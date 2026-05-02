/**
 * Helpers para preparar la base de datos antes/después de tests E2E.
 *
 * Estrategia (TDR §29.6):
 *   1. Apuntar `DATABASE_URL` a una BD dedicada `his_test`.
 *   2. `resetTestDatabase()` trunca tablas transaccionales (no catálogos
 *      semilla) en orden FK-safe.
 *   3. `seedMinimalFixtures()` inserta el conjunto mínimo (org, country,
 *      currency, service unit, beds, identifierType DUI/NIT) necesario
 *      para los flujos del MVP.
 *
 * Limitación conocida: no aislamos tests E2E por transacción porque
 * Playwright corre contra HTTP real. Se usa truncate + seed por suite.
 */

/**
 * Stub seguro: si se importa desde un test unitario que no levanta Prisma,
 * exporta funciones que lanzan un error claro al invocarse fuera de E2E.
 */
function notInE2E(): never {
  throw new Error(
    "test-database.ts solo debe usarse en tests E2E con DATABASE_URL apuntando a his_test",
  );
}

export interface TestDbHandle {
  /** Trunca tablas transaccionales (Patient, Encounter, Bed, AuditLog, Triage*). */
  reset(): Promise<void>;
  /** Inserta org+país+moneda+servicio+camas+identifierType. Retorna IDs. */
  seedMinimal(): Promise<{
    organizationId: string;
    countryId: string;
    currencyId: string;
    serviceUnitId: string;
    bedIds: string[];
  }>;
  /** Cierra la conexión Prisma. */
  close(): Promise<void>;
}

/**
 * Implementación real: requiere `@his/database` y `DATABASE_URL` a his_test.
 * Cargamos Prisma de forma perezosa para que los tests unitarios no lo
 * necesiten y esta utilidad pueda usarse desde Playwright globalSetup.
 */
export async function openTestDatabase(): Promise<TestDbHandle> {
  if (process.env.NODE_ENV === "production") notInE2E();
  if (!process.env.DATABASE_URL?.includes("test")) {
    throw new Error(
      "Negativa por seguridad: DATABASE_URL no contiene 'test'. " +
        "openTestDatabase solo opera contra una BD claramente marcada como test.",
    );
  }

  // Import dinámico — evita levantar Prisma fuera de E2E.
  const dbMod = await import("@his/database").catch(() => null);
  if (!dbMod || !("prisma" in dbMod)) {
    throw new Error("No se pudo importar @his/database para tests E2E.");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = (dbMod as any).prisma;

  return {
    async reset() {
      // Orden FK-safe: hijos primero.
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "AuditLog" CASCADE`);
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE "TriageDiscriminatorHit", "TriageVitalSign", "TriageEvaluation" CASCADE`,
      );
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE "EncounterTransfer", "BedAssignment", "Encounter" CASCADE`,
      );
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE "PatientAllergy", "PatientAddress", "PatientPhone", "PatientEmail", "PatientEmergencyContact", "PatientIdentifier", "Patient" CASCADE`,
      );
    },

    async seedMinimal() {
      // Implementación pragmática: delega al `prisma/seed.ts` real para no
      // duplicar lógica. El seed es idempotente.
      // @ts-expect-error -- import dinamico opcional: @his/database no exporta
      // ./prisma/seed publicamente; .catch() captura runtime si no se resuelve.
      const seed = await import("@his/database/prisma/seed").catch(() => null);
      if (seed && "main" in seed) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (seed as any).main();
      }
      // Retorna los IDs que el seed garantiza por código conocido.
      const org = await prisma.organization.findFirst({ where: { code: "AVANTE-SV" } });
      const country = await prisma.country.findFirst({ where: { iso2: "SV" } });
      const currency = await prisma.currency.findFirst({ where: { code: "USD" } });
      const su = await prisma.serviceUnit.findFirst({ where: { organizationId: org?.id } });
      const beds = await prisma.bed.findMany({
        where: { serviceUnitId: su?.id },
        take: 4,
      });
      return {
        organizationId: org!.id,
        countryId: country!.id,
        currencyId: currency!.id,
        serviceUnitId: su!.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        bedIds: beds.map((b: any) => b.id),
      };
    },

    async close() {
      await prisma.$disconnect();
    },
  };
}
