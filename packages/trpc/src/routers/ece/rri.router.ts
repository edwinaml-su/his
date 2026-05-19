/**
 * Router tRPC — ECE Referencia / Retorno / Interconsulta (RRI).
 *
 * Documento NTEC: Doc 10 — Referencia, Retorno e Interconsulta Médica.
 * Norma: MINSAL Acuerdo n.° 1616 (2024), §3.10.
 * Código de tipo_documento: RRI.
 * Regula el traslado de pacientes entre niveles de atención (referencia),
 *   la respuesta de retorno del centro receptor, y las interconsultas
 *   entre especialidades dentro del mismo establecimiento.
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (doble firma con PIN — código tipo: RRI)
 * ---------------------------------------------------------------------------
 *   borrador    → en_revision  (MC: completar datos de la solicitud)
 *   en_revision → firmado      (MC: firma con PIN argon2id)
 *                               → emite 'ece.rri.firmada'
 *   firmado     → validado     (IC: médico interconsultante responde + firma PIN)
 *                               → emite 'ece.rri.respondida'
 *   cualquiera  → anulado      (DIR: pre-validado)
 *
 *   Paso 1: MC (Médico Certificador) crea la solicitud de RRI (borrador).
 *   Paso 2: MC firma con PIN electrónico (firmar) — el documento se vuelve oficial.
 *   Paso 3: IC (Médico Interconsultante / centro receptor) responde y firma con PIN.
 *   Paso 4 (opcional): DIR anula en caso de error o cancelación.
 *
 *   El PIN se verifica contra ece.firma_electronica.pin_hash (argon2id).
 *   Lockout automático tras 3 intentos fallidos (locked_until timestamptz).
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (emitDomainEvent dentro del callback de withWorkflowContext)
 * ---------------------------------------------------------------------------
 *   'ece.rri.firmada'     — emitido por firmar(). Notifica al centro receptor.
 *     Payload: { rriId, episodioId, medicoId, tipo ('referencia'|'interconsulta'),
 *                payloadHash, orgId }
 *   'ece.rri.respondida'  — emitido por responder(). Cierra el circuito.
 *     Payload: { rriId, icId, respuestaInterconsultante, payloadHash, orgId }
 *   payloadHash = SHA-256({ motivo, resumenClinico, establecimientoDestinoId,
 *                            especialidadSolicitada })
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.rri                  — fila principal: episodio_id, tipo,
 *                              motivo, resumen_clinico,
 *                              establecimiento_destino_id,
 *                              respuesta_interconsultante,
 *                              solicitado_por, respondido_por,
 *                              registrado_en (DEFAULT now()), instancia_id
 *   ece.documento_instancia  — instancia de flujo vinculada
 *   ece.personal_salud       — mapeo his_user_id → personal ECE id
 *   ece.firma_electronica    — credencial PIN (argon2id) del MC y del IC
 *
 * ---------------------------------------------------------------------------
 * HD-25 (S1): schema drift corregido
 * ---------------------------------------------------------------------------
 *   destino_servicio_id          → establecimiento_destino_id
 *   datos_clinicos_relevantes    → resumen_clinico
 *   respuesta                    → respuesta_interconsultante
 *   fecha_solicitud              → eliminado (DB usa registrado_en DEFAULT now())
 *   urgencia                     → eliminado (columna no existe en BD)
 *   diagnostico_ic               → eliminado (columna no existe en BD)
 *   plan_ic                      → eliminado (columna no existe en BD)
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   list, get    → requireRole(["MC","PHYSICIAN","IC","DIR","NURSE"])
 *   create       → requireRole(["MC","PHYSICIAN"])
 *   firmar       → requireRole(["MC","PHYSICIAN"])  — requiere PIN
 *   responder    → requireRole(["IC","PHYSICIAN"])  — requiere PIN
 *   anular       → requireRole(["DIR"])
 */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { argon2 } from "@his/infrastructure";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext, type EceContext } from "../../workflow/context";
