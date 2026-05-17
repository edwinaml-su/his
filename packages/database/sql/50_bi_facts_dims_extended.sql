-- =============================================================================
-- SQL 50 — BI Facts + Dims Extended (Beta.19b)
-- Wave: Beta.19b — Fase 6 TDR §26-27
-- Owner: @BID — BI Developer
-- Dependencias: SQL 48 (schema analytics, dim_date, dim_org, dim_estab),
--               SQL 49 (RLS helpers, bi_reader, set_bi_context, DEFAULT PRIVILEGES)
-- Siguiente: SQL 51 (pg_cron refresh jobs + bi_refresh_log)
-- ADR base: ADR 0009 — BI Medallion Architecture
-- =============================================================================
-- NOTAS DE MODELADO:
--   - "PascalCase" y "camelCase" reflejan las tablas Prisma en public schema.
--   - Surrogate keys via ROW_NUMBER() OVER (ORDER BY id) para REFRESH CONCURRENTLY.
--   - FK entre analytics son logicas (sin FOREIGN KEY constraint) para evitar
--     bloqueos en REFRESH CONCURRENTLY paralelo.
--   - PHI redactada en dims: dim_patient solo expone age_band + biological_sex.
--   - Toda matview con organization_id recibe RLS. dim_date no tiene org_id,
--     no recibe RLS (ya resuelto en SQL 49).
-- =============================================================================

-- =============================================================================
-- SECCION 1 — dim_patient (SCD Tipo 2)
-- Grain: una version de datos demograficos de un paciente.
-- Fuente: public."Patient" JOIN public."BiologicalSex"
-- SCD Tipo 2: valid_from / valid_to / is_current
-- Refresh: cada 1h (pg_cron en SQL 51)
-- PHI REDACTADA: sin nombre, sin documento, sin fecha exacta de nacimiento.
-- Solo age_band (banda quinquenal) y biological_sex.
-- =============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.dim_patient AS
SELECT
  ROW_NUMBER() OVER (ORDER BY p."id")              AS patient_sk,
  p."id"                                           AS patient_id,
  p."organizationId"                               AS organization_id,
  -- age_band calculado desde birthDate (PHI: solo banda, no fecha exacta)
  CASE
    WHEN p."birthDate" IS NULL               THEN 'UNKNOWN'
    WHEN DATE_PART('year', AGE(CURRENT_DATE, p."birthDate"::DATE)) < 5  THEN '0-4'
    WHEN DATE_PART('year', AGE(CURRENT_DATE, p."birthDate"::DATE)) < 15 THEN '5-14'
    WHEN DATE_PART('year', AGE(CURRENT_DATE, p."birthDate"::DATE)) < 45 THEN '15-44'
    WHEN DATE_PART('year', AGE(CURRENT_DATE, p."birthDate"::DATE)) < 65 THEN '45-64'
    ELSE '65+'
  END                                              AS age_band,
  -- biological_sex: codigo de catalogo (M/F/INTERSEX/UNKNOWN)
  COALESCE(bs."code", 'UNKNOWN')                   AS biological_sex,
  -- SCD Tipo 2: en una matview no podemos hacer diffs de versiones reales;
  -- valid_from = updatedAt snapshotted en el momento del REFRESH.
  -- Beta.19b con dbt snapshot manejara versiones historicas reales.
  p."updatedAt"::DATE                              AS valid_from,
  NULL::DATE                                       AS valid_to,      -- NULL = version actual
  TRUE                                             AS is_current,
  -- Para trazabilidad: indicador si el paciente esta activo en OLTP
  p."active"                                       AS is_active
FROM public."Patient" p
LEFT JOIN public."BiologicalSex" bs ON bs."id" = p."biologicalSexId"
WHERE p."deletedAt" IS NULL
WITH DATA;

-- Unique index requerido para REFRESH CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS dim_patient_sk_idx
  ON analytics.dim_patient (patient_sk);

CREATE INDEX IF NOT EXISTS dim_patient_patient_id_idx
  ON analytics.dim_patient (patient_id);

CREATE INDEX IF NOT EXISTS dim_patient_org_id_idx
  ON analytics.dim_patient (organization_id);

COMMENT ON MATERIALIZED VIEW analytics.dim_patient IS
  'SCD Tipo 2 (snapshot simplificado). Refresh cada 1h.
   PHI redactada: sin nombre, documento ni fecha exacta de nacimiento.
   Beta.19b: dbt snapshot dim_patient_snapshot.sql gestiona versiones historicas.
   REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_patient;';

-- RLS en dim_patient
ALTER TABLE analytics.dim_patient ENABLE ROW LEVEL SECURITY;

CREATE POLICY bi_reader_patient_isolation ON analytics.dim_patient
  AS PERMISSIVE
  FOR SELECT
  TO bi_reader
  USING (organization_id = analytics.current_bi_org_id());

CREATE POLICY authenticated_patient_isolation ON analytics.dim_patient
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (organization_id = analytics.current_bi_org_id());

