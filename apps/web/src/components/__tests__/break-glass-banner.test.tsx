// @vitest-environment jsdom
/**
 * CC-0017 F3 — `<BreakGlassBanner />`.
 *
 * Verifica: sin sesión no renderiza nada (fail-safe visual); con sesión
 * muestra el aviso + justificación + botón "Desactivar" que llama a
 * `clearBreakGlass()` y refresca la ruta.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockClearBreakGlass = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/app/actions/break-glass", () => ({
  clearBreakGlass: (...args: unknown[]) => mockClearBreakGlass(...args),
}));

import { BreakGlassBanner } from "../break-glass-banner";

describe("<BreakGlassBanner /> — CC-0017 F3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("session=null → no renderiza nada (fail-safe)", () => {
    const { container } = render(<BreakGlassBanner session={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("session activa → muestra el aviso, la justificación, y el botón Desactivar", () => {
    render(
      <BreakGlassBanner
        session={{
          patientId: "11111111-1111-4111-8111-111111111111",
          justification: "Paciente inconsciente, requiere revisión urgente.",
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        }}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/break-glass activo/i)).toBeInTheDocument();
    expect(screen.getByText(/paciente inconsciente/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /desactivar/i })).toBeInTheDocument();
  });

  it("click en Desactivar → llama clearBreakGlass() y router.refresh()", async () => {
    render(
      <BreakGlassBanner
        session={{
          patientId: "11111111-1111-4111-8111-111111111111",
          justification: "Emergencia clínica.",
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /desactivar/i }));

    await waitFor(() => expect(mockClearBreakGlass).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  });
});
