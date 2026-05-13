/**
 * Tests del schema §10 Outpatient.
 * Cubre: enums, ALLOWED_TRANSITIONS constants, validaciones Zod, reason category.
 */
import { describe, it, expect } from "vitest";
import {
  appointmentStatusEnum,
  reasonCategoryEnum,
  ALLOWED_TRANSITIONS,
  noShowDetectInput,
  outpatientAppointmentCreateInput,
  outpatientAppointmentUpdateInput,
  outpatientAppointmentListInput,
  outpatientAppointmentCancelInput,
  outpatientConsultationCreateInput,
} from "../outpatient";

const u = "00000000-0000-0000-0000-000000000001";
const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

describe("appointmentStatusEnum", () => {
  it.each(["SCHEDULED", "CONFIRMED", "CHECKED_IN", "NO_SHOW", "COMPLETED", "CANCELLED"])(
    "acepta estado %s",
    (s) => expect(appointmentStatusEnum.safeParse(s).success).toBe(true),
  );

  it("rechaza estado desconocido", () => {
    expect(appointmentStatusEnum.safeParse("PENDING").success).toBe(false);
  });
});

describe("reasonCategoryEnum", () => {
  it.each(["ROUTINE", "FOLLOWUP", "ACUTE", "PREVENTIVE", "CHRONIC", "OTHER"])(
    "acepta categoria %s",
    (c) => expect(reasonCategoryEnum.safeParse(c).success).toBe(true),
  );

  it("rechaza categoria desconocida", () => {
    expect(reasonCategoryEnum.safeParse("EMERGENCY").success).toBe(false);
  });
});

describe("ALLOWED_TRANSITIONS", () => {
  it("SCHEDULED puede ir a 4 estados", () => {
    expect(ALLOWED_TRANSITIONS.SCHEDULED).toHaveLength(4);
    expect(ALLOWED_TRANSITIONS.SCHEDULED).toEqual(
      expect.arrayContaining(["CONFIRMED", "CHECKED_IN", "CANCELLED", "NO_SHOW"]),
    );
  });

  it("CONFIRMED puede ir a 3 estados", () => {
    expect(ALLOWED_TRANSITIONS.CONFIRMED).toHaveLength(3);
    expect(ALLOWED_TRANSITIONS.CONFIRMED).toEqual(
      expect.arrayContaining(["CHECKED_IN", "CANCELLED", "NO_SHOW"]),
    );
  });

  it("CHECKED_IN puede ir a COMPLETED, CANCELLED", () => {
    expect(ALLOWED_TRANSITIONS.CHECKED_IN).toEqual(
      expect.arrayContaining(["COMPLETED", "CANCELLED"]),
    );
    expect(ALLOWED_TRANSITIONS.CHECKED_IN).toHaveLength(2);
  });

  it("estados terminales no tienen transiciones", () => {
    expect(ALLOWED_TRANSITIONS.NO_SHOW).toHaveLength(0);
    expect(ALLOWED_TRANSITIONS.COMPLETED).toHaveLength(0);
    expect(ALLOWED_TRANSITIONS.CANCELLED).toHaveLength(0);
  });
});

