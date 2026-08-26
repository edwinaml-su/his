/**
 * Router tRPC — ECE Indicaciones Médicas (IND_MED).
 *
 * Documento NTEC: Doc 6 — Indicaciones Médicas / Prescripción Farmacológica.
 * Norma: MINSAL Acuerdo n.° 1616 (2024), §3.6.
 * Código tipo_documento: IND_MED.
 *
 * ---------------------------------------------------------------------------
 * ESTRUCTURA BD (raw SQL — ece.* no en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.indicaciones_medicas
 *     id, instancia_id, episodio_id, fecha_hora, version (optimistic lock),
 *     vigencia (ACTIVA|SUSPENDIDA|CANCELADA), medico_prescriptor,
 *     transcripcion_enf, registrado_en, estado_registro (borrador|firmado|validado),
 *     digitado_retroactivamente, timestamp_real_papel, contingencia_evento_id
 *
 *   ece.indicacion_item
 *     id, indicacion_id, tipo, descripcion, dosis, via, frecuencia, duracion
 *
 *   ece.administracion_medicamento
 *     id, registro_enf_id, indicacion_item_id, hora_programada,
 *     hora_aplicada, estado, motivo_omision, responsable
 *
 * ---------------------------------------------------------------------------
 * OUTBOX
 * ---------------------------------------------------------------------------
 *   'ece.indicaciones.firmadas'  — emitido en firmar().
 *     Payload: { indicacionId, episodioId, medicoId, itemCount, organizationId }
 *     Consumido SÍNCRONAMENTE (misma transacción) por
 *     `materializeIndicacionFirmadaToFarmacia` (../../ece/mar-consumer.ts):
 *     copia los ítems tipo=medicamento, verbatim, a la cola de conciliación
 *     `ece.indicacion_farmacia_pendiente` (packages/database/sql/
 *     201_ece_indicacion_farmacia_pendiente.sql — NO aplicado a prod aún).
 *     Ver mar-consumer.ts para el porqué de este destino (no
 *     PrescriptionItem/MedicationAdministration ni administracion_medicamento)
 *     y el contrato de fallo (si falla, la firma completa revierte).
 *
 * ---------------------------------------------------------------------------
 * ROLES
 * ---------------------------------------------------------------------------
 *   list, get, listAdministraciones → PHYSICIAN | NURSE
 *   create, update, firmar          → PHYSICIAN
 *   suspender, cancelar             → PHYSICIAN | NURSE
 *   registrarAdministracion         → NURSE
 *
 * ---------------------------------------------------------------------------
 * HALLAZGOS CERRADOS (audit Stream B)
 * ---------------------------------------------------------------------------
 *   IND-001 [P0] Router + UI completamente ausentes → este archivo cierra.
 *   IND-005 [P2] vigencia sin enum constraint → migration NN_ind_constraints.sql.
 *
 * HALLAZGOS FOLLOW-UP (no implementados aquí)
 *   IND-002 [P1] Columnas estructuradas dosis_valor/dosis_unidad/via_codigo
 *   IND-003 [P1] Trigger inmutabilidad post-ADMINISTRADO en administracion_medicamento
 *   IND-004 [P2] CHECK condicional motivo_omision NOT NULL cuando estado OMITIDA|RECHAZADA
 *
 * ---------------------------------------------------------------------------
 * DRIFT CHECK-vs-Zod (detectado 2026-08-19, corregido 2026-08-20)
 * ---------------------------------------------------------------------------
 *   `tipoIndicacionEnum` y `estadoAdminEnum` de este archivo no coincidían en
 *   NINGÚN valor con los CHECK que tenía prod (minúsculas en español, del DDL
 *   original 61_ece_06_documentos.sql): `create()` y
 *   `registrarAdministracion()` violaban el constraint en cada llamada real
 *   contra Postgres. Confirmado con las tablas vacías (0 filas) — nadie logró
 *   escribir una indicación nunca. Los tests unitarios no lo veían porque
 *   Prisma está 100% mockeado y jamás toca un CHECK real.
 *
 *   Resuelto alineando la BD a este vocabulario en
 *   `packages/database/sql/202_ece_indicacion_vocabulario_estados.sql` (ahí
 *   está el porqué de la decisión y el efecto sobre 98/142/146/165).
 *   `__tests__/vocabulario-bd-drift.test.ts` compara estos enums contra el SQL
 *   de 202 para que un cambio futuro en cualquiera de los dos lados falle CI.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { PrismaClient } from "@his/database";
import { router, requireRole } from "../../trpc";
import { withEceContext } from "../../ece/rls-context";
import { materializeIndicacionFirmadaToFarmacia } from "../../ece/mar-consumer";
import { materializeCareTasksFromIndicacion } from "../../ece/care-task-consumer";
import { materializeOrdenesFromIndicacion } from "../../ece/order-consumer";
import { resolveEceEstablecimientoId } from "../../lib/ece-hooks";
import { emitDomainEvent } from "@his/database";
import { abacGuard } from "../../abac";
import {
  validateClinicalText,
  forbiddenAbbreviationsRefine,
} from "@his/contracts/clinical/forbidden-abbreviations";

// ─── Input schemas (inline — evita problemas de resolución en tests de worktree)
// La copia canónica para el cliente vive en @his/contracts/src/schemas/ece-indicaciones.ts

/**
 * Espejo de chk_ind_item_tipo (SQL 202 + 211). Ver __tests__/vocabulario-bd-drift.test.ts.
 * MOVIMIENTO/INTERCONSULTA — nuevos en 211 (categorías `mov`/`inter` del CPOE,
 * ESP-MOCKUP-0026, sin tipo equivalente hasta ahora). REPOSO ya existía en el
 * CHECK desde el DDL original pero no estaba expuesto aquí (delta documentado
 * en el test de drift); se expone ahora junto con el resto del cambio.
 */
