/**
 * §15 Pharmacy — router (Sprint 4 / Phase 4 + Beta.2 hardening).
 *
 * Beta.2 (2026-05-13):
 * - State machine validada (canTransitionPrescription) en sign/dispense.
 * - Interaction checks al firmar (`prescription.sign` carga dataset estático
 *   y emite alertas; bloquea si major/contraindicated salvo override).
 * - Dispense bloqueado para lotes expirados (validateLotForDispense) y para
 *   prescriptions en estado no-dispensable.
 * - RX_CONTROLLED requiere campo justification + actor secundario (2-eyes)
 *   en el input. Si falta → FORBIDDEN.
 * - Soporte de `forceOverrideJustification` para validacion mayor con
 *   justificacion auditada.
 *
 * Dataset interacciones: carga `packages/database/seed/drug-interactions.json`
 * en memoria al iniciar (Wave 2: reemplazar con Lexicomp/Vademecum).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
// Importación directa del schema de farmacia para evitar ciclo ESM con el
// barrel de @his/contracts en contexto de tests vitest.
import {
  drugListInput,
  drugCreateInput,
  prescriptionCreateInput,
  prescriptionSignInput,
  prescriptionListInput,
  dispenseCreateInput,
  detectInteractionAlerts,
  hasBlockingInteraction,
  validateLotForDispense,
  isControlledDispensingClass,
  isHighRiskAtc,
  canTransitionPrescription,
  type DrugInteractionEntry,
  type PrescriptionStatusType,
  type PharmacyInteractionAlert,
} from "../../../contracts/src/schemas/pharmacy";
import type { DrugInteractionPayload } from "../../../contracts/src/events/payloads";
import * as Database from "@his/database";
import { router, tenantProcedure } from "../trpc";

/**
 * Beta.15 — mapea severities del helper Pharmacy (minor/moderate/major/
 * contraindicated) al enum del payload Zod (`CRITICAL`/`WARNING`).
 * Toma la "peor" severity entre las alertas detectadas como severity del evento.
 */
function worstInteractionSeverity(
  alerts: PharmacyInteractionAlert[],
): "CRITICAL" | "WARNING" {
  for (const a of alerts) {
    if (a.severity === "major" || a.severity === "contraindicated") {
      return "CRITICAL";
    }
  }
  return "WARNING";
}

/**
 * Beta.15 — construye lista única de Drug.id en conflicto a partir de las
 * alertas + items de la prescripción. El payload Zod exige `min(2)`. Si por
 * cualquier razón el mapeo no llega a 2 IDs, retorna null y el caller no
 * emite el evento (defensa contra payloads inválidos).
 */
function buildConflictingDrugIds(
  alerts: PharmacyInteractionAlert[],
  items: Array<{ drug: { id: string; atcCode: string | null } }>,
): string[] | null {
  const atcsInAlerts = new Set<string>();
  for (const a of alerts) {
    atcsInAlerts.add(a.atcA.toUpperCase());
    atcsInAlerts.add(a.atcB.toUpperCase());
  }
  const ids = new Set<string>();
  for (const it of items) {
    const code = (it.drug.atcCode ?? "").toUpperCase();
    if (code && atcsInAlerts.has(code)) ids.add(it.drug.id);
  }
  if (ids.size < 2) return null;
  return Array.from(ids);
}

// ---------------------------------------------------------------------------
// Dataset estático de interacciones (Wave 1)
// ---------------------------------------------------------------------------

interface InteractionsJson {
  version: string;
  source: string;
  entries: DrugInteractionEntry[];
}

function loadInteractionsDataset(): DrugInteractionEntry[] {
  try {
    const candidates = [
      path.resolve(process.cwd(), "packages/database/seed/drug-interactions.json"),
      path.resolve(__dirname, "../../../database/seed/drug-interactions.json"),
      path.resolve(__dirname, "../../../../packages/database/seed/drug-interactions.json"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf8");
        const parsed = JSON.parse(raw) as InteractionsJson;
        return parsed.entries;
      }
    }
  } catch {
    // En tests el archivo puede no estar; devolvemos vacío para que el
    // router no bloquee si no hay seed.
  }
  return [];
}

