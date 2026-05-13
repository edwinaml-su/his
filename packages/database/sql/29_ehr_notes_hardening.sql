-- =============================================================================
-- §14 EHR Clinical Notes — Hardening Layer 1 (Beta.5, 2026-05-13)
--
-- Owner: @DBA (revisar) + @SRE (aplicar en mantenimiento, Edwin aprueba merge)
-- Estado: NO ejecutado en prod. Script para aplicación manual post-merge.
--
-- Cambios:
--   1. Trigger BEFORE UPDATE/DELETE en "ClinicalNote": bloquea toda mutación
--      cuando signedAt IS NOT NULL, salvo el propio UPDATE que establece
--      signedAt (firma) — identificado porque OLD.signed_at IS NULL.
--   2. Trigger BEFORE INSERT en "ClinicalNote": valida que si addendum_of_id
--      IS NOT NULL, la nota referenciada ya esté firmada (signedAt NOT NULL).
--   3. Índice adicional en "EncounterDiagnosis" sobre concept_id para los
--      JOINs de validación CIE-10 (el FK index de 07_fk_indexes ya existe;
--      este es un partial index para conceptos activos si es necesario).
--
-- Convención: SQL idempotente (DROP IF EXISTS + DO $$ guards).
-- Nombres de tabla: Prisma usa PascalCase en PostgreSQL por mapeo directo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Función compartida de inmutabilidad post-firma en ClinicalNote
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_clinical_note_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- DELETE nunca permitido sobre nota firmada.
  IF TG_OP = 'DELETE' THEN
    IF OLD."signedAt" IS NOT NULL THEN
      RAISE EXCEPTION
        'clinical_note_immutable: nota % ya firmada (signedAt=%). No se permite DELETE.',
        OLD.id, OLD."signedAt"
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: permitido sólo cuando estamos estableciendo signedAt por primera vez
  -- (OLD.signedAt IS NULL AND NEW.signedAt IS NOT NULL) o cuando la nota aún
  -- no está firmada.
  IF TG_OP = 'UPDATE' THEN
    IF OLD."signedAt" IS NOT NULL THEN
      -- La nota ya estaba firmada: bloquear cualquier UPDATE.
      RAISE EXCEPTION
        'clinical_note_immutable: nota % ya firmada (signedAt=%). No se permite UPDATE post-firma.',
        OLD.id, OLD."signedAt"
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- Wiring: BEFORE UPDATE OR DELETE en ClinicalNote.
DROP TRIGGER IF EXISTS trg_clinical_note_immutability ON public."ClinicalNote";

CREATE TRIGGER trg_clinical_note_immutability
  BEFORE UPDATE OR DELETE ON public."ClinicalNote"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_clinical_note_immutability();

-- -----------------------------------------------------------------------------
-- 2. Función de validación de addendum chain en ClinicalNote INSERT
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_clinical_note_addendum_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_original_signed_at timestamptz;
BEGIN
  -- Si no es addendum, nada que validar.
  IF NEW."addendumOfId" IS NULL THEN
    RETURN NEW;
  END IF;

  -- La nota original debe existir y estar firmada.
  SELECT "signedAt"
    INTO v_original_signed_at
    FROM public."ClinicalNote"
   WHERE id = NEW."addendumOfId";

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'clinical_note_addendum_chain: nota original % no existe.',
      NEW."addendumOfId"
      USING ERRCODE = 'P0001';
  END IF;

  IF v_original_signed_at IS NULL THEN
    RAISE EXCEPTION
      'clinical_note_addendum_chain: nota original % no está firmada. No se puede crear addendum.',
      NEW."addendumOfId"
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Wiring: BEFORE INSERT en ClinicalNote.
DROP TRIGGER IF EXISTS trg_clinical_note_addendum_chain ON public."ClinicalNote";

CREATE TRIGGER trg_clinical_note_addendum_chain
  BEFORE INSERT ON public."ClinicalNote"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_clinical_note_addendum_chain();

-- -----------------------------------------------------------------------------
-- 3. Índice sobre ClinicalNote.editHistory no requerido (es JSONB sin búsqueda
--    por contenido en capa 1). Se documenta para referencia futura.
--
--    Índice parcial en EncounterDiagnosis para facilitar el JOIN de validación
--    ICD10 (concept_id → ClinicalConcept.code_system_id → CodeSystem.code='ICD10').
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename   = 'EncounterDiagnosis'
       AND indexname   = 'idx_enc_diagnosis_concept_id_hardening'
  ) THEN
    CREATE INDEX idx_enc_diagnosis_concept_id_hardening
      ON public."EncounterDiagnosis" ("conceptId");
  END IF;
END;
$$;

-- =============================================================================
-- FIN 29_ehr_notes_hardening.sql
-- =============================================================================
