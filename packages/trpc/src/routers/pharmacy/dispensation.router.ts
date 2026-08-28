/**
 * Fase 2 — US.F2.6.6-9: Dispensación Farmacia (router canónico consolidado)
 *
 * US.F2.6.6: checkPreconditions — hard stop si no hay receta ACTIVA firmada.
 * US.F2.6.7: scanItem — valida GTIN/lote/vencimiento contra la orden médica.
 * US.F2.6.8: reserveItem / cancelReservation / getReservation — reserva lógica
 *            de serial por paciente (consolidado desde el extinto
 *            pharmacy-dispensation.router.ts, hallazgo PR #581: aquel router
 *            NO validaba inventario; ahora reserveItem comparte el mismo
 *            hard stop R07 que scanItem).
 * US.F2.6.9: checkDuplicate — ventana terapéutica vs última dispensación.
 * orderDetail: datos de la receta para la estación de despacho.
 *
 * Semántica de "orden de farmacia": la Prescription firmada ACTÚA como
 * pharmacy order (FK de PharmacyReservation re-apuntada en SQL 214).
 *
 * Diseño: el cliente (Gs1Scanner) parsea el DataMatrix GS1 y envía los campos
 * individuales. El servidor re-valida todo server-side (hard stops no se
 * confían al cliente). El campo gs1Raw se incluye para auditoría.
 *
 * Hard stops server-side:
 *   SIN_RECETA_ACTIVA             : no existe indicación activa para el paciente/encuentro
 *   RECETA_SUSPENDIDA             : indicación encontrada pero no está en estado dispensable
 *   MEDICAMENTO_VENCIDO           : fecha de vencimiento AI(17) en el pasado
 *   LOTE_EN_RECALL                : lote tiene recallStatus != null en MedicationGtin
 *   LOTE_NO_EXISTE_EN_INVENTARIO  : R07 — el GTIN está en el catálogo (StockItem) pero
 *                                   el lote escaneado nunca ingresó a StockLot.
 *   LOTE_NO_DISPONIBLE_INVENTARIO : R07 — StockLot.qualityStatus != AVAILABLE.
 *   STOCK_INSUFICIENTE            : R07 — StockLot.quantityOnHand < 1 al momento del scan.
 *
 * Emite evento Beta.15 outbox `pharmacy.expired-attempt` en MEDICAMENTO_VENCIDO.
 *
 * R07 (remediación crítico, 2026-08-19) — validación de inventario real:
 *   scanItem validaba GTIN/lote/vencimiento/recall pero nunca consultaba stock
 *   físico ("disponibilidad virtualmente ilimitada"). Ahora, si el GTIN+lote
 *   tiene un StockItem/StockLot cargado (§19), se valida disponibilidad y se
 *   descuenta 1 unidad atómicamente en la misma transacción que el resto del
 *   scan. El enforcement es data-driven (no un flag): si el catálogo de
 *   inventario todavía no tiene ese ítem cargado, no bloquea (StockItem/
 *   StockLot están en 0 filas en prod al momento de este cambio) — bloquear
 *   el 100% de las dispensaciones por falta de carga de catálogo sería peor
 *   que el hallazgo original. `stockValidated` en la respuesta indica si el
 *   descuento ocurrió contra inventario real.
 *
 * Dependencia @DBA (bloqueante para GTIN_NO_COINCIDE_CON_RECETA completo):
 *   - Drug.gtin (campo GTIN-14 en catálogo) → cuando exista, se valida coincidencia.
 *   - MedicationGtin (tabla con lot/recallStatus) → check recall live.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { emitDomainEvent, type EmitDomainEventTx } from "@his/database";
import { router, tenantProcedure, requireRole } from "../../trpc";
import { withTenantContext } from "../../rls-context";
import { abacGuard } from "../../abac";

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

/**
 * Convierte el campo `frequency` de PrescriptionItem a minutos.
 *
 * Acepta:
 *   - Códigos abreviados: QD, BID, TID, QID, Q8H, Q12H, Q24H, PRN, etc.
 *   - Strings libres con patrón "cada N hora(s)".
 *
 * Retorna null si no reconoce el patrón (→ no se aplica Hard Stop de ventana).
 *
 * ⚠ Paridad: `apps/web/src/lib/medication-slot.ts` mantiene una copia de esta
 * tabla para el cálculo de slot eMAR. Si cambia aquí, debe cambiar allá.
 */
