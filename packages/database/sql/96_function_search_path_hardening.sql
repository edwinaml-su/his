-- =============================================================================
-- 96_function_search_path_hardening.sql
-- Hardening: SET search_path en funciones con `function_search_path_mutable`
--
-- Corrige 38 funciones en schemas ece, gs1 y public.
-- Referencia: Supabase Advisor warning `function_search_path_mutable`.
-- CVE-mitigación: evita ataques de search_path injection si un rol sin
-- SECURITY DEFINER logra crear objetos en un schema anterior en el path.
--
-- Idempotente: usa DO $$ BEGIN ... EXCEPTION WHEN OTHERS THEN NULL; END $$
-- para tolerar funciones que no existen en el entorno actual.
--
-- NO aplicar desde el agente. Aplicar vía Supabase SQL Editor pre-deploy
-- o mcp__supabase__apply_migration en ventana de mantenimiento.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Schema: ece
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ALTER FUNCTION ece.fn_who_checklist_updated_en()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.fn_farmacovig_updated_at()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.fn_bloquea_mutacion()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece._rol()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece._estado()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece._doc()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.current_establecimiento_id_safe()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.set_reanimacion_neonatal_updated()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.preop_checklist_immutable()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.fn_recepcion_actualizado_en()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.update_eliminacion_updated_at()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.devolucion_inventario_set_updated_at()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.fn_episodio_actualizado_en()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.fn_episodio_valida_transicion()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.fn_chk_modalidad_hospitalaria()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.fn_episodio_log_estado()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.gs1_check_digit_valid()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.fn_set_updated_at()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.fn_check_dedup_nui_dui()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.fn_historial_inmutable()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.fn_tabla_historica_inmutable()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.registrar_tabla_historica()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.set_ece_context()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.current_personal_id()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.current_establecimiento_id()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.bedside_validation_immutable()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.fn_gs1_epcis_event_immutable()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.fn_lockout_firma()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.fn_bloquea_comite_firmada()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION ece.next_workflow_version()
    SET search_path = pg_catalog, public, ece;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Schema: gs1
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ALTER FUNCTION gs1.set_updated_at()
    SET search_path = pg_catalog, public, gs1;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Schema: public
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ALTER FUNCTION public.set_pharma_reservation_updated_at()
    SET search_path = pg_catalog, public;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION public.fn_set_updated_at_pharmacy_order()
    SET search_path = pg_catalog, public;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION public.fn_validate_pharmacy_order_status_transition()
    SET search_path = pg_catalog, public;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION public.fn_validate_pharmacy_reservation_status_transition()
    SET search_path = pg_catalog, public;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION public.fn_set_updated_at_medication_gtin()
    SET search_path = pg_catalog, public;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION public.fn_validate_staff_gsrn_status_transition()
    SET search_path = pg_catalog, public;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION public.set_pharmacy_cart_updated_at()
    SET search_path = pg_catalog, public;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION public.expire_pharmacy_reservations()
    SET search_path = pg_catalog, public;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER FUNCTION public.set_updated_at_gsrn_history()
    SET search_path = pg_catalog, public;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Verificación post-aplicación (ejecutar manualmente para confirmar):
-- SELECT proname, pronamespace::regnamespace, proconfig
-- FROM pg_proc
-- WHERE proconfig::text LIKE '%search_path%'
-- ORDER BY pronamespace::regnamespace, proname;
