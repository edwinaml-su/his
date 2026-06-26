/**
 * ECE Historia Clínica — Schemas Zod compartidos.
 *
 * Alineados con DDL real de ece.historia_clinica (61_ece_06_documentos.sql
 * + 175_hc_avante_destino_cie11_analisis.sql — control de cambios CC-0001).
 * Estados HC: borrador → firmado → validado (o anulado).
 * HC-003: los estados válidos son los de este enum + CHECK constraint en BD.
 *
 * CC-0001 (Requerimiento_HC_Avante_v1.0.md, NTEC Art. 7):
 *   RF-02 antecedentes no patológicos + bloque obstétrico FPP
 *   RF-03 diagnósticos CIE-11 (tipo Presuntivo/Definitivo/Complementario)
 *   RF-05 análisis clínico
 *   RF-06 "Disposición" → "Destino" (catálogo cerrado de 8 valores)
 *
 * Compat: icd10DiagnosticoSchema / DISPOSICION_OPTIONS se conservan (deprecados)
 * para no romper consumidores legacy; los nuevos schemas son la fuente CC-0001.
 */
import { z } from "zod";

// ─── Enums NTEC ───────────────────────────────────────────────────────────────

export const HISTORIA_CLINICA_ESTADO = [
  "borrador",
  "firmado",
  "validado",
  "anulado",
] as const;

export const historiaClinicaEstadoEnum = z.enum(HISTORIA_CLINICA_ESTADO);
export type HistoriaClinicaEstado = z.infer<typeof historiaClinicaEstadoEnum>;

/** NTEC Art. 7 — tipos de consulta ECE */
export const TIPO_CONSULTA = [
  "ingreso",
  "control",
  "urgencia",
  "ambulatoria",
  "interconsulta",
] as const;
export const tipoConsultaEnum = z.enum(TIPO_CONSULTA);
export type TipoConsulta = z.infer<typeof tipoConsultaEnum>;

/** @deprecated CC-0001 RF-06 lo sustituye por DESTINO_OPTIONS. Se conserva para compat. */
export const DISPOSICION_OPTIONS = [
  "ALTA",
  "INTERNAMIENTO",
  "REFERENCIA",
  "OBSERVACION",
] as const;
/** @deprecated usar destinoEnum (CC-0001 RF-06). */
export const disposicionEnum = z.enum(DISPOSICION_OPTIONS);

// ─── Catálogos CC-0001 (Avante v1.0) ──────────────────────────────────────────

/** RF-03 — tipo de diagnóstico CIE-11 (sustituye Principal/Secundario). */
export const TIPO_DIAGNOSTICO = ["PRESUNTIVO", "DEFINITIVO", "COMPLEMENTARIO"] as const;
export const tipoDiagnosticoEnum = z.enum(TIPO_DIAGNOSTICO);
export type TipoDiagnostico = z.infer<typeof tipoDiagnosticoEnum>;

export const TIPO_DIAGNOSTICO_LABELS: Record<TipoDiagnostico, string> = {
  PRESUNTIVO: "Presuntivo",
  DEFINITIVO: "Definitivo",
  COMPLEMENTARIO: "Complementario",
};

/**
 * RF-06 / CC-0007 RF-12 — Destino del paciente.
 * CC-0001 definió 8 valores. CC-0007 agrega FALLECIDO (spec §5, RF-12).
 * Reconciliación mockup vs spec:
 *   Mockup L971-977 lista 7: Alta médica, Alta voluntaria, Ingreso hospitalario,
 *   Observación, Seguimiento, Remisión a otro centro, Fallecido.
 *   La spec §5 alinea los valores internos con ese set.
 *   PROCEDIMIENTO_AMBULATORIO e INGRESO (legacy CC-0001) se conservan para no
 *   romper registros existentes; la UI CC-0007 muestra solo los 7 del mockup.
 */
export const DESTINO_OPTIONS = [
  "INGRESO",
  "ALTA_MEDICA",
  "ALTA_VOLUNTARIA",
  "SEGUIMIENTO",
  "OBSERVACION",
  "PROCEDIMIENTO_AMBULATORIO",
  "REFERENCIA",
  "REMISION",
  "FALLECIDO",
] as const;
export const destinoEnum = z.enum(DESTINO_OPTIONS);
export type Destino = z.infer<typeof destinoEnum>;

export const DESTINO_LABELS: Record<Destino, string> = {
  INGRESO: "Ingreso hospitalario",
  ALTA_MEDICA: "Alta médica",
  ALTA_VOLUNTARIA: "Alta voluntaria",
  SEGUIMIENTO: "Seguimiento",
  OBSERVACION: "Observación",
  PROCEDIMIENTO_AMBULATORIO: "Procedimiento ambulatorio",
  REFERENCIA: "Referencia",
  REMISION: "Remisión a otro centro",
  FALLECIDO: "Fallecido",
};

// ─── Sub-schemas JSONB ────────────────────────────────────────────────────────

