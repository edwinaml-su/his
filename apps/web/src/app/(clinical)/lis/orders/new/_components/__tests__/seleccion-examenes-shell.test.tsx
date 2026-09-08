// @vitest-environment jsdom
/**
 * Rediseño lab 2026-09 — Tests de `<SeleccionExamenesShell>`: resolución de
 * `?cuentaId=` (selector de cuenta vs pantalla de escogitación), mismo
 * patrón que `imaging/_components/imaging-module-shell.test.tsx`.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockPush = vi.fn();
let searchParamsMap = new Map<string, string>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: (key: string) => searchParamsMap.get(key) ?? null }),
}));

vi.mock("@/components/selector-cuenta", () => ({
  SelectorCuenta: ({ titulo }: { titulo: string }) => <div>{titulo}</div>,
}));

vi.mock("../seleccion-examenes", () => ({
  SeleccionExamenes: ({ cuentaId, roleCodes }: { cuentaId: string; roleCodes: string[] }) => (
    <div>
      Selección para cuenta {cuentaId} · roles: {roleCodes.join(",")}
    </div>
  ),
}));

import { SeleccionExamenesShell } from "../seleccion-examenes-shell";

describe("SeleccionExamenesShell (rediseño lab 2026-09)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMap = new Map();
  });
  afterEach(() => cleanup());

  it("sin cuentaId muestra el selector de cuenta", () => {
    render(<SeleccionExamenesShell roleCodes={["ADMIN"]} />);
    expect(screen.getByText("Nueva orden de laboratorio")).toBeInTheDocument();
  });

  it("con cuentaId renderiza la pantalla de escogitación con los roleCodes del server", () => {
    searchParamsMap.set("cuentaId", "cuenta-9");
    render(<SeleccionExamenesShell roleCodes={["ADMIN", "MC"]} />);
    expect(screen.getByText("Selección para cuenta cuenta-9 · roles: ADMIN,MC")).toBeInTheDocument();
  });
});
