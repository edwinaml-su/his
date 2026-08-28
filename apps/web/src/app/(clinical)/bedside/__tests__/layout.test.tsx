// @vitest-environment jsdom
/**
 * Tests unitarios — BedsideLayout
 *
 * Verifica que el layout de /bedside renderiza sus children y monta
 * HidScannerInput (US.F2.6.42) sin crashear — inventario de componentes
 * huérfanos 2026-08-26, Tier 1.
 */

import * as React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import BedsideLayout from "../layout";

afterEach(() => {
  cleanup();
});

describe("BedsideLayout", () => {
  it("renderiza sus children", () => {
    render(
      <BedsideLayout>
        <div data-testid="child">contenido</div>
      </BedsideLayout>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
