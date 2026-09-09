/**
 * Pipeline de seguridad al firmar una indicación médica — ADR 0023 Ola 2.
 *
 * Contexto: `docs/adr/0023-punto-unico-de-prescripcion.md` (Opción A) decide
 * que la indicación médica NTEC es el único punto de prescripción. La Ola 1
 * (`prescription-consumer.ts`) ya genera `Prescription`/`PrescriptionItem`
 * al firmar. Esta Ola 2 agrega los CONTROLES que
 * `docs/qa/drhis/R06-evaluacion-datos-farmacologicos.md` encontró diseñados
 * pero inalcanzables desde la práctica clínica real (H-01, H-04, H-06).
 *
 * ALCANCE: esta función SOLO corre si la indicación tiene al menos un ítem
 * MEDICAMENTO con `drug_id` estructurado (mismo criterio que
 * `materializePrescripcionFromIndicacion` — ADR 0023 Opción A). Ítems de
 * texto libre no tienen identidad farmacológica verificable (H-01 lo dice
 * explícitamente: no hay ATC contra qué cruzar interacciones, ni fármaco
 * identificable para el ajuste renal). Si NINGÚN ítem de la indicación trae
 * drug_id, `checkPrescriptionSafety` retorna de inmediato sin tocar la BD.
 *
 * ───────────────────────────────────────────────────────────────────────
 * Interacciones (H-01/H-06)
 * ───────────────────────────────────────────────────────────────────────
 * Cruza los fármacos de ESTA indicación (a) entre sí y (b) contra los
 * medicamentos "activos" del paciente. Criterio de "activo" (el modelo hoy
 * no tiene fecha de fin de tratamiento estructurada — `duracion` es texto
 * libre — así que se usa lo único disponible): ítems MEDICAMENTO con
 * drug_id de OTRAS indicaciones del mismo paciente (cualquier episodio)
 * cuyo `estado_registro` esté en (firmado, validado) y `vigencia='ACTIVA'`.
 * Ampliable cuando `duracion`/`dosis_valor` se estructuren con una fecha de
 * fin real.
 *
 * Solo se reportan alertas donde participa al menos un fármaco de ESTA
 * indicación — un par de interacción puramente entre dos medicamentos
 * preexistentes ya se evaluó cuando se prescribieron; bloquear la firma
 * actual por eso sería un falso stop sin relación con lo que el médico está
 * firmando ahora.
 *
 * Usa `detectInteractionAlerts`/`hasBlockingInteraction`
 * (`@his/contracts` `schemas/pharmacy`) — el MISMO helper puro que
 * `pharmacy.router.ts` `prescription.sign` ya usa. H-01 pedía exactamente
 * esto: no un motor nuevo, cablear el que ya existe a la ruta real de
 * prescripción. El dataset (Wave 1, JSON estático) lo carga el caller
 * (`getInteractionsDataset()` de `pharmacy.router.ts`) para no duplicar la
 * lógica de resolución de rutas de archivo.
 *
 * ───────────────────────────────────────────────────────────────────────
 * Alerta renal Cockcroft-Gault (H-04) — SOLO advisory, nunca bloquea
 * ───────────────────────────────────────────────────────────────────────
 * Requiere, en orden:
 *   1. Paciente adulto (≥18 años — Cockcroft-Gault no está validada en
 *      pediatría) con `biologicalSex.code` resoluble a 'M' o 'F' (la
 *      fórmula clásica solo define esos dos factores).
 *   2. Peso más reciente en `ece.signos_vitales.peso` para el episodio
 *      (CC-0012, capturador único transversal).
 *   3. Creatinina sérica: `LabResult` validado (regla 4-eyes del LIS, ver
 *      `LabResult.validatedById`) más reciente de un `LabTest` cuyo nombre
 *      sea "CREATININA" con `specimen=BLOOD` (excluye creatinina en orina,
 *      unidades/interpretación distintas).
 * Si falta cualquier insumo, omite en silencio — no es un hallazgo nuevo,
 * es un dato clínico no capturado todavía (comportamiento pedido
 * explícitamente por el ADR).
 *
 * Motor: `evalFormula`/`classify` de `@his/infrastructure`
 * (`packages/infrastructure/src/formula/engine.ts`), con la definición
 * CALC-NEFRO-001 (Cockcroft-Gault) — el mismo motor con tests golden que
 * R06 encontró huérfano (cero consumidores fuera de `packages/
 * infrastructure`). NO hace dosificación por fármaco — eso requiere una
 * fuente farmacológica licenciada (ver R06 §Opciones); solo alerta cuando
 * ClCr estimado < 60 mL/min.
 */
