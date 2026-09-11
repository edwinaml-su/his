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
 * SQL 232: returnItem — devolución post-despacho que cierra el ciclo de la
 *          requisición (RN-HIS-BOT-001). Ver comentario de
 *          `RETURN_ITEM_OPEN_STATUSES` para el hallazgo de por qué opera
 *          sobre RESERVED (no solo DISPATCHED/CONFIRMED como el diseño
 *          original preveía).
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
 *
 * docs/48 Ola 4b (H-13) — libro de controlados alimentado desde el flujo REAL:
 * `pharmacy.router.ts dispense.create` (el que persiste isControlled/witness/
 * justification) no lo invoca ninguna pantalla — la dispensación real pasa
 * por `reserveItem` (y, si algún día se cablea, `scanItem`). Cuando el ítem
 * resuelto de la receta es RX_CONTROLLED, ambos exigen witnessUserId +
 * witnessPin + controlledJustification (2-eyes con PIN, mismo patrón
 * `verifyPinOrThrow` de `pathology.router.ts`/ECE contra
 * `ece.firma_electronica`) y crean la fila `MedicationDispense` — se elige
 * ESA tabla (no columnas nuevas en `PharmacyReservation`) porque ya tiene las
 * 3 columnas de controlados (Ola 4 C4-4) y `pharmacy.libroControlados` ya la
 * consulta: no duplica el modelo ni obliga a unir dos formas de fila.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { emitDomainEvent, type EmitDomainEventTx } from "@his/database";
import { isControlledDispensingClass } from "@his/contracts";
import { argon2 } from "@his/infrastructure";
import { router, tenantProcedure, requireRole } from "../../trpc";
import { withTenantContext } from "../../rls-context";
import { abacGuard } from "../../abac";
import { capturarCargo, revertirCargo } from "../../lib/charge-capture";
import { requirePersonalSalud } from "../../lib/identity-resolver";

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
  /** `sku` = código de catálogo (StockItem.sku) — insumo de `capturarCargo` (docs/48 C2-2). */
  | { status: "DESCONTADO"; stockItemId: string; lotId: string; sku: string };

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
    select: { id: true, sku: true },
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

  return { status: "DESCONTADO", stockItemId: stockItem.id, lotId: lot.id, sku: stockItem.sku };
}

/**
 * docs/48 Ola 2 (C2-2) — código de catálogo para `capturarCargo`.
 *
 * El cargo es un eje distinto de la validación de inventario (R07): que el
 * GTIN todavía no tenga `StockItem` cargado (SIN_CATALOGO, o establecimiento
 * sin validar) no debe significar dispensar gratis (H-01) — se cae al GTIN
 * crudo como código, que `resolverPrecio` simplemente no resolverá (→ línea
 * PENDIENTE_TARIFA, nunca 0). Cuando el StockItem SÍ existe, su `sku` es el
 * código de catálogo real que el tarifario puede tener cargado.
 */
function codigoCargoDispensacion(stock: StockDecrementResult | null, gtin: string): string {
  return stock?.status === "DESCONTADO" ? stock.sku : gtin;
}

// ---------------------------------------------------------------------------
// docs/48 Ola 4b (H-13) — 2-eyes con PIN para fármacos RX_CONTROLLED.
//
// Replica el patrón `verifyPinOrThrow` de `pathology.router.ts` (mismo
// argon2id contra `ece.firma_electronica`, vía `personal_id` resuelto por
// `requirePersonalSalud`) pero parametrizado por `witnessUserId` en vez de
// `ctx.user.id` — el PIN que se valida es el DEL TESTIGO, no el del
// dispensador que ejecuta la mutación.
// ---------------------------------------------------------------------------

const WITNESS_PIN_LOCKOUT_MAX = 5;

interface FirmaElectronicaRow {
  id: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
}

