/**
 * Router tRPC — ECE Mapa de Camas Hospitalarias.
 *
 * Norma: MINSAL Acuerdo n.° 1616 (2024), §3 — Gestión de recursos hospitalarios.
 * Código de módulo: ECE-CAMAS.
 * Responsabilidad: vista en tiempo real del estado de cada cama por servicio,
 *   métricas de ocupación, y transiciones manuales de estado operativo.
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (estados de cama — no es workflow de documento NTEC)
 * ---------------------------------------------------------------------------
 *   Estados de cama (public."Bed".estadoManual):
 *     libre → limpieza → libre   (ciclo post-alta)
 *     libre → mantenimiento → libre (ciclo correctivo)
 *
 *   Estado "ocupada" es derivado: se infiere de la existencia de una fila
 *   en ece.asignacion_cama con estado 'activa'. Tiene prioridad sobre
 *   estadoManual: una cama con asignación activa siempre es "ocupada".
 *
 *   Las asignaciones se crean en el bridge-admision.router.ts y se liberan
 *   en episodio-hospitalario.router.ts (confirmarAlta). Este router solo
 *   gestiona transiciones manuales de estado operativo.
 *
 * ---------------------------------------------------------------------------
 * OUTBOX
 * ---------------------------------------------------------------------------
 *   No emite eventos de dominio. Los cambios de estado de cama son operativos,
 *   no generan eventos clínicos ni notificaciones (Beta.15).
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — mezcla schema public + ece)
 * ---------------------------------------------------------------------------
 *   public."Bed"              — catálogo de camas: codigo, servicio_id,
 *                               tipo_cama, "estadoManual"
 *   ece.asignacion_cama       — asignaciones activas: cama_id, episodio_id,
 *                               estado ('activa'|'liberada'), fecha_asignacion
 *   ece.episodio_hospitalario — para join con paciente (via episodio_atencion)
 *   ece.episodio_atencion     — datos base: paciente_id
 *   public."Patient"          — nombre y documento del paciente
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   listEstadoCamas  → requireRole(["NURSE","ADM","PHYSICIAN"])
 *   estadoServicio   → requireRole(["NURSE","ADM","PHYSICIAN"])
 *   cambiarEstado    → requireRole(["NURSE","ADM"])
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
