/**
 * Router tRPC — CareBoard (CC-0026 D3).
 *
 * Alimenta `/tableros` (grid de áreas) y `/tableros/[unidad]` (tablero por
 * área o por rol transversal — enfermería). Lee `CareTask` (modelo/RLS de
 * `packages/trpc/src/routers/care-task.router.ts` — este router NO se toca,
 * ver `packages/database/sql/209_cc0026_care_task.sql`) agrupado por
 * `ServiceUnit.areaType` (columna nueva, `sql/212_cc0026_service_unit_area.sql`).
 *
 * Enfermería es un ROL, no una unidad (REQ-CC-0026 D3): su fila/tablero
 * filtra `assignedRoleCode='NURSE'` transversal a las unidades del
 * establecimiento, no una `ServiceUnit` concreta.
 */
import { router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";
import { careBoardInput } from "@his/contracts/schemas/care-board";

/** Estados que cuentan como "actividad abierta" en el resumen de áreas. */
const OPEN_STATUSES = ["PENDIENTE", "EN_PROCESO"] as const;

function priorityRank(priority: string): number {
  switch (priority) {
    case "CRITICAL":
      return 0;
    case "HIGH":
      return 1;
    case "LOW":
      return 3;
    default:
      return 2; // NORMAL y cualquier valor inesperado.
  }
}

/** [00:00, ahora] del día actual en UTC — ventana de "CUMPLIDA HOY". */
function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

export const careBoardRouter = router({
  /**
   * Grid de áreas: ServiceUnits con `areaType` clasificado + fila virtual
   * "ENFERMERIA" (rol, no unidad) — ambas con conteo PENDIENTE/EN_PROCESO.
   */
  areas: tenantProcedure.query(async ({ ctx }) => {
    const establishmentId = ctx.tenant.establishmentId ?? undefined;

    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const [units, unitCounts, nurseCounts] = await Promise.all([
        tx.serviceUnit.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            active: true,
            areaType: { not: null },
            ...(establishmentId ? { establishmentId } : {}),
          },
          select: { id: true, code: true, name: true, areaType: true },
          orderBy: { name: "asc" },
        }),
        tx.careTask.groupBy({
          by: ["serviceUnitId", "status"],
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(establishmentId ? { establishmentId } : {}),
            status: { in: [...OPEN_STATUSES] },
            serviceUnitId: { not: null },
          },
          _count: { _all: true },
        }),
        tx.careTask.groupBy({
          by: ["status"],
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(establishmentId ? { establishmentId } : {}),
            assignedRoleCode: "NURSE",
            status: { in: [...OPEN_STATUSES] },
          },
          _count: { _all: true },
        }),
      ]);

      const countsByUnit = new Map<string, { pendiente: number; enProceso: number }>();
      for (const row of unitCounts) {
        if (!row.serviceUnitId) continue;
        const entry = countsByUnit.get(row.serviceUnitId) ?? { pendiente: 0, enProceso: 0 };
        if (row.status === "PENDIENTE") entry.pendiente = row._count._all;
        if (row.status === "EN_PROCESO") entry.enProceso = row._count._all;
        countsByUnit.set(row.serviceUnitId, entry);
      }

      const nurseEntry = { pendiente: 0, enProceso: 0 };
      for (const row of nurseCounts) {
        if (row.status === "PENDIENTE") nurseEntry.pendiente = row._count._all;
        if (row.status === "EN_PROCESO") nurseEntry.enProceso = row._count._all;
      }

      return {
        areas: units.map((u) => ({
          kind: "unit" as const,
          id: u.id,
          code: u.code,
          name: u.name,
          areaType: u.areaType,
          pendienteCount: countsByUnit.get(u.id)?.pendiente ?? 0,
          enProcesoCount: countsByUnit.get(u.id)?.enProceso ?? 0,
        })),
        enfermeria: {
          kind: "role" as const,
          id: "enfermeria",
          code: "ENFERMERIA",
          name: "Enfermería",
          areaType: null,
          pendienteCount: nurseEntry.pendiente,
          enProcesoCount: nurseEntry.enProceso,
        },
      };
    });
  }),

  /**
   * Tablero de una unidad o de enfermería (rol). Sin `status` explícito
   * devuelve PENDIENTE + EN_PROCESO + CUMPLIDA de hoy (para la columna
   * "Cumplida hoy" del tablero); con `status` filtra exacto (CUMPLIDA
   * siempre acotada al día — un tablero operativo no lista histórico).
   *
   * Orden: vencidas primero (PENDIENTE con dueAt < ahora), luego prioridad
   * CRITICAL>HIGH>NORMAL>LOW, luego dueAt asc. Postgres no ordena bien un
   * CASE compuesto vía Prisma typed API sin `$queryRaw`, así que el criterio
   * se aplica en memoria tras el fetch — aceptable al alcance de un tablero
   * por área/rol (no se pagina un histórico completo).
   */
  board: tenantProcedure.input(careBoardInput).query(async ({ ctx, input }) => {
    const scope = input.serviceUnitId
      ? { serviceUnitId: input.serviceUnitId }
      : { assignedRoleCode: "NURSE" };

    const baseWhere = {
      organizationId: ctx.tenant.organizationId,
      ...scope,
    };

    const where = input.status
      ? {
          ...baseWhere,
          status: input.status,
          ...(input.status === "CUMPLIDA" ? { completedAt: { gte: startOfTodayUtc() } } : {}),
        }
      : {
          ...baseWhere,
          OR: [
            { status: { in: [...OPEN_STATUSES] } },
            { status: "CUMPLIDA", completedAt: { gte: startOfTodayUtc() } },
          ],
        };

    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const tasks = await tx.careTask.findMany({
        where,
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
          serviceUnit: { select: { id: true, code: true, name: true } },
        },
      });

      const now = Date.now();
      const sorted = tasks.slice().sort((a, b) => {
        const aOverdue = a.status === "PENDIENTE" && a.dueAt !== null && a.dueAt.getTime() < now ? 0 : 1;
        const bOverdue = b.status === "PENDIENTE" && b.dueAt !== null && b.dueAt.getTime() < now ? 0 : 1;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;

        const aPriority = priorityRank(a.priority);
        const bPriority = priorityRank(b.priority);
        if (aPriority !== bPriority) return aPriority - bPriority;

        const aDue = a.dueAt?.getTime() ?? Infinity;
        const bDue = b.dueAt?.getTime() ?? Infinity;
        return aDue - bDue;
      });

      const total = sorted.length;
      const start = (input.page - 1) * input.pageSize;
      const items = sorted.slice(start, start + input.pageSize);

      return { items, total, page: input.page, pageSize: input.pageSize };
    });
  }),
});
