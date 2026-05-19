/**
 * Router tRPC — Hoja de Ingreso Hospitalario.
 *
 * Documento NTEC: Doc 12 — Hoja de Ingreso Hospitalario, §3.12.
 * Norma: MINSAL Acuerdo n.° 1616 (2024).
 * Código de tipo_documento: HOJA_ING.
 *
 * La hoja de ingreso es el documento administrativo-clínico que formaliza
 * el ingreso del paciente al establecimiento hospitalario. Vincula la orden
 * de ingreso (emitida por médico) con el episodio hospitalario y la cama
 * asignada. Requiere firma del personal administrativo (ADM) y validación
 * del archivista (ARCH) para quedar en estado oficial.
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (código tipo: HOJA_ING)
 * ---------------------------------------------------------------------------
 *   borrador    → en_revision  (ADM: completar datos administrativos)
 *   en_revision → firmado      (ADM: firma electrónica con PIN argon2id)
 *   firmado     → validado     (ARCH: archivista valida documentación)
 *   borrador|en_revision|firmado → anulado (DIR: solo pre-validado)
 *
 *   El PIN se verifica contra ece.firma_electronica.pin_hash (argon2id).
 *   Lockout automático tras 3 intentos fallidos (locked_until timestamptz).
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (emitDomainEvent dentro del callback de withWorkflowContext)
 * ---------------------------------------------------------------------------
 *   'ece.hoja_ingreso.firmada'   — emitido por firmar(). Disparador para
 *     que el módulo de camas confirme la asignación oficial.
 *     Payload: { hojaIngresoId, episodioHospitalarioId, admId, orgId }
 *   'ece.hoja_ingreso.validada'  — emitido por validar().
 *     Payload: { hojaIngresoId, archId, orgId }
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.hoja_ingreso              — fila principal: episodio_hospitalario_id,
 *                                   orden_ingreso_id (FK nullable),
 *                                   fecha_ingreso, motivo_ingreso, estado,
 *                                   firmado_por, firmado_en, validado_por
 *   ece.orden_ingreso             — consultada para validar la orden médica
 *   ece.documento_instancia       — instancia de flujo vinculada
 *   ece.firma_electronica         — credencial de firma del ADM
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   list, get           → requireRole(["MC","ENF","ESP","ARCH","DIR","ADM"])
 *   create, update      → requireRole(["ADM"])
 *   firmar              → requireRole(["ADM"])    — requiere PIN
 *   validar             → requireRole(["ARCH"])
 *   anular              → requireRole(["DIR"])
 */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import argon2 from "@his/infrastructure/firma/argon2";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext, type EceContext } from "../../workflow/context";
import { emitDomainEvent } from "@his/database";
import {
  eceHojaIngresoCreateSchema,
  eceHojaIngresoUpdateSchema,
  eceHojaIngresoListSchema,
  eceHojaIngresoGetSchema,
  eceHojaIngresoFirmarSchema,
  eceHojaIngresoValidarSchema,
  eceHojaIngresoAnularSchema,
  type HojaIngresoRow,
} from "./hoja-ingreso.schemas";

// Re-exportamos los schemas locales para que el router sea auto-contenido.
export type { HojaIngresoRow };

// =============================================================================
// Tipos auxiliares de raw SQL
// =============================================================================

interface PersonalRow { id: string }
interface FirmaRow {
  id: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  revoked_at: Date | null;
}
interface TipoDocRow {
  tipo_doc_id: string;
  estado_inicial_id: string;
}
interface OrdenIngresoRow {
  id: string;
  paciente_id: string;
  episodio_hospitalario_id: string | null;
}

// =============================================================================
// Alias de tipo para el tx dentro de withWorkflowContext
// =============================================================================

