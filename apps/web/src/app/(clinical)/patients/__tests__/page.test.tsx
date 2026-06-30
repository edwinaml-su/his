// @vitest-environment jsdom
/**
 * Tests de PatientsPage (worklist de cobro /patients).
 *
 * Estrategia: mock de @/lib/trpc/react. Sin DB — verifica el grid, las vistas
 * (pendientes/cerradas), los filtros y el badge "Egresado".
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockWorklistQuery = vi.fn();
const mockCatalogQuery = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    patientAccount: {
      listarWorklist: { useQuery: (...args: unknown[]) => mockWorklistQuery(...args) },
    },
    catalog: {
      list: { useQuery: (...args: unknown[]) => mockCatalogQuery(...args) },
    },
  },
}));

import PatientsPage from "../page";

const rows = [
  {
    patientId: "p1",
    expediente: "SV2600001",
    mrn: "MRN-1",
    nombreCompleto: "María Hernández",
    documentNumber: "01234567-8",
    sexo: "Femenino",
    edad: 36,
    saldo: 125.5,
    facturasPendientes: 2,
    areaUnidad: "Hospitalización",
    areaCama: "H-12",
    egresado: false,
  },
  {
    patientId: "p2",
    expediente: "SV2600002",
    mrn: "MRN-2",
    nombreCompleto: "Juan Pérez",
    documentNumber: "08765432-1",
    sexo: "Masculino",
    edad: 50,
    saldo: 80,
    facturasPendientes: 1,
    areaUnidad: null,
    areaCama: null,
    egresado: true,
  },
];

describe("PatientsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorklistQuery.mockReturnValue({ data: rows, isLoading: false, error: null });
    mockCatalogQuery.mockReturnValue({
      data: [
        { id: "sex-m", code: "M", name: "Masculino" },
        { id: "sex-f", code: "F", name: "Femenino" },
      ],
    });
  });

  afterEach(() => cleanup());

  it("renderiza el grid con expediente, paciente, saldo y área", () => {
    render(<PatientsPage />);

    expect(screen.getByRole("heading", { name: "Pacientes" })).toBeInTheDocument();
    expect(screen.getByText("SV2600001")).toBeInTheDocument();
    expect(screen.getByText("María Hernández")).toBeInTheDocument();
    expect(screen.getByText("Hospitalización · H-12")).toBeInTheDocument();
  });

  it("muestra el badge Egresado cuando no hay encuentro abierto", () => {
    render(<PatientsPage />);
    expect(screen.getByText("Egresado")).toBeInTheDocument();
  });

  it("arranca en la vista 'pendientes' y permite cambiar a 'cerradas'", () => {
    render(<PatientsPage />);

    const tabPendientes = screen.getByRole("tab", { name: "Pendientes de cobro" });
    const tabCerradas = screen.getByRole("tab", { name: "Cerradas (Históricas)" });
    expect(tabPendientes).toHaveAttribute("aria-selected", "true");

    fireEvent.click(tabCerradas);

    expect(mockWorklistQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ vista: "cerradas" }),
    );
  });

  it("pasa los filtros al procedure (sexo)", () => {
    render(<PatientsPage />);
    fireEvent.change(screen.getByLabelText("Sexo"), { target: { value: "sex-f" } });

    expect(mockWorklistQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ biologicalSexId: "sex-f" }),
    );
  });

  it("muestra estado vacío cuando no hay filas", () => {
    mockWorklistQuery.mockReturnValue({ data: [], isLoading: false, error: null });
    render(<PatientsPage />);
    expect(
      screen.getByText(/No hay expedientes con cuentas pendientes de cobro/),
    ).toBeInTheDocument();
  });
});
