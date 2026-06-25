// @vitest-environment jsdom
/**
 * Tests unitarios — componentes CC-0004 (evolucion/nueva).
 *
 * Cubre:
 *   SignosVitalesCapture: render smoke + onChange al editar un campo.
 *   ProblemasModal: render + guardar + cancelar + buffer re-sync + validación descripcion.
 *   ProblemasCard: estado vacío + con datos + handlers.
 *   SignosVitalesCard: smoke.
 */

import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { SignosVitalesCapture, SIGNOS_INITIAL } from "../SignosVitalesCapture";
import { ProblemasCard } from "../ProblemasCard";
import { ProblemasModal, type ProblemaItem } from "../ProblemasModal";
import { SignosVitalesCard } from "../SignosVitalesCard";

// ─── Mocks externos ──────────────────────────────────────────────────────────

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
  it("muestra estado vacío y botón 'Agregar problema' cuando no hay problemas", () => {
    render(
      <ProblemasCard
        problemas={[]}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/Aún no hay problemas registrados/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /agregar problema/i })).toBeInTheDocument();
  });

  it("muestra las descripciones de los problemas en la tabla", () => {
    const problemas: ProblemaItem[] = [
      { id: "1", descripcion: "Cefalea tensional", subjetivo: "S1", objetivo: "O1" },
      { id: "2", descripcion: "HTA grado 2", subjetivo: "S2", objetivo: "" },
    ];
    render(
      <ProblemasCard
        problemas={problemas}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("Cefalea tensional")).toBeInTheDocument();
    expect(screen.getByText("HTA grado 2")).toBeInTheDocument();
  });

  it("click en 'Agregar problema' llama onAdd", () => {
    const onAdd = vi.fn();
    render(
      <ProblemasCard
        problemas={[]}
        onAdd={onAdd}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /agregar problema/i }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("click en Editar llama onEdit con el índice correcto", () => {
    const onEdit = vi.fn();
    const problemas: ProblemaItem[] = [
      { id: "1", descripcion: "Problema A", subjetivo: "", objetivo: "" },
      { id: "2", descripcion: "Problema B", subjetivo: "", objetivo: "" },
    ];
    render(
      <ProblemasCard
        problemas={problemas}
        onAdd={vi.fn()}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />,
    );
    const editButtons = screen.getAllByRole("button", { name: /editar problema/i });
    fireEvent.click(editButtons[1]!);
    expect(onEdit).toHaveBeenCalledWith(1);
  });

  it("click en Eliminar llama onDelete con el índice correcto", () => {
    const onDelete = vi.fn();
    const problemas: ProblemaItem[] = [
      { id: "1", descripcion: "Problema A", subjetivo: "", objetivo: "" },
      { id: "2", descripcion: "Problema B", subjetivo: "", objetivo: "" },
    ];
    render(
      <ProblemasCard
        problemas={problemas}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={onDelete}
      />,
    );
    const deleteButtons = screen.getAllByRole("button", { name: /eliminar problema/i });
    fireEvent.click(deleteButtons[0]!);
    expect(onDelete).toHaveBeenCalledWith(0);
  });
});

// ─── ProblemasModal ──────────────────────────────────────────────────────────

describe("ProblemasModal", () => {
  it("renderiza el modal con campos Problema/Subjetivo/Objetivo (sin signos)", () => {
    render(
      <ProblemasModal
        open={true}
        onClose={vi.fn()}
        value={null}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Problema$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Subjetivo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Objetivo/i)).toBeInTheDocument();
    // No debe mostrar signos vitales
    expect(screen.queryByTestId("signos-vitales-capture")).not.toBeInTheDocument();
  });

  it("muestra título 'Agregar problema' cuando value=null", () => {
    render(
      <ProblemasModal open={true} onClose={vi.fn()} value={null} onSave={vi.fn()} />,
    );
    expect(screen.getByText("Agregar problema")).toBeInTheDocument();
  });

  it("muestra título 'Editar problema' cuando value tiene datos", () => {
    const item: ProblemaItem = { id: "1", descripcion: "Cefalea", subjetivo: "S", objetivo: "O" };
    render(
      <ProblemasModal open={true} onClose={vi.fn()} value={item} onSave={vi.fn()} />,
    );
    expect(screen.getByText("Editar problema")).toBeInTheDocument();
  });

  it("llama onSave con los datos y luego onClose al guardar", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <ProblemasModal
        open={true}
        onClose={onClose}
        value={null}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^Problema$/i), {
      target: { value: "Cefalea tensional" },
    });
    fireEvent.change(screen.getByLabelText(/Subjetivo/i), {
      target: { value: "Dolor de cabeza" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar$/i }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ descripcion: "Cefalea tensional", subjetivo: "Dolor de cabeza" }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("llama onClose pero NO onSave al cancelar", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <ProblemasModal
        open={true}
        onClose={onClose}
        value={null}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^Problema$/i), {
      target: { value: "Algo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Cancelar/i }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("botón Guardar deshabilitado si descripcion está vacía", () => {
    render(
      <ProblemasModal open={true} onClose={vi.fn()} value={null} onSave={vi.fn()} />,
    );
    // descripcion vacía al abrir en modo Agregar
    const guardar = screen.getByRole("button", { name: /^Guardar$/i });
    expect(guardar).toBeDisabled();
  });

  it("AC-6: al re-abrir el modal el buffer muestra el valor externo (no la edición cancelada)", () => {
    const item: ProblemaItem = {
      id: "1",
      descripcion: "Valor guardado previamente",
      subjetivo: "S previo",
      objetivo: "",
    };
    const { rerender } = render(
      <ProblemasModal open={true} onClose={vi.fn()} value={item} onSave={vi.fn()} />,
    );
    // Editar en el buffer sin guardar
    fireEvent.change(screen.getByLabelText(/^Problema$/i), {
      target: { value: "Edición descartada" },
    });
    // Cerrar y re-abrir
    rerender(
      <ProblemasModal open={false} onClose={vi.fn()} value={item} onSave={vi.fn()} />,
    );
    rerender(
      <ProblemasModal open={true} onClose={vi.fn()} value={item} onSave={vi.fn()} />,
    );
    expect(screen.getByLabelText(/^Problema$/i)).toHaveValue("Valor guardado previamente");
  });
});

// ─── SignosVitalesCard ───────────────────────────────────────────────────────

describe("SignosVitalesCard", () => {
  it("renderiza sin errores y muestra título 'Signos vitales'", () => {
    render(
      <SignosVitalesCard value={SIGNOS_INITIAL} onChange={vi.fn()} />,
    );
    expect(screen.getByText(/Signos vitales/i)).toBeInTheDocument();
    expect(screen.getByTestId("signos-vitales-capture")).toBeInTheDocument();
  });
});
