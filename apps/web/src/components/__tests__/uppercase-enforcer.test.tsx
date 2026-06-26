/**
 * Tests — UppercaseEnforcer (listener global de mayúsculas).
 *
 * Verifica que el listener en fase de captura transforma campos de texto
 * editables, respeta las exclusiones y no interfiere con composición IME ni
 * con el estado de un input controlado por React.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { UppercaseEnforcer } from "../uppercase-enforcer";

afterEach(() => cleanup());

/** Asigna value y despacha un evento `input` real (capturable por el listener). */
function dispatchInput(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  opts?: { isComposing?: boolean },
): void {
  el.value = value;
  const ev = new Event("input", { bubbles: true });
  if (opts?.isComposing) Object.defineProperty(ev, "isComposing", { value: true });
  el.dispatchEvent(ev);
}

describe("UppercaseEnforcer", () => {
  it("convierte a mayúsculas un <input> de texto y un <textarea>", () => {
    render(
      <>
        <UppercaseEnforcer />
        <input data-testid="txt" />
        <textarea data-testid="ta" />
      </>,
    );
    const input = screen.getByTestId("txt") as HTMLInputElement;
    const ta = screen.getByTestId("ta") as HTMLTextAreaElement;

    dispatchInput(input, "paciente uno");
    dispatchInput(ta, "nota clínica");

    expect(input.value).toBe("PACIENTE UNO");
    expect(ta.value).toBe("NOTA CLÍNICA");
  });

  it("no toca contraseñas, campos readOnly ni [data-no-uppercase]", () => {
    render(
      <>
        <UppercaseEnforcer />
        <input data-testid="pwd" type="password" />
        <input data-testid="ro" readOnly />
        <input data-testid="opt" data-no-uppercase />
      </>,
    );

    const pwd = screen.getByTestId("pwd") as HTMLInputElement;
    const ro = screen.getByTestId("ro") as HTMLInputElement;
    const opt = screen.getByTestId("opt") as HTMLInputElement;

    dispatchInput(pwd, "Secreto123");
    dispatchInput(ro, "abc");
    dispatchInput(opt, "abc");

    expect(pwd.value).toBe("Secreto123");
    expect(ro.value).toBe("abc");
    expect(opt.value).toBe("abc");
  });

  it("ignora el evento durante composición IME", () => {
    render(
      <>
        <UppercaseEnforcer />
        <input data-testid="ime" />
      </>,
    );
    const input = screen.getByTestId("ime") as HTMLInputElement;

    dispatchInput(input, "niño", { isComposing: true });

    expect(input.value).toBe("niño");
  });

  it("mantiene el estado de un input controlado en mayúsculas", () => {
    function Controlled() {
      const [v, setV] = React.useState("");
      return (
        <input
          data-testid="ctrl"
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
      );
    }
    render(
      <>
        <UppercaseEnforcer />
        <Controlled />
      </>,
    );
    const input = screen.getByTestId("ctrl") as HTMLInputElement;

    fireEvent.input(input, { target: { value: "abc" } });

    expect(input.value).toBe("ABC");
  });
});
