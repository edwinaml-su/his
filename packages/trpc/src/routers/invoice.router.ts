/**
 * Router tRPC: Facturación — Invoice, InvoiceItem, InvoicePayment, InsuranceClaim.
 *
 * Las tablas Invoice/InvoiceItem/InvoicePayment/InsuranceClaim NO tienen modelos
 * Prisma (drift por diseño) — todas las queries usan $queryRawUnsafe.
 *
 * Trigger automático `trg_invoice_payment_recalc` en BD recalcula paidAmount
 * y status al insertar pagos; NO manipular status de Invoice manualmente
 * al agregar pagos.
 *
 * IVA: El Salvador, 13% sobre subtotal. Se calcula en el router al crear factura.
 *
 * Procedures:
 *   list         — readerProc, filtros opcionales: status, fechaDesde, fechaHasta, paginación
 *   get          — readerProc, retorna Invoice + InvoiceItem[] + InvoicePayment[] + InsuranceClaim[]
 *   create       — writerProc, crea Invoice + InvoiceItem[] en transacción
 *   addPayment   — writerProc, agrega InvoicePayment (trigger recalcula totals)
 *   voidInvoice  — writerProc, marca status='VOIDED'
 *   createClaim  — writerProc, registra InsuranceClaim
 *   listCostCenters — tenantProcedure, lista CostCenter activos para Select
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** IVA El Salvador (Art. 54 LIVA). */
const IVA_RATE = 0.13;

// ---------------------------------------------------------------------------
// Schemas locales
// ---------------------------------------------------------------------------

const invoiceStatusEnum = z.enum([
  "DRAFT",
  "ISSUED",
  "PAID",
  "PARTIALLY_PAID",
  "VOIDED",
]);

const paymentMethodEnum = z.enum([
  "CASH",
  "CARD",
  "TRANSFER",
  "INSURANCE",
  "OTHER",
]);

const claimStatusEnum = z.enum([
  "SUBMITTED",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "PARTIALLY_APPROVED",
  "PAID",
]);

const itemInput = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  costCenterId: z.string().uuid(),
  serviceUnitId: z.string().uuid().optional(),
});

const listInput = z.object({
  status: invoiceStatusEnum.optional(),
  fechaDesde: z.string().datetime().optional(),
  fechaHasta: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const createInput = z.object({
  patientId: z.string().uuid(),
  encounterId: z.string().uuid().optional(),
  insurerId: z.string().uuid().optional(),
  costCenterId: z.string().uuid().optional(),
  currencyId: z.string().uuid(),
  items: z.array(itemInput).min(1),
  status: z.enum(["DRAFT", "ISSUED"]).default("DRAFT"),
});

const addPaymentInput = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().positive(),
  method: paymentMethodEnum,
  referenceNumber: z.string().max(80).optional(),
});

const voidInput = z.object({
  invoiceId: z.string().uuid(),
});

const createClaimInput = z.object({
  invoiceId: z.string().uuid(),
  insurerId: z.string().uuid(),
  claimNumber: z.string().trim().min(1).max(80),
  submittedAmount: z.number().min(0),
});

// ---------------------------------------------------------------------------
// Tipos de fila raw
// ---------------------------------------------------------------------------

interface InvoiceRow {
  id: string;
  organizationId: string;
  establishmentId: string;
  encounterId: string | null;
  patientId: string;
  insurerId: string | null;
  invoiceNumber: string;
  issuedAt: Date;
  dueAt: Date | null;
  currencyId: string;
  exchangeRateToFunc: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  paidAmount: string;
  status: string;
  electronicInvoiceStatus: string;
  costCenterId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface InvoiceItemRow {
  id: string;
  invoiceId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
  serviceUnitId: string | null;
  costCenterId: string;
  estimatedCost: string | null;
  createdAt: Date;
}

interface InvoicePaymentRow {
  id: string;
  invoiceId: string;
  paidAt: Date;
  amount: string;
  method: string;
  referenceNumber: string | null;
  createdAt: Date;
}

interface InsuranceClaimRow {
  id: string;
  invoiceId: string;
  insurerId: string;
  claimNumber: string;
  submittedAt: Date;
  respondedAt: Date | null;
  status: string;
  submittedAmount: string;
  approvedAmount: string;
  rejectedAmount: string;
  rejectionReason: string | null;
  createdAt: Date;
}

interface CostCenterRow {
  id: string;
  code: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Helper: genera invoiceNumber único (YYYYMMDD-NNNNN)
// ---------------------------------------------------------------------------

function buildInvoiceNumber(): string {
  const d = new Date();
  const date = d.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 100000).toString().padStart(5, "0");
  return `${date}-${rand}`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const readerProc = tenantProcedure;
const writerProc = requireRole(["ADMIN", "ACCOUNTANT", "BILLING"]);

export const invoiceRouter = router({
  /**
   * Listado paginado de facturas con filtros opcionales.
   */
  list: readerProc.input(listInput).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;
    const orgId = tenant.organizationId;

    return withTenantContext(prisma, tenant, async (tx) => {
      const conditions: string[] = [`i."organizationId" = $1`];
      const params: unknown[] = [orgId];
      let idx = 2;

      if (input.status) {
        conditions.push(`i.status = $${idx++}::invoice_status`);
        params.push(input.status);
      }
      if (input.fechaDesde) {
        conditions.push(`i."issuedAt" >= $${idx++}`);
        params.push(input.fechaDesde);
      }
      if (input.fechaHasta) {
        conditions.push(`i."issuedAt" <= $${idx++}`);
        params.push(input.fechaHasta);
      }

      params.push(input.limit, input.offset);

      const rows = await tx.$queryRawUnsafe<InvoiceRow[]>(
        `SELECT i.id, i."organizationId", i."establishmentId", i."encounterId",
                i."patientId", i."insurerId", i."invoiceNumber", i."issuedAt",
                i."dueAt", i."currencyId", i."exchangeRateToFunc",
                i.subtotal, i."taxAmount", i."totalAmount", i."paidAmount",
                i.status, i."electronicInvoiceStatus", i."costCenterId",
                i.notes, i."createdAt", i."updatedAt"
           FROM "Invoice" i
          WHERE ${conditions.join(" AND ")}
          ORDER BY i."issuedAt" DESC
          LIMIT $${idx++} OFFSET $${idx++}`,
        ...params,
      );

      return rows;
    });
  }),

