// @vitest-environment jsdom
/**
 * Tests de <Estudios> — CC-0013b (grid de consulta de exámenes, todos los
 * estados).
 *
 * Estrategia: mock de `@/lib/trpc/react` (mismo patrón que
 * `tablero.test.tsx`). Cubre:
 *   1. KPIs renderizados desde `lis.order.estudios`.
 *   2. Fila con paciente/expediente/cuenta/examen/centro + pill de estado.
 *   3. Click en fila dispara `cuentaModal` y abre `<SolicitudModal>`.
 *   4. Búsqueda por paciente dispara la query con `search` tras el debounce.
 *   5. "Cargar más" pagina usando el cursor de la página anterior.
 *   6. "Limpiar filtros" resetea el campo de búsqueda.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastProvider, ToastViewport } from "@his/ui/components/toast";

const mockEstudiosQuery = vi.fn();
const mockCostCentersQuery = vi.fn();
const mockCuentaModalQuery = vi.fn();
const mockEstudiosFetch = vi.fn();
const mockEstudiosInvalidate = vi.fn();
const mockUpdateItems = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    lis: {
      order: {
        estudios: { useQuery: (...args: unknown[]) => mockEstudiosQuery(...args) },
        cuentaModal: { useQuery: (...args: unknown[]) => mockCuentaModalQuery(...args) },
        updateItems: { useMutation: (opts?: unknown) => mockUpdateItems(opts) },
      },
    },
    costCenter: {
      list: { useQuery: (...args: unknown[]) => mockCostCentersQuery(...args) },
    },
    useUtils: () => ({
      lis: {
        order: {
          estudios: { invalidate: mockEstudiosInvalidate, fetch: mockEstudiosFetch },
        },
      },
    }),
  },
}));

import { Estudios } from "../estudios";

const ROW_1 = {
  itemId: "item-1",
  testId: "test-1",
  orderId: "order-1",
  examen: "GLUCOSA",
  seccion: "QUIMICA",
  paciente: { nombre: "Ana Cruz", expediente: "22290000012" },
  cuenta: "CTA00050",
  centro: "2-LAB-CLI — Laboratorio Clínico",
  medico: "Dr. Guevara",
  fecha: "2026-07-28T10:00:00.000Z",
  estado: "ORDERED",
  estadoGrupo: "CREADO" as const,
  prioridad: "ROUTINE" as const,
};

const ROW_2 = {
  ...ROW_1,
  itemId: "item-2",
  examen: "COLESTEROL",
};

const CUENTA_MODAL_DATA = {
  cuentaId: "cuenta-1",
  orderId: "order-1",
  numeroCuenta: "CTA00050",
  paciente: { nombre: "Ana Cruz", edad: 32, sexo: "F" as const },
  medico: "Dr. Guevara",
  ingreso: "2026-07-27T08:00:00.000Z",
  prioridad: "Rutina" as const,
  clinicalIndication: "Ayuno de 8 horas",
  totalExamenes: 1,
  pendientes: 1,
  enProceso: 0,
  realizados: 0,
  estado: "Activa" as const,
  examenes: [
    { itemId: "item-1", testId: "test-1", nombre: "GLUCOSA", seccion: "QUIMICA", estado: "ORDERED", notes: "" },
  ],
};

function renderEstudios() {
  return render(
    <ToastProvider>
      <Estudios />
      <ToastViewport />
    </ToastProvider>,
  );
}

describe("Estudios (CC-0013b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEstudiosQuery.mockReturnValue({
      data: { kpis: { total: 1, creados: 1, enProceso: 0, hechos: 0 }, items: [ROW_1], nextCursor: null },
      isLoading: false,
      error: null,
    });
    mockCostCentersQuery.mockReturnValue({ data: [{ id: "cc-1", code: "2-LAB-CLI", name: "Laboratorio Clínico" }] });
    mockCuentaModalQuery.mockReturnValue({ data: undefined, error: null });
    mockUpdateItems.mockImplementation((opts?: { onSuccess?: () => void }) => ({
      mutate: vi.fn(() => opts?.onSuccess?.()),
      isPending: false,
      error: null,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renderiza los KPIs desde lis.order.estudios", () => {
    renderEstudios();
    expect(screen.getByText("Total").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("Creados").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("En proceso").previousSibling).toHaveTextContent("0");
    expect(screen.getByText("Hechos").previousSibling).toHaveTextContent("0");
  });

  it("renderiza la fila con paciente, expediente, cuenta, examen, centro y pill de estado", () => {
    renderEstudios();
    expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
    expect(screen.getByText("22290000012")).toBeInTheDocument();
    expect(screen.getByText("CTA00050")).toBeInTheDocument();
    expect(screen.getByText("GLUCOSA")).toBeInTheDocument();
    expect(screen.getByText("2-LAB-CLI — Laboratorio Clínico")).toBeInTheDocument();
    expect(screen.getByText("Creado")).toBeInTheDocument();
  });

  it("click en una fila dispara cuentaModal y abre el modal Solicitud", () => {
    mockCuentaModalQuery.mockReturnValue({ data: CUENTA_MODAL_DATA, error: null });
    renderEstudios();

    fireEvent.click(screen.getByRole("button", { name: /Abrir solicitud de Ana Cruz/ }));

    expect(screen.getByRole("heading", { name: "Ana Cruz · CTA00050" })).toBeInTheDocument();
    // El último useQuery de cuentaModal se llamó con el orderId de la fila clickeada.
    const lastCall = mockCuentaModalQuery.mock.calls.at(-1)!;
    expect(lastCall[0]).toMatchObject({ orderId: "order-1" });
  });

  it("busca por paciente y dispara la query con search tras el debounce", async () => {
    vi.useFakeTimers();
    renderEstudios();

    fireEvent.change(screen.getByLabelText("Paciente"), { target: { value: "Cruz" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    const lastCall = mockEstudiosQuery.mock.calls.at(-1)!;
    expect(lastCall[0]).toMatchObject({ search: "Cruz" });
  });

  it('"Cargar más" pagina usando el cursor de la página anterior', async () => {
    mockEstudiosQuery.mockReturnValue({
      data: { kpis: { total: 2, creados: 2, enProceso: 0, hechos: 0 }, items: [ROW_1], nextCursor: "item-1" },
      isLoading: false,
      error: null,
    });
    mockEstudiosFetch.mockResolvedValue({ items: [ROW_2], nextCursor: null });

    renderEstudios();
    expect(screen.getByRole("button", { name: "Cargar más" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));

    await waitFor(() => expect(screen.getByText("COLESTEROL")).toBeInTheDocument());
    expect(mockEstudiosFetch).toHaveBeenCalledWith(expect.objectContaining({ cursor: "item-1" }));
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();
  });

  it('"Limpiar filtros" resetea el campo de búsqueda', () => {
    renderEstudios();
    const input = screen.getByLabelText("Paciente") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Cruz" } });
    expect(input.value).toBe("Cruz");

    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(input.value).toBe("");
  });
});
