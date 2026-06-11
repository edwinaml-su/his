/**
 * Router tRPC — ECE Episodios de Atención (ambulatorio y hospitalario).
 *
 * Norma: MINSAL Acuerdo n.° 1616 (2024), §3 — Gestión de episodios.
 * Código de módulo: ECE-EPISODIO.
 * Un episodio agrupa todos los documentos clínicos de una atención continua.
 * Para hospitalización, episodio_atencion tiene un subtype episodio_hospitalario.
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (state machine de episodio — validado también por triggers en BD)
 * ---------------------------------------------------------------------------
 *   abierto → en_curso → cerrado
 *   cancelado es estado terminal (desde cualquier estado pre-cierre)
 *
 *   Los triggers de BD impiden regresar de estados cerrado/cancelado.
 *   El alta médica (episodio-hospitalario.router) transiciona via confirmarAlta.
 *   Las transiciones se registran en ece.episodio_estado_log (append-only).
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (emitDomainEvent dentro del callback de withWorkflowContext)
 * ---------------------------------------------------------------------------
 *   'ece.episodio.abierto'  — emitido al crearAmbulatorio / crearHospitalario.
 *     Payload: { episodioId, pacienteId, tipo ('ambulatorio'|'hospitalario'), orgId }
 *   'ece.episodio.cerrado'  — emitido al transicionar() con estado destino 'cerrado'.
 *     Payload: { episodioId, pacienteId, fechaCierre, orgId }
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.episodio_atencion        — fila base: paciente_id, tipo, estado,
 *                                  motivo, fecha_apertura, fecha_cierre
 *   ece.episodio_hospitalario    — subtype hospitalario: sala_id, orden_ingreso_id,
 *                                  gravedad, fecha_ingreso, fecha_egreso
 *   ece.asignacion_cama          — asignación activa: cama_id, episodio_id, estado
 *   ece.episodio_estado_log      — bitácora inmutable de cada transición de estado
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   listAmbulatorios, listHospitalarios, get → requireRole(["PHYSICIAN","NURSE","ADM"])
 *   crearAmbulatorio, transicionar           → requireRole(["PHYSICIAN","NURSE"])
 *   crearHospitalario                        → requireRole(["PHYSICIAN","ADM"])
 *   asignarCama, liberarCama                 → requireRole(["NURSE","ADM"])
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext } from "../../ece/workflow-context";
import { emitDomainEvent } from "@his/database";

// ─── Schemas Zod (definidos localmente — patrón seguido por routers ECE) ─────

const listAmbulatoriasInput = z.object({
  pacienteId: z.string().uuid().optional(),
  fecha: z.coerce.date().optional(),
  estado: z.enum(["abierto", "en_curso", "cerrado", "cancelado"]).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

const listHospitalariasInput = z.object({
  salaId: z.string().uuid().optional(),
  fecha: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

const getEpisodioInput = z.object({
  id: z.string().uuid(),
});

const crearAmbulatorioInput = z.object({
  pacienteId: z.string().uuid(),
  motivoConsulta: z.string().trim().min(1).max(1000),
  encounterId: z.string().uuid().optional(),
  fechaApertura: z.coerce.date().optional(),
});

const crearHospitalarioInput = z.object({
  pacienteId: z.string().uuid(),
  ordenIngresoId: z.string().uuid(),
  camaId: z.string().uuid(),
  salaId: z.string().uuid(),
  motivoIngreso: z.string().trim().min(1).max(1000),
  fechaIngreso: z.coerce.date().optional(),
});

const transicionarInput = z.object({
  episodioId: z.string().uuid(),
  nuevoEstado: z.enum(["en_curso", "cerrado"]),
  observacion: z.string().trim().max(1000).optional(),
});

const asignarCamaInput = z.object({
  episodioHospitalarioId: z.string().uuid(),
  camaId: z.string().uuid(),
  fechaAsignacion: z.coerce.date(),
});

const liberarCamaInput = z.object({
  asignacionId: z.string().uuid(),
  fechaLiberacion: z.coerce.date(),
});

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Construye el contexto ECE (establecimientoId + personalId) a partir del ctx tRPC.
 * Lanza BAD_REQUEST si no hay establecimiento activo.
 */
