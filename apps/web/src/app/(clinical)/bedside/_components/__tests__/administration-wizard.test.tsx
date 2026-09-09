// @vitest-environment jsdom
/**
 * Tests de <AdministrationWizard> — regresión del bypass de hard-stop BCMA.
 *
 * Defecto corregido: `bedside.validate5Correct.validate` NO lanza en fallo de
 * validación — devuelve `{ ok:false, hardStop, reason }` (ValidateResult,
 * bedside.router.ts). El wizard solo capturaba excepciones, así que con
 * ok:false seguía de largo y llamaba `administration.record`, que asume los
 * 5 correctos ya validados (bypass del hard-stop de seguridad del paciente).
 *
 * Estrategia: mock de `@/lib/trpc/react` (patrón estudios.test.tsx) y stub de
 * <ScanStep> que expone onScan como botón — el timing HID real de scan-step
 * no es reproducible en jsdom y no es lo que se prueba aquí.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockValidate = vi.fn();
const mockRecord = vi.fn();
const mockStatQuery = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    bedside: {
      validate5Correct: {
        validate: { useMutation: () => ({ mutateAsync: mockValidate }) },
      },
      administration: {
        record: { useMutation: () => ({ mutateAsync: mockRecord }) },
      },
    },
    bedsideStat: {
      getActive: { useQuery: (...args: unknown[]) => mockStatQuery(...args) },
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

// Stub de ScanStep: un botón por paso que dispara onScan con el payload fijado
// por el test (data-raw). El timing anti-teclado de scan-step queda fuera.
vi.mock("../scan-step", () => ({
  ScanStep: ({ label, onScan, disabled }: { label: string; onScan: (raw: string) => void; disabled?: boolean }) => (
    <button
      type="button"
      data-testid={`stub-scan-${label}`}
      disabled={disabled}
      onClick={() => onScan((window as unknown as Record<string, string>)[`__scan__${label}`] ?? "")}
    >
      {label}
    </button>
  ),
}));

vi.mock("@/components/scanner/barcode-scanner", () => ({
  BarcodeScanner: () => null,
}));
vi.mock("../stat-activation-dialog", () => ({ StatActivationDialog: () => null }));
vi.mock("../stat-banner", () => ({ StatBanner: () => null }));

// parseGs1String real es estricto con el formato; se stubbea para controlar
// gtin/lot/expiry sin fabricar un DataMatrix válido.
vi.mock("@/lib/gs1/parse-ai", () => ({
  parseGs1String: () => ({
    ok: true,
    data: { gtin: "07501000001234", lot: "L-001", expiry: "271231" },
  }),
}));

import { AdministrationWizard } from "../administration-wizard";

const GSRN_PACIENTE = "861234567890123456";
const GSRN_ENFERMERA = "869876543210987654";

function setScan(label: string, value: string) {
  (window as unknown as Record<string, string>)[`__scan__${label}`] = value;
}

/** Recorre los 3 pasos de escaneo hasta disparar la validación. */
async function escanearTresPasos() {
  const botones = await screen.findAllByTestId(/^stub-scan-/);
  // Orden de render: paso 1 (paciente), paso 2 (enfermera), paso 3 (medicamento).
  const [paciente, enfermera, medicamento] = botones;
  if (!paciente || !enfermera || !medicamento) throw new Error("faltan pasos de escaneo");
  setScan(paciente.textContent ?? "", GSRN_PACIENTE);
  fireEvent.click(paciente);
  setScan(enfermera.textContent ?? "", GSRN_ENFERMERA);
  fireEvent.click(enfermera);
  setScan(medicamento.textContent ?? "", "cualquier-datamatrix");
  fireEvent.click(medicamento);
}

describe("AdministrationWizard — hard-stop de 5 correctos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatQuery.mockReturnValue({ data: null, refetch: vi.fn() });
  });
  afterEach(() => cleanup());

  it("ok:false del validate NO registra la administración y muestra el hard-stop", async () => {
    mockValidate.mockResolvedValue({
      ok: false,
      hardStop: "MEDICAMENTO_INCORRECTO",
      reason: "El GTIN escaneado no coincide con la indicación",
    });

    render(<AdministrationWizard patientId="pat-1" indicationId="ind-1" />);
    await escanearTresPasos();

    await waitFor(() => expect(mockValidate).toHaveBeenCalledTimes(1));
    // Regresión: antes de la corrección, record se llamaba igual con ok:false.
    expect(mockRecord).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/MEDICAMENTO_INCORRECTO: El GTIN escaneado no coincide/),
    ).toBeInTheDocument();
  });

  it("ok:true del validate continúa con administration.record", async () => {
    mockValidate.mockResolvedValue({ ok: true });
    mockRecord.mockResolvedValue({
      requiresDoubleCheck: false,
      administrationId: "adm-1",
    });

    render(<AdministrationWizard patientId="pat-1" indicationId="ind-1" />);
    await escanearTresPasos();

    await waitFor(() => expect(mockRecord).toHaveBeenCalledTimes(1));
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        patientGsrn: GSRN_PACIENTE,
        staffGsrn: GSRN_ENFERMERA,
        medicamentoGtin: "07501000001234",
        lote: "L-001",
        indicationId: "ind-1",
      }),
    );
  });

  it("excepción del validate también corta en hard-stop (camino previo intacto)", async () => {
    mockValidate.mockRejectedValue(new Error("HARD_STOP:MEDICAMENTO_VENCIDO"));

    render(<AdministrationWizard patientId="pat-1" indicationId="ind-1" />);
    await escanearTresPasos();

    await waitFor(() => expect(mockValidate).toHaveBeenCalledTimes(1));
    expect(mockRecord).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Medicamento vencido — no se puede administrar/),
    ).toBeInTheDocument();
  });
});
