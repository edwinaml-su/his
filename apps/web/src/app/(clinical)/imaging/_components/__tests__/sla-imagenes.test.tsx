// @vitest-environment jsdom
/**
 * CC-0041 — Tests de <SlaImagenes> (parametrización del SLA de imagenología
 * por prioridad). Mock de `@/lib/trpc/react`.
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
    imagingRequest: {
      sla: {
        list: { useQuery: (...args: unknown[]) => mockList(...args) },
        upsert: { useMutation: (opts?: unknown) => mockUpsert(opts) },
      },
    },
    useUtils: () => ({ imagingRequest: { sla: { list: { invalidate: mockInvalidate } } } }),
  },
}));

import { SlaImagenes } from "../parametrizacion/sla";

const ROWS = [
  { priority: "STAT", slaMinutes: 60, warningMinutes: 15, esDefault: true },
  { priority: "URGENT", slaMinutes: 180, warningMinutes: 20, esDefault: false },
  { priority: "ROUTINE", slaMinutes: 1440, warningMinutes: 60, esDefault: true },
];

describe("SlaImagenes (CC-0041)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockReturnValue({ data: ROWS, isLoading: false, error: null });
    mockUpsert.mockImplementation(() => ({ mutate: vi.fn(), isPending: false, error: null }));
  });

  afterEach(() => cleanup());

  it("muestra las 3 prioridades con su origen (default vs parametrizado)", () => {
    render(<SlaImagenes />);
    const urgent = screen.getByTestId("img-sla-row-URGENT");
    expect(within(urgent).getByText("Parametrizado")).toBeInTheDocument();
    expect(within(urgent).getByLabelText(/SLA en minutos para Urgente/)).toHaveValue(180);
    const stat = screen.getByTestId("img-sla-row-STAT");
    expect(within(stat).getByText("Default del sistema")).toBeInTheDocument();
  });

  it("Guardar llama imagingRequest.sla.upsert con los minutos editados", () => {
    const mutate = vi.fn();
    mockUpsert.mockImplementation(() => ({ mutate, isPending: false, error: null }));
    render(<SlaImagenes />);

    fireEvent.change(screen.getByLabelText(/SLA en minutos para STAT/), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText(/Minutos de aviso para STAT/), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("img-sla-save-STAT"));

    expect(mutate).toHaveBeenCalledWith({ priority: "STAT", slaMinutes: 45, warningMinutes: 10 });
  });
});
