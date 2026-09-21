// @vitest-environment jsdom
/**
 * Tests de EditarHistoriaClinicaAmbulatoriaPage — edición de borrador HC.
 *
 * Estrategia: mock de @/lib/trpc/react (patrón de
 * catalogs/laboratorio/__tests__/page.test.tsx) — sin DB, verifica
 * comportamiento de UI con datos simulados de `eceHistoriaClinica.get`.
 *
 * Casos:
 *   1. Borrador: hidrata el formulario con los datos del server (incluye
 *      alergias y el destino del catálogo).
 *   2. Estado ≠ borrador: no renderiza formulario, muestra guard HC-005.
 *   3. RN-03: guardar sin diagnóstico Complementario bloquea client-side
 *      (no llama a update.mutate).
 *   4. Guardar válido: update.mutate recibe id + campos editados y PRESERVA
 *      lo que el formulario no gestiona (complemento del dx, claves extra de
 *      antecedentes, signosVitales del examen físico).
 *   5. Destino legacy fuera de DESTINO_OPTIONS hidrata vacío (no revienta
 *      el enum al guardar).
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// ─── Mocks de infraestructura ─────────────────────────────────────────────────

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: HC_ID }),
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// ─── Mock tRPC ────────────────────────────────────────────────────────────────

const mockGetQuery = vi.fn();
const mockUpdateMutate = vi.fn();

interface MutationOpts {
  onSuccess?: () => void;
  onError?: (e: { message: string }) => void;
}

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    eceHistoriaClinica: {
      get: { useQuery: (...args: unknown[]) => mockGetQuery(...args) },
      update: {
        useMutation: (_opts?: MutationOpts) => ({
          mutate: mockUpdateMutate,
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

import EditarHistoriaClinicaAmbulatoriaPage from "../page";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HC_ID = "11111111-1111-4111-8111-111111111111";

const HC_BORRADOR = {
  id: HC_ID,
  estadoRegistro: "borrador",
  tipoConsulta: "primera_vez",
  motivoConsulta: "DOLOR ABDOMINAL",
  enfermedadActual: "24 HORAS DE EVOLUCION",
  antecedentes: {
    personales: "HTA",
    familiares: "DM2 MATERNA",
    obstetricos: "G2P2",
    alergias: "PENICILINA",
    // Clave que el formulario NO gestiona — debe sobrevivir al guardado.
    ocupacion: "AGRICULTOR",
  },
  examenFisico: {
    sistemas: [{ sistema: "General", hallazgo: "ABDOMEN BLANDO DEPRESIBLE" }],
    // Igual: el formulario no la edita pero no debe perderla.
    signosVitales: { frecuenciaCardiaca: 80 },
  },
  diagnosticos: [
    {
      codigo: "ME24",
      descripcion: "DOLOR ABDOMINAL",
      tipo: "PRESUNTIVO",
      complemento: "EPIGASTRIO",
    },
  ],
  planManejo: "OBSERVACION Y ANALGESIA",
  destino: "SEGUIMIENTO",
  registradoEn: new Date("2026-09-01T10:00:00Z"),
  patient: { id: "p1", firstName: "ANA", lastName: "PEREZ", mrn: "SLV2600001" },
  firmadoEn: null,
  validadoEn: null,
};

function queryOk(data: unknown) {
  return { isLoading: false, error: null, data, refetch: vi.fn() };
}

function renderPage(data: unknown = HC_BORRADOR) {
  mockGetQuery.mockReturnValue(queryOk(data));
  return render(<EditarHistoriaClinicaAmbulatoriaPage />);
}

function submitForm() {
  fireEvent.submit(
    screen.getByRole("form", { name: /edición historia clínica ambulatoria/i }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("EditarHistoriaClinicaAmbulatoriaPage", () => {
  it("hidrata el formulario con los datos del borrador", () => {
    renderPage();

    expect(screen.getByLabelText(/motivo de consulta/i)).toHaveValue("DOLOR ABDOMINAL");
    expect(screen.getByLabelText(/anamnesis/i)).toHaveValue("24 HORAS DE EVOLUCION");
    expect(screen.getByLabelText(/^personales$/i)).toHaveValue("HTA");
    expect(screen.getByLabelText(/familiares/i)).toHaveValue("DM2 MATERNA");
    expect(screen.getByLabelText(/alergias/i)).toHaveValue("PENICILINA");
    expect(screen.getByLabelText(/hallazgos por aparato/i)).toHaveValue(
      "ABDOMEN BLANDO DEPRESIBLE",
    );
    expect(screen.getByLabelText(/plan terapéutico/i)).toHaveValue(
      "OBSERVACION Y ANALGESIA",
    );
    // Diagnóstico hidratado en la lista
    expect(screen.getByText("ME24")).toBeInTheDocument();
    expect(screen.getByText("(Presuntivo)")).toBeInTheDocument();
    // Destino del catálogo hidratado en el trigger del select
    expect(
      within(screen.getByLabelText(/destino del paciente/i)).getByText("Seguimiento"),
    ).toBeInTheDocument();
  });

  it("no renderiza formulario si el estado no es borrador (guard HC-005)", () => {
    renderPage({ ...HC_BORRADOR, estadoRegistro: "firmado" });

    expect(screen.getByRole("alert")).toHaveTextContent(/'firmado' no puede editarse/i);
    expect(
      screen.queryByRole("form", { name: /edición historia clínica ambulatoria/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /volver al detalle/i })).toHaveAttribute(
      "href",
      `/historia-clinica-ambulatoria/${HC_ID}`,
    );
  });

  it("RN-03: bloquea guardar sin diagnóstico Complementario", () => {
    renderPage(); // el fixture solo trae un PRESUNTIVO

    submitForm();

    expect(mockUpdateMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/RN-03/);
  });

  it("guarda con update.mutate preservando lo que el formulario no gestiona", () => {
    renderPage({
      ...HC_BORRADOR,
      diagnosticos: [
        ...HC_BORRADOR.diagnosticos,
        { codigo: "MG50", descripcion: "HALLAZGO COMPLEMENTARIO", tipo: "COMPLEMENTARIO" },
      ],
    });

    fireEvent.change(screen.getByLabelText(/plan terapéutico/i), {
      target: { value: "ALTA CON ANALGESIA ORAL" },
    });
    submitForm();

    expect(mockUpdateMutate).toHaveBeenCalledTimes(1);
    const payload = mockUpdateMutate.mock.calls[0]![0];
    expect(payload.id).toBe(HC_ID);
    expect(payload.planManejo).toBe("ALTA CON ANALGESIA ORAL");
    expect(payload.destino).toBe("SEGUIMIENTO");
    // Preservación de claves no gestionadas por el formulario:
    expect(payload.antecedentes.ocupacion).toBe("AGRICULTOR");
    expect(payload.antecedentes.alergias).toBe("PENICILINA");
    expect(payload.examenFisico.signosVitales).toEqual({ frecuenciaCardiaca: 80 });
    expect(payload.diagnosticos[0].complemento).toBe("EPIGASTRIO");
    expect(payload.examenFisico.sistemas).toEqual([
      { sistema: "General", hallazgo: "ABDOMEN BLANDO DEPRESIBLE" },
    ]);
  });

  it("destino legacy fuera del catálogo hidrata vacío y se omite al guardar", () => {
    renderPage({
      ...HC_BORRADOR,
      destino: "ALTA", // valor pre-CC-0001, no existe en DESTINO_OPTIONS
      diagnosticos: [{ codigo: "MG50", descripcion: "HALLAZGO", tipo: "COMPLEMENTARIO" }],
    });

    expect(screen.getByText(/seleccione destino/i)).toBeInTheDocument();

    submitForm();

    expect(mockUpdateMutate).toHaveBeenCalledTimes(1);
    expect(mockUpdateMutate.mock.calls[0]![0].destino).toBeUndefined();
  });
});
