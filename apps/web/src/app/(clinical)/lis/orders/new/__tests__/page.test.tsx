// @vitest-environment jsdom
/**
 * Tests de NewLisOrderPage — CC-0013 (escogitación de exámenes por cuenta).
 *
 * Estrategia: mock de `@/lib/trpc/react` (patrón de
 * catalogs/laboratorio/__tests__/page.test.tsx) — sin DB. `useSearchParams`
 * se mockea con un Map mutable para poder probar con/sin `?cuentaId=`.
 *
 * Casos:
 *   1. Sin cuentaId → muestra el SelectorCuenta.
 *   2. Con cuentaId → carga secciones desde `lis.test.listByArea` y permite
 *      seleccionar un examen (contador + chip en "Solicitud de laboratorio").
 *   3. Toggle "Buscar por N..." cambia a búsqueda por nombre con badge de sección.
 *   4. Guardar Exámenes → modal resumen → Confirmar y Guardar llama
 *      `lis.order.create` con cuentaId + prioridad default ROUTINE.
 *
 * @QA E2E (Playwright): flujo completo selección → guardar → verificar en Tablero.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastProvider, ToastViewport } from "@his/ui/components/toast";

// ─── next/navigation ────────────────────────────────────────────────────────

const mockPush = vi.fn();
let searchParamsMap = new Map<string, string>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({
    get: (key: string) => searchParamsMap.get(key) ?? null,
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// ─── Mock tRPC ──────────────────────────────────────────────────────────────

const mockContextoCuenta = vi.fn();
const mockListByArea = vi.fn();
const mockPatientSearch = vi.fn();
const mockListarPorPaciente = vi.fn();
const mockOrderCreate = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    patient: {
      contextoCuenta: { useQuery: (...args: unknown[]) => mockContextoCuenta(...args) },
      search: { useQuery: (...args: unknown[]) => mockPatientSearch(...args) },
    },
    patientAccount: {
      listarPorPaciente: { useQuery: (...args: unknown[]) => mockListarPorPaciente(...args) },
    },
    lis: {
      test: { listByArea: { useQuery: (...args: unknown[]) => mockListByArea(...args) } },
      order: { create: { useMutation: (opts?: unknown) => mockOrderCreate(opts) } },
    },
  },
}));

import NewLisOrderPage from "../page";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const PANELS = [
  {
    panelId: "11111111-1111-1111-1111-111111111111",
    nombre: "QUIMICA",
    tests: [
      { id: "t1-glucosa", nombre: "GLUCOSA", displayOrder: 1 },
      { id: "t2-colesterol", nombre: "COLESTEROL", displayOrder: 2 },
    ],
  },
  {
    panelId: "22222222-2222-2222-2222-222222222222",
    nombre: "URIANALISIS",
    tests: [{ id: "t3-orina", nombre: "GENERAL DE ORINA", displayOrder: 1 }],
  },
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

function renderPage() {
  return render(
    <ToastProvider>
      <NewLisOrderPage />
      <ToastViewport />
    </ToastProvider>,
  );
}

describe("NewLisOrderPage (CC-0013)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMap = new Map();
    mockContextoCuenta.mockReturnValue({ ...idleQuery, data: CONTEXTO });
    mockListByArea.mockReturnValue({ ...idleQuery, data: PANELS });
    mockPatientSearch.mockReturnValue({ ...idleQuery, data: [] });
    mockListarPorPaciente.mockReturnValue({ ...idleQuery, data: [] });
    mockOrderCreate.mockImplementation(defaultMutationImpl);
  });

  afterEach(() => cleanup());

  it("sin cuentaId muestra el selector de cuenta", () => {
    renderPage();
    expect(screen.getByText("Nueva orden de laboratorio")).toBeInTheDocument();
  });

  it("con cuentaId carga las secciones desde listByArea y permite seleccionar un examen", () => {
    searchParamsMap.set("cuentaId", "cuenta-1");
    renderPage();

    expect(screen.getByText("QUIMICA")).toBeInTheDocument();
    expect(screen.getByText("URIANALISIS")).toBeInTheDocument();
    expect(screen.getByText("GLUCOSA")).toBeInTheDocument();

    expect(screen.getByText("0 seleccionadas")).toBeInTheDocument();

    fireEvent.click(screen.getByText("GLUCOSA"));

    expect(screen.getByText("1 seleccionada")).toBeInTheDocument();
    expect(screen.getByText("1 examen")).toBeInTheDocument(); // contador panel Solicitud
  });

  it("toggle búsqueda cambia a modo por nombre con badge de sección", () => {
    searchParamsMap.set("cuentaId", "cuenta-1");
    renderPage();

    fireEvent.click(screen.getByRole("switch", { name: /buscar por nombre/i }));
    const buscador = screen.getByPlaceholderText("Escriba el nombre de la prueba...");
    fireEvent.change(buscador, { target: { value: "ORINA" } });

    expect(screen.getByText("GENERAL DE ORINA")).toBeInTheDocument();
    // Badge de sección visible solo en modo búsqueda.
    const item = screen.getByText("GENERAL DE ORINA").closest("label")!;
    expect(within(item).getByText("URIANALISIS")).toBeInTheDocument();
  });

  it("Guardar Exámenes → modal resumen → Confirmar y Guardar llama order.create con cuentaId", () => {
    searchParamsMap.set("cuentaId", "cuenta-1");
    const mutate = vi.fn();
    mockOrderCreate.mockImplementation(() => ({ mutate, isPending: false, error: null }));
    renderPage();

    fireEvent.click(screen.getByText("GLUCOSA"));
    fireEvent.click(screen.getAllByText("💾 Guardar Exámenes")[0]!);

    expect(screen.getByRole("heading", { name: "Prestaciones a guardar" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar y Guardar" }));

    expect(mutate).toHaveBeenCalledWith({
      cuentaId: "cuenta-1",
      priority: "ROUTINE",
      items: [{ testId: "t1-glucosa" }],
    });
  });

  it("Guardar sin selección muestra aviso y no abre el modal", () => {
    searchParamsMap.set("cuentaId", "cuenta-1");
    renderPage();

    fireEvent.click(screen.getAllByText("💾 Guardar Exámenes")[0]!);

    expect(screen.queryByRole("heading", { name: "Prestaciones a guardar" })).not.toBeInTheDocument();
    expect(screen.getByText("Seleccione al menos una prestación antes de guardar.")).toBeInTheDocument();
  });
});
