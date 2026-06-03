/**
 * Router tRPC — ECE Episodio Hospitalario (ciclo hospitalización → alta).
 *
 * Norma: MINSAL Acuerdo n.° 1616 (2024), §3 — Gestión del episodio hospitalario.
 * Complementa `eceEpisodioRouter` (apertura y transición genérica de episodios).
 * Este router cubre la fase de hospitalización activa hasta el alta médica firmada.
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (alta médica — dos pasos)
 * ---------------------------------------------------------------------------
 *   Paso 1 — iniciarAltaMedica (PHYSICIAN)
 *     Transición: episodio_atencion.estado → 'alta_pendiente'
 *     Acción: crea borrador de ece.epicrisis_egreso (EPICRISIS_EGRESO) para
 *             que el médico complete el resumen de egreso antes del alta formal.
 *     Outbox: emite `ece.episodio.altaIniciada`
 *
 *   Paso 2 — confirmarAlta (PHYSICIAN)
 *     Precondición: epicrisis_egreso.estado IN ('firmado','validado','certificado')
 *     Transición: episodio_atencion.estado → 'cerrado'
 *     Acción: libera ece.asignacion_cama (estado → 'liberada'),
 *             registra fecha_hora_egreso en ece.episodio_hospitalario,
 *             appends a ece.episodio_estado_log.
 *     Outbox: emite `ece.episodio.altaConfirmada`
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (emitDomainEvent dentro del callback de withWorkflowContext — HD-10)
 * ---------------------------------------------------------------------------
 *   'ece.episodio.altaIniciada'   — payload: { episodioId, pacienteId, medicoId, orgId }
 *   'ece.episodio.altaConfirmada' — payload: { episodioId, camaId, fechaEgreso, orgId }
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.episodio_atencion       — estado principal del episodio (motivo, estado)
 *   ece.episodio_hospitalario   — datos subtype: servicio_id, episodio_id (FK),
 *                                 fecha_hora_orden_ingreso, fecha_hora_egreso
 *   ece.asignacion_cama         — se libera al confirmar alta (estado 'liberada')
 *   ece.epicrisis_egreso        — se crea borrador al iniciar alta
 *   ece.episodio_estado_log     — bitácora inmutable append-only de transiciones
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   listActivos, getDetalle  → requireRole(["PHYSICIAN","NURSE","ADM"])
 *   iniciarAltaMedica        → requireRole(["PHYSICIAN"])
 *   confirmarAlta            → requireRole(["PHYSICIAN"])
 *
 * ---------------------------------------------------------------------------
 * DECISIONES DE SCHEMA (HD-07/08/09)
 * ---------------------------------------------------------------------------
 *   HD-07: columnas corregidas para alinear con BD real:
 *     - eh.episodio_id (BD) ← router usaba eh.episodio_atencion_id
 *     - eh.servicio_id (BD) ← router usaba eh.sala_id
 *     - eh.fecha_hora_orden_ingreso (BD) ← router usaba eh.fecha_ingreso
 *     - eh.fecha_hora_egreso (BD) ← router usaba eh.fecha_egreso
 *   HD-08: columnas gravedad y medico_tratante_id NO EXISTEN en ece.episodio_hospitalario.
 *     Eliminadas del SELECT/WHERE. Issue pendiente @AE para evaluar si se agregan
 *     via migración DDL en sprint posterior.
 *   HD-09: verificación de autoría médico == firmante epicrisis no implementable
 *     sin medico_tratante_id en BD. Documentado para sprint posterior junto a HD-08.
 *   HD-10: emitDomainEvent unificado dentro del mismo withWorkflowContext callback
 *     para garantizar atomicidad (un solo tx).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext } from "../../ece/workflow-context";
// emitDomainEvent: mismo import que episodio.router.ts (patrón establecido)
import { emitDomainEvent } from "@his/database";

// ─── Schemas Zod (inline — patrón de todos los routers ECE) ──────────────────
// Los tipos canónicos viven en @his/contracts/src/schemas/ece-episodio-hospitalario.ts
// La UI importa desde @his/contracts (barrel). Aquí se definen inline para
// evitar el ciclo de resolución que afecta al typecheck del worktree.

const motivoAltaEnum = z.enum(["mejoria", "traslado", "alta_voluntaria", "defuncion"]);

const listActivosInput = z.object({
  servicioId: z.string().uuid().optional(),
  fecha: z.coerce.date().optional(),
  // gravedad eliminado (HD-08): columna no existe en ece.episodio_hospitalario BD real.
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

const listAdmisionesInput = z.object({
  /** false = solo admisiones activas; true = incluye egresados (histórico). */
  incluirCerrados: z.boolean().default(false),
  /** Filtra por número de expediente o de admisión (ILIKE). */
  busqueda: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(200).default(100),
});

