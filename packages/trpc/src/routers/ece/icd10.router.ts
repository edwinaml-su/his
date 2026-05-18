/**
 * Router tRPC — Catálogo CIE-10 y validaciones de combinaciones inválidas.
 *
 * Norma: NTEC Arts. 16-17 (MINSAL Acuerdo n.° 1616, 2024).
 * US.F2.7.33 — Búsqueda en catálogo maestro CIE-10.
 * US.F2.7.35 — Validación de combinaciones inválidas.
 *
 * ─── Tablas BD ────────────────────────────────────────────────────────────────
 *   public."Icd10Catalog"           — catálogo global (no tenant-scoped)
 *   ece.icd10_combinacion_invalida  — reglas de combinaciones inválidas
 *
 * ─── Roles tRPC ───────────────────────────────────────────────────────────────
 *   search       → protectedProcedure  (cualquier autenticado — catálogo global)
 *   getByCode    → protectedProcedure
 *   validate     → protectedProcedure  (valida combinaciones para un paciente)
 *   listCombs    → requireRole(["DIR","ARCH","ADMIN"])
 *   createComb   → requireRole(["DIR","ADMIN"])
 *
 * ─── Nota sobre RLS ───────────────────────────────────────────────────────────
 *   Icd10Catalog es global (no tenant-scoped), por tanto NO requiere
 *   withTenantContext. Las reglas de combinación tampoco son tenant-scoped.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, requireRole, router } from "../../trpc";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const searchInputSchema = z.object({
  q: z.string().trim().min(1, "Ingrese al menos 1 carácter").max(100),
  limit: z.number().int().min(1).max(50).default(10),
  soloActivos: z.boolean().default(true),
});

const getByCodeInputSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(3)
    .max(7)
    .regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{0,4})?$/, "Formato CIE-10 inválido (ej. J06.9)"),
});

const validateInputSchema = z.object({
  codigos: z
    .array(
      z
        .string()
        .trim()
        .min(3)
        .max(7)
        .regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{0,4})?$/, "Formato CIE-10 inválido"),
    )
    .min(1)
    .max(5, "Máximo 5 diagnósticos por episodio"),
  /** Sexo del paciente para validar restricciones sexo-específicas */
  sexoPaciente: z.enum(["masculino", "femenino", "otro", "desconocido"]).optional(),
  /** Edad del paciente en años completos para validar restricciones etarias */
  edadPacienteAnios: z.number().int().min(0).max(150).optional(),
});

const createCombInputSchema = z.object({
  codigoA: z
    .string()
    .trim()
    .min(3)
    .max(7)
    .regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{0,4})?$/),
  codigoB: z
    .string()
    .trim()
    .min(3)
    .max(7)
    .regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{0,4})?$/),
  motivo: z.string().min(5).max(500),
  sexoExcluido: z.enum(["masculino", "femenino"]).optional(),
  edadMinExcluida: z.number().int().min(0).max(150).optional(),
  edadMaxExcluida: z.number().int().min(0).max(150).optional(),
});

// ---------------------------------------------------------------------------
// Tipos raw BD
// ---------------------------------------------------------------------------

interface Icd10Row {
  codigo: string;
  descripcion: string;
  capitulo: string | null;
  grupo: string | null;
  activo: boolean;
}

