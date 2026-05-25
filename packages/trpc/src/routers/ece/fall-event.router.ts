/**
 * Router tRPC — Reporte de Caídas ECE.
 *
 * JCI Standard: IPSG.6 ME 4 — Registro estructurado de eventos de caída.
 * US.5.16 — Formulario estructurado reporte de caídas (5 SP).
 *
 * Flujo:
 *   1. Personal de salud registra la caída con PIN de firma electrónica.
 *   2. Se emite evento outbox `ipsg6.fall_event_recorded`.
 *   3. Listado paginado por episodio para historial.
 */
import { TRPCError } from "@trpc/server";
import { argon2 } from "@his/infrastructure";
import { emitDomainEvent } from "@his/database";
import { fallEventInputSchema, fallEventListInputSchema } from "@his/contracts/schemas/fall-event";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext, type EceContext } from "../../workflow/context";

// =============================================================================
// Tipos raw
// =============================================================================

interface FallEventRow {
  id: string;
  paciente_id: string;
  episodio_id: string;
  organization_id: string;
  fecha_hora: Date;
  lugar: string;
  lugar_otro: string | null;
  testigo_presente: boolean;
  testigo_tipo: string | null;
  morse_previa: number | null;
  circunstancia: string;
  lesion_resultante: string | null;
  requirio_atencion_medica: boolean;
  intervencion_aplicada: string | null;
  reportado_por_id: string;
  creado_en: Date;
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
// Helpers
// =============================================================================

function buildEceCtx(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string; roleCodes: string[] };
}): EceContext {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para registrar caídas.",
    });
  }
  return {
    personalId: ctx.user.id,
    establecimientoId: ctx.tenant.establishmentId,
    roles: ctx.tenant.roleCodes,
  };
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

async function findFirma(
  tx: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  personalId: string,
): Promise<FirmaRow | null> {
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

const LOCKOUT_MAX = 5;

async function verifyPinOrThrow(
  tx: {
    $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
    $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  },
  hisUserId: string,
  pin: string,
): Promise<string> {
  const personal = await findPersonal(tx, hisUserId);
  if (!personal) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "No se encontró un profesional de salud asociado a su cuenta.",
    });
  }

  const firma = await findFirma(tx, personal.id);
  if (!firma) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
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
    UPDATE ece.firma_electronica
    SET failed_attempts = 0
    WHERE id = ${firma.id}::uuid
  `;

  return personal.id;
}

// =============================================================================
// Procedures
// =============================================================================

const staffProc = requireRole(["NURSE", "ENF", "MC", "ESP"]);
const readerProc = requireRole(["NURSE", "ENF", "MC", "ESP", "DIR"]);

// =============================================================================
// Router
// =============================================================================

export const fallEventRouter = router({
  /**
   * Registra un evento de caída con firma PIN obligatoria.
   *
   * JCI Standard: IPSG.6 ME 4
   */
  record: staffProc.input(fallEventInputSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    const orgId = ctx.tenant.organizationId;

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      // Verificar que el episodio pertenece al establecimiento
      const epRows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ episodio_id: string }>>)`
        SELECT episodio_id::text
        FROM ece.episodio_hospitalario
        WHERE episodio_id = ${input.episodioId}::uuid
        LIMIT 1
      `;

      if (epRows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Episodio hospitalario no encontrado en el establecimiento activo: ${input.episodioId}`,
        });
      }

      // Verificar PIN y obtener personal_id
      const personalId = await verifyPinOrThrow(tx, ctx.user.id, input.firmaPin);

      // Calcular hash del PIN para audit trail (no guardar plaintext)
      const firmaPinHash = await argon2.hash(input.firmaPin);

      const fechaHora = input.fechaHora ?? new Date().toISOString();

      const rows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.fall_event (
          organization_id,
          paciente_id,
          episodio_id,
          fecha_hora,
          lugar,
          lugar_otro,
          testigo_presente,
          testigo_tipo,
          circunstancia,
          lesion_resultante,
          requirio_atencion_medica,
          intervencion_aplicada,
          reportado_por_id,
          firma_pin_hash
        ) VALUES (
          ${orgId}::uuid,
          ${input.pacienteId}::uuid,
          ${input.episodioId}::uuid,
          ${fechaHora}::timestamptz,
          ${input.lugar},
          ${input.lugarOtro ?? null},
          ${input.testigoPresente},
          ${input.testigoTipo ?? null},
          ${input.circunstancia},
          ${input.lesionResultante},
          ${input.requirioAtencionMedica},
          ${input.intervencionAplicada ?? null},
          ${personalId}::uuid,
          ${firmaPinHash}
        )
        RETURNING id::text
      `;

      const fallEventId = rows[0]!.id;

      await emitDomainEvent(tx, {
        organizationId: orgId,
        eventType: "ipsg6.fall_event_recorded",
        aggregateType: "FallEvent",
        aggregateId: fallEventId,
        emittedById: ctx.user.id,
        payload: {
          fallEventId,
          pacienteId:             input.pacienteId,
          episodioId:             input.episodioId,
          lugar:                  input.lugar,
          lesionResultante:       input.lesionResultante,
          requirioAtencionMedica: input.requirioAtencionMedica,
          reportadoPorId:         personalId,
        },
      });

      return { fallEventId };
    });
  }),

  /**
   * Lista caídas de un episodio, paginadas por cursor.
   *
   * JCI Standard: IPSG.6 ME 3 — Historial de intervenciones por riesgo.
   */
  list: readerProc.input(fallEventListInputSchema).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      const rows = await (tx.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<FallEventRow[]>)`
        SELECT
          fe.id::text,
          fe.paciente_id::text,
          fe.episodio_id::text,
          fe.organization_id::text,
          fe.fecha_hora,
          fe.lugar,
          fe.lugar_otro,
          fe.testigo_presente,
          fe.testigo_tipo,
          fe.morse_previa,
          fe.circunstancia,
          fe.lesion_resultante,
          fe.requirio_atencion_medica,
          fe.intervencion_aplicada,
          fe.reportado_por_id::text,
          fe.creado_en
        FROM ece.fall_event fe
        WHERE (${input.episodioId ?? null}::uuid IS NULL OR fe.episodio_id = ${input.episodioId ?? null}::uuid)
          AND (${input.cursor ?? null}::uuid IS NULL OR fe.id < ${input.cursor ?? null}::uuid)
        ORDER BY fe.fecha_hora DESC, fe.id DESC
        LIMIT ${input.limit}
      `;

      const nextCursor = rows.length === input.limit ? rows[rows.length - 1]!.id : null;
      return { items: rows, nextCursor };
    });
  }),
});
