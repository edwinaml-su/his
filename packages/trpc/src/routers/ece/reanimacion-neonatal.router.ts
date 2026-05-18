/**
 * Router tRPC — Reanimación Neonatal NRP (AHA/AAP).
 *
 * Tabla física: ece.reanimacion_neonatal (creada en gate F2-S1, SQL 74).
 * FK principal: atencion_rn_id → ece.documentos_obstetricos.id (NOT NULL).
 * Estado: cerrado_en IS NULL = en_curso; IS NOT NULL = cerrado (terminal).
 *
 * Procedimientos: list / get / registrarPaso / cerrar.
 * Roles escritura: MT, NURSE, OB, NEONATOLOGIST, PHYSICIAN.
 * Roles lectura:   + DIR, ADMIN.
 *
 * Raw SQL obligatorio — tablas ECE no están en schema Prisma.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, requireRole } from "../../trpc";

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const listSchema = z.object({
  atencionRnId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});

const getSchema = z.object({ id: z.string().uuid() });

const crearSchema = z.object({
  atencionRnId: z.string().uuid(),
  fcInicial: z.number().int().min(0).max(400).optional(),
  respiracionInicial: z.string().max(200).optional(),
});

const registrarPasoSchema = z.object({
  id: z.string().uuid(),
  // Estimulación táctil
  estimulacionTactilNota: z.string().max(500).optional(),
  // VPP
  vppPresionCmh2o: z.number().int().min(0).max(80).optional(),
  vppFrecuenciaRpm: z.number().int().min(0).max(120).optional(),
  vppFiO2Pct: z.number().int().min(0).max(100).optional(),
  // Intubación
  tuboSizeMm: z.number().min(0).max(5).optional(),
  intubacionNota: z.string().max(500).optional(),
  // MCE
  mceRatio: z.string().max(10).optional(),
  // Adrenalina
  adrenalinaDosisMl: z.number().min(0).max(10).optional(),
  adrenalinaVia: z.string().max(50).optional(),
  adrenalinaConcentracion: z.string().max(50).optional(),
  // Volumen expansor
  volumenExpansorMl: z.number().min(0).max(500).optional(),
  volumenExpansorTipo: z.string().max(100).optional(),
  // FC post
  fcPostIntervencion: z.number().int().min(0).max(400).optional(),
});

const cerrarSchema = z.object({
  id: z.string().uuid(),
  resultado: z.enum(["estable", "cuidados_intermedios", "ucin", "defuncion"]),
  notasCierre: z.string().max(2000).optional(),
  fcPostIntervencion: z.number().int().min(0).max(400).optional(),
});

// ---------------------------------------------------------------------------
// Row type — refleja el schema real de Supabase
// ---------------------------------------------------------------------------

export interface ReanimacionNeonatalRow {
  id: string;
  atencion_rn_id: string;
  apertura_en: Date;
  registrado_por: string;
  valoracion_inicial_en: Date | null;
  fc_inicial: number | null;
  respiracion_inicial: string | null;
  estimulacion_tactil_en: Date | null;
  estimulacion_tactil_nota: string | null;
  vpp_iniciada_en: Date | null;
  vpp_presion_cmh2o: number | null;
  vpp_frecuencia_rpm: number | null;
  vpp_fi_o2_pct: number | null;
  intubacion_en: Date | null;
  tubo_size_mm: string | null;
  intubacion_nota: string | null;
  mce_iniciado_en: Date | null;
  mce_ratio: string | null;
  adrenalina_dosis_ml: string | null;
  adrenalina_via: string | null;
  adrenalina_concentracion: string | null;
  adrenalina_en: Date | null;
  volumen_expansor_ml: string | null;
  volumen_expansor_tipo: string | null;
  volumen_expansor_en: Date | null;
  fc_post_intervencion: number | null;
  fc_post_en: Date | null;
  resultado: string | null;
  cerrado_en: Date | null;
  cerrado_por: string | null;
  notas_cierre: string | null;
  creado_en: Date;
  actualizado_en: Date;
}

// ---------------------------------------------------------------------------
// Helper — requiere establecimiento ECE activo
// ---------------------------------------------------------------------------

function resolveEceCtx(ctx: {
  user: { id: string };
  tenant: { organizationId: string; establishmentId?: string };
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
// Helper — resolver personal_salud del usuario activo
// ---------------------------------------------------------------------------

async function resolvePersonalId(
  prisma: Parameters<typeof router>[0] extends never ? never : { $queryRaw: unknown },
  userId: string,
): Promise<string> {
  const rows = await (
    prisma as { $queryRaw: (tpl: TemplateStringsArray, ...v: unknown[]) => Promise<{ id: string }[]> }
  ).$queryRaw`
    SELECT id::text FROM ece.personal_salud
    WHERE his_user_id = ${userId}::uuid AND activo = true LIMIT 1
  `;
  if (!rows[0]) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "El usuario no tiene un registro de personal de salud activo en ECE.",
    });
  }
  return rows[0].id;
}

// ---------------------------------------------------------------------------
// Procedures base
// ---------------------------------------------------------------------------

const readBase  = requireRole(["MT", "NURSE", "OB", "NEONATOLOGIST", "DIR", "ADMIN", "PHYSICIAN"]);
const writeBase = requireRole(["MT", "NURSE", "OB", "NEONATOLOGIST", "PHYSICIAN"]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const eceReanimacionNeonatalRouter = router({
  /** Lista registros NRP, filtrables por atencion_rn_id. Orden apertura DESC. */
  list: readBase.input(listSchema).query(async ({ ctx, input }) => {
    resolveEceCtx(ctx);

    const atencionFilter = input.atencionRnId ?? null;
    const offset = (input.page - 1) * input.pageSize;

    const rows = await ctx.prisma.$queryRaw<ReanimacionNeonatalRow[]>`
      SELECT *
      FROM ece.reanimacion_neonatal
      WHERE (${atencionFilter}::uuid IS NULL OR atencion_rn_id = ${atencionFilter}::uuid)
      ORDER BY apertura_en DESC
      LIMIT ${input.pageSize} OFFSET ${offset}
    `;

    const [{ total }] = await ctx.prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COUNT(*) AS total
      FROM ece.reanimacion_neonatal
      WHERE (${atencionFilter}::uuid IS NULL OR atencion_rn_id = ${atencionFilter}::uuid)
    `;

    return {
      items: rows,
      total: Number(total),
      page: input.page,
      pageSize: input.pageSize,
    };
  }),

  /** Lectura individual por id. */
  get: readBase.input(getSchema).query(async ({ ctx, input }) => {
    resolveEceCtx(ctx);

    const rows = await ctx.prisma.$queryRaw<ReanimacionNeonatalRow[]>`
      SELECT * FROM ece.reanimacion_neonatal WHERE id = ${input.id}::uuid LIMIT 1
    `;
    if (rows.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Registro NRP no encontrado." });
    }
    return rows[0]!;
  }),

  /**
   * Crea un nuevo registro NRP vinculado a atencion_rn_id.
   * Estado inicial: en_curso (cerrado_en IS NULL).
   */
  crear: writeBase.input(crearSchema).mutation(async ({ ctx, input }) => {
    const { userId } = resolveEceCtx(ctx);
    const personalId = await resolvePersonalId(ctx.prisma as never, userId);

    const fcInicial = input.fcInicial ?? null;
    const respiracionInicial = input.respiracionInicial ?? null;

    const rows = await ctx.prisma.$queryRaw<[{ id: string }]>`
      INSERT INTO ece.reanimacion_neonatal (
        atencion_rn_id,
        registrado_por,
        fc_inicial,
        respiracion_inicial
      ) VALUES (
        ${input.atencionRnId}::uuid,
        ${personalId}::uuid,
        ${fcInicial}::smallint,
        ${respiracionInicial}
      )
      RETURNING id::text
    `;

    return { id: rows[0]!.id };
  }),

  /**
   * Registra uno o más pasos NRP con timestamp now() en primera ejecución.
   * Solo si cerrado_en IS NULL (registro en_curso).
   */
  registrarPaso: writeBase.input(registrarPasoSchema).mutation(async ({ ctx, input }) => {
    resolveEceCtx(ctx);

    const rows = await ctx.prisma.$queryRaw<[{ cerrado_en: Date | null }?]>`
      SELECT cerrado_en FROM ece.reanimacion_neonatal
      WHERE id = ${input.id}::uuid LIMIT 1
    `;
    const rec = rows[0];
    if (!rec) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Registro NRP no encontrado." });
    }
    if (rec.cerrado_en !== null) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Solo se pueden registrar pasos en un registro en_curso (cerrado_en IS NULL).",
      });
    }

    const updated: string[] = [];

    if (input.estimulacionTactilNota !== undefined) {
      await ctx.prisma.$executeRaw`
        UPDATE ece.reanimacion_neonatal
        SET estimulacion_tactil_en = COALESCE(estimulacion_tactil_en, now()),
            estimulacion_tactil_nota = ${input.estimulacionTactilNota},
            actualizado_en = now()
        WHERE id = ${input.id}::uuid
      `;
      updated.push("estimulacion_tactil");
    }

    if (input.vppPresionCmh2o !== undefined || input.vppFrecuenciaRpm !== undefined || input.vppFiO2Pct !== undefined) {
      const presion = input.vppPresionCmh2o ?? null;
      const frecuencia = input.vppFrecuenciaRpm ?? null;
      const fio2 = input.vppFiO2Pct ?? null;
      await ctx.prisma.$executeRaw`
        UPDATE ece.reanimacion_neonatal
        SET vpp_iniciada_en = COALESCE(vpp_iniciada_en, now()),
            vpp_presion_cmh2o = COALESCE(${presion}::smallint, vpp_presion_cmh2o),
            vpp_frecuencia_rpm = COALESCE(${frecuencia}::smallint, vpp_frecuencia_rpm),
            vpp_fi_o2_pct = COALESCE(${fio2}::smallint, vpp_fi_o2_pct),
            actualizado_en = now()
        WHERE id = ${input.id}::uuid
      `;
      updated.push("vpp");
    }

    if (input.tuboSizeMm !== undefined || input.intubacionNota !== undefined) {
      const tubo = input.tuboSizeMm ?? null;
      const nota = input.intubacionNota ?? null;
      await ctx.prisma.$executeRaw`
        UPDATE ece.reanimacion_neonatal
        SET intubacion_en = COALESCE(intubacion_en, now()),
            tubo_size_mm = COALESCE(${tubo}, tubo_size_mm),
            intubacion_nota = COALESCE(${nota}, intubacion_nota),
            actualizado_en = now()
        WHERE id = ${input.id}::uuid
      `;
      updated.push("intubacion");
    }

    if (input.mceRatio !== undefined) {
      await ctx.prisma.$executeRaw`
        UPDATE ece.reanimacion_neonatal
        SET mce_iniciado_en = COALESCE(mce_iniciado_en, now()),
            mce_ratio = ${input.mceRatio},
            actualizado_en = now()
        WHERE id = ${input.id}::uuid
      `;
      updated.push("mce");
    }

    if (input.adrenalinaDosisMl !== undefined) {
      const via = input.adrenalinaVia ?? null;
      const conc = input.adrenalinaConcentracion ?? null;
      await ctx.prisma.$executeRaw`
        UPDATE ece.reanimacion_neonatal
        SET adrenalina_dosis_ml = ${input.adrenalinaDosisMl},
            adrenalina_via = COALESCE(${via}, adrenalina_via),
            adrenalina_concentracion = COALESCE(${conc}, adrenalina_concentracion),
            adrenalina_en = COALESCE(adrenalina_en, now()),
            actualizado_en = now()
        WHERE id = ${input.id}::uuid
      `;
      updated.push("adrenalina");
    }

    if (input.volumenExpansorMl !== undefined) {
      const tipo = input.volumenExpansorTipo ?? null;
      await ctx.prisma.$executeRaw`
        UPDATE ece.reanimacion_neonatal
        SET volumen_expansor_ml = ${input.volumenExpansorMl},
            volumen_expansor_tipo = COALESCE(${tipo}, volumen_expansor_tipo),
            volumen_expansor_en = COALESCE(volumen_expansor_en, now()),
            actualizado_en = now()
        WHERE id = ${input.id}::uuid
      `;
      updated.push("volumen_expansor");
    }

    if (input.fcPostIntervencion !== undefined) {
      await ctx.prisma.$executeRaw`
        UPDATE ece.reanimacion_neonatal
        SET fc_post_intervencion = ${input.fcPostIntervencion},
            fc_post_en = COALESCE(fc_post_en, now()),
            actualizado_en = now()
        WHERE id = ${input.id}::uuid
      `;
      updated.push("fc_post");
    }

    return { ok: true as const, updated };
  }),

  /**
   * Cierra el registro NRP. Requiere resultado clínico.
   * Transición terminal: setea cerrado_en = now().
   */
  cerrar: writeBase.input(cerrarSchema).mutation(async ({ ctx, input }) => {
    const { userId } = resolveEceCtx(ctx);
    const personalId = await resolvePersonalId(ctx.prisma as never, userId);

    const rows = await ctx.prisma.$queryRaw<[{ cerrado_en: Date | null }?]>`
      SELECT cerrado_en FROM ece.reanimacion_neonatal
      WHERE id = ${input.id}::uuid LIMIT 1
    `;
    const rec = rows[0];
    if (!rec) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Registro NRP no encontrado." });
    }
    if (rec.cerrado_en !== null) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "El registro NRP ya está cerrado.",
      });
    }

    const notas = input.notasCierre ?? null;
    const fcPost = input.fcPostIntervencion ?? null;

    await ctx.prisma.$executeRaw`
      UPDATE ece.reanimacion_neonatal
      SET resultado            = ${input.resultado}::ece.resultado_reanimacion,
          cerrado_en           = now(),
          cerrado_por          = ${personalId}::uuid,
          notas_cierre         = ${notas},
          fc_post_intervencion = COALESCE(${fcPost}::smallint, fc_post_intervencion),
          fc_post_en           = CASE
                                   WHEN ${fcPost}::smallint IS NOT NULL AND fc_post_en IS NULL
                                   THEN now()
                                   ELSE fc_post_en
                                 END,
          actualizado_en       = now()
      WHERE id = ${input.id}::uuid
    `;

    return { ok: true as const, resultado: input.resultado };
  }),
});
