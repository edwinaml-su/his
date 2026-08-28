// @vitest-environment jsdom
/**
 * US-2.7 — `<BreakGlassButton />` + `<BreakGlassModal />`.
 *
 * Verifica: con acceso normal no renderiza nada (regla DoD); sin acceso
 * normal muestra el botón "Break-Glass" y, al hacer click, abre el modal
 * de activación (justificación + acknowledgement).
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockActivateBreakGlass = vi.fn().mockResolvedValue({
  ok: true,
  activatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
});
vi.mock("@/app/actions/break-glass", () => ({
  activateBreakGlass: (...args: unknown[]) => mockActivateBreakGlass(...args),
}));

import { BreakGlassButton } from "../break-glass-button";

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

describe("<BreakGlassButton /> — US-2.7", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("hasNormalAccess=true → no renderiza nada (regla DoD)", () => {
    const { container } = render(
      <BreakGlassButton patientId={PATIENT_ID} hasNormalAccess />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hasNormalAccess=false → muestra el botón Break-Glass", () => {
    render(<BreakGlassButton patientId={PATIENT_ID} hasNormalAccess={false} />);
    expect(
      screen.getByRole("button", { name: /activar acceso de emergencia/i }),
    ).toBeInTheDocument();
  });

  it("click en el botón → abre el modal de activación", () => {
    render(
      <BreakGlassButton
        patientId={PATIENT_ID}
        patientLabel="Paciente de prueba"
        hasNormalAccess={false}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /activar acceso de emergencia/i }),
    );

    expect(
      screen.getByText(/acceso de emergencia \(break-glass\)/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/justificación clínica/i)).toBeInTheDocument();
    expect(
      screen.getByText(/paciente de prueba sin permiso normal/i),
    ).toBeInTheDocument();
  });
});
