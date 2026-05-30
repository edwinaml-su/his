/**
 * Tests unitarios — forbiddenAbbreviationsRefine (Zod refinement bloqueante).
 *
 * JCI Standard: IPSG.2 ME 3 / US-21-D2 / IPSG.2-H2
 * "Do Not Use abbreviations" — enforcement bloqueante en create/update de indicaciones.
 *
 * Estos tests validan la función Zod refinement pura; los tests de integración
 * con el router viven en packages/trpc/src/routers/ece/__tests__/indicaciones-medicas.router.test.ts.
 *
 * @QA E2E (Playwright):
 *   - Crear indicación con "10 U insulina" → error de validación visible en UI.
 *   - Crear indicación con "10 U insulina" + acknowledged=true + reason ≥10 chars → pasa.
 *   - Crear indicación con "10 U insulina" + acknowledged=true sin reason → error.
 *   - Crear indicación con "500 cc SF" (warning, no error) → pasa sin ack.
 *   - Crear indicación limpia → pasa sin ack.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { forbiddenAbbreviationsRefine } from "../forbidden-abbreviations";

// ---------------------------------------------------------------------------
// Schema de prueba que usa el refinement
// ---------------------------------------------------------------------------

const testItemSchema = z
  .object({
    descripcion: z.string().trim().min(1).max(500),
    forbiddenAbbrAcknowledged: z.boolean().optional(),
    forbiddenAbbrReason: z.string().trim().min(10).max(500).optional(),
  })
  .superRefine(forbiddenAbbreviationsRefine("descripcion"))
  .superRefine((val, ctx) => {
    if (val.forbiddenAbbrAcknowledged === true && !val.forbiddenAbbrReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["forbiddenAbbrReason"],
        message: "forbiddenAbbrReason obligatorio cuando forbiddenAbbrAcknowledged=true.",
      });
    }
  });

// ---------------------------------------------------------------------------
// Casos bloqueantes — severity="error" sin acknowledgement
// ---------------------------------------------------------------------------

describe("forbiddenAbbreviationsRefine — bloquea en severity=error sin ack", () => {
  it("rechaza descripción con 'U' (unidades) — error JCI NPSG", () => {
    const result = testItemSchema.safeParse({
      descripcion: "Insulina 10 U SC antes del desayuno",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "descripcion");
      expect(issue).toBeDefined();
      expect(issue?.message).toContain("JCI prohibidas");
      expect(issue?.params?.type).toBe("jci/ipsg2-abreviaciones");
    }
  });

  it("rechaza descripción con 'IU' (unidades internacionales)", () => {
    const result = testItemSchema.safeParse({
      descripcion: "Vitamina D 1000 IU oral diario",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "descripcion")).toBe(true);
    }
  });

  it("rechaza descripción con 'QD'", () => {
    const result = testItemSchema.safeParse({
      descripcion: "Metformina 850mg QD con alimentos",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza descripción con 'MSO4'", () => {
    const result = testItemSchema.safeParse({
      descripcion: "MSO4 4mg IV PRN dolor moderado",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza descripción con trailing zero '1.0 mg'", () => {
    const result = testItemSchema.safeParse({
      descripcion: "Warfarina 1.0 mg oral cada noche",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza descripción con leading zero ausente '.5 mg'", () => {
    const result = testItemSchema.safeParse({
      descripcion: "Digoxina .5 mg cada 24h",
    });
    expect(result.success).toBe(false);
  });

  it("issue params contiene findings con match + offset + replacement", () => {
    const result = testItemSchema.safeParse({
      descripcion: "heparina 5000 IU SC cada 12h",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "descripcion");
      const findings = issue?.params?.findings as Array<{
        match: string;
        offset: number;
        replacement: string;
      }>;
      expect(Array.isArray(findings)).toBe(true);
      expect(findings.length).toBeGreaterThan(0);
      const iuFinding = findings.find((f) => f.match.includes("IU"));
      expect(iuFinding).toBeDefined();
      expect(typeof iuFinding!.offset).toBe("number");
      expect(iuFinding!.replacement.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Casos que pasan — con acknowledgement correcto
// ---------------------------------------------------------------------------

describe("forbiddenAbbreviationsRefine — pasa con acknowledged=true + reason", () => {
  it("acepta descripción con 'U' cuando acknowledged=true y reason ≥10 chars", () => {
    const result = testItemSchema.safeParse({
      descripcion: "Insulina 10 U SC antes del desayuno",
      forbiddenAbbrAcknowledged: true,
      forbiddenAbbrReason: "Unidad ya establecida en protocolo clínico previo del servicio",
    });
    expect(result.success).toBe(true);
  });

  it("acepta descripción con 'IU' cuando acknowledged=true y reason presente", () => {
    const result = testItemSchema.safeParse({
      descripcion: "Vitamina D 1000 IU oral diario",
      forbiddenAbbrAcknowledged: true,
      forbiddenAbbrReason: "Transcripción literal de receta de especialista externo",
    });
    expect(result.success).toBe(true);
  });

  it("acepta descripción con 'MSO4' cuando acknowledged=true", () => {
    const result = testItemSchema.safeParse({
      descripcion: "MSO4 4mg IV PRN dolor",
      forbiddenAbbrAcknowledged: true,
      forbiddenAbbrReason: "Sistema legado de farmacia no acepta el nombre completo",
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Casos que pasan — sin abreviaciones prohibidas (error-severity)
// ---------------------------------------------------------------------------

describe("forbiddenAbbreviationsRefine — pasa sin abreviaciones prohibidas", () => {
  it("acepta descripción clínica limpia sin hallazgos", () => {
    const result = testItemSchema.safeParse({
      descripcion: "Paracetamol 500 mg oral cada 8 horas por 5 días",
    });
    expect(result.success).toBe(true);
  });

  it("acepta descripción con 'cc' (severity=warning, no error) sin ack", () => {
    // cc es warning — no debe bloquear el create
    const result = testItemSchema.safeParse({
      descripcion: "Suero fisiológico 500 cc IV en 4 horas",
    });
    expect(result.success).toBe(true);
  });

  it("acepta descripción con 'hs' (severity=warning, no error) sin ack", () => {
    const result = testItemSchema.safeParse({
      descripcion: "Alprazolam 0.5 mg hs para ansiedad",
    });
    expect(result.success).toBe(true);
  });

  it("acepta descripción con 'QID' — no confundir con 'QD'", () => {
    const result = testItemSchema.safeParse({
      descripcion: "Amoxicilina 500 mg oral QID por 7 días",
    });
    // QID es válido; no debe ser rechazado como QD
    expect(result.success).toBe(true);
  });

  it("acepta 0.5 mg con cero inicial — no es leading zero ausente", () => {
    const result = testItemSchema.safeParse({
      descripcion: "Levotiroxina 0.5 mg oral cada mañana en ayunas",
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Casos de error — acknowledged=true sin reason
// ---------------------------------------------------------------------------

describe("forbiddenAbbreviationsRefine — acknowledged=true requiere reason", () => {
  it("rechaza acknowledged=true sin forbiddenAbbrReason", () => {
    const result = testItemSchema.safeParse({
      descripcion: "Insulina 10 U SC",
      forbiddenAbbrAcknowledged: true,
      // forbiddenAbbrReason ausente
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const reasonIssue = result.error.issues.find(
        (i) => i.path[0] === "forbiddenAbbrReason",
      );
      expect(reasonIssue).toBeDefined();
    }
  });

  it("rechaza acknowledged=true con reason vacía (no cumple min:10)", () => {
    const result = testItemSchema.safeParse({
      descripcion: "Insulina 10 U SC",
      forbiddenAbbrAcknowledged: true,
      forbiddenAbbrReason: "corto",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Campo vacío o no-string — refinement no aplica
// ---------------------------------------------------------------------------

describe("forbiddenAbbreviationsRefine — campo vacío / no relevante", () => {
  it("string vacío no dispara la validación de abreviaciones", () => {
    // El schema tiene min(1) así que un string vacío ya falla antes del refine;
    // verificamos que el error sea por min-length, no por abreviaciones.
    const result = testItemSchema.safeParse({ descripcion: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      // No debe haber issue del tipo "jci/ipsg2-abreviaciones"
      const jciIssue = result.error.issues.find(
        (i) => i.params?.type === "jci/ipsg2-abreviaciones",
      );
      expect(jciIssue).toBeUndefined();
    }
  });
});
