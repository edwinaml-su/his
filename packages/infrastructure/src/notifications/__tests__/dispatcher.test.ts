/**
 * Tests del dispatcher Beta.15 (US.B15.2.3).
 *
 * Cubre:
 *  - Idempotencia: 2da llamada con mismo eventId → skip.
 *  - vital.critical → resuelve admission.attendingId → INBOX + EMAIL.
 *  - lab.criticalValue → resuelve User por prescriberId → INBOX + EMAIL.
 *  - drug.interaction → INBOX + EMAIL según severity del payload.
 *  - allergy.mismatch con prescriberId null → no-recipient.
 *  - Sin provider de email → solo INBOX (no se llama send).
 *  - TransientProviderError → fila EMAIL permanece PENDING.
 *  - PermanentProviderError → fila EMAIL pasa a FAILED.
 *  - User prefs: deshabilita EMAIL WARNING → solo INBOX.
 *  - Payload inválido → skippedReason "no-payload".
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

import {
  PermanentProviderError,
  TransientProviderError,
  type EmailProvider,
} from "@his/contracts";
import {
  dispatchDomainEvent,
  type DispatchInputEvent,
} from "../index";

// UUIDs estables para tests — formato v4 estricto (validador Zod .uuid()
// requiere version=4 nibble en posición 13 y variant=8-b en posición 17).
const ORG = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const ADMISSION_ID = "33333333-3333-4333-8333-333333333333";
const ATTENDING_ID = "44444444-4444-4444-8444-444444444444";
const PATIENT_ID = "55555555-5555-4555-8555-555555555555";
const VITALS_ID = "66666666-6666-4666-8666-666666666666";
const PRESCRIBER_ID = "77777777-7777-4777-8777-777777777777";
const ALLERGY_ID = "88888888-8888-4888-8888-888888888888";
const DRUG_A = "99999999-9999-4999-8999-999999999999";
const DRUG_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOTIF_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeProvider(): EmailProvider & { send: ReturnType<typeof vi.fn> } {
  return {
    providerName: "stub",
    send: vi.fn().mockResolvedValue({ providerMessageId: "msg_123" }),
  };
}

function makeVitalEvent(): DispatchInputEvent {
  return {
    id: EVENT_ID,
    organizationId: ORG,
    eventType: "vital.critical",
    aggregateType: "InpatientVitals",
    aggregateId: VITALS_ID,
    payload: {
      source: "InpatientVitals",
      admissionId: ADMISSION_ID,
      patientId: PATIENT_ID,
      sourceRowId: VITALS_ID,
      alerts: [
        {
          parameter: "SPO2",
          value: 82,
          severity: "CRITICAL",
          message: "SpO2 muy bajo",
        },
      ],
    },
  };
}

function makeLabEvent(): DispatchInputEvent {
  return {
    id: EVENT_ID,
    organizationId: ORG,
    eventType: "lab.criticalValue",
    aggregateType: "LabResult",
    aggregateId: VITALS_ID,
    payload: {
      orderItemId: VITALS_ID,
      resultId: VITALS_ID,
      prescriberId: PRESCRIBER_ID,
      testCode: "LOINC-1234",
      flag: "CRITICAL_HIGH",
      value: 999,
      unit: "mg/dL",
      referenceRange: { low: 0, high: 100 },
    },
  };
}

function makeDrugEvent(severity: "CRITICAL" | "WARNING"): DispatchInputEvent {
  return {
    id: EVENT_ID,
    organizationId: ORG,
    eventType: "drug.interaction",
    aggregateType: "Prescription",
    aggregateId: VITALS_ID,
    payload: {
      prescriptionId: VITALS_ID,
      prescriberId: PRESCRIBER_ID,
      conflictingDrugIds: [DRUG_A, DRUG_B],
      severity,
      description: "Interacción de prueba",
    },
  };
}

function makeAllergyEvent(prescriberId: string | null): DispatchInputEvent {
  return {
    id: EVENT_ID,
    organizationId: ORG,
    eventType: "allergy.mismatch",
    aggregateType: "MedicationAdministration",
    aggregateId: VITALS_ID,
    payload: {
      medicationAdministrationId: VITALS_ID,
      patientId: PATIENT_ID,
      allergyId: ALLERGY_ID,
      drugId: DRUG_A,
      prescriberId,
    },
  };
}

/** Stub mínimo para el shape de admision esperado por dispatcher. */
function stubAdmission(opts: { email: string | null }) {
  return {
    organizationId: ORG,
    attendingId: ATTENDING_ID,
    attending: { email: opts.email, fullName: "Dr. Test" },
  };
}

