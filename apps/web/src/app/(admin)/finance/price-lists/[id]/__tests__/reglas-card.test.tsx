// @vitest-environment jsdom
/**
 * CC-0021 — Tests de la tarjeta de reglas de precio.
 *
 * Estrategia: mock de `@/lib/trpc/react` (mismo patrón que finance/tipos-cuenta,
 * sin BD). Se valida el render de las dos reglas REALES de Odoo (el markup de
 * categoría INSUMOS y el margen fijo de IMAGENES), el estado vacío y el
 * probador de precios.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockListRules = vi.fn();
const mockListCategories = vi.fn();
const mockListLists = vi.fn();
const mockSimular = vi.fn();
const mockSetRuleActive = vi.fn();
const mockAddRule = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    servicePriceList: {
      listRules: { useQuery: (...args: unknown[]) => mockListRules(...args) },
      listCategories: { useQuery: (...args: unknown[]) => mockListCategories(...args) },
      list: { useQuery: (...args: unknown[]) => mockListLists(...args) },
      simularPrecio: { useQuery: (...args: unknown[]) => mockSimular(...args) },
      setRuleActive: { useMutation: (opts?: unknown) => mockSetRuleActive(opts) },
      addRule: { useMutation: (opts?: unknown) => mockAddRule(opts) },
    },
  },
}));

import { ReglasCard } from "../_components/reglas-card";

const PRICE_LIST_ID = "00000000-0000-0000-0000-000000000010";
const idleQuery = { data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() };

/** Regla real de Odoo: markup del 6.38% sobre la categoría INSUMOS. */
const REGLA_INSUMOS = {
  id: "r-1",
  appliedOn: "category",
  itemCode: null,
  categoryNombre: "INSUMOS",
  minQuantity: "1",
  dateStart: null,
  dateEnd: null,
  computePrice: "formula",
  fixedPrice: null,
  percentPrice: "0",
  base: "list_price",
  basePriceListName: null,
  priceDiscount: "-6.38",
  priceSurcharge: "0",
  priceRound: "0",
  priceMinMargin: "0",
  priceMaxMargin: "0",
  sequence: 0,
  odooItemId: 11796,
  active: true,
};

/** Regla real de Odoo: margen fijo de 0.70 sobre la categoría IMAGENES. */
const REGLA_IMAGENES = {
  ...REGLA_INSUMOS,
  id: "r-2",
  categoryNombre: "IMAGENES",
  minQuantity: "0",
  dateStart: "2026-06-29T15:00:00.000Z",
  priceDiscount: "0",
  priceMinMargin: "0.7",
  priceMaxMargin: "0.7",
  odooItemId: 15027,
};

describe("ReglasCard (CC-0021)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListRules.mockReturnValue({ ...idleQuery, data: [REGLA_INSUMOS, REGLA_IMAGENES] });
    mockListCategories.mockReturnValue({ ...idleQuery, data: [{ id: "cat-1", nombre: "INSUMOS" }] });
    mockListLists.mockReturnValue({ ...idleQuery, data: [] });
    mockSimular.mockReturnValue({ ...idleQuery });
    mockSetRuleActive.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockAddRule.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  afterEach(cleanup);

  it("muestra el markup como un aumento porcentual sobre el precio de catálogo", () => {
    render(<ReglasCard priceListId={PRICE_LIST_ID} />);

    expect(screen.getByText("Reglas de precio (2)")).toBeInTheDocument();
    expect(screen.getByText(/\+6\.38% sobre catálogo/)).toBeInTheDocument();
    expect(screen.getByText(/Odoo #11796/)).toBeInTheDocument();
  });

  it("describe los márgenes mínimo y máximo de la regla de imágenes", () => {
    render(<ReglasCard priceListId={PRICE_LIST_ID} />);

    expect(screen.getByText(/mín\. \+\$0\.70 · máx\. \+\$0\.70 sobre catálogo/)).toBeInTheDocument();
    // La vigencia abierta se muestra con el extremo faltante como «…».
    expect(screen.getByText("29/6/2026 – …")).toBeInTheDocument();
  });

  it("sin reglas explica que la lista funciona con los precios de sus ítems", () => {
    mockListRules.mockReturnValue({ ...idleQuery, data: [] });

    render(<ReglasCard priceListId={PRICE_LIST_ID} />);

    expect(screen.getByText(/Sin reglas\./)).toBeInTheDocument();
  });

  it("el probador solo consulta al pulsar Probar y muestra la fuente del precio", () => {
    render(<ReglasCard priceListId={PRICE_LIST_ID} />);

    // Antes de pulsar, la consulta está deshabilitada.
    expect(mockSimular.mock.calls[0]![1]).toMatchObject({ enabled: false });

    fireEvent.change(screen.getByLabelText("Código a probar"), { target: { value: "AVT-IMG-001" } });
    mockSimular.mockReturnValue({ ...idleQuery, data: { precio: 28.7, fuente: "regla", reglaId: "r-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Probar" }));

    expect(screen.getByRole("status")).toHaveTextContent("$28.70");
    expect(screen.getByRole("status")).toHaveTextContent("Regla explícita");
    expect(mockSimular.mock.calls.at(-1)![0]).toMatchObject({ code: "AVT-IMG-001", cantidad: 1 });
  });

  it("avisa cuando ningún eslabón produce precio", () => {
    render(<ReglasCard priceListId={PRICE_LIST_ID} />);

    fireEvent.change(screen.getByLabelText("Código a probar"), { target: { value: "NO-EXISTE" } });
    mockSimular.mockReturnValue({ ...idleQuery, data: { precio: null, fuente: null, reglaId: null } });
    fireEvent.click(screen.getByRole("button", { name: "Probar" }));

    expect(screen.getByRole("status")).toHaveTextContent("captura manual");
  });

  it("desactivar una regla envía el toggle al servidor", () => {
    const mutate = vi.fn();
    mockSetRuleActive.mockReturnValue({ mutate, isPending: false });

    render(<ReglasCard priceListId={PRICE_LIST_ID} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Desactivar" })[0]!);

    expect(mutate).toHaveBeenCalledWith({ id: "r-1", active: false });
  });
});
