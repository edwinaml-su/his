// @vitest-environment jsdom
/**
 * Tests de <LabMaintenance> — Rediseño lab 2026-09 (mantenimiento de
 * catálogos, área LABORATORIO de `/catalogs/laboratorio`).
 *
 * Estrategia: mismo patrón que `../../__tests__/page.test.tsx` (mock de
 * `@/lib/trpc/react`, sin DB). Fuente de comportamiento: `#mantScreen` de
 * `design/mockup/mockup_examenes_laboratorio.html`.
 *
 * Los mocks de mutation devuelven un `mutate` **estable** (memoizado en
 * `makeMutationMock`, no uno nuevo por render) — a diferencia del patrón de
 * `page.test.tsx` (`mock.results.at(-1)`), que asume que el último render
 * capturado antes del click es el que atiende el submit. Ese supuesto no
 * se sostiene aquí: la señal "+ Nuevo" (`newSignal`) dispara una cadena de
 * dos efectos anidados (padre → hijo → propio `useEffect` de reset del
 * formulario) que producen más recommits de los que un capture-then-click
 * ingenuo puede rastrear de forma fiable. Un spy estable por mutation
 * elimina la carrera por completo.
 *
 * Casos cubiertos:
 *   1. Toolbar: contador + 4 sub-tabs con testids.
 *   2. Tabla de Pruebas: filas + búsqueda.
 *   3. Tabla de Secciones/Tipos/Subtipos: conteos derivados de `catalog.cascada`.
 *   4. "+ Nueva prueba"/"+ Nueva sección": dialog contextual, código autogenerado.
 *   5. Editar sección (prefill + update).
 *   6. Eliminar (desactivar) con `window.confirm`.
 *   7. Modal de parámetros: listar/agregar/CONFLICT.
 *   8. Exportar: dispara `catalogo.export.fetch`.
 *   9. Importar: JSON válido dispara `catalogo.import.mutate`; JSON inválido
 *      muestra error sin llamar al backend.
 *
 * @QA — E2E (Playwright): interacción real con los Select en cascada
 * (Sección→Tipo→Subtipo) contra Supabase — Radix Select no se ejercita aquí
 * (abrir su popover requiere `scrollIntoView`/`hasPointerCapture`, no
 * polyfilled en este proyecto); los formularios se prueban enviando con los
 * valores prefijados por defecto, que ya cubre la lógica de payload.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, waitFor, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TooltipProvider } from "@his/ui/components/tooltip";
import { ToastProvider, ToastViewport } from "@his/ui/components/toast";

// ─── Fixtures (shape de `lis.catalog.cascada`) — ids UUID reales: los inputs
// de los formularios se validan con `z.string().uuid()` en `@his/contracts`. ─

const TIPO_SANGRE = { id: "11111111-1111-1111-1111-111111111111", name: "SANGRE", displayOrder: 0, testCount: 1 };
const TIPO_ORINA = { id: "22222222-2222-2222-2222-222222222222", name: "ORINA", displayOrder: 1, testCount: 0 };
const SUB_VENOSA = {
  id: "33333333-3333-3333-3333-333333333333",
  sampleTypeId: TIPO_SANGRE.id,
  name: "VENOSA",
  displayOrder: 0,
  testCount: 1,
};
const SEC_QUIMICA = { id: "44444444-4444-4444-4444-444444444444", name: "QUIMICA CLINICA", displayOrder: 0, testCount: 1 };
const PRUEBA_GLUCOSA = {
  id: "55555555-5555-5555-5555-555555555555",
  name: "GLUCOSA",
  panelId: SEC_QUIMICA.id,
  sampleTypeId: TIPO_SANGRE.id,
  sampleSubtypeId: SUB_VENOSA.id,
  defaultQty: 1,
  paramCount: 0,
};

const cascadaFixture = {
  tipos: [TIPO_SANGRE, TIPO_ORINA],
  subtipos: [SUB_VENOSA],
  secciones: [SEC_QUIMICA],
  pruebas: [PRUEBA_GLUCOSA],
};

// ─── Mock tRPC ──────────────────────────────────────────────────────────────

const mockCascadaQuery = vi.fn();
const mockParamListQuery = vi.fn();

interface MutationOpts {
  onSuccess?: (res?: unknown) => void;
  onError?: (e: { message: string }) => void;
}

/**
 * `mutate`/`mutateAsync` son spies ÚNICOS y estables para toda la vida del
 * test (no uno nuevo por render) — ver nota de cabecera. `hook` es lo que se
 * conecta a `useMutation` en el mock; su último `opts` (para invocar
 * `onSuccess`/`onError` manualmente) se lee con `hook.mock.calls.at(-1)`.
 */
