// =============================================================================
// Cube: Transfusions
// Fuente: analytics.fact_transfusion (matview Gold)
// Grain: una unidad de sangre transfundida
// KPIs: seguridad transfusional, hemovigilancia MINSAL SV
// =============================================================================

cube('Transfusions', {
  sql_table: 'analytics.fact_transfusion',

  sql: `
    SELECT *
    FROM analytics.fact_transfusion
    WHERE (
      SELECT analytics.set_bi_context(
        NULLIF('{SECURITY_CONTEXT.organizationId}', '')::UUID
      )
    ) IS DISTINCT FROM 'NEVER_MATCH'
  `,

  measures: {
    count: {
      type: 'count',
      title: 'Total transfusiones',
      description: 'Numero de unidades transfundidas (COMPLETED o ABORTED).',
    },

    // Reacciones transfusionales
    reactionCount: {
      type: 'count',
      filters: [
        { sql: `${CUBE}.had_reaction = TRUE` },
      ],
      title: 'Transfusiones con reaccion',
      description: 'Hemovigilancia: unidades con reaccion adversa registrada.',
    },

    // Tasa de reacciones (por cada 1000 transfusiones)
    reactionRatePer1000: {
      type: 'number',
      sql: `
        CASE WHEN ${count} > 0
        THEN ROUND(${reactionCount}::NUMERIC / ${count}::NUMERIC * 1000, 2)
        ELSE 0 END
      `,
      title: 'Tasa reacciones (x1000)',
      description: 'Reacciones adversas por cada 1000 unidades transfundidas.',
    },

    // Volumen total transfundido (ml)
    totalVolumeMl: {
      type: 'sum',
      sql: `${CUBE}.volume_ml`,
      title: 'Volumen total (ml)',
    },

    // Volumen promedio por unidad
    avgVolumeMl: {
      type: 'avg',
      sql: `${CUBE}.volume_ml`,
      title: 'Volumen promedio (ml)',
    },
  },

  dimensions: {
    transfusionSk: {
      sql: `${CUBE}.transfusion_sk`,
      type: 'number',
      primaryKey: true,
    },
    transfusionId: {
      sql: `${CUBE}.transfusion_id`,
      type: 'string',
      title: 'ID Transfusion',
    },
    organizationId: {
      sql: `${CUBE}.organization_id`,
      type: 'string',
      shown: false,
    },
    bloodProductType: {
      sql: `${CUBE}.blood_product_type`,
      type: 'string',
      title: 'Componente sanguineo',
      description: 'PACKED_RBC / PLASMA / PLATELETS / etc.',
    },
    aboGroup: {
      sql: `${CUBE}.abo_group`,
      type: 'string',
      title: 'Grupo ABO',
    },
    rhFactor: {
      sql: `${CUBE}.rh_factor`,
      type: 'string',
      title: 'Factor Rh',
    },
    hadReaction: {
      sql: `${CUBE}.had_reaction`,
      type: 'boolean',
      title: 'Con reaccion adversa',
    },
    reactionType: {
      sql: `${CUBE}.reaction_type`,
      type: 'string',
      title: 'Tipo de reaccion',
    },
    transfusedDate: {
      sql: `(SELECT full_date FROM analytics.dim_date WHERE date_sk = ${CUBE}.transfused_date_sk)`,
      type: 'time',
      title: 'Fecha de transfusion',
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
