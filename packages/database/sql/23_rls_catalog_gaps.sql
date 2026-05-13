-- =============================================================================
-- HIS Multi-país | RLS Policies — catalog & lookup gap closure
--
-- Cobertura faltante surfaceada por Supabase advisor (2026-05-13):
-- 23 tablas con RLS deshabilitada. Riesgo: anyone con anon key puede
-- leer/modificar cualquier row.
--
-- Patrón aplicado (idéntico a ExchangeRate en 06_rls_auth_audit.sql):
--   - ALTER TABLE ... ENABLE ROW LEVEL SECURITY
--   - CREATE POLICY <t>_select_all ... FOR SELECT USING (true)
--     (cualquier rol autenticado puede leer — son catálogos públicos)
--   - SIN policy de mutación (INSERT/UPDATE/DELETE)
--     (solo service_role bypasea RLS → admin catalogs via backend)
--
-- TDR §7 (catálogos maestros) — parametrizables solo desde UI admin
-- que usa service_role para mutación.
--
-- Idempotente (DROP POLICY IF EXISTS antes de CREATE).
-- =============================================================================

DO $$
DECLARE
  t text;
  catalogs text[] := ARRAY[
    -- Identidad y demografía (i18n + lookup)
    'Language',
    'MaritalStatus',
    'IdentifierType',
    'EducationLevel',
    'BiologicalSex',
    'Ethnicity',
    'Religion',
    'PatientType',
    'PatientCategory',
    'AgeBand',
    'Gender',
    'Occupation',

    -- Geografía / regulatorio
    'Country',
    'GeoDivision',
    'Holiday',

    -- Económico
    'Currency',
    'CountryCurrency',

    -- Clínico (catálogos parametrizables)
    'MedicalSpecialty',
    'ClinicalConcept',
    'ClinicalConceptMap',
    'CodeSystem',
    'Vaccine',

    -- Seguridad (catálogo de permisos definidos globalmente)
    'Permission'
  ];
BEGIN
  FOREACH t IN ARRAY catalogs LOOP
    -- 1) Habilitar RLS
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- 2) SELECT abierto a roles autenticados (catálogo público de lectura)
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (true)',
      t || '_select_all', t
    );

    -- 3) Sin policy de mutación: only service_role (que bypasea RLS por default).
  END LOOP;
END$$;
