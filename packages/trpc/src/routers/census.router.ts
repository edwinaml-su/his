/**
 * US-5.4 — Censo realtime + ocupación.
 *
 * Endpoints agregados para el tablero ADT (`/census`):
 *   - bedMap            → grid Bed × Servicio con paciente resumido si OCUPADA.
 *   - occupancyStats    → counts por status + % de ocupación global y por servicio.
 *   - dailyMovements    → ingresos, egresos, traslados, defunciones, fugas del día.
 *   - kpisByService     → días-cama, giro de cama y estancia promedio (30d).
 *
 * Realtime: el plan MVP es polling con `refetchInterval: 30_000` desde la UI.
 * Sprint 4 evaluará Supabase Realtime channels (broadcast post-INSERT/UPDATE
 * sobre Bed / BedAssignment / Encounter) para evitar el round-trip y reducir
 * la latencia percibida bajo carga.
 *
 * Multitenancy: todas las queries restringen `organizationId = ctx.tenant`.
 * El filtro opcional `establishmentId` cae en cascada para casos donde el
 * usuario actúa sobre un solo establecimiento (default = el seleccionado).
 *
 * Importante:
 *   - El schema usa `EncounterTransfer.occurredAt` (no `transferredAt`).
 *   - El schema usa `DischargeType.DEATH` (no `DECEASED`).
 *   - La US describe esos campos con nombres distintos; aquí mapeamos al
 *     modelo real Prisma.
 */
import {
  censusBedMapSchema,
  censusOccupancyStatsSchema,
  censusDailyMovementsSchema,
  censusKpisByServiceSchema,
} from "../../../contracts/src/schemas/census";
import { router, tenantProcedure } from "../trpc";