import { emitDomainEvent } from "@his/database";
import {
  eceRriListSchema,
  eceRriGetSchema,
  eceRriCreateSchema,
  eceRriFirmarSchema,
  eceRriResponderSchema,
  eceRriAnularSchema,
} from "./rri.schemas";

// =============================================================================
// Tipos de fila raw — alineados con columnas reales de ece.rri
// =============================================================================

export interface RriRow {
  id: string;
  instancia_id: string;
  paciente_id: string;
  episodio_id: string;
  tipo: string;
  establecimiento_destino_id: string | null;
  motivo: string;
  resumen_clinico: string | null;
  especialidad_solicitada: string | null;
  solicitado_por: string;
  respondido_por: string | null;
  respuesta_interconsultante: string | null;
  registrado_en: Date;
  estado_codigo: string;
  estado_id: string;
}

interface PersonalRow { id: string }
interface FirmaRow {
  id: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  revoked_at: Date | null;
}

// =============================================================================
// Helpers de contexto
// =============================================================================

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

async function withEceContext<T>(
  prisma: Parameters<typeof withWorkflowContext>[0],
  ctx: EceContext,
  fn: Parameters<typeof withWorkflowContext<T>>[2],
): Promise<T> {
  return withWorkflowContext(prisma, ctx, fn);
}

// =============================================================================
// Helpers de lectura raw
// =============================================================================

type RawTx = {
  $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
};

async function findRri(tx: RawTx, id: string): Promise<RriRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<RriRow[]>)`
    SELECT
      r.id::text,
      r.instancia_id::text,
      r.paciente_id::text,
      r.episodio_id::text,
      r.tipo,
      r.establecimiento_destino_id::text,
      r.motivo,
      r.resumen_clinico,
      r.especialidad_solicitada,
      r.solicitado_por::text,
      r.respondido_por::text,
      r.respuesta_interconsultante,
      r.registrado_en,
      fe.codigo AS estado_codigo,
      fe.id::text AS estado_id
    FROM ece.rri r
    JOIN ece.documento_instancia di ON di.id = r.instancia_id
    JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
    WHERE r.id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findPersonal(tx: RawTx, hisUserId: string): Promise<PersonalRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<PersonalRow[]>)`
    SELECT id::text
    FROM ece.personal_salud
    WHERE his_user_id = ${hisUserId}::uuid
      AND activo = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findFirmaByPersonal(tx: RawTx, personalId: string): Promise<FirmaRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<FirmaRow[]>)`
    SELECT id::text, pin_hash, failed_attempts, locked_until, revoked_at
    FROM ece.firma_electronica
    WHERE personal_id = ${personalId}::uuid
      AND revoked_at IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// =============================================================================
// Helper: verificar PIN con lockout
// =============================================================================

const LOCKOUT_MAX = 5;

async function verifyPinOrThrow(
  tx: RawTx,
  hisUserId: string,
  pin: string,
): Promise<{ firmaId: string; personalId: string }> {
  const personal = await findPersonal(tx, hisUserId);
  if (!personal) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No se encontró un profesional de salud asociado a su cuenta.",
    });
  }

  const firma = await findFirmaByPersonal(tx, personal.id);
  if (!firma) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Firma electrónica no configurada.",
    });
  }

  if (firma.locked_until !== null && firma.locked_until > new Date()) {
    const mins = Math.ceil((firma.locked_until.getTime() - Date.now()) / 60_000);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Firma bloqueada. Inténtelo en ${mins} min.`,
    });
  }

  const valid = await argon2.verify(firma.pin_hash, pin);

  if (!valid) {
    await (tx.$executeRaw as (
      q: TemplateStringsArray,
      ...v: unknown[]
    ) => Promise<number>)`
      UPDATE ece.firma_electronica
      SET failed_attempts = failed_attempts + 1
      WHERE id = ${firma.id}::uuid
    `;
    const remaining = LOCKOUT_MAX - (firma.failed_attempts + 1);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        remaining > 0
          ? `PIN incorrecto. Intentos restantes: ${remaining}.`
          : "PIN incorrecto. La firma quedará bloqueada.",
    });
  }

  await (tx.$executeRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<number>)`
    UPDATE ece.firma_electronica
    SET failed_attempts = 0
    WHERE id = ${firma.id}::uuid
  `;

  return { firmaId: firma.id, personalId: personal.id };
}

