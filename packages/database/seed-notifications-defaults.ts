/**
 * @his/database — Seed `RoleNotificationDefault` (US.B15.3.4).
 *
 * Backlog: docs/backlog/beta15_alerts_notifications.md §6 (matriz severity × rol).
 *
 * Modelo de datos: `RoleNotificationDefault (roleId, severity, channel, enabled)`,
 * PK compuesta `(roleId, severity, channel)`. Read-mostly; cambios via seed/migration.
 *
 * Semántica de `enabled`:
 *   - Sembramos siempre las 6 combinaciones (severity × channel) por rol con
 *     `enabled = true|false` según matriz. Esto deja explícitos los opt-out
 *     (p.ej. ADMIN+INFO+INBOX = false) y permite a `UserNotificationPreference`
 *     hacer fallback inequívoco sin ambigüedad NULL vs. ausencia.
 *
 * Idempotencia: `upsert` por PK `(roleId, severity, channel)`. Re-ejecuciones
 * son no-op (o sincronizan `enabled` si la matriz cambia en el código).
 *
 * Tolerancia: si una organización activa no tiene rol `X` (p.ej. PHYSICIAN no
 * creado todavía), se logea warning y se salta — NO rompe el seed completo.
 *
 * La matriz y la función `expandDefaultsForRole` viven en módulo separado
 * (`src/seeds/notifications-defaults-matrix.ts`) para que el test unitario
 * pueda importarlas sin instanciar `PrismaClient`.
 *
 * Ejecución:
 *   pnpm --filter @his/database seed:notif-defaults
 *   o:
 *   tsx --env-file=.env seed-notifications-defaults.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  ROLE_CODES,
  expandDefaultsForRole,
  type RoleCode,
} from "./src/seeds/notifications-defaults-matrix";

const prisma = new PrismaClient();

// ──────────────────────────── Lógica de seed ────────────────────────────

async function seedForRoleIds(
  scopeLabel: string,
  rolesByCode: Map<RoleCode, string>,
): Promise<number> {
  let upserts = 0;
  for (const code of ROLE_CODES) {
    const roleId = rolesByCode.get(code);
    if (!roleId) {
      console.warn(`[seed-notif-defaults] ${scopeLabel}: rol ${code} no existe. Saltando rol.`);
      continue;
    }
    for (const row of expandDefaultsForRole(code)) {
      await prisma.roleNotificationDefault.upsert({
        where: {
          roleId_severity_channel: {
            roleId,
            severity: row.severity,
            channel: row.channel,
          },
        },
        update: { enabled: row.enabled },
        create: {
          roleId,
          severity: row.severity,
          channel: row.channel,
          enabled: row.enabled,
        },
      });
      upserts++;
    }
  }
  return upserts;
}

async function seedForOrganization(organizationId: string, orgLabel: string): Promise<void> {
  const roles = await prisma.role.findMany({
    where: { organizationId, code: { in: ROLE_CODES }, active: true },
    select: { id: true, code: true },
  });
  if (roles.length === 0) {
    console.warn(
      `[seed-notif-defaults] org="${orgLabel}" (${organizationId}): sin roles ` +
        `${ROLE_CODES.join("/")}. Saltando.`,
    );
    return;
  }

  const rolesByCode = new Map<RoleCode, string>();
  for (const r of roles) rolesByCode.set(r.code as RoleCode, r.id);

  const upserts = await seedForRoleIds(`org="${orgLabel}"`, rolesByCode);
  console.log(
    `[seed-notif-defaults] org="${orgLabel}": ${upserts} filas upsert ` +
      `(${roles.length} roles × 6 combinaciones esperadas).`,
  );
}

async function main(): Promise<void> {
  console.log("[seed-notif-defaults] Inicio");

  // 1) Roles tenant-scoped (organizationId NOT NULL).
  const orgs = await prisma.organization.findMany({
    where: { active: true },
    select: { id: true, tradeName: true, legalName: true },
  });
  if (orgs.length === 0) {
    console.warn(
      "[seed-notif-defaults] No hay organizaciones activas — ejecuta `pnpm db:seed` primero.",
    );
  } else {
    for (const o of orgs) {
      const label = o.tradeName ?? o.legalName;
      await seedForOrganization(o.id, label);
    }
  }

  // 2) Roles globales (organizationId NULL), si los hay.
  const globalRoles = await prisma.role.findMany({
    where: { organizationId: null, code: { in: ROLE_CODES }, active: true },
    select: { id: true, code: true },
  });
  if (globalRoles.length > 0) {
    const rolesByCode = new Map<RoleCode, string>();
    for (const r of globalRoles) rolesByCode.set(r.code as RoleCode, r.id);
    const upserts = await seedForRoleIds("globales", rolesByCode);
    console.log(`[seed-notif-defaults] roles globales: ${upserts} filas upsert.`);
  }

  console.log("[seed-notif-defaults] Listo.");
}

// Permite importar este módulo desde tests u otros scripts sin disparar
// `main()`. Solo arranca cuando el script es invocado directamente.
const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /seed-notifications-defaults\.ts$/.test(process.argv[1]);

if (isDirectRun) {
  main()
    .catch((err) => {
      console.error("[seed-notif-defaults] ERROR", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
