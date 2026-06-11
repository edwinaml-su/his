/**
 * eceResultadoEstudio — Router tRPC para Resultado de Estudio ECE.
 *
 * Documento NTEC: Doc 18 (Resultado de Estudio Diagnóstico / de Laboratorio).
 * Norma: MINSAL Acuerdo n.° 1616 (2024), §3.18.
 * Código de tipo_documento: RES_EST.
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW (dos pasos — no usa ece.flujo_estado genérico)
 * ---------------------------------------------------------------------------
 *   Paso 1 — registrar (estado_registro: 'pendiente_validacion')
 *     Roles permitidos: TEC (técnico de diagnóstico), PROF_DX (profesional diagnóstico).
 *     Precondición: ece.solicitud_estudio.estado IN ('firmado','validado').
 *     Acción: INSERT en ece.resultado_estudio con valores jsonb + interpretacion opcional.
 *
 *   Paso 2 — validarResultado (estado_registro: 'validado')
 *     Roles permitidos: MC | ESP (médico certificador).
 *     Acción: UPDATE estado_registro → 'validado'.
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (domainEvent vía emitDomainEvent inside Prisma.$transaction)
 * ---------------------------------------------------------------------------
 *   'ece.resultado_estudio.registrado'  — emitido por registrar()
 *   'ece.resultado_estudio.validado'    — emitido por validarResultado()
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.resultado_estudio — columnas reales:
 *     id, instancia_id, solicitud_id,
 *     valores (jsonb — objeto con los resultados numéricos/cualitativos),
 *     interpretacion (text, nullable),
 *     responsable_validacion_id (uuid),
 *     fecha_hora_informe (timestamptz),
 *     estado_registro (text)
 *
 *   Columnas NO presentes en BD (eliminadas del router):
 *     adjunto_uri, aprobado_por, aprobado_en, comentario_medico
 *     → Si se requieren clínicamente, deben agregarse via ALTER TABLE (tarea separada).
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   list, get         → requireRole(["MC","ESP","ENF","DIR","ARCH","TEC","PROF_DX"])
 *   registrar         → requireRole(["TEC","PROF_DX","MC","ESP"])
 *   validarResultado  → requireRole(["MC","ESP"])
 *
 * Raw SQL es obligatorio porque ece.* vive fuera del modelo Prisma (opción B,
 * schema separado). Todas las queries usan prisma.$queryRaw / $executeRaw con
 * tagged templates para evitar interpolación directa (sql injection prevention).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext, type EceContext } from "../../workflow/context";
import { emitDomainEvent } from "@his/database";

// ---------------------------------------------------------------------------
// Schemas locales
// ---------------------------------------------------------------------------

const registrarSchema = z.object({
  solicitudId: z.string().uuid(),
  /** Valores del resultado en formato jsonb. Puede ser un objeto con claves analíticas. */
  valores: z.record(z.unknown()).or(z.array(z.unknown())),
  interpretacion: z.string().max(4000).optional(),
});

const validarResultadoSchema = z.object({
  resultadoId: z.string().uuid(),
});

