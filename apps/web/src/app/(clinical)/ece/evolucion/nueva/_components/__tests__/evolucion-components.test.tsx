// @vitest-environment jsdom
/**
 * Tests unitarios — componentes CC-0004 (evolucion/nueva).
 *
 * Cubre:
 *   SignosVitalesCapture: render smoke + onChange al editar un campo.
 *   ProblemasCard: render sin completar + render completado con preview.
 *   ProblemasModal: render smoke + descarta buffer al cancelar + persiste al guardar.
 */

import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { SignosVitalesCapture, SIGNOS_INITIAL } from "../SignosVitalesCapture";
import { ProblemasCard } from "../ProblemasCard";
import { ProblemasModal, PROBLEMAS_INITIAL } from "../ProblemasModal";

// ─── Mocks externos ──────────────────────────────────────────────────────────

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

// ─── ProblemasCard ───────────────────────────────────────────────────────────

describe("ProblemasCard", () => {
  it("muestra CTA 'Completar problemas' cuando isCompleted=false", () => {
    const onEdit = vi.fn();
    render(
      <ProblemasCard
        value={PROBLEMAS_INITIAL}
        isCompleted={false}
        onEdit={onEdit}
      />,
    );
    expect(screen.getByRole("button", { name: /completar sección problemas/i })).toBeInTheDocument();
  });

  it("muestra badge 'Completado' y preview cuando isCompleted=true", () => {
    const onEdit = vi.fn();
    const value = {
      ...PROBLEMAS_INITIAL,
      subjetivo: "Dolor abdominal fuerte que inició ayer.",
      objetivo: "Abdomen blando sin rigidez.",
    };
    render(
      <ProblemasCard value={value} isCompleted={true} onEdit={onEdit} />,
    );
    expect(screen.getByText(/Completado/i)).toBeInTheDocument();
    expect(screen.getByText(/Dolor abdominal/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /editar/i })).toBeInTheDocument();
  });

  it("llama onEdit al hacer click en el botón Editar", () => {
    const onEdit = vi.fn();
    render(
      <ProblemasCard
        value={{ ...PROBLEMAS_INITIAL, subjetivo: "Algo" }}
        isCompleted={true}
        onEdit={onEdit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /editar/i }));
    expect(onEdit).toHaveBeenCalledOnce();
  });
});

// ─── ProblemasModal ──────────────────────────────────────────────────────────

describe("ProblemasModal", () => {
  it("renderiza el modal cuando open=true", () => {
    render(
      <ProblemasModal
        open={true}
        onClose={vi.fn()}
        value={PROBLEMAS_INITIAL}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/Subjetivo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Objetivo/i)).toBeInTheDocument();
  });

  it("llama onChange con los datos actualizados al guardar", () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <ProblemasModal
        open={true}
        onClose={onClose}
        value={PROBLEMAS_INITIAL}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Subjetivo/i), {
      target: { value: "Dolor de cabeza" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar$/i }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ subjetivo: "Dolor de cabeza" }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("llama onClose pero NO onChange al cancelar", () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <ProblemasModal
        open={true}
        onClose={onClose}
        value={PROBLEMAS_INITIAL}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Subjetivo/i), {
      target: { value: "Texto descartado" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Cancelar/i }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  // AC-5: signos vitales guardados junto con S/O al confirmar
  it("AC-5: onChange incluye signos vitales capturados al guardar", () => {
    const onChange = vi.fn();
    render(
      <ProblemasModal
        open={true}
        onClose={vi.fn()}
        value={PROBLEMAS_INITIAL}
        onChange={onChange}
      />,
    );
    // Editar subjetivo
    fireEvent.change(screen.getByLabelText(/Subjetivo/i), {
      target: { value: "Cefalea intensa" },
    });
    // Editar un signo vital (TA Sistólica — idPrefix="modal-sv")
    const taSist = screen.getByLabelText(/TA Sistólica/i);
    fireEvent.change(taSist, { target: { value: "140" } });
    // Guardar
    fireEvent.click(screen.getByRole("button", { name: /^Guardar$/i }));
    expect(onChange).toHaveBeenCalledOnce();
    const payload = onChange.mock.calls[0]![0] as { subjetivo: string; signos: { presionSistolica: string } };
    expect(payload.subjetivo).toBe("Cefalea intensa");
    expect(payload.signos.presionSistolica).toBe("140");
  });

  // AC-6: buffer re-sincroniza con value externo al re-abrir (no conserva edición
  // del intento cancelado anterior).
  it("AC-6: al re-abrir el modal el buffer muestra el valor externo (no la edición cancelada)", () => {
    const externalValue = { ...PROBLEMAS_INITIAL, subjetivo: "Valor guardado previamente" };
    const { rerender } = render(
      <ProblemasModal
        open={true}
        onClose={vi.fn()}
        value={externalValue}
        onChange={vi.fn()}
      />,
    );
    // Editar en el buffer sin guardar
    fireEvent.change(screen.getByLabelText(/Subjetivo/i), {
      target: { value: "Edición descartada" },
    });
    // Cerrar (simula que el padre pone open=false luego open=true otra vez)
    rerender(
      <ProblemasModal
        open={false}
        onClose={vi.fn()}
        value={externalValue}
        onChange={vi.fn()}
      />,
    );
    rerender(
      <ProblemasModal
        open={true}
        onClose={vi.fn()}
        value={externalValue}
        onChange={vi.fn()}
      />,
    );
    // Al re-abrir, el subjetivo debe mostrar el valor externo
    expect(screen.getByLabelText(/Subjetivo/i)).toHaveValue("Valor guardado previamente");
  });
});
