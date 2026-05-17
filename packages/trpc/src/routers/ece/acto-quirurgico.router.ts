/**
 * eceActoQuirurgicoRouter — Router tRPC para Acto Quirúrgico ECE (NTEC §3.13 / Doc 13).
 *
 * Workflow ACT_QX:
 *   borrador → firmado  (acción 'firmar',  rol ESP/cirujano, requiere PIN)
 *   firmado  → validado (acción 'validar', rol ESP/DIR/jefe servicio)
 *   borrador → anulado  (acción 'anular',  rol ESP/DIR)
 *
 * La tabla ece.acto_quirurgico es INMUTABLE post-firma (NTEC §3.13).
 * Cualquier intento de UPDATE en estado != borrador lanza CONFLICT.
 *
 * Outbox (transaccional via emitDomainEvent):
 *   firmar  → 'ece.acto_quirurgico.firmado'
 *   validar → 'ece.acto_quirurgico.validado'
 *
 * Tablas raw SQL (schema ece — sin modelo Prisma):
 *   ece.acto_quirurgico
 *   ece.documento_instancia
 *   ece.documento_instancia_historial
 *   ece.flujo_estado / ece.flujo_transicion
 *   ece.personal_salud
 *   ece.firma_electronica
 */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import argon2 from "argon2";
import type { PrismaClient } from "@his/database";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext } from "../../ece/workflow-context";
// emitDomainEvent: mismo import que consentimiento.router.ts / episodio-hospitalario.router.ts.
// El error TS2724 es pre-existente en el worktree (stub @his/database desincronizado).
import { emitDomainEvent } from "@his/database";
import {
  actoQxListSchema,
  actoQxGetSchema,
  actoQxCreateSchema,
  actoQxUpdateSchema,
  actoQxFirmarSchema,
  actoQxValidarSchema,
  actoQxAnularSchema,
} from "./acto-quirurgico.schemas";

// =============================================================================
// Tipos de fila raw
// =============================================================================

export interface ActoQxRow {
  id: string;
  instancia_id: string;
  episodio_id: string;
  diagnostico_pre: string | null;
  diagnostico_post: string | null;
  procedimiento_realizado: string | null;
  hallazgos: string | null;
  hora_inicio: Date | null;
  hora_fin: Date | null;
  cirujano_id: string;
  anestesiologo_id: string | null;
  valoracion_preop: unknown;
  checklist_cirugia_segura: unknown;
  ayudantes: unknown;
  registro_anestesico: unknown;
  recuperacion_urpa: unknown;
  registrado_en: Date;
  estado_registro: string;
  // join desde documento_instancia + flujo_estado
  estado_codigo: string;
  estado_id: string;
}

interface PersonalRow {
  id: string;
}

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

function requireEstablishment(ctx: {
  user: { id: string };
  tenant: { organizationId: string; establishmentId?: string; roleCodes: string[] };
}): { personalId: string; organizationId: string; establecimientoId: string } {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar documentos ECE.",
    });
  }
  return {
    personalId: ctx.user.id,
    organizationId: ctx.tenant.organizationId,
    establecimientoId: ctx.tenant.establishmentId,
  };
}

// Alias semántico para el cliente dentro del callback withWorkflowContext.
type Tx = PrismaClient;

// Wrapper semántico que delega a withWorkflowContext del worktree ECE.
async function withEce<T>(
  prisma: PrismaClient,
  establecimientoId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withWorkflowContext(prisma, establecimientoId, fn);
}

// =============================================================================
// Helpers raw SQL
// =============================================================================

