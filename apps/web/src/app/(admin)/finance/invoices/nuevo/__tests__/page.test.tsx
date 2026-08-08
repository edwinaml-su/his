// @vitest-environment jsdom
/**
 * Tests de NuevaFacturaPage — CC-0015 (filtrado de tarifario por cuenta +
 * patientAccountId en la factura).
 *
 * Estrategia: mock de `@/lib/trpc/react`. La selección de "Cuenta del
 * paciente" usa un `<Select>` de Radix — `fireEvent.change` no dispara su
 * `onValueChange` (no es un `<select>` nativo) y este repo no tiene
 * polyfills de pointer-capture para simular apertura+click del dropdown.
 * Por eso este test valida lo observable sin abrir el Select: gating de
 * `listarPorPaciente`/`tipoCuenta.list` por UUID válido, comportamiento
 * "sin cuenta" (idéntico al previo a CC-0015), y que la lista de cuentas
 * llega correctamente al Select. El flujo completo "elegir cuenta → banner
 * → filtro → patientAccountId en submit" queda marcado para @QA E2E
 * Playwright (interacción real de Radix Select en browser).
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const mockListCostCenters = vi.fn();
const mockCurrencyList = vi.fn();
const mockInsurerList = vi.fn();
const mockListActiveItems = vi.fn();
const mockInvoiceCreate = vi.fn();
const mockListarPorPaciente = vi.fn();
const mockTipoCuentaList = vi.fn();
const mockResolverPorCuentaFetch = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      servicePriceList: { resolverPorCuenta: { fetch: mockResolverPorCuentaFetch } },
    }),
    invoice: {
      listCostCenters: { useQuery: (...args: unknown[]) => mockListCostCenters(...args) },
      create: { useMutation: (opts?: unknown) => mockInvoiceCreate(opts) },
    },
    currency: {
      list: { useQuery: (...args: unknown[]) => mockCurrencyList(...args) },
    },
    insurance: {
      insurer: { list: { useQuery: (...args: unknown[]) => mockInsurerList(...args) } },
    },
    servicePriceList: {
      listActiveItems: { useQuery: (...args: unknown[]) => mockListActiveItems(...args) },
    },
    patientAccount: {
      listarPorPaciente: { useQuery: (...args: unknown[]) => mockListarPorPaciente(...args) },
    },
    tipoCuenta: {
      list: { useQuery: (...args: unknown[]) => mockTipoCuentaList(...args) },
    },
  },
}));

import NuevaFacturaPage from "../page";

const idleQuery = { data: undefined, isLoading: false, error: null };
const PATIENT_UUID = "11111111-1111-1111-1111-111111111111";

function defaultMutationImpl() {
  return { mutate: vi.fn(), isPending: false };
}

describe("NuevaFacturaPage (CC-0015)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListCostCenters.mockReturnValue({ ...idleQuery, data: [] });
    mockCurrencyList.mockReturnValue({ ...idleQuery, data: [{ id: "cur-1", isoCode: "USD", name: "Dólar" }] });
    mockInsurerList.mockReturnValue({ ...idleQuery, data: [] });
    mockListActiveItems.mockReturnValue({ ...idleQuery, data: [] });
    mockInvoiceCreate.mockImplementation(defaultMutationImpl);
    mockListarPorPaciente.mockReturnValue({
      ...idleQuery,
      data: [{ id: "cta-1", numeroCuenta: "CTA00001", tipoCuenta: { id: "tc-1" } }],
    });
    mockTipoCuentaList.mockReturnValue({
      ...idleQuery,
      data: [{ id: "tc-1", nombre: "ISBM", priceListId: "pl-1", priceListName: "ODOO — PRECIOS ISBM" }],
    });
  });

  afterEach(() => cleanup());

  it("sin cuenta seleccionada, listActiveItems se consulta sin filtro (comportamiento previo)", () => {
    render(<NuevaFacturaPage />);
    const lastCall = mockListActiveItems.mock.calls.at(-1)!;
    expect(lastCall[0]).toBeUndefined();
  });

  it("sin cuenta seleccionada, no muestra el banner de lista aplicada", () => {
    render(<NuevaFacturaPage />);
    expect(screen.queryByText(/Lista aplicada:/)).not.toBeInTheDocument();
  });

  it("consulta cuentas del paciente solo cuando el UUID es válido", () => {
    render(<NuevaFacturaPage />);

    // Sin UUID válido aún → enabled: false
    expect(mockListarPorPaciente.mock.calls.at(-1)![1]).toMatchObject({ enabled: false });

    fireEvent.change(screen.getByLabelText("ID Paciente (UUID) *"), {
      target: { value: PATIENT_UUID },
    });

    expect(mockListarPorPaciente.mock.calls.at(-1)![0]).toMatchObject({ patientId: PATIENT_UUID });
    expect(mockListarPorPaciente.mock.calls.at(-1)![1]).toMatchObject({ enabled: true });
  });

  it("el select de cuenta lista las cuentas devueltas por listarPorPaciente", () => {
    render(<NuevaFacturaPage />);
    fireEvent.change(screen.getByLabelText("ID Paciente (UUID) *"), {
      target: { value: PATIENT_UUID },
    });

    // El trigger no está deshabilitado una vez hay cuentas.
    const cuentaSelect = screen.getByLabelText("Cuenta del paciente");
    expect(cuentaSelect).not.toBeDisabled();
  });
});