  /**
   * Detalle completo: Invoice + items + pagos + claims.
   */
  get: readerProc.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      const [invoices, items, payments, claims] = await Promise.all([
        tx.$queryRawUnsafe<InvoiceRow[]>(
          `SELECT i.id, i."organizationId", i."establishmentId", i."encounterId",
                  i."patientId", i."insurerId", i."invoiceNumber", i."issuedAt",
                  i."dueAt", i."currencyId", i."exchangeRateToFunc",
                  i.subtotal, i."taxAmount", i."totalAmount", i."paidAmount",
                  i.status, i."electronicInvoiceStatus", i."costCenterId",
                  i.notes, i."createdAt", i."updatedAt"
             FROM "Invoice" i
            WHERE i.id = $1 AND i."organizationId" = $2`,
          input.id,
          tenant.organizationId,
        ),
        tx.$queryRawUnsafe<InvoiceItemRow[]>(
          `SELECT id, "invoiceId", description, quantity, "unitPrice", "totalPrice",
                  "serviceUnitId", "costCenterId", "estimatedCost", "createdAt"
             FROM "InvoiceItem"
            WHERE "invoiceId" = $1`,
          input.id,
        ),
        tx.$queryRawUnsafe<InvoicePaymentRow[]>(
          `SELECT id, "invoiceId", "paidAt", amount, method, "referenceNumber", "createdAt"
             FROM "InvoicePayment"
            WHERE "invoiceId" = $1
            ORDER BY "paidAt" DESC`,
          input.id,
        ),
        tx.$queryRawUnsafe<InsuranceClaimRow[]>(
          `SELECT id, "invoiceId", "insurerId", "claimNumber", "submittedAt",
                  "respondedAt", status, "submittedAmount", "approvedAmount",
                  "rejectedAmount", "rejectionReason", "createdAt"
             FROM "InsuranceClaim"
            WHERE "invoiceId" = $1
            ORDER BY "submittedAt" DESC`,
          input.id,
        ),
      ]);

      const invoice = invoices[0];
      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Factura no encontrada." });
      }

