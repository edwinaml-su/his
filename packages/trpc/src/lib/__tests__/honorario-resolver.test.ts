import { describe, it, expect } from "vitest";
import { resolverReglaHonorario, calcularHonorario, type ReglaCandidata } from "../honorario-resolver";

function regla(overrides: Partial<ReglaCandidata> = {}): ReglaCandidata {
  return {
    id: "regla-1",
    ambito: "CONSULTA",
    rolMedico: null,
    serviceCategoryId: null,
    codigoServicio: null,
    tipoCalculo: "PORCENTAJE",
    porcentaje: 0.4,
    montoFijo: null,
    montoMinimo: null,
    montoMaximo: null,
    prioridad: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("resolverReglaHonorario", () => {
  it("gana la regla por codigoServicio sobre la de categoría y la de ámbito (especificidad)", () => {
    const porAmbito = regla({ id: "ambito", ambito: "CONSULTA" });
    const porCategoria = regla({ id: "categoria", serviceCategoryId: "cat-1" });
    const porCodigo = regla({ id: "codigo", codigoServicio: "CONS-001" });

    const ganadora = resolverReglaHonorario([porAmbito, porCategoria, porCodigo], {
      ambito: "CONSULTA",
      rolMedico: "TRATANTE",
      serviceCategoryId: "cat-1",
      codigoServicio: "CONS-001",
    });

    expect(ganadora?.id).toBe("codigo");
  });

  it("gana la regla por serviceCategoryId cuando no hay match de código", () => {
    const porAmbito = regla({ id: "ambito" });
    const porCategoria = regla({ id: "categoria", serviceCategoryId: "cat-1" });
    const porCodigoQueNoMatchea = regla({ id: "codigo-otro", codigoServicio: "OTRO-CODE" });

    const ganadora = resolverReglaHonorario([porAmbito, porCategoria, porCodigoQueNoMatchea], {
      ambito: "CONSULTA",
      rolMedico: "TRATANTE",
      serviceCategoryId: "cat-1",
      codigoServicio: "CONS-001",
    });

    expect(ganadora?.id).toBe("categoria");
  });

  it("dentro del mismo nivel de especificidad, gana prioridad desc", () => {
    const baja = regla({ id: "baja", prioridad: 1 });
    const alta = regla({ id: "alta", prioridad: 10 });

    const ganadora = resolverReglaHonorario([baja, alta], {
      ambito: "CONSULTA",
      rolMedico: "TRATANTE",
    });

    expect(ganadora?.id).toBe("alta");
  });

  it("en empate de prioridad, gana createdAt desc (creación más reciente)", () => {
    const vieja = regla({ id: "vieja", createdAt: new Date("2026-01-01") });
    const nueva = regla({ id: "nueva", createdAt: new Date("2026-06-01") });

    const ganadora = resolverReglaHonorario([vieja, nueva], {
      ambito: "CONSULTA",
      rolMedico: "TRATANTE",
    });

    expect(ganadora?.id).toBe("nueva");
  });

  it("filtra por ambito — una regla de otro ambito nunca hace match", () => {
    const cirugia = regla({ ambito: "CIRUGIA" });

    const ganadora = resolverReglaHonorario([cirugia], {
      ambito: "CONSULTA",
      rolMedico: "TRATANTE",
    });

    expect(ganadora).toBeNull();
  });

  it("una regla con rolMedico fijo solo aplica a ese rol", () => {
    const soloCirujano = regla({ ambito: "CIRUGIA", rolMedico: "CIRUJANO" });

    expect(
      resolverReglaHonorario([soloCirujano], { ambito: "CIRUGIA", rolMedico: "AYUDANTE" }),
    ).toBeNull();
    expect(
      resolverReglaHonorario([soloCirujano], { ambito: "CIRUGIA", rolMedico: "CIRUJANO" })?.id,
    ).toBe(soloCirujano.id);
  });

  it("una regla con rolMedico null aplica a cualquier rol dentro de su ámbito", () => {
    const cualquierRol = regla({ ambito: "CIRUGIA", rolMedico: null });

    expect(
      resolverReglaHonorario([cualquierRol], { ambito: "CIRUGIA", rolMedico: "ANESTESISTA" })?.id,
    ).toBe(cualquierRol.id);
  });

  it("AC3 — a igual especificidad de código/categoría/ámbito, un rolMedico ESPECÍFICO gana al comodín (null), antes de prioridad", () => {
    // Ambas son "ambito-only" (score 0): la genérica tiene prioridad MAYOR,
    // pero la específica del rol debe ganar igual (especificidad > prioridad).
    const generica = regla({ id: "generica-cirugia", ambito: "CIRUGIA", rolMedico: null, prioridad: 10 });
    const especificaDelRol = regla({ id: "especifica-cirujano", ambito: "CIRUGIA", rolMedico: "CIRUJANO", prioridad: 0 });

    const ganadora = resolverReglaHonorario([generica, especificaDelRol], {
      ambito: "CIRUGIA",
      rolMedico: "CIRUJANO",
    });

    expect(ganadora?.id).toBe("especifica-cirujano");
  });

  it("sin reglas candidatas, devuelve null (SIN_REGLA)", () => {
    expect(resolverReglaHonorario([], { ambito: "CONSULTA", rolMedico: "TRATANTE" })).toBeNull();
  });
});

describe("calcularHonorario", () => {
  it("REQ US.AFIL.1.5 AC4 — 40% con montoMinimo $25 sobre cargo $50 aplica el mínimo ($25, no $20)", () => {
    const r = regla({ tipoCalculo: "PORCENTAJE", porcentaje: 0.4, montoMinimo: 25 });
    expect(calcularHonorario(r, 50)).toBe(25);
  });

  it("PORCENTAJE sin mínimo/máximo calcula directo", () => {
    const r = regla({ tipoCalculo: "PORCENTAJE", porcentaje: 0.3 });
    expect(calcularHonorario(r, 100)).toBe(30);
  });

  it("MONTO_FIJO ignora el monto facturado", () => {
    const r = regla({ tipoCalculo: "MONTO_FIJO", montoFijo: 75, porcentaje: null });
    expect(calcularHonorario(r, 1000)).toBe(75);
  });

  it("aplica montoMaximo como tope", () => {
    const r = regla({ tipoCalculo: "PORCENTAJE", porcentaje: 0.5, montoMaximo: 40 });
    expect(calcularHonorario(r, 200)).toBe(40);
  });

  it("nunca devuelve un honorario negativo", () => {
    const r = regla({ tipoCalculo: "MONTO_FIJO", montoFijo: 0, porcentaje: null });
    expect(calcularHonorario(r, 0)).toBe(0);
  });

  it("redondea a centavos", () => {
    const r = regla({ tipoCalculo: "PORCENTAJE", porcentaje: 1 / 3 });
    expect(calcularHonorario(r, 100)).toBe(33.33);
  });
});
