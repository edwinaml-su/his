/**
 * eceSignosVitales — router tRPC para tomas de signos vitales (ECE §SIG_VIT).
 *
 * Workflow: borrador → en_revision → firmado → validado → anulado
 * Código de tipo de documento: SIG_VIT
 *
 * Tablas ECE (raw SQL — sin modelo Prisma):
 *   ece.signos_vitales            — datos clínicos de la toma
 *   ece.documento_instancia       — instancia del documento en workflow
 *   ece.documento_instancia_historial — bitácora con hash de payload
 *   ece.tipo_documento            — resolución del tipoDocumentoId por código
 *   ece.flujo_estado              — estado inicial + estados por código
 *
 * Autorización: requireRole(["NURSE","PHYSICIAN"])
 * Contexto ECE: withEceContext(prisma, personalId, establecimientoId, fn)
 *
 * Firmar / validar:
 *   - Ambas acciones crean/actualizan la instancia en ece.documento_instancia
 *     (si no existe, se crea al firmar).
 *   - Insertan fila en ece.documento_instancia_historial con hash SHA-256 del
 *     payload JSON (inmutabilidad de auditoría, análogo al audit chain §6.3).
 *
 * @QA E2E a cubrir:
 *   - Flujo completo create → firmar → validar con credenciales NURSE.
 *   - Intentar update de registro firmado → 400.
 *   - PHYSICIAN puede listar pero no firmar (403).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { withEceContext } from "../../ece/rls-context";
import {
  eceSignosVitalesCreateSchema,
  eceSignosVitalesUpdateSchema,
  type EceSignosVitalesUpdateInput,
} from "@his/contracts";

// ─── Tipos de fila raw ───────────────────────────────────────────────────────

export interface SignosVitalesRow {
  id: string;
  paciente_id: string;
  episodio_id: string | null;
  personal_id: string;
  establecimiento_id: string;
  ta_sistolica: number | null;
  ta_diastolica: number | null;
  frecuencia_cardiaca: number | null;
  frecuencia_respiratoria: number | null;
  temperatura: number | null;
  saturacion_o2: number | null;
  dolor_eva: number | null;
  observaciones: string | null;
  tomado_en: Date;
  estado: string;
  creado_en: Date;
  actualizado_en: Date;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Genera SHA-256 de un objeto JSON determinístico. */
function hashPayload(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

/**
 * Resuelve el UUID del tipo de documento SIG_VIT y del estado por código.
 * Ambas queries son idempotentes (catálogo inmutable en runtime).
 */
async function resolveDocMetadata(
  tx: { $queryRaw: <T>(tpl: TemplateStringsArray, ...values: unknown[]) => Promise<T> },
  estadoCodigo: string,
): Promise<{ tipoDocumentoId: string; estadoId: string }> {
  const tipoRows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM ece.tipo_documento WHERE codigo = 'SIG_VIT' LIMIT 1
  `;
  if (!tipoRows[0]) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Tipo de documento SIG_VIT no está configurado en el catálogo.",
    });
  }

  const estadoRows = await tx.$queryRaw<{ id: string }[]>`
    SELECT fe.id::text
    FROM ece.flujo_estado fe
    JOIN ece.tipo_documento td ON td.id = fe.tipo_documento_id
    WHERE td.codigo = 'SIG_VIT'
      AND fe.codigo = ${estadoCodigo}
    LIMIT 1
  `;
  if (!estadoRows[0]) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Estado ${estadoCodigo} no configurado para SIG_VIT.`,
    });
  }

  return {
    tipoDocumentoId: tipoRows[0].id,
    estadoId: estadoRows[0].id,
  };
}

/**
 * Obtiene o crea la instancia de documento_instancia para un registro de
 * signos vitales. Si no existe la crea en el estado dado.
 */
