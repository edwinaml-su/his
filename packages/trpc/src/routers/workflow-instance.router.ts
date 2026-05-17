/**
 * workflow.instance — Instancias de documentos ECE + avance de workflow.
 *
 * Tablas operadas (schema ece, raw SQL — sin modelo Prisma):
 *   ece.documento_instancia          — instancia de un documento en un episodio
 *   ece.documento_instancia_historial — bitácora inmutable de transiciones
 *   ece.flujo_estado                 — estados (para resolver estado inicial)
 *   ece.tipo_documento               — tipos (para resolver estado inicial)
 *
 * Procedures:
 *   workflow.instance.create  — crea instancia en el estado inicial del tipo
 *   workflow.instance.get     — lectura de una instancia por id
 *   workflow.instance.list    — lista paginada filtrada por episodio/paciente/tipo
 *   workflow.instance.advance — ejecuta una transición (usa canTransition + executeTransition)
 *   workflow.instance.history — historial de transiciones paginado DESC
 *
 * Autorización base: requireRole(['MC','MT','ENF','ARCH','DIR','ESP']).
 * La autorización de cada transición la impone executeTransition comparando
 * el rol del usuario con el rol_autoriza_id de la fila flujo_transicion.
 *
 * Outbox: cada avance exitoso emite `workflow.transitionExecuted` (Beta.15).
 *
 * Spec: docs/backlog/fase2/_insumos/05_motor_workflow.sql
 *       docs/backlog/fase2/03_epic_workflow_engine.md §4 US.F2.1.6-9
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../trpc";
import { withWorkflowContext, type EceContext } from "../workflow/context";
import { canTransition, executeTransition } from "../workflow/transitions";
import { emitDomainEvent } from "@his/database";

// ─── Schemas de input ────────────────────────────────────────────────────────

const createInput = z.object({
  tipoDocumentoId: z.string().uuid(),
  episodioId: z.string().uuid().optional(),
  pacienteId: z.string().uuid(),
  /** id de la fila en la tabla física de datos clínicos (ece.<tabla_datos>). */
  registroId: z.string().uuid().optional(),
});

const getInput = z.object({
  id: z.string().uuid(),
});

const listInput = z.object({
  episodioId: z.string().uuid().optional(),
  pacienteId: z.string().uuid().optional(),
  tipoDocumentoId: z.string().uuid().optional(),
  /** Cursor para paginación (id de la última instancia recibida). */
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const advanceInput = z.object({
  instanceId: z.string().uuid(),
  /** Código de acción definido en ece.flujo_transicion (ej. 'firmar', 'enviar_revision'). */
  accion: z.string().min(1).max(128),
  /** UUID de ece.firma_electronica; obligatorio cuando la transición requiere firma. */
  firmaId: z.string().uuid().optional(),
  observacion: z.string().max(1000).optional(),
});

const historyInput = z.object({
  instanceId: z.string().uuid(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

// ─── Tipos de fila raw ───────────────────────────────────────────────────────

export interface InstanciaRow {
  id: string;
  tipo_documento_id: string;
  tipo_codigo: string;
  tipo_nombre: string;
  episodio_id: string | null;
  paciente_id: string;
  registro_id: string | null;
  estado_actual_id: string;
  estado_codigo: string;
  estado_nombre: string;
  version: number;
  estado_registro: string;
  creado_por: string;
  creado_en: Date;
}

export interface HistorialRow {
  id: string;
  instancia_id: string;
  estado_anterior_id: string | null;
  estado_nuevo_id: string;
  estado_anterior_codigo: string | null;
  estado_nuevo_codigo: string;
  accion: string;
  ejecutado_por: string;
  ejecutado_en: Date;
  firma_id: string | null;
  observacion: string | null;
}

interface EstadoInicialRow {
  id: string;
  codigo: string;
}

// ─── Helper: EceContext desde ctx ───────────────────────────────────────────

/**
 * Construye EceContext a partir del contexto tRPC.
 * personalId usa ctx.user.id como proxy hasta que Stream 12 mapee
 * ece.personal_salud <-> HIS User (ver comentario en workflow-tipoDoc.router.ts).
 */
function buildEceCtx(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string; roleCodes: string[] };
}): EceContext {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar documentos ECE.",
    });
  }
  return {
    personalId: ctx.user.id,
    establecimientoId: ctx.tenant.establishmentId,
    roles: ctx.tenant.roleCodes,
  };
}

// ─── Base procedure ──────────────────────────────────────────────────────────

const instanceBase = requireRole(["MC", "MT", "ENF", "ARCH", "DIR", "ESP"]);

// ─── Router ──────────────────────────────────────────────────────────────────

