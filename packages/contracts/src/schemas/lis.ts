/**
 * §17 LIS — schemas de input + helpers de business rules.
 *
 * Beta.3 hardening (2026-05-13):
 * - Helpers puros: `evaluateLabResultFlag` para auto-flagging por reference
 *   ranges, `applyReflexRules` para detectar pruebas reflex a ordenar
 *   automáticamente, `canTransitionLabOrder` state machine.
 * - Tipos para reference ranges age/sex stratified y reflex rules.
 */
import { z } from "zod";

const SPECIMEN_TYPE = ["BLOOD", "URINE", "STOOL", "CSF", "SWAB", "TISSUE", "SALIVA", "OTHER"] as const;
const LAB_PRIORITY = ["ROUTINE", "URGENT", "STAT"] as const;
const LAB_ORDER_STATUS = ["DRAFT", "ORDERED", "COLLECTED", "IN_PROCESS", "RESULTED", "VALIDATED", "CANCELLED"] as const;
const SPECIMEN_CONDITION = ["ACCEPTABLE", "REJECTED", "HEMOLYZED", "CLOTTED", "INSUFFICIENT"] as const;
const RESULT_FLAG = ["NORMAL", "LOW", "HIGH", "CRITICAL_LOW", "CRITICAL_HIGH", "ABNORMAL"] as const;

export const specimenTypeEnum = z.enum(SPECIMEN_TYPE);
export const labPriorityEnum = z.enum(LAB_PRIORITY);
export const labOrderStatusEnum = z.enum(LAB_ORDER_STATUS);
export const specimenConditionEnum = z.enum(SPECIMEN_CONDITION);
export const resultFlagEnum = z.enum(RESULT_FLAG);

