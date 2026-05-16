// =============================================================================
// Cube: Prescriptions
// Fuente: analytics.fact_prescription (matview Gold)
// Grain: una linea de prescripcion (PrescriptionItem)
// KPIs: M-CLI-06 Prescription compliance
// =============================================================================

cube('Prescriptions', {
  sql_table: 'analytics.fact_prescription',

  sql: `
    SELECT *
    FROM analytics.fact_prescription
    WHERE (
      SELECT analytics.set_bi_context(
        NULLIF('{SECURITY_CONTEXT.organizationId}', '')::UUID
      )
    ) IS DISTINCT FROM 'NEVER_MATCH'
  `,

  measures: {
    count: {
      type: 'count',
      title: 'Total prescripciones',
      description: 'Numero de lineas de prescripcion (PrescriptionItems).',
    },

    // M-CLI-06: Prescripciones dispensadas
    dispensedCount: {
      type: 'count',
      filters: [
        { sql: `${CUBE}.is_dispensed = TRUE` },
      ],
      title: 'Prescripciones dispensadas',
      description: 'M-CLI-06: Lineas que tienen al menos una dispensacion registrada.',
    },

    // M-CLI-06: Tasa de dispensacion
    dispensationRate: {
      type: 'number',
      sql: `
        CASE WHEN ${count} > 0
        THEN ROUND(${dispensedCount}::NUMERIC / ${count}::NUMERIC * 100, 2)
        ELSE 0 END
      `,
      title: 'Tasa dispensacion (%)',
      description: 'M-CLI-06: (dispensadas / total) * 100.',
    },

    // Compliance promedio (solo donde se tiene dato administrado)
    avgCompliancePct: {
      type: 'avg',
      sql: `${CUBE}.compliance_pct`,
      filters: [
        { sql: `${CUBE}.compliance_pct IS NOT NULL` },
      ],
      title: 'Compliance promedio (%)',
      description: 'Porcentaje promedio de cumplimiento de dosis administradas vs prescritas.',
    },

    // Prescripciones de medicamentos controlados
    controlledCount: {
      type: 'count',
      filters: [
        { sql: `${CUBE}.is_controlled = TRUE` },
      ],
      title: 'Prescripciones controladas',
      description: 'Lineas de farmacos con requisitoControlledLog.',
    },

    // Dosis total prescrita (suma)
    totalQtyPrescribed: {
      type: 'sum',
      sql: `${CUBE}.qty_prescribed`,
      title: 'Cantidad total prescrita',
    },

    // Dosis total administrada
    totalQtyAdministered: {
      type: 'sum',
      sql: `${CUBE}.qty_administered`,
      title: 'Cantidad total administrada',
    },
  },

  dimensions: {
    prescriptionSk: {
      sql: `${CUBE}.prescription_sk`,
      type: 'number',
      primaryKey: true,
    },
    prescriptionId: {
      sql: `${CUBE}.prescription_id`,
      type: 'string',
      title: 'ID Prescripcion',
    },
    organizationId: {
      sql: `${CUBE}.organization_id`,
      type: 'string',
      shown: false,
    },
    isDispensed: {
      sql: `${CUBE}.is_dispensed`,
      type: 'boolean',
      title: 'Dispensada',
    },
    isControlled: {
      sql: `${CUBE}.is_controlled`,
      type: 'boolean',
      title: 'Medicamento controlado',
    },
    prescribedDate: {
      sql: `(SELECT full_date FROM analytics.dim_date WHERE date_sk = ${CUBE}.prescribed_date_sk)`,
      type: 'time',
      title: 'Fecha de prescripcion',
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
    Drugs: {
      relationship: 'many_to_one',
      sql: `${CUBE}.drug_sk = ${Drugs}.drug_sk`,
    },
  },

  preAggregations: {},
});

// =============================================================================
// Cube auxiliar: Drugs (dim_drug)
// Referenciado por Prescriptions.
// =============================================================================
cube('Drugs', {
  sql_table: 'analytics.dim_drug',

  measures: {
    count: {
      type: 'count',
      title: 'Total farmacos',
    },
  },

  dimensions: {
    drugSk: {
      sql: `${CUBE}.drug_sk`,
      type: 'number',
      primaryKey: true,
    },
    drugProductId: {
      sql: `${CUBE}.drug_product_id`,
      type: 'string',
      title: 'ID Farmaco',
    },
    organizationId: {
      sql: `${CUBE}.organization_id`,
      type: 'string',
      shown: false,
    },
    genericName: {
      sql: `${CUBE}.generic_name`,
      type: 'string',
      title: 'Nombre generico',
    },
    atcCode: {
      sql: `${CUBE}.atc_code`,
      type: 'string',
      title: 'Codigo ATC',
    },
    atcLevel1Name: {
      sql: `${CUBE}.atc_level1_name`,
      type: 'string',
      title: 'Categoria ATC nivel 1',
    },
    dosageForm: {
      sql: `${CUBE}.dosage_form`,
      type: 'string',
      title: 'Forma farmaceutica',
    },
    isControlled: {
      sql: `${CUBE}.is_controlled`,
      type: 'boolean',
      title: 'Medicamento controlado',
    },
    isActive: {
      sql: `${CUBE}.is_active`,
      type: 'boolean',
      title: 'Activo',
    },
  },

  preAggregations: {},
});
