/**
 * Beta.18 — Router de contabilidad multi-libro (TDR §23, ADR 0007).
 *
 * Sin DTE Hacienda (ADR 0006 — servicio satélite separado).
 *
 * Procedures:
 *   accounting.chart.list          — plan de cuentas de un libro
 *   accounting.chart.create        — crear cuenta (ACCOUNTANT)
 *   accounting.chart.update        — actualizar metadata (ACCOUNTANT, no cambia tipo)
 *   accounting.period.list         — períodos de un libro
 *   accounting.period.create       — crear período (ACCOUNTANT)
 *   accounting.period.close        — cerrar período (ACCOUNTANT_SENIOR)
 *   accounting.journal.list        — asientos de un período/libro
 *   accounting.journal.draft       — crear asiento en DRAFT (ACCOUNTANT)
 *   accounting.journal.post        — confirmar asiento DRAFT → POSTED (ACCOUNTANT)
 *   accounting.journal.reverse     — crear contraasiento (ACCOUNTANT_SENIOR)
 *   accounting.costCenter.list     — centros de costos
 *   accounting.costCenter.create   — crear centro de costos (ACCOUNTANT)
 *
 * Seguridad:
 *   - Toda query en withTenantContext (RLS + demoteRole).
 *   - requireRole(["ACCOUNTANT"]) o requireRole(["ACCOUNTANT_SENIOR"]).
 *
 * Eventos de dominio:
 *   - accounting.periodClosed       → recipient: ACCOUNTANT_SENIOR
 *   - accounting.journalPostedHighValue → umbral configurable (HIGH_VALUE_THRESHOLD)
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { emitDomainEvent } from "@his/database";
import {
  type AccountingPeriodClosedPayload,
  type AccountingJournalPostedHighValuePayload,
} from "@his/contracts/events";
import { router, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

/** Umbral en USD para evento journalPostedHighValue. */
const HIGH_VALUE_THRESHOLD = 10_000;

// ---------------------------------------------------------------------------
// Schemas Zod locales
// ---------------------------------------------------------------------------

const accountTypeEnum = z.enum([
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
  "STATISTICAL",
]);

const periodStatusEnum = z.enum(["OPEN", "PENDING_CLOSE", "CLOSED", "REOPENED"]);
const journalStatusEnum = z.enum(["DRAFT", "POSTED", "REVERSED"]);
const journalOriginEnum = z.enum([
  "MANUAL",
  "SISTEMA_FACTURACION",
  "SISTEMA_NOMINA",
  "AJUSTE",
  "CIERRE",
]);

// --- Chart of Accounts ---
const chartListInput = z.object({
  ledgerId:       z.string().uuid(),
  parentAccountId: z.string().uuid().nullable().optional(),
  activeOnly:     z.boolean().optional().default(true),
});

const chartCreateInput = z.object({
  ledgerId:        z.string().uuid(),
  code:            z.string().trim().min(1).max(40),
  name:            z.string().trim().min(2).max(200),
  accountType:     accountTypeEnum,
  isLeaf:          z.boolean().optional().default(true),
  parentAccountId: z.string().uuid().nullable().optional(),
  currencyId:      z.string().uuid(),
});

const chartUpdateInput = z.object({
  id:          z.string().uuid(),
  name:        z.string().trim().min(2).max(200).optional(),
  allowPosting: z.boolean().optional(),
  active:      z.boolean().optional(),
});

// --- Accounting Period ---
const periodListInput = z.object({
  ledgerId:   z.string().uuid(),
  status:     periodStatusEnum.optional(),
  periodYear: z.number().int().optional(),
});

const periodCreateInput = z.object({
  ledgerId:    z.string().uuid(),
  periodYear:  z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(0).max(12),
  startDate:   z.string().date(),
  endDate:     z.string().date(),
});

const periodCloseInput = z.object({
  periodId:    z.string().uuid(),
  closingNote: z.string().max(500).optional(),
});

// --- Journal Entry ---
const journalLineSchema = z.object({
  lineNumber:    z.number().int().min(1),
  accountId:     z.string().uuid(),
  debit:         z.number().min(0),
  credit:        z.number().min(0),
  descripcion:   z.string().max(300).optional(),
  costCenterId:  z.string().uuid().nullable().optional(),
  thirdPartyType: z.string().max(30).nullable().optional(),
  thirdPartyId:  z.string().uuid().nullable().optional(),
}).refine(
  (l) => !(l.debit > 0 && l.credit > 0),
  { message: "Una línea no puede tener debit y credit ambos > 0." },
);

