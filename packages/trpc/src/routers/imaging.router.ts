/**
 * §18 RIS/PACS — router (Wave 7 / Phase 2).
 * Beta.9 hardening layer 1:
 *   - State machine enforcement (VALID_STATUS_TRANSITIONS)
 *   - DICOM modality code validation on modality.create
 *   - imaging.getOverdueOrders: SLA-breach detection
 *   - report.validate: immutability lock endpoint
 *   - Radiation dose fields on updateStatus
 *
 * HH-13 (2026-05-19):
 * - Todos los resolvers envueltos en withTenantContext para garantizar
 *   demote a rol `authenticated` y aplicación de RLS de Postgres.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  imagingModalityCreateInput,
  imagingModalityListInput,
  imagingOrderListInput,
  imagingOrderUpdateStatusInput,
  imagingOrderCancelInput,
  imagingReportCreateInput,
  imagingReportSignInput,
  imagingReportValidateInput,
  VALID_STATUS_TRANSITIONS,
  SLA_MINUTES,
  type ImagingOrderStatusType,
} from "@his/contracts";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

/**
 * CC-0035 (P0-4 acotado, auditoría C6 2026-09-15) — el ciclo clínico
 * posterior a la solicitud (programar/realizar/dictar/firmar/validar)
 * corría en `tenantProcedure` sin `requireRole`: `radiologistId=ctx.user.id`
 * se asignaba a cualquier usuario tenant sin verificar rol. `ADMIN` se
 * incluye como override operativo (mismo patrón que `lis.router.ts` y
 * `critical-result.router.ts`).
 *
 * NO se toca `modality.list`/`modality.create` (catálogo, fuera del ciclo
 * post-solicitud que pide el encargo) ni se agrega segregación firma≠valida
 * en `report.validate` (el encargo pide "agrega requireRole", no rediseñar
 * la regla de negocio) — documentado como pendiente para el CC de UI/RIS
 * futuro (ver auditoría B35: sin segregación firma≠validación).
 */
const radTechnicianProc = requireRole(["RAD_TECHNICIAN", "ADMIN"]);
const radiologistProc = requireRole(["PHYSICIAN", "ADMIN"]);

