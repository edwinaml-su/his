// @vitest-environment jsdom
/**
 * Tests unitarios — SignosVitalesCapture (CC-0006).
 *
 * ProblemasCard y ProblemasModal fueron eliminados en CC-0006 PASO 2.
 * Los tests de los componentes nuevos viven en __tests__/evolucion-page.test.tsx.
 */

import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { SignosVitalesCapture, SIGNOS_INITIAL } from "../SignosVitalesCapture";

// evaluateVitalAlerts puede lanzar si el contrato no se importa correctamente
// en jsdom. Lo stubeamos para mantener los tests enfocados en la UI.
vi.mock("@his/contracts/schemas/inpatient", () => ({
  evaluateVitalAlerts: vi.fn().mockReturnValue([]),
  VITAL_THRESHOLDS_ADULT: {},
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── SignosVitalesCapture ────────────────────────────────────────────────────

describe("SignosVitalesCapture", () => {
  it("renderiza sin errors (smoke)", () => {
    const onChange = vi.fn();
    render(
      <SignosVitalesCapture value={SIGNOS_INITIAL} onChange={onChange} />,
    );
    expect(screen.getByTestId("signos-vitales-capture")).toBeInTheDocument();
  });

  it("llama onChange al editar TA sistólica", () => {
    const onChange = vi.fn();
    render(
      <SignosVitalesCapture
        idPrefix="test"
        value={SIGNOS_INITIAL}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText(/TA Sistólica/i);
    fireEvent.change(input, { target: { value: "120" } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ presionSistolica: "120" }),
    );
  });

  it("llama onChange al mover el slider de dolor", () => {
    const onChange = vi.fn();
    render(
      <SignosVitalesCapture
        idPrefix="test"
        value={SIGNOS_INITIAL}
        onChange={onChange}
      />,
    );
    const slider = screen.getByLabelText(/Escala de dolor 0 a 10/i);
    fireEvent.change(slider, { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ escalaDolor: 7 }),
    );
  });
});
