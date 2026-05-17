/**
 * Router tRPC — ECE Registro Anestésico Intraoperatorio.
 *
 * Tabla: ece.registro_anestesico
 * Tipo doc: REG_ANEST
 * Rol requerido: ESP (anestesiólogo) en firma; PHYSICIAN/ESP en lectura/creación.
 *
 * Procedures:
 *   eceRegistroAnestesico.list              — lista por acto quirúrgico
 *   eceRegistroAnestesico.get               — detalle por id
 *   eceRegistroAnestesico.create            — crea en borrador
 *   eceRegistroAnestesico.registrarSignoVital — append signo vital al JSONB
 *   eceRegistroAnestesico.firmar            — firma el registro (ESP)
 *
 * Emite: ece.anestesia.firmada (outbox)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { emitDomainEvent } from "@his/database";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext } from "../../workflow/context";
import type { TenantContext } from "@his/contracts";
import type { PrismaClient } from "@prisma/client";
import {
  eceRegistroAnestesicoCreateSchema,
  eceRegistroAnestesicoListSchema,
  eceRegistroAnestesicoIdSchema,
  registrarSignoVitalSchema,
} from "@his/contracts";

// ---------------------------------------------------------------------------
// Tipos raw SQL
// ---------------------------------------------------------------------------

interface RegistroAnestesicoRow {
  id: string;
  acto_quirurgico_id: string;
  instancia_id: string | null;
  asa: number;
  tipo_anestesia: string;
  via_aerea: string;
  medicamentos_administrados: unknown;
  signos_vitales_intraop: unknown;
  complicaciones: string | null;
  fluidoterapia_ml: number | null;
  perdidas_sanguineas_ml: number | null;
  registrado_por: string;
  estado_registro: string;
  firmado_por: string | null;
  firmado_en: Date | null;
  registrado_en: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEceCtx(tenant: TenantContext, userId: string) {
  return {
    personalId: userId,
    establecimientoId: tenant.establishmentId ?? tenant.organizationId,
  };
}

async function withEceContext<T>(
  prisma: PrismaClient,
  tenant: TenantContext,
  userId: string,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return withWorkflowContext(prisma, buildEceCtx(tenant, userId), fn);
}

async function findRegistro(
  prisma: Pick<PrismaClient, "$queryRaw">,
  id: string,
): Promise<RegistroAnestesicoRow | null> {
  const rows = await (prisma.$queryRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<RegistroAnestesicoRow[]>)`
    SELECT id, acto_quirurgico_id, instancia_id,
           asa, tipo_anestesia, via_aerea,
           medicamentos_administrados, signos_vitales_intraop,
           complicaciones, fluidoterapia_ml, perdidas_sanguineas_ml,
           registrado_por, estado_registro,
           firmado_por, firmado_en, registrado_en
      FROM ece.registro_anestesico
     WHERE id = ${id}::uuid
     LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findPersonalId(
  prisma: Pick<PrismaClient, "$queryRaw">,
  userId: string,
): Promise<string | null> {
  const rows = await (prisma.$queryRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<Array<{ id: string }>>)`
    SELECT id FROM ece.personal_salud
     WHERE his_user_id = ${userId}::uuid
       AND activo = true
     LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

async function countActivos(
  prisma: Pick<PrismaClient, "$queryRaw">,
  actoQuirurgicoId: string,
): Promise<number> {
  const rows = await (prisma.$queryRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<Array<{ cnt: bigint }>>)`
    SELECT COUNT(*) AS cnt
      FROM ece.registro_anestesico
     WHERE acto_quirurgico_id = ${actoQuirurgicoId}::uuid
       AND estado_registro <> 'anulado'
  `;
  return Number(rows[0]?.cnt ?? 0);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const espRole = requireRole(["ESP"]);
const clinicalRole = requireRole(["PHYSICIAN", "ESP", "NURSE"]);

export const eceRegistroAnestesicoRouter = router({
  /** Lista registros anestésicos con filtros opcionales. */
  list: clinicalRole
    .input(eceRegistroAnestesicoListSchema)
    .query(async ({ ctx, input }) => {
      return (ctx.prisma.$queryRaw as (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<RegistroAnestesicoRow[]>)`
        SELECT id, acto_quirurgico_id, instancia_id,
               asa, tipo_anestesia, via_aerea,
               medicamentos_administrados, signos_vitales_intraop,
               complicaciones, fluidoterapia_ml, perdidas_sanguineas_ml,
               registrado_por, estado_registro,
               firmado_por, firmado_en, registrado_en
          FROM ece.registro_anestesico
         WHERE (${input.actoQuirurgicoId ?? null}::uuid IS NULL
                OR acto_quirurgico_id = ${input.actoQuirurgicoId ?? null}::uuid)
           AND (${input.estado ?? null}::text IS NULL
                OR estado_registro = ${input.estado ?? null})
         ORDER BY registrado_en DESC
         LIMIT ${input.limit}
      `;
    }),

  /** Detalle de un registro anestésico. */
  get: clinicalRole
    .input(eceRegistroAnestesicoIdSchema)
    .query(async ({ ctx, input }) => {
      const row = await findRegistro(ctx.prisma, input.id);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Registro anestésico no encontrado.",
        });
      }
      return row;
    }),

  /** Crea un registro anestésico en estado borrador. */
  create: espRole
    .input(eceRegistroAnestesicoCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const personalId = await findPersonalId(ctx.prisma, ctx.user.id);
      if (!personalId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El usuario no tiene perfil de personal_salud activo en ECE.",
        });
      }

      const activos = await countActivos(ctx.prisma, input.actoQuirurgicoId);
      if (activos > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Ya existe un registro anestésico activo para este acto quirúrgico.",
        });
      }

      const medicamentosJson = JSON.stringify(
        input.medicamentosAdministrados,
      );
      const signosJson = JSON.stringify(input.signosVitalesIntraop);

      const rows = await withEceContext(
        ctx.prisma,
        ctx.tenant,
        ctx.user.id,
        async (tx) =>
          (tx.$queryRaw as (
            query: TemplateStringsArray,
            ...values: unknown[]
          ) => Promise<Array<{ id: string }>>)`
            INSERT INTO ece.registro_anestesico
              (acto_quirurgico_id, asa, tipo_anestesia, via_aerea,
               medicamentos_administrados, signos_vitales_intraop,
               complicaciones, fluidoterapia_ml, perdidas_sanguineas_ml,
               registrado_por, estado_registro, registrado_en)
            VALUES
              (${input.actoQuirurgicoId}::uuid,
               ${input.asa}::smallint,
               ${input.tipoAnestesia},
               ${input.viaAerea},
               ${medicamentosJson}::jsonb,
               ${signosJson}::jsonb,
               ${input.complicaciones ?? null},
               ${input.fluidoterapiaMl ?? null},
               ${input.perdidasSanguineasMl ?? null},
               ${personalId}::uuid,
               'borrador',
               now())
            RETURNING id
          `,
      );

      const id = rows[0]?.id;
      if (!id) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Error al crear el registro anestésico.",
        });
      }

      return { id };
    }),

  /**
   * Agrega un punto de signos vitales al array JSONB.
   * Uso: llamar cada ~5 min durante el intraoperatorio.
   */
  registrarSignoVital: espRole
    .input(registrarSignoVitalSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await findRegistro(ctx.prisma, input.id);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Registro anestésico no encontrado.",
        });
      }
      if (row.estado_registro === "firmado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "No se pueden agregar signos vitales a un registro firmado.",
        });
      }
      if (row.estado_registro === "anulado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "El registro anestésico está anulado.",
        });
      }

      const signoJson = JSON.stringify(input.signoVital);

      await withEceContext(ctx.prisma, ctx.tenant, ctx.user.id, async (tx) =>
        (tx.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>)`
          UPDATE ece.registro_anestesico
             SET signos_vitales_intraop =
                   signos_vitales_intraop || ${signoJson}::jsonb
           WHERE id = ${input.id}::uuid
        `,
      );

      return { ok: true as const };
    }),

  /**
   * Firma el registro anestésico — exclusivo para anestesiólogo (ESP).
   * Emite evento de dominio `ece.anestesia.firmada`.
   */
  firmar: espRole
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const personalId = await findPersonalId(ctx.prisma, ctx.user.id);
      if (!personalId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El usuario no tiene perfil de personal_salud activo en ECE.",
        });
      }

      const row = await findRegistro(ctx.prisma, input.id);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Registro anestésico no encontrado.",
        });
      }
      if (row.estado_registro !== "borrador") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `El registro ya está en estado '${row.estado_registro}'.`,
        });
      }

      await withEceContext(ctx.prisma, ctx.tenant, ctx.user.id, async (tx) => {
        await (tx.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>)`
          UPDATE ece.registro_anestesico
             SET estado_registro = 'firmado',
                 firmado_por     = ${personalId}::uuid,
                 firmado_en      = now()
           WHERE id = ${input.id}::uuid
        `;

        await emitDomainEvent(tx, "ece.anestesia.firmada", {
          registroId: input.id,
          actoQuirurgicoId: row.acto_quirurgico_id,
          firmadoPor: personalId,
        });
      });

      return { ok: true as const };
    }),
});
