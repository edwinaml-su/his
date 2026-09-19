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
import { resolvePersonalSalud } from "../../lib/identity-resolver";
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

export interface RegistroAnestesicoRow {
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
  // R1.2 (revisión independiente, P1-2) — el fallback `?? tenant.organizationId`
  // metía el uuid de la organización donde se espera un establecimiento:
  // `ece.set_ece_context` no lo resuelve contra `ece.establecimiento` (ni por
  // `id` ni por `establishment_id` puente, ver ADR 0022) y solo emite un
  // RAISE WARNING — el GUC queda con un valor que ninguna policy `by_estab`
  // matchea nunca. Resultado silencioso: list/get devuelven 0 filas (no un
  // error) y las mutaciones con `emitDomainEvent` revientan 42501 en el
  // primer INSERT sobre una tabla `ece.*`. Se falla rápido y explícito en su
  // lugar, igual que certificado-defuncion/periodo-expulsivo/los bridges.
  if (!tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Selecciona un establecimiento antes de continuar.",
    });
  }
  return {
    personalId: userId,
    establecimientoId: tenant.establishmentId,
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

// R03: delega al resolver canónico (packages/trpc/src/lib/identity-resolver.ts)
// en vez de reimplementar el lookup his_user_id → ece.personal_salud.
async function findPersonalId(
  prisma: Pick<PrismaClient, "$queryRaw">,
  userId: string,
): Promise<string | null> {
  const personal = await resolvePersonalSalud(prisma, userId);
  return personal?.id ?? null;
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
  /**
   * Lista registros anestésicos con filtros opcionales.
   *
   * R1.2 (2026-09) — antes corría en `ctx.prisma` directo (rol BYPASSRLS)
   * sin filtro de establecimiento (solo por actoQuirurgicoId/estado, ambos
   * opcionales) — cualquier organización podía listar el registro anestésico
   * de otra. La policy `reg_anest_by_acto_estab` (ALL, vía
   * acto_quirurgico→episodio_atencion) filtra de verdad bajo `authenticated`.
   */
  list: clinicalRole
    .input(eceRegistroAnestesicoListSchema)
    .query(async ({ ctx, input }) => {
      return withEceContext(ctx.prisma, ctx.tenant, ctx.user.id, (tx) =>
        (tx.$queryRaw as (
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
        `,
      );
    }),

  /**
   * Detalle de un registro anestésico.
   *
   * R1.2 — mismo hallazgo que `list`: sin filtro de establecimiento.
   */
  get: clinicalRole
    .input(eceRegistroAnestesicoIdSchema)
    .query(async ({ ctx, input }) => {
      return withEceContext(ctx.prisma, ctx.tenant, ctx.user.id, async (tx) => {
        const row = await findRegistro(tx, input.id);
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Registro anestésico no encontrado.",
          });
        }
        return row;
      });
    }),

  /** Crea un registro anestésico en estado borrador. */
  create: espRole
    .input(eceRegistroAnestesicoCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const medicamentosJson = JSON.stringify(
        input.medicamentosAdministrados,
      );
      const signosJson = JSON.stringify(input.signosVitalesIntraop);

      const rows = await withEceContext(
        ctx.prisma,
        ctx.tenant,
        ctx.user.id,
        async (tx) => {
          // R1.2 — findPersonalId/countActivos movidos dentro del contexto
          // ECE (antes corrían en ctx.prisma directo).
          const personalId = await findPersonalId(tx, ctx.user.id);
          if (!personalId) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "El usuario no tiene perfil de personal_salud activo en ECE.",
            });
          }

          const activos = await countActivos(tx, input.actoQuirurgicoId);
          if (activos > 0) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Ya existe un registro anestésico activo para este acto quirúrgico.",
            });
          }

          return (tx.$queryRaw as (
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
          `;
        },
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
      const signoJson = JSON.stringify(input.signoVital);

      await withEceContext(ctx.prisma, ctx.tenant, ctx.user.id, async (tx) => {
        // R1.2 — pre-check movido dentro del contexto ECE.
        const row = await findRegistro(tx, input.id);
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

        await (tx.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>)`
          UPDATE ece.registro_anestesico
             SET signos_vitales_intraop =
                   signos_vitales_intraop || ${signoJson}::jsonb
           WHERE id = ${input.id}::uuid
        `;
      });

      return { ok: true as const };
    }),

  /**
   * Firma el registro anestésico — exclusivo para anestesiólogo (ESP).
   * Emite evento de dominio `ece.anestesia.firmada`.
   */
  firmar: espRole
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await withEceContext(ctx.prisma, ctx.tenant, ctx.user.id, async (tx) => {
        // R1.2 — pre-checks movidos dentro del contexto ECE.
        const personalId = await findPersonalId(tx, ctx.user.id);
        if (!personalId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "El usuario no tiene perfil de personal_salud activo en ECE.",
          });
        }

        const row = await findRegistro(tx, input.id);
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

        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.anestesia.firmada",
          aggregateType: "RegistroAnestesico",
          aggregateId: input.id,
          emittedById: ctx.user.id,
          payload: {
            registroId: input.id,
            actoQuirurgicoId: row.acto_quirurgico_id,
            firmadoPor: personalId,
          },
        });
      });

      return { ok: true as const };
    }),
});
