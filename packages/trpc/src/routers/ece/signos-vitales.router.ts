/**
 * Router tRPC — ECE Signos Vitales (SIG_VIT).
 *
 * Documento NTEC: SIG_VIT — Toma y Registro de Signos Vitales.
 * Norma: MINSAL Acuerdo n.° 1616 (2024) — documento clínico de enfermería
 *   de alta frecuencia (múltiples tomas por turno durante hospitalización).
 * Código de tipo_documento: SIG_VIT.
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (código tipo: SIG_VIT)
 * ---------------------------------------------------------------------------
 *   borrador    → en_revision  (NURSE: completar toma)
 *   en_revision → firmado      (NURSE: firma — inmutable post-firma)
 *   firmado     → validado     (NURSE: validación por supervisora)
 *   cualquiera  → anulado      (NURSE/PHYSICIAN: corrección de toma errónea)
 *
 *   Al firmar, si no existe ece.documento_instancia para la toma, se crea
 *   automáticamente. La inmutabilidad se logra rechazando UPDATE en el router
 *   (no hay trigger dedicado — la lógica vive en JS).
 *
 *   Cada transición inserta fila en ece.documento_instancia_historial con
 *   hash SHA-256 del payload JSON (cadena de auditoría, análogo a §6.3 TDR).
 *
 * ---------------------------------------------------------------------------
 * OUTBOX
 * ---------------------------------------------------------------------------
 *   No emite eventos de dominio propios. Los signos vitales son consumidos
 *   directamente por la UI de enfermería; el event outbox no es necesario
 *   para el flujo de alta frecuencia (trade-off: latencia vs. consistencia).
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.signos_vitales                — fila principal: episodio_id, fecha_hora_toma,
 *                                       presion_sistolica, presion_diastolica,
 *                                       frecuencia_cardiaca, frecuencia_respiratoria,
 *                                       saturacion_o2, escala_dolor,
 *                                       peso_kg, talla_cm, imc, glucometria_mgdl
 *   ece.documento_instancia           — instancia de workflow del documento
 *   ece.documento_instancia_historial — log de transiciones + SHA-256 payload
 *   ece.tipo_documento                — resolución de tipoDocumentoId por código 'SIG_VIT'
 *   ece.flujo_estado                  — estado inicial configurado para SIG_VIT
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   list, get      → requireRole(["NURSE","PHYSICIAN"])
 *   create, update → requireRole(["NURSE"])
 *   firmar         → requireRole(["NURSE"])
 *   validar        → requireRole(["NURSE"])
 *   anular         → requireRole(["NURSE","PHYSICIAN"])
 *
 * @QA E2E a cubrir:
 *   - Flujo completo create → firmar → validar con credenciales NURSE.
 *   - Intentar update de registro firmado → 400 PRECONDITION_FAILED.
 *   - PHYSICIAN intenta firmar → 403 FORBIDDEN.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { withEceContext } from "../../ece/rls-context";
// Importar desde schemas locales del worktree para evitar el symlink de node_modules
// que apunta al main branch. Post-merge consolida en @his/contracts.
import {
  eceSignosVitalesCreateSchema,
  eceSignosVitalesUpdateSchema,
  type EceSignosVitalesUpdateInput,
} from "./signos-vitales.schemas";

// ─── Tipos de fila raw ───────────────────────────────────────────────────────

export interface SignosVitalesRow {
  id: string;
  episodio_id: string | null;
  instancia_id: string | null;
  registrado_por: string;
  presion_sistolica: number | null;
  presion_diastolica: number | null;
  frecuencia_cardiaca: number | null;
  frecuencia_respiratoria: number | null;
  temperatura: number | null;
  saturacion_o2: number | null;
  escala_dolor: number | null;
  peso_kg: number | null;
  talla_cm: number | null;
  imc: number | null;
  glucometria_mgdl: number | null;
  fecha_hora_toma: Date;
  estado_registro: string;
  registrado_en: Date;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Genera SHA-256 de un objeto JSON determinístico. */
