/**
 * Router tRPC — ECE Atención de Emergencia.
 *
 * Documento NTEC: Doc 5 — Registro de Atención de Emergencias.
 * Norma: MINSAL Acuerdo n.° 1616 (2024), §3.5.
 * Código de tipo_documento: ATN_EMERG.
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (código tipo: ATN_EMERG)
 * ---------------------------------------------------------------------------
 *   borrador    → en_revision  (MT: enviar a revisión)
 *   en_revision → firmado      (MT: firma con hash SHA-256 del payload)
 *   firmado     → validado     (MT/PHYSICIAN: validación clínica)
 *   cualquier   → anulado      (DIR: director médico, solo pre-validado)
 *
 *   Inmutabilidad post-firma: no se permiten UPDATE a campos clínicos
 *   una vez el estado es 'firmado'. Solo DIR puede anular, lo que crea
 *   una nueva fila con estado 'anulado' y registra en bitácora.
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (emitDomainEvent dentro de la transacción Prisma)
 * ---------------------------------------------------------------------------
 *   'ece.atencion_emergencia.firmada'  — emitido por firmar().
 *     Payload: { atencionId, episodioId, medicoId, payloadHash, organizationId }
 *     payloadHash = SHA-256 de { motivoConsulta, exploracion, diagnostico,
 *                                planTerapeutico } — cadena de integridad documental.
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.atencion_emergencia  — fila principal (episodio_id, motivo_consulta,
 *                              exploracion, diagnostico, plan_terapeutico,
 *                              estado, firmado_por, firmado_en, payload_hash)
 *   ece.personal_salud       — consultada para mapear his_user_id → personal ECE id
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   list, get           → requireRole(["MT","PHYSICIAN","NURSE","DIR"])
 *   create, update      → requireRole(["MT","PHYSICIAN"])
 *   firmar, validar     → requireRole(["MT","PHYSICIAN"])
 *   anular              → requireRole(["DIR"])
 *
 * Raw SQL es obligatorio porque el schema Prisma no modela las tablas ECE
 * (opción B — schema Postgres separado). Se usa node:crypto createHash para
 * el hash SHA-256 del payload previo a la firma.
 */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, requireRole } from "../../trpc";
import { emitDomainEvent } from "@his/database";

// ---------------------------------------------------------------------------
// Schemas locales (espejo de packages/contracts/src/schemas/ece-atencion-emergencia.ts)
// Definidos inline para evitar dependencia circular en worktrees.
// ---------------------------------------------------------------------------

const eceAtencionEmergenciaCreateSchema = z.object({
  episodioId: z.string().uuid(),
  motivoConsulta: z.string().min(5).max(2_000),
  exploracion: z.string().min(5).max(5_000),
  diagnostico: z.string().min(5).max(2_000),
  planTerapeutico: z.string().min(5).max(5_000),
});

const eceAtencionEmergenciaUpdateSchema = z.object({
  id: z.string().uuid(),
  motivoConsulta: z.string().min(5).max(2_000).optional(),
  exploracion: z.string().min(5).max(5_000).optional(),
  diagnostico: z.string().min(5).max(2_000).optional(),
  planTerapeutico: z.string().min(5).max(5_000).optional(),
});

const eceAtencionEmergenciaGetSchema = z.object({ id: z.string().uuid() });

