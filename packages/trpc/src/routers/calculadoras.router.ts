/**
 * calculadoras — Módulo de Calculadoras y Fórmulas Clínicas (CC-0009 / ECE-CALC-001).
 *
 * Dos caras:
 *   - Vista médico (widget flotante): lee el catálogo publicado filtrado por país
 *     + pantalla, evalúa en vivo y registra cada cálculo en ece.registro_calculo.
 *   - Vista administración (Farmacia Clínica / Calidad): CRUD del catálogo con
 *     versionado inmutable, activación por país/pantalla y gate de casos de prueba
 *     antes de publicar.
 *
 * Ámbitos RLS:
 *   - Catálogo (`ece.calculadora`, `ece.calculadora_version`, `ece.calculadora_caso_prueba`,
 *     `ece.calculadora_pantalla`) = referencia GLOBAL. Lectura por cualquier usuario
 *     autenticado del tenant; escritura solo rol admin (ADMIN/DIR/PHARM).
 *   - `ece.registro_calculo` = TENANT-scoped. Se escribe vía `withTenantContext`
 *     (RLS por organization_id + trigger de auditoría hash-chain).
 *
 * Gobernanza (GOB-1/CA-6): ninguna calculadora se publica sin (a) casos de prueba en
 * verde y (b) validación clínica registrada. Los casos validan el MOTOR, no la
 * corrección clínica de las constantes.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import { calcDefinicionSchema } from "@his/contracts";
import {
  evaluar,
  validateInputIds,
  type CalcDef,
  type CalcDefFormula,
} from "@his/infrastructure/formula";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Gate de roles admin — Farmacia Clínica / Calidad / Administración
// ---------------------------------------------------------------------------

const adminBase = requireRole(["ADMIN", "DIR", "PHARM"]);

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const tipoEnum = z.enum(["formula", "score", "dosis"]);
const estadoEnum = z.enum(["borrador", "publicada", "retirada"]);
const paisEnum = z.enum(["SV", "GT", "HN"]);

const paisesSchema = z
  .object({ SV: z.boolean(), GT: z.boolean(), HN: z.boolean() })
  .partial();

const paginasSchema = z.union([z.literal("*"), z.array(z.string().min(1))]);

const cabeceraInput = z.object({
  codigo: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[A-Z0-9-]+$/, "Código en MAYÚSCULAS: CALC-{AREA}-NNN."),
  nombre: z.string().min(2).max(200),
  tipo: tipoEnum,
  categoria: z.string().min(1).max(80),
  altoRiesgo: z.boolean().optional(),
  sub: z.string().max(200).optional(),
  ref: z.string().optional(),
  paises: paisesSchema.optional(),
  paginas: paginasSchema.optional(),
  definicion: calcDefinicionSchema,
});

const idInput = z.object({ id: z.string().uuid() });

const listInput = z.object({
  q: z.string().max(120).optional(),
  tipo: tipoEnum.optional(),
  estado: estadoEnum.optional(),
  categoria: z.string().max(80).optional(),
});

const widgetInput = z.object({
  pantalla: z.string().max(60).optional(),
  pais: paisEnum.optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertFound<T>(row: T | null | undefined, label: string): T {
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: `${label} no encontrado.` });
  }
  return row;
}

/**
 * Valida la `definicion` contra el contrato Zod + reglas del motor.
 * Lanza BAD_REQUEST con detalle si la forma no corresponde al tipo o si algún
 * id de input colisiona con palabra reservada / función del motor (MOTOR-2/3).
 */
function validarDefinicion(tipo: string, def: unknown): CalcDef {
  const parsed = calcDefinicionSchema.safeParse(def);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Definición inválida: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    });
  }
  const value = parsed.data as CalcDef;

  if (tipo === "score") {
    if (!("items" in value)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Un score requiere `items` en su definición.",
      });
    }
  } else {
    if (!("inputs" in value) || !("expr" in value)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Una fórmula/dosis requiere `inputs` y `expr` en su definición.",
      });
    }
    const errs = validateInputIds(value as CalcDefFormula);
    if (errs.length > 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: errs.join(" ") });
    }
  }
  return value;
}