export const tipoIndicacionEnum = z.enum([
  "MEDICAMENTO",
  "PROCEDIMIENTO",
  "DIETA",
  "CUIDADO_GENERAL",
  "ESTUDIO",
  "REPOSO",
  "MOVIMIENTO",
  "INTERCONSULTA",
]);

const viaAdminEnum = z.enum([
  "ORAL",
  "IV",
  "IM",
  "SC",
  "TOPICAL",
  "INHALED",
  "RECTAL",
  "SUBLINGUAL",
  "OPHTHALMIC",
  "OTIC",
  "NASAL",
]);

const frecuenciaEnum = z.enum([
  "QD",
  "BID",
  "TID",
  "QID",
  "Q4H",
  "Q6H",
  "Q8H",
  "Q12H",
  "Q24H",
  "STAT",
  "PRN",
]);

const vigenciaEnum = z.enum(["ACTIVA", "SUSPENDIDA", "CANCELADA"]);

/** ESP-MOCKUP-0026 §Estructura — plazo máximo entre indicaciones firmadas del mismo episodio. */
const PLAZO_MAXIMO_HORAS = 32;

/**
 * Subconjunto de chk_admin_med_estado_v2 (SQL 202). DIFERIDA es parte del CHECK
 * pero la expone `registro-enfermeria.router.ts`, no este router.
 */
export const estadoAdminEnum = z.enum([
  "PROGRAMADA",
  "ADMINISTRADO",
  "OMITIDA",
  "RECHAZADA",
]);

const indicacionItemSchema = z
  .object({
    tipo: tipoIndicacionEnum,
    descripcion: z.string().trim().min(1).max(500),
    dosis: z.string().trim().max(100).optional(),
    via: viaAdminEnum.optional(),
    frecuencia: frecuenciaEnum.optional(),
    duracion: z.string().trim().max(100).optional(),
    /**
     * CC-0026 Ola 2 (SQL 211) — FK a `public."Drug"` cuando tipo=MEDICAMENTO y
     * el médico seleccionó un producto del catálogo real (no el MED_DATA del
     * mockup). Opcional a propósito: no rompe callers viejos que solo mandan
     * descripcion en texto libre.
     */
    drugId: z.string().uuid().optional(),
    /**
     * CC-0026 Ola 2 (SQL 211) — payload estructurado por categoría que arma
     * cada modal del CPOE (ESP-MOCKUP-0026) además del texto de `descripcion`.
     * Sin schema fijo: cada categoría define sus propias claves.
     */
    detalle: z.record(z.string(), z.unknown()).optional(),
    /**
     * JCI IPSG.2-H2 (US-21-D2): si la descripción contiene abreviaciones
     * prohibidas de severity="error", este flag debe ser true para pasar
     * la validación. Requiere forbiddenAbbrReason para audit trail.
     */
    forbiddenAbbrAcknowledged: z.boolean().optional(),
    forbiddenAbbrReason: z.string().trim().min(10).max(500).optional(),
  })
  .superRefine(forbiddenAbbreviationsRefine("descripcion"))
  .superRefine((val, ctx) => {
    // Si se reconocen abreviaciones, la razón clínica es obligatoria.
    if (val.forbiddenAbbrAcknowledged === true && !val.forbiddenAbbrReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["forbiddenAbbrReason"],
        message:
          "forbiddenAbbrReason es obligatorio cuando forbiddenAbbrAcknowledged=true (razón clínica ≥10 chars).",
      });
    }
  });

const createSchema = z.object({
  episodioId: z.string().uuid(),
  // Si no viene del cliente, el server lo resuelve a ctx.user.id (el médico
  // autenticado). Esto evita exponer el UUID del médico en la UI y permite
  // que el form simplemente no pida ese campo en el caso 99% (el prescriptor
  // es el usuario logueado). Override solo necesario para uso administrativo
  // o registro retroactivo (digitado_retroactivamente=true).
  medicoPrescriptor: z.string().uuid().optional(),
  items: z.array(indicacionItemSchema).min(1).max(50),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  items: z.array(indicacionItemSchema).min(1).max(50),
});

