// @vitest-environment jsdom
/**
 * Regresión PharmacyPickingQueuePage — bug "r[i] is not a function"
 * (2026-09-12).
 *
 * `handleStartPicking` llamaba `trpcAny.dispensation.checkPreconditions
 * .fetch(...)` sobre el proxy de hooks de createTRPCReact, que NO expone
 * `.fetch()` — el TypeError caía en el catch como error visible y
 * "Iniciar Dispensación" nunca navegaba al flujo de picking. El fix usa
 * `trpc.useUtils()`.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockListQuery = vi.fn();
const mockCheckPreconditionsFetch = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}));

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    pharmacy: {
      prescription: {
        list: { useQuery: (...args: unknown[]) => mockListQuery(...args) },
      },
    },
    dispensation: {
      // La página referencia (sin invocar) checkPreconditions.useQuery.
      checkPreconditions: { useQuery: vi.fn() },
    },
    useUtils: () => ({
      dispensation: {
        checkPreconditions: { fetch: mockCheckPreconditionsFetch },
      },
    }),
  },
}));

import PharmacyPickingQueuePage from "../page";

const RX = {
  id: "rx-1",
  status: "SIGNED",
  prescribedAt: "2026-09-12T10:00:00.000Z",
  prescriberId: "doc-1",
  patient: { id: "pat-1", firstName: "Ana", lastName: "Cruz", mrn: "MRN-001" },
  encounter: { id: "enc-1", encounterNumber: "ENC-0001" },
  items: [
    { id: "item-1", drug: { genericName: "AMOXICILINA" }, dosage: "500 mg", frequency: "c/8h" },
  ],
};

describe("PharmacyPickingQueuePage — Iniciar Dispensación (regresión checkPreconditions.fetch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListQuery.mockReturnValue({ data: { items: [RX] }, isLoading: false });
  });

  afterEach(() => {
    cleanup();
  });

  it("pre-condición OK: checkPreconditions vía useUtils().fetch y navega al picking", async () => {
    mockCheckPreconditionsFetch.mockResolvedValue({ ok: true });

    render(<PharmacyPickingQueuePage />);
    fireEvent.click(screen.getByRole("button", { name: /Iniciar dispensación para Ana Cruz/ }));

    await waitFor(() =>
      expect(mockCheckPreconditionsFetch).toHaveBeenCalledWith({
        patientId: "pat-1",
        indicationId: "rx-1",
      }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/pharmacy/dispense/rx-1"));
  });

  it("hard stop SIN_RECETA_ACTIVA: muestra el mensaje mapeado y NO navega", async () => {
    mockCheckPreconditionsFetch.mockRejectedValue(new Error("SIN_RECETA_ACTIVA"));

    render(<PharmacyPickingQueuePage />);
    fireEvent.click(screen.getByRole("button", { name: /Iniciar dispensación para Ana Cruz/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Hard Stop: No existe receta médica digital activa para este paciente.",
      ),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
