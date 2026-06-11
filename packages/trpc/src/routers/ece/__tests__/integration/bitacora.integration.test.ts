/**
 * Test de INTEGRACIÓN (schema contract) — bitacoraRouter.register ↔ esquema vivo.
 *
 * Valida que el INSERT SQL de `register` cuadra con el DDL real de
 * ece.bitacora_acceso (columnas, tipos, NOT NULL). Los tests unitarios mockean
 * $executeRawUnsafe y no atraparían una columna renombrada o un tipo cambiado.
 *
 * Gating: INTEGRATION_DB=1 + DATABASE_URL (DIRECT_URL preferida).
 * Nada persiste — toda la tx hace rollback.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { bitacoraRouter } from "../../bitacora.router";
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
  personalId: string;
}

describe.skipIf(!hasIntegrationDb())(
  "[integration] bitacoraRouter.register ↔ esquema vivo",
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

      if (!user || !org || !estab || !inst) {
        throw new Error(
          "Fixtures FK faltantes: se necesita al menos 1 User, Organization, establecimiento, institucion en la BD.",
        );
      }

      fx = { user: user.id, org: org.id, estab: estab.id, inst: inst.id, personalId: "" };
    }, 30_000);

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it("register inserta en ece.bitacora_acceso contra el DDL real (rollback)", async () => {
      const result = await withRollback(prisma, async (db) => {
        // Fixture: personal_salud ligado al User real.
        const [personal] = (await db.$queryRawUnsafe(
          `INSERT INTO ece.personal_salud
             (his_user_id, institucion_id, establecimiento_id,
              documento_identidad, nombre_completo, activo)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'HARNESS-BIT', 'Dr Bitacora', true)
           RETURNING id::text AS id`,
          fx.user,
          fx.inst,
          fx.estab,
        )) as Array<{ id: string }>;

        if (!personal) throw new Error("No se pudo crear personal_salud fixture");

        const ctx = makeCtx({
          prisma: db,
          user: { ...MOCK_USER_ADMIN, id: fx.user },
          tenant: {
            ...MOCK_TENANT,
            organizationId: fx.org,
            roleCodes: ["PHYSICIAN"],
          },
        });

        const caller = bitacoraRouter.createCaller(ctx);

        const res = await caller.register({
          personalId: personal.id,
          accion: "FIRMAR",
          autorizado: true,
          justificacion: "harness rollback test",
          ip: "127.0.0.1",
          establecimientoId: fx.estab,
        });

        return res;
      });

      expect(result.ok).toBe(true);
    }, 30_000);

    it("register sin personalId/establecimientoId (campos nullable) también inserta (rollback)", async () => {
      const result = await withRollback(prisma, async (db) => {
        const ctx = makeCtx({
          prisma: db,
          user: { ...MOCK_USER_ADMIN, id: fx.user },
          tenant: {
            ...MOCK_TENANT,
            organizationId: fx.org,
            roleCodes: ["PHYSICIAN"],
          },
        });

        const caller = bitacoraRouter.createCaller(ctx);

        return caller.register({
          accion: "view",
          autorizado: false,
        });
      });

      expect(result.ok).toBe(true);
    }, 30_000);
  },
);
