/**
 * Bedside Ronda Router — Modo Rondas Enfermería (US.F2.6.46, 50, 51)
 *
 * Gestiona sesiones de ronda de enfermería: inicio, pausa, reanudación,
 * avance entre indicaciones y cierre. Dos modos de ordenamiento:
 *  - POR_HORA      → indicaciones ordenadas por hora programada ASC
 *  - POR_UBICACION → camas ordenadas por servicio + número ascendente
 *
 * Estado de sesión persiste en ece.ronda_session (tolerante a reconexión,
 * compatible con pausa por urgencias). Inactividad > 5 min → sesión suspendida.
 *
 * Usa withTenantContext mandatorio para RLS en toda operación de escritura.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Tipos de dominio
// ---------------------------------------------------------------------------

export type RondaModo = "POR_HORA" | "POR_UBICACION";

export interface IndicacionRonda {
  indicacionId: string;
  patientId: string;
  patientGsrn: string | null;
  cama: string | null;
  servicio: string | null;
  horaProgramada: Date | null;
  gtin: string | null;
  completada: boolean;
}

export interface RondaSessionState {
  id: string;
  modo: RondaModo;
  iniciadoEn: Date;
  pausadoEn: Date | null;
  reanudadoEn: Date | null;
  completadoEn: Date | null;
  totalPacientes: number;
  indicacionesPending: IndicacionRonda[];
  indicacionesCompletadas: IndicacionRonda[];
}

// ---------------------------------------------------------------------------
// Raw row types de $queryRawUnsafe
// ---------------------------------------------------------------------------

interface RondaSessionRow {
  id: string;
  modo: string;
  iniciado_en: Date;
  pausado_en: Date | null;
  reanudado_en: Date | null;
  completado_en: Date | null;
  total_pacientes: number;
  indicaciones_pending: unknown;
  indicaciones_completadas: unknown;
}

interface IndicacionPendienteRow {
  indicacion_id: string;
  patient_id: string;
  patient_gsrn: string | null;
  cama: string | null;
  servicio: string | null;
  hora_programada: Date | null;
  gtin: string | null;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const startInput = z.object({
  modo: z.enum(["POR_HORA", "POR_UBICACION"]).default("POR_HORA"),
});

const pauseInput = z.object({
  sessionId: z.string().uuid(),
});

const resumeInput = z.object({
  sessionId: z.string().uuid(),
});

const nextIndicationInput = z.object({
  sessionId: z.string().uuid(),
  indicacionId: z.string(),
});

const completeInput = z.object({
  sessionId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ordena las indicaciones según el modo seleccionado.
 *
 * POR_HORA: ordenadas por hora_programada ASC (NULLS LAST).
 * POR_UBICACION: por servicio alphabético + número de cama ASC numérico,
 *   con tie-break por hora_programada para camas con múltiples indicaciones.
 */
export function ordenarIndicaciones(
  items: IndicacionRonda[],
  modo: RondaModo,
): IndicacionRonda[] {
  const copy = [...items];
  if (modo === "POR_HORA") {
    return copy.sort((a, b) => {
      if (!a.horaProgramada && !b.horaProgramada) return 0;
      if (!a.horaProgramada) return 1;
      if (!b.horaProgramada) return -1;
      return a.horaProgramada.getTime() - b.horaProgramada.getTime();
    });
  }
  // POR_UBICACION: servicio ASC → número cama ASC numérico → hora ASC
  return copy.sort((a, b) => {
    const svcCmp = (a.servicio ?? "").localeCompare(b.servicio ?? "", "es");
    if (svcCmp !== 0) return svcCmp;
    // Extraer número de la cama para comparar numéricamente
    const numA = parseInt((a.cama ?? "").replace(/\D/g, "") || "0", 10);
    const numB = parseInt((b.cama ?? "").replace(/\D/g, "") || "0", 10);
    if (numA !== numB) return numA - numB;
    // Tie-break: camas idénticas → por hora
    if (!a.horaProgramada && !b.horaProgramada) return 0;
    if (!a.horaProgramada) return 1;
    if (!b.horaProgramada) return -1;
    return a.horaProgramada.getTime() - b.horaProgramada.getTime();
  });
}

function rowToSession(row: RondaSessionRow): RondaSessionState {
  return {
    id: row.id,
    modo: row.modo as RondaModo,
    iniciadoEn: new Date(row.iniciado_en),
    pausadoEn: row.pausado_en ? new Date(row.pausado_en) : null,
    reanudadoEn: row.reanudado_en ? new Date(row.reanudado_en) : null,
    completadoEn: row.completado_en ? new Date(row.completado_en) : null,
    totalPacientes: row.total_pacientes,
    indicacionesPending: parseJsonArray(row.indicaciones_pending),
    indicacionesCompletadas: parseJsonArray(row.indicaciones_completadas),
  };
}

