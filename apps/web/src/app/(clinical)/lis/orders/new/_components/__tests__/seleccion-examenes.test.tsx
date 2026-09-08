// @vitest-environment jsdom
/**
 * Tests de <SeleccionExamenes> — rediseño lab 2026-09 (cascada
 * Tipo→Subtipo→Sección + tablero de solicitud con cantidad/parámetros).
 *
 * Estrategia: mock de `@/lib/trpc/react` (mismo patrón que el resto de
 * `/lis`) — sin DB. Reemplaza a `orders/new/__tests__/page.test.tsx`
 * (CC-0013), realineado a la nueva UI: la cascada sustituye el filtro plano
 * por sección; los casos "sin selección" y "guardar → resumen → confirmar"
 * se conservan.
 *
 * Casos:
 *   1. Con cuentaId → carga la cascada (`lis.catalog.cascada`), auto-elige
 *      la primera sección permitida y permite seleccionar un examen.
 *   2. Cascada Tipo→Subtipo filtra las secciones disponibles.
 *   3. Toggle "Buscar por N..." cambia a búsqueda por nombre con badge de sección.
 *   4. Guardar Exámenes → modal resumen → Confirmar y Guardar llama
 *      `lis.order.create` con cantidad editada y parámetros resueltos por
 *      defecto (TODOS) cuando el usuario no abrió el modal de parámetros.
 *   5. Guardar sin selección muestra aviso y no abre el modal.
 *   6. "Mantenimiento de catálogos" solo visible para ADMIN/DIR.
 *
 * @QA E2E (Playwright): flujo completo cascada → selección → guardar → Tablero.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastProvider, ToastViewport } from "@his/ui/components/toast";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockContextoCuenta = vi.fn();
const mockCascada = vi.fn();
const mockParametersQuery = vi.fn();
const mockOrderCreate = vi.fn();
const mockParametersFetch = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    patient: {
      contextoCuenta: { useQuery: (...args: unknown[]) => mockContextoCuenta(...args) },
    },
    lis: {
      catalog: { cascada: { useQuery: (...args: unknown[]) => mockCascada(...args) } },
      test: { parameters: { useQuery: (...args: unknown[]) => mockParametersQuery(...args) } },
      order: { create: { useMutation: (opts?: unknown) => mockOrderCreate(opts) } },
    },
    useUtils: () => ({
      lis: { test: { parameters: { fetch: mockParametersFetch } } },
    }),
  },
}));

import { SeleccionExamenes } from "../seleccion-examenes";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const CASCADA = {
  tipos: [
    { id: "tipo-sangre", name: "Sangre y derivados", displayOrder: 0, testCount: 2 },
    { id: "tipo-orina", name: "Orina", displayOrder: 1, testCount: 1 },
  ],
  subtipos: [
    { id: "sub-suero", sampleTypeId: "tipo-sangre", name: "Suero", displayOrder: 0, testCount: 2 },
    { id: "sub-azar", sampleTypeId: "tipo-orina", name: "Orina al azar", displayOrder: 0, testCount: 1 },
  ],
  secciones: [
    { id: "sec-quimica", name: "QUIMICA", displayOrder: 0, testCount: 2 },
    { id: "sec-uri", name: "URIANALISIS", displayOrder: 1, testCount: 1 },
  ],
  pruebas: [
    {
      id: "t1-glucosa",
      name: "GLUCOSA",
      panelId: "sec-quimica",
      sampleTypeId: "tipo-sangre",
      sampleSubtypeId: "sub-suero",
      defaultQty: 1,
      paramCount: 0,
    },
    {
      id: "t2-colesterol",
      name: "COLESTEROL",
      panelId: "sec-quimica",
      sampleTypeId: "tipo-sangre",
      sampleSubtypeId: "sub-suero",
      defaultQty: 1,
      paramCount: 0,
    },
    {
      id: "t3-orina",
      name: "GENERAL DE ORINA",
      panelId: "sec-uri",
      sampleTypeId: "tipo-orina",
      sampleSubtypeId: "sub-azar",
      defaultQty: 1,
      paramCount: 2,
    },
  ],
};

const PARAMETROS_ORINA = [
  { id: "p1", name: "Color", displayOrder: 0 },
  { id: "p2", name: "Densidad", displayOrder: 1 },
];

const CONTEXTO = {
  cuenta: { id: "cuenta-1", numeroCuenta: "CTA00099", encounterId: null, tipo: null },
  paciente: {
    id: "pac-1",
    firstName: "Ana",
    lastName: "Cruz",
    birthDate: "1994-01-01",
    biologicalSexId: null,
    preferredName: null,
    esLgbtiq: null,
    mrn: "MRN001",
    documentType: null,
    documentNumber: null,
    domicilio: null,
  },
  episodioId: null,
  alergias: [],
  contactosEmergencia: [],
  usuarioActual: { id: "u1", nombre: "Dr. Guevara" },
};

const idleQuery = { data: undefined, isLoading: false, error: null };

function defaultMutationImpl() {
  return { mutate: vi.fn(), isPending: false, error: null };
}

function renderComponente(roleCodes: string[] = []) {
  return render(
    <ToastProvider>
      <SeleccionExamenes cuentaId="cuenta-1" roleCodes={roleCodes} />
      <ToastViewport />
    </ToastProvider>,
  );
}

describe("SeleccionExamenes (rediseño lab 2026-09)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContextoCuenta.mockReturnValue({ ...idleQuery, data: CONTEXTO });
    mockCascada.mockReturnValue({ ...idleQuery, data: CASCADA });
    mockParametersQuery.mockReturnValue({ ...idleQuery, data: PARAMETROS_ORINA });
    mockOrderCreate.mockImplementation(defaultMutationImpl);
    mockParametersFetch.mockResolvedValue(PARAMETROS_ORINA);
  });

  afterEach(() => cleanup());

  it("carga la cascada, auto-elige la primera sección y permite seleccionar un examen", () => {
    renderComponente();

    // Paso 1: Tipo — "Todos" activo por defecto, pills con contador.
    expect(screen.getByTestId("lab-tipo-pill-Todos")).toBeInTheDocument();
    expect(screen.getByTestId("lab-tipo-pill-Sangre y derivados")).toHaveTextContent("2");

    // Paso 3: Sección — QUIMICA auto-seleccionada (primera con pruebas).
    expect(screen.getByTestId("lab-seccion-pill-QUIMICA")).toBeInTheDocument();
    expect(screen.getByText("GLUCOSA")).toBeInTheDocument();

    expect(screen.getByText("0 seleccionadas")).toBeInTheDocument();

    fireEvent.click(screen.getByText("GLUCOSA"));

    expect(screen.getByText("1 seleccionada")).toBeInTheDocument();
    expect(screen.getByText("1 examen")).toBeInTheDocument(); // chip del tablero de solicitud
    expect(screen.getByTestId("lab-solicitud-row")).toBeInTheDocument();
  });

  it("cascada Tipo→Subtipo filtra secciones y subtipos disponibles", () => {
    renderComponente();

    fireEvent.click(screen.getByTestId("lab-tipo-pill-Orina"));

    // Subtipo — solo "Orina al azar" (el único con testCount>0 para Orina).
    expect(screen.getByTestId("lab-subtipo-pill-Orina al azar")).toBeInTheDocument();
    expect(screen.queryByTestId("lab-subtipo-pill-Suero")).not.toBeInTheDocument();

    // Sección — se reduce a URIANALISIS y la lista muestra GENERAL DE ORINA.
    expect(screen.getByTestId("lab-seccion-pill-URIANALISIS")).toBeInTheDocument();
    expect(screen.queryByTestId("lab-seccion-pill-QUIMICA")).not.toBeInTheDocument();
    expect(screen.getByText("GENERAL DE ORINA")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Quitar filtro de muestra"));
    expect(screen.getByTestId("lab-seccion-pill-QUIMICA")).toBeInTheDocument();
  });

  it("toggle búsqueda cambia a modo por nombre con badge de sección", () => {
    renderComponente();

    fireEvent.click(screen.getByRole("switch", { name: /buscar por nombre/i }));
    const buscador = screen.getByPlaceholderText("Escriba el nombre de la prueba...");
    fireEvent.change(buscador, { target: { value: "ORINA" } });

    expect(screen.getByText("GENERAL DE ORINA")).toBeInTheDocument();
    const item = screen.getByText("GENERAL DE ORINA").closest("label")!;
    expect(within(item).getByText("URIANALISIS")).toBeInTheDocument();
  });

  it("Guardar Exámenes → modal resumen → Confirmar y Guardar llama order.create con cantidad y parámetros resueltos por defecto", async () => {
    const mutate = vi.fn();
    mockOrderCreate.mockImplementation(() => ({ mutate, isPending: false, error: null }));
    renderComponente();

    // GLUCOSA (sin parámetros) — edita cantidad a 3.
    fireEvent.click(screen.getByText("GLUCOSA"));
    fireEvent.change(screen.getByLabelText("Cantidad de GLUCOSA"), { target: { value: "3" } });

    // GENERAL DE ORINA (2 parámetros) — se selecciona sin abrir el modal de parámetros.
    fireEvent.click(screen.getByTestId("lab-tipo-pill-Orina"));
    fireEvent.click(screen.getByText("GENERAL DE ORINA"));

    expect(screen.getAllByTestId("lab-solicitud-row")).toHaveLength(2);
    expect(screen.getByText("2/2 parám.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByTestId("lab-guardar-btn")[0]!);
    expect(screen.getByRole("heading", { name: "Pruebas a guardar" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar y Guardar" }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mockParametersFetch).toHaveBeenCalledWith({ testId: "t3-orina" });
    expect(mutate).toHaveBeenCalledWith({
      cuentaId: "cuenta-1",
      priority: "ROUTINE",
      items: [
        { testId: "t1-glucosa", quantity: 3 },
        { testId: "t3-orina", quantity: 1, parameterIds: ["p1", "p2"] },
      ],
    });
  });

  it("Guardar sin selección muestra aviso y no abre el modal", () => {
    renderComponente();

    fireEvent.click(screen.getAllByTestId("lab-guardar-btn")[0]!);

    expect(screen.queryByRole("heading", { name: "Pruebas a guardar" })).not.toBeInTheDocument();
    expect(screen.getByText("Seleccione al menos una prueba.")).toBeInTheDocument();
  });

  it('"Mantenimiento de catálogos" solo es visible para ADMIN/DIR', () => {
    const { unmount } = renderComponente(["ENF"]);
    expect(screen.queryByText("⚙ Mantenimiento de catálogos")).not.toBeInTheDocument();
    unmount();

    renderComponente(["DIR"]);
    expect(screen.getByText("⚙ Mantenimiento de catálogos")).toBeInTheDocument();
  });
});
