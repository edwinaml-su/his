/**
 * ece.cama — Router tRPC para el Mapa de Camas.
 *
 * Tablas operadas (raw SQL, schema ece + público):
 *   public."Bed"             — catálogo de camas (código, servicio_id)
 *   ece.asignacion_cama      — asignaciones activas (episodio → cama)
 *   ece.episodio_hospitalario — episodio hospitalario (vincula paciente)
 *   ece.episodio_atencion    — datos base del episodio (paciente_id)
 *   public."Patient"         — nombre del paciente
 *
 * Procedures:
 *   listEstadoCamas  — query: lista camas del servicio con su estado en tiempo real
 *   estadoServicio   — query: métricas agregadas (totales, libres, ocupadas…)
 *   cambiarEstado    — mutation: transición manual (libre↔limpieza↔mantenimiento)
 *
 * Roles:
 *   listEstadoCamas, estadoServicio → NURSE | ADM | PHYSICIAN
 *   cambiarEstado                   → NURSE | ADM
 *
 * Nota: "ocupada" se deriva de la existencia de una asignacion_cama activa.
 * Los estados manuales (limpieza/mantenimiento) viven en public."Bed".estadoManual.
 * Si una cama tiene asignación activa, su estado es "ocupada" con independencia
 * del estadoManual.
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
  estado_manual: string | null;
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

// ─── Helper privado ───────────────────────────────────────────────────────────

function resolverEstado(estadoManual: string | null, ocupada: boolean): EstadoCama {
  if (ocupada) return "ocupada";
  if (estadoManual === "limpieza") return "limpieza";
  if (estadoManual === "mantenimiento") return "mantenimiento";
  return "libre";
}

function withEceCtx(ctx: {
  tenant: { establishmentId?: string };
}) {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere establecimiento activo para consultar el mapa de camas.",
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

const readBase = requireRole(["NURSE", "ADM", "PHYSICIAN"]);
const writeBase = requireRole(["NURSE", "ADM"]);

// ─── Router ──────────────────────────────────────────────────────────────────

export const eceCamaRouter = router({
  /**
   * Lista todas las camas de un servicio con su estado en tiempo real.
   *
   * Estado derivado:
   * - Si existe ece.asignacion_cama activa → "ocupada"
   * - Si no, usa Bed.estadoManual (libre / limpieza / mantenimiento)
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
            COALESCE(w.name, b."wardId"::text)       AS servicio,
            b."statusManual"                         AS estado_manual,
            ac.id::text                              AS asignacion_id,
            CONCAT(p."firstName", ' ', p."lastName1") AS paciente_nombre,
            ea.id::text                              AS episodio_id,
            ac.fecha_asignacion                      AS asignada_desde
          FROM public."Bed" b
          LEFT JOIN public."Ward" w ON w.id = b."wardId"
          LEFT JOIN ece.asignacion_cama ac
            ON ac.cama_id = b.id AND ac.activa = true
          LEFT JOIN ece.episodio_hospitalario eh
            ON eh.id = ac.episodio_hospitalario_id
          LEFT JOIN ece.episodio_atencion ea
            ON ea.id = eh.episodio_atencion_id
          LEFT JOIN public."Patient" p
            ON p.id = ea.paciente_id
          WHERE b."wardId" = ${input.servicioId}::uuid
          ORDER BY b.code ASC
        `;

        return rows.map((r): CamaEstadoRow => ({
          camaId: r.cama_id,
          codigo: r.codigo,
          servicio: r.servicio,
          estado: resolverEstado(r.estado_manual, r.asignacion_id !== null),
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
                AND (b."statusManual" IS NULL OR b."statusManual" = 'libre')
            )                                                AS libres,
            COUNT(*) FILTER (WHERE ac.id IS NOT NULL)        AS ocupadas,
            COUNT(*) FILTER (
              WHERE ac.id IS NULL AND b."statusManual" = 'limpieza'
            )                                                AS limpieza,
            COUNT(*) FILTER (
              WHERE ac.id IS NULL AND b."statusManual" = 'mantenimiento'
            )                                                AS mantenimiento
          FROM public."Bed" b
          LEFT JOIN ece.asignacion_cama ac
            ON ac.cama_id = b.id AND ac.activa = true
          WHERE b."wardId" = ${input.servicioId}::uuid
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
            w.id::text   AS servicio_id,
            w.name       AS servicio_nombre
          FROM public."Ward" w
          JOIN public."Bed" b ON b."wardId" = w.id
          WHERE b.active = true
          ORDER BY w.name ASC
        `;

        if (servicios.length === 0) return [];

        // Una sola query para todas las camas de todos los servicios
        const todasCamas = await tx.$queryRaw<(CamaRaw & { ward_id: string })[]>`
          SELECT
            b.id::text                               AS cama_id,
            b.code                                   AS codigo,
            w.name                                   AS servicio,
            w.id::text                               AS ward_id,
            b."statusManual"                         AS estado_manual,
            ac.id::text                              AS asignacion_id,
            CONCAT(p."firstName", ' ', p."lastName1") AS paciente_nombre,
            ea.id::text                              AS episodio_id,
            ac.fecha_asignacion                      AS asignada_desde
          FROM public."Bed" b
          JOIN public."Ward" w ON w.id = b."wardId"
          LEFT JOIN ece.asignacion_cama ac
            ON ac.cama_id = b.id AND ac.activa = true
          LEFT JOIN ece.episodio_hospitalario eh
            ON eh.id = ac.episodio_hospitalario_id
          LEFT JOIN ece.episodio_atencion ea
            ON ea.id = eh.episodio_atencion_id
          LEFT JOIN public."Patient" p
            ON p.id = ea.paciente_id
          WHERE b.active = true
          ORDER BY w.name ASC, b.code ASC
        `;

        // Agrupar en memoria por servicio
        const camasPorServicio = new Map<string, CamaEstadoRow[]>();
        for (const r of todasCamas) {
          const grupo = camasPorServicio.get(r.ward_id) ?? [];
          grupo.push({
            camaId: r.cama_id,
            codigo: r.codigo,
            servicio: r.servicio,
            estado: resolverEstado(r.estado_manual, r.asignacion_id !== null),
            pacienteNombre: r.paciente_nombre ?? null,
            episodioId: r.episodio_id ?? null,
            asignadaDesde: r.asignada_desde ?? null,
          });
          camasPorServicio.set(r.ward_id, grupo);
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
   * Cambia el estado manual de una cama (libre / limpieza / mantenimiento).
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

        const nuevoEstadoManual = input.nuevoEstado === "libre" ? null : input.nuevoEstado;

        const updated = await tx.$queryRaw<{ id: string }[]>`
          UPDATE public."Bed"
          SET "statusManual" = ${nuevoEstadoManual}
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