/** @deprecated HC-004 legacy CIE-10. CC-0001 RF-03 usa cie11DiagnosticoSchema. */
export const icd10DiagnosticoSchema = z.object({
  code: z.string().regex(/^[A-Z]\d{2}(\.\d+)?$/, "Código CIE-10 inválido"),
  description: z.string().min(1).max(500),
  tipo: z.enum(["principal", "secundario"]).default("secundario"),
});
export type Icd10Diagnostico = z.infer<typeof icd10DiagnosticoSchema>;

/**
 * RF-03 — Diagnóstico CIE-11. La autoridad del catálogo es la WHO ICD API
 * (RN-02); el regex solo valida la superficie del código: CIE-10 legacy
 * (J45.0) o CIE-11 MMS — stem (1A00), extensión (XS25), clúster postcoordinado
 * (KA62.1/KB23.0, 2A00&XH8TR4). Case-insensitive; se persiste en mayúsculas.
 */
export const CIE11_CODE_REGEX = /^[A-Z0-9]{2,}([./&-][A-Z0-9]+)*$/i;
export const cie11DiagnosticoSchema = z.object({
  codigo: z.string().regex(CIE11_CODE_REGEX, "Código CIE-11 inválido"),
  descripcion: z.string().min(1).max(500),
  tipo: tipoDiagnosticoEnum,
  /** CC-0007 RF-08 — complemento por diagnóstico (texto libre, almacenado en mayúsculas). */
  complemento: z.string().max(500).optional(),
});
export type Cie11Diagnostico = z.infer<typeof cie11DiagnosticoSchema>;

/** RN-03 — debe existir ≥ 1 diagnóstico de tipo Complementario. */
export function tieneComplementario(
  diagnosticos: ReadonlyArray<{ tipo?: string | null }>,
): boolean {
  return diagnosticos.some((d) => d.tipo === "COMPLEMENTARIO");
}

const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (formato yyyy-mm-dd)");

/**
 * RF-02 — antecedentes embebidos. Patológicos (personales/familiares/alergias),
 * no patológicos (ocupación/hábitos), gineco-obstétricos + bloque FPP.
 * `sociales` se conserva (deprecado) para lectura de datos legacy.
 */
export const antecedentesSchema = z
  .object({
    personales: z.string().max(4000).optional(),
    familiares: z.string().max(4000).optional(),
    alergias: z.string().max(2000).optional(),
    ocupacion: z.string().max(2000).optional(),
    habitosPersonales: z.string().max(4000).optional(),
    obstetricos: z.string().max(4000).optional(),
    /** RF-02 — si true, FUM es obligatoria y FPP/EG se derivan (Naegele). */
    calcularFpp: z.boolean().optional(),
    fum: isoDateString.optional(),
    fpp: isoDateString.optional(),
    /** @deprecated reemplazado por ocupacion/habitosPersonales. */
    sociales: z.string().max(4000).optional(),
  })
  .superRefine((a, ctx) => {
    // RN-05 — FUM ∈ [hoy − 300 días, hoy] (solo cuando está presente).
    if (a.fum) {
      const fum = new Date(`${a.fum}T00:00:00Z`);
      const now = new Date();
      const hoy = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const min = new Date(hoy);
      min.setUTCDate(min.getUTCDate() - 300);
      if (Number.isNaN(fum.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fum"], message: "FUM inválida." });
      } else if (fum > hoy) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fum"], message: "FUM no puede ser futura." });
      } else if (fum < min) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fum"], message: "FUM no puede ser anterior a 300 días." });
      }
    }
  });
export type Antecedentes = z.infer<typeof antecedentesSchema>;

export const examenFisicoSchema = z.object({
  sistemas: z
    .array(
      z.object({
        sistema: z.string().max(100),
        hallazgo: z.string().max(2000),
      }),
    )
    .optional(),
  signosVitales: z
    .object({
      paSistolica: z.number().int().min(50).max(300).optional(),
      paDiastolica: z.number().int().min(30).max(200).optional(),
      frecuenciaCardiaca: z.number().int().min(20).max(300).optional(),
      frecuenciaRespiratoria: z.number().int().min(4).max(60).optional(),
      temperatura: z.number().min(30).max(45).optional(),
    })
    .optional(),
});
export type ExamenFisico = z.infer<typeof examenFisicoSchema>;

// ─── Sub-schemas JSONB CC-0007 ────────────────────────────────────────────────

/**
 * CC-0007 RF-05 — antecedentes estructurados por subsección.
 * Cinco subsecciones exactas leídas del mockup (data-antecedente):
 *   alergias | personales | familiares | ocupacion | habitos
 * (obstétricos removido de antecedentes; FUR/FPP van en EceSignosVitales).
 * estado: "TIENE" | "NINGUNO" | "NO_APLICA"
 *   Ninguno → alergias/personales/familiares usan "NINGUNO"
 *   No aplica → ocupacion/habitos usan "NO_APLICA"
 */
const antecedenteSubseccionSchema = z.object({
  estado: z.enum(["TIENE", "NINGUNO", "NO_APLICA"]),
  items: z.array(z.string().min(1).max(500)).optional(),
});