export const labPanelListInput = z.object({
  search: z.string().trim().max(120).optional(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
});

export const labTestListInput = z.object({
  panelId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
});

export const labOrderItemInput = z.object({
  testId: z.string().uuid(),
  notes: z.string().trim().max(2000).optional(),
});

export const labOrderCreateInput = z.object({
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  priority: labPriorityEnum.default("ROUTINE"),
  clinicalIndication: z.string().trim().max(2000).optional(),
  items: z.array(labOrderItemInput).min(1).max(50),
  /** Centro de costo solicitante (productivo o intermedio). */
  costCenterId: z.string().uuid().optional(),
  /** Centro ejecutor. Si se omite, el router asigna el laboratorio clínico (code 2-LAB-CLI). */
  ejecutorCostCenterId: z.string().uuid().optional(),
});

export const labOrderListInput = z.object({
  encounterId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  priority: labPriorityEnum.optional(),
  status: labOrderStatusEnum.optional(),
  fromDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  /** Filtrar por centro solicitante. */
  costCenterId: z.string().uuid().optional(),
  /** Filtrar por centro ejecutor. */
  ejecutorCostCenterId: z.string().uuid().optional(),
});

// JCI Standard: IPSG.1 ME 4 — toma de muestra bedside requiere 2 identificadores.
export const specimenCollectInput = z.object({
  orderId: z.string().uuid(),
  type: specimenTypeEnum,
  barcode: z.string().trim().min(1).max(80),
  collectedAt: z.coerce.date().optional(),
  /** GSRN de la pulsera del paciente (AI 8018, 18 dígitos). Requerido para bedside. */
  patientGsrn: z.string().length(18).regex(/^\d{18}$/).optional(),
  /**
   * Segundo identificador: MRN interno o valor de PatientIdentifier (DUI/NIT/NIE).
   * Cuando patientGsrn viene presente, secondIdentifier también debe venir — se
   * valida en el router con refinement lógico para no bloquear uso en lab (sin pulsera).
   */
  secondIdentifier: z.string().trim().min(1).max(80).optional(),
});

export const specimenRejectInput = z.object({
  id: z.string().uuid(),
  rejectionReason: z.string().trim().min(1).max(400),
});

export const resultEnterInput = z.object({
  orderItemId: z.string().uuid(),
  specimenId: z.string().uuid().optional(),
  valueNumeric: z.number().optional(),
  valueText: z.string().trim().max(800).optional(),
  valueUnit: z.string().trim().max(40).optional(),
  flag: resultFlagEnum.default("NORMAL"),
  notes: z.string().trim().max(2000).optional(),
});

export const resultValidateInput = z.object({
  resultId: z.string().uuid(),
});

export type LabOrderCreateInput = z.infer<typeof labOrderCreateInput>;
export type LabOrderListInput = z.infer<typeof labOrderListInput>;
export type SpecimenCollectInput = z.infer<typeof specimenCollectInput>;
export type ResultEnterInput = z.infer<typeof resultEnterInput>;
export type LisResultFlag = z.infer<typeof resultFlagEnum>;
export type LabOrderStatus = z.infer<typeof labOrderStatusEnum>;

// ---------------------------------------------------------------------------
// Beta.3 hardening — types
// ---------------------------------------------------------------------------

export type LisSex = "MALE" | "FEMALE" | "BOTH";

/**
 * Rango de referencia estratificado por edad y sexo. Wave 1: subset Adult.
 * Wave 2 introducirá tabla `LabReferenceRange` poblada con rangos completos.
 */
export interface LabReferenceRange {
  /** Valor mínimo del rango normal (null si no aplica, ej. test cualitativo). */
  minValue: number | null;
  /** Valor máximo del rango normal. */
  maxValue: number | null;
  /** Edad mínima en años aplicable (null = sin restricción inferior). */
  ageMinYears: number | null;
  /** Edad máxima en años aplicable (null = sin restricción superior). */
  ageMaxYears: number | null;
  /** Sexo aplicable: MALE, FEMALE, BOTH. */
  sex: LisSex;
  /** Valor crítico bajo (panic value low) — si <= debe alertar siempre. */
  criticalLow?: number | null;
  /** Valor crítico alto (panic value high). */
  criticalHigh?: number | null;
}

/** Regla de reflex testing — si test A da resultado X, ordenar test B. */
export interface ReflexRule {
  triggerTestCode: string; // LOINC del test base
  triggerCondition: "ABOVE" | "BELOW" | "POSITIVE" | "FLAGGED";
  triggerThreshold?: number | null; // para ABOVE/BELOW
  reflexTestCode: string; // LOINC del test a ordenar
  reflexTestName: string;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Beta.3 helpers — auto-flagging
// ---------------------------------------------------------------------------

/**
 * Evalúa el flag apropiado para un resultado numérico contra reference range
 * estratificado por edad/sexo. Si no se proporcionan rangos, retorna NORMAL.
 * Si valueNumeric es null/undefined, retorna NORMAL (resultados cualitativos
 * se flagean por valueText).
 */
export function evaluateLabResultFlag(input: {
  valueNumeric: number | null | undefined;
  ranges: LabReferenceRange[]; // múltiples; selecciona el que matchea age+sex
  patientAgeYears?: number | null;
  patientSex?: LisSex | null;
}): LisResultFlag {
  if (input.valueNumeric === null || input.valueNumeric === undefined) {
    return "NORMAL";
  }
  const value = input.valueNumeric;
  const sex = input.patientSex ?? "BOTH";
  const age = input.patientAgeYears ?? null;

  // Selecciona la mejor regla matching (más específica primero).
  const candidates = input.ranges.filter((r) => {
    const sexMatch = r.sex === "BOTH" || r.sex === sex || sex === "BOTH";
    const ageMatch =
      age === null ||
      ((r.ageMinYears === null || age >= r.ageMinYears) &&
        (r.ageMaxYears === null || age <= r.ageMaxYears));
    return sexMatch && ageMatch;
  });
  if (candidates.length === 0) return "NORMAL";

  // Prefiere reglas con sex/edad específicos > generales (BOTH/null).
  const ranked = [...candidates].sort((a, b) => {
    const aSpecificity =
      (a.sex !== "BOTH" ? 2 : 0) +
      (a.ageMinYears !== null || a.ageMaxYears !== null ? 1 : 0);
    const bSpecificity =
      (b.sex !== "BOTH" ? 2 : 0) +
      (b.ageMinYears !== null || b.ageMaxYears !== null ? 1 : 0);
    return bSpecificity - aSpecificity;
  });
  const range = ranked[0]!;

  // Críticos primero (mayor severidad).
  if (range.criticalLow !== null && range.criticalLow !== undefined && value <= range.criticalLow) {
    return "CRITICAL_LOW";
  }
  if (range.criticalHigh !== null && range.criticalHigh !== undefined && value >= range.criticalHigh) {
    return "CRITICAL_HIGH";
  }
  if (range.minValue !== null && value < range.minValue) return "LOW";
  if (range.maxValue !== null && value > range.maxValue) return "HIGH";
  return "NORMAL";
}

/** Helper — true si el flag es crítico (requiere notificación urgente). */
export function isCriticalFlag(flag: LisResultFlag): boolean {
  return flag === "CRITICAL_LOW" || flag === "CRITICAL_HIGH";
}

// ---------------------------------------------------------------------------
// Beta.3 helpers — reflex testing
// ---------------------------------------------------------------------------

/**
 * Aplica reglas de reflex testing a un resultado: si el trigger se cumple,
 * devuelve la lista de tests a ordenar automáticamente. NO ordena —
 * solo retorna la lista; el router decide cómo materializar.
 */
export function applyReflexRules(input: {
  testCode: string;
  valueNumeric?: number | null;
  flag: LisResultFlag;
  rules: ReflexRule[];
}): ReflexRule[] {
  const matches: ReflexRule[] = [];
  for (const rule of input.rules) {
    if (!rule.active) continue;
    if (rule.triggerTestCode !== input.testCode) continue;

    let triggered = false;
    switch (rule.triggerCondition) {
      case "ABOVE":
        triggered =
          input.valueNumeric != null &&
          rule.triggerThreshold != null &&
          input.valueNumeric > rule.triggerThreshold;
        break;
      case "BELOW":
        triggered =
          input.valueNumeric != null &&
          rule.triggerThreshold != null &&
          input.valueNumeric < rule.triggerThreshold;
        break;
      case "FLAGGED":
        triggered = input.flag !== "NORMAL";
        break;
      case "POSITIVE":
        // Para qualitative tests: si flag indica abnormal positiva.
        triggered = input.flag === "HIGH" || input.flag === "CRITICAL_HIGH";
        break;
    }
    if (triggered) {
      matches.push(rule);
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Beta.3 helpers — state machine LabOrder
// ---------------------------------------------------------------------------

const LAB_ORDER_TRANSITIONS = {
  DRAFT: ["ORDERED", "CANCELLED"] as const,
  ORDERED: ["COLLECTED", "CANCELLED"] as const,
  COLLECTED: ["IN_PROCESS", "CANCELLED"] as const,
  IN_PROCESS: ["RESULTED", "CANCELLED"] as const,
  RESULTED: ["VALIDATED", "CANCELLED"] as const,
  VALIDATED: [] as const,
  CANCELLED: [] as const,
} as const;

export function canTransitionLabOrder(
  from: LabOrderStatus,
  to: LabOrderStatus,
): boolean {
  return (LAB_ORDER_TRANSITIONS[from] as readonly LabOrderStatus[]).includes(to);
}

export function isTerminalLabOrderStatus(status: LabOrderStatus): boolean {
  return LAB_ORDER_TRANSITIONS[status].length === 0;
}

// ---------------------------------------------------------------------------
// Beta.3 inputs adicionales
// ---------------------------------------------------------------------------

/** Input extendido de resultEnter — incluye opcionalmente datos del paciente
 *  para calcular flag auto. Wave 1 los pasa el cliente; Wave 2 los obtiene
 *  el router desde el Patient. */
export const resultEnterWithPatientContextInput = resultEnterInput.extend({
  patientAgeYears: z.number().int().min(0).max(120).optional(),
  patientSex: z.enum(["MALE", "FEMALE", "BOTH"]).optional(),
  /** Si se quiere forzar flag manual sin recálculo. */
  forceFlagOverride: z.boolean().default(false),
});

export type ResultEnterWithPatientContextInput = z.infer<
  typeof resultEnterWithPatientContextInput
>;