/** [00:00, 24:00) UTC del día que contiene `at` (o hoy si no se da). */
function dayBounds(at?: Date): { start: Date; end: Date } {
  const ref = at ? new Date(at) : new Date();
  const start = new Date(
    Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0, 0),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export const censusRouter = router({
  /**
   * Grid Bed × ServiceUnit con paciente resumido si OCUPADA.
   * Devuelve servicios sin camas (empty group) para que la UI muestre el
   * empty state correcto cuando una org aún no tenga inventario configurado.
   */
  bedMap: tenantProcedure
    .input(censusBedMapSchema)
    .query(async ({ ctx, input }) => {
      const establishmentId =
        input?.establishmentId ?? ctx.tenant.establishmentId ?? undefined;

      const services = await ctx.prisma.serviceUnit.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          active: true,
          ...(establishmentId ? { establishmentId } : {}),
          ...(input?.serviceUnitId ? { id: input.serviceUnitId } : {}),
        },
        include: {
          beds: {
            where: { active: true },
            include: {
              assignments: {
                where: { releasedAt: null },
                include: {
                  encounter: {
                    select: {
                      id: true,
                      admittedAt: true,
                      admissionType: true,
                      primaryDiagnosisId: true,
                      patient: {
                        select: {
                          id: true,
                          mrn: true,
                          firstName: true,
                          lastName: true,
                        },
                      },
                    },
                  },
                },
                take: 1,
              },
            },
            orderBy: { code: "asc" },
          },
        },
        orderBy: { code: "asc" },
      });

      return services.map((s) => ({
        serviceUnitId: s.id,
        serviceUnitCode: s.code,
        serviceUnitName: s.name,
        beds: s.beds.map((b) => {
          const a = b.assignments[0];
          const enc = a?.encounter ?? null;
          return {
            id: b.id,
            code: b.code,
            room: b.room,
            status: b.status,
            isolation: b.isolation,
            patient: enc?.patient
              ? {
                  id: enc.patient.id,
                  mrn: enc.patient.mrn,
                  fullName: `${enc.patient.firstName} ${enc.patient.lastName}`,
                  admittedAt: enc.admittedAt,
                  admissionType: enc.admissionType,
                  /** Stub MVP: el dx primario se modela en `Encounter`. */
                  primaryDiagnosis: enc.primaryDiagnosisId ?? null,
                }
              : null,
          };
        }),
      }));
    }),

  /**
   * Counts agrupados por status + porcentaje de ocupación.
   *
   * Algoritmo de % ocupación:
   *   denominador = camas operativas = total − BLOCKED − MAINTENANCE
   *   numerador   = OCCUPIED
   *
   * Descartamos BLOCKED y MAINTENANCE del denominador porque no están
   * disponibles para asignación (no representan capacidad efectiva). DIRTY
   * sí cuenta — es transitoria del ciclo housekeeping y volverá a FREE.
   * RESERVED también cuenta como capacidad (la cama existe, sólo está
   * apartada).
   */
  occupancyStats: tenantProcedure
    .input(censusOccupancyStatsSchema)
    .query(async ({ ctx, input }) => {
      const establishmentId =
        input?.establishmentId ?? ctx.tenant.establishmentId ?? undefined;

      const where = {
        organizationId: ctx.tenant.organizationId,
        active: true,
        ...(establishmentId ? { establishmentId } : {}),
        ...(input?.serviceUnitId ? { serviceUnitId: input.serviceUnitId } : {}),
      };

      const [grouped, byService] = await Promise.all([
        ctx.prisma.bed.groupBy({
          by: ["status"],
          where,
          _count: { _all: true },
        }),
        ctx.prisma.bed.groupBy({
          by: ["serviceUnitId", "status"],
          where,
          _count: { _all: true },
        }),
      ]);

      const counts = {
        FREE: 0,
        OCCUPIED: 0,
        DIRTY: 0,
        BLOCKED: 0,
        MAINTENANCE: 0,
        RESERVED: 0,
      } as Record<
        "FREE" | "OCCUPIED" | "DIRTY" | "BLOCKED" | "MAINTENANCE" | "RESERVED",
        number
      >;
      for (const row of grouped) counts[row.status] = row._count._all;

      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const operational = total - counts.BLOCKED - counts.MAINTENANCE;
      const occupancyPct =
        operational > 0 ? (counts.OCCUPIED / operational) * 100 : 0;

      // Pivote por servicio.
      const serviceMap = new Map<
        string,
        Record<string, number> & { total: number }
      >();
      for (const row of byService) {
        const key = row.serviceUnitId;
        const bucket =
          serviceMap.get(key) ??
          ({ total: 0, FREE: 0, OCCUPIED: 0, DIRTY: 0, BLOCKED: 0, MAINTENANCE: 0, RESERVED: 0 } as Record<string, number> & { total: number });
        bucket[row.status] = row._count._all;
        bucket.total += row._count._all;
        serviceMap.set(key, bucket);
      }

      const services = await ctx.prisma.serviceUnit.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          active: true,
          ...(establishmentId ? { establishmentId } : {}),
          ...(input?.serviceUnitId ? { id: input.serviceUnitId } : {}),
        },
        select: { id: true, code: true, name: true },
        orderBy: { code: "asc" },
      });

      const byServiceList = services.map((s) => {
        const b = serviceMap.get(s.id);
        const sTotal = b?.total ?? 0;
        const sOperational =
          sTotal - (b?.BLOCKED ?? 0) - (b?.MAINTENANCE ?? 0);
        return {
          serviceUnitId: s.id,
          serviceUnitCode: s.code,
          serviceUnitName: s.name,
          total: sTotal,
          occupied: b?.OCCUPIED ?? 0,
          free: b?.FREE ?? 0,
          dirty: b?.DIRTY ?? 0,
          blocked: b?.BLOCKED ?? 0,
          maintenance: b?.MAINTENANCE ?? 0,
          reserved: b?.RESERVED ?? 0,
          occupancyPct:
            sOperational > 0
              ? ((b?.OCCUPIED ?? 0) / sOperational) * 100
              : 0,
        };
      });

      return {
        global: {
          total,
          operational,
          occupied: counts.OCCUPIED,
          free: counts.FREE,
          dirty: counts.DIRTY,
          blocked: counts.BLOCKED,
          maintenance: counts.MAINTENANCE,
          reserved: counts.RESERVED,
          occupancyPct,
        },
        byService: byServiceList,
      };
    }),

  /**
   * Movimientos del día: ingresos, egresos, traslados, defunciones, fugas.
   * Devuelve counts y, en cada bucket, una lista resumida (top 50) para que
   * la UI pueda expandir sin pedir un endpoint adicional.
   */
  dailyMovements: tenantProcedure
    .input(censusDailyMovementsSchema)
    .query(async ({ ctx, input }) => {
      const { start, end } = dayBounds(input?.date);
      const establishmentId =
        input?.establishmentId ?? ctx.tenant.establishmentId ?? undefined;

      const orgFilter = {
        organizationId: ctx.tenant.organizationId,
        ...(establishmentId ? { establishmentId } : {}),
      };

      const [admissions, discharges, transfers, deaths, absconded] =
        await Promise.all([
          ctx.prisma.encounter.findMany({
            where: { ...orgFilter, admittedAt: { gte: start, lt: end } },
            select: {
              id: true,
              encounterNumber: true,
              admittedAt: true,
              admissionType: true,
              patient: {
                select: { id: true, mrn: true, firstName: true, lastName: true },
              },
              serviceUnit: { select: { id: true, code: true, name: true } },
            },
            orderBy: { admittedAt: "desc" },
            take: 50,
          }),
          ctx.prisma.encounter.findMany({
            where: { ...orgFilter, dischargedAt: { gte: start, lt: end } },
            select: {
              id: true,
              encounterNumber: true,
              dischargedAt: true,
              dischargeType: true,
              patient: {
                select: { id: true, mrn: true, firstName: true, lastName: true },
              },
              serviceUnit: { select: { id: true, code: true, name: true } },
            },
            orderBy: { dischargedAt: "desc" },
            take: 50,
          }),
          ctx.prisma.encounterTransfer.findMany({
            where: {
              occurredAt: { gte: start, lt: end },
              encounter: orgFilter,
            },
            select: {
              id: true,
              occurredAt: true,
              reason: true,
              fromServiceId: true,
              toServiceId: true,
              encounter: {
                select: {
                  id: true,
                  encounterNumber: true,
                  patient: {
                    select: {
                      id: true,
                      mrn: true,
                      firstName: true,
                      lastName: true,
                    },
                  },
                },
              },
            },
            orderBy: { occurredAt: "desc" },
            take: 50,
          }),
          ctx.prisma.encounter.findMany({
            where: {
              ...orgFilter,
              dischargedAt: { gte: start, lt: end },
              dischargeType: "DEATH",
            },
            select: {
              id: true,
              encounterNumber: true,
              dischargedAt: true,
              patient: {
                select: { id: true, mrn: true, firstName: true, lastName: true },
              },
            },
            orderBy: { dischargedAt: "desc" },
            take: 50,
          }),
          ctx.prisma.encounter.findMany({
            where: {
              ...orgFilter,
              dischargedAt: { gte: start, lt: end },
              dischargeType: "ABSCONDED",
            },
            select: {
              id: true,
              encounterNumber: true,
              dischargedAt: true,
              patient: {
                select: { id: true, mrn: true, firstName: true, lastName: true },
              },
            },
            orderBy: { dischargedAt: "desc" },
            take: 50,
          }),
        ]);

      return {
        date: start,
        admissions: { count: admissions.length, items: admissions },
        discharges: { count: discharges.length, items: discharges },
        transfers: { count: transfers.length, items: transfers },
        deaths: { count: deaths.length, items: deaths },
        absconded: { count: absconded.length, items: absconded },
      };
    }),

  /**
   * KPIs por servicio:
   *   - patientDays  = ∑ duración(BedAssignment) en la ventana, en días-cama.
   *   - turnover     = egresos en la ventana / camas operativas (giro cama).
   *   - avgLengthOfStay = ∑ días de Encounter cerrados en la ventana / N egresos.
   */
  kpisByService: tenantProcedure
    .input(censusKpisByServiceSchema)
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const since = new Date(
        now.getTime() - input.windowDays * 24 * 60 * 60 * 1000,
      );

      const service = await ctx.prisma.serviceUnit.findFirst({
        where: {
          id: input.serviceUnitId,
          organizationId: ctx.tenant.organizationId,
        },
        select: { id: true, name: true },
      });

      const [bedTotal, bedOps, discharges, assignments] = await Promise.all([
        ctx.prisma.bed.count({
          where: {
            organizationId: ctx.tenant.organizationId,
            serviceUnitId: input.serviceUnitId,
            active: true,
          },
        }),
        ctx.prisma.bed.count({
          where: {
            organizationId: ctx.tenant.organizationId,
            serviceUnitId: input.serviceUnitId,
            active: true,
            status: { notIn: ["BLOCKED", "MAINTENANCE"] },
          },
        }),
        ctx.prisma.encounter.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            serviceUnitId: input.serviceUnitId,
            dischargedAt: { gte: since, lte: now, not: null },
          },
          select: { admittedAt: true, dischargedAt: true },
        }),
        ctx.prisma.bedAssignment.findMany({
          where: {
            bed: {
              serviceUnitId: input.serviceUnitId,
              organizationId: ctx.tenant.organizationId,
            },
            assignedAt: { lte: now },
            OR: [{ releasedAt: null }, { releasedAt: { gte: since } }],
          },
          select: { assignedAt: true, releasedAt: true },
        }),
      ]);

      const dayMs = 24 * 60 * 60 * 1000;

      // Días-cama: clip al rango [since, now].
      let patientDays = 0;
      for (const a of assignments) {
        const s = a.assignedAt > since ? a.assignedAt : since;
        const e = a.releasedAt ?? now;
        const eClipped = e > now ? now : e;
        if (eClipped > s) patientDays += (eClipped.getTime() - s.getTime()) / dayMs;
      }

      // Estancia promedio: encuentros cerrados en ventana.
      let stayTotal = 0;
      for (const e of discharges) {
        if (e.dischargedAt) {
          stayTotal += (e.dischargedAt.getTime() - e.admittedAt.getTime()) / dayMs;
        }
      }
      const avgLengthOfStay =
        discharges.length > 0 ? stayTotal / discharges.length : 0;

      const turnover = bedOps > 0 ? discharges.length / bedOps : 0;

      return {
        serviceUnitId: input.serviceUnitId,
        serviceUnitName: service?.name ?? null,
        windowDays: input.windowDays,
        bedTotal,
        bedOperational: bedOps,
        dischargesInWindow: discharges.length,
        patientDays: Number(patientDays.toFixed(2)),
        turnover: Number(turnover.toFixed(2)),
        avgLengthOfStay: Number(avgLengthOfStay.toFixed(2)),
      };
    }),
});
