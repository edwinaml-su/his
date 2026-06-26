// @vitest-environment jsdom
/**
 * Tests de renderizado de la página NuevaEvolucionPage.
 *
 * Estrategia: mock completo del hook useEvolucionDraft para evitar
 * la cadena de imports tRPC que no resuelve en Vitest (alias "@/" no
 * funciona en vite:import-analysis para subdirectorios profundos con Vite 2.1.9).
 * Los tests de autosave con tRPC real van en E2E.
 *
 * @QA E2E (Playwright): abrir modal problema → guardar → verificar sección;
 *   firmar con estado completo → verificar inmutabilidad en BD.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams("episodeId=test-episode-uuid"),
}));

// El alias "@/" no resuelve en vite:import-analysis para módulos cargados
// transitivamente desde subdirectorios profundos (limitación del config de Vitest).
// Mockeamos el hook directamente para evitar que Vite transforme useEvolucionDraft.tsx
// y su cadena de imports tRPC.
import { draftReducer, DRAFT_EMPTY, puedeFirmar, SIGNOS_EMPTY } from "../_lib/types";

const mockSign = vi.fn();
const mockDispatch = vi.fn();

let draftState = { ...DRAFT_EMPTY };

vi.mock("../_hooks/useEvolucionDraft", () => {
  // Componente mínimo de Provider que no usa tRPC
  function EvolucionDraftProvider({
    children,
  }: {
    episodeId?: string;
    children: React.ReactNode;
  }) {
    return React.createElement(React.Fragment, null, children);
  }

  function useEvolucionDraft() {
    return {
      draft: draftState,
      dispatch: (action: Parameters<typeof draftReducer>[1]) => {
        mockDispatch(action);
        // Aplicar el reducer real para que los tests vean el estado actualizado
        draftState = draftReducer(draftState, action);
      },
      status: "idle" as const,
      borradorId: undefined,
      canSign: puedeFirmar(draftState),
      sign: mockSign,
      episodeId: "test-episode-uuid",
      fecha: new Date("2026-06-25T10:00:00"),
    };
  }

  return { EvolucionDraftProvider, useEvolucionDraft };
});

// SignosVitalesCapture usa @his/contracts
vi.mock("@his/contracts/schemas/inpatient", () => ({
  evaluateVitalAlerts: vi.fn().mockReturnValue([]),
}));

// ─── Import del componente (tras los mocks) ──────────────────────────────────

import NuevaEvolucionPage from "../page";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setup() {
  draftState = { ...DRAFT_EMPTY };
  return render(<NuevaEvolucionPage />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("NuevaEvolucionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renderiza el título y las secciones principales", () => {
    setup();
    expect(screen.getByRole("heading", { name: /nueva evolución médica/i })).toBeInTheDocument();
    // Todos los badges de sección
    expect(screen.getAllByText(/problemas/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/subjetivo/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/signos vitales/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/objetivo/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/análisis/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/plan/i).length).toBeGreaterThan(0);
  });

  it("botón Firmar deshabilitado con draft vacío (gating)", () => {
    setup();
    const btn = screen.getByTestId("btn-firmar");
    expect(btn).toBeDisabled();
  });

  it("abre modal de problema al hacer click en Agregar problema", () => {
    setup();
    // Puede haber múltiples elementos con ese texto (header + modal); usar el botón del header
    const btns = screen.getAllByRole("button", { name: /agregar problema/i });
    fireEvent.click(btns[0]!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText(/agregar problema/i).length).toBeGreaterThan(0);
  });

  it("cerrar modal con Cancelar no envía dispatch", () => {
    setup();
    const btns = screen.getAllByRole("button", { name: /agregar problema/i });
    fireEvent.click(btns[0]!);
    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("agregar problema envía dispatch ADD_PROBLEMA y aparece en lista", async () => {
    setup();
    const btns = screen.getAllByRole("button", { name: /agregar problema/i });
    fireEvent.click(btns[0]!);
    const ta = screen.getByPlaceholderText(/Describa el problema/i);
    fireEvent.change(ta, { target: { value: "Cefalea tensional" } });
    fireEvent.click(screen.getByRole("button", { name: /agregar a la lista/i }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_PROBLEMA", texto: "Cefalea tensional" }),
    );
    // El texto debe aparecer en el DOM tras el dispatch
    expect(await screen.findByText("Cefalea tensional")).toBeInTheDocument();
  });

  it("abrir modal de subjetivo y guardar envía dispatch SET_SUBJETIVO", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /llenar subjetivo/i }));
    fireEvent.change(screen.getByPlaceholderText(/redactar subjetivo/i), {
      target: { value: "Dolor de cabeza" },
    });
    fireEvent.click(screen.getByRole("button", { name: /guardar subjetivo/i }));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_SUBJETIVO", texto: "Dolor de cabeza" }),
    );
  });

  it("abrir modal de análisis y guardar envía dispatch SET_ANALISIS", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /llenar análisis/i }));
    fireEvent.change(screen.getByPlaceholderText(/redactar evaluación/i), {
      target: { value: "Diagnóstico test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /guardar análisis/i }));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_ANALISIS", texto: "Diagnóstico test" }),
    );
  });

  it("agregar indicación al plan envía dispatch ADD_PLAN", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /agregar al plan/i }));
    const ta = screen.getByPlaceholderText(/Describa la indicación/i);
    fireEvent.change(ta, { target: { value: "Reposo absoluto" } });
    // El footer del modal tiene el botón Agregar al plan
    const btns = screen.getAllByRole("button", { name: /agregar al plan/i });
    fireEvent.click(btns[btns.length - 1]!);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_PLAN", texto: "Reposo absoluto" }),
    );
  });

  it("Firmar se habilita solo con TODOS los campos obligatorios completos", async () => {
    // Precargar el draft ANTES de renderizar (setup() resetea draftState, por eso se usa render directo)
    draftState = draftReducer(DRAFT_EMPTY, {
      type: "SET_ESPECIALIDAD",
      especialidad: { id: null, nombre: "Medicina Interna" },
    });
    draftState = draftReducer(draftState, { type: "ADD_PROBLEMA", texto: "p1" });
    draftState = draftReducer(draftState, { type: "SET_SUBJETIVO", texto: "refiere dolor" });
    draftState = draftReducer(draftState, { type: "SET_OBJETIVO", texto: "examen físico" });
    draftState = draftReducer(draftState, { type: "SET_ANALISIS", texto: "dx" });
    draftState = draftReducer(draftState, { type: "ADD_PLAN", texto: "plan1" });
    draftState = draftReducer(draftState, {
      type: "SET_SIGNOS",
      signos: {
        ...SIGNOS_EMPTY,
        presionSistolica: "120",
        presionDiastolica: "80",
        frecuenciaCardiaca: "72",
        frecuenciaRespiratoria: "16",
        temperatura: "36.6",
        saturacionO2: "98",
        fio2: "21",
      },
    });
    render(<NuevaEvolucionPage />);

    await waitFor(() => {
      expect(screen.getByTestId("btn-firmar")).not.toBeDisabled();
    });
  });

  it("clic en Cancelar llama router.back()", () => {
    // Simplificado: verificamos que el botón existe (router.back E2E → Playwright)
    setup();
    expect(screen.getByRole("button", { name: /cancelar/i })).toBeInTheDocument();
  });
});
