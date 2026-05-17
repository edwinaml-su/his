/**
 * ece.bridge — Bridge bidireccional ECE↔HIS (Ficha NTEC Art. 15 ↔ MPI).
 *
 * Norma: Acuerdo MINSAL n.° 1616 Art. 15 — campos obligatorios de la Ficha ECE.
 * Diseño: Opción B ACL — `ece.paciente.public_patient_id UUID NULLABLE`.
 *
 * Procedures:
 *   ece.bridge.linkPatient        — vincula ece.paciente a public.Patient
 *   ece.bridge.unlinkPatient      — desvincula (SET NULL)
 *   ece.bridge.syncFromHis        — HIS → ECE: crea/actualiza ece.paciente
 *   ece.bridge.syncToHis          — ECE → HIS: actualiza campos demográficos
 *   ece.bridge.listLinkedPatients — pacientes con vínculo activo (paginado)
 *
 * Autorización: requireRole(["ARCH","ADM","DIR"]).
 *
 * Emisión de eventos (outbox transaccional):
 *   - "ece.paciente.linked"  tras linkPatient.
 *   - "ece.paciente.synced"  tras syncFromHis / syncToHis.
 *
 * Validación de consistencia en sync:
 *   Si ambos registros tienen DUI/NIE/expediente y difieren → BAD_REQUEST.
 *   Campos sincronizados (NTEC Art. 15 demográficos):
 *     firstName, lastName, secondLastName, birthDate, biologicalSexId.
 *
 * Raw SQL para ece.paciente; Prisma model para public.Patient.
 *
 * Spec: docs/blueprints/ece_his_bridge.md
 */
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../trpc";
import { emitDomainEvent } from "@his/database";
import {
  linkPatientInput,
  unlinkPatientInput,
  syncFromHisInput,
  syncToHisInput,
  listLinkedPatientsInput,
} from "@his/contracts";

// ─── Tipos raw SQL ECE ────────────────────────────────────────────────────────

interface EcePacienteRow {
  id: string;
  public_patient_id: string | null;
  primer_nombre: string;
  primer_apellido: string;
  segundo_apellido: string | null;
  fecha_nacimiento: Date | null;
  sexo_biologico_id: string | null;
  expediente_numero: string | null;
  dui: string | null;
  nie: string | null;
  establecimiento_id: string;
}

// ─── Campos demográficos NTEC Art. 15 que se sincronizan ────────────────────

const SYNCED_FIELDS = [
  "firstName",
  "lastName",
  "secondLastName",
  "birthDate",
  "biologicalSexId",
] as const;

// ─── Base procedure ──────────────────────────────────────────────────────────

const bridgeBase = requireRole(["ARCH", "ADM", "DIR"]);

// ─── Router ──────────────────────────────────────────────────────────────────