const journalDraftInput = z.object({
  ledgerId:     z.string().uuid(),
  periodId:     z.string().uuid(),
  entryDate:    z.string().date(),
  descripcion:  z.string().trim().min(3).max(500),
  origen:       journalOriginEnum.optional().default("MANUAL"),
  currencyId:   z.string().uuid(),
  fxRate:       z.number().positive().optional(),
  fxRateDate:   z.string().date().optional(),
  documentRef:  z.string().max(120).optional(),
  documentType: z.string().max(60).optional(),
  lines:        z.array(journalLineSchema).min(2),
}).refine(
  (input) => {
    const totalDebit  = input.lines.reduce((s, l) => s + l.debit,  0);
    const totalCredit = input.lines.reduce((s, l) => s + l.credit, 0);
    return Math.abs(totalDebit - totalCredit) < 0.005;
  },
  { message: "La suma de débitos debe igualar la suma de créditos (partida doble)." },
);

const journalPostInput = z.object({
  journalEntryId: z.string().uuid(),
});

const journalListInput = z.object({
  ledgerId:  z.string().uuid().optional(),
  periodId:  z.string().uuid().optional(),
  status:    journalStatusEnum.optional(),
  limit:     z.number().int().min(1).max(200).optional().default(50),
  cursor:    z.string().uuid().optional(),
});

const journalReverseInput = z.object({
  journalEntryId: z.string().uuid(),
  descripcion:    z.string().trim().min(3).max(500),
  entryDate:      z.string().date(),
});

// --- Cost Center ---
const costCenterListInput = z.object({
  parentId:   z.string().uuid().nullable().optional(),
  activeOnly: z.boolean().optional().default(true),
});

const costCenterCreateInput = z.object({
  code:     z.string().trim().min(1).max(20),
  name:     z.string().trim().min(2).max(120),
  parentId: z.string().uuid().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rethrowPrisma(err: unknown): never {
  // Duck-typing por compatibilidad con el stub de @his/database en tests
  // (Prisma.PrismaClientKnownRequestError no está disponible en el stub).
  if (
    err != null &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  ) {
    const code = (err as { code: string }).code;
    if (code === "P2002") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Ya existe un registro con ese código en la organización.",
      });
    }
    if (code === "P2003") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Referencia inválida (FK). Verifica ledger, currency, account, etc.",
      });
    }
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Sub-routers
// ---------------------------------------------------------------------------

const chartRouter = router({
  list: requireRole(["ACCOUNTANT", "ACCOUNTANT_SENIOR", "ADMIN"]).input(chartListInput).query(
    async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.account.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ledgerId: input.ledgerId,
            ...(input.parentAccountId !== undefined
              ? { parentAccountId: input.parentAccountId }
              : {}),
            ...(input.activeOnly ? { active: true } : {}),
          },
          include: {
            parent: { select: { id: true, code: true, name: true } },
            _count: { select: { children: true, journalLines: true } },
          },
          orderBy: [{ code: "asc" }],
        });
      });
    },
  ),

  create: requireRole(["ACCOUNTANT", "ACCOUNTANT_SENIOR", "ADMIN"])
    .input(chartCreateInput)
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Calcular nivel jerárquico.
        let level = 1;
        if (input.parentAccountId) {
          const parent = await tx.account.findUnique({
            where: { id: input.parentAccountId },
            select: { id: true, level: true, ledgerId: true, accountType: true },
          });
          if (!parent) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cuenta padre no existe.",
            });
          }
          if (parent.ledgerId !== input.ledgerId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "La cuenta padre pertenece a un libro diferente.",
            });
          }
          // El hijo hereda el tipo del padre (ADR 0007 D3).
          if (parent.accountType !== input.accountType) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `El tipo de cuenta debe coincidir con el tipo del padre (${parent.accountType}).`,
            });
          }
          level = parent.level + 1;
        }

        try {
          return await tx.account.create({
            data: {
              organizationId:  ctx.tenant.organizationId,
              ledgerId:        input.ledgerId,
              code:            input.code,
              name:            input.name,
              accountType:     input.accountType,
              isLeaf:          input.isLeaf,
              allowPosting:    input.isLeaf,
              parentAccountId: input.parentAccountId ?? null,
              level,
              currencyId:      input.currencyId,
            },
          });
        } catch (err) {
          rethrowPrisma(err);
        }
      });
    }),

  update: requireRole(["ACCOUNTANT", "ACCOUNTANT_SENIOR", "ADMIN"])
    .input(chartUpdateInput)
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const existing = await tx.account.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
        });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta no encontrada." });
        }
        // No se puede cambiar accountType (rompería jerarquía).
        return tx.account.update({
          where: { id: input.id },
          data: {
            ...(input.name        !== undefined ? { name: input.name }               : {}),
            ...(input.allowPosting !== undefined ? { allowPosting: input.allowPosting } : {}),
            ...(input.active      !== undefined ? { active: input.active }           : {}),
          },
        });
      });
    }),
});