const listSchema = z.object({
  solicitudId: z.string().uuid(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const getSchema = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// Tipos de fila raw — alineados con columnas reales de ece.resultado_estudio
// ---------------------------------------------------------------------------

export interface ResultadoRow {
  id: string;
  instancia_id: string;
  solicitud_id: string;
  /** JSONB con los valores del estudio */
  valores: unknown;
  interpretacion: string | null;
  responsable_validacion_id: string;
  fecha_hora_informe: Date;
  /**
   * CHECK: vigente | rectificado.
   * NO existe estado 'pendiente_validacion' ni 'validado' en el DDL.
   * La "validación médica" es un evento de dominio (ece.resultado_estudio.validado)
   * sin cambio de estado_registro. El valor al insertar es siempre 'vigente'.
   */
  estado_registro: string;
}

interface SolicitudEstadoRow {
  estado_codigo: string;
  instancia_id: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RawTx = {
  $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
};

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

async function withEceCtx<T>(
  prisma: Parameters<typeof withWorkflowContext>[0],
  ctx: EceContext,
  fn: Parameters<typeof withWorkflowContext<T>>[2],
): Promise<T> {
  return withWorkflowContext(prisma, ctx, fn);
}

async function findSolicitudEstado(
  tx: RawTx,
  solicitudId: string,
): Promise<SolicitudEstadoRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<SolicitudEstadoRow[]>)`
    SELECT fe.codigo AS estado_codigo, di.id::text AS instancia_id
    FROM ece.solicitud_estudio se
    JOIN ece.documento_instancia di ON di.id = se.instancia_id
    JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
    WHERE se.id = ${solicitudId}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findResultado(tx: RawTx, id: string): Promise<ResultadoRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<ResultadoRow[]>)`
    SELECT
      id::text,
      instancia_id::text,
      solicitud_id::text,
      valores,
      interpretacion,
      responsable_validacion_id::text,
      fecha_hora_informe,
      estado_registro
    FROM ece.resultado_estudio
    WHERE id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findPersonal(tx: RawTx, hisUserId: string): Promise<{ id: string } | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<Array<{ id: string }>>)`
    SELECT id::text
    FROM ece.personal_salud
    WHERE his_user_id = ${hisUserId}::uuid AND activo = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Procedures
// ---------------------------------------------------------------------------

const tecProc = requireRole(["MC", "ESP", "TEC", "PROF_DX"]);
const mcProc = requireRole(["MC", "ESP"]);
const eceReader = requireRole(["MC", "ESP", "ENF", "DIR", "ARCH", "TEC", "PROF_DX"]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const eceResultadoEstudioRouter = router({
  /** Lista resultados de una solicitud. */
  list: eceReader.input(listSchema).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
      const rows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<ResultadoRow[]>)`
        SELECT
          id::text,
          instancia_id::text,
          solicitud_id::text,
          valores,
          interpretacion,
          responsable_validacion_id::text,
          fecha_hora_informe,
          estado_registro
        FROM ece.resultado_estudio
        WHERE solicitud_id = ${input.solicitudId}::uuid
          AND (${input.cursor ?? null}::uuid IS NULL OR id < ${input.cursor ?? null}::uuid)
        ORDER BY fecha_hora_informe DESC, id DESC
        LIMIT ${input.limit}
      `;
      const nextCursor = rows.length === input.limit ? rows[rows.length - 1]!.id : null;
      return { items: rows, nextCursor };
    });
  }),

  /** Obtiene un resultado por id. */
  get: eceReader.input(getSchema).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
      const res = await findResultado(tx, input.id);
      if (!res) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Resultado no encontrado: ${input.id}` });
      }
      return res;
    });
  }),

  /**
   * Registra el resultado.
   * Solo válido si la solicitud está en estado 'firmado' o 'validado'.
   */
  registrar: tecProc.input(registrarSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
      const solEstado = await findSolicitudEstado(tx, input.solicitudId);
      if (!solEstado) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Solicitud no encontrada: ${input.solicitudId}`,
        });
      }
      if (solEstado.estado_codigo !== "firmado" && solEstado.estado_codigo !== "validado") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Solo se puede registrar resultado de solicitudes firmadas o validadas. Estado actual: '${solEstado.estado_codigo}'.`,
        });
      }

      const personal = await findPersonal(tx, ctx.user.id);
      if (!personal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No se encontró un profesional de salud asociado a su cuenta.",
        });
      }

      // estado_registro CHECK: vigente | rectificado. Se inserta 'vigente' (default de BD).
      // La transición a "validado" no existe en DDL; se representa con evento de dominio.
      const valoresJson = JSON.stringify(input.valores);
      const resRows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.resultado_estudio
          (instancia_id, solicitud_id, valores, interpretacion, responsable_validacion_id, estado_registro)
        VALUES (
          (SELECT instancia_id FROM ece.solicitud_estudio WHERE id = ${input.solicitudId}::uuid LIMIT 1),
          ${input.solicitudId}::uuid,
          ${valoresJson}::jsonb,
          ${input.interpretacion ?? null},
          ${personal.id}::uuid,
          'vigente'
        )
        RETURNING id::text
      `;

      const resultadoId = resRows[0]!.id;

      await emitDomainEvent(tx, {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.resultado_estudio.registrado",
        aggregateType: "ResultadoEstudio",
        aggregateId: resultadoId,
        emittedById: ctx.user.id,
        payload: {
          solicitudId: input.solicitudId,
          instanceId: solEstado.instancia_id,
          byUserId: ctx.user.id,
        },
      });

      return { resultadoId, registradoEn: new Date().toISOString() };
    });
  }),

  /**
   * MC refrenda el resultado clínicamente.
   *
   * estado_registro solo admite 'vigente'|'rectificado' (CHECK DDL). No existe
   * estado 'validado' ni 'pendiente_validacion'. La validación clínica se
   * representa únicamente mediante el evento de dominio ece.resultado_estudio.validado.
   * Si el resultado ya fue refrendado (validado) se permite idempotencia — el MC puede
   * refrendar de nuevo sin error (reafirma la validación).
   */
  validarResultado: mcProc.input(validarResultadoSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
      const res = await findResultado(tx, input.resultadoId);
      if (!res) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Resultado no encontrado: ${input.resultadoId}` });
      }

      await emitDomainEvent(tx, {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.resultado_estudio.validado",
        aggregateType: "ResultadoEstudio",
        aggregateId: res.id,
        emittedById: ctx.user.id,
        payload: {
          solicitudId: res.solicitud_id,
          byUserId: ctx.user.id,
        },
      });

      return { ok: true as const, validadoEn: new Date().toISOString() };
    });
  }),
});
