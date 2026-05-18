/**
 * §15 Pharmacy + §16 eMAR — Router tRPC (BCs `prescribing` + `pharmacy` + `medication-admin`).
 *
 * Team Charlie · ADR-0003 — state machine `Prescription` con three-actor
 * coordination, optimistic locking + locks pesimistas en Dispense/Administer.
 *
 * Procedures expuestos:
 *
 *   prescription.draft         (US-12.1 — Drafted, valida alergia/interacción)
 *   prescription.sign          (US-12.1 — Drafted -> Prescribed, firma TSA)
 *   prescription.validate      (US-12.2 — Prescribed -> Validated)
 *   prescription.reject        (US-12.2 — Prescribed -> Rejected)
 *   prescription.discontinue   (US-12.x — * -> Discontinued)
 *   prescription.get           (vista detallada)
 *   prescription.list          (lista paginada)
 *   prescription.validationQueue (cola farmacéutica)
 *   prescription.emarQueue     (cola enfermería — próximas dosis)
 *
 *   dispense.create            (US-12.3 — Validated -> Dispensed)
 *
 *   administer.record          (US-12.4 + US-12.5 — Dispensed -> Administered)
 *
 *   ledger.recordEntry         (US-12.6 — asiento DNM inmutable)
 *   ledger.list                (consulta paginada por org)
 *
 *   catalog.searchDrug         (autocomplete para CPOE)
 *
 * Eventos publicados al outbox (`DomainEvent`):
 *   PrescriptionDrafted, PrescriptionSigned, PrescriptionValidated,
 *   PrescriptionRejected, MedicationDispensed, MedicationAdministered,
 *   AllergyAlertTriggered, PrescriptionDiscontinued, ControlledSubstanceLogged.
 *
 * Hash-chain audit: reusa primitiva D-03 de Bravo (`fn_anchor_pharmacy_audit`).
 *
 * Dataset de interacciones (Wave 1): JSON estático cargado en memoria al iniciar
 * el módulo. TODO[Wave 2 Lexicomp/Vademecum]: reemplazar por servicio externo.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import { z } from "zod";
import {
  draftPrescriptionInput,
  signPrescriptionInput,
  validatePrescriptionInput,
  rejectPrescriptionInput,
  dispensationInputSchema,
  administerInputSchema,
  discontinueInput,
  ledgerEntryInput,
  listPrescriptionsInput,
  getPrescriptionInput,
  validationQueueInput,
  emarQueueInput,
  canTransition,
  guardControlledSubstanceRequiresPaper,
  guardInteractionAndAllergyClear,
  guardFiveRights,
  guardDoubleVerification,
  detectAllergyAlerts,
  detectInteractionAlerts,
  buildItemBarcode,
  canonicalizePrescriptionPayload,
  isHighRiskAtc,
  checkAllergiesInput,
  evaluateAllergyCheck,
  type PrescriptionDto,
  type PrescriptionStatus,
  type DrugInteractionDatasetEntry,
} from "@his/contracts";
import { withTenantContext } from "../rls-context";
import { router, tenantProcedure } from "../trpc";

// ---------------------------------------------------------------------------
// Dataset estático de interacciones (Wave 1)
// ---------------------------------------------------------------------------

interface InteractionJson {
  version: string;
  source: string;
  entries: Array<{
    atcA: string;
    atcB: string;
    severity: "minor" | "moderate" | "major" | "contraindicated";
    description: string;
  }>;
}

/**
 * Carga el dataset estático en memoria. Tolera ausencia del archivo (tests
 * mockean directamente). TODO[Wave 2 Lexicomp/Vademecum]: sustituir por client.
 */
function loadInteractionDataset(): DrugInteractionDatasetEntry[] {
  try {
    const candidates = [
      path.resolve(
        process.cwd(),
        "packages/database/seed/drug-interactions.json",
      ),
      path.resolve(__dirname, "../../../database/seed/drug-interactions.json"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf8");
        const parsed = JSON.parse(raw) as InteractionJson;
        return parsed.entries.map((e) => ({
          atcA: e.atcA,
          atcB: e.atcB,
          severity: e.severity,
          description: e.description,
          source: "stub-wave1" as const,
        }));
      }
    }
  } catch {
    // En tests el archivo puede no estar; devolvemos vacío.
  }
  return [];
}

const INTERACTION_DATASET: DrugInteractionDatasetEntry[] =
  loadInteractionDataset();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Inserta una entrada en `DomainEvent` (outbox) con idempotencia. */
async function publishEvent(
  prisma: Prisma.TransactionClient,
  params: {
    organizationId: string;
    aggregateId: string;
    eventType: string;
    payload: unknown;
    auditEntryId?: bigint | null;
    dedupSuffix?: string;
  },
): Promise<void> {
  const dedupKey = `${params.aggregateId}|${params.eventType}|${
    params.dedupSuffix ?? "pharmacy"
  }`;
  try {
    await prisma.domainEvent.create({
      data: {
        organizationId: params.organizationId,
        aggregate: "pharmacy",
        aggregateId: params.aggregateId,
        eventType: params.eventType,
        payload: params.payload as Prisma.InputJsonValue,
        dedupKey,
        auditEntryId: params.auditEntryId ?? null,
      },
    });
  } catch (e: unknown) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return; // ya publicado
    }
    throw e;
  }
}

/**
 * Ancla acción de pharmacy al audit_log (hash-chain Merkle reusando D-03).
 * Devuelve el id del registro de auditoría para enlazarlo al agregado.
 */