function withEceContext(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string; roleCodes: string[] };
}) {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar episodios ECE.",
    });
  }
  return {
    personalId: ctx.user.id,
    establecimientoId: ctx.tenant.establishmentId,
    roles: ctx.tenant.roleCodes,
  };
}

// ─── Tipos de fila raw ───────────────────────────────────────────────────────

export interface EpisodioRow {
  id: string;
  paciente_id: string;
  tipo: "ambulatorio" | "hospitalario";
  estado: string;
  motivo: string;
  encounter_id: string | null;
  establecimiento_id: string;
  creado_por: string;
  creado_en: Date;
  actualizado_en: Date;
}

export interface EpisodioHospitalarioRow extends EpisodioRow {
  orden_ingreso_id: string;
  sala_id: string;
  fecha_ingreso: Date;
  fecha_egreso: Date | null;
}

interface AsignacionCamaRow {
  id: string;
  episodio_hospitalario_id: string;
  cama_id: string;
  fecha_asignacion: Date;
  fecha_liberacion: Date | null;
  activa: boolean;
}

// ─── Sub-routers base procedures ─────────────────────────────────────────────

const readBase = requireRole(["PHYSICIAN", "NURSE", "ADM"]);
const clinicalBase = requireRole(["PHYSICIAN", "NURSE"]);
const physicianAdmBase = requireRole(["PHYSICIAN", "ADM"]);
const bedBase = requireRole(["NURSE", "ADM"]);

// ─── Router ──────────────────────────────────────────────────────────────────

