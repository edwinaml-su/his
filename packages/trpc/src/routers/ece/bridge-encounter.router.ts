/**
 * Bridge ECE↔HIS Encounter — Fase 2, Stream 22b.
 *
 * Operaciones:
 *   bridge.linkEncounter              — vincula episodio ECE existente a Encounter HIS.
 *   bridge.unlinkEncounter            — elimina el vínculo (SET NULL en public_encounter_id).
 *   bridge.createEpisodioFromEncounter — crea ece.episodio_atencion desde un Encounter HIS.
 *   bridge.listEncountersWithoutEpisodio — Encounters HIS sin episodio ECE (paginado).
 *
 * Invariantes:
 *   - Toda escritura ECE usa raw SQL ($queryRaw / $executeRaw) porque ece.*
 *     no está en schema.prisma (schema ECE separado, Opción B).
 *   - Toda lectura de public.Encounter usa Prisma para aprovechar tipos y RLS proxy.
 *   - createEpisodioFromEncounter resuelve ece.paciente vía public_patient_id = patientId.
 *     Si no existe fila ece.paciente para el paciente, lanza PRECONDITION_FAILED —
 *     el bridge de paciente (stream 22) debe correr primero.
 *   - El outbox (DomainEvent + AuditLog) se emite dentro de la misma transacción
 *     Prisma; si hay rollback, el evento NO existe (atomicidad garantizada).
 *   - requireRole(["PHYSICIAN","NURSE","ADM"]) aplica a todas las mutations.
 *     listEncountersWithoutEpisodio sólo requiere tenantProcedure (lectura).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { emitDomainEvent } from "@his/database";
import { router, requireRole, tenantProcedure } from "../../trpc";

// =============================================================================
// Schemas Zod (inlined para evitar dependencia del barrel @his/contracts/schemas
// en runtime de tests; los tipos canónicos viven en packages/contracts).
// =============================================================================

const linkEncounterSchema = z.object({
  encounterId: z.string().uuid(),
  episodioId: z.string().uuid(),
});

const unlinkEncounterSchema = z.object({
  episodioId: z.string().uuid(),
});

const createEpisodioFromEncounterSchema = z.object({
  encounterId: z.string().uuid(),
  modalidad: z.enum(["ambulatorio", "hospitalario"]),
  servicio_categoria: z.enum([
    "consulta_externa",
    "emergencia",
    "hospitalizacion",
    "hospital_de_dia",
  ]),
  establecimientoEceId: z.string().uuid(),
  origen_consulta: z
    .enum(["espontanea", "cita_previa", "referencia"])
    .optional(),
  motivo: z.string().max(500).optional(),
});

const listEncountersWithoutEpisodioSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

// =============================================================================
// Tipos raw SQL
// =============================================================================

type EpisodioRow = {
  id: string;
  public_encounter_id: string | null;
  paciente_id: string;
  establecimiento_id: string;
  estado: string;
};

type PacienteEceRow = {
  id: string;
  establecimiento_id: string;
};

// =============================================================================
// Helpers raw SQL
// =============================================================================

async function findEpisodio(
  prisma: {
    $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  },
  episodioId: string,
): Promise<EpisodioRow | null> {
  const rows = await (prisma.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<EpisodioRow[]>)`
    SELECT id, public_encounter_id, paciente_id, establecimiento_id, estado
    FROM ece.episodio_atencion
    WHERE id = ${episodioId}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findPacienteEcePorPublicPatient(
  prisma: {
    $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  },
  publicPatientId: string,
): Promise<PacienteEceRow | null> {
  const rows = await (prisma.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<PacienteEceRow[]>)`
    SELECT id, establecimiento_id
    FROM ece.paciente
    WHERE public_patient_id = ${publicPatientId}::uuid
      AND estado_expediente = 'activo'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// =============================================================================
// Router
// =============================================================================

export const bridgeEncounterRouter = router({
  /**
   * Vincula un episodio ECE existente a un Encounter HIS.
   * Falla con CONFLICT si el episodio ya tiene vínculo.
   * Falla con NOT_FOUND si el Encounter no pertenece al tenant.
   */
  linkEncounter: requireRole(["PHYSICIAN", "NURSE", "ADM"])
    .input(linkEncounterSchema)
    .mutation(async ({ ctx, input }) => {
      // 1. Verificar que el Encounter pertenece al tenant.
      const encounter = await ctx.prisma.encounter.findFirst({
        where: {
          id: input.encounterId,
          organizationId: ctx.tenant.organizationId,
        },
        select: { id: true, patientId: true, admittedAt: true, organizationId: true },
      });
      if (!encounter) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Encounter no encontrado en esta organización.",
        });
      }

      // 2. Verificar que el episodio ECE existe y no tiene ya un vínculo.
      const episodio = await findEpisodio(ctx.prisma, input.episodioId);
      if (!episodio) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Episodio ECE no encontrado.",
        });
      }
      if (episodio.public_encounter_id !== null) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `El episodio ya está vinculado al Encounter ${episodio.public_encounter_id}.`,
        });
      }

      // 3. Actualizar + emitir evento en transacción atómica.
      return ctx.prisma.$transaction(async (tx) => {
        await (tx.$executeRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<number>)`
          UPDATE ece.episodio_atencion
          SET public_encounter_id = ${input.encounterId}::uuid,
              actualizado_en      = now()
          WHERE id = ${input.episodioId}::uuid
        `;

        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.episodio.linkedToEncounter",
          aggregateType: "EpisodioAtencion",
          aggregateId: input.episodioId,
          emittedById: ctx.user.id,
          payload: {
            episodioId: input.episodioId,
            encounterId: input.encounterId,
            patientId: encounter.patientId,
            organizationId: ctx.tenant.organizationId,
            linkedById: ctx.user.id,
          },
        });

        return { episodioId: input.episodioId, encounterId: input.encounterId };
      });
    }),

  /**
   * Elimina el vínculo entre un episodio ECE y su Encounter HIS (SET NULL).
   * No borra ninguna fila — permite re-vincular posteriormente.
   */
  unlinkEncounter: requireRole(["PHYSICIAN", "NURSE", "ADM"])
    .input(unlinkEncounterSchema)
    .mutation(async ({ ctx, input }) => {
      const episodio = await findEpisodio(ctx.prisma, input.episodioId);
      if (!episodio) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Episodio ECE no encontrado.",
        });
      }
      if (episodio.public_encounter_id === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El episodio no tiene ningún Encounter vinculado.",
        });
      }

      await (ctx.prisma.$executeRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<number>)`
        UPDATE ece.episodio_atencion
        SET public_encounter_id = NULL,
            actualizado_en      = now()
        WHERE id = ${input.episodioId}::uuid
      `;

      return { episodioId: input.episodioId, unlinkedEncounterId: episodio.public_encounter_id };
    }),

  /**
   * Crea un episodio ECE a partir de un Encounter HIS y lo vincula.
   *
   * Prerequisitos:
   *   - El Encounter debe existir en el tenant.
   *   - El paciente del Encounter debe tener ya un ece.paciente via bridge #22
   *     (public_patient_id = encounter.patientId).
   *   - El Encounter NO debe tener ya un episodio vinculado.
   */
  createEpisodioFromEncounter: requireRole(["PHYSICIAN", "NURSE", "ADM"])
    .input(createEpisodioFromEncounterSchema)
    .mutation(async ({ ctx, input }) => {
      // 1. Encounter válido en tenant.
      const encounter = await ctx.prisma.encounter.findFirst({
        where: {
          id: input.encounterId,
          organizationId: ctx.tenant.organizationId,
        },
        select: {
          id: true,
          patientId: true,
          admittedAt: true,
          organizationId: true,
        },
      });
      if (!encounter) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Encounter no encontrado en esta organización.",
        });
      }

      // 2. Verificar que el Encounter no tenga ya un episodio vinculado.
      const existing = await (ctx.prisma.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        SELECT id FROM ece.episodio_atencion
        WHERE public_encounter_id = ${input.encounterId}::uuid
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `El Encounter ya tiene el episodio ECE ${existing[0]!.id} vinculado.`,
        });
      }

      // 3. Resolver ece.paciente via bridge de paciente (stream 22).
      const pacienteEce = await findPacienteEcePorPublicPatient(
        ctx.prisma,
        encounter.patientId,
      );
      if (!pacienteEce) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No existe registro ece.paciente para este paciente. " +
            "Ejecuta el bridge de paciente (stream 22) antes de crear el episodio.",
        });
      }

      // 4. Crear episodio + vincular + emitir evento — todo atómico.
      return ctx.prisma.$transaction(async (tx) => {
        const rows = await (tx.$queryRaw as (
          q: TemplateStringsArray,
          ...v: unknown[]
        ) => Promise<Array<{ id: string }>>)`
          INSERT INTO ece.episodio_atencion (
            paciente_id,
            establecimiento_id,
            public_encounter_id,
            modalidad,
            servicio_categoria,
            origen_consulta,
            motivo,
            fecha_hora_inicio,
            estado,
            creado_en,
            actualizado_en
          ) VALUES (
            ${pacienteEce.id}::uuid,
            ${input.establecimientoEceId}::uuid,
            ${input.encounterId}::uuid,
            ${input.modalidad},
            ${input.servicio_categoria},
            ${input.origen_consulta ?? null},
            ${input.motivo ?? null},
            ${encounter.admittedAt}::timestamptz,
            'abierto',
            now(),
            now()
          )
          RETURNING id
        `;

        const episodioId = rows[0]!.id;

        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.episodio.linkedToEncounter",
          aggregateType: "EpisodioAtencion",
          aggregateId: episodioId,
          emittedById: ctx.user.id,
          payload: {
            episodioId,
            encounterId: input.encounterId,
            patientId: encounter.patientId,
            organizationId: ctx.tenant.organizationId,
            linkedById: ctx.user.id,
          },
        });

        return {
          episodioId,
          encounterId: input.encounterId,
          pacienteEceId: pacienteEce.id,
        };
      });
    }),

  /**
   * Listado paginado de Encounters HIS sin episodio ECE asociado.
   * Útil para el panel de conciliación ECE (identificar brechas de registro).
   * Solo requiere tenantProcedure (lectura sin mutación de datos).
   */
  listEncountersWithoutEpisodio: tenantProcedure
    .input(listEncountersWithoutEpisodioSchema)
    .query(async ({ ctx, input }) => {
      // Subquery: encuentros que YA tienen un episodio ECE vinculado.
      // No usamos JOIN en Prisma porque ece.* no está en el schema Prisma.
      // Traemos los encounter IDs vinculados y los excluimos con notIn.
      const linkedRows = await (ctx.prisma.$queryRaw as (
        q: TemplateStringsArray,
        ...v: unknown[]
      ) => Promise<Array<{ eid: string }>>)`
        SELECT public_encounter_id::text AS eid
        FROM ece.episodio_atencion
        WHERE public_encounter_id IS NOT NULL
      `;
      const linkedIds = linkedRows.map((r) => r.eid);

      const where = {
        organizationId: ctx.tenant.organizationId,
        dischargedAt: null, // solo encuentros abiertos son relevantes para conciliación
        ...(linkedIds.length > 0 ? { id: { notIn: linkedIds } } : {}),
      };

      const [items, total] = await Promise.all([
        ctx.prisma.encounter.findMany({
          where,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: { admittedAt: "desc" },
          select: {
            id: true,
            encounterNumber: true,
            admittedAt: true,
            admissionType: true,
            patientId: true,
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
          },
        }),
        ctx.prisma.encounter.count({ where }),
      ]);

      return { items, total, page: input.page, pageSize: input.pageSize };
    }),
});
