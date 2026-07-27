// @vitest-environment jsdom
/**
 * Tests unitarios — SignosVitalesCapture (CC-0012, módulo transversal).
 *
 * Cubre: render de grupos (núcleo + "Ver más"), conversiones bidireccionales
 * (kg↔lb, m↔ft), alertas críticas en vivo, y gineco-obstétrico obligatorio
 * (fórmula G·P·P·A·V) solo para sexo femenino.
 */
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { SignosVitalesCapture } from "../SignosVitalesCapture";
import { VITALES_FORM_EMPTY, type VitalesFormState } from "../types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Controlled({
  initial = VITALES_FORM_EMPTY,
  sexo,
  edad,
  showErrors,
}: {
  initial?: VitalesFormState;
  sexo?: string | null;
  edad?: number | null;
  showErrors?: boolean;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <SignosVitalesCapture
      idPrefix="t"
      value={value}
      onChange={setValue}
      sexo={sexo}
      edad={edad}
      showErrors={showErrors}
    />
  );
}

describe("SignosVitalesCapture — render de grupos", () => {
  it("renderiza sin errores y muestra el núcleo obligatorio siempre visible", () => {
    render(<Controlled />);
    expect(screen.getByTestId("signos-vitales-capture")).toBeInTheDocument();
    expect(screen.getByLabelText(/TA Sistólica/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/TA Diastólica/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Frecuencia cardíaca/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Frecuencia respiratoria/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Temperatura/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/SpO₂/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/FiO₂/i)).toBeInTheDocument();
  });

  it('el bloque "Ver más" inicia plegado (className="hidden", sin unmount) y se expande al hacer click', () => {
    render(<Controlled />);
    // El bloque usa `className={expanded ? "space-y-4" : "hidden"}` (no
    // desmonta), por eso se verifica la clase del contenedor en vez de
    // presencia/visibilidad computada (jsdom no resuelve Tailwind en tests).
    const vmore = document.getElementById("t-vmore");
    expect(vmore?.className).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: /Ver más/i }));
    expect(vmore?.className).not.toBe("hidden");
    expect(screen.getByLabelText(/Glucometría capilar/i)).toBeInTheDocument();
  });

  it("gineco-obstétrico NO se muestra para sexo masculino", () => {
    render(<Controlled sexo="M" />);
    fireEvent.click(screen.getByRole("button", { name: /Ver más/i }));
    expect(screen.queryByText(/Gineco-obstétrico/i)).not.toBeInTheDocument();
  });

  it("gineco-obstétrico se muestra para sexo femenino con fórmula G·P·P·A·V", () => {
    render(<Controlled sexo="F" edad={28} />);
    fireEvent.click(screen.getByRole("button", { name: /Ver más/i }));
    expect(screen.getByText(/Gineco-obstétrico/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Fecha de última regla/i)).toBeInTheDocument();
    // Interruptor FPP solo aparece si además está en edad fértil.
    expect(screen.getByLabelText(/Calcular fecha probable de parto/i)).toBeInTheDocument();
  });

  it("FPP no se ofrece si la paciente está fuera de edad fértil", () => {
    render(<Controlled sexo="F" edad={70} />);
    fireEvent.click(screen.getByRole("button", { name: /Ver más/i }));
    expect(screen.getByText(/Gineco-obstétrico/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Calcular fecha probable de parto/i)).not.toBeInTheDocument();
  });
});

describe("SignosVitalesCapture — conversiones bidireccionales", () => {
  it("kg → lb: al editar peso en kg, actualiza peso en lb", () => {
    render(<Controlled sexo="F" edad={28} />);
    fireEvent.click(screen.getByRole("button", { name: /Ver más/i }));
    const kgInput = screen.getByLabelText(/Peso\s*\(kg\)/i) as HTMLInputElement;
    fireEvent.change(kgInput, { target: { value: "70" } });
    const lbInput = screen.getByLabelText(/Peso\s*\(lb\)/i) as HTMLInputElement;
    expect(lbInput.value).toBe((70 * 2.20462).toFixed(1));
  });

  it("m → ft: al editar talla en m, actualiza talla en ft", () => {
    render(<Controlled sexo="F" edad={28} />);
    fireEvent.click(screen.getByRole("button", { name: /Ver más/i }));
    const mInput = screen.getByLabelText(/Talla\s*\(m\)/i) as HTMLInputElement;
    fireEvent.change(mInput, { target: { value: "1.7" } });
    const ftInput = screen.getByLabelText(/Talla\s*\(ft\)/i) as HTMLInputElement;
    expect(ftInput.value).toBe((1.7 * 3.28084).toFixed(2));
  });

  it("IMC se calcula y clasifica al tener peso(kg) y talla(m)", () => {
    render(<Controlled />);
    fireEvent.click(screen.getByRole("button", { name: /Ver más/i }));
    fireEvent.change(screen.getByLabelText(/Peso\s*\(kg\)/i), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText(/Talla\s*\(m\)/i), { target: { value: "1.70" } });
    expect(screen.getByText(/24\.2 kg\/m²/)).toBeInTheDocument();
    expect(screen.getByText(/Normal/)).toBeInTheDocument();
  });
});

describe("SignosVitalesCapture — alertas críticas en vivo", () => {
  it('sin datos muestra el mensaje idle ("Ingrese signos...")', () => {
    render(<Controlled />);
    expect(screen.getByTestId("signos-alertas")).toHaveTextContent(
      /Ingrese signos para evaluar alertas/i,
    );
  });

  it("SpO₂ < 90 dispara alerta 'SpO₂ baja'", () => {
    render(<Controlled />);
    fireEvent.change(screen.getByLabelText(/SpO₂/i), { target: { value: "85" } });
    expect(screen.getByTestId("signos-alertas")).toHaveTextContent(/SpO₂ baja/);
  });

  it("sin alertas pero con datos capturados muestra 'Sin alertas críticas'", () => {
    render(<Controlled />);
    fireEvent.change(screen.getByLabelText(/SpO₂/i), { target: { value: "98" } });
    expect(screen.getByTestId("signos-alertas")).toHaveTextContent(/Sin alertas críticas/);
  });

  it("TA sistólica ≥180 dispara 'Crisis hipertensiva'", () => {
    render(<Controlled />);
    fireEvent.change(screen.getByLabelText(/TA Sistólica/i), { target: { value: "185" } });
    expect(screen.getByTestId("signos-alertas")).toHaveTextContent(/Crisis hipertensiva/);
  });
});
