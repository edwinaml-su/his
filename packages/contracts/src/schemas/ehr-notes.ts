/**
 * §14 EHR Clinical Notes — schemas. Beta.5 hardening layer 1.
 */
import { z } from 'zod';

const NOTE_TYPE = [
  'PROGRESS',
  'ADMISSION',
  'DISCHARGE_SUMMARY',
  'CONSULTATION',
  'NURSING',
  'EMERGENCY',
] as const;
const DIAGNOSIS_TYPE = ['PRINCIPAL', 'SECONDARY', 'RULE_OUT', 'CHRONIC'] as const;

export const noteTypeEnum = z.enum(NOTE_TYPE);
export const diagnosisTypeEnum = z.enum(DIAGNOSIS_TYPE);

export const editHistoryActionEnum = z.enum(['create', 'update']);

export const editHistoryEntrySchema = z.object({
  at: z.string().datetime(),
  by: z.string().uuid(),
  action: editHistoryActionEnum,
  diff: z.record(z.string().nullable()).optional(),
});

export type EditHistoryEntry = z.infer<typeof editHistoryEntrySchema>;

export const clinicalNoteCreateInput = z.object({
  encounterId: z.string().uuid(),
  noteType: noteTypeEnum,
  specialtyId: z.string().uuid().optional(),
  subjective: z.string().trim().max(8000).optional(),
  objective: z.string().trim().max(8000).optional(),
  assessment: z.string().trim().max(8000).optional(),
  plan: z.string().trim().max(8000).optional(),
});

export const clinicalNoteSignInput = z.object({
  id: z.string().uuid(),
});

export const clinicalNoteAddendumInput = z.object({
  addendumOfId: z.string().uuid(),
  noteType: noteTypeEnum.default('PROGRESS'),
  subjective: z.string().trim().max(8000).optional(),
  objective: z.string().trim().max(8000).optional(),
  assessment: z.string().trim().max(8000).optional(),
  plan: z.string().trim().max(8000).optional(),
});

export const clinicalNoteListInput = z.object({
  encounterId: z.string().uuid().optional(),
  authorId: z.string().uuid().optional(),
  noteType: noteTypeEnum.optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const encounterDiagnosisCreateInput = z.object({
  encounterId: z.string().uuid(),
  conceptId: z.string().uuid(),
  type: diagnosisTypeEnum,
  notes: z.string().trim().max(2000).optional(),
});

export const encounterDiagnosisListInput = z.object({
  encounterId: z.string().uuid(),
  type: diagnosisTypeEnum.optional(),
});

export const encounterDiagnosisResolveInput = z.object({
  id: z.string().uuid(),
});

export type ClinicalNoteCreateInput = z.infer<typeof clinicalNoteCreateInput>;
export type ClinicalNoteSignInput = z.infer<typeof clinicalNoteSignInput>;
export type ClinicalNoteAddendumInput = z.infer<typeof clinicalNoteAddendumInput>;
export type ClinicalNoteListInput = z.infer<typeof clinicalNoteListInput>;
export type EncounterDiagnosisCreateInput = z.infer<typeof encounterDiagnosisCreateInput>;
export type EncounterDiagnosisListInput = z.infer<typeof encounterDiagnosisListInput>;
export type EncounterDiagnosisResolveInput = z.infer<typeof encounterDiagnosisResolveInput>;
