// @vitest-environment jsdom
/**
 * Remediación auditoría 2026-09-18 (P0 IPSG.2) — bandeja de read-back de
 * valores críticos: lista `eceCriticalResult.pending`, semáforo vs SLA y
 * confirmación con PIN de firma electrónica.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastProvider, ToastViewport } from "@his/ui/components/toast";

const mockPending = vi.fn();
const mockConfirm = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    useUtils: () => ({ eceCriticalResult: { pending: { invalidate: mockInvalidate } } }),
    eceCriticalResult: {
      pending: { useQuery: (...a: unknown[]) => mockPending(...a) },
      confirmReadback: { useMutation: (o?: unknown) => mockConfirm(o) },
    },
  },
}));

import ValoresCriticosPage from "../page";

const NOTIF = {
  id: "00000000-0000-0000-0000-0000000000c1",
  organization_id: "org",
  lab_result_id: "lr-1",
  paciente_id: "p-1",
  medico_tratante_id: "ps-1",
  valor_critico: {
    testCode: "GLU",
    testName: "Glucemia",
    flag: "CRITICAL_LOW",
    value: 35,
    unit: "mg/dL",
    referenceRange: { low: 70, high: 110 },
  },
  severidad: "crítica",
  notificado_en: new Date(Date.now() - 90 * 60_000), // 90 min > SLA 60 ⇒ vencida
  sla_min: 60,
  read_back_at: null,
  read_back_por_id: null,
  pin_fail_count: 0,
  escalado_a_id: null,
  escalado_en: null,
};

function renderPage() {
  return render(
    <ToastProvider>
      <ValoresCriticosPage />
      <ToastViewport />
    </ToastProvider>,
  );
}

describe("ValoresCriticosPage (IPSG.2 read-back)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPending.mockReturnValue({ data: { items: [NOTIF] }, isLoading: false, error: null });
    mockConfirm.mockImplementation(() => ({ mutate: vi.fn(), isPending: false, error: null }));
  });

  afterEach(() => cleanup());

  it("muestra la notificación con severidad, valor y estado VENCIDA vs SLA", () => {
    renderPage();
    const card = screen.getByTestId("vc-notif");
    expect(card).toHaveTextContent("Crítica");
    expect(card).toHaveTextContent("Glucemia");
    expect(card).toHaveTextContent("35 mg/dL");
    expect(card).toHaveTextContent("Ref: 70 – 110");
    expect(card).toHaveTextContent("VENCIDA");
  });

  it("confirmar read-back exige PIN (≥4) y llama la mutation; el toast informa fuera de SLA", () => {
    const mutate = vi.fn();
    mockConfirm.mockImplementation((opts?: unknown) => {
      const o = opts as { onSuccess?: (r: unknown) => void };
      return {
        mutate: (vars: unknown) => {
          mutate(vars);
          o.onSuccess?.({ ok: true, dentroSla: false, minutosTranscurridos: 90, readBackAt: new Date().toISOString() });
        },
        isPending: false,
        error: null,
      };
    });
    renderPage();

    fireEvent.click(screen.getByTestId(`vc-confirmar-${NOTIF.id}`));
    const boton = screen.getByTestId("vc-confirmar-pin");
    expect(boton).toBeDisabled(); // sin PIN no firma
    fireEvent.change(screen.getByTestId("vc-pin"), { target: { value: "1234" } });
    fireEvent.click(boton);

    expect(mutate).toHaveBeenCalledWith({ notificationId: NOTIF.id, pin: "1234" });
    expect(mockInvalidate).toHaveBeenCalled();
    expect(screen.getByText(/FUERA del SLA/)).toBeInTheDocument();
  });

  it("error del server (p. ej. PIN incorrecto) se muestra sin cerrar el circuito", () => {
    mockConfirm.mockImplementation((opts?: unknown) => {
      const o = opts as { onError?: (e: { message: string }) => void };
      return {
        mutate: () => o.onError?.({ message: "PIN incorrecto. Intentos restantes: 2." }),
        isPending: false,
        error: null,
      };
    });
    renderPage();
    fireEvent.click(screen.getByTestId(`vc-confirmar-${NOTIF.id}`));
    fireEvent.change(screen.getByTestId("vc-pin"), { target: { value: "9999" } });
    fireEvent.click(screen.getByTestId("vc-confirmar-pin"));
    expect(screen.getByText(/PIN incorrecto/)).toBeInTheDocument();
  });

  it("bandeja vacía muestra el estado limpio", () => {
    mockPending.mockReturnValue({ data: { items: [] }, isLoading: false, error: null });
    renderPage();
    expect(screen.getByText(/Sin valores críticos pendientes/)).toBeInTheDocument();
  });
});
