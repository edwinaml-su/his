/**
 * Router tRPC — Dashboard Maternidad (NTEC Art. 25).
 *
 * Expone 4 procedures de solo lectura para el dashboard operacional
 * del jefe de servicio de maternidad. Todas las queries trabajan sobre
 * tablas ECE existentes (ece.episodio_atencion, ece.sala_expulsion,
 * ece.partograma_registro) y el outbox de dominio (public.domain_events).
 *
 * No materializa vistas — computa KPIs en tiempo real con $queryRaw.
 *
 * RLS: withWorkflowContext con demoteRole=true (rol authenticated, tenant-scoped).
 */
import { router, requireRole } from "../../trpc";
import { withWorkflowContext } from "../../workflow/context";
import type { TenantContext } from "@his/contracts";
import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Tipos de retorno (snake_case: viene directo de raw SQL)
// ---------------------------------------------------------------------------

export interface ObstetriciaKpis {
  partos_hoy: number;
  partos_pendientes: number;
  cesareas_hoy: number;
  fallecidos_maternos_hoy: number;
}

export interface SalaExpulsionStatus {
  id: string;
  codigo: string;
  tipo: string;
  /** libre | ocupada | limpieza */
  estado: string;
  paciente_nombre: string | null;
  minutos_en_sala: number | null;
  dilatacion_cm: number | null;
}

export interface AlertaObstetrica {
  id: string;
  tipo: string;
  paciente_nombre: string;
  sala_codigo: string;
  minutos_transcurridos: number;
  mensaje: string;
}

export interface EpisodioLaborActiva {
  id: string;
  paciente_nombre: string;
  semanas_gestacion: number | null;
  hora_ingreso: string;
  motivo: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEceCtx(tenant: TenantContext, userId: string) {
  return {
    personalId: userId,
    establecimientoId: tenant.establishmentId ?? tenant.organizationId,
  };
}

async function readWithContext<T>(
  prisma: PrismaClient,
  tenant: TenantContext,
  userId: string,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  // demoteRole=true (default): aplica RLS con rol authenticated
  return withWorkflowContext(prisma, buildEceCtx(tenant, userId), fn);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const jefeProcedure = requireRole(["PHYSICIAN", "NURSE", "HEAD_NURSE", "MC"]);

export const eceObstetriciaRouter = router({
  /**
   * KPIs del turno actual:
   *   - partos_hoy: nacimientos registrados hoy (sala_expulsion)
   *   - partos_pendientes: episodios en labor activa sin nacimiento registrado
   *   - cesareas_hoy: partos tipo cesarea_emergencia o cesarea_programada hoy
   *   - fallecidos_maternos_hoy: eventos ece.muerte.materna emitidos hoy
   */
  kpis: jefeProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    return readWithContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
      const rows = await (tx.$queryRaw as (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<Array<{
        partos_hoy: bigint;
        partos_pendientes: bigint;
        cesareas_hoy: bigint;
        fallecidos_maternos_hoy: bigint;
      }>>)`
        SELECT
          -- Nacimientos registrados hoy
          (SELECT COUNT(*)
             FROM ece.sala_expulsion
            WHERE nacimiento_ts::date = CURRENT_DATE
          ) AS partos_hoy,

          -- Episodios obstétricos en labor activa (sin nacimiento aún)
          (SELECT COUNT(*)
             FROM ece.episodio_atencion ea
            WHERE ea.tipo_episodio = 'obstetrico'
              AND ea.estado NOT IN ('cerrado', 'dado_alta', 'fallecido')
              AND NOT EXISTS (
                SELECT 1 FROM ece.sala_expulsion se
                 WHERE se.episodio_hospitalario_id = ea.id
              )
          ) AS partos_pendientes,

          -- Cesáreas de hoy
          (SELECT COUNT(*)
             FROM ece.sala_expulsion
            WHERE nacimiento_ts::date = CURRENT_DATE
              AND tipo_parto IN ('cesarea_emergencia', 'cesarea_programada')
          ) AS cesareas_hoy,

          -- Muertes maternas registradas hoy (domain_events outbox)
          (SELECT COUNT(*)
             FROM public.domain_events
            WHERE event_type = 'ece.muerte.materna'
              AND created_at::date = CURRENT_DATE
          ) AS fallecidos_maternos_hoy
      `;

      const r = rows[0];
      return {
        partos_hoy: Number(r?.partos_hoy ?? 0),
        partos_pendientes: Number(r?.partos_pendientes ?? 0),
        cesareas_hoy: Number(r?.cesareas_hoy ?? 0),
        fallecidos_maternos_hoy: Number(r?.fallecidos_maternos_hoy ?? 0),
      } satisfies ObstetriciaKpis;
    });
  }),

