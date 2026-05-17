/**
 * Tests de schemas de país (countryCreateInput, countryUpdateInput, etc.).
 */
import { describe, it, expect } from "vitest";
import {
  countryCreateInput,
  countryUpdateInput,
  countryDeactivateInput,
  countryActivateInput,
  countryListInput,
} from "../country";

const u = "00000000-0000-0000-0000-000000000001";

const VALID_CREATE = {
  isoAlpha3: "SLV",
  isoNumeric: 222,
  name: "El Salvador",
  defaultLocale: "es-SV",
  defaultTzId: "America/El_Salvador",
};

describe("countryCreateInput", () => {
  it("acepta input valido", () => {
    expect(countryCreateInput.safeParse(VALID_CREATE).success).toBe(true);
  });

  it("normaliza isoAlpha3 a mayusculas", () => {
    const result = countryCreateInput.safeParse({ ...VALID_CREATE, isoAlpha3: "slv" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isoAlpha3).toBe("SLV");
  });

  it("rechaza isoAlpha3 de 2 letras", () => {
    expect(countryCreateInput.safeParse({ ...VALID_CREATE, isoAlpha3: "SV" }).success).toBe(false);
  });

  it("rechaza isoAlpha3 con digitos", () => {
    expect(countryCreateInput.safeParse({ ...VALID_CREATE, isoAlpha3: "SV1" }).success).toBe(false);
  });

  it("rechaza isoNumeric fuera de rango (0)", () => {
    expect(countryCreateInput.safeParse({ ...VALID_CREATE, isoNumeric: 0 }).success).toBe(false);
  });

  it("rechaza isoNumeric fuera de rango (1000)", () => {
    expect(countryCreateInput.safeParse({ ...VALID_CREATE, isoNumeric: 1000 }).success).toBe(false);
  });

  it("rechaza nombre menor a 2 caracteres", () => {
    expect(countryCreateInput.safeParse({ ...VALID_CREATE, name: "X" }).success).toBe(false);
  });

  it("rechaza locale invalido", () => {
    expect(countryCreateInput.safeParse({ ...VALID_CREATE, defaultLocale: "x" }).success).toBe(false);
  });

  it("acepta defaultCurrencyId UUID opcional", () => {
    const result = countryCreateInput.safeParse({ ...VALID_CREATE, defaultCurrencyId: u });
    expect(result.success).toBe(true);
  });

  it("rechaza defaultCurrencyId no-UUID", () => {
    expect(countryCreateInput.safeParse({ ...VALID_CREATE, defaultCurrencyId: "bad" }).success).toBe(false);
  });
});

describe("countryUpdateInput", () => {
  it("acepta actualizacion parcial con solo id", () => {
    expect(countryUpdateInput.safeParse({ id: u }).success).toBe(true);
  });

  it("acepta actualizacion parcial de nombre", () => {
    expect(countryUpdateInput.safeParse({ id: u, name: "Nuevo nombre" }).success).toBe(true);
  });

  it("rechaza isoNumeric invalido en update", () => {
    expect(countryUpdateInput.safeParse({ id: u, isoNumeric: 1000 }).success).toBe(false);
  });

  it("rechaza id no-uuid", () => {
    expect(countryUpdateInput.safeParse({ id: "bad" }).success).toBe(false);
  });
});

describe("countryDeactivateInput / countryActivateInput", () => {
  it("acepta id UUID para deactivate", () => {
    expect(countryDeactivateInput.safeParse({ id: u }).success).toBe(true);
  });

  it("acepta id UUID para activate", () => {
    expect(countryActivateInput.safeParse({ id: u }).success).toBe(true);
  });

  it("rechaza id no-uuid en deactivate", () => {
    expect(countryDeactivateInput.safeParse({ id: "bad" }).success).toBe(false);
  });
});

describe("countryListInput", () => {
  it("acepta input sin filtros", () => {
    expect(countryListInput.safeParse({}).success).toBe(true);
  });

  it("acepta filtros activeOnly+search", () => {
    expect(countryListInput.safeParse({ activeOnly: true, search: "Salvador" }).success).toBe(true);
  });
});
