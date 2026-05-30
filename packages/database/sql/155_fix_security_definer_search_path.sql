-- =============================================================================
-- 155_fix_security_definer_search_path.sql
-- Cierra: BD-P0-4 / US-21-A4
-- Fija search_path en funciones SECURITY DEFINER para prevenir hijacking
-- por search_path injection (CVE pattern documentado en PG docs).
--
-- Riesgo original: SECDEF con proconfig=NULL ejecuta con search_path del
-- caller; un usuario malicioso puede crear objetos en su schema con el
-- mismo nombre que un objeto referenciado dentro de la funcion y forzar
-- ejecucion alterada.
--
-- Estado pre-apply (verificado 2026-05-30):
--   6 funciones SECDEF con proconfig=NULL.
-- Estado post-apply:
--   las 6 con search_path explicito.
--
-- Las 65+ trigger functions sin SECDEF (proconfig NULL) reportadas como
-- WARN por el advisor quedan para Beta.21 Sprint 2 (US-21-A4-bis).
-- =============================================================================

-- ECE setter de GUCs tenant (toda la RLS ECE depende de este)
ALTER FUNCTION ece.set_ece_context(p_personal_id uuid, p_establecimiento_id uuid)
  SET search_path = ece, public, pg_catalog;

-- Triggers ECE: el search_path mas seguro seria vacio + schema-qualify todo
-- en el cuerpo (Postgres docs), pero requiere refactor del cuerpo
-- (TODO Beta.22). Por ahora fijamos search_path a los schemas que
-- efectivamente usa la funcion — defensivo contra hijacking.
ALTER FUNCTION ece.fn_check_dedup_nui_dui()
  SET search_path = ece, public, pg_catalog;

ALTER FUNCTION ece.fn_assert_wristband_gsrn()
  SET search_path = ece, public, pg_catalog;

ALTER FUNCTION ece.fn_gs1_epcis_event_immutable()
  SET search_path = ece, public, pg_catalog;

-- Portal paciente: helper publica que retorna el portal account del JWT actual
ALTER FUNCTION public.current_portal_account()
  SET search_path = public, pg_catalog;

-- Cron-like cleanup de reservas farmacia
ALTER FUNCTION public.expire_pharmacy_reservations()
  SET search_path = public, pg_catalog;

-- Verificacion post-apply esperada:
-- SELECT n.nspname || '.' || p.proname AS fname,
--        array_to_string(p.proconfig, ' | ') AS proconfig
-- FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
-- WHERE p.prosecdef
--   AND p.proname IN (
--     'set_ece_context', 'fn_check_dedup_nui_dui', 'fn_assert_wristband_gsrn',
--     'fn_gs1_epcis_event_immutable', 'current_portal_account',
--     'expire_pharmacy_reservations'
--   );
-- -> 6 filas, todas con proconfig 'search_path=...' (NO NULL)
