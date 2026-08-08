// @vitest-environment jsdom
/**
 * CC-0016 — Tests de `<ImagingModuleShell>`: resolución de `?cuentaId=`
 * (selector de cuenta vs módulo), patrón de `/lis/orders/new`.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockReplace = vi.fn();
let searchParamsMap = new Map<string, string>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({ get: (key: string) => searchParamsMap.get(key) ?? null }),
}));

vi.mock("@/components/selector-cuenta", () => ({
  SelectorCuenta: ({ titulo }: { titulo: string }) => <div>{titulo}</div>,
}));

vi.mock("../modulo-imagenes", () => ({
  ModuloImagenes: ({ cuentaId }: { cuentaId: string }) => <div>Módulo para cuenta {cuentaId}</div>,
}));

import { ImagingModuleShell } from "../imaging-module-shell";

describe("ImagingModuleShell (CC-0016)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMap = new Map();
  });
  afterEach(() => cleanup());

  it("sin cuentaId muestra el selector de cuenta", () => {
    render(<ImagingModuleShell roleCodes={["ADMIN"]} />);
    expect(screen.getByText("Radiología e Imágenes")).toBeInTheDocument();
  });

  it("con cuentaId renderiza el módulo", () => {
    searchParamsMap.set("cuentaId", "cuenta-9");
    render(<ImagingModuleShell roleCodes={["ADMIN"]} />);
    expect(screen.getByText("Módulo para cuenta cuenta-9")).toBeInTheDocument();
  });
});
