// @vitest-environment jsdom
/**
 * Tests de LaboratorioCatalogPage — CC-0011 WS-C (catálogo admin de exámenes).
 *
 * Estrategia: mock de @/lib/trpc/react (patrón de
 * gs1/trazabilidad/__tests__/page.test.tsx) — sin DB, verifica comportamiento
 * de UI con datos simulados de `lis.panel.list` / `lis.test.list`.
 *
 * Casos:
 *   1. Renderiza título + tabs de área (Laboratorio/Radiología/Cardiología).
 *   2. La tabla de paneles distingue Global (organizationId=null) vs Propio.
 *   3. Seleccionar un panel dispara `lis.test.list` con su panelId.
 *   4. Fila global: "Editar"/"Desactivar" deshabilitados (solo lectura).
 *      Fila propia: acciones habilitadas.
 *   5. "+ Nuevo panel" abre el dialog de creación.
 *   6. Error CONFLICT del server (código duplicado) se muestra en español.
 *   7. Error FORBIDDEN del server (acción sobre fila global) se muestra en español.
 *
 * @QA — E2E (Playwright): flujo completo crear/editar/desactivar panel y
 * examen contra Supabase real, incluyendo hover del tooltip "solo lectura".
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TooltipProvider } from "@his/ui/components/tooltip";
import { ToastProvider, ToastViewport } from "@his/ui/components/toast";

// ─── Mocks de infraestructura ─────────────────────────────────────────────────

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// ─── Mock tRPC ──────────────────────────────────────────────────────────────
// Queries: vi.fn() configurables por test (mockReturnValue).
// Mutations: vi.fn() que registra los `options` pasados por el componente,
// para poder invocar onSuccess/onError manualmente y así simular la
// respuesta del server sin depender de la lógica interna de react-query.

const mockPanelListQuery = vi.fn();
const mockTestListQuery = vi.fn();

/** Shape mínimo de los `options` que los componentes pasan a `useMutation`. */
interface MutationOpts {
  onSuccess?: () => void;
  onError?: (e: { message: string }) => void;
}

function defaultMutationImpl(_opts?: MutationOpts) {
  return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
}

const mockPanelCreate = vi.fn(defaultMutationImpl);
const mockPanelUpdate = vi.fn(defaultMutationImpl);
const mockPanelDeactivate = vi.fn(defaultMutationImpl);
const mockPanelReactivate = vi.fn(defaultMutationImpl);
const mockTestCreate = vi.fn(defaultMutationImpl);
const mockTestUpdate = vi.fn(defaultMutationImpl);
const mockTestDeactivate = vi.fn(defaultMutationImpl);
const mockTestReactivate = vi.fn(defaultMutationImpl);

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    lis: {
      panel: {
        list: { useQuery: (...args: unknown[]) => mockPanelListQuery(...args) },
        create: { useMutation: (opts?: MutationOpts) => mockPanelCreate(opts) },
        update: { useMutation: (opts?: MutationOpts) => mockPanelUpdate(opts) },
        deactivate: { useMutation: (opts?: MutationOpts) => mockPanelDeactivate(opts) },
        reactivate: { useMutation: (opts?: MutationOpts) => mockPanelReactivate(opts) },
      },
      test: {
        list: { useQuery: (...args: unknown[]) => mockTestListQuery(...args) },
        create: { useMutation: (opts?: MutationOpts) => mockTestCreate(opts) },
        update: { useMutation: (opts?: MutationOpts) => mockTestUpdate(opts) },
        deactivate: { useMutation: (opts?: MutationOpts) => mockTestDeactivate(opts) },
        reactivate: { useMutation: (opts?: MutationOpts) => mockTestReactivate(opts) },
      },
    },
    useUtils: () => ({
      lis: {
        panel: { list: { invalidate: vi.fn() } },
        test: { list: { invalidate: vi.fn() } },
      },
    }),
  },
}));

import LaboratorioCatalogPage from "../page";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePanel(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    organizationId: null,
    code: "AVT-LAB-HEM",
    name: "Hematología y coagulación",
    area: "LABORATORIO",
    displayOrder: 1,
    active: true,
    ...overrides,
  };
}

function makeTenantPanel(overrides: Record<string, unknown> = {}) {
  return makePanel({
    id: "22222222-2222-2222-2222-222222222222",
    organizationId: "33333333-3333-3333-3333-333333333333",
    code: "TEN-LAB-CUS",
    name: "Panel propio del tenant",
    displayOrder: 2,
    ...overrides,
  });
}

function makeTest(overrides: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    organizationId: null,
    panelId: "11111111-1111-1111-1111-111111111111",
    code: "AVT-LAB-HEM-01",
    name: "Hemograma completo",
    displayOrder: 1,
    active: true,
    ...overrides,
  };
}