-- =============================================================================
-- SECCION 2 — dim_diagnosis (SCD Tipo 1)
-- Grain: un codigo diagnostico del catalogo CIE-10/SNOMED.
-- Fuente: public."ClinicalConcept" JOIN public."CodeSystem"
-- SCD Tipo 1: REFRESH sobreescribe.
-- Refresh: cada 24h (pg_cron en SQL 51)
-- =============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.dim_diagnosis AS
SELECT
  ROW_NUMBER() OVER (ORDER BY cc."id")             AS diag_sk,
  cc."id"                                          AS concept_id,
  cc."code"                                        AS code,
  cc."display"                                     AS display,
  cs."name"                                        AS code_system,
  cs."version"                                     AS code_system_version,
  -- chapter_code: primera letra del codigo CIE-10 (A-Z)
  UPPER(LEFT(cc."code", 1))                        AS chapter_code,
  -- chapter_name_es: lookup estatico de capitulos CIE-10
  CASE UPPER(LEFT(cc."code", 1))
    WHEN 'A' THEN 'Enfermedades infecciosas y parasitarias'
    WHEN 'B' THEN 'Enfermedades infecciosas y parasitarias'
    WHEN 'C' THEN 'Tumores'
    WHEN 'D' THEN 'Enfermedades de la sangre y tumores in situ'
    WHEN 'E' THEN 'Enfermedades endocrinas y metabolicas'
    WHEN 'F' THEN 'Trastornos mentales y del comportamiento'
    WHEN 'G' THEN 'Enfermedades del sistema nervioso'
    WHEN 'H' THEN 'Enfermedades del ojo y del oido'
    WHEN 'I' THEN 'Enfermedades del sistema circulatorio'
    WHEN 'J' THEN 'Enfermedades del sistema respiratorio'
    WHEN 'K' THEN 'Enfermedades del sistema digestivo'
    WHEN 'L' THEN 'Enfermedades de la piel'
    WHEN 'M' THEN 'Enfermedades del sistema osteomuscular'
    WHEN 'N' THEN 'Enfermedades del sistema genitourinario'
    WHEN 'O' THEN 'Embarazo, parto y puerperio'
    WHEN 'P' THEN 'Afecciones del periodo perinatal'
    WHEN 'Q' THEN 'Malformaciones congenitas'
    WHEN 'R' THEN 'Sintomas y signos no clasificados'
    WHEN 'S' THEN 'Traumatismos y envenenamientos'
    WHEN 'T' THEN 'Otras causas externas'
    WHEN 'U' THEN 'Codigos de uso especial (COVID-19, etc.)'
    WHEN 'V' THEN 'Causas externas de morbilidad'
    WHEN 'W' THEN 'Causas externas de morbilidad'
    WHEN 'X' THEN 'Causas externas de morbilidad'
    WHEN 'Y' THEN 'Causas externas de morbilidad'
    WHEN 'Z' THEN 'Factores que influyen en el estado de salud'
    ELSE 'Otro sistema de codificacion'
  END                                              AS chapter_name_es,
  cc."active"                                      AS is_active
FROM public."ClinicalConcept" cc
JOIN public."CodeSystem" cs ON cs."id" = cc."codeSystemId"
WHERE cc."active" = TRUE
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS dim_diagnosis_sk_idx
  ON analytics.dim_diagnosis (diag_sk);

CREATE INDEX IF NOT EXISTS dim_diagnosis_concept_id_idx
  ON analytics.dim_diagnosis (concept_id);

CREATE INDEX IF NOT EXISTS dim_diagnosis_code_idx
  ON analytics.dim_diagnosis (code);

COMMENT ON MATERIALIZED VIEW analytics.dim_diagnosis IS
  'SCD Tipo 1. Catalogo CIE-10/SNOMED. Refresh cada 24h.
   chapter_name_es lookup estatico CIE-10. Actualizar si se agrega nuevo sistema.
   REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_diagnosis;';

-- dim_diagnosis no tiene organization_id (catalogo global); sin RLS de org.
-- bi_reader puede leer todo el catalogo — los hechos restringen por org.
GRANT SELECT ON analytics.dim_diagnosis TO bi_reader;
GRANT SELECT ON analytics.dim_diagnosis TO authenticated;

-- =============================================================================
-- SECCION 3 — dim_drug (SCD Tipo 1)
-- Grain: un producto farmaceutico (Drug en OLTP).
-- Fuente: public."Drug"
-- SCD Tipo 1: REFRESH sobreescribe.
-- Refresh: cada 24h
-- Nota: Drug.organizationId puede ser NULL (catalogo global).
-- =============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.dim_drug AS
SELECT
  ROW_NUMBER() OVER (ORDER BY d."id")              AS drug_sk,
  d."id"                                           AS drug_product_id,
  d."organizationId"                               AS organization_id,  -- NULL = catalogo global
  d."genericName"                                  AS generic_name,
  d."atcCode"                                      AS atc_code,
  -- atc_level1_name: lookup nivel 1 ATC (primera letra)
  CASE LEFT(COALESCE(d."atcCode", '?'), 1)
    WHEN 'A' THEN 'Aparato digestivo y metabolismo'
    WHEN 'B' THEN 'Sangre y organos hematopoyeticos'
    WHEN 'C' THEN 'Sistema cardiovascular'
    WHEN 'D' THEN 'Dermatologicos'
    WHEN 'G' THEN 'Sistema genitourinario y hormonas sexuales'
    WHEN 'H' THEN 'Preparados hormonales sistemicos'
    WHEN 'J' THEN 'Antiinfecciosos de uso sistemico'
    WHEN 'L' THEN 'Agentes antineoplasicos e inmunomoduladores'
    WHEN 'M' THEN 'Sistema musculoesqueletico'
    WHEN 'N' THEN 'Sistema nervioso'
    WHEN 'P' THEN 'Antiparasitarios, insecticidas y repelentes'
    WHEN 'R' THEN 'Sistema respiratorio'
    WHEN 'S' THEN 'Organos de los sentidos'
    WHEN 'V' THEN 'Varios'
    ELSE 'Sin clasificacion ATC'
  END                                              AS atc_level1_name,
  -- dosage_form derivado de pharmaceuticalForm enum
  d."pharmaceuticalForm"::TEXT                     AS dosage_form,
  -- strength: combina valor + unidad
  CONCAT(d."strengthValue"::TEXT, ' ', d."strengthUnit") AS strength,
  -- is_controlled: Drug.requiresControlledLog
  d."requiresControlledLog"                        AS is_controlled,
  d."active"                                       AS is_active
