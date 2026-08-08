// @vitest-environment jsdom
/**
 * CC-0016 — Tests de `<ModuloImagenes>` (módulo de radiología e imágenes).
 *
 * Estrategia: mock de `@/lib/trpc/react` (patrón de
 * lis/orders/new/__tests__/page.test.tsx) — sin DB.
 *
 * Cubre:
 *  - Tabs del módulo (Parametrización visible solo si roleCodes incluye ADMIN/DIR).
 *  - Nueva Solicitud: categorías desde `catalogoImagen.list` mockeado,
 *    selección incrementa el contador y agrega un chip.
 *  - Campos dinámicos desde `fieldConfig.list` (obligatorio con asterisco,
 *    oculto no se renderiza).
 *  - Guardar llama `imagingRequest.crear` con el payload correcto.
 *  - Listado: solicitudes por cuenta.
 *  - Parametrización > Opciones de llenado: click en un estado llama `fieldConfig.set`.
 *
 * @QA E2E (Playwright): flujo completo selección → guardar → verificar en Listado.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastProvider, ToastViewport } from "@his/ui/components/toast";

const idleQuery = { data: undefined, isLoading: false, error: null };
function defaultMutationImpl() {
  return { mutate: vi.fn(), isPending: false, error: null };
}

// ─── Mock tRPC ──────────────────────────────────────────────────────────────

const mockContextoCuenta = vi.fn();
const mockResolverDeepLink = vi.fn();
const mockOrderGet = vi.fn();
const mockCatalogoList = vi.fn();
const mockCatalogoUpsert = vi.fn();
const mockFieldConfigList = vi.fn();
const mockFieldConfigSet = vi.fn();
const mockRulesList = vi.fn();
const mockRulesSet = vi.fn();
const mockCrear = vi.fn();
const mockListarPorCuenta = vi.fn();
const mockDetalle = vi.fn();
const mockPanelList = vi.fn();
const mockPanelUpdate = vi.fn();
const mockPanelDeactivate = vi.fn();
const mockPanelReactivate = vi.fn();
const mockTestDeactivate = vi.fn();
const mockTestReactivate = vi.fn();
const mockModalityList = vi.fn();

const mockInvalidate = vi.fn();
const mockUtils = {
  imagingRequest: {
    listarPorCuenta: { invalidate: mockInvalidate },
    catalogoImagen: { list: { invalidate: mockInvalidate } },
    fieldConfig: { list: { invalidate: mockInvalidate } },
    rules: { list: { invalidate: mockInvalidate } },
  },
  lis: { panel: { list: { invalidate: mockInvalidate } } },
};

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    useUtils: () => mockUtils,
    patient: {
      contextoCuenta: { useQuery: (...args: unknown[]) => mockContextoCuenta(...args) },
    },
    imaging: {
      order: { get: { useQuery: (...args: unknown[]) => mockOrderGet(...args) } },
      modality: { list: { useQuery: (...args: unknown[]) => mockModalityList(...args) } },
    },
    imagingRequest: {
      resolverDeepLink: { useQuery: (...args: unknown[]) => mockResolverDeepLink(...args) },
      crear: { useMutation: (opts?: unknown) => mockCrear(opts) },
      listarPorCuenta: { useQuery: (...args: unknown[]) => mockListarPorCuenta(...args) },
      detalle: { useQuery: (...args: unknown[]) => mockDetalle(...args) },
      catalogoImagen: {
        list: { useQuery: (...args: unknown[]) => mockCatalogoList(...args) },
        upsert: { useMutation: (opts?: unknown) => mockCatalogoUpsert(opts) },
      },
      fieldConfig: {
        list: { useQuery: (...args: unknown[]) => mockFieldConfigList(...args) },
        set: { useMutation: (opts?: unknown) => mockFieldConfigSet(opts) },
      },
      rules: {
        list: { useQuery: (...args: unknown[]) => mockRulesList(...args) },
        set: { useMutation: (opts?: unknown) => mockRulesSet(opts) },
      },
    },
    lis: {
      panel: {
        list: { useQuery: (...args: unknown[]) => mockPanelList(...args) },
        update: { useMutation: (opts?: unknown) => mockPanelUpdate(opts) },
        deactivate: { useMutation: (opts?: unknown) => mockPanelDeactivate(opts) },
        reactivate: { useMutation: (opts?: unknown) => mockPanelReactivate(opts) },
      },
      test: {
        deactivate: { useMutation: (opts?: unknown) => mockTestDeactivate(opts) },
        reactivate: { useMutation: (opts?: unknown) => mockTestReactivate(opts) },
      },
    },
  },
}));

import { ModuloImagenes } from "../modulo-imagenes";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const CONTEXTO = {
  cuenta: { id: "cuenta-1", numeroCuenta: "CTA00099" },
  paciente: { firstName: "Ana", lastName: "Cruz", birthDate: "1994-01-01", mrn: "MRN001" },
};

const CATALOGO = [
  {
    labTestId: "t1",
    code: "RX001",
    name: "RX TORAX",
    panelId: "p-rx",
    panelNombre: "Radiografías",
    panelDisplayOrder: 1,
    panelActive: true,
    displayOrder: 1,
    active: true,
    requiereContraste: false,
    requiereAyuno: false,
    requiereAutorizacion: false,
    duracionMin: 15,
    modalityId: null,
    preparacionPaciente: null,
  },
  {
    labTestId: "t2",
    code: "TC001",
    name: "TOMOGRAFIA CRANEO",
    panelId: "p-tac",
    panelNombre: "Tomografías",
    panelDisplayOrder: 3,
    panelActive: true,
    displayOrder: 1,
    active: true,
    requiereContraste: true,
    requiereAyuno: false,
    requiereAutorizacion: false,
    duracionMin: 25,
    modalityId: null,
    preparacionPaciente: null,
  },
];

const FIELD_CONFIG = [
  { fieldKey: "dx", estado: "obligatorio", displayOrder: 0 },
  { fieldKey: "just", estado: "obligatorio", displayOrder: 1 },
  { fieldKey: "prio", estado: "obligatorio", displayOrder: 2 },
  { fieldKey: "fecha", estado: "opcional", displayOrder: 3 },
  { fieldKey: "embarazo", estado: "opcional", displayOrder: 4 },
  { fieldKey: "alergias", estado: "opcional", displayOrder: 5 },
  { fieldKey: "creat", estado: "opcional", displayOrder: 6 },
  { fieldKey: "obs", estado: "oculto", displayOrder: 7 },
];

const RULES = [
  { ruleKey: "multi", enabled: true, valorNum: null },
  { ruleKey: "global", enabled: true, valorNum: null },
  { ruleKey: "codigo", enabled: false, valorNum: null },
  { ruleKey: "flags", enabled: true, valorNum: null },
  { ruleKey: "dupWarn", enabled: true, valorNum: null },
  { ruleKey: "firma", enabled: false, valorNum: null },
  { ruleKey: "maxN", enabled: false, valorNum: 10 },
];

/**
 * Radix `TabsTrigger` activa el tab en `onMouseDown` (no `onClick`) — ver
 * @radix-ui/react-tabs/dist/index.js. `fireEvent.click` no lo dispara.
 */
