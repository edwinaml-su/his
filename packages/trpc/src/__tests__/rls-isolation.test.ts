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
    // Cleanup en orden inverso. Cualquier fallo se loguea pero no bloquea.
    await prisma.patient
      .deleteMany({ where: { id: { in: [patientAId, patientBId] } } })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: { in: [orgAId, orgBId] } } })
      .catch(() => undefined);
    await prisma.$disconnect();
  });

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
    // Nota: si DATABASE_URL apunta al rol service_role / superuser con
    // BYPASSRLS, este test verá ambos pacientes y fallará. Es la señal
    // correcta — la suite debe correr con un rol app, no con bypass.
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
});
