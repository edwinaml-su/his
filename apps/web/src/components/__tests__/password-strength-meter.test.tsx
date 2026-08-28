// @vitest-environment jsdom
/**
 * Tests de <PasswordStrengthMeter /> — US-2.10.
 *
 * El componente es puro (recibe score/errors ya calculados), así que estos
 * tests no necesitan mocks de tRPC ni de Next — solo `@testing-library/react`.
 *
 * @QA — E2E: la integración real (mount dentro de /recover/reset y
 * /users/[id]) queda para Playwright — este archivo cubre solo la lógica de
 * render del componente en aislamiento.
 */
import * as React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PasswordStrengthMeter } from "../password-strength-meter";

afterEach(() => cleanup());

describe("<PasswordStrengthMeter /> (US-2.10)", () => {
  it("no renderiza nada cuando empty=true (input vacío)", () => {
    const { container } = render(
      <PasswordStrengthMeter score={0} errors={[]} empty />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renderiza la etiqueta 'Muy débil' para score=0", () => {
    render(<PasswordStrengthMeter score={0} errors={["Mínimo 12 caracteres"]} />);
    expect(screen.getByText("Muy débil")).toBeInTheDocument();
  });

  it("renderiza la etiqueta 'Excelente' para score=4", () => {
    render(<PasswordStrengthMeter score={4} errors={[]} />);
    expect(screen.getByText("Excelente")).toBeInTheDocument();
  });

  it("expone role=progressbar con aria-valuenow igual al score", () => {
    render(<PasswordStrengthMeter score={3} errors={[]} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "4");
  });

  it("lista los errores de política cuando hay alguno", () => {
    render(
      <PasswordStrengthMeter
        score={1}
        errors={["Falta una mayúscula", "Incluye un carácter especial"]}
      />,
    );
    expect(screen.getByTestId("password-strength-errors")).toBeInTheDocument();
    expect(screen.getByText("Falta una mayúscula")).toBeInTheDocument();
    expect(screen.getByText("Incluye un carácter especial")).toBeInTheDocument();
  });

  it("no renderiza la lista de errores cuando errors está vacío", () => {
    render(<PasswordStrengthMeter score={4} errors={[]} />);
    expect(screen.queryByTestId("password-strength-errors")).not.toBeInTheDocument();
  });

  it("aprieta (clamp) un score fuera de rango a [0..4]", () => {
    // Defensivo: TS bloquea esto en uso normal, pero el componente debe
    // resistir un valor corrupto en runtime (p.ej. venido de JSON externo).
    render(
      <PasswordStrengthMeter
        score={9 as unknown as 0 | 1 | 2 | 3 | 4}
        errors={[]}
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
    expect(screen.getByText("Excelente")).toBeInTheDocument();
  });
});