import type { PrismaClient } from "@his/database";
// Subpath "./formula" — el barrel raíz de @his/infrastructure NO re-exporta
// el motor de fórmulas (ver src/index.ts); evalFormula/classify solo están
// disponibles vía @his/infrastructure/formula.
import { evalFormula, classify, type CalcDefFormula } from "@his/infrastructure/formula";
// Importación relativa directa (no @his/contracts) — mismo motivo que
// pharmacy.router.ts: evita ciclo ESM con el barrel de @his/contracts en
// contexto de tests vitest.
import {
  detectInteractionAlerts,
  hasBlockingInteraction,
  type DrugInteractionEntry,
  type PharmacyInteractionAlert,
} from "../../../contracts/src/schemas/pharmacy";

export interface SafetyCheckItem {
  /** ece.indicacion_item.id */
  id: string;
  /** CC-0026 Ola 2 (SQL 211). NULL = texto libre legacy, excluido del pipeline. */
  drugId: string | null;
}

export interface PrescriptionSafetyResult {
  /** Alertas donde participa al menos un fármaco de ESTA indicación. */
  alerts: PharmacyInteractionAlert[];
  /** true si alguna alerta es severity major/contraindicated (hard-stop). */
  blocking: boolean;
  /** Texto de advertencia renal, o null si no aplica / faltan insumos. */
  renalAdvisory: string | null;
}

// ---------------------------------------------------------------------------
// Cockcroft-Gault (CALC-NEFRO-001) — espejo de
// packages/database/scripts/data/calculadoras-catalog.json y de los tests
// golden en packages/infrastructure/src/formula/engine.test.ts. Se inlinea
// acá (en vez de leer el catálogo JSON) porque este pipeline es server-side
// puro y no depende de la UI de calculadoras clínicas.
// ---------------------------------------------------------------------------

const COCKCROFT_GAULT_DEF: CalcDefFormula = {
  inputs: [
    { id: "edad", label: "Edad", u: "años" },
    { id: "peso", label: "Peso", u: "kg" },
    { id: "crea", label: "Creatinina sérica", u: "mg/dL" },
    {
      id: "sexo",
      type: "select",
      label: "Sexo",
      opts: [
        { v: "Masculino", f: 1 },
        { v: "Femenino", f: 0.85 },
      ],
      sel: 0,
    },
  ],
  expr: "((140 - edad) * peso / (72 * crea)) * sexoF",
  out: { label: "Depuración de creatinina", u: "mL/min", dec: 1 },
  interp: [
    { max: 30, n: "critico", t: "Deterioro grave" },
    { max: 60, n: "alerta", t: "Deterioro moderado" },
    { n: "normal", t: "Función renal adecuada" },
  ],
};

const RENAL_MIN_AGE_YEARS = 18;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * Convierte Prisma Decimal-or-number-or-null a number-or-null. Mismo patrón
 * que `decimalToNullableNumber` en `lis.router.ts` — Prisma serializa
 * columnas Decimal como objetos `{toNumber()}`; los mocks de test suelen
 * pasar el number crudo directamente.
 */
function decimalToNumber(v: { toNumber: () => number } | number | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === "number" ? v : v.toNumber();
}

/**
 * Pipeline completo de seguridad. Ver header del archivo para el alcance y
 * el criterio de cada control. Debe llamarse DENTRO de la misma transacción
 * `withEceContext(..., { tenantContext })` que `firmar()` — lee `Drug`,
 * `Patient` y `LabResult` (`public.*`, RLS de tenant clásico).
 */
export async function checkPrescriptionSafety(
  tx: PrismaClient,
  params: { episodioId: string; currentItems: SafetyCheckItem[] },
  interactionsDataset: DrugInteractionEntry[],
): Promise<PrescriptionSafetyResult> {
  const currentDrugIds = Array.from(
    new Set(
      params.currentItems
        .map((it) => it.drugId)
        .filter((id): id is string => typeof id === "string"),
    ),
  );

  if (currentDrugIds.length === 0) {
    return { alerts: [], blocking: false, renalAdvisory: null };
  }

  const alerts = await detectInteractionsForIndicacion(
    tx,
    params.episodioId,
    currentDrugIds,
    interactionsDataset,
  );
  const renalAdvisory = await computeRenalAdvisory(tx, params.episodioId);

  return { alerts, blocking: hasBlockingInteraction(alerts), renalAdvisory };
}

