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

// ─── Fila de alertas (§10.4) — 3 estados ─────────────────────────────────────

describe("SignosVitalesCapture · fila de alertas", () => {
  it("sin datos: estado inactivo (role=status) con texto guía", () => {
    render(<SignosVitalesCapture value={SIGNOS_INITIAL} onChange={vi.fn()} />);
    const row = screen.getByTestId("signos-alertas");
    expect(row).toHaveAttribute("role", "status");
    expect(row).toHaveTextContent(/ingrese signos para evaluar alertas/i);
  });

  it("con datos normales: 'Sin alertas críticas' (role=status)", () => {
    render(
      <SignosVitalesCapture
        value={{ ...SIGNOS_INITIAL, presionSistolica: "120" }}
        onChange={vi.fn()}
      />,
    );
    const row = screen.getByTestId("signos-alertas");
    expect(row).toHaveAttribute("role", "status");
    expect(row).toHaveTextContent(/sin alertas críticas/i);
  });

  it("con valor crítico: alerta roja (role=alert) con el mensaje", () => {
    render(
      <SignosVitalesCapture
        value={{ ...SIGNOS_INITIAL, saturacionO2: "85" }}
        onChange={vi.fn()}
      />,
    );
    const row = screen.getByTestId("signos-alertas");
    expect(row).toHaveAttribute("role", "alert");
    expect(row).toHaveTextContent("Alertas");
    expect(row).toHaveTextContent("baja"); // "SpO₂ baja"
  });
});

// ─── Antropometría — índice cintura-talla (§10.7) ────────────────────────────

describe("SignosVitalesCapture · índice cintura-talla", () => {
  it("calcula y clasifica el ICT con cintura + talla", () => {
    render(
      <SignosVitalesCapture
        idPrefix="t"
        value={{ ...SIGNOS_INITIAL, tallaM: "1.6", perimetroCintura: "90" }}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /ver más/i }));
    expect(screen.getByText(/0\.56/)).toBeInTheDocument();
    expect(screen.getByText("Riesgo aumentado")).toBeInTheDocument();
  });
});

// ─── Gineco-obstétrico (§10.4) ───────────────────────────────────────────────

describe("SignosVitalesCapture · gineco-obstétrico", () => {
  it("oculto para sexo masculino", () => {
    render(<SignosVitalesCapture value={SIGNOS_INITIAL} onChange={vi.fn()} sexo="M" edad={30} />);
    expect(screen.queryByText("Gineco-obstétrico")).not.toBeInTheDocument();
    expect(screen.queryByText(/fórmula obstétrica/i)).not.toBeInTheDocument();
  });

  it("visible y marcado como obligatorio para sexo femenino", () => {
    render(<SignosVitalesCapture value={SIGNOS_INITIAL} onChange={vi.fn()} sexo="F" edad={30} />);
    expect(screen.getByText("Gineco-obstétrico")).toBeInTheDocument();
    expect(screen.getByText("Obligatorio")).toBeInTheDocument();
    expect(screen.getByText(/fórmula obstétrica/i)).toBeInTheDocument();
  });

  it("el interruptor activa el cálculo de la FPP (Naegele)", () => {
    render(
      <SignosVitalesCapture
        idPrefix="t"
        value={{ ...SIGNOS_INITIAL, fechaUltimaRegla: "2025-05-15" }}
        onChange={vi.fn()}
        sexo="F"
        edad={30}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /ver más/i }));
    // Apagado: muestra la guía, aún sin fecha.
    expect(screen.getByText(/active el interruptor para calcular la fpp/i)).toBeInTheDocument();
    // Encender el interruptor → desaparece la guía y aparece una fecha dd/mm/aaaa.
    fireEvent.click(screen.getByRole("switch", { name: /calcular fecha probable de parto/i }));
    expect(screen.queryByText(/active el interruptor/i)).not.toBeInTheDocument();
    expect(screen.getByText(/\d{1,2}\/\d{1,2}\/\d{4}/)).toBeInTheDocument();
  });
});
