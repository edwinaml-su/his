/**
 * Tests Zod — ECE Historia Clínica (control de cambios CC-0001 / Avante v1.0).
 *
 * Cubre los catálogos y reglas de negocio nuevas:
 *   RF-03 / RN-02  diagnósticos CIE-11 + CIE11_CODE_REGEX
 *   RF-06 / RN-08  Destino (catálogo cerrado de 9; CC-0007 RF-12 sumó FALLECIDO)
 *   RN-03          ≥1 diagnóstico Complementario (tieneComplementario)
 *   RF-02 / RN-05  antecedentes + bloque obstétrico (FUM ∈ [hoy−300, hoy])
 *   createInput    episodioId + tipoConsulta obligatorios (RN-01)
 */
import { describe, it, expect } from "vitest";
import {
  TIPO_DIAGNOSTICO,
  tipoDiagnosticoEnum,
  TIPO_DIAGNOSTICO_LABELS,
  DESTINO_OPTIONS,
  destinoEnum,
  DESTINO_LABELS,
  CIE11_CODE_REGEX,
  cie11DiagnosticoSchema,
  tieneComplementario,
  antecedentesSchema,
  historiaClinicaCreateInput,
} from "../ece-historia-clinica";

const EPISODIO_ID = "00000000-0000-0000-0000-000000000001";

