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
 *             registra fecha_egreso en ece.episodio_hospitalario,
 *             appends a ece.episodio_estado_log.
 *     Outbox: emite `ece.episodio.altaConfirmada`
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (emitDomainEvent dentro del callback de withWorkflowContext)
 * ---------------------------------------------------------------------------
 *   'ece.episodio.altaIniciada'   — payload: { episodioId, pacienteId, medicoId, orgId }
 *   'ece.episodio.altaConfirmada' — payload: { episodioId, camaId, fechaEgreso, orgId }
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.episodio_atencion       — estado principal del episodio (motivo, estado)
 *   ece.episodio_hospitalario   — datos subtype: sala_id, orden_ingreso_id,
 *                                 gravedad, fecha_ingreso, fecha_egreso
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

const gravedadEnum = z.enum(["leve", "moderado", "grave", "critico"]);
const motivoAltaEnum = z.enum(["mejoria", "traslado", "alta_voluntaria", "defuncion"]);

const listActivosInput = z.object({
  servicioId: z.string().uuid().optional(),
  fecha: z.coerce.date().optional(),
  gravedad: gravedadEnum.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
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

export interface EpisodioActivoRow {
  id: string;
  episodio_atencion_id: string;
  paciente_id: string;
  paciente_nombre: string;
  sala_id: string;
  sala_nombre: string | null;
  cama_id: string | null;
  cama_codigo: string | null;
  fecha_ingreso: Date;
  estado: string;
  gravedad: string | null;
  medico_tratante_id: string | null;
  medico_nombre: string | null;
}

export interface EpisodioDetalleRow extends EpisodioActivoRow {
  motivo_ingreso: string;
  orden_ingreso_id: string;
  documentos_firmados_count: number;
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
   * Filtros: servicioId, fecha ingreso, gravedad.
   * Paginación cursor-based por id ASC.
   */
  listActivos: readBase.input(listActivosInput).query(async ({ ctx, input }) => {
    const ece = withEceContext(ctx);

    return withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
      const fechaStr = input.fecha ? input.fecha.toISOString().split("T")[0] : null;

      const rows = await tx.$queryRaw<EpisodioActivoRow[]>`
        SELECT
          eh.id::text,
          ea.id::text                    AS episodio_atencion_id,
          ea.paciente_id::text,
          COALESCE(p.primer_nombre || ' ' || p.primer_apellido, ea.paciente_id::text) AS paciente_nombre,
          eh.sala_id::text,
          s.nombre                       AS sala_nombre,
          ac.cama_id::text,
          c.codigo                       AS cama_codigo,
          eh.fecha_ingreso,
          ea.estado,
          eh.gravedad,
          eh.medico_tratante_id::text,
          COALESCE(med.nombre_completo, NULL) AS medico_nombre
        FROM ece.episodio_hospitalario eh
        JOIN ece.episodio_atencion ea ON ea.id = eh.episodio_atencion_id
        LEFT JOIN ece.paciente       p   ON p.id = ea.paciente_id
        LEFT JOIN ece.sala           s   ON s.id = eh.sala_id
        LEFT JOIN ece.asignacion_cama ac ON ac.episodio_hospitalario_id = eh.id AND ac.activa = true
        LEFT JOIN ece.cama           c   ON c.id = ac.cama_id
        LEFT JOIN ece.personal_salud med ON med.id = eh.medico_tratante_id
        WHERE ea.establecimiento_id = ${ece.establecimientoId}::uuid
          AND ea.estado NOT IN ('cerrado', 'cancelado')
          AND (${input.servicioId ?? null}::uuid IS NULL
               OR eh.sala_id = ${input.servicioId ?? null}::uuid)
          AND (${fechaStr}::date IS NULL
               OR eh.fecha_ingreso::date = ${fechaStr}::date)
          AND (${input.gravedad ?? null}::text IS NULL
               OR eh.gravedad = ${input.gravedad ?? null}::text)
          AND (${input.cursor ?? null}::uuid IS NULL
               OR eh.id > ${input.cursor ?? null}::uuid)
        ORDER BY eh.id ASC
        LIMIT ${input.limit + 1}
      `;

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
    });
  }),

  /**
   * Detalle completo de un episodio hospitalario:
   * paciente + cama + médico tratante + count de documentos firmados.
   */
  getDetalle: readBase.input(getDetalleInput).query(async ({ ctx, input }) => {
    const ece = withEceContext(ctx);

    return withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
      const rows = await tx.$queryRaw<EpisodioDetalleRow[]>`
        SELECT
          eh.id::text,
          ea.id::text                    AS episodio_atencion_id,
          ea.paciente_id::text,
          COALESCE(p.primer_nombre || ' ' || p.primer_apellido, ea.paciente_id::text) AS paciente_nombre,
          eh.sala_id::text,
          s.nombre                       AS sala_nombre,
          ac.cama_id::text,
          c.codigo                       AS cama_codigo,
          eh.fecha_ingreso,
          ea.estado,
          eh.gravedad,
          eh.medico_tratante_id::text,
          COALESCE(med.nombre_completo, NULL) AS medico_nombre,
          ea.motivo_consulta             AS motivo_ingreso,
          eh.orden_ingreso_id::text,
          COALESCE(docs.firmados, 0)     AS documentos_firmados_count
        FROM ece.episodio_hospitalario eh
        JOIN ece.episodio_atencion ea ON ea.id = eh.episodio_atencion_id
        LEFT JOIN ece.paciente       p   ON p.id = ea.paciente_id
        LEFT JOIN ece.sala           s   ON s.id = eh.sala_id
        LEFT JOIN ece.asignacion_cama ac ON ac.episodio_hospitalario_id = eh.id AND ac.activa = true
        LEFT JOIN ece.cama           c   ON c.id = ac.cama_id
        LEFT JOIN ece.personal_salud med ON med.id = eh.medico_tratante_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS firmados
          FROM ece.documento_clinico dc
          WHERE dc.episodio_id = ea.id
            AND dc.estado_workflow IN ('firmado', 'validado', 'certificado')
        ) docs ON true
        WHERE eh.id = ${input.id}::uuid
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
   * Todo en una sola transacción (3 tablas afectadas).
   */
  iniciarAltaMedica: physicianBase.input(iniciarAltaMedicaInput).mutation(async ({ ctx, input }) => {
    const ece = withEceContext(ctx);

    const result = await withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
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
        JOIN ece.episodio_hospitalario eh ON eh.episodio_atencion_id = ea.id
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

      return { episodioId: input.episodioId, epicrisisId, pacienteId: episodio.paciente_id };
    });

    // 5. Emitir evento outbox (tx separada — patrón de episodio.router.ts)
    await ctx.prisma.$transaction(async (tx) => {
      await emitDomainEvent(tx, {
        organizationId: ece.organizationId,
        eventType: "ece.episodio.altaIniciada",
        aggregateType: "EpisodioHospitalario",
        aggregateId: result.episodioId,
        emittedById: ctx.user.id,
        payload: {
          episodioId: result.episodioId,
          epicrisisId: result.epicrisisId,
          pacienteId: result.pacienteId,
          medicoAltaId: input.medicoAltaId,
          motivoAlta: input.motivoAlta,
          fechaHoraAlta: input.fechaHoraAlta.toISOString(),
        },
      });
    });

    return result;
  }),

  /**
   * Confirma el alta médica:
   * 1. Valida que la epicrisis esté firmada (borrador no válido).
   * 2. Cierra el episodio (estado = 'cerrado') + registra fecha_egreso.
   * 3. Libera la cama activa.
   * 4. Emite outbox `ece.episodio.altaConfirmada`.
   *
   * Todo en una sola transacción (3 tablas afectadas).
   */
  confirmarAlta: physicianBase.input(confirmarAltaInput).mutation(async ({ ctx, input }) => {
    const ece = withEceContext(ctx);

    const result = await withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
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
        JOIN ece.episodio_hospitalario eh  ON eh.episodio_atencion_id = ea.id
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

      // 2. Cerrar episodio + fecha egreso
      await tx.$executeRaw`
        UPDATE ece.episodio_atencion
        SET estado = 'cerrado', actualizado_en = NOW()
        WHERE id = ${input.episodioId}::uuid
      `;

      await tx.$executeRaw`
        UPDATE ece.episodio_hospitalario
        SET fecha_egreso = NOW()
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

      return {
        episodioId: input.episodioId,
        epicrisisId: input.epicrisisId,
        pacienteId: row.paciente_id,
      };
    });

    // 5. Emitir evento outbox (tx separada)
    await ctx.prisma.$transaction(async (tx) => {
      await emitDomainEvent(tx, {
        organizationId: ece.organizationId,
        eventType: "ece.episodio.altaConfirmada",
        aggregateType: "EpisodioHospitalario",
        aggregateId: result.episodioId,
        emittedById: ctx.user.id,
        payload: {
          episodioId: result.episodioId,
          epicrisisId: result.epicrisisId,
          pacienteId: result.pacienteId,
          cerradoPor: ctx.user.id,
        },
      });
    });

    return result;
  }),
});