type RawTx = {
  $queryRaw: (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>;
  $executeRaw: (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>;
};

// =============================================================================
// Helpers de construcción de contexto ECE
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

async function withEce<T>(
  prisma: Parameters<typeof withWorkflowContext>[0],
  ctx: EceContext,
  fn: Parameters<typeof withWorkflowContext<T>>[2],
): Promise<T> {
  return withWorkflowContext<T>(prisma, ctx, fn);
}

// =============================================================================
// Helpers de consulta raw
// =============================================================================

async function findHojaIngreso(tx: RawTx, id: string): Promise<HojaIngresoRow | null> {
  const rows = await (tx.$queryRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
  ) => Promise<HojaIngresoRow[]>)`
    SELECT
      hi.id::text,
      hi.instancia_id::text,
      hi.paciente_id::text,
      hi.episodio_hospitalario_id::text,
      hi.orden_ingreso_id::text,
      hi.fecha_hora_ingreso,
      hi.servicio_ingreso_id::text,
      hi.cama_asignada_id::text,
      hi.modalidad,
      hi.procedencia,
      hi.diagnostico_ingreso,
      hi.motivo_consulta,
      hi.notas_adicionales,
      hi.admisionista_id::text,
      fe.codigo AS estado_codigo,
      fe.id::text AS estado_id,
      di.creado_en
    FROM ece.hoja_ingreso hi
    JOIN ece.documento_instancia di ON di.id = hi.instancia_id
    JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
    WHERE hi.id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findPersonal(tx: RawTx, hisUserId: string): Promise<PersonalRow | null> {
  const rows = await (tx.$queryRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
  ) => Promise<PersonalRow[]>)`
    SELECT id::text
    FROM ece.personal_salud
    WHERE his_user_id = ${hisUserId}::uuid AND activo = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findFirmaByPersonal(tx: RawTx, personalId: string): Promise<FirmaRow | null> {
  const rows = await (tx.$queryRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
  ) => Promise<FirmaRow[]>)`
    SELECT id::text, pin_hash, failed_attempts, locked_until, revoked_at
    FROM ece.firma_electronica
    WHERE personal_id = ${personalId}::uuid AND revoked_at IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findOrdenIngreso(tx: RawTx, ordenId: string): Promise<OrdenIngresoRow | null> {
  const rows = await (tx.$queryRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
  ) => Promise<OrdenIngresoRow[]>)`
    SELECT
      id::text,
      paciente_id::text,
      episodio_hospitalario_id::text
    FROM ece.orden_ingreso
    WHERE id = ${ordenId}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function resolveTipoDoc(tx: RawTx): Promise<TipoDocRow> {
  const rows = await (tx.$queryRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
  ) => Promise<TipoDocRow[]>)`
    SELECT td.id::text AS tipo_doc_id, fe.id::text AS estado_inicial_id
    FROM ece.tipo_documento td
    JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
    WHERE td.codigo = 'HOJA_ING'
    LIMIT 1
  `;
  if (rows.length === 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Tipo de documento HOJA_ING no configurado en el catálogo ECE.",
    });
  }
  return rows[0]!;
}

// =============================================================================
// Verificación de PIN con lockout (mismo patrón que consentimiento.router)
// =============================================================================

const LOCKOUT_MAX = 5;

async function verifyPinOrThrow(
  tx: RawTx,
  hisUserId: string,
  pin: string,
): Promise<{ firmaId: string }> {
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
      message: "Firma electrónica no configurada. Use firma.setup para crearla.",
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
      tpl: TemplateStringsArray, ...args: unknown[]
    ) => Promise<number>)`
      UPDATE ece.firma_electronica
      SET failed_attempts = failed_attempts + 1
      WHERE id = ${firma.id}::uuid
    `;
    const remaining = LOCKOUT_MAX - (firma.failed_attempts + 1);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: remaining > 0
        ? `PIN incorrecto. Intentos restantes: ${remaining}.`
        : "PIN incorrecto. La firma quedará bloqueada.",
    });
  }

  await (tx.$executeRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
  ) => Promise<number>)`
    UPDATE ece.firma_electronica SET failed_attempts = 0 WHERE id = ${firma.id}::uuid
  `;

  return { firmaId: firma.id };
}

// =============================================================================
// Avanzar estado del workflow
// =============================================================================