function makeMutationMock() {
  const mutate = vi.fn();
  const mutateAsync = vi.fn();
  const hook = vi.fn((_opts?: MutationOpts) => ({ mutate, mutateAsync, isPending: false }));
  return { hook, mutate, mutateAsync };
}

const testCreateM = makeMutationMock();
const testUpdateM = makeMutationMock();
const testDeactivateM = makeMutationMock();
const panelCreateM = makeMutationMock();
const panelUpdateM = makeMutationMock();
const panelDeactivateM = makeMutationMock();
const sampleTypeCreateM = makeMutationMock();
const sampleTypeUpdateM = makeMutationMock();
const sampleSubtypeCreateM = makeMutationMock();
const sampleSubtypeUpdateM = makeMutationMock();
const paramAddM = makeMutationMock();
const paramRemoveM = makeMutationMock();
const catalogoImportM = makeMutationMock();

const mockExportFetch = vi.fn().mockResolvedValue({ secciones: [], tipos: [], subtipos: {}, pruebas: [] });
const mockCascadaInvalidate = vi.fn();
const mockParamListInvalidate = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    lis: {
      catalog: {
        cascada: { useQuery: (...args: unknown[]) => mockCascadaQuery(...args) },
      },
      catalogo: {
        import: { useMutation: (opts?: MutationOpts) => catalogoImportM.hook(opts) },
      },
      test: {
        create: { useMutation: (opts?: MutationOpts) => testCreateM.hook(opts) },
        update: { useMutation: (opts?: MutationOpts) => testUpdateM.hook(opts) },
        deactivate: { useMutation: (opts?: MutationOpts) => testDeactivateM.hook(opts) },
      },
      panel: {
        create: { useMutation: (opts?: MutationOpts) => panelCreateM.hook(opts) },
        update: { useMutation: (opts?: MutationOpts) => panelUpdateM.hook(opts) },
        deactivate: { useMutation: (opts?: MutationOpts) => panelDeactivateM.hook(opts) },
      },
      sampleType: {
        create: { useMutation: (opts?: MutationOpts) => sampleTypeCreateM.hook(opts) },
        update: { useMutation: (opts?: MutationOpts) => sampleTypeUpdateM.hook(opts) },
      },
      sampleSubtype: {
        create: { useMutation: (opts?: MutationOpts) => sampleSubtypeCreateM.hook(opts) },
        update: { useMutation: (opts?: MutationOpts) => sampleSubtypeUpdateM.hook(opts) },
      },
      testParameter: {
        list: { useQuery: (...args: unknown[]) => mockParamListQuery(...args) },
        add: { useMutation: (opts?: MutationOpts) => paramAddM.hook(opts) },
        remove: { useMutation: (opts?: MutationOpts) => paramRemoveM.hook(opts) },
      },
    },
    useUtils: () => ({
      lis: {
        catalog: { cascada: { invalidate: mockCascadaInvalidate } },
        catalogo: { export: { fetch: mockExportFetch } },
        testParameter: { list: { invalidate: mockParamListInvalidate } },
      },
    }),
  },
}));

import { LabMaintenance } from "../lab-maintenance";

const idleQuery = { data: undefined, isLoading: false, error: null };

function renderMaintenance() {
  return render(
    <ToastProvider>
      <TooltipProvider>
        <LabMaintenance />
      </TooltipProvider>
      <ToastViewport />
    </ToastProvider>,
  );
}

/** Radix `TabsTrigger` activa en `onMouseDown`, no `onClick` (ver page.test.tsx). */
function clickTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

const ALL_MUTATIONS = [
  testCreateM,
  testUpdateM,
  testDeactivateM,
  panelCreateM,
  panelUpdateM,
  panelDeactivateM,
  sampleTypeCreateM,
  sampleTypeUpdateM,
  sampleSubtypeCreateM,
  sampleSubtypeUpdateM,
  paramAddM,
  paramRemoveM,
  catalogoImportM,
];

