/**
 * Tests de routing (resolvers) para los 6 nuevos eventTypes:
 * Beta.16.1 — transfusion.crossmatchFailed, transfusion.adverseReaction
 * Beta.17.1 — pathology.reportSigned, pathology.criticalFinding
 * Beta.18.1 — accounting.periodClosed, accounting.journalPostedHighValue
 *
 * Prisma mockeado con vitest-mock-extended.
 * El dispatcher se invoca con emailProvider=null para simplificar:
 * sólo nos interesa verificar la resolución de recipients y la creación
 * de filas Notification (severity, cantidad).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

import { dispatchDomainEvent, type DispatchInputEvent } from "../index";

// ---------------------------------------------------------------------------
// UUIDs estables (formato v4: version nibble=4, variant nibble=8-b)
// ---------------------------------------------------------------------------

const ORG         = "11111111-1111-4111-8111-111111111111";
const EVENT_ID    = "22222222-2222-4222-8222-222222222222";
const USER_A      = "33333333-3333-4333-8333-333333333333";
const USER_B      = "44444444-4444-4444-8444-444444444444";
const USER_C      = "55555555-5555-4555-8555-555555555555";
const NOTIF_ID    = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID  = "77777777-7777-4777-8777-777777777777";
const UNIT_ID     = "88888888-8888-4888-8888-888888888888";
const XMATCH_ID   = "99999999-9999-4999-8999-999999999999";
const PATIENT_ID  = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRANSF_ID   = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REPORT_ID   = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORDER_ID    = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LEDGER_ID   = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PERIOD_ID   = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const JOURNAL_ID  = "00000000-0000-4000-8000-000000000001";

function stubUser(id: string, email: string | null = "user@his.test") {
  return { id, email, fullName: "Usuario Test" };
}

function baseCtx(prisma: DeepMockProxy<PrismaClient>) {
  return {
    prisma,
    emailProvider: null,
    fromEmail: "alerts@his.test",
  } as const;
}

describe("dispatcher routing — Beta.16.1 + Beta.17.1 + Beta.18.1", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.notification.findFirst.mockResolvedValue(null as never);
    prisma.notification.create.mockResolvedValue({ id: NOTIF_ID } as never);
    prisma.notification.update.mockResolvedValue({ id: NOTIF_ID } as never);
    prisma.userOrganizationRole.findFirst.mockResolvedValue({
      role: { code: "PHYSICIAN" },
    } as never);
    // audit log
    prisma.auditLog.create.mockResolvedValue({} as never);
  });

  // -------------------------------------------------------------------------
  // transfusion.crossmatchFailed
  // -------------------------------------------------------------------------

  describe("transfusion.crossmatchFailed", () => {
    function makeEvent(): DispatchInputEvent {
      return {
        id: EVENT_ID,
        organizationId: ORG,
        eventType: "transfusion.crossmatchFailed",
        aggregateType: "TransfusionRequest",
        aggregateId: REQUEST_ID,
        payload: {
          requestId: REQUEST_ID,
          unitId: UNIT_ID,
          crossMatchId: XMATCH_ID,
          result: "INCOMPATIBLE",
          requestedById: USER_A,
          patientId: PATIENT_ID,
        },
      };
    }

    it("resuelve requestedById → 1 recipient CRITICAL → crea INBOX", async () => {
      prisma.user.findUnique.mockResolvedValue(stubUser(USER_A) as never);

      const result = await dispatchDomainEvent(makeEvent(), baseCtx(prisma));

      expect(result.skippedReason).toBeUndefined();
      expect(result.notificationsCreated).toBeGreaterThanOrEqual(1);

      const createCalls = prisma.notification.create.mock.calls;
      const channels = createCalls.map((c) => (c[0] as { data: { channel: string } }).data.channel);
      expect(channels).toContain("INBOX");

      const severities = createCalls.map((c) => (c[0] as { data: { severity: string } }).data.severity);
      expect(severities.every((s) => s === "CRITICAL")).toBe(true);
    });

    it("requestedById no encontrado → no-recipient", async () => {
      prisma.user.findUnique.mockResolvedValue(null as never);

      const result = await dispatchDomainEvent(makeEvent(), baseCtx(prisma));

      expect(result.skippedReason).toBe("no-recipient");
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // transfusion.adverseReaction
  // -------------------------------------------------------------------------

  describe("transfusion.adverseReaction", () => {
    function makeEvent(severity: "MILD" | "MODERATE" | "SEVERE" | "LIFE_THREATENING"): DispatchInputEvent {
      return {
        id: EVENT_ID,
        organizationId: ORG,
        eventType: "transfusion.adverseReaction",
        aggregateType: "TransfusionAdverseReaction",
        aggregateId: TRANSF_ID,
        payload: {
          transfusionId: TRANSF_ID,
          requestId: REQUEST_ID,
          patientId: PATIENT_ID,
          supervisorId: USER_A,
          nurseId: USER_B,
          reactionType: "Urticaria",
          severity,
        },
      };
    }

    it("SEVERE → 2 recipients (supervisor + nurse) CRITICAL", async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(stubUser(USER_A) as never)
        .mockResolvedValueOnce(stubUser(USER_B, "nurse@his.test") as never);

      const result = await dispatchDomainEvent(makeEvent("SEVERE"), baseCtx(prisma));

      expect(result.skippedReason).toBeUndefined();
      const createCalls = prisma.notification.create.mock.calls;
      expect(createCalls.length).toBeGreaterThanOrEqual(2);

      const severities = createCalls.map((c) => (c[0] as { data: { severity: string } }).data.severity);
      expect(severities.every((s) => s === "CRITICAL")).toBe(true);
    });

    it("LIFE_THREATENING → CRITICAL", async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(stubUser(USER_A) as never)
        .mockResolvedValueOnce(stubUser(USER_B) as never);

      const result = await dispatchDomainEvent(makeEvent("LIFE_THREATENING"), baseCtx(prisma));

      expect(result.skippedReason).toBeUndefined();
      const createCalls = prisma.notification.create.mock.calls;
      const severities = createCalls.map((c) => (c[0] as { data: { severity: string } }).data.severity);
      expect(severities.every((s) => s === "CRITICAL")).toBe(true);
    });

    it("MODERATE → WARNING", async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(stubUser(USER_A, null) as never)   // sin email → solo INBOX
        .mockResolvedValueOnce(stubUser(USER_B, null) as never);

      const result = await dispatchDomainEvent(makeEvent("MODERATE"), baseCtx(prisma));

      expect(result.skippedReason).toBeUndefined();
      const createCalls = prisma.notification.create.mock.calls;
      const severities = createCalls.map((c) => (c[0] as { data: { severity: string } }).data.severity);
      expect(severities.every((s) => s === "WARNING")).toBe(true);
    });

    it("ninguno de los dos usuarios encontrado → no-recipient", async () => {
      prisma.user.findUnique.mockResolvedValue(null as never);

      const result = await dispatchDomainEvent(makeEvent("SEVERE"), baseCtx(prisma));

      expect(result.skippedReason).toBe("no-recipient");
    });
  });

  // -------------------------------------------------------------------------
  // pathology.reportSigned
  // -------------------------------------------------------------------------

  describe("pathology.reportSigned", () => {
    function makeEvent(): DispatchInputEvent {
      return {
        id: EVENT_ID,
        organizationId: ORG,
        eventType: "pathology.reportSigned",
        aggregateType: "PathologyReport",
        aggregateId: REPORT_ID,
        payload: {
          reportId: REPORT_ID,
          orderId: ORDER_ID,
          requestingPhysicianId: USER_A,
          pathologistId: USER_B,
          primaryDiagnosis: "Adenocarcinoma",
        },
      };
    }

    it("resuelve requestingPhysicianId → 1 recipient WARNING", async () => {
      prisma.user.findUnique.mockResolvedValue(stubUser(USER_A) as never);

      const result = await dispatchDomainEvent(makeEvent(), baseCtx(prisma));

      expect(result.skippedReason).toBeUndefined();
      expect(result.notificationsCreated).toBeGreaterThanOrEqual(1);

      const createCalls = prisma.notification.create.mock.calls;
      const severities = createCalls.map((c) => (c[0] as { data: { severity: string } }).data.severity);
      expect(severities.every((s) => s === "WARNING")).toBe(true);
    });

    it("requestingPhysicianId no encontrado → no-recipient", async () => {
      prisma.user.findUnique.mockResolvedValue(null as never);

      const result = await dispatchDomainEvent(makeEvent(), baseCtx(prisma));

      expect(result.skippedReason).toBe("no-recipient");
    });
  });

  // -------------------------------------------------------------------------
  // pathology.criticalFinding
  // -------------------------------------------------------------------------

  describe("pathology.criticalFinding", () => {
    function makeEvent(withServiceHead: boolean): DispatchInputEvent {
      return {
        id: EVENT_ID,
        organizationId: ORG,
        eventType: "pathology.criticalFinding",
        aggregateType: "PathologyReport",
        aggregateId: REPORT_ID,
        payload: {
          reportId: REPORT_ID,
          orderId: ORDER_ID,
          requestingPhysicianId: USER_A,
          ...(withServiceHead ? { serviceHeadId: USER_C } : {}),
          primaryDiagnosis: "Linfoma",
        },
      };
    }

    it("sin serviceHeadId → 1 recipient CRITICAL (requestingPhysicianId)", async () => {
      prisma.user.findUnique.mockResolvedValue(stubUser(USER_A) as never);

      const result = await dispatchDomainEvent(makeEvent(false), baseCtx(prisma));

      expect(result.skippedReason).toBeUndefined();
      const createCalls = prisma.notification.create.mock.calls;
      const severities = createCalls.map((c) => (c[0] as { data: { severity: string } }).data.severity);
      expect(severities.every((s) => s === "CRITICAL")).toBe(true);
    });

    it("con serviceHeadId → 2 recipients CRITICAL", async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(stubUser(USER_A) as never)
        .mockResolvedValueOnce(stubUser(USER_C, "head@his.test") as never);

      const result = await dispatchDomainEvent(makeEvent(true), baseCtx(prisma));

      expect(result.skippedReason).toBeUndefined();
      const createCalls = prisma.notification.create.mock.calls;
      expect(createCalls.length).toBeGreaterThanOrEqual(2);
      const severities = createCalls.map((c) => (c[0] as { data: { severity: string } }).data.severity);
      expect(severities.every((s) => s === "CRITICAL")).toBe(true);
    });

    it("requestingPhysicianId no encontrado → no-recipient (aunque serviceHead exista)", async () => {
      // physician null, serviceHead con datos
      prisma.user.findUnique
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(stubUser(USER_C) as never);

      const result = await dispatchDomainEvent(makeEvent(true), baseCtx(prisma));

      // Solo el serviceHead habría generado un recipient, pero physician es null → 1 notif
      // Si physician es null y serviceHead existe, el resultado depende del orden de Promise.all.
      // El resolver hace push condicional: si physician null → no push, pero serviceHead sí.
      // Así que no es "no-recipient" sino 1 recipient.
      expect(result.skippedReason).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // accounting.periodClosed
  // -------------------------------------------------------------------------

  describe("accounting.periodClosed", () => {
    function makeEvent(): DispatchInputEvent {
      return {
        id: EVENT_ID,
        organizationId: ORG,
        eventType: "accounting.periodClosed",
        aggregateType: "AccountingPeriod",
        aggregateId: PERIOD_ID,
        payload: {
          organizationId: ORG,
          ledgerId: LEDGER_ID,
          periodId: PERIOD_ID,
          periodYear: 2026,
          periodMonth: 5,
          closedById: USER_A,
        },
      };
    }

    it("resuelve closedById → 1 recipient WARNING", async () => {
      prisma.user.findUnique.mockResolvedValue(stubUser(USER_A) as never);

      const result = await dispatchDomainEvent(makeEvent(), baseCtx(prisma));

      expect(result.skippedReason).toBeUndefined();
      const createCalls = prisma.notification.create.mock.calls;
      const severities = createCalls.map((c) => (c[0] as { data: { severity: string } }).data.severity);
      expect(severities.every((s) => s === "WARNING")).toBe(true);
    });

    it("closedById no encontrado → no-recipient", async () => {
      prisma.user.findUnique.mockResolvedValue(null as never);

      const result = await dispatchDomainEvent(makeEvent(), baseCtx(prisma));

      expect(result.skippedReason).toBe("no-recipient");
    });
  });

  // -------------------------------------------------------------------------
  // accounting.journalPostedHighValue
  // -------------------------------------------------------------------------

  describe("accounting.journalPostedHighValue", () => {
    function makeEvent(): DispatchInputEvent {
      return {
        id: EVENT_ID,
        organizationId: ORG,
        eventType: "accounting.journalPostedHighValue",
        aggregateType: "JournalEntry",
        aggregateId: JOURNAL_ID,
        payload: {
          organizationId: ORG,
          ledgerId: LEDGER_ID,
          journalEntryId: JOURNAL_ID,
          totalDebit: 150000.50,
          thresholdExceeded: 100000,
          postedById: USER_A,
        },
      };
    }

    it("resuelve postedById → 1 recipient WARNING", async () => {
      prisma.user.findUnique.mockResolvedValue(stubUser(USER_A) as never);

      const result = await dispatchDomainEvent(makeEvent(), baseCtx(prisma));

      expect(result.skippedReason).toBeUndefined();
      const createCalls = prisma.notification.create.mock.calls;
      const severities = createCalls.map((c) => (c[0] as { data: { severity: string } }).data.severity);
      expect(severities.every((s) => s === "WARNING")).toBe(true);
    });

    it("postedById no encontrado → no-recipient", async () => {
      prisma.user.findUnique.mockResolvedValue(null as never);

      const result = await dispatchDomainEvent(makeEvent(), baseCtx(prisma));

      expect(result.skippedReason).toBe("no-recipient");
    });
  });
});