const idleQuery = { data: undefined, isLoading: false, error: null };

function firstTable(): HTMLElement {
  const [table] = screen.getAllByRole("table");
  if (!table) throw new Error("No se encontró ninguna tabla en el DOM.");
  return table;
}

function renderPage() {
  return render(
    <ToastProvider>
      <TooltipProvider>
        <LaboratorioCatalogPage />
      </TooltipProvider>
      <ToastViewport />
    </ToastProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LaboratorioCatalogPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPanelCreate.mockImplementation(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }));
    mockPanelUpdate.mockImplementation(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }));
    mockPanelDeactivate.mockImplementation(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }));
    mockPanelReactivate.mockImplementation(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }));
    mockTestCreate.mockImplementation(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }));
    mockTestUpdate.mockImplementation(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }));
    mockTestDeactivate.mockImplementation(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }));
    mockTestReactivate.mockImplementation(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }));
    mockPanelListQuery.mockReturnValue({ ...idleQuery, data: [makePanel(), makeTenantPanel()] });
    mockTestListQuery.mockReturnValue({ ...idleQuery, data: [makeTest()] });
  });

  afterEach(() => {
    cleanup();
  });

  // ── 1. Título + tabs de área ──────────────────────────────────────────────

  it("renderiza el título y los tabs de área", () => {
    renderPage();

    expect(screen.getByText("Catálogo de laboratorio y estudios")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Laboratorio" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Radiología" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Cardiología" })).toBeInTheDocument();
  });

  // ── 2. Global vs Propio ───────────────────────────────────────────────────

  it("distingue paneles Global (organizationId=null) de Propio (tenant)", () => {
    renderPage();
    const panelTable = firstTable();

    expect(within(panelTable).getByText("AVT-LAB-HEM")).toBeInTheDocument();
    expect(within(panelTable).getByText("TEN-LAB-CUS")).toBeInTheDocument();
    expect(within(panelTable).getByText("Global")).toBeInTheDocument();
    expect(within(panelTable).getByText("Propio")).toBeInTheDocument();
  });

  // ── 3. Selección de panel dispara test.list con panelId ──────────────────

  it("al seleccionar un panel, consulta los exámenes de ese panelId", () => {
    renderPage();

    fireEvent.click(screen.getByText("Panel propio del tenant"));

    const lastCall = mockTestListQuery.mock.calls.at(-1);
    expect(lastCall?.[0]).toMatchObject({ panelId: "22222222-2222-2222-2222-222222222222" });
  });

  // ── 4. Acciones deshabilitadas para filas globales ────────────────────────

  it("deshabilita Editar/Desactivar para el panel global y los habilita para el propio", () => {
    renderPage();
    const panelTable = firstTable();

    const globalRow = within(panelTable).getByText("AVT-LAB-HEM").closest("tr")!;
    const tenantRow = within(panelTable).getByText("TEN-LAB-CUS").closest("tr")!;

    expect(within(globalRow).getByRole("button", { name: "Editar" })).toBeDisabled();
    expect(within(globalRow).getByRole("button", { name: "Desactivar" })).toBeDisabled();
    expect(within(tenantRow).getByRole("button", { name: "Editar" })).not.toBeDisabled();
    expect(within(tenantRow).getByRole("button", { name: "Desactivar" })).not.toBeDisabled();
  });

  // ── 5. "+ Nuevo panel" abre el dialog de creación ─────────────────────────

  it("el botón 'Nuevo panel' abre el dialog de creación", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Nuevo panel/i }));

    expect(screen.getByRole("heading", { name: "Nuevo panel" })).toBeInTheDocument();
  });

  // ── 6. CONFLICT (código duplicado) se muestra en español ─────────────────

  it("muestra el mensaje CONFLICT del server al crear un panel con código duplicado", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Nuevo panel/i }));

    const onError = mockPanelCreate.mock.calls.at(-1)?.[0]?.onError as (e: { message: string }) => void;
    act(() => {
      onError({ message: "Ya existe un registro con ese código en el catálogo LIS." });
    });

    expect(screen.getByText("Ya existe un registro con ese código en el catálogo LIS.")).toBeInTheDocument();
  });

  // ── 7. FORBIDDEN (fila global) se muestra en español ──────────────────────

  it("muestra el mensaje FORBIDDEN del server si una acción sobre catálogo global falla", () => {
    renderPage();

    const onError = mockPanelDeactivate.mock.calls.at(-1)?.[0]?.onError as (e: { message: string }) => void;
    act(() => {
      onError({
        message: "El catálogo global de laboratorio es de solo lectura. Cree un panel propio del tenant.",
      });
    });

    expect(
      screen.getByText("El catálogo global de laboratorio es de solo lectura. Cree un panel propio del tenant."),
    ).toBeInTheDocument();
  });
});