function parseJsonArray(raw: unknown): IndicacionRonda[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as IndicacionRonda[];
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw as IndicacionRonda[];
  return [];
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const bedsideRondaRouter = router({
  /**
   * Inicia una nueva sesión de ronda para el usuario activo.
   * Cancela cualquier sesión activa previa del mismo usuario.
   *
   * Carga las indicaciones pendientes del turno, las ordena según `modo`
   * y persiste la sesión en ece.ronda_session.
   */
  start: tenantProcedure
    .input(startInput)
    .mutation(async ({ ctx, input }): Promise<{ session: RondaSessionState }> => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      // Cargar indicaciones pendientes del turno (misma lógica que shiftQueue)
      const indicRows = await ctx.prisma.$queryRawUnsafe<IndicacionPendienteRow[]>(
        `SELECT
           i.id                        AS indicacion_id,
           i.patient_id,
           g.codigo                    AS patient_gsrn,
           b.codigo                    AS cama,
           b.servicio                  AS servicio,
           i.proxima_administracion    AS hora_programada,
           i.gtin_medicamento          AS gtin
         FROM ece.indicaciones_medicas i
         LEFT JOIN ece.gs1_gsrn g ON g.referencia_id = i.patient_id
                                  AND g.tipo = 'paciente' AND g.activo = true
         LEFT JOIN ece.gs1_gln_beds b ON b.patient_id = i.patient_id
         WHERE i.organization_id = $1::uuid
           AND i.estado = 'ACTIVA'
         ORDER BY i.proxima_administracion ASC NULLS LAST
         LIMIT 50`,
        orgId,
      );

      const indicaciones: IndicacionRonda[] = indicRows.map((r) => ({
        indicacionId: r.indicacion_id,
        patientId: r.patient_id,
        patientGsrn: r.patient_gsrn,
        cama: r.cama,
        servicio: r.servicio,
        horaProgramada: r.hora_programada ? new Date(r.hora_programada) : null,
        gtin: r.gtin,
        completada: false,
      }));

      const ordenadas = ordenarIndicaciones(indicaciones, input.modo);

      // Contar pacientes únicos
      const pacientesUnicos = new Set(ordenadas.map((i) => i.patientId)).size;

      const session = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Cerrar sesión activa previa del mismo usuario
        await tx.$executeRawUnsafe(
          `UPDATE ece.ronda_session
              SET completado_en = NOW()
            WHERE user_id = $1::uuid
              AND organization_id = $2::uuid
              AND completado_en IS NULL`,
          userId,
          orgId,
        );

        const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO ece.ronda_session
             (user_id, organization_id, modo, total_pacientes,
              indicaciones_pending, indicaciones_completadas)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, '[]'::jsonb)
           RETURNING id`,
          userId,
          orgId,
          input.modo,
          pacientesUnicos,
          JSON.stringify(ordenadas),
        );

        const sessionId = rows[0]!.id;
        const sessionRows = await tx.$queryRawUnsafe<RondaSessionRow[]>(
          `SELECT * FROM ece.ronda_session WHERE id = $1::uuid`,
          sessionId,
        );
        return rowToSession(sessionRows[0]!);
      });

      return { session };
    }),

  /**
   * Pausa la sesión activa. Registra pausado_en con timestamp actual.
   * La sesión puede reanudarse posteriormente con `resume`.
   */
  pause: tenantProcedure
    .input(pauseInput)
    .mutation(async ({ ctx, input }): Promise<{ session: RondaSessionState }> => {
      const orgId = ctx.tenant.organizationId;

      const session = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const rows = await tx.$queryRawUnsafe<RondaSessionRow[]>(
          `SELECT * FROM ece.ronda_session
            WHERE id = $1::uuid AND organization_id = $2::uuid
              AND completado_en IS NULL
            FOR UPDATE`,
          input.sessionId,
          orgId,
        );
        if (!rows[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sesión de ronda no encontrada o ya completada.",
          });
        }

        const updated = await tx.$queryRawUnsafe<RondaSessionRow[]>(
          `UPDATE ece.ronda_session
              SET pausado_en = NOW(), reanudado_en = NULL
            WHERE id = $1::uuid
            RETURNING *`,
          input.sessionId,
        );
        return rowToSession(updated[0]!);
      });

      return { session };
    }),

  /**
   * Reanuda una sesión pausada. Registra reanudado_en y limpia pausado_en.
   */
  resume: tenantProcedure
    .input(resumeInput)
    .mutation(async ({ ctx, input }): Promise<{ session: RondaSessionState }> => {
      const orgId = ctx.tenant.organizationId;

      const session = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const rows = await tx.$queryRawUnsafe<RondaSessionRow[]>(
          `SELECT * FROM ece.ronda_session
            WHERE id = $1::uuid AND organization_id = $2::uuid
              AND completado_en IS NULL
            FOR UPDATE`,
          input.sessionId,
          orgId,
        );
        if (!rows[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sesión de ronda no encontrada o ya completada.",
          });
        }
        if (!rows[0].pausado_en) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "La sesión no está pausada.",
          });
        }

        const updated = await tx.$queryRawUnsafe<RondaSessionRow[]>(
          `UPDATE ece.ronda_session
              SET pausado_en = NULL, reanudado_en = NOW()
            WHERE id = $1::uuid
            RETURNING *`,
          input.sessionId,
        );
        return rowToSession(updated[0]!);
      });

      return { session };
    }),

  /**
   * Marca una indicación como completada y avanza al siguiente paciente.
   * Mueve la indicación de indicaciones_pending → indicaciones_completadas.
   * Si no quedan pendientes, marca la sesión como completada automáticamente.
   */
  nextIndication: tenantProcedure
    .input(nextIndicationInput)
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<{ session: RondaSessionState; rondaCompletada: boolean }> => {
        const orgId = ctx.tenant.organizationId;

        const result = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const rows = await tx.$queryRawUnsafe<RondaSessionRow[]>(
            `SELECT * FROM ece.ronda_session
              WHERE id = $1::uuid AND organization_id = $2::uuid
                AND completado_en IS NULL
              FOR UPDATE`,
            input.sessionId,
            orgId,
          );
          if (!rows[0]) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Sesión de ronda no encontrada o ya completada.",
            });
          }

          const current = rowToSession(rows[0]!);
          const indicIdx = current.indicacionesPending.findIndex(
            (i) => i.indicacionId === input.indicacionId,
          );

          if (indicIdx === -1) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Indicación ${input.indicacionId} no está en cola pendiente.`,
            });
          }

          // Mover de pending → completadas
          const indicacion = {
            ...current.indicacionesPending[indicIdx]!,
            completada: true,
          };
          const newPending = current.indicacionesPending.filter(
            (_, idx) => idx !== indicIdx,
          );
          const newCompletadas = [...current.indicacionesCompletadas, indicacion];

          const rondaCompletada = newPending.length === 0;
          const completadoEn = rondaCompletada ? "NOW()" : "NULL";

          const updated = await tx.$queryRawUnsafe<RondaSessionRow[]>(
            `UPDATE ece.ronda_session
                SET indicaciones_pending     = $2::jsonb,
                    indicaciones_completadas = $3::jsonb,
                    completado_en            = ${completadoEn}
              WHERE id = $1::uuid
              RETURNING *`,
            input.sessionId,
            JSON.stringify(newPending),
            JSON.stringify(newCompletadas),
          );

          return { session: rowToSession(updated[0]!), rondaCompletada };
        });

        return result;
      },
    ),

  /**
   * Completa (abandona) una sesión activa, registrando completado_en.
   * Usado cuando la enfermera decide terminar la ronda manualmente.
   */
  complete: tenantProcedure
    .input(completeInput)
    .mutation(async ({ ctx, input }): Promise<{ session: RondaSessionState }> => {
      const orgId = ctx.tenant.organizationId;

      const session = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const updated = await tx.$queryRawUnsafe<RondaSessionRow[]>(
          `UPDATE ece.ronda_session
              SET completado_en = NOW()
            WHERE id = $1::uuid AND organization_id = $2::uuid
              AND completado_en IS NULL
            RETURNING *`,
          input.sessionId,
          orgId,
        );
        if (!updated[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sesión de ronda no encontrada o ya completada.",
          });
        }
        return rowToSession(updated[0]!);
      });

      return { session };
    }),

  /**
   * Retorna la sesión activa del usuario (si existe).
   * Retorna null si no hay sesión activa.
   */
  current: tenantProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }): Promise<{ session: RondaSessionState | null }> => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      const rows = await ctx.prisma.$queryRawUnsafe<RondaSessionRow[]>(
        `SELECT * FROM ece.ronda_session
          WHERE user_id = $1::uuid AND organization_id = $2::uuid
            AND completado_en IS NULL
          ORDER BY iniciado_en DESC
          LIMIT 1`,
        userId,
        orgId,
      );

      if (!rows[0]) return { session: null };
      return { session: rowToSession(rows[0]!) };
    }),
});