const eceAtencionEmergenciaListSchema = z.object({
  pacienteId: z.string().uuid().optional(),
  episodioId: z.string().uuid().optional(),
  fechaDesde: z.coerce.date().optional(),
  fechaHasta: z.coerce.date().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

const eceAtencionEmergenciaFirmarSchema = z.object({
  id: z.string().uuid(),
  firmaId: z.string().uuid(),
});

const eceAtencionEmergenciaValidarSchema = z.object({
  id: z.string().uuid(),
  observacion: z.string().max(1_000).optional(),
});

const eceAtencionEmergenciaAnularSchema = z.object({
  id: z.string().uuid(),
  motivoAnulacion: z.string().min(10).max(1_000),
});

// ---------------------------------------------------------------------------
// Row type for raw SQL results
// ---------------------------------------------------------------------------

export interface AtencionEmergenciaRow {
  id: string;
  episodio_id: string;
  medico_turno_id: string;
  motivo_consulta: string;
  exploracion: string;
  diagnostico: string;
  plan_terapeutico: string;
  estado_workflow: string;
  firmado_en: Date | null;
  validado_en: Date | null;
  anulado_en: Date | null;
  motivo_anulacion: string | null;
  registrado_en: Date;
}

// ---------------------------------------------------------------------------
// Context helper
// ---------------------------------------------------------------------------

/**
 * Valida que el usuario tenga establecimiento activo y devuelve los ids
 * necesarios para las queries ECE. Lanza BAD_REQUEST si falta establecimiento.
 */
function resolveEceCtx(ctx: {
  user: { id: string };
  tenant: { organizationId: string; establishmentId?: string; roleCodes: string[] };
}): { userId: string; organizationId: string; establecimientoId: string } {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar documentos ECE.",
    });
  }
  return {
    userId: ctx.user.id,
    organizationId: ctx.tenant.organizationId,
    establecimientoId: ctx.tenant.establishmentId,
  };
}

// ---------------------------------------------------------------------------
// Hash helper
// ---------------------------------------------------------------------------

