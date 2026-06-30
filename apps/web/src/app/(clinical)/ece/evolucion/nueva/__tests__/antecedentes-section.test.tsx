// @vitest-environment jsdom
/**
 * Tests de AntecedentesSection (CC-0006 §10.3).
 *
 * Estrategia idéntica a evolucion-page.test: se mockea useEvolucionDraft para
 * cortar la cadena tRPC. Se verifica la máquina de estados colapsado → resumen
 * → edición, la confirmación §10.3.1 y el sello "registrado por".
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { DRAFT_EMPTY } from "../_lib/types";

const mockDispatch = vi.fn();

let draftState: typeof DRAFT_EMPTY = { ...DRAFT_EMPTY };
const paciente = {
  preferredName: "LALO",
  esLgbtiq: true,
  usuarioActual: { id: "u1", nombre: "DR. TEST" },
};

vi.mock("../_hooks/useEvolucionDraft", () => ({
  useEvolucionDraft: () => ({
    draft: draftState,
    dispatch: mockDispatch,
    paciente,
  }),
}));

import { AntecedentesSection } from "../_components/AntecedentesSection";

describe("AntecedentesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftState = {
      ...DRAFT_EMPTY,
      antecedentes: {
        alergias: { estado: "TIENE", items: ["PENICILINA"] },
        personales: {
          estado: "NINGUNO",
          items: [],
          auditoria: { registradoPor: "DR. TEST", registradoEn: "01/01/2026 10:00:00" },
        },
        familiares: { estado: "TIENE", items: [] },
        ocupacion: { estado: "NO_APLICA", items: [] },
        habitos: { estado: "TIENE", items: [] },
      },
    };
  });

  afterEach(() => cleanup());

  it("arranca colapsado: muestra título y controles, sin resumen", () => {
    render(<AntecedentesSection />);
    expect(screen.getByText(/^antecedentes$/i)).toBeInTheDocument();
    expect(screen.getByText(/opcional/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /modificar antecedentes/i })).toBeInTheDocument();
    // En colapsado no hay grupos ni chips.
    expect(screen.queryByText(/patológicos/i)).not.toBeInTheDocument();
    expect(screen.queryByText("PENICILINA")).not.toBeInTheDocument();
  });

  it("el chevron expande el resumen de solo lectura con sello e identidad", () => {
    render(<AntecedentesSection />);
    fireEvent.click(screen.getByRole("button", { name: /ver antecedentes/i }));
    // Grupos
    expect(screen.getByText(/^patológicos$/i)).toBeInTheDocument();
    expect(screen.getByText(/^no patológicos$/i)).toBeInTheDocument();
    expect(screen.getByText(/^identidad$/i)).toBeInTheDocument();
    // Chip de alergia + sello de "Personales" negativo
    expect(screen.getByText("PENICILINA")).toBeInTheDocument();
    expect(screen.getByText(/registrado por/i)).toBeInTheDocument();
    expect(screen.getByText("DR. TEST")).toBeInTheDocument();
    // Identidad de solo lectura
    expect(screen.getByText("LALO")).toBeInTheDocument();
  });

  it("«Modificar Antecedentes» abre la confirmación §10.3.1", () => {
    render(<AntecedentesSection />);
    fireEvent.click(screen.getByRole("button", { name: /modificar antecedentes/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText(/confirme que desea modificar los antecedentes/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/actualizan la historia clínica del paciente/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sí, modificar/i })).toBeInTheDocument();
  });

  it("confirmar habilita el editor con las 5 subsecciones y «Contraer»", () => {
    render(<AntecedentesSection />);
    fireEvent.click(screen.getByRole("button", { name: /modificar antecedentes/i }));
    fireEvent.click(screen.getByRole("button", { name: /sí, modificar/i }));
    // Editor: subsecciones clínicas + acción de contraer
    expect(screen.getByText("Alergias")).toBeInTheDocument();
    expect(screen.getByText("Ocupación")).toBeInTheDocument();
    expect(screen.getByText("Hábitos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /contraer antecedentes/i })).toBeInTheDocument();
    // La identidad permanece de solo lectura (no se edita en la evolución).
    expect(screen.getByText(/se gestiona en el registro de pacientes/i)).toBeInTheDocument();
  });
});