async function upsertDocInstancia(
  tx: {
    $queryRaw: <T>(tpl: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
    $executeRaw: (tpl: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  },
  opts: {
    signosVitalesId: string;
    pacienteId: string;
    episodioId: string | null | undefined;
    tipoDocumentoId: string;
    estadoId: string;
    personalId: string;
  },
): Promise<{ instanciaId: string; isNew: boolean }> {
  // Buscar instancia existente ligada al registro de signos vitales
  const existing = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text
    FROM ece.documento_instancia
    WHERE registro_id = ${opts.signosVitalesId}::uuid
    LIMIT 1
  `;

  if (existing[0]) {
    return { instanciaId: existing[0].id, isNew: false };
  }

  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO ece.documento_instancia
      (tipo_documento_id, episodio_id, paciente_id, registro_id, estado_actual_id, creado_por)
    VALUES (
      ${opts.tipoDocumentoId}::uuid,
      ${opts.episodioId ?? null}::uuid,
      ${opts.pacienteId}::uuid,
      ${opts.signosVitalesId}::uuid,
      ${opts.estadoId}::uuid,
      ${opts.personalId}::uuid
    )
    RETURNING id::text
  `;

  return { instanciaId: rows[0]!.id, isNew: true };
}

/**
 * Inserta fila en ece.documento_instancia_historial con hash del payload.
 */
async function insertHistorial(
  tx: { $executeRaw: (tpl: TemplateStringsArray, ...values: unknown[]) => Promise<number> },
  opts: {
    instanciaId: string;
    estadoAnteriorId: string | null;
    estadoNuevoId: string;
    accion: string;
    personalId: string;
    payload: unknown;
  },
): Promise<void> {
  const payloadJson = JSON.stringify(opts.payload);
  const payloadHash = hashPayload(opts.payload);

  await tx.$executeRaw`
    INSERT INTO ece.documento_instancia_historial
      (instancia_id, estado_anterior_id, estado_nuevo_id, accion,
       ejecutado_por, payload_hash, observacion)
    VALUES (
      ${opts.instanciaId}::uuid,
      ${opts.estadoAnteriorId}::uuid,
      ${opts.estadoNuevoId}::uuid,
      ${opts.accion},
      ${opts.personalId}::uuid,
      ${payloadHash},
      ${payloadJson}
    )
  `;
}

// ─── Base procedure ──────────────────────────────────────────────────────────

const base = requireRole(["NURSE", "PHYSICIAN"]);
const nurseOnly = requireRole(["NURSE"]);

// ─── Router ──────────────────────────────────────────────────────────────────

export const eceSignosVitalesRouter = router({
  /**
   * Lista tomas de signos vitales con filtros opcionales.
   * Al menos pacienteId o episodioId es requerido.
   */
  list: base
    .input(
      z.object({
        pacienteId: z.string().uuid().optional(),
        episodioId: z.string().uuid().optional(),
        desde: z.string().datetime({ offset: true }).optional(),
        hasta: z.string().datetime({ offset: true }).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!input.pacienteId && !input.episodioId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Se requiere pacienteId o episodioId.",
        });
      }

      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<SignosVitalesRow[]>`
          SELECT
            sv.id::text,
            sv.paciente_id::text,
            sv.episodio_id::text,
            sv.personal_id::text,
            sv.establecimiento_id::text,
            sv.ta_sistolica,
            sv.ta_diastolica,
            sv.frecuencia_cardiaca,
            sv.frecuencia_respiratoria,
            sv.temperatura,
            sv.saturacion_o2,
            sv.dolor_eva,
            sv.observaciones,
            sv.tomado_en,
            sv.estado,
            sv.creado_en,
            sv.actualizado_en
          FROM ece.signos_vitales sv
          WHERE
            (${input.pacienteId ?? null}::uuid IS NULL
              OR sv.paciente_id = ${input.pacienteId ?? null}::uuid)
            AND (${input.episodioId ?? null}::uuid IS NULL
              OR sv.episodio_id = ${input.episodioId ?? null}::uuid)
            AND (${input.desde ?? null}::timestamptz IS NULL
              OR sv.tomado_en >= ${input.desde ?? null}::timestamptz)
            AND (${input.hasta ?? null}::timestamptz IS NULL
              OR sv.tomado_en <= ${input.hasta ?? null}::timestamptz)
            AND (${input.cursor ?? null}::uuid IS NULL
              OR sv.id > ${input.cursor ?? null}::uuid)
          ORDER BY sv.tomado_en DESC, sv.id DESC
          LIMIT ${input.limit + 1}
        `;

        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1]!.id : null;

        return { items, nextCursor };
      });
    }),

  /** Obtiene una toma por id. */
  get: base
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<SignosVitalesRow[]>`
          SELECT
            sv.id::text,
            sv.paciente_id::text,
            sv.episodio_id::text,
            sv.personal_id::text,
            sv.establecimiento_id::text,
            sv.ta_sistolica,
            sv.ta_diastolica,
            sv.frecuencia_cardiaca,
            sv.frecuencia_respiratoria,
            sv.temperatura,
            sv.saturacion_o2,
            sv.dolor_eva,
            sv.observaciones,
            sv.tomado_en,
            sv.estado,
            sv.creado_en,
            sv.actualizado_en
          FROM ece.signos_vitales sv
          WHERE sv.id = ${input.id}::uuid
          LIMIT 1
        `;

        if (!rows[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Signos vitales no encontrados: ${input.id}`,
          });
        }

        return rows[0];
      });
    }),

  /**
   * Crea una nueva toma de signos vitales en estado "borrador".
   * Valida rangos plausibles vía Zod antes de llegar a la BD.
   */
  create: nurseOnly
    .input(eceSignosVitalesCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO ece.signos_vitales (
            paciente_id, episodio_id, personal_id, establecimiento_id,
            ta_sistolica, ta_diastolica, frecuencia_cardiaca, frecuencia_respiratoria,
            temperatura, saturacion_o2, dolor_eva, observaciones,
            tomado_en, estado
          ) VALUES (
            ${input.pacienteId}::uuid,
            ${input.episodioId ?? null}::uuid,
            ${input.personalId}::uuid,
            ${input.establecimientoId}::uuid,
            ${input.taSistolica ?? null},
            ${input.taDiastolica ?? null},
            ${input.frecuenciaCardiaca ?? null},
            ${input.frecuenciaRespiratoria ?? null},
            ${input.temperatura ?? null},
            ${input.saturacionO2 ?? null},
            ${input.dolorEva ?? null},
            ${input.observaciones ?? null},
            ${input.tomadoEn ? new Date(input.tomadoEn) : new Date()},
            'borrador'
          )
          RETURNING id::text
        `;

        return { id: rows[0]!.id };
      });
    }),

  /**
   * Actualiza una toma SOLO si está en estado "borrador".
   */
  update: nurseOnly
    .input(
      z.object({
        id: z.string().uuid(),
        data: eceSignosVitalesUpdateSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        // Verificar que existe y está en borrador
        const rows = await tx.$queryRaw<{ estado: string }[]>`
          SELECT estado FROM ece.signos_vitales WHERE id = ${input.id}::uuid LIMIT 1
        `;

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Toma no encontrada." });
        }

        if (rows[0].estado !== "borrador") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se pueden editar tomas en estado 'borrador'. Estado actual: '${rows[0].estado}'.`,
          });
        }

        const d: EceSignosVitalesUpdateInput = input.data;
        await tx.$executeRaw`
          UPDATE ece.signos_vitales SET
            ta_sistolica           = COALESCE(${d.taSistolica ?? null}, ta_sistolica),
            ta_diastolica          = COALESCE(${d.taDiastolica ?? null}, ta_diastolica),
            frecuencia_cardiaca    = COALESCE(${d.frecuenciaCardiaca ?? null}, frecuencia_cardiaca),
            frecuencia_respiratoria = COALESCE(${d.frecuenciaRespiratoria ?? null}, frecuencia_respiratoria),
            temperatura            = COALESCE(${d.temperatura ?? null}, temperatura),
            saturacion_o2          = COALESCE(${d.saturacionO2 ?? null}, saturacion_o2),
            dolor_eva              = COALESCE(${d.dolorEva ?? null}, dolor_eva),
            observaciones          = COALESCE(${d.observaciones ?? null}, observaciones),
            tomado_en              = COALESCE(${d.tomadoEn ? new Date(d.tomadoEn) : null}::timestamptz, tomado_en),
            actualizado_en         = now()
          WHERE id = ${input.id}::uuid
        `;

        return { ok: true as const };
      });
    }),

  /**
   * Firma la toma (ENF). Transición borrador → firmado.
   *
   * Crea/actualiza instancia en ece.documento_instancia + inserta historial
   * con hash SHA-256 del payload (auditoría inmutable).
   */
  firmar: nurseOnly
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<SignosVitalesRow[]>`
          SELECT sv.*, sv.episodio_id::text AS episodio_id, sv.paciente_id::text AS paciente_id
          FROM ece.signos_vitales sv
          WHERE sv.id = ${input.id}::uuid LIMIT 1
        `;

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Toma no encontrada." });
        }

        const sv = rows[0];

        if (sv.estado !== "borrador") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se pueden firmar tomas en 'borrador'. Estado actual: '${sv.estado}'.`,
          });
        }

        // Resolver metadata de documento (tipoDocumentoId + estadoId "firmado")
        const { tipoDocumentoId, estadoId: estadoFirmadoId } = await resolveDocMetadata(
          tx,
          "firmado",
        );

        // Obtener también el estadoId "borrador" para el historial
        const estadoBorradorRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT fe.id::text
          FROM ece.flujo_estado fe
          JOIN ece.tipo_documento td ON td.id = fe.tipo_documento_id
          WHERE td.codigo = 'SIG_VIT' AND fe.codigo = 'borrador'
          LIMIT 1
        `;

        // Transición en signos_vitales
        await tx.$executeRaw`
          UPDATE ece.signos_vitales
          SET estado = 'firmado', actualizado_en = now()
          WHERE id = ${input.id}::uuid
        `;

        // Upsert instancia de documento
        const { instanciaId, isNew } = await upsertDocInstancia(tx, {
          signosVitalesId: input.id,
          pacienteId: sv.paciente_id,
          episodioId: sv.episodio_id,
          tipoDocumentoId,
          estadoId: estadoFirmadoId,
          personalId,
        });

        // Actualizar estado de la instancia si ya existía
        if (!isNew) {
          await tx.$executeRaw`
            UPDATE ece.documento_instancia
            SET estado_actual_id = ${estadoFirmadoId}::uuid, version = version + 1
            WHERE id = ${instanciaId}::uuid
          `;
        }

        // Insertar historial con hash
        await insertHistorial(tx, {
          instanciaId,
          estadoAnteriorId: estadoBorradorRows[0]?.id ?? null,
          estadoNuevoId: estadoFirmadoId,
          accion: "firmar",
          personalId,
          payload: { signosVitalesId: input.id, firmadoEn: new Date().toISOString() },
        });

        return { ok: true as const, instanciaId };
      });
    }),

  /**
   * Valida la toma (ENF). Transición firmado → validado.
   */
  validar: nurseOnly
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<SignosVitalesRow[]>`
          SELECT sv.*, sv.episodio_id::text AS episodio_id, sv.paciente_id::text AS paciente_id
          FROM ece.signos_vitales sv
          WHERE sv.id = ${input.id}::uuid LIMIT 1
        `;

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Toma no encontrada." });
        }

        const sv = rows[0];

        if (sv.estado !== "firmado") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se pueden validar tomas en estado 'firmado'. Estado actual: '${sv.estado}'.`,
          });
        }

        const { estadoId: estadoValidadoId } = await resolveDocMetadata(tx, "validado");

        const estadoFirmadoRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT fe.id::text
          FROM ece.flujo_estado fe
          JOIN ece.tipo_documento td ON td.id = fe.tipo_documento_id
          WHERE td.codigo = 'SIG_VIT' AND fe.codigo = 'firmado'
          LIMIT 1
        `;

        await tx.$executeRaw`
          UPDATE ece.signos_vitales
          SET estado = 'validado', actualizado_en = now()
          WHERE id = ${input.id}::uuid
        `;

        // Obtener instancia asociada
        const instanciaRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM ece.documento_instancia
          WHERE registro_id = ${input.id}::uuid LIMIT 1
        `;

        if (!instanciaRows[0]) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "La toma no tiene instancia de documento. Firme primero.",
          });
        }

        const instanciaId = instanciaRows[0].id;

        await tx.$executeRaw`
          UPDATE ece.documento_instancia
          SET estado_actual_id = ${estadoValidadoId}::uuid, version = version + 1
          WHERE id = ${instanciaId}::uuid
        `;

        await insertHistorial(tx, {
          instanciaId,
          estadoAnteriorId: estadoFirmadoRows[0]?.id ?? null,
          estadoNuevoId: estadoValidadoId,
          accion: "validar",
          personalId,
          payload: { signosVitalesId: input.id, validadoEn: new Date().toISOString() },
        });

        return { ok: true as const };
      });
    }),
});

// ─── Helper de contexto ──────────────────────────────────────────────────────

/**
 * Extrae personalId y establecimientoId del contexto tRPC.
 * El personalId usa ctx.user.id como proxy hasta que ece.personal_salud
 * esté completamente integrado (mismo patrón que workflow-instance.router.ts).
 */
function resolveEceIds(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string };
}): { personalId: string; establecimientoId: string } {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar signos vitales ECE.",
    });
  }
  return {
    personalId: ctx.user.id,
    establecimientoId: ctx.tenant.establishmentId,
  };
}
