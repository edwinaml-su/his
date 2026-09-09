// @vitest-environment jsdom
/**
 * Tests de IndicacionDetallePage — modal de override de interacciones
 * (ADR 0023 Ola 2).
 *
 * Estrategia: mock de `@/lib/trpc/react` + `next/navigation`, sin tRPC real
 * (mismo patrón que `patients/new/__tests__/page.test.tsx`). El mock de
 * `firmar.useMutation` captura la config (`onSuccess`/`onError`) que pasa el
 * componente para poder simular la respuesta del server de forma síncrona.
 *
 * Casos cubiertos:
 *   1. onError con `data.interactionAlerts` abre el modal de override,
 *      mostrando los pares en conflicto.
 *   2. Confirmar el modal con verificador/PIN/justificación llama a
 *      `firmar.mutate` con `overrideInteracciones` (2º intento).
 *   3. El botón de confirmar override permanece deshabilitado si falta
 *      algún campo (justificación < 10 caracteres).
 *   4. onSuccess con `advertencias` las muestra en el banner no bloqueante.
 *
 * @QA E2E (Playwright): firmar con interacción real contra Postgres →
 *   verificar que el override persiste en el evento de auditoría.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

interface MutationConfig {
  onSuccess?: (data: unknown) => void;
  onError?: (err: unknown) => void;
}

const mockGetQuery = vi.fn();
const mockFirmarMutate = vi.fn();
const mockSuspenderMutate = vi.fn();
const mockCancelarMutate = vi.fn();
let firmarConfig: MutationConfig = {};

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    eceIndicaciones: {
      get: { useQuery: (...args: unknown[]) => mockGetQuery(...args) },
      firmar: {
        useMutation: (config: MutationConfig) => {
          firmarConfig = config;
          return { mutate: mockFirmarMutate, isPending: false };
        },
      },
      suspender: {
        useMutation: () => ({ mutate: mockSuspenderMutate, isPending: false }),
      },
      cancelar: {
        useMutation: () => ({ mutate: mockCancelarMutate, isPending: false }),
      },
    },
  },
}));

import IndicacionDetallePage from "../page";

const INDICACION_BORRADOR = {
  id: "11111111-1111-4111-8111-111111111111",
  episodio_id: "22222222-2222-4222-8222-222222222222",
  estado_registro: "borrador",
  vigencia: "ACTIVA",
  registrado_en: "2026-09-09T10:00:00Z",
  items: [
    {
      id: "item-1",
      tipo: "MEDICAMENTO",
      descripcion: "Warfarina 5mg VO QD",
      dosis: "5mg",
      via: "ORAL",
      frecuencia: "QD",
      duracion: null,
    },
  ],
};

const INTERACTION_ERROR = {
  message:
    "Se detectaron interacciones medicamentosas mayor/contraindicadas (1). " +
    "Requiere override con segunda firma.",
  data: {
    code: "PRECONDITION_FAILED",
    interactionAlerts: [
      {
        atcA: "B01AA03",
        atcB: "M01AE01",
        drugAName: "Warfarina",
        drugBName: "Ibuprofeno",
        severity: "major",
        description: "Warfarina + Ibuprofeno — riesgo de sangrado",
      },
    ],
  },
};

function clickFirmar() {
  fireEvent.click(screen.getByTestId("btn-firmar"));
}

describe("IndicacionDetallePage — override de interacciones (ADR 0023 Ola 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firmarConfig = {};
    mockGetQuery.mockReturnValue({
      data: INDICACION_BORRADOR,
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => cleanup());

  it("firmar() rechazado con interactionAlerts abre el modal mostrando los pares en conflicto", () => {
    render(<IndicacionDetallePage />);

    clickFirmar();
    expect(mockFirmarMutate).toHaveBeenCalledWith({
      id: "11111111-1111-4111-8111-111111111111",
    });

    act(() => {
      firmarConfig.onError?.(INTERACTION_ERROR);
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("interaction-alert-list").textContent).toContain(
      "Warfarina",
    );
    expect(screen.getByTestId("interaction-alert-list").textContent).toContain(
      "Ibuprofeno",
    );
    expect(screen.getByTestId("interaction-alert-list").textContent).toContain(
      "major",
    );
  });

  it("confirmar el override llama a firmar.mutate con overrideInteracciones", () => {
    render(<IndicacionDetallePage />);

    clickFirmar();
    act(() => {
      firmarConfig.onError?.(INTERACTION_ERROR);
    });

    fireEvent.change(screen.getByTestId("input-override-verificador"), {
      target: { value: "33333333-3333-4333-8333-333333333333" },
    });
    fireEvent.change(screen.getByTestId("input-override-pin"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByTestId("input-override-justificacion"), {
      target: { value: "Autorizado por jefe de servicio de medicina interna." },
    });

    fireEvent.click(screen.getByTestId("btn-confirmar-override"));

    expect(mockFirmarMutate).toHaveBeenCalledTimes(2);
    expect(mockFirmarMutate).toHaveBeenLastCalledWith({
      id: "11111111-1111-4111-8111-111111111111",
      overrideInteracciones: {
        justificacion: "Autorizado por jefe de servicio de medicina interna.",
        verificadorId: "33333333-3333-4333-8333-333333333333",
        verificadorPin: "123456",
      },
    });
  });

  it("el botón de confirmar override está deshabilitado si la justificación tiene menos de 10 caracteres", () => {
    render(<IndicacionDetallePage />);

    clickFirmar();
    act(() => {
      firmarConfig.onError?.(INTERACTION_ERROR);
    });

    fireEvent.change(screen.getByTestId("input-override-verificador"), {
      target: { value: "33333333-3333-4333-8333-333333333333" },
    });
    fireEvent.change(screen.getByTestId("input-override-pin"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByTestId("input-override-justificacion"), {
      target: { value: "corta" },
    });

    expect(screen.getByTestId("btn-confirmar-override")).toBeDisabled();
  });

  it("onSuccess con advertencias las muestra en el banner no bloqueante", () => {
    render(<IndicacionDetallePage />);

    clickFirmar();
    act(() => {
      firmarConfig.onSuccess?.({
        id: INDICACION_BORRADOR.id,
        estadoRegistro: "firmado",
        advertencias: [
          "[moderate] Warfarina + Paracetamol crónico",
          "Función renal reducida (ClCr estimado 19.4 mL/min) — verifique ajuste de dosis.",
        ],
      });
    });

    const banner = screen.getByTestId("alert-advertencias");
    expect(banner.textContent).toContain("Warfarina + Paracetamol");
    expect(banner.textContent).toContain("Función renal reducida");
  });
});
