import { z } from "zod";

/**
 * Schemas Zod — Certificado de Incapacidad ISSS (CERT_INC).
 * Normativa: ISSS El Salvador — Reglamento de Evaluación de Incapacidades.
 * NTEC §22 (informes ISSS).
 */

export const TIPO_INCAPACIDAD = [
  "enfermedad_comun",
  "accidente_comun",
  "riesgo_profesional",
  "maternidad",
  "paternidad",
  "accidente_trabajo",
] as const;

export type TipoIncapacidad = (typeof TIPO_INCAPACIDAD)[number];

/** Regex CIE-10: letra + 2 dígitos + opcional punto + 1-2 dígitos. */
const cie10Regex = /^[A-Z][0-9]{2}(\.[0-9]{1,2})?$/;

export const certificadoIncapacidadCreateInput = z.object({
  pacienteId:              z.string().uuid(),
  episodioId:              z.string().uuid().optional(),
  medicoId:                z.string().uuid(),
  tipoIncapacidad:         z.enum(TIPO_INCAPACIDAD),
  fechaInicio:             z.string().date(),
  fechaFin:                z.string().date(),
  diagnosticoCie10:        z.string().regex(cie10Regex, "Código CIE-10 inválido (ej. J20 o J20.0)"),
  diagnosticoDescripcion:  z.string().min(10, "Mínimo 10 caracteres"),
  numeroAfiliacionIsss:    z
    .string()
    .regex(/^[0-9]{9}$/, "Debe ser exactamente 9 dígitos numéricos")
    .optional(),
  patronoNit:              z.string().optional(),
  observaciones:           z.string().optional(),
});

export type CertificadoIncapacidadCreateInput = z.infer<typeof certificadoIncapacidadCreateInput>;

export const certificadoIncapacidadFirmarInput = z.object({
  id:      z.string().uuid(),
  firmaPin: z.string().min(4).max(32),
});

export type CertificadoIncapacidadFirmarInput = z.infer<typeof certificadoIncapacidadFirmarInput>;

export const certificadoIncapacidadAnularInput = z.object({
  id:               z.string().uuid(),
  motivoAnulacion:  z.string().min(10, "Mínimo 10 caracteres"),
});

export type CertificadoIncapacidadAnularInput = z.infer<typeof certificadoIncapacidadAnularInput>;

export const certificadoIncapacidadListInput = z.object({
  pacienteId:  z.string().uuid().optional(),
  fechaDesde:  z.coerce.date().optional(),
  fechaHasta:  z.coerce.date().optional(),
  page:        z.number().int().min(1).default(1),
  pageSize:    z.number().int().min(1).max(100).default(20),
});

export type CertificadoIncapacidadListInput = z.infer<typeof certificadoIncapacidadListInput>;

export const certificadoIncapacidadGetInput = z.object({
  id: z.string().uuid(),
});

export type CertificadoIncapacidadGetInput = z.infer<typeof certificadoIncapacidadGetInput>;