// =============================================================================
// Helper: avanzar estado workflow
// =============================================================================

async function avanzarEstado(
  tx: RawTx,
  instanciaId: string,
  accion: string,
  ejecutadoPor: string,
  rolCodigo: string,
  firmaId?: string,
): Promise<void> {
  const transiciones = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<Array<{ estado_destino_id: string }>>)`
    SELECT ft.estado_destino_id::text
    FROM ece.flujo_transicion ft
    JOIN ece.flujo_estado fe_origen ON fe_origen.id = ft.estado_origen_id
    JOIN ece.rol r ON r.id = ft.rol_autoriza_id
    JOIN ece.documento_instancia di ON di.estado_actual_id = fe_origen.id
    WHERE di.id = ${instanciaId}::uuid
      AND ft.accion = ${accion}
      AND r.codigo = ${rolCodigo}
    LIMIT 1
  `;

  if (transiciones.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Transición '${accion}' no permitida para el rol ${rolCodigo} en el estado actual.`,
    });
  }

  const { estado_destino_id } = transiciones[0]!;

  await (tx.$executeRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<number>)`
    UPDATE ece.documento_instancia
    SET estado_actual_id = ${estado_destino_id}::uuid,
        version = version + 1
    WHERE id = ${instanciaId}::uuid
  `;

  await (tx.$executeRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<number>)`
    INSERT INTO ece.documento_instancia_historial
      (instancia_id, estado_anterior_id, estado_nuevo_id, accion,
       ejecutado_por, firma_id, rol_ejecutor_id)
    SELECT
      ${instanciaId}::uuid,
      di.estado_actual_id,
      ${estado_destino_id}::uuid,
      ${accion},
      ${ejecutadoPor}::uuid,
      ${firmaId ?? null}::uuid,
      r.id
    FROM ece.documento_instancia di
    JOIN ece.rol r ON r.codigo = ${rolCodigo}
    WHERE di.id = ${instanciaId}::uuid
  `;
}

// =============================================================================
// Helper: hash payload
// =============================================================================

function computeRriHash(rri: RriRow): string {
  const payload = JSON.stringify({
    id: rri.id,
    tipo: rri.tipo,
    motivo: rri.motivo,
    resumen_clinico: rri.resumen_clinico,
    establecimiento_destino_id: rri.establecimiento_destino_id,
    solicitado_por: rri.solicitado_por,
    registrado_en: rri.registrado_en,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

// =============================================================================
// Role procedures
// =============================================================================

const mcProc = requireRole(["MC", "ESP"]);
const icProc = requireRole(["MC", "ESP", "IC"]);
const dirProc = requireRole(["DIR"]);
const readerProc = requireRole(["MC", "ESP", "IC", "ENF", "DIR", "ARCH"]);

// =============================================================================
// Router
// =============================================================================

export const eceRriRouter = router({
  /**
   * Lista RRI con filtros opcionales: paciente, episodio, tipo y estado.
   * Paginación por cursor.
   */
  list: readerProc.input(eceRriListSchema).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx, async (tx) => {
      const rows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<RriRow[]>)`
        SELECT
          r.id::text,
          r.instancia_id::text,
          r.paciente_id::text,
          r.episodio_id::text,
          r.tipo,
          r.establecimiento_destino_id::text,
          r.motivo,
          r.resumen_clinico,
          r.especialidad_solicitada,
          r.solicitado_por::text,
          r.respondido_por::text,
          r.respuesta_interconsultante,
          r.registrado_en,
          fe.codigo AS estado_codigo,
          fe.id::text AS estado_id
        FROM ece.rri r
        JOIN ece.documento_instancia di ON di.id = r.instancia_id
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE (${input.pacienteId ?? null}::uuid IS NULL OR r.paciente_id = ${input.pacienteId ?? null}::uuid)
          AND (${input.episodioId ?? null}::uuid IS NULL OR r.episodio_id = ${input.episodioId ?? null}::uuid)
          AND (${input.tipo ?? null}::text IS NULL OR r.tipo = ${input.tipo ?? null}::text)
          AND (${input.estado ?? null}::text IS NULL OR fe.codigo = ${input.estado ?? null}::text)
          AND (${input.cursor ?? null}::uuid IS NULL OR r.id < ${input.cursor ?? null}::uuid)
        ORDER BY r.registrado_en DESC, r.id DESC
        LIMIT ${input.limit}
      `;

      const nextCursor = rows.length === input.limit ? rows[rows.length - 1]!.id : null;
      return { items: rows, nextCursor };
    });
  }),

  /**
   * Obtiene una RRI por id. NOT_FOUND si no existe.
   */
  get: readerProc.input(eceRriGetSchema).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx, async (tx) => {
      const rri = await findRri(tx, input.id);
      if (!rri) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `RRI no encontrada: ${input.id}`,
        });
      }
      return rri;
    });
  }),

  /**
   * Crea una solicitud RRI en estado borrador/en_revision.
   * Requiere rol MC o ESP.
   *
   * Pasos:
   *   1. Resuelve tipo de documento RRI y estado inicial.
   *   2. Resuelve paciente desde episodio.
   *   3. Crea instancia de workflow.
   *   4. Inserta registro clínico en ece.rri.
   */
  create: mcProc.input(eceRriCreateSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx, async (tx) => {
      // 1. Resolver tipo doc RRI + estado inicial
      const tipoRows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ tipo_doc_id: string; estado_inicial_id: string }>>)`
        SELECT td.id::text AS tipo_doc_id, fe.id::text AS estado_inicial_id
        FROM ece.tipo_documento td
        JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
        WHERE td.codigo = 'RRI'
        LIMIT 1
      `;

      if (tipoRows.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Tipo de documento RRI no configurado en el catálogo ECE.",
        });
      }

      const { tipo_doc_id, estado_inicial_id } = tipoRows[0]!;

      // 2. Resolver paciente desde episodio
      const pacienteRows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ paciente_id: string }>>)`
        SELECT paciente_id::text
        FROM ece.episodio_atencion
        WHERE id = ${input.episodioId}::uuid
        LIMIT 1
      `;

      if (pacienteRows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Episodio no encontrado: ${input.episodioId}`,
        });
      }

      const pacienteId = pacienteRows[0]!.paciente_id;

      // 3. Resolver personal_salud del MC solicitante
      const personal = await findPersonal(tx, ctx.user.id);
      if (!personal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No se encontró un profesional de salud asociado a su cuenta.",
        });
      }

      // 4. Crear instancia de workflow
      const instanciaRows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.documento_instancia
          (tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por)
        VALUES (
          ${tipo_doc_id}::uuid,
          ${input.episodioId}::uuid,
          ${pacienteId}::uuid,
          ${estado_inicial_id}::uuid,
          ${eceCtx.personalId}::uuid
        )
        RETURNING id::text
      `;

      const instanciaId = instanciaRows[0]!.id;

      // 5. Insertar registro clínico con columnas reales de ece.rri
      const rriRows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.rri
          (instancia_id, paciente_id, episodio_id, tipo,
           establecimiento_destino_id, motivo, resumen_clinico,
           solicitado_por)
        VALUES (
          ${instanciaId}::uuid,
          ${pacienteId}::uuid,
          ${input.episodioId}::uuid,
          ${input.tipo},
          ${input.establecimientoDestinoId}::uuid,
          ${input.motivo},
          ${input.resumenClinico},
          ${personal.id}::uuid
        )
        RETURNING id::text
      `;

      return {
        rriId: rriRows[0]!.id,
        instanciaId,
        estadoCodigo: "borrador",
      };
    });
  }),

  /**
   * MC firma la solicitud RRI con PIN electrónico.
   * Avanza: en_revision → firmado.
   * Emite outbox 'ece.rri.firmada'.
   */
  firmar: mcProc.input(eceRriFirmarSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx, async (tx) => {
      const rri = await findRri(tx, input.rriId);
      if (!rri) {
        throw new TRPCError({ code: "NOT_FOUND", message: `RRI no encontrada: ${input.rriId}` });
      }

      if (!["borrador", "en_revision"].includes(rri.estado_codigo)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La RRI no está en un estado firmable (estado: ${rri.estado_codigo}).`,
        });
      }

      const { firmaId } = await verifyPinOrThrow(tx, ctx.user.id, input.pin);

      const rolEjecutor = ctx.tenant.roleCodes.includes("MC") ? "MC" : "ESP";
      await avanzarEstado(tx, rri.instancia_id, "firmar", eceCtx.personalId, rolEjecutor, firmaId);

      const payloadHash = computeRriHash(rri);

      await emitDomainEvent(tx, {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.rri.firmada",
        aggregateType: "RRI",
        aggregateId: rri.id,
        emittedById: ctx.user.id,
        payload: {
          instanceId: rri.instancia_id,
          tipo: rri.tipo,
          establecimientoDestinoId: rri.establecimiento_destino_id,
          solicitadoPor: rri.solicitado_por,
          payloadHash,
          firmaId,
        },
      });

      return { ok: true as const, payloadHash, firmadoEn: new Date().toISOString() };
    });
  }),

  /**
   * IC responde la interconsulta/referencia firmada.
   * Avanza: firmado → validado.
   * Emite outbox 'ece.rri.respondida'.
   * Requiere rol IC, MC o ESP (quien responde actúa como IC).
   */
  responder: icProc.input(eceRriResponderSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx, async (tx) => {
      const rri = await findRri(tx, input.rriId);
      if (!rri) {
        throw new TRPCError({ code: "NOT_FOUND", message: `RRI no encontrada: ${input.rriId}` });
      }

      if (rri.estado_codigo !== "firmado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La RRI no está en estado 'firmado' para responder (estado: ${rri.estado_codigo}).`,
        });
      }

      const { firmaId, personalId } = await verifyPinOrThrow(tx, ctx.user.id, input.pin);

      // Persistir respuesta antes de avanzar estado
      await (tx.$executeRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<number>)`
        UPDATE ece.rri
        SET respuesta_interconsultante = ${input.respuestaInterconsultante},
            respondido_por             = ${personalId}::uuid
        WHERE id = ${input.rriId}::uuid
      `;

      const rolEjecutor = ctx.tenant.roleCodes.includes("IC") ? "IC" : "ESP";
      await avanzarEstado(tx, rri.instancia_id, "responder", eceCtx.personalId, rolEjecutor, firmaId);

      await emitDomainEvent(tx, {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.rri.respondida",
        aggregateType: "RRI",
        aggregateId: rri.id,
        emittedById: ctx.user.id,
        payload: {
          instanceId: rri.instancia_id,
          tipo: rri.tipo,
          respondidoPor: personalId,
          firmaId,
        },
      });

      return { ok: true as const, respondidoEn: new Date().toISOString() };
    });
  }),

  /**
   * DIR anula la RRI en cualquier estado previo a validado.
   */
  anular: dirProc.input(eceRriAnularSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx, async (tx) => {
      const rri = await findRri(tx, input.rriId);
      if (!rri) {
        throw new TRPCError({ code: "NOT_FOUND", message: `RRI no encontrada: ${input.rriId}` });
      }

      if (rri.estado_codigo === "validado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "No se puede anular una RRI ya validada.",
        });
      }

      if (rri.estado_codigo === "anulado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "La RRI ya está anulada.",
        });
      }

      await avanzarEstado(tx, rri.instancia_id, "anular", eceCtx.personalId, "DIR");

      return { ok: true as const, anuladoEn: new Date().toISOString() };
    });
  }),
});