async function anchorPharmacyAudit(
  prisma: Prisma.TransactionClient,
  params: {
    action: "CREATE" | "SIGN" | "UPDATE";
    entity:
      | "Prescription"
      | "DispensationEvent"
      | "AdministrationEvent"
      | "ControlledSubstanceLedger";
    entityId: string;
    userId: string;
    organizationId: string;
    establishmentId: string | null;
    afterJson: unknown;
    justification?: string;
  },
): Promise<bigint> {
  const rows = await prisma.$queryRaw<Array<{ id: bigint }>>`
    SELECT public.fn_anchor_pharmacy_audit(
      ${params.action}::text,
      ${params.entity}::text,
      ${params.entityId}::text,
      ${params.userId}::uuid,
      ${params.organizationId}::uuid,
      ${params.establishmentId}::uuid,
      ${JSON.stringify(params.afterJson)}::jsonb,
      ${params.justification ?? null}
    ) AS id;
  `;
  if (!rows[0]?.id) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "No se pudo anclar la auditoría pharmacy (hash-chain).",
    });
  }
  return rows[0].id;
}

/** Stub TSA — devuelve `signatureRef`. Wave 2: HSM/PKI. */
async function obtainPharmacyTsaToken(
  hash: string,
  forceFallback = false,
): Promise<{ signatureRef: string; provider: string }> {
  const provider = forceFallback ? "digicert" : "freetsa";
  const ts = new Date().toISOString();
  return {
    signatureRef: `tsa:${provider}:${ts}:${hash.slice(0, 16)}`,
    provider,
  };
}

