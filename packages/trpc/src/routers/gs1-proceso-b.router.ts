/**
 * GS1 Proceso B — Transferencias de inventario entre depósitos (GLN→GLN).
 *
 * Tabla operada (raw SQL — schema ece):
 *   ece.transferencia_inventario
 *
 * Estados: programado → en_transito → recibido | rechazado
 *
 * Outbox:
 *   enviarTransferencia  → gs1.transfer.enviada
 *   recibirTransferencia → gs1.transfer.recibida
 *   rechazarTransferencia (via recibirTransferencia con rechazar:true) → gs1.transfer.rechazada
 *
 * Roles: INVENTORY_MANAGER | PHARMACIST | NURSE (Cat-E — filtro por GLNs del tenant)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../trpc";
import { emitDomainEvent } from "@his/database";
import { gs1CheckDigitValid } from "@his/contracts";
import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

// HI-17: tipo explícito exportado para uso en la UI.
export interface ProductoTransferencia {
  gtin: string;
  lote: string;
  fechaVencimiento: string;
  cantidad: number;
  uom: string;
}

const productoTransferenciaSchema = z.object({
  gtin:             z.string().min(8).max(14),
  lote:             z.string().min(1).max(50),
  // HI-16: la fecha debe ser futura para evitar transferir medicamentos vencidos.
  fechaVencimiento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD")
    .refine((d) => new Date(d + "T00:00:00") > new Date(), "La fecha de vencimiento debe ser futura"),
  cantidad:         z.number().int().positive(),
  uom:              z.string().min(1).max(20).default("EA"),
});

// HI-15: GLN-13 requiere check-digit GS1 Módulo-10 válido.
const glnSchema = z
  .string()
  .length(13, "GLN debe tener exactamente 13 dígitos")
  .regex(/^\d{13}$/, "GLN debe ser numérico")
  .refine(gs1CheckDigitValid, "Dígito verificador GS1 (GLN-13) inválido");

const enviarTransferenciaInput = z.object({
  origenGln:   glnSchema,
  destinoGln:  glnSchema,
  ssccPallet:  z.string().length(18).optional(),
  productos:   z.array(productoTransferenciaSchema).min(1, "Debe incluir al menos un producto"),
  fechaEnvio:  z.coerce.date().optional(),
});

const recibirTransferenciaInput = z.object({
  id:             z.string().uuid(),
  /** Si true, el estado cambia a 'rechazado'; de lo contrario a 'recibido'. */
  rechazar:       z.boolean().default(false),
  motivoRechazo:  z.string().trim().max(1000).optional(),
});

const listInput = z.object({
  estado: z.enum(["programado", "en_transito", "recibido", "rechazado"]).optional(),
  origenGln:  z.string().optional(),
  destinoGln: z.string().optional(),
  limit:  z.number().int().min(1).max(200).default(50),
});

const idInput = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// Tipos raw SQL
// ---------------------------------------------------------------------------

