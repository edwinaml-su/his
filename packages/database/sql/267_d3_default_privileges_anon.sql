-- =============================================================================
-- 267_d3_default_privileges_anon.sql
-- D3 (docs/plan/PLAN-REMEDIACION-2026-09.md, hallazgo de revisión R1C
-- 2026-09-19, ya referenciado como "raíz sistémica" en la cola de sql/261):
-- los default privileges del schema `public` otorgan DML completo
-- (INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) a `anon` en TODA TABLA
-- NUEVA. sql/152 y sql/261 cerraron esto tabla por tabla con REVOKE puntual
-- (13 tablas hoy: 9 de sql/152 + 3 de sql/261 + SsoProviderConfig de sql/258)
-- pero ninguno tocó la RAÍZ (`ALTER DEFAULT PRIVILEGES`), así que cualquier
-- tabla `public` creada desde entonces (o en el futuro) hereda el mismo
-- privilegio excesivo salvo que su propio SQL lo revoque explícito.
--
-- ⚠ NO APLICADO — requiere aprobación de Edwin. NO ejecutar contra prod
-- hasta tener el OK explícito (ver CLAUDE.md §Preferencias del usuario).
--
-- =============================================================================
-- 1) VERIFICACIÓN EN PROD (ejacvsgbewcerxtjtwto, solo lectura, 2026-09-27)
-- =============================================================================
--
-- pg_default_acl por schema (obj_type 'r' = tablas):
--   - `public`  → DOS entradas de owner con default ACL sobre tablas:
--       owner `postgres`       : anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm
--       owner `supabase_admin` : anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm
--     Confirma el hallazgo íntegro: CUALQUIER tabla nueva en `public` creada
--     por cualquiera de esos dos roles hereda DML completo para `anon`.
--   - `ece`     → SOLO `authenticated=arwd/postgres` y `service_role=arwd/postgres`.
--     `anon` NO aparece en el default ACL de `ece`. Nada que hacer aquí.
--   - `audit`   → SIN entradas de default ACL en absoluto (el default de
--     Postgres — sin GRANT — aplica: el owner tiene todo, nadie más nada).
--     Más restrictivo que `public` ya hoy. Nada que hacer aquí.
--   → Alcance real de este archivo: SOLO schema `public`.
--
-- role_table_grants: `anon` tiene privilegios DML sobre 203 de 216 tablas
-- `public` con grants activos (las 13 restantes ya están limpias por
-- sql/152 + sql/258 + sql/261: Encounter, ImagingSlaConfig, LabSlaConfig,
-- Patient, PatientIdentifier, PortalAccount, PortalMagicLink, PortalSession,
-- Session, SsoProviderConfig, TrSlaConfig, User, UserCredential).
--
-- pg_policies: de esas 203, SOLO UNA tiene una policy RLS dirigida
-- explícitamente `TO anon` — `public.surgical_form_submission`
-- (`anon_insert_only`, FOR INSERT). Se trata aparte en §3. El resto de
-- policies de `public`/`ece`/`audit` están definidas `TO public` (cualquier
-- rol, filtradas por predicado de sesión) — ninguna nombra `anon`.
--
-- Roles (pg_roles + pg_auth_members), aplicando como `postgres` (el rol que
-- ejecuta este archivo vía MCP/Supabase SQL Editor — es el mismo
-- "postgres.<ref>" de CLAUDE.md §RLS):
--   anon            rolsuper=false rolbypassrls=false
--   authenticated   rolsuper=false rolbypassrls=false
--   postgres        rolsuper=false rolbypassrls=true   (rol que aplica este SQL)
--   service_role    rolsuper=false rolbypassrls=true
--   supabase_admin  rolsuper=true  rolbypassrls=true
--   pg_auth_members: `postgres` es miembro de {pg_monitor, pg_signal_backend,
--     pg_read_all_data, pg_create_subscription, anon, authenticated,
--     service_role, authenticator, supabase_privileged_role, bi_reader} —
--     **NO** de `supabase_admin`.
--
-- =============================================================================
-- 2) LÍMITE DOCUMENTADO — `supabase_admin` queda FUERA del alcance de este SQL
-- =============================================================================
--
-- `ALTER DEFAULT PRIVILEGES FOR ROLE X` solo lo puede ejecutar X mismo, un
-- miembro de X, o un superusuario. `postgres` no es superusuario (ver arriba)
-- ni es miembro de `supabase_admin` → NO PUEDE alterar el default ACL que
-- `supabase_admin` posee sobre `public`. Este archivo, aplicado como
-- `postgres`, solo puede cerrar `FOR ROLE postgres` (implícito: es el
-- `current_user` al aplicar, y es el owner real de las tablas de aplicación
-- — todo `sql/*.sql` numerado de este repo se ha aplicado como `postgres` vía
-- MCP/SQL Editor, nunca como `supabase_admin`).
--
-- Riesgo residual aceptado y documentado, NO resuelto por este archivo: si
-- algún objeto de `public` llegara a crearse explícitamente como
-- `supabase_admin` (no ocurre en el flujo normal de este proyecto — Supabase
-- Dashboard/SQL Editor conecta como `postgres`), esa tabla heredaría DML
-- para `anon` igual que hoy. Cerrar ese segundo default ACL requeriría una
-- sesión que conecte literalmente como `supabase_admin` (soporte Supabase) o
-- que `postgres` reciba membership de `supabase_admin` — ninguna de las dos
-- está en alcance de D3. @SRE/@Orq deciden si vale la pena perseguirlo.
--
-- =============================================================================
-- 3) `authenticated` — NO SE TOCA (a propósito)
-- =============================================================================
--
-- El mismo default ACL también da DML completo a `authenticated`. Eso es
-- **intencional y necesario**: `withTenantContext` (packages/trpc/src/
-- rls-context.ts) demota la sesión a rol `authenticated` precisamente para
-- que las policies RLS puedan autorizar el DML real (CLAUDE.md §Contrato
-- RLS). Revocar DML de `authenticated` rompería toda la aplicación. Este
-- archivo revoca privilegios de `anon` ÚNICAMENTE — nunca de `authenticated`
-- ni de `service_role`.
--
-- =============================================================================
-- 4) IMPACTO — ¿alguna ruta de la app depende de que `anon` tenga DML?
-- =============================================================================
--
-- Barrido (`grep`) de `apps/web` + `packages` por clientes Supabase con
-- ANON_KEY que hagan `.from(...)`/`.rpc(...)` contra Postgres (no Storage,
-- no `.auth.*`):
--
--   - `apps/web/src/app/api/sync/replay/route.ts` — INSERT en
--     `offline_sync_log`, `MedicationAdministration`, `ClinicalOverride`.
--   - `apps/web/src/app/api/retencion/report.csv/route.ts` — RPC
--     `retencion_proximos_vencer` (solo lectura).
--
-- AMBAS rutas llaman `supabase.auth.getUser()` y devuelven 401 si no hay
-- sesión, ANTES de cualquier `.from()/.rpc()`. En Supabase/PostgREST el rol
-- Postgres efectivo de una request lo decide el claim `role` del JWT de
-- sesión (normalmente `authenticated`), no la apikey usada para construir el
-- cliente — usar `NEXT_PUBLIC_SUPABASE_ANON_KEY` para instanciar
-- `createServerClient` es el patrón oficial `@supabase/ssr` y NO implica que
-- la query corra como `anon` cuando hay cookie de sesión válida. Con sesión
-- válida (el único camino que estas rutas permiten), ambas ejecutan como
-- `authenticated`. Ninguna ruta de la app depende de que `anon` tenga DML.
--
-- El resto de escritura tenant-scoped pasa por tRPC + Prisma +
-- `withTenantContext` (rol `authenticated`) o por `service_role` (edge
-- functions, ej. `notifications-dispatch`) — nunca por `anon` directo.
--
-- Único hallazgo real de uso declarado de `anon`: la policy
-- `anon_insert_only` (FOR INSERT) en `public.surgical_form_submission`. Esa
-- tabla es de **origen desconocido**: 0 filas en prod, sin archivo SQL de
-- creación en el corpus, sin código en `apps/`/`packages/` que la referencie
-- (`docs/45_registro_drift_schema.md` §5.1, ya marcada P2 "investigar antes
-- de decidir drop vs. modelar"). No se asume que es código muerto para
-- decidir un REVOKE de INSERT sobre ella — esa decisión es de
-- docs/45 §7 P2, fuera de alcance de D3. Este archivo SÍ le cierra, por
-- defensa en profundidad, los privilegios que ninguna policy ampara
-- (UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER — no existe policy `anon` para
-- ninguno de esos comandos), preservando el único que sí tiene policy
-- (INSERT). Ver §6.
--
-- Conclusión: es seguro revocar DML/TRUNCATE/REFERENCES/TRIGGER de `anon`
-- tanto a nivel de default privileges (objetos futuros) como en el barrido
-- de tablas existentes (§5), salvo la excepción puntual de §6.
--
-- =============================================================================
-- 5) RAÍZ — ALTER DEFAULT PRIVILEGES para objetos futuros de `public`
-- =============================================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLES
  FROM anon;