describe("LabMaintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCascadaQuery.mockReturnValue({ ...idleQuery, data: cascadaFixture });
    mockParamListQuery.mockReturnValue({ ...idleQuery, data: [] });
    mockExportFetch.mockResolvedValue({ secciones: [], tipos: [], subtipos: {}, pruebas: [] });
    for (const m of ALL_MUTATIONS) {
      m.hook.mockImplementation((_opts?: MutationOpts) => ({
        mutate: m.mutate,
        mutateAsync: m.mutateAsync,
        isPending: false,
      }));
    }
  });

  afterEach(() => {
    cleanup();
  });

  // ── 1. Toolbar: contador + 4 sub-tabs ─────────────────────────────────────

  it("muestra el contador del toolbar y los 4 sub-tabs con testid", () => {
    renderMaintenance();

    expect(screen.getByTestId("lab-mant-tab-pruebas")).toBeInTheDocument();
    expect(screen.getByTestId("lab-mant-tab-secciones")).toBeInTheDocument();
    expect(screen.getByTestId("lab-mant-tab-tipos")).toBeInTheDocument();
    expect(screen.getByTestId("lab-mant-tab-subtipos")).toBeInTheDocument();

    // "1 pruebas · 1 secciones · 2 tipos · 1 subtipos · 0 parámetros"
    expect(
      screen.getByText((_, el) => el?.textContent === "1 pruebas · 1 secciones · 2 tipos · 1 subtipos · 0 parámetros"),
    ).toBeInTheDocument();
  });

  // ── 2. Tabla de Pruebas + búsqueda ─────────────────────────────────────────

  it("muestra las pruebas y filtra con la búsqueda del toolbar", () => {
    renderMaintenance();

    expect(screen.getAllByTestId("lab-mant-row")).toHaveLength(1);
    expect(screen.getByText("GLUCOSA")).toBeInTheDocument();
    expect(screen.getByText("QUIMICA CLINICA")).toBeInTheDocument();
    expect(screen.getByText("SANGRE")).toBeInTheDocument();
    expect(screen.getByText("VENOSA")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("lab-mant-search"), { target: { value: "POTASIO" } });
    expect(screen.getByText("Sin resultados.")).toBeInTheDocument();
  });

  // ── 3. Secciones/Tipos/Subtipos: conteos de catalog.cascada ───────────────

  it("Secciones: muestra el conteo de pruebas por sección", () => {
    renderMaintenance();
    clickTab("Secciones");

    const rows = screen.getAllByTestId("lab-mant-row");
    expect(rows).toHaveLength(1);
    const cells = within(rows[0]!).getAllByRole("cell");
    // # / Sección / Pruebas / Acciones
    expect(cells[1]).toHaveTextContent("QUIMICA CLINICA");
    expect(cells[2]).toHaveTextContent("1");
  });

  it("Tipos de muestra: muestra conteo de subtipos y pruebas por tipo", () => {
    renderMaintenance();
    clickTab("Tipos de muestra");

    const rows = screen.getAllByTestId("lab-mant-row");
    expect(rows).toHaveLength(2);
    // # / Tipo / Subtipos / Pruebas / Acciones — SANGRE tiene 1 subtipo (VENOSA) y 1 prueba (GLUCOSA).
    const sangreCells = within(rows[0]!).getAllByRole("cell");
    expect(sangreCells[1]).toHaveTextContent("SANGRE");
    expect(sangreCells[2]).toHaveTextContent("1");
    expect(sangreCells[3]).toHaveTextContent("1");
    // ORINA no tiene subtipos ni pruebas.
    const orinaCells = within(rows[1]!).getAllByRole("cell");
    expect(orinaCells[1]).toHaveTextContent("ORINA");
    expect(orinaCells[2]).toHaveTextContent("0");
    expect(orinaCells[3]).toHaveTextContent("0");
  });

  it("Subtipos de muestra: fila plana con el nombre del tipo padre", () => {
    renderMaintenance();
    clickTab("Subtipos de muestra");

    const rows = screen.getAllByTestId("lab-mant-row");
    expect(rows).toHaveLength(1);
    const cells = within(rows[0]!).getAllByRole("cell");
    // # / Subtipo / Tipo / Pruebas / Acciones
    expect(cells[1]).toHaveTextContent("VENOSA");
    expect(cells[2]).toHaveTextContent("SANGRE");
    expect(cells[3]).toHaveTextContent("1");
  });

  // ── 4. "+ Nuevo" contextual ────────────────────────────────────────────────

  it("'+ Nueva prueba' abre el dialog con Sección/Tipo/Subtipo prefijados y envía el create", () => {
    renderMaintenance();

    fireEvent.click(screen.getByTestId("lab-mant-new"));
    expect(screen.getByRole("heading", { name: "Nueva prueba" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Nombre de la prueba/), { target: { value: "POTASIO" } });
    // Requerimiento 2026-09-09: el precio del servicio se define en el mismo form.
    fireEvent.change(screen.getByLabelText(/Precio estándar/), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(testCreateM.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        panelId: SEC_QUIMICA.id,
        name: "POTASIO",
        sampleTypeId: TIPO_SANGRE.id,
        sampleSubtypeId: SUB_VENOSA.id,
        defaultQty: 1,
        standardPrice: 12.5,
        code: expect.stringMatching(/^LABMANT-/),
      }),
    );
  });

  it("'+ Nueva sección' (tab Secciones) envía panel.create con área LABORATORIO y código autogenerado", () => {
    renderMaintenance();
    clickTab("Secciones");

    fireEvent.click(screen.getByTestId("lab-mant-new"));
    expect(screen.getByRole("heading", { name: "Nueva sección" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Nombre de la sección/), { target: { value: "MICROBIOLOGIA" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(panelCreateM.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "MICROBIOLOGIA",
        area: "LABORATORIO",
        code: expect.stringMatching(/^SECMANT-/),
      }),
    );
  });

  // ── 5. Editar sección ──────────────────────────────────────────────────────

  it("Editar sección: prefija el nombre y envía panel.update", () => {
    renderMaintenance();
    clickTab("Secciones");

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.getByRole("heading", { name: "Editar sección" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre de la sección/)).toHaveValue("QUIMICA CLINICA");

    fireEvent.change(screen.getByLabelText(/Nombre de la sección/), { target: { value: "QUIMICA CLINICA II" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(panelUpdateM.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: SEC_QUIMICA.id, name: "QUIMICA CLINICA II" }),
    );
  });

  // ── 6. Eliminar (desactivar) con confirm ───────────────────────────────────

  it("Eliminar prueba: pide confirm y solo llama a test.deactivate si se confirma", () => {
    renderMaintenance();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(testDeactivateM.mutate).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(testDeactivateM.mutate).toHaveBeenCalledWith({ id: PRUEBA_GLUCOSA.id });

    confirmSpy.mockRestore();
  });

  // ── 7. Modal de parámetros ──────────────────────────────────────────────────

  it("modal de parámetros: lista, agrega (Enter) y muestra CONFLICT del backend", () => {
    mockParamListQuery.mockReturnValue({
      ...idleQuery,
      data: [{ id: "param1", labTestId: PRUEBA_GLUCOSA.id, name: "AYUNAS", displayOrder: 0 }],
    });
    renderMaintenance();

    fireEvent.click(screen.getByRole("button", { name: /0 · Configurar/ }));
    expect(screen.getByTestId("lab-param-modal")).toBeInTheDocument();
    expect(mockParamListQuery).toHaveBeenCalledWith(
      { labTestId: PRUEBA_GLUCOSA.id },
      expect.objectContaining({ enabled: true }),
    );
    expect(screen.getByText("AYUNAS")).toBeInTheDocument();

    const input = screen.getByPlaceholderText("Nuevo parámetro...");
    fireEvent.change(input, { target: { value: "GLICEMIA POST" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(paramAddM.mutate).toHaveBeenCalledWith({ labTestId: PRUEBA_GLUCOSA.id, name: "GLICEMIA POST" });

    const onError = paramAddM.hook.mock.calls.at(-1)?.[0]?.onError as (e: { message: string }) => void;
    act(() => {
      onError({ message: "Ese parámetro ya existe en la prueba." });
    });
    expect(screen.getByText("Ese parámetro ya existe en la prueba.")).toBeInTheDocument();
  });

  // ── 8. Exportar ──────────────────────────────────────────────────────────────

  it("Exportar dispara catalogo.export.fetch", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();

    renderMaintenance();
    fireEvent.click(screen.getByTestId("lab-export-btn"));

    await waitFor(() => expect(mockExportFetch).toHaveBeenCalled());

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  // ── 9. Importar ────────────────────────────────────────────────────────────

  it("Importar: un JSON válido dispara catalogo.import.mutate", async () => {
    renderMaintenance();

    const payload = { secciones: ["QUIMICA"], tipos: ["SANGRE"], subtipos: {}, pruebas: [] };
    const file = new File([JSON.stringify(payload)], "catalogo.json", { type: "application/json" });
    const input = screen.getByTestId("lab-import-input") as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(catalogoImportM.mutate).toHaveBeenCalledWith(payload));
  });

  it("Importar: un archivo no-JSON muestra el error sin llamar al backend", async () => {
    renderMaintenance();

    const file = new File(["esto no es json"], "catalogo.json", { type: "application/json" });
    const input = screen.getByTestId("lab-import-input") as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(
        screen.getByText("Archivo no válido. Debe ser un JSON exportado desde este catálogo."),
      ).toBeInTheDocument(),
    );
    expect(catalogoImportM.mutate).not.toHaveBeenCalled();
  });
});