interface CombinacionRow {
  id: string;
  codigo_a: string;
  codigo_b: string;
  motivo: string;
  sexo_excluido: string | null;
  edad_min_excluida: number | null;
  edad_max_excluida: number | null;
  activo: boolean;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const icd10Router = router({
  /**
   * Búsqueda full-text por código exacto o texto libre.
   * Usa índice GIN trigramas (pg_trgm) sobre descripcion.
   * Resultados ordenados: código exacto primero, luego por relevancia trigrama.
   */
  search: protectedProcedure.input(searchInputSchema).query(async ({ ctx, input }) => {
    const soloActivos = input.soloActivos;
    const q = input.q.toUpperCase();

    // Intento búsqueda por código exacto primero (case-insensitive)
    const exactRows = await ctx.prisma.$queryRaw<Icd10Row[]>`
      SELECT "codigo", "descripcion", "capitulo", "grupo", "activo"
      FROM public."Icd10Catalog"
      WHERE upper("codigo") = ${q}
        AND ("activo" = true OR ${soloActivos} = false)
      LIMIT 1
    `;

    if (exactRows.length > 0) {
      return { items: exactRows, total: exactRows.length };
    }

    // Búsqueda por trigramas en descripcion + prefijo de código
    const rows = await ctx.prisma.$queryRaw<Icd10Row[]>`
      SELECT "codigo", "descripcion", "capitulo", "grupo", "activo",
             similarity("descripcion", ${input.q}) AS _sim
      FROM public."Icd10Catalog"
      WHERE (
        "descripcion" ILIKE ${'%' + input.q + '%'}
        OR upper("codigo") LIKE ${q + '%'}
      )
      AND ("activo" = true OR ${soloActivos} = false)
      ORDER BY _sim DESC, "codigo" ASC
      LIMIT ${input.limit}
    `;

    return { items: rows.map(({ ...r }) => r), total: rows.length };
  }),

  /**
   * Lectura de un código CIE-10 específico.
   * Lanza NOT_FOUND si no existe en el catálogo.
   */
  getByCode: protectedProcedure.input(getByCodeInputSchema).query(async ({ ctx, input }) => {
    const rows = await ctx.prisma.$queryRaw<Icd10Row[]>`
      SELECT "codigo", "descripcion", "capitulo", "grupo", "activo"
      FROM public."Icd10Catalog"
      WHERE "codigo" = ${input.codigo}
      LIMIT 1
    `;

    if (rows.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Código CIE-10 "${input.codigo}" no encontrado en el catálogo.`,
      });
    }

    return rows[0]!;
  }),

  /**
   * Valida un conjunto de códigos CIE-10 para un paciente.
   * Comprueba:
   *   1. Que todos los códigos existen en el catálogo.
   *   2. Que ninguna combinación par viole las reglas de ece.icd10_combinacion_invalida.
   * Retorna lista de advertencias; la decisión de bloquear o no es de la UI.
   */
  validate: protectedProcedure.input(validateInputSchema).query(async ({ ctx, input }) => {
    const warnings: Array<{
      tipo: "CODIGO_NO_ENCONTRADO" | "COMBINACION_INVALIDA" | "RESTRICCION_SEXO" | "RESTRICCION_EDAD";
      mensaje: string;
      codigos: string[];
    }> = [];

    if (input.codigos.length === 0) return { ok: true, warnings };

    // 1. Verificar existencia de cada código en el catálogo
    const placeholders = input.codigos;
    const catalogRows = await ctx.prisma.$queryRaw<Array<{ codigo: string }>>`
      SELECT "codigo"
      FROM public."Icd10Catalog"
      WHERE "codigo" = ANY(${placeholders}::varchar[])
        AND "activo" = true
    `;

    const encontrados = new Set(catalogRows.map((r) => r.codigo));
    for (const cod of input.codigos) {
      if (!encontrados.has(cod)) {
        warnings.push({
          tipo: "CODIGO_NO_ENCONTRADO",
          mensaje: `Código CIE-10 "${cod}" no encontrado en el catálogo.`,
          codigos: [cod],
        });
      }
    }

    // 2. Verificar combinaciones inválidas para cada par
    if (input.codigos.length > 1) {
      const combRows = await ctx.prisma.$queryRaw<CombinacionRow[]>`
        SELECT id::text, codigo_a, codigo_b, motivo, sexo_excluido,
               edad_min_excluida, edad_max_excluida, activo
        FROM ece.icd10_combinacion_invalida
        WHERE activo = true
          AND (
            (codigo_a = ANY(${input.codigos}::varchar[]) AND codigo_b = ANY(${input.codigos}::varchar[]))
          )
      `;

      for (const comb of combRows) {
        // Verificar restricción de sexo
        if (
          comb.sexo_excluido &&
          input.sexoPaciente &&
          input.sexoPaciente === comb.sexo_excluido
        ) {
          warnings.push({
            tipo: "RESTRICCION_SEXO",
            mensaje: `Combinación "${comb.codigo_a}"+"${comb.codigo_b}" no aplica para sexo ${comb.sexo_excluido}. ${comb.motivo}`,
            codigos: [comb.codigo_a, comb.codigo_b],
          });
          continue;
        }

        // Verificar restricción de edad mínima
        if (
          comb.edad_min_excluida !== null &&
          input.edadPacienteAnios !== undefined &&
          input.edadPacienteAnios < comb.edad_min_excluida
        ) {
          warnings.push({
            tipo: "RESTRICCION_EDAD",
            mensaje: `Combinación "${comb.codigo_a}"+"${comb.codigo_b}": ${comb.motivo} (requiere edad ≥ ${comb.edad_min_excluida} años)`,
            codigos: [comb.codigo_a, comb.codigo_b],
          });
          continue;
        }

        // Verificar restricción de edad máxima
        if (
          comb.edad_max_excluida !== null &&
          input.edadPacienteAnios !== undefined &&
          input.edadPacienteAnios > comb.edad_max_excluida
        ) {
          warnings.push({
            tipo: "RESTRICCION_EDAD",
            mensaje: `Combinación "${comb.codigo_a}"+"${comb.codigo_b}": ${comb.motivo} (aplica solo a edad ≤ ${comb.edad_max_excluida} años)`,
            codigos: [comb.codigo_a, comb.codigo_b],
          });
          continue;
        }

        // Si no hay restricción específica de sexo/edad pero la combinación es inválida en general
        if (!comb.sexo_excluido && comb.edad_min_excluida === null && comb.edad_max_excluida === null) {
          warnings.push({
            tipo: "COMBINACION_INVALIDA",
            mensaje: `Combinación potencialmente inválida: "${comb.codigo_a}" + "${comb.codigo_b}". ${comb.motivo}`,
            codigos: [comb.codigo_a, comb.codigo_b],
          });
        }
      }
    }

    return { ok: warnings.length === 0, warnings };
  }),

  /**
   * Lista reglas de combinación inválidas. Solo para roles de administración.
   */
  listCombs: requireRole(["DIR", "ARCH", "ADMIN"]).query(async ({ ctx }) => {
    const rows = await ctx.prisma.$queryRaw<CombinacionRow[]>`
      SELECT id::text, codigo_a, codigo_b, motivo, sexo_excluido,
             edad_min_excluida, edad_max_excluida, activo
      FROM ece.icd10_combinacion_invalida
      ORDER BY activo DESC, codigo_a ASC
    `;
    return rows;
  }),

  /**
   * Crea una nueva regla de combinación inválida.
   */
  createComb: requireRole(["DIR", "ADMIN"])
    .input(createCombInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Verificar que ambos códigos existen en el catálogo
      const checkRows = await ctx.prisma.$queryRaw<Array<{ codigo: string }>>`
        SELECT "codigo" FROM public."Icd10Catalog"
        WHERE "codigo" = ANY(${[input.codigoA, input.codigoB]}::varchar[])
      `;

      const found = new Set(checkRows.map((r) => r.codigo));
      const missing = [input.codigoA, input.codigoB].filter((c) => !found.has(c));
      if (missing.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Códigos no encontrados en catálogo: ${missing.join(", ")}`,
        });
      }

      const sexoExcluido = input.sexoExcluido ?? null;
      const edadMin = input.edadMinExcluida ?? null;
      const edadMax = input.edadMaxExcluida ?? null;

      const rows = await ctx.prisma.$queryRaw<[{ id: string }]>`
        INSERT INTO ece.icd10_combinacion_invalida
          (codigo_a, codigo_b, motivo, sexo_excluido, edad_min_excluida, edad_max_excluida)
        VALUES
          (${input.codigoA}, ${input.codigoB}, ${input.motivo},
           ${sexoExcluido}, ${edadMin}::int, ${edadMax}::int)
        RETURNING id::text
      `;

      return { id: rows[0]!.id };
    }),
});
