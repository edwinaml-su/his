// @vitest-environment jsdom
/**
 * Tests de PreRegistroPage (CC-0008 / REQ-ECE-PRE-001).
 *
 * Estrategia: mock de @/lib/trpc/react + next/navigation. Sin DB — verifica el
 * comportamiento de UI (switch, radios, escaneo, edad derivada, panel de éxito).
 *
 * @QA — E2E (Playwright): pre-registrar con DUI real muestra expediente
 *   SV{AA}{NNNNN}; reutilizar el mismo DUI recupera el expediente existente.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

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

import PreRegistroPage from "../page";

function makeMutationState(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, error: null, ...overrides };
}

// Catálogo de sexo biológico con códigos M/F (el form filtra por code).
const catalogState = {
  data: [
    { id: "sex-m", code: "M", name: "Masculino" },
    { id: "sex-f", code: "F", name: "Femenino" },
  ],
};

describe("PreRegistroPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMutation.mockReturnValue(makeMutationState());
    mockUseQuery.mockReturnValue(catalogState);
  });

  afterEach(() => cleanup());

  // ── AC1/AC2/AC4 — título, sin MRN, tipo como radios, "Número de Documento" ──
  it("renderiza Pre-registro: sin MRN, tipo de documento como radios, número de documento", () => {
    render(<PreRegistroPage />);

    expect(screen.getByRole("heading", { name: "Pre-registro" })).toBeInTheDocument();
    expect(screen.queryByLabelText("MRN")).not.toBeInTheDocument();

    // Tipo de documento como radios: DUI, Pasaporte, Carnet de Residente (sin DNI).
    expect(screen.getByRole("radio", { name: "DUI" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Pasaporte" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Carnet de Residente" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "DNI" })).not.toBeInTheDocument();

    expect(screen.getByLabelText(/Número de Documento/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Crear preregistro/ })).toBeInTheDocument();
  });

  // ── AC3 — sexo biológico como radios (Masculino/Femenino) ──────────────────
  it("renderiza sexo biológico como radios Masculino/Femenino", () => {
    render(<PreRegistroPage />);
    expect(screen.getByRole("radio", { name: "Masculino" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Femenino" })).toBeInTheDocument();
  });

  // ── AC5 — switch OFF oculta documento y muestra aviso manual ───────────────
  it("al apagar el switch oculta el bloque de documento y muestra aviso de captura manual", async () => {
    render(<PreRegistroPage />);

    expect(screen.getByLabelText(/Número de Documento/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => {
      expect(screen.queryByLabelText(/Número de Documento/)).not.toBeInTheDocument();
      expect(screen.getByText(/Captura manual — el paciente no presenta documento/)).toBeInTheDocument();
    });
  });

  // ── AC6 — escaneo puebla campos y muestra aviso de verificación ────────────
  it("escanear puebla nombres/apellidos/fecha y muestra el aviso de datos del documento", async () => {
    render(<PreRegistroPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /Escanear documento/ }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Datos obtenidos del documento/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Primer nombre/)).toHaveValue("María");
      expect(screen.getByLabelText(/Primer apellido/)).toHaveValue("Hernández");
      expect(screen.getByLabelText(/Apellido de casada/)).toHaveValue("de Castellanos");
    });
  });

  // ── AC7 — edad derivada visible tras fijar fecha de nacimiento ─────────────
  it("muestra la edad derivada al ingresar la fecha de nacimiento", async () => {
    render(<PreRegistroPage />);

    fireEvent.change(screen.getByLabelText(/Fecha de nacimiento/), {
      target: { value: "1990-01-01" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("edad-derivada")).toHaveTextContent(/años/);
    });
  });

  // ── AC10 — panel de éxito muestra el expediente ────────────────────────────
  it("muestra el expediente en el panel de éxito tras create exitoso", async () => {
    let capturedOnSuccess: ((p: { id: string; expediente: string }) => void) | undefined;

    mockUseMutation.mockImplementation(
      (opts: { onSuccess?: (p: { id: string; expediente: string }) => void }) => {
        capturedOnSuccess = opts?.onSuccess;
        return makeMutationState();
      },
    );

    render(<PreRegistroPage />);
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