export const workflowInstanceRouter = router({
  /**
   * Crea una instancia de documento en el estado inicial del tipo.
   *
   * Busca el único estado con es_inicial=true para el tipo de documento dado.
   * Si el tipo no tiene estado inicial definido lanza BAD_REQUEST — el catálogo
   * de estados debe estar completo antes de crear instancias (DoR de la épica).
   */
  create: instanceBase.input(createInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      // 1. Resolver estado inicial del tipo de documento
      const estadosIniciales = await tx.$queryRaw<EstadoInicialRow[]>`
        SELECT id::text, codigo
        FROM ece.flujo_estado
        WHERE tipo_documento_id = ${input.tipoDocumentoId}::uuid
          AND es_inicial = true
        LIMIT 1
      `;

      if (estadosIniciales.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `El tipo de documento ${input.tipoDocumentoId} no tiene estado inicial configurado.`,
        });
      }

      const estadoInicial = estadosIniciales[0]!;

      // 2. Insertar instancia
      const rows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO ece.documento_instancia
          (tipo_documento_id, episodio_id, paciente_id, registro_id,
           estado_actual_id, creado_por)
        VALUES (
          ${input.tipoDocumentoId}::uuid,
          ${input.episodioId ?? null}::uuid,
          ${input.pacienteId}::uuid,
          ${input.registroId ?? null}::uuid,
          ${estadoInicial.id}::uuid,
          ${eceCtx.personalId}::uuid
        )
        RETURNING id::text
      `;

      const instanceId = rows[0]!.id;

      // 3. Registrar en historial (creación = estado anterior NULL → inicial)
      await tx.$executeRaw`
        INSERT INTO ece.documento_instancia_historial
          (instancia_id, estado_anterior_id, estado_nuevo_id, accion, ejecutado_por, rol_ejecutor_id)
        SELECT
          ${instanceId}::uuid,
          NULL::uuid,
          ${estadoInicial.id}::uuid,
          'crear',
          ${eceCtx.personalId}::uuid,
          r.id
        FROM ece.rol r
        WHERE r.codigo = ${eceCtx.roles?.[0] ?? "MC"}
        LIMIT 1
      `;

      return { id: instanceId, estadoInicialId: estadoInicial.id, estadoInicialCodigo: estadoInicial.codigo };
    });
  }),

  /**
   * Obtiene una instancia por id, incluyendo estado actual y tipo de documento.
   */
  get: instanceBase.input(getInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      const rows = await tx.$queryRaw<InstanciaRow[]>`
        SELECT
          di.id::text,
          di.tipo_documento_id::text,
          td.codigo  AS tipo_codigo,
          td.nombre  AS tipo_nombre,
          di.episodio_id::text,
          di.paciente_id::text,
          di.registro_id::text,
          di.estado_actual_id::text,
          fe.codigo  AS estado_codigo,
          fe.nombre  AS estado_nombre,
          di.version,
          di.estado_registro,
          di.creado_por::text,
          di.creado_en
        FROM ece.documento_instancia di
        JOIN ece.tipo_documento td ON td.id = di.tipo_documento_id
        JOIN ece.flujo_estado   fe ON fe.id = di.estado_actual_id
        WHERE di.id = ${input.id}::uuid
        LIMIT 1
      `;

      if (rows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Instancia de documento no encontrada: ${input.id}`,
        });
      }

      return rows[0]!;
    });
  }),

  /**
   * Lista instancias con filtros opcionales y paginación cursor-based por id ASC.
   * Al menos uno de episodioId o pacienteId es requerido para limitar el alcance.
   */
  list: instanceBase.input(listInput).query(async ({ ctx, input }) => {
    if (!input.episodioId && !input.pacienteId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Se requiere episodioId o pacienteId para listar instancias.",
      });
    }

    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      const rows = await tx.$queryRaw<InstanciaRow[]>`
        SELECT
          di.id::text,
          di.tipo_documento_id::text,
          td.codigo  AS tipo_codigo,
          td.nombre  AS tipo_nombre,
          di.episodio_id::text,
          di.paciente_id::text,
          di.registro_id::text,
          di.estado_actual_id::text,
          fe.codigo  AS estado_codigo,
          fe.nombre  AS estado_nombre,
          di.version,
          di.estado_registro,
          di.creado_por::text,
          di.creado_en
        FROM ece.documento_instancia di
        JOIN ece.tipo_documento td ON td.id = di.tipo_documento_id
        JOIN ece.flujo_estado   fe ON fe.id = di.estado_actual_id
        WHERE
          (${input.episodioId ?? null}::uuid IS NULL OR di.episodio_id = ${input.episodioId ?? null}::uuid)
          AND (${input.pacienteId ?? null}::uuid IS NULL OR di.paciente_id = ${input.pacienteId ?? null}::uuid)
          AND (${input.tipoDocumentoId ?? null}::uuid IS NULL OR di.tipo_documento_id = ${input.tipoDocumentoId ?? null}::uuid)
          AND (${input.cursor ?? null}::uuid IS NULL OR di.id > ${input.cursor ?? null}::uuid)
        ORDER BY di.id ASC
        LIMIT ${input.limit + 1}
      `;

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1]!.id : null;

      return { items, nextCursor };
    });
  }),

  /**
   * Avanza el workflow de una instancia ejecutando una acción.
   *
   * Flujo:
   *   1. canTransition — verifica que la transición exista y el rol la autorice.
   *   2. Guarda fromState para el evento outbox.
   *   3. executeTransition — revalida (TOCTOU) + muta instancia + inserta historial.
   *   4. emitDomainEvent `workflow.transitionExecuted` (outbox transaccional Beta.15).
   *
   * Lanza FORBIDDEN si el rol no autoriza la transición.
   * Lanza BAD_REQUEST si la transición requiere firma y no se proporcionó firmaId.
   */
  advance: instanceBase.input(advanceInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    // 1. Pre-check (fuera de tx) para devolver error temprano sin abrir transacción.
    const preCheck = await canTransition(
      ctx.prisma,
      input.instanceId,
      input.accion,
      eceCtx.roles ?? [],
    );

    if (!preCheck.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Acción '${input.accion}' no está permitida para los roles del usuario en el estado actual.`,
      });
    }

    if (preCheck.requiresSignature && !input.firmaId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `La acción '${input.accion}' requiere firma electrónica (firmaId obligatorio).`,
      });
    }

    // 2. Capturar estado anterior + tipo para el payload del evento
    const instanciaRows = await ctx.prisma.$queryRaw<
      { estado_actual_id: string; tipo_documento_id: string; tipo_codigo: string }[]
    >`
      SELECT
        di.estado_actual_id::text,
        di.tipo_documento_id::text,
        td.codigo AS tipo_codigo
      FROM ece.documento_instancia di
      JOIN ece.tipo_documento td ON td.id = di.tipo_documento_id
      WHERE di.id = ${input.instanceId}::uuid
      LIMIT 1
    `;

    // NOT_FOUND lo lanzará executeTransition; esto es defensa extra
    const fromStateId = instanciaRows[0]?.estado_actual_id ?? "";
    const tipoDocumentoCodigo = instanciaRows[0]?.tipo_codigo ?? "";

    // 3. Ejecutar transición (abre su propia transacción con withWorkflowContext)
    await executeTransition(
      ctx.prisma,
      input.instanceId,
      input.accion,
      eceCtx,
      eceCtx.personalId,
      input.firmaId,
      input.observacion,
    );

    // 4. Emitir evento outbox (en transacción separada — outbox es eventual,
    //    el advance ya está comprometido; si falla el emit el SRE reintenta).
    await ctx.prisma.$transaction(async (tx) => {
      await emitDomainEvent(tx, {
        organizationId: ctx.tenant.organizationId,
        eventType: "workflow.transitionExecuted",
        aggregateType: "DocumentoInstancia",
        aggregateId: input.instanceId,
        emittedById: ctx.user.id,
        payload: {
          instanceId: input.instanceId,
          tipoDocumentoCodigo,
          fromStateId,
          toStateId: preCheck.targetStateId!,
          accion: input.accion,
          byUserId: ctx.user.id,
          ...(input.firmaId ? { firmaId: input.firmaId } : {}),
        },
      });
    });

    return {
      ok: true as const,
      instanceId: input.instanceId,
      fromStateId,
      toStateId: preCheck.targetStateId!,
    };
  }),

  /**
   * Historial paginado de transiciones de una instancia, ordenado por
   * ejecutado_en DESC (más reciente primero). Incluye personal + firma.
   */
  history: instanceBase.input(historyInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      const rows = await tx.$queryRaw<HistorialRow[]>`
        SELECT
          dih.id::text,
          dih.instancia_id::text,
          dih.estado_anterior_id::text,
          dih.estado_nuevo_id::text,
          fe_ant.codigo  AS estado_anterior_codigo,
          fe_nue.codigo  AS estado_nuevo_codigo,
          dih.accion,
          dih.ejecutado_por::text,
          dih.ejecutado_en,
          dih.firma_id::text,
          dih.observacion
        FROM ece.documento_instancia_historial dih
        LEFT JOIN ece.flujo_estado fe_ant ON fe_ant.id = dih.estado_anterior_id
        JOIN      ece.flujo_estado fe_nue ON fe_nue.id = dih.estado_nuevo_id
        WHERE dih.instancia_id = ${input.instanceId}::uuid
          AND (${input.cursor ?? null}::uuid IS NULL
               OR dih.id < ${input.cursor ?? null}::uuid)
        ORDER BY dih.ejecutado_en DESC, dih.id DESC
        LIMIT ${input.limit + 1}
      `;

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1]!.id : null;

      return { items, nextCursor };
    });
  }),
});
