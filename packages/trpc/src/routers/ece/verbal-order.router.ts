/**
 * Router tRPC — Órdenes Verbales ECE (VERBAL_ORDER).
 *
 * JCI Standard: IPSG.2 ME 1 — Comunicación efectiva: read-back de órdenes verbales.
 * US.JCI.5.5 — Workflow read-back de órdenes verbales (8 SP).
 *
 * Ciclo obligatorio:
 *   1. Médico dicta → ENF registra  (record)         → estado: registrada
 *   2. ENF lee de vuelta; MC confirma con PIN         → estado: confirmada
 *      o MC rechaza con PIN + texto corregido         → estado: rechazada
 *   3. Si rechazada: ENF re-registra (nuevo INSERT)
 *
 * Tablas BD (raw SQL — ece.* no está en schema.prisma):
 *   ece.verbal_order      — ciclo JCI (ver 113_verbal_order.sql)
 *   ece.personal_salud    — mapeo his_user_id → personal ECE
 *   ece.firma_electronica — credencial PIN argon2id del MC
 *
 * Roles tRPC:
 *   record          → requireRole(["NURSE","ENF"])
 *   confirmReadback → requireRole(["MC","ESP"])
 *   list            → requireRole(["MC","ESP","NURSE","ENF","DIR"])
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { argon2 } from "@his/infrastructure";
import { emitDomainEvent } from "@his/database";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext, type EceContext } from "../../workflow/context";

// =============================================================================
// Tipos de fila raw
// =============================================================================

interface VerbalOrderRow {
  id: string;
  episodio_id: string;
  paciente_id: string;
  dictado_por_id: string;
  registrado_por_id: string;
  orden_texto: string;
  texto_readback: string | null;
  estado: string;
  indicacion_item_id: string | null;
  dictado_en: Date;
  registrado_en: Date | null;
  confirmado_en: Date | null;
  // JCI IPSG.2-H1 — campos read-back auditables (sql/158)
  readback_at: Date | null;
  readback_by: string | null;
  readback_text: string | null;
  readback_match: boolean | null;
}

interface PersonalRow {
  id: string;
}

interface FirmaRow {
  id: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  revoked_at: Date | null;
}

// =============================================================================
// Helpers
// =============================================================================

function buildEceCtx(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string; roleCodes: string[] };
}): EceContext {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar órdenes verbales ECE.",
    });
  }
  return {
    personalId: ctx.user.id,
    establecimientoId: ctx.tenant.establishmentId,
    roles: ctx.tenant.roleCodes,
  };
}

async function findPersonal(
  tx: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  hisUserId: string,
): Promise<PersonalRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<PersonalRow[]>)`
    SELECT id::text
    FROM ece.personal_salud
    WHERE his_user_id = ${hisUserId}::uuid
      AND activo = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findFirmaByPersonal(
  tx: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  personalId: string,
): Promise<FirmaRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<FirmaRow[]>)`
    SELECT id::text, pin_hash, failed_attempts,
           locked_until, revoked_at
    FROM ece.firma_electronica
    WHERE personal_id = ${personalId}::uuid
      AND revoked_at IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

const LOCKOUT_MAX = 5;

async function verifyPinOrThrow(
  tx: {
    $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
    $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  },
  hisUserId: string,
  pin: string,
): Promise<void> {
  const personal = await findPersonal(tx, hisUserId);
  if (!personal) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No se encontró un profesional de salud asociado a su cuenta.",
    });
  }

  const firma = await findFirmaByPersonal(tx, personal.id);
  if (!firma) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Firma electrónica no configurada. Use firma.setup para crearla.",
    });
  }

  if (firma.locked_until !== null && firma.locked_until > new Date()) {
    const mins = Math.ceil((firma.locked_until.getTime() - Date.now()) / 60_000);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Firma bloqueada. Inténtelo en ${mins} min.`,
    });
  }

  const valid = await argon2.verify(firma.pin_hash, pin);

  if (!valid) {
    await (tx.$executeRaw as (
      q: TemplateStringsArray,
      ...v: unknown[]
    ) => Promise<number>)`
      UPDATE ece.firma_electronica
      SET failed_attempts = failed_attempts + 1
      WHERE id = ${firma.id}::uuid
    `;
    const remaining = LOCKOUT_MAX - (firma.failed_attempts + 1);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        remaining > 0
          ? `PIN incorrecto. Intentos restantes: ${remaining}.`
          : "PIN incorrecto. La firma quedará bloqueada.",
    });
  }

  // Resetear contador en éxito
  await (tx.$executeRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<number>)`
    UPDATE ece.firma_electronica
    SET failed_attempts = 0
    WHERE id = ${firma.id}::uuid
  `;
}

// =============================================================================
// Input schemas
// =============================================================================

const recordInput = z.object({
  episodioId: z.string().uuid(),
  pacienteId: z.string().uuid(),
  ordenTexto: z.string().min(1).max(2000),
  dictadoPorId: z.string().uuid(),
});

const confirmReadbackInput = z.object({
  orderId: z.string().uuid(),
  ordenConfirmada: z.boolean(),
  ordenCorregida: z.string().min(1).max(2000).optional(),
  pin: z.string().min(4),
  // JCI IPSG.2-H1 — read-back auditable obligatorio
  /** Texto exacto que el receptor repitió de vuelta al médico. */
  readbackText: z.string().min(10).max(2000),
  /** true si el MC confirmó que el read-back coincidió con la orden original. */
  readbackMatch: z.boolean(),
});