FROM public."Drug" d
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS dim_drug_sk_idx
  ON analytics.dim_drug (drug_sk);

CREATE INDEX IF NOT EXISTS dim_drug_product_id_idx
  ON analytics.dim_drug (drug_product_id);

CREATE INDEX IF NOT EXISTS dim_drug_org_id_idx
  ON analytics.dim_drug (organization_id);

COMMENT ON MATERIALIZED VIEW analytics.dim_drug IS
  'SCD Tipo 1. Catalogo de farmacos (Drug OLTP). Refresh cada 24h.
   organization_id NULL = catalogo global compartido.
   REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_drug;';

-- dim_drug: RLS por organization_id cuando no es NULL
-- (farmacologicos globales son visibles a todos, los propios solo a su org)
ALTER TABLE analytics.dim_drug ENABLE ROW LEVEL SECURITY;

CREATE POLICY bi_reader_drug_isolation ON analytics.dim_drug
  AS PERMISSIVE
  FOR SELECT
  TO bi_reader
  USING (
    organization_id IS NULL
    OR organization_id = analytics.current_bi_org_id()
  );

CREATE POLICY authenticated_drug_isolation ON analytics.dim_drug
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    organization_id IS NULL
    OR organization_id = analytics.current_bi_org_id()
  );

-- =============================================================================
-- SECCION 4 — dim_user_role (SCD Tipo 1)
-- Grain: un par (usuario, rol) activo por organizacion.
-- Fuente: public."UserOrganizationRole" JOIN public."Role" JOIN public."User"
-- SCD Tipo 1: historico de cambios en audit_log OLTP.
-- Refresh: cada 1h (rol actual cambia por asignaciones)
-- =============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.dim_user_role AS
SELECT
  ROW_NUMBER() OVER (ORDER BY uor."id")            AS user_role_sk,
  uor."userId"                                     AS user_id,
  uor."organizationId"                             AS organization_id,
  r."code"                                         AS role_code,
  r."name"                                         AS role_display,
  -- professional_category: agrupacion de negocio derivada del codigo de rol
  CASE
    WHEN UPPER(r."code") LIKE '%PHYSICIAN%'
      OR UPPER(r."code") LIKE '%DOCTOR%'
      OR UPPER(r."code") LIKE '%MEDIC%'   THEN 'PHYSICIAN'
    WHEN UPPER(r."code") LIKE '%NURSE%'
      OR UPPER(r."code") LIKE '%ENFERM%'  THEN 'NURSE'
    WHEN UPPER(r."code") LIKE '%ADMIN%'
      OR UPPER(r."code") LIKE '%MANAGER%' THEN 'ADMIN'
    ELSE 'OTHER'
  END                                              AS professional_category,
  -- is_active: rol vigente si validTo es NULL o futuro
  (uor."validTo" IS NULL OR uor."validTo" > NOW()) AS is_active
FROM public."UserOrganizationRole" uor
JOIN public."Role" r ON r."id" = uor."roleId"
JOIN public."User" u ON u."id" = uor."userId"
WHERE u."active" = TRUE
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS dim_user_role_sk_idx
  ON analytics.dim_user_role (user_role_sk);

CREATE INDEX IF NOT EXISTS dim_user_role_user_id_idx
  ON analytics.dim_user_role (user_id);

CREATE INDEX IF NOT EXISTS dim_user_role_org_id_idx
  ON analytics.dim_user_role (organization_id);

COMMENT ON MATERIALIZED VIEW analytics.dim_user_role IS
  'SCD Tipo 1. Rol actual del usuario por org. Refresh cada 1h.
   Historico de cambios de rol disponible en audit.audit_log OLTP.
   REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_user_role;';

ALTER TABLE analytics.dim_user_role ENABLE ROW LEVEL SECURITY;

CREATE POLICY bi_reader_user_role_isolation ON analytics.dim_user_role
  AS PERMISSIVE
  FOR SELECT
  TO bi_reader
  USING (organization_id = analytics.current_bi_org_id());

CREATE POLICY authenticated_user_role_isolation ON analytics.dim_user_role
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (organization_id = analytics.current_bi_org_id());

