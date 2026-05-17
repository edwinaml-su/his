/**
 * Router tRPC — ECE §3.15 Epicrisis de Egreso (NTEC / Art. 40-21).
 *
 * Tabla física: ece.epicrisis_egreso (raw SQL — fuera del schema Prisma).
 * Workflow INMUTABLE post-firma (Art. 40):
 *   borrador → firmado   (MC,  requireRole PHYSICIAN)
 *   firmado  → validado  (ESP, requireRole ESP)
 *   validado → certificado (DIR, requireRole DIR) → emite ece.epicrisis.certificada
 *   cualquier estado → anulado (DIR, solo antes de certificar)
 *
 * Raw SQL es obligatorio porque el schema Prisma no modela las tablas ECE.
 * La inmutabilidad se refuerza con el trigger `trg_epicrisis_inmutable` (SQL 61).
 *
 * Outbox: certificar emite `ece.epicrisis.certificada` con hash + directorId.
 */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, requireRole } from "../../trpc";
import { emitDomainEvent } from "@his/database";

// ---------------------------------------------------------------------------
// Schemas locales (espejo de packages/contracts/src/schemas/ece-epicrisis.ts)
// Definidos inline para evitar dependencia circular en el contexto de test.
// ---------------------------------------------------------------------------

const cie10CodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(10)
  .regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{0,4})?$/, "Formato CIE-10 inválido");

const diagnosticoEgresoItemSchema = z.object({
  cie10: cie10CodeSchema,
  descripcion: z.string().min(1).max(500),
  tipo: z.enum(["principal", "secundario", "comorbilidad"]).default("secundario"),
});

const eceEpicrisisCreateSchema = z.object({
  episodioHospitalarioId: z.string().uuid(),
  fechaEgreso: z.coerce.date(),
  motivoEgreso: z.enum(["alta_voluntaria", "alta_medica", "traslado", "fallecido", "otro"]),
  diagnosticoEgresoCie10: z.array(diagnosticoEgresoItemSchema).min(1, "Se requiere al menos un diagnóstico"),
  resumenIngreso: z.string().min(10).max(10_000),
  evolucionHospitalaria: z.string().min(10).max(10_000),
  tratamientoEgreso: z.string().min(5).max(5_000),
  indicacionesEgreso: z.string().min(5).max(5_000),
  notas: z.string().max(2_000).optional(),
});

const eceEpicrisisGetSchema = z.object({ id: z.string().uuid() });

const eceEpicrisisListSchema = z.object({
  episodioId: z.string().uuid().optional(),
  pacienteId: z.string().uuid().optional(),
  estado: z.enum(["borrador", "firmado", "validado", "certificado", "anulado"]).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});

const eceEpicrisisFirmarSchema = z.object({
  id: z.string().uuid(),
  firmaId: z.string().uuid(),
});

const eceEpicrisisValidarSchema = z.object({
  id: z.string().uuid(),
  observacion: z.string().max(1_000).optional(),
});

const eceEpicrisisCertificarSchema = z.object({
  id: z.string().uuid(),
  firmaId: z.string().uuid(),
});

const eceEpicrisisAnularSchema = z.object({
  id: z.string().uuid(),
  motivoAnulacion: z.string().min(10).max(1_000),
});

// ---------------------------------------------------------------------------
// Tipos de fila raw
// ---------------------------------------------------------------------------

export interface EpicrisisRow {
  id: string;
  instancia_id: string;
  episodio_id: string;
  fecha_hora_egreso: Date;
  tipo_egreso: string;
  circunstancia_alta: string;
  diagnosticos_egreso: unknown;
  resumen_ingreso: string;
  evolucion_hospitalaria: string;
  tratamiento_egreso: string;
  indicaciones_egreso: string;
  notas: string | null;
  medico_tratante_id: string;
  visto_jefe_servicio_id: string | null;
  estado_workflow: string;
  firma_mc_id: string | null;
  firma_esp_id: string | null;
  firma_dir_id: string | null;
  firmado_en: Date | null;
  validado_en: Date | null;
  certificado_en: Date | null;
  anulado_en: Date | null;
  motivo_anulacion: string | null;
  registrado_en: Date;
}

