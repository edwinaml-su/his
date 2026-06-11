/**
 * Test de INTEGRACIÓN (schema contract) — eceBridgeCirugia ↔ esquema vivo.
 *
 * A diferencia de `bridge-cirugia.router.test.ts` (mockea el SQL), este test
 * corre el router REAL contra una BD REAL en una transacción con rollback. Si el
 * SQL del router no cuadra con el DDL (columna inexistente, valor fuera de CHECK,
 * enum inválido, NOT NULL omitido), el INSERT/UPDATE lanza y el test FALLA — la
 * clase de bug que descubrimos en quirófano (12 desajustes) y en ~28 routers más.
 *
 * Gating: solo corre con `INTEGRATION_DB=1` + `DATABASE_URL`. En CI: job separado
 * contra BD efímera. Nada persiste (rollback) → seguro contra BD compartida.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { eceBridgeCirugiaRouter } from "../../bridge-cirugia.router";
import { makeCtx } from "../../../../__tests__/helpers/caller";
import {
  hasIntegrationDb,
  makeIntegrationPrisma,
  withRollback,
} from "../../../../__tests__/integration/rollback-harness";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

interface Fixtures {
  estab: string;
  inst: string;
  user: string;
  org: string;
  paciente: string;
}

describe.skipIf(!hasIntegrationDb())("[integration] eceBridgeCirugia ↔ esquema vivo", () => {
  let prisma: PrismaClient;
  let fx: Fixtures;

  beforeAll(async () => {
    prisma = makeIntegrationPrisma();
    const q = (sql: string) =>
      (prisma.$queryRawUnsafe as (s: string) => Promise<Array<{ id: string }>>)(sql);
    const [estab] = await q(`SELECT id::text AS id FROM ece.establecimiento LIMIT 1`);
    const [inst] = await q(`SELECT id::text AS id FROM ece.institucion LIMIT 1`);
    const [user] = await q(`SELECT id::text AS id FROM public."User" LIMIT 1`);
    const [org] = await q(`SELECT id::text AS id FROM public."Organization" LIMIT 1`);
    const [paciente] = await q(`SELECT id::text AS id FROM ece.paciente LIMIT 1`);
    fx = { estab: estab!.id, inst: inst!.id, user: user!.id, org: org!.id, paciente: paciente!.id };
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("programarCirugia + cancelarPrograma ejecutan contra el DDL real (rollback)", async () => {
    const result = await withRollback(prisma, async (db) => {
      // Fixtures (rollback): personal ECE (his_user_id = User real) + sala QX.
      const [personal] = (await db.$queryRawUnsafe(
        `INSERT INTO ece.personal_salud
           (his_user_id, institucion_id, establecimiento_id, documento_identidad, nombre_completo, activo)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'HARNESS-CIR', 'Dr Harness', true)
         RETURNING id::text AS id`,
        fx.user, fx.inst, fx.estab,
      )) as Array<{ id: string }>;
      const [sala] = (await db.$queryRawUnsafe(
        `INSERT INTO ece.sala_qx (establecimiento_id, codigo, nombre, tipo)
         VALUES ($1::uuid, 'HARNESS-QX', 'QX Harness', 'mayor')
         RETURNING id::text AS id`,
        fx.estab,
      )) as Array<{ id: string }>;
      // El trigger fn_episodio_log_estado usa app.current_user_id como FK a personal_salud.
      await db.$executeRawUnsafe(
        `SELECT set_config('app.current_user_id', $1, true)`,
        personal!.id,
      );

      const ctx = makeCtx({
        prisma: db,
        user: { ...MOCK_USER_ADMIN, id: fx.user },
        tenant: { ...MOCK_TENANT, organizationId: fx.org, roleCodes: ["PHYSICIAN"] },
      });
      const caller = eceBridgeCirugiaRouter.createCaller(ctx);

      const prog = await caller.programarCirugia({
        pacienteId: fx.paciente,
        procedimientoCie10: "K35.89",
        fechaProgramada: new Date(Date.now() + 86_400_000).toISOString(),
        cirujanoId: personal!.id,
        anestesiologoId: personal!.id,
        salaQxId: sala!.id,
        duracionEstimadaMin: 90,
      });
      expect(prog.ordenId).toBeTruthy();
      expect(prog.episodioId).toBeTruthy();
      expect(prog.preOpId).toBeTruthy();
      expect(prog.reservaId).toBeTruthy();

      const cancel = await caller.cancelarPrograma({
        ordenId: prog.ordenId,
        motivo: "harness rollback",
      });
      expect(cancel.ok).toBe(true);
      return prog;
    });
    expect(result.ordenId).toBeTruthy();
  }, 30_000);

  it("DETECTA drift: el bug clásico (estado_registro='borrador') lanza CHECK 23514", async () => {
    // Demuestra que el harness atrapa exactamente la clase de bug de los ~28
    // routers: un valor fuera del CHECK del DDL. (orden_ingreso.estado_registro
    // solo admite 'vigente'/'rectificado'.)
    await expect(
      withRollback(prisma, async (db) => {
        await db.$executeRawUnsafe(
          `INSERT INTO ece.orden_ingreso
             (instancia_id, paciente_id, circunstancia_ingreso, motivo_ingreso,
              procedencia, modalidad, medico_ordena, estado_registro)
           VALUES (gen_random_uuid(), $1::uuid, 'x', 'x',
              'consulta_externa', 'hospitalizacion', gen_random_uuid(), 'borrador')`,
          fx.paciente,
        );
      }),
    ).rejects.toThrow(/check|23514|estado_registro/i);
  });
});