-- =============================================================================
-- SECCION 5 — fact_encounter
-- Grain: un encuentro clinico (admision o visita ambulatoria/emergencia).
-- Fuente: public."Encounter" LEFT JOIN public."TriageEvaluation"
-- KPIs: M-CLI-01 (censo), M-CLI-02 (LOS), M-CLI-03/04 (triage cycle time)
-- Refresh: cada 1h
-- =============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.fact_encounter AS
SELECT
  ROW_NUMBER() OVER (ORDER BY e."id")              AS encounter_sk,
  e."id"                                           AS encounter_id,
  e."organizationId"                               AS organization_id,
  -- FK logica a dim_patient (patient_sk del snapshot mas reciente is_current)
  dp.patient_sk,
  -- FK logica a dim_organization
  dorg.org_sk,
  -- FK logica a dim_establishment
  de.estab_sk,
  -- FK a dim_date para admission date
  COALESCE(
    TO_CHAR(e."admittedAt"::DATE, 'YYYYMMDD')::INTEGER,
    20200101
  )                                                AS admitted_date_sk,
  -- FK a dim_date para discharge date (NULL si activo)
  CASE
    WHEN e."dischargedAt" IS NOT NULL
    THEN TO_CHAR(e."dischargedAt"::DATE, 'YYYYMMDD')::INTEGER
    ELSE NULL
  END                                              AS discharged_date_sk,
  e."admissionType"::TEXT                          AS admission_type,
  -- triage: nivel y color del primer triage asociado al encuentro
  triage_agg.triage_level,
  triage_agg.triage_color,
  -- LOS en horas (NULL si encuentro aun activo)
  CASE
    WHEN e."dischargedAt" IS NOT NULL
    THEN ROUND(
      EXTRACT(EPOCH FROM (e."dischargedAt" - e."admittedAt")) / 3600.0,
      2
    )::NUMERIC(8,2)
    ELSE NULL
  END                                              AS los_hours,
  -- is_active: sin fecha de alta
  (e."dischargedAt" IS NULL)                       AS is_active,
  -- discharge_reason derivado de dischargeType enum
  COALESCE(e."dischargeType"::TEXT, 'ACTIVO')      AS discharge_reason,
  -- insurance_type: simplificado desde PatientCoverage (JOIN costoso; placeholder)
  'UNKNOWN'::VARCHAR(30)                           AS insurance_type,
  -- diagnostico principal al alta (FK logica a dim_diagnosis)
  dd_primary.diag_sk                               AS primary_diag_sk,
  NOW()                                            AS loaded_at
FROM public."Encounter" e
-- dim_patient: join al snapshot actual del paciente
LEFT JOIN analytics.dim_patient dp
  ON dp.patient_id = e."patientId"
  AND dp.is_current = TRUE
-- dim_organization
LEFT JOIN analytics.dim_organization dorg
  ON dorg.organization_id = e."organizationId"
-- dim_establishment
LEFT JOIN analytics.dim_establishment de
  ON de.establishment_id = e."establishmentId"
-- diagnostico principal: ClinicalConcept del primaryDiagnosisId
LEFT JOIN analytics.dim_diagnosis dd_primary
  ON dd_primary.concept_id = e."primaryDiagnosisId"
-- triage: primer triage completado del encuentro
LEFT JOIN LATERAL (
  SELECT
    te."assignedLevelId"::TEXT   AS triage_level,
    -- triage_color derivado del nombre del nivel (manchester: RED/ORANGE/YELLOW/GREEN/BLUE)
    CASE UPPER(tl."name")
      WHEN 'ROJO'     THEN 'RED'
      WHEN 'NARANJA'  THEN 'ORANGE'
      WHEN 'AMARILLO' THEN 'YELLOW'
      WHEN 'VERDE'    THEN 'GREEN'
      WHEN 'AZUL'     THEN 'BLUE'
      ELSE 'UNKNOWN'
    END                          AS triage_color
  FROM public."TriageEvaluation" te
  JOIN public."TriageLevel" tl ON tl."id" = te."assignedLevelId"
  WHERE te."encounterId" = e."id"
    AND te."status" = 'COMPLETED'
  ORDER BY te."completedAt" ASC
  LIMIT 1
) triage_agg ON TRUE
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS fact_encounter_sk_idx
  ON analytics.fact_encounter (encounter_sk);

CREATE INDEX IF NOT EXISTS fact_encounter_encounter_id_idx
  ON analytics.fact_encounter (encounter_id);

CREATE INDEX IF NOT EXISTS fact_encounter_org_id_idx
  ON analytics.fact_encounter (organization_id);

CREATE INDEX IF NOT EXISTS fact_encounter_admitted_date_sk_idx
  ON analytics.fact_encounter (admitted_date_sk);

CREATE INDEX IF NOT EXISTS fact_encounter_patient_sk_idx
  ON analytics.fact_encounter (patient_sk);

COMMENT ON MATERIALIZED VIEW analytics.fact_encounter IS
  'Grain: un encuentro clinico. Refresh cada 1h.
   KPIs: M-CLI-01 censo, M-CLI-02 LOS, M-CLI-03/04 triage cycle time.
   insurance_type: placeholder; Beta.19c join a PatientCoverage.
   REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.fact_encounter;';

ALTER TABLE analytics.fact_encounter ENABLE ROW LEVEL SECURITY;

CREATE POLICY bi_reader_encounter_isolation ON analytics.fact_encounter
  AS PERMISSIVE
  FOR SELECT
  TO bi_reader
  USING (organization_id = analytics.current_bi_org_id());

CREATE POLICY authenticated_encounter_isolation ON analytics.fact_encounter
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (organization_id = analytics.current_bi_org_id());

