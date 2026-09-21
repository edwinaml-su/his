// @vitest-environment jsdom
/**
 * CC-0042 — Tests de <ParametrizacionTr> (panel de configuración del módulo,
 * solo ADMIN/DIR): tarifa base + flags por procedimiento (con badge «tenant»
 * para overrides materializados), dosis por medicamento y SLA parametrizable
 * (TrSlaConfig). Radix TabsTrigger activa en mouseDown, no en click.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastProvider, ToastViewport } from "@his/ui/components/toast";

const mockCatalogo = vi.fn();
const mockUpdateProc = vi.fn();
const mockUpdateMed = vi.fn();
const mockSlaList = vi.fn();
const mockSlaUpsert = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      respiratory: {
        tr: {
          catalogo: { list: { invalidate: mockInvalidate } },
          sla: { list: { invalidate: mockInvalidate } },
        },
      },
    }),
    respiratory: {
      tr: {
        catalogo: {
          list: { useQuery: (...a: unknown[]) => mockCatalogo(...a) },
          updateProcedimiento: { useMutation: (o?: unknown) => mockUpdateProc(o) },
          updateMedicamento: { useMutation: (o?: unknown) => mockUpdateMed(o) },
        },
        sla: {
          list: { useQuery: (...a: unknown[]) => mockSlaList(...a) },
          upsert: { useMutation: (o?: unknown) => mockSlaUpsert(o) },
        },
      },
    },
  },
}));

import { ParametrizacionTr } from "../parametrizacion-tr";

const CATALOGO = {
  procedimientos: [
    {
      id: "00000000-0000-0000-0000-00000000aa01",
      codigo: "TR-AER-01",
      nombre: "Nebulización convencional (jet)",
      categoria: "Aerosolterapia",
      seccionOrden: 2,
      subSeccion: null,
      unidadCobro: "Sesión",
      requiereConsentimiento: false,
      delegablePorProtocolo: true,
      pareoCon: null,
      tiempoEstandarMin: 20,
      tarifaBase: null,
      aerosolConfig: null,
      displayOrder: 0,
      activo: true,
      esOverrideTenant: false,
    },
    {
      id: "00000000-0000-0000-0000-00000000aa02",
      codigo: "TR-OXI-01",
      nombre: "Inicio de oxigenoterapia de bajo flujo",
      categoria: "Oxigenoterapia",
      seccionOrden: 1,
      subSeccion: null,
      unidadCobro: "Evento",
      requiereConsentimiento: false,
      delegablePorProtocolo: false,
      pareoCon: "TR-OXI-02",
      tiempoEstandarMin: null,
      tarifaBase: 18,
      aerosolConfig: null,
      displayOrder: 1,
      activo: true,
      esOverrideTenant: true,
    },
  ],
  medicamentos: [
    {
      id: "00000000-0000-0000-0000-00000000bb01",
      clave: "salbutamol",
      nombre: "Salbutamol — solución para nebulizar 5 mg/mL",
      unidadBase: "mg",
      dosisMin: 2.5,
      dosisMax: 5,
      dosisDefault: 2.5,
      altoRiesgo: false,
      precaucion: false,
      mensaje: "Vigilar taquicardia.",
      activo: true,
      esOverrideTenant: false,
    },
  ],
};

const SLA_ROWS = [
  { priority: "STAT", slaMinutes: 15, warningMinutes: 5, esDefault: true },
  { priority: "URGENT", slaMinutes: 60, warningMinutes: 15, esDefault: true },
  { priority: "ROUTINE", slaMinutes: 240, warningMinutes: 30, esDefault: false },
];

/** Radix TabsTrigger activa el tab en mouseDown (ver modulo-imagenes.test.tsx). */
function abrirTab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

function renderPanel() {
  return render(
    <ToastProvider>
      <ParametrizacionTr />
      <ToastViewport />
    </ToastProvider>,
  );
}