export const eceBridgePatientRouter = router({
  /**
   * Vincula ece.paciente a public.Patient.
   *
   * Valida que:
   *   1. El Patient HIS existe y pertenece al tenant.
   *   2. El ece.paciente existe.
   *   3. El ece.paciente no tenga ya un vínculo diferente (idempotente si es el mismo).
   */
  linkPatient: bridgeBase
    .input(linkPatientInput)
    .mutation(async ({ ctx, input }) => {
      const { patientId, ecePacienteId } = input;
      const orgId = ctx.tenant.organizationId;

      return ctx.prisma.$transaction(async (tx) => {
        // 1. Verificar Patient HIS existe y pertenece al tenant
        const patient = await tx.patient.findFirst({
          where: { id: patientId, organizationId: orgId, deletedAt: null },
          select: { id: true },
        });
        if (!patient) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Patient HIS ${patientId} no encontrado en la organización.`,
          });
        }

        // 2. Verificar ece.paciente y leer vínculo actual
        const eceRows = await tx.$queryRaw<
          { id: string; public_patient_id: string | null }[]
        >`
          SELECT id::text, public_patient_id::text
          FROM ece.paciente
          WHERE id = ${ecePacienteId}::uuid
          LIMIT 1
        `;
        if (eceRows.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `ece.paciente ${ecePacienteId} no encontrado.`,
          });
        }

        const existing = eceRows[0]!;
        // Idempotente: si ya está vinculado al mismo Patient, no falla.
        if (
          existing.public_patient_id !== null &&
          existing.public_patient_id !== patientId
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `ece.paciente ya está vinculado al Patient ${existing.public_patient_id}. Desvincule primero.`,
          });
        }

        // 3. Actualizar vínculo
        await tx.$executeRaw`
          UPDATE ece.paciente
          SET public_patient_id = ${patientId}::uuid
          WHERE id = ${ecePacienteId}::uuid
        `;

        // 4. Emitir evento outbox
        await emitDomainEvent(tx, {
          organizationId: orgId,
          eventType: "ece.paciente.linked",
          aggregateType: "EcePaciente",
          aggregateId: ecePacienteId,
          emittedById: ctx.user.id,
          payload: {
            ecePacienteId,
            publicPatientId: patientId,
            linkedById: ctx.user.id,
            organizationId: orgId,
          },
        });

        return { ecePacienteId, publicPatientId: patientId };
      });
    }),

  /**
   * Desvincula ece.paciente de public.Patient (SET NULL).
   * No falla si ya estaba desvinculado.
   */
  unlinkPatient: bridgeBase
    .input(unlinkPatientInput)
    .mutation(async ({ ctx, input }) => {
      const { ecePacienteId } = input;

      await ctx.prisma.$executeRaw`
        UPDATE ece.paciente
        SET public_patient_id = NULL
        WHERE id = ${ecePacienteId}::uuid
      `;

      return { ecePacienteId, unlinked: true };
    }),

  /**
   * Sincronización HIS → ECE.
   *
   * Lee public.Patient y sus identificadores DUI/NIE, luego:
   *   - Si ecePacienteId se da: valida consistencia de identificadores y actualiza
   *     los campos demográficos en ece.paciente.
   *   - Si no se da: crea una nueva fila en ece.paciente y establece el vínculo.
   *
   * Consistencia: si ece.paciente tiene DUI/NIE y HIS tiene un identificador
   * del mismo tipo con valor diferente → BAD_REQUEST (conflicto de identidad).
   */
  syncFromHis: bridgeBase
    .input(syncFromHisInput)
    .mutation(async ({ ctx, input }) => {
      const { patientId, ecePacienteId } = input;
      const orgId = ctx.tenant.organizationId;

      return ctx.prisma.$transaction(async (tx) => {
        // 1. Leer Patient HIS con identificadores
        const patient = await tx.patient.findFirst({
          where: { id: patientId, organizationId: orgId, deletedAt: null },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            secondLastName: true,
            birthDate: true,
            biologicalSexId: true,
            identifiers: {
              select: { kind: true, value: true },
              where: { kind: { in: ["DUI", "NIE"] } },
            },
          },
        });
        if (!patient) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Patient HIS ${patientId} no encontrado en la organización.`,
          });
        }

        const hisDui = patient.identifiers.find((i) => i.kind === "DUI")?.value ?? null;
        const hisNie = patient.identifiers.find((i) => i.kind === "NIE")?.value ?? null;

        let targetId = ecePacienteId;
        const fieldsUpdated: string[] = [];

        if (ecePacienteId) {
          // 2a. Actualizar ece.paciente existente — verificar consistencia primero
          const eceRows = await tx.$queryRaw<EcePacienteRow[]>`
            SELECT
              id::text,
              public_patient_id::text,
              primer_nombre,
              primer_apellido,
              segundo_apellido,
              fecha_nacimiento,
              sexo_biologico_id::text,
              expediente_numero,
              dui,
              nie,
              establecimiento_id::text
            FROM ece.paciente
            WHERE id = ${ecePacienteId}::uuid
            LIMIT 1
          `;
          if (eceRows.length === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `ece.paciente ${ecePacienteId} no encontrado.`,
            });
          }

          const ece = eceRows[0]!;

          // Validar consistencia de identificadores
          if (hisDui && ece.dui && hisDui !== ece.dui) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Conflicto DUI: HIS=${hisDui}, ECE=${ece.dui}. Corrija antes de sincronizar.`,
            });
          }
          if (hisNie && ece.nie && hisNie !== ece.nie) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Conflicto NIE: HIS=${hisNie}, ECE=${ece.nie}. Corrija antes de sincronizar.`,
            });
          }

          // Aplicar campos demográficos
          await tx.$executeRaw`
            UPDATE ece.paciente
            SET
              primer_nombre      = ${patient.firstName},
              primer_apellido    = ${patient.lastName},
              segundo_apellido   = ${patient.secondLastName ?? null},
              fecha_nacimiento   = ${patient.birthDate ?? null}::date,
              sexo_biologico_id  = ${patient.biologicalSexId}::uuid,
              public_patient_id  = ${patientId}::uuid
            WHERE id = ${ecePacienteId}::uuid
          `;

          fieldsUpdated.push(...SYNCED_FIELDS);
        } else {
          // 2b. Crear nueva fila en ece.paciente
          // Requiere establecimientoId del tenant — obligatorio en ECE.
          if (!ctx.tenant.establishmentId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Se requiere un establecimiento activo para crear Ficha ECE.",
            });
          }

          const created = await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO ece.paciente (
              primer_nombre,
              primer_apellido,
              segundo_apellido,
              fecha_nacimiento,
              sexo_biologico_id,
              establecimiento_id,
              public_patient_id,
              dui,
              nie
            )
            VALUES (
              ${patient.firstName},
              ${patient.lastName},
              ${patient.secondLastName ?? null},
              ${patient.birthDate ?? null}::date,
              ${patient.biologicalSexId}::uuid,
              ${ctx.tenant.establishmentId}::uuid,
              ${patientId}::uuid,
              ${hisDui}::text,
              ${hisNie}::text
            )
            RETURNING id::text
          `;

          targetId = created[0]!.id;
          fieldsUpdated.push(...SYNCED_FIELDS, "dui", "nie");
        }

        // 3. Emitir evento outbox
        await emitDomainEvent(tx, {
          organizationId: orgId,
          eventType: "ece.paciente.synced",
          aggregateType: "EcePaciente",
          aggregateId: targetId!,
          emittedById: ctx.user.id,
          payload: {
            ecePacienteId: targetId!,
            publicPatientId: patientId,
            direction: "fromHis",
            syncedById: ctx.user.id,
            organizationId: orgId,
            fieldsUpdated,
          },
        });

        return { ecePacienteId: targetId!, publicPatientId: patientId, fieldsUpdated };
      });
    }),

  /**
   * Sincronización ECE → HIS.
   *
   * Lee ece.paciente y actualiza solo los campos demográficos NTEC Art. 15
   * en public.Patient vinculado. No crea un Patient si no existe vínculo.
   *
   * Consistencia: si los identificadores DUI/NIE difieren → BAD_REQUEST.
   */
  syncToHis: bridgeBase
    .input(syncToHisInput)
    .mutation(async ({ ctx, input }) => {
      const { ecePacienteId } = input;
      const orgId = ctx.tenant.organizationId;

      return ctx.prisma.$transaction(async (tx) => {
        // 1. Leer ece.paciente
        const eceRows = await tx.$queryRaw<EcePacienteRow[]>`
          SELECT
            id::text,
            public_patient_id::text,
            primer_nombre,
            primer_apellido,
            segundo_apellido,
            fecha_nacimiento,
            sexo_biologico_id::text,
            expediente_numero,
            dui,
            nie,
            establecimiento_id::text
          FROM ece.paciente
          WHERE id = ${ecePacienteId}::uuid
          LIMIT 1
        `;
        if (eceRows.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `ece.paciente ${ecePacienteId} no encontrado.`,
          });
        }

        const ece = eceRows[0]!;

        if (!ece.public_patient_id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `ece.paciente ${ecePacienteId} no tiene vínculo a Patient HIS. Use linkPatient o syncFromHis primero.`,
          });
        }

        // 2. Leer Patient HIS para validar consistencia
        const patient = await tx.patient.findFirst({
          where: {
            id: ece.public_patient_id,
            organizationId: orgId,
            deletedAt: null,
          },
          select: {
            id: true,
            identifiers: {
              select: { kind: true, value: true },
              where: { kind: { in: ["DUI", "NIE"] } },
            },
          },
        });
        if (!patient) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Patient HIS ${ece.public_patient_id} no encontrado en la organización.`,
          });
        }

        const hisDui = patient.identifiers.find((i) => i.kind === "DUI")?.value ?? null;
        const hisNie = patient.identifiers.find((i) => i.kind === "NIE")?.value ?? null;

        // Validar consistencia de identificadores
        if (ece.dui && hisDui && ece.dui !== hisDui) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Conflicto DUI: ECE=${ece.dui}, HIS=${hisDui}. Corrija antes de sincronizar.`,
          });
        }
        if (ece.nie && hisNie && ece.nie !== hisNie) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Conflicto NIE: ECE=${ece.nie}, HIS=${hisNie}. Corrija antes de sincronizar.`,
          });
        }

        // 3. Actualizar Patient HIS con campos demográficos NTEC Art. 15
        await tx.patient.update({
          where: { id: ece.public_patient_id },
          data: {
            firstName: ece.primer_nombre,
            lastName: ece.primer_apellido,
            secondLastName: ece.segundo_apellido ?? null,
            birthDate: ece.fecha_nacimiento ?? null,
            biologicalSexId: ece.sexo_biologico_id ?? undefined,
            updatedBy: ctx.user.id,
          },
        });

        const fieldsUpdated = [...SYNCED_FIELDS];

        // 4. Emitir evento outbox
        await emitDomainEvent(tx, {
          organizationId: orgId,
          eventType: "ece.paciente.synced",
          aggregateType: "EcePaciente",
          aggregateId: ecePacienteId,
          emittedById: ctx.user.id,
          payload: {
            ecePacienteId,
            publicPatientId: ece.public_patient_id,
            direction: "toHis",
            syncedById: ctx.user.id,
            organizationId: orgId,
            fieldsUpdated,
          },
        });

        return {
          ecePacienteId,
          publicPatientId: ece.public_patient_id,
          fieldsUpdated,
        };
      });
    }),

  /**
   * Lista pacientes con vínculo ECE↔HIS activo.
   * Paginación por cursor (id de ece.paciente).
   */
  listLinkedPatients: bridgeBase
    .input(listLinkedPatientsInput)
    .query(async ({ ctx, input }) => {
      const { cursor, limit } = input;

      // Construir la query con cursor opcional vía $queryRawUnsafe.
      // El cursor es un UUID validado por Zod — escapamos comillas simples
      // como defensa adicional antes de interpolarlo.
      const cursorClause = cursor
        ? `AND id > '${String(cursor).replace(/'/g, "''")}'::uuid`
        : "";

      const rows = await ctx.prisma.$queryRawUnsafe<
        {
          ece_id: string;
          public_patient_id: string;
          primer_nombre: string;
          primer_apellido: string;
          expediente_numero: string | null;
          dui: string | null;
        }[]
      >(
        `SELECT
           id::text          AS ece_id,
           public_patient_id::text,
           primer_nombre,
           primer_apellido,
           expediente_numero,
           dui
         FROM ece.paciente
         WHERE public_patient_id IS NOT NULL
           ${cursorClause}
         ORDER BY id
         LIMIT ${limit + 1}`,
      );

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1]!.ece_id : null;

      return { items, nextCursor };
    }),
});