-- =============================================================================
-- SECCION 6 — fact_lab_result
-- Grain: un resultado de laboratorio liberado (validado).
-- Fuente: public."LabResult" JOIN "LabOrderItem" JOIN "LabOrder" JOIN "LabTest"
-- KPIs: M-CLI-07 Lab TAT p95, M-CLI-08 Critical value ACK time p95
-- Refresh: cada 1h
-- =============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.fact_lab_result AS
SELECT
  ROW_NUMBER() OVER (ORDER BY lr."id")             AS lab_result_sk,
  lr."id"                                          AS lab_result_id,
  lo."organizationId"                              AS organization_id,
  -- FK logica a fact_encounter
  fe.encounter_sk,
  -- FK a dim_date para fecha de orden
  COALESCE(
    TO_CHAR(lo."orderedAt"::DATE, 'YYYYMMDD')::INTEGER,
    20200101
  )                                                AS ordered_date_sk,
  -- FK a dim_date para fecha de resultado
  COALESCE(
    TO_CHAR(lr."resultedAt"::DATE, 'YYYYMMDD')::INTEGER,
    20200101
  )                                                AS resulted_date_sk,
  -- TAT: tiempo desde orden hasta resultado validado, en horas
  CASE
    WHEN lr."validatedAt" IS NOT NULL
    THEN ROUND(
      EXTRACT(EPOCH FROM (lr."validatedAt" - lo."orderedAt")) / 3600.0,
      2
    )::NUMERIC(8,2)
    ELSE ROUND(
      EXTRACT(EPOCH FROM (lr."resultedAt" - lo."orderedAt")) / 3600.0,
      2
    )::NUMERIC(8,2)
  END                                              AS order_to_result_hours,
  -- is_critical: flag del LabTest o si flag = CRITICAL
  (lr."flag" = 'CRITICAL' OR lt."critical" = TRUE)  AS is_critical,
  -- critical_ack_minutes: placeholder (Beta.19c: join a tabla de ACKs si existe)
  NULL::NUMERIC(8,2)                               AS critical_ack_minutes,
  -- LOINC code del test
  lt."code"                                        AS test_loinc_code,
  -- result_status derivado de validatedAt
  CASE
    WHEN lr."validatedAt" IS NOT NULL THEN 'FINAL'
    ELSE 'PRELIMINARY'
  END                                              AS result_status,
  NOW()                                            AS loaded_at
FROM public."LabResult" lr
JOIN public."LabOrderItem" loi ON loi."id" = lr."orderItemId"
JOIN public."LabOrder" lo      ON lo."id"  = loi."orderId"
JOIN public."LabTest" lt       ON lt."id"  = loi."testId"
-- FK logica a fact_encounter via encounter del lab order
LEFT JOIN analytics.fact_encounter fe
  ON fe.encounter_id = lo."encounterId"
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS fact_lab_result_sk_idx
  ON analytics.fact_lab_result (lab_result_sk);

CREATE INDEX IF NOT EXISTS fact_lab_result_lab_result_id_idx
  ON analytics.fact_lab_result (lab_result_id);

CREATE INDEX IF NOT EXISTS fact_lab_result_org_id_idx
  ON analytics.fact_lab_result (organization_id);

CREATE INDEX IF NOT EXISTS fact_lab_result_ordered_date_sk_idx
  ON analytics.fact_lab_result (ordered_date_sk);

COMMENT ON MATERIALIZED VIEW analytics.fact_lab_result IS
  'Grain: un resultado de lab liberado. Refresh cada 1h.
   KPIs: M-CLI-07 Lab TAT p95, M-CLI-08 Critical ACK time p95.
   critical_ack_minutes placeholder; Beta.19c completar con tabla de ACKs.
   REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.fact_lab_result;';

ALTER TABLE analytics.fact_lab_result ENABLE ROW LEVEL SECURITY;

CREATE POLICY bi_reader_lab_result_isolation ON analytics.fact_lab_result
  AS PERMISSIVE
  FOR SELECT
  TO bi_reader
  USING (organization_id = analytics.current_bi_org_id());

CREATE POLICY authenticated_lab_result_isolation ON analytics.fact_lab_result
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (organization_id = analytics.current_bi_org_id());

-- =============================================================================
-- SECCION 7 — fact_prescription
-- Grain: una linea de prescripcion (PrescriptionItem).
-- Fuente: "PrescriptionItem" JOIN "Prescription" JOIN "Drug" JOIN "MedicationDispense"
-- KPIs: M-CLI-06 Prescription compliance
-- Refresh: cada 1h
-- =============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.fact_prescription AS
SELECT
  ROW_NUMBER() OVER (ORDER BY pi."id")             AS prescription_sk,
  pi."id"                                          AS prescription_id,
  px."organizationId"                              AS organization_id,
  -- FK logica a fact_encounter
  fe.encounter_sk,
  -- FK logica a dim_drug
  dd.drug_sk,
  -- FK a dim_date
  COALESCE(
    TO_CHAR(px."prescribedAt"::DATE, 'YYYYMMDD')::INTEGER,
    20200101
  )                                                AS prescribed_date_sk,
  -- FK logica a dim_user_role (prescriptor)
  dur.user_role_sk                                 AS prescribed_by_sk,
  -- cantidades
  pi."prescribedQty"                               AS qty_prescribed,
  pi."administeredQty"                             AS qty_administered,
  -- compliance: (administeredQty / prescribedQty) * 100
  CASE
    WHEN pi."prescribedQty" > 0
    THEN ROUND((pi."administeredQty" / pi."prescribedQty" * 100)::NUMERIC, 2)
    ELSE NULL
  END                                              AS compliance_pct,
  -- is_dispensed: existe al menos una dispensacion para este item
  (disp_agg.dispense_count > 0)                   AS is_dispensed,
  -- is_controlled: copia de Drug.requiresControlledLog
  d."requiresControlledLog"                        AS is_controlled,
  NOW()                                            AS loaded_at
