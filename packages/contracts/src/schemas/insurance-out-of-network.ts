/**
 * CC-0044 — Formularios de médico fuera de red (módulo de aseguradoras).
 *
 * Digitaliza 2 formularios físicos AVANTE (SQL 266):
 *   - callCensus   → "Censo de llamada seguro médico" (NetworkCallCensus +
 *     NetworkCallCensusEntry): documenta los médicos de la red a los que
 *     recepción llamó antes de admitir con un médico fuera de red.
 *   - outOfNetwork → "Constancia de atención por médico fuera de red"
 *     (OutOfNetworkAttestation): respaldo AVANTE firmado por el
 *     asegurado/responsable cuando la aseguradora no exige su propio formulario.
 *
 * Ambas tablas aceptan `insurerId` (catálogo `Insurer`, global o del tenant)
 * O `aseguradoraNombre` (texto libre) — CHECK en SQL 266 exige al menos uno.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Compartido
// ---------------------------------------------------------------------------

/** Aseguradora del catálogo (insurerId) O texto libre (aseguradoraNombre) — al menos uno. */
const aseguradoraFields = {
  insurerId: z.string().uuid().optional(),
  aseguradoraNombre: z.string().trim().min(1).max(200).optional(),
};

function refineAseguradora<T extends { insurerId?: string; aseguradoraNombre?: string }>(
  data: T,
  ctx: z.RefinementCtx,
) {
  if (!data.insurerId && !data.aseguradoraNombre) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Selecciona la aseguradora del catálogo o escribe su nombre",
      path: ["aseguradoraNombre"],
    });
  }
}

// ---------------------------------------------------------------------------
// NetworkCallCensus — "Censo de llamada seguro médico"
// ---------------------------------------------------------------------------

export const networkCallCensusStatusEnum = z.enum(["BORRADOR", "FIRMADO", "ANULADO"]);
export type NetworkCallCensusStatus = z.infer<typeof networkCallCensusStatusEnum>;

/** Fila del censo: un médico de la red llamado. `id` presente = fila existente (update); ausente = fila nueva. */
export const networkCallCensusEntryInput = z.object({
  id: z.string().uuid().optional(),
  /** Sin valor = el router asigna la posición dentro del array (`entries`/`addEntry`). */
  ordenIndex: z.number().int().min(0).optional(),
  doctorNombre: z.string().trim().min(1).max(200),
  telefono: z.string().trim().max(40).optional(),
  /** null/undefined = sin registrar; true/false = sí/no atendió. */
  atendioLlamada: z.boolean().nullable().optional(),
  comentarios: z.string().trim().max(300).optional(),
});
export type NetworkCallCensusEntryInput = z.infer<typeof networkCallCensusEntryInput>;

export const networkCallCensusCreateInput = z
  .object({
    patientId: z.string().uuid(),
    patientAccountId: z.string().uuid().optional(),
    ...aseguradoraFields,
    diagnostico: z.string().trim().min(1),
    notas: z.string().trim().max(2000).optional(),
    /** Filas iniciales del censo (opcional — pueden agregarse después con addEntry). */
    entries: z.array(networkCallCensusEntryInput).default([]),
  })
  .superRefine(refineAseguradora);
export type NetworkCallCensusCreateInput = z.infer<typeof networkCallCensusCreateInput>;

/** Edición de cabecera — sólo permitida en estado BORRADOR (enforced en el router). */
export const networkCallCensusUpdateInput = z
  .object({
    id: z.string().uuid(),
    patientAccountId: z.string().uuid().optional(),
    insurerId: z.string().uuid().optional(),
    aseguradoraNombre: z.string().trim().min(1).max(200).optional(),
    diagnostico: z.string().trim().min(1).optional(),
    notas: z.string().trim().max(2000).optional(),
  });
export type NetworkCallCensusUpdateInput = z.infer<typeof networkCallCensusUpdateInput>;

export const networkCallCensusAddEntryInput = z.object({
  censusId: z.string().uuid(),
  entry: networkCallCensusEntryInput.omit({ id: true }),
});
export type NetworkCallCensusAddEntryInput = z.infer<typeof networkCallCensusAddEntryInput>;

export const networkCallCensusUpdateEntryInput = z.object({
  censusId: z.string().uuid(),
  entryId: z.string().uuid(),
  entry: networkCallCensusEntryInput.omit({ id: true }).partial(),
});
export type NetworkCallCensusUpdateEntryInput = z.infer<typeof networkCallCensusUpdateEntryInput>;

export const networkCallCensusRemoveEntryInput = z.object({
  censusId: z.string().uuid(),
  entryId: z.string().uuid(),
});
export type NetworkCallCensusRemoveEntryInput = z.infer<typeof networkCallCensusRemoveEntryInput>;