// Singleton perezoso para permitir tests con dataset inyectado.
let cachedDataset: DrugInteractionEntry[] | null = null;
function getInteractionsDataset(): DrugInteractionEntry[] {
  if (cachedDataset === null) cachedDataset = loadInteractionsDataset();
  return cachedDataset;
}

/** Exportado sólo para tests — permite resetear el dataset entre tests. */
export function _resetInteractionsDatasetForTesting(
  newDataset?: DrugInteractionEntry[],
): void {
  cachedDataset = newDataset ?? null;
}

// ---------------------------------------------------------------------------
// Extended inputs (Beta.2) — lazy para evitar TDZ en ciclos ESM de tests.
// ---------------------------------------------------------------------------

function getPrescriptionSignWithOverrideInput() {
  return prescriptionSignInput.extend({
    /** Justificación obligatoria si hay interaction major/contraindicated. */
    forceOverrideJustification: z.string().trim().min(10).max(2000).optional(),
  });
}

function getDispenseCreateExtendedInput() {
  return dispenseCreateInput.extend({
    /** Para RX_CONTROLLED: justificación legal del 2-eyes (mínimo 10 chars). */
    controlledJustification: z.string().trim().min(10).max(2000).optional(),
    /** Para RX_CONTROLLED: usuario testigo (no puede ser el mismo dispensador). */
    witnessUserId: z.string().uuid().optional(),
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const pharmacyRouter = router({
  drug: router({
    list: tenantProcedure.input(drugListInput).query(async ({ ctx, input }) => {
      return ctx.prisma.drug.findMany({
        where: {
          OR: [
            { organizationId: null }, // catálogo global
            { organizationId: ctx.tenant.organizationId },
          ],
          ...(input.activeOnly && { active: true }),
          ...(input.dispensingClass && { dispensingClass: input.dispensingClass }),
          ...(input.search && {
            OR: [
              { genericName: { contains: input.search, mode: "insensitive" } },
              { brandName: { contains: input.search, mode: "insensitive" } },
              { atcCode: { contains: input.search, mode: "insensitive" } },
            ],
          }),
        },
        orderBy: { genericName: "asc" },
        take: input.limit,
      });
    }),

    create: tenantProcedure
      .input(drugCreateInput)
      .mutation(async ({ ctx, input }) => {
        // Si organizationId viene null, es catálogo global — sólo service_role
        // debería poder crearlo, pero validación fina se delega a permission check.
        return ctx.prisma.drug.create({
          data: {
            ...input,
            organizationId: input.organizationId ?? ctx.tenant.organizationId,
          },
        });
      }),
  }),

  prescription: router({
    list: tenantProcedure
      .input(prescriptionListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.prescription.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(input.encounterId && { encounterId: input.encounterId }),
            ...(input.patientId && { patientId: input.patientId }),
            ...(input.prescriberId && { prescriberId: input.prescriberId }),
            ...(input.fromDate && { prescribedAt: { gte: input.fromDate } }),
            ...(input.costCenterId && { costCenterId: input.costCenterId }),
          },
          include: { items: { include: { drug: true } } },
          orderBy: { prescribedAt: "desc" },
          take: input.limit,
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const presc = await ctx.prisma.prescription.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
          include: { items: { include: { drug: true, dispenses: true } } },
        });
        if (!presc) throw new TRPCError({ code: "NOT_FOUND" });
        return presc;
      }),

    create: tenantProcedure
      .input(prescriptionCreateInput)
      .mutation(async ({ ctx, input }) => {
        const enc = await ctx.prisma.encounter.findFirst({
          where: { id: input.encounterId, organizationId: ctx.tenant.organizationId },
          select: { id: true, patientId: true },
        });
        if (!enc) throw new TRPCError({ code: "NOT_FOUND", message: "Encuentro no existe en la organización." });
        if (enc.patientId !== input.patientId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "patientId no coincide con encounter." });
        }
        return ctx.prisma.prescription.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            encounterId: input.encounterId,
            patientId: input.patientId,
            prescriberId: ctx.user.id,
            notes: input.notes ?? null,
            ...(input.costCenterId && { costCenterId: input.costCenterId }),
            items: { create: input.items },
          },
          include: { items: true },
        });
      }),

    /**
     * Beta.2 — Sign con interaction check.
     * - Carga drugs de los items para extraer atcCodes.
     * - Cruza contra dataset de interacciones.
     * - Si hay major/contraindicated → bloquea salvo `forceOverrideJustification`.
     * - State machine: solo DRAFT → SIGNED permitida aquí.
     */
    sign: tenantProcedure
      .input(getPrescriptionSignWithOverrideInput())
      .mutation(async ({ ctx, input }) => {
        const presc = await ctx.prisma.prescription.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
          // Beta.15: prescriberId requerido para el payload del evento.
          select: { id: true, status: true, prescriberId: true },
        });
        if (!presc) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Receta no encontrada.",
          });
        }
        if (
          !canTransitionPrescription(
            presc.status as PrescriptionStatusType,
            "SIGNED",
          )
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Transición inválida: ${presc.status} → SIGNED.`,
          });
        }

        const items = await ctx.prisma.prescriptionItem.findMany({
          where: { prescriptionId: presc.id },
          // Beta.15: drug.id requerido para `conflictingDrugIds` del payload.
          include: {
            drug: { select: { id: true, atcCode: true, genericName: true } },
          },
        });
        const alerts = detectInteractionAlerts(
          items.map((it) => ({ atcCode: it.drug.atcCode, name: it.drug.genericName })),
          getInteractionsDataset(),
        );

        if (hasBlockingInteraction(alerts) && !input.forceOverrideJustification) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              `Se detectaron interacciones mayor/contraindicadas (${alerts.length}). Requiere justificación de override.`,
            cause: { alerts } as unknown as Error,
          });
        }

        // Beta.15 (US.B15.4.3 — drug.interaction): si hay alerts y el sign
        // procede (override o no-blocking), emitimos evento en la misma tx
        // del update. `conflictingDrugIds` resuelto a partir de los items;
        // si <2 IDs únicos, no emitimos (payload Zod requiere min 2).
        const conflictingDrugIds = alerts.length > 0
          ? buildConflictingDrugIds(alerts, items)
          : null;
        const shouldEmit = alerts.length > 0 && conflictingDrugIds !== null;

        await ctx.prisma.$transaction(async (tx) => {
          await tx.prescription.update({
            where: { id: presc.id },
            data: {
              status: "SIGNED",
              signedAt: new Date(),
              ...(input.forceOverrideJustification && {
                notes: appendOverrideNote(input.forceOverrideJustification, alerts),
              }),
            },
          });
          if (shouldEmit) {
            const description = alerts
              .map((a) => a.description)
              .join("; ")
              .slice(0, 500);
            const payload: DrugInteractionPayload = {
              prescriptionId: presc.id,
              prescriberId: presc.prescriberId,
              conflictingDrugIds: conflictingDrugIds!,
              severity: worstInteractionSeverity(alerts),
              description,
            };
            await Database.emitDomainEvent(tx, {
              organizationId: ctx.tenant.organizationId,
              eventType: "drug.interaction",
              aggregateType: "Prescription",
              aggregateId: presc.id,
              emittedById: ctx.user.id,
              payload,
            });
          }
        });
        return { ok: true as const, alerts };
      }),
  }),

  dispense: router({
    /**
     * Beta.2 — Dispense con validaciones:
     * - prescription debe estar SIGNED o PARTIALLY_DISPENSED.
     * - Si batchNumber + expiryDate provistos → valida no-expirado.
     * - Si drug.dispensingClass = RX_CONTROLLED → exige
     *   `controlledJustification` + `witnessUserId` (distinto de dispensador).
     * - Si drug isHighRisk → exige `witnessUserId` (sin justification obligatoria,
     *   pero recomendada).
     */
    create: tenantProcedure
      .input(getDispenseCreateExtendedInput())
      .mutation(async ({ ctx, input }) => {
        // Verifica que el item pertenezca a una prescription dispensable de la misma org.
        const item = await ctx.prisma.prescriptionItem.findFirst({
          where: {
            id: input.prescriptionItemId,
            prescription: {
              organizationId: ctx.tenant.organizationId,
              status: { in: ["SIGNED", "PARTIALLY_DISPENSED"] },
            },
          },
          include: {
            drug: {
              select: {
                id: true,
                atcCode: true,
                dispensingClass: true,
                genericName: true,
              },
            },
          },
        });
        if (!item) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Ítem no existe, no firmado, o ya dispensado.",
          });
        }

        // Beta.2 — Validar lote si vienen batchNumber + expiryDate.
        if (input.batchNumber && input.expiryDate) {
          const v = validateLotForDispense(
            {
              lotNumber: input.batchNumber,
              expiryDate: input.expiryDate,
              // Wave 1: no DrugStock todavía; stock asumido suficiente. Wave 2 valida.
              stockQuantity: Number.MAX_SAFE_INTEGER,
            },
            input.quantity,
          );
          if (!v.ok) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: v.reason,
            });
          }
        }

        // Beta.2 — Validar 2-eyes para RX_CONTROLLED.
        if (isControlledDispensingClass(item.drug.dispensingClass)) {
          if (!input.witnessUserId) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `Fármaco controlado (${item.drug.genericName}) requiere usuario testigo (witnessUserId).`,
            });
          }
          if (input.witnessUserId === ctx.user.id) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "El testigo de fármaco controlado debe ser distinto del dispensador.",
            });
          }
          if (!input.controlledJustification) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Fármaco controlado requiere justificación documentada.",
            });
          }
        }

        // Beta.2 — Validar witness para high-risk si no es controlled (recomendado).
        if (
          !isControlledDispensingClass(item.drug.dispensingClass) &&
          isHighRiskAtc(item.drug.atcCode) &&
          !input.witnessUserId
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Fármaco de alto riesgo (${item.drug.genericName}, ATC ${item.drug.atcCode}) requiere usuario testigo.`,
          });
        }
        if (input.witnessUserId === ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "El testigo no puede ser el mismo dispensador.",
          });
        }

        // Resolver centro de costo dispensador: usa el que viene en input o
        // intenta auto-sugerir 2-FAR-HOS del tenant. Si no existe en BD, queda null.
        let resolvedCostCenterId: string | null = input.costCenterId ?? null;
        if (!resolvedCostCenterId) {
          const farmaciaCc = await ctx.prisma.costCenter.findFirst({
            where: { code: "2-FAR-HOS", organizationId: ctx.tenant.organizationId },
            select: { id: true },
          });
          resolvedCostCenterId = farmaciaCc?.id ?? null;
        }

        return ctx.prisma.medicationDispense.create({
          data: {
            prescriptionItemId: input.prescriptionItemId,
            dispensedById: ctx.user.id,
            quantity: input.quantity,
            batchNumber: input.batchNumber ?? null,
            expiryDate: input.expiryDate ?? null,
            notes: composeDispenseNotes(input),
            ...(resolvedCostCenterId && { costCenterId: resolvedCostCenterId }),
          },
        });
      }),
  }),
});

// ---------------------------------------------------------------------------
// Helpers privados
// ---------------------------------------------------------------------------

function appendOverrideNote(
  justification: string,
  alerts: PharmacyInteractionAlert[],
): string {
  const ts = new Date().toISOString();
  const alertSummary = alerts
    .map((a) => `${a.atcA}↔${a.atcB} [${a.severity}]`)
    .join("; ");
  return `[${ts}] [OVERRIDE INTERACTIONS: ${alertSummary}] ${justification}`;
}

function composeDispenseNotes(input: {
  notes?: string | null;
  controlledJustification?: string | null;
  witnessUserId?: string | null;
}): string | null {
  const parts: string[] = [];
  if (input.notes) parts.push(input.notes);
  if (input.controlledJustification) {
    parts.push(`[CONTROLLED:${input.controlledJustification}]`);
  }
  if (input.witnessUserId) {
    parts.push(`[witness:${input.witnessUserId}]`);
  }
  return parts.length > 0 ? parts.join(" | ") : null;
}
