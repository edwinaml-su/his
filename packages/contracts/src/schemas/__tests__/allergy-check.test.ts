/**
 * Tests unitarios — US.F2.6.10 cross-check alergias paciente vs GTIN.
 *
 * Valida la función pura `evaluateAllergyCheck` de `@his/contracts`.
 * El router tRPC se cubre en packages/trpc/src/routers/__tests__/allergy-check.test.ts.
 */
import { describe, it, expect } from "vitest";
import { evaluateAllergyCheck } from "../pharmacy";

// Datos de prueba fijos
const DRUG_AMOXICILINA = {
  id: "drug-amox-001",
  name: "Amoxicilina 500 mg",
  allergyFamilies: ["penicilina", "penicilínicos", "betalactámicos"],
  allergyExcipients: [] as string[],
};

const DRUG_PARACETAMOL_TARTRAZINA = {
  id: "drug-para-001",
  name: "Paracetamol 500 mg (naranja)",
  allergyFamilies: ["paracetamol"],
  allergyExcipients: ["tartrazina"],
};

const DRUG_SIN_ALERGENOS = {
  id: "drug-ibup-001",
  name: "Ibuprofeno 400 mg",
  allergyFamilies: ["aine", "ibuprofeno"],
  allergyExcipients: [] as string[],
};

const ALLERGY_PENICILINA = {
  id: "allergy-001",
  substanceText: "Penicilina",
  severity: "severe",
  active: true,
};

const ALLERGY_TARTRAZINA = {
  id: "allergy-002",
  substanceText: "Tartrazina",
  severity: "mild",
  active: true,
};

const NO_ALLERGIES: typeof ALLERGY_PENICILINA[] = [];
const NO_INTOLERANCES: { id: string; substanceDisplay: string; criticality: string; clinicalStatus: string }[] = [];

// ---------------------------------------------------------------------------

describe("evaluateAllergyCheck · principio activo", () => {
  it("hard stop cuando el paciente es alérgico a Penicilina y el drug es Amoxicilina", () => {
    const result = evaluateAllergyCheck(
      DRUG_AMOXICILINA,
      [ALLERGY_PENICILINA],
      NO_INTOLERANCES,
    );

    expect(result.status).toBe("hardStop");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.type).toBe("activeIngredient");
    expect(result.matches[0]?.component.toLowerCase()).toContain("penicilina");
  });

  it("hard stop por cualquier familia coincidente del drug", () => {
    const allergyBetalact = {
      id: "allergy-003",
      substanceText: "betalactámicos",
      severity: "moderate",
      active: true,
    };
    const result = evaluateAllergyCheck(DRUG_AMOXICILINA, [allergyBetalact], NO_INTOLERANCES);

    expect(result.status).toBe("hardStop");
    expect(result.matches[0]?.type).toBe("activeIngredient");
  });

  it("hard stop se dispara aunque haya también excipiente alergénico", () => {
    // Drug con ambos — el hard stop debe dominar.
    const drugCombo = {
      id: "drug-combo-001",
      name: "Amoxicilina con tartrazina",
      allergyFamilies: ["penicilina"],
      allergyExcipients: ["tartrazina"],
    };
    const result = evaluateAllergyCheck(
      drugCombo,
      [ALLERGY_PENICILINA, ALLERGY_TARTRAZINA],
      NO_INTOLERANCES,
    );

    expect(result.status).toBe("hardStop");
    // Hard stop retorna solo matches de principio activo (la función corta en el primer bloque).
    expect(result.matches.every((m) => m.type === "activeIngredient")).toBe(true);
  });
});

describe("evaluateAllergyCheck · excipiente", () => {
  it("warning cuando el paciente es alérgico a Tartrazina y el drug la contiene como excipiente", () => {
    const result = evaluateAllergyCheck(
      DRUG_PARACETAMOL_TARTRAZINA,
      [ALLERGY_TARTRAZINA],
      NO_INTOLERANCES,
    );

    expect(result.status).toBe("warning");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.type).toBe("excipient");
    expect(result.matches[0]?.component.toLowerCase()).toContain("tartrazina");
  });

  it("warning desde AllergyIntolerance v2 cuando substanceDisplay coincide con excipiente", () => {
    const v2Intolerance = {
      id: "intol-001",
      substanceDisplay: "Tartrazina (E102)",
      criticality: "low",
      clinicalStatus: "active",
    };
    const result = evaluateAllergyCheck(
      DRUG_PARACETAMOL_TARTRAZINA,
      NO_ALLERGIES,
      [v2Intolerance],
    );

    expect(result.status).toBe("warning");
    expect(result.matches[0]?.type).toBe("excipient");
  });
});

describe("evaluateAllergyCheck · sin alertas", () => {
  it("ok cuando el paciente no tiene alergias registradas", () => {
    const result = evaluateAllergyCheck(DRUG_AMOXICILINA, NO_ALLERGIES, NO_INTOLERANCES);

    expect(result.status).toBe("ok");
    expect(result.matches).toHaveLength(0);
  });

  it("ok cuando las alergias del paciente no coinciden con el drug", () => {
    const result = evaluateAllergyCheck(
      DRUG_SIN_ALERGENOS,
      [ALLERGY_PENICILINA, ALLERGY_TARTRAZINA],
      NO_INTOLERANCES,
    );

    expect(result.status).toBe("ok");
    expect(result.matches).toHaveLength(0);
  });

  it("ok cuando la alergia está inactiva", () => {
    const inactiveAllergy = { ...ALLERGY_PENICILINA, active: false };
    const result = evaluateAllergyCheck(DRUG_AMOXICILINA, [inactiveAllergy], NO_INTOLERANCES);

    expect(result.status).toBe("ok");
  });

  it("ok cuando la intolerancia v2 tiene clinicalStatus inactive", () => {
    const inactiveIntolerance = {
      id: "intol-002",
      substanceDisplay: "Tartrazina",
      criticality: "low",
      clinicalStatus: "inactive",
    };
    const result = evaluateAllergyCheck(
      DRUG_PARACETAMOL_TARTRAZINA,
      NO_ALLERGIES,
      [inactiveIntolerance],
    );

    expect(result.status).toBe("ok");
  });
});

describe("evaluateAllergyCheck · resultado incluye metadata", () => {
  it("incluye drugId y drugName en el resultado", () => {
    const result = evaluateAllergyCheck(DRUG_AMOXICILINA, [ALLERGY_PENICILINA], NO_INTOLERANCES);

    expect(result.drugId).toBe(DRUG_AMOXICILINA.id);
    expect(result.drugName).toBe(DRUG_AMOXICILINA.name);
  });

  it("incluye allergyId del paciente en el match", () => {
    const result = evaluateAllergyCheck(DRUG_AMOXICILINA, [ALLERGY_PENICILINA], NO_INTOLERANCES);

    expect(result.matches[0]?.allergyId).toBe(ALLERGY_PENICILINA.id);
  });
});
