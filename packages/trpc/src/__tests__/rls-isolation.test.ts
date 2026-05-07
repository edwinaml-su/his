/**
 * US-1.7 — RLS isolation tests.
 *
 * Suite de integración real contra Postgres. Crea 2 organizaciones + 2 usuarios
 * + 1 paciente por organización y valida que las policies RLS impidan que
 * usuarios de Org A vean datos de Org B.
 *
 * NO se ejecuta en CI por defecto: requiere una BD de TEST con las migraciones
 * de Prisma + `01_rls_policies.sql` + `04_rls_session_helpers.sql` aplicados.
 *
 * Para correr localmente:
 *   export RUN_RLS_TESTS=1
 *   export DATABASE_URL="postgresql://...test_db"
 *   npm run -w @his/trpc test -- rls-isolation
 *
 * El alias `@his/database` está mapeado a un stub en `vitest.config.ts`,
 * por eso este archivo importa `PrismaClient` directamente desde
 * `@prisma/client` y crea su propia instancia.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { applyTenantContext, clearTenantContext } from "../rls-context";

const RUN = process.env.RUN_RLS_TESTS === "1";

// Construimos un cliente nuevo solo para esta suite. Si RUN_RLS_TESTS no está
// activo, ni siquiera intentamos conectar.
const prisma: PrismaClient | null = RUN
  ? new PrismaClient({ log: ["error"] })
  : null;

// IDs únicos por corrida — evitamos colisiones si la BD no se purga entre runs.
const RUN_TAG = randomUUID().slice(0, 8);
const orgAId = randomUUID();
const orgBId = randomUUID();
const userAId = randomUUID();
const userBId = randomUUID();
const patientAId = randomUUID();
const patientBId = randomUUID();

// Estos IDs los resolvemos en beforeAll leyendo catálogos seed.
let countryId: string;
let biologicalSexId: string;
let functionalCurrencyId: string;

describe.skipIf(!RUN)("RLS isolation (US-1.7)", () => {
  beforeAll(async () => {
    if (!prisma) return;

    // 1. Resolver FKs requeridas desde catálogos seed.
    //    Asumimos al menos un país, una BiologicalSex y una Currency cargados.
    //    Si la BD de test no los tiene, fallar aquí con mensaje claro.
    const country = await prisma.country.findFirst({ select: { id: true } });
    const sex = await prisma.biologicalSex.findFirst({ select: { id: true } });
    const currency = await prisma.currency.findFirst({ select: { id: true } });

    if (!country || !sex || !currency) {
      throw new Error(
        "BD de test sin seed mínimo (Country / BiologicalSex / Currency). " +
          "Ejecutar `npm run -w @his/database seed` antes de los tests RLS.",
      );
    }
    countryId = country.id;
    biologicalSexId = sex.id;
    functionalCurrencyId = currency.id;

    // 2. Crear las 2 organizaciones + pacientes vía service_role (BYPASSRLS).
    //    Prisma con DATABASE_URL apuntando al rol con bypass omite RLS.
    await prisma.$transaction([
      prisma.organization.create({
        data: {
          id: orgAId,
          countryId,
          legalName: `RLS-Test-OrgA-${RUN_TAG}`,
          taxId: `RLS-A-${RUN_TAG}`,
          functionalCurrency: functionalCurrencyId,
        },
      }),
      prisma.organization.create({
        data: {
          id: orgBId,
          countryId,
          legalName: `RLS-Test-OrgB-${RUN_TAG}`,
          taxId: `RLS-B-${RUN_TAG}`,
          functionalCurrency: functionalCurrencyId,
        },
      }),
      prisma.patient.create({
        data: {
          id: patientAId,
          organizationId: orgAId,
          mrn: `MRN-A-${RUN_TAG}`,
          firstName: "Alice",
          lastName: "OrgA",
          biologicalSexId,
        },
      }),
      prisma.patient.create({
        data: {
          id: patientBId,
          organizationId: orgBId,
          mrn: `MRN-B-${RUN_TAG}`,
          firstName: "Bob",
          lastName: "OrgB",
          biologicalSexId,
        },
      }),
    ]);
  }, 30_000);

  afterAll(async () => {
    if (!prisma) return;
    // Cleanup en orden inverso de FKs. Cada paso tolera fallo aislado.
    await prisma.userCredential
      .deleteMany({ where: { userId: { in: [userAId, userBId] } } })
      .catch(() => undefined);
    await prisma.userOrganizationRole
      .deleteMany({ where: { userId: { in: [userAId, userBId] } } })
      .catch(() => undefined);
    await prisma.patient
      .deleteMany({ where: { id: { in: [patientAId, patientBId] } } })
      .catch(() => undefined);
    await prisma.user
      .deleteMany({ where: { id: { in: [userAId, userBId] } } })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: { in: [orgAId, orgBId] } } })
      .catch(() => undefined);
    await prisma.$disconnect();
  });

  // El demote a rol `authenticated` ahora vive dentro de
  // `applyTenantContext` y `clearTenantContext` (defensa en profundidad
  // runtime). Estos tests heredan el comportamiento sin pasos extra.

  it("Test 1: User A con context Org A puede leer paciente A", async () => {
    if (!prisma) return;
    const result = await prisma.$transaction(async (tx) => {
      await applyTenantContext(tx as unknown as PrismaClient, {
        userId: userAId,
        organizationId: orgAId,
      });
      return tx.patient.findUnique({ where: { id: patientAId } });
    });
    expect(result).not.toBeNull();
    expect(result?.id).toBe(patientAId);
    expect(result?.organizationId).toBe(orgAId);
  });

  it("Test 2: User A con context Org A NO puede leer paciente B (cross-org)", async () => {
    if (!prisma) return;
    const result = await prisma.$transaction(async (tx) => {
      await applyTenantContext(tx as unknown as PrismaClient, {
        userId: userAId,
        organizationId: orgAId,
      });
      // Lookup directo por ID del paciente B → RLS lo oculta → null.
      const direct = await tx.patient.findUnique({ where: { id: patientBId } });
      // Listado por org B → RLS filtra a 0.
      const listed = await tx.patient.findMany({
        where: { organizationId: orgBId },
      });
      return { direct, listed };
    });
    expect(result.direct).toBeNull();
    expect(result.listed).toHaveLength(0);
  });

  it("Test 3: Sin context (RLS estricta) no puede leer pacientes", async () => {
    if (!prisma) return;
    const count = await prisma.$transaction(async (tx) => {
      await clearTenantContext(tx as unknown as PrismaClient);
      const rows = await tx.patient.findMany({
        where: { id: { in: [patientAId, patientBId] } },
      });
      return rows.length;
    });
    expect(count).toBe(0);
  });

  it("Test 4: Break-glass permite cross-org (queda audit aparte)", async () => {
    if (!prisma) return;
    const rows = await prisma.$transaction(async (tx) => {
      await applyTenantContext(
        tx as unknown as PrismaClient,
        { userId: userAId, organizationId: orgAId },
        { breakGlass: true },
      );
      return tx.patient.findMany({
        where: { id: { in: [patientAId, patientBId] } },
      });
    });
    expect(rows.map((r) => r.id).sort()).toEqual([patientAId, patientBId].sort());
    // Audit log de break-glass se valida en otro test (audit.router) —
    // aquí solo demostramos que la policy lo permite.
  });

  // 06_rls_auth_audit.sql — aislamiento de auth/audit/financial.
  it("Test 5: audit.AuditLog respeta organizationId del contexto", async () => {
    if (!prisma) return;
    // entityId único por test para no chocar con auditoría de los seed inserts.
    const tagA = `rls-audit-A-${RUN_TAG}`;
    const tagB = `rls-audit-B-${RUN_TAG}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO audit."AuditLog" ("occurredAt", "organizationId", action, entity, "entityId")
       VALUES (now(), $1::uuid, 'CREATE'::"AuditAction", 'TestEntity', $2),
              (now(), $3::uuid, 'CREATE'::"AuditAction", 'TestEntity', $4)`,
      orgAId,
      tagA,
      orgBId,
      tagB,
    );

    const rows = await prisma.$transaction(async (tx) => {
      await applyTenantContext(tx as unknown as PrismaClient, {
        userId: userAId,
        organizationId: orgAId,
      });
      return tx.$queryRawUnsafe<Array<{ entityId: string }>>(
        `SELECT "entityId" FROM audit."AuditLog" WHERE "entityId" IN ($1, $2)`,
        tagA,
        tagB,
      );
    });
    expect(rows.map((r) => r.entityId)).toEqual([tagA]);

    // Cleanup directo (postgres role bypass) — el trigger trg_auditlog_no_update
    // bloquea DELETE/UPDATE app-side. Limpiar mediante DISABLE TRIGGER + restore
    // sería caro; aceptamos que estos rows queden en el log (entityId tagueado).
  });

  it("Test 6: User es visible cross-tenant si comparte org via UserOrganizationRole", { timeout: 30_000 }, async () => {
    if (!prisma) return;
    // userA y userB no existen aun como User rows (los IDs son sólo refs).
    // Crear ambos + asignar a sus orgs vía UserOrganizationRole.
    const role = await prisma.role.findFirst({ select: { id: true } });
    if (!role) throw new Error("seed sin Role minimo");

    await prisma.$transaction([
      prisma.user.upsert({
        where: { id: userAId },
        create: { id: userAId, email: `rls-a-${RUN_TAG}@x.test`, fullName: "RLS A" },
        update: {},
      }),
      prisma.user.upsert({
        where: { id: userBId },
        create: { id: userBId, email: `rls-b-${RUN_TAG}@x.test`, fullName: "RLS B" },
        update: {},
      }),
      prisma.userOrganizationRole.create({
        data: { userId: userAId, organizationId: orgAId, roleId: role.id },
      }),
      prisma.userOrganizationRole.create({
        data: { userId: userBId, organizationId: orgBId, roleId: role.id },
      }),
    ]);

    const visible = await prisma.$transaction(async (tx) => {
      await applyTenantContext(tx as unknown as PrismaClient, {
        userId: userAId,
        organizationId: orgAId,
      });
      return tx.user.findMany({
        where: { id: { in: [userAId, userBId] } },
        select: { id: true },
      });
    });
    // userA se ve a sí mismo + via UOR; userB es de otra org → invisible.
    expect(visible.map((u) => u.id)).toEqual([userAId]);
  });

  it("Test 7: UserCredential sólo visible para el propio userId", { timeout: 30_000 }, async () => {
    if (!prisma) return;
    const credAId = randomUUID();
    const credBId = randomUUID();
    await prisma.$transaction([
      prisma.userCredential.create({
        data: { id: credAId, userId: userAId, method: "PASSWORD", secretHash: "x" },
      }),
      prisma.userCredential.create({
        data: { id: credBId, userId: userBId, method: "PASSWORD", secretHash: "x" },
      }),
    ]);

    const visible = await prisma.$transaction(async (tx) => {
      await applyTenantContext(tx as unknown as PrismaClient, {
        userId: userAId,
        organizationId: orgAId,
      });
      return tx.userCredential.findMany({
        where: { id: { in: [credAId, credBId] } },
        select: { id: true, userId: true },
      });
    });
    expect(visible.map((c) => c.id)).toEqual([credAId]);

    await prisma.userCredential
      .deleteMany({ where: { id: { in: [credAId, credBId] } } })
      .catch(() => undefined);
  });
});
