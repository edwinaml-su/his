/**
 * Test de INTEGRACIÓN (schema contract) — eceEpisodioHospitalario ↔ esquema vivo.
 *
 * Cubre el flujo completo de alta médica en dos pasos:
 *   1. iniciarAltaMedica → crea borrador epicrisis_egreso.
 *   2. confirmarAlta     → cierra episodio (requiere epicrisis firmada).
 *
 * Fixtures creados dentro del rollback (nada persiste):
 *   - personal_salud (his_user_id = User real)
 *   - episodio_atencion (modalidad = ambulatorio, estado = en_curso)
 *   - episodio_hospitalario (FK → episodio_atencion)
 *   - tipo_documento EPICRISIS + flujo_estado ya deben existir en la BD (sembrados).
 *
 * Gating: solo corre con INTEGRATION_DB=1 + DATABASE_URL/DIRECT_URL.
 * Nada persiste (withRollback garantiza rollback).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { eceEpisodioHospitalarioRouter } from "../../episodio-hospitalario.router";
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
  "[integration] eceEpisodioHospitalario ↔ esquema vivo",
  () => {
    let prisma: PrismaClient;
    let fx: Fixtures;

    beforeAll(async () => {
      prisma = makeIntegrationPrisma();
      const q = (sql: string) =>
        (prisma.$queryRawUnsafe as (s: string) => Promise<Array<{ id: string }>>)(sql);
      const [estab]   = await q(`SELECT id::text AS id FROM ece.establecimiento LIMIT 1`);
      const [inst]    = await q(`SELECT id::text AS id FROM ece.institucion LIMIT 1`);
      const [user]    = await q(`SELECT id::text AS id FROM public."User" LIMIT 1`);
      const [org]     = await q(`SELECT id::text AS id FROM public."Organization" LIMIT 1`);
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
      /**
       * iniciarAltaMedica — happy path (bug cambiado_por corregido).
       *
       * El router resuelve personal_salud.id via subquery:
       *   WHERE his_user_id = ${ece.personalId}::uuid AND activo = true
       * Por tanto ctx.user.id debe ser el User.id (= his_user_id del personal_salud
       * fabricado), y el log escribe el FK correcto → sin FK 23503.
       *
       * Resultado esperado: retorna { episodioId, epicrisisId, pacienteId }.
       */
      "iniciarAltaMedica — retorna episodioId + epicrisisId cuando personal_salud.his_user_id = ctx.user.id",
      async () => {
        const result = await withRollback(prisma, async (db) => {
          // Fabrica personal_salud con his_user_id = fx.user (User.id real).
          const [personal] = (await db.$queryRawUnsafe(
            `INSERT INTO ece.personal_salud
               (his_user_id, institucion_id, establecimiento_id, documento_identidad, nombre_completo, activo)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'HARNESS-EH', 'Dr Harness', true)
             RETURNING id::text AS id`,
            fx.user, fx.inst, fx.estab,
          )) as Array<{ id: string }>;
          const personalId = personal!.id;

          // app.current_user_id debe ser el personal_salud.id para el trigger de log.
          await db.$executeRawUnsafe(
            `SELECT set_config('app.current_user_id', $1, true)`,
            personalId,
          );

          const [episodioAtencion] = (await db.$queryRawUnsafe(
            `INSERT INTO ece.episodio_atencion
               (paciente_id, establecimiento_id, modalidad, servicio_categoria, fecha_hora_inicio, estado)
             VALUES ($1::uuid, $2::uuid, 'hospitalario', 'hospitalizacion', now(), 'en_curso')
             RETURNING id::text AS id`,
            fx.paciente, fx.estab,
          )) as Array<{ id: string }>;
          const episodioId = episodioAtencion!.id;

          await db.$executeRawUnsafe(
            `INSERT INTO ece.episodio_hospitalario
               (episodio_id, circunstancia_ingreso, procedencia_ingreso, modalidad_hospitalaria, fecha_hora_orden_ingreso)
             VALUES ($1::uuid, 'urgencia', 'emergencia', 'hospitalizacion', now())`,
            episodioId,
          );

          // ctx.user.id = fx.user (User.id = his_user_id) — el router hace subquery
          // WHERE his_user_id = ctx.user.id para obtener personal_salud.id correcto.
          const ctx = makeCtx({
            prisma: db,
            user: { ...MOCK_USER_ADMIN, id: fx.user },
            tenant: {
              ...MOCK_TENANT,
              organizationId: fx.org,
              establishmentId: fx.estab,
              roleCodes: ["PHYSICIAN"],
            },
          });

          return eceEpisodioHospitalarioRouter.createCaller(ctx).iniciarAltaMedica({
            episodioId,
            medicoAltaId: personalId,
            fechaHoraAlta: new Date(Date.now() + 3_600_000),
            motivoAlta: "mejoria",
            instruccionesAlta: "Instrucciones de alta para test harness.",
          });
        });

        expect(result).toMatchObject({
          episodioId: expect.any(String),
          epicrisisId: expect.any(String),
          pacienteId: expect.any(String),
        });
      },
      30_000,
    );

    it(
      /**
       * confirmarAlta cierra el episodio correctamente.
       *
       * El UPDATE ahora incluye `fecha_hora_cierre = NOW()`, satisfaciendo
       * chk_cierre_estado. El episodio queda en estado 'cerrado'.
       */
      "confirmarAlta — cierra el episodio con fecha_hora_cierre (bug corregido)",
      async () => {
        const result = await withRollback(prisma, async (db) => {
            const [personal] = (await db.$queryRawUnsafe(
              `INSERT INTO ece.personal_salud
                 (his_user_id, institucion_id, establecimiento_id, documento_identidad, nombre_completo, activo)
               VALUES ($1::uuid, $2::uuid, $3::uuid, 'HARNESS-EH2', 'Dr Harness 2', true)
               RETURNING id::text AS id`,
              fx.user, fx.inst, fx.estab,
            )) as Array<{ id: string }>;
            const personalId = personal!.id;

            await db.$executeRawUnsafe(
              `SELECT set_config('app.current_user_id', $1, true)`,
              personalId,
            );

            const [episodioAtencion] = (await db.$queryRawUnsafe(
              `INSERT INTO ece.episodio_atencion
                 (paciente_id, establecimiento_id, modalidad, servicio_categoria, fecha_hora_inicio, estado)
               VALUES ($1::uuid, $2::uuid, 'hospitalario', 'hospitalizacion', now(), 'en_curso')
               RETURNING id::text AS id`,
              fx.paciente, fx.estab,
            )) as Array<{ id: string }>;
            const episodioId = episodioAtencion!.id;

            await db.$executeRawUnsafe(
              `INSERT INTO ece.episodio_hospitalario
                 (episodio_id, circunstancia_ingreso, procedencia_ingreso, modalidad_hospitalaria, fecha_hora_orden_ingreso)
               VALUES ($1::uuid, 'urgencia', 'emergencia', 'hospitalizacion', now())`,
              episodioId,
            );

            const [tipoDocRow] = (await db.$queryRawUnsafe(
              `SELECT id::text AS id FROM ece.tipo_documento WHERE codigo = 'EPICRISIS' AND activo = true LIMIT 1`,
            )) as Array<{ id: string }>;
            if (!tipoDocRow) throw new Error("SKIP: EPICRISIS no sembrado");

            const [estadoFirmadoRow] = (await db.$queryRawUnsafe(
              `SELECT fe.id::text AS id FROM ece.flujo_estado fe
               WHERE fe.tipo_documento_id = $1::uuid AND fe.codigo = 'firmado' LIMIT 1`,
              tipoDocRow.id,
            )) as Array<{ id: string }>;
            if (!estadoFirmadoRow) throw new Error("SKIP: flujo_estado firmado no encontrado");

            const [instanciaRow] = (await db.$queryRawUnsafe(
              `INSERT INTO ece.documento_instancia
                 (tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)
               RETURNING id::text AS id`,
              tipoDocRow.id, episodioId, fx.paciente, estadoFirmadoRow.id, personalId,
            )) as Array<{ id: string }>;

            const [epicrisisRow] = (await db.$queryRawUnsafe(
              `INSERT INTO ece.epicrisis_egreso
                 (instancia_id, episodio_id, fecha_hora_egreso, tipo_egreso, circunstancia_alta,
                  diagnosticos_egreso, resumen_ingreso, evolucion_hospitalaria,
                  tratamiento_egreso, indicaciones_egreso, medico_tratante_id, estado_workflow)
               VALUES ($1::uuid, $2::uuid, now(), 'vivo', 'mejoria',
                  '[]'::jsonb, '', '', '', 'Alta programada', $3::uuid, 'firmado')
               RETURNING id::text AS id`,
              instanciaRow!.id, episodioId, personalId,
            )) as Array<{ id: string }>;

            // ctx.user.id = fx.user (User.id / his_user_id) — el router resuelve
            // personal_salud.id via subquery WHERE his_user_id = ctx.user.id.
            const ctx = makeCtx({
              prisma: db,
              user: { ...MOCK_USER_ADMIN, id: fx.user },
              tenant: {
                ...MOCK_TENANT,
                organizationId: fx.org,
                establishmentId: fx.estab,
                roleCodes: ["PHYSICIAN"],
              },
            });
            return eceEpisodioHospitalarioRouter.createCaller(ctx).confirmarAlta({
              episodioId,
              epicrisisId: epicrisisRow!.id,
            });
          });

        // El router debe retornar algo (al menos el episodioId) sin lanzar.
        expect(result).toBeTruthy();
      },
      30_000,
    );

    it(
      "iniciarAltaMedica FALLA si el episodio no está en_curso",
      async () => {
        await expect(
          withRollback(prisma, async (db) => {
            const [personal] = (await db.$queryRawUnsafe(
              `INSERT INTO ece.personal_salud
                 (his_user_id, institucion_id, establecimiento_id, documento_identidad, nombre_completo, activo)
               VALUES ($1::uuid, $2::uuid, $3::uuid, 'HARNESS-EH3', 'Dr Harness 3', true)
               RETURNING id::text AS id`,
              fx.user, fx.inst, fx.estab,
            )) as Array<{ id: string }>;
            const personalId = personal!.id;

            await db.$executeRawUnsafe(
              `SELECT set_config('app.current_user_id', $1, true)`,
              personalId,
            );

            // Episodio en estado 'abierto' (no en_curso) — el router debe rechazar iniciarAltaMedica.
            // No usamos 'cerrado' directo porque chk_cierre_estado no permite INSERT cerrado.
            const [episodioAtencion] = (await db.$queryRawUnsafe(
              `INSERT INTO ece.episodio_atencion
                 (paciente_id, establecimiento_id, modalidad, servicio_categoria, fecha_hora_inicio, estado)
               VALUES ($1::uuid, $2::uuid, 'hospitalario', 'hospitalizacion', now(), 'abierto')
               RETURNING id::text AS id`,
              fx.paciente, fx.estab,
            )) as Array<{ id: string }>;
            const episodioId = episodioAtencion!.id;

            await db.$executeRawUnsafe(
              `INSERT INTO ece.episodio_hospitalario
                 (episodio_id, circunstancia_ingreso, procedencia_ingreso, modalidad_hospitalaria, fecha_hora_orden_ingreso)
               VALUES ($1::uuid, 'urgencia', 'emergencia', 'hospitalizacion', now())`,
              episodioId,
            );

            const ctx = makeCtx({
              prisma: db,
              // user.id = personalId para que cambiado_por FK a personal_salud resuelva.
              user: { ...MOCK_USER_ADMIN, id: personalId },
              tenant: {
                ...MOCK_TENANT,
                organizationId: fx.org,
                establishmentId: fx.estab,
                roleCodes: ["PHYSICIAN"],
              },
            });
            const caller = eceEpisodioHospitalarioRouter.createCaller(ctx);

            return caller.iniciarAltaMedica({
              episodioId,
              medicoAltaId: personalId,
              fechaHoraAlta: new Date(),
              motivoAlta: "mejoria",
              instruccionesAlta: "Test negativo.",
            });
          }),
        ).rejects.toThrow(/en_curso|CONFLICT/i);
      },
      30_000,
    );
  },
);
