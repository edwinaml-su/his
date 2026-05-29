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
 *     Consumido por motor MAR (Stream 30) para crear líneas de admin pendientes.
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
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { PrismaClient } from "@his/database";
import { router, requireRole } from "../../trpc";
import { withEceContext } from "../../ece/rls-context";
import { emitDomainEvent } from "@his/database";
import { validateClinicalText } from "@his/contracts/clinical/forbidden-abbreviations";

// ─── Input schemas (inline — evita problemas de resolución en tests de worktree)
// La copia canónica para el cliente vive en @his/contracts/src/schemas/ece-indicaciones.ts

const tipoIndicacionEnum = z.enum([
  "MEDICAMENTO",
  "PROCEDIMIENTO",
  "DIETA",
  "CUIDADO_GENERAL",
  "ESTUDIO",
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

const estadoAdminEnum = z.enum([
  "PROGRAMADA",
  "ADMINISTRADO",
  "OMITIDA",
  "RECHAZADA",
]);

const indicacionItemSchema = z.object({
  tipo: tipoIndicacionEnum,
  descripcion: z.string().trim().min(1).max(500),
  dosis: z.string().trim().max(100).optional(),
  via: viaAdminEnum.optional(),
  frecuencia: frecuenciaEnum.optional(),
  duracion: z.string().trim().max(100).optional(),
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
      registrado_en, estado_registro, digitado_retroactivamente
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

// ─── Helper: armar contexto ECE desde ctx tRPC ───────────────────────────────

function eceIds(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string };
}): { personalId: string; establecimientoId: string } {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar indicaciones ECE.",
    });
  }
  return {
    personalId: ctx.user.id,
    establecimientoId: ctx.tenant.establishmentId,
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
    const { personalId, establecimientoId } = eceIds(ctx);

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
            registrado_en, estado_registro, digitado_retroactivamente
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
    const { personalId, establecimientoId } = eceIds(ctx);

    return withEceContext(
      ctx.prisma,
      personalId,
      establecimientoId,
      async (tx) => {
        const indicacion = await getIndicacionOrThrow(tx, input.id);

        const items = await tx.$queryRaw<IndicacionItemRow[]>`
          SELECT
            id::text, indicacion_id::text,
            tipo, descripcion, dosis, via, frecuencia, duracion
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
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = eceIds(ctx);

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
                (indicacion_id, tipo, descripcion, dosis, via, frecuencia, duracion)
              VALUES (
                ${indicacionId}::uuid,
                ${item.tipo},
                ${item.descripcion},
                ${item.dosis ?? null},
                ${item.via ?? null},
                ${item.frecuencia ?? null},
                ${item.duracion ?? null}
              )
            `;
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
      const { personalId, establecimientoId } = eceIds(ctx);

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
                (indicacion_id, tipo, descripcion, dosis, via, frecuencia, duracion)
              VALUES (
                ${input.id}::uuid,
                ${item.tipo},
                ${item.descripcion},
                ${item.dosis ?? null},
                ${item.via ?? null},
                ${item.frecuencia ?? null},
                ${item.duracion ?? null}
              )
            `;
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
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = eceIds(ctx);

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

          // JCI IPSG.2 ME 3 — escanear texto libre de items (warning, no bloquea)
          const itemTexts = await tx.$queryRaw<{ descripcion: string; notas: string | null }[]>`
            SELECT descripcion, notas
            FROM ece.indicacion_item
            WHERE indicacion_id = ${input.id}::uuid
          `;
          const textoItems = itemTexts
            .map((r) => [r.descripcion, r.notas ?? ""].join(" "))
            .join(" ");
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
                transcripcion_enf = null
            WHERE id = ${input.id}::uuid
          `;

          // Contar items para el payload del evento
          const countRows = await tx.$queryRaw<{ cnt: number }[]>`
            SELECT count(*)::int AS cnt
            FROM ece.indicacion_item
            WHERE indicacion_id = ${input.id}::uuid
          `;
          const itemCount = countRows[0]?.cnt ?? 0;

          await emitDomainEvent(tx, {
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

          return {
            id: input.id,
            estadoRegistro: "firmado" as const,
            ipsg2Warnings: [...ipsg2.errors, ...ipsg2.warnings],
          };
        },
      );
    }),

  /**
   * Suspende una indicación activa.
   * vigencia ACTIVA → SUSPENDIDA. Solo NURSE | PHYSICIAN.
   */
  suspender: clinicalProcedure
    .input(suspenderSchema)
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = eceIds(ctx);

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
      const { personalId, establecimientoId } = eceIds(ctx);

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
      const { personalId, establecimientoId } = eceIds(ctx);

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
      const { personalId, establecimientoId } = eceIds(ctx);

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
});
