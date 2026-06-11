/**
 * Test de INTEGRACIÓN (schema contract) — eceCertDefRouter.create ↔ esquema vivo.
 *
 * Valida que el INSERT SQL de `create` cuadra con el DDL real de
 * ece.certificado_defuncion (incluyendo columnas nuevas de migración 167:
 * lugar_defuncion, causa_principal_cie10, manera, autopsia_realizada,
 * observaciones). También valida que el guard B-04 (epicrisis tipo_egreso='fallecido')
 * funciona contra la BD real.
 *
 * Cadena de fixtures (rollback):
 *   personal_salud + firma_electronica (pin hash placeholder)
 *   → episodio_atencion → epicrisis_egreso (tipo_egreso='fallecido')
 *   → tipo_documento CERT_DEF + flujo_estado inicial → create()
 *
 * Gating: INTEGRATION_DB=1 + DATABASE_URL (DIRECT_URL preferida).
 * Nada persiste.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { eceCertDefRouter } from "../../certificado-defuncion.router";
import { makeCtx } from "../../../../__tests__/helpers/caller";
import {
  hasIntegrationDb,
  makeIntegrationPrisma,
  withRollback,
} from "../../../../__tests__/integration/rollback-harness";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

interface Fixtures {
  user: string;
  org: string;
  estab: string;
  inst: string;
  paciente: string;
}

describe.skipIf(!hasIntegrationDb())(
  "[integration] eceCertDefRouter.create ↔ esquema vivo",
  () => {
    let prisma: PrismaClient;
    let fx: Fixtures;

    beforeAll(async () => {
      prisma = makeIntegrationPrisma();
      const q = (sql: string) =>
        (
          prisma.$queryRawUnsafe as (
            s: string,
          ) => Promise<Array<{ id: string }>>
        )(sql);

      const [user] = await q(`SELECT id::text AS id FROM public."User" LIMIT 1`);
      const [org] = await q(
        `SELECT id::text AS id FROM public."Organization" LIMIT 1`,
      );
      const [estab] = await q(
        `SELECT id::text AS id FROM ece.establecimiento LIMIT 1`,
      );
      const [inst] = await q(
        `SELECT id::text AS id FROM ece.institucion LIMIT 1`,
      );
      const [paciente] = await q(
        `SELECT id::text AS id FROM ece.paciente LIMIT 1`,
      );

      if (!user || !org || !estab || !inst || !paciente) {
        throw new Error(
          "Fixtures FK faltantes: se necesita User, Organization, establecimiento, institucion, paciente.",
        );
      }

      fx = {
        user: user.id,
        org: org.id,
        estab: estab.id,
        inst: inst.id,
        paciente: paciente.id,
      };
    }, 30_000);

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it("create inserta certificado_defuncion en estado borrador contra el DDL real (rollback)", async () => {
      const result = await withRollback(prisma, async (db) => {
        // 1. personal_salud para el médico (his_user_id = User real).
        //    El router resuelve personal por his_user_id en la TX → debe existir
        //    dentro del rollback. La firma_electronica NO es necesaria para create()
        //    (solo para firmar/validar/certificar que requieren PIN).
        const [personal] = (await db.$queryRawUnsafe(
          `INSERT INTO ece.personal_salud
             (his_user_id, institucion_id, establecimiento_id,
              documento_identidad, nombre_completo, activo)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'HARNESS-CDEF', 'Dr CertDef', true)
           RETURNING id::text AS id`,
          fx.user,
          fx.inst,
          fx.estab,
        )) as Array<{ id: string }>;

        if (!personal) throw new Error("No se pudo crear personal_salud fixture");

        // 2. episodio_atencion: DDL real no tiene columna 'tipo';
        //    modalidad + servicio_categoria son NOT NULL sin default.
        const [episodio] = (await db.$queryRawUnsafe(
          `INSERT INTO ece.episodio_atencion
             (paciente_id, establecimiento_id, modalidad, servicio_categoria)
           VALUES ($1::uuid, $2::uuid, 'hospitalario', 'hospitalizacion')
           RETURNING id::text AS id`,
          fx.paciente,
          fx.estab,
        )) as Array<{ id: string }>;

        if (!episodio) throw new Error("No se pudo crear episodio_atencion fixture");

        // 3. Para epicrisis_egreso necesitamos primero una documento_instancia
        //    (instancia_id NOT NULL). Resolvemos un tipo_doc para la instancia.
        const tipoEpiRows = (await db.$queryRawUnsafe(
          `SELECT td.id::text AS tipo_id, fe.id::text AS estado_id
           FROM ece.tipo_documento td
           JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
           WHERE td.codigo IN ('EPICRISIS','EPICRISIS_EGRESO','EPICRISIS_HOSPITALIZACIon')
              OR td.codigo ILIKE '%epicrisi%'
           LIMIT 1`,
        )) as Array<{ tipo_id: string; estado_id: string }>;

        // Si no hay tipo epicrisis específico, usa cualquier tipo disponible.
        const tipoFallback = tipoEpiRows[0] ?? (await db.$queryRawUnsafe(
          `SELECT td.id::text AS tipo_id, fe.id::text AS estado_id
           FROM ece.tipo_documento td
           JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
           LIMIT 1`,
        ) as Array<{ tipo_id: string; estado_id: string }>)[0];

        if (!tipoFallback) {
          throw new Error("No hay tipo_documento con flujo_estado inicial. El seed debe estar aplicado.");
        }

        const [instanciaEpi] = (await db.$queryRawUnsafe(
          `INSERT INTO ece.documento_instancia
             (tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)
           RETURNING id::text AS id`,
          tipoFallback.tipo_id,
          episodio.id,
          fx.paciente,
          tipoFallback.estado_id,
          personal.id,
        )) as Array<{ id: string }>;

        if (!instanciaEpi) throw new Error("No se pudo crear documento_instancia para epicrisis fixture");

        // 4. epicrisis_egreso con tipo_egreso='fallecido' (guard B-04).
        //    DDL real: instancia_id, fecha_hora_egreso, circunstancia_alta,
        //    diagnosticos_egreso, medico_tratante_id, estado_registro,
        //    estado_workflow son NOT NULL.
        const [epicrisis] = (await db.$queryRawUnsafe(
          `INSERT INTO ece.epicrisis_egreso
             (instancia_id, episodio_id, fecha_hora_egreso, tipo_egreso,
              circunstancia_alta, diagnosticos_egreso, medico_tratante_id,
              estado_registro, estado_workflow)
           VALUES ($1::uuid, $2::uuid, now(), 'fallecido',
                   'fallecido_en_establecimiento', '[]'::jsonb, $3::uuid,
                   'vigente', 'borrador')
           RETURNING id::text AS id`,
          instanciaEpi.id,
          episodio.id,
          personal.id,
        )) as Array<{ id: string }>;

        if (!epicrisis) throw new Error("No se pudo crear epicrisis_egreso fixture");

        // 4. set_config para triggers que lean app.current_user_id /
        //    app.ece_personal_id (withWorkflowContext también los seteará, pero
        //    ciertos triggers corren BEFORE y pueden leer el GUC directamente).
        await db.$executeRawUnsafe(
          `SELECT set_config('app.current_user_id', $1, true)`,
          personal.id,
        );
        await db.$executeRawUnsafe(
          `SELECT set_config('app.ece_personal_id', $1, true)`,
          personal.id,
        );
        await db.$executeRawUnsafe(
          `SELECT set_config('app.ece_establecimiento_id', $1, true)`,
          fx.estab,
        );

        // tenant.establishmentId debe ser fx.estab para que el router valide que
        // el episodio pertenece al establecimiento correcto (buildEceCtx).
        const ctx = makeCtx({
          prisma: db,
          user: { ...MOCK_USER_ADMIN, id: fx.user },
          tenant: {
            ...MOCK_TENANT,
            organizationId: fx.org,
            establishmentId: fx.estab,
            roleCodes: ["MC", "PHYSICIAN"],
          },
        });

        const caller = eceCertDefRouter.createCaller(ctx);

        return caller.create({
          episodioId: episodio.id,
          epicrisisId: epicrisis.id,
          fechaHoraDefuncion: new Date("2026-01-15T08:00:00Z"),
          lugarDefuncion: "intrahospitalaria",
          causaPrincipalCie10: "J18.9",
          causasIntermediasCie10: ["J96.0"],
          causaBasicaCie10: "J18.9",
          manera: "natural",
          autopsiaRealizada: false,
          observaciones: "harness rollback — no persiste",
        });
      });

      expect(result.id).toBeTruthy();
    }, 30_000);

    it("DETECTA guard B-04: epicrisis sin tipo_egreso=fallecido lanza BAD_REQUEST", async () => {
      await expect(
        withRollback(prisma, async (db) => {
          const [personal] = (await db.$queryRawUnsafe(
            `INSERT INTO ece.personal_salud
               (his_user_id, institucion_id, establecimiento_id,
                documento_identidad, nombre_completo, activo)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'HARNESS-B04', 'Dr B04', true)
             RETURNING id::text AS id`,
            fx.user,
            fx.inst,
            fx.estab,
          )) as Array<{ id: string }>;

          const [episodio] = (await db.$queryRawUnsafe(
            `INSERT INTO ece.episodio_atencion
               (paciente_id, establecimiento_id, modalidad, servicio_categoria)
             VALUES ($1::uuid, $2::uuid, 'hospitalario', 'hospitalizacion')
             RETURNING id::text AS id`,
            fx.paciente,
            fx.estab,
          )) as Array<{ id: string }>;

          // Instancia para la epicrisis fixture.
          const tipoB04Rows = (await db.$queryRawUnsafe(
            `SELECT td.id::text AS tipo_id, fe.id::text AS estado_id
             FROM ece.tipo_documento td
             JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
             LIMIT 1`,
          )) as Array<{ tipo_id: string; estado_id: string }>;

          const [instanciaB04] = (await db.$queryRawUnsafe(
            `INSERT INTO ece.documento_instancia
               (tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)
             RETURNING id::text AS id`,
            tipoB04Rows[0]!.tipo_id,
            episodio!.id,
            fx.paciente,
            tipoB04Rows[0]!.estado_id,
            personal!.id,
          )) as Array<{ id: string }>;

          // tipo_egreso = 'vivo' (válido en BD, pero != 'fallecido' → el guard B-04 rechaza).
          // tipo_egreso CHECK: 'vivo' | 'fallecido' (alta_voluntaria no existe en el enum).
          const [epicrisis] = (await db.$queryRawUnsafe(
            `INSERT INTO ece.epicrisis_egreso
               (instancia_id, episodio_id, fecha_hora_egreso, tipo_egreso,
                circunstancia_alta, diagnosticos_egreso, medico_tratante_id,
                estado_registro, estado_workflow)
             VALUES ($1::uuid, $2::uuid, now(), 'vivo',
                     'vivo', '[]'::jsonb, $3::uuid,
                     'vigente', 'borrador')
             RETURNING id::text AS id`,
            instanciaB04!.id,
            episodio!.id,
            personal!.id,
          )) as Array<{ id: string }>;

          await db.$executeRawUnsafe(
            `SELECT set_config('app.ece_personal_id', $1, true)`,
            personal!.id,
          );
          await db.$executeRawUnsafe(
            `SELECT set_config('app.ece_establecimiento_id', $1, true)`,
            fx.estab,
          );

          const ctx = makeCtx({
            prisma: db,
            user: { ...MOCK_USER_ADMIN, id: fx.user },
            tenant: {
              ...MOCK_TENANT,
              organizationId: fx.org,
              establishmentId: fx.estab,
              roleCodes: ["MC", "PHYSICIAN"],
            },
          });

          const caller = eceCertDefRouter.createCaller(ctx);
          return caller.create({
            episodioId: episodio!.id,
            epicrisisId: epicrisis!.id,
            fechaHoraDefuncion: new Date("2026-01-15T08:00:00Z"),
            lugarDefuncion: "intrahospitalaria",
            causaPrincipalCie10: "J18.9",
            causasIntermediasCie10: [],
            causaBasicaCie10: "J18.9",
            manera: "natural",
            autopsiaRealizada: false,
          });
        }),
      ).rejects.toThrow(/epicrisis_no_es_fallecido/i);
    }, 30_000);
  },
);
