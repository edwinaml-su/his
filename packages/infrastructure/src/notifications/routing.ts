/**
 * Routing rules Beta.15 — defaults hardcoded por role × severity.
 *
 * Fuente: `docs/backlog/beta15_alerts_notifications.md` §6.
 *
 * | Rol         | CRITICAL          | WARNING           | INFO   |
 * | Doctor      | EMAIL + INBOX     | EMAIL + INBOX     | INBOX  |
 * | Nurse       | EMAIL + INBOX     | INBOX             | INBOX  |
 * | Pharmacist  | EMAIL + INBOX     | EMAIL + INBOX     | INBOX  |
 * | Admin Org   | EMAIL + INBOX     | INBOX             | (off)  |
 *
 * Reglas duras (no editables por preferences):
 *   - CRITICAL siempre dispara INBOX para el target.
 *   - CRITICAL siempre dispara EMAIL si el user tiene email no nulo.
 *
 * Roadmap: estos defaults vivirán en `RoleNotificationDefault` (BD) y serán
 * configurables. Mientras esa US (US.B15.3.3 preferences UI) no aterriza,
 * el dispatcher resuelve aquí.
 */
import type { PrismaClient } from "@prisma/client";

export type Severity = "CRITICAL" | "WARNING" | "INFO";
export type Channel = "INBOX" | "EMAIL";

export interface ChannelSet {
  inbox: boolean;
  email: boolean;
}

/**
 * Códigos de rol según seed canónico (`packages/database/prisma/seed.ts`).
 * NOTA: el backlog habla de "Doctor" — en BD el code es `PHYSICIAN`.
 */