function frequencyToMinutes(freq: string): number | null {
  const upper = freq.toUpperCase().trim();

  // Abreviaciones estándar
  const map: Record<string, number> = {
    QD: 1440,    // once daily
    "Q24H": 1440,
    "Q12H": 720,
    BID: 720,
    "Q8H": 480,
    TID: 480,
    QID: 360,
    "Q6H": 360,
    "Q4H": 240,
    "Q2H": 120,
    "QOD": 2880, // every other day
  };
  if (map[upper] !== undefined) return map[upper]!;

  // Patrón "cada N hora(s)"
  const matchH = upper.match(/CADA\s+(\d+)\s+HORA/);
  if (matchH) return parseInt(matchH[1]!, 10) * 60;

  // Patrón "cada N minuto(s)"
  const matchM = upper.match(/CADA\s+(\d+)\s+MINUTO/);
  if (matchM) return parseInt(matchM[1]!, 10);

  return null;
}

// ---------------------------------------------------------------------------
// R07 — validación + descuento atómico de inventario real (StockItem/StockLot)
//
// Compartido por scanItem y reserveItem para que la lógica del hard stop de
// inventario viva en UN solo lugar (hallazgo PR #581: reserveItem, el que usa
// la página de despacho, no validaba stock). Debe llamarse DENTRO del callback
// de withTenantContext (misma transacción → rollback conjunto).
//
// Enforcement DATA-DRIVEN, no un flag global: si el GTIN todavía no está en el
// catálogo de inventario (StockItem), no bloquea — bloquear el 100% de las
// dispensaciones por falta de carga de catálogo sería peor que el hallazgo
// original (ver rationale R07 en el encabezado).
// ---------------------------------------------------------------------------

type StockDecrementResult =
  | { status: "SIN_CATALOGO" }
  | {
      status: "HARD_STOP";
      hardStop:
        | "LOTE_NO_EXISTE_EN_INVENTARIO"
        | "LOTE_NO_DISPONIBLE_INVENTARIO"
        | "STOCK_INSUFICIENTE";
      qualityStatus?: string;
    }
  | { status: "DESCONTADO"; stockItemId: string; lotId: string };

