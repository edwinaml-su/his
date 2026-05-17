/**
 * eceConsentimiento — Router tRPC para Consentimiento Informado ECE (Doc 9 NTEC §3.9).
 *
 * Workflow CONS_INF (código inmutable, no en revisión):
 *   borrador → firmado  (acción 'firmar', rol MC, requiere firma electrónica)
 *   firmado  → validado (acción 'validar', rol DIR)
 *
 * Flujo de doble firma:
 *   1. Médico (MC) crea el borrador con los datos clínicos del consentimiento.
 *   2. El paciente/representante registra su firma (imagen URI) vía firmarPaciente.
 *   3. El MC firma con PIN electrónico vía firmar — avanza el workflow a 'firmado'.
 *   4. El DIR valida (aprueba) el consentimiento vía validar.
 *
 * La tabla `ece.consentimiento_informado` es INMUTABLE después del paso 3.
 * Triggers en BD impiden UPDATE/DELETE sobre campos clínicos post-firma.
 * El router detecta el estado via documento_instancia y lanza CONFLICT si
 * el estado no es borrador cuando se intenta firmar o modificar.
 *
 * Outbox: cada firma MC emite 'ece.consentimiento.firmado' con hash inmutable.
 *
 * Tablas raw SQL (schema ece — sin modelo Prisma):
 *   ece.consentimiento_informado
 *   ece.documento_instancia
 *   ece.personal_salud
 *   ece.firma_electronica
 *   ece.paciente
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import argon2 from "argon2";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext, type EceContext } from "../../workflow/context";
import { emitDomainEvent } from "@his/database";
// Schemas importados desde contracts (disponibles post-merge al main branch).
// En el worktree se definen inline para evitar resolución de symlink.
import {
  eceConsentimientoCreateSchema,
  eceConsentimientoFirmarPacienteSchema,
  eceConsentimientoFirmarMcSchema,
  eceConsentimientoValidarSchema,
} from "./schemas";

// =============================================================================
// Tipos de fila raw
// =============================================================================

interface ConsentimientoRow {
  id: string;
  instancia_id: string;
  paciente_id: string;
  episodio_id: string | null;
  tipo: string;
  procedimiento_descrito: string;
  riesgos_explicados: string | null;
  alternativas: string | null;
  medico_que_informa: string;
  firmante_rol: string | null;
  firmante_nombre: string | null;
  firmante_documento: string | null;
  evidencia_firma_ref: string | null;
  fecha_hora: Date;
  /** Estado del documento_instancia asociado. */
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
// Helper: construir EceContext desde ctx
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

// =============================================================================
// Helper: withEceContext — envuelve withWorkflowContext con alias semántico
// =============================================================================

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

async function findConsentimiento(
  tx: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  id: string,
): Promise<ConsentimientoRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<ConsentimientoRow[]>)`
    SELECT
      ci.id::text,
      ci.instancia_id::text,
      ci.paciente_id::text,
      ci.episodio_id::text,
      ci.tipo,
      ci.procedimiento_descrito,
      ci.riesgos_explicados,
      ci.alternativas,
      ci.medico_que_informa::text,
      ci.firmante_rol,
      ci.firmante_nombre,
      ci.firmante_documento,
      ci.evidencia_firma_ref,
      ci.fecha_hora,
      fe.codigo AS estado_codigo,
      fe.id::text AS estado_id
    FROM ece.consentimiento_informado ci
    JOIN ece.documento_instancia di ON di.id = ci.instancia_id
    JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
    WHERE ci.id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findPersonal(
  tx: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  hisUserId: string,
): Promise<PersonalRow | null> {
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

async function findFirmaByPersonal(
  tx: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  personalId: string,
): Promise<FirmaRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<FirmaRow[]>)`
    SELECT id::text, pin_hash, failed_attempts,
           locked_until, revoked_at
    FROM ece.firma_electronica
    WHERE personal_id = ${personalId}::uuid
      AND revoked_at IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// =============================================================================
