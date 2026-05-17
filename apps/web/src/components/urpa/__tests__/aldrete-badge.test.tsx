/**
 * Tests unitarios — AldreteBadge y getAldreteStyle.
 *
 * Valida la lógica del semáforo clínico sin montar el componente completo.
 */
import { describe, it, expect } from "vitest";
import { getAldreteStyle } from "../aldrete-badge";

describe("getAldreteStyle — semáforo Aldrete", () => {
  it("score 10 → verde / cumple alta", () => {
    const { severity, label } = getAldreteStyle(10);
    expect(severity).toBe("green");
    expect(label).toMatch(/alta/i);
  });

  it("score 9 → verde (límite inferior apto para alta)", () => {
    const { severity } = getAldreteStyle(9);
    expect(severity).toBe("green");
  });

  it("score 8 → ámbar (observación)", () => {
    const { severity, label } = getAldreteStyle(8);
    expect(severity).toBe("amber");
    expect(label).toMatch(/observac/i);
  });

  it("score 5 → ámbar (límite inferior observación)", () => {
    const { severity } = getAldreteStyle(5);
    expect(severity).toBe("amber");
  });

  it("score 4 → rojo (traslado UCI)", () => {
    const { severity, label } = getAldreteStyle(4);
    expect(severity).toBe("red");
    expect(label).toMatch(/uci/i);
  });

  it("score 0 → rojo", () => {
    const { severity } = getAldreteStyle(0);
    expect(severity).toBe("red");
  });
});
