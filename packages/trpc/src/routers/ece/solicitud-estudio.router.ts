/**
 * eceSolicitudEstudio — Router tRPC para Solicitud de Estudio ECE (Doc 18 NTEC).
 *
 * Workflow SOL_EST:
 *   borrador → en_revision → firmado → validado
 *   cualquier estado pre-validado → anulado
 *
 * MC firma (con PIN electrónico), MC valida.
 * RLS habilitado en ece.solicitud_estudio (withWorkflowContext demota rol).
 *
 * Outbox emite:
 *   - 'ece.solicitud_estudio.firmada'   al firmar
 *   - 'ece.solicitud_estudio.validada'  al validar
 *   - 'ece.solicitud_estudio.anulada'   al anular
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import argon2 from "argon2";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext, type EceContext } from "../../workflow/context";
import { emitDomainEvent } from "@his/database";

// ---------------------------------------------------------------------------
// Schemas locales (mirrors de contracts; evita symlink en worktrees)
// ---------------------------------------------------------------------------

const tipoEstudioSchema = z.enum(["laboratorio", "imagenologia", "otro"]);
const prioridadEstudioSchema = z.enum(["rutina", "urgente", "stat"]);

const createSchema = z.object({
  episodioId: z.string().uuid(),
  tipo: tipoEstudioSchema,
  estudiosSolicitados: z.array(z.string().min(1).max(100)).min(1).max(50),
  prioridad: prioridadEstudioSchema.default("rutina"),
  observacionesClinicas: z.string().max(4000).optional(),
});

const firmarSchema = z.object({
  solicitudId: z.string().uuid(),
  pin: z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos"),
});

const validarSchema = z.object({
  solicitudId: z.string().uuid(),
  observacion: z.string().max(1000).optional(),
});

const anularSchema = z.object({
  solicitudId: z.string().uuid(),
  motivo: z.string().min(1).max(1000),
});

const listSchema = z.object({
  episodioId: z.string().uuid().optional(),
  estadoCodigo: z.string().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const getSchema = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// Tipos de fila raw
// ---------------------------------------------------------------------------

interface SolicitudRow {
  id: string;
  instancia_id: string;
  episodio_id: string;
  paciente_id: string;
  tipo: string;
  estudios_solicitados: unknown;
  prioridad: string;
  observaciones_clinicas: string | null;
  solicitado_por: string;
  fecha_solicitud: Date;
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

// ---------------------------------------------------------------------------
// Helpers comunes
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

async function findPersonal(tx: RawTx, hisUserId: string): Promise<PersonalRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<PersonalRow[]>)`
    SELECT id::text
    FROM ece.personal_salud
    WHERE his_user_id = ${hisUserId}::uuid AND activo = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findFirma(tx: RawTx, personalId: string): Promise<FirmaRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
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
    await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
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
  await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
    UPDATE ece.firma_electronica SET failed_attempts = 0 WHERE id = ${firma.id}::uuid
  `;
  return { firmaId: firma.id };
}

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
      message: `Transición '${accion}' no permitida desde el estado actual para el rol ${rolCodigo}.`,
    });
  }

  const { estado_destino_id } = transiciones[0]!;

  await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
    UPDATE ece.documento_instancia
    SET estado_actual_id = ${estado_destino_id}::uuid, version = version + 1
    WHERE id = ${instanciaId}::uuid
  `;

  await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
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

async function findSolicitud(tx: RawTx, id: string): Promise<SolicitudRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<SolicitudRow[]>)`
    SELECT
      se.id::text,
      se.instancia_id::text,
      se.episodio_id::text,
      se.paciente_id::text,
      se.tipo,
      se.estudios_solicitados,
      se.prioridad,
      se.observaciones_clinicas,
      se.solicitado_por::text,
      se.fecha_solicitud,
      fe.codigo AS estado_codigo,
      fe.id::text AS estado_id
    FROM ece.solicitud_estudio se
    JOIN ece.documento_instancia di ON di.id = se.instancia_id
    JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
    WHERE se.id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Procedures
// ---------------------------------------------------------------------------

const mcProc = requireRole(["MC", "ESP"]);
const eceReader = requireRole(["MC", "ESP", "ENF", "DIR", "ARCH", "TEC"]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const eceSolicitudEstudioRouter = router({
  /** Lista solicitudes con filtro opcional por episodio y estado. */
  list: eceReader.input(listSchema).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
      const rows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<SolicitudRow[]>)`
        SELECT
          se.id::text,
          se.instancia_id::text,
          se.episodio_id::text,
          se.paciente_id::text,
          se.tipo,
          se.estudios_solicitados,
          se.prioridad,
          se.observaciones_clinicas,
          se.solicitado_por::text,
          se.fecha_solicitud,
          fe.codigo AS estado_codigo,
          fe.id::text AS estado_id
        FROM ece.solicitud_estudio se
        JOIN ece.documento_instancia di ON di.id = se.instancia_id
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE (${input.episodioId ?? null}::uuid IS NULL OR se.episodio_id = ${input.episodioId ?? null}::uuid)
          AND (${input.estadoCodigo ?? null} IS NULL OR fe.codigo = ${input.estadoCodigo ?? null})
          AND (${input.cursor ?? null}::uuid IS NULL OR se.id < ${input.cursor ?? null}::uuid)
        ORDER BY se.fecha_solicitud DESC, se.id DESC
        LIMIT ${input.limit}
      `;
      const nextCursor = rows.length === input.limit ? rows[rows.length - 1]!.id : null;
      return { items: rows, nextCursor };
    });
  }),

  /** Obtiene una solicitud por id. */
  get: eceReader.input(getSchema).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
      const sol = await findSolicitud(tx, input.id);
      if (!sol) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Solicitud no encontrada: ${input.id}` });
      }
      return sol;
    });
  }),

  /** Crea una solicitud en borrador. */
  create: mcProc.input(createSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
      // Resolver tipo de documento SOL_EST
      const tipoRows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ tipo_doc_id: string; estado_inicial_id: string }>>)`
        SELECT td.id::text AS tipo_doc_id, fe.id::text AS estado_inicial_id
        FROM ece.tipo_documento td
        JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
        WHERE td.codigo = 'SOL_EST'
        LIMIT 1
      `;
      if (tipoRows.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Tipo de documento SOL_EST no configurado en el catálogo ECE.",
        });
      }
      const { tipo_doc_id, estado_inicial_id } = tipoRows[0]!;

      // Resolver paciente desde episodio
      const episodioRows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ paciente_id: string }>>)`
        SELECT paciente_id::text
        FROM ece.episodio_atencion
        WHERE id = ${input.episodioId}::uuid
        LIMIT 1
      `;
      if (episodioRows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Episodio no encontrado: ${input.episodioId}`,
        });
      }
      const pacienteId = episodioRows[0]!.paciente_id;

      const personal = await findPersonal(tx, ctx.user.id);
      if (!personal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No se encontró un profesional de salud asociado a su cuenta.",
        });
      }

      // Crear instancia de workflow
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

      // Insertar solicitud (estudios_solicitados como JSONB)
      const estudiosSolicitadosJson = JSON.stringify(input.estudiosSolicitados);
      const solRows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.solicitud_estudio
          (instancia_id, episodio_id, paciente_id, tipo,
           estudios_solicitados, prioridad, observaciones_clinicas, solicitado_por)
        VALUES (
          ${instanciaId}::uuid,
          ${input.episodioId}::uuid,
          ${pacienteId}::uuid,
          ${input.tipo},
          ${estudiosSolicitadosJson}::jsonb,
          ${input.prioridad},
          ${input.observacionesClinicas ?? null},
          ${personal.id}::uuid
        )
        RETURNING id::text
      `;

      return {
        solicitudId: solRows[0]!.id,
        instanciaId,
        estadoCodigo: "borrador",
      };
    });
  }),

  /** MC firma la solicitud con PIN — borrador → firmado. */
  firmar: mcProc.input(firmarSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
      const sol = await findSolicitud(tx, input.solicitudId);
      if (!sol) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Solicitud no encontrada: ${input.solicitudId}` });
      }
      if (sol.estado_codigo !== "borrador" && sol.estado_codigo !== "en_revision") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La solicitud no puede firmarse en estado '${sol.estado_codigo}'.`,
        });
      }

      const { firmaId } = await verifyPinOrThrow(tx, ctx.user.id, input.pin);
      const rolEjecutor = ctx.tenant.roleCodes.includes("MC") ? "MC" : "ESP";
      await avanzarEstado(tx, sol.instancia_id, "firmar", eceCtx.personalId, rolEjecutor, firmaId);

      await emitDomainEvent(tx, {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.solicitud_estudio.firmada",
        aggregateType: "SolicitudEstudio",
        aggregateId: sol.id,
        emittedById: ctx.user.id,
        payload: {
          instanceId: sol.instancia_id,
          tipoDocumentoCodigo: "SOL_EST",
          tipo: sol.tipo,
          prioridad: sol.prioridad,
          accion: "firmar",
          byUserId: ctx.user.id,
          firmaId,
        },
      });

      return { ok: true as const, firmadoEn: new Date().toISOString() };
    });
  }),

  /** MC valida la solicitud firmada — firmado → validado. */
  validar: mcProc.input(validarSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
      const sol = await findSolicitud(tx, input.solicitudId);
      if (!sol) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Solicitud no encontrada: ${input.solicitudId}` });
      }
      if (sol.estado_codigo !== "firmado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La solicitud no está en estado 'firmado' (estado: ${sol.estado_codigo}).`,
        });
      }

      const rolEjecutor = ctx.tenant.roleCodes.includes("MC") ? "MC" : "ESP";
      await avanzarEstado(tx, sol.instancia_id, "validar", eceCtx.personalId, rolEjecutor);

      await emitDomainEvent(tx, {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.solicitud_estudio.validada",
        aggregateType: "SolicitudEstudio",
        aggregateId: sol.id,
        emittedById: ctx.user.id,
        payload: {
          instanceId: sol.instancia_id,
          tipoDocumentoCodigo: "SOL_EST",
          accion: "validar",
          byUserId: ctx.user.id,
          observacion: input.observacion ?? null,
        },
      });

      return { ok: true as const, validadoEn: new Date().toISOString() };
    });
  }),

  /** Anula la solicitud. Solo estados pre-validados. */
  anular: requireRole(["MC", "ESP", "DIR"]).input(anularSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
      const sol = await findSolicitud(tx, input.solicitudId);
      if (!sol) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Solicitud no encontrada: ${input.solicitudId}` });
      }
      if (sol.estado_codigo === "validado" || sol.estado_codigo === "anulado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `No se puede anular una solicitud en estado '${sol.estado_codigo}'.`,
        });
      }

      const rolEjecutor = ctx.tenant.roleCodes.includes("DIR")
        ? "DIR"
        : ctx.tenant.roleCodes.includes("MC")
          ? "MC"
          : "ESP";

      await avanzarEstado(tx, sol.instancia_id, "anular", eceCtx.personalId, rolEjecutor);

      await emitDomainEvent(tx, {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.solicitud_estudio.anulada",
        aggregateType: "SolicitudEstudio",
        aggregateId: sol.id,
        emittedById: ctx.user.id,
        payload: {
          instanceId: sol.instancia_id,
          accion: "anular",
          motivo: input.motivo,
          byUserId: ctx.user.id,
        },
      });

      return { ok: true as const, anuladoEn: new Date().toISOString() };
    });
  }),
});
