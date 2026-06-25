/**
 * Tests Zod — CC-0006 ECE Evolución Médica.
 *
 * Verifica: evolucionDataSchema (parse, strip extra keys, defaults, signos optional),
 * eceEvolucionUpdateSchema (borrador con solo id).
 */
import { describe, it, expect } from "vitest";
import {
  evolucionDataSchema,
  eceEvolucionUpdateSchema,
} from "../ece-evolucion";

const UUID = "00000000-0000-0000-0000-000000000001";

const PROBLEMA_VALIDO = { id: "p1", texto: "HTA", parentId: null, orden: 0 };
const PLAN_VALIDO = { id: "ip1", texto: "Metoprolol 50mg c/24h", orden: 0 };
const SIGNOS_VALIDOS = {
  presionSistolica: "120",
  presionDiastolica: "80",
  frecuenciaCardiaca: "72",
  frecuenciaRespiratoria: "16",
  temperatura: "36.5",
  saturacionO2: "98",
  escalaDolor: 2,
  pesoKg: "70",
  tallaCm: "170",
  glucometriaMgdl: "",
};

// ---------------------------------------------------------------------------
// evolucionDataSchema — parse OK
// ---------------------------------------------------------------------------

describe("evolucionDataSchema", () => {
  it("parsea objeto completo con problemas, plan y signos", () => {
    const result = evolucionDataSchema.safeParse({
      problemas: [PROBLEMA_VALIDO],
      plan: [PLAN_VALIDO],
      signos: SIGNOS_VALIDOS,
    });
    expect(result.success).toBe(true);
  });

  it("descarta claves no declaradas en el objeto raíz (strip)", () => {
    const result = evolucionDataSchema.safeParse({
      problemas: [PROBLEMA_VALIDO],
      plan: [],
      claveInventada: "valor-espurio",
    });
    expect(result.success).toBe(true);
    // La clave inventada no debe aparecer en el output
    expect((result.data as Record<string, unknown>)["claveInventada"]).toBeUndefined();
  });

  it("conserva signos cuando está declarado en el schema", () => {
    const result = evolucionDataSchema.parse({
      problemas: [],
      plan: [],
      signos: SIGNOS_VALIDOS,
    });
    expect(result.signos).toBeDefined();
    expect(result.signos?.escalaDolor).toBe(2);
  });

  it("acepta signos ausente (optional) y aplica default [] a problemas y plan", () => {
    const result = evolucionDataSchema.parse({});
    expect(result.problemas).toEqual([]);
    expect(result.plan).toEqual([]);
    expect(result.signos).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// eceEvolucionUpdateSchema — borrador sin campos SOAP
// ---------------------------------------------------------------------------

describe("eceEvolucionUpdateSchema", () => {
  it("acepta borrador con solo id (todos los SOAP ausentes)", () => {
    expect(eceEvolucionUpdateSchema.safeParse({ id: UUID }).success).toBe(true);
  });

  it("rechaza si falta id", () => {
    expect(
      eceEvolucionUpdateSchema.safeParse({ soapSubjetivo: "texto" }).success,
    ).toBe(false);
  });

  it("rechaza id con formato no-uuid", () => {
    expect(
      eceEvolucionUpdateSchema.safeParse({ id: "no-es-uuid" }).success,
    ).toBe(false);
  });
});
