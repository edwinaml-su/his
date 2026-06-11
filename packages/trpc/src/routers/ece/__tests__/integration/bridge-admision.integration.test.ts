/**
 * Test de INTEGRACIÓN (schema contract) — eceBridgeAdmision ↔ esquema vivo.
 *
 * Cubre el flujo principal: admitirDesdeOrden.
 *
 * Cadena de fixtures (dentro del rollback):
 *   1. personal_salud (his_user_id = User real, para el ADM)
 *   2. firma_electronica con PIN '1234' hasheado con pgcrypto crypt()
 *   3. tipo_documento HOJA_ING + flujo_estado 'firmado' (ya sembrado en BD)
 *   4. documento_instancia ORDEN_ING en estado 'firmado'
 *   5. orden_ingreso apuntando a la instancia, con estado_registro = 'vigente'
 *
 * El router verifica el PIN usando `crypt(pin, hash) = hash` de pgcrypto.
 * Insertamos el hash directamente con `crypt('1234', gen_salt('bf', 4))`.
 *
 * Gating: solo corre con INTEGRATION_DB=1 + DATABASE_URL/DIRECT_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { eceBridgeAdmisionRouter } from "../../bridge-admision.router";
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

describe.skipIf(!hasIntegrationDb())(
  "[integration] eceBridgeAdmision ↔ esquema vivo",
  () => {
    let prisma: PrismaClient;
    let fx: Fixtures;

    beforeAll(async () => {
      prisma = makeIntegrationPrisma();
      const q = (sql: string) =>
        (prisma.$queryRawUnsafe as (s: string) => Promise<Array<{ id: string }>>)(sql);
      const [estab]    = await q(`SELECT id::text AS id FROM ece.establecimiento LIMIT 1`);
      const [inst]     = await q(`SELECT id::text AS id FROM ece.institucion LIMIT 1`);
      const [user]     = await q(`SELECT id::text AS id FROM public."User" LIMIT 1`);
      const [org]      = await q(`SELECT id::text AS id FROM public."Organization" LIMIT 1`);
      const [paciente] = await q(`SELECT id::text AS id FROM ece.paciente LIMIT 1`);
      fx = {
        estab: estab!.id,
        inst: inst!.id,
        user: user!.id,
        org: org!.id,
        paciente: paciente!.id,
      };
    }, 30_000);

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it(
      "admitirDesdeOrden ejecuta la cadena de 9 pasos contra el DDL real (rollback)",
      async () => {
        const result = await withRollback(prisma, async (db) => {
          // Fixture 1: personal_salud para el ADM
          const [personal] = (await db.$queryRawUnsafe(
            `INSERT INTO ece.personal_salud
               (his_user_id, institucion_id, establecimiento_id, documento_identidad, nombre_completo, activo)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'HARNESS-ADM', 'Adm Harness', true)
             RETURNING id::text AS id`,
            fx.user, fx.inst, fx.estab,
          )) as Array<{ id: string }>;
          const personalId = personal!.id;

          // Fixture 2: firma_electronica con PIN '1234' en bcrypt (cost 4 — rápido)
          // salt_extra es NOT NULL — se usa como extra entropy, aquí usamos el mismo salt.
          const [firmaRow] = (await db.$queryRawUnsafe(
            `INSERT INTO ece.firma_electronica (personal_id, pin_hash, salt_extra, failed_attempts)
             VALUES ($1::uuid, crypt('1234', gen_salt('bf', 4)), gen_salt('bf', 4), 0)
             RETURNING id::text AS id`,
            personalId,
          )) as Array<{ id: string }>;
          expect(firmaRow!.id).toBeTruthy();

          // Fixture 3: tipo_documento ORDEN_ING para crear la instancia de la orden
          // (la orden_ingreso.instancia_id FK → documento_instancia.id)
          const [tipoOrdenRow] = (await db.$queryRawUnsafe(
            `SELECT id::text AS id FROM ece.tipo_documento WHERE codigo = 'ORDEN_ING' AND activo = true LIMIT 1`,
          )) as Array<{ id: string }>;

          // Si ORDEN_ING no está sembrado, buscamos cualquier tipo con estado firmado
          const tipoId = tipoOrdenRow?.id;
          if (!tipoId) {
            // TODO: Si la BD no tiene ORDEN_ING sembrado, este test no puede completarse.
            // Seed requerido: INSERT INTO ece.tipo_documento (codigo, ...) VALUES ('ORDEN_ING', ...)
            return { skipped: true as const, episodioId: null };
          }

          const [estadoFirmadoRow] = (await db.$queryRawUnsafe(
            `SELECT fe.id::text AS id FROM ece.flujo_estado fe
             WHERE fe.tipo_documento_id = $1::uuid AND fe.codigo = 'firmado'
             LIMIT 1`,
            tipoId,
          )) as Array<{ id: string }>;

          if (!estadoFirmadoRow) {
            return { skipped: true as const, episodioId: null };
          }

          // Fixture 4: documento_instancia en estado 'firmado' para la orden
          const [instanciaOrdenRow] = (await db.$queryRawUnsafe(
            `INSERT INTO ece.documento_instancia
               (tipo_documento_id, paciente_id, estado_actual_id, creado_por)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
             RETURNING id::text AS id`,
            tipoId, fx.paciente, estadoFirmadoRow.id, personalId,
          )) as Array<{ id: string }>;
          const instanciaOrdenId = instanciaOrdenRow!.id;

          // Fixture 5: orden_ingreso con instancia firmada (sin episodio_id → pendiente)
          const [ordenRow] = (await db.$queryRawUnsafe(
            `INSERT INTO ece.orden_ingreso
               (instancia_id, paciente_id, circunstancia_ingreso, motivo_ingreso,
                procedencia, modalidad, medico_ordena, estado_registro)
             VALUES ($1::uuid, $2::uuid, 'programado', 'Cirugía electiva',
                     'consulta_externa', 'hospitalizacion', $3::uuid, 'vigente')
             RETURNING id::text AS id`,
            instanciaOrdenId, fx.paciente, personalId,
          )) as Array<{ id: string }>;
          const ordenId = ordenRow!.id;

          const ctx = makeCtx({
            prisma: db,
            user: { ...MOCK_USER_ADMIN, id: fx.user },
            tenant: {
              ...MOCK_TENANT,
              organizationId: fx.org,
              establishmentId: fx.estab,
              roleCodes: ["ADM"],
            },
          });
          const caller = eceBridgeAdmisionRouter.createCaller(ctx);

          const result = await caller.admitirDesdeOrden({
            ordenIngresoId: ordenId,
            fechaHoraIngreso: new Date().toISOString(),
            modalidad: "hospitalizacion",
            procedencia: "consulta_externa",
            pinAdm: "1234",
          });

          expect(result.episodioId).toBeTruthy();
          expect(result.hojaIngresoId).toBeTruthy();
          return result;
        });

        // Si saltamos por fixture faltante, reportamos sin fallar
        if (result && typeof result === "object" && "skipped" in result && result.skipped) {
          // TODO: sembrar ORDEN_ING en la BD de integración para habilitar este test
          console.warn("[integration] SKIP: tipo_documento ORDEN_ING no encontrado en BD.");
          return;
        }
        expect((result as { episodioId: string }).episodioId).toBeTruthy();
      },
      30_000,
    );

    it(
      "admitirDesdeOrden FALLA con PIN incorrecto",
      async () => {
        await expect(
          withRollback(prisma, async (db) => {
            // Fixture mínimo: personal con firma
            const [personal] = (await db.$queryRawUnsafe(
              `INSERT INTO ece.personal_salud
                 (his_user_id, institucion_id, establecimiento_id, documento_identidad, nombre_completo, activo)
               VALUES ($1::uuid, $2::uuid, $3::uuid, 'HARNESS-ADM2', 'Adm Harness 2', true)
               RETURNING id::text AS id`,
              fx.user, fx.inst, fx.estab,
            )) as Array<{ id: string }>;
            const personalId = personal!.id;

            await db.$queryRawUnsafe(
              `INSERT INTO ece.firma_electronica (personal_id, pin_hash, salt_extra, failed_attempts)
               VALUES ($1::uuid, crypt('correct-pin', gen_salt('bf', 4)), gen_salt('bf', 4), 0)`,
              personalId,
            );

            // Necesitamos una orden para llegar a la verificación de PIN
            const tipoOrdenRows = (await db.$queryRawUnsafe(
              `SELECT td.id::text AS id FROM ece.tipo_documento td
               JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.codigo = 'firmado'
               WHERE td.activo = true LIMIT 1`,
            )) as Array<{ id: string }>;

            if (tipoOrdenRows.length === 0) {
              // Sin fixtures de tipo_documento no podemos llegar al check de PIN
              return { reached_pin_check: false };
            }

            const tipoId = tipoOrdenRows[0]!.id;
            const [estadoFirmadoRow] = (await db.$queryRawUnsafe(
              `SELECT fe.id::text AS id FROM ece.flujo_estado fe
               WHERE fe.tipo_documento_id = $1::uuid AND fe.codigo = 'firmado' LIMIT 1`,
              tipoId,
            )) as Array<{ id: string }>;

            const [instRow] = (await db.$queryRawUnsafe(
              `INSERT INTO ece.documento_instancia
                 (tipo_documento_id, paciente_id, estado_actual_id, creado_por)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
               RETURNING id::text AS id`,
              tipoId, fx.paciente, estadoFirmadoRow!.id, personalId,
            )) as Array<{ id: string }>;

            const [ordenRow] = (await db.$queryRawUnsafe(
              `INSERT INTO ece.orden_ingreso
                 (instancia_id, paciente_id, circunstancia_ingreso, motivo_ingreso,
                  procedencia, modalidad, medico_ordena, estado_registro)
               VALUES ($1::uuid, $2::uuid, 'urgencia', 'Prueba PIN',
                       'consulta_externa', 'hospitalizacion', $3::uuid, 'vigente')
               RETURNING id::text AS id`,
              instRow!.id, fx.paciente, personalId,
            )) as Array<{ id: string }>;

            const ctx = makeCtx({
              prisma: db,
              user: { ...MOCK_USER_ADMIN, id: fx.user },
              tenant: {
                ...MOCK_TENANT,
                organizationId: fx.org,
                establishmentId: fx.estab,
                roleCodes: ["ADM"],
              },
            });
            const caller = eceBridgeAdmisionRouter.createCaller(ctx);

            return caller.admitirDesdeOrden({
              ordenIngresoId: ordenRow!.id,
              fechaHoraIngreso: new Date().toISOString(),
              modalidad: "hospitalizacion",
              procedencia: "consulta_externa",
              pinAdm: "wrong-pin",
            });
          }),
        ).rejects.toThrow(/PIN|UNAUTHORIZED|incorrecto/i);
      },
      30_000,
    );
  },
);
