// @vitest-environment jsdom
/**
 * Tests de <SlaTab> — extensión CC-0040 (parametrización de SLA de
 * laboratorio por prioridad). Mock de `@/lib/trpc/react`.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockList = vi.fn();
const mockUpsert = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    lis: {
      sla: {
        list: { useQuery: (...args: unknown[]) => mockList(...args) },
        upsert: { useMutation: (opts?: unknown) => mockUpsert(opts) },
      },
    },
    useUtils: () => ({ lis: { sla: { list: { invalidate: mockInvalidate } } } }),
  },
}));

import { SlaTab } from "../lab-mant-sla";

const ROWS = [
  { priority: "STAT", slaMinutes: 60, warningMinutes: 15, esDefault: true },
  { priority: "URGENT", slaMinutes: 90, warningMinutes: 20, esDefault: false },
  { priority: "ROUTINE", slaMinutes: 1440, warningMinutes: 60, esDefault: true },
];

describe("SlaTab (extensión CC-0040)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockReturnValue({ data: ROWS, isLoading: false, error: null });
    mockUpsert.mockImplementation(() => ({ mutate: vi.fn(), isPending: false, error: null }));
  });

  afterEach(() => cleanup());

  it("muestra las 3 prioridades con su origen (default vs parametrizado)", () => {
    render(<SlaTab />);

    const stat = screen.getByTestId("lab-sla-row-STAT");
    expect(within(stat).getByText("Default del sistema")).toBeInTheDocument();
    expect(within(stat).getByLabelText(/SLA en minutos para STAT/)).toHaveValue(60);

    const urgent = screen.getByTestId("lab-sla-row-URGENT");
    expect(within(urgent).getByText("Parametrizado")).toBeInTheDocument();
    expect(within(urgent).getByLabelText(/SLA en minutos para Urgente/)).toHaveValue(90);
  });

  it("Guardar llama lis.sla.upsert con los minutos editados", () => {
    const mutate = vi.fn();
    mockUpsert.mockImplementation(() => ({ mutate, isPending: false, error: null }));
    render(<SlaTab />);

    fireEvent.change(screen.getByLabelText(/SLA en minutos para STAT/), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText(/Minutos de aviso para STAT/), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("lab-sla-save-STAT"));

    expect(mutate).toHaveBeenCalledWith({ priority: "STAT", slaMinutes: 45, warningMinutes: 10 });
  });
});
