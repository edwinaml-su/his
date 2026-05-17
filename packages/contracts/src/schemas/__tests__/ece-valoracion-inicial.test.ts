/**
 * Tests Zod — ECE Valoración Inicial de Enfermería.
 *
 * Verifica: escalas, estados workflow, create/update/list schemas.
 * Cobertura objetivo: ≥80% del módulo ece-valoracion-inicial.ts.
 */
import { describe, it, expect } from "vitest";
import {
  escalaBradenSchema,
  escalaMorseSchema,
  escalaDoloreSchema,
  estadoValoracionEnum,
  eceValoracionInicialCreateSchema,
  eceValoracionInicialUpdateSchema,
  eceValoracionInicialListSchema,
  eceValoracionInicialIdSchema,
} from "../ece-valoracion-inicial";

const UUID = "00000000-0000-0000-0000-000000000001";
const EPISODIO_ID = "00000000-0000-0000-0000-000000000002";

// ---------------------------------------------------------------------------
// Escala Braden (6–23)
// ---------------------------------------------------------------------------

describe("escalaBradenSchema", () => {
  it("acepta valor mínimo 6", () => {
    expect(escalaBradenSchema.safeParse(6).success).toBe(true);
  });

  it("acepta valor máximo 23", () => {
    expect(escalaBradenSchema.safeParse(23).success).toBe(true);
  });

  it("rechaza valor 5 (por debajo del mínimo)", () => {
    expect(escalaBradenSchema.safeParse(5).success).toBe(false);
  });

  it("rechaza valor 24 (por encima del máximo)", () => {
    expect(escalaBradenSchema.safeParse(24).success).toBe(false);
  });

  it("rechaza decimal", () => {
    expect(escalaBradenSchema.safeParse(10.5).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Escala Morse (0–125)
// ---------------------------------------------------------------------------

describe("escalaMorseSchema", () => {
  it("acepta 0", () => {
    expect(escalaMorseSchema.safeParse(0).success).toBe(true);
  });

  it("acepta 125", () => {
    expect(escalaMorseSchema.safeParse(125).success).toBe(true);
  });

  it("rechaza -1", () => {
    expect(escalaMorseSchema.safeParse(-1).success).toBe(false);
  });

  it("rechaza 126", () => {
    expect(escalaMorseSchema.safeParse(126).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Escala de Dolor (0–10)
// ---------------------------------------------------------------------------

describe("escalaDoloreSchema", () => {
  it("acepta 0 (sin dolor)", () => {
    expect(escalaDoloreSchema.safeParse(0).success).toBe(true);
  });

  it("acepta 10 (dolor máximo)", () => {
    expect(escalaDoloreSchema.safeParse(10).success).toBe(true);
  });

  it("rechaza 11", () => {
    expect(escalaDoloreSchema.safeParse(11).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Estado de valoración enum
// ---------------------------------------------------------------------------

describe("estadoValoracionEnum", () => {
  it.each(["borrador", "firmado", "validado", "anulado"])(
    "acepta estado '%s'",
    (estado) => {
      expect(estadoValoracionEnum.safeParse(estado).success).toBe(true);
    },
  );

  it("rechaza estado desconocido", () => {
    expect(estadoValoracionEnum.safeParse("en_revision").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Create schema
// ---------------------------------------------------------------------------

describe("eceValoracionInicialCreateSchema", () => {
  const base = {
    episodioHospitalarioId: EPISODIO_ID,
    fechaHora: new Date().toISOString(),
  };

  it("acepta payload mínimo válido", () => {
    expect(eceValoracionInicialCreateSchema.safeParse(base).success).toBe(true);
  });

  it("acepta payload completo", () => {
    const result = eceValoracionInicialCreateSchema.safeParse({
      ...base,
      antecedentesPersonales: "HTA",
      antecedentesFamiliares: "DM materna",
      alergiasConocidas: "Penicilina",
      medicamentosActuales: "Metoprolol 50mg",
      escalaBraden: 12,
      escalaMorse: 45,
      escalaDolor: 6,
      estadoConsciencia: "Alerta, orientado en 3 esferas",
      dispositivosInvasivos: "CVC yugular derecho",
      educacionBrindada: "Higiene de manos",
      planCuidadosInicial: "Monitoreo continuo, posición semisentada",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza episodioHospitalarioId vacío", () => {
    expect(
      eceValoracionInicialCreateSchema.safeParse({
        ...base,
        episodioHospitalarioId: "",
      }).success,
    ).toBe(false);
  });

  it("rechaza UUID malformado", () => {
    expect(
      eceValoracionInicialCreateSchema.safeParse({
        ...base,
        episodioHospitalarioId: "no-es-uuid",
      }).success,
    ).toBe(false);
  });

  it("rechaza escalaBraden fuera de rango", () => {
    expect(
      eceValoracionInicialCreateSchema.safeParse({
        ...base,
        escalaBraden: 3,
      }).success,
    ).toBe(false);
  });

  it("rechaza escalaDolor fuera de rango", () => {
    expect(
      eceValoracionInicialCreateSchema.safeParse({
        ...base,
        escalaDolor: 11,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Update schema
// ---------------------------------------------------------------------------

describe("eceValoracionInicialUpdateSchema", () => {
  it("acepta update solo con id (todos los campos opcionales)", () => {
    expect(
      eceValoracionInicialUpdateSchema.safeParse({ id: UUID }).success,
    ).toBe(true);
  });

  it("acepta update parcial con escalas", () => {
    expect(
      eceValoracionInicialUpdateSchema.safeParse({
        id: UUID,
        escalaBraden: 18,
        escalaDolor: 3,
      }).success,
    ).toBe(true);
  });

  it("rechaza id faltante", () => {
    expect(
      eceValoracionInicialUpdateSchema.safeParse({ escalaBraden: 10 }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// List schema
// ---------------------------------------------------------------------------

describe("eceValoracionInicialListSchema", () => {
  it("aplica default limit=20 cuando se omite", () => {
    const result = eceValoracionInicialListSchema.parse({});
    expect(result.limit).toBe(20);
  });

  it("acepta filtro por episodio", () => {
    const result = eceValoracionInicialListSchema.safeParse({
      episodioHospitalarioId: EPISODIO_ID,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza limit > 100", () => {
    expect(
      eceValoracionInicialListSchema.safeParse({ limit: 200 }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Id schema
// ---------------------------------------------------------------------------

describe("eceValoracionInicialIdSchema", () => {
  it("acepta UUID válido", () => {
    expect(eceValoracionInicialIdSchema.safeParse({ id: UUID }).success).toBe(
      true,
    );
  });

  it("rechaza UUID inválido", () => {
    expect(
      eceValoracionInicialIdSchema.safeParse({ id: "no-uuid" }).success,
    ).toBe(false);
  });
});
