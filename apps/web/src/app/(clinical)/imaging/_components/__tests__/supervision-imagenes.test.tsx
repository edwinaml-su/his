// @vitest-environment jsdom
/**
 * CC-0041 — Tests de <SupervisionImagenes> (tablero de supervisión de
 * imagenología: trazabilidad por hitos + semáforo SLA). Mock de
 * `@/lib/trpc/react`, mismo patrón que supervision.test.tsx de laboratorio.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockSupervision = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    imagingRequest: {
      supervision: { useQuery: (...args: unknown[]) => mockSupervision(...args) },
    },
  },
}));

import { SupervisionImagenes } from "../supervision-imagenes";

const DATA = {
  kpis: { total: 2, enTiempo: 0, porVencer: 1, vencidos: 1, cumplidosATiempo: 0, cumplidosTarde: 0 },
  rows: [
    {
      orderId: "o1",
      folio: "SOL-2026-0001",
      estudio: "RX TORAX PA",
      categoria: "Radiografías",
      paciente: { nombre: "Ana Cruz", expediente: "EXP-1" },
      cuenta: "CTA-1",
      atencion: "AMBULATORIO",
      prioridad: "ROUTINE",
      etapa: "SOLICITADO",
      hitos: {
        solicitadoAt: new Date("2026-09-17T08:00:00Z"),
        programadoAt: null,
        realizadoAt: null,
        informadoAt: null,
        validadoAt: null,
      },
      slaEstado: "VENCIDO",
      dueAt: new Date("2026-09-18T08:00:00Z"),
      tareaStatus: "PENDIENTE",
    },
    {
      orderId: "o2",
      folio: "SOL-2026-0002",
      estudio: "TOMOGRAFIA CRANEO",
      categoria: "Tomografías",
      paciente: { nombre: "Luis Mena", expediente: "EXP-2" },
      cuenta: null,
      atencion: "HOSPITALARIO",
      prioridad: "STAT",
      etapa: "EN_PROCESO",
      hitos: {
        solicitadoAt: new Date("2026-09-18T09:00:00Z"),
        programadoAt: new Date("2026-09-18T09:05:00Z"),
        realizadoAt: null,
        informadoAt: null,
        validadoAt: null,
      },
      slaEstado: "POR_VENCER",
      dueAt: new Date("2026-09-18T10:00:00Z"),
      tareaStatus: "EN_PROCESO",
    },
  ],
};

describe("SupervisionImagenes (CC-0041)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupervision.mockReturnValue({ data: DATA, isLoading: false, error: null });
  });

  afterEach(() => cleanup());

  it("muestra KPIs, trazabilidad por hitos y semáforo SLA (hospitalario y ambulatorio)", () => {
    render(<SupervisionImagenes />);

    expect(screen.getAllByTestId("img-sup-kpi").length).toBeGreaterThanOrEqual(6);

    const rows = screen.getAllByTestId("img-sup-row");
    expect(rows).toHaveLength(2);

    expect(within(rows[0]!).getByText("RX TORAX PA")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Ambulatorio")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Vencido")).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/SOL-2026-0001/)).toBeInTheDocument();

    expect(within(rows[1]!).getByText("Hospitalario")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("En proceso")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Por vencer")).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/Programado:/)).toBeInTheDocument();
  });

  it("pasa search y filtros al query", () => {
    render(<SupervisionImagenes />);
    fireEvent.change(screen.getByPlaceholderText(/Buscar paciente/), { target: { value: "Ana" } });
    const lastCall = mockSupervision.mock.calls.at(-1)!;
    expect(lastCall[0]).toMatchObject({ search: "Ana", incluirCompletados: true, limit: 200 });
  });

  it("muestra vacío cuando no hay estudios", () => {
    mockSupervision.mockReturnValue({
      data: { kpis: { total: 0, enTiempo: 0, porVencer: 0, vencidos: 0, cumplidosATiempo: 0, cumplidosTarde: 0 }, rows: [] },
      isLoading: false,
      error: null,
    });
    render(<SupervisionImagenes />);
    expect(screen.getByText("Sin estudios para estos filtros.")).toBeInTheDocument();
  });
});
