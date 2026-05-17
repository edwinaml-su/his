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
 *   Paso 1 — registrar (estado: 'pendiente_aprobacion')
 *     Roles permitidos: TEC (técnico de diagnóstico), PROF_DX (profesional diagnóstico).
 *     Precondición: ece.solicitud_estudio.estado IN ('firmado','validado').
 *     Acción: INSERT en ece.resultado_estudio con el contenido del resultado,
 *             interpretación opcional y URI de archivo adjunto.
 *
 *   Paso 2 — aprobar (estado: 'aprobado')
 *     Roles permitidos: MC | PHYSICIAN (médico certificador).
 *     Acción: UPDATE estado + comentario_medico.
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (domainEvent vía emitDomainEvent inside Prisma.$transaction)
 * ---------------------------------------------------------------------------
 *   'ece.resultado_estudio.registrado'  — emitido por registrar()
 *   'ece.resultado_estudio.aprobado'    — emitido por aprobar()
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.resultado_estudio   — fila principal: resultado, interpretacion, adjunto_uri,
 *                             estado, comentario_medico, solicitud_id (FK)
 *   ece.solicitud_estudio   — consultada para validar precondición de estado
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   list, get   → cualquier rol autenticado con tenant (tenantProcedure)
 *   registrar   → requireRole(["TEC","PROF_DX"])
 *   aprobar     → requireRole(["MC","PHYSICIAN"])
 *
 * Raw SQL es obligatorio porque ece.* vive fuera del modelo Prisma (opción B,
 * schema separado). Todas las queries usan prisma.$queryRaw / $executeRaw con
 * Prisma.sql para evitar interpolación directa (sql injection prevention).
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
  resultado: z.string().min(1).max(10000),
  interpretacion: z.string().max(4000).optional(),
  adjuntoUri: z.string().url().max(2000).optional(),
});

const aprobarSchema = z.object({
  resultadoId: z.string().uuid(),
  comentarioMedico: z.string().max(2000).optional(),
});

const listSchema = z.object({
  solicitudId: z.string().uuid(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const getSchema = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// Tipos de fila raw
// ---------------------------------------------------------------------------

export interface ResultadoRow {
  id: string;
  solicitud_id: string;
  resultado: string;
  interpretacion: string | null;
  adjunto_uri: string | null;
  registrado_por: string;
  registrado_en: Date;
  aprobado_por: string | null;
  aprobado_en: Date | null;
  comentario_medico: string | null;
  estado: string;
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
      solicitud_id::text,
      resultado,
      interpretacion,
      adjunto_uri,
      registrado_por::text,
      registrado_en,
      aprobado_por::text,
      aprobado_en,
      comentario_medico,
      estado
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
          solicitud_id::text,
          resultado,
          interpretacion,
          adjunto_uri,
          registrado_por::text,
          registrado_en,
          aprobado_por::text,
          aprobado_en,
          comentario_medico,
          estado
        FROM ece.resultado_estudio
        WHERE solicitud_id = ${input.solicitudId}::uuid
          AND (${input.cursor ?? null}::uuid IS NULL OR id < ${input.cursor ?? null}::uuid)
        ORDER BY registrado_en DESC, id DESC
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

      const resRows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.resultado_estudio
          (solicitud_id, resultado, interpretacion, adjunto_uri, registrado_por, estado)
        VALUES (
          ${input.solicitudId}::uuid,
          ${input.resultado},
          ${input.interpretacion ?? null},
          ${input.adjuntoUri ?? null},
          ${personal.id}::uuid,
          'pendiente_aprobacion'
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

  /** MC aprueba el resultado clínicamente. */
  aprobar: mcProc.input(aprobarSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
      const res = await findResultado(tx, input.resultadoId);
      if (!res) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Resultado no encontrado: ${input.resultadoId}` });
      }
      if (res.estado !== "pendiente_aprobacion") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `El resultado no está pendiente de aprobación (estado: ${res.estado}).`,
        });
      }

      const personal = await findPersonal(tx, ctx.user.id);
      if (!personal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No se encontró un profesional de salud asociado a su cuenta.",
        });
      }

      await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
        UPDATE ece.resultado_estudio
        SET estado = 'aprobado',
            aprobado_por = ${personal.id}::uuid,
            aprobado_en = now(),
            comentario_medico = ${input.comentarioMedico ?? null}
        WHERE id = ${input.resultadoId}::uuid
      `;

      await emitDomainEvent(tx, {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.resultado_estudio.aprobado",
        aggregateType: "ResultadoEstudio",
        aggregateId: res.id,
        emittedById: ctx.user.id,
        payload: {
          solicitudId: res.solicitud_id,
          byUserId: ctx.user.id,
          comentarioMedico: input.comentarioMedico ?? null,
        },
      });

      return { ok: true as const, aprobadoEn: new Date().toISOString() };
    });
  }),
});
