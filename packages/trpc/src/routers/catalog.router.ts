/**
 * CRUD genérico para catálogos parametrizables (TDR §7).
 * Sólo expone catálogos con dependencias controladas; los que requieren reglas
 * extra (IdentifierType con validatorFn complejo, MedicalSpecialty con jerarquía
 * profunda, etc.) podrán mover a routers dedicados en una iteración futura.
 *
 * US-3.2 — añadido:
 *  - input `search` en list (filtro por code/name).
 *  - validación por catálogo del payload `data` usando schemas Zod (catalogDataSchemas).
 *  - mutation `reactivate` (espejo de deactivate) para revivir un registro inactivo.
 *  - Mapeo de error P2002 (unique violation) → CONFLICT con mensaje legible es-SV.
 *
 * TODO(Sprint 2): rutas dedicadas para catálogos con jerarquía (MedicalSpecialty).
 * TODO(Sprint 2): permission check por catálogo (ej. solo ADMIN puede crear).
 * TODO(Sprint 2): paginación servidor cuando catálogos crezcan a miles de filas.
 */
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import {
  catalogKeyEnum,
  catalogListInput,
  catalogGetInput,
  catalogCreateInput,
  catalogUpdateInput,
  catalogToggleInput,
  catalogDataSchemas,
  type CatalogKey,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

/**
 * Mapa catalog → modelo Prisma. Se usa indirectamente vía `(ctx.prisma as any)[model]`
 * para mantenerlo simple en MVP. Si crece, conviene generar este mapa con types.
 */
const modelMap: Record<CatalogKey, string> = {
  biologicalSex: "biologicalSex",
  gender: "gender",
  maritalStatus: "maritalStatus",
  educationLevel: "educationLevel",
  occupation: "occupation",
  religion: "religion",
  language: "language",
  ethnicity: "ethnicity",
  patientType: "patientType",
  patientCategory: "patientCategory",
  ageBand: "ageBand",
  medicalSpecialty: "medicalSpecialty",
  identifierType: "identifierType",
};

function model(prisma: unknown, key: CatalogKey) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (prisma as any)[modelMap[key]];
  if (!m) throw new TRPCError({ code: "BAD_REQUEST", message: "Catálogo desconocido." });
  return m;
}

/** Aplica el schema Zod específico al payload `data` o lanza BAD_REQUEST con detalle. */
function validateData(catalog: CatalogKey, raw: Record<string, unknown>) {
  const schema = catalogDataSchemas[catalog];
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
    });
  }
  return parsed.data as Record<string, unknown>;
}

/** Convierte errores Prisma comunes en TRPCError con mensaje es-SV. */
function rethrowPrisma(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Ya existe un registro con ese código en el catálogo.",
      });
    }
    if (err.code === "P2025") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Registro no encontrado." });
    }
  }
  throw err;
}

/**
 * Filtros de búsqueda — buscan en `code` y `name` (case-insensitive).
 * Ojo: algunos modelos no tienen `code` sino `isoCode` (Language) o `ciuoCode` (Occupation).
 */
function buildWhere(catalog: CatalogKey, activeOnly: boolean, search?: string) {
  const where: Record<string, unknown> = {};
  if (activeOnly) where.active = true;
  if (search && search.length > 0) {
    const codeField =
      catalog === "language" ? "isoCode" : catalog === "occupation" ? "ciuoCode" : "code";
    where.OR = [
      { [codeField]: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
    ];
  }
  return where;
}

export const catalogRouter = router({
  /** Listado plano con búsqueda básica. */
  list: tenantProcedure.input(catalogListInput).query(async ({ ctx, input }) => {
    return model(ctx.prisma, input.catalog).findMany({
      where: buildWhere(input.catalog, input.activeOnly, input.search),
      orderBy: { name: "asc" },
    });
  }),

  get: tenantProcedure.input(catalogGetInput).query(async ({ ctx, input }) => {
    const item = await model(ctx.prisma, input.catalog).findUnique({
      where: { id: input.id },
    });
    if (!item) throw new TRPCError({ code: "NOT_FOUND" });
    return item;
  }),

  create: tenantProcedure.input(catalogCreateInput).mutation(async ({ ctx, input }) => {
    const data = validateData(input.catalog, input.data);
    try {
      return await model(ctx.prisma, input.catalog).create({ data });
    } catch (err) {
      rethrowPrisma(err);
    }
  }),

  update: tenantProcedure.input(catalogUpdateInput).mutation(async ({ ctx, input }) => {
    const data = validateData(input.catalog, input.data);
    try {
      return await model(ctx.prisma, input.catalog).update({
        where: { id: input.id },
        data,
      });
    } catch (err) {
      rethrowPrisma(err);
    }
  }),

  /** Soft-disable: marca active=false. NO borra físicamente. */
  deactivate: tenantProcedure.input(catalogToggleInput).mutation(async ({ ctx, input }) => {
    try {
      return await model(ctx.prisma, input.catalog).update({
        where: { id: input.id },
        data: { active: false },
      });
    } catch (err) {
      rethrowPrisma(err);
    }
  }),

  /** Re-activa un registro previamente desactivado. */
  reactivate: tenantProcedure.input(catalogToggleInput).mutation(async ({ ctx, input }) => {
    try {
      return await model(ctx.prisma, input.catalog).update({
        where: { id: input.id },
        data: { active: true },
      });
    } catch (err) {
      rethrowPrisma(err);
    }
  }),
});

// Re-export key enum para consumidores que quieran tipar parámetros UI.
export { catalogKeyEnum };