const listSchema = z.object({
  episodioId: z.string().uuid(),
  vigencia: vigenciaEnum.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

const idSchema = z.object({ id: z.string().uuid() });

/**
 * CC-0026 — INICIAL (primera del episodio) | SUBSECUENTE (hay al menos una
 * firmada/validada previa). Espejo de `chk_ind_tipo_indicacion` (SQL 210).
 * Nombre distinto de `tipoIndicacionEnum` (arriba) a propósito — ese enum
 * describe el TIPO DE ÍTEM (medicamento/dieta/...), este describe el TIPO DE
 * FIRMA del encabezado; son conceptos distintos que comparten la palabra
 * "tipo" en el mockup.
 */
export const tipoFirmaIndicacionEnum = z.enum(["INICIAL", "SUBSECUENTE"]);

/**
 * `tipoIndicacion` es OPCIONAL y retrocompatible a propósito: si el caller no
 * lo envía, `firmar()` no valida el tipo (comportamiento bit-idéntico al de
 * antes de CC-0026) pero SÍ sigue calculando `plazoExcedido` — la regla de
 * 32h del mockup aplica siempre, la clasificación INICIAL/SUBSECUENTE es la
 * parte que la UI puede adoptar de forma incremental.
 */
const firmarSchema = idSchema.extend({
  tipoIndicacion: tipoFirmaIndicacionEnum.optional(),
});

const suspenderSchema = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(1).max(500),
});

const administracionSchema = z
  .object({
    indicacionItemId: z.string().uuid(),
    registroEnfId: z.string().uuid(),
    horaAplicada: z.coerce.date(),
    estado: estadoAdminEnum,
    motivoOmision: z.string().trim().min(10).max(1000).optional(),
    responsable: z.string().uuid(),
  })
  .superRefine((val, ctx) => {
    if (
      (val.estado === "OMITIDA" || val.estado === "RECHAZADA") &&
      !val.motivoOmision
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "motivo_omision es obligatorio cuando estado es OMITIDA o RECHAZADA (NTEC §3.6).",
        path: ["motivoOmision"],
      });
    }
  });

const listAdminSchema = z.object({
  indicacionItemId: z.string().uuid(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

// ─── Tipos de fila raw ────────────────────────────────────────────────────────

export interface IndicacionRow {
  id: string;
  instancia_id: string | null;
  episodio_id: string;
  fecha_hora: Date;
  version: number;
  vigencia: string;
  medico_prescriptor: string;
  transcripcion_enf: string | null;
  registrado_en: Date;
  estado_registro: string;
  digitado_retroactivamente: boolean;
  /** CC-0026 (SQL 210). NULL para indicaciones no firmadas o creadas antes del cambio. */
  tipo_indicacion: string | null;
  /** CC-0026 (SQL 210). Base del chip countdown de 32h en la UI — ver `firmar()`. */
  fecha_firma: Date | null;
}

export interface IndicacionItemRow {
  id: string;
  indicacion_id: string;
  tipo: string;
  descripcion: string;
  dosis: string | null;
  via: string | null;
  frecuencia: string | null;
  duracion: string | null;
  /** CC-0026 Ola 2 (SQL 211). */
  drug_id: string | null;
  /** CC-0026 Ola 2 (SQL 211). */
  detalle: Record<string, unknown> | null;
}

export interface AdminRow {
  id: string;
  registro_enf_id: string;
  indicacion_item_id: string;
  hora_programada: Date | null;
  hora_aplicada: Date | null;
  estado: string;
  motivo_omision: string | null;
  responsable: string;
}

// ─── Helper: leer encabezado + verificar existencia ──────────────────────────

async function getIndicacionOrThrow(
  tx: PrismaClient,
  id: string,
): Promise<IndicacionRow> {
  const rows = await tx.$queryRaw<IndicacionRow[]>`
    SELECT
      id::text, instancia_id::text, episodio_id::text,
      fecha_hora, version, vigencia,
      medico_prescriptor::text, transcripcion_enf::text,
      registrado_en, estado_registro, digitado_retroactivamente,
      tipo_indicacion, fecha_firma
    FROM ece.indicaciones_medicas
    WHERE id = ${id}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Indicación médica no encontrada: ${id}`,
    });
  }
  return row;
}

// ─── Helper: regla de 32h + tipo INICIAL/SUBSECUENTE (CC-0026, SQL 210) ──────