-- Idempotente: REVOKE (incluso sobre default privileges) es no-op si el
-- privilegio por defecto ya no está otorgado.

-- =============================================================================
-- 6) BARRIDO de tablas EXISTENTES de `public` con DML heredado a `anon`
-- =============================================================================
--
-- Lista explícita (NO `REVOKE ... ON ALL TABLES IN SCHEMA public`, que
-- barrería a ciegas incluyendo SELECT/tablas fuera de este análisis) — las
-- 203 tablas confirmadas hoy con al menos un privilegio DML/TRUNCATE
-- otorgado a `anon` en `information_schema.role_table_grants`, MENOS
-- `surgical_form_submission` (tratada aparte, preserva INSERT) y las 13 ya
-- remediadas por sql/152 + sql/258 + sql/261 (no necesitan REVOKE de nuevo,
-- pero repetirlo sería no-op inocuo si se agregaran — se dejan fuera por
-- prolijidad, no por riesgo).
--
-- `to_regclass` hace el barrido tolerante a Postgres donde alguna tabla no
-- exista (mismo patrón que sql/261 — un Postgres reconstruido desde cero no
-- tiene por qué tener las 227+ tablas de este proyecto en este punto).

DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'AbacRule', 'Account', 'AccountReceivable', 'AccountingPeriod', 'AgeBand',
    'AgendaExcepcion', 'AgendaHorario', 'AgendaMedico', 'AsignacionTurno',
    'AuditDashboardConfig', 'AuthorizationRequest', 'Bed', 'BedAssignment', 'BiologicalSex',
    'BiomedicalEquipment', 'BloodBank', 'BloodUnit', 'CalibrationLog', 'CareTask',
    'CatalogoInsumo', 'CatalogoMedicamento', 'ClinicalConcept', 'ClinicalConceptMap',
    'ClinicalNote', 'ClinicalNoteAttachment', 'CodeSystem', 'Consultorio',
    'ContratoArrendamiento', 'ContratoCargo', 'ContratoJornada', 'ConvenioHonorario',
    'CostCenter', 'CostCenterAllocationRule', 'CostCenterAllocationTarget', 'Country',
    'CountryCurrency', 'CoverageLetter', 'CoverageRule', 'CrossMatch', 'Currency',
    'DeathCertificate', 'DietPlan', 'DomainEvent', 'Drug', 'DrugClassifier', 'EcePatientMerge',
    'EducationLevel', 'EmergencyNote', 'EmergencyVisit', 'EncounterDiagnosis',
    'EncounterTransfer', 'Establishment', 'Ethnicity', 'ExchangeRate',
    'ExpedienteFormatConfig', 'Gender', 'GeoDivision', 'GsrnHistory', 'GuardianRelationship',
    'HisOperatingCost', 'Holiday', 'Icd10Catalog', 'IdentifierType', 'ImagingFormFieldConfig',
    'ImagingModality', 'ImagingModuleRule', 'ImagingOrder', 'ImagingReport', 'ImagingRequest',
    'ImagingTestAttrs', 'InpatientAdmission', 'InpatientCarePlan', 'InpatientKardex',
    'InpatientVitals', 'InsuranceClaim', 'InsurancePlan', 'InsurancePlanCoverage', 'Insurer',
    'Invoice', 'InvoiceItem', 'InvoicePayment', 'JournalEntry', 'JournalLine', 'LabOrder',
    'LabOrderItem', 'LabOrderItemParameter', 'LabPanel', 'LabReferenceRange', 'LabReflexRule',
    'LabResult', 'LabSampleSubtype', 'LabSampleType', 'LabSpecimen', 'LabTest',
    'LabTestParameter', 'Language', 'Ledger', 'Liquidacion', 'LiquidacionCompensacion',
    'ListaEspera', 'MaritalStatus', 'MedicalGasUsage', 'MedicalSpecialty',
    'MedicationAdministration', 'MedicationDispense', 'MedicationGtin', 'MedicoAfiliado',
    'MedicoAfiliadoEspecialidad', 'Notification', 'NpsResponse', 'NutritionAssessment',
    'NutritionOrder', 'Occupation', 'OdooSyncLog', 'OdooSyncMapping', 'OperatingRoom',
    'Organization', 'OutpatientAppointment', 'OutpatientConsultation',
    'PathologyMacroDescription', 'PathologyMicroDescription', 'PathologyOrder',
    'PathologyReport', 'PathologySpecimen', 'PatientAccount', 'PatientAccountService',
    'PatientAddress', 'PatientAllergy', 'PatientCategory', 'PatientConsent', 'PatientCoverage',
    'PatientCoverageOverride', 'PatientEmail', 'PatientEmergencyContact', 'PatientEthnicity',
    'PatientLanguage', 'PatientMerge', 'PatientPhone', 'PatientReligion', 'PatientType',
    'PatientVaccination', 'PerformanceSample', 'Permission', 'PharmacyCart',
    'PharmacyCartItem', 'PharmacyOrder', 'PharmacyReservation', 'PharmacySubstitution',
    'PlantillaTurno', 'PmSchedule', 'Prescription', 'PrescriptionItem', 'ProduccionMedica',
    'ProgramacionTurno', 'RateLimitHit', 'ReglaHonorario', 'Religion', 'RespiratoryOrder',
    'RespiratoryOrderItem', 'Role', 'RoleCodeAlias', 'RoleNotificationDefault',
    'RolePermission', 'Room', 'ServiceCategory', 'ServicePriceList', 'ServicePriceListItem',
    'ServicePriceRule', 'ServiceUnit', 'SrsFabricante', 'SrsFormaFarmaceutica',
    'SrsPresentacion', 'SrsPrincipioActivo', 'SrsRegistroCache', 'StaffGsrn', 'StockItem',
    'StockLot', 'StockMovement', 'SurgeryCase', 'TipoCuenta', 'TrMedicamentoInhalado',
    'TrProcedimiento', 'Transfusion', 'TransfusionRequest', 'TriageDiscriminator',
    'TriageDiscriminatorHit', 'TriageEvaluation', 'TriageFlowchart',
    'TriageFlowchartVitalSign', 'TriageLevel', 'TriageVitalSign', 'UserExternalIdentity',
    'UserNotificationPreference', 'UserOrganizationRole', 'UserServiceUnitAssignment',
    'Vaccine', 'VentilatorSession', 'WorkflowTaskAction', 'chat_knowledge_chunk',
    'chat_message', 'chat_session', 'offline_sync_log'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM anon',
        t
      );
    END IF;
  END LOOP;
