// @vitest-environment jsdom
/**
 * CC-0042 — Tests de <WorklistTr> (worklist / supervisión del área):
 * KPIs + semáforo SLA, cierre «Ejecutar» ⇒ mutation + toast con el cargo
 * devengado (RN-TR-24) o PENDIENTE DE TARIFA, y cierre «No ejecutada» ⇒
 * causa codificada del Anexo B sin cargo.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastProvider, ToastViewport } from "@his/ui/components/toast";
import { TR_CAUSAS_NO_EJECUCION } from "@his/contracts";

const mockSupervision = vi.fn();
const mockEjecutar = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    useUtils: () => ({ respiratory: { tr: { supervision: { invalidate: mockInvalidate } } } }),
    respiratory: {
      tr: {
        supervision: { useQuery: (...a: unknown[]) => mockSupervision(...a) },
        sesion: { ejecutar: { useMutation: (o?: unknown) => mockEjecutar(o) } },
      },
    },
  },
}));

import { WorklistTr } from "../worklist-tr";

function row(over: Record<string, unknown> = {}) {
  return {
    itemId: "i1",
    codigo: "TR-AER-01",
    procedimiento: "Nebulización convencional (jet)",
    paciente: { nombre: "Ana Cruz", expediente: "222-26-00001" },
    cuenta: "CTA-9",
    atencion: "HOSPITALARIO",
    prioridad: "STAT",
    dx: "CA22.0 — EPOC exacerbada",
    estado: "PROGRAMADA",
    slaEstado: "POR_VENCER",
    dueAt: new Date("2026-09-18T15:00:00Z"),
    medicamento: { nombre: "Salbutamol", dosis: 2.5, unidad: "mg", frecuencia: "Cada 6 horas" },
    causaNoEjecucion: null,
    cargoId: null,
    ...over,
  };
}

const DATA = {
  kpis: { programadas: 2, ejecutadas: 1, noEjecutadas: 1, porVencer: 1, vencidas: 1 },
  rows: [
    row(),
    row({
      itemId: "i2",
      codigo: "TR-OXI-01",
      procedimiento: "Inicio de oxigenoterapia de bajo flujo",
      paciente: { nombre: "Luis Mena", expediente: "222-26-00002" },
      atencion: "AMBULATORIO",
      prioridad: "ROUTINE",
      slaEstado: "VENCIDO",
      medicamento: null,
    }),
    row({
      itemId: "i3",
      codigo: "TR-FIS-01",
      procedimiento: "Fisioterapia torácica convencional",
      estado: "NO_EJECUTADA",
      slaEstado: "CUMPLIDO_A_TIEMPO",
      causaNoEjecucion: "Paciente en procedimiento fuera de la unidad",
      medicamento: null,
    }),
  ],
};

/** Cierra el ciclo del mutation: mutate() dispara onSuccess con `resultado`. */
function stubEjecutar(resultado: { cargoStatus: string; unitPrice: number | null }) {
  const mutateSpy = vi.fn();
  mockEjecutar.mockImplementation((opts?: unknown) => {
    const o = opts as { onSuccess?: (r: unknown, v: unknown) => void };
    return {
      mutate: (vars: unknown) => {
        mutateSpy(vars);
        o.onSuccess?.(resultado, vars);
      },
      isPending: false,
      error: null,
    };
  });
  return mutateSpy;
}

function renderWorklist() {
  return render(
    <ToastProvider>
      <WorklistTr />
      <ToastViewport />
    </ToastProvider>,
  );
}

