/**
 * Router tRPC — ECE Orden de Ingreso (ORD_ING).
 *
 * Documento NTEC: Art. 33 — decisión clínica del médico que autoriza el
 * internamiento. Prerrequisito obligatorio de HOJA_ING (apertura administrativa).
 *
 * ---------------------------------------------------------------------------
 * COLUMNAS REALES ece.orden_ingreso (verificadas 2026-05-24 via MCP)
 * ---------------------------------------------------------------------------
 *   id                    uuid        NOT NULL  gen_random_uuid()
 *   instancia_id          uuid        NOT NULL  → ece.documento_instancia.id
 *   paciente_id           uuid        NOT NULL  → ece.paciente.id
 *   episodio_origen_id    uuid        YES       → ece.episodio_atencion.id
 *   circunstancia_ingreso text        NOT NULL
 *   fecha_hora_orden      timestamptz NOT NULL  now()
 *   motivo_ingreso        text        NOT NULL
 *   servicio_ingreso_id   uuid        YES       → ece.servicio.id
 *   procedencia           text        NOT NULL  CHECK (6 valores)
 *   modalidad             text        NOT NULL  CHECK ('hospitalizacion','hospital_de_dia')
 *   diagnostico_ingreso   jsonb       YES
 *   medico_ordena         uuid        NOT NULL  → ece.personal_salud.id
 *   registrado_en         timestamptz NOT NULL  now()
 *   estado_registro       text        NOT NULL  DEFAULT 'vigente' CHECK ('vigente','rectificado')
 *   motivo_ingreso_tipo   text        YES       CHECK (5 valores)
 *   procedimiento_cie10   text        YES
 *   establecimiento_id    uuid        YES       → ece.establecimiento.id
 *   episodio_id           uuid        YES       → ece.episodio_atencion.id
 *   reserva_sala_qx_id    uuid        YES       → ece.reserva_sala_qx.id
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW
 * ---------------------------------------------------------------------------
 *   Estado en ece.documento_instancia (estado_actual_id → flujo_estado).
 *   orden_ingreso.estado_registro = vigente|rectificado (vigencia del registro).
 *   El MC firma con PIN → avanza borrador → firmado en documento_instancia.
 *   La anulación (DIR) avanza → anulado en documento_instancia.
 *
 * ---------------------------------------------------------------------------
 * ROLES
 * ---------------------------------------------------------------------------
 *   list, get   → requireRole(["MC","ESP","ENF","ARCH","DIR","ADM","ADMIN"])
 *   create      → requireRole(["MC","ESP"])   — médico ordena el ingreso
 *   firmar      → requireRole(["MC","ESP"])   — firma electrónica
 *   anular      → requireRole(["DIR"])        — solo pre-validado
 */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { argon2 } from "@his/infrastructure";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext, type EceContext } from "../../workflow/context";
import { emitDomainEvent } from "@his/database";
import { assertDependenciasFirmadas } from "../../ece/dependencias-enforcement";
import {
  ordenIngresoCreateInput,
  ordenIngresoFirmarInput,
  ordenIngresoAnularInput,
  ordenIngresoListInput,
  ordenIngresoGetInput,
} from "@his/contracts/schemas/orden-ingreso";

// =============================================================================
// Tipos raw SQL
// =============================================================================

export interface OrdenIngresoRow {
  id: string;
  instancia_id: string;
  paciente_id: string;
  episodio_origen_id: string | null;
  episodio_id: string | null;
  circunstancia_ingreso: string;
  fecha_hora_orden: Date;
  motivo_ingreso: string;
  servicio_ingreso_id: string | null;
  procedencia: string;
  modalidad: string;
  diagnostico_ingreso: unknown; // jsonb
  medico_ordena: string;
  registrado_en: Date;
  estado_registro: string;
  motivo_ingreso_tipo: string | null;
  procedimiento_cie10: string | null;
  // CC-0005: columnas de identificación (nullable — back-compat con órdenes previas)
  documento_tipo: string | null;
  documento_numero: string | null;
  establecimiento_id: string | null;
  reserva_sala_qx_id: string | null;
  // virtual — JOIN con documento_instancia → flujo_estado
  estado_documento: string | null;
  estado_es_final: boolean | null;
}

// =============================================================================
// Alias para tx raw SQL
// =============================================================================