function hashPayload(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

/**
 * Calcula IMC si peso y talla están disponibles.
 * Retorna null si alguno falta o talla es cero.
 */
function calcularImc(pesoKg: number | null | undefined, tallaCm: number | null | undefined): number | null {
  if (!pesoKg || !tallaCm || tallaCm === 0) return null;
  const tallaM = tallaCm / 100;
  return Math.round((pesoKg / (tallaM * tallaM)) * 10) / 10;
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
      (tipo_documento_id, episodio_id, registro_id, estado_actual_id, creado_por)
    VALUES (
      ${opts.tipoDocumentoId}::uuid,
      ${opts.episodioId ?? null}::uuid,
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
   * Al menos episodioId es requerido.
   */
  list: base
    .input(
      z.object({
        episodioId: z.string().uuid().optional(),
        desde: z.string().datetime({ offset: true }).optional(),
        hasta: z.string().datetime({ offset: true }).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!input.episodioId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Se requiere episodioId.",
        });
      }

      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<SignosVitalesRow[]>`
          SELECT
            sv.id::text,
            sv.episodio_id::text,
            sv.instancia_id::text,
            sv.registrado_por::text,
            sv.presion_sistolica,
            sv.presion_diastolica,
            sv.frecuencia_cardiaca,
            sv.frecuencia_respiratoria,
            sv.temperatura,
            sv.saturacion_o2,
            sv.escala_dolor,
            sv.peso_kg,
            sv.talla_cm,
            sv.imc,
            sv.glucometria_mgdl,
            sv.fecha_hora_toma,
            sv.estado_registro,
            sv.registrado_en
          FROM ece.signos_vitales sv
          WHERE sv.episodio_id = ${input.episodioId}::uuid
            AND (${input.desde ?? null}::timestamptz IS NULL
              OR sv.fecha_hora_toma >= ${input.desde ?? null}::timestamptz)
            AND (${input.hasta ?? null}::timestamptz IS NULL
              OR sv.fecha_hora_toma <= ${input.hasta ?? null}::timestamptz)
            AND (${input.cursor ?? null}::uuid IS NULL
              OR sv.id > ${input.cursor ?? null}::uuid)
          ORDER BY sv.fecha_hora_toma DESC, sv.id DESC
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
            sv.episodio_id::text,
            sv.instancia_id::text,
            sv.registrado_por::text,
            sv.presion_sistolica,
            sv.presion_diastolica,
            sv.frecuencia_cardiaca,
            sv.frecuencia_respiratoria,
            sv.temperatura,
            sv.saturacion_o2,
            sv.escala_dolor,
            sv.peso_kg,
            sv.talla_cm,
            sv.imc,
            sv.glucometria_mgdl,
            sv.fecha_hora_toma,
            sv.estado_registro,
            sv.registrado_en
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
   * IMC se calcula automáticamente si peso y talla están provistos.
   */
  create: nurseOnly
    .input(eceSignosVitalesCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);
      const imc = calcularImc(input.pesoKg, input.tallaCm);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO ece.signos_vitales (
            episodio_id, registrado_por,
            presion_sistolica, presion_diastolica,
            frecuencia_cardiaca, frecuencia_respiratoria,
            temperatura, saturacion_o2, escala_dolor,
            peso_kg, talla_cm, imc, glucometria_mgdl,
            fecha_hora_toma, estado_registro
          ) VALUES (
            ${input.episodioId ?? null}::uuid,
            ${personalId}::uuid,
            ${input.presionSistolica ?? null},
            ${input.presionDiastolica ?? null},
            ${input.frecuenciaCardiaca ?? null},
            ${input.frecuenciaRespiratoria ?? null},
            ${input.temperatura ?? null},
            ${input.saturacionO2 ?? null},
            ${input.escalaDolor ?? null},
            ${input.pesoKg ?? null},
            ${input.tallaCm ?? null},
            ${imc},
            ${input.glucometriaMgdl ?? null},
            ${input.fechaHoraToma ? new Date(input.fechaHoraToma) : new Date()},
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
        const rows = await tx.$queryRaw<{ estado_registro: string; peso_kg: number | null; talla_cm: number | null }[]>`
          SELECT estado_registro, peso_kg, talla_cm
          FROM ece.signos_vitales WHERE id = ${input.id}::uuid LIMIT 1
        `;

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Toma no encontrada." });
        }

        if (rows[0].estado_registro !== "borrador") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se pueden editar tomas en estado 'borrador'. Estado actual: '${rows[0].estado_registro}'.`,
          });
        }

        const d: EceSignosVitalesUpdateInput = input.data;

        // Recalcular IMC si peso o talla cambian
        const newPeso = d.pesoKg ?? rows[0].peso_kg;
        const newTalla = d.tallaCm ?? rows[0].talla_cm;
        const imc = calcularImc(newPeso, newTalla);

        await tx.$executeRaw`
          UPDATE ece.signos_vitales SET
            presion_sistolica       = COALESCE(${d.presionSistolica ?? null}, presion_sistolica),
            presion_diastolica      = COALESCE(${d.presionDiastolica ?? null}, presion_diastolica),
            frecuencia_cardiaca     = COALESCE(${d.frecuenciaCardiaca ?? null}, frecuencia_cardiaca),
            frecuencia_respiratoria = COALESCE(${d.frecuenciaRespiratoria ?? null}, frecuencia_respiratoria),
            temperatura             = COALESCE(${d.temperatura ?? null}, temperatura),
            saturacion_o2           = COALESCE(${d.saturacionO2 ?? null}, saturacion_o2),
            escala_dolor            = COALESCE(${d.escalaDolor ?? null}, escala_dolor),
            peso_kg                 = COALESCE(${d.pesoKg ?? null}, peso_kg),
            talla_cm                = COALESCE(${d.tallaCm ?? null}, talla_cm),
            imc                     = COALESCE(${imc}, imc),
            glucometria_mgdl        = COALESCE(${d.glucometriaMgdl ?? null}, glucometria_mgdl),
            fecha_hora_toma         = COALESCE(${d.fechaHoraToma ? new Date(d.fechaHoraToma) : null}::timestamptz, fecha_hora_toma),
            registrado_en           = now()
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
        const rows = await tx.$queryRaw<(SignosVitalesRow & { estado_registro: string })[]>`
          SELECT sv.*, sv.episodio_id::text AS episodio_id
          FROM ece.signos_vitales sv
          WHERE sv.id = ${input.id}::uuid LIMIT 1
        `;

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Toma no encontrada." });
        }

        const sv = rows[0];

        if (sv.estado_registro !== "borrador") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se pueden firmar tomas en 'borrador'. Estado actual: '${sv.estado_registro}'.`,
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
          SET estado_registro = 'firmado', registrado_en = now()
          WHERE id = ${input.id}::uuid
        `;

        // Upsert instancia de documento
        const { instanciaId, isNew } = await upsertDocInstancia(tx, {
          signosVitalesId: input.id,
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
          SELECT sv.*, sv.episodio_id::text AS episodio_id
          FROM ece.signos_vitales sv
          WHERE sv.id = ${input.id}::uuid LIMIT 1
        `;

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Toma no encontrada." });
        }

        const sv = rows[0];

        if (sv.estado_registro !== "firmado") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se pueden validar tomas en estado 'firmado'. Estado actual: '${sv.estado_registro}'.`,
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
          SET estado_registro = 'validado', registrado_en = now()
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
