-- =============================================================================
-- §12 Emergency — Hardening Layer 1 v2 (Beta.4, parche 2026-05-14)
--
-- v2: corrige naming PascalCase ("EmergencyVisit", "EmergencyNote") y columnas
-- camelCase quoted ("chiefComplaint", "observationStartedAt", "observationEndedAt",
-- "dispositionAt", "visitId", "arrivedAt", "treatingId", "deletedAt",
-- "organizationId", "recordedAt"). El v1 (28_emergency_hardening.sql) usaba
-- snake_case que no existe en el schema.
--
-- Idempotente.
-- =============================================================================

-- 1. CHECK constraints en EmergencyVisit --------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_visit_chief_complaint_not_blank_chk') THEN
    ALTER TABLE public."EmergencyVisit"
      ADD CONSTRAINT emergency_visit_chief_complaint_not_blank_chk
      CHECK (length(btrim("chiefComplaint")) >= 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_visit_observation_window_chk') THEN
    ALTER TABLE public."EmergencyVisit"
      ADD CONSTRAINT emergency_visit_observation_window_chk
      CHECK (
        "observationEndedAt" IS NULL
        OR (
          "observationStartedAt" IS NOT NULL
          AND "observationEndedAt" >= "observationStartedAt"
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_visit_disposition_at_consistency_chk') THEN
    ALTER TABLE public."EmergencyVisit"
      ADD CONSTRAINT emergency_visit_disposition_at_consistency_chk
      CHECK (
        (disposition = 'PENDING' AND "dispositionAt" IS NULL)
        OR (disposition <> 'PENDING' AND "dispositionAt" IS NOT NULL)
      );
  END IF;
END $$;

-- 2. CHECK constraint en EmergencyNote ----------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emergency_note_body_not_blank_chk') THEN
    ALTER TABLE public."EmergencyNote"
      ADD CONSTRAINT emergency_note_body_not_blank_chk
      CHECK (length(btrim(body)) >= 1);
  END IF;
END $$;

-- 3. Trigger state machine EmergencyVisit.disposition -------------------------

CREATE OR REPLACE FUNCTION public.fn_validate_emergency_disposition_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_allowed BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.disposition <> 'PENDING' AND NEW."dispositionAt" IS NULL THEN
      RAISE EXCEPTION 'dispositionAt requerido cuando disposition <> PENDING'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.disposition = NEW.disposition THEN
    RETURN NEW;
  END IF;

  v_allowed := (OLD.disposition = 'PENDING'
                AND NEW.disposition IN (
                  'DISCHARGED', 'ADMITTED', 'TRANSFERRED',
                  'LWBS', 'AMA', 'DECEASED'
                ));

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transición inválida de EmergencyDisposition: % -> %',
      OLD.disposition, NEW.disposition
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."dispositionAt" IS NULL THEN
    NEW."dispositionAt" := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_emergency_disposition_transition ON public."EmergencyVisit";
CREATE TRIGGER tr_emergency_disposition_transition
  BEFORE INSERT OR UPDATE ON public."EmergencyVisit"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_emergency_disposition_transition();

-- 4. Trigger: bloquea notas sobre visitas terminadas --------------------------

CREATE OR REPLACE FUNCTION public.fn_block_note_on_terminal_emergency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_disposition TEXT;
BEGIN
  SELECT disposition::text INTO v_disposition
  FROM public."EmergencyVisit"
  WHERE id = NEW."visitId";

  IF v_disposition IS NULL THEN
    RAISE EXCEPTION 'Visita de urgencias % no existe', NEW."visitId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_disposition <> 'PENDING' THEN
    RAISE EXCEPTION 'No se admiten notas sobre visita con disposition % (id=%)',
      v_disposition, NEW."visitId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_block_note_on_terminal_emergency ON public."EmergencyNote";
CREATE TRIGGER tr_block_note_on_terminal_emergency
  BEFORE INSERT ON public."EmergencyNote"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_block_note_on_terminal_emergency();

-- 5. Índices para Beta.4 ------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_emergency_visit_lwbs_pending
  ON public."EmergencyVisit" ("organizationId", "arrivedAt")
  WHERE disposition = 'PENDING' AND "treatingId" IS NULL AND "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS ix_emergency_visit_observation_open
  ON public."EmergencyVisit" ("organizationId", "observationStartedAt")
  WHERE "observationStartedAt" IS NOT NULL
    AND "observationEndedAt" IS NULL
    AND "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS ix_emergency_note_visit_category_recorded
  ON public."EmergencyNote" ("visitId", category, "recordedAt" DESC);
