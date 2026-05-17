/**
 * GS1 Proceso C — Preparación Unidosis.
 *
 * Procedimientos:
 *   prepararUnidosis  — crea registro + genera código UD-N + etiqueta QR data
 *   verificarUnidosis — busca por código (al dispensar)
 *   list              — listado por paciente/indicación (cursor-based)
 *
 * Eventos de dominio emitidos:
 *   gs1.unidosis.preparada   (prepararUnidosis)
 *   gs1.unidosis.verificada  (verificarUnidosis)
 *
 * RLS Cat-E: withWorkflowContext demota a rol `authenticated`; las
 * políticas filtran por establecimiento via JOIN ece.paciente.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { PrismaClient } from "@his/database";
import { router, requireRole } from "../trpc";
import { withWorkflowContext } from "../workflow/context";
import { emitDomainEvent } from "@his/database";

// ─── Schemas locales (importar desde contracts en el cliente) ─────────────────

const prepararInput = z.object({
  pacienteId: z.string().uuid(),
  indicacionId: z.string().uuid(),
  gtinOrigenId: z.string().uuid(),
  loteOrigen: z.string().trim().min(1).max(50),
  cantidadPreparada: z.number().int().min(1).max(9999),
  expiryUnidosis: z.string().datetime(),
  preparadoPor: z.string().uuid(),
});

const verificarInput = z.object({
  codigoUnidosis: z.string().trim().min(1).max(50),
});

const listInput = z.object({
  pacienteId: z.string().uuid().optional(),
  indicacionId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

// ─── Tipos raw SQL ────────────────────────────────────────────────────────────

interface UnidosisRaw {
  id: string;
  codigo_unidosis: string;
  etiqueta_qr_generada: string | null;
  paciente_id: string;
  indicacion_id: string;
  gtin_origen: string;
  lote_origen: string;
  cantidad_preparada: number;
  fecha_preparacion: Date;
  expiry_unidosis: Date;
  preparado_por: string;
  creado_en: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildEceCtx(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string; roleCodes: string[] };
}) {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar unidosis.",
    });
  }
  return {
    personalId: ctx.user.id,
    establecimientoId: ctx.tenant.establishmentId,
    roles: ctx.tenant.roleCodes,
  };
}

/**
 * Construye el payload de datos QR para la etiqueta de la unidosis.
 * Formato: JSON compacto imprimible via QR (no URL).
 */
function buildQrData(params: {
  codigoUnidosis: string;
  gtinOrigenId: string;
  loteOrigen: string;
  pacienteId: string;
  indicacionId: string;
  expiry: string;
}): string {
  return JSON.stringify({
    ud: params.codigoUnidosis,
    gtin: params.gtinOrigenId,
    lot: params.loteOrigen,
    pid: params.pacienteId,
    ind: params.indicacionId,
    exp: params.expiry,
  });
}

async function getUnidosisByCodigoOrThrow(
  tx: PrismaClient,
  codigo: string,
): Promise<UnidosisRaw> {
  const rows = await tx.$queryRaw<UnidosisRaw[]>`
    SELECT
      id::text, codigo_unidosis,
      etiqueta_qr_generada,
      paciente_id::text, indicacion_id::text,
      gtin_origen::text, lote_origen,
      cantidad_preparada::int,
      fecha_preparacion, expiry_unidosis,
      preparado_por::text, creado_en
    FROM ece.preparacion_unidosis
    WHERE codigo_unidosis = ${codigo}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Unidosis no encontrada: ${codigo}`,
    });
  }
  return row;
}

// ─── Procedures ──────────────────────────────────────────────────────────────

const pharmacyProcedure = requireRole(["PHARMACIST", "NURSE", "ENF", "FARM"]);

// ─── Router ───────────────────────────────────────────────────────────────────