FROM public."PrescriptionItem" pi
JOIN public."Prescription" px ON px."id" = pi."prescriptionId"
JOIN public."Drug" d          ON d."id"  = pi."drugId"
-- FK logica a fact_encounter
LEFT JOIN analytics.fact_encounter fe
  ON fe.encounter_id = px."encounterId"
-- FK logica a dim_drug
LEFT JOIN analytics.dim_drug dd
  ON dd.drug_product_id = pi."drugId"
-- FK logica a dim_user_role del prescriptor
LEFT JOIN analytics.dim_user_role dur
  ON dur.user_id = px."prescriberId"
  AND dur.organization_id = px."organizationId"
  AND dur.is_active = TRUE
-- count de dispensaciones (is_dispensed)
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS dispense_count
  FROM public."MedicationDispense" md
  WHERE md."prescriptionItemId" = pi."id"
) disp_agg ON TRUE
WHERE px."status" IN ('SIGNED', 'DISPENSED', 'ADMINISTERED', 'COMPLETED')
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS fact_prescription_sk_idx
  ON analytics.fact_prescription (prescription_sk);

CREATE INDEX IF NOT EXISTS fact_prescription_id_idx
  ON analytics.fact_prescription (prescription_id);

CREATE INDEX IF NOT EXISTS fact_prescription_org_id_idx
  ON analytics.fact_prescription (organization_id);

CREATE INDEX IF NOT EXISTS fact_prescription_date_sk_idx
  ON analytics.fact_prescription (prescribed_date_sk);

COMMENT ON MATERIALIZED VIEW analytics.fact_prescription IS
  'Grain: una linea de prescripcion (PrescriptionItem). Refresh cada 1h.
   KPIs: M-CLI-06 Prescription compliance.
   Solo incluye prescripciones SIGNED/DISPENSED/ADMINISTERED/COMPLETED.
   REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.fact_prescription;';

ALTER TABLE analytics.fact_prescription ENABLE ROW LEVEL SECURITY;

CREATE POLICY bi_reader_prescription_isolation ON analytics.fact_prescription
  AS PERMISSIVE
  FOR SELECT
  TO bi_reader
  USING (organization_id = analytics.current_bi_org_id());

CREATE POLICY authenticated_prescription_isolation ON analytics.fact_prescription
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (organization_id = analytics.current_bi_org_id());

-- =============================================================================
-- SECCION 8 — fact_transfusion
-- Grain: una unidad de sangre transfundida (Transfusion OLTP).
-- Fuente: "Transfusion" JOIN "BloodUnit" JOIN "TransfusionRequest"
-- KPIs: seguridad transfusional, hemovigilancia MINSAL
-- Refresh: cada 1h
-- =============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.fact_transfusion AS
SELECT
  ROW_NUMBER() OVER (ORDER BY t."id")              AS transfusion_sk,
  t."id"                                           AS transfusion_id,
  t."organizationId"                               AS organization_id,
  -- FK logica a fact_encounter
  fe.encounter_sk,
  -- FK a dim_date para fecha de transfusion
  COALESCE(
    TO_CHAR(t."startedAt"::DATE, 'YYYYMMDD')::INTEGER,
    20200101
  )                                                AS transfused_date_sk,
  -- blood_product_type del componente de la unidad transfundida
  bu."component"::TEXT                             AS blood_product_type,
  -- abo_group del tipo sanguineo de la unidad
  bu."bloodType"::TEXT                             AS abo_group,
  -- rh_factor
  bu."rhFactor"::TEXT                              AS rh_factor,
  -- volume_ml de la unidad (puede ser NULL en BloodUnit)
  bu."volume"::NUMERIC(8,2)                        AS volume_ml,
  -- had_reaction: adverseReactions JSONB no vacio
  (
    t."adverseReactions" IS NOT NULL
    AND t."adverseReactions" != 'null'::JSONB
    AND t."adverseReactions" != '{}'::JSONB
    AND t."adverseReactions" != '[]'::JSONB
  )                                                AS had_reaction,
  -- reaction_type: primera clave del JSON de reacciones (simplificado)
  CASE
    WHEN t."adverseReactions" IS NOT NULL
      AND t."adverseReactions" != 'null'::JSONB
      AND t."adverseReactions" != '{}'::JSONB
      AND t."adverseReactions" != '[]'::JSONB
    THEN t."adverseReactions"->>0
    ELSE NULL
  END                                              AS reaction_type,
  NOW()                                            AS loaded_at
FROM public."Transfusion" t
JOIN public."BloodUnit" bu ON bu."id" = t."unitId"
-- FK logica a fact_encounter
LEFT JOIN analytics.fact_encounter fe
  ON fe.encounter_id = t."encounterId"
WHERE t."status" IN ('COMPLETED', 'ABORTED')
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS fact_transfusion_sk_idx
  ON analytics.fact_transfusion (transfusion_sk);

CREATE INDEX IF NOT EXISTS fact_transfusion_id_idx
  ON analytics.fact_transfusion (transfusion_id);

CREATE INDEX IF NOT EXISTS fact_transfusion_org_id_idx
  ON analytics.fact_transfusion (organization_id);

