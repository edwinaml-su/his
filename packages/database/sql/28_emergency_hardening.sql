-- =============================================================================
-- §12 Emergency — Hardening Layer 1 (Beta.4, 2026-05-13)
--
-- Owner: @DBA (revisar) + @SRE (aplicar en mantenimiento Edwin manual)
-- Estado: NO ejecutado en prod. Documentado para aplicación post-cierre Bloque 1.
--
-- Cambios:
--   1. CHECK constraints sobre EmergencyVisit
--      - chief_complaint no-blank.
--      - observation: si ended_at, started_at debe existir y ended >= started.
--      - disposition_at no-null cuando disposition != PENDING.
--   2. CHECK constraints sobre EmergencyNote (body no-blank).
--   3. Trigger BEFORE UPDATE en EmergencyVisit: valida state machine
--      de `disposition` permitiendo solo PENDING -> {DISCHARGED, ADMITTED,
--      TRANSFERRED, LWBS, AMA, DECEASED}. Terminales no permiten cambio.
--   4. Trigger BEFORE INSERT/UPDATE en EmergencyNote: bloquea notas sobre
--      visitas con disposition terminal (defensa en profundidad junto al router).
--   5. Índices adicionales para queries de hardening (LWBS check,
--      observation lookup, notes por categoría).
--
-- Convención: SQL idempotente con DO $$ ... $$ guards.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CHECK constraints en emergency_visit
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'emergency_visit_chief_complaint_not_blank_chk'
  ) THEN
    ALTER TABLE public.emergency_visit
      ADD CONSTRAINT emergency_visit_chief_complaint_not_blank_chk
      CHECK (length(btrim(chief_complaint)) >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'emergency_visit_observation_window_chk'
  ) THEN
    ALTER TABLE public.emergency_visit
      ADD CONSTRAINT emergency_visit_observation_window_chk
      CHECK (
        observation_ended_at IS NULL
        OR (
          observation_started_at IS NOT NULL
          AND observation_ended_at >= observation_started_at
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'emergency_visit_disposition_at_consistency_chk'
  ) THEN
    ALTER TABLE public.emergency_visit
      ADD CONSTRAINT emergency_visit_disposition_at_consistency_chk
      CHECK (
        (disposition = 'PENDING' AND disposition_at IS NULL)
        OR (disposition <> 'PENDING' AND disposition_at IS NOT NULL)
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. CHECK constraint en emergency_note
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'emergency_note_body_not_blank_chk'
  ) THEN
    ALTER TABLE public.emergency_note
      ADD CONSTRAINT emergency_note_body_not_blank_chk
      CHECK (length(btrim(body)) >= 1);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Trigger state machine en emergency_visit.disposition
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_validate_emergency_disposition_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_allowed BOOLEAN := FALSE;
BEGIN
  -- INSERT: aceptar cualquier estado inicial (router crea siempre PENDING
  -- pero migraciones / imports pueden insertar terminados).
  IF TG_OP = 'INSERT' THEN
    -- Si insertar disposition != PENDING, exigir disposition_at coherente
    -- (esto es defensa adicional al CHECK).
    IF NEW.disposition <> 'PENDING' AND NEW.disposition_at IS NULL THEN
      RAISE EXCEPTION 'disposition_at requerido cuando disposition <> PENDING'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: si la disposition no cambia, permitir (puede ser update notes).
  IF OLD.disposition = NEW.disposition THEN
    RETURN NEW;
  END IF;

  -- Solo PENDING admite transiciones; los demás son terminales.
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

  -- Asegurar que la transición setee disposition_at.
  IF NEW.disposition_at IS NULL THEN
    NEW.disposition_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_emergency_disposition_transition ON public.emergency_visit;
CREATE TRIGGER tr_emergency_disposition_transition
  BEFORE INSERT OR UPDATE ON public.emergency_visit
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_emergency_disposition_transition();

-- -----------------------------------------------------------------------------
-- 4. Trigger: bloquea notas sobre visitas terminadas
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_block_note_on_terminal_emergency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_disposition TEXT;
BEGIN
  SELECT disposition::text INTO v_disposition
  FROM public.emergency_visit
  WHERE id = NEW.visit_id;

  IF v_disposition IS NULL THEN
    RAISE EXCEPTION 'Visita de urgencias % no existe', NEW.visit_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_disposition <> 'PENDING' THEN
    RAISE EXCEPTION 'No se admiten notas sobre visita con disposition % (id=%)',
      v_disposition, NEW.visit_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_block_note_on_terminal_emergency ON public.emergency_note;
CREATE TRIGGER tr_block_note_on_terminal_emergency
  BEFORE INSERT ON public.emergency_note
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_block_note_on_terminal_emergency();

-- -----------------------------------------------------------------------------
-- 5. Índices para queries Beta.4
-- -----------------------------------------------------------------------------

-- Cron LWBS: visitas PENDING sin treating, ordenadas por arrived_at.
CREATE INDEX IF NOT EXISTS ix_emergency_visit_lwbs_pending
  ON public.emergency_visit (organization_id, arrived_at)
  WHERE disposition = 'PENDING' AND treating_id IS NULL AND deleted_at IS NULL;

-- Observación abierta: visitas con started pero sin ended.
CREATE INDEX IF NOT EXISTS ix_emergency_visit_observation_open
  ON public.emergency_visit (organization_id, observation_started_at)
  WHERE observation_started_at IS NOT NULL
    AND observation_ended_at IS NULL
    AND deleted_at IS NULL;

-- Notas por categoría dentro de visita.
CREATE INDEX IF NOT EXISTS ix_emergency_note_visit_category_recorded
  ON public.emergency_note (visit_id, category, recorded_at DESC);

-- -----------------------------------------------------------------------------
-- 6. Verificación post-aplicación
-- -----------------------------------------------------------------------------

-- Esperado tras ejecución:
--   SELECT COUNT(*) FROM pg_constraint
--   WHERE conname IN (
--     'emergency_visit_chief_complaint_not_blank_chk',
--     'emergency_visit_observation_window_chk',
--     'emergency_visit_disposition_at_consistency_chk',
--     'emergency_note_body_not_blank_chk'
--   );
--   -- Debe retornar 4
--
--   SELECT tgname FROM pg_trigger
--   WHERE tgname IN (
--     'tr_emergency_disposition_transition',
--     'tr_block_note_on_terminal_emergency'
--   );
--   -- Debe retornar 2 filas
--
--   SELECT indexname FROM pg_indexes
--   WHERE indexname IN (
--     'ix_emergency_visit_lwbs_pending',
--     'ix_emergency_visit_observation_open',
--     'ix_emergency_note_visit_category_recorded'
--   );
--   -- Debe retornar 3 filas

-- -----------------------------------------------------------------------------
-- 7. Rollback (si fuera necesario)
-- -----------------------------------------------------------------------------

-- BEGIN;
--   DROP TRIGGER IF EXISTS tr_block_note_on_terminal_emergency ON public.emergency_note;
--   DROP TRIGGER IF EXISTS tr_emergency_disposition_transition ON public.emergency_visit;
--   DROP FUNCTION IF EXISTS public.fn_block_note_on_terminal_emergency();
--   DROP FUNCTION IF EXISTS public.fn_validate_emergency_disposition_transition();
--   ALTER TABLE public.emergency_note DROP CONSTRAINT IF EXISTS emergency_note_body_not_blank_chk;
--   ALTER TABLE public.emergency_visit DROP CONSTRAINT IF EXISTS emergency_visit_chief_complaint_not_blank_chk;
--   ALTER TABLE public.emergency_visit DROP CONSTRAINT IF EXISTS emergency_visit_observation_window_chk;
--   ALTER TABLE public.emergency_visit DROP CONSTRAINT IF EXISTS emergency_visit_disposition_at_consistency_chk;
--   DROP INDEX IF EXISTS public.ix_emergency_visit_lwbs_pending;
--   DROP INDEX IF EXISTS public.ix_emergency_visit_observation_open;
--   DROP INDEX IF EXISTS public.ix_emergency_note_visit_category_recorded;
-- COMMIT;