const listInput = z.object({
  episodioId: z.string().uuid(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

// =============================================================================
// Procedures por rol
// =============================================================================

const nurseProc = requireRole(["NURSE", "ENF"]);
const physicianProc = requireRole(["MC", "ESP"]);
const readerProc = requireRole(["MC", "ESP", "NURSE", "ENF", "DIR"]);

// =============================================================================
// Router
// =============================================================================

export const verbalOrderRouter = router({
  /**
   * Enfermera registra la orden verbal dictada por el médico.
   * El médico dictador se identifica por dictadoPorId (FK a personal_salud).
   * Estado resultante: registrada.
   */
  record: nurseProc.input(recordInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      // Resolver personal_salud de la enfermera (registrado_por)
      const enfermeraPersonal = await findPersonal(tx, ctx.user.id);
      if (!enfermeraPersonal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No se encontró un profesional de salud asociado a su cuenta.",
        });
      }

      // Verificar que el episodio pertenece al establecimiento activo
      const epRows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        SELECT id::text
        FROM ece.episodio_atencion
        WHERE id = ${input.episodioId}::uuid
          AND establecimiento_id::text = current_setting('app.establecimiento_id', true)
        LIMIT 1
      `;

      if (epRows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Episodio no encontrado en el establecimiento activo: ${input.episodioId}`,
        });
      }

      const rows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.verbal_order
          (episodio_id, paciente_id, dictado_por_id,
           registrado_por_id, orden_texto, estado, registrado_en)
        VALUES (
          ${input.episodioId}::uuid,
          ${input.pacienteId}::uuid,
          ${input.dictadoPorId}::uuid,
          ${enfermeraPersonal.id}::uuid,
          ${input.ordenTexto},
          'registrada',
          now()
        )
        RETURNING id::text
      `;

      return { orderId: rows[0]!.id, estado: "registrada" as const };
    });
  }),

  /**
   * Médico confirma (o rechaza) la orden verbal después del read-back.
   * Requiere PIN argon2id (IPSG.2 ME 1 — firma electrónica).
   *
   * Si ordenConfirmada=true  → estado: confirmada
   * Si ordenConfirmada=false → estado: rechazada; se persiste ordenCorregida si viene
   */
  confirmReadback: physicianProc
    .input(confirmReadbackInput)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      const result = await withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        // Verificar que la orden existe y está en estado registrada
        const orderRows = await (tx.$queryRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<VerbalOrderRow[]>)`
          SELECT
            vo.id::text,
            vo.episodio_id::text,
            vo.paciente_id::text,
            vo.dictado_por_id::text,
            vo.registrado_por_id::text,
            vo.orden_texto,
            vo.texto_readback,
            vo.estado,
            vo.indicacion_item_id::text,
            vo.dictado_en,
            vo.registrado_en,
            vo.confirmado_en
          FROM ece.verbal_order vo
          JOIN ece.episodio_atencion ea ON ea.id = vo.episodio_id
          WHERE vo.id = ${input.orderId}::uuid
            AND ea.establecimiento_id::text = current_setting('app.establecimiento_id', true)
          LIMIT 1
        `;

        if (orderRows.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Orden verbal no encontrada: ${input.orderId}`,
          });
        }

        const order = orderRows[0]!;

        if (order.estado !== "registrada") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `La orden no está en estado 'registrada' (estado actual: ${order.estado}). Solo se puede confirmar una orden registrada.`,
          });
        }

        // JCI IPSG.2-H1: el read-back debe coincidir para poder confirmar la orden.
        // Si el receptor detectó discrepancia (readbackMatch=false), la orden
        // NO puede quedar en estado 'confirmada' — el médico debe corregirla primero.
        if (!input.readbackMatch) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "El read-back no coincidió con la orden original. Corrija la orden antes de confirmar (IPSG.2-H1).",
          });
        }

        // Verificar PIN del médico
        await verifyPinOrThrow(tx, ctx.user.id, input.pin);

        const nuevoEstado = input.ordenConfirmada ? "confirmada" : "rechazada";

        // Si rechazada y viene ordenCorregida, guardar como texto_readback
        // (la enfermera usará ese texto para re-registrar)
        const textoReadback = !input.ordenConfirmada && input.ordenCorregida
          ? input.ordenCorregida
          : order.texto_readback;

        await (tx.$executeRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<number>)`
          UPDATE ece.verbal_order
          SET estado          = ${nuevoEstado},
              texto_readback  = ${textoReadback ?? null},
              confirmado_en   = now(),
              readback_at     = now(),
              readback_by     = ${ctx.user.id}::uuid,
              readback_text   = ${input.readbackText},
              readback_match  = ${input.readbackMatch}
          WHERE id = ${input.orderId}::uuid
        `;

        return {
          orderId: input.orderId,
          estado: nuevoEstado as "confirmada" | "rechazada",
          confirmedAt: new Date().toISOString(),
        };
      });

      // Emitir evento auditable fuera del withWorkflowContext (abre su propia tx)
      await emitDomainEvent(ctx.prisma, {
        organizationId: ctx.tenant.organizationId,
        eventType: "jci.ipsg2.readback_recorded",
        aggregateType: "VerbalOrder",
        aggregateId: input.orderId,
        emittedById: ctx.user.id,
        payload: {
          verbalOrderId: input.orderId,
          by: ctx.user.id,
          match: input.readbackMatch,
        },
      });

      return result;
    }),

  /**
   * Lista órdenes verbales de un episodio, paginadas por cursor.
   */
  list: readerProc.input(listInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      const rows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<VerbalOrderRow[]>)`
        SELECT
          vo.id::text,
          vo.episodio_id::text,
          vo.paciente_id::text,
          vo.dictado_por_id::text,
          vo.registrado_por_id::text,
          vo.orden_texto,
          vo.texto_readback,
          vo.estado,
          vo.indicacion_item_id::text,
          vo.dictado_en,
          vo.registrado_en,
          vo.confirmado_en
        FROM ece.verbal_order vo
        JOIN ece.episodio_atencion ea ON ea.id = vo.episodio_id
        WHERE vo.episodio_id = ${input.episodioId}::uuid
          AND ea.establecimiento_id::text = current_setting('app.establecimiento_id', true)
          AND (${input.cursor ?? null}::uuid IS NULL OR vo.id < ${input.cursor ?? null}::uuid)
        ORDER BY vo.dictado_en DESC, vo.id DESC
        LIMIT ${input.limit}
      `;

      const nextCursor = rows.length === input.limit ? rows[rows.length - 1]!.id : null;
      return { items: rows, nextCursor };
    });
  }),
});