END;
$$;

-- =============================================================================
-- 7) Excepción puntual — `surgical_form_submission` conserva INSERT
-- =============================================================================
--
-- Única tabla con policy RLS dirigida explícitamente `TO anon`
-- (`anon_insert_only`, FOR INSERT). Se preserva ese privilegio intacto — no
-- es este SQL (alcance: default privileges + higiene de grants excedentes)
-- el que decide si esa tabla/policy sigue siendo necesaria; esa decisión es
-- de docs/45_registro_drift_schema.md §7 P2. Se revoca únicamente lo que
-- NINGUNA policy ampara hoy (no existe policy `anon` para UPDATE, DELETE,
-- TRUNCATE, ni motivo para REFERENCES/TRIGGER).

DO $$
BEGIN
  IF to_regclass('public.surgical_form_submission') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.surgical_form_submission FROM anon';
  END IF;
END;
$$;

-- =============================================================================
-- 8) Verificación post-aplicación esperada
-- =============================================================================
--
-- a) Default privileges de `postgres` en `public` ya no incluyen DML para
--    `anon` en tablas futuras (la entrada de `supabase_admin` persiste — ver
--    §2, es el límite documentado, no un error de esta verificación):
--
--      SELECT d.defaclacl
--      FROM pg_default_acl d
--      JOIN pg_namespace n ON n.oid = d.defaclnamespace
--      WHERE n.nspname = 'public'
--        AND d.defaclobjtype = 'r'
--        AND d.defaclrole::regrole::text = 'postgres';
--      -- → el elemento "anon=..." del arreglo ya no contiene a/w/d/D/x/t
--      --   (puede seguir apareciendo con solo r/U si tenía SELECT/USAGE)
--
-- b) Cero grants DML/TRUNCATE/REFERENCES/TRIGGER de `anon` en `public`,
--    excepto INSERT en `surgical_form_submission`:
--
--      SELECT table_name, privilege_type
--      FROM information_schema.role_table_grants
--      WHERE grantee = 'anon'
--        AND table_schema = 'public'
--        AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
--        AND NOT (table_name = 'surgical_form_submission' AND privilege_type = 'INSERT');
--      -- → 0 filas
--
-- c) Una tabla `public` creada DESPUÉS de este archivo (por `postgres`) no
--    hereda DML para `anon`:
--
--      SELECT has_table_privilege('anon', '<tabla_nueva>', 'INSERT');  -- → false
--      SELECT has_table_privilege('anon', '<tabla_nueva>', 'UPDATE');  -- → false
--
-- =============================================================================