// Fecha yyyy-mm-dd a `offsetDays` días de hoy (UTC) — para probar RN-05.
function fechaOffset(offsetDays: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// RF-03 — tipo de diagnóstico
// ---------------------------------------------------------------------------

describe("TIPO_DIAGNOSTICO", () => {
  it("contiene exactamente Presuntivo/Definitivo/Complementario", () => {
    expect(TIPO_DIAGNOSTICO).toEqual(["PRESUNTIVO", "DEFINITIVO", "COMPLEMENTARIO"]);
  });

  it("tiene una etiqueta legible por cada valor", () => {
    for (const t of TIPO_DIAGNOSTICO) {
      expect(TIPO_DIAGNOSTICO_LABELS[t]).toBeTruthy();
    }
  });

  it("el enum rechaza un tipo desconocido", () => {
    expect(tipoDiagnosticoEnum.safeParse("PRINCIPAL").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RF-06 / RN-08 — Destino (catálogo cerrado de 9; CC-0007 RF-12 sumó FALLECIDO)
// ---------------------------------------------------------------------------

describe("DESTINO_OPTIONS", () => {
  it("define exactamente 9 destinos", () => {
    // CC-0001 definió 8; CC-0007 RF-12 (#486) agregó FALLECIDO → 9.
    expect(DESTINO_OPTIONS).toHaveLength(9);
  });

  it("tiene etiqueta para cada destino", () => {
    for (const d of DESTINO_OPTIONS) {
      expect(DESTINO_LABELS[d]).toBeTruthy();
    }
  });

  it("acepta un destino del catálogo", () => {
    expect(destinoEnum.safeParse("ALTA_MEDICA").success).toBe(true);
  });

  it("rechaza un destino fuera del catálogo (legacy 'ALTA')", () => {
    expect(destinoEnum.safeParse("ALTA").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RF-03 / RN-02 — CIE11_CODE_REGEX
// ---------------------------------------------------------------------------

describe("CIE11_CODE_REGEX", () => {
  it.each([
    "1A00", // stem MMS
    "XS25", // extensión
    "BA00.0", // con decimal
    "KA62.1", // clúster
    "2A00&XH8TR4", // postcoordinado
    "J45.0", // CIE-10 legacy admitido
  ])("acepta %s", (code) => {
    expect(CIE11_CODE_REGEX.test(code)).toBe(true);
  });

  it.each([
    "A", // un solo carácter
    "", // vacío
    "1A 00", // espacio
    "1A00.", // termina en separador
  ])("rechaza %s", (code) => {
    expect(CIE11_CODE_REGEX.test(code)).toBe(false);
  });

  it("el schema persiste el código tal cual (validación de superficie)", () => {
    const r = cie11DiagnosticoSchema.safeParse({
      codigo: "BA00",
      descripcion: "Hipertensión",
      tipo: "COMPLEMENTARIO",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza descripción vacía", () => {
    expect(
      cie11DiagnosticoSchema.safeParse({ codigo: "BA00", descripcion: "", tipo: "DEFINITIVO" })
        .success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RN-03 — tieneComplementario
// ---------------------------------------------------------------------------

describe("tieneComplementario", () => {
  it("true si hay al menos un COMPLEMENTARIO", () => {
    expect(
      tieneComplementario([{ tipo: "DEFINITIVO" }, { tipo: "COMPLEMENTARIO" }]),
    ).toBe(true);
  });

  it("false si no hay ninguno", () => {
    expect(tieneComplementario([{ tipo: "DEFINITIVO" }, { tipo: "PRESUNTIVO" }])).toBe(false);
  });

  it("false con lista vacía", () => {
    expect(tieneComplementario([])).toBe(false);
  });

  it("tolera tipo null/undefined", () => {
    expect(tieneComplementario([{ tipo: null }, {}])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RF-02 / RN-05 — antecedentes + bloque obstétrico
// ---------------------------------------------------------------------------

describe("antecedentesSchema", () => {
  it("acepta solo campos patológicos", () => {
    expect(
      antecedentesSchema.safeParse({ alergias: "Penicilina", personales: "HTA" }).success,
    ).toBe(true);
  });

  it("acepta campos no patológicos (ocupación, hábitos, obstétricos)", () => {
    const r = antecedentesSchema.safeParse({
      ocupacion: "Agricultor",
      habitosPersonales: "Tabaquismo",
      obstetricos: "G3P2A0",
    });
    expect(r.success).toBe(true);
  });

  it("acepta FUM de hoy (límite superior de RN-05)", () => {
    expect(antecedentesSchema.safeParse({ fum: fechaOffset(0) }).success).toBe(true);
  });

  it("acepta FUM de hace 300 días (límite inferior de RN-05)", () => {
    expect(antecedentesSchema.safeParse({ fum: fechaOffset(-300) }).success).toBe(true);
  });

  it("rechaza FUM futura (RN-05)", () => {
    expect(antecedentesSchema.safeParse({ fum: fechaOffset(1) }).success).toBe(false);
  });

  it("rechaza FUM anterior a 300 días (RN-05)", () => {
    expect(antecedentesSchema.safeParse({ fum: fechaOffset(-301) }).success).toBe(false);
  });

  it("rechaza FUM con formato inválido", () => {
    expect(antecedentesSchema.safeParse({ fum: "01/04/2026" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RN-01 — createInput
// ---------------------------------------------------------------------------

describe("historiaClinicaCreateInput", () => {
  it("acepta el mínimo: episodioId + tipoConsulta", () => {
    expect(
      historiaClinicaCreateInput.safeParse({
        episodioId: EPISODIO_ID,
        tipoConsulta: "ambulatoria",
      }).success,
    ).toBe(true);
  });

  it("rechaza sin episodioId (RN-01)", () => {
    expect(historiaClinicaCreateInput.safeParse({ tipoConsulta: "ambulatoria" }).success).toBe(
      false,
    );
  });

  it("rechaza sin tipoConsulta (RN-01)", () => {
    expect(historiaClinicaCreateInput.safeParse({ episodioId: EPISODIO_ID }).success).toBe(false);
  });

  it("admite destino, analisisClinico y diagnósticos CIE-11", () => {
    const r = historiaClinicaCreateInput.safeParse({
      episodioId: EPISODIO_ID,
      tipoConsulta: "urgencia",
      destino: "REFERENCIA",
      analisisClinico: "Correlación clínica favorable.",
      diagnosticos: [{ codigo: "1A00", descripcion: "Cólera", tipo: "COMPLEMENTARIO" }],
    });
    expect(r.success).toBe(true);
  });
});
