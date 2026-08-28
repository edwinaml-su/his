// @vitest-environment jsdom
/**
 * US-2.7 — `<PatientShellBar />` como puerta de entrada de break-glass.
 *
 * Cuando `trpc.patient.get` falla (paciente fuera del alcance normal del
 * usuario), el componente debía devolver `null` sin más — dejando al
 * clínico sin ninguna forma de invocar el acceso de emergencia. Verifica
 * que ahora, en ese estado de error, se renderiza `<BreakGlassButton>`.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockInvalidate = vi.fn().mockResolvedValue(undefined);
const mockPatientGetUseQuery = vi.fn();
const mockEncounterListUseQuery = vi.fn((..._args: unknown[]) => ({ data: undefined }));

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    useUtils: () => ({ patient: { get: { invalidate: mockInvalidate } } }),
    patient: {
      get: {
        useQuery: (...args: unknown[]) => mockPatientGetUseQuery(...args),
      },
    },
    encounter: {
      list: {
        useQuery: (...args: unknown[]) => mockEncounterListUseQuery(...args),
      },
    },
  },
}));

const mockActivateBreakGlass = vi.fn().mockResolvedValue({
  ok: true,
  activatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
});
vi.mock("@/app/actions/break-glass", () => ({
  activateBreakGlass: (...args: unknown[]) => mockActivateBreakGlass(...args),
}));

import { PatientShellBar } from "../patient-shell-bar";

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

describe("<PatientShellBar /> — puerta de entrada break-glass (US-2.7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("cargando → no renderiza nada", () => {
    mockPatientGetUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    const { container } = render(<PatientShellBar patientId={PATIENT_ID} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("query falla (sin acceso normal) → renderiza BreakGlassButton en vez de nada", () => {
    mockPatientGetUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("FORBIDDEN"),
    });
    render(<PatientShellBar patientId={PATIENT_ID} />);

    expect(
      screen.getByRole("button", { name: /activar acceso de emergencia/i }),
    ).toBeInTheDocument();
  });

  it("click en Break-Glass abre el modal de activación", () => {
    mockPatientGetUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("FORBIDDEN"),
    });
    render(<PatientShellBar patientId={PATIENT_ID} />);

    fireEvent.click(
      screen.getByRole("button", { name: /activar acceso de emergencia/i }),
    );

    expect(
      screen.getByText(/acceso de emergencia \(break-glass\)/i),
    ).toBeInTheDocument();
  });
});