CREATE INDEX IF NOT EXISTS fact_transfusion_date_sk_idx
  ON analytics.fact_transfusion (transfused_date_sk);

COMMENT ON MATERIALIZED VIEW analytics.fact_transfusion IS
  'Grain: una unidad de sangre transfundida (COMPLETED o ABORTED). Refresh cada 1h.
   KPIs: seguridad transfusional, hemovigilancia MINSAL.
   reaction_type simplificado; extender con ontologia de reacciones en Beta.19c.
   REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.fact_transfusion;';

ALTER TABLE analytics.fact_transfusion ENABLE ROW LEVEL SECURITY;

CREATE POLICY bi_reader_transfusion_isolation ON analytics.fact_transfusion
  AS PERMISSIVE
  FOR SELECT
  TO bi_reader
  USING (organization_id = analytics.current_bi_org_id());

CREATE POLICY authenticated_transfusion_isolation ON analytics.fact_transfusion
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (organization_id = analytics.current_bi_org_id());

-- =============================================================================
-- SECCION 9 — fact_journal_line
-- Grain: una linea de asiento contable (JournalLine).
-- Fuente: "JournalLine" JOIN "JournalEntry" JOIN "Ledger" JOIN "Account"
-- KPIs: M-EXE-01 Revenue total, M-EXE-02 Revenue por servicio, M-EXE-03 Margen
-- Refresh: cada 4h (naturaleza diferida de contabilidad)
-- ADR base: ADR 0007 — Multi-ledger Accounting
-- =============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.fact_journal_line AS
SELECT
  ROW_NUMBER() OVER (ORDER BY jl."id")             AS journal_line_sk,
  jl."id"                                          AS journal_line_id,
  je."organizationId"                              AS organization_id,
  -- FK logica a dim_organization
  dorg.org_sk,
  -- FK a dim_date por fecha del asiento
  COALESCE(
    TO_CHAR(je."entryDate"::DATE, 'YYYYMMDD')::INTEGER,
    20200101
  )                                                AS entry_date_sk,
  -- ledger_kind del libro contable
  l."kind"::TEXT                                   AS ledger_kind,
  -- codigo de cuenta del plan de cuentas
  a."code"                                         AS account_code,
  -- tipo de cuenta
  a."accountType"::TEXT                            AS account_type,
  -- importes en moneda funcional
  jl."debit"                                       AS debit_amount,
  jl."credit"                                      AS credit_amount,
  -- net_amount: credito - debito (positivo = ingreso en cuentas de Revenue)
  (jl."credit" - jl."debit")                       AS net_amount,
  -- moneda del asiento cabecera
  cur."code"                                       AS currency_code,
  -- fx_rate del asiento
  COALESCE(je."fxRate", 1.0)::NUMERIC(18,8)        AS fx_rate,
  -- document_type: tipo de documento origen (outpatient_encounter, dte_fe, etc.)
  COALESCE(je."documentType", 'MANUAL')            AS document_type,
  -- document_ref: referencia al documento origen
  je."documentRef"                                 AS document_ref,
  -- entry_status: Posted / Reversed / Voided
  CASE
    WHEN je."reversalOfId" IS NOT NULL THEN 'Reversed'
    WHEN je."status" = 'POSTED'        THEN 'Posted'
    WHEN je."status" = 'VOIDED'        THEN 'Voided'
    ELSE je."status"::TEXT
  END                                              AS entry_status,
  -- cost_center_id (puede ser NULL)
  jl."costCenterId"                                AS cost_center_id,
  NOW()                                            AS loaded_at
FROM public."JournalLine" jl
JOIN public."JournalEntry" je ON je."id" = jl."journalEntryId"
JOIN public."Ledger" l        ON l."id"  = je."ledgerId"
JOIN public."Account" a       ON a."id"  = jl."accountId"
JOIN public."Currency" cur    ON cur."id" = je."currencyId"
-- FK logica a dim_organization
LEFT JOIN analytics.dim_organization dorg
  ON dorg.organization_id = je."organizationId"
-- Solo asientos POSTED (datos financieros confirmados)
WHERE je."status" = 'POSTED'
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS fact_journal_line_sk_idx
  ON analytics.fact_journal_line (journal_line_sk);

CREATE INDEX IF NOT EXISTS fact_journal_line_id_idx
  ON analytics.fact_journal_line (journal_line_id);

CREATE INDEX IF NOT EXISTS fact_journal_line_org_id_idx
  ON analytics.fact_journal_line (organization_id);

CREATE INDEX IF NOT EXISTS fact_journal_line_date_sk_idx
  ON analytics.fact_journal_line (entry_date_sk);

CREATE INDEX IF NOT EXISTS fact_journal_line_ledger_kind_idx
  ON analytics.fact_journal_line (ledger_kind);

COMMENT ON MATERIALIZED VIEW analytics.fact_journal_line IS
  'Grain: una linea de asiento contable POSTED. Refresh cada 4h.
   KPIs: M-EXE-01 Revenue total, M-EXE-02 Revenue por servicio, M-EXE-03 Margen.
   Consume ADR 0007: libros FISCAL_SV/IFRS/MANAGEMENT/BUDGET/STATISTICAL.
   Solo lineas de asientos POSTED; borrador/voided excluido.
   REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.fact_journal_line;';

ALTER TABLE analytics.fact_journal_line ENABLE ROW LEVEL SECURITY;

