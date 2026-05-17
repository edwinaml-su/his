// =============================================================================
// Cube: Encounters
// Fuente: analytics.fact_encounter (matview Gold)
// Grain: un encuentro clinico
// KPIs: M-CLI-01 censo, M-CLI-02 LOS, M-CLI-03/04 triage cycle time
// =============================================================================

cube('Encounters', {
  sql_table: 'analytics.fact_encounter',

  // -----------------------------------------------------------------------
  // Pre-hook: propagar organization_id al contexto RLS de Postgres.
  // set_bi_context se llama en una transaccion (Cube envuelve cada query).
  // -----------------------------------------------------------------------
  sql: `
    SELECT *
    FROM analytics.fact_encounter
    WHERE (
      SELECT analytics.set_bi_context(
        NULLIF('{SECURITY_CONTEXT.organizationId}', '')::UUID
      )
    ) IS DISTINCT FROM 'NEVER_MATCH'
  `,

  // -----------------------------------------------------------------------
  // Measures (metricas)
  // -----------------------------------------------------------------------
  measures: {
    // M-CLI-00: Recuento de encuentros
    count: {
      type: 'count',
      title: 'Total encuentros',
      description: 'Numero total de encuentros en el periodo seleccionado.',
    },

    // M-CLI-01: Camas ocupadas (encuentros INPATIENT activos)
    activeInpatientCount: {
      type: 'count',
      filters: [
        { sql: `${CUBE}.is_active = TRUE AND ${CUBE}.admission_type = 'INPATIENT'` },
      ],
      title: 'Camas ocupadas',
      description: 'M-CLI-01: Encuentros INPATIENT activos (sin alta). Proxy de ocupacion de camas.',
    },

    // M-CLI-02: Length of Stay promedio (dias)
    avgLOSDays: {
      type: 'avg',
      sql: `${CUBE}.los_hours / 24.0`,
      title: 'LOS promedio (dias)',
      description: 'M-CLI-02: Estancia media en dias. Solo encuentros con alta.',
    },

    // M-CLI-02b: LOS maximo
    maxLOSDays: {
      type: 'max',
      sql: `${CUBE}.los_hours / 24.0`,
      title: 'LOS maximo (dias)',
    },

    // Recuento de encuentros de emergencia
    emergencyCount: {
      type: 'count',
      filters: [
        { sql: `${CUBE}.admission_type = 'EMERGENCY'` },
      ],
      title: 'Encuentros emergencia',
    },

    // Tasa de LWBS (Left Without Being Seen) — encounter activo sin triage
    // Placeholder: requiere logica adicional de "sin atencion > umbral tiempo"
    activeCount: {
      type: 'count',
      filters: [
        { sql: `${CUBE}.is_active = TRUE` },
      ],
      title: 'Encuentros activos',
      description: 'Encuentros sin alta (census actual).',
    },
  },

  // -----------------------------------------------------------------------
  // Dimensions
  // -----------------------------------------------------------------------
  dimensions: {
    encounterSk: {
      sql: `${CUBE}.encounter_sk`,
      type: 'number',
      primaryKey: true,
    },
    encounterId: {
      sql: `${CUBE}.encounter_id`,
      type: 'string',
      title: 'ID Encuentro',
    },
    organizationId: {
      sql: `${CUBE}.organization_id`,
      type: 'string',
      title: 'Organizacion ID',
      shown: false, // No mostrar en UI (solo para filtros internos)
    },
    admissionType: {
      sql: `${CUBE}.admission_type`,
      type: 'string',
      title: 'Tipo de admision',
      description: 'EMERGENCY / OUTPATIENT / INPATIENT',
    },
    triageLevel: {
      sql: `${CUBE}.triage_level`,
      type: 'string',
      title: 'Nivel triage',
    },
    triageColor: {
      sql: `${CUBE}.triage_color`,
      type: 'string',
      title: 'Color triage Manchester',
      description: 'RED / ORANGE / YELLOW / GREEN / BLUE / UNKNOWN',
    },
    isActive: {
      sql: `${CUBE}.is_active`,
      type: 'boolean',
      title: 'Encuentro activo',
    },
    dischargeReason: {
      sql: `${CUBE}.discharge_reason`,
      type: 'string',
      title: 'Razon de alta',
    },
    insuranceType: {
      sql: `${CUBE}.insurance_type`,
      type: 'string',
      title: 'Tipo de seguro',
    },
    admittedDate: {
      sql: `(SELECT full_date FROM analytics.dim_date WHERE date_sk = ${CUBE}.admitted_date_sk)`,
      type: 'time',
      title: 'Fecha de admision',
    },
    dischargedDate: {
      sql: `CASE WHEN ${CUBE}.discharged_date_sk IS NOT NULL
            THEN (SELECT full_date FROM analytics.dim_date WHERE date_sk = ${CUBE}.discharged_date_sk)
            END`,
      type: 'time',
      title: 'Fecha de alta',
    },
    loadedAt: {
      sql: `${CUBE}.loaded_at`,
      type: 'time',
      title: 'Ultima actualizacion matview',
    },
  },

  // -----------------------------------------------------------------------
  // Joins a dimensiones
  // -----------------------------------------------------------------------
  joins: {
    Patients: {
      relationship: 'many_to_one',
      sql: `${CUBE}.patient_sk = ${Patients}.patient_sk`,
    },
    Organizations: {
      relationship: 'many_to_one',
      sql: `${CUBE}.org_sk = ${Organizations}.org_sk`,
    },
    Establishments: {
      relationship: 'many_to_one',
      sql: `${CUBE}.estab_sk = ${Establishments}.estab_sk`,
    },
    Diagnoses: {
      relationship: 'many_to_one',
      sql: `${CUBE}.primary_diag_sk = ${Diagnoses}.diag_sk`,
    },
  },

  // -----------------------------------------------------------------------
  // Pre-aggregaciones (Beta.19c: habilitar cuando el volumen lo justifique)
  // -----------------------------------------------------------------------
  preAggregations: {
    // Agregacion diaria de encuentros por tipo y establecimiento
    // daily: {
    //   measures: [Encounters.count, Encounters.activeInpatientCount],
    //   dimensions: [Encounters.admissionType, Establishments.estabName],
    //   timeDimension: Encounters.admittedDate,
    //   granularity: 'day',
    //   refreshKey: { every: '1 hour' },
    // },
  },
});
