/**
 * Schemas Zod para ECE Signos Vitales — módulo transversal (CC-0012, mockup avante7).
 *
 * Rangos plausibles alineados con el mockup `docs/CC/0006/evolucion-medica-avante7.html`
 * (función `vitalsBodyHTML()`), fuente única de verdad visual:
 *   TA sistólica : 60–260 mmHg      TA diastólica: 40–160 mmHg
 *   FC           : 30–220 lpm       FR           : 4–60 rpm
 *   Temperatura  : 30–43 °C         SpO2         : 50–100 %
 *   FiO2         : 21–100 %         Glucometría  : 10–900 mg/dL
 *   Peso         : 0.5–400 kg · 1–880 lb
 *   Talla        : 30–250 cm (0.3–2.5 m) · 1–8.2 ft
 *   Cintura      : 30–250 cm        Balance hídrico: ±20 000 mL
 *   Diuresis     : 0–2000 mL/h      Dolor (EVA)  : 0–10
 *   Glasgow      : ocular 1–4 · verbal 1–5 · motor 1–6 · total 3–15
 *   Fórmula obstétrica (G·P·P·A·V): 0–30 cada componente
 *
 * Columnas DB (ece.signos_vitales) — alineado post CC-0012 (migración 188):
 *   presion_sistolica / presion_diastolica / escala_dolor /
 *   fecha_hora_toma / registrado_por / observaciones (SQL 175)
 *   peso_kg / talla_cm / imc / glucometria_mgdl  (HD-18)
 *   glasgow_ocular / glasgow_verbal / glasgow_motor / glasgow_total (CC-0007, SQL 182)
 *   fio2 / ict / perimetro_cintura / balance_hidrico / diuresis / fur / fpp (CC-0007, SQL 182)
 *   cuenta_id / go_gestas / go_partos_termino / go_partos_pretermino / go_abortos /
 *   go_vivos / peso_lb / talla_ft / fpp_activo (CC-0012, SQL 188)
 *
 * CC-0012 — episodio_id es NULLABLE en BD: la toma puede anclarse solo a la
 * cuenta activa del paciente (public."PatientAccount"). superRefine exige que
 * al menos uno de {episodioId, cuentaId} esté presente (mismo CHECK que la BD).
 */
import { z } from "zod";
import { VITAL_RANGES } from "../validators/signos-vitales";

// ─── Helpers de rango ────────────────────────────────────────────────────────

function numRange(min: number, max: number, label: string) {
  return z
    .number({ required_error: `${label} es requerido.` })
    .min(min, `${label} mínimo ${min}.`)
    .max(max, `${label} máximo ${max}.`);
}

// ─── Schema de creación ──────────────────────────────────────────────────────

