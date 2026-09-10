// @vitest-environment jsdom
/**
 * Tests de NuevaFacturaShell — CC-0015 (filtrado de tarifario por cuenta +
 * patientAccountId en la factura) + docs/48 Ola 4b H-17 (dialog de override
 * de precio).
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
 *
 * Por la misma limitación de Radix Select en jsdom, los tests del dialog de
 * override (H-17) no pueden disparar el submit real (`handleSave` exige
 * cuenta/moneda/centro de costo, todos `<Select>`) — en su lugar invocan
 * directamente el `onError` capturado del mock de `invoice.create.useMutation`,
 * que es exactamente lo que React Query invoca cuando el servidor rechaza el
 * submit. La lógica pura de decisión (`esErrorDePrecio`/`puedeOverridePrecio`/
 * `attachOverrideJustificacion`) tiene su propia suite en
 * `invoice-override.test.ts`.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
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

/** Capturado desde el último `invoice.create.useMutation(opts)` — permite disparar onError manualmente. */
let capturedMutationOpts: { onError?: (err: { message: string }) => void } | undefined;
const mockMutate = vi.fn();

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

import { NuevaFacturaShell } from "../nueva-factura-shell";

const idleQuery = { data: undefined, isLoading: false, error: null };
const PATIENT_UUID = "11111111-1111-1111-1111-111111111111";

describe("NuevaFacturaShell (CC-0015 + H-17)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedMutationOpts = undefined;
    mockListCostCenters.mockReturnValue({ ...idleQuery, data: [] });
    mockCurrencyList.mockReturnValue({ ...idleQuery, data: [{ id: "cur-1", isoCode: "USD", name: "Dólar" }] });
    mockInsurerList.mockReturnValue({ ...idleQuery, data: [] });
    mockListActiveItems.mockReturnValue({ ...idleQuery, data: [] });
    mockInvoiceCreate.mockImplementation((opts: { onError?: (err: { message: string }) => void }) => {
      capturedMutationOpts = opts;
      return { mutate: mockMutate, isPending: false };
    });
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
    render(<NuevaFacturaShell roleCodes={[]} />);
    const lastCall = mockListActiveItems.mock.calls.at(-1)!;
    expect(lastCall[0]).toBeUndefined();
  });

  it("sin cuenta seleccionada, no muestra el banner de lista aplicada", () => {
    render(<NuevaFacturaShell roleCodes={[]} />);
    expect(screen.queryByText(/Lista aplicada:/)).not.toBeInTheDocument();
  });

  it("consulta cuentas del paciente solo cuando el UUID es válido", () => {
    render(<NuevaFacturaShell roleCodes={[]} />);

    // Sin UUID válido aún → enabled: false
    expect(mockListarPorPaciente.mock.calls.at(-1)![1]).toMatchObject({ enabled: false });

    fireEvent.change(screen.getByLabelText("ID Paciente (UUID) *"), {
      target: { value: PATIENT_UUID },
    });

    expect(mockListarPorPaciente.mock.calls.at(-1)![0]).toMatchObject({ patientId: PATIENT_UUID });
    expect(mockListarPorPaciente.mock.calls.at(-1)![1]).toMatchObject({ enabled: true });
  });

  it("el select de cuenta lista las cuentas devueltas por listarPorPaciente", () => {
    render(<NuevaFacturaShell roleCodes={[]} />);
    fireEvent.change(screen.getByLabelText("ID Paciente (UUID) *"), {
      target: { value: PATIENT_UUID },
    });

    // El trigger no está deshabilitado una vez hay cuentas.
    const cuentaSelect = screen.getByLabelText("Cuenta del paciente");
    expect(cuentaSelect).not.toBeDisabled();
  });

  // ---------------------------------------------------------------------
  // docs/48 Ola 4b (H-17) — dialog de override de precio
  // ---------------------------------------------------------------------
  describe("dialog de override de precio (H-17)", () => {
    /**
     * Dispara el `onError` capturado dentro de `act()`: React Query lo
     * invocaría de forma asíncrona (fuera de un evento de usuario), así que
     * sin `act()` el `setState` que abre el dialog queda pendiente y las
     * aserciones corren antes del re-render.
     */
    function triggerOnError(message: string) {
      act(() => {
        capturedMutationOpts?.onError?.({ message });
      });
    }

    it("con rol ADMIN, un error de precio abre el dialog de override (no el mensaje inline)", () => {
      render(<NuevaFacturaShell roleCodes={["ADMIN"]} />);

      triggerOnError(
        'El precio enviado (10) no coincide con el resuelto por el servidor (12) para "LAB-01". Use overridePrecio para forzarlo.',
      );

      expect(screen.getByText("Forzar precio (override)")).toBeInTheDocument();
      expect(screen.getByLabelText("Justificación *")).toBeInTheDocument();
    });

    it("con rol DIR, un error de precio no-resoluble también abre el dialog", () => {
      render(<NuevaFacturaShell roleCodes={["DIR"]} />);

      triggerOnError(
        'No se pudo resolver el precio del código "LAB-01". Cargue la tarifa o use overridePrecio con rol ADMIN/DIR.',
      );

      expect(screen.getByText("Forzar precio (override)")).toBeInTheDocument();
    });

    it("sin rol ADMIN/DIR, el mismo error NO abre el dialog — cae al mensaje inline", () => {
      render(<NuevaFacturaShell roleCodes={["ACCOUNTANT"]} />);

      triggerOnError(
        'No se pudo resolver el precio del código "LAB-01". Cargue la tarifa o use overridePrecio con rol ADMIN/DIR.',
      );

      expect(screen.queryByText("Forzar precio (override)")).not.toBeInTheDocument();
      expect(
        screen.getByText('No se pudo resolver el precio del código "LAB-01". Cargue la tarifa o use overridePrecio con rol ADMIN/DIR.'),
      ).toBeInTheDocument();
    });

    it("con rol ADMIN, un error NO relacionado a precio no abre el dialog", () => {
      render(<NuevaFacturaShell roleCodes={["ADMIN"]} />);

      triggerOnError("La cuenta indicada no pertenece a este paciente o tenant.");

      expect(screen.queryByText("Forzar precio (override)")).not.toBeInTheDocument();
      expect(screen.getByText("La cuenta indicada no pertenece a este paciente o tenant.")).toBeInTheDocument();
    });

    it("justificación demasiado corta rechaza sin reenviar el submit", () => {
      render(<NuevaFacturaShell roleCodes={["ADMIN"]} />);
      triggerOnError('No se pudo resolver el precio del código "LAB-01".');

      fireEvent.change(screen.getByLabelText("Justificación *"), { target: { value: "corta" } });
      fireEvent.click(screen.getByRole("button", { name: "Forzar precio y guardar" }));

      expect(screen.getByText("La justificación debe tener al menos 10 caracteres.")).toBeInTheDocument();
      expect(mockMutate).not.toHaveBeenCalled();
    });
  });
});
