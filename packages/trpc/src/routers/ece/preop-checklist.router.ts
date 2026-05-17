/**
 * eceCirugiaPreop — Lista de Verificación Preoperatoria (PREOP_CHECK).
 *
 * NTEC Art. 28, Acuerdo n.° 1616 (MINSAL 2024).
 *
 * Workflow: borrador → firmado (rol MC, firma electrónica PIN).
 * Después de firma, el registro es INMUTABLE (trigger BD).
 *
 * Tablas raw SQL (schema ece — sin modelo Prisma):
 *   ece.preop_checklist
 *   ece.documento_instancia
 *   ece.personal_salud
 *   ece.firma_electronica
 *   ece.episodio_hospitalario
 *
 * Outbox: `firmar` emite 'ece.preop_checklist.firmado' vía emitDomainEvent.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import argon2 from "argon2";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext, type EceContext } from "../../workflow/context";
import { emitDomainEvent } from "@his/database";

// =============================================================================
// Schemas Zod
// =============================================================================

export const preopChecklistCreateSchema = z.object({
  episodioHospitalarioId: z.string().uuid(),
  ayunoHoras: z.number().int().min(0).max(24).optional(),
  marcapasos: z.boolean().optional(),
  alergias: z.string().max(2000).optional(),
  anticoagulantes: z.boolean().optional(),
  retiroProtesis: z.boolean().optional(),
  identificacionPacienteVerificada: z.boolean().optional(),
  sitioMarcado: z.boolean().optional(),
  consentimientoFirmado: z.boolean().optional(),
  riesgoAnestesicoAsa: z.number().int().min(1).max(5).optional(),
});

export const preopChecklistUpdateSchema = preopChecklistCreateSchema
  .omit({ episodioHospitalarioId: true })
  .partial()
  .extend({ id: z.string().uuid() });

export const preopChecklistFirmarSchema = z.object({
  id: z.string().uuid(),
  pin: z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos"),
});

// =============================================================================
// Tipos de fila raw
// =============================================================================

interface PreopRow {
  id: string;
  instancia_id: string;
  episodio_hospitalario_id: string;
  ayuno_horas: number | null;
  marcapasos: boolean | null;
  alergias: string | null;
  anticoagulantes: boolean | null;
  retiro_protesis: boolean | null;
  identificacion_paciente_verificada: boolean | null;
  sitio_marcado: boolean | null;
  consentimiento_firmado: boolean | null;
  riesgo_anestesico_asa: number | null;
  estado_registro: string;
  firmado_por: string | null;
  firmado_en: Date | null;
  registrado_por: string;
  registrado_en: Date;
  estado_codigo: string;
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
// Helpers de contexto ECE (patrón consentimiento.router)
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

async function withEceCtx<T>(
  prisma: Parameters<typeof withWorkflowContext>[0],
  ctx: EceContext,
  fn: Parameters<typeof withWorkflowContext<T>>[2],
): Promise<T> {
  return withWorkflowContext(prisma, ctx, fn);
}

// =============================================================================
// Helpers raw SQL
// =============================================================================

async function findPreop(
  tx: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  id: string,
): Promise<PreopRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<PreopRow[]>)`
    SELECT
      pc.id::text,
      pc.instancia_id::text,
      pc.episodio_hospitalario_id::text,
      pc.ayuno_horas,
      pc.marcapasos,
      pc.alergias,
      pc.anticoagulantes,
      pc.retiro_protesis,
      pc.identificacion_paciente_verificada,
      pc.sitio_marcado,
      pc.consentimiento_firmado,
      pc.riesgo_anestesico_asa,
      pc.estado_registro,
      pc.firmado_por::text,
      pc.firmado_en,
      pc.registrado_por::text,
      pc.registrado_en,
      fe.codigo AS estado_codigo
    FROM ece.preop_checklist pc
    JOIN ece.documento_instancia di ON di.id = pc.instancia_id
    JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
    WHERE pc.id = ${id}::uuid
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

// ─── Verificación de PIN con lockout (patrón de consentimiento.router) ────────

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

  const firmaRows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<FirmaRow[]>)`
    SELECT id::text, pin_hash, failed_attempts, locked_until, revoked_at
    FROM ece.firma_electronica
    WHERE personal_id = ${personal.id}::uuid
      AND revoked_at IS NULL
    LIMIT 1
  `;
  const firma = firmaRows[0] ?? null;

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

  return { firmaId: firma.id };
}

// =============================================================================
// Procedures
// =============================================================================

const readerProc = requireRole(["MC", "ESP", "ENF", "ANES", "DIR", "ARCH"]);
const physicianProc = requireRole(["MC", "ANES"]);

// =============================================================================
// Router
// =============================================================================

export const eceCirugiaPreopRouter = router({
  /**
   * Lista checklists preoperatorios por episodio hospitalario (paginados).
   */
  list: readerProc
    .input(
      z.object({
        episodioHospitalarioId: z.string().uuid(),
        cursor: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
        const rows = await (tx.$queryRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<PreopRow[]>)`
          SELECT
            pc.id::text,
            pc.instancia_id::text,
            pc.episodio_hospitalario_id::text,
            pc.ayuno_horas,
            pc.marcapasos,
            pc.alergias,
            pc.anticoagulantes,
            pc.retiro_protesis,
            pc.identificacion_paciente_verificada,
            pc.sitio_marcado,
            pc.consentimiento_firmado,
            pc.riesgo_anestesico_asa,
            pc.estado_registro,
            pc.firmado_por::text,
            pc.firmado_en,
            pc.registrado_por::text,
            pc.registrado_en,
            fe.codigo AS estado_codigo
          FROM ece.preop_checklist pc
          JOIN ece.documento_instancia di ON di.id = pc.instancia_id
          JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
          WHERE pc.episodio_hospitalario_id = ${input.episodioHospitalarioId}::uuid
            AND (${input.cursor ?? null}::uuid IS NULL OR pc.id < ${input.cursor ?? null}::uuid)
          ORDER BY pc.registrado_en DESC, pc.id DESC
          LIMIT ${input.limit}
        `;
        const nextCursor = rows.length === input.limit ? rows[rows.length - 1]!.id : null;
        return { items: rows, nextCursor };
      });
    }),

  /**
   * Obtiene un checklist por id.
   */
  get: readerProc
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
        const row = await findPreop(tx, input.id);
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Preop checklist no encontrado: ${input.id}`,
          });
        }
        return row;
      });
    }),

  /**
   * Crea un checklist en borrador.
   * Resuelve el tipo de documento PREOP_CHECK y su estado inicial.
   */
  create: physicianProc
    .input(preopChecklistCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
        // Verificar que el episodio hospitalario existe
        const hospRows = await (tx.$queryRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<Array<{ episodio_id: string }>>)`
          SELECT episodio_id::text
          FROM ece.episodio_hospitalario
          WHERE episodio_id = ${input.episodioHospitalarioId}::uuid
          LIMIT 1
        `;
        if (hospRows.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Episodio hospitalario no encontrado: ${input.episodioHospitalarioId}`,
          });
        }

        // Resolver tipo de documento PREOP_CHECK
        const tipoRows = await (tx.$queryRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<Array<{ tipo_doc_id: string; estado_inicial_id: string }>>)`
          SELECT td.id::text AS tipo_doc_id, fe.id::text AS estado_inicial_id
          FROM ece.tipo_documento td
          JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
          WHERE td.codigo = 'PREOP_CHECK'
          LIMIT 1
        `;
        if (tipoRows.length === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Tipo de documento PREOP_CHECK no configurado en el catálogo ECE.",
          });
        }
        const { tipo_doc_id, estado_inicial_id } = tipoRows[0]!;

        // Resolver paciente desde el episodio_atencion referenciado por hospitalario
        const pacienteRows = await (tx.$queryRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<Array<{ paciente_id: string }>>)`
          SELECT ea.paciente_id::text
          FROM ece.episodio_hospitalario eh
          JOIN ece.episodio_atencion ea ON ea.id = eh.episodio_id
          WHERE eh.episodio_id = ${input.episodioHospitalarioId}::uuid
          LIMIT 1
        `;
        const pacienteId = pacienteRows[0]?.paciente_id ?? null;

        // Resolver personal del ejecutor
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
            ${input.episodioHospitalarioId}::uuid,
            ${pacienteId}::uuid,
            ${estado_inicial_id}::uuid,
            ${eceCtx.personalId}::uuid
          )
          RETURNING id::text
        `;
        const instanciaId = instanciaRows[0]!.id;

        // Insertar checklist
        const insertRows = await (tx.$queryRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<Array<{ id: string }>>)`
          INSERT INTO ece.preop_checklist (
            instancia_id,
            episodio_hospitalario_id,
            ayuno_horas,
            marcapasos,
            alergias,
            anticoagulantes,
            retiro_protesis,
            identificacion_paciente_verificada,
            sitio_marcado,
            consentimiento_firmado,
            riesgo_anestesico_asa,
            registrado_por
          ) VALUES (
            ${instanciaId}::uuid,
            ${input.episodioHospitalarioId}::uuid,
            ${input.ayunoHoras ?? null},
            ${input.marcapasos ?? null},
            ${input.alergias ?? null},
            ${input.anticoagulantes ?? null},
            ${input.retiroProtesis ?? null},
            ${input.identificacionPacienteVerificada ?? null},
            ${input.sitioMarcado ?? null},
            ${input.consentimientoFirmado ?? null},
            ${input.riesgoAnestesicoAsa ?? null},
            ${personal.id}::uuid
          )
          RETURNING id::text
        `;

        return {
          id: insertRows[0]!.id,
          instanciaId,
          estadoCodigo: "borrador",
        };
      });
    }),

  /**
   * Actualiza un checklist en borrador (pre-firma).
   */
  update: physicianProc
    .input(preopChecklistUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
        const row = await findPreop(tx, input.id);
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Preop checklist no encontrado: ${input.id}`,
          });
        }
        if (row.estado_codigo !== "borrador") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `El checklist no está en borrador (estado: ${row.estado_codigo}). Inmutabilidad enforced.`,
          });
        }

        await (tx.$executeRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<number>)`
          UPDATE ece.preop_checklist SET
            ayuno_horas                         = COALESCE(${input.ayunoHoras ?? null}, ayuno_horas),
            marcapasos                          = COALESCE(${input.marcapasos ?? null}, marcapasos),
            alergias                            = COALESCE(${input.alergias ?? null}, alergias),
            anticoagulantes                     = COALESCE(${input.anticoagulantes ?? null}, anticoagulantes),
            retiro_protesis                     = COALESCE(${input.retiroProtesis ?? null}, retiro_protesis),
            identificacion_paciente_verificada  = COALESCE(${input.identificacionPacienteVerificada ?? null}, identificacion_paciente_verificada),
            sitio_marcado                       = COALESCE(${input.sitioMarcado ?? null}, sitio_marcado),
            consentimiento_firmado              = COALESCE(${input.consentimientoFirmado ?? null}, consentimiento_firmado),
            riesgo_anestesico_asa               = COALESCE(${input.riesgoAnestesicoAsa ?? null}, riesgo_anestesico_asa)
          WHERE id = ${input.id}::uuid
        `;

        return { ok: true as const };
      });
    }),

  /**
   * Firma el checklist con PIN electrónico del MC/ANES.
   * Avanza el workflow borrador → firmado y emite 'ece.preop_checklist.firmado'.
   */
  firmar: physicianProc
    .input(preopChecklistFirmarSchema)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withEceCtx(ctx.prisma, eceCtx, async (tx) => {
        const row = await findPreop(tx, input.id);
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Preop checklist no encontrado: ${input.id}`,
          });
        }
        if (row.estado_codigo !== "borrador") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `El checklist ya no está en borrador (estado: ${row.estado_codigo}).`,
          });
        }

        const { firmaId } = await verifyPinOrThrow(tx, ctx.user.id, input.pin);

        // Buscar el estado destino 'firmado'
        const transRows = await (tx.$queryRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<Array<{ estado_destino_id: string }>>)`
          SELECT ft.estado_destino_id::text
          FROM ece.flujo_transicion ft
          JOIN ece.flujo_estado fe_orig ON fe_orig.id = ft.estado_origen_id
          JOIN ece.rol r ON r.id = ft.rol_autoriza_id
          JOIN ece.documento_instancia di ON di.estado_actual_id = fe_orig.id
          WHERE di.id = ${row.instancia_id}::uuid
            AND ft.accion = 'firmar'
            AND r.codigo = ANY(ARRAY['MC','ANES'])
          LIMIT 1
        `;

        if (transRows.length === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Transición 'firmar' no permitida desde el estado actual.",
          });
        }

        const { estado_destino_id } = transRows[0]!;

        // Actualizar instancia
        await (tx.$executeRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<number>)`
          UPDATE ece.documento_instancia
          SET estado_actual_id = ${estado_destino_id}::uuid,
              version = version + 1
          WHERE id = ${row.instancia_id}::uuid
        `;

        // Registrar firma en preop_checklist
        const personal = await findPersonal(tx, ctx.user.id);
        await (tx.$executeRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<number>)`
          UPDATE ece.preop_checklist
          SET firmado_por = ${personal?.id ?? null}::uuid,
              firmado_en  = now()
          WHERE id = ${input.id}::uuid
        `;

        const firmadoEn = new Date().toISOString();

        // Emitir evento de dominio (outbox transaccional)
        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.preop_checklist.firmado",
          aggregateType: "PreopChecklist",
          aggregateId: row.id,
          emittedById: ctx.user.id,
          payload: {
            instanceId: row.instancia_id,
            tipoDocumentoCodigo: "PREOP_CHECK",
            episodioHospitalarioId: row.episodio_hospitalario_id,
            firmaId,
            byUserId: ctx.user.id,
            firmadoEn,
          },
        });

        return { ok: true as const, firmadoEn };
      });
    }),
});