/** sign — requiere rol médico (requireRole PHYSICIAN); asigna medicoTurnoUserId=ctx.user.id. */
export const networkCallCensusSignInput = z.object({ id: z.string().uuid() });
export type NetworkCallCensusSignInput = z.infer<typeof networkCallCensusSignInput>;

export const networkCallCensusAnularInput = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(1).max(400),
});
export type NetworkCallCensusAnularInput = z.infer<typeof networkCallCensusAnularInput>;

export const networkCallCensusListInput = z.object({
  patientId: z.string().uuid().optional(),
  insurerId: z.string().uuid().optional(),
  status: networkCallCensusStatusEnum.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
export type NetworkCallCensusListInput = z.infer<typeof networkCallCensusListInput>;

export const networkCallCensusByIdInput = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// OutOfNetworkAttestation — "Constancia de atención por médico fuera de red"
// ---------------------------------------------------------------------------

export const outOfNetworkAttestationStatusEnum = z.enum([
  "PENDIENTE_FIRMA",
  "FIRMADO",
  "ANULADO",
]);
export type OutOfNetworkAttestationStatus = z.infer<typeof outOfNetworkAttestationStatusEnum>;

export const parentescoEnum = z.enum(["TITULAR", "CONYUGE", "HIJO", "OTRO"]);
export type ParentescoType = z.infer<typeof parentescoEnum>;

function refineParentesco<T extends { parentesco: ParentescoType; parentescoOtro?: string }>(
  data: T,
  ctx: z.RefinementCtx,
) {
  if (data.parentesco === "OTRO" && !data.parentescoOtro) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Especifica el parentesco cuando selecciones OTRO",
      path: ["parentescoOtro"],
    });
  }
}

export const outOfNetworkAttestationCreateInput = z
  .object({
    patientId: z.string().uuid(),
    patientAccountId: z.string().uuid().optional(),
    ...aseguradoraFields,
    polizaNumero: z.string().trim().max(80).optional(),
    certificadoCarnet: z.string().trim().max(80).optional(),
    aseguradoTitular: z.string().trim().min(1).max(200),
    parentesco: parentescoEnum,
    parentescoOtro: z.string().trim().max(120).optional(),
    doctorNombre: z.string().trim().min(1).max(200),
    doctorEspecialidad: z.string().trim().min(1).max(200),
    telefonoContacto: z.string().trim().max(40).optional(),
    lugarFecha: z.string().trim().max(200).optional(),
  })
  .superRefine((d, ctx) => {
    refineAseguradora(d, ctx);
    refineParentesco(d, ctx);
  });
export type OutOfNetworkAttestationCreateInput = z.infer<typeof outOfNetworkAttestationCreateInput>;

/** Edición — sólo permitida en estado PENDIENTE_FIRMA (enforced en el router). */
export const outOfNetworkAttestationUpdateInput = z
  .object({
    id: z.string().uuid(),
    patientAccountId: z.string().uuid().optional(),
    insurerId: z.string().uuid().optional(),
    aseguradoraNombre: z.string().trim().min(1).max(200).optional(),
    polizaNumero: z.string().trim().max(80).optional(),
    certificadoCarnet: z.string().trim().max(80).optional(),
    aseguradoTitular: z.string().trim().min(1).max(200).optional(),
    parentesco: parentescoEnum.optional(),
    parentescoOtro: z.string().trim().max(120).optional(),
    doctorNombre: z.string().trim().min(1).max(200).optional(),
    doctorEspecialidad: z.string().trim().min(1).max(200).optional(),
    telefonoContacto: z.string().trim().max(40).optional(),
    lugarFecha: z.string().trim().max(200).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.parentesco === "OTRO" && !d.parentescoOtro) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Especifica el parentesco cuando selecciones OTRO",
        path: ["parentescoOtro"],
      });
    }
  });
export type OutOfNetworkAttestationUpdateInput = z.infer<typeof outOfNetworkAttestationUpdateInput>;

/** markFirmado — registra que el impreso físico fue firmado por el asegurado/responsable. */
export const outOfNetworkAttestationMarkFirmadoInput = z.object({ id: z.string().uuid() });
export type OutOfNetworkAttestationMarkFirmadoInput = z.infer<
  typeof outOfNetworkAttestationMarkFirmadoInput
>;

export const outOfNetworkAttestationAnularInput = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(1).max(400),
});
export type OutOfNetworkAttestationAnularInput = z.infer<typeof outOfNetworkAttestationAnularInput>;

export const outOfNetworkAttestationListInput = z.object({
  patientId: z.string().uuid().optional(),
  insurerId: z.string().uuid().optional(),
  status: outOfNetworkAttestationStatusEnum.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
export type OutOfNetworkAttestationListInput = z.infer<typeof outOfNetworkAttestationListInput>;

export const outOfNetworkAttestationByIdInput = z.object({ id: z.string().uuid() });
