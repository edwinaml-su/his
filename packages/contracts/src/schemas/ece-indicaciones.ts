/**
 * §ECE — Indicaciones Médicas (IND_MED): schemas Zod.
 *
 * Norma técnica NTEC (Doc 6): órdenes de medicamentos y procedimientos emitidas
 * por médico prescriptor y transcritas/validadas por enfermería (CPOE).
 *
 * BD: ece.indicaciones_medicas / ece.indicacion_item / ece.administracion_medicamento
 *
 * Notas de diseño:
 *   - dosis, via, frecuencia son texto libre en BD (columnas legacy text).
 *     Los enums Zod validan en capa de aplicación mientras la migración
 *     IND-002 (columnas estructuradas) no esté aplicada.
 *   - viaAdminEnum y frecuenciaEnum se alinean con AdminRoute/FrequencyCode
 *     del bounded context pharmacy para facilitar el puente ECE↔pharmacy.
 */
import { z } from "zod";

// ─── Enumerados ───────────────────────────────────────────────────────────────

export const tipoIndicacionEnum = z.enum([
  "MEDICAMENTO",
  "PROCEDIMIENTO",
  "DIETA",
  "CUIDADO_GENERAL",
  "ESTUDIO",
]);

export const vigenciaEnum = z.enum(["ACTIVA", "SUSPENDIDA", "CANCELADA"]);

export const estadoRegistroEnum = z.enum(["borrador", "firmado", "validado"]);

/** Alineado con AdminRoute del pharmacy bounded context. */
export const viaAdminEnum = z.enum([
  "ORAL",
  "IV",
  "IM",
  "SC",
  "TOPICAL",
  "INHALED",
  "RECTAL",
  "SUBLINGUAL",
  "OPHTHALMIC",
  "OTIC",
  "NASAL",
]);

/** Alineado con FrequencyCode del pharmacy bounded context. */
export const frecuenciaEnum = z.enum([
  "QD",
  "BID",
  "TID",
  "QID",
  "Q4H",
  "Q6H",
  "Q8H",
  "Q12H",
  "Q24H",
  "STAT",
  "PRN",
]);

export const estadoAdminEnum = z.enum([
  "PROGRAMADA",
  "ADMINISTRADO",
  "OMITIDA",
  "RECHAZADA",
]);

// ─── Item de indicación (CPOE multi-línea) ───────────────────────────────────

export const indicacionItemSchema = z.object({
  tipo: tipoIndicacionEnum,
  descripcion: z.string().trim().min(1).max(500),
  /** Campo legacy text libre. Solo obligatorio si tipo=MEDICAMENTO. */
  dosis: z.string().trim().max(100).optional(),
  via: viaAdminEnum.optional(),
  frecuencia: frecuenciaEnum.optional(),
  duracion: z.string().trim().max(100).optional(),
});

export type IndicacionItem = z.infer<typeof indicacionItemSchema>;

// ─── Create ───────────────────────────────────────────────────────────────────

export const eceIndicacionesCreateSchema = z.object({
  episodioId: z.string().uuid(),
  medicoPrescriptor: z.string().uuid(),
  items: z.array(indicacionItemSchema).min(1).max(50),
});

export type EceIndicacionesCreate = z.infer<typeof eceIndicacionesCreateSchema>;

// ─── Update (solo en borrador) ────────────────────────────────────────────────

export const eceIndicacionesUpdateSchema = z.object({
  id: z.string().uuid(),
  items: z.array(indicacionItemSchema).min(1).max(50),
});

// ─── List ─────────────────────────────────────────────────────────────────────

export const eceIndicacionesListSchema = z.object({
  episodioId: z.string().uuid(),
  vigencia: vigenciaEnum.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

// ─── Id simple ────────────────────────────────────────────────────────────────

export const eceIndicacionIdSchema = z.object({
  id: z.string().uuid(),
});

// ─── Suspender / cancelar ─────────────────────────────────────────────────────

export const eceSuspenderSchema = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(1).max(500),
});

// ─── Registrar administración (NURSE — eMAR/MAR) ─────────────────────────────

export const administracionRecordSchema = z
  .object({
    indicacionItemId: z.string().uuid(),
    registroEnfId: z.string().uuid(),
    horaAplicada: z.coerce.date(),
    estado: estadoAdminEnum,
    motivoOmision: z.string().trim().min(10).max(1000).optional(),
    responsable: z.string().uuid(),
  })
  .superRefine((val, ctx) => {
    if (
      (val.estado === "OMITIDA" || val.estado === "RECHAZADA") &&
      !val.motivoOmision
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "motivo_omision es obligatorio cuando estado es OMITIDA o RECHAZADA (NTEC §3.6).",
        path: ["motivoOmision"],
      });
    }
  });

export type AdministracionRecord = z.infer<typeof administracionRecordSchema>;

// ─── List administraciones ────────────────────────────────────────────────────

export const listAdministracionesSchema = z.object({
  indicacionItemId: z.string().uuid(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});
