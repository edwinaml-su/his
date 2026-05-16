{% snapshot dim_patient_snapshot %}
{{
  config(
    target_schema='analytics',
    unique_key='patient_id',
    strategy='check',
    check_cols=[
      'biological_sex',
      'age_band',
      'is_active'
    ],
    updated_at='updated_at',
    invalidate_hard_deletes=False
  )
}}

-- =============================================================================
-- Snapshot: dim_patient_snapshot
-- Wave: Beta.19b — BI Capa Semantica
-- Owner: @BID — BI Developer
-- Estrategia: check — detecta cambios en columnas especificadas.
-- unique_key: patient_id (natural key del OLTP).
-- updated_at: updatedAt del Patient OLTP (campo de change detection).
--
-- PROPOSITO:
--   Generar versiones SCD Tipo 2 reales de dim_patient.
--   Cada vez que bio_sex, age_band o is_active cambia, dbt crea una nueva
--   fila con dbt_valid_from / dbt_valid_to / dbt_scd_id.
--
-- COLUMNAS dbt snapshot (automaticas):
--   dbt_scd_id       VARCHAR — hash unico de la fila snapshot
--   dbt_updated_at   TIMESTAMP — cuando dbt proceso este cambio
--   dbt_valid_from   TIMESTAMP — inicio de validez de esta version
--   dbt_valid_to     TIMESTAMP — fin de validez (NULL = version actual)
--
-- PHI REDACTADA:
--   igual que la matview dim_patient (SQL 50):
--   sin nombre, sin documento, sin fecha exacta de nacimiento.
--
-- PREREQUISITO:
--   dbt conectado al proyecto Supabase con rol que tenga WRITE en analytics schema.
--   En produccion usar service_role o un rol dedicado 'dbt_runner'.
--
-- CORRER:
--   cd packages/bi/dbt
--   dbt snapshot --select dim_patient_snapshot
--
-- VERIFICAR:
--   SELECT patient_id, age_band, dbt_valid_from, dbt_valid_to
--   FROM analytics.dim_patient_snapshot
--   ORDER BY patient_id, dbt_valid_from;
-- =============================================================================

SELECT
  p.id                                             AS patient_id,
  p."organizationId"                               AS organization_id,
  -- age_band: banda de edad (PHI safe)
  CASE
    WHEN p."birthDate" IS NULL
      THEN 'UNKNOWN'
    WHEN DATE_PART('year', AGE(CURRENT_DATE, p."birthDate"::DATE)) < 5
      THEN '0-4'
    WHEN DATE_PART('year', AGE(CURRENT_DATE, p."birthDate"::DATE)) < 15
      THEN '5-14'
    WHEN DATE_PART('year', AGE(CURRENT_DATE, p."birthDate"::DATE)) < 45
      THEN '15-44'
    WHEN DATE_PART('year', AGE(CURRENT_DATE, p."birthDate"::DATE)) < 65
      THEN '45-64'
    ELSE '65+'
  END                                              AS age_band,
  -- biological_sex: codigo de catalogo
  COALESCE(bs.code, 'UNKNOWN')                     AS biological_sex,
  -- is_active: paciente activo en OLTP
  p.active                                         AS is_active,
  -- updated_at: campo de change detection (requerido por strategy=check)
  p."updatedAt"                                    AS updated_at

FROM {{ source('public', 'Patient') }} p
LEFT JOIN {{ source('public', 'BiologicalSex') }} bs
  ON bs.id = p."biologicalSexId"
WHERE p."deletedAt" IS NULL

{% endsnapshot %}
