/**
 * Tests del schema CC-0011/CC-0013 — catálogo LIS parametrizable.
 * CC-0013 agrega `standardPrice` a create/update.
 */
import { describe, it, expect } from "vitest";
import { labTestCreateInput, labTestUpdateInput } from "../lis-catalogo";

const u = "00000000-0000-0000-0000-000000000001";

describe("labTestCreateInput — standardPrice (CC-0013)", () => {
  it("acepta sin standardPrice (opcional)", () => {
    const r = labTestCreateInput.safeParse({ panelId: u, code: "T1", name: "Test" });
    expect(r.success).toBe(true);
  });

  it("acepta standardPrice con 2 decimales", () => {
    const r = labTestCreateInput.safeParse({
      panelId: u,
      code: "T1",
      name: "Test",
      standardPrice: 12.5,
    });
    expect(r.success).toBe(true);
  });

  it("rechaza standardPrice negativo", () => {
    const r = labTestCreateInput.safeParse({
      panelId: u,
      code: "T1",
      name: "Test",
      standardPrice: -1,
    });
    expect(r.success).toBe(false);
  });

  it("rechaza standardPrice con más de 2 decimales", () => {
    const r = labTestCreateInput.safeParse({
      panelId: u,
      code: "T1",
      name: "Test",
      standardPrice: 12.555,
    });
    expect(r.success).toBe(false);
  });
});

describe("labTestUpdateInput — standardPrice (CC-0013)", () => {
  it("acepta null para limpiar el precio", () => {
    const r = labTestUpdateInput.safeParse({ id: u, standardPrice: null });
    expect(r.success).toBe(true);
  });

  it("acepta un nuevo precio válido", () => {
    const r = labTestUpdateInput.safeParse({ id: u, standardPrice: 8 });
    expect(r.success).toBe(true);
  });
});
