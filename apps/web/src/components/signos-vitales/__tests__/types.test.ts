/**
 * Tests unitarios — helpers puros de VitalesFormState (CC-0012).
 */
import { describe, it, expect } from "vitest";
import {
  VITALES_FORM_EMPTY,
  tieneSignosForm,
  signosNucleoCompletos,
  formulaObstetricaCompleta,
  type VitalesFormState,
} from "../types";

const NUCLEO_COMPLETO: Partial<VitalesFormState> = {
  presionSistolica: "120",
  presionDiastolica: "80",
  frecuenciaCardiaca: "75",
  frecuenciaRespiratoria: "16",
  temperatura: "37",
  saturacionO2: "98",
  fio2: "21",
};

describe("tieneSignosForm", () => {
  it("false para el estado vacío", () => {
    expect(tieneSignosForm(VITALES_FORM_EMPTY)).toBe(false);
  });

  it("true si escalaDolor > 0 aunque el resto esté vacío", () => {
    expect(tieneSignosForm({ ...VITALES_FORM_EMPTY, escalaDolor: 3 })).toBe(true);
  });

  it("true si hay al menos un campo string no vacío", () => {
    expect(tieneSignosForm({ ...VITALES_FORM_EMPTY, presionSistolica: "120" })).toBe(true);
  });

  it("fppActivo=true por sí solo NO cuenta como dato (es un toggle de UI)", () => {
    expect(tieneSignosForm({ ...VITALES_FORM_EMPTY, fppActivo: true })).toBe(false);
  });
});

describe("signosNucleoCompletos", () => {
  it("false con el estado vacío", () => {
    expect(signosNucleoCompletos(VITALES_FORM_EMPTY)).toBe(false);
  });

  it("false si falta un solo campo del núcleo (p.ej. fio2)", () => {
    const { fio2: _fio2, ...resto } = NUCLEO_COMPLETO;
    expect(
      signosNucleoCompletos({ ...VITALES_FORM_EMPTY, ...resto, fio2: "" }),
    ).toBe(false);
  });

  it("true con los 7 campos del núcleo completos", () => {
    expect(signosNucleoCompletos({ ...VITALES_FORM_EMPTY, ...NUCLEO_COMPLETO })).toBe(true);
  });
});

describe("formulaObstetricaCompleta", () => {
  it("false con el estado vacío", () => {
    expect(formulaObstetricaCompleta(VITALES_FORM_EMPTY)).toBe(false);
  });

  it("true con los 5 campos G·P·P·A·V completos", () => {
    expect(
      formulaObstetricaCompleta({
        ...VITALES_FORM_EMPTY,
        gestaG: "2",
        partoTermino: "1",
        partoPretermino: "0",
        abortos: "1",
        vivos: "1",
      }),
    ).toBe(true);
  });

  it("false si falta un campo (p.ej. vivos)", () => {
    expect(
      formulaObstetricaCompleta({
        ...VITALES_FORM_EMPTY,
        gestaG: "2",
        partoTermino: "1",
        partoPretermino: "0",
        abortos: "1",
      }),
    ).toBe(false);
  });
});
