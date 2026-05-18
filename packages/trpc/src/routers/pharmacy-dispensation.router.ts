/**
 * Router tRPC: Proceso D — Dispensación GS1 (US.F2.6.8-9).
 *
 * US.F2.6.8 — Reserva lógica de número de serie/lote por paciente:
 *   - `reserveItem`: INSERT PharmacyReservation RESERVED + expiresAt=now()+4h.
 *     Hard Stop si el serial ya está RESERVED por otro paciente.
 *     Transacción atómica (withTenantContext requerido).
 *   - `cancelReservation`: UPDATE → CANCELLED + cancelMotivo + audit log.
 *   - `getReservation`: consulta estado de una reserva.
 *
 * US.F2.6.9 — Detección de duplicados en dispensación:
 *   - `checkDuplicate`: cruza PharmacyOrder.dispensedAt con MedicalOrder.frequency
 *     para determinar si el ítem ya fue dispensado dentro de la ventana terapéutica.
 *     Devuelve { allowed, lastDispensedAt, nextWindowAt }.
 *     Hard Stop si allowed=false (llamar ANTES de escanear).
 *
 * Seguridad:
 *   Todos los procedures son tenantProcedure + withTenantContext (RLS demote).
 *   cancelReservation emite audit log en public.audit_log.
 *
 * Integración con scanItem (Stream 05):
 *   El caller debe invocar checkDuplicate → Hard Stop si !allowed.
 *   Luego reserveItem para bloquear el serial al paciente.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";
import { emitDomainEvent, type EmitDomainEventTx } from "@his/database";

// ---------------------------------------------------------------------------
// Helpers: parseo de frecuencia médica a minutos
// ---------------------------------------------------------------------------

/**
 * Convierte el campo `frequency` de PrescriptionItem a minutos.
 *
 * Acepta:
 *   - Códigos abreviados: QD, BID, TID, QID, Q8H, Q12H, Q24H, PRN, etc.
 *   - Strings libres con patrón "cada N hora(s)".
 *
 * Retorna null si no reconoce el patrón (→ no se aplica Hard Stop de ventana).
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
// Schemas Zod de entrada
// ---------------------------------------------------------------------------

const reserveItemInput = z.object({
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
// Router
// ---------------------------------------------------------------------------

export const pharmacyDispensationRouter = router({
  /**
   * US.F2.6.8 — Reserva lógica.
   *
   * Crea un registro PharmacyReservation con status=RESERVED y expiresAt=now()+4h.
   * Hard Stop si ese serial ya está RESERVED por otro paciente (UNIQUE constraint
   * parcial en BD: (gtin, lote, serie) WHERE status='RESERVED').
   *
   * Transacción atómica con withTenantContext.
   */
  reserveItem: requireRole(["PHARM", "ADMIN"])
    .input(reserveItemInput)
    .mutation(async ({ ctx, input }) => {
      const { prisma, tenant } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
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
   * Cambia status → CANCELLED + registra motivo.
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
      const reservation = await prisma.pharmacyReservation.findFirst({
        where: {
          id: input.reservationId,
          organizationId: tenant.organizationId,
        },
      });

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
      const prescriptionItem = await prisma.prescriptionItem.findFirst({
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
      });

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

export type PharmacyDispensationRouter = typeof pharmacyDispensationRouter;