async function findActoQx(tx: Tx, id: string): Promise<ActoQxRow | null> {
  const rows = await tx.$queryRaw<ActoQxRow[]>`
    SELECT
      aq.id::text,
      aq.instancia_id::text,
      aq.episodio_id::text,
      aq.diagnostico_pre,
      aq.diagnostico_post,
      aq.procedimiento_realizado,
      aq.hallazgos,
      aq.hora_inicio,
      aq.hora_fin,
      aq.cirujano_id::text,
      aq.anestesiologo_id::text,
      aq.valoracion_preop,
      aq.checklist_cirugia_segura,
      aq.ayudantes,
      aq.registro_anestesico,
      aq.recuperacion_urpa,
      aq.registrado_en,
      aq.estado_registro,
      fe.codigo AS estado_codigo,
      fe.id::text AS estado_id
    FROM ece.acto_quirurgico aq
    JOIN ece.documento_instancia di ON di.id = aq.instancia_id
    JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
    WHERE aq.id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findPersonal(tx: Tx, hisUserId: string): Promise<PersonalRow | null> {
  const rows = await tx.$queryRaw<PersonalRow[]>`
    SELECT id::text
    FROM ece.personal_salud
    WHERE his_user_id = ${hisUserId}::uuid
      AND activo = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findFirmaByPersonal(tx: Tx, personalId: string): Promise<FirmaRow | null> {
  const rows = await tx.$queryRaw<FirmaRow[]>`
    SELECT id::text, pin_hash, failed_attempts, locked_until, revoked_at
    FROM ece.firma_electronica
    WHERE personal_id = ${personalId}::uuid
      AND revoked_at IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// =============================================================================
// Verificación PIN con lockout
// =============================================================================

const LOCKOUT_MAX = 5;

async function verifyPinOrThrow(tx: Tx, hisUserId: string, pin: string): Promise<{ firmaId: string }> {
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
    await tx.$executeRaw`
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

  await tx.$executeRaw`
    UPDATE ece.firma_electronica
    SET failed_attempts = 0
    WHERE id = ${firma.id}::uuid
  `;

  return { firmaId: firma.id };
}

// =============================================================================
// Avanzar estado del workflow ECE
// =============================================================================

async function avanzarEstado(
  tx: Tx,
  instanciaId: string,
  accion: string,
  ejecutadoPor: string,
  rolCodigo: string,
  firmaId?: string,
): Promise<void> {
  const transiciones = await tx.$queryRaw<{ estado_destino_id: string }[]>`
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

  await tx.$executeRaw`
    UPDATE ece.documento_instancia
    SET estado_actual_id = ${estado_destino_id}::uuid,
        version = version + 1
    WHERE id = ${instanciaId}::uuid
  `;

  await tx.$executeRaw`
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
// Hash de contenido clínico (inmutabilidad post-firma)
// =============================================================================

function computeHash(aq: ActoQxRow): string {
  const payload = JSON.stringify({
    id: aq.id,
    episodio_id: aq.episodio_id,
    cirujano_id: aq.cirujano_id,
    procedimiento_realizado: aq.procedimiento_realizado,
    diagnostico_pre: aq.diagnostico_pre,
    diagnostico_post: aq.diagnostico_post,
    hora_inicio: aq.hora_inicio,
    hora_fin: aq.hora_fin,
    registrado_en: aq.registrado_en,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

// =============================================================================
// Base procedures
// =============================================================================

// Lectura: cualquier clínico con acceso al quirófano
const readerProc = requireRole(["MC", "ESP", "ENF", "DIR", "ARCH", "QX"]);
// Escritura / firma: cirujano o especialista
const surgeonProc = requireRole(["ESP", "MC", "QX"]);
// Validación: jefe servicio o dirección médica
const chiefProc = requireRole(["ESP", "DIR"]);

// =============================================================================
// Router
// =============================================================================

export const eceActoQuirurgicoRouter = router({
  /**
   * Lista actos quirúrgicos paginados por cursor.
   * Filtra opcionalmente por episodio, cirujano o estado del workflow.
   */
  list: readerProc.input(actoQxListSchema).query(async ({ ctx, input }) => {
    const ece = requireEstablishment(ctx);

    return withEce(ctx.prisma, ece.establecimientoId, async (tx) => {
      const rows = await tx.$queryRaw<ActoQxRow[]>`
        SELECT
          aq.id::text,
          aq.instancia_id::text,
          aq.episodio_id::text,
          aq.diagnostico_pre,
          aq.diagnostico_post,
          aq.procedimiento_realizado,
          aq.hallazgos,
          aq.hora_inicio,
          aq.hora_fin,
          aq.cirujano_id::text,
          aq.anestesiologo_id::text,
          aq.valoracion_preop,
          aq.checklist_cirugia_segura,
          aq.ayudantes,
          aq.registro_anestesico,
          aq.recuperacion_urpa,
          aq.registrado_en,
          aq.estado_registro,
          fe.codigo AS estado_codigo,
          fe.id::text AS estado_id
        FROM ece.acto_quirurgico aq
        JOIN ece.documento_instancia di ON di.id = aq.instancia_id
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        JOIN ece.episodio_atencion ea ON ea.id = aq.episodio_id
        WHERE ea.establecimiento_id = ${ece.establecimientoId}::uuid
          AND (${input.episodioId ?? null}::uuid IS NULL
               OR aq.episodio_id = ${input.episodioId ?? null}::uuid)
          AND (${input.cirujanoId ?? null}::uuid IS NULL
               OR aq.cirujano_id = ${input.cirujanoId ?? null}::uuid)
          AND (${input.estado ?? null}::text IS NULL
               OR fe.codigo = ${input.estado ?? null}::text)
          AND (${input.cursor ?? null}::uuid IS NULL
               OR aq.id < ${input.cursor ?? null}::uuid)
        ORDER BY aq.registrado_en DESC, aq.id DESC
        LIMIT ${input.limit}
      `;

      const nextCursor = rows.length === input.limit ? rows[rows.length - 1]!.id : null;
      return { items: rows, nextCursor };
    });
  }),

  /**
   * Obtiene un acto quirúrgico por id.
   * Lanza NOT_FOUND si no existe o no pertenece al establecimiento del tenant.
   */
  get: readerProc.input(actoQxGetSchema).query(async ({ ctx, input }) => {
    const ece = requireEstablishment(ctx);

    return withEce(ctx.prisma, ece.establecimientoId, async (tx) => {
      const rows = await tx.$queryRaw<ActoQxRow[]>`
        SELECT
          aq.id::text,
          aq.instancia_id::text,
          aq.episodio_id::text,
          aq.diagnostico_pre,
          aq.diagnostico_post,
          aq.procedimiento_realizado,
          aq.hallazgos,
          aq.hora_inicio,
          aq.hora_fin,
          aq.cirujano_id::text,
          aq.anestesiologo_id::text,
          aq.valoracion_preop,
          aq.checklist_cirugia_segura,
          aq.ayudantes,
          aq.registro_anestesico,
          aq.recuperacion_urpa,
          aq.registrado_en,
          aq.estado_registro,
          fe.codigo AS estado_codigo,
          fe.id::text AS estado_id
        FROM ece.acto_quirurgico aq
        JOIN ece.documento_instancia di ON di.id = aq.instancia_id
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        JOIN ece.episodio_atencion ea ON ea.id = aq.episodio_id
        WHERE aq.id = ${input.id}::uuid
          AND ea.establecimiento_id = ${ece.establecimientoId}::uuid
        LIMIT 1
      `;

      const aq = rows[0];
      if (!aq) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Acto quirúrgico no encontrado: ${input.id}`,
        });
      }
      return aq;
    });
  }),

  /**
   * Crea un acto quirúrgico en estado borrador.
   *
   * 1. Resuelve tipo de documento ACT_QX y su estado inicial.
   * 2. Verifica que el episodio pertenezca al establecimiento.
   * 3. Crea instancia del workflow.
   * 4. Inserta el registro clínico en ece.acto_quirurgico.
   *
   * Require rol ESP / MC / QX.
   */
  create: surgeonProc.input(actoQxCreateSchema).mutation(async ({ ctx, input }) => {
    const ece = requireEstablishment(ctx);

    return withEce(ctx.prisma, ece.establecimientoId, async (tx) => {
      // 1. Resolver tipo de documento ACT_QX
      const tipoRows = await tx.$queryRaw<{ tipo_doc_id: string; estado_inicial_id: string }[]>`
        SELECT td.id::text AS tipo_doc_id, fe.id::text AS estado_inicial_id
        FROM ece.tipo_documento td
        JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
        WHERE td.codigo = 'ACT_QX'
        LIMIT 1
      `;

      if (tipoRows.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Tipo de documento ACT_QX no configurado en el catálogo ECE.",
        });
      }

      const { tipo_doc_id, estado_inicial_id } = tipoRows[0]!;

      // 2. Verificar episodio
      const episodioRows = await tx.$queryRaw<{ paciente_id: string }[]>`
        SELECT paciente_id::text
        FROM ece.episodio_atencion
        WHERE id = ${input.episodioId}::uuid
          AND establecimiento_id = ${ece.establecimientoId}::uuid
        LIMIT 1
      `;

      if (episodioRows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Episodio no encontrado: ${input.episodioId}`,
        });
      }
      const pacienteId = episodioRows[0]!.paciente_id;

      // 3. Crear instancia de workflow
      const instanciaRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO ece.documento_instancia
          (tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por)
        VALUES (
          ${tipo_doc_id}::uuid,
          ${input.episodioId}::uuid,
          ${pacienteId}::uuid,
          ${estado_inicial_id}::uuid,
          ${ece.personalId}::uuid
        )
        RETURNING id::text
      `;
      const instanciaId = instanciaRows[0]!.id;

      // 4. Insertar registro clínico
      const ayudantesJson = JSON.stringify(input.ayudantes);
      const valoracionJson = input.valoracionPreop
        ? JSON.stringify(input.valoracionPreop)
        : null;
      const checklistJson = input.checklistCirugiaSeguradEntrada
        ? JSON.stringify({ entrada: input.checklistCirugiaSeguradEntrada })
        : null;
      const registroAnestJson = input.registroAnestesico
        ? JSON.stringify(input.registroAnestesico)
        : null;
      const urpaJson = input.recuperacionUrpa
        ? JSON.stringify(input.recuperacionUrpa)
        : null;

      const aqRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO ece.acto_quirurgico (
          instancia_id,
          episodio_id,
          diagnostico_pre,
          diagnostico_post,
          procedimiento_realizado,
          hallazgos,
          hora_inicio,
          hora_fin,
          cirujano_id,
          anestesiologo_id,
          valoracion_preop,
          checklist_cirugia_segura,
          ayudantes,
          registro_anestesico,
          recuperacion_urpa
        ) VALUES (
          ${instanciaId}::uuid,
          ${input.episodioId}::uuid,
          ${input.diagnosticoPre},
          ${input.diagnosticoPost ?? null},
          ${input.procedimientoRealizado},
          ${input.hallazgos ?? null},
          ${input.horaInicio?.toISOString() ?? null}::timestamptz,
          ${input.horaFin?.toISOString() ?? null}::timestamptz,
          ${input.cirujanoId}::uuid,
          ${input.anestesiologoId ?? null}::uuid,
          ${valoracionJson}::jsonb,
          ${checklistJson}::jsonb,
          ${ayudantesJson}::jsonb,
          ${registroAnestJson}::jsonb,
          ${urpaJson}::jsonb
        )
        RETURNING id::text
      `;

      return {
        actoQxId: aqRows[0]!.id,
        instanciaId,
        estadoCodigo: "borrador" as const,
      };
    });
  }),

  /**
   * Actualiza campos clínicos de un acto quirúrgico en borrador.
   * Lanza CONFLICT si el estado no es borrador (inmutabilidad post-firma).
   */
  update: surgeonProc.input(actoQxUpdateSchema).mutation(async ({ ctx, input }) => {
    const ece = requireEstablishment(ctx);

    return withEce(ctx.prisma, ece.establecimientoId, async (tx) => {
      const aq = await findActoQx(tx, input.id);
      if (!aq) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Acto quirúrgico no encontrado: ${input.id}`,
        });
      }

      if (aq.estado_codigo !== "borrador") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `El acto quirúrgico está en estado '${aq.estado_codigo}'. Solo borradores son editables (NTEC §3.13).`,
        });
      }

      await tx.$executeRaw`
        UPDATE ece.acto_quirurgico SET
          diagnostico_pre         = COALESCE(${input.diagnosticoPre ?? null}, diagnostico_pre),
          diagnostico_post        = COALESCE(${input.diagnosticoPost ?? null}, diagnostico_post),
          procedimiento_realizado = COALESCE(${input.procedimientoRealizado ?? null}, procedimiento_realizado),
          hallazgos               = COALESCE(${input.hallazgos ?? null}, hallazgos),
          hora_inicio             = COALESCE(${input.horaInicio?.toISOString() ?? null}::timestamptz, hora_inicio),
          hora_fin                = COALESCE(${input.horaFin?.toISOString() ?? null}::timestamptz, hora_fin),
          ayudantes               = COALESCE(${input.ayudantes ? JSON.stringify(input.ayudantes) : null}::jsonb, ayudantes),
          valoracion_preop        = COALESCE(${input.valoracionPreop ? JSON.stringify(input.valoracionPreop) : null}::jsonb, valoracion_preop),
          registro_anestesico     = COALESCE(${input.registroAnestesico ? JSON.stringify(input.registroAnestesico) : null}::jsonb, registro_anestesico),
          recuperacion_urpa       = COALESCE(${input.recuperacionUrpa ? JSON.stringify(input.recuperacionUrpa) : null}::jsonb, recuperacion_urpa)
        WHERE id = ${input.id}::uuid
      `;

      return { ok: true as const, updatedAt: new Date().toISOString() };
    });
  }),

  /**
   * Firma el acto quirúrgico con el PIN electrónico del cirujano (ESP/QX).
   *
   * 1. Verifica estado borrador.
   * 2. Valida que haya procedimiento_realizado.
   * 3. Valida PIN.
   * 4. Avanza workflow: borrador → firmado.
   * 5. Emite 'ece.acto_quirurgico.firmado' con hash del contenido clínico.
   *
   * Tras este paso el documento es INMUTABLE.
   */
  firmar: surgeonProc.input(actoQxFirmarSchema).mutation(async ({ ctx, input }) => {
    const ece = requireEstablishment(ctx);

    return withEce(ctx.prisma, ece.establecimientoId, async (tx) => {
      const aq = await findActoQx(tx, input.id);
      if (!aq) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Acto quirúrgico no encontrado: ${input.id}`,
        });
      }

      if (aq.estado_codigo !== "borrador") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `El acto quirúrgico no está en borrador (estado: ${aq.estado_codigo}). Inmutabilidad enforced.`,
        });
      }

      if (!aq.procedimiento_realizado) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Debe completar 'procedimiento_realizado' antes de firmar.",
        });
      }

      const { firmaId } = await verifyPinOrThrow(tx, ctx.user.id, input.pin);

      // El cirujano firma; determinar rol válido para la transición
      const rolEjecutor = ctx.tenant.roleCodes.includes("ESP")
        ? "ESP"
        : ctx.tenant.roleCodes.includes("QX")
          ? "QX"
          : "MC";

      await avanzarEstado(tx, aq.instancia_id, "firmar", ece.personalId, rolEjecutor, firmaId);

      const contenidoHash = computeHash(aq);

      // Emitir evento outbox dentro de la misma tx
      await emitDomainEvent(// eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tx as any), {
        organizationId: ece.organizationId,
        eventType: "ece.acto_quirurgico.firmado",
        aggregateType: "ActoQuirurgico",
        aggregateId: aq.id,
        emittedById: ctx.user.id,
        payload: {
          instanciaId: aq.instancia_id,
          tipoDocumentoCodigo: "ACT_QX",
          fromStateId: aq.estado_id,
          accion: "firmar",
          byUserId: ctx.user.id,
          firmaId,
          contenidoHash,
          checklistSalidaConfirmado: input.checklistSalidaConfirmado,
        },
      });

      return { ok: true as const, contenidoHash, firmadoEn: new Date().toISOString() };
    });
  }),

  /**
   * Valida el acto quirúrgico firmado. Rol ESP (jefe servicio) o DIR.
   *
   * Avanza el workflow: firmado → validado.
   * Emite 'ece.acto_quirurgico.validado'.
   */
  validar: chiefProc.input(actoQxValidarSchema).mutation(async ({ ctx, input }) => {
    const ece = requireEstablishment(ctx);

    return withEce(ctx.prisma, ece.establecimientoId, async (tx) => {
      const aq = await findActoQx(tx, input.id);
      if (!aq) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Acto quirúrgico no encontrado: ${input.id}`,
        });
      }

      if (aq.estado_codigo !== "firmado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `El acto quirúrgico no está firmado (estado: ${aq.estado_codigo}).`,
        });
      }

      const rolEjecutor = ctx.tenant.roleCodes.includes("DIR") ? "DIR" : "ESP";
      await avanzarEstado(tx, aq.instancia_id, "validar", ece.personalId, rolEjecutor);

      await emitDomainEvent(// eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tx as any), {
        organizationId: ece.organizationId,
        eventType: "ece.acto_quirurgico.validado",
        aggregateType: "ActoQuirurgico",
        aggregateId: aq.id,
        emittedById: ctx.user.id,
        payload: {
          instanciaId: aq.instancia_id,
          accion: "validar",
          byUserId: ctx.user.id,
          observacion: input.observacion ?? null,
        },
      });

      return { ok: true as const, validadoEn: new Date().toISOString() };
    });
  }),

  /**
   * Anula un acto quirúrgico que aún no está firmado.
   * Un acto firmado o validado NO puede anularse (requiere rectificación formal).
   * Rol ESP / DIR.
   */
  anular: chiefProc.input(actoQxAnularSchema).mutation(async ({ ctx, input }) => {
    const ece = requireEstablishment(ctx);

    return withEce(ctx.prisma, ece.establecimientoId, async (tx) => {
      const aq = await findActoQx(tx, input.id);
      if (!aq) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Acto quirúrgico no encontrado: ${input.id}`,
        });
      }

      if (aq.estado_codigo === "firmado" || aq.estado_codigo === "validado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `No se puede anular un acto quirúrgico en estado '${aq.estado_codigo}'. Use el proceso de rectificación formal.`,
        });
      }

      if (aq.estado_codigo === "anulado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "El acto quirúrgico ya está anulado.",
        });
      }

      const rolEjecutor = ctx.tenant.roleCodes.includes("DIR") ? "DIR" : "ESP";
      await avanzarEstado(tx, aq.instancia_id, "anular", ece.personalId, rolEjecutor);

      // Marcar estado_registro en la tabla clínica
      await tx.$executeRaw`
        UPDATE ece.acto_quirurgico
        SET estado_registro = 'rectificado'
        WHERE id = ${input.id}::uuid
      `;

      return { ok: true as const, anuladoEn: new Date().toISOString(), motivo: input.motivo };
    });
  }),
});
