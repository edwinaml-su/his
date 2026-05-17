/**
 * Tests Zod — ECE Registro Anestésico Intraoperatorio.
 */
import { describe, it, expect } from "vitest";
import {
  tipoAnestesiaEnum,
  viaAereaEnum,
  estadoRegistroAnestEnum,
  medicamentoAdministradoSchema,
  signoVitalIntraopSchema,
  eceRegistroAnestesicoCreateSchema,
  eceRegistroAnestesicoListSchema,
  eceRegistroAnestesicoIdSchema,
  registrarSignoVitalSchema,
} from "../ece-registro-anestesico";

const UUID = "00000000-0000-0000-0000-000000000001";
const ACTO_ID = "00000000-0000-0000-0000-000000000002";
const TS = "2026-05-17T10:00:00-06:00";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

describe("tipoAnestesiaEnum", () => {
  it.each(["general", "regional", "local", "sedacion"])(
    "acepta '%s'",
    (v) => {
      expect(tipoAnestesiaEnum.safeParse(v).success).toBe(true);
    },
  );

  it("rechaza valor desconocido", () => {
    expect(tipoAnestesiaEnum.safeParse("espinal").success).toBe(false);
  });
});

describe("viaAereaEnum", () => {
  it.each(["intubacion", "mascarilla", "lma"])("acepta '%s'", (v) => {
    expect(viaAereaEnum.safeParse(v).success).toBe(true);
  });

  it("rechaza valor desconocido", () => {
    expect(viaAereaEnum.safeParse("traqueotomia").success).toBe(false);
  });
});

describe("estadoRegistroAnestEnum", () => {
  it.each(["borrador", "firmado", "anulado"])("acepta '%s'", (v) => {
    expect(estadoRegistroAnestEnum.safeParse(v).success).toBe(true);
  });

  it("rechaza 'validado' (no aplica para anestésico)", () => {
    expect(estadoRegistroAnestEnum.safeParse("validado").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// medicamentoAdministradoSchema
// ---------------------------------------------------------------------------

describe("medicamentoAdministradoSchema", () => {
  it("acepta payload mínimo válido", () => {
    const result = medicamentoAdministradoSchema.safeParse({
      nombre: "Propofol",
      dosis: "200 mg",
      via: "IV",
      hora_administracion: TS,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza nombre vacío", () => {
    expect(
      medicamentoAdministradoSchema.safeParse({
        nombre: "",
        dosis: "200 mg",
        via: "IV",
        hora_administracion: TS,
      }).success,
    ).toBe(false);
  });

  it("rechaza timestamp malformado", () => {
    expect(
      medicamentoAdministradoSchema.safeParse({
        nombre: "Ketamina",
        dosis: "50 mg",
        via: "IV",
        hora_administracion: "no-es-fecha",
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// signoVitalIntraopSchema
// ---------------------------------------------------------------------------

describe("signoVitalIntraopSchema", () => {
  it("acepta punto mínimo (solo ts)", () => {
    expect(signoVitalIntraopSchema.safeParse({ ts: TS }).success).toBe(true);
  });

  it("acepta punto completo", () => {
    expect(
      signoVitalIntraopSchema.safeParse({
        ts: TS,
        ta_sistolica: 120,
        ta_diastolica: 80,
        fc: 72,
        fr: 16,
        spo2: 98,
        etco2: 35,
      }).success,
    ).toBe(true);
  });

  it("rechaza spo2 > 100", () => {
    expect(
      signoVitalIntraopSchema.safeParse({ ts: TS, spo2: 101 }).success,
    ).toBe(false);
  });

  it("rechaza fc negativa", () => {
    expect(
      signoVitalIntraopSchema.safeParse({ ts: TS, fc: -1 }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// eceRegistroAnestesicoCreateSchema
// ---------------------------------------------------------------------------

describe("eceRegistroAnestesicoCreateSchema", () => {
  const base = {
    actoQuirurgicoId: ACTO_ID,
    asa: 2,
    tipoAnestesia: "general",
    viaAerea: "intubacion",
  };

  it("acepta payload mínimo válido", () => {
    expect(eceRegistroAnestesicoCreateSchema.safeParse(base).success).toBe(
      true,
    );
  });

  it("aplica default arrays vacíos", () => {
    const result = eceRegistroAnestesicoCreateSchema.parse(base);
    expect(result.medicamentosAdministrados).toEqual([]);
    expect(result.signosVitalesIntraop).toEqual([]);
  });

  it("acepta payload completo con medicamentos y signos vitales", () => {
    const result = eceRegistroAnestesicoCreateSchema.safeParse({
      ...base,
      medicamentosAdministrados: [
        { nombre: "Propofol", dosis: "200mg", via: "IV", hora_administracion: TS },
      ],
      signosVitalesIntraop: [
        { ts: TS, ta_sistolica: 115, ta_diastolica: 75, fc: 68, spo2: 99 },
      ],
      complicaciones: "Laringospasmo leve, resuelto con succinilcolina.",
      fluidoterapiaMl: 1500,
      perdidasSanguineasMl: 200,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza asa fuera de rango (0)", () => {
    expect(
      eceRegistroAnestesicoCreateSchema.safeParse({ ...base, asa: 0 }).success,
    ).toBe(false);
  });

  it("rechaza asa fuera de rango (6)", () => {
    expect(
      eceRegistroAnestesicoCreateSchema.safeParse({ ...base, asa: 6 }).success,
    ).toBe(false);
  });

  it("rechaza actoQuirurgicoId con UUID malformado", () => {
    expect(
      eceRegistroAnestesicoCreateSchema.safeParse({
        ...base,
        actoQuirurgicoId: "no-uuid",
      }).success,
    ).toBe(false);
  });

  it("rechaza fluidoterapiaMl negativa", () => {
    expect(
      eceRegistroAnestesicoCreateSchema.safeParse({
        ...base,
        fluidoterapiaMl: -1,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// eceRegistroAnestesicoListSchema
// ---------------------------------------------------------------------------

describe("eceRegistroAnestesicoListSchema", () => {
  it("aplica default limit=20", () => {
    const result = eceRegistroAnestesicoListSchema.parse({});
    expect(result.limit).toBe(20);
  });

  it("acepta filtro por acto y estado", () => {
    expect(
      eceRegistroAnestesicoListSchema.safeParse({
        actoQuirurgicoId: ACTO_ID,
        estado: "firmado",
      }).success,
    ).toBe(true);
  });

  it("rechaza limit > 100", () => {
    expect(
      eceRegistroAnestesicoListSchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// eceRegistroAnestesicoIdSchema
// ---------------------------------------------------------------------------

describe("eceRegistroAnestesicoIdSchema", () => {
  it("acepta UUID válido", () => {
    expect(eceRegistroAnestesicoIdSchema.safeParse({ id: UUID }).success).toBe(
      true,
    );
  });

  it("rechaza UUID inválido", () => {
    expect(
      eceRegistroAnestesicoIdSchema.safeParse({ id: "no-uuid" }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// registrarSignoVitalSchema
// ---------------------------------------------------------------------------

describe("registrarSignoVitalSchema", () => {
  it("acepta payload válido", () => {
    expect(
      registrarSignoVitalSchema.safeParse({
        id: UUID,
        signoVital: { ts: TS, fc: 72, spo2: 98 },
      }).success,
    ).toBe(true);
  });

  it("rechaza signoVital sin ts", () => {
    expect(
      registrarSignoVitalSchema.safeParse({
        id: UUID,
        signoVital: { fc: 72 },
      }).success,
    ).toBe(false);
  });
});
