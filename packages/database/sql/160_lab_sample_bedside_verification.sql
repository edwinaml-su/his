-- IPSG.1-H1: Lab sample bedside 2-IDs verification persistence
-- Agrega campos de verificación JCI a LabSpecimen.
-- El router ya valida en runtime; esto persiste la evidencia de la verificación.
-- Aplicado a Supabase production via MCP apply_migration el 2026-05-30.

ALTER TABLE public."LabSpecimen"
  ADD COLUMN IF NOT EXISTS "gsrnPacienteVerificado" varchar(20),
  ADD COLUMN IF NOT EXISTS "identifier2Kind"        varchar(20),
  ADD COLUMN IF NOT EXISTS "identifier2Value"       text,
  ADD COLUMN IF NOT EXISTS "verifiedAt"             timestamptz,
  ADD COLUMN IF NOT EXISTS "verifiedBy"             uuid REFERENCES public."User"(id) ON DELETE RESTRICT;

-- Index parcial: solo filas con verificación registrada (flujo bedside).
CREATE INDEX IF NOT EXISTS "LabSpecimen_verifiedAt_idx"
  ON public."LabSpecimen" ("verifiedAt")
  WHERE "verifiedAt" IS NOT NULL;
