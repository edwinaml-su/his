// @vitest-environment jsdom
/**
 * Tests de NewPatientPage — registro de paciente con expediente (CC-0002 §13.5).
 *
 * Estrategia: mock de @/lib/trpc/react + next/navigation.
 * No necesita DB — verifica comportamiento de UI con datos simulados.
 *
 * Casos:
 *   1. Renderiza los campos básicos y el Select de tipo de documento.
 *   2. Al elegir DUI_RESP aparece la sección "Datos del responsable".
 *   3. Tras create exitoso se muestra el expediente en el panel de éxito.
 *
 * @QA — E2E (Playwright): crear paciente con DUI real muestra expediente SV{AA}{NNNNN};
 *   reutilizar el mismo DUI recupera el expediente existente sin crear duplicado.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// ─── Mocks de infraestructura Next.js ─────────────────────────────────────────

const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

// ─── Mock tRPC ─────────────────────────────────────────────────────────────────

const mockUseMutation = vi.fn();
const mockUseQuery = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    patient: {
      create: { useMutation: (...args: unknown[]) => mockUseMutation(...args) },
    },
    catalog: {
      list: { useQuery: (...args: unknown[]) => mockUseQuery(...args) },
    },
  },
}));

import NewPatientPage from "../page";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Estado base de useMutation — sin pending ni error. */
function makeMutationState(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    isPending: false,
    error: null,
    ...overrides,
  };
}

/** Catálogo de sexo biológico mínimo para que el Select se renderice. */
const catalogState = {
  data: [{ id: "sex-m", name: "Masculino" }],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("NewPatientPage", () => {
  beforeEach(() => {
    mockUseMutation.mockReturnValue(makeMutationState());
    mockUseQuery.mockReturnValue(catalogState);
    vi.clearAllMocks();
    mockUseMutation.mockReturnValue(makeMutationState());
    mockUseQuery.mockReturnValue(catalogState);
  });

  afterEach(() => {
    cleanup();
  });

  // ── 1. Renderiza campos básicos + Select de tipo de documento ─────────────

  it("renderiza los campos básicos y el Select de tipo de documento", () => {
    render(<NewPatientPage />);

    expect(screen.getByLabelText("MRN")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
    expect(screen.getByLabelText("Apellido")).toBeInTheDocument();
    expect(screen.getByText("Tipo de documento")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear paciente" })).toBeInTheDocument();
  });

  // ── 2. Al elegir DUI_RESP aparece sección "Datos del responsable" ─────────
  //
  // jsdom no implementa scrollIntoView (usado por @radix-ui/react-select al
  // abrir el listbox), por lo que no es posible interactuar con el dropdown
  // real. En su lugar se dispara el evento interno que Radix emite al
  // seleccionar un valor, usando fireEvent.change sobre el elemento nativo
  // oculto (<select>) que Radix renderiza para accesibilidad.

  it("al seleccionar DUI_RESP muestra la sección Datos del responsable", async () => {
    render(<NewPatientPage />);

    // Antes de elegir DUI_RESP, la sección no debe existir.
    expect(screen.queryByText("Datos del responsable")).not.toBeInTheDocument();

    // Radix Select renderiza un <select> nativo oculto para accesibilidad.
    // Disparar change sobre él actualiza el estado del componente igual que
    // elegir la opción en la UI real (comportamiento documentado por Radix).
    const nativeSelect = document.querySelector("select[name='documentType']")
      ?? document.querySelectorAll("select")[1]; // fallback: segundo select de la página

    if (nativeSelect) {
      fireEvent.change(nativeSelect, { target: { value: "DUI_RESP" } });
    } else {
      // Si Radix no renderiza <select> nativo, forzamos el cambio de estado
      // disparando el evento personalizado que el componente expone.
      const trigger = document.querySelector("[data-testid='documentType-trigger']")
        ?? document.querySelectorAll("[role='combobox']")[1];
      if (trigger) fireEvent.click(trigger);
    }

    // El estado condicional del form debe mostrar la sección.
    await waitFor(() => {
      expect(screen.getByText("Datos del responsable")).toBeInTheDocument();
      expect(screen.getByLabelText("Nombre del responsable")).toBeInTheDocument();
      expect(screen.getByLabelText("Parentesco")).toBeInTheDocument();
      expect(screen.getByLabelText("DUI del responsable")).toBeInTheDocument();
    });
  });

  // ── 3. Tras create exitoso se muestra el expediente ───────────────────────

  it("muestra el expediente en el panel de éxito tras create exitoso", async () => {
    // Interceptar el argumento de useMutation para capturar onSuccess.
    let capturedOnSuccess: ((p: { id: string; expediente: string }) => void) | undefined;

    mockUseMutation.mockImplementation((opts: { onSuccess?: (p: { id: string; expediente: string }) => void }) => {
      capturedOnSuccess = opts?.onSuccess;
      return makeMutationState({ mutate: vi.fn() });
    });

    render(<NewPatientPage />);

    // Invocar onSuccess simulando la respuesta del servidor.
    capturedOnSuccess?.({ id: "patient-1", expediente: "SV8400001" });

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText(/SV8400001/)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Ver expediente del paciente" }),
      ).toBeInTheDocument();
    });
  });
});
