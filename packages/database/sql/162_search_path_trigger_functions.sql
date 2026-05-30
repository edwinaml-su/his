-- =============================================================================
-- 162_search_path_trigger_functions.sql
-- Hardening Supabase advisor `function_search_path_mutable` (WARN).
--
-- Fija search_path en las 58 funciones restantes del schema `ece` y `public`
-- que tenian proconfig=NULL.
--
-- NO toca las 6 funciones criticas SECURITY DEFINER ya hardened en
-- 155_fix_security_definer_search_path.sql:
--   - ece.set_ece_context
--   - ece.fn_check_dedup_nui_dui
--   - ece.fn_assert_wristband_gsrn
--   - ece.fn_gs1_epcis_event_immutable
--   - public.current_portal_account
--   - public.expire_pharmacy_reservations
--
-- Defensa en profundidad: aunque la mayoria de estas funciones NO son
-- SECURITY DEFINER (corren con permisos del caller), fijar search_path
-- previene que un atacante que comprometa una sesion authenticated
-- redirija llamadas a funciones helper a objetos en su propio schema.
-- =============================================================================

-- ─── ece schema (45 funciones) ────────────────────────────────────────────────
ALTER FUNCTION ece._doc(p_codigo text) SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece._estado(p_doc text, p_estado text) SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece._rol(p_codigo text) SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.bedside_validation_immutable() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.crn_set_updated_at() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.current_establecimiento_id() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.current_establecimiento_id_safe() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.current_personal_id() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.devolucion_inventario_set_updated_at() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fall_event_updated_at() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_admin_med_immutable() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_assert_dependencias_firmadas() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_assert_who_checklist_complete() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_bloquea_comite_firmada() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_bloquea_mutacion() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_bloquea_mutacion_acto_qx() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_bloquea_mutacion_certdef() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_bloquea_mutacion_consentimiento() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_bloquea_mutacion_epicrisis() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_chk_modalidad_hospitalaria() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_depende_de_efectivo(p_tipo_documento_id uuid, p_establecimiento_id uuid) SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_doc_asoc_inmutabilidad() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_episodio_actualizado_en() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_episodio_log_estado() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_episodio_valida_transicion() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_farmacovig_updated_at() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_hc_bloquea_mutacion() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_hc_immutable() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_historial_inmutable() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_lockout_firma() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_recepcion_actualizado_en() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_seed_workflow_estandar(p_codigo_doc text) SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_set_updated_at() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_tabla_historica_inmutable() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_validate_diagnosticos_cie10(diagnosticos jsonb) SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_verbal_order_updated_at() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.fn_who_checklist_updated_en() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.gs1_check_digit_valid(p_code text) SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.next_workflow_version(p_tipo_doc_id uuid) SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.preop_checklist_immutable() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.registrar_tabla_historica(p_tabla text) SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.set_reanimacion_neonatal_updated() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.stat_event_expire_old() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.stat_event_immutability() SET search_path = ece, public, pg_catalog;
ALTER FUNCTION ece.update_eliminacion_updated_at() SET search_path = ece, public, pg_catalog;

-- ─── public schema (13 funciones) ─────────────────────────────────────────────
ALTER FUNCTION public.chat_knowledge_search(query_embedding vector, match_count integer, min_similarity double precision) SET search_path = public, pg_catalog;
ALTER FUNCTION public.fn_alloc_rule_targets_sum_100() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fn_bloquea_death_certificate() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fn_invoice_recalc_payments() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fn_operating_room_default_qx() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fn_set_updated_at_medication_gtin() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fn_set_updated_at_pharmacy_order() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fn_validate_pharmacy_order_status_transition() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fn_validate_pharmacy_reservation_status_transition() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fn_validate_staff_gsrn_status_transition() SET search_path = public, pg_catalog;
ALTER FUNCTION public.set_pharma_reservation_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.set_pharmacy_cart_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.set_updated_at_gsrn_history() SET search_path = public, pg_catalog;

-- ─── Verificacion post-apply ──────────────────────────────────────────────────
-- SELECT n.nspname || '.' || p.proname AS fname,
--        COALESCE(array_to_string(p.proconfig, ' | '), '<NULL>') AS proconfig
-- FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
-- WHERE n.nspname IN ('ece', 'public')
--   AND p.proconfig IS NULL
--   AND p.prokind = 'f'
-- ORDER BY n.nspname, p.proname;
-- -> 0 filas en ece y public (excepto las 6 ya hardened previamente)
