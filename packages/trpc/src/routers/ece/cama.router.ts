/**
 * Router tRPC — ECE Mapa de Camas Hospitalarias.
 *
 * Norma: MINSAL Acuerdo n.° 1616 (2024), §3 — Gestión de recursos hospitalarios.
 * Código de módulo: ECE-CAMAS.
 * Responsabilidad: vista en tiempo real del estado de cada cama por servicio,
 *   métricas de ocupación, y transiciones manuales de estado operativo.
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (estados de cama)
 * ---------------------------------------------------------------------------
 *   Estados de cama (public."Bed".status — enum BedStatus):
 *     FREE → DIRTY → FREE              (ciclo post-alta)
 *     FREE → MAINTENANCE → FREE        (ciclo correctivo)
 *
 *   El frontend recibe nombres en español:
 *     FREE        → libre
 *     DIRTY       → limpieza
 *     MAINTENANCE → mantenimiento
 *     OCCUPIED    → ocupada
 *
 *   "ocupada" tiene prioridad sobre el status físico: si hay
 *   ece.asignacion_cama activa, la cama se marca como ocupada aunque su
 *   `status` físico diga otra cosa.
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — mezcla schema public + ece)
 * ---------------------------------------------------------------------------
 *   public."Bed"              — catálogo de camas: code, serviceUnitId, status
 *   public."ServiceUnit"      — servicio/área donde está la cama (sustituye al
 *                               legacy "Ward" que NO existe en este schema)
 *   public."Patient"          — datos del paciente (firstName, lastName)
 *   ece.asignacion_cama       — asignaciones activas: cama_id, episodio_id, activa
 *   ece.episodio_hospitalario — para join con paciente via episodio_atencion
 *   ece.episodio_atencion     — datos base: paciente_id
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext } from "../../ece/workflow-context";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const estadoCamaManualEnum = z.enum(["libre", "limpieza", "mantenimiento"]);

const listEstadoCamasInput = z.object({
  servicioId: z.string().uuid(),
});

const estadoServicioInput = z.object({
  servicioId: z.string().uuid(),
});

const cambiarEstadoInput = z.object({
  camaId: z.string().uuid(),
  nuevoEstado: estadoCamaManualEnum,
  observacion: z.string().trim().max(500).optional(),
});

// ─── Tipos de fila raw ────────────────────────────────────────────────────────

export type EstadoCama = "libre" | "ocupada" | "limpieza" | "mantenimiento";

export interface CamaEstadoRow {
  camaId: string;
  codigo: string;
  servicio: string;
  estado: EstadoCama;
  pacienteNombre: string | null;
  episodioId: string | null;
  asignadaDesde: Date | null;
}

interface CamaRaw {
  cama_id: string;
  codigo: string;
  servicio: string;
  status_bd: string | null;
  asignacion_id: string | null;
  paciente_nombre: string | null;
  episodio_id: string | null;
  asignada_desde: Date | null;
}

interface MetricaRaw {
  total: bigint;
  libres: bigint;
  ocupadas: bigint;
  limpieza: bigint;
  mantenimiento: bigint;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mapea BedStatus (enum DB) + ocupación derivada → estado frontend. */
function resolverEstado(statusBd: string | null, ocupada: boolean): EstadoCama {
  if (ocupada) return "ocupada";
  if (statusBd === "DIRTY") return "limpieza";
  if (statusBd === "MAINTENANCE") return "mantenimiento";
  return "libre"; // FREE, BLOCKED, RESERVED y null caen a "libre" (legibilidad UX)
}

/** Inverso: estado frontend → BedStatus enum DB. */
function estadoFrontendABedStatus(estado: "libre" | "limpieza" | "mantenimiento"): string {
  switch (estado) {
    case "libre":         return "FREE";
    case "limpieza":      return "DIRTY";
    case "mantenimiento": return "MAINTENANCE";
  }
}

function withEceCtx(ctx: {
  tenant: { establishmentId?: string };
}) {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Tu cuenta no tiene un establecimiento activo. Solicita al administrador asignarte a un hospital o registrar un establecimiento en tu organización.",
    });
  }
  return ctx.tenant.establishmentId;
}

// ─── Tipos adicionales ────────────────────────────────────────────────────────