export const ROLE_CODES = {
  DOCTOR: "PHYSICIAN",
  NURSE: "NURSE",
  PHARMACIST: "PHARMACIST",
  ADMIN: "ADMIN",
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

export interface RoleSeverityMatrix {
  critical: ChannelSet;
  warning: ChannelSet;
  info: ChannelSet;
}

const ALL: ChannelSet = { inbox: true, email: true };
const INBOX_ONLY: ChannelSet = { inbox: true, email: false };
const OFF: ChannelSet = { inbox: false, email: false };

/**
 * Defaults por rol. Si un rol no aparece en este map, se aplica
 * `FALLBACK_DEFAULTS` (mismos que doctor — el más permisivo para no
 * silenciar alertas críticas a usuarios con roles no mapeados).
 */
export const DEFAULT_ROLE_DEFAULTS: ReadonlyMap<string, RoleSeverityMatrix> =
  new Map<string, RoleSeverityMatrix>([
    [ROLE_CODES.DOCTOR, { critical: ALL, warning: ALL, info: INBOX_ONLY }],
    [ROLE_CODES.NURSE, { critical: ALL, warning: INBOX_ONLY, info: INBOX_ONLY }],
    [ROLE_CODES.PHARMACIST, { critical: ALL, warning: ALL, info: INBOX_ONLY }],
    [ROLE_CODES.ADMIN, { critical: ALL, warning: INBOX_ONLY, info: OFF }],
  ]);

/** Fallback usado cuando el role code del user no está mapeado. */
export const FALLBACK_DEFAULTS: RoleSeverityMatrix = {
  critical: ALL,
  warning: INBOX_ONLY,
  info: INBOX_ONLY,
};

/**
 * Resuelve los canales aplicables para una tupla (role, severity)
 * aplicando reglas duras + defaults + overrides de preferences del user.
 *
 * @param roleCode  Código del rol del recipient (ej "PHYSICIAN"). Si null,
 *                  se usa FALLBACK_DEFAULTS.
 * @param severity  Severidad del evento.
 * @param hasEmail  Si el user tiene `email` no nulo. Si false, EMAIL se
 *                  fuerza a `false` aunque defaults/prefs lo permitan.
 * @param userPrefs Filas `UserNotificationPreference` del user — overrides
 *                  por (severity, channel). Si vacío/undefined → solo defaults.
 * @param overrides Mapa de defaults por role (opcional, p/ tests).
 */
export function resolveChannels(args: {
  roleCode: string | null;
  severity: Severity;
  hasEmail: boolean;
  userPrefs?: ReadonlyArray<{
    severity: string;
    channel: string;
    enabled: boolean;
  }>;
  overrides?: ReadonlyMap<string, RoleSeverityMatrix>;
}): ChannelSet {
  const { roleCode, severity, hasEmail, userPrefs, overrides } = args;
  const defaultsMap = overrides ?? DEFAULT_ROLE_DEFAULTS;
  const matrix =
    (roleCode ? defaultsMap.get(roleCode) : undefined) ?? FALLBACK_DEFAULTS;

  const baseChannels = pickSeverityRow(matrix, severity);
  const channels: ChannelSet = { inbox: baseChannels.inbox, email: baseChannels.email };

  // Overrides del user (UserNotificationPreference) — sólo aplican a la
  // severity exacta del evento.
  if (userPrefs && userPrefs.length > 0) {
    for (const pref of userPrefs) {
      if (pref.severity !== severity) continue;
      if (pref.channel === "INBOX") channels.inbox = pref.enabled;
      else if (pref.channel === "EMAIL") channels.email = pref.enabled;
    }
  }

  // Reglas duras: CRITICAL fuerza INBOX y, si hay email, también EMAIL.
  if (severity === "CRITICAL") {
    channels.inbox = true;
    if (hasEmail) channels.email = true;
  }

  // Si no hay email registrado, EMAIL no puede salir aunque defaults/prefs
  // lo permitan — no rompemos por destinatario sin email.
  if (!hasEmail) channels.email = false;

  return channels;
}

function pickSeverityRow(matrix: RoleSeverityMatrix, severity: Severity): ChannelSet {
  switch (severity) {
    case "CRITICAL":
      return matrix.critical;
    case "WARNING":
      return matrix.warning;
    case "INFO":
      return matrix.info;
  }
}

// -----------------------------------------------------------------------------
// CC-0031 Fase 1(d) — `RoleNotificationDefault` en BD con fallback al mapa
// hardcodeado de arriba. Deuda declarada desde Beta.15 (ver comentario del
// header): ahora que `sql/238` siembra la tabla para TODOS los roles, el
// dispatcher puede leerla — pero sigue funcionando si está vacía (prod hoy,
// antes de aplicar sql/238) o si el rol puntual no tiene fila todavía.
// -----------------------------------------------------------------------------

/**
 * Recorte de `PrismaClient` — mismo patrón que `RolesDelegate` en
 * `packages/trpc/src/rbac/effective-roles.ts` (permite mockear con
 * `vitest-mock-extended` sin instanciar el cliente completo).
 */
export type RoleNotificationDefaultsDelegate = Pick<
  PrismaClient,
  "role" | "roleNotificationDefault"
>;

/**
 * Construye un `RoleSeverityMatrix` a partir de las filas de
 * `RoleNotificationDefault` de un rol. Si `rows` no trae las 6 combinaciones
 * (severity × channel), las faltantes se completan con `FALLBACK_DEFAULTS`
 * — nunca degradamos silenciosamente a "sin canal" por una fila ausente.
 */
export function buildMatrixFromRows(
  rows: ReadonlyArray<{ severity: string; channel: string; enabled: boolean }>,
): RoleSeverityMatrix {
  const get = (severity: Severity, channel: Channel): boolean => {
    const row = rows.find((r) => r.severity === severity && r.channel === channel);
    if (row) return row.enabled;
    return pickSeverityRow(FALLBACK_DEFAULTS, severity)[channel === "INBOX" ? "inbox" : "email"];
  };
  return {
    critical: { inbox: get("CRITICAL", "INBOX"), email: get("CRITICAL", "EMAIL") },
    warning: { inbox: get("WARNING", "INBOX"), email: get("WARNING", "EMAIL") },
    info: { inbox: get("INFO", "INBOX"), email: get("INFO", "EMAIL") },
  };
}

/**
 * Resuelve los canales para (roleCode, severity) leyendo `RoleNotificationDefault`
 * de BD primero; si el rol no existe o no tiene filas, cae a `resolveChannels`
 * (mapa hardcodeado / `overrides` explícito de tests). Nunca lanza — cualquier
 * error de BD degrada al comportamiento pre-CC-0031 (mismo contrato fail-safe
 * que `getEffectiveRoleCodes`, ver rbac/effective-roles.ts).
 */
export async function resolveChannelsFromDb(args: {
  prisma: RoleNotificationDefaultsDelegate;
  organizationId: string;
  roleCode: string | null;
  severity: Severity;
  hasEmail: boolean;
  userPrefs?: ReadonlyArray<{ severity: string; channel: string; enabled: boolean }>;
}): Promise<ChannelSet> {
  const { prisma, organizationId, roleCode, severity, hasEmail, userPrefs } = args;
  if (!roleCode) {
    return resolveChannels({ roleCode, severity, hasEmail, userPrefs });
  }
  try {
    const role = await prisma.role.findFirst({
      where: { code: roleCode, OR: [{ organizationId }, { organizationId: null }] },
      select: { id: true },
    });
    if (!role) {
      return resolveChannels({ roleCode, severity, hasEmail, userPrefs });
    }
    const rows = await prisma.roleNotificationDefault.findMany({
      where: { roleId: role.id },
      select: { severity: true, channel: true, enabled: true },
    });
    if (!Array.isArray(rows) || rows.length === 0) {
      return resolveChannels({ roleCode, severity, hasEmail, userPrefs });
    }
    const matrix = buildMatrixFromRows(rows);
    return resolveChannels({
      roleCode,
      severity,
      hasEmail,
      userPrefs,
      overrides: new Map([[roleCode, matrix]]),
    });
  } catch {
    return resolveChannels({ roleCode, severity, hasEmail, userPrefs });
  }
}
