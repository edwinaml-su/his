/**
 * @his/trpc — `triageFlowchart` router.
 *
 * US-6.3 (Flujogramas Manchester 52) + US-6.4 (Discriminadores activos).
 * Equipo: Mike — Triage Manchester.
 *
 * Endpoints:
 *   - list({ category?, search?, includeInactive? })
 *   - get({ id })
 *   - listForTriage({ triageEvaluationId })  → discriminadores activos del flowchart
 *                                               de la evaluación, ordenados por ordinal.
 *   - setActive({ id, active })              → admin / config.
 *
 * NOTA: NO se registra aquí en `_app.ts` (otro equipo lo extiende). Para usar
 * desde el cliente cuando aún no esté registrado, hacer un cast al tipo
 * `AppRouter` extendido.
 */
import { TRPCError } from "@trpc/server";
// Import directo del schema (no exportado aún desde el barrel `@his/contracts`).
// Cuando Sierra agregue la línea correspondiente a `schemas/index.ts`, se puede
// migrar a `from "@his/contracts"`.
import {
  listFlowchartsInputSchema,
  getFlowchartInputSchema,
  listForTriageInputSchema,
  setFlowchartActiveInputSchema,
  categoryFromFlowchart,
  type FlowchartCategory,
  type FlowchartListItem,
  type FlowchartDetail,
  type DiscriminatorOut,
  type TriageColorOut,
} from "../../../contracts/src/schemas/triage-flowchart";
import { router, tenantProcedure } from "../trpc";

export const triageFlowchartRouter = router({
  /**
   * Lista de flujogramas configurados en la org actual.
   *
   * Filtros:
   *  - category: agrupación inferida del code/isPediatric.
   *  - search:  ILIKE en `name` o `code`.
   *  - includeInactive: por default solo activos.
   */
  list: tenantProcedure
    .input(listFlowchartsInputSchema)
    .query(async ({ ctx, input }): Promise<FlowchartListItem[]> => {
      const search = input?.search?.trim();
      const rows = await ctx.prisma.triageFlowchart.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          ...(input?.includeInactive ? {} : { active: true }),
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { code: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { name: "asc" },
        include: {
          _count: { select: { discriminators: { where: { active: true } } } },
        },
      });

      const all: FlowchartListItem[] = rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        isPediatric: r.isPediatric,
        active: r.active,
        category: categoryFromFlowchart({
          code: r.code,
          isPediatric: r.isPediatric,
        }),
        discriminatorCount: r._count.discriminators,
      }));

      return input?.category
        ? all.filter((f) => f.category === input.category)
        : all;
    }),

  /** Devuelve el flujograma + sus discriminadores ACTIVOS ordenados por ordinal. */
  get: tenantProcedure
    .input(getFlowchartInputSchema)
    .query(async ({ ctx, input }): Promise<FlowchartDetail> => {
      const fc = await ctx.prisma.triageFlowchart.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.tenant.organizationId,
        },
        include: {
          discriminators: {
            where: { active: true },
            orderBy: { ordinal: "asc" },
            include: { resultLevel: true },
          },
          _count: { select: { discriminators: { where: { active: true } } } },
        },
      });
      if (!fc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Flujograma no existe." });
      }

      return {
        id: fc.id,
        code: fc.code,
        name: fc.name,
        isPediatric: fc.isPediatric,
        active: fc.active,
        defaultLevelId: fc.defaultLevelId,
        category: categoryFromFlowchart({
          code: fc.code,
          isPediatric: fc.isPediatric,
        }),
        discriminatorCount: fc._count.discriminators,
        discriminators: fc.discriminators.map<DiscriminatorOut>((d) => ({
          id: d.id,
          code: d.code,
          text: d.text,
          ordinal: d.ordinal,
          active: d.active,
          resultLevel: {
            id: d.resultLevel.id,
            color: d.resultLevel.color as TriageColorOut,
            name: d.resultLevel.name,
            priority: d.resultLevel.priority,
            maxWaitMinutes: d.resultLevel.maxWaitMinutes,
            uiColorHex: d.resultLevel.uiColorHex,
          },
        })),
      };
    }),

  /**
   * Para una evaluación de triage dada, devuelve sus discriminadores activos.
   * Se filtra a nivel de evaluación → flowchart → discriminadores.active=true.
   */
  listForTriage: tenantProcedure
    .input(listForTriageInputSchema)
    .query(async ({ ctx, input }) => {
      const evaluation = await ctx.prisma.triageEvaluation.findFirst({
        where: {
          id: input.triageEvaluationId,
          organizationId: ctx.tenant.organizationId,
        },
        select: { id: true, flowchartId: true, status: true },
      });
      if (!evaluation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Evaluación de triage no existe.",
        });
      }
      const fc = await ctx.prisma.triageFlowchart.findUnique({
        where: { id: evaluation.flowchartId },
        select: { id: true, code: true, name: true, isPediatric: true, defaultLevelId: true },
      });
      if (!fc) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Flujograma de la evaluación no existe.",
        });
      }
      const discriminators = await ctx.prisma.triageDiscriminator.findMany({
        where: { flowchartId: fc.id, active: true },
        orderBy: { ordinal: "asc" },
        include: { resultLevel: true },
      });

      return {
        evaluation: {
          id: evaluation.id,
          status: evaluation.status,
        },
        flowchart: {
          id: fc.id,
          code: fc.code,
          name: fc.name,
          isPediatric: fc.isPediatric,
          defaultLevelId: fc.defaultLevelId,
          category: categoryFromFlowchart({
            code: fc.code,
            isPediatric: fc.isPediatric,
          }) as FlowchartCategory,
        },
        discriminators: discriminators.map<DiscriminatorOut>((d) => ({
          id: d.id,
          code: d.code,
          text: d.text,
          ordinal: d.ordinal,
          active: d.active,
          resultLevel: {
            id: d.resultLevel.id,
            color: d.resultLevel.color as TriageColorOut,
            name: d.resultLevel.name,
            priority: d.resultLevel.priority,
            maxWaitMinutes: d.resultLevel.maxWaitMinutes,
            uiColorHex: d.resultLevel.uiColorHex,
          },
        })),
      };
    }),

  /** Toggle activación de flujograma (admin /triage-config). */
  setActive: tenantProcedure
    .input(setFlowchartActiveInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Verifica que pertenezca al tenant.
      const fc = await ctx.prisma.triageFlowchart.findFirst({
        where: { id: input.id, organizationId: ctx.tenant.organizationId },
        select: { id: true },
      });
      if (!fc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Flujograma no existe." });
      }
      const updated = await ctx.prisma.triageFlowchart.update({
        where: { id: fc.id },
        data: { active: input.active },
        select: { id: true, active: true },
      });
      return updated;
    }),
});
