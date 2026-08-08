// @vitest-environment jsdom
/**
 * Tests de TiposCuentaPage (CC-0015).
 *
 * Estrategia: mock de `@/lib/trpc/react` (patrón de
 * finance/price-lists — sin DB). No se ejercita la apertura del Select de
 * lista de precios dentro del Dialog (Radix + jsdom, ver nota en
 * selector-cuenta.test.tsx) — se valida render de tabla, apertura de Dialog
 * de creación y validación de campos requeridos.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockList = vi.fn();
const mockPriceListsList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDeactivate = vi.fn();
const mockReactivate = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    tipoCuenta: {
      list: { useQuery: (...args: unknown[]) => mockList(...args) },
      create: { useMutation: (opts?: unknown) => mockCreate(opts) },
      update: { useMutation: (opts?: unknown) => mockUpdate(opts) },
      deactivate: { useMutation: (opts?: unknown) => mockDeactivate(opts) },
      reactivate: { useMutation: (opts?: unknown) => mockReactivate(opts) },
    },
    servicePriceList: {
      list: { useQuery: (...args: unknown[]) => mockPriceListsList(...args) },
    },
  },
}));

import TiposCuentaPage from "../page";

const idleQuery = { data: undefined, isLoading: false, error: null, refetch: vi.fn() };

function defaultMutationImpl() {
  return { mutate: vi.fn(), isPending: false };
}

describe("TiposCuentaPage (CC-0015)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockReturnValue({
      ...idleQuery,
      data: [
        {
          id: "tc-1",
          code: "PARTICULAR",
          nombre: "Particular",
          priceListId: "pl-1",
          priceListName: "ODOO — Precios Avante Complejo Hospitalario",
          esParticular: true,
          active: true,
        },
        {
          id: "tc-2",
          code: "ISBM",
          nombre: "ISBM Seguros",
          priceListId: null,
          priceListName: null,
          esParticular: false,
          active: true,
        },
      ],
    });
    mockPriceListsList.mockReturnValue({ ...idleQuery, data: [] });
    mockCreate.mockImplementation(defaultMutationImpl);
    mockUpdate.mockImplementation(defaultMutationImpl);
    mockDeactivate.mockImplementation(defaultMutationImpl);
    mockReactivate.mockImplementation(defaultMutationImpl);
  });

  afterEach(() => cleanup());

  it("renderiza la tabla con código, nombre y lista de precios asignada", () => {
    render(<TiposCuentaPage />);

    expect(screen.getByText("PARTICULAR")).toBeInTheDocument();
    expect(screen.getByText("ODOO — Precios Avante Complejo Hospitalario")).toBeInTheDocument();
    expect(screen.getByText("ISBM")).toBeInTheDocument();
    expect(screen.getByText("Sin lista asignada")).toBeInTheDocument();
  });

  it("abre el diálogo de creación y valida campos requeridos", () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue({ mutate, isPending: false });
    render(<TiposCuentaPage />);

    fireEvent.click(screen.getByText("+ Nuevo tipo de cuenta"));
    expect(screen.getByRole("heading", { name: "Nuevo tipo de cuenta" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Crear" }));

    expect(screen.getByText("El código es requerido.")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("crea un tipo de cuenta con código y nombre válidos", () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue({ mutate, isPending: false });
    render(<TiposCuentaPage />);

    fireEvent.click(screen.getByText("+ Nuevo tipo de cuenta"));
    fireEvent.change(screen.getByLabelText("Código *"), { target: { value: "mapfre" } });
    fireEvent.change(screen.getByLabelText("Nombre *"), { target: { value: "Mapfre Seguros" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ code: "MAPFRE", nombre: "Mapfre Seguros", esParticular: false }),
    );
  });

  it("desactiva un tipo de cuenta activo", () => {
    const mutate = vi.fn();
    mockDeactivate.mockReturnValue({ mutate, isPending: false });
    render(<TiposCuentaPage />);

    const row = screen.getByText("ISBM Seguros").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Desactivar" }));

    expect(mutate).toHaveBeenCalledWith({ id: "tc-2" });
  });
});