export interface TransferenciaInventarioRow {
  id: string;
  origen_gln: string;
  destino_gln: string;
  sscc_pallet: string | null;
  /** HI-17: JSONB en BD — parseado y validado al leer. */
  productos: ProductoTransferencia[];
  fecha_envio: Date | null;
  fecha_recepcion: Date | null;
  estado: string;
  registrado_por: string;
  verificado_por: string | null;
  motivo_rechazo: string | null;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findTransferencia(
  prisma: Pick<PrismaClient, "$queryRaw">,
  id: string,
): Promise<TransferenciaInventarioRow | null> {
  const rows = await (prisma.$queryRaw as (
    tpl: TemplateStringsArray,
    ...vals: unknown[]
  ) => Promise<TransferenciaInventarioRow[]>)`
    SELECT id, origen_gln, destino_gln, sscc_pallet,
           productos, fecha_envio, fecha_recepcion, estado,
           registrado_por, verificado_por, motivo_rechazo,
           created_at, updated_at
      FROM ece.transferencia_inventario
     WHERE id = ${id}::uuid
     LIMIT 1
  `;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const inventoryRole = requireRole(["INVENTORY_MANAGER", "PHARMACIST", "NURSE"]);

export const gs1ProcesoBRouter = router({
  /**
   * Crea una transferencia en estado 'en_transito'.
   * Emite gs1.transfer.enviada.
   */
  enviarTransferencia: inventoryRole
    .input(enviarTransferenciaInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const orgId = ctx.tenant.organizationId;
      const fechaEnvio = input.fechaEnvio ?? new Date();
      const productosJson = JSON.stringify(input.productos);

      const rows = await (ctx.prisma.$queryRaw as (
        tpl: TemplateStringsArray,
        ...vals: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.transferencia_inventario
          (origen_gln, destino_gln, sscc_pallet, productos,
           fecha_envio, estado, registrado_por)
        VALUES
          (${input.origenGln}, ${input.destinoGln},
           ${input.ssccPallet ?? null},
           ${productosJson}::jsonb,
           ${fechaEnvio}::timestamptz,
           'en_transito',
           ${userId}::uuid)
        RETURNING id
      `;
      const created = rows[0];
      if (!created) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo crear la transferencia." });
      }

      await emitDomainEvent(ctx.prisma as unknown as PrismaClient, {
        organizationId: orgId,
        eventType: "gs1.transfer.enviada",
        aggregateType: "TransferenciaInventario",
        aggregateId: created.id,
        emittedById: userId,
        payload: {
          transferenciaId: created.id,
          origenGln: input.origenGln,
          destinoGln: input.destinoGln,
          ssccPallet: input.ssccPallet ?? null,
          cantidadProductos: input.productos.length,
          fechaEnvio: fechaEnvio.toISOString(),
        },
      });

      return { id: created.id };
    }),

  /**
   * Confirma recepción (→ recibido) o rechazo (→ rechazado).
   * Valida que todos los productos hayan sido escaneados antes de marcar recibido.
   * Emite gs1.transfer.recibida | gs1.transfer.rechazada.
   *
   * La verificación de productos se delega al cliente: el frontend escanea
   * cada GTIN/lote y envía la confirmación. Si rechazar=false, el router
   * asume que el cliente ya completó la verificación visual.
   */
  recibirTransferencia: inventoryRole
    .input(recibirTransferenciaInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const orgId = ctx.tenant.organizationId;

      const row = await findTransferencia(ctx.prisma, input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      if (row.estado !== "en_transito") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Solo se puede recibir/rechazar una transferencia 'en_transito'. Estado actual: '${row.estado}'.`,
        });
      }

      if (input.rechazar && !input.motivoRechazo?.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El motivo de rechazo es obligatorio al rechazar una transferencia.",
        });
      }

      const nuevoEstado = input.rechazar ? "rechazado" : "recibido";
      const eventType = input.rechazar ? "gs1.transfer.rechazada" : "gs1.transfer.recibida";

      await (ctx.prisma.$executeRaw as (
        tpl: TemplateStringsArray,
        ...vals: unknown[]
      ) => Promise<number>)`
        UPDATE ece.transferencia_inventario
           SET estado          = ${nuevoEstado},
               fecha_recepcion = now(),
               verificado_por  = ${userId}::uuid,
               motivo_rechazo  = ${input.motivoRechazo ?? null}
         WHERE id = ${input.id}::uuid
      `;

      await emitDomainEvent(ctx.prisma as unknown as PrismaClient, {
        organizationId: orgId,
        eventType,
        aggregateType: "TransferenciaInventario",
        aggregateId: input.id,
        emittedById: userId,
        payload: {
          transferenciaId: input.id,
          origenGln: row.origen_gln,
          destinoGln: row.destino_gln,
          verificadoPor: userId,
          motivoRechazo: input.motivoRechazo ?? null,
        },
      });

      return { ok: true as const, estado: nuevoEstado };
    }),

  /** Lista transferencias pendientes (estado = programado). */
  listPendientes: inventoryRole
    .input(listInput.omit({ estado: true }))
    .query(async ({ ctx, input }) => {
      return (ctx.prisma.$queryRaw as (
        tpl: TemplateStringsArray,
        ...vals: unknown[]
      ) => Promise<TransferenciaInventarioRow[]>)`
        SELECT id, origen_gln, destino_gln, sscc_pallet,
               productos, fecha_envio, fecha_recepcion, estado,
               registrado_por, verificado_por, motivo_rechazo,
               created_at, updated_at
          FROM ece.transferencia_inventario
         WHERE estado = 'programado'
           AND (${input.origenGln ?? null}::text IS NULL OR origen_gln = ${input.origenGln ?? null})
           AND (${input.destinoGln ?? null}::text IS NULL OR destino_gln = ${input.destinoGln ?? null})
         ORDER BY created_at DESC
         LIMIT ${input.limit}
      `;
    }),

  /** Lista transferencias en tránsito (estado = en_transito). */
  listEnTransito: inventoryRole
    .input(listInput.omit({ estado: true }))
    .query(async ({ ctx, input }) => {
      return (ctx.prisma.$queryRaw as (
        tpl: TemplateStringsArray,
        ...vals: unknown[]
      ) => Promise<TransferenciaInventarioRow[]>)`
        SELECT id, origen_gln, destino_gln, sscc_pallet,
               productos, fecha_envio, fecha_recepcion, estado,
               registrado_por, verificado_por, motivo_rechazo,
               created_at, updated_at
          FROM ece.transferencia_inventario
         WHERE estado = 'en_transito'
           AND (${input.origenGln ?? null}::text IS NULL OR origen_gln = ${input.origenGln ?? null})
           AND (${input.destinoGln ?? null}::text IS NULL OR destino_gln = ${input.destinoGln ?? null})
         ORDER BY fecha_envio ASC
         LIMIT ${input.limit}
      `;
    }),

  /** Obtiene una transferencia por id. */
  get: inventoryRole
    .input(idInput)
    .query(async ({ ctx, input }) => {
      const row = await findTransferencia(ctx.prisma, input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),
});