describe("ParametrizacionTr (CC-0042)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCatalogo.mockReturnValue({ data: CATALOGO, isLoading: false, error: null });
    mockUpdateProc.mockImplementation(() => ({ mutate: vi.fn(), isPending: false, error: null }));
    mockUpdateMed.mockImplementation(() => ({ mutate: vi.fn(), isPending: false, error: null }));
    mockSlaList.mockReturnValue({ data: SLA_ROWS, isLoading: false, error: null });
    mockSlaUpsert.mockImplementation(() => ({ mutate: vi.fn(), isPending: false, error: null }));
  });

  afterEach(() => cleanup());

  it("guarda la tarifa base y el tiempo estándar del procedimiento (fallback del price-resolver)", () => {
    const mutate = vi.fn();
    mockUpdateProc.mockImplementation(() => ({ mutate, isPending: false, error: null }));
    renderPanel();

    fireEvent.change(screen.getByLabelText("Tarifa base de TR-AER-01"), { target: { value: "12.50" } });
    fireEvent.click(screen.getByTestId("tr-cfg-save-TR-AER-01"));

    expect(mutate).toHaveBeenCalledWith({
      id: "00000000-0000-0000-0000-00000000aa01",
      tarifaBase: 12.5,
      tiempoEstandarMin: 20,
    });
  });

  it("marca con badge «tenant» los overrides materializados y los flags disparan el guardado inmediato", () => {
    const mutate = vi.fn();
    mockUpdateProc.mockImplementation(() => ({ mutate, isPending: false, error: null }));
    renderPanel();

    const filaOverride = screen.getByTestId("tr-cfg-proc-TR-OXI-01");
    expect(within(filaOverride).getByText("tenant")).toBeInTheDocument();
    const filaGlobal = screen.getByTestId("tr-cfg-proc-TR-AER-01");
    expect(within(filaGlobal).queryByText("tenant")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Activo de TR-AER-01"));
    expect(mutate).toHaveBeenCalledWith({ id: "00000000-0000-0000-0000-00000000aa01", activo: false });
  });

  it("filtra procedimientos por código", () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText(/Filtrar por código/), { target: { value: "TR-OXI" } });
    expect(screen.queryByTestId("tr-cfg-proc-TR-AER-01")).not.toBeInTheDocument();
    expect(screen.getByTestId("tr-cfg-proc-TR-OXI-01")).toBeInTheDocument();
  });

  it("pestaña Medicamentos: guarda el rango de dosis paramétrica (RN-TR-36)", () => {
    const mutate = vi.fn();
    mockUpdateMed.mockImplementation(() => ({ mutate, isPending: false, error: null }));
    renderPanel();
    abrirTab(/Medicamentos/);

    fireEvent.change(screen.getByLabelText("Dosis máxima de salbutamol"), { target: { value: "6" } });
    fireEvent.click(screen.getByTestId("tr-cfg-med-save-salbutamol"));

    expect(mutate).toHaveBeenCalledWith({
      id: "00000000-0000-0000-0000-00000000bb01",
      dosisMin: 2.5,
      dosisMax: 6,
      dosisDefault: 2.5,
    });

    fireEvent.click(screen.getByLabelText("Alto riesgo de salbutamol"));
    expect(mutate).toHaveBeenCalledWith({ id: "00000000-0000-0000-0000-00000000bb01", altoRiesgo: true });
  });

  it("pestaña SLA: muestra origen (default vs parametrizado) y hace upsert por prioridad", () => {
    const mutate = vi.fn();
    mockSlaUpsert.mockImplementation(() => ({ mutate, isPending: false, error: null }));
    renderPanel();
    abrirTab(/^SLA$/);

    expect(within(screen.getByTestId("tr-sla-row-STAT")).getByText("Default del sistema")).toBeInTheDocument();
    expect(within(screen.getByTestId("tr-sla-row-ROUTINE")).getByText("Parametrizado")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/SLA en minutos para STAT/), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText(/Minutos de aviso para STAT/), { target: { value: "8" } });
    fireEvent.click(screen.getByTestId("tr-sla-save-STAT"));

    expect(mutate).toHaveBeenCalledWith({ priority: "STAT", slaMinutes: 20, warningMinutes: 8 });
  });

  it("pestaña SLA: rechaza valores no válidos sin llamar al server", () => {
    const mutate = vi.fn();
    mockSlaUpsert.mockImplementation(() => ({ mutate, isPending: false, error: null }));
    renderPanel();
    abrirTab(/^SLA$/);

    fireEvent.change(screen.getByLabelText(/SLA en minutos para STAT/), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("tr-sla-save-STAT"));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/SLA debe ser un entero ≥ 1/)).toBeInTheDocument();
  });
});