function stubUser(opts: { id: string; email: string | null }) {
  return { id: opts.id, email: opts.email, fullName: "Dr. Test" };
}

describe("dispatchDomainEvent", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let provider: ReturnType<typeof makeProvider>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    provider = makeProvider();
    // Defaults razonables: no existe Notification previa, role PHYSICIAN.
    prisma.notification.findFirst.mockResolvedValue(null as never);
    prisma.userOrganizationRole.findFirst.mockResolvedValue({
      role: { code: "PHYSICIAN" },
    } as never);
    prisma.notification.create.mockResolvedValue({ id: NOTIF_ID } as never);
    prisma.notification.update.mockResolvedValue({ id: NOTIF_ID } as never);
  });

  // ---------------------------------------------------------------------------
  // Idempotencia
  // ---------------------------------------------------------------------------

  it("idempotencia: si ya existe Notification para eventId → skip", async () => {
    prisma.notification.findFirst.mockResolvedValueOnce({ id: NOTIF_ID } as never);

    const result = await dispatchDomainEvent(makeVitalEvent(), {
      prisma,
      emailProvider: provider,
      fromEmail: "alerts@his.test",
    });

    expect(result.skippedReason).toBe("already-dispatched");
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Payload inválido
  // ---------------------------------------------------------------------------

  it("payload inválido → skippedReason 'no-payload'", async () => {
    const event: DispatchInputEvent = {
      id: EVENT_ID,
      organizationId: ORG,
      eventType: "vital.critical",
      aggregateType: "InpatientVitals",
      aggregateId: VITALS_ID,
      payload: { foo: "bar" }, // no matchea schema
    };

    const result = await dispatchDomainEvent(event, {
      prisma,
      emailProvider: provider,
      fromEmail: "alerts@his.test",
    });

    expect(result.skippedReason).toBe("no-payload");
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // vital.critical
  // ---------------------------------------------------------------------------

  it("vital.critical: resuelve attendingId y crea INBOX + EMAIL", async () => {
    prisma.inpatientAdmission.findUnique.mockResolvedValue(
      stubAdmission({ email: "doc@his.test" }) as never,
    );

    const result = await dispatchDomainEvent(makeVitalEvent(), {
      prisma,
      emailProvider: provider,
      fromEmail: "alerts@his.test",
    });

    expect(result.notificationsCreated).toBe(2);
    expect(result.emailsSent).toBe(1);
    expect(result.emailsFailed).toBe(0);
    expect(provider.send).toHaveBeenCalledTimes(1);

    const sendArg = provider.send.mock.calls[0]![0];
    expect(sendArg.to).toBe("doc@his.test");
    expect(sendArg.from).toBe("alerts@his.test");
    expect(sendArg.subject).toContain("CRÍTICO");
    expect(sendArg.tags).toMatchObject({ eventId: EVENT_ID });

    // 2 creates: INBOX + EMAIL
    const createCalls = prisma.notification.create.mock.calls;
    expect(createCalls).toHaveLength(2);
    const channels = createCalls.map((c) => (c[0] as { data: { channel: string } }).data.channel);
    expect(channels).toEqual(["INBOX", "EMAIL"]);

    // EMAIL update con SENT + providerMessageId
    const updates = prisma.notification.update.mock.calls;
    const sentUpdate = updates.find(
      (c) => (c[0] as { data: { status?: string } }).data.status === "SENT",
    );
    expect(sentUpdate).toBeDefined();
    expect((sentUpdate![0] as { data: { providerMessageId: string } }).data.providerMessageId).toBe(
      "msg_123",
    );
  });

  it("vital.critical sin email del attending → solo INBOX (CRITICAL fuerza INBOX)", async () => {
    prisma.inpatientAdmission.findUnique.mockResolvedValue(
      stubAdmission({ email: null }) as never,
    );

    const result = await dispatchDomainEvent(makeVitalEvent(), {
      prisma,
      emailProvider: provider,
      fromEmail: "alerts@his.test",
    });

    expect(result.notificationsCreated).toBe(1);
    expect(result.emailsSent).toBe(0);
    expect(provider.send).not.toHaveBeenCalled();
    const createCalls = prisma.notification.create.mock.calls;
    const channel = (createCalls[0]![0] as { data: { channel: string } }).data.channel;
    expect(channel).toBe("INBOX");
  });

  it("vital.critical sin admission encontrada → no-recipient", async () => {
    prisma.inpatientAdmission.findUnique.mockResolvedValue(null as never);

    const result = await dispatchDomainEvent(makeVitalEvent(), {
      prisma,
      emailProvider: provider,
      fromEmail: "alerts@his.test",
    });

    expect(result.skippedReason).toBe("no-recipient");
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // lab.criticalValue
  // ---------------------------------------------------------------------------

  it("lab.criticalValue: resuelve User por prescriberId → INBOX + EMAIL", async () => {
    prisma.user.findUnique.mockResolvedValue(
      stubUser({ id: PRESCRIBER_ID, email: "doc@his.test" }) as never,
    );

    const result = await dispatchDomainEvent(makeLabEvent(), {
      prisma,
      emailProvider: provider,
      fromEmail: "alerts@his.test",
    });

    expect(result.notificationsCreated).toBe(2);
    expect(result.emailsSent).toBe(1);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // drug.interaction
  // ---------------------------------------------------------------------------

  it("drug.interaction WARNING: doctor recibe INBOX + EMAIL (default doctor)", async () => {
    prisma.user.findUnique.mockResolvedValue(
      stubUser({ id: PRESCRIBER_ID, email: "doc@his.test" }) as never,
    );

    const result = await dispatchDomainEvent(makeDrugEvent("WARNING"), {
      prisma,
      emailProvider: provider,
      fromEmail: "alerts@his.test",
    });

    expect(result.notificationsCreated).toBe(2);
    expect(result.emailsSent).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // allergy.mismatch
  // ---------------------------------------------------------------------------

  it("allergy.mismatch sin prescriberId → no-recipient", async () => {
    const result = await dispatchDomainEvent(makeAllergyEvent(null), {
      prisma,
      emailProvider: provider,
      fromEmail: "alerts@his.test",
    });

    expect(result.skippedReason).toBe("no-recipient");
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Provider opcional
  // ---------------------------------------------------------------------------

  it("sin emailProvider → solo INBOX (no se intenta send)", async () => {
    prisma.inpatientAdmission.findUnique.mockResolvedValue(
      stubAdmission({ email: "doc@his.test" }) as never,
    );

    const result = await dispatchDomainEvent(makeVitalEvent(), {
      prisma,
      emailProvider: null,
      fromEmail: "alerts@his.test",
    });

    // INBOX + EMAIL filas creadas (las EMAIL quedan PENDING para retry posterior).
    // En el flujo "sin provider" el dispatcher crea la fila EMAIL pero no envía.
    expect(result.emailsSent).toBe(0);
    expect(result.notificationsCreated).toBeGreaterThanOrEqual(1);
    const channels = prisma.notification.create.mock.calls.map(
      (c) => (c[0] as { data: { channel: string } }).data.channel,
    );
    expect(channels).toContain("INBOX");
  });

  // ---------------------------------------------------------------------------
  // Errores del provider
  // ---------------------------------------------------------------------------

  it("TransientProviderError → fila EMAIL permanece PENDING (sin status=FAILED)", async () => {
    prisma.inpatientAdmission.findUnique.mockResolvedValue(
      stubAdmission({ email: "doc@his.test" }) as never,
    );
    provider.send.mockRejectedValueOnce(new TransientProviderError("ECONNRESET"));

    const result = await dispatchDomainEvent(makeVitalEvent(), {
      prisma,
      emailProvider: provider,
      fromEmail: "alerts@his.test",
    });

    expect(result.emailsSent).toBe(0);
    expect(result.emailsFailed).toBe(1);

    const updates = prisma.notification.update.mock.calls;
    const transientUpdate = updates.find((c) => {
      const d = (c[0] as { data: { failureReason?: string } }).data;
      return d.failureReason?.startsWith("transient:");
    });
    expect(transientUpdate).toBeDefined();
    // NO debe haberse marcado FAILED
    const failedUpdate = updates.find(
      (c) => (c[0] as { data: { status?: string } }).data.status === "FAILED",
    );
    expect(failedUpdate).toBeUndefined();
  });

  it("PermanentProviderError → fila EMAIL pasa a FAILED", async () => {
    prisma.inpatientAdmission.findUnique.mockResolvedValue(
      stubAdmission({ email: "doc@his.test" }) as never,
    );
    provider.send.mockRejectedValueOnce(
      new PermanentProviderError("invalid recipient"),
    );

    const result = await dispatchDomainEvent(makeVitalEvent(), {
      prisma,
      emailProvider: provider,
      fromEmail: "alerts@his.test",
    });

    expect(result.emailsSent).toBe(0);
    expect(result.emailsFailed).toBe(1);

    const updates = prisma.notification.update.mock.calls;
    const failedUpdate = updates.find(
      (c) => (c[0] as { data: { status?: string } }).data.status === "FAILED",
    );
    expect(failedUpdate).toBeDefined();
    const data = (failedUpdate![0] as {
      data: { failureReason: string; failedAt: unknown };
    }).data;
    expect(data.failureReason).toContain("permanent:");
    expect(data.failedAt).toBeInstanceOf(Date);
  });

  // ---------------------------------------------------------------------------
  // Preferences override
  // ---------------------------------------------------------------------------

  it("preferences override: user deshabilita EMAIL WARNING → solo INBOX", async () => {
    prisma.user.findUnique.mockResolvedValue(
      stubUser({ id: PRESCRIBER_ID, email: "doc@his.test" }) as never,
    );

    const result = await dispatchDomainEvent(makeDrugEvent("WARNING"), {
      prisma,
      emailProvider: provider,
      fromEmail: "alerts@his.test",
      loadUserPreferences: async () => [
        { severity: "WARNING", channel: "EMAIL", enabled: false },
      ],
    });

    expect(result.emailsSent).toBe(0);
    const channels = prisma.notification.create.mock.calls.map(
      (c) => (c[0] as { data: { channel: string } }).data.channel,
    );
    expect(channels).toEqual(["INBOX"]);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("preferences NO pueden suprimir CRITICAL INBOX (regla dura)", async () => {
    prisma.inpatientAdmission.findUnique.mockResolvedValue(
      stubAdmission({ email: "doc@his.test" }) as never,
    );

    const result = await dispatchDomainEvent(makeVitalEvent(), {
      prisma,
      emailProvider: provider,
      fromEmail: "alerts@his.test",
      // El user intenta deshabilitar ambos canales para CRITICAL.
      loadUserPreferences: async () => [
        { severity: "CRITICAL", channel: "INBOX", enabled: false },
        { severity: "CRITICAL", channel: "EMAIL", enabled: false },
      ],
    });

    // Regla dura: CRITICAL → INBOX + EMAIL forzados.
    expect(result.notificationsCreated).toBe(2);
    const channels = prisma.notification.create.mock.calls.map(
      (c) => (c[0] as { data: { channel: string } }).data.channel,
    );
    expect(channels).toEqual(["INBOX", "EMAIL"]);
  });

  // ---------------------------------------------------------------------------
  // US.B15.1.4 — audit log wiring (publish)
  // ---------------------------------------------------------------------------

  it("audit log wiring: tras crear notifications llama auditLog.create con action=UPDATE y justification DOMAIN_EVENT_PUBLISHED", async () => {
    prisma.inpatientAdmission.findUnique.mockResolvedValue(
      stubAdmission({ email: "doc@his.test" }) as never,
    );

    const result = await dispatchDomainEvent(makeVitalEvent(), {
      prisma,
      emailProvider: provider,
      fromEmail: "alerts@his.test",
    });

    // Sanity: el dispatch creó las dos notificaciones (INBOX + EMAIL).
    expect(result.notificationsCreated).toBe(2);

    // Audit log debe haberse escrito UNA vez con action=UPDATE.
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const auditArg = (prisma.auditLog.create.mock.calls[0]![0] as {
      data: {
        action: string;
        entity: string;
        entityId: string;
        organizationId: string;
        justification: string;
      };
    }).data;
    expect(auditArg.action).toBe("UPDATE");
    expect(auditArg.entity).toBe("DomainEvent");
    expect(auditArg.entityId).toBe(EVENT_ID);
    expect(auditArg.organizationId).toBe(ORG);
    expect(auditArg.justification).toContain("DOMAIN_EVENT_PUBLISHED");
    expect(auditArg.justification).toContain("vital.critical");
    expect(auditArg.justification).toContain("recipients=2");
    expect(auditArg.justification).toMatch(/duration=\d+ms/);
  });

  it("audit log NO se escribe si dispatch hace short-circuit (already-dispatched)", async () => {
    prisma.notification.findFirst.mockResolvedValueOnce({ id: NOTIF_ID } as never);

    const result = await dispatchDomainEvent(makeVitalEvent(), {
      prisma,
      emailProvider: provider,
      fromEmail: "alerts@his.test",
    });

    expect(result.skippedReason).toBe("already-dispatched");
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