function clickTab(name: RegExp | string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

function renderModulo(roleCodes: string[] = ["ADMIN"]) {
  return render(
    <ToastProvider>
      <ModuloImagenes cuentaId="cuenta-1" roleCodes={roleCodes} deepLinkOrderId={null} />
      <ToastViewport />
    </ToastProvider>,
  );
}

describe("ModuloImagenes (CC-0016)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContextoCuenta.mockReturnValue({ ...idleQuery, data: CONTEXTO });
    mockResolverDeepLink.mockReturnValue({ ...idleQuery, data: undefined });
    mockOrderGet.mockReturnValue({ ...idleQuery, data: undefined });
    mockCatalogoList.mockReturnValue({ ...idleQuery, data: CATALOGO });
    mockCatalogoUpsert.mockImplementation(defaultMutationImpl);
    mockFieldConfigList.mockReturnValue({ ...idleQuery, data: FIELD_CONFIG });
    mockFieldConfigSet.mockImplementation(defaultMutationImpl);
    mockRulesList.mockReturnValue({ ...idleQuery, data: RULES });
    mockRulesSet.mockImplementation(defaultMutationImpl);
    mockCrear.mockImplementation(defaultMutationImpl);
    mockListarPorCuenta.mockReturnValue({ ...idleQuery, data: [] });
    mockDetalle.mockReturnValue({ ...idleQuery, data: undefined });
    mockPanelList.mockReturnValue({ ...idleQuery, data: [] });
    mockPanelUpdate.mockImplementation(defaultMutationImpl);
    mockPanelDeactivate.mockImplementation(defaultMutationImpl);
    mockPanelReactivate.mockImplementation(defaultMutationImpl);
    mockTestDeactivate.mockImplementation(defaultMutationImpl);
    mockTestReactivate.mockImplementation(defaultMutationImpl);
    mockModalityList.mockReturnValue({ ...idleQuery, data: [] });
  });

  afterEach(() => cleanup());

  it("muestra las 3 pestañas para ADMIN, ocultando Parametrización para roles sin ADMIN/DIR", () => {
    renderModulo(["ADMIN"]);
    expect(screen.getByRole("tab", { name: /Nueva Solicitud/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Solicitudes del paciente/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Parametrización/ })).toBeInTheDocument();

    cleanup();
    renderModulo(["PHYSICIAN"]);
    expect(screen.queryByRole("tab", { name: /Parametrización/ })).not.toBeInTheDocument();
  });

  it("Nueva Solicitud: categorías vienen de catalogoImagen.list y la selección agrega un chip + contador", () => {
    renderModulo();

    expect(screen.getByText(/Radiografías/)).toBeInTheDocument();
    expect(screen.getByText(/Tomografías/)).toBeInTheDocument();
    expect(screen.getByText("RX TORAX")).toBeInTheDocument();

    // Selecciona el checkbox asociado a "RX TORAX" (dentro de su <label>).
    const label = screen.getByText("RX TORAX").closest("label")!;
    fireEvent.click(within(label).getByRole("checkbox"));

    expect(screen.getByText(/Solicitud actual — 1 prestación\(es\)/)).toBeInTheDocument();
  });

  it("campos dinámicos: dx/just/prio obligatorios con asterisco, obs (oculto) no se renderiza", () => {
    renderModulo();
    expect(screen.getByText(/Diagnóstico presuntivo/)).toBeInTheDocument();
    expect(screen.queryByText(/Observaciones para el técnico/)).not.toBeInTheDocument();
    // Asterisco de obligatorio junto al label.
    const dxLabel = screen.getByText(/Diagnóstico presuntivo/).closest("label")!;
    expect(within(dxLabel).getByText("*")).toBeInTheDocument();
  });

  it("Guardar llama imagingRequest.crear con cuentaId + prestaciones + campos", () => {
    // "prio" se marca opcional para este caso: la interacción con el Select
    // de Radix (Portal + pointer events) no es fiable bajo jsdom — el resto
    // de la parametrización (dx/just obligatorios vía <input>/<textarea>
    // planos) sí se ejercita end-to-end.
    mockFieldConfigList.mockReturnValue({
      ...idleQuery,
      data: FIELD_CONFIG.map((f) => (f.fieldKey === "prio" ? { ...f, estado: "opcional" } : f)),
    });
    const mutate = vi.fn();
    mockCrear.mockImplementation(() => ({ mutate, isPending: false, error: null }));
    renderModulo();

    const label = screen.getByText("RX TORAX").closest("label")!;
    fireEvent.click(within(label).getByRole("checkbox"));

    fireEvent.change(screen.getByPlaceholderText("Ej. M54.5 — Lumbalgia"), {
      target: { value: "M54.5" },
    });
    fireEvent.change(screen.getByPlaceholderText("Describa el motivo clínico del estudio…"), {
      target: { value: "Dolor lumbar" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Guardar Prestaciones/ }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        cuentaId: "cuenta-1",
        prestaciones: [{ labTestId: "t1", conContraste: false }],
        dx: "M54.5",
        justificacion: "Dolor lumbar",
      }),
    );
    expect(mutate.mock.calls[0]![0]).not.toHaveProperty("prioridad");
  });

  it("Solicitudes del paciente: renderiza filas de listarPorCuenta", () => {
    mockListarPorCuenta.mockReturnValue({
      ...idleQuery,
      data: [
        {
          id: "req-1",
          folio: "SOL-2026-0001",
          fecha: new Date("2026-08-01"),
          categorias: "Radiografías",
          nPrestaciones: 1,
          prioridad: "ROUTINE",
          estado: "pend",
        },
      ],
    });
    renderModulo();
    clickTab(/Solicitudes del paciente/);
    expect(screen.getByText("SOL-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
  });

  it("Parametrización > Opciones de llenado: click en un estado llama fieldConfig.set", () => {
    const mutate = vi.fn();
    mockFieldConfigSet.mockImplementation(() => ({ mutate, isPending: false, error: null }));
    renderModulo();

    clickTab(/Parametrización/);
    clickTab(/Opciones de llenado/);

    const row = screen.getByText(/Fecha deseada del estudio/).closest("div")!.parentElement!;
    fireEvent.click(within(row).getByText("Oculto"));

    expect(mutate).toHaveBeenCalledWith({ fieldKey: "fecha", estado: "oculto" });
  });
});