// ---------------------------------------------------------------------------
// Helper withEceContext
// ---------------------------------------------------------------------------

/**
 * Construye el contexto mínimo para operaciones ECE.
 * Lanza BAD_REQUEST si no hay establecimiento activo.
 */
function withEceContext(ctx: {
  user: { id: string };
  tenant: { organizationId: string; establishmentId?: string; roleCodes: string[] };
}): { personalId: string; organizationId: string; establecimientoId: string; roles: string[] } {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar documentos ECE.",
    });
  }
  return {
    personalId: ctx.user.id,
    organizationId: ctx.tenant.organizationId,
    establecimientoId: ctx.tenant.establishmentId,
    roles: ctx.tenant.roleCodes,
  };
}

/** Calcula el hash SHA-256 de los campos clínicos clave de una epicrisis. */
function computeDocumentHash(row: EpicrisisRow): string {
  const canonical = JSON.stringify({
    id: row.id,
    episodio_id: row.episodio_id,
    fecha_hora_egreso: row.fecha_hora_egreso,
    tipo_egreso: row.tipo_egreso,
    diagnosticos_egreso: row.diagnosticos_egreso,
    resumen_ingreso: row.resumen_ingreso,
    evolucion_hospitalaria: row.evolucion_hospitalaria,
    tratamiento_egreso: row.tratamiento_egreso,
    indicaciones_egreso: row.indicaciones_egreso,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Base procedure — roles mínimos de lectura y escritura ECE
// ---------------------------------------------------------------------------

const eceBase = requireRole(["MC", "ESP", "DIR", "PHYSICIAN", "ADMIN"]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const epicrisisRouter = router({
  /**
   * Lista epicrisis filtradas por episodioId (o globales del tenant).
   */
  list: eceBase.input(eceEpicrisisListSchema).query(async ({ ctx, input }) => {
    const eceCtx = withEceContext(ctx);

    // Construye cláusulas WHERE dinámicas de forma segura con interpolación tipada.
    const episodioFilter = input.episodioId ? input.episodioId : null;
    const estadoFilter = input.estado ?? null;
    const offset = (input.page - 1) * input.pageSize;

    const rows = await ctx.prisma.$queryRaw<EpicrisisRow[]>`
      SELECT *
      FROM ece.epicrisis_egreso
      WHERE (${episodioFilter}::uuid IS NULL OR episodio_id = ${episodioFilter}::uuid)
        AND (${estadoFilter}::text IS NULL OR estado_workflow = ${estadoFilter}::text)
      ORDER BY registrado_en DESC
      LIMIT ${input.pageSize} OFFSET ${offset}
    `;

    const [{ total }] = await ctx.prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COUNT(*) AS total
      FROM ece.epicrisis_egreso
      WHERE (${episodioFilter}::uuid IS NULL OR episodio_id = ${episodioFilter}::uuid)
        AND (${estadoFilter}::text IS NULL OR estado_workflow = ${estadoFilter}::text)
    `;

    void eceCtx; // utilizado en withEceContext para validar tenant

    return {
      items: rows,
      total: Number(total),
      page: input.page,
      pageSize: input.pageSize,
    };
  }),

  /**
   * Lectura individual de epicrisis.
   */
  get: eceBase.input(eceEpicrisisGetSchema).query(async ({ ctx, input }) => {
    withEceContext(ctx);

    const rows = await ctx.prisma.$queryRaw<EpicrisisRow[]>`
      SELECT * FROM ece.epicrisis_egreso WHERE id = ${input.id}::uuid LIMIT 1
    `;

    if (rows.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Epicrisis no encontrada." });
    }
    return rows[0]!;
  }),

  /**
   * Crea una epicrisis en estado `borrador`.
   * Solo rol MC/PHYSICIAN puede crear.
   * 1:1 con episodio hospitalario (UNIQUE en episodio_id).
   */
  create: requireRole(["MC", "PHYSICIAN"]).input(eceEpicrisisCreateSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = withEceContext(ctx);

    // Verificar que no exista ya una epicrisis para el episodio (1:1).
    const existing = await ctx.prisma.$queryRaw<[{ id: string }?]>`
      SELECT id::text FROM ece.epicrisis_egreso
      WHERE episodio_id = ${input.episodioHospitalarioId}::uuid
      LIMIT 1
    `;
    if (existing[0]) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Ya existe una epicrisis para este episodio hospitalario.",
      });
    }

    // Resolver personal_salud vinculado al usuario HIS.
    const personalRows = await ctx.prisma.$queryRaw<[{ id: string }?]>`
      SELECT id::text FROM ece.personal_salud
      WHERE his_user_id = ${eceCtx.personalId}::uuid AND activo = true LIMIT 1
    `;
    if (!personalRows[0]) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "El usuario no tiene un registro de personal de salud activo en ECE.",
      });
    }
    const medicoId = personalRows[0].id;

    const tipoEgreso = input.motivoEgreso === "fallecido" ? "fallecido" : "vivo";

    const rows = await ctx.prisma.$queryRaw<[{ id: string }]>`
      INSERT INTO ece.epicrisis_egreso (
        episodio_id,
        fecha_hora_egreso,
        tipo_egreso,
        circunstancia_alta,
        diagnosticos_egreso,
        resumen_ingreso,
        evolucion_hospitalaria,
        tratamiento_egreso,
        indicaciones_egreso,
        notas,
        medico_tratante_id,
        estado_workflow
      ) VALUES (
        ${input.episodioHospitalarioId}::uuid,
        ${input.fechaEgreso}::timestamptz,
        ${tipoEgreso},
        ${input.motivoEgreso},
        ${JSON.stringify(input.diagnosticoEgresoCie10)}::jsonb,
        ${input.resumenIngreso},
        ${input.evolucionHospitalaria},
        ${input.tratamientoEgreso},
        ${input.indicacionesEgreso},
        ${input.notas ?? null},
        ${medicoId}::uuid,
        'borrador'
      )
      RETURNING id::text
    `;

    return { id: rows[0]!.id };
  }),

  /**
   * Firma la epicrisis (MC). Transición borrador → firmado.
   * Post-firma el documento es INMUTABLE (trigger en BD).
   */
  firmar: requireRole(["MC", "PHYSICIAN"]).input(eceEpicrisisFirmarSchema).mutation(async ({ ctx, input }) => {
    withEceContext(ctx);

    const rows = await ctx.prisma.$queryRaw<EpicrisisRow[]>`
      SELECT * FROM ece.epicrisis_egreso WHERE id = ${input.id}::uuid LIMIT 1
    `;
    const epicrisis = rows[0];
    if (!epicrisis) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Epicrisis no encontrada." });
    }
    if (epicrisis.estado_workflow !== "borrador") {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Solo se puede firmar en estado borrador. Estado actual: ${epicrisis.estado_workflow}.`,
      });
    }

    // La transición a 'firmado' hace el documento inmutable (trigger BD lo refuerza).
    await ctx.prisma.$executeRaw`
      UPDATE ece.epicrisis_egreso
      SET estado_workflow = 'firmado',
          firma_mc_id     = ${input.firmaId}::uuid,
          firmado_en      = now()
      WHERE id = ${input.id}::uuid
        AND estado_workflow = 'borrador'
    `;

    return { ok: true as const, estado: "firmado" };
  }),

  /**
   * Valida la epicrisis (ESP — Jefe de Servicio). Transición firmado → validado.
   */
  validar: requireRole(["ESP"]).input(eceEpicrisisValidarSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = withEceContext(ctx);

    const rows = await ctx.prisma.$queryRaw<EpicrisisRow[]>`
      SELECT * FROM ece.epicrisis_egreso WHERE id = ${input.id}::uuid LIMIT 1
    `;
    const epicrisis = rows[0];
    if (!epicrisis) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Epicrisis no encontrada." });
    }
    if (epicrisis.estado_workflow !== "firmado") {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Solo se puede validar en estado firmado. Estado actual: ${epicrisis.estado_workflow}.`,
      });
    }

    const personalRows = await ctx.prisma.$queryRaw<[{ id: string }?]>`
      SELECT id::text FROM ece.personal_salud
      WHERE his_user_id = ${eceCtx.personalId}::uuid AND activo = true LIMIT 1
    `;
    const jefeId = personalRows[0]?.id ?? eceCtx.personalId;

    const observacion = input.observacion ?? null;

    await ctx.prisma.$executeRaw`
      UPDATE ece.epicrisis_egreso
      SET estado_workflow         = 'validado',
          visto_jefe_servicio_id  = ${jefeId}::uuid,
          validado_en             = now()
      WHERE id = ${input.id}::uuid
        AND estado_workflow = 'firmado'
    `;

    void observacion; // campo reservado para bitácora futura

    return { ok: true as const, estado: "validado" };
  }),

  /**
   * Certifica la epicrisis (DIR). Transición validado → certificado.
   * OBLIGATORIO para copias formales (Art. 21 NTEC).
   * Emite outbox `ece.epicrisis.certificada` con hash + directorId.
   */
  certificar: requireRole(["DIR"]).input(eceEpicrisisCertificarSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = withEceContext(ctx);

    return ctx.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<EpicrisisRow[]>`
        SELECT * FROM ece.epicrisis_egreso WHERE id = ${input.id}::uuid LIMIT 1
      `;
      const epicrisis = rows[0];
      if (!epicrisis) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Epicrisis no encontrada." });
      }
      if (epicrisis.estado_workflow !== "validado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Para certificar se requiere estado validado. Estado actual: ${epicrisis.estado_workflow}.`,
        });
      }

      const documentHash = computeDocumentHash(epicrisis);

      await tx.$executeRaw`
        UPDATE ece.epicrisis_egreso
        SET estado_workflow = 'certificado',
            firma_dir_id    = ${input.firmaId}::uuid,
            certificado_en  = now()
        WHERE id = ${input.id}::uuid
          AND estado_workflow = 'validado'
      `;

      await emitDomainEvent(tx, {
        organizationId: eceCtx.organizationId,
        eventType: "ece.epicrisis.certificada",
        aggregateType: "EpicrisisEgreso",
        aggregateId: input.id,
        emittedById: ctx.user.id,
        payload: {
          epicrisisId: input.id,
          episodioId: epicrisis.episodio_id,
          documentHash,
          directorId: ctx.user.id,
          firmaId: input.firmaId,
          organizationId: eceCtx.organizationId,
        },
      });

      return { ok: true as const, estado: "certificado", documentHash };
    });
  }),

  /**
   * Anula la epicrisis (DIR). Solo si NO está certificada.
   * La anulación es terminal — no hay reversión.
   */
  anular: requireRole(["DIR"]).input(eceEpicrisisAnularSchema).mutation(async ({ ctx, input }) => {
    withEceContext(ctx);

    const rows = await ctx.prisma.$queryRaw<EpicrisisRow[]>`
      SELECT estado_workflow FROM ece.epicrisis_egreso WHERE id = ${input.id}::uuid LIMIT 1
    `;
    const epicrisis = rows[0];
    if (!epicrisis) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Epicrisis no encontrada." });
    }
    if (epicrisis.estado_workflow === "certificado") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Un documento certificado no puede anularse. Inicie un proceso administrativo.",
      });
    }
    if (epicrisis.estado_workflow === "anulado") {
      throw new TRPCError({ code: "CONFLICT", message: "La epicrisis ya está anulada." });
    }

    await ctx.prisma.$executeRaw`
      UPDATE ece.epicrisis_egreso
      SET estado_workflow  = 'anulado',
          motivo_anulacion = ${input.motivoAnulacion},
          anulado_en       = now()
      WHERE id = ${input.id}::uuid
    `;

    return { ok: true as const, estado: "anulado" };
  }),
});
