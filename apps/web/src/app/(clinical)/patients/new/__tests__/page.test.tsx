// @vitest-environment jsdom
/**
 * Tests de PreRegistroPage (CC-0008 / REQ-ECE-PRE-001; CC-0008b: tipo de
 * sangre + paciente no identificado).
 *
 * Estrategia: mock de @/lib/trpc/react + next/navigation. Sin DB — verifica el
 * comportamiento de UI (switch, radios, escaneo, edad derivada, banner de
 * sangre, toggle "no identificado", panel de éxito).
 *
 * @QA — E2E (Playwright): pre-registrar con DUI real muestra expediente
 *   SV{AA}{NNNNN}; reutilizar el mismo DUI recupera el expediente existente;
 *   pre-registrar "paciente no identificado" muestra el código DDMMAAAA-NN
 *   real (asignado por el servidor) en el panel de éxito.
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

const TRAE_DOC_SWITCH = "El paciente trae documento de identidad";
const NO_ID_SWITCH = "Paciente no identificado";

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

    fireEvent.click(screen.getByRole("switch", { name: TRAE_DOC_SWITCH }));

    await waitFor(() => {
      expect(screen.queryByLabelText(/Número de Documento/)).not.toBeInTheDocument();
      expect(screen.getByText(/Captura manual — el paciente no presenta documento/)).toBeInTheDocument();
    });
  });

  // ── AC6 — escaneo puebla campos (incl. tipo de sangre) y muestra el aviso ──
  it("escanear puebla nombres/apellidos/fecha/sangre y muestra el aviso de datos del documento", async () => {
    render(<PreRegistroPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /Escanear documento/ }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Datos obtenidos del documento/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Primer nombre/)).toHaveValue("María");
      expect(screen.getByLabelText(/Primer apellido/)).toHaveValue("Hernández");
      expect(screen.getByLabelText(/Apellido de casada/)).toHaveValue("de Castellanos");
      expect(screen.getByLabelText(/Fecha de nacimiento/)).toHaveValue("14/07/1990");
      expect(screen.getByLabelText(/Tipo de sangre/)).toHaveValue("O+");
    });
  });

  // ── AC7/CC-0008b — edad derivada + máscara DD/MM/AAAA ──────────────────────
  it("aplica la máscara DD/MM/AAAA y muestra la edad derivada", async () => {
    render(<PreRegistroPage />);

    const fnac = screen.getByLabelText(/Fecha de nacimiento/);
    fireEvent.change(fnac, { target: { value: "01011990" } });

    await waitFor(() => {
      expect(fnac).toHaveValue("01/01/1990");
      expect(screen.getByTestId("edad-derivada")).toHaveTextContent(/años/);
    });
  });

  it("no calcula edad para una fecha calendario inexistente (31/02)", async () => {
    render(<PreRegistroPage />);
    const fnac = screen.getByLabelText(/Fecha de nacimiento/);
    fireEvent.change(fnac, { target: { value: "31021990" } });

    await waitFor(() => expect(fnac).toHaveValue("31/02/1990"));
    expect(screen.queryByTestId("edad-derivada")).not.toBeInTheDocument();
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

  it("muestra el unknownLabel en el panel de éxito cuando el paciente es no identificado", async () => {
    let capturedOnSuccess:
      | ((p: { id: string; expediente: string; unknownLabel: string }) => void)
      | undefined;

    mockUseMutation.mockImplementation(
      (opts: {
        onSuccess?: (p: { id: string; expediente: string; unknownLabel: string }) => void;
      }) => {
        capturedOnSuccess = opts?.onSuccess;
        return makeMutationState();
      },
    );

    render(<PreRegistroPage />);
    capturedOnSuccess?.({ id: "nn-1", expediente: "SV2600001", unknownLabel: "27072026-01" });

    await waitFor(() => {
      expect(screen.getByText(/27072026-01/)).toBeInTheDocument();
    });
  });

  // ── CC-0008b — banner permanente de tipo de sangre (4 estados) ─────────────
  describe("banner de tipo de sangre", () => {
    it("estado inicial (trae ON, sin sangre seleccionada): 'Sin registrar'", () => {
      render(<PreRegistroPage />);
      const banner = screen.getAllByRole("status")[0]!;
      expect(banner).toHaveTextContent("Tipo de sangre: Sin registrar");
    });

    it("trae ON + sangre concreta seleccionada → banner OK con el valor", async () => {
      render(<PreRegistroPage />);
      fireEvent.change(screen.getByLabelText(/Tipo de sangre/), { target: { value: "A+" } });

      await waitFor(() => {
        const banner = screen.getAllByRole("status")[0]!;
        expect(banner).toHaveTextContent("Tipo de sangre: A+");
      });
    });

    it("trae ON + sangre='NR' (seleccionado manualmente) → 'No reportado en documento de identificación'", async () => {
      render(<PreRegistroPage />);
      fireEvent.change(screen.getByLabelText(/Tipo de sangre/), { target: { value: "NR" } });

      await waitFor(() => {
        const banner = screen.getAllByRole("status")[0]!;
        expect(banner).toHaveTextContent("No reportado en documento de identificación");
      });
    });

    it("trae OFF → sangre se fuerza a NR, deshabilitada, banner 'Sin documento'", async () => {
      render(<PreRegistroPage />);
      fireEvent.click(screen.getByRole("switch", { name: TRAE_DOC_SWITCH }));

      await waitFor(() => {
        const sangreSelect = screen.getByLabelText(/Tipo de sangre/);
        expect(sangreSelect).toBeDisabled();
        expect(sangreSelect).toHaveValue("NR");
        const banner = screen.getAllByRole("status")[0]!;
        expect(banner).toHaveTextContent("Sin documento — tipo de sangre no identificado");
      });
    });

    it("paciente no identificado ON → banner 'Paciente no identificado — tipo de sangre desconocido'", async () => {
      render(<PreRegistroPage />);
      fireEvent.click(screen.getByRole("switch", { name: NO_ID_SWITCH }));

      await waitFor(() => {
        const banner = screen.getAllByRole("status")[0]!;
        expect(banner).toHaveTextContent("Paciente no identificado — tipo de sangre desconocido");
      });
    });
  });

  // ── CC-0008b — toggle "Paciente no identificado" ────────────────────────────
  describe("paciente no identificado", () => {
    it("oculta documento/nombres/apellidos/fecha, apaga y deshabilita 'trae documento'", async () => {
      render(<PreRegistroPage />);

      fireEvent.click(screen.getByRole("switch", { name: NO_ID_SWITCH }));

      await waitFor(() => {
        expect(screen.queryByLabelText(/Número de Documento/)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/Primer nombre/)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/Primer apellido/)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/Fecha de nacimiento/)).not.toBeInTheDocument();

        const traeSwitch = screen.getByRole("switch", { name: TRAE_DOC_SWITCH });
        expect(traeSwitch).toBeDisabled();
        expect(traeSwitch).toHaveAttribute("aria-checked", "false");

        expect(
          screen.getByText("Nombre asignado (paciente no identificado)"),
        ).toBeInTheDocument();
      });
    });

    it("el nombre temporal invita a seleccionar sexo biológico cuando aún no se elige", async () => {
      render(<PreRegistroPage />);
      fireEvent.click(screen.getByRole("switch", { name: NO_ID_SWITCH }));

      await waitFor(() => {
        expect(
          screen.getByText(/Paciente no identificado \d{8}-01 — seleccione sexo biológico/),
        ).toBeInTheDocument();
      });
    });

    it("el nombre temporal se completa según el sexo biológico seleccionado (F → femenino)", async () => {
      render(<PreRegistroPage />);
      fireEvent.click(screen.getByRole("switch", { name: NO_ID_SWITCH }));
      fireEvent.click(screen.getByRole("radio", { name: "Femenino" }));

      await waitFor(() => {
        expect(
          screen.getByText(/Paciente femenino no identificado \d{8}-01/),
        ).toBeInTheDocument();
      });
    });

    it("el nombre temporal se completa según el sexo biológico seleccionado (M → masculino)", async () => {
      render(<PreRegistroPage />);
      fireEvent.click(screen.getByRole("switch", { name: NO_ID_SWITCH }));
      fireEvent.click(screen.getByRole("radio", { name: "Masculino" }));

      await waitFor(() => {
        expect(
          screen.getByText(/Paciente masculino no identificado \d{8}-01/),
        ).toBeInTheDocument();
      });
    });

    it("al desactivarse 'trae documento' sigue apagado (igual que el mockup) — reactivarlo manualmente re-habilita y limpia sangre", async () => {
      render(<PreRegistroPage />);
      const noIdSwitch = screen.getByRole("switch", { name: NO_ID_SWITCH });

      fireEvent.click(noIdSwitch);
      await waitFor(() => expect(screen.getByLabelText(/Tipo de sangre/)).toBeDisabled());

      // Apagar "no identificado" NO reactiva "trae documento" (mockup toggleNoId():
      // trae.disabled=false, pero trae.checked queda como estaba → false).
      fireEvent.click(noIdSwitch);
      await waitFor(() => {
        expect(screen.getByRole("switch", { name: TRAE_DOC_SWITCH })).not.toBeDisabled();
        expect(screen.getByLabelText(/Tipo de sangre/)).toBeDisabled();
      });

      // El usuario reactiva "trae documento" manualmente → sangre se re-habilita y limpia.
      fireEvent.click(screen.getByRole("switch", { name: TRAE_DOC_SWITCH }));
      await waitFor(() => {
        const sangreSelect = screen.getByLabelText(/Tipo de sangre/);
        expect(sangreSelect).not.toBeDisabled();
        expect(sangreSelect).toHaveValue("");
      });
    });

    it("envía isUnknown=true, sin firstName/lastName/birthDate, con bloodTypeNotReported", async () => {
      const mutate = vi.fn();
      mockUseMutation.mockReturnValue(makeMutationState({ mutate }));

      render(<PreRegistroPage />);
      fireEvent.click(screen.getByRole("switch", { name: NO_ID_SWITCH }));
      fireEvent.click(screen.getByRole("radio", { name: "Femenino" }));
      fireEvent.click(screen.getByRole("button", { name: /Crear preregistro/ }));

      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
      const payload = mutate.mock.calls[0]![0];
      expect(payload).toMatchObject({
        isUnknown: true,
        traeDocumento: false,
        firstName: undefined,
        lastName: undefined,
        birthDate: undefined,
        bloodTypeNotReported: true,
      });
    });
  });

  // ── CC-0008b — mapeo del <select> de sangre al payload (Du / NR) ───────────
  describe("payload de tipo de sangre", () => {
    function fillRequiredFields() {
      fireEvent.change(screen.getByLabelText(/Número de Documento/), {
        target: { value: "04829175-3" },
      });
      fireEvent.change(screen.getByLabelText(/Primer nombre/), { target: { value: "Ana" } });
      fireEvent.change(screen.getByLabelText(/Primer apellido/), { target: { value: "Pérez" } });
      fireEvent.click(screen.getByRole("radio", { name: "Femenino" }));
      fireEvent.change(screen.getByLabelText(/Fecha de nacimiento/), {
        target: { value: "01011990" },
      });
    }

    it("'A Du' → bloodTypeAbo='A', bloodRh='Du'", async () => {
      const mutate = vi.fn();
      mockUseMutation.mockReturnValue(makeMutationState({ mutate }));

      render(<PreRegistroPage />);
      fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/Tipo de sangre/), { target: { value: "A Du" } });
      fireEvent.click(screen.getByRole("button", { name: /Crear preregistro/ }));

      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
      expect(mutate.mock.calls[0]![0]).toMatchObject({ bloodTypeAbo: "A", bloodRh: "Du" });
    });

    it("'AB-' → bloodTypeAbo='AB', bloodRh='-'", async () => {
      const mutate = vi.fn();
      mockUseMutation.mockReturnValue(makeMutationState({ mutate }));

      render(<PreRegistroPage />);
      fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/Tipo de sangre/), { target: { value: "AB-" } });
      fireEvent.click(screen.getByRole("button", { name: /Crear preregistro/ }));

      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
      expect(mutate.mock.calls[0]![0]).toMatchObject({ bloodTypeAbo: "AB", bloodRh: "-" });
    });

    it("'NR' → bloodTypeNotReported=true, sin bloodTypeAbo/bloodRh", async () => {
      const mutate = vi.fn();
      mockUseMutation.mockReturnValue(makeMutationState({ mutate }));

      render(<PreRegistroPage />);
      fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/Tipo de sangre/), { target: { value: "NR" } });
      fireEvent.click(screen.getByRole("button", { name: /Crear preregistro/ }));

      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
      const payload = mutate.mock.calls[0]![0];
      expect(payload).toMatchObject({ bloodTypeNotReported: true });
      expect(payload.bloodTypeAbo).toBeUndefined();
      expect(payload.bloodRh).toBeUndefined();
    });

    it("sin seleccionar tipo de sangre → bloquea el submit con error de validación", async () => {
      const mutate = vi.fn();
      mockUseMutation.mockReturnValue(makeMutationState({ mutate }));

      render(<PreRegistroPage />);
      fillRequiredFields();
      fireEvent.click(screen.getByRole("button", { name: /Crear preregistro/ }));

      await waitFor(() => {
        expect(screen.getByText("Selecciona el tipo de sangre.")).toBeInTheDocument();
      });
      expect(mutate).not.toHaveBeenCalled();
    });
  });
});