describe("WorklistTr (CC-0042)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupervision.mockReturnValue({ data: DATA, isLoading: false, error: null });
    mockEjecutar.mockImplementation(() => ({ mutate: vi.fn(), isPending: false, error: null }));
  });

  afterEach(() => cleanup());

  it("muestra KPIs con etiqueta correcta y tarjetas con semáforo SLA / estado final", () => {
    renderWorklist();

    const kpis = screen.getAllByTestId("tr-kpi").map((k) => k.textContent);
    expect(kpis).toEqual([
      "2 Programadas",
      "1 Ejecutadas",
      "1 No ejecutadas",
      "1 Por vencer",
      "1 Vencidas",
    ]);

    const tasks = screen.getAllByTestId("tr-task");
    expect(tasks).toHaveLength(3);
    // Abiertas: pill = semáforo SLA; cerradas: pill = estado + causa visible.
    expect(within(tasks[0]!).getByText("Por vencer")).toBeInTheDocument();
    expect(within(tasks[0]!).getByText(/Salbutamol · 2.5 mg · Cada 6 horas/)).toBeInTheDocument();
    expect(within(tasks[1]!).getByText("Vencida")).toBeInTheDocument();
    expect(within(tasks[1]!).getByText(/Ambulatorio/)).toBeInTheDocument();
    expect(within(tasks[2]!).getByText("No ejecutada")).toBeInTheDocument();
    expect(within(tasks[2]!).getByText(/Causa: Paciente en procedimiento fuera de la unidad/)).toBeInTheDocument();
    expect(within(tasks[2]!).queryByRole("button", { name: "Ejecutar" })).not.toBeInTheDocument();
  });

  it("Ejecutar ⇒ mutation EJECUTADA y toast con el cargo devengado (RN-TR-24)", () => {
    const mutateSpy = stubEjecutar({ cargoStatus: "VIGENTE", unitPrice: 12.5 });
    renderWorklist();

    fireEvent.click(screen.getByTestId("tr-ejecutar-TR-AER-01"));
    expect(screen.getByText("Firmar sesión ejecutada")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Observaciones"), { target: { value: "Sesión tolerada" } });
    fireEvent.click(screen.getByTestId("tr-confirmar-cierre"));

    expect(mutateSpy).toHaveBeenCalledWith({
      itemId: "i1",
      resultado: "EJECUTADA",
      observaciones: "Sesión tolerada",
    });
    expect(screen.getByText("Cargo de $12.50 devengado en la cuenta.")).toBeInTheDocument();
  });

  it("Ejecutar sin tarifa resoluble ⇒ toast PENDIENTE DE TARIFA (nunca $0)", () => {
    stubEjecutar({ cargoStatus: "PENDIENTE_TARIFA", unitPrice: null });
    renderWorklist();

    fireEvent.click(screen.getByTestId("tr-ejecutar-TR-AER-01"));
    fireEvent.click(screen.getByTestId("tr-confirmar-cierre"));

    expect(
      screen.getByText(/PENDIENTE DE TARIFA — parametrice el precio del procedimiento/),
    ).toBeInTheDocument();
  });

  it("No ejecutada ⇒ mutation con causa codificada del Anexo B, sin cargo", () => {
    const mutateSpy = stubEjecutar({ cargoStatus: "VIGENTE", unitPrice: 0 });
    renderWorklist();

    const primera = screen.getAllByTestId("tr-task")[0]!;
    fireEvent.click(within(primera).getByRole("button", { name: "No ejecutada" }));
    expect(screen.getByText("Registrar no ejecución")).toBeInTheDocument();
    expect(screen.getByText(/Causa codificada \(Anexo B\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tr-confirmar-cierre"));

    expect(mutateSpy).toHaveBeenCalledWith({
      itemId: "i1",
      resultado: "NO_EJECUTADA",
      causaNoEjecucion: TR_CAUSAS_NO_EJECUCION[0],
    });
    expect(screen.getByText("Sesión cerrada como no ejecutada — sin cargo generado.")).toBeInTheDocument();
  });

  it("pasa search y filtros al query de supervisión", () => {
    renderWorklist();
    fireEvent.change(screen.getByPlaceholderText(/Buscar paciente/), { target: { value: "Ana" } });
    const lastCall = mockSupervision.mock.calls.at(-1)!;
    expect(lastCall[0]).toMatchObject({ search: "Ana", incluirCompletados: true, limit: 200 });
  });

  it("muestra vacío cuando no hay sesiones", () => {
    mockSupervision.mockReturnValue({
      data: { kpis: { programadas: 0, ejecutadas: 0, noEjecutadas: 0, porVencer: 0, vencidas: 0 }, rows: [] },
      isLoading: false,
      error: null,
    });
    renderWorklist();
    expect(screen.getByText("Sin sesiones para estos filtros.")).toBeInTheDocument();
  });
});
