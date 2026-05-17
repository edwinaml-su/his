/**
 * Schemas Zod — Bridge ECE↔HIS (Ficha NTEC Art. 15 ↔ public.Patient MPI).
 *
 * Consume: bridge-patient.router.ts en @his/trpc.
 * Spec:    docs/blueprints/ece_his_bridge.md
 */
import { z } from "zod";

// ─── Inputs de vínculo ────────────────────────────────────────────────────────

export const linkPatientInput = z.object({
  patientId: z.string().uuid(),
  ecePacienteId: z.string().uuid(),
});

export const unlinkPatientInput = z.object({
  patientId: z.string().uuid(),
  ecePacienteId: z.string().uuid(),
});

// ─── Inputs de sincronización ────────────────────────────────────────────────

export const syncFromHisInput = z.object({
  patientId: z.string().uuid(),
  /** Si existe un ecePacienteId previo, lo actualiza; si no, lo crea. */
  ecePacienteId: z.string().uuid().optional(),
});

export const syncToHisInput = z.object({
  ecePacienteId: z.string().uuid(),
});

// ─── Paginación ───────────────────────────────────────────────────────────────

export const listLinkedPatientsInput = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

// ─── Tipos exportados ────────────────────────────────────────────────────────

export type LinkPatientInput = z.infer<typeof linkPatientInput>;
export type UnlinkPatientInput = z.infer<typeof unlinkPatientInput>;
export type SyncFromHisInput = z.infer<typeof syncFromHisInput>;
export type SyncToHisInput = z.infer<typeof syncToHisInput>;
export type ListLinkedPatientsInput = z.infer<typeof listLinkedPatientsInput>;
