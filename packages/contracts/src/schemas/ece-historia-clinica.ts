/**
 * ECE Historia Clínica — Schemas Zod compartidos.
 *
 * Alineados con DDL real de ece.historia_clinica (61_ece_06_documentos.sql).
 * Estados HC: borrador → firmado → validado (o anulado).
 * HC-003: los estados válidos son los de este enum + CHECK constraint en BD.
 * HC-004: icd10DiagnosticoSchema valida el patrón CIE-10 en borde de aplicación.
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

export const DISPOSICION_OPTIONS = [
  "ALTA",
  "INTERNAMIENTO",
  "REFERENCIA",
  "OBSERVACION",
] as const;
export const disposicionEnum = z.enum(DISPOSICION_OPTIONS);

// ─── Sub-schemas JSONB ────────────────────────────────────────────────────────

/** HC-004: valida código CIE-10 en borde de aplicación */
export const icd10DiagnosticoSchema = z.object({
  code: z.string().regex(/^[A-Z]\d{2}(\.\d+)?$/, "Código CIE-10 inválido"),
  description: z.string().min(1).max(500),
  tipo: z.enum(["principal", "secundario"]).default("secundario"),
});
export type Icd10Diagnostico = z.infer<typeof icd10DiagnosticoSchema>;

export const antecedentesSchema = z.object({
  personales: z.string().max(4000).optional(),
  familiares: z.string().max(4000).optional(),
  sociales: z.string().max(4000).optional(),
  alergias: z.string().max(2000).optional(),
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
  disposicion: disposicionEnum.optional(),
  planManejo: z.string().max(5000).optional(),
  antecedentes: antecedentesSchema.optional(),
  examenFisico: examenFisicoSchema.optional(),
  diagnosticos: z.array(icd10DiagnosticoSchema).optional(),
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