export interface ServicioMapRow {
  servicioId: string;
  servicioNombre: string;
  camas: CamaEstadoRow[];
}

interface ServicioRaw {
  servicio_id: string;
  servicio_nombre: string;
}

// ─── Base procedures ──────────────────────────────────────────────────────────

const readBase = requireRole(["NURSE", "ADM", "ADMIN", "ADMIN_CLINICO", "PHYSICIAN", "DIR"]);
const writeBase = requireRole(["NURSE", "ADM", "ADMIN", "ADMIN_CLINICO"]);

// ─── Router ──────────────────────────────────────────────────────────────────

export const eceCamaRouter = router({
  /**
   * Lista todas las camas de un servicio con su estado en tiempo real.
   */
  listEstadoCamas: readBase
    .input(listEstadoCamasInput)
    .query(async ({ ctx, input }) => {
      const establecimientoId = withEceCtx(ctx);

      return withWorkflowContext(ctx.prisma, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<CamaRaw[]>`
          SELECT
            b.id::text                               AS cama_id,
            b.code                                   AS codigo,
            COALESCE(su.name, b."serviceUnitId"::text) AS servicio,
            b."status"::text                         AS status_bd,
            ac.id::text                              AS asignacion_id,
            CONCAT(p."firstName", ' ', p."lastName") AS paciente_nombre,
            ea.id::text                              AS episodio_id,
            ac.fecha_asignacion                      AS asignada_desde
          FROM public."Bed" b
          LEFT JOIN public."ServiceUnit" su ON su.id = b."serviceUnitId"
          LEFT JOIN ece.asignacion_cama ac
            ON ac.cama_id = b.id AND ac.activa = true
          LEFT JOIN ece.episodio_hospitalario eh
            ON eh.id = ac.episodio_hospitalario_id
          LEFT JOIN ece.episodio_atencion ea
            ON ea.id = eh.episodio_atencion_id
          LEFT JOIN public."Patient" p
            ON p.id = ea.paciente_id
          WHERE b."serviceUnitId" = ${input.servicioId}::uuid
          ORDER BY b.code ASC
        `;

        return rows.map((r): CamaEstadoRow => ({
          camaId: r.cama_id,
          codigo: r.codigo,
          servicio: r.servicio,
          estado: resolverEstado(r.status_bd, r.asignacion_id !== null),
          pacienteNombre: r.paciente_nombre ?? null,
          episodioId: r.episodio_id ?? null,
          asignadaDesde: r.asignada_desde ?? null,
        }));
      });
    }),

  /**
   * Devuelve métricas agregadas del servicio.
   */
  estadoServicio: readBase
    .input(estadoServicioInput)
    .query(async ({ ctx, input }) => {
      const establecimientoId = withEceCtx(ctx);

      return withWorkflowContext(ctx.prisma, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<MetricaRaw[]>`
          SELECT
            COUNT(*)                                          AS total,
            COUNT(*) FILTER (
              WHERE ac.id IS NULL
                AND (b."status" IS NULL OR b."status" = 'FREE')
            )                                                AS libres,
            COUNT(*) FILTER (WHERE ac.id IS NOT NULL)        AS ocupadas,
            COUNT(*) FILTER (
              WHERE ac.id IS NULL AND b."status" = 'DIRTY'
            )                                                AS limpieza,
            COUNT(*) FILTER (
              WHERE ac.id IS NULL AND b."status" = 'MAINTENANCE'
            )                                                AS mantenimiento
          FROM public."Bed" b
          LEFT JOIN ece.asignacion_cama ac
            ON ac.cama_id = b.id AND ac.activa = true
          WHERE b."serviceUnitId" = ${input.servicioId}::uuid
        `;

        const m = rows[0];
        if (!m) {
          return { totalCamas: 0, libres: 0, ocupadas: 0, limpieza: 0, mantenimiento: 0 };
        }

        return {
          totalCamas:    Number(m.total),
          libres:        Number(m.libres),
          ocupadas:      Number(m.ocupadas),
          limpieza:      Number(m.limpieza),
          mantenimiento: Number(m.mantenimiento),
        };
      });
    }),

  /**
   * Mapa completo agrupado por servicio.
   * Shape compatible con el legacy bed.getMap para migración transparente.
   */
  mapCompleto: readBase
    .query(async ({ ctx }) => {
      const establecimientoId = withEceCtx(ctx);

      return withWorkflowContext(ctx.prisma, establecimientoId, async (tx) => {
        // Obtener servicios con camas activas
        const servicios = await tx.$queryRaw<ServicioRaw[]>`
          SELECT DISTINCT
            su.id::text   AS servicio_id,
            su.name       AS servicio_nombre
          FROM public."ServiceUnit" su
          JOIN public."Bed" b ON b."serviceUnitId" = su.id
          WHERE b.active = true
          ORDER BY su.name ASC
        `;

        if (servicios.length === 0) return [];

        // Una sola query para todas las camas de todos los servicios
        const todasCamas = await tx.$queryRaw<(CamaRaw & { service_unit_id: string })[]>`
          SELECT
            b.id::text                               AS cama_id,
            b.code                                   AS codigo,
            su.name                                  AS servicio,
            su.id::text                              AS service_unit_id,
            b."status"::text                         AS status_bd,
            ac.id::text                              AS asignacion_id,
            CONCAT(p."firstName", ' ', p."lastName") AS paciente_nombre,
            ea.id::text                              AS episodio_id,
            ac.fecha_asignacion                      AS asignada_desde
          FROM public."Bed" b
          JOIN public."ServiceUnit" su ON su.id = b."serviceUnitId"
          LEFT JOIN ece.asignacion_cama ac
            ON ac.cama_id = b.id AND ac.activa = true
          LEFT JOIN ece.episodio_hospitalario eh
            ON eh.id = ac.episodio_hospitalario_id
          LEFT JOIN ece.episodio_atencion ea
            ON ea.id = eh.episodio_atencion_id
          LEFT JOIN public."Patient" p
            ON p.id = ea.paciente_id
          WHERE b.active = true
          ORDER BY su.name ASC, b.code ASC
        `;

        // Agrupar en memoria por servicio
        const camasPorServicio = new Map<string, CamaEstadoRow[]>();
        for (const r of todasCamas) {
          const grupo = camasPorServicio.get(r.service_unit_id) ?? [];
          grupo.push({
            camaId: r.cama_id,
            codigo: r.codigo,
            servicio: r.servicio,
            estado: resolverEstado(r.status_bd, r.asignacion_id !== null),
            pacienteNombre: r.paciente_nombre ?? null,
            episodioId: r.episodio_id ?? null,
            asignadaDesde: r.asignada_desde ?? null,
          });
          camasPorServicio.set(r.service_unit_id, grupo);
        }

        return servicios
          .filter((s) => (camasPorServicio.get(s.servicio_id)?.length ?? 0) > 0)
          .map((s): ServicioMapRow => ({
            servicioId: s.servicio_id,
            servicioNombre: s.servicio_nombre,
            camas: camasPorServicio.get(s.servicio_id) ?? [],
          }));
      });
    }),

  /**
   * Cambia el estado físico de una cama (libre / limpieza / mantenimiento).
   * No puede aplicarse si la cama tiene una asignación activa (ya está ocupada).
   */
  cambiarEstado: writeBase
    .input(cambiarEstadoInput)
    .mutation(async ({ ctx, input }) => {
      const establecimientoId = withEceCtx(ctx);

      return withWorkflowContext(ctx.prisma, establecimientoId, async (tx) => {
        // Verificar que la cama no esté ocupada
        const activas = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text
          FROM ece.asignacion_cama
          WHERE cama_id = ${input.camaId}::uuid
            AND activa = true
          LIMIT 1
        `;

        if (activas.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "La cama está actualmente ocupada. Libere la asignación antes de cambiar su estado.",
          });
        }

        const nuevoStatus = estadoFrontendABedStatus(input.nuevoEstado);

        const updated = await tx.$queryRaw<{ id: string }[]>`
          UPDATE public."Bed"
          SET "status" = ${nuevoStatus}::"BedStatus", "updatedAt" = now()
          WHERE id = ${input.camaId}::uuid
          RETURNING id::text
        `;

        if (updated.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Cama no encontrada: ${input.camaId}`,
          });
        }

        return {
          camaId: updated[0]!.id,
          nuevoEstado: input.nuevoEstado,
          observacion: input.observacion ?? null,
        };
      });
    }),
});
