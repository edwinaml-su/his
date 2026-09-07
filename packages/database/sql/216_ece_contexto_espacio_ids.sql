-- =============================================================================
-- 216_ece_contexto_espacio_ids.sql — ADR 0022 (P0-5 Code Castle), mitad SQL.
--
-- Tres fixes independientes pero de la misma causa raíz ("no hay un único
-- punto de verdad para el id/GUC de establecimiento en ece.*"):
--
--   1. ece.set_ece_context resuelve el PUENTE de espacios de id: la app
--      históricamente pasó ids de DOS espacios bajo el mismo GUC —
--      public."Establishment".id (espacio A, lo que trae ctx.tenant) y
--      ece.establecimiento.id (espacio B, lo que comparan 15+ policies).
--      Ahora la función acepta cualquiera de los dos y SIEMPRE deja
--      app.ece_establecimiento_id en el espacio B, usando la columna puente
--      ece.establecimiento.establishment_id (1:1, verificada en ADR 0022 §2).
--      Si no hay fila puente, conserva el valor crudo con RAISE WARNING
--      (comportamiento legacy = 0 filas bajo RLS, pero ahora ruidoso en logs;
--      no se lanza excepción para no romper seeders/E2E que aún no siembran
--      ece.establecimiento).
--
--   2. ece.verbal_order: sus 3 policies leían el GUC fantasma
--      'app.establecimiento_id' (sin prefijo ece_) que NADIE setea →
--      deny-all permanente en SELECT/INSERT/UPDATE (IPSG.2 inoperante).
--      Se recrean con ece.current_establecimiento_id().
--
--   3. ece.who_checklist_insert leía 'app.current_estab_id' (tercer nombre
--      fantasma) → el WHO Surgical Safety Checklist no se podía crear bajo
--      RLS. Se alinea con who_checklist_select/update, que ya usan
--      ece.current_establecimiento_id().
--
-- Va acompañado de sql/217 (migración de ece.paciente al espacio B) y del
-- cambio en packages/trpc/src/workflow/context.ts (applyWorkflowContext deja
-- de setear el GUC a mano y llama esta función). Aplicar 216+217 JUNTOS,
-- inmediatamente después del deploy del código.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------
-- 1. set_ece_context con resolución de puente (reemplaza sql/62b; conserva
--    SECURITY DEFINER + search_path fijo de sql/155).
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ece.set_ece_context(p_personal_id uuid, p_establecimiento_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'ece', 'public', 'pg_catalog'
AS $function$
DECLARE
  v_resolved uuid;
BEGIN
  PERFORM set_config('app.ece_personal_id', coalesce(p_personal_id::text, ''), true);

  IF p_establecimiento_id IS NULL THEN
    PERFORM set_config('app.ece_establecimiento_id', '', true);
    RETURN;
  END IF;

  -- ADR 0022: aceptar espacio B (id) o espacio A (establishment_id puente).
  SELECT e.id INTO v_resolved
  FROM ece.establecimiento e
  WHERE e.id = p_establecimiento_id
     OR e.establishment_id = p_establecimiento_id
  LIMIT 1;

  IF v_resolved IS NULL THEN
    RAISE WARNING 'set_ece_context: establecimiento % sin fila en ece.establecimiento (ni id ni establishment_id puente) — RLS ECE devolverá 0 filas',
      p_establecimiento_id;
    v_resolved := p_establecimiento_id;
  END IF;

  PERFORM set_config('app.ece_establecimiento_id', v_resolved::text, true);
END;
$function$;

-- -----------------------------------------------------------------------
-- 2. ece.verbal_order — GUC fantasma 'app.establecimiento_id' → helper real.
--    Mismo predicado que tenían (join a episodio_atencion), solo cambia la
--    fuente del establecimiento. Condicional a que la tabla exista: la BD
--    efímera de E2E aplica este archivo pero NO sql/113 (DROP POLICY
--    IF EXISTS no perdona la ausencia de la TABLA — P1014).
-- -----------------------------------------------------------------------
DO $$ BEGIN
  IF to_regclass('ece.verbal_order') IS NULL THEN RETURN; END IF;

  DROP POLICY IF EXISTS verbal_order_select_policy ON ece.verbal_order;
  CREATE POLICY verbal_order_select_policy ON ece.verbal_order
    FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM ece.episodio_atencion ea
      WHERE ea.id = verbal_order.episodio_id
        AND ea.establecimiento_id = ece.current_establecimiento_id()));

  DROP POLICY IF EXISTS verbal_order_insert_policy ON ece.verbal_order;
  CREATE POLICY verbal_order_insert_policy ON ece.verbal_order
    FOR INSERT
    WITH CHECK (EXISTS (
      SELECT 1 FROM ece.episodio_atencion ea
      WHERE ea.id = verbal_order.episodio_id
        AND ea.establecimiento_id = ece.current_establecimiento_id()));

  DROP POLICY IF EXISTS verbal_order_update_policy ON ece.verbal_order;
  CREATE POLICY verbal_order_update_policy ON ece.verbal_order
    FOR UPDATE
    USING (EXISTS (
      SELECT 1 FROM ece.episodio_atencion ea
      WHERE ea.id = verbal_order.episodio_id
        AND ea.establecimiento_id = ece.current_establecimiento_id()));
END $$;

-- -----------------------------------------------------------------------
-- 3. ece.who_checklist_insert — GUC fantasma 'app.current_estab_id' →
--    alinear con select/update de la misma tabla. Condicional por la misma
--    razón que la sección 2.
-- -----------------------------------------------------------------------
DO $$ BEGIN
  IF to_regclass('ece.who_checklist') IS NULL THEN RETURN; END IF;

  DROP POLICY IF EXISTS who_checklist_insert ON ece.who_checklist;
  CREATE POLICY who_checklist_insert ON ece.who_checklist
    FOR INSERT
    WITH CHECK (EXISTS (
      SELECT 1
      FROM ece.acto_quirurgico aq
      JOIN ece.episodio_atencion ea ON ea.id = aq.episodio_id
      WHERE aq.id = who_checklist.acto_quirurgico_id
        AND ea.establecimiento_id = ece.current_establecimiento_id()));
END $$;
