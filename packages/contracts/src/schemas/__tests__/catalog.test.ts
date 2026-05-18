/**
 * Tests de schemas del catálogo genérico.
 */
import { describe, it, expect } from "vitest";
import {
  catalogKeyEnum,
  catalogListInput,
  catalogGetInput,
  catalogCreateInput,
  catalogUpdateInput,
  catalogToggleInput,
} from "../catalog";

const u = "00000000-0000-0000-0000-000000000001";

describe("catalogKeyEnum", () => {
  it("acepta claves validas", () => {
    const keys = ["biologicalSex", "gender", "maritalStatus", "occupation", "serviceUnit"];
    for (const k of keys) {
      expect(catalogKeyEnum.safeParse(k).success).toBe(true);
    }
  });

  it("rechaza clave desconocida", () => {
    expect(catalogKeyEnum.safeParse("nonExistent").success).toBe(false);
  });
});

describe("catalogListInput", () => {
  it("acepta input vacio", () => {
    expect(catalogListInput.safeParse({ catalog: "gender" }).success).toBe(true);
  });

  it("acepta activeOnly booleano", () => {
    expect(catalogListInput.safeParse({ catalog: "gender", activeOnly: true }).success).toBe(true);
  });

  it("rechaza catalog invalido", () => {
    expect(catalogListInput.safeParse({ catalog: "foo" }).success).toBe(false);
  });
});

describe("catalogGetInput", () => {
  it("acepta catalog+uuid valido", () => {
    expect(catalogGetInput.safeParse({ catalog: "gender", id: u }).success).toBe(true);
  });

  it("rechaza id no-uuid", () => {
    expect(catalogGetInput.safeParse({ catalog: "gender", id: "x" }).success).toBe(false);
  });
});

describe("catalogCreateInput", () => {
  it("crea biologicalSex valido", () => {
    const result = catalogCreateInput.safeParse({
      catalog: "biologicalSex",
      data: { code: "M", name: "Masculino" },
    });
    expect(result.success).toBe(true);
  });

  it("crea occupation con ciuoCode", () => {
    const result = catalogCreateInput.safeParse({
      catalog: "occupation",
      data: { name: "Médico", ciuoCode: "2211" },
    });
    expect(result.success).toBe(true);
  });

  it("rechaza catalog invalido en create", () => {
    const result = catalogCreateInput.safeParse({
      catalog: "nonExistent",
      data: { code: "X", name: "Y" },
    });
    expect(result.success).toBe(false);
  });

  it("crea educationLevel con ordinal", () => {
    const result = catalogCreateInput.safeParse({
      catalog: "educationLevel",
      data: { code: "PRIM", name: "Primaria", ordinal: 1 },
    });
    expect(result.success).toBe(true);
  });

  it("crea language con isoCode", () => {
    const result = catalogCreateInput.safeParse({
      catalog: "language",
      data: { code: "ES", name: "Español", isoCode: "spa" },
    });
    expect(result.success).toBe(true);
  });

  it("crea ageBand con minDays/maxDays", () => {
    const result = catalogCreateInput.safeParse({
      catalog: "ageBand",
      data: { code: "NEO", name: "Neonato", minDays: 0, maxDays: 28 },
    });
    expect(result.success).toBe(true);
  });

  it("crea identifierType con validatorFn opcional", () => {
    const result = catalogCreateInput.safeParse({
      catalog: "identifierType",
      data: { code: "DUI", name: "DUI", validatorFn: "validateDUI" },
    });
    expect(result.success).toBe(true);
  });
});

describe("catalogUpdateInput", () => {
  it("acepta actualizacion parcial", () => {
    const result = catalogUpdateInput.safeParse({
      catalog: "gender",
      id: u,
      data: { name: "Nuevo nombre" },
    });
    expect(result.success).toBe(true);
  });

  it("rechaza id no-uuid", () => {
    const result = catalogUpdateInput.safeParse({
      catalog: "gender",
      id: "bad-id",
      data: { name: "X" },
    });
    expect(result.success).toBe(false);
  });
});

describe("catalogToggleInput", () => {
  it("acepta catalog+id valido", () => {
    expect(catalogToggleInput.safeParse({ catalog: "religion", id: u }).success).toBe(true);
  });

  it("rechaza catalog invalido", () => {
    expect(catalogToggleInput.safeParse({ catalog: "foo", id: u }).success).toBe(false);
  });
});
