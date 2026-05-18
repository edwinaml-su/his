/**
 * Router tRPC — ECE Indicaciones Médicas (IND_MED).
 *
 * Documento NTEC: Doc 6 — Indicaciones Médicas / Prescripción Farmacológica.
 * Norma: MINSAL Acuerdo n.° 1616 (2024), §3.6.
 * Código de tipo_documento: IND_MED.
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (código tipo: IND_MED)
 * ---------------------------------------------------------------------------
 *   borrador    → en_revision  (MC: enviar a validar por enfermería)
 *   en_revision → firmado      (MC: firma con firma electrónica + hash SHA-256)
 *   firmado     → validado     (ENF/NURSE: transcripción confirmada al MAR/Kardex)
 *   cualquiera  → anulado      (MC | ENF, pre-validado)
 *
 *   Items de la orden (ece.indicacion_item) se pueden agregar/eliminar mientras
 *   el encabezado está en estado borrador o en_revision. Post-firma son inmutables.
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (emitDomainEvent dentro del callback de withWorkflowContext)
 * ---------------------------------------------------------------------------
 *   'ece.indicaciones.firmadas'  — emitido por firmar().
 *     Payload: { indicacionId, episodioId, medicoId, itemCount, organizationId }
 *     Consumido por el motor de MAR (Stream 30) para crear las líneas de
 *     ece.administracion_medicamento pendientes de enfermería.
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.indicaciones_medicas  — encabezado: episodio_id, observaciones, estado,
 *                               firmado_por, firmado_en
 *   ece.indicacion_item       — línea: indicacion_id, medicamento_codigo, dosis,
 *                               via, frecuencia, duracion_dias, observaciones
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   list, get                 → requireRole(["MC","PHYSICIAN","NURSE","ENF"])
 *   create, firmar            → requireRole(["MC","PHYSICIAN"])
 *   addItem, removeItem       → requireRole(["MC","PHYSICIAN"])
 *   validar                   → requireRole(["NURSE","ENF"])
 *   anular                    → requireRole(["MC","PHYSICIAN","NURSE","ENF"])
 *
 * Raw SQL es obligatorio porque ece.* usa schema Postgres separado (opción B)
 * y no está mapeado en schema.prisma. Queries con Prisma.sql para prevenir SQLi.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { PrismaClient } from "@his/database";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext } from "../../workflow/context";
import { emitDomainEvent } from "@his/database";

// ─── Input schemas (inline — evita problemas de resolución monorepo en tests)
// Los mismos tipos se exportan desde @his/contracts/src/schemas/ece-indicaciones
// para uso en el cliente (Next.js).

const eceIndicacionItemSchema = z.object({
  medicamentoCodigo: z.string().trim().min(1).max(50),
  dosis: z.string().trim().min(1).max(100),
  via: z.string().trim().min(1).max(50),
  frecuencia: z.string().trim().min(1).max(100),
  duracionDias: z.number().int().min(1).max(365),
  observaciones: z.string().trim().max(500).optional(),
});

const eceIndicacionesCreateSchema = z.object({
  episodioId: z.string().uuid(),
  observaciones: z.string().trim().max(1000).optional(),
  items: z.array(eceIndicacionItemSchema).min(1).max(50),
});

const eceIndicacionIdSchema = z.object({ id: z.string().uuid() });

const eceAddItemSchema = z.object({
  indicacionId: z.string().uuid(),
  item: eceIndicacionItemSchema,
});

const eceRemoveItemSchema = z.object({
  indicacionId: z.string().uuid(),
  itemId: z.string().uuid(),
});

const eceAnularSchema = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(1).max(500),
});

const eceIndicacionesListSchema = z.object({
  episodioId: z.string().uuid(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

// ─── Estados permitidos para mutación de ítems ────────────────────────────────

const ESTADOS_EDITABLE = new Set(["borrador", "en_revision"]);

// ─── Tipos de fila raw ────────────────────────────────────────────────────────

export interface IndicacionRow {
  id: string;
  episodio_id: string;
  estado: string;
  observaciones: string | null;
  creado_por: string;
  creado_en: Date;
  firmado_por: string | null;
  firmado_en: Date | null;
  validado_por: string | null;
  validado_en: Date | null;
}

export interface IndicacionItemRow {
  id: string;
  indicacion_id: string;
  medicamento_codigo: string;
  dosis: string;
  via: string;
  frecuencia: string;
  duracion_dias: number;
  observaciones: string | null;
}

// ─── Helper: construye EceContext desde ctx ───────────────────────────────────

function buildEceCtx(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string; roleCodes: string[] };
}) {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar indicaciones ECE.",
    });
  }
  return {
    personalId: ctx.user.id,
    establecimientoId: ctx.tenant.establishmentId,
    roles: ctx.tenant.roleCodes,
  };
}

// ─── Helper: leer encabezado + verificar existencia ──────────────────────────

async function getIndicacionOrThrow(
  tx: PrismaClient,
  id: string,
): Promise<IndicacionRow> {
  const rows = await tx.$queryRaw<IndicacionRow[]>`
    SELECT
      id::text, episodio_id::text, estado,
      observaciones,
      creado_por::text, creado_en,
      firmado_por::text, firmado_en,
      validado_por::text, validado_en
    FROM ece.indicaciones_medicas
    WHERE id = ${id}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Indicación médica no encontrada: ${id}`,
    });
  }
  return row;
}

// ─── Procedures base ─────────────────────────────────────────────────────────

const physicianProcedure = requireRole(["PHYSICIAN", "MC"]);
const nurseProcedure = requireRole(["NURSE", "ENF"]);
const clinicalProcedure = requireRole(["PHYSICIAN", "MC", "NURSE", "ENF"]);

// ─── Router ───────────────────────────────────────────────────────────────────

export const indicacionesMedicasRouter = router({
  /**
   * Lista indicaciones de un episodio (paginación cursor-based).
   */
  list: clinicalProcedure
    .input(eceIndicacionesListSchema)
    .query(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        const rows = await tx.$queryRaw<IndicacionRow[]>`
          SELECT
            id::text, episodio_id::text, estado,
            observaciones,
            creado_por::text, creado_en,
            firmado_por::text, firmado_en,
            validado_por::text, validado_en
          FROM ece.indicaciones_medicas
          WHERE episodio_id = ${input.episodioId}::uuid
            AND (${input.cursor ?? null}::uuid IS NULL
                 OR id > ${input.cursor ?? null}::uuid)
          ORDER BY id ASC
          LIMIT ${input.limit + 1}
        `;

        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1]!.id : null;

        return { items, nextCursor };
      });
    }),

  /**
   * Devuelve encabezado + ítems de una indicación.
   */
  get: clinicalProcedure
    .input(eceIndicacionIdSchema)
    .query(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        const indicacion = await getIndicacionOrThrow(tx, input.id);

        const items = await tx.$queryRaw<IndicacionItemRow[]>`
          SELECT
            id::text, indicacion_id::text,
            medicamento_codigo, dosis, via, frecuencia,
            duracion_dias, observaciones
          FROM ece.indicacion_item
          WHERE indicacion_id = ${input.id}::uuid
          ORDER BY id ASC
        `;

        return { ...indicacion, items };
      });
    }),

  /**
   * Crea encabezado + ítems en una sola transacción.
   * Estado inicial: borrador.
   */
  create: physicianProcedure
    .input(eceIndicacionesCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        // 1. Insertar encabezado
        const headRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO ece.indicaciones_medicas
            (episodio_id, estado, observaciones, creado_por)
          VALUES (
            ${input.episodioId}::uuid,
            'borrador',
            ${input.observaciones ?? null},
            ${eceCtx.personalId}::uuid
          )
          RETURNING id::text
        `;
        const indicacionId = headRows[0]!.id;

        // 2. Insertar ítems
        for (const item of input.items) {
          await tx.$executeRaw`
            INSERT INTO ece.indicacion_item
              (indicacion_id, medicamento_codigo, dosis, via,
               frecuencia, duracion_dias, observaciones)
            VALUES (
              ${indicacionId}::uuid,
              ${item.medicamentoCodigo},
              ${item.dosis},
              ${item.via},
              ${item.frecuencia},
              ${item.duracionDias},
              ${item.observaciones ?? null}
            )
          `;
        }

        return { id: indicacionId, estado: "borrador" as const };
      });
    }),

  /**
   * Agrega un ítem. Solo si la indicación está en borrador o en_revision.
   */
  addItem: clinicalProcedure
    .input(eceAddItemSchema)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        const indicacion = await getIndicacionOrThrow(tx, input.indicacionId);

        if (!ESTADOS_EDITABLE.has(indicacion.estado)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `No se pueden agregar ítems en estado '${indicacion.estado}'.`,
          });
        }

        const itemRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO ece.indicacion_item
            (indicacion_id, medicamento_codigo, dosis, via,
             frecuencia, duracion_dias, observaciones)
          VALUES (
            ${input.indicacionId}::uuid,
            ${input.item.medicamentoCodigo},
            ${input.item.dosis},
            ${input.item.via},
            ${input.item.frecuencia},
            ${input.item.duracionDias},
            ${input.item.observaciones ?? null}
          )
          RETURNING id::text
        `;

        return { id: itemRows[0]!.id };
      });
    }),

  /**
   * Elimina un ítem. Solo si la indicación está en borrador o en_revision.
   */
  removeItem: clinicalProcedure
    .input(eceRemoveItemSchema)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        const indicacion = await getIndicacionOrThrow(tx, input.indicacionId);

        if (!ESTADOS_EDITABLE.has(indicacion.estado)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `No se pueden eliminar ítems en estado '${indicacion.estado}'.`,
          });
        }

        const deleted = await tx.$executeRaw`
          DELETE FROM ece.indicacion_item
          WHERE id = ${input.itemId}::uuid
            AND indicacion_id = ${input.indicacionId}::uuid
        `;

        if ((deleted as number) === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Ítem no encontrado: ${input.itemId}`,
          });
        }

        return { ok: true as const };
      });
    }),

  /**
   * MC firma la indicación: borrador|en_revision → firmado.
   * Emite evento `ece.indicaciones.firmadas` (outbox transaccional).
   */
  firmar: physicianProcedure
    .input(eceIndicacionIdSchema)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      const result = await withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        const indicacion = await getIndicacionOrThrow(tx, input.id);

        if (!ESTADOS_EDITABLE.has(indicacion.estado)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Solo se pueden firmar indicaciones en estado borrador o en_revision. Estado actual: '${indicacion.estado}'.`,
          });
        }

        await tx.$executeRaw`
          UPDATE ece.indicaciones_medicas
          SET estado = 'firmado',
              firmado_por = ${eceCtx.personalId}::uuid,
              firmado_en  = now()
          WHERE id = ${input.id}::uuid
        `;

        // Emitir evento outbox dentro de la misma transacción
        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.indicaciones.firmadas",
          aggregateType: "IndicacionMedica",
          aggregateId: input.id,
          emittedById: ctx.user.id,
          payload: {
            indicacionId: input.id,
            episodioId: indicacion.episodio_id,
            firmadoPor: eceCtx.personalId,
            estadoAnterior: indicacion.estado,
          },
        });

        return { id: input.id, estado: "firmado" as const };
      });

      return result;
    }),

  /**
   * ENF valida la transcripción: firmado → validado.
   */
  validar: nurseProcedure
    .input(eceIndicacionIdSchema)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        const indicacion = await getIndicacionOrThrow(tx, input.id);

        if (indicacion.estado !== "firmado") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Solo se pueden validar indicaciones en estado 'firmado'. Estado actual: '${indicacion.estado}'.`,
          });
        }

        await tx.$executeRaw`
          UPDATE ece.indicaciones_medicas
          SET estado = 'validado',
              validado_por = ${eceCtx.personalId}::uuid,
              validado_en  = now()
          WHERE id = ${input.id}::uuid
        `;

        return { id: input.id, estado: "validado" as const };
      });
    }),

  /**
   * Anula una indicación desde cualquier estado editable (borrador|en_revision|firmado).
   * Validado no se puede anular — requiere flujo administrativo distinto.
   */
  anular: clinicalProcedure
    .input(eceAnularSchema)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        const indicacion = await getIndicacionOrThrow(tx, input.id);

        if (indicacion.estado === "anulado" || indicacion.estado === "validado") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `No se puede anular una indicación en estado '${indicacion.estado}'.`,
          });
        }

        await tx.$executeRaw`
          UPDATE ece.indicaciones_medicas
          SET estado = 'anulado',
              observaciones = concat_ws(' | ', observaciones, ${"ANULADO: " + input.motivo})
          WHERE id = ${input.id}::uuid
        `;

        return { id: input.id, estado: "anulado" as const };
      });
    }),
});