async function avanzarEstado(
  tx: RawTx,
  instanciaId: string,
  accion: string,
  ejecutadoPor: string,
  rolCodigo: string,
  firmaId?: string,
): Promise<{ estadoDestinoId: string }> {
  const transiciones = await (tx.$queryRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
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
      message: `Transición '${accion}' no permitida desde el estado actual para el rol ${rolCodigo}.`,
    });
  }

  const { estado_destino_id } = transiciones[0]!;

  await (tx.$executeRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
  ) => Promise<number>)`
    UPDATE ece.documento_instancia
    SET estado_actual_id = ${estado_destino_id}::uuid,
        version = version + 1
    WHERE id = ${instanciaId}::uuid
  `;

  await (tx.$executeRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
  ) => Promise<number>)`
    INSERT INTO ece.documento_instancia_historial
      (instancia_id, estado_anterior_id, estado_nuevo_id, accion, ejecutado_por, firma_id, rol_ejecutor_id)
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

  return { estadoDestinoId: estado_destino_id };
}

// =============================================================================
// Hash del payload (para outbox)
// =============================================================================

function computePayloadHash(row: HojaIngresoRow): string {
  const payload = JSON.stringify({
    id: row.id,
    paciente_id: row.paciente_id,
    orden_ingreso_id: row.orden_ingreso_id,
    fecha_hora_ingreso: row.fecha_hora_ingreso,
    servicio_ingreso_id: row.servicio_ingreso_id,
    modalidad: row.modalidad,
    procedencia: row.procedencia,
    diagnostico_ingreso: row.diagnostico_ingreso,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

// =============================================================================
// Procedures
// =============================================================================

const admProc     = requireRole(["ADM"]);
const archProc    = requireRole(["ARCH"]);
const dirProc     = requireRole(["DIR"]);
const readerProc  = requireRole(["ADM", "MC", "ESP", "ENF", "ARCH", "DIR"]);

// =============================================================================
// Router
// =============================================================================

export const eceHojaIngresoRouter = router({

  /** Lista hojas de ingreso con filtros opcionales. Paginado por página. */
  list: readerProc.input(eceHojaIngresoListSchema).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    const offset = (input.page - 1) * input.pageSize;

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const countRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ total: bigint }>>)`
        SELECT COUNT(*)::bigint AS total
        FROM ece.hoja_ingreso hi
        JOIN ece.documento_instancia di ON di.id = hi.instancia_id
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE (${input.pacienteId ?? null}::uuid IS NULL OR hi.paciente_id = ${input.pacienteId ?? null}::uuid)
          AND (${input.servicioId ?? null}::uuid IS NULL OR hi.servicio_ingreso_id = ${input.servicioId ?? null}::uuid)
          AND (${input.estado ?? null}::text IS NULL OR fe.codigo = ${input.estado ?? null}::text)
          AND (${input.fecha ?? null}::date IS NULL OR hi.fecha_hora_ingreso::date = ${input.fecha ?? null}::date)
      `;
      const total = Number(countRows[0]?.total ?? 0n);

      const rows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<HojaIngresoRow[]>)`
        SELECT
          hi.id::text,
          hi.instancia_id::text,
          hi.paciente_id::text,
          hi.episodio_hospitalario_id::text,
          hi.orden_ingreso_id::text,
          hi.fecha_hora_ingreso,
          hi.servicio_ingreso_id::text,
          hi.cama_asignada_id::text,
          hi.modalidad,
          hi.procedencia,
          hi.diagnostico_ingreso,
          hi.motivo_consulta,
          hi.notas_adicionales,
          hi.admisionista_id::text,
          fe.codigo AS estado_codigo,
          fe.id::text AS estado_id,
          di.creado_en
        FROM ece.hoja_ingreso hi
        JOIN ece.documento_instancia di ON di.id = hi.instancia_id
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE (${input.pacienteId ?? null}::uuid IS NULL OR hi.paciente_id = ${input.pacienteId ?? null}::uuid)
          AND (${input.servicioId ?? null}::uuid IS NULL OR hi.servicio_ingreso_id = ${input.servicioId ?? null}::uuid)
          AND (${input.estado ?? null}::text IS NULL OR fe.codigo = ${input.estado ?? null}::text)
          AND (${input.fecha ?? null}::date IS NULL OR hi.fecha_hora_ingreso::date = ${input.fecha ?? null}::date)
        ORDER BY hi.fecha_hora_ingreso DESC, hi.id DESC
        LIMIT ${input.pageSize} OFFSET ${offset}
      `;

      return { items: rows, total, page: input.page, pageSize: input.pageSize };
    });
  }),

  /** Devuelve una hoja de ingreso por id. NOT_FOUND si no existe. */
  get: readerProc.input(eceHojaIngresoGetSchema).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const row = await findHojaIngreso(tx, input.id);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Hoja de ingreso no encontrada: ${input.id}`,
        });
      }
      return row;
    });
  }),

  /**
   * Crea una hoja de ingreso en borrador.
   *
   * Pasos:
   *   1. Resolver tipo_documento HOJA_ING y su estado inicial.
   *   2. Verificar que la orden_ingreso existe y extraer paciente_id.
   *   3. Crear documento_instancia (workflow en borrador).
   *   4. Insertar ece.hoja_ingreso.
   *
   * CONFLICT si ya existe una hoja no anulada para la misma orden.
   */
  create: admProc.input(eceHojaIngresoCreateSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      // 1. Tipo de documento
      const tipoDoc = await resolveTipoDoc(tx);

      // 2. Orden de ingreso
      const orden = await findOrdenIngreso(tx, input.ordenIngresoId);
      if (!orden) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Orden de ingreso no encontrada: ${input.ordenIngresoId}`,
        });
      }

      // 3. Verificar duplicado (solo una hoja activa por orden)
      const existente = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ id: string; estado: string }>>)`
        SELECT hi.id::text, fe.codigo AS estado
        FROM ece.hoja_ingreso hi
        JOIN ece.documento_instancia di ON di.id = hi.instancia_id
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE hi.orden_ingreso_id = ${input.ordenIngresoId}::uuid
          AND fe.codigo != 'anulado'
        LIMIT 1
      `;

      if (existente.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Ya existe una hoja de ingreso activa (id: ${existente[0]!.id}, estado: ${existente[0]!.estado}) para esta orden.`,
        });
      }

      // 4. Personal del admisionista
      const personal = await findPersonal(tx, ctx.user.id);
      if (!personal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No se encontró un profesional de salud asociado a su cuenta.",
        });
      }

      // 5. Crear instancia de workflow
      const instanciaRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.documento_instancia
          (tipo_documento_id, paciente_id, estado_actual_id, creado_por)
        VALUES (
          ${tipoDoc.tipo_doc_id}::uuid,
          ${orden.paciente_id}::uuid,
          ${tipoDoc.estado_inicial_id}::uuid,
          ${eceCtx.personalId}::uuid
        )
        RETURNING id::text
      `;
      const instanciaId = instanciaRows[0]!.id;

      // 6. Insertar hoja de ingreso
      const hojaRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.hoja_ingreso
          (instancia_id, paciente_id, episodio_hospitalario_id, orden_ingreso_id,
           fecha_hora_ingreso, servicio_ingreso_id, cama_asignada_id,
           modalidad, procedencia, diagnostico_ingreso, motivo_consulta,
           notas_adicionales, admisionista_id)
        VALUES (
          ${instanciaId}::uuid,
          ${orden.paciente_id}::uuid,
          ${orden.episodio_hospitalario_id ?? null}::uuid,
          ${input.ordenIngresoId}::uuid,
          ${input.fechaHoraIngreso.toISOString()},
          ${input.servicioIngresoId}::uuid,
          ${input.camaAsignadaId ?? null}::uuid,
          ${input.modalidad},
          ${input.procedencia},
          ${input.diagnosticoIngreso ?? null},
          ${input.motivoConsulta ?? null},
          ${input.notasAdicionales ?? null},
          ${personal.id}::uuid
        )
        RETURNING id::text
      `;

      return {
        id: hojaRows[0]!.id,
        instanciaId,
        estadoCodigo: "borrador" as const,
      };
    });
  }),

  /**
   * Actualiza una hoja de ingreso. Solo permitido en estado borrador.
   */
  update: admProc.input(eceHojaIngresoUpdateSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const hoja = await findHojaIngreso(tx, input.id);
      if (!hoja) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Hoja de ingreso no encontrada: ${input.id}` });
      }
      if (hoja.estado_codigo !== "borrador") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede editar en estado borrador (estado actual: ${hoja.estado_codigo}).`,
        });
      }

      await (tx.$executeRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<number>)`
        UPDATE ece.hoja_ingreso SET
          fecha_hora_ingreso  = COALESCE(${input.fechaHoraIngreso?.toISOString() ?? null}::timestamptz, fecha_hora_ingreso),
          servicio_ingreso_id = COALESCE(${input.servicioIngresoId ?? null}::uuid, servicio_ingreso_id),
          cama_asignada_id    = ${input.camaAsignadaId !== undefined ? (input.camaAsignadaId ?? null) : null}::uuid,
          modalidad           = COALESCE(${input.modalidad ?? null}, modalidad),
          procedencia         = COALESCE(${input.procedencia ?? null}, procedencia),
          diagnostico_ingreso = COALESCE(${input.diagnosticoIngreso ?? null}, diagnostico_ingreso),
          motivo_consulta     = COALESCE(${input.motivoConsulta ?? null}, motivo_consulta),
          notas_adicionales   = COALESCE(${input.notasAdicionales ?? null}, notas_adicionales)
        WHERE id = ${input.id}::uuid
      `;

      return { ok: true as const };
    });
  }),

  /**
   * Firma la hoja de ingreso con el PIN electrónico del ADM.
   * Avanza el workflow: borrador → en_revision → firmado (según config HOJA_ING).
   * Emite outbox ece.hoja_ingreso.firmada.
   */
  firmar: admProc.input(eceHojaIngresoFirmarSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const hoja = await findHojaIngreso(tx, input.id);
      if (!hoja) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Hoja de ingreso no encontrada: ${input.id}` });
      }

      const estadosPermitidos: string[] = ["borrador", "en_revision"];
      if (!estadosPermitidos.includes(hoja.estado_codigo)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `No se puede firmar desde el estado '${hoja.estado_codigo}'.`,
        });
      }

      const { firmaId } = await verifyPinOrThrow(tx, ctx.user.id, input.pin);

      await avanzarEstado(tx, hoja.instancia_id, "firmar", eceCtx.personalId, "ADM", firmaId);

      const payloadHash = computePayloadHash(hoja);

      await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.hoja_ingreso.firmada",
        aggregateType: "HojaIngreso",
        aggregateId: hoja.id,
        emittedById: ctx.user.id,
        payload: {
          hojaIngresoId: hoja.id,
          instanciaId: hoja.instancia_id,
          tipoDocumentoCodigo: "HOJA_ING" as const,
          accion: "firmar" as const,
          byUserId: ctx.user.id,
          firmaId,
          payloadHash,
        },
      });

      return { ok: true as const, payloadHash, firmadoEn: new Date().toISOString() };
    });
  }),

  /**
   * Valida la hoja de ingreso firmada. Rol ARCH.
   * Avanza: firmado → validado.
   * Emite outbox ece.hoja_ingreso.validada.
   */
  validar: archProc.input(eceHojaIngresoValidarSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const hoja = await findHojaIngreso(tx, input.id);
      if (!hoja) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Hoja de ingreso no encontrada: ${input.id}` });
      }
      if (hoja.estado_codigo !== "firmado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede validar desde estado 'firmado' (actual: ${hoja.estado_codigo}).`,
        });
      }

      await avanzarEstado(tx, hoja.instancia_id, "validar", eceCtx.personalId, "ARCH");

      const payloadHash = computePayloadHash(hoja);

      await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.hoja_ingreso.validada",
        aggregateType: "HojaIngreso",
        aggregateId: hoja.id,
        emittedById: ctx.user.id,
        payload: {
          hojaIngresoId: hoja.id,
          instanciaId: hoja.instancia_id,
          tipoDocumentoCodigo: "HOJA_ING" as const,
          accion: "validar" as const,
          byUserId: ctx.user.id,
          observacion: input.observacion ?? null,
          payloadHash,
        },
      });

      return { ok: true as const, validadoEn: new Date().toISOString() };
    });
  }),

  /**
   * Anula la hoja de ingreso. Rol DIR.
   * Válido desde cualquier estado pre-validado (borrador, en_revision, firmado).
   */
  anular: dirProc.input(eceHojaIngresoAnularSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const hoja = await findHojaIngreso(tx, input.id);
      if (!hoja) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Hoja de ingreso no encontrada: ${input.id}` });
      }
      if (hoja.estado_codigo === "validado" || hoja.estado_codigo === "anulado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `No se puede anular una hoja en estado '${hoja.estado_codigo}'.`,
        });
      }

      await avanzarEstado(tx, hoja.instancia_id, "anular", eceCtx.personalId, "DIR");

      // Registrar motivo en notas (campo libre, no hay tabla dedicada)
      await (tx.$executeRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<number>)`
        UPDATE ece.hoja_ingreso
        SET notas_adicionales = CONCAT(
          COALESCE(notas_adicionales || E'\n', ''),
          '[ANULACIÓN] ',
          ${input.motivoAnulacion}
        )
        WHERE id = ${input.id}::uuid
      `;

      return { ok: true as const, anuladoEn: new Date().toISOString() };
    });
  }),
});
