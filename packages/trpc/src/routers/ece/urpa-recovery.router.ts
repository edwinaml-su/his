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
 * Alta: requireRole(["NURSE"])
 *
 * Lógica de negocio dar alta:
 *   - Aldrete alta ≥9 → criterio debe ser "cumple".
 *   - Aldrete alta <9 → criterio "no_cumple_observacion" o "trasladar_uci".
 *   - Validado en Zod (eceUrpaDarAltaSchema) y reforzado en router.
 *   - Emite evento de dominio ece.urpa.alta_otorgada en notifications_outbox.
 *
 * @QA E2E a cubrir:
 *   - Flujo completo: create → registrarSignos → darAlta (Aldrete ≥9, criterio cumple).
 *   - darAlta con Aldrete <9 y criterio "cumple" → 400.
 *   - darAlta con Aldrete ≥9 y criterio "no_cumple_observacion" → 400.
 *   - darAlta sobre registro ya dado de alta → 409.
 *   - PHYSICIAN puede list/get pero no darAlta (403).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { withEceContext } from "../../ece/rls-context";
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
        // Verificar que el acto quirúrgico existe y es del establecimiento activo.
        const actoRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT aq.id::text
          FROM ece.acto_quirurgico aq
          WHERE aq.id = ${input.actoQuirurgicoId}::uuid
            AND aq.establecimiento_id = ${establecimientoId}::uuid
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
   * Otorga el alta URPA (ENF).
   *
   * Reglas:
   *   - Aldrete alta ≥9 → criterio debe ser "cumple".
   *   - Aldrete alta <9 → criterio "no_cumple_observacion" o "trasladar_uci".
   *   - Emite evento ece.urpa.alta_otorgada en notifications_outbox.
   */
  darAlta: nurseOnly
    .input(eceUrpaDarAltaSchema)
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

        // Evento de dominio en notifications_outbox.
        const payload = JSON.stringify({
          urpaId: input.id,
          actoQuirurgicoId: urpa.acto_quirurgico_id,
          escalaAldreteAlta: aldreteAlta,
          criterioAlta: criterio,
          altaOtorgadaEn: altaTs.toISOString(),
          registradoPor: personalId,
        });

        await tx.$executeRaw`
          INSERT INTO notifications_outbox (event_type, payload, created_at)
          VALUES ('ece.urpa.alta_otorgada', ${payload}::jsonb, now())
        `;

        return { ok: true as const, altaTs: altaTs.toISOString() };
      });
    }),
});
