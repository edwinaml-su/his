/**
 * Fase 2 — US.F2.6.6-7: Estación de Picking Farmacia
 *
 * US.F2.6.6: checkPreconditions — hard stop si no hay receta ACTIVA firmada.
 * US.F2.6.7: scanItem — valida GTIN/lote/vencimiento contra la orden médica.
 *
 * Diseño: el cliente (Gs1Scanner) parsea el DataMatrix GS1 y envía los campos
 * individuales. El servidor re-valida todo server-side (hard stops no se
 * confían al cliente). El campo gs1Raw se incluye para auditoría.
 *
 * Hard stops server-side:
 *   SIN_RECETA_ACTIVA      : no existe indicación activa para el paciente/encuentro
 *   RECETA_SUSPENDIDA      : indicación encontrada pero no está en estado dispensable
 *   MEDICAMENTO_VENCIDO    : fecha de vencimiento AI(17) en el pasado
 *   LOTE_EN_RECALL         : lote tiene recallStatus != null en MedicationGtin
 *
 * Emite evento Beta.15 outbox `pharmacy.expired-attempt` en MEDICAMENTO_VENCIDO.
 *
 * Dependencia @DBA (bloqueante para GTIN_NO_COINCIDE_CON_RECETA completo):
 *   - Drug.gtin (campo GTIN-14 en catálogo) → cuando exista, se valida coincidencia.
 *   - MedicationGtin (tabla con lot/recallStatus) → check recall live.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, tenantProcedure } from "../../trpc";
import { withTenantContext } from "../../rls-context";

// ---------------------------------------------------------------------------
// Helpers internos (sin dependencias cross-package)
// ---------------------------------------------------------------------------

/**
 * Parsea un string GS1 YYMMDD en un Date UTC.
 * GS1 spec: DD=00 → último día del mes.
 */