async function validateAndDecrementStock(
  tx: PrismaClient,
  params: {
    organizationId: string;
    establishmentId: string;
    gtin: string;
    lot: string;
    userId: string;
    referenceCode: string;
    reason: string;
  },
): Promise<StockDecrementResult> {
  const stockItem = await tx.stockItem.findFirst({
    where: {
      gtin: params.gtin,
      OR: [{ organizationId: null }, { organizationId: params.organizationId }],
    },
    select: { id: true },
  });

  // GTIN sin StockItem → ítem aún no incorporado al inventario. No bloquea.
  if (!stockItem) return { status: "SIN_CATALOGO" };

  const lot = await tx.stockLot.findFirst({
    where: {
      organizationId: params.organizationId,
      establishmentId: params.establishmentId,
      itemId: stockItem.id,
      lotNumber: params.lot,
    },
    select: { id: true, qualityStatus: true },
  });

  // El lote nunca ingresó físicamente a esta bodega — hard stop.
  if (!lot) {
    return { status: "HARD_STOP", hardStop: "LOTE_NO_EXISTE_EN_INVENTARIO" };
  }

  if (lot.qualityStatus !== "AVAILABLE") {
    return {
      status: "HARD_STOP",
      hardStop: "LOTE_NO_DISPONIBLE_INVENTARIO",
      qualityStatus: lot.qualityStatus,
    };
  }

  // Descuento atómico: el WHERE exige quantityOnHand >= 1, así que un
  // `count === 0` significa "otro proceso concurrente ya agotó el lote" o
  // "no había stock" — ambos son STOCK_INSUFICIENTE, sin leer-y-comparar.
  const decremented = await tx.stockLot.updateMany({
    where: { id: lot.id, quantityOnHand: { gte: 1 } },
    data: { quantityOnHand: { decrement: 1 } },
  });

  if (decremented.count === 0) {
    return { status: "HARD_STOP", hardStop: "STOCK_INSUFICIENTE" };
  }

  await tx.stockMovement.create({
    data: {
      organizationId: params.organizationId,
      establishmentId: params.establishmentId,
      itemId: stockItem.id,
      lotId: lot.id,
      type: "OUT",
      quantity: 1,
      reason: params.reason,
      referenceCode: params.referenceCode,
      gtinFisico: params.gtin,
      performedById: params.userId,
    },
  });

  return { status: "DESCONTADO", stockItemId: stockItem.id, lotId: lot.id };
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

const orderDetailInput = z.object({
  /** ID de la Prescription que actúa como pharmacy order. */
  pharmacyOrderId: z.string().uuid(),
});

const reserveItemInput = z.object({
  /** ID de la Prescription que actúa como pharmacy order. */
  pharmacyOrderId: z.string().uuid({ message: "pharmacyOrderId debe ser UUID" }),
  gtin: z
    .string()
    .length(14, "GTIN-14: exactamente 14 caracteres")
    .regex(/^\d{14}$/, "GTIN-14: solo dígitos"),
  lote: z.string().min(1).max(80),
  serie: z.string().max(80).optional(),
  patientId: z.string().uuid({ message: "patientId debe ser UUID" }),
});

const cancelReservationInput = z.object({
  reservationId: z.string().uuid(),
  motivo: z.string().min(1, "El motivo de cancelación es requerido"),
});

const checkDuplicateInput = z.object({
  patientId: z.string().uuid(),
  /** ID del ítem de receta (PrescriptionItem) */
  prescriptionItemId: z.string().uuid(),
  gtin: z
    .string()
    .length(14)
    .regex(/^\d{14}$/),
});

const getReservationInput = z.object({
  reservationId: z.string().uuid(),
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

          // Paso 3.5 — R07: validar inventario real (StockItem/StockLot,
          // fuente de verdad de §19) vía helper compartido con reserveItem.
          // Sin input.lot no se puede ubicar el StockLot exacto (único por
          // org+establecimiento+item+lote) → no bloquea, stockValidated=false.
          // Corre dentro de la misma transacción que el resto de scanItem
          // (withTenantContext ya la abre): si algo más adelante falla, la
          // transacción completa hace rollback, incluido el descuento.
          let stockValidated = false;
          if (ctx.tenant.establishmentId && input.lot) {
            const stock = await validateAndDecrementStock(tx, {
              organizationId: ctx.tenant.organizationId,
              establishmentId: ctx.tenant.establishmentId,
              gtin: input.gtin,
              lot: input.lot,
              userId: ctx.user.id,
              referenceCode: prescription.id,
              reason: "Dispensación GS1 bedside (dispensation.scanItem)",
            });

            if (stock.status === "HARD_STOP") {
              if (stock.hardStop === "LOTE_NO_DISPONIBLE_INVENTARIO") {
                return {
                  hardStop: stock.hardStop,
                  lot: input.lot,
                  qualityStatus: stock.qualityStatus,
                };
              }
              return { hardStop: stock.hardStop, gtin: input.gtin, lot: input.lot };
            }

            stockValidated = stock.status === "DESCONTADO";
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
            /** true si se validó y descontó contra StockLot real (§19). */
            stockValidated,
          };
        },
      );

      return result;
    }),

  /**
   * Datos de la receta (orden de farmacia) para la estación de despacho.
   *
   * La página /pharmacy/dispense/[orderId] los usa para mostrar paciente y
   * medicamentos reales en lugar de pedir UUIDs tipeados a mano (hallazgo
   * PR #581: la página nunca fetcheaba datos de receta).
   */
  orderDetail: tenantProcedure
    .input(orderDetailInput)
    .query(async ({ ctx, input }) => {
      const rx = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) =>
        tx.prescription.findFirst({
          where: {
            id: input.pharmacyOrderId,
            organizationId: ctx.tenant.organizationId,
          },
          select: {
            id: true,
            status: true,
            patientId: true,
            patient: { select: { firstName: true, lastName: true, mrn: true } },
            items: {
              select: {
                id: true,
                dosage: true,
                route: true,
                frequency: true,
                drug: { select: { id: true, genericName: true } },
              },
            },
          },
        }),
      );

      if (!rx) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Orden no encontrada" });
      }

      return rx;
    }),

  /**
   * US.F2.6.8 — Reserva lógica.
   *
   * Crea un registro PharmacyReservation con status=RESERVED y expiresAt=now()+4h.
   * Hard Stops server-side (no se confían al cliente):
   *   - SIN_RECETA_ACTIVA: la receta no existe / no es del paciente / no es
   *     dispensable (status fuera de SIGNED|PARTIALLY_DISPENSED).
   *   - SERIAL_YA_RESERVADO_OTRO_PACIENTE (CONFLICT).
   *   - R07 inventario: LOTE_NO_EXISTE_EN_INVENTARIO /
   *     LOTE_NO_DISPONIBLE_INVENTARIO / STOCK_INSUFICIENTE
   *     (PRECONDITION_FAILED). El descuento de 1 unidad + StockMovement OUT
   *     (referenceCode = reservation.id) ocurren en la MISMA transacción que
   *     la reserva: un throw revierte todo (sin descuento fantasma).
   *
   * Transacción atómica con withTenantContext.
   */
  reserveItem: requireRole(["PHARM", "ADMIN"])
    .input(reserveItemInput)
    // CC-0017 F2 — prueba de concepto abacGuard (canDispense). Seed MVP
    // replica el comportamiento actual (rol EN [farmaceutico]) — no bloquea
    // nada hoy; un admin puede añadir una DENY más específica desde /abac.
    .use(abacGuard("dispensation", "dispense"))
    .mutation(async ({ ctx, input }) => {
      const { prisma, tenant } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        // Paso 0 — la receta que actúa como orden de farmacia debe existir,
        // pertenecer al paciente y ser dispensable (mismo criterio que
        // scanItem Paso 1). Además respalda la FK a Prescription (SQL 214).
        const prescription = await tx.prescription.findFirst({
          where: {
            id: input.pharmacyOrderId,
            organizationId: tenant.organizationId,
            patientId: input.patientId,
            status: { in: ["SIGNED", "PARTIALLY_DISPENSED"] },
          },
          select: { id: true },
        });

        if (!prescription) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "SIN_RECETA_ACTIVA",
          });
        }

        // Verificar si el serial ya está RESERVED por OTRO paciente
        if (input.serie) {
          const conflict = await tx.pharmacyReservation.findFirst({
            where: {
              organizationId: tenant.organizationId,
              gtin: input.gtin,
              lote: input.lote,
              serie: input.serie,
              status: "RESERVED",
            },
            select: { id: true, patientId: true },
          });

          if (conflict && conflict.patientId !== input.patientId) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "SERIAL_YA_RESERVADO_OTRO_PACIENTE",
            });
          }

          if (conflict && conflict.patientId === input.patientId) {
            // Misma reserva activa — idempotente: devolver la existente
            // (sin descontar stock otra vez).
            return tx.pharmacyReservation.findUniqueOrThrow({
              where: { id: conflict.id },
            });
          }
        }

        const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000); // +4h

        const reservation = await tx.pharmacyReservation.create({
          data: {
            organizationId: tenant.organizationId,
            pharmacyOrderId: input.pharmacyOrderId,
            patientId: input.patientId,
            gtin: input.gtin,
            lote: input.lote,
            serie: input.serie ?? null,
            status: "RESERVED",
            expiresAt,
          },
        });

        // R07 — hard stop de inventario (hallazgo PR #581: este flujo no
        // validaba stock). Mismo helper que scanItem; el throw revierte la
        // transacción completa, incluida la reserva recién creada.
        if (tenant.establishmentId) {
          const stock = await validateAndDecrementStock(tx, {
            organizationId: tenant.organizationId,
            establishmentId: tenant.establishmentId,
            gtin: input.gtin,
            lot: input.lote,
            userId: tenant.userId,
            referenceCode: reservation.id,
            reason: "Reserva dispensación GS1 (dispensation.reserveItem)",
          });

          if (stock.status === "HARD_STOP") {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: stock.hardStop,
            });
          }
        }

        // Emit domain event para outbox Beta.15
        await emitDomainEvent(tx as unknown as EmitDomainEventTx, {
          eventType: "pharmacy.reservation.created",
          aggregateType: "PharmacyReservation",
          aggregateId: reservation.id,
          emittedById: tenant.userId,
          organizationId: tenant.organizationId,
          payload: {
            reservationId: reservation.id,
            patientId: input.patientId,
            pharmacyOrderId: input.pharmacyOrderId,
            gtin: input.gtin,
            lote: input.lote,
            serie: input.serie,
            expiresAt: expiresAt.toISOString(),
            organizationId: tenant.organizationId,
          },
        });

        return reservation;
      });
    }),

  /**
   * US.F2.6.8 — Cancelación de reserva.
   *
   * Cambia status → CANCELLED + registra motivo. Si la reserva descontó
   * inventario (StockMovement OUT con referenceCode = reservationId), repone
   * la unidad (increment + StockMovement IN) en la misma transacción — "la
   * unidad quedará disponible para otros pacientes".
   * Emite audit log. Solo cancela reservas RESERVED del tenant activo.
   */
  cancelReservation: requireRole(["PHARM", "ADMIN"])
    .input(cancelReservationInput)
    .mutation(async ({ ctx, input }) => {
      const { prisma, tenant } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const reservation = await tx.pharmacyReservation.findFirst({
          where: {
            id: input.reservationId,
            organizationId: tenant.organizationId,
            status: "RESERVED",
          },
        });

        if (!reservation) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "Reserva no encontrada o ya no está en estado RESERVED",
          });
        }

        const updated = await tx.pharmacyReservation.update({
          where: { id: input.reservationId },
          data: {
            status: "CANCELLED",
            cancelMotivo: input.motivo,
          },
        });

        // R07 — reponer la unidad descontada al reservar (si hubo descuento).
        const outMovement = await tx.stockMovement.findFirst({
          where: {
            organizationId: tenant.organizationId,
            referenceCode: input.reservationId,
            type: "OUT",
          },
          select: {
            itemId: true,
            lotId: true,
            quantity: true,
            establishmentId: true,
          },
        });

        if (outMovement?.lotId) {
          await tx.stockLot.updateMany({
            where: { id: outMovement.lotId },
            data: { quantityOnHand: { increment: outMovement.quantity } },
          });
          await tx.stockMovement.create({
            data: {
              organizationId: tenant.organizationId,
              establishmentId: outMovement.establishmentId,
              itemId: outMovement.itemId,
              lotId: outMovement.lotId,
              type: "IN",
              quantity: outMovement.quantity,
              reason:
                "Reposición por cancelación de reserva (dispensation.cancelReservation)",
              referenceCode: input.reservationId,
              gtinFisico: reservation.gtin,
              performedById: tenant.userId,
            },
          });
        }

        // Audit log en dominio
        await emitDomainEvent(tx as unknown as EmitDomainEventTx, {
          eventType: "pharmacy.reservation.cancelled",
          aggregateType: "PharmacyReservation",
          aggregateId: input.reservationId,
          emittedById: tenant.userId,
          organizationId: tenant.organizationId,
          payload: {
            reservationId: input.reservationId,
            motivo: input.motivo,
            cancelledBy: tenant.userId,
            patientId: reservation.patientId,
            organizationId: tenant.organizationId,
          },
        });

        return updated;
      });
    }),

  /**
   * Consulta estado de una reserva (para el contador de tiempo en UI).
   */
  getReservation: tenantProcedure
    .input(getReservationInput)
    .query(async ({ ctx, input }) => {
      const { prisma, tenant } = ctx;
      const reservation = await withTenantContext(prisma, tenant, (tx) =>
        tx.pharmacyReservation.findFirst({
          where: {
            id: input.reservationId,
            organizationId: tenant.organizationId,
          },
        }),
      );

      if (!reservation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Reserva no encontrada" });
      }

      return reservation;
    }),

  /**
   * US.F2.6.9 — Detección de duplicados antes del scan.
   *
   * Cruza la última dispensación del ítem con la frecuencia de la indicación médica.
   * Si la próxima ventana aún no llegó → Hard Stop "ITEM_YA_DISPENSADO_EN_VENTANA".
   *
   * Llamar ANTES de invocar reserveItem / scanItem.
   */
  checkDuplicate: tenantProcedure
    .input(checkDuplicateInput)
    .query(async ({ ctx, input }) => {
      const { prisma, tenant } = ctx;

      // Obtener el PrescriptionItem con su frecuencia y las dispensaciones del paciente
      const prescriptionItem = await withTenantContext(prisma, tenant, (tx) =>
        tx.prescriptionItem.findFirst({
          where: {
            id: input.prescriptionItemId,
            prescription: {
              patientId: input.patientId,
              organizationId: tenant.organizationId,
            },
          },
          select: {
            id: true,
            frequency: true,
            dispenses: {
              orderBy: { dispensedAt: "desc" },
              take: 1,
              select: { dispensedAt: true },
            },
          },
        }),
      );

      if (!prescriptionItem) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Ítem de receta no encontrado para este paciente",
        });
      }

      const lastDispense = prescriptionItem.dispenses[0];

      if (!lastDispense) {
        // Nunca dispensado — permitir
        return {
          allowed: true,
          lastDispensedAt: null,
          nextWindowAt: null,
        };
      }

      const frequencyMinutes = frequencyToMinutes(prescriptionItem.frequency);

      if (frequencyMinutes === null) {
        // Frecuencia no parseable (PRN, etc.) — no aplicar Hard Stop de ventana
        return {
          allowed: true,
          lastDispensedAt: lastDispense.dispensedAt,
          nextWindowAt: null,
        };
      }

      const nextWindowAt = new Date(
        lastDispense.dispensedAt.getTime() + frequencyMinutes * 60 * 1000,
      );
      const now = new Date();

      if (nextWindowAt > now) {
        // Dentro de la ventana terapéutica — Hard Stop
        return {
          allowed: false,
          lastDispensedAt: lastDispense.dispensedAt,
          nextWindowAt,
          reason: "ITEM_YA_DISPENSADO_EN_VENTANA" as const,
        };
      }

      return {
        allowed: true,
        lastDispensedAt: lastDispense.dispensedAt,
        nextWindowAt,
      };
    }),
});
