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
 *   ece.bridge.syncToHis          — ECE → HIS: actualiza identificadores
 *   ece.bridge.listLinkedPatients — pacientes con vínculo activo (paginado)
 *
 * Autorización: requireRole(["ARCH","ADM","DIR"]).
 *
 * Emisión de eventos (outbox transaccional):
 *   - "ece.paciente.linked"  tras linkPatient.
 *   - "ece.paciente.synced"  tras syncFromHis / syncToHis.
 *
 * ===========================================================================
 * SCHEMA REAL (verificado 2026-05-29 vía MCP)
 * ===========================================================================
 *
 * `ece.paciente` NO almacena datos demográficos (firstName/lastName/birthDate/
 * biologicalSex). Esos viven solo en `public.Patient` y se acceden via JOIN
 * por `public_patient_id`. Lo que `ece.paciente` SÍ almacena:
 *
 *   - id, public_patient_id (FK opcional a public.Patient)
 *   - establecimiento_id (NOT NULL — public.Establishment)
 *   - numero_expediente (NOT NULL — text único por establecimiento; mapea a Patient.mrn)
 *   - dui, nui, cun, carnet_minoridad, pasaporte (identificadores opcionales SV)
 *   - tipo_registro_identidad (NOT NULL default 'verificado')
 *   - estado_expediente / estado_registro / fallecido (flags admin)
 *   - estado_familiar, ocupacion, nacionalidad, direccion, telefono (opcionales)
 *
 * Esto significa que la "sincronización" se reduce a IDENTIFICADORES + numero_expediente.
 * Los demográficos siempre vienen de public.Patient.
 *
 * Mapeo HIS → ECE:
 *   public.Patient.mrn                        → ece.paciente.numero_expediente
 *   public.Patient.identifiers (kind=DUI)     → ece.paciente.dui
 *   public.Patient.identifiers (kind=NIE)     → ece.paciente.carnet_minoridad
 *                                              (NTEC no tiene "NIE" como tal;
 *                                              carnet de minoridad es el más
 *                                              cercano para extranjeros menores)
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

// ─── Tipos raw SQL ECE (columnas reales — no demograficos) ────────────────────

interface EcePacienteRow {
  id: string;
  public_patient_id: string | null;
  establecimiento_id: string;
  numero_expediente: string;
  dui: string | null;
  nui: string | null;
  cun: string | null;
  carnet_minoridad: string | null;
  pasaporte: string | null;
  tipo_registro_identidad: string;
  estado_expediente: string;
  estado_registro: string;
  fallecido: boolean;
}

// ─── Campos identificador que se sincronizan ──────────────────────────────────
// Antes incluía firstName/lastName/birthDate/etc — esos NO están en ece.paciente.
// Solo se sincronizan los identificadores que existen en ambos lados.