      return { invoice, items, payments, claims };
    });
  }),

  /**
   * Crea Invoice + InvoiceItem[] en una sola transacción.
   * IVA: 13% sobre subtotal (LIVA El Salvador).
   * invoiceNumber: generado automáticamente (no forzamos consecutivo en MVP).
   */
  create: writerProc.input(createInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      // Obtener establishmentId del tenant
      type EstabRow = { id: string };
      const estabs = await tx.$queryRawUnsafe<EstabRow[]>(
        `SELECT id FROM "Establishment" WHERE "organizationId" = $1 LIMIT 1`,
        tenant.organizationId,
      );
      const establishmentId = estabs[0]?.id;
      if (!establishmentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No hay establecimiento activo para la organización.",
        });
      }

      // Calcular totales
      const subtotal = input.items.reduce(
        (acc, it) => acc + it.quantity * it.unitPrice,
        0,
      );
      const taxAmount = parseFloat((subtotal * IVA_RATE).toFixed(2));
      const totalAmount = parseFloat((subtotal + taxAmount).toFixed(2));
      const subtotalFixed = parseFloat(subtotal.toFixed(2));

      const invoiceNumber = buildInvoiceNumber();

      type IdRow = { id: string };

      const inserted = await tx.$queryRawUnsafe<IdRow[]>(
        `INSERT INTO "Invoice" (
           "organizationId", "establishmentId", "patientId", "encounterId",
           "insurerId", "costCenterId", "currencyId", "invoiceNumber",
           subtotal, "taxAmount", "totalAmount", status
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::invoice_status
         ) RETURNING id`,
        tenant.organizationId,
        establishmentId,
        input.patientId,
        input.encounterId ?? null,
        input.insurerId ?? null,
        input.costCenterId ?? null,
        input.currencyId,
        invoiceNumber,
        subtotalFixed,
        taxAmount,
        totalAmount,
        input.status,
      );

      const invoiceId = inserted[0]?.id;
      if (!invoiceId) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al crear factura." });
      }

      // Insertar items
      for (const item of input.items) {
        const totalPrice = parseFloat((item.quantity * item.unitPrice).toFixed(2));
        await tx.$queryRawUnsafe(
          `INSERT INTO "InvoiceItem" (
             "invoiceId", description, quantity, "unitPrice", "totalPrice",
             "costCenterId", "serviceUnitId"
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          invoiceId,
          item.description,
          item.quantity,
          item.unitPrice,
          totalPrice,
          item.costCenterId,
          item.serviceUnitId ?? null,
        );
      }

      return { id: invoiceId, invoiceNumber };
    });
  }),

  /**
   * Agrega un pago. El trigger trg_invoice_payment_recalc recalcula
   * Invoice.paidAmount y status automáticamente.
   */
  addPayment: writerProc.input(addPaymentInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      // Verificar que la factura pertenece al tenant y no está VOIDED
      type StatusRow = { status: string };
      const rows = await tx.$queryRawUnsafe<StatusRow[]>(
        `SELECT status FROM "Invoice" WHERE id = $1 AND "organizationId" = $2`,
        input.invoiceId,
        tenant.organizationId,
      );

      const inv = rows[0];
      if (!inv) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Factura no encontrada." });
      }
      if (inv.status === "VOIDED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede registrar pago en una factura anulada.",
        });
      }

      type IdRow = { id: string };
      const result = await tx.$queryRawUnsafe<IdRow[]>(
        `INSERT INTO "InvoicePayment" ("invoiceId", amount, method, "referenceNumber")
         VALUES ($1, $2, $3::payment_method, $4)
         RETURNING id`,
        input.invoiceId,
        input.amount,
        input.method,
        input.referenceNumber ?? null,
      );

      return { id: result[0]?.id };
    });
  }),

  /**
   * Anula una factura. Solo cambia status; no elimina registros.
   */
  voidInvoice: writerProc.input(voidInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      type StatusRow = { status: string };
      const rows = await tx.$queryRawUnsafe<StatusRow[]>(
        `SELECT status FROM "Invoice" WHERE id = $1 AND "organizationId" = $2`,
        input.invoiceId,
        tenant.organizationId,
      );

      const inv = rows[0];
      if (!inv) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Factura no encontrada." });
      }
      if (inv.status === "VOIDED") {
        return { invoiceId: input.invoiceId }; // idempotente
      }

      await tx.$queryRawUnsafe(
        `UPDATE "Invoice" SET status = 'VOIDED'::invoice_status, "updatedAt" = now()
          WHERE id = $1`,
        input.invoiceId,
      );

      return { invoiceId: input.invoiceId };
    });
  }),

  /**
   * Registra un InsuranceClaim para una Invoice que tenga insurerId.
   */
  createClaim: writerProc.input(createClaimInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      // Verificar que la factura existe y pertenece al tenant
      type InvCheckRow = { id: string; status: string };
      const rows = await tx.$queryRawUnsafe<InvCheckRow[]>(
        `SELECT id, status FROM "Invoice" WHERE id = $1 AND "organizationId" = $2`,
        input.invoiceId,
        tenant.organizationId,
      );

      const inv = rows[0];
      if (!inv) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Factura no encontrada." });
      }
      if (inv.status === "VOIDED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede crear claim sobre factura anulada.",
        });
      }

      type IdRow = { id: string };
      const result = await tx.$queryRawUnsafe<IdRow[]>(
        `INSERT INTO "InsuranceClaim" (
           "invoiceId", "insurerId", "claimNumber", "submittedAmount"
         ) VALUES ($1, $2, $3, $4)
         RETURNING id`,
        input.invoiceId,
        input.insurerId,
        input.claimNumber,
        input.submittedAmount,
      );

      return { id: result[0]?.id };
    });
  }),

  /**
   * Lista CostCenters activos del tenant (para Select en formularios).
   */
  listCostCenters: tenantProcedure.query(async ({ ctx }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      const rows = await tx.$queryRawUnsafe<CostCenterRow[]>(
        `SELECT id, code, name
           FROM "CostCenter"
          WHERE "organizationId" = $1 AND active = true
          ORDER BY code`,
        tenant.organizationId,
      );
      return rows;
    });
  }),
});