const periodRouter = router({
  list: requireRole(["ACCOUNTANT", "ACCOUNTANT_SENIOR", "ADMIN"]).input(periodListInput).query(
    async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.accountingPeriod.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ledgerId: input.ledgerId,
            ...(input.status     ? { status: input.status }         : {}),
            ...(input.periodYear ? { periodYear: input.periodYear }  : {}),
          },
          orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
        });
      });
    },
  ),

  create: requireRole(["ACCOUNTANT", "ACCOUNTANT_SENIOR", "ADMIN"])
    .input(periodCreateInput)
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Verificar que el ledger pertenece al tenant.
        const ledger = await tx.ledger.findFirst({
          where: { id: input.ledgerId, organizationId: ctx.tenant.organizationId },
        });
        if (!ledger) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Libro no encontrado." });
        }
        try {
          return await tx.accountingPeriod.create({
            data: {
              organizationId: ctx.tenant.organizationId,
              ledgerId:       input.ledgerId,
              periodYear:     input.periodYear,
              periodMonth:    input.periodMonth,
              startDate:      new Date(input.startDate),
              endDate:        new Date(input.endDate),
              status:         "OPEN",
            },
          });
        } catch (err) {
          rethrowPrisma(err);
        }
      });
    }),

  close: requireRole(["ACCOUNTANT_SENIOR", "ADMIN"])
    .input(periodCloseInput)
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const period = await tx.accountingPeriod.findFirst({
          where: { id: input.periodId, organizationId: ctx.tenant.organizationId },
        });
        if (!period) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Período no encontrado." });
        }
        if (period.status === "CLOSED") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "El período ya está cerrado.",
          });
        }

        // Verificar que no hay asientos DRAFT pendientes en este período.
        const draftCount = await tx.journalEntry.count({
          where: {
            periodId:       input.periodId,
            organizationId: ctx.tenant.organizationId,
            status:         "DRAFT",
          },
        });
        if (draftCount > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Existen ${draftCount} asiento(s) en DRAFT. Postearlos o eliminarlos antes de cerrar el período.`,
          });
        }

        const closed = await tx.accountingPeriod.update({
          where: { id: input.periodId },
          data: {
            status:      "CLOSED",
            closedById:  ctx.user.id,
            closedAt:    new Date(),
            closingNote: input.closingNote,
          },
        });

        // Evento de dominio: accounting.periodClosed.
        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType:      "accounting.periodClosed",
          aggregateType:  "AccountingPeriod",
          aggregateId:    closed.id,
          emittedById:    ctx.user.id,
          payload: {
            organizationId: ctx.tenant.organizationId,
            ledgerId:       closed.ledgerId,
            periodId:       closed.id,
            periodYear:     closed.periodYear,
            periodMonth:    closed.periodMonth,
            closedById:     ctx.user.id,
          } satisfies AccountingPeriodClosedPayload,
        });

        return closed;
      });
    }),
});

const journalRouter = router({
  list: requireRole(["ACCOUNTANT", "ACCOUNTANT_SENIOR", "ADMIN"]).input(journalListInput).query(
    async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const items = await tx.journalEntry.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(input.ledgerId ? { ledgerId: input.ledgerId } : {}),
            ...(input.periodId ? { periodId: input.periodId } : {}),
            ...(input.status   ? { status: input.status }     : {}),
          },
          include: {
            _count: { select: { lines: true } },
            createdBy: { select: { id: true, fullName: true } },
          },
          orderBy: [{ entryDate: "desc" }, { numeroCorrelativo: "desc" }],
          take: input.limit,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        });
        const nextCursor =
          items.length === input.limit ? items[items.length - 1]!.id : null;
        return { items, nextCursor };
      });
    },
  ),

  draft: requireRole(["ACCOUNTANT", "ACCOUNTANT_SENIOR", "ADMIN"])
    .input(journalDraftInput)
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Verificar que el período existe, pertenece al tenant y está OPEN/REOPENED.
        const period = await tx.accountingPeriod.findFirst({
          where: { id: input.periodId, organizationId: ctx.tenant.organizationId },
        });
        if (!period) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Período no encontrado." });
        }
        if (!["OPEN", "REOPENED"].includes(period.status)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Período en estado ${period.status}. Solo períodos OPEN o REOPENED aceptan asientos.`,
          });
        }

        // Generar número correlativo (MAX + 1 por ledger + period dentro de la tx).
        const maxCorrelativo = await tx.journalEntry.aggregate({
          _max: { numeroCorrelativo: true },
          where: {
            organizationId: ctx.tenant.organizationId,
            ledgerId:       input.ledgerId,
            periodId:       input.periodId,
          },
        });
        const nextCorrelativo = (maxCorrelativo._max.numeroCorrelativo ?? 0) + 1;

        try {
          const entry = await tx.journalEntry.create({
            data: {
              organizationId:    ctx.tenant.organizationId,
              ledgerId:          input.ledgerId,
              periodId:          input.periodId,
              entryDate:         new Date(input.entryDate),
              numeroCorrelativo: nextCorrelativo,
              descripcion:       input.descripcion,
              origen:            input.origen,
              status:            "DRAFT",
              currencyId:        input.currencyId,
              fxRate:            input.fxRate    ?? null,
              fxRateDate:        input.fxRateDate ? new Date(input.fxRateDate) : null,
              documentRef:       input.documentRef  ?? null,
              documentType:      input.documentType ?? null,
              createdById:       ctx.user.id,
              lines: {
                create: input.lines.map((l) => ({
                  lineNumber:     l.lineNumber,
                  accountId:      l.accountId,
                  debit:          l.debit,
                  credit:         l.credit,
                  descripcion:    l.descripcion    ?? null,
                  costCenterId:   l.costCenterId   ?? null,
                  thirdPartyType: l.thirdPartyType ?? null,
                  thirdPartyId:   l.thirdPartyId   ?? null,
                })),
              },
            },
            include: {
              lines: { orderBy: { lineNumber: "asc" } },
            },
          });
          return entry;
        } catch (err) {
          rethrowPrisma(err);
        }
      });
    }),

  post: requireRole(["ACCOUNTANT", "ACCOUNTANT_SENIOR", "ADMIN"])
    .input(journalPostInput)
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const entry = await tx.journalEntry.findFirst({
          where: {
            id:             input.journalEntryId,
            organizationId: ctx.tenant.organizationId,
          },
          include: {
            lines: true,
            period: { select: { id: true, status: true } },
          },
        });
        if (!entry) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Asiento no encontrado." });
        }
        if (entry.status !== "DRAFT") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `El asiento está en estado ${entry.status}, no se puede postear.`,
          });
        }
        if (!["OPEN", "REOPENED"].includes(entry.period.status)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "El período del asiento está cerrado.",
          });
        }

        // Validar balance (doble verificación antes del trigger SQL).
        const totalDebit  = entry.lines.reduce((s, l) => s + Number(l.debit),  0);
        const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
        if (Math.abs(totalDebit - totalCredit) >= 0.005) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Asiento desbalanceado: debit=${totalDebit}, credit=${totalCredit}.`,
          });
        }

        const posted = await tx.journalEntry.update({
          where: { id: input.journalEntryId },
          data: {
            status:      "POSTED",
            postedAt:    new Date(),
            postedById:  ctx.user.id,
          },
        });

        // Evento journalPostedHighValue si supera umbral.
        if (totalDebit > HIGH_VALUE_THRESHOLD) {
          await emitDomainEvent(tx, {
            organizationId: ctx.tenant.organizationId,
            eventType:      "accounting.journalPostedHighValue",
            aggregateType:  "JournalEntry",
            aggregateId:    posted.id,
            emittedById:    ctx.user.id,
            payload: {
              organizationId:    ctx.tenant.organizationId,
              ledgerId:          posted.ledgerId,
              journalEntryId:    posted.id,
              totalDebit,
              thresholdExceeded: HIGH_VALUE_THRESHOLD,
              postedById:        ctx.user.id,
            } satisfies AccountingJournalPostedHighValuePayload,
          });
        }

        return posted;
      });
    }),

  reverse: requireRole(["ACCOUNTANT_SENIOR", "ADMIN"])
    .input(journalReverseInput)
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const original = await tx.journalEntry.findFirst({
          where: {
            id:             input.journalEntryId,
            organizationId: ctx.tenant.organizationId,
          },
          include: { lines: true, period: { select: { id: true, status: true } } },
        });
        if (!original) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Asiento no encontrado." });
        }
        if (original.status !== "POSTED") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Solo se puede revertir un asiento POSTED.",
          });
        }
        // El contraasiento va en el mismo período si está OPEN/REOPENED;
        // de lo contrario, el caller debe pasar otro periodId (no soportado
        // en esta versión; se puede extender).
        if (!["OPEN", "REOPENED"].includes(original.period.status)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "El período del asiento original está CLOSED. Reabrirlo antes de revertir.",
          });
        }

        // Correlativo para el contraasiento.
        const maxCorrelativo = await tx.journalEntry.aggregate({
          _max: { numeroCorrelativo: true },
          where: {
            organizationId: ctx.tenant.organizationId,
            ledgerId:       original.ledgerId,
            periodId:       original.periodId,
          },
        });
        const nextCorrelativo = (maxCorrelativo._max.numeroCorrelativo ?? 0) + 1;

        // Crear contraasiento: líneas invertidas (debit ↔ credit).
        const reversal = await tx.journalEntry.create({
          data: {
            organizationId:    ctx.tenant.organizationId,
            ledgerId:          original.ledgerId,
            periodId:          original.periodId,
            entryDate:         new Date(input.entryDate),
            numeroCorrelativo: nextCorrelativo,
            descripcion:       input.descripcion,
            origen:            "AJUSTE",
            status:            "POSTED",
            currencyId:        original.currencyId,
            fxRate:            original.fxRate,
            fxRateDate:        original.fxRateDate,
            documentRef:       original.documentRef,
            documentType:      original.documentType,
            postedAt:          new Date(),
            postedById:        ctx.user.id,
            createdById:       ctx.user.id,
            reversalOfId:      original.id,
            lines: {
              create: original.lines.map((l) => ({
                lineNumber:     l.lineNumber,
                accountId:      l.accountId,
                // Invertir: debit ↔ credit.
                debit:          l.credit,
                credit:         l.debit,
                descripcion:    l.descripcion,
                costCenterId:   l.costCenterId,
                thirdPartyType: l.thirdPartyType,
                thirdPartyId:   l.thirdPartyId,
              })),
            },
          },
          include: { lines: { orderBy: { lineNumber: "asc" } } },
        });

        // Marcar el entry original como REVERSED.
        await tx.journalEntry.update({
          where: { id: original.id },
          data:  { status: "REVERSED" },
        });

        return reversal;
      });
    }),
});

const costCenterRouter = router({
  list: requireRole(["ACCOUNTANT", "ACCOUNTANT_SENIOR", "ADMIN"])
    .input(costCenterListInput)
    .query(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.costCenter.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
            ...(input.activeOnly ? { active: true } : {}),
          },
          include: {
            parent: { select: { id: true, code: true, name: true } },
            _count: { select: { children: true } },
          },
          orderBy: [{ code: "asc" }],
        });
      });
    }),

  create: requireRole(["ACCOUNTANT", "ACCOUNTANT_SENIOR", "ADMIN"])
    .input(costCenterCreateInput)
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        try {
          return await tx.costCenter.create({
            data: {
              organizationId: ctx.tenant.organizationId,
              code:           input.code,
              name:           input.name,
              parentId:       input.parentId ?? null,
            },
          });
        } catch (err) {
          rethrowPrisma(err);
        }
      });
    }),
});

// ---------------------------------------------------------------------------
// Router principal
// ---------------------------------------------------------------------------

export const accountingRouter = router({
  chart:       chartRouter,
  period:      periodRouter,
  journal:     journalRouter,
  costCenter:  costCenterRouter,
});
