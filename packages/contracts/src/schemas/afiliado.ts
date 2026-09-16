import { z } from "zod";

/**
 * CC-0036 Ola 1B (REQ-HIS-AFIL-001 S1) — Consultorio y MedicoAfiliado.
 * sql/244_cc0036_afiliado_consultorio.sql.
 *
 * Fuera de alcance de esta ola: ContratoArrendamiento, ConvenioHonorario,
 * ProduccionMedica, Liquidacion, agenda (Épica E2) — llegan en olas
 * siguientes del mismo REQ.
 */

export const consultorioTipoUsoEnum = z.enum(["ARRENDADO", "PROPIO", "MIXTO"]);

export const medicoAfiliadoTipoRelacionEnum = z.enum([
  "AFILIADO_ARRENDATARIO",
  "AFILIADO_SIN_CONSULTORIO",
  "STAFF_INTERNO",
]);

export const medicoAfiliadoEstadoEnum = z.enum([
  "PROSPECTO",
  "ACTIVO",
  "SUSPENDIDO",
  "INACTIVO",
]);

// -----------------------------------------------------------------------------
// Consultorio
// -----------------------------------------------------------------------------

export const consultorioListSchema = z
  .object({
    establishmentId: z.string().uuid().optional(),
    serviceUnitId: z.string().uuid().optional(),
    activeOnly: z.boolean().optional(),
  })
  .optional();

export const consultorioCreateSchema = z.object({
  establishmentId: z.string().uuid(),
  serviceUnitId: z.string().uuid().optional(),
  codigo: z.string().trim().min(1).max(40),
  nombre: z.string().trim().min(1).max(120),
  piso: z.string().trim().max(20).optional(),
  areaM2: z.number().positive().max(999_999.99).optional(),
  tipoUso: consultorioTipoUsoEnum,
  especialidadSugeridaId: z.string().uuid().optional(),
  capacidadPacientesHora: z.number().int().positive().max(1000).optional(),
  glnCodigo: z
    .string()
    .length(13)
    .regex(/^\d{13}$/, "GLN-13: 13 dígitos numéricos")
    .optional(),
  equipamiento: z.record(z.string(), z.unknown()).optional(),
});

/** `codigo` no se expone editable (identidad dentro de la organización, como Room). */
export const consultorioUpdateSchema = z.object({
  id: z.string().uuid(),
  serviceUnitId: z.string().uuid().nullable().optional(),
  nombre: z.string().trim().min(1).max(120).optional(),
  piso: z.string().trim().max(20).nullable().optional(),
  areaM2: z.number().positive().max(999_999.99).nullable().optional(),
  tipoUso: consultorioTipoUsoEnum.optional(),
  especialidadSugeridaId: z.string().uuid().nullable().optional(),
  capacidadPacientesHora: z.number().int().positive().max(1000).nullable().optional(),
  glnCodigo: z
    .string()
    .length(13)
    .regex(/^\d{13}$/, "GLN-13: 13 dígitos numéricos")
    .nullable()
    .optional(),
  equipamiento: z.record(z.string(), z.unknown()).optional(),
});

export const consultorioSetActiveSchema = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});

export type ConsultorioListInput = z.infer<typeof consultorioListSchema>;
export type ConsultorioCreateInput = z.infer<typeof consultorioCreateSchema>;
export type ConsultorioUpdateInput = z.infer<typeof consultorioUpdateSchema>;
export type ConsultorioSetActiveInput = z.infer<typeof consultorioSetActiveSchema>;

// -----------------------------------------------------------------------------
// MedicoAfiliado
// -----------------------------------------------------------------------------

export const medicoAfiliadoListSchema = z
  .object({
    estado: medicoAfiliadoEstadoEnum.optional(),
    tipoRelacion: medicoAfiliadoTipoRelacionEnum.optional(),
    search: z.string().trim().max(200).optional(),
  })
  .optional();

export const medicoAfiliadoCreateSchema = z.object({
  nombreCompleto: z.string().trim().min(1).max(200),
  tipoDocumentoId: z.string().uuid().optional(),
  numeroDocumento: z.string().trim().max(40).optional(),
  jvpmNumero: z.string().trim().min(1).max(30),
  especialidadPrincipalId: z.string().uuid().optional(),
  /** Especialidades adicionales (aparte de la principal). */
  especialidadIds: z.array(z.string().uuid()).max(20).optional(),
  tipoRelacion: medicoAfiliadoTipoRelacionEnum,
  nit: z.string().trim().max(40).optional(),
  nrc: z.string().trim().max(20).optional(),
  esContribuyenteIva: z.boolean().optional(),
  fechaIngreso: z.string().date().optional(),
  permiteCompensacion: z.boolean().optional(),
});

/** `jvpmNumero` no se expone editable (identidad regulatoria del afiliado). */
export const medicoAfiliadoUpdateSchema = z.object({
  id: z.string().uuid(),
  nombreCompleto: z.string().trim().min(1).max(200).optional(),
  tipoDocumentoId: z.string().uuid().nullable().optional(),
  numeroDocumento: z.string().trim().max(40).nullable().optional(),
  especialidadPrincipalId: z.string().uuid().nullable().optional(),
  nit: z.string().trim().max(40).nullable().optional(),
  nrc: z.string().trim().max(20).nullable().optional(),
  esContribuyenteIva: z.boolean().optional(),
  fechaIngreso: z.string().date().nullable().optional(),
  permiteCompensacion: z.boolean().optional(),
});

/**
 * US.AFIL.1.2 AC3 — transición PROSPECTO → ACTIVO. Decisión temporal (Ola
 * 1B, documentada en medico-afiliado.router.ts): el REQ exige contrato o
 * convenio VIGENTE, pero esas entidades llegan en olas siguientes. Por ahora
 * se permite manual con permiso `medico_afiliado.editar` + auditoría.
 */
export const medicoAfiliadoActivarSchema = z.object({ id: z.string().uuid() });

/** US.AFIL.1.2 AC4 — baja: exige fecha y motivo. */
export const medicoAfiliadoDarBajaSchema = z.object({
  id: z.string().uuid(),
  fechaBaja: z.string().date(),
  motivoBaja: z.string().trim().min(1).max(300),
});

/** US.AFIL.1.2 AC5 — vincula el afiliado a un usuario HIS existente. */
export const medicoAfiliadoVincularUsuarioSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});

export type MedicoAfiliadoListInput = z.infer<typeof medicoAfiliadoListSchema>;
export type MedicoAfiliadoCreateInput = z.infer<typeof medicoAfiliadoCreateSchema>;
export type MedicoAfiliadoUpdateInput = z.infer<typeof medicoAfiliadoUpdateSchema>;
export type MedicoAfiliadoActivarInput = z.infer<typeof medicoAfiliadoActivarSchema>;
export type MedicoAfiliadoDarBajaInput = z.infer<typeof medicoAfiliadoDarBajaSchema>;
export type MedicoAfiliadoVincularUsuarioInput = z.infer<
  typeof medicoAfiliadoVincularUsuarioSchema
>;
