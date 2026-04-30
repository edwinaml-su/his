/**
 * CRUD genérico para catálogos parametrizables (TDR §7).
 * Sólo expone catálogos con dependencias controladas; los que requieren reglas
 * extra (IdentifierType con validatorFn, MedicalSpecialty con jerarquía, etc.)
 * deben tener routers dedicados en una iteración futura.
 *
 * TODO(Sprint 2): rutas dedicadas para catálogos con jerarquía (MedicalSpecialty).
 * TODO(Sprint 2): permission check por catálogo (ej. solo ADMIN puede crear).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, tenantProcedure } from "../trpc";

const catalogKeyEnum = z.enum([
  "biologicalSex",
  "gender",
  "maritalStatus",
  "educationLevel",
  "occupation",
  "religion",
  "language",
  "ethnicity",
  "patientType",
  "patientCategory",
  "ageBand",
  "medicalSpecialty",
  "identifierType",
]);

type CatalogKey = z.infer<typeof catalogKeyEnum>;

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

export const catalogRouter = router({
  list: tenantProcedure
    .input(z.object({ catalog: catalogKeyEnum, activeOnly: z.boolean().default(true) }))
    .query(async ({ ctx, input }) => {
      return model(ctx.prisma, input.catalog).findMany({
        where: input.activeOnly ? { active: true } : {},
        orderBy: { name: "asc" },
      });
    }),

  get: tenantProcedure
    .input(z.object({ catalog: catalogKeyEnum, id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const item = await model(ctx.prisma, input.catalog).findUnique({
        where: { id: input.id },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      return item;
    }),

  create: tenantProcedure
    .input(
      z.object({
        catalog: catalogKeyEnum,
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return model(ctx.prisma, input.catalog).create({ data: input.data });
    }),

  update: tenantProcedure
    .input(
      z.object({
        catalog: catalogKeyEnum,
        id: z.string().uuid(),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return model(ctx.prisma, input.catalog).update({
        where: { id: input.id },
        data: input.data,
      });
    }),

  /** Soft-disable: marca active=false. */
  deactivate: tenantProcedure
    .input(z.object({ catalog: catalogKeyEnum, id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return model(ctx.prisma, input.catalog).update({
        where: { id: input.id },
        data: { active: false },
      });
    }),
});