const eceSignosVitalesBaseSchema = z.object({
  // CC-0012 — la toma se ancla al episodio y/o a la cuenta activa (al menos
  // uno de los dos, ver superRefine más abajo). pacienteId es opcional por
  // compat legacy (el router lo resuelve server-side cuando falta).
  pacienteId: z.string().uuid().optional(),
  episodioId: z.string().uuid().optional(),
  cuentaId: z.string().uuid().optional(),

  // Núcleo obligatorio en UI (presión + oxigenación/cardiorrespiratorio) —
  // opcional a nivel Zod porque `update` envía parches parciales.
  presionSistolica: numRange(VITAL_RANGES.presionSistolica.min, VITAL_RANGES.presionSistolica.max, "TA sistólica").optional(),
  presionDiastolica: numRange(VITAL_RANGES.presionDiastolica.min, VITAL_RANGES.presionDiastolica.max, "TA diastólica").optional(),
  frecuenciaCardiaca: numRange(VITAL_RANGES.frecuenciaCardiaca.min, VITAL_RANGES.frecuenciaCardiaca.max, "FC").optional(),
  frecuenciaRespiratoria: numRange(VITAL_RANGES.frecuenciaRespiratoria.min, VITAL_RANGES.frecuenciaRespiratoria.max, "FR").optional(),
  temperatura: numRange(VITAL_RANGES.temperatura.min, VITAL_RANGES.temperatura.max, "Temperatura").optional(),
  saturacionO2: numRange(VITAL_RANGES.saturacionO2.min, VITAL_RANGES.saturacionO2.max, "SpO2").optional(),
  fio2: numRange(VITAL_RANGES.fio2.min, VITAL_RANGES.fio2.max, "FiO2").optional(),
  escalaDolor: numRange(VITAL_RANGES.dolorEva.min, VITAL_RANGES.dolorEva.max, "Dolor EVA").optional(),

  // Estado neurológico y metabólico
  glasgowOcular: numRange(1, 4, "Glasgow ocular").int().optional(),
  glasgowVerbal: numRange(1, 5, "Glasgow verbal").int().optional(),
  glasgowMotor: numRange(1, 6, "Glasgow motor").int().optional(),
  glasgowTotal: numRange(3, 15, "Glasgow total").int().optional(),
  glucometriaMgdl: numRange(VITAL_RANGES.glucometriaMgdl.min, VITAL_RANGES.glucometriaMgdl.max, "Glucometría").optional(),

  // Antropometría (HD-18 + CC-0012 conversiones kg↔lb / m↔ft)
  pesoKg: numRange(VITAL_RANGES.pesoKg.min, VITAL_RANGES.pesoKg.max, "Peso").optional(),
  pesoLb: numRange(VITAL_RANGES.pesoLb.min, VITAL_RANGES.pesoLb.max, "Peso (lb)").optional(),
  tallaCm: numRange(30, 250, "Talla").optional(),
  tallaFt: numRange(VITAL_RANGES.tallaFt.min, VITAL_RANGES.tallaFt.max, "Talla (ft)").optional(),
  perimetroCintura: numRange(VITAL_RANGES.perimetroCintura.min, VITAL_RANGES.perimetroCintura.max, "Perímetro cintura").optional(),
  ict: z.number().positive("ICT debe ser positivo.").optional(),

  // Balance hídrico
  balanceHidrico: numRange(VITAL_RANGES.balanceHidrico.min, VITAL_RANGES.balanceHidrico.max, "Balance hídrico").optional(),
  diuresis: numRange(VITAL_RANGES.diuresisHoraria.min, VITAL_RANGES.diuresisHoraria.max, "Diuresis").optional(),

  // Gineco-obstétrico (solo paciente femenina en edad fértil, mockup avante7)
  fur: z.string().date().optional(),
  fpp: z.string().date().optional(),
  /** CC-0012 — estado del interruptor FPP (Naegele) al guardar la toma. */
  fppActivo: z.boolean().optional(),
  /** CC-0012 — fórmula obstétrica G·P·P·A·V (obligatoria en UI si sexo femenino). */
  goGestas: numRange(0, 30, "Gestas").int().optional(),
  goPartosTermino: numRange(0, 30, "Partos a término").int().optional(),
  goPartosPretermino: numRange(0, 30, "Partos pretérmino").int().optional(),
  goAbortos: numRange(0, 30, "Abortos").int().optional(),
  goVivos: numRange(0, 30, "Nacidos vivos").int().optional(),

  /** RF-04 CC-0001 — nota opcional por toma. */
  observaciones: z.string().max(2000).optional(),

  /** Fecha-hora de la toma. Si no se envía, la BD usa now(). */
  fechaHoraToma: z.string().datetime({ offset: true }).optional(),
});

export const eceSignosVitalesCreateSchema = eceSignosVitalesBaseSchema.superRefine((data, ctx) => {
  if (!data.episodioId && !data.cuentaId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Se requiere episodioId o cuentaId (al menos un ancla).",
      path: ["episodioId"],
    });
  }
});

export type EceSignosVitalesCreateInput = z.infer<typeof eceSignosVitalesCreateSchema>;

// ─── Schema de actualización (solo campos clínicos, no IDs) ─────────────────

export const eceSignosVitalesUpdateSchema = eceSignosVitalesBaseSchema
  .pick({
    presionSistolica: true,
    presionDiastolica: true,
    frecuenciaCardiaca: true,
    frecuenciaRespiratoria: true,
    temperatura: true,
    saturacionO2: true,
    fio2: true,
    escalaDolor: true,
    glasgowOcular: true,
    glasgowVerbal: true,
    glasgowMotor: true,
    glasgowTotal: true,
    glucometriaMgdl: true,
    pesoKg: true,
    pesoLb: true,
    tallaCm: true,
    tallaFt: true,
    perimetroCintura: true,
    ict: true,
    balanceHidrico: true,
    diuresis: true,
    fur: true,
    fpp: true,
    fppActivo: true,
    goGestas: true,
    goPartosTermino: true,
    goPartosPretermino: true,
    goAbortos: true,
    goVivos: true,
    observaciones: true,
    fechaHoraToma: true,
  })
  .partial();

export type EceSignosVitalesUpdateInput = z.infer<typeof eceSignosVitalesUpdateSchema>;