export const antecedentesEstructuradosSchema = z.object({
  alergias:   antecedenteSubseccionSchema,
  personales: antecedenteSubseccionSchema,
  familiares: antecedenteSubseccionSchema,
  ocupacion:  antecedenteSubseccionSchema,
  habitos:    antecedenteSubseccionSchema,
});
export type AntecedentesEstructurados = z.infer<typeof antecedentesEstructuradosSchema>;

/** CC-0007 RF-12 — item del plan de manejo (grid de indicaciones). */
export const planItemSchema = z.object({
  orden: z.number().int().min(1),
  texto: z.string().min(1).max(2000),
});
export type PlanItem = z.infer<typeof planItemSchema>;

/** CC-0007 RF-09 — procedimiento CPT con complemento por fila. */
export const procedimientoCptSchema = z.object({
  codigo:      z.string().min(1).max(20),
  descripcion: z.string().min(1).max(500),
  complemento: z.string().max(500).optional(),
});
export type ProcedimientoCpt = z.infer<typeof procedimientoCptSchema>;

/** CC-0007 RF-10 — terapia respiratoria estructurada. */
export const terapiaRespiratoriaSchema = z.object({
  gasometria: z.object({
    tipo:   z.enum(["BASAL", "O2"]),
    fio2:   z.number().min(21).max(100).optional(),  // % solo con O2
    flujo:  z.number().min(0).max(60).optional(),    // L/min solo con O2
  }),
  nebulizaciones:   z.string().max(1000).optional(),
  vibroterapia:     z.string().max(1000).optional(),
  palmopercusion:   z.string().max(1000).optional(),
});
export type TerapiaRespiratoria = z.infer<typeof terapiaRespiratoriaSchema>;

/** CC-0007 RF-10 — orden de examen (lab/gabinete). */
export const ordenExamenSchema = z.object({
  seccion:  z.string().min(1).max(100),
  examen:   z.string().min(1).max(200),
  cantidad: z.number().int().min(1).max(99).default(1),
});
export type OrdenExamen = z.infer<typeof ordenExamenSchema>;

/** CC-0007 RF-10 — orden de inyección (texto libre). */
export const ordenInyeccionSchema = z.object({
  texto: z.string().min(1).max(1000),
});
export type OrdenInyeccion = z.infer<typeof ordenInyeccionSchema>;

// ─── Input schemas ────────────────────────────────────────────────────────────

export const historiaClinicaListInput = z.object({
  episodioId: z.string().uuid().optional(),
  estado: historiaClinicaEstadoEnum.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export type HistoriaClinicaListInput = z.infer<typeof historiaClinicaListInput>;

export const historiaClinicaGetInput = z.object({
  id: z.string().uuid(),
});
export type HistoriaClinicaGetInput = z.infer<typeof historiaClinicaGetInput>;

export const historiaClinicaCreateInput = z.object({
  episodioId: z.string().uuid(),
  instanciaId: z.string().uuid().optional(),
  tipoConsulta: tipoConsultaEnum,
  motivoConsulta: z.string().min(1).max(2000).optional(),
  enfermedadActual: z.string().max(4000).optional(),
  /** RF-06 — Destino (catálogo cerrado de 8). Se persiste en columna `disposicion`. */
  destino: destinoEnum.optional(),
  /** RF-05 — análisis/correlación clínica. */
  analisisClinico: z.string().max(5000).optional(),
  planManejo: z.string().max(5000).optional(),
  antecedentes: antecedentesSchema.optional(),
  examenFisico: examenFisicoSchema.optional(),
  /** RF-03 — diagnósticos CIE-11 validados en borde de aplicación. */
  diagnosticos: z.array(cie11DiagnosticoSchema).optional(),
  // ─── CC-0007 — campos estructurados nuevos (jsonb) ───
  /** RF-05 — antecedentes por subsección (sustituye texto libre en UI CC-0007). */
  antecedentesEstructurados: antecedentesEstructuradosSchema.optional(),
  /** RF-12 — plan de manejo como grid ordenado. */
  planItems: z.array(planItemSchema).optional(),
  /** RF-09 — procedimientos CPT. */
  procedimientosCpt: z.array(procedimientoCptSchema).optional(),
  /** RF-10 — terapia respiratoria estructurada. */
  terapiaRespiratoria: terapiaRespiratoriaSchema.optional(),
  /** RF-10 — órdenes de exámenes lab/gabinete. */
  ordenesExamenes: z.array(ordenExamenSchema).optional(),
  /** RF-10 — órdenes de inyecciones. */
  ordenesInyecciones: z.array(ordenInyeccionSchema).optional(),
});
export type HistoriaClinicaCreateInput = z.infer<typeof historiaClinicaCreateInput>;

export const historiaClinicaUpdateInput = historiaClinicaCreateInput
  .omit({ episodioId: true, instanciaId: true })
  .partial()
  .extend({ id: z.string().uuid() });
export type HistoriaClinicaUpdateInput = z.infer<typeof historiaClinicaUpdateInput>;

export const historiaClinicaTransitionInput = z.object({
  id: z.string().uuid(),
  firmaId: z.string().uuid().optional(),
  observacion: z.string().max(1000).optional(),
});
export type HistoriaClinicaTransitionInput = z.infer<typeof historiaClinicaTransitionInput>;
