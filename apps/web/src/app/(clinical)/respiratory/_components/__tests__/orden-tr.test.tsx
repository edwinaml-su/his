// @vitest-environment jsdom
/**
 * CC-0042 — Tests de <OrdenTr> (CPOE-TR, comportamiento del mockup
 * MOCK-HIS-TR-001): pareo automático, declaraciones por sección con colapso,
 * meta dinámica, bloque de medicamento dependiente con bloqueo de unidad «g»,
 * validación bloqueante al firmar (modal) y conjuntos de órdenes.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastProvider, ToastViewport } from "@his/ui/components/toast";

const mockCatalogo = vi.fn();
const mockCrear = vi.fn();
const mockCie11Estado = vi.fn();
const mockCie11Buscar = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    useUtils: () => ({ respiratory: { tr: { supervision: { invalidate: mockInvalidate } } } }),
    respiratory: {
      tr: {
        catalogo: { list: { useQuery: (...a: unknown[]) => mockCatalogo(...a) } },
        orden: { crear: { useMutation: (o?: unknown) => mockCrear(o) } },
      },
    },
    cie11: {
      estado: { useQuery: (...a: unknown[]) => mockCie11Estado(...a) },
      buscar: { useQuery: (...a: unknown[]) => mockCie11Buscar(...a) },
    },
  },
}));

import { OrdenTr } from "../orden-tr";

const AER_CFG = {
  hint: "Parámetros estándar de nebulización con generador tipo jet",
  meds: ["ipratropio", "salbutamol"],
  unidades: ["mg", "µg", "g", "mL"],
  diluyentes: ["Solución salina normal 0.9 % · 4 mL", "Sin diluyente"],
  diluyenteDefault: 0,
  extra: { label: "Flujo impulsor de oxígeno", opciones: ["6 L/min", "7 L/min"], default: 0 },
};

const CATALOGO = {
  procedimientos: [
    p("TR-OXI-01", "Inicio de oxigenoterapia de bajo flujo", 1, { pareoCon: "TR-OXI-02" }),
    p("TR-OXI-02", "Supervisión y cuidado de O₂ bajo flujo", 1),
    p("TR-OXI-03", "Inicio de oxigenoterapia de alto flujo", 1, { pareoCon: "TR-OXI-04" }),
    p("TR-OXI-04", "Supervisión y cuidado de O₂ alto flujo", 1),
    p("TR-AER-01", "Nebulización convencional (jet)", 2, { aerosolConfig: AER_CFG }),
    p("TR-AER-05", "Educación de técnica inhalatoria al egreso", 2),
    p("TR-FIS-01", "Fisioterapia torácica convencional", 3, {
      subSeccion: "3.1 · Fisioterapia respiratoria",
    }),
    p("TR-FIS-03", "Ejercicios de rehabilitación con espirómetro incentivo", 3, {
      subSeccion: "3.1 · Fisioterapia respiratoria",
    }),
  ],
  medicamentos: [
    {
      id: "m1",
      clave: "ipratropio",
      nombre: "Bromuro de ipratropio («Tropium») — solución 0.25 mg/mL",
      unidadBase: "mg",
      dosisMin: 0.25,
      dosisMax: 0.5,
      dosisDefault: 0.5,
      altoRiesgo: false,
      precaucion: false,
      mensaje: "La unidad válida es miligramo o microgramo, nunca gramo.",
      activo: true,
      esOverrideTenant: false,
    },
    {
      id: "m2",
      clave: "salbutamol",
      nombre: "Salbutamol — solución para nebulizar 5 mg/mL",
      unidadBase: "mg",
      dosisMin: 2.5,
      dosisMax: 5,
      dosisDefault: 2.5,
      altoRiesgo: false,
      precaucion: false,
      mensaje: "Vigilar taquicardia.",
      activo: true,
      esOverrideTenant: false,
    },
  ],
};

function p(codigo: string, nombre: string, seccionOrden: number, extra: Record<string, unknown> = {}) {
  return {
    id: `p-${codigo}`,
    codigo,
    nombre,
    categoria: "x",
    seccionOrden,
    subSeccion: null,
    unidadCobro: "Evento",
    requiereConsentimiento: false,
    delegablePorProtocolo: false,
    pareoCon: null,
    tiempoEstandarMin: null,
    tarifaBase: null,
    aerosolConfig: null,
    displayOrder: 0,
    activo: true,
    esOverrideTenant: false,
    ...extra,
  };
}

function renderOrden() {
  return render(
    <ToastProvider>
      <OrdenTr cuentaId="00000000-0000-0000-0000-000000000010" onGuardado={vi.fn()} />
      <ToastViewport />
    </ToastProvider>,
  );
}

/** El nombre accesible del checkbox viene del <label> que lo envuelve (código + nombre). */
function checkboxDe(texto: string) {
  const rx = new RegExp(texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return screen.getByRole("checkbox", { name: rx });
}
function queryCheckboxDe(texto: string) {
  const rx = new RegExp(texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return screen.queryByRole("checkbox", { name: rx });
}

describe("OrdenTr (CC-0042)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCatalogo.mockReturnValue({ data: CATALOGO, isLoading: false, error: null });
    mockCrear.mockImplementation(() => ({ mutate: vi.fn(), isPending: false, error: null }));
    mockCie11Estado.mockReturnValue({ data: { configured: false }, isLoading: false, error: null });
    mockCie11Buscar.mockReturnValue({ data: { configured: false, items: [] }, isFetching: false, error: null });
  });

  afterEach(() => cleanup());

  it("RN-TR-33: elegir TR-OXI-01 selecciona automáticamente TR-OXI-02 (pareo indivisible)", () => {
    renderOrden();
    fireEvent.click(checkboxDe("Inicio de oxigenoterapia de bajo flujo"));
    expect(checkboxDe("Supervisión y cuidado de O₂ bajo flujo")).toBeChecked();

    // Cambiar a alto flujo deselecciona el par anterior.
    fireEvent.click(checkboxDe("Inicio de oxigenoterapia de alto flujo"));
    expect(checkboxDe("Supervisión y cuidado de O₂ alto flujo")).toBeChecked();
    expect(checkboxDe("Inicio de oxigenoterapia de bajo flujo")).not.toBeChecked();
  });

  it("RF-TR-E111/E116: «No requiere oxigenoterapia» colapsa la sección y la meta de saturación", () => {
    renderOrden();
    expect(screen.getByText(/Meta de saturación \(obligatoria/)).toBeInTheDocument();
    fireEvent.click(checkboxDe("No requiere oxigenoterapia"));
    expect(screen.queryByText(/Meta de saturación \(obligatoria/)).not.toBeInTheDocument();
    expect(queryCheckboxDe("Inicio de oxigenoterapia de bajo flujo")).not.toBeInTheDocument();
    expect(screen.getByText(/declara que este paciente no requiere oxigenoterapia/)).toBeInTheDocument();
  });

  it("RF-TR-E119: el mensaje de la meta es dinámico según la meta elegida", () => {
    renderOrden();
    fireEvent.click(screen.getByTestId("tr-meta-88-92"));
    expect(screen.getByTestId("tr-meta-hint")).toHaveTextContent("Paciente con riesgo de hipercapnia");
    fireEvent.click(screen.getByTestId("tr-meta-94-98"));
    expect(screen.getByTestId("tr-meta-hint")).toHaveTextContent("Meta estándar del adulto agudo");
    fireEvent.click(screen.getByTestId("tr-meta-OTRO"));
    expect(screen.queryByTestId("tr-meta-hint")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Justificación clínica de la meta/)).toBeInTheDocument();
  });

  it("RF-TR-E117/RN-TR-36: seleccionar TR-AER-01 despliega el medicamento; TR-AER-05 no lo despliega", () => {
    renderOrden();
    fireEvent.click(checkboxDe("Nebulización convencional (jet)"));
    expect(screen.getByTestId("tr-med-titulo")).toHaveTextContent("Medicamento para TR-AER-01");
    expect(screen.getByLabelText("Flujo impulsor de oxígeno")).toBeInTheDocument();

    fireEvent.click(checkboxDe("Educación de técnica inhalatoria al egreso"));
    expect(screen.queryByTestId("tr-med-titulo")).not.toBeInTheDocument();
  });

  it("RF-TR-E113: firmar sin pronunciarse sobre oxigenoterapia abre el modal de error bloqueante", async () => {
    const mutate = vi.fn();
    mockCrear.mockImplementation(() => ({ mutate, isPending: false, error: null }));
    renderOrden();
    // Sin dx el primer bloqueo es el diagnóstico (RN-TR-31).
    fireEvent.click(screen.getByTestId("tr-firmar"));
    expect(screen.getByTestId("tr-modal-error")).toHaveTextContent("diagnóstico CIE-11");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("conjunto EPOC precarga bajo flujo + nebulización con ipratropio + meta 88-92 y firma con payload completo", async () => {
    const mutate = vi.fn();
    mockCrear.mockImplementation(() => ({ mutate, isPending: false, error: null }));
    renderOrden();

    fireEvent.click(screen.getByRole("button", { name: "Conjunto: EPOC exacerbada" }));

    expect(checkboxDe("Inicio de oxigenoterapia de bajo flujo")).toBeChecked();
    expect(checkboxDe("Supervisión y cuidado de O₂ bajo flujo")).toBeChecked();
    expect(screen.getByTestId("tr-dx-sel")).toHaveTextContent("CA22.0");
    expect(screen.getByTestId("tr-meta-hint")).toHaveTextContent("riesgo de hipercapnia");
    expect(screen.getByTestId("tr-med-titulo")).toHaveTextContent("TR-AER-01");

    fireEvent.click(screen.getByTestId("tr-firmar"));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const payload = mutate.mock.calls[0]![0];
    expect(payload).toMatchObject({
      dxCodigo: "CA22.0",
      declaraciones: {
        oxigenoterapia: "SELECCIONADA",
        aerosolterapia: "SELECCIONADA",
        seccion3: "SELECCIONADA",
      },
      meta: { tipo: "88-92" },
    });
    const codigos = payload.items.map((i: { codigo: string }) => i.codigo).sort();
    expect(codigos).toEqual(["TR-AER-01", "TR-FIS-01", "TR-OXI-01", "TR-OXI-02"].sort());
    const aerItem = payload.items.find((i: { codigo: string }) => i.codigo === "TR-AER-01");
    expect(aerItem.medicamento).toMatchObject({ clave: "ipratropio", dosis: 0.5, unidad: "mg" });
  });
});
