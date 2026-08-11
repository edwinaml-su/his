-- =============================================================================
-- 196_cc0020_hardening_advisors.sql
-- CC-0020 — Hardening de advisors de seguridad Supabase (linter EXTERNAL).
--
-- Cierra 6 hallazgos nivel ERROR reportados por el database linter:
--   - "Security Definer View": public.v_inpatient_admission_timeline.
--   - "RLS Disabled in Public" ×4: secuencia_expediente / secuencia_cuenta /
--     secuencia_no_identificado / secuencia_solicitud_imagen.
--   - "Sensitive Columns Exposed": secuencia_cuenta (columna patient_id).
--
-- Contexto:
--   Las 4 tablas de secuencia son CONTADORES INTERNOS, escritos únicamente por
--   las funciones fn_next_* (SECURITY DEFINER, owner=postgres). Tenían grants
--   completos a anon/authenticated (INSERT/UPDATE/DELETE/TRUNCATE) y estaban
--   expuestas por PostgREST — cualquiera podía leerlas/alterarlas y
--   secuencia_cuenta filtraba patient_id.
--
--   La vista v_inpatient_admission_timeline era SECURITY DEFINER (owner postgres):
--   consultarla NO aplicaba las RLS de InpatientAdmission → fuga cross-tenant.
--
-- Por qué es seguro habilitar RLS en las tablas de secuencia:
--   El OWNER de una tabla OMITE su propio RLS (salvo FORCE ROW LEVEL SECURITY,
--   que NO se usa aquí). Las funciones fn_next_* corren como su definer
--   (postgres = owner de las tablas), así que siguen operando con RLS activa.
--   Verificado con smoke test (fn_next_solicitud_imagen sobre bucket ficticio
--   año 2099, sin error de permisos). anon/authenticated quedan sin grants y,
--   por RLS sin policy, sin acceso alguno (deny-all — la config más segura
--   para un contador interno). El advisor pasa de ERROR "RLS Disabled" a INFO
--   "RLS Enabled No Policy" (benigno e intencional).
--
-- Idempotente. YA APLICADO a prod 2026-08-10 vía MCP (migración
-- cc0020_hardening_advisors_secuencias_vista) — este archivo es el registro
-- versionado. NO re-aplicar innecesariamente.
-- =============================================================================

-- 1. Tablas de secuencia — sacar de la API REST + RLS deny-all
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'secuencia_expediente','secuencia_cuenta','secuencia_no_identificado','secuencia_solicitud_imagen'
  ] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

COMMENT ON TABLE public.secuencia_expediente IS
  'CC-0020 — contador interno, solo accesible por fn_next_expediente (SECDEF). RLS deny-all + sin grants API.';
COMMENT ON TABLE public.secuencia_cuenta IS
  'CC-0020 — contador interno (por paciente), solo fn_next_cuenta (SECDEF). RLS deny-all + sin grants API (contenía patient_id expuesto).';
COMMENT ON TABLE public.secuencia_no_identificado IS
  'CC-0020 — contador interno, solo fn_next_no_identificado (SECDEF). RLS deny-all + sin grants API.';
COMMENT ON TABLE public.secuencia_solicitud_imagen IS
  'CC-0020 — contador interno, solo fn_next_solicitud_imagen (SECDEF). RLS deny-all + sin grants API.';

-- 2. Vista timeline — respetar RLS del que consulta + quitar acceso de escritura/anon
ALTER VIEW public.v_inpatient_admission_timeline SET (security_invoker = true);
REVOKE ALL ON public.v_inpatient_admission_timeline FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.v_inpatient_admission_timeline FROM authenticated;

COMMENT ON VIEW public.v_inpatient_admission_timeline IS
  'CC-0020 — security_invoker=true: respeta RLS de InpatientAdmission del usuario que consulta (antes SECURITY DEFINER = fuga cross-tenant).';

-- =============================================================================
-- Verificación (ejecutar tras aplicar):
--   SELECT relname, relrowsecurity FROM pg_class
--     WHERE relname LIKE 'secuencia_%';  -- relrowsecurity = t en las 4
--   get_advisors(security): 0 hallazgos de "RLS Disabled" / "Security Definer
--     View" / "Sensitive Columns Exposed" sobre estos objetos.
-- =============================================================================
