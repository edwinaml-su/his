// @vitest-environment jsdom
/**
 * Tests de <Supervision> — extensión CC-0040 (tablero de supervisión de
 * laboratorio: trazabilidad + semáforo SLA). Mock de `@/lib/trpc/react`,
 * mismo patrón que tablero.test.tsx / estudios.test.tsx.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockSupervision = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    lis: {
      order: { supervision: { useQuery: (...args: unknown[]) => mockSupervision(...args) } },
    },
  },
}));

import { Supervision } from "../supervision";

const DATA = {
  kpis: { total: 2, enTiempo: 0, porVencer: 0, vencidos: 1, cumplidosATiempo: 1, cumplidosTarde: 0 },
  rows: [
    {
      itemId: "i1",
      orderId: "o1",
      examen: "GLUCOSA",
      seccion: "QUIMICA",
      paciente: { nombre: "Ana Cruz", expediente: "EXP-1" },
      cuenta: "CTA-1",
      atencion: "AMBULATORIO",
      prioridad: "ROUTINE",
      etapa: "SOLICITADO",
      hitos: {
        solicitadoAt: new Date("2026-09-17T08:00:00Z"),
        muestraAt: null,
        resultadoAt: null,
        validadoAt: null,
      },
      slaEstado: "VENCIDO",
      dueAt: new Date("2026-09-18T08:00:00Z"),
      tareaStatus: "PENDIENTE",
    },
    {
      itemId: "i2",
      orderId: "o2",
      examen: "HEMOGRAMA",
      seccion: "HEMATOLOGIA",
      paciente: { nombre: "Luis Mena", expediente: "EXP-2" },
      cuenta: null,
      atencion: "HOSPITALARIO",
      prioridad: "STAT",
      etapa: "RESULTADO",
      hitos: {
        solicitadoAt: new Date("2026-09-18T09:00:00Z"),
        muestraAt: new Date("2026-09-18T09:10:00Z"),
        resultadoAt: new Date("2026-09-18T09:40:00Z"),
        validadoAt: null,
      },
      slaEstado: "CUMPLIDO_A_TIEMPO",
      dueAt: new Date("2026-09-18T10:00:00Z"),
      tareaStatus: "CUMPLIDA",
    },
  ],
};

describe("Supervision (extensión CC-0040)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupervision.mockReturnValue({ data: DATA, isLoading: false, error: null });
  });

  afterEach(() => cleanup());

  it("muestra KPIs, trazabilidad y semáforo SLA por examen (hospitalario y ambulatorio)", () => {
    render(<Supervision />);

    const kpis = screen.getAllByTestId("lab-sup-kpi");
    expect(kpis.map((k) => k.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Vencidos"), expect.stringContaining("Exámenes")]),
    );

    const rows = screen.getAllByTestId("lab-sup-row");
    expect(rows).toHaveLength(2);

    // Row 1: ambulatorio, solicitado, vencido.
    expect(within(rows[0]!).getByText("GLUCOSA")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Ambulatorio")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Solicitado")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Vencido")).toBeInTheDocument();

    // Row 2: hospitalario con hitos de toma y resultado + cumplido a tiempo.
    expect(within(rows[1]!).getByText("Hospitalario")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Cumplido a tiempo")).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/Muestra:/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/Resultado:/)).toBeInTheDocument();
  });

  it("pasa search y filtro de semáforo al query", () => {
    render(<Supervision />);

    fireEvent.change(screen.getByPlaceholderText(/Buscar paciente/), { target: { value: "Ana" } });

    const lastCall = mockSupervision.mock.calls.at(-1)!;
    expect(lastCall[0]).toMatchObject({ search: "Ana", incluirCompletados: true, limit: 200 });
  });

  it("muestra vacío cuando no hay exámenes", () => {
    mockSupervision.mockReturnValue({
      data: { kpis: { total: 0, enTiempo: 0, porVencer: 0, vencidos: 0, cumplidosATiempo: 0, cumplidosTarde: 0 }, rows: [] },
      isLoading: false,
      error: null,
    });
    render(<Supervision />);
    expect(screen.getByText("Sin exámenes para estos filtros.")).toBeInTheDocument();
  });
});
