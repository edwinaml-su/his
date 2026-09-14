// @vitest-environment jsdom
/**
 * Regresión GS1DispensePage — bug "r[i] is not a function" (2026-09-12).
 *
 * `handleScan` llamaba `trpcAny.dispensation.checkDuplicate.fetch(...)` sobre
 * el proxy de hooks de createTRPCReact, que NO expone `.fetch()` — el
 * TypeError síncrono caía en el catch y `reserveItem` nunca se ejecutaba:
 * "Validar y reservar" no dispensaba nada. El fix usa `trpc.useUtils()`.
 *
 * Estos tests fijan el contrato: submit válido → checkDuplicate.fetch (vía
 * utils) → reserveItem.mutate; ventana terapéutica → hard stop sin reservar.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockCostCentersQuery = vi.fn();
const mockOrderDetailQuery = vi.fn();
const mockReserveMutate = vi.fn();
const mockCancelMutate = vi.fn();
const mockReturnMutate = vi.fn();
const mockSubstitutionsQuery = vi.fn();
const mockCheckDuplicateFetch = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ orderId: "order-1" }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock("../../../_components/substitution-modal", () => ({
  SubstitutionModal: () => null,
}));

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    costCenter: {
      list: { useQuery: (...args: unknown[]) => mockCostCentersQuery(...args) },
    },
    dispensation: {
      orderDetail: { useQuery: (...args: unknown[]) => mockOrderDetailQuery(...args) },
      reserveItem: {
        useMutation: () => ({ mutate: mockReserveMutate, isPending: false }),
      },
      cancelReservation: {
        useMutation: () => ({ mutate: mockCancelMutate, isPending: false }),
      },
      returnItem: {
        useMutation: () => ({ mutate: mockReturnMutate, isPending: false }),
      },
    },
    pharmacySubstitution: {
      listAuthorizedForItem: {
        useQuery: (...args: unknown[]) => mockSubstitutionsQuery(...args),
      },
    },
    useUtils: () => ({
      dispensation: {
        checkDuplicate: { fetch: mockCheckDuplicateFetch },
      },
    }),
  },
}));

import GS1DispensePage from "../page";

const ORDER = {
  id: "order-1",
  status: "SIGNED",
  patientId: "pat-1",
  patient: { firstName: "Ana", lastName: "Cruz", mrn: "MRN-001" },
  // Un solo ítem → la página lo auto-selecciona (sin abrir el Select Radix).
  items: [
    {
      id: "item-1",
      dosage: "500 mg",
      route: "PO",
      frequency: "c/8h",
      drug: { id: "drug-1", genericName: "AMOXICILINA" },
    },
  ],
};

const GTIN = "07501001234567";

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(/GTIN-14/), { target: { value: GTIN } });
  fireEvent.change(screen.getByLabelText(/^Lote/), { target: { value: "L2024A" } });
  fireEvent.click(screen.getByRole("button", { name: "Validar y reservar" }));
}

describe("GS1DispensePage — handleScan (regresión checkDuplicate.fetch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCostCentersQuery.mockReturnValue({ data: [] });
    mockOrderDetailQuery.mockReturnValue({ data: ORDER, isLoading: false, error: null });
    mockSubstitutionsQuery.mockReturnValue({ data: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("scan válido: checkDuplicate vía useUtils().fetch y luego reserveItem.mutate", async () => {
    mockCheckDuplicateFetch.mockResolvedValue({
      allowed: true,
      lastDispensedAt: null,
      nextWindowAt: null,
    });

    render(<GS1DispensePage />);
    fillAndSubmit();

    await waitFor(() =>
      expect(mockCheckDuplicateFetch).toHaveBeenCalledWith({
        patientId: "pat-1",
        prescriptionItemId: "item-1",
        gtin: GTIN,
      }),
    );
    await waitFor(() =>
      expect(mockReserveMutate).toHaveBeenCalledWith({
        pharmacyOrderId: "order-1",
        gtin: GTIN,
        lote: "L2024A",
        serie: undefined,
        patientId: "pat-1",
      }),
    );
  });

  it("ítem ya dispensado en ventana: hard stop visible y reserveItem NO se llama", async () => {
    mockCheckDuplicateFetch.mockResolvedValue({
      allowed: false,
      lastDispensedAt: "2026-09-12T08:00:00.000Z",
      nextWindowAt: "2026-09-12T16:00:00.000Z",
    });

    render(<GS1DispensePage />);
    fillAndSubmit();

    await waitFor(() =>
      expect(
        screen.getByText(/HARD STOP — ITEM_YA_DISPENSADO_EN_VENTANA/),
      ).toBeInTheDocument(),
    );
    expect(mockReserveMutate).not.toHaveBeenCalled();
  });

  it("fallo del checkDuplicate: muestra el error del servidor sin reservar", async () => {
    mockCheckDuplicateFetch.mockRejectedValue(new Error("UNAUTHORIZED"));

    render(<GS1DispensePage />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("UNAUTHORIZED"));
    expect(mockReserveMutate).not.toHaveBeenCalled();
  });
});
