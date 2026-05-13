/**
 * Tests del schema §10 Outpatient.
 * Validan forma del contrato (Zod) — la lógica de transición de estados
 * vive en el router `outpatient.router.ts` y se cubre en pruebas de integración.
 */
import { describe, it, expect } from "vitest";
import {
  appointmentStatusEnum,
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
  it.each([
    "SCHEDULED",
    "CONFIRMED",
    "CHECKED_IN",
    "NO_SHOW",
    "COMPLETED",
    "CANCELLED",
  ])("acepta estado %s", (s) =>
    expect(appointmentStatusEnum.safeParse(s).success).toBe(true),
  );

  it("rechaza estado desconocido", () => {
    expect(appointmentStatusEnum.safeParse("PENDING").success).toBe(false);
  });
});

describe("outpatientAppointmentCreateInput", () => {
  it("acepta input mínimo válido con fecha futura", () => {
    const r = outpatientAppointmentCreateInput.safeParse({
      patientId: u,
      providerId: u,
      establishmentId: u,
      scheduledAt: future,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.durationMinutes).toBe(20);
  });

  it("rechaza scheduledAt en pasado", () => {
    expect(
      outpatientAppointmentCreateInput.safeParse({
        patientId: u,
        providerId: u,
        establishmentId: u,
        scheduledAt: past,
      }).success,
    ).toBe(false);
  });

  it("rechaza durationMinutes fuera de rango", () => {
    expect(
      outpatientAppointmentCreateInput.safeParse({
        patientId: u,
        providerId: u,
        establishmentId: u,
        scheduledAt: future,
        durationMinutes: 4,
      }).success,
    ).toBe(false);
    expect(
      outpatientAppointmentCreateInput.safeParse({
        patientId: u,
        providerId: u,
        establishmentId: u,
        scheduledAt: future,
        durationMinutes: 181,
      }).success,
    ).toBe(false);
  });

  it("rechaza UUID inválido en patientId", () => {
    expect(
      outpatientAppointmentCreateInput.safeParse({
        patientId: "not-uuid",
        providerId: u,
        establishmentId: u,
        scheduledAt: future,
      }).success,
    ).toBe(false);
  });
});

describe("outpatientAppointmentUpdateInput", () => {
  it("acepta update parcial con solo status", () => {
    expect(
      outpatientAppointmentUpdateInput.safeParse({
        id: u,
        status: "CONFIRMED",
      }).success,
    ).toBe(true);
  });

  it("acepta notes null", () => {
    expect(
      outpatientAppointmentUpdateInput.safeParse({ id: u, notes: null })
        .success,
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
    expect(
      outpatientAppointmentListInput.safeParse({ limit: 101 }).success,
    ).toBe(false);
  });
});

describe("outpatientAppointmentCancelInput", () => {
  it("requiere reason no vacío", () => {
    expect(
      outpatientAppointmentCancelInput.safeParse({ id: u, reason: "" }).success,
    ).toBe(false);
  });

  it("acepta reason válido", () => {
    expect(
      outpatientAppointmentCancelInput.safeParse({
        id: u,
        reason: "Paciente solicitó cancelación.",
      }).success,
    ).toBe(true);
  });
});

describe("outpatientConsultationCreateInput", () => {
  it("acepta SOAP completo", () => {
    expect(
      outpatientConsultationCreateInput.safeParse({
        encounterId: u,
        reasonOfVisit: "Control rutinario",
        subjective: "Paciente refiere mejoría",
        objective: "Signos vitales estables",
        assessment: "Evolución favorable",
        plan: "Continuar tratamiento",
      }).success,
    ).toBe(true);
  });

  it("rechaza reasonOfVisit vacío", () => {
    expect(
      outpatientConsultationCreateInput.safeParse({
        encounterId: u,
        reasonOfVisit: "",
      }).success,
    ).toBe(false);
  });
});