const listAdmisionesPorPacienteInput = z.object({
  /** HIS Patient.id (MPI). El router resuelve los ece.paciente vinculados (1:N por establecimiento). */
  patientId: z.string().uuid(),
  /** Default true para mostrar el histórico completo del paciente. */
  incluirCerrados: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(100),
});

const getDetalleAdmisionInput = z.object({
  /** id de ece.episodio_atencion (ambulatorio u hospitalario). */
  id: z.string().uuid(),
});

const getDetalleInput = z.object({
  id: z.string().uuid(),
});

const iniciarAltaMedicaInput = z.object({
  episodioId: z.string().uuid(),
  medicoAltaId: z.string().uuid(),
  fechaHoraAlta: z.coerce.date(),
  motivoAlta: motivoAltaEnum,
  instruccionesAlta: z.string().trim().min(1).max(5000),
});

const confirmarAltaInput = z.object({
  episodioId: z.string().uuid(),
  epicrisisId: z.string().uuid(),
});

// ─── Tipos de fila raw ────────────────────────────────────────────────────────
// Alias SQL mantienen nombres de campos UI para no romper componentes existentes.
// sala_id y fecha_ingreso son alias de servicio_id y fecha_hora_orden_ingreso respectivamente.

export interface EpisodioActivoRow {
  id: string;
  episodio_atencion_id: string;
  paciente_id: string;
  paciente_nombre: string;
  sala_id: string;           // alias de servicio_id en BD
  sala_nombre: string | null;
  cama_id: string | null;
  cama_codigo: string | null;
  fecha_ingreso: Date;       // alias de fecha_hora_orden_ingreso en BD
  estado: string;
  medico_nombre: string | null;
}

export interface EpisodioDetalleRow extends EpisodioActivoRow {
  motivo_ingreso: string;
  orden_ingreso_id: string;
  documentos_firmados_count: number;
}

/** Fila de admisión (episodio de atención) para el landing del ECE. */
export interface AdmisionRow {
  id: string;
  public_encounter_id: string | null;
  numero_expediente: string | null;
  modalidad: string;
  servicio_categoria: string | null;
  servicio_nombre: string | null;
  estado: string;
  fecha_inicio: Date;
  fecha_cierre: Date | null;
  /** true si existe ece.episodio_hospitalario → tiene página de detalle. */
  tiene_hospitalizacion: boolean;
}

/** Fila de admisión enriquecida con indicadores de contenido — usada en /patients/[id]. */
export interface AdmisionConContenidoRow extends AdmisionRow {
  procedimientos_count: number;
  lab_count: number;
  imagen_count: number;
  gabinete_count: number;
}

/** Detalle de admisión (ambulatoria u hospitalaria) — usado en /ece/admision/[id]. */
export interface AdmisionDetalleRow {
  id: string;
  public_encounter_id: string | null;
  paciente_id: string;
  paciente_nombre: string;
  modalidad: string;
  servicio_categoria: string | null;
  servicio_id: string | null;
  servicio_nombre: string | null;
  motivo: string | null;
  estado: string;
  fecha_inicio: Date;
  fecha_cierre: Date | null;
  disposicion: string | null;
  /** id de ece.episodio_hospitalario si existe; null para ambulatorias puras. */
  episodio_hospitalario_id: string | null;
  procedimientos_count: number;
  lab_count: number;
  imagen_count: number;
  gabinete_count: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withEceContext(ctx: {
  user: { id: string };
  tenant: { organizationId: string; establishmentId?: string; roleCodes: string[] };
}): { personalId: string; organizationId: string; establecimientoId: string } {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar episodios ECE.",
    });
  }
  return {
    personalId: ctx.user.id,
    organizationId: ctx.tenant.organizationId,
    establecimientoId: ctx.tenant.establishmentId,
  };
}