async function detectInteractionsForIndicacion(
  tx: PrismaClient,
  episodioId: string,
  currentDrugIds: string[],
  dataset: DrugInteractionEntry[],
): Promise<PharmacyInteractionAlert[]> {
  // Medicamentos "activos" del paciente en OTRAS indicaciones firmadas/
  // validadas vigentes (mismo paciente, cualquier episodio) — ver criterio
  // completo en el header del archivo.
  const activeRows = await tx.$queryRaw<{ drug_id: string }[]>`
    SELECT DISTINCT ii.drug_id::text AS drug_id
    FROM ece.indicacion_item ii
    JOIN ece.indicaciones_medicas im ON im.id = ii.indicacion_id
    JOIN ece.episodio_atencion ea ON ea.id = im.episodio_id
    WHERE ea.paciente_id = (
        SELECT paciente_id FROM ece.episodio_atencion WHERE id = ${episodioId}::uuid
      )
      AND im.estado_registro IN ('firmado', 'validado')
      AND im.vigencia = 'ACTIVA'
      AND ii.tipo = 'MEDICAMENTO'
      AND ii.drug_id IS NOT NULL
  `;

  const allDrugIds = Array.from(
    new Set<string>([...currentDrugIds, ...activeRows.map((r) => r.drug_id)]),
  );

  const drugs = await tx.drug.findMany({
    where: { id: { in: allDrugIds } },
    select: { id: true, atcCode: true, genericName: true },
  });
  const drugById = new Map(drugs.map((d) => [d.id, d]));

  const currentAtcSet = new Set(
    currentDrugIds
      .map((id) => drugById.get(id)?.atcCode?.trim().toUpperCase())
      .filter((c): c is string => !!c),
  );
  // Ningún ítem de esta indicación resolvió atcCode (Drug sin catalogar) —
  // no hay nada contra qué cruzar.
  if (currentAtcSet.size === 0) return [];

  const drugsForCheck = allDrugIds
    .map((id) => drugById.get(id))
    .filter((d): d is { id: string; atcCode: string | null; genericName: string } => !!d)
    .map((d) => ({ atcCode: d.atcCode, name: d.genericName }));

  const allAlerts = detectInteractionAlerts(drugsForCheck, dataset);
  // Solo alertas donde participa un fármaco de ESTA indicación (ver header).
  return allAlerts.filter(
    (a) => currentAtcSet.has(a.atcA) || currentAtcSet.has(a.atcB),
  );
}

async function computeRenalAdvisory(
  tx: PrismaClient,
  episodioId: string,
): Promise<string | null> {
  const bridgeRows = await tx.$queryRaw<{ patient_id: string | null }[]>`
    SELECT p.public_patient_id::text AS patient_id
    FROM ece.episodio_atencion ea
    LEFT JOIN ece.paciente p ON p.id = ea.paciente_id
    WHERE ea.id = ${episodioId}::uuid
  `;
  const patientId = bridgeRows[0]?.patient_id ?? null;
  if (!patientId) return null;

  const patient = await tx.patient.findUnique({
    where: { id: patientId },
    select: { birthDate: true, biologicalSex: { select: { code: true } } },
  });
  if (!patient?.birthDate) return null;

  const sexoCode = patient.biologicalSex?.code;
  if (sexoCode !== "M" && sexoCode !== "F") return null;

  const edad = Math.floor((Date.now() - patient.birthDate.getTime()) / MS_PER_YEAR);
  if (edad < RENAL_MIN_AGE_YEARS) return null;

  const signosRows = await tx.$queryRaw<{ peso: string | null }[]>`
    SELECT peso::text AS peso
    FROM ece.signos_vitales
    WHERE episodio_id = ${episodioId}::uuid AND peso IS NOT NULL
    ORDER BY fecha_hora_toma DESC
    LIMIT 1
  `;
  const peso = signosRows[0]?.peso ? Number(signosRows[0].peso) : null;
  if (!peso || peso <= 0) return null;

  const creaResult = await tx.labResult.findFirst({
    where: {
      valueNumeric: { not: null },
      validatedAt: { not: null },
      orderItem: {
        test: { name: { equals: "CREATININA", mode: "insensitive" }, specimen: "BLOOD" },
        order: { patientId },
      },
    },
    orderBy: { resultedAt: "desc" },
    select: { valueNumeric: true },
  });
  const crea = decimalToNumber(creaResult?.valueNumeric);
  if (!crea || crea <= 0) return null;

  const clcr = evalFormula(COCKCROFT_GAULT_DEF, {
    edad,
    peso,
    crea,
    sexo: sexoCode === "F" ? 1 : 0,
  });
  if (!Number.isFinite(clcr)) return null;

  const interp = classify(COCKCROFT_GAULT_DEF.interp, clcr);
  if (interp.n === "normal") return null;

  return `Función renal reducida (ClCr estimado ${clcr.toFixed(1)} mL/min) — verifique ajuste de dosis.`;
}