CREATE POLICY bi_reader_journal_line_isolation ON analytics.fact_journal_line
  AS PERMISSIVE
  FOR SELECT
  TO bi_reader
  USING (organization_id = analytics.current_bi_org_id());

CREATE POLICY authenticated_journal_line_isolation ON analytics.fact_journal_line
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (organization_id = analytics.current_bi_org_id());

-- =============================================================================
-- SECCION 10 — Actualizar analytics.refresh_all()
-- Reemplaza el placeholder de SQL 48 con la version completa que incluye
-- las 4 dims y 5 facts nuevas en orden correcto (dims primero, facts despues).
-- =============================================================================

CREATE OR REPLACE FUNCTION analytics.refresh_all()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public, pg_temp
AS $$
BEGIN
  -- 1. Dims SCD1 (24h) — primera pasada en refresh_all diario
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_organization;
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_establishment;
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_diagnosis;
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_drug;

  -- 2. Dims SCD2 y dims que cambian con frecuencia (1h)
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_patient;
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_user_role;

  -- 3. Facts clinicos (1h) — despues de dims para FK logicas consistentes
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.fact_encounter;
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.fact_lab_result;
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.fact_prescription;
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.fact_transfusion;

  -- 4. Facts financieros (4h) — cadencia mas larga; se incluye para refresh manual
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.fact_journal_line;

  RAISE NOTICE 'analytics.refresh_all() completado: % UTC', NOW();
END;
$$;

COMMENT ON FUNCTION analytics.refresh_all IS
  'Refresca todas las materialized views del schema analytics en orden correcto.
   Dims primero (dependencias de FK logicas), facts despues.
   Invocar desde pg_cron (SQL 51) o Supabase Edge Function.
   Para refresh selectivo usar las funciones individuales de SQL 51.';

-- =============================================================================
-- SECCION 11 — Actualizar dataset_catalog con las 9 entries nuevas
-- =============================================================================

UPDATE analytics.dataset_catalog
SET status = 'active', implemented_wave = 'beta19b'
WHERE dataset_name IN (
  'dim_patient', 'dim_diagnosis', 'dim_drug', 'dim_user_role',
  'fact_encounter', 'fact_lab_result', 'fact_prescription',
  'fact_transfusion', 'fact_journal_line'
);

-- Insertar si por alguna razon el catalogo no tiene estos entries (idempotente)
INSERT INTO analytics.dataset_catalog
  (dataset_name, layer, object_type, grain, scd_type, refresh_cadence, owner_role, status, implemented_wave, notes)
VALUES
  ('dim_patient',      'gold','matview','Version de datos demograficos de un paciente','type2','cada 1h', '@BID','active','beta19b',
   'PHI redactada: sin nombre/doc/fecha exacta. age_band + biological_sex.'),
  ('dim_diagnosis',    'gold','matview','Un codigo diagnostico (CIE-10 / SNOMED)',     'type1','cada 24h','@BID','active','beta19b',
   'Catalogo global. Sin RLS de org.'),
  ('dim_drug',         'gold','matview','Un producto farmaceutico',                    'type1','cada 24h','@BID','active','beta19b',
   'organization_id NULL = catalogo global.'),
  ('dim_user_role',    'gold','matview','Un par usuario-rol activo por organizacion',  'type1','cada 1h', '@BID','active','beta19b',
   'Historico en audit_log OLTP.'),
  ('fact_encounter',   'gold','matview','Un encuentro clinico',                        NULL,   'cada 1h', '@BID','active','beta19b',
   'KPIs: M-CLI-01/02/03/04.'),
  ('fact_lab_result',  'gold','matview','Un resultado de laboratorio liberado',        NULL,   'cada 1h', '@BID','active','beta19b',
   'KPIs: M-CLI-07/08.'),
  ('fact_prescription','gold','matview','Una linea de prescripcion dispensada',        NULL,   'cada 1h', '@BID','active','beta19b',
   'KPIs: M-CLI-06.'),
  ('fact_transfusion', 'gold','matview','Una unidad de sangre transfundida',           NULL,   'cada 1h', '@BID','active','beta19b',
   'KPIs: hemovigilancia MINSAL.'),
  ('fact_journal_line','gold','matview','Una linea de asiento contable en cualquier libro',NULL,'cada 4h','@BID','active','beta19b',
   'KPIs: M-EXE-01/02/03. ADR 0007 multi-ledger.')
ON CONFLICT (dataset_name) DO UPDATE
  SET status           = EXCLUDED.status,
      implemented_wave = EXCLUDED.implemented_wave,
      notes            = EXCLUDED.notes;

-- =============================================================================
-- Verificacion post-aplicacion:
--
--   -- Como service_role:
--   SELECT dataset_name, status FROM analytics.dataset_catalog ORDER BY dataset_name;
--   SELECT COUNT(*) FROM analytics.dim_patient;        -- filas = pacientes activos
--   SELECT COUNT(*) FROM analytics.fact_encounter;     -- filas = todos los encuentros
--   SELECT COUNT(*) FROM analytics.fact_journal_line;  -- filas = lineas POSTED
--
--   -- Como bi_reader con contexto:
--   SELECT analytics.set_bi_context('<uuid-de-org>');
--   SELECT COUNT(*) FROM analytics.dim_patient;        -- solo org en contexto
--   SELECT COUNT(*) FROM analytics.fact_encounter;     -- idem
--
-- =============================================================================