// Helper: verificar PIN con lockout (subset de firma-electronica.router)
// =============================================================================

const LOCKOUT_MAX = 5;

async function verifyPinOrThrow(
  tx: {
    $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
    $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  },
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
    // Incrementar contador — el trigger trg_lockout_firma gestiona locked_until
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

  // Resetear contador en éxito
  await (tx.$executeRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<number>)`
    UPDATE ece.firma_electronica
    SET failed_attempts = 0
    WHERE id = ${firma.id}::uuid
  `;

  return { firmaId: firma.id };
}

// =============================================================================
// Helper: avanzar estado del workflow
// =============================================================================

async function avanzarEstado(
  tx: {
    $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
    $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  },
  instanciaId: string,
  accion: string,
  ejecutadoPor: string,
  rolCodigo: string,
  firmaId?: string,
): Promise<void> {
  // Buscar transición válida desde el estado actual
  const transiciones = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<Array<{ estado_destino_id: string; rol_codigo: string }>>)`
    SELECT ft.estado_destino_id::text, r.codigo AS rol_codigo
    FROM ece.flujo_transicion ft
    JOIN ece.flujo_estado fe_origen ON fe_origen.id = ft.estado_origen_id
    JOIN ece.flujo_estado fe_destino ON fe_destino.id = ft.estado_destino_id
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

  // Actualizar estado de la instancia
  await (tx.$executeRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<number>)`
    UPDATE ece.documento_instancia
    SET estado_actual_id = ${estado_destino_id}::uuid,
        version = version + 1
    WHERE id = ${instanciaId}::uuid
  `;

  // Registrar en historial (append-only)
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
// Helper: emitir evento de dominio consentimiento.firmado
// Usamos 'workflow.transitionExecuted' como eventType registrado; el payload
// identifica el consentimiento y el hash inmutable del contenido clínico.
// =============================================================================

function computeContenidoHash(ci: ConsentimientoRow): string {
  const payload = JSON.stringify({
    id: ci.id,
    tipo: ci.tipo,
    procedimiento_descrito: ci.procedimiento_descrito,
    riesgos_explicados: ci.riesgos_explicados,
    alternativas: ci.alternativas,
    medico_que_informa: ci.medico_que_informa,
    firmante_nombre: ci.firmante_nombre,
    firmante_documento: ci.firmante_documento,
    fecha_hora: ci.fecha_hora,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

// =============================================================================
// Procedures base
// =============================================================================

const physicianProc = requireRole(["MC", "ESP"]);
const dirProc = requireRole(["DIR"]);
// list/get accesibles por más roles
const eceReaderProc = requireRole(["MC", "ESP", "ENF", "DIR", "ARCH"]);

// =============================================================================
// Input schemas locales (para list/get)
// =============================================================================

const listInput = z.object({
  episodioId: z.string().uuid().optional(),
  pacienteId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const getInput = z.object({ id: z.string().uuid() });

// =============================================================================
// Router
// =============================================================================

export const eceConsentimientoRouter = router({
  /**
   * Lista consentimientos filtrados por episodio o paciente, paginados por cursor.
   */
  list: eceReaderProc.input(listInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx, async (tx) => {
      const rows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<ConsentimientoRow[]>)`
        SELECT
          ci.id::text,
          ci.instancia_id::text,
          ci.paciente_id::text,
          ci.episodio_id::text,
          ci.tipo,
          ci.procedimiento_descrito,
          ci.riesgos_explicados,
          ci.alternativas,
          ci.medico_que_informa::text,
          ci.firmante_rol,
          ci.firmante_nombre,
          ci.firmante_documento,
          ci.evidencia_firma_ref,
          ci.fecha_hora,
          fe.codigo AS estado_codigo,
          fe.id::text AS estado_id
        FROM ece.consentimiento_informado ci
        JOIN ece.documento_instancia di ON di.id = ci.instancia_id
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE (${input.episodioId ?? null}::uuid IS NULL OR ci.episodio_id = ${input.episodioId ?? null}::uuid)
          AND (${input.pacienteId ?? null}::uuid IS NULL OR ci.paciente_id = ${input.pacienteId ?? null}::uuid)
          AND (${input.cursor ?? null}::uuid IS NULL OR ci.id < ${input.cursor ?? null}::uuid)
        ORDER BY ci.fecha_hora DESC, ci.id DESC
        LIMIT ${input.limit}
      `;
      const nextCursor = rows.length === input.limit ? rows[rows.length - 1]!.id : null;
      return { items: rows, nextCursor };
    });
  }),

  /**
   * Lee un consentimiento por id. NOT_FOUND si no existe.
   */
  get: eceReaderProc.input(getInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx, async (tx) => {
      const ci = await findConsentimiento(tx, input.id);
      if (!ci) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Consentimiento informado no encontrado: ${input.id}`,
        });
      }
      return ci;
    });
  }),

  /**
   * Crea un consentimiento en borrador.
   *
   * Pasos:
   *   1. Obtiene el tipo de documento CONS_INF y su estado inicial.
   *   2. Crea la instancia del workflow en borrador.
   *   3. Inserta el registro clínico en ece.consentimiento_informado.
   *
   * Require rol MC o ESP. Solo en estado borrador tiene sentido crear.
   */
  create: physicianProc
    .input(eceConsentimientoCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withEceContext(ctx.prisma, eceCtx, async (tx) => {
        // 1. Resolver tipo de documento CONS_INF
        const tipoRows = await (tx.$queryRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<Array<{ tipo_doc_id: string; estado_inicial_id: string }>>)`
          SELECT td.id::text AS tipo_doc_id, fe.id::text AS estado_inicial_id
          FROM ece.tipo_documento td
          JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
          WHERE td.codigo = 'CONS_INF'
          LIMIT 1
        `;

        if (tipoRows.length === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Tipo de documento CONS_INF no configurado en el catálogo ECE.",
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

        // 3. Resolver personal_salud del MC creador
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

        // 5. Insertar registro clínico
        const ciRows = await (tx.$queryRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<Array<{ id: string }>>)`
          INSERT INTO ece.consentimiento_informado
            (instancia_id, paciente_id, episodio_id, tipo,
             procedimiento_descrito, riesgos_explicados, alternativas,
             medico_que_informa,
             firmante_rol, firmante_nombre, firmante_documento)
          VALUES (
            ${instanciaId}::uuid,
            ${pacienteId}::uuid,
            ${input.episodioId}::uuid,
            ${input.tipoConsentimiento},
            ${input.procedimientoDescrito},
            ${input.riesgos ?? null},
            ${input.alternativas ?? null},
            ${personal.id}::uuid,
            -- Datos del firmante: se completan en firmarPaciente
            ${input.datosTestigo?.nombre ? "representante_legal" : null},
            ${input.datosTestigo?.nombre ?? null},
            ${input.datosTestigo?.documento ?? null}
          )
          RETURNING id::text
        `;

        return {
          consentimientoId: ciRows[0]!.id,
          instanciaId,
          estadoCodigo: "borrador",
        };
      });
    }),

  /**
   * Registra la firma del paciente o representante legal.
   *
   * Actualiza firmante_rol, firmante_nombre, firmante_documento y
   * evidencia_firma_ref. Solo posible en estado borrador.
   * No avanza el workflow (el MC firma en el paso siguiente).
   */
  firmarPaciente: eceReaderProc
    .input(eceConsentimientoFirmarPacienteSchema)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withEceContext(ctx.prisma, eceCtx, async (tx) => {
        const ci = await findConsentimiento(tx, input.consentimientoId);
        if (!ci) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Consentimiento no encontrado: ${input.consentimientoId}`,
          });
        }

        if (ci.estado_codigo !== "borrador") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `El consentimiento ya no está en borrador (estado: ${ci.estado_codigo}). No se puede registrar la firma del paciente.`,
          });
        }

        await (tx.$executeRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<number>)`
          UPDATE ece.consentimiento_informado
          SET firmante_rol      = ${input.firmanteTipo},
              firmante_nombre   = ${input.firmanteNombre},
              firmante_documento = ${input.firmanteDocumento},
              evidencia_firma_ref = ${input.firmaImagenUri}
          WHERE id = ${input.consentimientoId}::uuid
        `;

        return {
          ok: true as const,
          firmaRegistradaEn: new Date().toISOString(),
        };
      });
    }),

  /**
   * Firma el consentimiento con el PIN electrónico del MC.
   *
   * Pasos:
   *   1. Verifica que el consentimiento esté en borrador.
   *   2. Verifica que el paciente haya firmado (evidencia_firma_ref no nulo).
   *   3. Valida el PIN del MC contra ece.firma_electronica.
   *   4. Avanza el estado del workflow: borrador → firmado.
   *   5. Emite evento de dominio 'workflow.transitionExecuted' con hash inmutable.
   *
   * Require rol MC o ESP.
   */
  firmar: physicianProc
    .input(eceConsentimientoFirmarMcSchema)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withEceContext(ctx.prisma, eceCtx, async (tx) => {
        const ci = await findConsentimiento(tx, input.consentimientoId);
        if (!ci) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Consentimiento no encontrado: ${input.consentimientoId}`,
          });
        }

        if (ci.estado_codigo !== "borrador") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `El consentimiento no está en borrador (estado: ${ci.estado_codigo}). Inmutabilidad enforced.`,
          });
        }

        if (!ci.evidencia_firma_ref) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "El paciente/representante aún no ha registrado su firma. Use firmarPaciente primero.",
          });
        }

        // Verificar PIN del MC
        const { firmaId } = await verifyPinOrThrow(tx, ctx.user.id, input.pin);

        // Avanzar workflow borrador → firmado (rol MC o ESP según el que ejecuta)
        const rolEjecutor = ctx.tenant.roleCodes.includes("MC") ? "MC" : "ESP";
        await avanzarEstado(tx, ci.instancia_id, "firmar", eceCtx.personalId, rolEjecutor, firmaId);

        // Hash inmutable del contenido clínico (para outbox)
        const contenidoHash = computeContenidoHash(ci);

        // Emitir evento de dominio (outbox transaccional)
        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "workflow.transitionExecuted",
          aggregateType: "ConsentimientoInformado",
          aggregateId: ci.id,
          emittedById: ctx.user.id,
          payload: {
            instanceId: ci.instancia_id,
            tipoDocumentoCodigo: "CONS_INF",
            fromStateId: ci.estado_id,
            toStateId: "firmado", // referencia conceptual; el estado real está en di
            accion: "firmar",
            byUserId: ctx.user.id,
            firmaId,
          },
        });

        return {
          ok: true as const,
          contenidoHash,
          firmadoEn: new Date().toISOString(),
        };
      });
    }),

  /**
   * Valida (autoriza) el consentimiento firmado. Rol DIR.
   *
   * Avanza el workflow: firmado → validado.
   * Solo posible si el estado es 'firmado'.
   */
  validar: dirProc
    .input(eceConsentimientoValidarSchema)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withEceContext(ctx.prisma, eceCtx, async (tx) => {
        const ci = await findConsentimiento(tx, input.consentimientoId);
        if (!ci) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Consentimiento no encontrado: ${input.consentimientoId}`,
          });
        }

        if (ci.estado_codigo !== "firmado") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `El consentimiento no está en estado 'firmado' (estado: ${ci.estado_codigo}).`,
          });
        }

        await avanzarEstado(tx, ci.instancia_id, "validar", eceCtx.personalId, "DIR");

        return {
          ok: true as const,
          validadoEn: new Date().toISOString(),
        };
      });
    }),
});
