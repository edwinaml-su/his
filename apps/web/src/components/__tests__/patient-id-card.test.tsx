/**
 * Tests unitarios: PatientIdCard (US.F2.6.37-40)
 *
 * Cubre: validación local de GSRN, render de ficha, badges de alergias,
 *        manejo de errores, callback onIdentified / onError.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

// Extender expect de Vitest con los matchers de jest-dom
expect.extend(matchers);

// ---------------------------------------------------------------------------
// Mock del cliente tRPC — hoisted para evitar TDZ
// ---------------------------------------------------------------------------

const { mockRefetch, mockUseQuery } = vi.hoisted(() => {
  const mockRefetch = vi.fn();
  const mockUseQuery = vi.fn(() => ({
    isFetching: false,
    error: null,
    refetch: mockRefetch,
    data: null,
  }));
  return { mockRefetch, mockUseQuery };
});

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    patientIdentification: {
      lookupByGsrn: { useQuery: mockUseQuery },
    },
  },
}));

// ---------------------------------------------------------------------------
// Import después del mock
// ---------------------------------------------------------------------------

import { PatientIdCard } from "../patient-id-card";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// GSRN-18 válido (dígito verificador con algoritmo (len-1-i)%2===0 ? 3 : 1)
const VALID_GSRN = "750300000000000018";

const MOCK_PATIENT_DATA = {
  gsrn: VALID_GSRN,
  gsrnAssignedAt: new Date("2026-05-01"),
  patient: {
    id: "pat-001",
    mrn: "MRN-001",
    firstName: "Ana",
    middleName: null,
    lastName: "Garcia",
    secondLastName: null,
    birthDate: new Date("1990-03-15"),
    bloodTypeAbo: "O",
    bloodRh: "+",
    active: true,
  },
  allergies: [
    {
      id: "allergy-01",
      substanceText: "Penicilina",
      severity: "severe",
      reaction: "Anafilaxis",
      verified: true,
    },
  ],
  activeEncounter: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PatientIdCard", () => {
  const onIdentified = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({
      isFetching: false,
      error: null,
      refetch: mockRefetch,
      data: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renderiza el campo de entrada y botón de identificar", () => {
    render(
      <PatientIdCard
        onIdentified={onIdentified}
        onError={onError}
        allowManualInput
      />,
    );

    expect(screen.getByRole("textbox", { name: /gsrn/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /identificar/i })).toBeInTheDocument();
  });

  it("muestra error de validación con GSRN de longitud incorrecta", async () => {
    render(
      <PatientIdCard
        onIdentified={onIdentified}
        onError={onError}
        allowManualInput
      />,
    );

    const input = screen.getByLabelText(/gsrn de la pulsera/i);

    // Cambiamos a una longitud de 18 dígitos con checkdigit inválido para evitar
    // que el botón quede disabled (requiere length === 18)
    fireEvent.change(input, { target: { value: "750300000000000019" } }); // bad checkdigit
    fireEvent.click(screen.getByRole("button", { name: /identificar/i }));

    await waitFor(() => {
      expect(screen.getByText(/dígito verificador/i)).toBeInTheDocument();
    });
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("el botón está deshabilitado cuando GSRN tiene menos de 18 dígitos", () => {
    render(
      <PatientIdCard
        onIdentified={onIdentified}
        onError={onError}
        allowManualInput
      />,
    );

    const input = screen.getByLabelText(/gsrn de la pulsera/i);
    fireEvent.change(input, { target: { value: "123" } });

    expect(screen.getByRole("button", { name: /identificar/i })).toBeDisabled();
  });

  it("llama a refetch y onIdentified con datos correctos al identificar", async () => {
    mockRefetch.mockResolvedValue({ data: MOCK_PATIENT_DATA });

    render(
      <PatientIdCard
        onIdentified={onIdentified}
        onError={onError}
        allowManualInput
      />,
    );

    const input = screen.getByLabelText(/gsrn de la pulsera/i);
    fireEvent.change(input, { target: { value: VALID_GSRN } });
    fireEvent.click(screen.getByRole("button", { name: /identificar/i }));

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled();
      expect(onIdentified).toHaveBeenCalledWith(MOCK_PATIENT_DATA);
    });
  });

  it("muestra el nombre y MRN del paciente después de identificar", async () => {
    mockRefetch.mockResolvedValue({ data: MOCK_PATIENT_DATA });

    render(
      <PatientIdCard
        onIdentified={onIdentified}
        onError={onError}
        allowManualInput
      />,
    );

    fireEvent.change(screen.getByLabelText(/gsrn de la pulsera/i), { target: { value: VALID_GSRN } });
    fireEvent.click(screen.getByRole("button", { name: /identificar/i }));

    await waitFor(() => {
      expect(screen.getByText(/Ana/)).toBeInTheDocument();
      expect(screen.getByText(/MRN-001/)).toBeInTheDocument();
    });
  });

  it("muestra badge de alergia severa", async () => {
    mockRefetch.mockResolvedValue({ data: MOCK_PATIENT_DATA });

    render(
      <PatientIdCard
        onIdentified={onIdentified}
        onError={onError}
        allowManualInput
      />,
    );

    fireEvent.change(screen.getByLabelText(/gsrn de la pulsera/i), { target: { value: VALID_GSRN } });
    fireEvent.click(screen.getByRole("button", { name: /identificar/i }));

    await waitFor(() => {
      expect(screen.getByText("Penicilina")).toBeInTheDocument();
    });
  });

  it("llama a onError con PULSERA_INACTIVA cuando el servidor la rechaza", async () => {
    mockRefetch.mockRejectedValue({ message: "PULSERA_INACTIVA" });

    render(
      <PatientIdCard
        onIdentified={onIdentified}
        onError={onError}
        allowManualInput
      />,
    );

    fireEvent.change(screen.getByLabelText(/gsrn de la pulsera/i), { target: { value: VALID_GSRN } });
    fireEvent.click(screen.getByRole("button", { name: /identificar/i }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        "PULSERA_INACTIVA",
        expect.stringMatching(/revocada/i),
      );
    });
  });

  it("el input en modo no-manual tiene atributo readonly", () => {
    render(
      <PatientIdCard
        onIdentified={onIdentified}
        onError={onError}
        allowManualInput={false}
      />,
    );

    expect(screen.getByLabelText(/gsrn de la pulsera/i)).toHaveAttribute("readonly");
  });
});
