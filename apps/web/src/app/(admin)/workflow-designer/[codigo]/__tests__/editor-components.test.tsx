// @vitest-environment jsdom
/**
 * Tests unitarios — Workflow Designer Editor Core (US.F2.2.01-04)
 *
 * Estrategia: mock de React Flow (no renderizable en jsdom), tRPC, UI libs y next/link.
 * Los tests verifican comportamiento de componentes UI, lógica de paleta,
 * props panel y toolbar.
 *
 * @QA: Agregar E2E para happy paths completos (drag nodo, auto-layout visual,
 * persistencia BD) en workflow-designer-editor.spec.ts.
 */

import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// ─── Mocks de infraestructura ─────────────────────────────────────────────────

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    "aria-label": ariaLabel,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    "aria-label"?: string;
  }) => (
    <a href={href} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

// Mock tRPC — usa el alias "@" resuelto por vitest.config.ts
// Mock explícito para todos los namespaces usados por los componentes bajo test.
const mockMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockQuery = { data: undefined, isLoading: false };

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    workflowEstado: {
      estado: {
        update: { useMutation: vi.fn(() => mockMutation) },
        setLayout: { useMutation: vi.fn(() => mockMutation) },
        getLayout: { useQuery: vi.fn(() => mockQuery) },
        list: { useQuery: vi.fn(() => mockQuery) },
      },
    },
    workflowTransicion: {
      update: { useMutation: vi.fn(() => mockMutation) },
      list: { useQuery: vi.fn(() => mockQuery) },
    },
    workflowTipoDoc: {
      list: { useQuery: vi.fn(() => mockQuery) },
    },
  },
}));

// Mock de @his/ui components — no están en el resolve.alias del vitest.config.ts
vi.mock("@his/ui/components/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    className,
    "aria-label": ariaLabel,
    "data-testid": testId,
    type,
    size: _size,
    variant: _variant,
    asChild: _asChild,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    "aria-label"?: string;
    "data-testid"?: string;
    type?: "button" | "submit" | "reset";
    size?: string;
    variant?: string;
    asChild?: boolean;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={className}
      aria-label={ariaLabel}
      data-testid={testId}
      type={type ?? "button"}
    >
      {children}
    </button>
  ),
}));

vi.mock("@his/ui/components/badge", () => ({
  Badge: ({
    children,
    className,
    variant: _variant,
    "aria-label": ariaLabel,
  }: {
    children: React.ReactNode;
    className?: string;
    variant?: string;
    "aria-label"?: string;
  }) => (
    <span className={className} aria-label={ariaLabel}>
      {children}
    </span>
  ),
}));

// ─── Importar componentes bajo test (DESPUÉS de los mocks) ───────────────────

import {
  EditorPalette,
  type PaletteEstadoTipo,
} from "../_components/editor-palette";
import {
  EditorPropsPanel,
  type EstadoNodeData,
  type TransicionEdgeData,
} from "../_components/editor-props-panel";
import { EditorToolbar } from "../_components/editor-toolbar";

// ─── EditorPalette ────────────────────────────────────────────────────────────

describe("EditorPalette", () => {
  afterEach(() => cleanup());

  it("renderiza todos los tipos de elemento", () => {
    render(<EditorPalette tiposPresentes={[]} />);
    expect(screen.getByText("Estado Inicial")).toBeInTheDocument();
    expect(screen.getByText("Estado Intermedio")).toBeInTheDocument();
    expect(screen.getByText("Estado Final (OK)")).toBeInTheDocument();
    expect(screen.getByText("Estado Final (KO)")).toBeInTheDocument();
    expect(screen.getByText("Esperando Firma")).toBeInTheDocument();
  });

  it("muestra 'Ya existe en el canvas' cuando INICIAL ya está presente", () => {
    const tiposPresentes: PaletteEstadoTipo[] = ["INICIAL"];
    render(<EditorPalette tiposPresentes={tiposPresentes} />);
    expect(screen.getByText("Ya existe en el canvas")).toBeInTheDocument();
  });

  it("filtra elementos por texto de búsqueda", () => {
    render(<EditorPalette tiposPresentes={[]} />);
    const searchInput = screen.getByRole("searchbox");
    fireEvent.change(searchInput, { target: { value: "Firma" } });
    expect(screen.getByText("Esperando Firma")).toBeInTheDocument();
    expect(screen.queryByText("Estado Inicial")).not.toBeInTheDocument();
  });

  it("muestra 'Sin resultados' cuando no hay coincidencias", () => {
    render(<EditorPalette tiposPresentes={[]} />);
    const searchInput = screen.getByRole("searchbox");
    fireEvent.change(searchInput, { target: { value: "zzz_inexistente" } });
    expect(screen.getByText("Sin resultados.")).toBeInTheDocument();
  });

  it("en modo readOnly muestra nota de solo lectura", () => {
    render(<EditorPalette tiposPresentes={[]} readOnly />);
    expect(screen.getByText(/Modo solo lectura/i)).toBeInTheDocument();
  });

  it("el elemento INICIAL bloqueado tiene aria-disabled=true", () => {
    render(<EditorPalette tiposPresentes={["INICIAL"]} />);
    // El item bloqueado tiene aria-disabled="true" como string
    const listItems = screen.getAllByRole("listitem");
    const blockedItem = listItems.find(
      (el) => el.getAttribute("aria-disabled") === "true",
    );
    expect(blockedItem).toBeDefined();
  });

  it("la paleta tiene landmark de navegación accesible", () => {
    render(<EditorPalette tiposPresentes={[]} />);
    const aside = screen.getByRole("complementary", { name: /Paleta/i });
    expect(aside).toBeInTheDocument();
  });
});

