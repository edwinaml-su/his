/**
 * Router tRPC — ECE Epicrisis de Egreso.
 *
 * Documento NTEC: §3.15 Epicrisis / Resumen de Egreso Hospitalario.
 * Norma: MINSAL Acuerdo n.° 1616 (2024), Arts. 17, 21, 40.
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (tres firmas progresivas — Art. 40 NTEC)
 * ---------------------------------------------------------------------------
 *   borrador    → firmado      (MC / PHYSICIAN: firma inicial con hash SHA-256)
 *   firmado     → validado     (ESP: especialista revisa y valida)
 *   validado    → certificado  (DIR: director médico certifica formalmente)
 *   cualquiera  → anulado      (DIR: solo antes del estado certificado)
 *
 *   INMUTABILIDAD: trg_bloquea_epicrisis bloquea UPDATE/DELETE cuando
 *   estado_workflow IN ('firmado','certificado','anulado').
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (emitDomainEvent dentro de Prisma.$transaction)
 * ---------------------------------------------------------------------------
 *   'ece.epicrisis.certificada'  — emitido por certificar().
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   list, get           → requireRole(["PHYSICIAN","MC","ESP","DIR","NURSE"])
 *   create, update      → requireRole(["MC","PHYSICIAN"])
 *   firmar              → requireRole(["MC","PHYSICIAN"])
 *   validar             → requireRole(["ESP"])
 *   certificar          → requireRole(["DIR"])
 *   anular              → requireRole(["DIR"])
 */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, requireRole } from "../../trpc";
import { emitDomainEvent } from "@his/database";
import { applyWorkflowContext } from "../../workflow/context";

// ---------------------------------------------------------------------------
// Schemas locales
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

