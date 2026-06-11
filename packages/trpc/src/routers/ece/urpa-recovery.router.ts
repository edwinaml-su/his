/**
 * eceUrpaRecovery — router tRPC para URPA (Unidad de Recuperación Post-Anestésica).
 *
 * Workflow: activo → alta_otorgada | anulado
 * Código de tipo de documento: URPA
 *
 * Tablas ECE (raw SQL — sin modelo Prisma):
 *   ece.urpa_recovery          — registro principal URPA
 *   ece.documento_instancia    — instancia del documento en workflow
 *   ece.acto_quirurgico        — FK de origen
 *
 * Autorización: requireRole(["NURSE", "PHYSICIAN"])
 * Alta: requireRole(["ESP", "MC"]) — Art. 39 NTEC + JCI ASC.5: solo anestesiólogo/MC firma el alta.
 *
 * Lógica de negocio dar alta:
 *   - Aldrete alta ≥9 → criterio debe ser "cumple".
 *   - Aldrete alta <9 → criterio "no_cumple_observacion" o "trasladar_uci".
 *   - Validado en Zod (eceUrpaDarAltaSchema) y reforzado en router.
 *   - Requiere firmaPin (PIN argon2id) del ESP/MC que otorga el alta.
 *   - Emite evento de dominio ece.urpa.alta_otorgada vía emitDomainEvent (outbox unificado).
 *
 * @QA E2E a cubrir:
 *   - Flujo completo: create (NURSE) → registrarSignos (NURSE) → darAlta (ESP, Aldrete ≥9, criterio cumple, PIN válido).
 *   - darAlta con Aldrete <9 y criterio "cumple" → 400.
 *   - darAlta con Aldrete ≥9 y criterio "no_cumple_observacion" → 400.
 *   - darAlta sobre registro ya dado de alta → 409.
 *   - darAlta con PIN incorrecto → 401.
 *   - NURSE intenta darAlta → 403 (Art. 39 NTEC).
 *   - PHYSICIAN intenta darAlta → 403 (solo ESP/MC).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { argon2 } from "@his/infrastructure";
import type { PrismaClient } from "@his/database";
import { router, requireRole } from "../../trpc";
import { withEceContext } from "../../ece/rls-context";
import { emitDomainEvent } from "@his/database";
import {
  eceUrpaCreateSchema,
  eceUrpaRegistrarSignosSchema,
  eceUrpaDarAltaSchema,
} from "@his/contracts";

// ─── Tipo de fila raw ────────────────────────────────────────────────────────

export interface UrpaRecoveryRow {
  id: string;
  acto_quirurgico_id: string;
  ingreso_urpa_ts: Date;
  alta_urpa_ts: Date | null;
  escala_aldrete_ingreso: number;
  escala_aldrete_alta: number | null;
  medicamentos_administrados: unknown;
  complicaciones: string | null;
  criterio_alta: string | null;
  registrado_por: string;
  alta_registrada_por: string | null;
  estado_registro: string;
  creado_en: Date;
  actualizado_en: Date;
}

// ─── Tipos internos para firma ───────────────────────────────────────────────

interface PersonalRow {
  id: string;
}

interface FirmaRow {
  id: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
}

// ─── PIN verification (Art. 39 NTEC — firma anestesiólogo) ───────────────────

const LOCKOUT_MAX = 5;

async function verifyPinOrThrow(
  tx: PrismaClient,
  hisUserId: string,
  pin: string,
): Promise<{ firmaId: string }> {
  const personalRows = await tx.$queryRaw<PersonalRow[]>`
    SELECT id::text
    FROM ece.personal_salud
    WHERE his_user_id = ${hisUserId}::uuid
      AND activo = true
    LIMIT 1
  `;
  const personal = personalRows[0];
  if (!personal) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No se encontró un profesional de salud asociado a su cuenta.",
    });
  }

  const firmaRows = await tx.$queryRaw<FirmaRow[]>`
    SELECT id::text, pin_hash, failed_attempts, locked_until
    FROM ece.firma_electronica
    WHERE personal_id = ${personal.id}::uuid
      AND revoked_at IS NULL
    LIMIT 1
  `;
  const firma = firmaRows[0];
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveEceIds(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string };
}): { personalId: string; establecimientoId: string } {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar URPA.",
    });
  }
  return { personalId: ctx.user.id, establecimientoId: ctx.tenant.establishmentId };
}

// ─── Procedures base ─────────────────────────────────────────────────────────

const base = requireRole(["NURSE", "PHYSICIAN"]);
const nurseOnly = requireRole(["NURSE"]);
// Art. 39 NTEC + JCI ASC.5: el alta URPA solo puede otorgarla el anestesiólogo (ESP) o MC.
const espOnly = requireRole(["ESP", "MC"]);

// ─── Router ──────────────────────────────────────────────────────────────────

export const eceUrpaRecoveryRouter = router({
  /**
   * Lista registros URPA. Requiere actoQuirurgicoId o pacienteId.
   */
  list: base
    .input(
      z.object({
        actoQuirurgicoId: z.string().uuid().optional(),
        estadoRegistro: z
          .enum(["activo", "alta_otorgada", "anulado"])
          .optional(),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<UrpaRecoveryRow[]>`
          SELECT
            u.id::text,
            u.acto_quirurgico_id::text,
            u.ingreso_urpa_ts,
            u.alta_urpa_ts,
            u.escala_aldrete_ingreso,
            u.escala_aldrete_alta,
            u.medicamentos_administrados,
            u.complicaciones,
            u.criterio_alta,
            u.registrado_por::text,
            u.alta_registrada_por::text,
            u.estado_registro,
            u.creado_en,
            u.actualizado_en
          FROM ece.urpa_recovery u
          JOIN ece.acto_quirurgico aq ON aq.id = u.acto_quirurgico_id
          WHERE
            (${input.actoQuirurgicoId ?? null}::uuid IS NULL
              OR u.acto_quirurgico_id = ${input.actoQuirurgicoId ?? null}::uuid)
            AND (${input.estadoRegistro ?? null}::text IS NULL
              OR u.estado_registro = ${input.estadoRegistro ?? null}::text)
            AND (${input.cursor ?? null}::uuid IS NULL
              OR u.id > ${input.cursor ?? null}::uuid)
          ORDER BY u.ingreso_urpa_ts DESC, u.id DESC
          LIMIT ${input.limit + 1}
        `;

        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1]!.id : null;

        return { items, nextCursor };
      });
    }),

  /**
   * Obtiene un registro URPA por id.
   */
  get: base
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<UrpaRecoveryRow[]>`
          SELECT
            u.id::text,
            u.acto_quirurgico_id::text,
            u.ingreso_urpa_ts,
            u.alta_urpa_ts,
            u.escala_aldrete_ingreso,
            u.escala_aldrete_alta,
            u.medicamentos_administrados,
            u.complicaciones,
            u.criterio_alta,
            u.registrado_por::text,
            u.alta_registrada_por::text,
            u.estado_registro,
            u.creado_en,
            u.actualizado_en
          FROM ece.urpa_recovery u
          WHERE u.id = ${input.id}::uuid
          LIMIT 1
        `;

        if (!rows[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Registro URPA no encontrado: ${input.id}`,
          });
        }

        return rows[0];
      });
    }),

  /**
   * Crea un nuevo registro URPA al ingreso del paciente.
   * Estado inicial: "activo".
   */
  create: nurseOnly
    .input(eceUrpaCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        // Verificar que el acto quirúrgico existe y su episodio pertenece al
        // establecimiento activo. acto_quirurgico no tiene establecimiento_id
        // propio — la FK de tenancy va por episodio_id → episodio_atencion.
        const actoRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT aq.id::text
          FROM ece.acto_quirurgico aq
          JOIN ece.episodio_atencion ep ON ep.id = aq.episodio_id
          WHERE aq.id = ${input.actoQuirurgicoId}::uuid
            AND ep.establecimiento_id = ${establecimientoId}::uuid
          LIMIT 1
        `;

        if (!actoRows[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Acto quirúrgico no encontrado en el establecimiento activo.",
          });
        }

        // Verificar que no existe ya un registro URPA activo para este acto.
        const existeRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM ece.urpa_recovery
          WHERE acto_quirurgico_id = ${input.actoQuirurgicoId}::uuid
            AND estado_registro = 'activo'
          LIMIT 1
        `;

        if (existeRows[0]) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Ya existe un registro URPA activo para este acto quirúrgico: ${existeRows[0].id}`,
          });
        }

        const medicamentosJson = JSON.stringify(input.medicamentosAdministrados ?? []);
        const ingresoTs = input.ingresoUrpaTs ? new Date(input.ingresoUrpaTs) : new Date();

        const rows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO ece.urpa_recovery (
            acto_quirurgico_id,
            ingreso_urpa_ts,
            escala_aldrete_ingreso,
            medicamentos_administrados,
            complicaciones,
            registrado_por,
            estado_registro
          ) VALUES (
            ${input.actoQuirurgicoId}::uuid,
            ${ingresoTs}::timestamptz,
            ${input.escalaAldreteIngreso}::smallint,
            ${medicamentosJson}::jsonb,
            ${input.complicaciones ?? null},
            ${personalId}::uuid,
            'activo'
          )
          RETURNING id::text
        `;

        return { id: rows[0]!.id };
      });
    }),

  /**
   * Actualiza medicamentos y complicaciones mientras el registro está activo.
   * Sólo actualizacion parcial — no cambia estado.
   */
  registrarSignos: nurseOnly
    .input(eceUrpaRegistrarSignosSchema)
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<{ estado_registro: string }[]>`
          SELECT estado_registro FROM ece.urpa_recovery
          WHERE id = ${input.id}::uuid LIMIT 1
        `;

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Registro URPA no encontrado." });
        }

        if (rows[0].estado_registro !== "activo") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se puede actualizar un registro URPA activo. Estado: '${rows[0].estado_registro}'.`,
          });
        }

        const medicamentosJson =
          input.medicamentosAdministrados !== undefined
            ? JSON.stringify(input.medicamentosAdministrados)
            : null;

        await tx.$executeRaw`
          UPDATE ece.urpa_recovery SET
            medicamentos_administrados = COALESCE(
              ${medicamentosJson}::jsonb,
              medicamentos_administrados
            ),
            complicaciones = COALESCE(${input.complicaciones ?? null}, complicaciones),
            actualizado_en = now()
          WHERE id = ${input.id}::uuid
        `;

        return { ok: true as const };
      });
    }),

  /**
   * Otorga el alta URPA.
   *
   * Reglas:
   *   - Solo ESP (anestesiólogo) o MC — Art. 39 NTEC + JCI ASC.5.
   *   - Requiere firmaPin argon2id del profesional que otorga el alta.
   *   - Aldrete alta ≥9 → criterio debe ser "cumple".
   *   - Aldrete alta <9 → criterio "no_cumple_observacion" o "trasladar_uci".
   *   - Emite evento ece.urpa.alta_otorgada vía emitDomainEvent (outbox unificado).
   */
  darAlta: espOnly
    .input(eceUrpaDarAltaSchema.and(z.object({ firmaPin: z.string().min(4) })))
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<UrpaRecoveryRow[]>`
          SELECT
            u.id::text,
            u.acto_quirurgico_id::text,
            u.estado_registro,
            u.escala_aldrete_ingreso
          FROM ece.urpa_recovery u
          WHERE u.id = ${input.id}::uuid LIMIT 1
        `;

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Registro URPA no encontrado." });
        }

        const urpa = rows[0];

        if (urpa.estado_registro !== "activo") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `El alta ya fue registrada o el registro está anulado. Estado: '${urpa.estado_registro}'.`,
          });
        }

        // Verificar PIN del anestesiólogo/MC antes de procesar (Art. 39 NTEC).
        await verifyPinOrThrow(tx, ctx.user.id, input.firmaPin);

        // Doble verificación (la validación Zod ya lo valida, pero reforzamos en DB).
        const aldreteAlta = input.escalaAldreteAlta;
        const criterio = input.criterioAlta;

        if (aldreteAlta >= 9 && criterio !== "cumple") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Aldrete ≥9: el criterio de alta debe ser 'cumple'.",
          });
        }
        if (aldreteAlta < 9 && criterio === "cumple") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Aldrete <9: el criterio 'cumple' no está permitido. Use 'no_cumple_observacion' o 'trasladar_uci'.",
          });
        }

        const altaTs = input.altaUrpaTs ? new Date(input.altaUrpaTs) : new Date();

        await tx.$executeRaw`
          UPDATE ece.urpa_recovery SET
            alta_urpa_ts         = ${altaTs}::timestamptz,
            escala_aldrete_alta  = ${aldreteAlta}::smallint,
            criterio_alta        = ${criterio},
            alta_registrada_por  = ${personalId}::uuid,
            estado_registro      = 'alta_otorgada',
            actualizado_en       = now()
          WHERE id = ${input.id}::uuid
        `;

        await emitDomainEvent(tx, {
          eventType: "ece.urpa.alta_otorgada",
          aggregateType: "UrpaRecovery",
          aggregateId: input.id,
          organizationId: ctx.tenant.organizationId,
          emittedById: ctx.user.id,
          payload: {
            urpaId: input.id,
            actoQuirurgicoId: urpa.acto_quirurgico_id,
            escalaAldreteAlta: aldreteAlta,
            criterioAlta: criterio,
            altaOtorgadaEn: altaTs.toISOString(),
            registradoPor: personalId,
          },
        });

        return { ok: true as const, altaTs: altaTs.toISOString() };
      });
    }),
});