const SYNCED_FIELDS = ["numero_expediente", "dui"] as const;

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
   * Lee public.Patient (mrn + identificadores DUI/NIE) y:
   *   - Si ecePacienteId se da: valida consistencia de identificadores y
   *     actualiza dui/carnet_minoridad + numero_expediente + public_patient_id.
   *   - Si no se da: crea una nueva fila en ece.paciente con los identificadores
   *     mapeados y `numero_expediente = patient.mrn`.
   *
   * NO sincroniza datos demográficos (firstName/lastName/birthDate/etc.) —
   * esos no existen en `ece.paciente` (schema NTEC simplificado verificado
   * 2026-05-29). Los demográficos se acceden vía JOIN a public.Patient.
   *
   * Consistencia: si ece.paciente tiene DUI y HIS tiene DUI con valor
   * diferente → BAD_REQUEST (conflicto de identidad).
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
            mrn: true,
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
          // 2a. Actualizar ece.paciente existente — verificar consistencia primero.
          const eceRows = await tx.$queryRaw<EcePacienteRow[]>`
            SELECT
              id::text,
              public_patient_id::text,
              establecimiento_id::text,
              numero_expediente,
              dui,
              nui,
              cun,
              carnet_minoridad,
              pasaporte,
              tipo_registro_identidad,
              estado_expediente,
              estado_registro,
              fallecido
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
          // NIE en HIS → carnet_minoridad en ECE (no existe NIE como columna).
          if (hisNie && ece.carnet_minoridad && hisNie !== ece.carnet_minoridad) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Conflicto NIE/carnet: HIS=${hisNie}, ECE=${ece.carnet_minoridad}. Corrija antes de sincronizar.`,
            });
          }

          // Aplicar identificadores. numero_expediente solo se setea si está vacío
          // (no sobrescribimos un número operativo que ya esté en uso).
          await tx.$executeRaw`
            UPDATE ece.paciente
            SET
              dui                = COALESCE(${hisDui}::text, dui),
              carnet_minoridad   = COALESCE(${hisNie}::text, carnet_minoridad),
              numero_expediente  = CASE
                WHEN numero_expediente IS NULL OR numero_expediente = ''
                THEN ${patient.mrn}::text
                ELSE numero_expediente
              END,
              public_patient_id  = ${patientId}::uuid
            WHERE id = ${ecePacienteId}::uuid
          `;

          if (hisDui && hisDui !== ece.dui) fieldsUpdated.push("dui");
          if (hisNie && hisNie !== ece.carnet_minoridad) fieldsUpdated.push("carnet_minoridad");
          if (!ece.numero_expediente) fieldsUpdated.push("numero_expediente");
          fieldsUpdated.push("public_patient_id");
        } else {
          // 2b. Crear nueva fila en ece.paciente. numero_expediente y
          // establecimiento_id son NOT NULL.
          if (!ctx.tenant.establishmentId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Se requiere un establecimiento activo para crear Ficha ECE.",
            });
          }

          // Tipo de registro: si hay DUI o NIE, "verificado"; sino "sin_documento".
          const tipoRegistro = hisDui || hisNie ? "verificado" : "sin_documento";

          const created = await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO ece.paciente (
              public_patient_id,
              establecimiento_id,
              numero_expediente,
              dui,
              carnet_minoridad,
              tipo_registro_identidad
            )
            VALUES (
              ${patientId}::uuid,
              ${ctx.tenant.establishmentId}::uuid,
              ${patient.mrn},
              ${hisDui}::text,
              ${hisNie}::text,
              ${tipoRegistro}
            )
            RETURNING id::text
          `;

          targetId = created[0]!.id;
          fieldsUpdated.push("numero_expediente", "public_patient_id");
          if (hisDui) fieldsUpdated.push("dui");
          if (hisNie) fieldsUpdated.push("carnet_minoridad");
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
   * Lee ece.paciente (identificadores) y actualiza public.Patient.mrn si
   * ece.numero_expediente difiere y no hay conflicto de identidad.
   *
   * NO actualiza demográficos (firstName/lastName/birthDate/etc.) porque
   * `ece.paciente` no los almacena (schema NTEC simplificado).
   *
   * Consistencia: si los identificadores DUI/NIE/carnet difieren con valores
   * presentes en ambos lados → BAD_REQUEST.
   *
   * Caso de uso: un Archivero captura una corrección de DUI en ECE; este
   * procedure propaga ese cambio al MPI principal (public.Patient.identifiers).
   * No implementado todavía: actualización de identificadores en HIS desde ECE
   * requiere `PatientIdentifier` upsert que respete uniqueness — queda como
   * follow-up. Por ahora solo sincroniza `numero_expediente → mrn` cuando
   * el de HIS está vacío.
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
            establecimiento_id::text,
            numero_expediente,
            dui,
            nui,
            cun,
            carnet_minoridad,
            pasaporte,
            tipo_registro_identidad,
            estado_expediente,
            estado_registro,
            fallecido
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
            mrn: true,
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
        if (ece.carnet_minoridad && hisNie && ece.carnet_minoridad !== hisNie) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Conflicto NIE/carnet: ECE=${ece.carnet_minoridad}, HIS=${hisNie}. Corrija antes de sincronizar.`,
          });
        }

        const fieldsUpdated: string[] = [];

        // 3. Actualizar mrn de Patient HIS desde numero_expediente si HIS está vacío
        //    y ECE tiene valor. No sobrescribimos un mrn HIS preexistente.
        if (!patient.mrn && ece.numero_expediente) {
          await tx.patient.update({
            where: { id: ece.public_patient_id },
            data: {
              mrn: ece.numero_expediente,
              updatedBy: ctx.user.id,
            },
          });
          fieldsUpdated.push("mrn");
        }

        // NOTA: upsert de identifiers (PatientIdentifier) queda como follow-up.
        // Requiere validación uniqueness por kind y manejo de identifierTypeId.
        // Si esa funcionalidad se necesita: ver issue de seguimiento.

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
   *
   * Hace LEFT JOIN a public."Patient" para obtener firstName/lastName/etc.
   * (esos campos no viven en ece.paciente).
   */
  listLinkedPatients: bridgeBase
    .input(listLinkedPatientsInput)
    .query(async ({ ctx, input }) => {
      const { cursor, limit } = input;

      // Construir la query con cursor opcional vía $queryRawUnsafe.
      // El cursor es un UUID validado por Zod — escapamos comillas simples
      // como defensa adicional antes de interpolarlo.
      const cursorClause = cursor
        ? `AND ece.id > '${String(cursor).replace(/'/g, "''")}'::uuid`
        : "";

      const rows = await ctx.prisma.$queryRawUnsafe<
        {
          ece_id: string;
          public_patient_id: string;
          numero_expediente: string;
          dui: string | null;
          first_name: string | null;
          last_name: string | null;
        }[]
      >(
        `SELECT
           ece.id::text                       AS ece_id,
           ece.public_patient_id::text,
           ece.numero_expediente,
           ece.dui,
           p."firstName"                       AS first_name,
           p."lastName"                        AS last_name
         FROM ece.paciente ece
         LEFT JOIN public."Patient" p
           ON p.id = ece.public_patient_id
          AND p."deletedAt" IS NULL
         WHERE ece.public_patient_id IS NOT NULL
           ${cursorClause}
         ORDER BY ece.id
         LIMIT ${limit + 1}`,
      );

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1]!.ece_id : null;

      return { items, nextCursor };
    }),
});