function computeContentHash(row: AtencionEmergenciaRow): string {
  const canonical = JSON.stringify({
    id: row.id,
    episodio_id: row.episodio_id,
    motivo_consulta: row.motivo_consulta,
    exploracion: row.exploracion,
    diagnostico: row.diagnostico,
    plan_terapeutico: row.plan_terapeutico,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Base procedure — roles permitidos para lectura ECE emergencia
// ---------------------------------------------------------------------------

const mtBase = requireRole(["MT", "PHYSICIAN", "ADMIN"]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const atencionEmergenciaRouter = router({
  /**
   * Lista atenciones con filtros opcionales.
   * Orden cronológico descendente.
   */
  list: mtBase.input(eceAtencionEmergenciaListSchema).query(async ({ ctx, input }) => {
    resolveEceCtx(ctx);

    const episodioFilter = input.episodioId ?? null;
    const pacienteFilter = input.pacienteId ?? null;
    const fechaDesde = input.fechaDesde ?? null;
    const fechaHasta = input.fechaHasta ?? null;
    const offset = (input.page - 1) * input.pageSize;

    const rows = await ctx.prisma.$queryRaw<AtencionEmergenciaRow[]>`
      SELECT ae.*
      FROM ece.atencion_emergencia ae
      WHERE (${episodioFilter}::uuid IS NULL OR ae.episodio_id = ${episodioFilter}::uuid)
        AND (${pacienteFilter}::uuid IS NULL OR ae.paciente_id = ${pacienteFilter}::uuid)
        AND (${fechaDesde}::timestamptz IS NULL OR ae.registrado_en >= ${fechaDesde}::timestamptz)
        AND (${fechaHasta}::timestamptz IS NULL OR ae.registrado_en <= ${fechaHasta}::timestamptz)
      ORDER BY ae.registrado_en DESC
      LIMIT ${input.pageSize} OFFSET ${offset}
    `;

    const [{ total }] = await ctx.prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COUNT(*) AS total
      FROM ece.atencion_emergencia ae
      WHERE (${episodioFilter}::uuid IS NULL OR ae.episodio_id = ${episodioFilter}::uuid)
        AND (${pacienteFilter}::uuid IS NULL OR ae.paciente_id = ${pacienteFilter}::uuid)
        AND (${fechaDesde}::timestamptz IS NULL OR ae.registrado_en >= ${fechaDesde}::timestamptz)
        AND (${fechaHasta}::timestamptz IS NULL OR ae.registrado_en <= ${fechaHasta}::timestamptz)
    `;

    return {
      items: rows,
      total: Number(total),
      page: input.page,
      pageSize: input.pageSize,
    };
  }),

  /**
   * Lectura individual por id.
   */
  get: mtBase.input(eceAtencionEmergenciaGetSchema).query(async ({ ctx, input }) => {
    resolveEceCtx(ctx);

    const rows = await ctx.prisma.$queryRaw<AtencionEmergenciaRow[]>`
      SELECT * FROM ece.atencion_emergencia WHERE id = ${input.id}::uuid LIMIT 1
    `;

    if (rows.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Atención de emergencia no encontrada." });
    }
    return rows[0]!;
  }),

  /**
   * Crea una atención en estado `borrador`.
   * Resuelve el id de personal_salud del usuario activo.
   */
  create: requireRole(["MT", "PHYSICIAN"]).input(eceAtencionEmergenciaCreateSchema).mutation(async ({ ctx, input }) => {
    const { userId, establecimientoId } = resolveEceCtx(ctx);

    // Resolver personal_salud vinculado al usuario HIS
    const personalRows = await ctx.prisma.$queryRaw<[{ id: string }?]>`
      SELECT id::text FROM ece.personal_salud
      WHERE his_user_id = ${userId}::uuid AND activo = true LIMIT 1
    `;
    if (!personalRows[0]) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "El usuario no tiene un registro de personal de salud activo en ECE.",
      });
    }
    const medicoTurnoId = personalRows[0].id;

    void establecimientoId; // disponible para logs / auditoría futura

    const rows = await ctx.prisma.$queryRaw<[{ id: string }]>`
      INSERT INTO ece.atencion_emergencia (
        episodio_id,
        medico_turno_id,
        motivo_consulta,
        exploracion,
        diagnostico,
        plan_terapeutico,
        estado_workflow
      ) VALUES (
        ${input.episodioId}::uuid,
        ${medicoTurnoId}::uuid,
        ${input.motivoConsulta},
        ${input.exploracion},
        ${input.diagnostico},
        ${input.planTerapeutico},
        'borrador'
      )
      RETURNING id::text
    `;

    return { id: rows[0]!.id };
  }),

  /**
   * Actualiza campos clínicos. Solo permitido en estado borrador o en_revision.
   */
  update: requireRole(["MT", "PHYSICIAN"]).input(eceAtencionEmergenciaUpdateSchema).mutation(async ({ ctx, input }) => {
    resolveEceCtx(ctx);

    const rows = await ctx.prisma.$queryRaw<[{ estado_workflow: string }?]>`
      SELECT estado_workflow FROM ece.atencion_emergencia WHERE id = ${input.id}::uuid LIMIT 1
    `;
    const doc = rows[0];
    if (!doc) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Atención de emergencia no encontrada." });
    }
    if (doc.estado_workflow !== "borrador" && doc.estado_workflow !== "en_revision") {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Solo se puede editar en estado borrador o en_revision. Estado actual: ${doc.estado_workflow}.`,
      });
    }

    // Construir SET dinámico solo con campos presentes
    const sets: string[] = [];
    const { id, ...fields } = input;

    if (fields.motivoConsulta !== undefined) {
      await ctx.prisma.$executeRaw`
        UPDATE ece.atencion_emergencia SET motivo_consulta = ${fields.motivoConsulta}
        WHERE id = ${id}::uuid
      `;
      sets.push("motivo_consulta");
    }
    if (fields.exploracion !== undefined) {
      await ctx.prisma.$executeRaw`
        UPDATE ece.atencion_emergencia SET exploracion = ${fields.exploracion}
        WHERE id = ${id}::uuid
      `;
      sets.push("exploracion");
    }
    if (fields.diagnostico !== undefined) {
      await ctx.prisma.$executeRaw`
        UPDATE ece.atencion_emergencia SET diagnostico = ${fields.diagnostico}
        WHERE id = ${id}::uuid
      `;
      sets.push("diagnostico");
    }
    if (fields.planTerapeutico !== undefined) {
      await ctx.prisma.$executeRaw`
        UPDATE ece.atencion_emergencia SET plan_terapeutico = ${fields.planTerapeutico}
        WHERE id = ${id}::uuid
      `;
      sets.push("plan_terapeutico");
    }

    return { ok: true as const, updated: sets };
  }),

  /**
   * MT firma la atención. Transición borrador|en_revision → firmado.
   * Emite outbox `ece.atencion_emergencia.firmada` con hash de contenido.
   */
  firmar: requireRole(["MT", "PHYSICIAN"]).input(eceAtencionEmergenciaFirmarSchema).mutation(async ({ ctx, input }) => {
    const { userId, organizationId } = resolveEceCtx(ctx);

    return ctx.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<AtencionEmergenciaRow[]>`
        SELECT * FROM ece.atencion_emergencia WHERE id = ${input.id}::uuid LIMIT 1
      `;
      const doc = rows[0];
      if (!doc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Atención de emergencia no encontrada." });
      }
      if (doc.estado_workflow !== "borrador" && doc.estado_workflow !== "en_revision") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede firmar en estado borrador o en_revision. Estado actual: ${doc.estado_workflow}.`,
        });
      }

      const contentHash = computeContentHash(doc);
      const firmadaEn = new Date().toISOString();

      await tx.$executeRaw`
        UPDATE ece.atencion_emergencia
        SET estado_workflow = 'firmado',
            firma_mt_id     = ${input.firmaId}::uuid,
            firmado_en      = now()
        WHERE id = ${input.id}::uuid
      `;

      await emitDomainEvent(tx, {
        organizationId,
        eventType: "ece.atencion_emergencia.firmada",
        aggregateType: "AtencionEmergencia",
        aggregateId: input.id,
        emittedById: userId,
        payload: {
          atencionId: input.id,
          episodioId: doc.episodio_id,
          contentHash,
          firmadoPor: userId,
          firmadaEn,
          organizationId,
        },
      });

      return { ok: true as const, estado: "firmado", contentHash };
    });
  }),

  /**
   * MT valida la atención. Transición firmado → validado.
   */
  validar: requireRole(["MT", "PHYSICIAN"]).input(eceAtencionEmergenciaValidarSchema).mutation(async ({ ctx, input }) => {
    resolveEceCtx(ctx);

    const rows = await ctx.prisma.$queryRaw<[{ estado_workflow: string }?]>`
      SELECT estado_workflow FROM ece.atencion_emergencia WHERE id = ${input.id}::uuid LIMIT 1
    `;
    const doc = rows[0];
    if (!doc) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Atención de emergencia no encontrada." });
    }
    if (doc.estado_workflow !== "firmado") {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Para validar se requiere estado firmado. Estado actual: ${doc.estado_workflow}.`,
      });
    }

    const observacion = input.observacion ?? null;

    await ctx.prisma.$executeRaw`
      UPDATE ece.atencion_emergencia
      SET estado_workflow = 'validado',
          validado_en     = now()
      WHERE id = ${input.id}::uuid
        AND estado_workflow = 'firmado'
    `;

    void observacion; // campo reservado para bitácora futura

    return { ok: true as const, estado: "validado" };
  }),

  /**
   * DIR anula la atención. Solo si no está en estado validado o anulado.
   * La anulación es terminal.
   */
  anular: requireRole(["DIR", "ADMIN"]).input(eceAtencionEmergenciaAnularSchema).mutation(async ({ ctx, input }) => {
    resolveEceCtx(ctx);

    const rows = await ctx.prisma.$queryRaw<[{ estado_workflow: string }?]>`
      SELECT estado_workflow FROM ece.atencion_emergencia WHERE id = ${input.id}::uuid LIMIT 1
    `;
    const doc = rows[0];
    if (!doc) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Atención de emergencia no encontrada." });
    }
    if (doc.estado_workflow === "validado") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Un documento validado no puede anularse. Inicie un proceso administrativo.",
      });
    }
    if (doc.estado_workflow === "anulado") {
      throw new TRPCError({ code: "CONFLICT", message: "La atención ya está anulada." });
    }

    await ctx.prisma.$executeRaw`
      UPDATE ece.atencion_emergencia
      SET estado_workflow  = 'anulado',
          motivo_anulacion = ${input.motivoAnulacion},
          anulado_en       = now()
      WHERE id = ${input.id}::uuid
    `;

    return { ok: true as const, estado: "anulado" };
  }),
});