type RawTx = {
  $queryRaw: (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>;
  $executeRaw: (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>;
};

// =============================================================================
// Context helper
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

async function findOrdenIngreso(tx: RawTx, id: string): Promise<OrdenIngresoRow | null> {
  const rows = await (tx.$queryRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
  ) => Promise<OrdenIngresoRow[]>)`
    SELECT
      oi.id::text,
      oi.instancia_id::text,
      oi.paciente_id::text,
      oi.episodio_origen_id::text,
      oi.episodio_id::text,
      oi.circunstancia_ingreso,
      oi.fecha_hora_orden,
      oi.motivo_ingreso,
      oi.servicio_ingreso_id::text,
      oi.procedencia,
      oi.modalidad,
      oi.diagnostico_ingreso,
      oi.medico_ordena::text,
      oi.registrado_en,
      oi.estado_registro,
      oi.motivo_ingreso_tipo,
      oi.procedimiento_cie10,
      oi.documento_tipo,
      oi.documento_numero,
      oi.establecimiento_id::text,
      oi.reserva_sala_qx_id::text,
      fe.codigo AS estado_documento,
      fe.es_final AS estado_es_final
    FROM ece.orden_ingreso oi
    JOIN ece.documento_instancia di ON di.id = oi.instancia_id
    JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
    WHERE oi.id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findPersonal(tx: RawTx, hisUserId: string): Promise<{ id: string } | null> {
  const rows = await (tx.$queryRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
  ) => Promise<Array<{ id: string }>>)`
    SELECT id::text FROM ece.personal_salud
    WHERE his_user_id = ${hisUserId}::uuid AND activo = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

interface FirmaRow {
  id: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  revoked_at: Date | null;
}

async function findFirma(tx: RawTx, personalId: string): Promise<FirmaRow | null> {
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

  const firma = await findFirma(tx, personal.id);
  if (!firma) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Firma electrónica no configurada. Contacte al administrador.",
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
    await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
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

  await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
    UPDATE ece.firma_electronica SET failed_attempts = 0 WHERE id = ${firma.id}::uuid
  `;

  return { firmaId: firma.id };
}

// Avanza estado del workflow y registra historial
async function avanzarEstado(
  tx: RawTx,
  instanciaId: string,
  accion: string,
  ejecutadoPor: string,
  rolCodigo: string,
  firmaId?: string,
): Promise<void> {
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

  await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
    UPDATE ece.documento_instancia
    SET estado_actual_id = ${estado_destino_id}::uuid, version = version + 1
    WHERE id = ${instanciaId}::uuid
  `;

  await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
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
}

function computeContentHash(row: OrdenIngresoRow): string {
  const canonical = JSON.stringify({
    id: row.id,
    paciente_id: row.paciente_id,
    motivo_ingreso: row.motivo_ingreso,
    modalidad: row.modalidad,
    procedencia: row.procedencia,
    diagnostico_ingreso: row.diagnostico_ingreso,
    medico_ordena: row.medico_ordena,
    fecha_hora_orden: row.fecha_hora_orden,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// =============================================================================
// Procedures
// =============================================================================

const readerProc = requireRole(["MC", "ESP", "ENF", "ARCH", "DIR", "ADM", "ADMIN"]);
const writerProc = requireRole(["MC", "ESP"]);
const dirProc    = requireRole(["DIR"]);

// =============================================================================
// Router
// =============================================================================

export const eceOrdenIngresoRouter = router({

  /** Lista órdenes de ingreso con filtros opcionales. */
  list: readerProc.input(ordenIngresoListInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    const offset = (input.page - 1) * input.pageSize;

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const epFilter  = input.episodioId  ?? null;
      const pacFilter = input.pacienteId  ?? null;
      const modFilter = input.modalidad   ?? null;
      const desde     = input.fechaDesde  ?? null;
      const hasta     = input.fechaHasta  ?? null;

      const [countRows, rows] = await Promise.all([
        (tx.$queryRaw as (
          tpl: TemplateStringsArray, ...args: unknown[]
        ) => Promise<Array<{ total: bigint }>>)`
          SELECT COUNT(*)::bigint AS total
          FROM ece.orden_ingreso oi
          JOIN ece.documento_instancia di ON di.id = oi.instancia_id
          WHERE (${epFilter}::uuid IS NULL OR oi.episodio_origen_id = ${epFilter}::uuid OR oi.episodio_id = ${epFilter}::uuid)
            AND (${pacFilter}::uuid IS NULL OR oi.paciente_id = ${pacFilter}::uuid)
            AND (${modFilter}::text IS NULL OR oi.modalidad = ${modFilter}::text)
            AND (${desde}::timestamptz IS NULL OR oi.fecha_hora_orden >= ${desde}::timestamptz)
            AND (${hasta}::timestamptz IS NULL OR oi.fecha_hora_orden <= ${hasta}::timestamptz)
        `,
        (tx.$queryRaw as (
          tpl: TemplateStringsArray, ...args: unknown[]
        ) => Promise<OrdenIngresoRow[]>)`
          SELECT
            oi.id::text, oi.instancia_id::text, oi.paciente_id::text,
            oi.episodio_origen_id::text, oi.episodio_id::text,
            oi.circunstancia_ingreso, oi.fecha_hora_orden, oi.motivo_ingreso,
            oi.servicio_ingreso_id::text, oi.procedencia, oi.modalidad,
            oi.diagnostico_ingreso, oi.medico_ordena::text,
            oi.registrado_en, oi.estado_registro,
            oi.motivo_ingreso_tipo, oi.procedimiento_cie10,
            oi.documento_tipo, oi.documento_numero,
            oi.establecimiento_id::text, oi.reserva_sala_qx_id::text,
            fe.codigo AS estado_documento,
            fe.es_final AS estado_es_final
          FROM ece.orden_ingreso oi
          JOIN ece.documento_instancia di ON di.id = oi.instancia_id
          JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
          WHERE (${epFilter}::uuid IS NULL OR oi.episodio_origen_id = ${epFilter}::uuid OR oi.episodio_id = ${epFilter}::uuid)
            AND (${pacFilter}::uuid IS NULL OR oi.paciente_id = ${pacFilter}::uuid)
            AND (${modFilter}::text IS NULL OR oi.modalidad = ${modFilter}::text)
            AND (${desde}::timestamptz IS NULL OR oi.fecha_hora_orden >= ${desde}::timestamptz)
            AND (${hasta}::timestamptz IS NULL OR oi.fecha_hora_orden <= ${hasta}::timestamptz)
          ORDER BY oi.fecha_hora_orden DESC
          LIMIT ${input.pageSize} OFFSET ${offset}
        `,
      ]);

      return {
        items: rows,
        total: Number(countRows[0]?.total ?? 0n),
        page: input.page,
        pageSize: input.pageSize,
      };
    });
  }),

  /** Lectura individual por id. NOT_FOUND si no existe. */
  get: readerProc.input(ordenIngresoGetInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const row = await findOrdenIngreso(tx, input.id);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Orden de ingreso no encontrada: ${input.id}` });
      }
      return row;
    });
  }),

  /**
   * Crea una orden de ingreso en estado borrador.
   *
   * Pasos:
   *   1. Resolver personal_salud activo del médico ordenante (medicoOrdena).
   *   2. assertDependenciasFirmadas (ORD_ING puede tener deps en catálogo).
   *   3. Resolver tipo_documento ORD_ING + estado inicial.
   *   4. Crear documento_instancia.
   *   5. INSERT ece.orden_ingreso con instancia_id.
   *   6. Emitir evento outbox.
   */
  create: writerProc.input(ordenIngresoCreateInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      // 1. Personal del médico ordenante
      const personal = await findPersonal(tx, input.medicoOrdena);
      if (!personal) {
        // El medicoOrdena puede ser distinto al usuario; intentar resolverlo por el usuario actual
        const personalActual = await findPersonal(tx, ctx.user.id);
        if (!personalActual) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "El médico especificado no tiene un registro de personal activo en ECE.",
          });
        }
      }

      const medicoPersonalId = personal?.id ?? (await findPersonal(tx, ctx.user.id))!.id;

      // 2. assertDependenciasFirmadas
      await assertDependenciasFirmadas({
        tx: ctx.prisma,
        tipoDocCodigo: "ORD_ING",
        episodioId: input.episodioOrigenId ?? null,
        pacienteId: input.pacienteId,
        establecimientoId: eceCtx.establecimientoId,
      });

      // 3. Tipo documento ORD_ING + estado inicial
      const tipoRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ tipo_doc_id: string; estado_inicial_id: string }>>)`
        SELECT td.id::text AS tipo_doc_id, fe.id::text AS estado_inicial_id
        FROM ece.tipo_documento td
        JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
        WHERE td.codigo = 'ORD_ING'
        LIMIT 1
      `;
      if (tipoRows.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Tipo documento ORD_ING no está configurado en el motor de workflow.",
        });
      }
      const { tipo_doc_id, estado_inicial_id } = tipoRows[0]!;

      // 4. Crear documento_instancia
      const instanciaRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.documento_instancia
          (tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por)
        VALUES (
          ${tipo_doc_id}::uuid,
          ${input.episodioOrigenId ?? null}::uuid,
          ${input.pacienteId}::uuid,
          ${estado_inicial_id}::uuid,
          ${medicoPersonalId}::uuid
        )
        RETURNING id::text
      `;
      const instanciaId = instanciaRows[0]!.id;

      // 5. INSERT ece.orden_ingreso
      // CC-0005: documento_tipo/documento_numero denormalizados para auditoría;
      // procedimiento_cie10 ya no se escribe (set NULL).
      const ordenRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.orden_ingreso (
          instancia_id,
          paciente_id,
          episodio_origen_id,
          circunstancia_ingreso,
          fecha_hora_orden,
          motivo_ingreso,
          servicio_ingreso_id,
          procedencia,
          modalidad,
          diagnostico_ingreso,
          medico_ordena,
          motivo_ingreso_tipo,
          procedimiento_cie10,
          documento_tipo,
          documento_numero,
          establecimiento_id,
          reserva_sala_qx_id
        ) VALUES (
          ${instanciaId}::uuid,
          ${input.pacienteId}::uuid,
          ${input.episodioOrigenId ?? null}::uuid,
          ${input.circunstanciaIngreso},
          ${input.fechaHoraOrden.toISOString()}::timestamptz,
          ${input.motivoIngreso},
          ${input.servicioIngresoId ?? null}::uuid,
          ${input.procedencia},
          ${input.modalidad},
          ${JSON.stringify(input.diagnosticoIngreso)}::jsonb,
          ${medicoPersonalId}::uuid,
          ${input.motivoIngresoTipo},
          NULL,
          ${input.documentoTipo},
          ${input.documentoNumero},
          ${eceCtx.establecimientoId}::uuid,
          ${input.reservaSalaQxId ?? null}::uuid
        )
        RETURNING id::text
      `;
      const ordenId = ordenRows[0]!.id;

      // 6. Outbox
      await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.orden_ingreso.creada",
        aggregateType: "OrdenIngreso",
        aggregateId: ordenId,
        emittedById: ctx.user.id,
        payload: {
          ordenId,
          instanciaId,
          pacienteId: input.pacienteId,
          medicoOrdenaPersonalId: medicoPersonalId,
          modalidad: input.modalidad,
          motivoIngresoTipo: input.motivoIngresoTipo,
          organizationId: ctx.tenant.organizationId,
        },
      });

      return { ok: true as const, id: ordenId, instanciaId };
    });
  }),

  /**
   * Firma la orden de ingreso con PIN electrónico (rol MC o ESP).
   * Avanza workflow borrador → firmado.
   * Emite ece.orden_ingreso.firmada.
   */
  firmar: writerProc.input(ordenIngresoFirmarInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const orden = await findOrdenIngreso(tx, input.id);
      if (!orden) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Orden de ingreso no encontrada: ${input.id}` });
      }

      if (orden.estado_documento !== "borrador" && orden.estado_documento !== "en_revision") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede firmar en estado borrador o en_revision. Estado actual: ${orden.estado_documento}.`,
        });
      }

      const { firmaId } = await verifyPinOrThrow(tx, ctx.user.id, input.firmaPin);

      // Determinar el rol activo del usuario para la transición
      const rolCodigo = ctx.tenant.roleCodes.find((r) => r === "MC") ?? "ESP";
      await avanzarEstado(tx, orden.instancia_id, "firmar", eceCtx.personalId, rolCodigo, firmaId);

      const contentHash = computeContentHash(orden);

      await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.orden_ingreso.firmada",
        aggregateType: "OrdenIngreso",
        aggregateId: input.id,
        emittedById: ctx.user.id,
        payload: {
          ordenId: input.id,
          instanciaId: orden.instancia_id,
          pacienteId: orden.paciente_id,
          contentHash,
          firmaId,
          firmadoPor: eceCtx.personalId,
          firmadaEn: new Date().toISOString(),
          organizationId: ctx.tenant.organizationId,
        },
      });

      return { ok: true as const, estado: "firmado", contentHash };
    });
  }),

  /**
   * Anula la orden de ingreso. Solo en estado firmado. Rol DIR.
   * Avanza workflow → anulado en documento_instancia.
   * Emite ece.orden_ingreso.anulada.
   */
  anular: dirProc.input(ordenIngresoAnularInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const orden = await findOrdenIngreso(tx, input.id);
      if (!orden) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Orden de ingreso no encontrada: ${input.id}` });
      }

      if (orden.estado_documento === "anulado") {
        throw new TRPCError({ code: "CONFLICT", message: "La orden ya está anulada." });
      }
      if (orden.estado_es_final === true && orden.estado_documento !== "firmado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `No se puede anular una orden en estado '${orden.estado_documento}'.`,
        });
      }
      // Solo se anula desde firmado (pre-HOJA_ING)
      if (orden.estado_documento !== "firmado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede anular desde estado 'firmado'. Estado actual: ${orden.estado_documento}.`,
        });
      }

      await avanzarEstado(tx, orden.instancia_id, "anular", eceCtx.personalId, "DIR");

      await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.orden_ingreso.anulada",
        aggregateType: "OrdenIngreso",
        aggregateId: input.id,
        emittedById: ctx.user.id,
        payload: {
          ordenId: input.id,
          instanciaId: orden.instancia_id,
          motivoAnulacion: input.motivoAnulacion,
          anuladoPor: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
        },
      });

      return { ok: true as const, estado: "anulado" };
    });
  }),
});
