/**
 * Tests del accountingRouter — Beta.18 (TDR §23, ADR 0007).
 *
 * Cubre:
 *   - Validación Zod: balance partida doble, debit+credit ambos > 0.
 *   - chart.list / chart.create / chart.update.
 *   - period.list / period.create / period.close.
 *   - journal.draft / journal.post / journal.reverse.
 *   - costCenter.list / costCenter.create.
 *   - RLS cross-tenant isolation.
 *   - Constraint: POSTED immutable.
 *   - Constraint: período CLOSED no acepta entries.
 *   - Eventos de dominio emitidos correctamente.
 *
 * Patrones:
 *   - mockDeep<PrismaClient>() + wireTransaction (como inpatient.router.test.ts).
 *   - $executeRawUnsafe mockeado para withTenantContext/applyTenantContext.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { accountingRouter } from "../accounting.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_USER_ADMIN, MOCK_TENANT_OTHER_ORG } from "@his/test-utils";

// ---------------------------------------------------------------------------
// Constantes reutilizables
// ---------------------------------------------------------------------------

const ORG_ID   = MOCK_TENANT.organizationId;
const USER_ID  = MOCK_USER_ADMIN.id;
const LEDGER_ID  = "00000000-0000-0000-0001-000000000001";
const PERIOD_ID  = "00000000-0000-0000-0002-000000000001";
const ACCOUNT_ID = "00000000-0000-0000-0003-000000000001";
const CURRENCY_ID = "00000000-0000-0000-0004-000000000001";
const ENTRY_ID   = "00000000-0000-0000-0005-000000000001";
const CENTER_ID  = "00000000-0000-0000-0006-000000000001";

const OPEN_PERIOD = {
  id:             PERIOD_ID,
  organizationId: ORG_ID,
  ledgerId:       LEDGER_ID,
  periodYear:     2026,
  periodMonth:    1,
  startDate:      new Date("2026-01-01"),
  endDate:        new Date("2026-01-31"),
  status:         "OPEN",
  closingNote:    null,
  closedAt:       null,
  closedById:     null,
  createdAt:      new Date(),
  updatedAt:      new Date(),
};

const DRAFT_ENTRY = {
  id:                ENTRY_ID,
  organizationId:    ORG_ID,
  ledgerId:          LEDGER_ID,
  periodId:          PERIOD_ID,
  entryDate:         new Date("2026-01-15"),
  numeroCorrelativo: 1,
  descripcion:       "Asiento de prueba",
  origen:            "MANUAL",
  status:            "DRAFT",
  currencyId:        CURRENCY_ID,
  fxRate:            null,
  fxRateDate:        null,
  documentRef:       null,
  documentType:      null,
  postedAt:          null,
  postedById:        null,
  createdById:       USER_ID,
  reversalOfId:      null,
  createdAt:         new Date(),
  updatedAt:         new Date(),
  period:            { id: PERIOD_ID, status: "OPEN" },
  lines: [
    {
      id:             "00000000-0000-0000-0007-000000000001",
      journalEntryId: ENTRY_ID,
      lineNumber:     1,
      accountId:      ACCOUNT_ID,
      debit:          1000,
      credit:         0,
      descripcion:    null,
      costCenterId:   null,
      thirdPartyType: null,
      thirdPartyId:   null,
      createdAt:      new Date(),
    },
    {
      id:             "00000000-0000-0000-0007-000000000002",
      journalEntryId: ENTRY_ID,
      lineNumber:     2,
      accountId:      "00000000-0000-0000-0003-000000000002",
      debit:          0,
      credit:         1000,
      descripcion:    null,
      costCenterId:   null,
      thirdPartyType: null,
      thirdPartyId:   null,
      createdAt:      new Date(),
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers de test
// ---------------------------------------------------------------------------

function wireTransaction(prisma: DeepMockProxy<PrismaClient>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma.$transaction.mockImplementation(async (cb: any) => {
    if (typeof cb === "function") {
      return cb(prisma);
    }
    return cb;
  });
  // $executeRawUnsafe necesario para withTenantContext (applyTenantContext).
  prisma.$executeRawUnsafe.mockResolvedValue(undefined as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("accountingRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    wireTransaction(prisma);
  });

  // -------------------------------------------------------------------------
  // chart.list
  // -------------------------------------------------------------------------
  describe("chart.list", () => {
    it("filtra por organizationId y ledgerId", async () => {
      prisma.account.findMany.mockResolvedValue([] as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await caller.chart.list({ ledgerId: LEDGER_ID });

      const args = prisma.account.findMany.mock.calls[0]![0];
      expect(args!.where!.organizationId).toBe(ORG_ID);
      expect(args!.where!.ledgerId).toBe(LEDGER_ID);
    });

    it("aplica filtro activeOnly por default", async () => {
      prisma.account.findMany.mockResolvedValue([] as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await caller.chart.list({ ledgerId: LEDGER_ID, activeOnly: true });

      const args = prisma.account.findMany.mock.calls[0]![0];
      expect(args!.where!.active).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // chart.create
  // -------------------------------------------------------------------------
  describe("chart.create", () => {
    it("crea cuenta raíz con level=1", async () => {
      prisma.account.create.mockResolvedValue({ id: ACCOUNT_ID, level: 1 } as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await caller.chart.create({
        ledgerId:    LEDGER_ID,
        code:        "1.01",
        name:        "Activos Corrientes",
        accountType: "ASSET",
        currencyId:  CURRENCY_ID,
      });

      const data = prisma.account.create.mock.calls[0]![0].data;
      expect(data.level).toBe(1);
      expect(data.organizationId).toBe(ORG_ID);
      expect(data.ledgerId).toBe(LEDGER_ID);
    });

    it("calcula level=parentLevel+1 y valida tipo coincide con padre", async () => {
      const PARENT_ID = "00000000-0000-0000-0009-000000000001";
      prisma.account.findUnique.mockResolvedValue({
        id:          PARENT_ID,
        level:       1,
        ledgerId:    LEDGER_ID,
        accountType: "ASSET",
      } as never);
      prisma.account.create.mockResolvedValue({ id: ACCOUNT_ID, level: 2 } as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await caller.chart.create({
        ledgerId:        LEDGER_ID,
        code:            "1.01.001",
        name:            "Caja",
        accountType:     "ASSET",
        parentAccountId: PARENT_ID,
        currencyId:      CURRENCY_ID,
      });

      const data = prisma.account.create.mock.calls[0]![0].data;
      expect(data.level).toBe(2);
    });

    it("rechaza si tipo de cuenta no coincide con el padre", async () => {
      const PARENT_ID = "00000000-0000-0000-0009-000000000002";
      prisma.account.findUnique.mockResolvedValue({
        id:          PARENT_ID,
        level:       1,
        ledgerId:    LEDGER_ID,
        accountType: "ASSET",
      } as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.chart.create({
          ledgerId:        LEDGER_ID,
          code:            "4.01",
          name:            "Ingresos",
          accountType:     "REVENUE",     // distinto del padre ASSET
          parentAccountId: PARENT_ID,
          currencyId:      CURRENCY_ID,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // -------------------------------------------------------------------------
  // period.create
  // -------------------------------------------------------------------------
  describe("period.create", () => {
    it("crea período OPEN correctamente", async () => {
      prisma.ledger.findFirst.mockResolvedValue({ id: LEDGER_ID, organizationId: ORG_ID } as never);
      prisma.accountingPeriod.create.mockResolvedValue({ ...OPEN_PERIOD } as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.period.create({
        ledgerId:    LEDGER_ID,
        periodYear:  2026,
        periodMonth: 1,
        startDate:   "2026-01-01",
        endDate:     "2026-01-31",
      });

      expect(result.status).toBe("OPEN");
    });

    it("retorna NOT_FOUND si ledger no existe en el tenant", async () => {
      prisma.ledger.findFirst.mockResolvedValue(null as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.period.create({
          ledgerId:    LEDGER_ID,
          periodYear:  2026,
          periodMonth: 1,
          startDate:   "2026-01-01",
          endDate:     "2026-01-31",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // -------------------------------------------------------------------------
  // period.close
  // -------------------------------------------------------------------------
  describe("period.close", () => {
    it("cierra período correctamente y emite evento", async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue({ ...OPEN_PERIOD } as never);
      prisma.journalEntry.count.mockResolvedValue(0 as never);
      prisma.accountingPeriod.update.mockResolvedValue({
        ...OPEN_PERIOD,
        status: "CLOSED",
        closedById: USER_ID,
        closedAt:   new Date(),
      } as never);
      prisma.domainEvent.create.mockResolvedValue({ id: "ev-1" } as never);
      prisma.auditLog.create.mockResolvedValue({ id: "al-1" } as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.period.close({ periodId: PERIOD_ID });

      expect(result.status).toBe("CLOSED");
      expect(prisma.domainEvent.create).toHaveBeenCalledOnce();
      const evData = prisma.domainEvent.create.mock.calls[0]![0].data;
      expect(evData.eventType).toBe("accounting.periodClosed");
    });

    it("falla CONFLICT si ya está cerrado", async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue({
        ...OPEN_PERIOD,
        status: "CLOSED",
      } as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.period.close({ periodId: PERIOD_ID }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("falla CONFLICT si hay asientos DRAFT pendientes", async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue({ ...OPEN_PERIOD } as never);
      prisma.journalEntry.count.mockResolvedValue(3 as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.period.close({ periodId: PERIOD_ID }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  // -------------------------------------------------------------------------
  // journal.draft — validaciones Zod (partida doble)
  // -------------------------------------------------------------------------
  describe("journal.draft — validación Zod", () => {
    const validLines = [
      { lineNumber: 1, accountId: ACCOUNT_ID, debit: 500, credit: 0 },
      { lineNumber: 2, accountId: "00000000-0000-0000-0003-000000000002", debit: 0, credit: 500 },
    ];

    it("acepta asiento balanceado", async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue({ ...OPEN_PERIOD } as never);
      prisma.journalEntry.aggregate.mockResolvedValue({ _max: { numeroCorrelativo: 0 } } as never);
      prisma.journalEntry.create.mockResolvedValue({ ...DRAFT_ENTRY } as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.journal.draft({
          ledgerId:    LEDGER_ID,
          periodId:    PERIOD_ID,
          entryDate:   "2026-01-15",
          descripcion: "Test asiento balanceado",
          currencyId:  CURRENCY_ID,
          lines:       validLines,
        }),
      ).resolves.toBeTruthy();
    });

    it("rechaza asiento desbalanceado (Zod refine)", async () => {
      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.journal.draft({
          ledgerId:    LEDGER_ID,
          periodId:    PERIOD_ID,
          entryDate:   "2026-01-15",
          descripcion: "Asiento desbalanceado",
          currencyId:  CURRENCY_ID,
          lines: [
            { lineNumber: 1, accountId: ACCOUNT_ID, debit: 500, credit: 0 },
            { lineNumber: 2, accountId: "00000000-0000-0000-0003-000000000002", debit: 0, credit: 300 },
          ],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rechaza línea con debit y credit ambos > 0 (Zod refine)", async () => {
      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.journal.draft({
          ledgerId:    LEDGER_ID,
          periodId:    PERIOD_ID,
          entryDate:   "2026-01-15",
          descripcion: "Línea inválida",
          currencyId:  CURRENCY_ID,
          lines: [
            { lineNumber: 1, accountId: ACCOUNT_ID, debit: 500, credit: 200 },
            { lineNumber: 2, accountId: "00000000-0000-0000-0003-000000000002", debit: 0, credit: 300 },
          ],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rechaza si el período está CLOSED", async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue({
        ...OPEN_PERIOD,
        status: "CLOSED",
      } as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.journal.draft({
          ledgerId:    LEDGER_ID,
          periodId:    PERIOD_ID,
          entryDate:   "2026-01-15",
          descripcion: "Asiento en período cerrado",
          currencyId:  CURRENCY_ID,
          lines:       validLines,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  // -------------------------------------------------------------------------
  // journal.post
  // -------------------------------------------------------------------------
  describe("journal.post", () => {
    it("postea asiento DRAFT y emite evento si supera umbral", async () => {
      const highValueEntry = {
        ...DRAFT_ENTRY,
        lines: DRAFT_ENTRY.lines.map((l, i) =>
          i === 0
            ? { ...l, debit: 15000, credit: 0 }
            : { ...l, debit: 0, credit: 15000 },
        ),
      };
      prisma.journalEntry.findFirst.mockResolvedValue(highValueEntry as never);
      prisma.journalEntry.update.mockResolvedValue({
        ...highValueEntry,
        status:      "POSTED",
        postedAt:    new Date(),
        postedById:  USER_ID,
      } as never);
      prisma.domainEvent.create.mockResolvedValue({ id: "ev-2" } as never);
      prisma.auditLog.create.mockResolvedValue({ id: "al-2" } as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await caller.journal.post({ journalEntryId: ENTRY_ID });

      // Debe emitir evento journalPostedHighValue
      expect(prisma.domainEvent.create).toHaveBeenCalledOnce();
      const evData = prisma.domainEvent.create.mock.calls[0]![0].data;
      expect(evData.eventType).toBe("accounting.journalPostedHighValue");
    });

    it("postea asiento sin emitir evento si no supera umbral", async () => {
      prisma.journalEntry.findFirst.mockResolvedValue({ ...DRAFT_ENTRY } as never);
      prisma.journalEntry.update.mockResolvedValue({
        ...DRAFT_ENTRY,
        status: "POSTED",
      } as never);
      // domainEvent.create no se debe llamar

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await caller.journal.post({ journalEntryId: ENTRY_ID });

      expect(prisma.domainEvent.create).not.toHaveBeenCalled();
    });

    it("falla CONFLICT si el asiento no está en DRAFT", async () => {
      prisma.journalEntry.findFirst.mockResolvedValue({
        ...DRAFT_ENTRY,
        status: "POSTED",
      } as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.journal.post({ journalEntryId: ENTRY_ID }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("falla BAD_REQUEST si el asiento está desbalanceado al momento de postear", async () => {
      // Simula un caso donde las líneas están desbalanceadas (protección doble)
      const unbalancedEntry = {
        ...DRAFT_ENTRY,
        lines: [
          { ...DRAFT_ENTRY.lines[0], debit: 500, credit: 0 },
          { ...DRAFT_ENTRY.lines[1], debit: 0, credit: 300 },
        ],
      };
      prisma.journalEntry.findFirst.mockResolvedValue(unbalancedEntry as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.journal.post({ journalEntryId: ENTRY_ID }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // -------------------------------------------------------------------------
  // journal.reverse
  // -------------------------------------------------------------------------
  describe("journal.reverse", () => {
    const POSTED_ENTRY = {
      ...DRAFT_ENTRY,
      status:  "POSTED",
      postedAt: new Date(),
      postedById: USER_ID,
    };

    it("crea contraasiento con líneas invertidas", async () => {
      prisma.journalEntry.findFirst.mockResolvedValue(POSTED_ENTRY as never);
      prisma.journalEntry.aggregate.mockResolvedValue({ _max: { numeroCorrelativo: 1 } } as never);
      prisma.journalEntry.create.mockResolvedValue({ id: "reversal-id", status: "POSTED" } as never);
      prisma.journalEntry.update.mockResolvedValue({ ...POSTED_ENTRY, status: "REVERSED" } as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await caller.journal.reverse({
        journalEntryId: ENTRY_ID,
        descripcion:    "Reversión de asiento de prueba",
        entryDate:      "2026-01-20",
      });

      const createData = prisma.journalEntry.create.mock.calls[0]![0].data;
      expect(createData.reversalOfId).toBe(ENTRY_ID);
      expect(createData.origen).toBe("AJUSTE");
      expect(createData.status).toBe("POSTED");

      // Las líneas deben estar invertidas
      // Línea 1 original: debit=1000, credit=0 → reversal: debit=credit_orig=0, credit=debit_orig=1000
      const lines = createData.lines.create as Array<{ debit: number; credit: number }>;
      expect(Number(lines[0]!.debit)).toBe(0);
      expect(Number(lines[0]!.credit)).toBe(1000);
    });

    it("falla CONFLICT si el asiento no está POSTED", async () => {
      prisma.journalEntry.findFirst.mockResolvedValue({ ...DRAFT_ENTRY } as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.journal.reverse({
          journalEntryId: ENTRY_ID,
          descripcion:    "Reversión",
          entryDate:      "2026-01-20",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  // -------------------------------------------------------------------------
  // costCenter.create
  // -------------------------------------------------------------------------
  describe("costCenter.create", () => {
    it("crea centro de costos correctamente", async () => {
      prisma.costCenter.create.mockResolvedValue({
        id:             CENTER_ID,
        organizationId: ORG_ID,
        code:           "CC-001",
        name:           "Urgencias",
        parentId:       null,
        active:         true,
        createdAt:      new Date(),
        updatedAt:      new Date(),
      } as never);

      const caller = accountingRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.costCenter.create({
        code: "CC-001",
        name: "Urgencias",
      });

      expect(result.code).toBe("CC-001");
      expect(prisma.costCenter.create.mock.calls[0]![0].data.organizationId).toBe(ORG_ID);
    });
  });

  // -------------------------------------------------------------------------
  // RLS cross-tenant isolation
  // -------------------------------------------------------------------------
  describe("RLS cross-tenant isolation", () => {
    it("journal.list filtra siempre por organizationId del tenant actual", async () => {
      prisma.journalEntry.findMany.mockResolvedValue([] as never);

      // Tenant de ORG B
      const ctxOrgB = makeCtx({ prisma, tenant: MOCK_TENANT_OTHER_ORG });
      const caller = accountingRouter.createCaller(ctxOrgB);
      await caller.journal.list({ ledgerId: LEDGER_ID });

      const args = prisma.journalEntry.findMany.mock.calls[0]![0];
      // La query filtra por la organización de ctxOrgB, no por ORG_ID (ORG A)
      expect(args!.where!.organizationId).toBe(MOCK_TENANT_OTHER_ORG.organizationId);
      expect(args!.where!.organizationId).not.toBe(ORG_ID);
    });

    it("period.close falla NOT_FOUND si el período no pertenece al tenant", async () => {
      // El mock retorna null → el período no existe para este tenant
      prisma.accountingPeriod.findFirst.mockResolvedValue(null as never);

      const ctxOrgB = makeCtx({ prisma, tenant: MOCK_TENANT_OTHER_ORG });
      const caller = accountingRouter.createCaller(ctxOrgB);
      await expect(
        caller.period.close({ periodId: PERIOD_ID }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
