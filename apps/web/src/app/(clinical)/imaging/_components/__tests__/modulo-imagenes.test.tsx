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
// CC-0041
const mockContextoExpediente = vi.fn();
const mockSupervision = vi.fn();
const mockSlaList = vi.fn();
const mockSlaUpsert = vi.fn();
const mockCie11Estado = vi.fn();
const mockCie11Buscar = vi.fn();
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
    sla: { list: { invalidate: mockInvalidate } },
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
      // CC-0041
      contextoExpediente: { useQuery: (...args: unknown[]) => mockContextoExpediente(...args) },
      supervision: { useQuery: (...args: unknown[]) => mockSupervision(...args) },
      sla: {
        list: { useQuery: (...args: unknown[]) => mockSlaList(...args) },
        upsert: { useMutation: (opts?: unknown) => mockSlaUpsert(opts) },
      },
    },
    cie11: {
      estado: { useQuery: (...args: unknown[]) => mockCie11Estado(...args) },
      buscar: { useQuery: (...args: unknown[]) => mockCie11Buscar(...args) },
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
    // Con tildes a propósito — RF-02 exige búsqueda insensible a tildes.
    name: "TOMOGRAFÍA CRÁNEO",
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
  // CC-0041 RF-06 — embarazo es obligatorio siempre.
  { fieldKey: "embarazo", estado: "obligatorio", displayOrder: 4 },
  { fieldKey: "alergias", estado: "opcional", displayOrder: 5 },
  { fieldKey: "creat", estado: "opcional", displayOrder: 6 },
  { fieldKey: "obs", estado: "oculto", displayOrder: 7 },
];

// CC-0041 — contexto del expediente (sexo F por defecto: embarazo editable).
const EXPEDIENTE = {
  sexo: "F",
  alergias: "Penicilina (rash)",
  diagnosticos: [
    {
      codigo: "ME84.2",
      descripcion: "Dolor de la región lumbar",
      sistema: "CIE11",
      fuente: "Historia Clínica — 15/09/2026",
      origenId: "hc-1",
    },
  ],
};