/** sha256 de un string (re-export útil para canonicalización). */
function sha256(text: string): string {
  // Lazy require para no bloquear edge runtime.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Mapea fila Prisma + relaciones a `PrescriptionDto`. */
function toPrescriptionDto(row: {
  id: string;
  encounterId: string;
  patientId: string;
  prescriberId: string;
  status: PrescriptionStatus;
  version: number;
  notes: string;
  signedAt: Date | null;
  signatureRef: string | null;
  signatureProvider: string | null;
  validatedAt: Date | null;
  validatedById: string | null;
  rejectedAt: Date | null;
  rejectionReason:
    | "ALLERGY"
    | "INTERACTION"
    | "DOSE_OUT_OF_RANGE"
    | "ROUTE_INCORRECT"
    | "DUPLICATE_THERAPY"
    | "OTHER"
    | null;
  rejectionDetail: string | null;
  discontinuedAt: Date | null;
  auditEntryId: bigint | null;
  createdAt: Date;
  updatedAt: Date;
  lines: Array<{
    id: string;
    drugId: string;
    dose: Prisma.Decimal | number;
    doseUnit: string;
    route: PrescriptionDto["lines"][number]["route"];
    frequency: PrescriptionDto["lines"][number]["frequency"];
    durationHours: number | null;
    instructions: string;
    drug: { name: string; atcCode: string; isHighRisk: boolean; controlledClass: PrescriptionDto["lines"][number]["controlledClass"] };
  }>;
  dispensations: Array<{
    id: string;
    prescriptionLineId: string;
    units: number;
    lotNumber: string;
    expiryDate: Date;
    itemBarcode: string;
    dispensedAt: Date;
    dispensedById: string;
  }>;
  administrations: Array<{
    id: string;
    prescriptionLineId: string;
    scheduledTime: Date;
    administeredAt: Date;
    administeredById: string;
    secondNurseId: string | null;
    doubleVerified: boolean;
    fiveRightsOk: boolean;
    notes: string | null;
  }>;
  prescriberName?: string | null;
}): PrescriptionDto {
  return {
    id: row.id,
    encounterId: row.encounterId,
    patientId: row.patientId,
    prescriberId: row.prescriberId,
    prescriberName: row.prescriberName ?? null,
    status: row.status,
    version: row.version,
    notes: row.notes,
    signedAt: row.signedAt,
    signatureRef: row.signatureRef,
    signatureProvider: row.signatureProvider,
    validatedAt: row.validatedAt,
    validatedById: row.validatedById,
    rejectedAt: row.rejectedAt,
    rejectionReason: row.rejectionReason,
    rejectionDetail: row.rejectionDetail,
    discontinuedAt: row.discontinuedAt,
    auditEntryId: row.auditEntryId ? row.auditEntryId.toString() : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lines: row.lines.map((l) => ({
      id: l.id,
      drugId: l.drugId,
      drugName: l.drug.name,
      atcCode: l.drug.atcCode,
      dose: typeof l.dose === "number" ? l.dose : Number(l.dose.toString()),
      doseUnit: l.doseUnit,
      route: l.route,
      frequency: l.frequency,
      durationHours: l.durationHours,
      instructions: l.instructions,
      isHighRisk: l.drug.isHighRisk,
      controlledClass: l.drug.controlledClass,
    })),
    dispensations: row.dispensations.map((d) => ({
      id: d.id,
      prescriptionLineId: d.prescriptionLineId,
      units: d.units,
      lotNumber: d.lotNumber,
      expiryDate: d.expiryDate,
      itemBarcode: d.itemBarcode,
      dispensedAt: d.dispensedAt,
      dispensedById: d.dispensedById,
    })),
    administrations: row.administrations.map((a) => ({
      id: a.id,
      prescriptionLineId: a.prescriptionLineId,
      scheduledTime: a.scheduledTime,
      administeredAt: a.administeredAt,
      administeredById: a.administeredById,
      secondNurseId: a.secondNurseId,
      doubleVerified: a.doubleVerified,
      fiveRightsOk: a.fiveRightsOk,
      notes: a.notes,
    })),
  };
}

const PRESCRIPTION_INCLUDE = {
  lines: { include: { drug: true } },
  dispensations: true,
  administrations: true,
} as const;

// ---------------------------------------------------------------------------
// Sub-router: prescription (CPOE + Validación)
// ---------------------------------------------------------------------------

const prescriptionSubRouter = router({
  /** US-12.1 — crea un draft (Drafted). Valida alergias para mostrar alertas. */
  draft: tenantProcedure
    .input(draftPrescriptionInput)
    .mutation(async ({ ctx, input }) => {
      // 1) Encuentro debe existir y pertenecer al tenant.
      const encounter = await ctx.prisma.encounter.findFirst({
        where: {
          id: input.encounterId,
          organizationId: ctx.tenant.organizationId,
        },
        select: { id: true, patientId: true, dischargedAt: true },
      });
      if (!encounter) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Encuentro no encontrado.",
        });
      }
      if (encounter.dischargedAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "El encuentro está cerrado; no se admiten nuevas prescripciones.",
        });
      }
      if (encounter.patientId !== input.patientId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "patientId no coincide con el encuentro.",
        });
      }

      // 2) Cargar fármacos referenciados.
      const drugIds = input.lines.map((l) => l.drugId);
      const drugs = await ctx.prisma.drug.findMany({
        where: { id: { in: drugIds } },
      });
      if (drugs.length !== drugIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Uno o más fármacos no existen en el catálogo.",
        });
      }

      // 3) Guard DNM: bloquear electrónica para clase II/III/IV (US-12.1).
      const controlledGuard = guardControlledSubstanceRequiresPaper(
        drugs.map((d) => ({
          atcCode: d.atcCode,
          controlledClass: d.controlledClass,
          name: d.name,
        })),
      );
      if (!controlledGuard.ok) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: controlledGuard.reason,
        });
      }

      // 4) Pre-chequear alergias del paciente (informativo en draft).
      const allergies = await ctx.prisma.patientAllergy.findMany({
        where: { patientId: input.patientId, active: true },
      });
      const allergyAlerts = detectAllergyAlerts(
        drugs.map((d) => ({
          id: d.id,
          name: d.name,
          atcCode: d.atcCode,
          allergyFamilies: d.allergyFamilies ?? [],
        })),
        allergies.map((a) => ({
          id: a.id,
          substanceText: a.substanceText,
          severity: a.severity,
          active: a.active,
        })),
      );

      // 5) Crear prescripción + líneas en transacción.
      const created = await ctx.prisma.$transaction(async (tx) => {
        const prescription = await tx.prescription.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            encounterId: input.encounterId,
            patientId: input.patientId,
            prescriberId: ctx.user.id,
            status: "Drafted",
            version: 1,
            notes: input.notes,
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
            lines: {
              create: input.lines.map((l) => ({
                organizationId: ctx.tenant.organizationId,
                drugId: l.drugId,
                dose: new Prisma.Decimal(l.dose),
                doseUnit: l.doseUnit,
                route: l.route,
                frequency: l.frequency,
                durationHours: l.durationHours,
                instructions: l.instructions,
              })),
            },
          },
          include: PRESCRIPTION_INCLUDE,
        });

        await publishEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          aggregateId: prescription.id,
          eventType: "PrescriptionDrafted",
          payload: {
            prescriptionId: prescription.id,
            encounterId: input.encounterId,
            patientId: input.patientId,
            prescriberId: ctx.user.id,
            lineCount: input.lines.length,
          },
        });

        if (allergyAlerts.length > 0) {
          await publishEvent(tx, {
            organizationId: ctx.tenant.organizationId,
            aggregateId: prescription.id,
            eventType: "AllergyAlertTriggered",
            payload: { alerts: allergyAlerts },
            dedupSuffix: "draft",
          });
        }

        return prescription;
      });

      return {
        prescription: toPrescriptionDto(created as never),
        allergyAlerts,
      };
    }),

  /**
   * US-12.1 — firma electrónica (Drafted -> Prescribed).
   * Calcula hash canónico, obtiene token TSA y ancla al audit.
   */
  sign: tenantProcedure
    .input(signPrescriptionInput)
    .mutation(async ({ ctx, input }) => {
      const out = await ctx.prisma.$transaction(async (tx) => {
        const existing = await tx.prescription.findFirst({
          where: {
            id: input.prescriptionId,
            organizationId: ctx.tenant.organizationId,
          },
          include: PRESCRIPTION_INCLUDE,
        });
        if (!existing) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Prescripción no encontrada.",
          });
        }
        if (existing.prescriberId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Solo el prescriptor puede firmar la receta.",
          });
        }
        if (!canTransition(existing.status, "Prescribed")) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Transición inválida: ${existing.status} -> Prescribed.`,
          });
        }

        const canonical = canonicalizePrescriptionPayload({
          prescriptionId: existing.id,
          status: "Prescribed",
          version: existing.version + 1,
          lines: existing.lines.map((l) => ({
            drugId: l.drugId,
            dose: Number(l.dose.toString()),
            doseUnit: l.doseUnit,
            route: l.route,
            frequency: l.frequency,
          })),
        });
        const contentHash = sha256(canonical);
        const { signatureRef, provider } = await obtainPharmacyTsaToken(
          contentHash,
          input.forceFallbackTsa ?? false,
        );

        const updated = await tx.prescription.update({
          where: { id: existing.id },
          data: {
            status: "Prescribed",
            version: existing.version + 1,
            signedAt: new Date(),
            signatureRef,
            signatureProvider: provider,
            updatedBy: ctx.user.id,
          },
          include: PRESCRIPTION_INCLUDE,
        });

        const auditId = await anchorPharmacyAudit(tx, {
          action: "SIGN",
          entity: "Prescription",
          entityId: existing.id,
          userId: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
          establishmentId: ctx.tenant.establishmentId ?? null,
          afterJson: {
            prescriptionId: existing.id,
            status: "Prescribed",
            contentHash,
            signatureRef,
            signatureProvider: provider,
            version: existing.version + 1,
          },
        });

        await tx.prescription.update({
          where: { id: existing.id },
          data: { auditEntryId: auditId },
        });

        await publishEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          aggregateId: existing.id,
          eventType: "PrescriptionSigned",
          payload: {
            prescriptionId: existing.id,
            patientId: existing.patientId,
            contentHash,
          },
          auditEntryId: auditId,
        });

        return updated;
      });

      return { prescription: toPrescriptionDto(out as never) };
    }),

  /**
   * US-12.2 — Validación farmacéutica (Prescribed -> Validated).
   * Aplica optimistic locking (version) + lock pesimista (SELECT FOR UPDATE).
   * Bloquea si hay alergia o interacción mayor sin override.
   */
  validate: tenantProcedure
    .input(validatePrescriptionInput)
    .mutation(async ({ ctx, input }) => {
      const out = await ctx.prisma.$transaction(async (tx) => {
        // Lock pesimista para evitar carrera con rechazo concurrente.
        const lockRows = await tx.$queryRaw<
          Array<{ id: string; status: PrescriptionStatus; version: number; patientId: string }>
        >`
          SELECT id, status, version, "patientId"
            FROM public.prescription
           WHERE id = ${input.prescriptionId}::uuid
             AND "organizationId" = ${ctx.tenant.organizationId}::uuid
           FOR UPDATE;
        `;
        const lock = lockRows[0];
        if (!lock) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Prescripción no encontrada.",
          });
        }
        if (lock.version !== input.expectedVersion) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Conflicto de versión (expected=${input.expectedVersion}, actual=${lock.version}). Refresca la página.`,
          });
        }
        if (!canTransition(lock.status, "Validated")) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Transición inválida: ${lock.status} -> Validated.`,
          });
        }

        const full = await tx.prescription.findUniqueOrThrow({
          where: { id: input.prescriptionId },
          include: PRESCRIPTION_INCLUDE,
        });

        // Cruce final de alergias + interacciones contra dataset.
        const allergies = await tx.patientAllergy.findMany({
          where: { patientId: full.patientId, active: true },
        });
        const allergyAlerts = detectAllergyAlerts(
          full.lines.map((l) => ({
            id: l.drug.id,
            name: l.drug.name,
            atcCode: l.drug.atcCode,
            allergyFamilies: l.drug.allergyFamilies ?? [],
          })),
          allergies.map((a) => ({
            id: a.id,
            substanceText: a.substanceText,
            severity: a.severity,
            active: a.active,
          })),
        );
        const interactionAlerts = detectInteractionAlerts(
          full.lines.map((l) => ({ id: l.drug.id, atcCode: l.drug.atcCode })),
          INTERACTION_DATASET,
        );

        const guard = guardInteractionAndAllergyClear({
          allergyAlerts,
          interactionAlerts,
          overrideJustification: input.overrideJustification,
        });
        if (!guard.ok) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: guard.reason,
          });
        }

        const updated = await tx.prescription.update({
          where: { id: input.prescriptionId },
          data: {
            status: "Validated",
            version: lock.version + 1,
            validatedAt: new Date(),
            validatedById: ctx.user.id,
            validationCheck: {
              checks: input.checks,
              overrideJustification: input.overrideJustification ?? null,
              allergyAlerts,
              interactionAlerts,
            } as Prisma.InputJsonValue,
            updatedBy: ctx.user.id,
          },
          include: PRESCRIPTION_INCLUDE,
        });

        const auditId = await anchorPharmacyAudit(tx, {
          action: "SIGN",
          entity: "Prescription",
          entityId: input.prescriptionId,
          userId: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
          establishmentId: ctx.tenant.establishmentId ?? null,
          afterJson: {
            prescriptionId: input.prescriptionId,
            status: "Validated",
            version: lock.version + 1,
            validatedById: ctx.user.id,
          },
          justification: input.overrideJustification,
        });

        await publishEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          aggregateId: input.prescriptionId,
          eventType: "PrescriptionValidated",
          payload: {
            prescriptionId: input.prescriptionId,
            validatedById: ctx.user.id,
            allergyAlertCount: allergyAlerts.length,
            interactionAlertCount: interactionAlerts.length,
          },
          auditEntryId: auditId,
        });

        return updated;
      });

      return { prescription: toPrescriptionDto(out as never) };
    }),

  /** US-12.2 — rechazo farmacéutico (Prescribed -> Rejected). */
  reject: tenantProcedure
    .input(rejectPrescriptionInput)
    .mutation(async ({ ctx, input }) => {
      const out = await ctx.prisma.$transaction(async (tx) => {
        const lockRows = await tx.$queryRaw<
          Array<{ id: string; status: PrescriptionStatus; version: number }>
        >`
          SELECT id, status, version
            FROM public.prescription
           WHERE id = ${input.prescriptionId}::uuid
             AND "organizationId" = ${ctx.tenant.organizationId}::uuid
           FOR UPDATE;
        `;
        const lock = lockRows[0];
        if (!lock) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Prescripción no encontrada.",
          });
        }
        if (lock.version !== input.expectedVersion) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Conflicto de versión (expected=${input.expectedVersion}, actual=${lock.version}).`,
          });
        }
        if (!canTransition(lock.status, "Rejected")) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Transición inválida: ${lock.status} -> Rejected.`,
          });
        }

        const updated = await tx.prescription.update({
          where: { id: input.prescriptionId },
          data: {
            status: "Rejected",
            version: lock.version + 1,
            rejectedAt: new Date(),
            rejectedById: ctx.user.id,
            rejectionReason: input.reason,
            rejectionDetail: input.detail,
            updatedBy: ctx.user.id,
          },
          include: PRESCRIPTION_INCLUDE,
        });

        const auditId = await anchorPharmacyAudit(tx, {
          action: "UPDATE",
          entity: "Prescription",
          entityId: input.prescriptionId,
          userId: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
          establishmentId: ctx.tenant.establishmentId ?? null,
          afterJson: {
            prescriptionId: input.prescriptionId,
            status: "Rejected",
            reason: input.reason,
            detail: input.detail,
          },
          justification: input.detail,
        });

        await publishEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          aggregateId: input.prescriptionId,
          eventType: "PrescriptionRejected",
          payload: {
            prescriptionId: input.prescriptionId,
            reason: input.reason,
            detail: input.detail,
            rejectedById: ctx.user.id,
          },
          auditEntryId: auditId,
        });

        return updated;
      });

      return { prescription: toPrescriptionDto(out as never) };
    }),

  /** US-12.x — Discontinuación (* -> Discontinued). Audit con override justificado. */
  discontinue: tenantProcedure
    .input(discontinueInput)
    .mutation(async ({ ctx, input }) => {
      const out = await ctx.prisma.$transaction(async (tx) => {
        const lockRows = await tx.$queryRaw<
          Array<{ id: string; status: PrescriptionStatus; version: number }>
        >`
          SELECT id, status, version
            FROM public.prescription
           WHERE id = ${input.prescriptionId}::uuid
             AND "organizationId" = ${ctx.tenant.organizationId}::uuid
           FOR UPDATE;
        `;
        const lock = lockRows[0];
        if (!lock) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Prescripción no encontrada.",
          });
        }
        if (lock.version !== input.expectedVersion) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Conflicto de versión (expected=${input.expectedVersion}, actual=${lock.version}).`,
          });
        }
        if (!canTransition(lock.status, "Discontinued")) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Transición inválida: ${lock.status} -> Discontinued.`,
          });
        }

        const updated = await tx.prescription.update({
          where: { id: input.prescriptionId },
          data: {
            status: "Discontinued",
            version: lock.version + 1,
            discontinuedAt: new Date(),
            discontinuedById: ctx.user.id,
            discontinueReason: input.reason,
            updatedBy: ctx.user.id,
          },
          include: PRESCRIPTION_INCLUDE,
        });

        const auditId = await anchorPharmacyAudit(tx, {
          action: "UPDATE",
          entity: "Prescription",
          entityId: input.prescriptionId,
          userId: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
          establishmentId: ctx.tenant.establishmentId ?? null,
          afterJson: {
            prescriptionId: input.prescriptionId,
            status: "Discontinued",
            reason: input.reason,
            detail: input.detail,
          },
          justification: input.detail,
        });

        await publishEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          aggregateId: input.prescriptionId,
          eventType: "PrescriptionDiscontinued",
          payload: {
            prescriptionId: input.prescriptionId,
            reason: input.reason,
            detail: input.detail,
          },
          auditEntryId: auditId,
        });

        return updated;
      });

      return { prescription: toPrescriptionDto(out as never) };
    }),

  /** Vista detallada — incluye lines, dispensations y administrations. */
  get: tenantProcedure
    .input(getPrescriptionInput)
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.prescription.findFirst({
        where: {
          id: input.prescriptionId,
          organizationId: ctx.tenant.organizationId,
        },
        include: PRESCRIPTION_INCLUDE,
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prescripción no encontrada.",
        });
      }
      return { prescription: toPrescriptionDto(row as never) };
    }),

  /** Lista paginada con filtros opcionales. */
  list: tenantProcedure
    .input(listPrescriptionsInput)
    .query(async ({ ctx, input }) => {
      const where: Prisma.PrescriptionWhereInput = {
        organizationId: ctx.tenant.organizationId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.encounterId ? { encounterId: input.encounterId } : {}),
        ...(input.patientId ? { patientId: input.patientId } : {}),
      };
      const [rows, total] = await Promise.all([
        ctx.prisma.prescription.findMany({
          where,
          include: PRESCRIPTION_INCLUDE,
          orderBy: { createdAt: "desc" },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.prescription.count({ where }),
      ]);
      return {
        prescriptions: rows.map((r) => toPrescriptionDto(r as never)),
        total,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /** US-12.2 — cola farmacéutica (Prescribed pendientes de validación). */
  validationQueue: tenantProcedure
    .input(validationQueueInput)
    .query(async ({ ctx, input }) => {
      const where: Prisma.PrescriptionWhereInput = {
        organizationId: ctx.tenant.organizationId,
        status: "Prescribed",
      };
      const [rows, total] = await Promise.all([
        ctx.prisma.prescription.findMany({
          where,
          include: PRESCRIPTION_INCLUDE,
          orderBy: { signedAt: "asc" }, // FIFO
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.prescription.count({ where }),
      ]);
      return {
        prescriptions: rows.map((r) => toPrescriptionDto(r as never)),
        total,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /** US-12.4 — cola eMAR (próximas dosis a administrar). */
  emarQueue: tenantProcedure
    .input(emarQueueInput)
    .query(async ({ ctx, input }) => {
      const _windowMs = input.windowHours * 60 * 60 * 1000;
      // Wave 1 simplificación: devolvemos todas las Dispensed/Administered con
      // dispensaciones activas. El cálculo de scheduled times concretos vive en
      // el cliente eMAR (basado en frequency + signedAt).
      const where: Prisma.PrescriptionWhereInput = {
        organizationId: ctx.tenant.organizationId,
        status: { in: ["Dispensed", "Administered"] },
      };
      const rows = await ctx.prisma.prescription.findMany({
        where,
        include: PRESCRIPTION_INCLUDE,
        orderBy: { signedAt: "asc" },
        take: 50,
      });
      return {
        prescriptions: rows.map((r) => toPrescriptionDto(r as never)),
      };
    }),
});

// ---------------------------------------------------------------------------
// Sub-router: dispense (US-12.3)
// ---------------------------------------------------------------------------

const dispenseSubRouter = router({
  /**
   * US.F2.6.10 — Cross-check alergias paciente vs medicamento (server-side, hard stop).
   *
   * Carga Drug.allergyFamilies (principios activos) y Drug.allergyExcipients,
   * luego los cruza contra PatientAllergy (v1) + AllergyIntolerance (v2) activos.
   *
   * Devuelve:
   *   ok       — sin alertas, dispensación puede continuar.
   *   warning  — excipiente alergénico detectado; requiere confirmación farmacéutico.
   *   hardStop — principio activo alergénico; bloquea la dispensación.
   *
   * Al detectar hardStop, publica `pharmacy.allergy-detected` al outbox (farmacovigilancia).
   * La confirmación de warning se persiste en audit_log por el caller (UI).
   */
  checkAllergies: tenantProcedure
    .input(checkAllergiesInput)
    .mutation(async ({ ctx, input }) => {
      return await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Carga fármaco con datos de alergia.
        const drug = await tx.drug.findFirst({
          where: {
            id: input.drugId,
            OR: [
              { organizationId: null },
              { organizationId: ctx.tenant.organizationId },
            ],
          },
          select: {
            id: true,
            name: true,
            allergyFamilies: true,
            allergyExcipients: true,
          },
        });
        if (!drug) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Fármaco no encontrado en catálogo.",
          });
        }

        // Carga alergias del paciente — v1 (PatientAllergy) + v2 (AllergyIntolerance).
        const [v1Allergies, v2Intolerances] = await Promise.all([
          tx.patientAllergy.findMany({
            where: { patientId: input.patientId, active: true },
            select: { id: true, substanceText: true, severity: true, active: true },
          }),
          tx.allergyIntolerance.findMany({
            where: {
              patientId: input.patientId,
              clinicalStatus: "active",
              verificationStatus: { notIn: ["refuted", "entered_in_error"] },
            },
            select: { id: true, substanceDisplay: true, criticality: true, clinicalStatus: true },
          }),
        ]);

        const result = evaluateAllergyCheck(drug, v1Allergies, v2Intolerances);

        // Al detectar hard stop: publicar evento farmacovigilancia al outbox.
        if (result.status === "hardStop") {
          const dedupKey = `${input.patientId}|${input.drugId}|pharmacy.allergy-detected|${
            result.matches.map((m) => m.allergyId).sort().join(",")
          }`;
          try {
            await tx.domainEvent.create({
              data: {
                organizationId: ctx.tenant.organizationId,
                aggregate: "pharmacy",
                aggregateId: input.drugId,
                eventType: "pharmacy.allergy-detected",
                payload: {
                  patientId: input.patientId,
                  drugId: input.drugId,
                  drugName: drug.name,
                  gtin: input.gtin ?? null,
                  matches: result.matches,
                  detectedAt: new Date().toISOString(),
                  detectedById: ctx.user.id,
                } as Prisma.InputJsonValue,
                dedupKey,
                auditEntryId: null,
              },
            });
          } catch (e: unknown) {
            if (
              !(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
            ) {
              throw e;
            }
            // Dedup: evento ya publicado — ok.
          }
        }

        return result;
      });
    }),

  /**
   * US-12.3 — Dispensación unidosis (Validated -> Dispensed).
   * Bloquea si algún lote está vencido. Genera item barcode UNIQUE.
   */
  create: tenantProcedure
    .input(dispensationInputSchema)
    .mutation(async ({ ctx, input }) => {
      const out = await ctx.prisma.$transaction(async (tx) => {
        const lockRows = await tx.$queryRaw<
          Array<{ id: string; status: PrescriptionStatus; version: number }>
        >`
          SELECT id, status, version
            FROM public.prescription
           WHERE id = ${input.prescriptionId}::uuid
             AND "organizationId" = ${ctx.tenant.organizationId}::uuid
           FOR UPDATE;
        `;
        const lock = lockRows[0];
        if (!lock) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Prescripción no encontrada.",
          });
        }
        if (lock.version !== input.expectedVersion) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Conflicto de versión (expected=${input.expectedVersion}, actual=${lock.version}).`,
          });
        }
        if (!canTransition(lock.status, "Dispensed")) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Transición inválida: ${lock.status} -> Dispensed.`,
          });
        }

        // Validar lotes (no vencidos).
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (const line of input.lines) {
          if (line.expiryDate < today) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `Lote ${line.lotNumber} vencido (${line.expiryDate.toISOString().slice(0, 10)}). No se permite dispensar.`,
            });
          }
        }

        // Cargar líneas para construir barcodes.
        const lineIds = input.lines.map((l) => l.prescriptionLineId);
        const lineRows = await tx.prescriptionLine.findMany({
          where: { id: { in: lineIds }, prescriptionId: input.prescriptionId },
          include: { drug: true },
        });
        if (lineRows.length !== input.lines.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Una o más líneas no pertenecen a la prescripción.",
          });
        }

        // Generar dispensaciones con barcode determinístico.
        const createdDispensations: Array<{ id: string; itemBarcode: string }> =
          [];
        for (let i = 0; i < input.lines.length; i++) {
          const inLine = input.lines[i];
          const matched = lineRows.find(
            (r) => r.id === inLine.prescriptionLineId,
          );
          if (!matched) continue;
          const barcode = buildItemBarcode(
            matched.drug.atcCode,
            inLine.lotNumber,
            i + 1,
          );
          const disp = await tx.dispensationEvent.create({
            data: {
              prescriptionId: input.prescriptionId,
              prescriptionLineId: matched.id,
              organizationId: ctx.tenant.organizationId,
              units: inLine.units,
              lotNumber: inLine.lotNumber,
              expiryDate: inLine.expiryDate,
              itemBarcode: barcode,
              dispensedById: ctx.user.id,
            },
            select: { id: true, itemBarcode: true },
          });
          createdDispensations.push(disp);
        }

        const updated = await tx.prescription.update({
          where: { id: input.prescriptionId },
          data: {
            status: "Dispensed",
            version: lock.version + 1,
            updatedBy: ctx.user.id,
          },
          include: PRESCRIPTION_INCLUDE,
        });

        const auditId = await anchorPharmacyAudit(tx, {
          action: "SIGN",
          entity: "DispensationEvent",
          entityId: input.prescriptionId,
          userId: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
          establishmentId: ctx.tenant.establishmentId ?? null,
          afterJson: {
            prescriptionId: input.prescriptionId,
            dispensations: createdDispensations,
          },
        });

        await publishEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          aggregateId: input.prescriptionId,
          eventType: "MedicationDispensed",
          payload: {
            prescriptionId: input.prescriptionId,
            dispensations: createdDispensations,
            dispensedById: ctx.user.id,
          },
          auditEntryId: auditId,
        });

        return updated;
      });

      return { prescription: toPrescriptionDto(out as never) };
    }),
});

// ---------------------------------------------------------------------------
// Sub-router: administer (US-12.4 + US-12.5)
// ---------------------------------------------------------------------------

const administerSubRouter = router({
  /**
   * US-12.4 — registra administración con 5R.
   * - UNIQUE (prescriptionLineId, scheduledTime) → idempotencia (doble-tap).
   * - Si drug.isHighRisk → exige secondNurseId distinto del firstNurse.
   * - Si fiveRights falla → 412 + log de intento (audit).
   */
  record: tenantProcedure
    .input(administerInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Cargar línea + drug + prescription (incluyendo el patient identifier).
      const line = await ctx.prisma.prescriptionLine.findFirst({
        where: {
          id: input.prescriptionLineId,
          organizationId: ctx.tenant.organizationId,
        },
        include: {
          drug: true,
          prescription: { select: { id: true, status: true, patientId: true } },
        },
      });
      if (!line) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Línea de prescripción no encontrada.",
        });
      }
      const rx = line.prescription;
      if (rx.status !== "Dispensed" && rx.status !== "Administered") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `No se puede administrar: prescripción en estado ${rx.status}.`,
        });
      }

      // Recuperar la dispensación correspondiente (primera no consumida).
      const disp = await ctx.prisma.dispensationEvent.findFirst({
        where: {
          prescriptionLineId: line.id,
          organizationId: ctx.tenant.organizationId,
        },
        orderBy: { dispensedAt: "asc" },
      });
      if (!disp) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No hay dispensación previa para esta línea.",
        });
      }

      // Cargar identificador del paciente (E5 wristband — usamos patient.id como
      // proxy estable en Wave 1; en Wave 2 será un código de pulsera dedicado).
      const patient = await ctx.prisma.patient.findFirst({
        where: { id: rx.patientId },
        select: { id: true },
      });
      if (!patient) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paciente no encontrado.",
        });
      }

      // Guard 5R.
      const fiveR = guardFiveRights(input.fiveRights, {
        patientCode: patient.id, // TODO[Wave 2]: campo Patient.wristbandCode
        medicationBarcode: disp.itemBarcode,
        scheduledTime: input.scheduledTime,
        expectedRoute: line.route as never,
        expectedDose: Number(line.dose.toString()),
      });
      if (!fiveR.ok) {
        // Registrar intento fallido para auditoría (no inserta administración).
        await anchorPharmacyAudit(ctx.prisma as Prisma.TransactionClient, {
          action: "UPDATE",
          entity: "AdministrationEvent",
          entityId: line.id,
          userId: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
          establishmentId: ctx.tenant.establishmentId ?? null,
          afterJson: {
            outcome: "FIVE_RIGHTS_FAILED",
            failedRight: fiveR.failedRight,
            attempt: input.fiveRights,
          },
          justification: fiveR.reason,
        });
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: fiveR.reason,
        });
      }

      // Guard doble verificación.
      const drugIsHighRisk =
        line.drug.isHighRisk || isHighRiskAtc(line.drug.atcCode);
      const dvGuard = guardDoubleVerification({
        isHighRisk: drugIsHighRisk,
        firstNurseId: ctx.user.id,
        secondNurseId: input.secondNurseId ?? null,
      });
      if (!dvGuard.ok) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: dvGuard.reason,
        });
      }

      // Inserción idempotente (UNIQUE (line, scheduledTime)).
      const out = await ctx.prisma.$transaction(async (tx) => {
        let event;
        try {
          event = await tx.administrationEvent.create({
            data: {
              prescriptionId: rx.id,
              prescriptionLineId: line.id,
              organizationId: ctx.tenant.organizationId,
              scheduledTime: input.scheduledTime,
              administeredAt: input.fiveRights.administeredAt,
              administeredById: ctx.user.id,
              secondNurseId: input.secondNurseId ?? null,
              doubleVerified: !!input.secondNurseId,
              fiveRightsSnapshot:
                input.fiveRights as unknown as Prisma.InputJsonValue,
              fiveRightsOk: true,
              notes: input.notes ?? null,
            },
          });
        } catch (e: unknown) {
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === "P2002"
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Ya existe una administración registrada para este slot (idempotente).",
            });
          }
          throw e;
        }

        // Actualizar prescription a Administered (ciclo permitido Admin->Admin).
        if (rx.status !== "Administered") {
          const cur = await tx.prescription.findUniqueOrThrow({
            where: { id: rx.id },
            select: { version: true },
          });
          await tx.prescription.update({
            where: { id: rx.id },
            data: {
              status: "Administered",
              version: cur.version + 1,
              updatedBy: ctx.user.id,
            },
          });
        }

        const auditId = await anchorPharmacyAudit(tx, {
          action: "SIGN",
          entity: "AdministrationEvent",
          entityId: event.id,
          userId: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
          establishmentId: ctx.tenant.establishmentId ?? null,
          afterJson: {
            administrationId: event.id,
            prescriptionId: rx.id,
            prescriptionLineId: line.id,
            scheduledTime: input.scheduledTime.toISOString(),
            doubleVerified: !!input.secondNurseId,
          },
        });

        await tx.administrationEvent.update({
          where: { id: event.id },
          data: { auditEntryId: auditId },
        });

        await publishEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          aggregateId: rx.id,
          eventType: "MedicationAdministered",
          payload: {
            administrationId: event.id,
            prescriptionId: rx.id,
            prescriptionLineId: line.id,
            administeredById: ctx.user.id,
            doubleVerified: !!input.secondNurseId,
            scheduledTime: input.scheduledTime.toISOString(),
          },
          auditEntryId: auditId,
          dedupSuffix: `${line.id}|${input.scheduledTime.toISOString()}`,
        });

        return event;
      });

      return {
        administration: {
          id: out.id,
          prescriptionLineId: out.prescriptionLineId,
          scheduledTime: out.scheduledTime,
          administeredAt: out.administeredAt,
          doubleVerified: out.doubleVerified,
          fiveRightsOk: out.fiveRightsOk,
        },
      };
    }),
});

// ---------------------------------------------------------------------------
// Sub-router: ledger (US-12.6 — Libro DNM)
// ---------------------------------------------------------------------------

const ledgerSubRouter = router({
  /** US-12.6 — asiento DNM con folio gapless + hash-chain local. */
  recordEntry: tenantProcedure
    .input(ledgerEntryInput)
    .mutation(async ({ ctx, input }) => {
      // Solo se permiten asientos para fármacos controlados (clase II/III/IV).
      const drug = await ctx.prisma.drug.findFirst({
        where: { id: input.drugId },
        select: { controlledClass: true, atcCode: true, name: true },
      });
      if (!drug) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Fármaco no encontrado.",
        });
      }
      if (drug.controlledClass === "NONE") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "El libro DNM solo admite fármacos controlados (clase II/III/IV).",
        });
      }

      const out = await ctx.prisma.$transaction(async (tx) => {
        const folioRows = await tx.$queryRaw<Array<{ folio: bigint }>>`
          SELECT public.fn_next_controlled_folio(${ctx.tenant.organizationId}::uuid) AS folio;
        `;
        const folio = folioRows[0]?.folio ?? 0n;

        // El trigger BEFORE INSERT calcula prevHash + currHash.
        const entry = await tx.controlledSubstanceLedger.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            folio,
            drugId: input.drugId,
            kind: input.kind,
            units: input.units,
            lotNumber: input.lotNumber,
            documentRef: input.documentRef,
            patientId: input.patientId ?? null,
            notes: input.notes ?? null,
            currHash: "PENDING", // sobreescrito por trigger
            recordedById: ctx.user.id,
          },
        });

        const auditId = await anchorPharmacyAudit(tx, {
          action: "CREATE",
          entity: "ControlledSubstanceLedger",
          entityId: entry.id,
          userId: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
          establishmentId: ctx.tenant.establishmentId ?? null,
          afterJson: {
            entryId: entry.id,
            folio: entry.folio.toString(),
            drugId: input.drugId,
            drugName: drug.name,
            kind: input.kind,
            units: input.units,
            lotNumber: input.lotNumber,
            documentRef: input.documentRef,
            currHash: entry.currHash,
          },
        });

        await tx.controlledSubstanceLedger.update({
          where: { id: entry.id },
          data: { auditEntryId: auditId },
        });

        await publishEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          aggregateId: entry.id,
          eventType: "ControlledSubstanceLogged",
          payload: {
            entryId: entry.id,
            folio: entry.folio.toString(),
            drugId: input.drugId,
            kind: input.kind,
            units: input.units,
          },
          auditEntryId: auditId,
          dedupSuffix: `dnm-${entry.folio}`,
        });

        return entry;
      });

      return {
        entryId: out.id,
        folio: out.folio.toString(),
        currHash: out.currHash,
      };
    }),

  /** Lista paginada del libro DNM. */
  list: tenantProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
        drugId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.ControlledSubstanceLedgerWhereInput = {
        organizationId: ctx.tenant.organizationId,
        ...(input.drugId ? { drugId: input.drugId } : {}),
      };
      const [rows, total] = await Promise.all([
        ctx.prisma.controlledSubstanceLedger.findMany({
          where,
          orderBy: { folio: "desc" },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          include: {
            drug: {
              select: { id: true, name: true, atcCode: true },
            },
          },
        }),
        ctx.prisma.controlledSubstanceLedger.count({ where }),
      ]);
      return {
        entries: rows.map((r) => ({
          id: r.id,
          folio: r.folio.toString(),
          drugId: r.drugId,
          drugName: r.drug.name,
          drugAtc: r.drug.atcCode,
          kind: r.kind,
          units: r.units,
          lotNumber: r.lotNumber,
          documentRef: r.documentRef,
          patientId: r.patientId,
          notes: r.notes,
          prevHash: r.prevHash,
          currHash: r.currHash,
          recordedAt: r.recordedAt,
          recordedById: r.recordedById,
        })),
        total,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),
});

// ---------------------------------------------------------------------------
// Sub-router: catalog (autocomplete CPOE)
// ---------------------------------------------------------------------------

const catalogSubRouter = router({
  /** Búsqueda en el catálogo de fármacos por nombre o ATC. */
  searchDrug: tenantProcedure
    .input(
      z.object({
        q: z.string().trim().min(1).max(60),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.drug.findMany({
        where: {
          active: true,
          OR: [
            { organizationId: null }, // catálogo global
            { organizationId: ctx.tenant.organizationId },
          ],
          AND: [
            {
              OR: [
                { name: { contains: input.q, mode: "insensitive" } },
                { atcCode: { contains: input.q.toUpperCase() } },
              ],
            },
          ],
        },
        orderBy: { name: "asc" },
        take: input.limit,
      });
      return {
        drugs: rows.map((d) => ({
          id: d.id,
          atcCode: d.atcCode,
          name: d.name,
          strength: d.strength,
          form: d.form,
          defaultRoute: d.defaultRoute,
          controlledClass: d.controlledClass,
          isHighRisk: d.isHighRisk,
          allergyFamilies: d.allergyFamilies,
        })),
      };
    }),
});

// ---------------------------------------------------------------------------
// Router agregado
// ---------------------------------------------------------------------------

export const pharmacyRouter = router({
  prescription: prescriptionSubRouter,
  dispense: dispenseSubRouter,
  administer: administerSubRouter,
  ledger: ledgerSubRouter,
  catalog: catalogSubRouter,
});