describe("outpatientAppointmentCreateInput", () => {
  it("acepta input minimo valido con fecha futura", () => {
    const r = outpatientAppointmentCreateInput.safeParse({
      patientId: u,
      providerId: u,
      establishmentId: u,
      scheduledAt: future,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.durationMinutes).toBe(20);
  });

  it("acepta reason hasta 500 chars", () => {
    expect(
      outpatientAppointmentCreateInput.safeParse({
        patientId: u, providerId: u, establishmentId: u, scheduledAt: future,
        reason: "a".repeat(500),
      }).success,
    ).toBe(true);
  });

  it("rechaza reason > 500 chars", () => {
    expect(
      outpatientAppointmentCreateInput.safeParse({
        patientId: u, providerId: u, establishmentId: u, scheduledAt: future,
        reason: "a".repeat(501),
      }).success,
    ).toBe(false);
  });

  it("acepta reasonCategory valido", () => {
    const r = outpatientAppointmentCreateInput.safeParse({
      patientId: u, providerId: u, establishmentId: u, scheduledAt: future,
      reasonCategory: "ACUTE",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reasonCategory).toBe("ACUTE");
  });

  it("rechaza reasonCategory invalido", () => {
    expect(
      outpatientAppointmentCreateInput.safeParse({
        patientId: u, providerId: u, establishmentId: u, scheduledAt: future,
        reasonCategory: "URGENT",
      }).success,
    ).toBe(false);
  });

  it("rechaza scheduledAt en pasado", () => {
    expect(
      outpatientAppointmentCreateInput.safeParse({
        patientId: u, providerId: u, establishmentId: u, scheduledAt: past,
      }).success,
    ).toBe(false);
  });

  it("rechaza durationMinutes fuera de rango", () => {
    expect(
      outpatientAppointmentCreateInput.safeParse({
        patientId: u, providerId: u, establishmentId: u, scheduledAt: future, durationMinutes: 4,
      }).success,
    ).toBe(false);
    expect(
      outpatientAppointmentCreateInput.safeParse({
        patientId: u, providerId: u, establishmentId: u, scheduledAt: future, durationMinutes: 181,
      }).success,
    ).toBe(false);
  });

  it("rechaza UUID invalido en patientId", () => {
    expect(
      outpatientAppointmentCreateInput.safeParse({
        patientId: "not-uuid", providerId: u, establishmentId: u, scheduledAt: future,
      }).success,
    ).toBe(false);
  });
});

describe("outpatientAppointmentUpdateInput", () => {
  it("acepta update parcial con solo status", () => {
    expect(
      outpatientAppointmentUpdateInput.safeParse({ id: u, status: "CONFIRMED" }).success,
    ).toBe(true);
  });

  it("acepta reasonCategory nullable", () => {
    expect(
      outpatientAppointmentUpdateInput.safeParse({ id: u, reasonCategory: null }).success,
    ).toBe(true);
    expect(
      outpatientAppointmentUpdateInput.safeParse({ id: u, reasonCategory: "FOLLOWUP" }).success,
    ).toBe(true);
  });

  it("acepta notes null", () => {
    expect(
      outpatientAppointmentUpdateInput.safeParse({ id: u, notes: null }).success,
    ).toBe(true);
  });
});

describe("outpatientAppointmentListInput", () => {
  it("aplica default limit=50", () => {
    const r = outpatientAppointmentListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("rechaza limit > 100", () => {
    expect(outpatientAppointmentListInput.safeParse({ limit: 101 }).success).toBe(false);
  });
});

describe("outpatientAppointmentCancelInput", () => {
  it("requiere reason no vacio", () => {
    expect(
      outpatientAppointmentCancelInput.safeParse({ id: u, reason: "" }).success,
    ).toBe(false);
  });

  it("acepta reason hasta 500 chars", () => {
    expect(
      outpatientAppointmentCancelInput.safeParse({ id: u, reason: "a".repeat(500) }).success,
    ).toBe(true);
  });

  it("rechaza reason > 500 chars", () => {
    expect(
      outpatientAppointmentCancelInput.safeParse({ id: u, reason: "a".repeat(501) }).success,
    ).toBe(false);
  });
});

describe("noShowDetectInput", () => {
  it("defaults: thresholdMinutes=30, commit=false", () => {
    const r = noShowDetectInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.thresholdMinutes).toBe(30);
      expect(r.data.commit).toBe(false);
    }
  });

  it("acepta commit=true con threshold personalizado", () => {
    const r = noShowDetectInput.safeParse({ thresholdMinutes: 60, commit: true });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.thresholdMinutes).toBe(60);
      expect(r.data.commit).toBe(true);
    }
  });

  it("rechaza thresholdMinutes=0", () => {
    expect(noShowDetectInput.safeParse({ thresholdMinutes: 0 }).success).toBe(false);
  });

  it("rechaza thresholdMinutes > 1440", () => {
    expect(noShowDetectInput.safeParse({ thresholdMinutes: 1441 }).success).toBe(false);
  });
});

describe("outpatientConsultationCreateInput", () => {
  it("acepta SOAP completo con reasonCategory", () => {
    expect(
      outpatientConsultationCreateInput.safeParse({
        encounterId: u,
        reasonOfVisit: "Control rutinario",
        reasonCategory: "ROUTINE",
        subjective: "Paciente refiere mejoria",
        objective: "Signos vitales estables",
        assessment: "Evolucion favorable",
        plan: "Continuar tratamiento",
      }).success,
    ).toBe(true);
  });

  it("acepta sin reasonCategory (opcional)", () => {
    expect(
      outpatientConsultationCreateInput.safeParse({ encounterId: u, reasonOfVisit: "Control" }).success,
    ).toBe(true);
  });

  it("acepta reasonOfVisit hasta 500 chars", () => {
    expect(
      outpatientConsultationCreateInput.safeParse({ encounterId: u, reasonOfVisit: "a".repeat(500) }).success,
    ).toBe(true);
  });

  it("rechaza reasonOfVisit > 500 chars", () => {
    expect(
      outpatientConsultationCreateInput.safeParse({ encounterId: u, reasonOfVisit: "a".repeat(501) }).success,
    ).toBe(false);
  });

  it("rechaza reasonOfVisit vacio", () => {
    expect(
      outpatientConsultationCreateInput.safeParse({ encounterId: u, reasonOfVisit: "" }).success,
    ).toBe(false);
  });

  it("acepta walk-in sin appointmentId", () => {
    expect(
      outpatientConsultationCreateInput.safeParse({ encounterId: u, reasonOfVisit: "Urgencia menor" }).success,
    ).toBe(true);
  });
});