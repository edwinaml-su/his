/**
 * Test de INTEGRACIÓN (schema contract) — eceRectificacionRouter.solicitar ↔ esquema vivo.
 *
 * Valida que el INSERT SQL de `solicitar` cuadra con el DDL real de
 * ece.solicitud_arco. El test unitario mockea $queryRaw y no atraparía
 * columnas renombradas, tipos erróneos o CHECK violations.
 *
 * Cadena de fixtures (rollback):
 *   personal_salud → episodio_atencion → tipo_documento + flujo_estado (CERT_DEF)
 *   → documento_instancia (estado firmado) → solicitar()
 *
 * Gating: INTEGRATION_DB=1 + DATABASE_URL (DIRECT_URL preferida).
 * Nada persiste.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { eceRectificacionRouter } from "../ece-rectificacion.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import {
  hasIntegrationDb,
  makeIntegrationPrisma,
  withRollback,
} from "../../__tests__/integration/rollback-harness";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

interface Fixtures {
  user: string;
  org: string;
  estab: string;
  inst: string;
  /** public."Patient".id — ece.paciente.public_patient_id apuntará aquí */
  patient: string;
  /** public."Establishment".id — FK de ece.paciente.establecimiento_id */
  establishment: string;
}

describe.skipIf(!hasIntegrationDb())(
  "[integration] eceRectificacionRouter.solicitar ↔ esquema vivo",
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
      // public."Patient".id → ece.paciente.public_patient_id.
      // El router lee p.public_patient_id para insertar en solicitud_arco.paciente_id (FK Patient).
      const [patient] = await q(
        `SELECT id::text AS id FROM public."Patient" LIMIT 1`,
      );
      // ece.paciente.establecimiento_id → public."Establishment".id
      const [establishment] = await q(
        `SELECT id::text AS id FROM public."Establishment" LIMIT 1`,
      );

      if (!user || !org || !estab || !inst || !patient || !establishment) {
        throw new Error(
          "Fixtures FK faltantes: User, Organization, ece.establecimiento, ece.institucion, Patient, Establishment.",
        );
      }

      fx = {
        user: user.id,
        org: org.id,
        estab: estab.id,
        inst: inst.id,
        patient: patient.id,
        establishment: establishment.id,
      };
    }, 30_000);

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it("solicitar crea solicitud_arco PENDIENTE contra el DDL real (rollback)", async () => {
      const result = await withRollback(prisma, async (db) => {
        // 1. personal_salud para el solicitante (his_user_id = User real).
        const [personal] = (await db.$queryRawUnsafe(
          `INSERT INTO ece.personal_salud
             (his_user_id, institucion_id, establecimiento_id,
              documento_identidad, nombre_completo, activo)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'HARNESS-RECT', 'Dr Rect', true)
           RETURNING id::text AS id`,
          fx.user,
          fx.inst,
          fx.estab,
        )) as Array<{ id: string }>;

        if (!personal) throw new Error("No se pudo crear personal_salud fixture");

        // 2. ece.paciente con public_patient_id = fx.patient.
        //    El router hace LEFT JOIN ece.paciente ON ... y lee public_patient_id para
        //    insertar en solicitud_arco.paciente_id (FK → public."Patient").
        //    documento_instancia.paciente_id → ece.paciente.id (el id generado aquí).
        const [ecePacienteRow] = (await db.$queryRawUnsafe(
          `INSERT INTO ece.paciente
             (public_patient_id, establecimiento_id, numero_expediente,
              tipo_registro_identidad, estado_expediente,
              fallecido, estado_registro)
           VALUES ($1::uuid, $2::uuid, 'HARNESS-RECT-EXP',
                   'sin_documento', 'activo', false, 'vigente')
           RETURNING id::text AS id`,
          fx.patient,
          fx.establishment,
        )) as Array<{ id: string }>;
        const ecePacienteId = ecePacienteRow!.id;

        // 3. episodio_atencion apunta a ece.paciente.id (no a Patient.id directamente).
        const [episodio] = (await db.$queryRawUnsafe(
          `INSERT INTO ece.episodio_atencion
             (paciente_id, establecimiento_id, modalidad, servicio_categoria)
           VALUES ($1::uuid, $2::uuid, 'ambulatorio', 'consulta_externa')
           RETURNING id::text AS id`,
          ecePacienteId,
          fx.estab,
        )) as Array<{ id: string }>;

        if (!episodio) throw new Error("No se pudo crear episodio_atencion fixture");

        // 3. Resolver un tipo_documento + flujo_estado con es_inicial=true para
        //    crear una instancia. Usamos CERT_DEF si existe; si no, el primero disponible.
        const tipoRows = (await db.$queryRawUnsafe(
          `SELECT td.id::text AS tipo_id, fe.id::text AS estado_id, fe.codigo
           FROM ece.tipo_documento td
           JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
           LIMIT 1`,
        )) as Array<{ tipo_id: string; estado_id: string; codigo: string }>;

        if (!tipoRows[0]) {
          throw new Error(
            "No hay tipo_documento con flujo_estado inicial. El seed de workflow debe haberse aplicado.",
          );
        }
        const { tipo_id: tipoId, estado_id: estadoInicialId } = tipoRows[0];

        // 4. Resolver un flujo_estado con codigo='firmado' para simular doc firmado.
        //    El guard de solicitar() requiere estado_codigo IN ('firmado','validado','certificado').
        const estadoFirmadoRows = (await db.$queryRawUnsafe(
          `SELECT id::text AS id
           FROM ece.flujo_estado
           WHERE tipo_documento_id = $1::uuid
             AND codigo IN ('firmado', 'validado', 'certificado')
           LIMIT 1`,
          tipoId,
        )) as Array<{ id: string }>;

        if (!estadoFirmadoRows[0]) {
          throw new Error(
            "No existe flujo_estado firmado/validado/certificado para el tipo_documento. Verificar seed.",
          );
        }
        const estadoFirmadoId = estadoFirmadoRows[0].id;

        // 5. documento_instancia en estado firmado.
        //    paciente_id → ece.paciente.id (ecePacienteId generado arriba).
        const [instancia] = (await db.$queryRawUnsafe(
          `INSERT INTO ece.documento_instancia
             (tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)
           RETURNING id::text AS id`,
          tipoId,
          episodio.id,
          ecePacienteId,
          estadoFirmadoId,
          personal.id,
        )) as Array<{ id: string }>;

        if (!instancia) throw new Error("No se pudo crear documento_instancia fixture");

        // 6. set_config para satisfacer cualquier trigger que lea app.current_user_id.
        await db.$executeRawUnsafe(
          `SELECT set_config('app.current_user_id', $1, true)`,
          personal.id,
        );

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

        const caller = eceRectificacionRouter.createCaller(ctx);

        return caller.solicitar({
          documentoInstanciaId: instancia.id,
          campo: "causa_principal_cie10",
          valorAnterior: "J18.9",
          valorPropuesto: "J22.0",
          motivo:
            "Corrección de código CIE-10 por revisión diagnóstica posterior al alta.",
        });
      });

      expect(result.id).toBeTruthy();
    }, 30_000);
  },
);