async function verifyWitnessPin(
  tx: PrismaClient,
  witnessUserId: string,
  pin: string,
): Promise<void> {
  const personal = await requirePersonalSalud(tx, witnessUserId, {
    action: "actuar como testigo de dispensación de fármaco controlado",
  });

  const firmaRows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<FirmaElectronicaRow[]>)`
    SELECT id::text, pin_hash, failed_attempts, locked_until
    FROM ece.firma_electronica
    WHERE personal_id = ${personal.id}::uuid AND revoked_at IS NULL
    LIMIT 1
  `;
  const firma = firmaRows[0] ?? null;
  if (!firma) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "El testigo no tiene firma electrónica (PIN) configurada.",
    });
  }

  if (firma.locked_until !== null && new Date(firma.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(firma.locked_until).getTime() - Date.now()) / 60_000);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Firma del testigo bloqueada. Inténtelo en ${mins} min.`,
    });
  }

  const valid = await argon2.verify(firma.pin_hash, pin);
  if (!valid) {
    await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
      UPDATE ece.firma_electronica
      SET failed_attempts = failed_attempts + 1
      WHERE id = ${firma.id}::uuid
    `;
    const remaining = WITNESS_PIN_LOCKOUT_MAX - (firma.failed_attempts + 1);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        remaining > 0
          ? `PIN de testigo incorrecto. Intentos restantes: ${remaining}.`
          : "PIN de testigo incorrecto. La firma quedará bloqueada.",
    });
  }

  await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
    UPDATE ece.firma_electronica SET failed_attempts = 0 WHERE id = ${firma.id}::uuid
  `;
}

/**
 * docs/48 Ola 4b (H-13) — valida los campos de 2-eyes exigidos cuando el
 * fármaco resuelto de la receta es RX_CONTROLLED, y verifica el PIN del
 * testigo. No hace nada si `isControlled` es false (comportamiento idéntico
 * al actual para el 100% de las dispensaciones no controladas).
 */
async function enforceControlledWitness(
  tx: PrismaClient,
  params: {
    isControlled: boolean;
    dispenserId: string;
    prescriberId: string;
    genericName: string;
    witnessUserId?: string;
    witnessPin?: string;
    controlledJustification?: string;
  },
): Promise<void> {
  if (!params.isControlled) return;

  if (!params.witnessUserId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Fármaco controlado (${params.genericName}) requiere usuario testigo (witnessUserId).`,
    });
  }
  if (params.witnessUserId === params.dispenserId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "El testigo de fármaco controlado debe ser distinto del dispensador.",
    });
  }
  if (params.witnessUserId === params.prescriberId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "El testigo de fármaco controlado debe ser distinto del prescriptor.",
    });
  }
  if (!params.witnessPin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Fármaco controlado requiere PIN del testigo (witnessPin).",
    });
  }
  if (!params.controlledJustification) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Fármaco controlado requiere justificación documentada (controlledJustification).",
    });
  }

  await verifyWitnessPin(tx, params.witnessUserId, params.witnessPin);
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const checkPreconditionsInput = z.object({
  patientId: z.string().uuid(),
  /** ID de la Prescription en HIS a validar como receta activa. */
  indicationId: z.string().uuid(),
});

/**
 * docs/48 Ola 4b (H-13) — 2-eyes para RX_CONTROLLED. Opcionales en Zod: se
 * exigen recién cuando `enforceControlledWitness` resuelve el fármaco como
 * RX_CONTROLLED — para el resto de las dispensaciones son ignorados.
 */
const controlledWitnessFields = {
  /** Usuario testigo (distinto del dispensador y del prescriptor). */
  witnessUserId: z.string().uuid().optional(),
  /** PIN de firma electrónica del testigo (mismo formato que firma.verify). */
  witnessPin: z
    .string()
    .trim()
    .regex(/^\d{6,8}$/, "El PIN debe tener entre 6 y 8 dígitos numéricos.")
    .optional(),
  /** Justificación legal de la dispensación de fármaco controlado. */
  controlledJustification: z.string().trim().min(10).max(500).optional(),
};

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
  ...controlledWitnessFields,
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
  ...controlledWitnessFields,
});

const cancelReservationInput = z.object({
  reservationId: z.string().uuid(),
  motivo: z.string().min(1, "El motivo de cancelación es requerido"),
});

/**
 * SQL 232 — catálogo cerrado del motivo de devolución post-despacho
 * (returnItem). Distinto del `motivo` libre de `cancelReservation` (esa
 * cancela una reserva que NUNCA se entregó; returnItem cierra una que sí se
 * entregó/descontó de inventario pero regresa al botiquín).
 */
const RETURN_ITEM_CLOSE_REASONS = [
  "NO_ADMINISTRADO",
  "ALTA",
  "INCUMPLIMIENTO",
  "VENCIMIENTO",
  "OTRO",
] as const;