const SUPERVISION_VACIA = {
  kpis: { total: 0, enTiempo: 0, porVencer: 0, vencidos: 0, cumplidosATiempo: 0, cumplidosTarde: 0 },
  rows: [],
};

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
    // CC-0041
    mockContextoExpediente.mockReturnValue({ ...idleQuery, data: EXPEDIENTE });
    mockSupervision.mockReturnValue({ ...idleQuery, data: SUPERVISION_VACIA });
    mockSlaList.mockReturnValue({
      ...idleQuery,
      data: [
        { priority: "STAT", slaMinutes: 60, warningMinutes: 15, esDefault: true },
        { priority: "URGENT", slaMinutes: 240, warningMinutes: 30, esDefault: true },
        { priority: "ROUTINE", slaMinutes: 1440, warningMinutes: 60, esDefault: true },
      ],
    });
    mockSlaUpsert.mockImplementation(defaultMutationImpl);
    mockCie11Estado.mockReturnValue({ ...idleQuery, data: { configured: false } });
    mockCie11Buscar.mockReturnValue({ ...idleQuery, data: { configured: false, items: [] }, isFetching: false });
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

  it("Guardar llama imagingRequest.crear con cuentaId + prestaciones + campos + embarazo automático (sexo M)", () => {
    // "prio" y "dx" se marcan opcionales para este caso: la interacción con
    // los Select de Radix (Portal + pointer events) no es fiable bajo jsdom —
    // "just" (textarea plano) sí se ejercita end-to-end. Sexo M ⇒ embarazo
    // «No aplica» automático (RF-06), así el obligatorio queda satisfecho.
    mockContextoExpediente.mockReturnValue({ ...idleQuery, data: { ...EXPEDIENTE, sexo: "M" } });
    mockFieldConfigList.mockReturnValue({
      ...idleQuery,
      data: FIELD_CONFIG.map((f) =>
        f.fieldKey === "prio" || f.fieldKey === "dx" ? { ...f, estado: "opcional" } : f,
      ),
    });
    const mutate = vi.fn();
    mockCrear.mockImplementation(() => ({ mutate, isPending: false, error: null }));
    renderModulo();

    const label = screen.getByText("RX TORAX").closest("label")!;
    fireEvent.click(within(label).getByRole("checkbox"));

    fireEvent.change(screen.getByPlaceholderText("Describa el motivo clínico del estudio…"), {
      target: { value: "Dolor lumbar" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Guardar Prestaciones/ }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        cuentaId: "cuenta-1",
        prestaciones: [{ labTestId: "t1", conContraste: false }],
        justificacion: "Dolor lumbar",
        embarazo: "No aplica",
      }),
    );
    expect(mutate.mock.calls[0]![0]).not.toHaveProperty("prioridad");
    // RF-07 — alergias no viajan: el server toma el snapshot de la HC.
    expect(mutate.mock.calls[0]![0]).not.toHaveProperty("alergias");
  });

  // ─── CC-0041 (mockup v2) ────────────────────────────────────────────────

  it("CC-0041 RF-04/RF-05: prioridad segmentada con colores; la fecha solo aparece con Rutina", () => {
    renderModulo();

    // Sin prioridad elegida no hay campo fecha.
    expect(screen.queryByLabelText(/Fecha de la solicitud/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("img-prio-Rutina"));
    expect(screen.getByLabelText(/Fecha de la solicitud/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("img-prio-STAT"));
    expect(screen.queryByLabelText(/Fecha de la solicitud/)).not.toBeInTheDocument();
    // Botón STAT activo con el color rojo del patrón.
    expect(screen.getByTestId("img-prio-STAT")).toHaveStyle({ backgroundColor: "#fee2e2" });
    // Aviso de notificación inmediata a Imagenología.
    expect(screen.getByText(/Prioridad STAT: se notificará de inmediato/)).toBeInTheDocument();
  });

  it("CC-0041 RF-06: sexo masculino bloquea embarazo en «No aplica»", () => {
    mockContextoExpediente.mockReturnValue({ ...idleQuery, data: { ...EXPEDIENTE, sexo: "M" } });
    renderModulo();

    const select = screen.getByTestId("img-embarazo-select");
    expect(select).toBeDisabled();
    expect(select).toHaveTextContent("No aplica");
    expect(screen.getByText(/el sistema asigna «No aplica» por defecto/)).toBeInTheDocument();
  });

  it("CC-0041 RF-07: alergias prellenadas desde la Historia Clínica y solo lectura", () => {
    renderModulo();
    const input = screen.getByLabelText(/Alergias conocidas/) as HTMLInputElement;
    expect(input).toHaveValue("Penicilina (rash)");
    expect(input).toHaveAttribute("readonly");

    cleanup();
    mockContextoExpediente.mockReturnValue({ ...idleQuery, data: { ...EXPEDIENTE, alergias: null } });
    renderModulo();
    expect(screen.getByLabelText(/Alergias conocidas/)).toHaveValue(
      "Sin alergias registradas en Historia Clínica",
    );
  });

  it("CC-0041 RF-08: seleccionar estudio con contraste muestra el rótulo y bloquea guardar sin creatinina", () => {
    mockContextoExpediente.mockReturnValue({ ...idleQuery, data: { ...EXPEDIENTE, sexo: "M" } });
    mockFieldConfigList.mockReturnValue({
      ...idleQuery,
      data: FIELD_CONFIG.map((f) =>
        f.fieldKey === "prio" || f.fieldKey === "dx" ? { ...f, estado: "opcional" } : f,
      ),
    });
    const mutate = vi.fn();
    mockCrear.mockImplementation(() => ({ mutate, isPending: false, error: null }));
    renderModulo();

    // Cambia a la categoría Tomografías y marca el estudio con contraste.
    fireEvent.click(screen.getByRole("button", { name: /Tomografías/ }));
    const label = screen.getByText("TOMOGRAFÍA CRÁNEO").closest("label")!;
    fireEvent.click(within(label).getByRole("checkbox"));

    expect(screen.getByTestId("img-creat-req")).toHaveTextContent("obligatoria — hay estudio(s) con contraste");

    fireEvent.change(screen.getByPlaceholderText("Describa el motivo clínico del estudio…"), {
      target: { value: "Cefalea" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Guardar Prestaciones/ }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/creatinina sérica es obligatoria/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Creatinina sérica/), { target: { value: "0.9" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar Prestaciones/ }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ creatinina: "0.9" }));
  });

  it("CC-0041 RF-02: «Buscar por Nombre» busca en todas las categorías sin tildes y muestra la categoría de origen", () => {
    renderModulo();

    fireEvent.click(screen.getByRole("switch", { name: /Buscar por Nombre/ }));
    // Sin query: mensaje guía, no lista.
    expect(screen.getByText(/buscar en todas las categorías/i)).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText(/Escriba el nombre de la prestación/),
      { target: { value: "tomografia craneo" } }, // sin tildes
    );
    const item = screen.getByText("TOMOGRAFÍA CRÁNEO").closest("label")!;
    expect(within(item).getByText("Tomografías")).toBeInTheDocument();
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

    const row = screen.getByText(/Fecha de la solicitud \(programación\)/).closest("div")!.parentElement!;
    fireEvent.click(within(row).getByText("Oculto"));

    expect(mutate).toHaveBeenCalledWith({ fieldKey: "fecha", estado: "oculto" });
  });
});