export const imagingRouter = router({
  modality: router({
    list: tenantProcedure
      .input(imagingModalityListInput)
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          return tx.imagingModality.findMany({
            where: {
              establishment: { organizationId: ctx.tenant.organizationId },
              ...(input.establishmentId && {
                establishmentId: input.establishmentId,
              }),
              ...(input.modalityType && { modalityType: input.modalityType }),
              ...(input.activeOnly && { active: true }),
            },
            orderBy: { code: "asc" },
            take: input.limit,
          });
        });
      }),

    create: tenantProcedure
      .input(imagingModalityCreateInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const est = await tx.establishment.findFirst({
            where: {
              id: input.establishmentId,
              organizationId: ctx.tenant.organizationId,
            },
            select: { id: true },
          });
          if (!est) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Establecimiento no existe en la organización.",
            });
          }
          return tx.imagingModality.create({
            data: {
              establishmentId: input.establishmentId,
              code: input.code,
              name: input.name,
              modalityType: input.modalityType,
              dicomCode: input.dicomCode ?? null,
              aeTitle: input.aeTitle ?? null,
            },
          });
        });
      }),
  }),

  order: router({
    list: tenantProcedure
      .input(imagingOrderListInput)
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          return tx.imagingOrder.findMany({
            where: {
              organizationId: ctx.tenant.organizationId,
              deletedAt: null,
              ...(input.status && { status: input.status }),
              ...(input.priority && { priority: input.priority }),
              ...(input.modalityType && { modalityType: input.modalityType }),
              ...(input.patientId && { patientId: input.patientId }),
              ...(input.encounterId && { encounterId: input.encounterId }),
              ...(input.establishmentId && {
                establishmentId: input.establishmentId,
              }),
              ...(input.costCenterId && { costCenterId: input.costCenterId }),
              ...(input.ejecutorCostCenterId && {
                ejecutorCostCenterId: input.ejecutorCostCenterId,
              }),
              ...((input.fromDate || input.toDate) && {
                createdAt: {
                  ...(input.fromDate && { gte: input.fromDate }),
                  ...(input.toDate && { lte: input.toDate }),
                },
              }),
            },
            include: {
              patient: {
                select: { id: true, firstName: true, lastName: true, mrn: true },
              },
              orderingProvider: { select: { id: true, fullName: true } },
              modality: { select: { id: true, code: true, name: true } },
            },
            orderBy: { createdAt: "desc" },
            take: input.limit,
          });
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const item = await tx.imagingOrder.findFirst({
            where: {
              id: input.id,
              organizationId: ctx.tenant.organizationId,
              deletedAt: null,
            },
            include: { report: true },
          });
          if (!item) throw new TRPCError({ code: "NOT_FOUND" });
          return item;
        });
      }),

    // Sin `create`: la creación de órdenes vive en `imagingRequest.crear`
    // (CC-0016, catálogo LabTest) que captura el cargo en la misma tx
    // (docs/48 Ola 3 C3-1 / RN-HIS-BOT-001 H-01). El `order.create` legado
    // (texto libre, sin código de catálogo) creaba órdenes sin cargo y no
    // tenía callers — eliminado.
    updateStatus: radTechnicianProc
      .input(imagingOrderUpdateStatusInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const order = await tx.imagingOrder.findFirst({
            where: {
              id: input.id,
              organizationId: ctx.tenant.organizationId,
              deletedAt: null,
            },
            select: { id: true, status: true },
          });
          if (!order) throw new TRPCError({ code: "NOT_FOUND" });

          const allowed = VALID_STATUS_TRANSITIONS[order.status as ImagingOrderStatusType];
          if (!allowed.includes(input.status)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Transición inválida: ${order.status} → ${input.status}.`,
            });
          }

          await tx.imagingOrder.update({
            where: { id: input.id },
            data: {
              status: input.status,
              ...(input.accessionNumber && { accessionNumber: input.accessionNumber }),
              // CC-0041 — hito de trazabilidad del tablero de supervisión
              // (antes scheduledAt nunca se seteaba por este camino).
              ...(input.status === "SCHEDULED" && { scheduledAt: new Date() }),
              ...(input.status === "COMPLETED" && { completedAt: new Date() }),
              ...(input.radiationDoseDap != null && {
                radiationDoseDap: input.radiationDoseDap,
              }),
              ...(input.radiationDoseCtdi != null && {
                radiationDoseCtdi: input.radiationDoseCtdi,
              }),
              updatedBy: ctx.user.id,
            },
          });

          // CC-0041 — sincroniza la CareTask de supervisión del estudio
          // (sourceType IMAGING_ORDER, creada por imagingRequest.crear o por
          // el order-consumer de indicaciones). SCHEDULED→PENDIENTE ·
          // IN_PROGRESS→EN_PROCESO · COMPLETED/REPORTED/VALIDATED→CUMPLIDA
          // (hallazgo pre-PR: COMPLETED→REPORTED vía updateStatus NO debe
          // reabrir una tarea ya cumplida); CANCELADA no se toca y una
          // CUMPLIDA conserva su completedAt (no se re-marca).
          const taskStatus =
            input.status === "COMPLETED" || input.status === "REPORTED" || input.status === "VALIDATED"
              ? "CUMPLIDA"
              : input.status === "IN_PROGRESS"
                ? "EN_PROCESO"
                : "PENDIENTE";
          await tx.careTask.updateMany({
            where: {
              sourceType: "IMAGING_ORDER",
              sourceId: input.id,
              status: { notIn: ["CANCELADA", taskStatus] },
            },
            data:
              taskStatus === "CUMPLIDA"
                ? { status: "CUMPLIDA", completedById: ctx.user.id, completedAt: new Date() }
                : { status: taskStatus, completedById: null, completedAt: null },
          });

          return { ok: true as const };
        });
      }),

    cancel: radTechnicianProc
      .input(imagingOrderCancelInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const updated = await tx.imagingOrder.updateMany({
            where: {
              id: input.id,
              organizationId: ctx.tenant.organizationId,
              // Only cancellable before COMPLETED
              status: { in: ["ORDERED", "SCHEDULED", "IN_PROGRESS"] },
              deletedAt: null,
            },
            data: {
              status: "CANCELLED",
              notes: input.reason,
              updatedBy: ctx.user.id,
            },
          });
          if (updated.count === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Orden no existe, ya fue completada, o ya estaba cancelada.",
            });
          }

          // CC-0041 — cancela también la CareTask de supervisión del estudio.
          await tx.careTask.updateMany({
            where: {
              sourceType: "IMAGING_ORDER",
              sourceId: input.id,
              status: { in: ["PENDIENTE", "EN_PROCESO"] },
            },
            data: { status: "CANCELADA", cancelReason: input.reason },
          });

          return { ok: true as const };
        });
      }),

    /**
     * Returns orders where orderedAt + sla < now() and status not in
     * terminal states REPORTED / VALIDATED / CANCELLED.
     * SLA is derived from priority: STAT=60min, URGENT=240min, ROUTINE=1440min.
     */
    getOverdueOrders: tenantProcedure
      .input(
        z.object({
          establishmentId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(200).default(50),
        }),
      )
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const now = new Date();

          // Fetch active (non-terminal) orders; compute overdue in-process.
          // Trade-off: filtering SLA per-priority in SQL requires raw query or
          // multiple queries. We fetch active orders and filter in JS to keep
          // the code simple and avoid $queryRaw coupling — volume is bounded
          // by active workload per establishment.
          const activeOrders = await tx.imagingOrder.findMany({
            where: {
              organizationId: ctx.tenant.organizationId,
              deletedAt: null,
              status: {
                notIn: ["REPORTED", "VALIDATED", "CANCELLED"],
              },
              ...(input.establishmentId && {
                establishmentId: input.establishmentId,
              }),
            },
            include: {
              patient: {
                select: { id: true, firstName: true, lastName: true, mrn: true },
              },
              orderingProvider: { select: { id: true, fullName: true } },
            },
            orderBy: { orderedAt: "asc" },
            take: input.limit * 4, // over-fetch to account for filtering
          });

          const overdue = activeOrders.filter((o) => {
            const sla = SLA_MINUTES[o.priority as keyof typeof SLA_MINUTES];
            const deadline = new Date(o.orderedAt.getTime() + sla * 60_000);
            return deadline < now;
          });

          return overdue.slice(0, input.limit);
        });
      }),
  }),

  report: router({
    create: radiologistProc
      .input(imagingReportCreateInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          // Check report not already validated (immutable)
          const existing = await tx.imagingReport.findUnique({
            where: { orderId: input.orderId },
            select: { validatedAt: true },
          });
          if (existing?.validatedAt) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "El reporte ya fue validado y es inmutable.",
            });
          }

          const order = await tx.imagingOrder.findFirst({
            where: {
              id: input.orderId,
              organizationId: ctx.tenant.organizationId,
              status: { in: ["COMPLETED", "REPORTED"] },
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!order) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Orden no existe o no está en estado reportable (COMPLETED/REPORTED).",
            });
          }
          const report = await tx.imagingReport.upsert({
            where: { orderId: input.orderId },
            create: {
              orderId: input.orderId,
              radiologistId: ctx.user.id,
              findings: input.findings,
              impression: input.impression,
              recommendation: input.recommendation ?? null,
            },
            update: {
              findings: input.findings,
              impression: input.impression,
              recommendation: input.recommendation ?? null,
              amendedAt: new Date(),
            },
          });
          // Promote order to REPORTED on first report creation
          await tx.imagingOrder.updateMany({
            where: {
              id: input.orderId,
              organizationId: ctx.tenant.organizationId,
              status: "COMPLETED",
            },
            data: { status: "REPORTED", updatedBy: ctx.user.id },
          });
          return report;
        });
      }),

    sign: radiologistProc
      .input(imagingReportSignInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const order = await tx.imagingOrder.findFirst({
            where: {
              id: input.orderId,
              organizationId: ctx.tenant.organizationId,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!order) throw new TRPCError({ code: "NOT_FOUND" });
          const updated = await tx.imagingReport.updateMany({
            where: { orderId: input.orderId, signedAt: null },
            data: { signedAt: new Date() },
          });
          if (updated.count === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Reporte no existe o ya está firmado.",
            });
          }
          return { ok: true as const };
        });
      }),

    /**
     * Validates a signed report, promoting the order to VALIDATED.
     * After validation the DB trigger blocks any further UPDATE/DELETE on the report.
     */
    validate: radiologistProc
      .input(imagingReportValidateInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const order = await tx.imagingOrder.findFirst({
            where: {
              id: input.orderId,
              organizationId: ctx.tenant.organizationId,
              status: "REPORTED",
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!order) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Orden no existe o no está en estado REPORTED.",
            });
          }
          const updated = await tx.imagingReport.updateMany({
            where: { orderId: input.orderId, signedAt: { not: null }, validatedAt: null },
            data: { validatedAt: new Date() },
          });
          if (updated.count === 0) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "El reporte debe estar firmado antes de validar, o ya fue validado.",
            });
          }
          await tx.imagingOrder.updateMany({
            where: { id: input.orderId, organizationId: ctx.tenant.organizationId },
            data: { status: "VALIDATED", updatedBy: ctx.user.id },
          });
          return { ok: true as const };
        });
      }),
  }),
});
