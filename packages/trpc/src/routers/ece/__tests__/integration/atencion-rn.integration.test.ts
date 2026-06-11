/**
 * Test de INTEGRACIÓN (schema contract) — eceAtencionRn ↔ esquema vivo.
 *
 * Cubre el flujo principal: create (creación atómica ATN_RN + paciente RN).
 *
 * El procedure create NO requiere PIN — la firma es en `firmar` (separado).
 * Solo necesita: personal_salud (MC), paciente madre (ece + public), tipo_documento ATN_RN.
 *
 * Cadena de fixtures (dentro del rollback):
 *   1. personal_salud (his_user_id = User real, rol MC)
 *   2. public."Patient" madre (referenciando una Organization real)
 *   3. ece.paciente madre (public_patient_id = Patient.id)
 *   4. ece.episodio_atencion obstetrico (para episodioObsId)
 *   5. biologicalSexId — leído de public."BiologicalSex" (catálogo)
 *   6. tipo_documento ATN_RN + flujo_estado inicial (ya sembrado en BD)
 *
 * Gating: solo corre con INTEGRATION_DB=1 + DATABASE_URL/DIRECT_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { eceAtencionRnRouter } from "../../atencion-rn.router";
import { makeCtx } from "../../../../__tests__/helpers/caller";
import {
  hasIntegrationDb,
  makeIntegrationPrisma,
  withRollback,
} from "../../../../__tests__/integration/rollback-harness";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

interface Fixtures {
  estab: string;       // ece.establecimiento.id (para personal_salud, episodio_atencion)
  establPub: string;   // public."Establishment".id (para ece.paciente FK)
  inst: string;
  user: string;
  org: string;
  bioSexId: string;
}

describe.skipIf(!hasIntegrationDb())(
  "[integration] eceAtencionRn ↔ esquema vivo",
  () => {
    let prisma: PrismaClient;
    let fx: Fixtures;

    beforeAll(async () => {
      prisma = makeIntegrationPrisma();
      const q = (sql: string) =>
        (prisma.$queryRawUnsafe as (s: string) => Promise<Array<{ id: string }>>)(sql);
      const [estab]     = await q(`SELECT id::text AS id FROM ece.establecimiento LIMIT 1`);
      const [establPub] = await q(`SELECT id::text AS id FROM public."Establishment" LIMIT 1`);
      const [inst]      = await q(`SELECT id::text AS id FROM ece.institucion LIMIT 1`);
      const [user]      = await q(`SELECT id::text AS id FROM public."User" LIMIT 1`);
      const [org]       = await q(`SELECT id::text AS id FROM public."Organization" LIMIT 1`);
      const [bioSex]    = await q(`SELECT id::text AS id FROM public."BiologicalSex" LIMIT 1`);
      fx = {
        estab: estab!.id,
        establPub: establPub!.id,
        inst: inst!.id,
        user: user!.id,
        org: org!.id,
        bioSexId: bioSex!.id,
      };
    }, 30_000);

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it(
      "create — crea ATN_RN y Patient RN correctamente (id + updatedAt incluidos)",
      async () => {
        // El INSERT de public."Patient" ya incluye `id = gen_random_uuid()` y
        // `"updatedAt" = now()`. El router debe completar sin error 23502.
        const result = await withRollback(prisma, async (db) => {
            // Fixture 1: personal_salud MC
            const [personal] = (await db.$queryRawUnsafe(
              `INSERT INTO ece.personal_salud
                 (his_user_id, institucion_id, establecimiento_id, documento_identidad, nombre_completo, activo)
               VALUES ($1::uuid, $2::uuid, $3::uuid, 'HARNESS-RN', 'MC Harness', true)
               RETURNING id::text AS id`,
              fx.user, fx.inst, fx.estab,
            )) as Array<{ id: string }>;
            const personalId = personal!.id;
            void personalId; // usado implícitamente via fx.user en ctx

            // Fixture 2: public.Patient madre
            const mrnMadre = `MADRE-${Date.now().toString(36).toUpperCase()}`;
            const [madrePublicRow] = (await db.$queryRawUnsafe(
              `INSERT INTO public."Patient"
                 (id, "organizationId", mrn, "firstName", "lastName",
                  "birthDate", "birthDateEstimated", "biologicalSexId", "isUnknown", "createdBy", "updatedAt")
               VALUES (gen_random_uuid(), $1::uuid, $2, 'Madre', 'Harness',
                       '1990-01-01'::timestamptz, false, $3::uuid, false, $4::uuid, now())
               RETURNING id::text AS id`,
              fx.org, mrnMadre, fx.bioSexId, fx.user,
            )) as Array<{ id: string }>;
            const madrePublicId = madrePublicRow!.id;

            // Fixture 3: ece.paciente madre
            const mrnMadreEce = `MADRE-ECE-${madrePublicId.substring(0, 8).toUpperCase()}`;
            const [madreEceRow] = (await db.$queryRawUnsafe(
              `INSERT INTO ece.paciente
                 (public_patient_id, establecimiento_id, numero_expediente, tipo_registro_identidad)
               VALUES ($1::uuid, $2::uuid, $3, 'sin_documento')
               RETURNING id::text AS id`,
              madrePublicId, fx.establPub, mrnMadreEce,
            )) as Array<{ id: string }>;
            const madreEceId = madreEceRow!.id;

            // Fixture 4: episodio_atencion obstétrico
            const [episodioRow] = (await db.$queryRawUnsafe(
              `INSERT INTO ece.episodio_atencion
                 (paciente_id, establecimiento_id, modalidad, servicio_categoria, fecha_hora_inicio, estado)
               VALUES ($1::uuid, $2::uuid, 'hospitalario', 'hospitalizacion', now(), 'en_curso')
               RETURNING id::text AS id`,
              madreEceId, fx.estab,
            )) as Array<{ id: string }>;
            const episodioObsId = episodioRow!.id;

            // Fixture 5: tipo_documento ATN_RN (debe estar sembrado)
            const [tipoAtnRow] = (await db.$queryRawUnsafe(
              `SELECT td.id::text AS id FROM ece.tipo_documento td
               JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
               WHERE td.codigo = 'ATN_RN' AND td.activo = true LIMIT 1`,
            )) as Array<{ id: string }>;

            if (!tipoAtnRow) {
              // Si ATN_RN no está sembrado, skip; el drift no aplica aquí
              return { skipped: true as const };
            }

            const ctx = makeCtx({
              prisma: db,
              user: { ...MOCK_USER_ADMIN, id: fx.user },
              tenant: {
                ...MOCK_TENANT,
                organizationId: fx.org,
                establishmentId: fx.establPub,
                roleCodes: ["MC"],
              },
            });

            return eceAtencionRnRouter.createCaller(ctx).create({
              episodioObsId,
              pacienteMadreId: madreEceId,
              rnPrimerNombre: "Bebe",
              rnPrimerApellido: "Harness",
              rnBiologicalSexId: fx.bioSexId,
              rnBirthDate: new Date(),
              pesoG: 3200,
              tallaCm: 50,
              sexo: "M",
              edadGestacionalSemanas: 39,
              apgar1min: 8,
              apgar5min: 9,
              reanimacionRequerida: false,
              reanimacionProtocoloNrp: false,
              alimentacionInicial: "lactancia_inmediata",
            });
          });

        // { skipped } si ATN_RN no está sembrado; de lo contrario debe retornar pacienteRnId.
        if (result && typeof result === "object" && "skipped" in result) return;
        expect((result as { ok: boolean; pacienteRnId: string }).pacienteRnId).toBeTruthy();
      },
      30_000,
    );

    it(
      "create reanimacion=true — crea ATN_RN con protocolo NRP correctamente",
      async () => {
        // La rama reanimacionRequerida=true usa el mismo INSERT de Patient que ya
        // incluye id + updatedAt. Debe completar sin error.
        const result = await withRollback(prisma, async (db) => {
            await db.$queryRawUnsafe(
              `INSERT INTO ece.personal_salud
                 (his_user_id, institucion_id, establecimiento_id, documento_identidad, nombre_completo, activo)
               VALUES ($1::uuid, $2::uuid, $3::uuid, 'HARNESS-RN2', 'MC Harness 2', true)
               RETURNING id::text AS id`,
              fx.user, fx.inst, fx.estab,
            );

            const mrnMadre = `MADRE2-${Date.now().toString(36).toUpperCase()}`;
            const [madrePublicRow] = (await db.$queryRawUnsafe(
              `INSERT INTO public."Patient"
                 (id, "organizationId", mrn, "firstName", "lastName",
                  "birthDate", "birthDateEstimated", "biologicalSexId", "isUnknown", "createdBy", "updatedAt")
               VALUES (gen_random_uuid(), $1::uuid, $2, 'Madre2', 'Harness',
                       '1992-03-15'::timestamptz, false, $3::uuid, false, $4::uuid, now())
               RETURNING id::text AS id`,
              fx.org, mrnMadre, fx.bioSexId, fx.user,
            )) as Array<{ id: string }>;
            const madrePublicId = madrePublicRow!.id;

            const mrnMadreEce = `MADRE2-${madrePublicId.substring(0, 8).toUpperCase()}`;
            const [madreEceRow] = (await db.$queryRawUnsafe(
              `INSERT INTO ece.paciente
                 (public_patient_id, establecimiento_id, numero_expediente, tipo_registro_identidad)
               VALUES ($1::uuid, $2::uuid, $3, 'sin_documento')
               RETURNING id::text AS id`,
              madrePublicId, fx.establPub, mrnMadreEce,
            )) as Array<{ id: string }>;
            const madreEceId = madreEceRow!.id;

            const [episodioRow] = (await db.$queryRawUnsafe(
              `INSERT INTO ece.episodio_atencion
                 (paciente_id, establecimiento_id, modalidad, servicio_categoria, fecha_hora_inicio, estado)
               VALUES ($1::uuid, $2::uuid, 'hospitalario', 'hospitalizacion', now(), 'en_curso')
               RETURNING id::text AS id`,
              madreEceId, fx.estab,
            )) as Array<{ id: string }>;

            const [tipoAtnRow] = (await db.$queryRawUnsafe(
              `SELECT td.id::text AS id FROM ece.tipo_documento td
               JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
               WHERE td.codigo = 'ATN_RN' AND td.activo = true LIMIT 1`,
            )) as Array<{ id: string }>;

            if (!tipoAtnRow) {
              return { skipped: true as const };
            }

            const ctx = makeCtx({
              prisma: db,
              user: { ...MOCK_USER_ADMIN, id: fx.user },
              tenant: {
                ...MOCK_TENANT,
                organizationId: fx.org,
                establishmentId: fx.establPub,
                roleCodes: ["MC"],
              },
            });

            return eceAtencionRnRouter.createCaller(ctx).create({
              episodioObsId: episodioRow!.id,
              pacienteMadreId: madreEceId,
              rnPrimerNombre: "BebeR",
              rnPrimerApellido: "Harness",
              rnBiologicalSexId: fx.bioSexId,
              rnBirthDate: new Date(),
              pesoG: 2900,
              tallaCm: 48,
              sexo: "F",
              edadGestacionalSemanas: 36,
              apgar1min: 4,
              apgar5min: 7,
              reanimacionRequerida: true,
              reanimacionProtocoloNrp: true,
              alimentacionInicial: "formula",
            });
          });

        if (result && typeof result === "object" && "skipped" in result) return;
        expect((result as { ok: boolean; pacienteRnId: string }).pacienteRnId).toBeTruthy();
      },
      30_000,
    );

    it(
      "DETECTA drift: sexo con valor fuera del CHECK ('X' no es válido) lanza 23514",
      async () => {
        await expect(
          withRollback(prisma, async (db) => {
            // Inserción directa con valor de sexo inválido para demostrar que el
            // harness atrapa el CHECK constraint de ece.atencion_recien_nacido.
            await db.$executeRawUnsafe(
              `INSERT INTO ece.atencion_recien_nacido
                 (episodio_obs_id, paciente_madre_id, paciente_rn_id,
                  peso_g, talla_cm, sexo, edad_gestacional_semanas,
                  apgar_1min, reanimacion_requerida, alimentacion_inicial,
                  estado_documento, registrado_por)
               VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                       3000, 50, 'X', 39, 8, false, 'lactancia_inmediata',
                       'borrador', gen_random_uuid())`,
            );
          }),
        ).rejects.toThrow(/check|23514|sexo/i);
      },
      30_000,
    );
  },
);