export const gs1ProcesoCRouter = router({
  /**
   * Registra un lote de unidosis preparadas.
   * Genera código UD-N (via DEFAULT de secuencia) y datos de etiqueta QR.
   */
  prepararUnidosis: pharmacyProcedure
    .input(prepararInput)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        // Insertar — el DEFAULT genera codigo_unidosis automáticamente
        const rows = await tx.$queryRaw<{ id: string; codigo_unidosis: string }[]>`
          INSERT INTO ece.preparacion_unidosis (
            paciente_id, indicacion_id,
            gtin_origen, lote_origen, cantidad_preparada,
            expiry_unidosis, preparado_por
          ) VALUES (
            ${input.pacienteId}::uuid,
            ${input.indicacionId}::uuid,
            ${input.gtinOrigenId}::uuid,
            ${input.loteOrigen},
            ${input.cantidadPreparada}::smallint,
            ${input.expiryUnidosis}::timestamptz,
            ${input.preparadoPor}::uuid
          )
          RETURNING id::text, codigo_unidosis
        `;

        const inserted = rows[0];
        if (!inserted) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Insert falló." });
        }

        // Generar datos QR y persistir en etiqueta_qr_generada
        const qrData = buildQrData({
          codigoUnidosis: inserted.codigo_unidosis,
          gtinOrigenId: input.gtinOrigenId,
          loteOrigen: input.loteOrigen,
          pacienteId: input.pacienteId,
          indicacionId: input.indicacionId,
          expiry: input.expiryUnidosis,
        });

        await tx.$executeRaw`
          UPDATE ece.preparacion_unidosis
          SET etiqueta_qr_generada = ${qrData}
          WHERE id = ${inserted.id}::uuid
        `;

        // Evento de dominio
        await emitDomainEvent(tx, {
          eventType: "gs1.unidosis.preparada",
          aggregateType: "unidosis",
          aggregateId: inserted.id,
          payload: {
            codigoUnidosis: inserted.codigo_unidosis,
            pacienteId: input.pacienteId,
            indicacionId: input.indicacionId,
            gtinOrigenId: input.gtinOrigenId,
            cantidadPreparada: input.cantidadPreparada,
            expiryUnidosis: input.expiryUnidosis,
          },
          organizationId: ctx.tenant.organizationId,
          emittedById: ctx.user.id,
        });

        return {
          id: inserted.id,
          codigoUnidosis: inserted.codigo_unidosis,
          qrData,
        };
      });
    }),

  /**
   * Verifica una unidosis al dispensar (busca por código).
   * Emite evento gs1.unidosis.verificada para trazabilidad.
   */
  verificarUnidosis: pharmacyProcedure
    .input(verificarInput)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        const row = await getUnidosisByCodigoOrThrow(tx, input.codigoUnidosis);

        // Verificar que no haya expirado
        if (new Date(row.expiry_unidosis) < new Date()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Unidosis ${input.codigoUnidosis} expirada.`,
          });
        }

        await emitDomainEvent(tx, {
          eventType: "gs1.unidosis.verificada",
          aggregateType: "unidosis",
          aggregateId: row.id,
          payload: {
            codigoUnidosis: row.codigo_unidosis,
            pacienteId: row.paciente_id,
            verificadoPor: ctx.user.id,
          },
          organizationId: ctx.tenant.organizationId,
          emittedById: ctx.user.id,
        });

        return row;
      });
    }),

  /**
   * Lista unidosis con filtro opcional por paciente/indicación (cursor-based).
   */
  list: pharmacyProcedure
    .input(listInput)
    .query(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        const rows = await tx.$queryRaw<UnidosisRaw[]>`
          SELECT
            id::text, codigo_unidosis,
            etiqueta_qr_generada,
            paciente_id::text, indicacion_id::text,
            gtin_origen::text, lote_origen,
            cantidad_preparada::int,
            fecha_preparacion, expiry_unidosis,
            preparado_por::text, creado_en
          FROM ece.preparacion_unidosis
          WHERE
            (${input.pacienteId ?? null}::uuid IS NULL
              OR paciente_id = ${input.pacienteId ?? null}::uuid)
            AND (${input.indicacionId ?? null}::uuid IS NULL
              OR indicacion_id = ${input.indicacionId ?? null}::uuid)
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
});
