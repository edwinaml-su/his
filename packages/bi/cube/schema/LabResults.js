// =============================================================================
// Cube: LabResults
// Fuente: analytics.fact_lab_result (matview Gold)
// Grain: un resultado de laboratorio liberado
// KPIs: M-CLI-07 Lab TAT p95, M-CLI-08 Critical value ACK time p95
// =============================================================================

cube('LabResults', {
  sql_table: 'analytics.fact_lab_result',

  sql: `
    SELECT *
    FROM analytics.fact_lab_result
    WHERE (
      SELECT analytics.set_bi_context(
        NULLIF('{SECURITY_CONTEXT.organizationId}', '')::UUID
      )
    ) IS DISTINCT FROM 'NEVER_MATCH'
  `,

  measures: {
    count: {
      type: 'count',
      title: 'Total resultados',
      description: 'Numero de resultados de laboratorio liberados.',
    },

    // M-CLI-07: TAT promedio en horas
    avgTATHours: {
      type: 'avg',
      sql: `${CUBE}.order_to_result_hours`,
      title: 'TAT promedio (horas)',
      description: 'M-CLI-07: Tiempo medio desde orden hasta resultado validado.',
    },

    // M-CLI-07: TAT p95 (aproximacion via percentile en SQL — no nativo en Cube)
    // Nota: Cube no soporta PERCENTILE_CONT nativo. Se usa avg como proxy.
    // En Beta.19c implementar via custom SQL measure o pre-aggregation.
    maxTATHours: {
      type: 'max',
      sql: `${CUBE}.order_to_result_hours`,
      title: 'TAT maximo (horas)',
    },

    // Resultados criticos
    criticalCount: {
      type: 'count',
      filters: [
        { sql: `${CUBE}.is_critical = TRUE` },
      ],
      title: 'Resultados criticos',
      description: 'M-CLI-08: Valores criticos emitidos.',
    },

    // ACK time promedio (solo para criticos)
    avgCriticalAckMinutes: {
      type: 'avg',
      sql: `${CUBE}.critical_ack_minutes`,
      filters: [
        { sql: `${CUBE}.is_critical = TRUE AND ${CUBE}.critical_ack_minutes IS NOT NULL` },
      ],
      title: 'ACK critico promedio (min)',
      description: 'M-CLI-08: Tiempo medio de reconocimiento de valores criticos.',
    },
  },

  dimensions: {
    labResultSk: {
      sql: `${CUBE}.lab_result_sk`,
      type: 'number',
      primaryKey: true,
    },
    labResultId: {
      sql: `${CUBE}.lab_result_id`,
      type: 'string',
      title: 'ID Resultado',
    },
    organizationId: {
      sql: `${CUBE}.organization_id`,
      type: 'string',
      shown: false,
    },
    testLoincCode: {
      sql: `${CUBE}.test_loinc_code`,
      type: 'string',
      title: 'Codigo LOINC',
      description: 'Codigo LOINC del test de laboratorio.',
    },
    resultStatus: {
      sql: `${CUBE}.result_status`,
      type: 'string',
      title: 'Estado resultado',
      description: 'PRELIMINARY / FINAL',
    },
    isCritical: {
      sql: `${CUBE}.is_critical`,
      type: 'boolean',
      title: 'Valor critico',
    },
    orderedDate: {
      sql: `(SELECT full_date FROM analytics.dim_date WHERE date_sk = ${CUBE}.ordered_date_sk)`,
      type: 'time',
      title: 'Fecha de orden',
    },
    resultedDate: {
      sql: `(SELECT full_date FROM analytics.dim_date WHERE date_sk = ${CUBE}.resulted_date_sk)`,
      type: 'time',
      title: 'Fecha de resultado',
    },
    loadedAt: {
      sql: `${CUBE}.loaded_at`,
      type: 'time',
      title: 'Ultima actualizacion matview',
    },
  },

  joins: {
    Encounters: {
      relationship: 'many_to_one',
      sql: `${CUBE}.encounter_sk = ${Encounters}.encounter_sk`,
    },
  },

  preAggregations: {},
});