/**
 * Estados sobre los que puede operar `returnItem`.
 *
 * Hallazgo (confirmado en 3 lugares: comentario propio de
 * conciliacion-cargos.router.ts, el código de `reserveItem` abajo, y al
 * aplicar SQL 232a contra prod — el enum ni siquiera TENÍA el valor
 * 'CONFIRMED' en la base real): el flujo cableado hoy SOLO crea reservas en
 * estado RESERVED; nunca existió un paso intermedio que transicione a
 * CONFIRMED/DISPATCHED. `reserveItem` ya descuenta inventario y captura el
 * cargo de forma síncrona — en la práctica, RESERVED young es el estado
 * terminal de una dispensación completa en este sistema, no un estado
 * "todavía no entregado" a la espera de un paso posterior.
 *
 * Por eso, a diferencia del diseño original (que reservaba `returnItem` solo
 * para DISPATCHED/CONFIRMED y redirigía RESERVED a `cancelReservation`), este
 * endpoint acepta RESERVED — de lo contrario sería código muerto: ninguna
 * reserva alcanzaría jamás el precondition y la regla de negocio de Edwin
 * ("la devolución debe cerrar el ciclo") seguiría incumplida. `DISPATCHED`
 * se deja en la lista por compatibilidad futura (si algún día se cablea un
 * paso explícito de confirmación de despacho). `CONFIRMED` NO se incluye:
 * no existe en el enum de prod, y referenciarlo en un `where` de Prisma
 * lanza 22P02 (invalid input value for enum) en runtime.
 */
const RETURN_ITEM_OPEN_STATUSES = ["RESERVED", "DISPATCHED"] as const;

