/**
 * Tests unitarios — helpers de forzado de MAYÚSCULAS (requerimiento Avante).
 *
 * Cubre el predicado de exclusión (isUppercaseTarget), el setter nativo
 * (setNativeValue) y la transformación con preservación de cursor (applyUppercase).
 */
import { describe, it, expect } from "vitest";
import { isUppercaseTarget, setNativeValue, applyUppercase } from "../uppercase";

function makeInput(type?: string): HTMLInputElement {
  const el = document.createElement("input");
  if (type) el.type = type;
  return el;
}

describe("isUppercaseTarget", () => {
  it("acepta <input> de texto (type explícito e implícito) y <textarea>", () => {
    expect(isUppercaseTarget(makeInput("text"))).toBe(true);
    expect(isUppercaseTarget(makeInput())).toBe(true); // type por defecto = text
    expect(isUppercaseTarget(document.createElement("textarea"))).toBe(true);
  });

  it("rechaza tipos no textuales o sensibles a may/min", () => {
    for (const t of ["password", "email", "url", "number", "tel", "date", "search", "checkbox"]) {
      expect(isUppercaseTarget(makeInput(t))).toBe(false);
    }
  });

  it("rechaza campos readOnly o disabled", () => {
    const ro = makeInput("text");
    ro.readOnly = true;
    expect(isUppercaseTarget(ro)).toBe(false);

    const dis = makeInput("text");
    dis.disabled = true;
    expect(isUppercaseTarget(dis)).toBe(false);
  });

  it("rechaza contraseñas reveladas (type=text) y PINs de firma vía autocomplete", () => {
    const revealed = makeInput("text");
    revealed.autocomplete = "current-password";
    expect(isUppercaseTarget(revealed)).toBe(false);

    const newPwd = makeInput("text");
    newPwd.autocomplete = "new-password";
    expect(isUppercaseTarget(newPwd)).toBe(false);
  });

  it("rechaza códigos OTP (autocomplete one-time-code)", () => {
    const otp = makeInput("text");
    otp.autocomplete = "one-time-code";
    expect(isUppercaseTarget(otp)).toBe(false);
  });

  it("respeta el opt-out [data-no-uppercase] en el campo o un ancestro", () => {
    const own = makeInput("text");
    own.setAttribute("data-no-uppercase", "");
    expect(isUppercaseTarget(own)).toBe(false);

    const wrap = document.createElement("div");
    wrap.setAttribute("data-no-uppercase", "");
    const child = makeInput("text");
    wrap.appendChild(child);
    expect(isUppercaseTarget(child)).toBe(false);
  });

  it("rechaza elementos no editables y null", () => {
    expect(isUppercaseTarget(document.createElement("div"))).toBe(false);
    expect(isUppercaseTarget(null)).toBe(false);
  });
});

describe("setNativeValue", () => {
  it("asigna el valor en <input> y <textarea>", () => {
    const input = makeInput("text");
    setNativeValue(input, "X");
    expect(input.value).toBe("X");

    const ta = document.createElement("textarea");
    setNativeValue(ta, "Y");
    expect(ta.value).toBe("Y");
  });
});

describe("applyUppercase", () => {
  it("transforma a mayúsculas y reporta el cambio", () => {
    const el = makeInput("text");
    el.value = "abc";
    expect(applyUppercase(el)).toBe(true);
    expect(el.value).toBe("ABC");
  });

  it("es no-op cuando el valor ya está en mayúsculas", () => {
    const el = makeInput("text");
    el.value = "ABC";
    expect(applyUppercase(el)).toBe(false);
    expect(el.value).toBe("ABC");
  });

  it("preserva la posición del cursor (longitud invariante)", () => {
    const el = makeInput("text");
    document.body.appendChild(el);
    el.value = "abcdef";
    el.setSelectionRange(2, 4);
    applyUppercase(el);
    expect(el.value).toBe("ABCDEF");
    expect(el.selectionStart).toBe(2);
    expect(el.selectionEnd).toBe(4);
    el.remove();
  });

  it("funciona en <textarea>", () => {
    const ta = document.createElement("textarea");
    ta.value = "hola mundo";
    expect(applyUppercase(ta)).toBe(true);
    expect(ta.value).toBe("HOLA MUNDO");
  });
});