// ─── Base procedures ─────────────────────────────────────────────────────────

const readBase = requireRole(["PHYSICIAN", "NURSE", "ADM"]);
const physicianBase = requireRole(["PHYSICIAN"]);

// ─── Router ──────────────────────────────────────────────────────────────────

export const eceEpisodioHospitalarioRouter = router({
  /**
   * Lista episodios hospitalarios activos (en_curso), agrupables por servicio.
   * Filtros: servicioId, fecha ingreso.
   * Paginación cursor-based por id ASC.
   */
  listActivos: readBase.input(listActivosInput).query(async ({ ctx, input }) => {
    const ece = withEceContext(ctx);

    return withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
      const fechaStr = input.fecha ? input.fecha.toISOString().split("T")[0] : null;

      const rows = await tx.$queryRaw<EpisodioActivoRow[]>`
        SELECT
          eh.episodio_id::text,
          ea.id::text                    AS episodio_atencion_id,
          ea.paciente_id::text,
          COALESCE(p.numero_expediente, ea.paciente_id::text) AS paciente_nombre,
          eh.servicio_id::text           AS sala_id,
          srv.nombre                     AS sala_nombre,
          eh.cama_id::text,
          c.codigo                       AS cama_codigo,
          eh.fecha_hora_orden_ingreso    AS fecha_ingreso,
          ea.estado,
          NULL::text                     AS medico_nombre
        FROM ece.episodio_hospitalario eh
        JOIN ece.episodio_atencion ea ON ea.id = eh.episodio_id
        LEFT JOIN ece.paciente       p   ON p.id = ea.paciente_id
        LEFT JOIN ece.servicio       srv ON srv.id = eh.servicio_id
        LEFT JOIN ece.cama           c   ON c.id = eh.cama_id
        WHERE ea.establecimiento_id = ${ece.establecimientoId}::uuid
          AND ea.estado NOT IN ('cerrado', 'cancelado')
          AND (${input.servicioId ?? null}::uuid IS NULL
               OR eh.servicio_id = ${input.servicioId ?? null}::uuid)
          AND (${fechaStr}::date IS NULL
               OR eh.fecha_hora_orden_ingreso::date = ${fechaStr}::date)
          AND (${input.cursor ?? null}::uuid IS NULL
               OR eh.episodio_id > ${input.cursor ?? null}::uuid)
        ORDER BY eh.episodio_id ASC
        LIMIT ${input.limit + 1}
      `;

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
    });
  }),

  /**
   * Detalle completo de un episodio hospitalario:
   * paciente + cama + count de documentos firmados.
   */
  /**
   * Lista admisiones (episodios de atención) de TODAS las áreas, identificadas
   * por número de admisión (public_encounter_id) y número de expediente del
   * paciente. Por defecto solo activas (estado ≠ cerrado/cancelado);
   * incluirCerrados=true agrega el histórico de egresados.
   *
   * Nota: el nombre del paciente vive en el índice maestro HIS (bridge); aquí
   * se usa numero_expediente como identificador clínico estable de ECE.
   */
  listAdmisiones: readBase.input(listAdmisionesInput).query(async ({ ctx, input }) => {
    const ece = withEceContext(ctx);

    return withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
      const busqueda = input.busqueda?.trim() || null;
      return tx.$queryRaw<AdmisionRow[]>`
        SELECT
          ea.id::text,
          ea.public_encounter_id::text,
          p.numero_expediente,
          ea.modalidad,
          ea.servicio_categoria,
          srv.nombre                  AS servicio_nombre,
          ea.estado,
          ea.fecha_hora_inicio        AS fecha_inicio,
          ea.fecha_hora_cierre        AS fecha_cierre,
          (eh.episodio_id IS NOT NULL) AS tiene_hospitalizacion
        FROM ece.episodio_atencion ea
        LEFT JOIN ece.paciente              p   ON p.id = ea.paciente_id
        LEFT JOIN ece.servicio              srv ON srv.id = ea.servicio_id
        LEFT JOIN ece.episodio_hospitalario eh  ON eh.episodio_id = ea.id
        WHERE ea.establecimiento_id = ${ece.establecimientoId}::uuid
          AND (${input.incluirCerrados}::boolean
               OR ea.estado NOT IN ('cerrado', 'cancelado'))
          AND (${busqueda}::text IS NULL
               OR p.numero_expediente ILIKE '%' || ${busqueda} || '%'
               OR ea.public_encounter_id::text ILIKE '%' || ${busqueda} || '%')
        ORDER BY ea.fecha_hora_inicio DESC NULLS LAST
        LIMIT ${input.limit}
      `;
    });
  }),

  /**
   * Lista admisiones (episodios de atención) de un paciente del MPI.
   *
   * Bridge: ece.paciente.public_patient_id = public."Patient".id (1:N por
   * establecimiento — un paciente MPI puede tener N expedientes ECE en N
   * establecimientos). El filtro de tenant limita al establecimiento activo
   * para mantener consistencia con listAdmisiones y respetar RLS.
   *
   * Usado por el tab "Admisiones" del expediente /patients/[id].
   */
  listAdmisionesPorPaciente: readBase
    .input(listAdmisionesPorPacienteInput)
    .query(async ({ ctx, input }) => {
      const ece = withEceContext(ctx);

      return withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
        return tx.$queryRaw<AdmisionConContenidoRow[]>`
          SELECT
            ea.id::text,
            ea.public_encounter_id::text,
            p.numero_expediente,
            ea.modalidad,
            ea.servicio_categoria,
            srv.nombre                  AS servicio_nombre,
            ea.estado,
            ea.fecha_hora_inicio        AS fecha_inicio,
            ea.fecha_hora_cierre        AS fecha_cierre,
            (eh.episodio_id IS NOT NULL) AS tiene_hospitalizacion,
            COALESCE(aq.cnt, 0)::int    AS procedimientos_count,
            COALESCE(lab.cnt, 0)::int   AS lab_count,
            COALESCE(img.cnt, 0)::int   AS imagen_count,
            COALESCE(gab.cnt, 0)::int   AS gabinete_count
          FROM ece.paciente p
          JOIN ece.episodio_atencion ea           ON ea.paciente_id = p.id
          LEFT JOIN ece.servicio              srv ON srv.id = ea.servicio_id
          LEFT JOIN ece.episodio_hospitalario eh  ON eh.episodio_id = ea.id
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS cnt FROM ece.acto_quirurgico x
            WHERE x.episodio_id = ea.id
          ) aq ON true
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS cnt FROM ece.solicitud_estudio s
            WHERE s.episodio_id = ea.id AND s.tipo = 'laboratorio'
              AND s.estado <> 'anulado'
          ) lab ON true
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS cnt FROM ece.solicitud_estudio s
            WHERE s.episodio_id = ea.id AND s.tipo = 'imagenologia'
              AND s.estado <> 'anulado'
          ) img ON true
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS cnt FROM ece.solicitud_estudio s
            WHERE s.episodio_id = ea.id AND s.tipo = 'gabinete'
              AND s.estado <> 'anulado'
          ) gab ON true
          WHERE p.public_patient_id = ${input.patientId}::uuid
            AND ea.establecimiento_id = ${ece.establecimientoId}::uuid
            AND (${input.incluirCerrados}::boolean
                 OR ea.estado NOT IN ('cerrado', 'cancelado'))
          ORDER BY ea.fecha_hora_inicio DESC NULLS LAST
          LIMIT ${input.limit}
        `;
      });
    }),

  /**
   * Detalle genérico de una admisión (episodio_atencion) — ambulatoria u
   * hospitalaria. Pensado para la ruta /ece/admision/[id]. Si la admisión
   * tiene episodio_hospitalario, el campo episodio_hospitalario_id permite
   * al frontend ofrecer un link a /ece/episodio-hospitalario/[id] sin
   * forzar la redirección automática.
   */
  getDetalleAdmision: readBase
    .input(getDetalleAdmisionInput)
    .query(async ({ ctx, input }) => {
      const ece = withEceContext(ctx);

      return withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<AdmisionDetalleRow[]>`
          SELECT
            ea.id::text,
            ea.public_encounter_id::text,
            ea.paciente_id::text,
            COALESCE(p.numero_expediente, ea.paciente_id::text) AS paciente_nombre,
            ea.modalidad,
            ea.servicio_categoria,
            ea.servicio_id::text,
            srv.nombre                  AS servicio_nombre,
            ea.motivo,
            ea.estado,
            ea.fecha_hora_inicio        AS fecha_inicio,
            ea.fecha_hora_cierre        AS fecha_cierre,
            ea.disposicion,
            eh.id::text                 AS episodio_hospitalario_id,
            COALESCE(aq.cnt, 0)::int    AS procedimientos_count,
            COALESCE(lab.cnt, 0)::int   AS lab_count,
            COALESCE(img.cnt, 0)::int   AS imagen_count,
            COALESCE(gab.cnt, 0)::int   AS gabinete_count
          FROM ece.episodio_atencion ea
          LEFT JOIN ece.paciente              p   ON p.id = ea.paciente_id
          LEFT JOIN ece.servicio              srv ON srv.id = ea.servicio_id
          LEFT JOIN ece.episodio_hospitalario eh  ON eh.episodio_id = ea.id
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS cnt FROM ece.acto_quirurgico x
            WHERE x.episodio_id = ea.id
          ) aq ON true
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS cnt FROM ece.solicitud_estudio s
            WHERE s.episodio_id = ea.id AND s.tipo = 'laboratorio'
              AND s.estado <> 'anulado'
          ) lab ON true
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS cnt FROM ece.solicitud_estudio s
            WHERE s.episodio_id = ea.id AND s.tipo = 'imagenologia'
              AND s.estado <> 'anulado'
          ) img ON true
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS cnt FROM ece.solicitud_estudio s
            WHERE s.episodio_id = ea.id AND s.tipo = 'gabinete'
              AND s.estado <> 'anulado'
          ) gab ON true
          WHERE ea.id = ${input.id}::uuid
            AND ea.establecimiento_id = ${ece.establecimientoId}::uuid
          LIMIT 1
        `;

        if (rows.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Admisión no encontrada: ${input.id}`,
          });
        }

        return rows[0]!;
      });
    }),

  getDetalle: readBase.input(getDetalleInput).query(async ({ ctx, input }) => {
    const ece = withEceContext(ctx);

    return withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
      const rows = await tx.$queryRaw<EpisodioDetalleRow[]>`
        SELECT
          eh.episodio_id::text,
          ea.id::text                    AS episodio_atencion_id,
          ea.paciente_id::text,
          COALESCE(p.numero_expediente, ea.paciente_id::text) AS paciente_nombre,
          eh.servicio_id::text           AS sala_id,
          srv.nombre                     AS sala_nombre,
          eh.cama_id::text,
          c.codigo                       AS cama_codigo,
          eh.fecha_hora_orden_ingreso    AS fecha_ingreso,
          ea.estado,
          NULL::text                     AS medico_nombre,
          ea.motivo                      AS motivo_ingreso,
          eh.episodio_id::text           AS orden_ingreso_id,
          COALESCE(docs.firmados, 0)     AS documentos_firmados_count
        FROM ece.episodio_hospitalario eh
        JOIN ece.episodio_atencion ea ON ea.id = eh.episodio_id
        LEFT JOIN ece.paciente       p   ON p.id = ea.paciente_id
        LEFT JOIN ece.servicio       srv ON srv.id = eh.servicio_id
        LEFT JOIN ece.cama           c   ON c.id = eh.cama_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS firmados
          FROM ece.documento_instancia di
          JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
          WHERE di.episodio_id = ea.id
            AND (fe.codigo IN ('firmado', 'validado', 'certificado') OR fe.es_final = true)
        ) docs ON true
        WHERE eh.episodio_id = ${input.id}::uuid
          AND ea.establecimiento_id = ${ece.establecimientoId}::uuid
        LIMIT 1
      `;

      if (rows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Episodio hospitalario no encontrado: ${input.id}`,
        });
      }

      return rows[0]!;
    });
  }),

  /**
   * Inicia el proceso de alta médica:
   * 1. Valida que el episodio esté en_curso.
   * 2. Crea borrador de epicrisis con los datos de alta.
   * 3. Transiciona estado a 'alta_iniciada' y registra log.
   * 4. Emite outbox `ece.episodio.altaIniciada`.
   *
   * Todo en una sola transacción (HD-10: emitDomainEvent dentro del mismo tx).
   */
  iniciarAltaMedica: physicianBase.input(iniciarAltaMedicaInput).mutation(async ({ ctx, input }) => {
    const ece = withEceContext(ctx);

    return withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
      // 1. Leer episodio y validar estado
      const episodioRows = await tx.$queryRaw<
        { id: string; estado: string; paciente_id: string; episodio_hosp_id: string }[]
      >`
        SELECT
          ea.id::text,
          ea.estado,
          ea.paciente_id::text,
          eh.id::text AS episodio_hosp_id
        FROM ece.episodio_atencion ea
        JOIN ece.episodio_hospitalario eh ON eh.episodio_id = ea.id
        WHERE ea.id = ${input.episodioId}::uuid
          AND ea.establecimiento_id = ${ece.establecimientoId}::uuid
        LIMIT 1
        FOR UPDATE
      `;

      if (episodioRows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Episodio no encontrado: ${input.episodioId}`,
        });
      }

      const episodio = episodioRows[0]!;
      if (episodio.estado !== "en_curso") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede iniciar alta en estado 'en_curso'. Estado actual: ${episodio.estado}`,
        });
      }

      // 2. Crear borrador de epicrisis
      const tipoEgreso = input.motivoAlta === "defuncion" ? "fallecido" : "vivo";
      const epicrisisRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO ece.epicrisis_egreso (
          episodio_id,
          fecha_hora_egreso,
          tipo_egreso,
          circunstancia_alta,
          diagnosticos_egreso,
          resumen_ingreso,
          evolucion_hospitalaria,
          tratamiento_egreso,
          indicaciones_egreso,
          medico_tratante_id,
          estado_workflow
        ) VALUES (
          ${episodio.episodio_hosp_id}::uuid,
          ${input.fechaHoraAlta.toISOString()}::timestamptz,
          ${tipoEgreso},
          ${input.motivoAlta},
          '[]'::jsonb,
          '',
          '',
          '',
          ${input.instruccionesAlta},
          ${input.medicoAltaId}::uuid,
          'borrador'
        )
        RETURNING id::text
      `;

      const epicrisisId = epicrisisRows[0]!.id;

      // 3. Transicionar estado del episodio
      await tx.$executeRaw`
        UPDATE ece.episodio_atencion
        SET estado = 'alta_iniciada', actualizado_en = NOW()
        WHERE id = ${input.episodioId}::uuid
      `;

      // 4. Registrar log de transición
      const observacionAlta = `Alta iniciada: ${input.motivoAlta}`;
      await tx.$executeRaw`
        INSERT INTO ece.episodio_estado_log
          (episodio_id, estado_anterior, estado_nuevo, cambiado_por, observacion)
        VALUES (
          ${input.episodioId}::uuid,
          'en_curso',
          'alta_iniciada',
          ${ece.personalId}::uuid,
          ${observacionAlta}
        )
      `;

      // 5. Emitir evento outbox dentro del mismo tx (HD-10: atomicidad garantizada)
      await emitDomainEvent(tx, {
        organizationId: ece.organizationId,
        eventType: "ece.episodio.altaIniciada",
        aggregateType: "EpisodioHospitalario",
        aggregateId: input.episodioId,
        emittedById: ctx.user.id,
        payload: {
          episodioId: input.episodioId,
          epicrisisId,
          pacienteId: episodio.paciente_id,
          medicoAltaId: input.medicoAltaId,
          motivoAlta: input.motivoAlta,
          fechaHoraAlta: input.fechaHoraAlta.toISOString(),
        },
      });

      return { episodioId: input.episodioId, epicrisisId, pacienteId: episodio.paciente_id };
    });
  }),

  /**
   * Confirma el alta médica:
   * 1. Valida que la epicrisis esté firmada (borrador no válido).
   * 2. Cierra el episodio (estado = 'cerrado') + registra fecha_hora_egreso.
   * 3. Libera la cama activa.
   * 4. Emite outbox `ece.episodio.altaConfirmada`.
   *
   * Todo en una sola transacción (HD-10: emitDomainEvent dentro del mismo tx).
   *
   * HD-09 PENDIENTE: verificación medico_autor_epicrisis == confirmador no implementable
   * hasta que @AE defina si se agrega medico_tratante_id a ece.episodio_hospitalario via DDL.
   */
  confirmarAlta: physicianBase.input(confirmarAltaInput).mutation(async ({ ctx, input }) => {
    const ece = withEceContext(ctx);

    return withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
      // 1. Leer episodio + estado epicrisis en una query
      const rows = await tx.$queryRaw<{
        episodio_id: string;
        estado_episodio: string;
        episodio_hosp_id: string;
        estado_epicrisis: string;
        paciente_id: string;
      }[]>`
        SELECT
          ea.id::text       AS episodio_id,
          ea.estado         AS estado_episodio,
          eh.id::text       AS episodio_hosp_id,
          epi.estado_workflow AS estado_epicrisis,
          ea.paciente_id::text
        FROM ece.episodio_atencion ea
        JOIN ece.episodio_hospitalario eh  ON eh.episodio_id = ea.id
        JOIN ece.epicrisis_egreso epi      ON epi.id = ${input.epicrisisId}::uuid
        WHERE ea.id = ${input.episodioId}::uuid
          AND ea.establecimiento_id = ${ece.establecimientoId}::uuid
        LIMIT 1
        FOR UPDATE
      `;

      if (rows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Episodio o epicrisis no encontrada.",
        });
      }

      const row = rows[0]!;

      if (row.estado_episodio !== "alta_iniciada") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `El alta solo puede confirmarse desde estado 'alta_iniciada'. Estado actual: ${row.estado_episodio}`,
        });
      }

      // La epicrisis debe estar al menos firmada (no puede ser borrador ni anulada)
      if (row.estado_epicrisis === "borrador" || row.estado_epicrisis === "anulado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La epicrisis debe estar firmada para confirmar el alta. Estado actual: ${row.estado_epicrisis}`,
        });
      }

      // 2. Cerrar episodio + fecha_hora_egreso (columna BD real)
      await tx.$executeRaw`
        UPDATE ece.episodio_atencion
        SET estado = 'cerrado', actualizado_en = NOW()
        WHERE id = ${input.episodioId}::uuid
      `;

      await tx.$executeRaw`
        UPDATE ece.episodio_hospitalario
        SET fecha_hora_egreso = NOW()
        WHERE id = ${row.episodio_hosp_id}::uuid
      `;

      // 3. Liberar cama activa
      await tx.$executeRaw`
        UPDATE ece.asignacion_cama
        SET activa = false, fecha_liberacion = NOW()
        WHERE episodio_hospitalario_id = ${row.episodio_hosp_id}::uuid
          AND activa = true
      `;

      // 4. Registrar log de transición
      await tx.$executeRaw`
        INSERT INTO ece.episodio_estado_log
          (episodio_id, estado_anterior, estado_nuevo, cambiado_por, observacion)
        VALUES (
          ${input.episodioId}::uuid,
          'alta_iniciada',
          'cerrado',
          ${ece.personalId}::uuid,
          'Alta confirmada'
        )
      `;

      // 5. Emitir evento outbox dentro del mismo tx (HD-10: atomicidad garantizada)
      await emitDomainEvent(tx, {
        organizationId: ece.organizationId,
        eventType: "ece.episodio.altaConfirmada",
        aggregateType: "EpisodioHospitalario",
        aggregateId: input.episodioId,
        emittedById: ctx.user.id,
        payload: {
          episodioId: input.episodioId,
          epicrisisId: input.epicrisisId,
          pacienteId: row.paciente_id,
          cerradoPor: ctx.user.id,
        },
      });

      return {
        episodioId: input.episodioId,
        epicrisisId: input.epicrisisId,
        pacienteId: row.paciente_id,
      };
    });
  }),
});