// US.F2.7.34 — Asignación obligatoria de CIE-10 al cierre de episodio (NTEC Art. 17).
const eceEpicrisisCie10Schema = z.object({
  id: z.string().uuid(),
  cie10Principal: cie10CodeSchema,
  cie10Secundarios: z.array(cie10CodeSchema).max(4).default([]),
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
  resumen_ingreso: string | null;
  evolucion_hospitalaria: string | null;
  tratamiento_egreso: string | null;
  indicaciones_egreso: string | null;
  notas: string | null;
  medico_tratante_id: string;
  visto_jefe_servicio_id: string | null;
  estado_workflow: string;
  cie10_principal: string | null;
  cie10_secundarios: string[] | null;
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
// Helper: extraer contexto ECE del ctx de tRPC.
// Solo valida que exista establishmentId — la demotion de rol la hace
// applyWorkflowContext() dentro de la transacción (A-04).
// ---------------------------------------------------------------------------

function extractEceCtx(ctx: {
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
   * Lista epicrisis del establecimiento activo (A-06: filtro por establecimiento).
   */
  list: eceBase.input(eceEpicrisisListSchema).query(async ({ ctx, input }) => {
    const eceCtx = extractEceCtx(ctx);

    const episodioFilter = input.episodioId ?? null;
    const estadoFilter = input.estado ?? null;
    const offset = (input.page - 1) * input.pageSize;
    const establecimientoId = eceCtx.establecimientoId;

    // A-06: filtrar por establecimiento_id vía JOIN con episodio_atencion.
    const rows = await ctx.prisma.$queryRaw<EpicrisisRow[]>`
      SELECT ee.*
      FROM ece.epicrisis_egreso ee
      JOIN ece.episodio_atencion ea ON ea.id = ee.episodio_id
      WHERE ea.establecimiento_id = ${establecimientoId}::uuid
        AND (${episodioFilter}::uuid IS NULL OR ee.episodio_id = ${episodioFilter}::uuid)
        AND (${estadoFilter}::text IS NULL OR ee.estado_workflow = ${estadoFilter}::text)
      ORDER BY ee.registrado_en DESC
      LIMIT ${input.pageSize} OFFSET ${offset}
    `;

    const [{ total }] = await ctx.prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COUNT(*) AS total
      FROM ece.epicrisis_egreso ee
      JOIN ece.episodio_atencion ea ON ea.id = ee.episodio_id
      WHERE ea.establecimiento_id = ${establecimientoId}::uuid
        AND (${episodioFilter}::uuid IS NULL OR ee.episodio_id = ${episodioFilter}::uuid)
        AND (${estadoFilter}::text IS NULL OR ee.estado_workflow = ${estadoFilter}::text)
    `;

    return {
      items: rows,
      total: Number(total),
      page: input.page,
      pageSize: input.pageSize,
    };
  }),

  /**
   * Lectura individual — A-06: verifica pertenencia al establecimiento.
   */
  get: eceBase.input(eceEpicrisisGetSchema).query(async ({ ctx, input }) => {
    const eceCtx = extractEceCtx(ctx);
    const establecimientoId = eceCtx.establecimientoId;

    const rows = await ctx.prisma.$queryRaw<EpicrisisRow[]>`
      SELECT ee.*
      FROM ece.epicrisis_egreso ee
      JOIN ece.episodio_atencion ea ON ea.id = ee.episodio_id
      WHERE ee.id = ${input.id}::uuid
        AND ea.establecimiento_id = ${establecimientoId}::uuid
      LIMIT 1
    `;

    if (rows.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Epicrisis no encontrada." });
    }
    return rows[0]!;
  }),

  /**
   * Crea una epicrisis en estado `borrador`.
   * A-04: usa withWorkflowContext (transacción + demote rol) para escritura.
   */
  create: requireRole(["MC", "PHYSICIAN"]).input(eceEpicrisisCreateSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = extractEceCtx(ctx);

    return ctx.prisma.$transaction(async (tx) => {
      // A-04: demote rol para que RLS aplique en la transacción.
      await applyWorkflowContext(tx as Parameters<typeof applyWorkflowContext>[0], {
        personalId: eceCtx.personalId,
        establecimientoId: eceCtx.establecimientoId,
      });

      // Verificar 1:1 con episodio.
      const existing = await tx.$queryRaw<[{ id: string }?]>`
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
      const personalRows = await tx.$queryRaw<[{ id: string }?]>`
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

      const rows = await tx.$queryRaw<[{ id: string }]>`
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
    });
  }),

  /**
   * Firma la epicrisis (MC). Transición borrador → firmado.
   * A-04: withWorkflowContext en transacción.
   * A-01: hard-stop CIE-10 obligatorio (Art. 17 NTEC).
   */
  firmar: requireRole(["MC", "PHYSICIAN"]).input(eceEpicrisisFirmarSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = extractEceCtx(ctx);

    return ctx.prisma.$transaction(async (tx) => {
      await applyWorkflowContext(tx as Parameters<typeof applyWorkflowContext>[0], {
        personalId: eceCtx.personalId,
        establecimientoId: eceCtx.establecimientoId,
      });

      const rows = await tx.$queryRaw<EpicrisisRow[]>`
        SELECT ee.*
        FROM ece.epicrisis_egreso ee
        JOIN ece.episodio_atencion ea ON ea.id = ee.episodio_id
        WHERE ee.id = ${input.id}::uuid
          AND ea.establecimiento_id = ${eceCtx.establecimientoId}::uuid
        LIMIT 1
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

      // US.F2.7.34 — Hard-stop Art. 17 NTEC: CIE-10 principal obligatorio.
      if (!epicrisis.cie10_principal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Debe asignar el diagnóstico CIE-10 principal antes de firmar la epicrisis (Art. 17 NTEC).",
        });
      }

      await tx.$executeRaw`
        UPDATE ece.epicrisis_egreso
        SET estado_workflow = 'firmado',
            firma_mc_id    = ${input.firmaId}::uuid,
            firmado_en     = now()
        WHERE id = ${input.id}::uuid
          AND estado_workflow = 'borrador'
      `;

      return { ok: true as const, estado: "firmado" };
    });
  }),

  /**
   * Valida la epicrisis (ESP). Transición firmado → validado.
   * A-04: withWorkflowContext en transacción.
   */
  validar: requireRole(["ESP"]).input(eceEpicrisisValidarSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = extractEceCtx(ctx);

    return ctx.prisma.$transaction(async (tx) => {
      await applyWorkflowContext(tx as Parameters<typeof applyWorkflowContext>[0], {
        personalId: eceCtx.personalId,
        establecimientoId: eceCtx.establecimientoId,
      });

      const rows = await tx.$queryRaw<EpicrisisRow[]>`
        SELECT ee.*
        FROM ece.epicrisis_egreso ee
        JOIN ece.episodio_atencion ea ON ea.id = ee.episodio_id
        WHERE ee.id = ${input.id}::uuid
          AND ea.establecimiento_id = ${eceCtx.establecimientoId}::uuid
        LIMIT 1
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

      const personalRows = await tx.$queryRaw<[{ id: string }?]>`
        SELECT id::text FROM ece.personal_salud
        WHERE his_user_id = ${eceCtx.personalId}::uuid AND activo = true LIMIT 1
      `;
      const jefeId = personalRows[0]?.id ?? eceCtx.personalId;
      const observacion = input.observacion ?? null;
      void observacion; // reservado para bitácora futura

      await tx.$executeRaw`
        UPDATE ece.epicrisis_egreso
        SET estado_workflow        = 'validado',
            visto_jefe_servicio_id = ${jefeId}::uuid,
            validado_en            = now()
        WHERE id = ${input.id}::uuid
          AND estado_workflow = 'firmado'
      `;

      return { ok: true as const, estado: "validado" };
    });
  }),

  /**
   * Certifica la epicrisis (DIR). Transición validado → certificado.
   * A-03: mutación efectivamente llamada desde UI (fix en page.tsx).
   * A-04: withWorkflowContext en transacción.
   */
  certificar: requireRole(["DIR"]).input(eceEpicrisisCertificarSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = extractEceCtx(ctx);

    return ctx.prisma.$transaction(async (tx) => {
      await applyWorkflowContext(tx as Parameters<typeof applyWorkflowContext>[0], {
        personalId: eceCtx.personalId,
        establecimientoId: eceCtx.establecimientoId,
      });

      const rows = await tx.$queryRaw<EpicrisisRow[]>`
        SELECT ee.*
        FROM ece.epicrisis_egreso ee
        JOIN ece.episodio_atencion ea ON ea.id = ee.episodio_id
        WHERE ee.id = ${input.id}::uuid
          AND ea.establecimiento_id = ${eceCtx.establecimientoId}::uuid
        LIMIT 1
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
            firma_dir_id   = ${input.firmaId}::uuid,
            certificado_en = now()
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
   * Asigna/actualiza CIE-10 (MC/PHYSICIAN). Solo en estado borrador.
   * A-01: columnas cie10_principal / cie10_secundarios ya existen en BD.
   * A-04: withWorkflowContext en transacción.
   */
  setCie10: requireRole(["MC", "PHYSICIAN"]).input(eceEpicrisisCie10Schema).mutation(async ({ ctx, input }) => {
    const eceCtx = extractEceCtx(ctx);

    return ctx.prisma.$transaction(async (tx) => {
      await applyWorkflowContext(tx as Parameters<typeof applyWorkflowContext>[0], {
        personalId: eceCtx.personalId,
        establecimientoId: eceCtx.establecimientoId,
      });

      const rows = await tx.$queryRaw<[{ estado_workflow: string }?]>`
        SELECT ee.estado_workflow
        FROM ece.epicrisis_egreso ee
        JOIN ece.episodio_atencion ea ON ea.id = ee.episodio_id
        WHERE ee.id = ${input.id}::uuid
          AND ea.establecimiento_id = ${eceCtx.establecimientoId}::uuid
        LIMIT 1
      `;
      const epicrisis = rows[0];

      if (!epicrisis) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Epicrisis no encontrada." });
      }
      if (epicrisis.estado_workflow !== "borrador") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Los diagnósticos CIE-10 solo pueden modificarse en estado borrador.",
        });
      }

      // Verificar código principal en catálogo activo.
      const catalogCheck = await tx.$queryRaw<[{ codigo: string }?]>`
        SELECT "codigo" FROM public."Icd10Catalog"
        WHERE "codigo" = ${input.cie10Principal} AND "activo" = true
        LIMIT 1
      `;
      if (!catalogCheck[0]) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Código CIE-10 principal "${input.cie10Principal}" no encontrado en el catálogo.`,
        });
      }

      await tx.$executeRaw`
        UPDATE ece.epicrisis_egreso
        SET cie10_principal    = ${input.cie10Principal},
            cie10_secundarios  = ${input.cie10Secundarios}::varchar[]
        WHERE id = ${input.id}::uuid
          AND estado_workflow = 'borrador'
      `;

      return { ok: true as const };
    });
  }),

  /**
   * Anula la epicrisis (DIR). Solo si NO está certificada.
   * A-04: withWorkflowContext en transacción.
   */
  anular: requireRole(["DIR"]).input(eceEpicrisisAnularSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = extractEceCtx(ctx);

    return ctx.prisma.$transaction(async (tx) => {
      await applyWorkflowContext(tx as Parameters<typeof applyWorkflowContext>[0], {
        personalId: eceCtx.personalId,
        establecimientoId: eceCtx.establecimientoId,
      });

      const rows = await tx.$queryRaw<[{ estado_workflow: string }?]>`
        SELECT ee.estado_workflow
        FROM ece.epicrisis_egreso ee
        JOIN ece.episodio_atencion ea ON ea.id = ee.episodio_id
        WHERE ee.id = ${input.id}::uuid
          AND ea.establecimiento_id = ${eceCtx.establecimientoId}::uuid
        LIMIT 1
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

      await tx.$executeRaw`
        UPDATE ece.epicrisis_egreso
        SET estado_workflow  = 'anulado',
            motivo_anulacion = ${input.motivoAnulacion},
            anulado_en       = now()
        WHERE id = ${input.id}::uuid
      `;

      return { ok: true as const, estado: "anulado" };
    });
  }),
});