export const eceEpisodioRouter = router({
  /**
   * Lista episodios ambulatorios con filtros opcionales.
   * Paginación cursor-based por id ASC.
   */
  listAmbulatorios: readBase
    .input(listAmbulatoriasInput)
    .query(async ({ ctx, input }) => {
      const ece = withEceContext(ctx);

      return withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<EpisodioRow[]>`
          SELECT
            ea.id::text,
            ea.paciente_id::text,
            'ambulatorio' AS tipo,
            ea.estado,
            ea.motivo            AS motivo,
            ea.public_encounter_id::text AS encounter_id,
            ea.establecimiento_id::text,
            ea.creado_por::text,
            ea.creado_en,
            ea.actualizado_en
          FROM ece.episodio_atencion ea
          WHERE ea.establecimiento_id = ${ece.establecimientoId}::uuid
            AND ea.modalidad = 'ambulatorio'
            AND (${input.pacienteId ?? null}::uuid IS NULL
                 OR ea.paciente_id = ${input.pacienteId ?? null}::uuid)
            AND (${input.fecha ? input.fecha.toISOString().split("T")[0] : null}::date IS NULL
                 OR ea.fecha_hora_inicio::date = ${input.fecha ? input.fecha.toISOString().split("T")[0] : null}::date)
            AND (${input.estado ?? null}::text IS NULL
                 OR ea.estado = ${input.estado ?? null}::text)
            AND (${input.cursor ?? null}::uuid IS NULL
                 OR ea.id > ${input.cursor ?? null}::uuid)
          ORDER BY ea.id ASC
          LIMIT ${input.limit + 1}
        `;

        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
      });
    }),

  /**
   * Lista episodios hospitalarios, opcionalmente filtrados por sala y fecha.
   */
  listHospitalarios: readBase
    .input(listHospitalariasInput)
    .query(async ({ ctx, input }) => {
      const ece = withEceContext(ctx);

      return withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<EpisodioHospitalarioRow[]>`
          SELECT
            ea.id::text,
            ea.paciente_id::text,
            'hospitalario' AS tipo,
            ea.estado,
            ea.motivo            AS motivo,
            NULL::text           AS encounter_id,
            ea.establecimiento_id::text,
            ea.creado_por::text,
            ea.creado_en,
            ea.actualizado_en,
            eh.episodio_id::text AS orden_ingreso_id,
            eh.servicio_id::text AS sala_id,
            eh.fecha_hora_orden_ingreso AS fecha_ingreso,
            eh.fecha_hora_egreso        AS fecha_egreso
          FROM ece.episodio_hospitalario eh
          JOIN ece.episodio_atencion ea ON ea.id = eh.episodio_id
          WHERE ea.establecimiento_id = ${ece.establecimientoId}::uuid
            AND (${input.salaId ?? null}::uuid IS NULL
                 OR eh.servicio_id = ${input.salaId ?? null}::uuid)
            AND (${input.fecha ? input.fecha.toISOString().split("T")[0] : null}::date IS NULL
                 OR eh.fecha_hora_orden_ingreso::date = ${input.fecha ? input.fecha.toISOString().split("T")[0] : null}::date)
            AND (${input.cursor ?? null}::uuid IS NULL
                 OR ea.id > ${input.cursor ?? null}::uuid)
          ORDER BY ea.id ASC
          LIMIT ${input.limit + 1}
        `;

        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
      });
    }),

  /**
   * Obtiene un episodio por id (ambulatorio o hospitalario).
   */
  get: readBase.input(getEpisodioInput).query(async ({ ctx, input }) => {
    const ece = withEceContext(ctx);

    return withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
      const rows = await tx.$queryRaw<EpisodioRow[]>`
        SELECT
          ea.id::text,
          ea.paciente_id::text,
          ea.modalidad         AS tipo,
          ea.estado,
          ea.motivo            AS motivo,
          ea.public_encounter_id::text AS encounter_id,
          ea.establecimiento_id::text,
          ea.creado_por::text,
          ea.creado_en,
          ea.actualizado_en
        FROM ece.episodio_atencion ea
        WHERE ea.id = ${input.id}::uuid
          AND ea.establecimiento_id = ${ece.establecimientoId}::uuid
        LIMIT 1
      `;

      if (rows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Episodio no encontrado: ${input.id}`,
        });
      }

      return rows[0]!;
    });
  }),

  /**
   * Crea un episodio ambulatorio en estado 'abierto'.
   * Emite outbox `ece.episodio.abierto`.
   */
  crearAmbulatorio: clinicalBase
    .input(crearAmbulatorioInput)
    .mutation(async ({ ctx, input }) => {
      const ece = withEceContext(ctx);
      const fechaApertura = (input.fechaApertura ?? new Date()).toISOString();

      const rows = await withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
        return tx.$queryRaw<{ id: string }[]>`
          INSERT INTO ece.episodio_atencion
            (paciente_id, modalidad, servicio_categoria, estado, motivo,
             public_encounter_id, establecimiento_id, creado_por, fecha_hora_inicio)
          VALUES (
            ${input.pacienteId}::uuid,
            'ambulatorio',
            'consulta_externa',
            'abierto',
            ${input.motivoConsulta},
            ${input.encounterId ?? null}::uuid,
            ${ece.establecimientoId}::uuid,
            ${ece.personalId}::uuid,
            ${fechaApertura}::timestamptz
          )
          RETURNING id::text
        `;
      });

      const episodioId = rows[0]!.id;

      await ctx.prisma.$transaction(async (tx) => {
        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.episodio.abierto",
          aggregateType: "EpisodioAtencion",
          aggregateId: episodioId,
          emittedById: ctx.user.id,
          payload: {
            episodioId,
            tipo: "ambulatorio",
            pacienteId: input.pacienteId,
            ...(input.encounterId ? { encounterId: input.encounterId } : {}),
          },
        });
      });

      return { id: episodioId };
    }),

  /**
   * Crea episodio hospitalario: inserta en episodio_atencion + episodio_hospitalario
   * + primera asignacion_cama, todo en una sola transacción.
   * Emite outbox `ece.episodio.abierto`.
   */
  crearHospitalario: physicianAdmBase
    .input(crearHospitalarioInput)
    .mutation(async ({ ctx, input }) => {
      const ece = withEceContext(ctx);
      const fechaIngreso = (input.fechaIngreso ?? new Date()).toISOString();

      const result = await withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
        // 1. Insertar episodio base.
        // servicio_categoria NOT NULL: 'hospitalizacion' es el valor correcto para hospitalario.
        const atencionRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO ece.episodio_atencion
            (paciente_id, modalidad, servicio_categoria, estado, motivo,
             establecimiento_id, creado_por, fecha_hora_inicio)
          VALUES (
            ${input.pacienteId}::uuid,
            'hospitalario',
            'hospitalizacion',
            'abierto',
            ${input.motivoIngreso},
            ${ece.establecimientoId}::uuid,
            ${ece.personalId}::uuid,
            ${fechaIngreso}::timestamptz
          )
          RETURNING id::text
        `;

        const episodioId = atencionRows[0]!.id;

        // 2. Insertar episodio_hospitalario.
        // PK = episodio_id (no hay columna id). salaId → servicio_id. No hay orden_ingreso_id.
        // Columnas reales: episodio_id, circunstancia_ingreso!, procedencia_ingreso!, modalidad_hospitalaria!, servicio_id, cama_id, fecha_hora_orden_ingreso!
        await tx.$executeRaw`
          INSERT INTO ece.episodio_hospitalario
            (episodio_id, circunstancia_ingreso, procedencia_ingreso, modalidad_hospitalaria,
             servicio_id, cama_id, fecha_hora_orden_ingreso)
          VALUES (
            ${episodioId}::uuid,
            'hospitalizacion',
            'espontaneo',
            'hospitalizacion',
            ${input.salaId}::uuid,
            ${input.camaId}::uuid,
            ${fechaIngreso}::timestamptz
          )
        `;

        // episodioHospId = episodioId (misma PK compartida).
        const episodioHospId = episodioId;

        // 3. Asignar cama inicial.
        // asignacion_cama real: episodio_id (FK a episodio_atencion), cama_id, desde.
        await tx.$executeRaw`
          INSERT INTO ece.asignacion_cama
            (episodio_id, cama_id, desde)
          VALUES (
            ${episodioId}::uuid,
            ${input.camaId}::uuid,
            ${fechaIngreso}::timestamptz
          )
        `;

        return { episodioId, episodioHospId };
      });

      await ctx.prisma.$transaction(async (tx) => {
        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.episodio.abierto",
          aggregateType: "EpisodioAtencion",
          aggregateId: result.episodioId,
          emittedById: ctx.user.id,
          payload: {
            episodioId: result.episodioId,
            tipo: "hospitalario",
            pacienteId: input.pacienteId,
            ordenIngresoId: input.ordenIngresoId,
            camaId: input.camaId,
          },
        });
      });

      return result;
    }),

  /**
   * Ejecuta una transición de estado del episodio.
   * Solo permite: abierto→en_curso o en_curso→cerrado.
   * Emite `ece.episodio.cerrado` cuando el nuevo estado es 'cerrado'.
   */
  transicionar: clinicalBase
    .input(transicionarInput)
    .mutation(async ({ ctx, input }) => {
      const ece = withEceContext(ctx);

      await withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
        // 1. Leer estado actual
        const rows = await tx.$queryRaw<{ id: string; estado: string }[]>`
          SELECT id::text, estado
          FROM ece.episodio_atencion
          WHERE id = ${input.episodioId}::uuid
            AND establecimiento_id = ${ece.establecimientoId}::uuid
          LIMIT 1
          FOR UPDATE
        `;

        if (rows.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Episodio no encontrado: ${input.episodioId}`,
          });
        }

        const estadoActual = rows[0]!.estado;

        // 2. Validar transición (state machine)
        const transicionesValidas: Record<string, string> = {
          abierto: "en_curso",
          en_curso: "cerrado",
        };

        if (estadoActual === "cancelado") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Un episodio cancelado no puede transicionar de estado.",
          });
        }

        if (estadoActual === "cerrado") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "El episodio ya está cerrado.",
          });
        }

        if (transicionesValidas[estadoActual] !== input.nuevoEstado) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Transición inválida: ${estadoActual} → ${input.nuevoEstado}.`,
          });
        }

        // 3. Actualizar estado
        await tx.$executeRaw`
          UPDATE ece.episodio_atencion
          SET estado = ${input.nuevoEstado},
              actualizado_en = NOW()
          WHERE id = ${input.episodioId}::uuid
        `;

        // 4. Registrar en bitácora
        await tx.$executeRaw`
          INSERT INTO ece.episodio_estado_log
            (episodio_id, estado_previo, estado_nuevo, cambiado_por, motivo)
          VALUES (
            ${input.episodioId}::uuid,
            ${estadoActual},
            ${input.nuevoEstado},
            ${ece.personalId}::uuid,
            ${input.observacion ?? null}
          )
        `;
      });

      // 5. Emitir evento si llega a cerrado
      if (input.nuevoEstado === "cerrado") {
        await ctx.prisma.$transaction(async (tx) => {
          await emitDomainEvent(tx, {
            organizationId: ctx.tenant.organizationId,
            eventType: "ece.episodio.cerrado",
            aggregateType: "EpisodioAtencion",
            aggregateId: input.episodioId,
            emittedById: ctx.user.id,
            payload: {
              episodioId: input.episodioId,
              byUserId: ctx.user.id,
              ...(input.observacion ? { observacion: input.observacion } : {}),
            },
          });
        });
      }

      return { ok: true as const, episodioId: input.episodioId, nuevoEstado: input.nuevoEstado };
    }),

  /**
   * Asigna una cama a un episodio hospitalario.
   * Bloquea si el episodio ya tiene una asignación activa.
   */
  asignarCama: bedBase
    .input(asignarCamaInput)
    .mutation(async ({ ctx, input }) => {
      const ece = withEceContext(ctx);

      return withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
        // Verificar que no haya asignación activa duplicada
        // asignacion_cama usa episodio_id (FK a episodio_atencion) y desde/hasta para el rango.
        // "Activa" = hasta IS NULL. episodioHospitalarioId en este router es el episodio_atencion.id
        // (PK compartida con episodio_hospitalario).
        const activas = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text
          FROM ece.asignacion_cama
          WHERE episodio_id = ${input.episodioHospitalarioId}::uuid
            AND hasta IS NULL
          LIMIT 1
        `;

        if (activas.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "El episodio ya tiene una cama activa asignada. Libere la cama actual antes de asignar otra.",
          });
        }

        const rows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO ece.asignacion_cama
            (episodio_id, cama_id, desde)
          VALUES (
            ${input.episodioHospitalarioId}::uuid,
            ${input.camaId}::uuid,
            ${input.fechaAsignacion.toISOString()}::timestamptz
          )
          RETURNING id::text
        `;

        return { id: rows[0]!.id };
      });
    }),

  /**
   * Libera una asignación de cama registrando la fecha de liberación.
   */
  liberarCama: bedBase
    .input(liberarCamaInput)
    .mutation(async ({ ctx, input }) => {
      const ece = withEceContext(ctx);

      return withWorkflowContext(ctx.prisma, ece.establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          UPDATE ece.asignacion_cama
          SET hasta = ${input.fechaLiberacion.toISOString()}::timestamptz,
              motivo_cambio = 'liberacion'
          WHERE id = ${input.asignacionId}::uuid
            AND hasta IS NULL
          RETURNING id::text
        `;

        if (rows.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Asignación no encontrada o ya liberada: ${input.asignacionId}`,
          });
        }

        return { id: rows[0]!.id };
      });
    }),
});
