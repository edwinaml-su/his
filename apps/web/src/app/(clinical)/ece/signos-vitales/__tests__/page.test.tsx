// @vitest-environment jsdom
/**
 * Remediación auditoría 2026-09-18 — el historial de signos vitales renderizaba
 * MOCK_ROWS hardcodeados. Estos tests aseguran que la página lee de
 * `eceSignosVitales.list` anclada a ?cuentaId=/?episodioId= y que sin ancla
 * ofrece el SelectorCuenta (nunca más datos inventados).
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockReplace = vi.fn();
const searchParamsMap = new Map<string, string>();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({ get: (k: string) => searchParamsMap.get(k) ?? null }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/selector-cuenta", () => ({
  SelectorCuenta: ({ titulo }: { titulo: string }) => <div data-testid="selector-cuenta">{titulo}</div>,
}));

const mockList = vi.fn();
vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    eceSignosVitales: { list: { useQuery: (...a: unknown[]) => mockList(...a) } },
  },
}));

import SignosVitalesPage from "../page";

const CUENTA = "00000000-0000-0000-0000-000000000010";

function toma(over: Record<string, unknown> = {}) {
  return {
    id: "sv-1",
    fecha_hora_toma: new Date("2026-09-18T08:00:00Z"),
    estado_registro: "firmado",
    presion_sistolica: 120,
    presion_diastolica: 80,
    frecuencia_cardiaca: 72,
    frecuencia_respiratoria: 16,
    temperatura: 36.8,
    saturacion_o2: 98,
    escala_dolor: 2,
    ...over,
  };
}

describe("SignosVitalesPage (historial cableado)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMap.clear();
    mockList.mockReturnValue({ data: { items: [], nextCursor: null }, isLoading: false, error: null });
  });

  afterEach(() => cleanup());

  it("sin ?cuentaId ni ?episodioId ofrece el SelectorCuenta y NO consulta", () => {
    render(<SignosVitalesPage />);
    expect(screen.getByTestId("selector-cuenta")).toBeInTheDocument();
    // enabled:false — el hook se llama pero deshabilitado.
    expect(mockList.mock.calls[0]![1]).toMatchObject({ enabled: false });
  });

  it("con ?cuentaId consulta list y renderiza las tomas reales (sin MOCK_ROWS)", () => {
    searchParamsMap.set("cuentaId", CUENTA);
    mockList.mockReturnValue({
      // spo2 87 ≤ criticalLow 88 (VITAL_THRESHOLDS_ADULT) ⇒ alerta crítica.
      data: { items: [toma(), toma({ id: "sv-2", saturacion_o2: 87, estado_registro: "borrador" })], nextCursor: null },
      isLoading: false,
      error: null,
    });
    render(<SignosVitalesPage />);

    expect(mockList.mock.calls[0]![0]).toMatchObject({ cuentaId: CUENTA, limit: 50 });
    expect(mockList.mock.calls[0]![1]).toMatchObject({ enabled: true });
    // SpO2 89 es crítico ⇒ zona de alerta + badge; la toma en borrador se marca.
    expect(screen.getByRole("status")).toHaveTextContent("Alerta crítica");
    expect(screen.getAllByText("borrador").length).toBeGreaterThan(0);
    // El link a nueva conserva el ancla de la cuenta.
    expect(screen.getByRole("link", { name: "Nuevo registro" })).toHaveAttribute(
      "href",
      `/ece/signos-vitales/nueva?cuentaId=${CUENTA}`,
    );
  });

  it("estado vacío real: sin tomas muestra el mensaje de captura, no datos inventados", () => {
    searchParamsMap.set("cuentaId", CUENTA);
    render(<SignosVitalesPage />);
    expect(screen.getByText(/Sin registros/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("propaga el error del server en vez de esconderlo", () => {
    searchParamsMap.set("episodioId", CUENTA);
    mockList.mockReturnValue({ data: undefined, isLoading: false, error: { message: "Se requiere episodioId o cuentaId." } });
    render(<SignosVitalesPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Se requiere episodioId o cuentaId.");
  });
});