const returnItemInput = z.object({
  reservationId: z.string().uuid(),
  motivo: z.enum(RETURN_ITEM_CLOSE_REASONS),
  notas: z.string().trim().max(1000).optional(),
  ...controlledWitnessFields,
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
   *
   * docs/48 Ola 4b (H-14) — sin caller real hoy: la página
   * `/pharmacy/dispense/[orderId]` solo invoca `reserveItem` (`scanItem` solo
   * aparece mockeado en `e2e/fase2/pharmacy-picking.spec.ts`, un spec
   * placeholder que nunca ejercitó la UI real — ver LEE de apps/web previa a
   * este cambio). Este endpoint captura cargo y descuenta inventario real
   * exactamente igual que `reserveItem` (mismo dominio, mismo header de
   * archivo: "US.F2.6.6-9: Dispensación Farmacia"), así que lleva el MISMO
   * gate — no queda abierto a `tenantProcedure` desnudo a la espera de un
   * caller futuro.
   */
  scanItem: requireRole(["PHARM", "ADMIN"])
    .input(scanItemInput)
    .use(abacGuard("dispensation", "dispense"))
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
              encounterId: true,
              prescriberId: true,
              items: {
                select: {
                  id: true,
                  drug: {
                    select: { id: true, genericName: true, dispensingClass: true },
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

          // docs/48 Ola 4 (C4-3) — segregación de funciones por IDENTIDAD
          // (RN-HIS-BOT-001 R9): mismo contrato que reserveItem. Sin bypass
          // documentado.
          if (prescription.prescriberId === ctx.user.id) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Segregación de funciones: quien prescribe no puede dispensar (RN-HIS-BOT-001 R9).",
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
          let stock: StockDecrementResult | null = null;
          if (ctx.tenant.establishmentId && input.lot) {
            stock = await validateAndDecrementStock(tx, {
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

          // docs/48 Ola 4b (H-13) — 2-eyes con PIN si el ítem resuelto es
          // RX_CONTROLLED. Corre ANTES de capturar el cargo: un scan de
          // controlado sin testigo/PIN válido no debe generar cargo ni
          // MedicationDispense (throw revierte también el descuento de stock
          // del Paso 3.5, misma transacción).
          const isControlled = isControlledDispensingClass(matchedItem.drug.dispensingClass);
          await enforceControlledWitness(tx, {
            isControlled,
            dispenserId: ctx.user.id,
            prescriberId: prescription.prescriberId,
            genericName: matchedItem.drug.genericName,
            witnessUserId: input.witnessUserId,
            witnessPin: input.witnessPin,
            controlledJustification: input.controlledJustification,
          });

          // docs/48 Ola 2 (C2-2) — captura de cargo en la MISMA transacción que
          // el descuento de inventario (RN-HIS-BOT-001 R5/H-01). Sin reserva
          // propia, `referenciaId` ancla a la Prescription (la orden de
          // farmacia). Si no hay cuenta activa, `capturarCargo` lanza y
          // scanItem falla completo (rollback incluye el descuento de arriba).
          const cargo = await capturarCargo(tx, {
            organizationId: ctx.tenant.organizationId,
            patientId: prescription.patientId,
            encounterId: prescription.encounterId,
            code: codigoCargoDispensacion(stock, input.gtin),
            descripcion: `Dispensación GS1: ${matchedItem.drug.genericName}`,
            quantity: 1,
            origen: "DISPENSACION_FARMACIA",
            referenciaId: prescription.id,
            actorId: ctx.user.id,
          });

          // docs/48 Ola 4b (H-13) — libro de controlados: solo se crea la fila
          // MedicationDispense cuando el fármaco es RX_CONTROLLED (evita
          // duplicar el registro de TODA dispensación, que ya vive en
          // PharmacyReservation/StockMovement/capturarCargo).
          if (isControlled) {
            await tx.medicationDispense.create({
              data: {
                prescriptionItemId: matchedItem.id,
                dispensedById: ctx.user.id,
                quantity: 1,
                batchNumber: input.lot ?? null,
                expiryDate: null,
                notes: `Dispensación GS1 scan: Prescription ${prescription.id}`,
                isControlled: true,
                witnessUserId: input.witnessUserId ?? null,
                controlledJustification: input.controlledJustification ?? null,
              },
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
            /** docs/48 Ola 2 (C2-2) — cargo capturado en la cuenta activa del paciente. */
            cargo,
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
          select: {
            id: true,
            encounterId: true,
            prescriberId: true,
            // docs/48 Ola 4b (H-13) — mismo patrón de scanItem: sin
            // prescriptionItemId en el input, se toma el primer ítem de la
            // receta para resolver el fármaco (libro de controlados + FK a
            // MedicationDispense). Pendiente Drug.gtin para matchear exacto.
            items: {
              select: {
                id: true,
                drug: { select: { genericName: true, dispensingClass: true } },
              },
            },
          },
        });

        if (!prescription) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "SIN_RECETA_ACTIVA",
          });
        }

        // docs/48 Ola 4 (C4-3) — segregación de funciones por IDENTIDAD
        // (RN-HIS-BOT-001 R9): quien prescribió esta receta no puede
        // dispensarla, sin importar su rol. Sin bypass documentado — un
        // médico que legítimamente despacha en emergencia debe usar otra
        // cuenta de usuario (decisión R9 literal).
        if (prescription.prescriberId === tenant.userId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Segregación de funciones: quien prescribe no puede dispensar (RN-HIS-BOT-001 R9).",
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

        // docs/48 Ola 4b (H-13) — 2-eyes con PIN si el ítem resuelto es
        // RX_CONTROLLED. Corre ANTES de crear la reserva: sin testigo/PIN
        // válido no debe quedar reserva, descuento de stock ni cargo.
        const matchedItem = prescription.items?.[0] ?? null;
        const isControlled = matchedItem
          ? isControlledDispensingClass(matchedItem.drug.dispensingClass)
          : false;
        await enforceControlledWitness(tx, {
          isControlled,
          dispenserId: tenant.userId,
          prescriberId: prescription.prescriberId,
          genericName: matchedItem?.drug.genericName ?? `GTIN ${input.gtin}`,
          witnessUserId: input.witnessUserId,
          witnessPin: input.witnessPin,
          controlledJustification: input.controlledJustification,
        });

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
        let stock: StockDecrementResult | null = null;
        if (tenant.establishmentId) {
          stock = await validateAndDecrementStock(tx, {
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

        // docs/48 Ola 2 (C2-2) — captura de cargo en la MISMA transacción que
        // el descuento de inventario (RN-HIS-BOT-001 R5/H-01). Sin cuenta
        // activa, `capturarCargo` lanza PRECONDITION_FAILED y toda la
        // transacción hace rollback (reserva + descuento incluidos) — la
        // dispensación falla completa, no queda a medias.
        const cargo = await capturarCargo(tx, {
          organizationId: tenant.organizationId,
          patientId: input.patientId,
          encounterId: prescription.encounterId,
          code: codigoCargoDispensacion(stock, input.gtin),
          descripcion: `Dispensación GS1: GTIN ${input.gtin} lote ${input.lote}`,
          quantity: 1,
          origen: "DISPENSACION_FARMACIA",
          referenciaId: reservation.id,
          actorId: tenant.userId,
        });

        // docs/48 Ola 4b (H-13) — libro de controlados: se crea la fila
        // MedicationDispense SOLO para RX_CONTROLLED (H-13 en pharmacy.ts
        // dispense.create nunca la alimentaba porque ninguna pantalla la
        // invoca; el flujo real es este). No se crea para dispensaciones
        // no-controladas: esas ya quedan registradas en PharmacyReservation +
        // StockMovement + el cargo — duplicarlas en MedicationDispense no
        // aporta y complicaría `libroControlados` sin necesidad.
        if (isControlled && matchedItem) {
          await tx.medicationDispense.create({
            data: {
              prescriptionItemId: matchedItem.id,
              dispensedById: tenant.userId,
              quantity: 1,
              batchNumber: input.lote,
              expiryDate: null,
              notes: `Reserva GS1: ${reservation.id}`,
              isControlled: true,
              witnessUserId: input.witnessUserId ?? null,
              controlledJustification: input.controlledJustification ?? null,
            },
          });
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

        /** docs/48 Ola 2 (C2-2) — cargo capturado en la cuenta activa del paciente. */
        return { ...reservation, cargo };
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

        // docs/48 Ola 2 (C2-4) — reversión de cargo: si la reserva generó un
        // cargo VIGENTE (referenciaId = reservation.id, docs/48 C2-2), se
        // revierte en la MISMA transacción que la reposición de inventario.
        // Nunca borra la línea original — revertirCargo la marca REVERTIDO y
        // crea la línea REVERSION enlazada.
        const cargoVigente = await tx.patientAccountService.findFirst({
          where: {
            referenciaId: input.reservationId,
            status: "VIGENTE",
            account: { organizationId: tenant.organizationId },
          },
          select: { id: true },
        });

        if (cargoVigente) {
          await revertirCargo(tx, {
            cargoId: cargoVigente.id,
            motivo: input.motivo,
            actorId: tenant.userId,
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
   * SQL 232 — Devolución post-despacho que CIERRA el ciclo de la
   * requisición (RN-HIS-BOT-001): medicamentos/insumos ya dispensados que
   * NO se administran (o deben regresar por alta/incumplimiento/vencimiento/
   * otro motivo) se devuelven sobre la MISMA reserva.
   *
   * Precondición de estado: ver `RETURN_ITEM_OPEN_STATUSES` — cubre
   * RESERVED (el único estado que el flujo real produce hoy) y DISPATCHED
   * (por compatibilidad futura). CANCELLED/EXPIRED/ADMINISTERED/RETURNED se
   * rechazan (ya cerradas o nunca llegaron a despacharse — para el caso
   * "nunca se entregó", el endpoint correcto sigue siendo
   * `cancelReservation`).
   *
   * Pasos, todos en la MISMA transacción (withTenantContext):
   *   1. Reserva debe existir y estar en un estado abierto.
   *   2. Si el ítem resuelto es RX_CONTROLLED, 2-eyes con PIN del testigo
   *      (mismo helper que reserveItem/scanItem) + fila `MedicationDispense`
   *      con cantidad NEGATIVA (misma granularidad de 1 unidad por reserva
   *      que el resto del flujo GS1) para que quede visible en
   *      `pharmacy.libroControlados` sin tocar esa query.
   *   3. Reingreso de inventario: repone la MISMA unidad descontada al
   *      reservar (StockMovement OUT con referenceCode=reservationId),
   *      mismo patrón que `cancelReservation`.
   *   4. Reversión del cargo VIGENTE con referenciaId=reservationId. Si no
   *      hay cargo VIGENTE (ya revertido, o nunca se capturó como tal) →
   *      CONFLICT explícito — a diferencia de `cancelReservation`, este
   *      endpoint NO hace no-op silencioso: una devolución que no puede
   *      revertir su cargo es una anomalía, no un caso normal.
   *   5. Cierra la reserva: status=RETURNED + closeReason/closeNotes/
   *      closedAt/closedBy/returnWitnessUserId.
   */
  returnItem: requireRole(["PHARM", "ADMIN"])
    .input(returnItemInput)
    .use(abacGuard("dispensation", "dispense"))
    .mutation(async ({ ctx, input }) => {
      const { prisma, tenant } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const reservation = await tx.pharmacyReservation.findFirst({
          where: {
            id: input.reservationId,
            organizationId: tenant.organizationId,
          },
        });

        if (!reservation) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Reserva no encontrada.",
          });
        }

        if (
          !(RETURN_ITEM_OPEN_STATUSES as readonly string[]).includes(
            reservation.status,
          )
        ) {
          const detalle =
            reservation.status === "CANCELLED"
              ? " (la reserva ya fue cancelada)."
              : reservation.status === "EXPIRED"
                ? " (la reserva expiró)."
                : " (ya tiene un cierre registrado — no se puede duplicar la devolución).";
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              `Solo se puede registrar devolución de una reserva dispensada y sin cerrar. ` +
              `Estado actual: ${reservation.status}${detalle}`,
          });
        }

        // Resolver el ítem/fármaco de la receta que originó la reserva — la
        // reserva no tiene FK directa a PrescriptionItem/Drug. Mismo patrón
        // (y misma limitación documentada: primer ítem) que reserveItem.
        const prescription = await tx.prescription.findFirst({
          where: {
            id: reservation.pharmacyOrderId,
            organizationId: tenant.organizationId,
          },
          select: {
            prescriberId: true,
            items: {
              select: {
                id: true,
                drug: { select: { genericName: true, dispensingClass: true } },
              },
            },
          },
        });

        if (!prescription) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No se pudo resolver la receta de origen de esta reserva.",
          });
        }

        const matchedItem = prescription.items?.[0] ?? null;
        const isControlled = matchedItem
          ? isControlledDispensingClass(matchedItem.drug.dispensingClass)
          : false;

        // 2-eyes con PIN si el ítem es RX_CONTROLLED — ANTES de tocar
        // inventario/cargo (un throw revierte todo, misma tx).
        await enforceControlledWitness(tx, {
          isControlled,
          dispenserId: tenant.userId,
          prescriberId: prescription.prescriberId,
          genericName: matchedItem?.drug.genericName ?? `GTIN ${reservation.gtin}`,
          witnessUserId: input.witnessUserId,
          witnessPin: input.witnessPin,
          controlledJustification: input.controlledJustification,
        });

        // Reingreso de inventario: repone la unidad descontada al reservar,
        // igual patrón que cancelReservation.
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
              reason: "Devolución a botiquín (dispensation.returnItem)",
              referenceCode: input.reservationId,
              gtinFisico: reservation.gtin,
              performedById: tenant.userId,
            },
          });
        }

        // Reversión del cargo VIGENTE — a diferencia de cancelReservation,
        // aquí es un error explícito (no un no-op) si no hay nada que
        // revertir: una devolución sin cargo VIGENTE es una anomalía.
        const cargoVigente = await tx.patientAccountService.findFirst({
          where: {
            referenciaId: input.reservationId,
            status: "VIGENTE",
            account: { organizationId: tenant.organizationId },
          },
          select: { id: true },
        });

        if (!cargoVigente) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "No hay un cargo VIGENTE asociado a esta reserva (ya fue revertido, o nunca se " +
              "capturó como VIGENTE) — no se puede duplicar la reversión.",
          });
        }

        await revertirCargo(tx, {
          cargoId: cargoVigente.id,
          motivo: `Devolución post-despacho (${input.motivo})${input.notas ? `: ${input.notas}` : ""}`,
          actorId: tenant.userId,
        });

        // docs/48 Ola 4b (H-13) — libro de controlados: fila de DEVOLUCIÓN
        // con cantidad negativa (misma granularidad de 1 unidad/reserva que
        // el resto del flujo GS1). `pharmacy.libroControlados` selecciona
        // `quantity` tal cual — no requiere cambios de query para mostrarla.
        if (isControlled && matchedItem) {
          await tx.medicationDispense.create({
            data: {
              prescriptionItemId: matchedItem.id,
              dispensedById: tenant.userId,
              quantity: -1,
              batchNumber: reservation.lote,
              expiryDate: null,
              notes:
                `[DEVOLUCION] Devolución post-despacho: reserva ${reservation.id}, ` +
                `motivo ${input.motivo}${input.notas ? ` — ${input.notas}` : ""}`,
              isControlled: true,
              witnessUserId: input.witnessUserId ?? null,
              controlledJustification: input.controlledJustification ?? null,
            },
          });
        }

        const updated = await tx.pharmacyReservation.update({
          where: { id: input.reservationId },
          data: {
            status: "RETURNED",
            closeReason: input.motivo,
            closeNotes: input.notas ?? null,
            closedAt: new Date(),
            closedBy: tenant.userId,
            returnWitnessUserId: input.witnessUserId ?? null,
          },
        });

        await emitDomainEvent(tx as unknown as EmitDomainEventTx, {
          eventType: "pharmacy.reservation.returned",
          aggregateType: "PharmacyReservation",
          aggregateId: input.reservationId,
          emittedById: tenant.userId,
          organizationId: tenant.organizationId,
          payload: {
            reservationId: input.reservationId,
            motivo: input.motivo,
            notas: input.notas ?? null,
            returnedBy: tenant.userId,
            patientId: reservation.patientId,
            isControlled,
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
