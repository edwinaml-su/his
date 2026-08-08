// @vitest-environment jsdom
/**
 * Tests de SelectorCuenta (CC-0015) — componente compartido entre
 * /ece/historia-clinica/nueva y /lis/orders/new.
 *
 * Estrategia: mock de `@/lib/trpc/react` (mismo patrón que
 * lis/orders/new/__tests__/page.test.tsx) — sin DB. La interacción con el
 * Select de Radix (abrir dropdown + elegir opción) no se ejercita aquí
 * (jsdom no soporta bien pointer capture de Radix) — se cubre por E2E
 * Playwright; este test valida el flujo de búsqueda/listado y la
 * validación de "tipo de cuenta requerido" al enviar sin seleccionar.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockPatientSearch = vi.fn();
const mockListarPorPaciente = vi.fn();
const mockTipoCuentaList = vi.fn();
const mockCrear = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    patient: {
      search: { useQuery: (...args: unknown[]) => mockPatientSearch(...args) },
    },
    patientAccount: {
      listarPorPaciente: { useQuery: (...args: unknown[]) => mockListarPorPaciente(...args) },
      crear: { useMutation: (opts?: unknown) => mockCrear(opts) },
    },
    tipoCuenta: {
      list: { useQuery: (...args: unknown[]) => mockTipoCuentaList(...args) },
    },
  },
}));

import { SelectorCuenta } from "../selector-cuenta";

const idleQuery = { data: undefined, isLoading: false, error: null };

function renderSelector() {
  return render(
    <SelectorCuenta
      onSelect={() => {}}
      titulo="Nueva Historia Clínica"
      subtitulo="Seleccione la cuenta del paciente."
    />,
  );
}

/** Escribe "Ana" en el buscador, avanza el debounce (300ms) y elige el resultado. */
function seleccionarPaciente() {
  fireEvent.change(
    screen.getByPlaceholderText("Buscar paciente por nombre, expediente o documento…"),
    { target: { value: "Ana" } },
  );
  act(() => {
    vi.advanceTimersByTime(300);
  });
  fireEvent.click(screen.getByText("Ana Cruz"));
}

describe("SelectorCuenta (CC-0015)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockPatientSearch.mockReturnValue({
      ...idleQuery,
      data: [{ id: "pac-1", firstName: "Ana", lastName: "Cruz", mrn: "MRN001", identifiers: [] }],
    });
    mockListarPorPaciente.mockReturnValue({ ...idleQuery, data: [] });
    mockTipoCuentaList.mockReturnValue({
      ...idleQuery,
      data: [
        { id: "tc-1", code: "PARTICULAR", nombre: "Particular" },
        { id: "tc-2", code: "ISBM", nombre: "ISBM" },
      ],
    });
    mockCrear.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("muestra título y subtítulo", () => {
    renderSelector();
    expect(screen.getByText("Nueva Historia Clínica")).toBeInTheDocument();
    expect(screen.getByText("Seleccione la cuenta del paciente.")).toBeInTheDocument();
  });

  it("busca paciente y al seleccionarlo consulta sus cuentas y tipos de cuenta", () => {
    renderSelector();
    seleccionarPaciente();

    expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
    expect(mockListarPorPaciente).toHaveBeenCalled();
    // enabled: true una vez hay pacienteSel
    const tipoCuentaCallArgs = mockTipoCuentaList.mock.calls.at(-1)!;
    expect(tipoCuentaCallArgs[0]).toMatchObject({ activeOnly: true });
    expect(tipoCuentaCallArgs[1]).toMatchObject({ enabled: true });
  });

  it("muestra el nombre real del tipo de cuenta en cada fila cuando existe", () => {
    mockListarPorPaciente.mockReturnValue({
      ...idleQuery,
      data: [
        {
          id: "cta-1",
          numeroCuenta: "CTA00001",
          servicios: [],
          tipoCuenta: { id: "tc-2", code: "ISBM", nombre: "ISBM" },
        },
      ],
    });
    renderSelector();
    seleccionarPaciente();

    expect(screen.getByText("CTA00001")).toBeInTheDocument();
    expect(screen.getByText("ISBM")).toBeInTheDocument();
  });

  it("permite abrir el formulario de nueva cuenta y valida tipo de cuenta requerido", () => {
    const mutate = vi.fn();
    mockCrear.mockReturnValue({ mutate, isPending: false });
    renderSelector();
    seleccionarPaciente();

    fireEvent.click(screen.getByText("+ Nueva cuenta"));
    expect(screen.getByText("Tipo de cuenta *")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Crear cuenta"));

    expect(screen.getByText("Selecciona el tipo de cuenta.")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});