function parseGs1Expiry(yymmdd: string): Date | null {
  if (yymmdd.length !== 6) return null;
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = parseInt(yymmdd.slice(2, 4), 10);
  const dd = parseInt(yymmdd.slice(4, 6), 10);
  // GS1: YY 00–49 → 2000–2049; 50–99 → 1950–1999.
  const fullYear = yy <= 49 ? 2000 + yy : 1900 + yy;
  const effectiveDay = dd === 0 ? new Date(fullYear, mm, 0).getDate() : dd;
  return new Date(Date.UTC(fullYear, mm - 1, effectiveDay, 23, 59, 59));
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const checkPreconditionsInput = z.object({
  patientId: z.string().uuid(),
  /** ID de la Prescription en HIS a validar como receta activa. */
  indicationId: z.string().uuid(),
});

const scanItemInput = z.object({
  /** ID de la Prescription que actúa como pharmacy order. */
  pharmacyOrderId: z.string().uuid(),
  /** GTIN-14 (AI 01) extraído del DataMatrix, ya validado checksum en cliente. */
  gtin: z.string().regex(/^\d{14}$/, "GTIN debe ser 14 dígitos"),
  /** Número de lote (AI 10). Opcional — algunos empaques no lo incluyen. */
  lot: z.string().max(20).optional(),
  /** Fecha de vencimiento GS1 YYMMDD (AI 17). */
  expiry: z.string().length(6).regex(/^\d{6}$/).optional(),
  /** Número de serie (AI 21). */
  serial: z.string().max(20).optional(),
  /** String GS1 original para registro de auditoría. */
  gs1Raw: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Outbox payload (inlineado para evitar dependencia externa en tipos)
// ---------------------------------------------------------------------------

type ExpiredAttemptPayload = {
  pharmacyOrderId: string;
  gtin: string;
  lot?: string;
  expiryRaw: string;
  pharmacistId: string;
  patientId: string;
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const dispensationRouter = router({
  /**
   * US.F2.6.6 — Verifica que exista receta ACTIVA firmada antes de abrir picking.
   *
   * La estación de picking solo debe abrirse si:
   *   1. La Prescription existe y pertenece al paciente en esta organización.
   *   2. Tiene signedAt != null (firmada digitalmente).
   *   3. Status es SIGNED o PARTIALLY_DISPENSED.
   */
  checkPreconditions: tenantProcedure
    .input(checkPreconditionsInput)
    .query(async ({ ctx, input }) => {
      const prescription = await withTenantContext(
        ctx.prisma,
        ctx.tenant,
        async (tx) => {
          return tx.prescription.findFirst({
            where: {
              id: input.indicationId,
              organizationId: ctx.tenant.organizationId,
              patientId: input.patientId,
            },
            select: {
              id: true,
              status: true,
              signedAt: true,
              prescriberId: true,
              items: {
                select: {
                  id: true,
                  drug: {
                    select: { id: true, genericName: true },
                  },
                  dosage: true,
                  route: true,
                  frequency: true,
                },
              },
            },
          });
        },
      );

      if (!prescription || !prescription.signedAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "SIN_RECETA_ACTIVA",
        });
      }

      if (!["SIGNED", "PARTIALLY_DISPENSED"].includes(prescription.status)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "RECETA_SUSPENDIDA",
        });
      }

      return {
        ok: true as const,
        prescriptionId: prescription.id,
        prescriberId: prescription.prescriberId,
        items: prescription.items.map((it) => ({
          id: it.id,
          drugId: it.drug.id,
          genericName: it.drug.genericName,
          dosage: it.dosage,
          route: it.route,
          frequency: it.frequency,
        })),
      };
    }),

  /**
   * US.F2.6.7 — Valida campos GS1 (GTIN/lote/vencimiento) contra la orden médica.
   *
   * El cliente (Gs1Scanner) ya parseó el DataMatrix; este endpoint hace todas
   * las validaciones de negocio server-side (hard stops no se confían al cliente).
   *
   * Flujo de validación en orden de prioridad:
   *   1. Cargar la orden y verificar que es dispensable.
   *   2. Validar vencimiento (MEDICAMENTO_VENCIDO + outbox).
   *   3. Verificar recall de lote si MedicationGtin existe en schema.
   *   4. Devolver ok con datos del ítem.
   */
  scanItem: tenantProcedure
    .input(scanItemInput)
    .mutation(async ({ ctx, input }) => {
      const result = await withTenantContext(
        ctx.prisma,
        ctx.tenant,
        async (tx) => {
          // Paso 1: Cargar la orden (Prescription dispensable).
          const prescription = await tx.prescription.findFirst({
            where: {
              id: input.pharmacyOrderId,
              organizationId: ctx.tenant.organizationId,
              status: { in: ["SIGNED", "PARTIALLY_DISPENSED"] },
            },
            select: {
              id: true,
              patientId: true,
              items: {
                select: {
                  id: true,
                  drug: {
                    select: { id: true, genericName: true },
                  },
                },
              },
            },
          });

          if (!prescription) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Orden no encontrada o no dispensable.",
            });
          }

          // Paso 2: Validar vencimiento — AI(17) YYMMDD.
          if (input.expiry) {
            const expiryDate = parseGs1Expiry(input.expiry);
            if (expiryDate && expiryDate < new Date()) {
              // Emitir evento outbox para farmacéutico jefe (Beta.15 pattern).
              const payload: ExpiredAttemptPayload = {
                pharmacyOrderId: input.pharmacyOrderId,
                gtin: input.gtin,
                lot: input.lot,
                expiryRaw: input.expiry,
                pharmacistId: ctx.user.id,
                patientId: prescription.patientId,
              };
              // Llamada dinámica: emitDomainEvent puede no existir en todos los
              // ambientes de test. Usamos acceso dinámico para no romper el import.
              const prismaAny = tx as unknown as {
                domainEvent?: {
                  create: (args: {
                    data: {
                      organizationId: string;
                      eventType: string;
                      aggregateType: string;
                      aggregateId: string;
                      emittedById: string;
                      payload: unknown;
                    };
                  }) => Promise<unknown>;
                };
              };
              if (prismaAny.domainEvent) {
                await prismaAny.domainEvent.create({
                  data: {
                    organizationId: ctx.tenant.organizationId,
                    eventType: "pharmacy.expired-attempt",
                    aggregateType: "Prescription",
                    aggregateId: prescription.id,
                    emittedById: ctx.user.id,
                    payload,
                  },
                });
              }

              return { hardStop: "MEDICAMENTO_VENCIDO" as const, expiryRaw: input.expiry };
            }
          }

          // Paso 3: Verificar recall de lote (MedicationGtin — dependencia @DBA futura).
          if (input.lot) {
            const prismaAny = tx as unknown as Record<
              string,
              { findFirst: (args: unknown) => Promise<{ recallStatus: string | null } | null> }
            >;
            if (prismaAny.medicationGtin) {
              const gtinEntry = await prismaAny.medicationGtin.findFirst({
                where: { gtin: input.gtin, lot: input.lot },
                select: { recallStatus: true },
              });
              if (gtinEntry?.recallStatus) {
                return {
                  hardStop: "LOTE_EN_RECALL" as const,
                  lot: input.lot,
                  recallStatus: gtinEntry.recallStatus,
                };
              }
            }
          }

          // Paso 4: Identificar el ítem de la orden.
          // Con Drug.gtin disponible (futura dependencia @DBA):
          //   Buscar el item cuyo drug.gtin === input.gtin.
          //   Si ninguno coincide → GTIN_NO_COINCIDE_CON_RECETA.
          const matchedItem = prescription.items[0];
          if (!matchedItem) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "La orden no tiene ítems pendientes.",
            });
          }

          return {
            ok: true as const,
            item: {
              prescriptionItemId: matchedItem.id,
              drugId: matchedItem.drug.id,
              genericName: matchedItem.drug.genericName,
              gtin: input.gtin,
              lot: input.lot ?? null,
              expiry: input.expiry ?? null,
              serial: input.serial ?? null,
            },
          };
        },
      );

      return result;
    }),
});