interface UltimaFirmaResult {
  /** true si el episodio ya tiene alguna indicación estado_registro IN (firmado, validado). */
  hasPrevious: boolean;
  /** Horas transcurridas desde la última `fecha_firma` registrada, o null si no hay dato. */
  horasDesdeUltimaFirma: number | null;
}

/**
 * Lee la última indicación firmada/validada del episodio. `hasPrevious` se
 * calcula por `estado_registro` (no por `fecha_firma`) porque en teoría una
 * fila podría estar firmada sin `fecha_firma` (columna nueva, SQL 210,
 * nullable) — separar ambos evita que un dato viejo sin timestamp haga creer
 * al server que la indicación es INICIAL cuando no lo es. `horasDesdeUltimaFirma`
 * sale null si esa fila no tiene `fecha_firma` (no se puede calcular el
 * plazo, pero el tipo INICIAL/SUBSECUENTE sigue siendo correcto).
 */
async function getUltimaFirma(
  tx: PrismaClient,
  episodioId: string,
): Promise<UltimaFirmaResult> {
  const rows = await tx.$queryRaw<{ fecha_firma: Date | null }[]>`
    SELECT fecha_firma
    FROM ece.indicaciones_medicas
    WHERE episodio_id = ${episodioId}::uuid
      AND estado_registro IN ('firmado', 'validado')
    ORDER BY fecha_firma DESC NULLS LAST
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return { hasPrevious: false, horasDesdeUltimaFirma: null };
  }
  if (!row.fecha_firma) {
    return { hasPrevious: true, horasDesdeUltimaFirma: null };
  }
  const horas = (Date.now() - new Date(row.fecha_firma).getTime()) / (1000 * 60 * 60);
  return { hasPrevious: true, horasDesdeUltimaFirma: horas };
}

// ─── Helper: armar contexto ECE desde ctx tRPC ───────────────────────────────

/**
 * Resuelve el establecimiento al espacio `ece.establecimiento` (no
 * `public."Establishment"` — son PKs distintas, ver `resolveEceEstablecimientoId`
 * en lib/ece-hooks.ts). Las policies RLS de `indicaciones_medicas`,
 * `indicacion_item` e `indicacion_farmacia_pendiente` comparan todas contra el
 * espacio `ece` (vía episodio → `ece.episodio_atencion.establecimiento_id`),
 * así que pasar `ctx.tenant.establishmentId` (espacio public) directo a
 * `withEceContext` hace que la policy nunca matchee — mismo patrón de guard
 * que gs1-patient-trace.router.ts / gs1-gln-hierarchy.router.ts.
 */
async function eceIds(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string };
  prisma: PrismaClient;
}): Promise<{ personalId: string; establecimientoId: string }> {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar indicaciones ECE.",
    });
  }
  const establecimientoId = await resolveEceEstablecimientoId(
    ctx.prisma,
    ctx.tenant.establishmentId,
  );
  if (!establecimientoId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ECE no inicializado para este establecimiento.",
    });
  }
  return {
    personalId: ctx.user.id,
    establecimientoId,
  };
}

// ─── Procedures base ─────────────────────────────────────────────────────────

const physicianProcedure = requireRole(["PHYSICIAN", "MC"]);
const nurseProcedure = requireRole(["NURSE", "ENF"]);
const clinicalProcedure = requireRole(["PHYSICIAN", "MC", "NURSE", "ENF"]);

// ─── Router ───────────────────────────────────────────────────────────────────

export const indicacionesMedicasRouter = router({
  /**
   * Lista indicaciones de un episodio. Agrupa por vigencia (ACTIVA/SUSPENDIDA/CANCELADA).
   */
  list: clinicalProcedure.input(listSchema).query(async ({ ctx, input }) => {
    const { personalId, establecimientoId } = await eceIds(ctx);

    return withEceContext(
      ctx.prisma,
      personalId,
      establecimientoId,
      async (tx) => {
        // vigencia null = sin filtro; string = filtrar por ese valor
        const vigenciaFilter = input.vigencia ?? null;
        const cursorFilter = input.cursor ?? null;

        const rows = await tx.$queryRaw<IndicacionRow[]>`
          SELECT
            id::text, instancia_id::text, episodio_id::text,
            fecha_hora, version, vigencia,
            medico_prescriptor::text, transcripcion_enf::text,
            registrado_en, estado_registro, digitado_retroactivamente,
            tipo_indicacion, fecha_firma
          FROM ece.indicaciones_medicas
          WHERE episodio_id = ${input.episodioId}::uuid
            AND (${vigenciaFilter}::text IS NULL OR vigencia = ${vigenciaFilter})
            AND (${cursorFilter}::uuid IS NULL OR id > ${cursorFilter}::uuid)
          ORDER BY registrado_en DESC, id ASC
          LIMIT ${input.limit + 1}
        `;

        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1]!.id : null;

        return { items, nextCursor };
      },
    );
  }),

  /**
   * Detalle de indicación: encabezado + items.
   */
  get: clinicalProcedure.input(idSchema).query(async ({ ctx, input }) => {
    const { personalId, establecimientoId } = await eceIds(ctx);

    return withEceContext(
      ctx.prisma,
      personalId,
      establecimientoId,
      async (tx) => {
        const indicacion = await getIndicacionOrThrow(tx, input.id);

        const items = await tx.$queryRaw<IndicacionItemRow[]>`
          SELECT
            id::text, indicacion_id::text,
            tipo, descripcion, dosis, via, frecuencia, duracion,
            drug_id::text AS drug_id, detalle
          FROM ece.indicacion_item
          WHERE indicacion_id = ${input.id}::uuid
          ORDER BY id ASC
        `;

        return { ...indicacion, items };
      },
    );
  }),

  /**
   * Crea encabezado + ítems en una transacción.
   * Estado inicial: borrador, vigencia: ACTIVA, version: 1.
   * Solo PHYSICIAN.
   */
  create: physicianProcedure
    .input(createSchema)
    // CC-0017 F2 — prueba de concepto abacGuard: DENY explícito en AbacRule
    // bloquea aunque el rol pase requireRole. Sin regla configurada (seed
    // MVP replica el comportamiento actual) → ALLOW, no rompe nada existente.
    .use(abacGuard("prescription", "prescribe"))
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = await eceIds(ctx);

      // Resolver médico prescriptor: si no vino del cliente, usar el usuario
      // autenticado (caso 99%). Override server-side blanqueado para evitar
      // suplantación arbitraria — sólo lo aceptamos si vino explícito.
      const medicoPrescriptor = input.medicoPrescriptor ?? personalId;

      return withEceContext(
        ctx.prisma,
        personalId,
        establecimientoId,
        async (tx) => {
          // Insertar encabezado
          const headRows = await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO ece.indicaciones_medicas
              (episodio_id, medico_prescriptor, version, vigencia, estado_registro,
               digitado_retroactivamente, registrado_en, fecha_hora)
            VALUES (
              ${input.episodioId}::uuid,
              ${medicoPrescriptor}::uuid,
              1,
              'ACTIVA',
              'borrador',
              false,
              now(),
              now()
            )
            RETURNING id::text
          `;
          const indicacionId = headRows[0]!.id;

          // Insertar ítems
          for (const item of input.items) {
            await tx.$executeRaw`
              INSERT INTO ece.indicacion_item
                (indicacion_id, tipo, descripcion, dosis, via, frecuencia, duracion,
                 drug_id, detalle)
              VALUES (
                ${indicacionId}::uuid,
                ${item.tipo},
                ${item.descripcion},
                ${item.dosis ?? null},
                ${item.via ?? null},
                ${item.frecuencia ?? null},
                ${item.duracion ?? null},
                ${item.drugId ?? null}::uuid,
                ${item.detalle ? JSON.stringify(item.detalle) : null}::jsonb
              )
            `;

            // JCI IPSG.2-H2: si el médico reconoció abreviaciones prohibidas,
            // registrar el acknowledgement en el audit log para trazabilidad JCI.
            if (item.forbiddenAbbrAcknowledged === true && item.forbiddenAbbrReason) {
              await emitDomainEvent(tx, {
                organizationId: ctx.tenant.organizationId,
                eventType: "jci.ipsg2.abbr_acknowledged",
                aggregateType: "IndicacionMedica",
                aggregateId: indicacionId,
                emittedById: ctx.user.id,
                payload: {
                  descripcion: item.descripcion,
                  reason: item.forbiddenAbbrReason,
                  medicoId: medicoPrescriptor,
                },
              });
            }
          }

          return { id: indicacionId, estadoRegistro: "borrador" as const, vigencia: "ACTIVA" as const };
        },
      );
    }),

  /**
   * Actualiza ítems de una indicación en borrador.
   * Incrementa version (optimistic lock).
   * Solo PHYSICIAN.
   */
  update: physicianProcedure
    .input(updateSchema)
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = await eceIds(ctx);

      return withEceContext(
        ctx.prisma,
        personalId,
        establecimientoId,
        async (tx) => {
          const indicacion = await getIndicacionOrThrow(tx, input.id);

          if (indicacion.estado_registro !== "borrador") {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Solo se pueden editar indicaciones en estado 'borrador'. Estado actual: '${indicacion.estado_registro}'.`,
            });
          }

          // Eliminar items existentes y reinsertar (replace strategy)
          await tx.$executeRaw`
            DELETE FROM ece.indicacion_item
            WHERE indicacion_id = ${input.id}::uuid
          `;

          for (const item of input.items) {
            await tx.$executeRaw`
              INSERT INTO ece.indicacion_item
                (indicacion_id, tipo, descripcion, dosis, via, frecuencia, duracion,
                 drug_id, detalle)
              VALUES (
                ${input.id}::uuid,
                ${item.tipo},
                ${item.descripcion},
                ${item.dosis ?? null},
                ${item.via ?? null},
                ${item.frecuencia ?? null},
                ${item.duracion ?? null},
                ${item.drugId ?? null}::uuid,
                ${item.detalle ? JSON.stringify(item.detalle) : null}::jsonb
              )
            `;

            if (item.forbiddenAbbrAcknowledged === true && item.forbiddenAbbrReason) {
              await emitDomainEvent(tx, {
                organizationId: ctx.tenant.organizationId,
                eventType: "jci.ipsg2.abbr_acknowledged",
                aggregateType: "IndicacionMedica",
                aggregateId: input.id,
                emittedById: ctx.user.id,
                payload: {
                  descripcion: item.descripcion,
                  reason: item.forbiddenAbbrReason,
                  medicoId: personalId,
                },
              });
            }
          }

          // Incrementar version para optimistic lock
          await tx.$executeRaw`
            UPDATE ece.indicaciones_medicas
            SET version = ${indicacion.version + 1}
            WHERE id = ${input.id}::uuid
          `;

          return { id: input.id, version: indicacion.version + 1 };
        },
      );
    }),

  /**
   * MC firma la indicación: borrador → firmado.
   * Emite evento 'ece.indicaciones.firmadas' en outbox transaccional.
   * Solo PHYSICIAN.
   */
  firmar: physicianProcedure
    .input(firmarSchema)
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = await eceIds(ctx);

      return withEceContext(
        ctx.prisma,
        personalId,
        establecimientoId,
        async (tx) => {
          const indicacion = await getIndicacionOrThrow(tx, input.id);

          if (indicacion.estado_registro !== "borrador") {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Solo se pueden firmar indicaciones en estado 'borrador'. Estado actual: '${indicacion.estado_registro}'.`,
            });
          }

          if (indicacion.vigencia !== "ACTIVA") {
            throw new TRPCError({
              code: "CONFLICT",
              message: `No se puede firmar una indicación con vigencia '${indicacion.vigencia}'.`,
            });
          }

          // CC-0026 (SQL 210) — tipo INICIAL/SUBSECUENTE + regla de 32h.
          // `tipoIndicacion` es opcional: si el caller no lo envía, no se
          // valida el tipo (retrocompatible), pero `plazoExcedido` SIEMPRE
          // se calcula — la regla de 32h del mockup no depende de que la UI
          // ya declare el tipo.
          const { hasPrevious, horasDesdeUltimaFirma } = await getUltimaFirma(
            tx,
            indicacion.episodio_id,
          );

          if (input.tipoIndicacion === "INICIAL" && hasPrevious) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "El episodio ya tiene una indicación firmada — no se puede firmar " +
                "otra como INICIAL. Use tipoIndicacion='SUBSECUENTE'.",
            });
          }
          if (input.tipoIndicacion === "SUBSECUENTE" && !hasPrevious) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "El episodio no tiene ninguna indicación firmada todavía — la " +
                "primera debe firmarse como tipoIndicacion='INICIAL'.",
            });
          }

          const plazoExcedido =
            horasDesdeUltimaFirma !== null && horasDesdeUltimaFirma > PLAZO_MAXIMO_HORAS;

          // JCI IPSG.2 ME 3 — escanear texto libre de items (warning, no bloquea)
          // ece.indicacion_item no tiene columna 'notas'; solo descripcion es texto libre.
          // Se piden id+tipo+detalle en la misma query porque CC-0026 los reusa
          // para materializar CareTask/LabOrder/ImagingRequest por ítem (ver
          // más abajo) — `detalle` es el payload estructurado del CPOE
          // (ESP-MOCKUP-0026) que discrimina lab/gabinete de los demás tipos.
          const items = await tx.$queryRaw<
            { id: string; tipo: string; descripcion: string; detalle: Record<string, unknown> | null }[]
          >`
            SELECT id::text, tipo, descripcion, detalle
            FROM ece.indicacion_item
            WHERE indicacion_id = ${input.id}::uuid
          `;
          const textoItems = items.map((r) => r.descripcion).join(" ");
          const ipsg2 = validateClinicalText(textoItems);
          if (ipsg2.errors.length > 0 || ipsg2.warnings.length > 0) {
            console.warn(
              `[IPSG.2 ME 3] indicaciones_medicas ${input.id}: ` +
                `${ipsg2.errors.length} error(es) JCI, ${ipsg2.warnings.length} warning(s)`,
            );
          }

          await tx.$executeRaw`
            UPDATE ece.indicaciones_medicas
            SET estado_registro = 'firmado',
                transcripcion_enf = null,
                fecha_firma = now(),
                tipo_indicacion = ${input.tipoIndicacion ?? null}
            WHERE id = ${input.id}::uuid
          `;

          const itemCount = items.length;

          const domainEvent = await emitDomainEvent(tx, {
            organizationId: ctx.tenant.organizationId,
            eventType: "ece.indicaciones.firmadas",
            aggregateType: "IndicacionMedica",
            aggregateId: input.id,
            emittedById: ctx.user.id,
            payload: {
              indicacionId: input.id,
              episodioId: indicacion.episodio_id,
              medicoId: personalId,
              itemCount,
              organizationId: ctx.tenant.organizationId,
            },
          });

          // R04 — materializa los ítems tipo=medicamento a la cola de
          // conciliación farmacia/eMAR (ece.indicacion_farmacia_pendiente).
          // Corre en la MISMA transacción que la firma: si falla, la firma
          // completa revierte (ver contrato de fallo en mar-consumer.ts) —
          // nunca queda una indicación "firmada" sin que farmacia se entere.
          try {
            await materializeIndicacionFirmadaToFarmacia(tx, {
              indicacionId: input.id,
              episodioId: indicacion.episodio_id,
              medicoPrescriptorId: indicacion.medico_prescriptor,
              domainEventId: domainEvent.id,
            });
          } catch (err) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message:
                "No se pudo firmar la indicación: falló la materialización a " +
                "farmacia/eMAR. La firma no se aplicó — reintente; si persiste, " +
                "contacte soporte.",
              cause: err,
            });
          }

          // CC-0026 D2 — una CareTask NURSE por ítem, en la MISMA transacción
          // que la firma. Mismo contrato de fallo que farmacia (arriba): si
          // falla, la firma completa revierte — nunca queda "firmada" sin
          // que enfermería tenga la tarea de seguimiento.
          let careTaskResult: { tasksCreated: number };
          try {
            careTaskResult = await materializeCareTasksFromIndicacion(tx, {
              indicacionId: input.id,
              episodioId: indicacion.episodio_id,
              eceEstablecimientoId: establecimientoId,
              establishmentId: ctx.tenant.establishmentId!,
              userId: ctx.user.id,
              items,
            });
          } catch (err) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message:
                "No se pudo firmar la indicación: falló la creación de tareas " +
                "de seguimiento para enfermería. La firma no se aplicó — " +
                "reintente; si persiste, contacte soporte.",
              cause: err,
            });
          }

          // CC-0026 D2 (corrección Edwin 2026-08-26) — ítems ESTUDIO de
          // laboratorio/gabinete generan la orden REAL (LabOrder/ImagingRequest+
          // ImagingOrder) + CareTask del área ejecutora, en la MISMA transacción.
          // Mismo contrato de fallo que farmacia/enfermería arriba: si falla,
          // la firma completa revierte.
          let ordenesResult: {
            labOrdersCreated: number;
            imagingRequestsCreated: number;
            ordenesOmitidas: { descripcion: string; motivo: string }[];
          };
          try {
            ordenesResult = await materializeOrdenesFromIndicacion(tx, {
              episodioId: indicacion.episodio_id,
              establishmentId: ctx.tenant.establishmentId!,
              userId: ctx.user.id,
              items,
            });
          } catch (err) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message:
                "No se pudo firmar la indicación: falló la creación de la orden " +
                "real de laboratorio/imágenes. La firma no se aplicó — reintente; " +
                "si persiste, contacte soporte.",
              cause: err,
            });
          }

          return {
            id: input.id,
            estadoRegistro: "firmado" as const,
            ipsg2Warnings: [...ipsg2.errors, ...ipsg2.warnings],
            plazoExcedido,
            horasDesdeUltimaFirma,
            // CC-0026 Ola 2 — la UI lo muestra en el toast de confirmación.
            tasksCreated: careTaskResult.tasksCreated,
            // CC-0026 D2 (corrección Edwin 2026-08-26) — lab/gabinete generan
            // orden real en vez de tarea de enfermería.
            labOrdersCreated: ordenesResult.labOrdersCreated,
            imagingRequestsCreated: ordenesResult.imagingRequestsCreated,
            ordenesOmitidas: ordenesResult.ordenesOmitidas,
          };
        },
        // CC-0026 — escritura cross-espacio: LabOrder/ImagingRequest/ImagingOrder
        // viven en `public.*` con RLS de tenant clásico (app.current_org_id),
        // ausente bajo `withEceContext` por defecto. Ver docstring de
        // `EceContextOptions.tenantContext` en rls-context.ts.
        { tenantContext: { userId: ctx.user.id, orgId: ctx.tenant.organizationId } },
      );
    }),

  /**
   * Suspende una indicación activa.
   * vigencia ACTIVA → SUSPENDIDA. Solo NURSE | PHYSICIAN.
   */
  suspender: clinicalProcedure
    .input(suspenderSchema)
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = await eceIds(ctx);

      return withEceContext(
        ctx.prisma,
        personalId,
        establecimientoId,
        async (tx) => {
          const indicacion = await getIndicacionOrThrow(tx, input.id);

          if (indicacion.vigencia !== "ACTIVA") {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Solo se pueden suspender indicaciones ACTIVAS. Vigencia actual: '${indicacion.vigencia}'.`,
            });
          }

          await tx.$executeRaw`
            UPDATE ece.indicaciones_medicas
            SET vigencia = 'SUSPENDIDA'
            WHERE id = ${input.id}::uuid
          `;

          return { id: input.id, vigencia: "SUSPENDIDA" as const, motivo: input.motivo };
        },
      );
    }),

  /**
   * Cancela una indicación. vigencia ACTIVA → CANCELADA. Solo PHYSICIAN.
   */
  cancelar: physicianProcedure
    .input(suspenderSchema)
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = await eceIds(ctx);

      return withEceContext(
        ctx.prisma,
        personalId,
        establecimientoId,
        async (tx) => {
          const indicacion = await getIndicacionOrThrow(tx, input.id);

          if (indicacion.vigencia !== "ACTIVA") {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Solo se pueden cancelar indicaciones ACTIVAS. Vigencia actual: '${indicacion.vigencia}'.`,
            });
          }

          await tx.$executeRaw`
            UPDATE ece.indicaciones_medicas
            SET vigencia = 'CANCELADA'
            WHERE id = ${input.id}::uuid
          `;

          return { id: input.id, vigencia: "CANCELADA" as const, motivo: input.motivo };
        },
      );
    }),

  /**
   * NURSE registra administración de un item (eMAR).
   * Si estado=OMITIDA|RECHAZADA, motivoOmision es obligatorio (validado en Zod).
   * Solo NURSE.
   */
  registrarAdministracion: nurseProcedure
    .input(administracionSchema)
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = await eceIds(ctx);

      return withEceContext(
        ctx.prisma,
        personalId,
        establecimientoId,
        async (tx) => {
          const adminRows = await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO ece.administracion_medicamento
              (registro_enf_id, indicacion_item_id, hora_programada,
               hora_aplicada, estado, motivo_omision, responsable)
            VALUES (
              ${input.registroEnfId}::uuid,
              ${input.indicacionItemId}::uuid,
              null,
              ${input.horaAplicada.toISOString()},
              ${input.estado},
              ${input.motivoOmision ?? null},
              ${input.responsable}::uuid
            )
            RETURNING id::text
          `;

          return { id: adminRows[0]!.id, estado: input.estado };
        },
      );
    }),

  /**
   * Lista historial de administraciones de un item. NURSE | PHYSICIAN.
   */
  listAdministraciones: clinicalProcedure
    .input(listAdminSchema)
    .query(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = await eceIds(ctx);

      return withEceContext(
        ctx.prisma,
        personalId,
        establecimientoId,
        async (tx) => {
          const rows = await tx.$queryRaw<AdminRow[]>`
            SELECT
              id::text, registro_enf_id::text, indicacion_item_id::text,
              hora_programada, hora_aplicada, estado, motivo_omision,
              responsable::text
            FROM ece.administracion_medicamento
            WHERE indicacion_item_id = ${input.indicacionItemId}::uuid
              AND (${input.fromDate ?? null}::timestamptz IS NULL
                   OR hora_aplicada >= ${input.fromDate ?? null}::timestamptz)
              AND (${input.toDate ?? null}::timestamptz IS NULL
                   OR hora_aplicada <= ${input.toDate ?? null}::timestamptz)
            ORDER BY hora_aplicada DESC NULLS LAST
          `;

          return rows;
        },
      );
    }),

  /**
   * CC-0026 Ola 2 — nombre del establecimiento activo de la sesión, para que
   * la categoría "Movimiento de paciente" del CPOE resuelva la sede (HE
   * Masferrer / CM Beethoven / SAT Surf City) sin pedirla en el formulario
   * ("se sobreentiende desde admisión", ESP-MOCKUP-0026 §mov). Lectura directa
   * — `public."Establishment"` no está bajo `withEceContext`/`withTenantContext`
   * aquí a propósito: el id ya viene resuelto server-side desde la cookie de
   * sesión (`ctx.tenant.establishmentId`), no de un input del cliente, así
   * que no hay riesgo de fuga cross-tenant por saltarse RLS para este único
   * SELECT de solo nombre.
   */
  contextoSede: clinicalProcedure.query(async ({ ctx }) => {
    if (!ctx.tenant.establishmentId) {
      return { establishmentId: null, establishmentName: null };
    }
    const establishment = await ctx.prisma.establishment.findUnique({
      where: { id: ctx.tenant.establishmentId },
      select: { id: true, name: true },
    });
    return {
      establishmentId: establishment?.id ?? null,
      establishmentName: establishment?.name ?? null,
    };
  }),
});
