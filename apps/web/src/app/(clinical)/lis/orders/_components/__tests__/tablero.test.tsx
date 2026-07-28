// @vitest-environment jsdom
/**
 * Tests de <Tablero> — CC-0013 (tablero de exámenes por cuenta).
 *
 * Estrategia: mock de `@/lib/trpc/react` (mismo patrón que
 * catalogs/laboratorio/__tests__/page.test.tsx). Cubre:
 *   1. KPIs renderizados desde `lis.order.tableroPorCuenta`.
 *   2. Fila de cuenta con pills de prioridad/estado.
 *   3. "Abrir" abre el modal Solicitud con los exámenes de la cuenta.
 *   4. "Guardar cambios" llama `lis.order.updateItems` con el orderId de la cuenta.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastProvider, ToastViewport } from "@his/ui/components/toast";

const mockTableroQuery = vi.fn();
const mockUpdateItems = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    lis: {
      order: {
        tableroPorCuenta: { useQuery: (...args: unknown[]) => mockTableroQuery(...args) },
        updateItems: { useMutation: (opts?: unknown) => mockUpdateItems(opts) },
      },
    },
    useUtils: () => ({
      lis: { order: { tableroPorCuenta: { invalidate: mockInvalidate } } },
    }),
  },
}));

import { Tablero } from "../tablero";

const CUENTA_URGENTE = {
  cuentaId: "cuenta-1",
  orderId: "order-1",
  numeroCuenta: "CTA00099",
  paciente: { nombre: "Jose Melendez", edad: 67, sexo: "M" },
  medico: "Dra. Cáceres",
  ingreso: "2026-07-26T08:00:00.000Z",
  prioridad: "Urgente" as const,
  clinicalIndication: "Dolor torácico",
  totalExamenes: 2,
  pendientes: 1,
  enProceso: 1,
  realizados: 0,
  estado: "Activa" as const,
  examenes: [
    { itemId: "item-1", testId: "test-1", nombre: "TROPONINA I", seccion: "PRUEBAS ESPECIALES", estado: "ORDERED", notes: "" },
    { itemId: "item-2", testId: "test-2", nombre: "CK-MB", seccion: "PRUEBAS ESPECIALES", estado: "IN_PROCESS", notes: "" },
  ],
};

const TABLERO_DATA = {
  kpis: { cuentasActivas: 1, examenesTotales: 2, examenesPendientes: 1, solicitudesUrgentes: 1 },
  cuentas: [CUENTA_URGENTE],
};

function renderTablero() {
  return render(
    <ToastProvider>
      <Tablero />
      <ToastViewport />
    </ToastProvider>,
  );
}

describe("Tablero (CC-0013)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTableroQuery.mockReturnValue({ data: TABLERO_DATA, isLoading: false, error: null });
    mockUpdateItems.mockImplementation((opts?: { onSuccess?: () => void }) => ({
      mutate: vi.fn(() => opts?.onSuccess?.()),
      isPending: false,
      error: null,
    }));
  });

  afterEach(() => cleanup());

  it("renderiza los KPIs desde tableroPorCuenta", () => {
    renderTablero();
    expect(screen.getByText("Cuentas activas").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("Exámenes totales").previousSibling).toHaveTextContent("2");
    expect(screen.getByText("Exámenes pendientes").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("Solicitudes urgentes").previousSibling).toHaveTextContent("1");
  });

  it("renderiza la fila de la cuenta con prioridad Urgente", () => {
    renderTablero();
    expect(screen.getByText("CTA00099")).toBeInTheDocument();
    expect(screen.getByText("Jose Melendez")).toBeInTheDocument();
    expect(screen.getByText("Urgente")).toBeInTheDocument();
  });

  it("Abrir abre el modal Solicitud con los exámenes de la cuenta", () => {
    renderTablero();
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));

    expect(screen.getByRole("heading", { name: "Jose Melendez · CTA00099" })).toBeInTheDocument();
    expect(screen.getByText("TROPONINA I")).toBeInTheDocument();
    expect(screen.getByText("CK-MB")).toBeInTheDocument();
  });

  it("Guardar cambios llama updateItems con el orderId de la cuenta", () => {
    const mutate = vi.fn();
    mockUpdateItems.mockImplementation((opts?: { onSuccess?: () => void }) => ({
      mutate: (input: unknown) => {
        mutate(input);
        opts?.onSuccess?.();
      },
      isPending: false,
      error: null,
    }));
    renderTablero();

    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    fireEvent.click(screen.getByRole("button", { name: "💾 Guardar cambios" }));

    expect(mutate).toHaveBeenCalledWith({
      orderId: "order-1",
      clinicalIndication: "Dolor torácico",
      items: [
        { itemId: "item-1", status: "ORDERED", notes: undefined },
        { itemId: "item-2", status: "IN_PROCESS", notes: undefined },
      ],
    });
    // Tras guardar: modal cerrado + toast de confirmación.
    expect(screen.queryByRole("heading", { name: "Jose Melendez · CTA00099" })).not.toBeInTheDocument();
    expect(mockInvalidate).toHaveBeenCalled();
  });
});
