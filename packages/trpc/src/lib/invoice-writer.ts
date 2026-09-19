/**
 * CC-0028b — helper compartido para el INSERT de Invoice + InvoiceItem[].
 *
 * Invoice/InvoiceItem NO tienen modelo Prisma (drift by diseño — ver
 * invoice.router.ts): toda escritura es `$queryRawUnsafe`. Antes de este
 * archivo, `invoice.router.ts#create` tenía el INSERT inline; se extrae acá
 * para que `patientAccount.facturacionDual` (CC-0028b, doble facturación de
 * coaseguro) reutilice exactamente el mismo raw SQL en vez de duplicarlo —
 * dos INSERT distintos a la misma tabla con columnas ligeramente distintas
 * son la forma más fácil de que diverjan en silencio (una migración nueva
 * que agrega una columna y solo uno de los dos INSERT se actualiza).
 */
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

export interface InvoiceItemParaInsertar {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  costCenterId: string;
  serviceUnitId?: string | null;
  priceListId: string | null;
  priceRuleId: string | null;
  resolvedAt: Date | null;
  priceSource: string | null;
}

export interface InsertarFacturaParams {
  organizationId: string;
  establishmentId: string;
  patientId: string;
  encounterId?: string | null;
  insurerId?: string | null;
  costCenterId?: string | null;
  currencyId: string;
  /** CC-A (auditoría 2026-09-18, P0) — tasa a la moneda funcional de la org. Default 1 (columna NOT NULL DEFAULT 1). */
  exchangeRateToFunc?: number;
  patientAccountId: string;
  status: "DRAFT" | "ISSUED";
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  notes?: string | null;
  items: InvoiceItemParaInsertar[];
}

/**
 * Genera un invoiceNumber único (YYYYMMDD-NNNNN). NO es un correlativo real
 * — fecha + 5 dígitos aleatorios — mismo mecanismo desde Wave 8b
 * (invoice.router.ts). Dos llamadas seguidas (p. ej. las 2 facturas de
 * `facturacionDual`) producen números distintos porque el componente
 * aleatorio difiere, pero no son "consecutivos" en el sentido de un
 * correlativo secuencial — no existe tal correlativo en Invoice hoy.
 */
export function buildInvoiceNumber(): string {
  const d = new Date();
  const date = d.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 100000).toString().padStart(5, "0");
  return `${date}-${rand}`;
}

type TxParaFactura = Pick<PrismaClient, "$queryRawUnsafe">;

/** INSERT de una Invoice + su InvoiceItem[] dentro de la tx recibida (misma tx del caller). */
export async function insertarFacturaConItems(
  tx: TxParaFactura,
  params: InsertarFacturaParams,
): Promise<{ id: string; invoiceNumber: string }> {
  type IdRow = { id: string };
  const invoiceNumber = buildInvoiceNumber();

  // `exchangeRateToFunc` va AL FINAL de la lista de columnas (no junto a
  // `currencyId`) a propósito: así los índices posicionales $1..$14 de las
  // columnas preexistentes no se corren, y no hace falta tocar los asserts
  // por posición de `patient-account.router.test.ts` (mismo INSERT,
  // reusado por `facturacionDual` — ver cabecera del archivo).
  const inserted = await tx.$queryRawUnsafe<IdRow[]>(
    `INSERT INTO "Invoice" (
       "organizationId", "establishmentId", "patientId", "encounterId",
       "insurerId", "costCenterId", "currencyId", "invoiceNumber",
       subtotal, "taxAmount", "totalAmount", status, "patientAccountId", notes,
       "exchangeRateToFunc"
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::invoice_status, $13, $14, $15
     ) RETURNING id`,
    params.organizationId,
    params.establishmentId,
    params.patientId,
    params.encounterId ?? null,
    params.insurerId ?? null,
    params.costCenterId ?? null,
    params.currencyId,
    invoiceNumber,
    params.subtotal,
    params.taxAmount,
    params.totalAmount,
    params.status,
    params.patientAccountId,
    params.notes ?? null,
    params.exchangeRateToFunc ?? 1,
  );

  const invoiceId = inserted[0]?.id;
  if (!invoiceId) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al crear factura." });
  }

  for (const item of params.items) {
    await tx.$queryRawUnsafe(
      `INSERT INTO "InvoiceItem" (
         "invoiceId", description, quantity, "unitPrice", "totalPrice",
         "costCenterId", "serviceUnitId", "priceListId", "priceRuleId",
         "resolvedAt", "priceSource"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      invoiceId,
      item.description,
      item.quantity,
      item.unitPrice,
      item.totalPrice,
      item.costCenterId,
      item.serviceUnitId ?? null,
      item.priceListId,
      item.priceRuleId,
      item.resolvedAt,
      item.priceSource,
    );
  }

  return { id: invoiceId, invoiceNumber };
}
