import { describe, it, expect } from "vitest";
import {
  mapManner,
  deterministicUuid,
  buildCausasIntermedias,
  buildCausasContribuyentes,
  VALID_CLASIFICACION,
} from "../deaths-to-ece-helpers";

describe("mapManner", () => {
  it("mapea 'natural' → 'natural'", () => {
    expect(mapManner("natural")).toBe("natural");
  });

  it("mapea 'accident' → 'violenta'", () => {
    expect(mapManner("accident")).toBe("violenta");
  });

  it("mapea 'suicide' → 'violenta'", () => {
    expect(mapManner("suicide")).toBe("violenta");
  });

  it("mapea 'homicide' → 'violenta'", () => {
    expect(mapManner("homicide")).toBe("violenta");
  });

  it("mapea 'undetermined' → 'en_investigacion'", () => {
    expect(mapManner("undetermined")).toBe("en_investigacion");
  });

  it("mapea 'accidente_transito' → 'accidente_transito'", () => {
    expect(mapManner("accidente_transito")).toBe("accidente_transito");
  });

  it("usa 'en_investigacion' como fallback para valores desconocidos", () => {
    expect(mapManner("desconocido")).toBe("en_investigacion");
    expect(mapManner("")).toBe("en_investigacion");
  });

  it("usa 'en_investigacion' cuando manner es null o undefined", () => {
    expect(mapManner(null)).toBe("en_investigacion");
    expect(mapManner(undefined)).toBe("en_investigacion");
  });

  it("normaliza a lowercase y trim", () => {
    expect(mapManner("  Natural  ")).toBe("natural");
    expect(mapManner("ACCIDENT")).toBe("violenta");
  });

  it("todos los valores posibles están dentro de VALID_CLASIFICACION", () => {
    const legacyValues = [
      "natural", "accident", "accidente", "accidente_transito",
      "suicide", "suicidio", "homicide", "homicidio",
      "undetermined", "indeterminado", "en_investigacion", "violenta",
    ];
    for (const v of legacyValues) {
      const result = mapManner(v);
      expect(VALID_CLASIFICACION).toContain(result);
    }
  });
});

describe("deterministicUuid", () => {
  it("genera un string con formato UUID v4", () => {
    const uuid = deterministicUuid("test-seed");
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("es determinista: mismo input → mismo output", () => {
    expect(deterministicUuid("foo")).toBe(deterministicUuid("foo"));
    expect(deterministicUuid("bar")).toBe(deterministicUuid("bar"));
  });

  it("inputs distintos producen UUIDs distintos", () => {
    expect(deterministicUuid("a")).not.toBe(deterministicUuid("b"));
  });

  it("prefijos distintos producen UUIDs distintos (evita colisión patient vs encounter)", () => {
    // El seed incluye el tipo ('patient:', 'encounter:') para evitar colisiones
    // cuando el mismo UUID source aparece en ambas tablas.
    const uuidA = deterministicUuid("patient:abc123");
    const uuidB = deterministicUuid("encounter:abc123");
    expect(uuidA).not.toBe(uuidB);
  });
});

describe("buildCausasIntermedias", () => {
  it("retorna null cuando ambos son vacíos", () => {
    expect(buildCausasIntermedias({ code: null, desc: null }, { code: null, desc: null })).toBeNull();
    expect(buildCausasIntermedias({ code: undefined, desc: undefined }, { code: undefined, desc: undefined })).toBeNull();
  });

  it("incluye solo la causa intermedia si la directa es nula", () => {
    const result = buildCausasIntermedias(
      { code: "J18.9", desc: "Neumonía" },
      { code: null, desc: null },
    );
    expect(result).toHaveLength(1);
    expect(result![0]).toMatchObject({ cie10: "J18.9", descripcion: "Neumonía" });
  });

  it("incluye ambas causas en orden intermedia→directa", () => {
    const result = buildCausasIntermedias(
      { code: "I21.0", desc: "Infarto" },
      { code: "I25.1", desc: "Cardiopatía" },
    );
    expect(result).toHaveLength(2);
    expect(result![0]!.cie10).toBe("I21.0");
    expect(result![1]!.cie10).toBe("I25.1");
  });

  it("usa string vacío cuando la descripción es null", () => {
    const result = buildCausasIntermedias({ code: "A09", desc: null }, { code: null, desc: null });
    expect(result![0]!.descripcion).toBe("");
  });

  it("siempre pone intervalo_aproximado: null", () => {
    const result = buildCausasIntermedias({ code: "K70", desc: "Cirrosis" }, { code: null, desc: null });
    expect(result![0]!.intervalo_aproximado).toBeNull();
  });
});

describe("buildCausasContribuyentes", () => {
  it("retorna null para valor null/undefined/vacío", () => {
    expect(buildCausasContribuyentes(null)).toBeNull();
    expect(buildCausasContribuyentes(undefined)).toBeNull();
    expect(buildCausasContribuyentes("")).toBeNull();
  });

  it("encapsula el texto en un array con cie10: null", () => {
    const result = buildCausasContribuyentes("Diabetes mellitus tipo 2");
    expect(result).toHaveLength(1);
    expect(result![0]).toMatchObject({ cie10: null, descripcion: "Diabetes mellitus tipo 2" });
  });
});