// ─── EditorPropsPanel — nodo ─────────────────────────────────────────────────

describe("EditorPropsPanel — selección de nodo", () => {
  afterEach(() => cleanup());

  const estadoData: EstadoNodeData = {
    id: "uuid-estado-1",
    codigo: "BORRADOR",
    nombre: "Borrador",
    es_inicial: true,
    es_final: false,
    orden: 1,
  };

  it("muestra el código del estado", () => {
    render(
      <EditorPropsPanel
        selection={{ kind: "node", data: estadoData }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText("BORRADOR")).toBeInTheDocument();
  });

  it("muestra tipo INICIAL cuando es_inicial=true", () => {
    render(
      <EditorPropsPanel
        selection={{ kind: "node", data: estadoData }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText("INICIAL")).toBeInTheDocument();
  });

  it("muestra tipo FINAL para estado final", () => {
    const finalEstado: EstadoNodeData = { ...estadoData, es_inicial: false, es_final: true };
    render(
      <EditorPropsPanel
        selection={{ kind: "node", data: finalEstado }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText("FINAL")).toBeInTheDocument();
  });

  it("botón Cerrar llama onClose", () => {
    const onClose = vi.fn();
    render(
      <EditorPropsPanel
        selection={{ kind: "node", data: estadoData }}
        onClose={onClose}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cerrar panel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("en modo readOnly no muestra input de nombre editable", () => {
    render(
      <EditorPropsPanel
        selection={{ kind: "node", data: estadoData }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        readOnly
      />,
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Borrador")).toBeInTheDocument();
  });

  it("retorna null cuando no hay selección", () => {
    const { container } = render(
      <EditorPropsPanel selection={null} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ─── EditorPropsPanel — arista ────────────────────────────────────────────────

describe("EditorPropsPanel — selección de arista", () => {
  afterEach(() => cleanup());

  const transicionData: TransicionEdgeData = {
    id: "uuid-transicion-1",
    accion: "firmar",
    estado_origen_id: "uuid-origen",
    estado_destino_id: "uuid-destino",
    requiere_firma: true,
    rol_codigo: "MC",
  };

  it("muestra la acción de la transición", () => {
    render(
      <EditorPropsPanel
        selection={{ kind: "edge", data: transicionData }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText("firmar")).toBeInTheDocument();
  });

  it("muestra el rol requerido MC", () => {
    render(
      <EditorPropsPanel
        selection={{ kind: "edge", data: transicionData }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText("MC")).toBeInTheDocument();
  });

  it("checkbox de firma está marcado cuando requiere_firma=true", () => {
    render(
      <EditorPropsPanel
        selection={{ kind: "edge", data: transicionData }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    const checkbox = screen.getByRole("checkbox", { name: /firma electrónica/i });
    expect(checkbox).toBeChecked();
  });

  it("checkbox de firma NO está marcado cuando requiere_firma=false", () => {
    const sinFirma: TransicionEdgeData = { ...transicionData, requiere_firma: false };
    render(
      <EditorPropsPanel
        selection={{ kind: "edge", data: sinFirma }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    const checkbox = screen.getByRole("checkbox", { name: /firma electrónica/i });
    expect(checkbox).not.toBeChecked();
  });
});

// ─── EditorToolbar ────────────────────────────────────────────────────────────

describe("EditorToolbar", () => {
  afterEach(() => cleanup());

  it("llama onAutoLayout al hacer click en Auto-layout", () => {
    const onAutoLayout = vi.fn();
    render(
      <EditorToolbar
        tipoDocNombre="Historia Clínica"
        tipoDocCodigo="HC"
        readOnly={false}
        onAutoLayout={onAutoLayout}
        onFitView={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("auto-layout-btn"));
    expect(onAutoLayout).toHaveBeenCalledOnce();
  });

  it("llama onFitView al hacer click en Encuadrar", () => {
    const onFitView = vi.fn();
    render(
      <EditorToolbar
        tipoDocNombre="Historia Clínica"
        tipoDocCodigo="HC"
        readOnly={false}
        onAutoLayout={vi.fn()}
        onFitView={onFitView}
      />,
    );
    fireEvent.click(screen.getByTestId("fit-view-btn"));
    expect(onFitView).toHaveBeenCalledOnce();
  });

  it("oculta el botón Auto-layout en modo readOnly", () => {
    render(
      <EditorToolbar
        tipoDocNombre="Historia Clínica"
        tipoDocCodigo="HC"
        readOnly
        onAutoLayout={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("auto-layout-btn")).not.toBeInTheDocument();
  });

  it("muestra badge 'Solo lectura' en modo readOnly", () => {
    render(
      <EditorToolbar
        tipoDocNombre="HC"
        tipoDocCodigo="HC"
        readOnly
        onAutoLayout={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
    expect(screen.getByText("Solo lectura")).toBeInTheDocument();
  });

  it("muestra el nombre del tipo de documento en el breadcrumb", () => {
    render(
      <EditorToolbar
        tipoDocNombre="Epicrisis NTEC"
        tipoDocCodigo="EPICRISIS"
        readOnly={false}
        onAutoLayout={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
    expect(screen.getByText("Epicrisis NTEC")).toBeInTheDocument();
  });

  it("el botón Encuadrar es visible siempre (modo edición y readOnly)", () => {
    render(
      <EditorToolbar
        tipoDocNombre="HC"
        tipoDocCodigo="HC"
        readOnly
        onAutoLayout={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
    expect(screen.getByTestId("fit-view-btn")).toBeInTheDocument();
  });
});
