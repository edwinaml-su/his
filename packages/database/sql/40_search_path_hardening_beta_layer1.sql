-- =============================================================================
-- HIS SQL 40 — search_path hardening Beta layer 1 (todas las funciones 25-38)
--
-- Aplica ALTER FUNCTION ... SET search_path = '' a las 22 funciones creadas
-- por los scripts de hardening beta layer 1, cerrando los WARN del advisor
-- security (function_search_path_mutable).
--
-- Aplicar DESPUÉS de:
--   - Bundle 8 archivos OK (29, 31, 33-38) — ya aplicado 2026-05-13
--   - 6 patches v2 (25, 26, 27, 28, 30, 32) — pendientes 2026-05-14
--
-- Idempotente: ALTER FUNCTION ... SET search_path = '' es no-op si ya está.
-- Todas las funciones referencian tablas con prefijo `public.X` calificado.
-- =============================================================================

-- Bloque 1: funciones del bundle OK (29, 31, 33-38) — 13 funciones -----------

ALTER FUNCTION public.fn_clinical_note_immutability()                  SET search_path = '';
ALTER FUNCTION public.fn_clinical_note_addendum_chain()                SET search_path = '';
ALTER FUNCTION public.trg_outpatient_consultation_appt_status()        SET search_path = '';
ALTER FUNCTION public.trg_outpatient_appointment_status_transition()   SET search_path = '';
ALTER FUNCTION public.fn_imaging_report_immutability()                 SET search_path = '';
ALTER FUNCTION public.fn_stock_movement_append_only()                  SET search_path = '';
ALTER FUNCTION public.fn_stock_movement_fefo()                         SET search_path = '';
ALTER FUNCTION public.fn_calibration_log_append_only()                 SET search_path = '';
ALTER FUNCTION public.fn_respiratory_critical_alert()                  SET search_path = '';
ALTER FUNCTION public.fn_medical_gas_usage_append_only()               SET search_path = '';
ALTER FUNCTION public.fn_nutrition_assessment_immutability()           SET search_path = '';
ALTER FUNCTION public.fn_auth_request_state_machine()                  SET search_path = '';
ALTER FUNCTION public.fn_auth_request_no_delete()                      SET search_path = '';

-- Bloque 2: funciones de los patches v2 (25, 26, 27, 28, 30, 32) — 9 funciones

ALTER FUNCTION public.fn_validate_inpatient_status_transition()        SET search_path = '';
ALTER FUNCTION public.fn_validate_prescription_status_transition()     SET search_path = '';
ALTER FUNCTION public.fn_validate_lab_order_status_transition()        SET search_path = '';
ALTER FUNCTION public.fn_validate_emergency_disposition_transition()   SET search_path = '';
ALTER FUNCTION public.fn_block_note_on_terminal_emergency()            SET search_path = '';
ALTER FUNCTION public.fn_validate_surgery_status_transition()          SET search_path = '';
ALTER FUNCTION public.fn_surgery_who_checklist_gate()                  SET search_path = '';
ALTER FUNCTION public.fn_emar_accumulate_administered_qty()            SET search_path = '';
ALTER FUNCTION public.fn_emar_immutable_post_administered()            SET search_path = '';

-- =============================================================================
-- Verificación post-apply:
--   SELECT count(*) FROM pg_proc p
--   WHERE proname IN (
--     'fn_clinical_note_immutability','fn_clinical_note_addendum_chain',
--     'trg_outpatient_consultation_appt_status','trg_outpatient_appointment_status_transition',
--     'fn_imaging_report_immutability','fn_stock_movement_append_only',
--     'fn_stock_movement_fefo','fn_calibration_log_append_only',
--     'fn_respiratory_critical_alert','fn_medical_gas_usage_append_only',
--     'fn_nutrition_assessment_immutability','fn_auth_request_state_machine',
--     'fn_auth_request_no_delete','fn_validate_inpatient_status_transition',
--     'fn_validate_prescription_status_transition','fn_validate_lab_order_status_transition',
--     'fn_validate_emergency_disposition_transition','fn_block_note_on_terminal_emergency',
--     'fn_validate_surgery_status_transition','fn_surgery_who_checklist_gate',
--     'fn_emar_accumulate_administered_qty','fn_emar_immutable_post_administered'
--   ) AND proconfig @> ARRAY['search_path=']::text[];
--   -- = 22
-- =============================================================================