  /**
   * Estado de salas de expulsión/pre-parto/post-parto.
   *
   * Datos base de ece.sala_expulsion JOIN ece.episodio_atencion.
   * Si no existe tabla ece.sala_obs_config (catálogo de salas), devuelve
   * las salas inferidas de episodios activos más un placeholder de libres.
   *
   * Nota: cuando la BD tenga ece.sala_obs_config, esta query se simplifica
   * a un LEFT JOIN. Por ahora deriva el estado de la actividad.
   */
  salas: jefeProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    return readWithContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
      return (tx.$queryRaw as (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<SalaExpulsionStatus[]>)`
        SELECT
          ea.id,
          COALESCE(ea.numero_cama, 'SIN-SALA') AS codigo,
          COALESCE(ea.tipo_unidad, 'expulsion')  AS tipo,
          CASE
            WHEN ea.estado IN ('cerrado', 'dado_alta', 'fallecido') THEN 'limpieza'
            ELSE 'ocupada'
          END AS estado,
          CONCAT(p.primer_apellido, ', ', p.primer_nombre) AS paciente_nombre,
          EXTRACT(EPOCH FROM (now() - ea.fecha_ingreso_unidad)) / 60 AS minutos_en_sala,
          pr.dilatacion_cm
        FROM ece.episodio_atencion ea
        JOIN public."Patient" p ON p.id = ea.paciente_id
        LEFT JOIN LATERAL (
          SELECT dilatacion_cm
            FROM ece.partograma_registro
           WHERE episodio_id = ea.id
           ORDER BY registrado_en DESC
           LIMIT 1
        ) pr ON true
        WHERE ea.tipo_episodio = 'obstetrico'
          AND ea.fecha_ingreso_unidad IS NOT NULL
          AND ea.fecha_ingreso_unidad::date = CURRENT_DATE
        ORDER BY ea.fecha_ingreso_unidad DESC
        LIMIT 50
      `;
    });
  }),

  /**
   * Alertas clínicas activas leídas de domain_events.
   *
   * Tipos: ece.partograma.alerta (zona_alerta / zona_accion),
   *        ece.alumbramiento.tardio, ece.hemorragia.postparto.sospecha
   *
   * Solo eventos de las últimas 24 h sin evento de cierre correlacionado.
   */
  alertas: jefeProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    return readWithContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
      return (tx.$queryRaw as (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<AlertaObstetrica[]>)`
        SELECT
          de.id,
          de.event_type                                              AS tipo,
          COALESCE(
            de.payload->>'pacienteNombre',
            de.payload->>'nombre_paciente',
            'Paciente desconocida'
          )                                                          AS paciente_nombre,
          COALESCE(de.payload->>'salaCodigo', de.payload->>'sala_codigo', '') AS sala_codigo,
          EXTRACT(EPOCH FROM (now() - de.created_at)) / 60          AS minutos_transcurridos,
          COALESCE(de.payload->>'mensaje', de.event_type)            AS mensaje
        FROM public.domain_events de
        WHERE de.event_type IN (
          'ece.partograma.alerta',
          'ece.alumbramiento.tardio',
          'ece.hemorragia.postparto.sospecha',
          'ece.hpp.activo',
          'ece.distocia.detectada'
        )
          AND de.created_at >= now() - interval '24 hours'
          -- Excluir alertas que ya tienen evento de cierre
          AND NOT EXISTS (
            SELECT 1 FROM public.domain_events cierre
             WHERE cierre.event_type = de.event_type || '.cerrado'
               AND cierre.aggregate_id = de.aggregate_id
               AND cierre.created_at > de.created_at
          )
        ORDER BY de.created_at DESC
        LIMIT 20
      `;
    });
  }),

  /**
   * Episodios obstétricos en labor activa (cola de trabajo).
   *
   * Excluye los ya con nacimiento registrado (cerrados fisiológicamente).
   */
  cola: jefeProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    return readWithContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
      return (tx.$queryRaw as (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<EpisodioLaborActiva[]>)`
        SELECT
          ea.id,
          CONCAT(p.primer_apellido, ', ', p.primer_nombre) AS paciente_nombre,
          (ea.payload->>'semanas_gestacion')::int           AS semanas_gestacion,
          TO_CHAR(ea.fecha_ingreso_unidad, 'HH24:MI')       AS hora_ingreso,
          ea.motivo_ingreso                                  AS motivo
        FROM ece.episodio_atencion ea
        JOIN public."Patient" p ON p.id = ea.paciente_id
        WHERE ea.tipo_episodio = 'obstetrico'
          AND ea.estado NOT IN ('cerrado', 'dado_alta', 'fallecido')
          AND NOT EXISTS (
            SELECT 1 FROM ece.sala_expulsion se
             WHERE se.episodio_hospitalario_id = ea.id
          )
        ORDER BY ea.fecha_ingreso_unidad ASC
        LIMIT 30
      `;
    });
  }),
});