/** ¿La calculadora es visible en la pantalla dada? `"*"` = todas. */
function pantallaVisible(paginas: unknown, pantalla: string | undefined): boolean {
  if (paginas === "*" || pantalla === undefined) return true;
  return Array.isArray(paginas) && (paginas as string[]).includes(pantalla);
}

/** ¿La calculadora está activa en el país dado? Sin filtro = visible. */
function paisActivo(paises: unknown, pais: string | undefined): boolean {
  if (pais === undefined) return true;
  return Boolean(paises && (paises as Record<string, boolean>)[pais]);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const calculadorasRouter = router({
  // ---- Catálogo de pantallas (10 filas semilla) ----
  pantallas: tenantProcedure.query(async ({ ctx }) => {
    return ctx.prisma.calculadoraPantalla.findMany({
      where: { activo: true },
      orderBy: { orden: "asc" },
    });
  }),

  // ---- Tabla de administración ----
  list: adminBase.input(listInput).query(async ({ ctx, input }) => {
    const where: Prisma.CalculadoraWhereInput = {};
    if (input.tipo) where.tipo = input.tipo;
    if (input.estado) where.estado = input.estado;
    if (input.categoria) where.categoria = input.categoria;
    if (input.q) {
      where.OR = [
        { nombre: { contains: input.q, mode: "insensitive" } },
        { codigo: { contains: input.q, mode: "insensitive" } },
        { sub: { contains: input.q, mode: "insensitive" } },
      ];
    }
    const rows = await ctx.prisma.calculadora.findMany({
      where,
      orderBy: { codigo: "asc" },
      include: {
        versionActual: { select: { version: true } },
        _count: { select: { versiones: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      codigo: r.codigo,
      nombre: r.nombre,
      tipo: r.tipo,
      categoria: r.categoria,
      altoRiesgo: r.altoRiesgo,
      sub: r.sub,
      estado: r.estado,
      paises: r.paises,
      paginas: r.paginas,
      versionActual: r.versionActual?.version ?? null,
      totalVersiones: r._count.versiones,
    }));
  }),

  // ---- Feed del widget: publicadas, filtradas por país + pantalla, CON def ----
  paraWidget: tenantProcedure.input(widgetInput).query(async ({ ctx, input }) => {
    const rows = await ctx.prisma.calculadora.findMany({
      where: { estado: "publicada", versionActualId: { not: null } },
      orderBy: [{ categoria: "asc" }, { nombre: "asc" }],
      include: { versionActual: true },
    });
    return rows
      .filter(
        (r) =>
          paisActivo(r.paises, input.pais) &&
          pantallaVisible(r.paginas, input.pantalla),
      )
      .map((r) => ({
        id: r.id,
        codigo: r.codigo,
        nombre: r.nombre,
        tipo: r.tipo,
        categoria: r.categoria,
        altoRiesgo: r.altoRiesgo,
        sub: r.sub,
        ref: r.ref,
        ver: r.versionActual!.version,
        versionId: r.versionActual!.id,
        def: r.versionActual!.definicion as unknown as CalcDef,
      }));
  }),

  // ---- Detalle completo (header + def de la versión actual) ----
  get: tenantProcedure.input(idInput).query(async ({ ctx, input }) => {
    const row = await ctx.prisma.calculadora.findUnique({
      where: { id: input.id },
      include: { versionActual: true },
    });
    const calc = assertFound(row, "Calculadora");
    return {
      id: calc.id,
      codigo: calc.codigo,
      nombre: calc.nombre,
      tipo: calc.tipo,
      categoria: calc.categoria,
      altoRiesgo: calc.altoRiesgo,
      sub: calc.sub,
      ref: calc.ref,
      estado: calc.estado,
      paises: calc.paises,
      paginas: calc.paginas,
      ver: calc.versionActual?.version ?? null,
      versionId: calc.versionActual?.id ?? null,
      def: (calc.versionActual?.definicion ?? null) as unknown as CalcDef | null,
    };
  }),

  // ---- Historial de versiones ----
  historial: adminBase.input(idInput).query(async ({ ctx, input }) => {
    return ctx.prisma.calculadoraVersion.findMany({
      where: { calculadoraId: input.id },
      orderBy: { version: "desc" },
      select: {
        id: true,
        version: true,
        publicadaEn: true,
        publicadaPor: true,
        inmutable: true,
      },
    });
  }),

  // ---- Casos de prueba de una versión ----
  casos: adminBase
    .input(z.object({ versionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.calculadoraCasoPrueba.findMany({
        where: { versionId: input.versionId },
        orderBy: { id: "asc" },
      });
    }),

  // ---- Crear calculadora + versión 1 (estado borrador) ----
  create: adminBase.input(cabeceraInput).mutation(async ({ ctx, input }) => {
    validarDefinicion(input.tipo, input.definicion);

    try {
      return await ctx.prisma.$transaction(async (tx) => {
        const calc = await tx.calculadora.create({
          data: {
            codigo: input.codigo,
            nombre: input.nombre,
            tipo: input.tipo,
            categoria: input.categoria,
            altoRiesgo: input.altoRiesgo ?? false,
            sub: input.sub,
            ref: input.ref,
            estado: "borrador",
            paises: input.paises ?? {},
            paginas: input.paginas ?? "*",
          },
        });
        const version = await tx.calculadoraVersion.create({
          data: {
            calculadoraId: calc.id,
            version: 1,
            definicion: input.definicion as Prisma.InputJsonValue,
          },
        });
        return { id: calc.id, codigo: calc.codigo, versionId: version.id, version: 1 };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Ya existe una calculadora con código '${input.codigo}'.`,
        });
      }
      throw e;
    }
  }),

  // ---- Nueva versión inmutable (editar = versionar) ----
  nuevaVersion: adminBase
    .input(z.object({ id: z.string().uuid(), definicion: calcDefinicionSchema }))
    .mutation(async ({ ctx, input }) => {
      const calc = assertFound(
        await ctx.prisma.calculadora.findUnique({ where: { id: input.id } }),
        "Calculadora",
      );
      validarDefinicion(calc.tipo, input.definicion);

      const last = await ctx.prisma.calculadoraVersion.findFirst({
        where: { calculadoraId: calc.id },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const nextVersion = (last?.version ?? 0) + 1;

      const version = await ctx.prisma.calculadoraVersion.create({
        data: {
          calculadoraId: calc.id,
          version: nextVersion,
          definicion: input.definicion as Prisma.InputJsonValue,
        },
      });
      return { versionId: version.id, version: nextVersion };
    }),

  // ---- Activación por país (CA-4) ----
  setPaises: adminBase
    .input(z.object({ id: z.string().uuid(), paises: paisesSchema }))
    .mutation(async ({ ctx, input }) => {
      const calc = assertFound(
        await ctx.prisma.calculadora.findUnique({ where: { id: input.id } }),
        "Calculadora",
      );
      const merged = { ...(calc.paises as object), ...input.paises };
      await ctx.prisma.calculadora.update({
        where: { id: input.id },
        data: { paises: merged as Prisma.InputJsonValue },
      });
      return { paises: merged };
    }),

  // ---- Visibilidad por pantalla (CA-4) ----
  setPaginas: adminBase
    .input(z.object({ id: z.string().uuid(), paginas: paginasSchema }))
    .mutation(async ({ ctx, input }) => {
      assertFound(
        await ctx.prisma.calculadora.findUnique({ where: { id: input.id } }),
        "Calculadora",
      );
      await ctx.prisma.calculadora.update({
        where: { id: input.id },
        data: { paginas: input.paginas as Prisma.InputJsonValue },
      });
      return { paginas: input.paginas };
    }),

  // ---- Agregar caso de prueba a una versión ----
  agregarCasoPrueba: adminBase
    .input(
      z.object({
        versionId: z.string().uuid(),
        entradas: z.record(z.union([z.string(), z.number(), z.boolean()])),
        esperado: z.number(),
        tolerancia: z.number().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertFound(
        await ctx.prisma.calculadoraVersion.findUnique({ where: { id: input.versionId } }),
        "Versión",
      );
      const caso = await ctx.prisma.calculadoraCasoPrueba.create({
        data: {
          versionId: input.versionId,
          entradas: input.entradas as Prisma.InputJsonValue,
          esperado: new Prisma.Decimal(input.esperado),
          tolerancia: new Prisma.Decimal(input.tolerancia),
        },
      });
      return { id: caso.id };
    }),

  // ---- Correr los casos de prueba de una versión por el motor (CA-2) ----
  correrCasos: adminBase
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const version = assertFound(
        await ctx.prisma.calculadoraVersion.findUnique({
          where: { id: input.versionId },
          include: { calculadora: { select: { tipo: true } }, casosPrueba: true },
        }),
        "Versión",
      );
      const def = version.definicion as unknown as CalcDef;
      const calc = { tipo: version.calculadora.tipo, def };

      let pasan = 0;
      for (const caso of version.casosPrueba) {
        const { resultado } = evaluar(
          calc,
          caso.entradas as Record<string, string | number | boolean>,
        );
        const ok =
          Number.isFinite(resultado) &&
          Math.abs(resultado - Number(caso.esperado)) <= Number(caso.tolerancia);
        if (ok) pasan++;
        await ctx.prisma.calculadoraCasoPrueba.update({
          where: { id: caso.id },
          data: { resultado: ok ? "pasa" : "falla" },
        });
      }
      const total = version.casosPrueba.length;
      return { total, pasan, fallan: total - pasan };
    }),

  // ---- Publicar: gate casos en verde + validación clínica (CA-2/CA-6) ----
  publicar: adminBase
    .input(
      z.object({
        id: z.string().uuid(),
        versionId: z.string().uuid(),
        // CA-6: la publicación exige validación clínica registrada explícita.
        validacionClinica: z.literal(true, {
          errorMap: () => ({
            message: "Se requiere validación clínica registrada para publicar.",
          }),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const version = assertFound(
        await ctx.prisma.calculadoraVersion.findFirst({
          where: { id: input.versionId, calculadoraId: input.id },
          include: { casosPrueba: true },
        }),
        "Versión",
      );

      if (version.casosPrueba.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No se puede publicar sin casos de prueba.",
        });
      }
      const fallan = version.casosPrueba.filter((c) => c.resultado !== "pasa");
      if (fallan.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${fallan.length} caso(s) de prueba no están en verde. Corré los casos antes de publicar.`,
        });
      }

      await ctx.prisma.$transaction(async (tx) => {
        await tx.calculadoraVersion.update({
          where: { id: version.id },
          data: {
            inmutable: true,
            publicadaEn: new Date(),
            publicadaPor: ctx.tenant.userId,
          },
        });
        await tx.calculadora.update({
          where: { id: input.id },
          data: { estado: "publicada", versionActualId: version.id },
        });
      });
      return { estado: "publicada" as const, versionId: version.id };
    }),

  // ---- Retirar del catálogo ----
  retirar: adminBase.input(idInput).mutation(async ({ ctx, input }) => {
    assertFound(
      await ctx.prisma.calculadora.findUnique({ where: { id: input.id } }),
      "Calculadora",
    );
    await ctx.prisma.calculadora.update({
      where: { id: input.id },
      data: { estado: "retirada" },
    });
    return { estado: "retirada" as const };
  }),

  // ---- Registrar un cálculo ejecutado (tenant-scoped + auditoría) — CA-5 ----
  registrar: tenantProcedure
    .input(
      z.object({
        calculadoraId: z.string().uuid(),
        versionId: z.string().uuid(),
        pacienteId: z.string().uuid(),
        entradas: z.record(z.union([z.string(), z.number(), z.boolean()])),
        resultado: z.number(),
        interpretacion: z.string().max(500).optional(),
        pantalla: z.string().max(60).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const reg = await tx.registroCalculo.create({
          data: {
            calculadoraId: input.calculadoraId,
            versionId: input.versionId,
            pacienteId: input.pacienteId,
            entradas: input.entradas as Prisma.InputJsonValue,
            resultado: new Prisma.Decimal(input.resultado),
            interpretacion: input.interpretacion,
            pantalla: input.pantalla,
            usuarioId: ctx.tenant.userId,
            organizationId: ctx.tenant.organizationId,
          },
          select: { id: true, creadoEn: true },
        });
        return reg;
      });
    }),
});
