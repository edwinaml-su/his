// =============================================================================
// Cube: JournalLines
// Fuente: analytics.fact_journal_line (matview Gold)
// Grain: una linea de asiento contable POSTED
// KPIs: M-EXE-01 Revenue total, M-EXE-02 Revenue por servicio, M-EXE-03 Margen
// ADR base: ADR 0007 — Multi-ledger Accounting
// =============================================================================

cube('JournalLines', {
  sql_table: 'analytics.fact_journal_line',

  sql: `
    SELECT *
    FROM analytics.fact_journal_line
    WHERE (
      SELECT analytics.set_bi_context(
        NULLIF('{SECURITY_CONTEXT.organizationId}', '')::UUID
      )
    ) IS DISTINCT FROM 'NEVER_MATCH'
  `,

  measures: {
    count: {
      type: 'count',
      title: 'Total lineas contables',
      description: 'Numero de lineas de asiento POSTED.',
    },

    // M-EXE-01: Revenue total (credito en cuentas Revenue)
    totalRevenue: {
      type: 'sum',
      sql: `${CUBE}.credit_amount`,
      filters: [
        { sql: `${CUBE}.account_type = 'Revenue'` },
        { sql: `${CUBE}.entry_status = 'Posted'` },
      ],
      title: 'Revenue total',
      description: 'M-EXE-01: Suma de creditos en cuentas de Revenue (moneda funcional).',
    },

    // M-EXE-02: Revenue por tipo de documento (ver dimension documentType)
    revenueByService: {
      type: 'sum',
      sql: `${CUBE}.credit_amount`,
      filters: [
        { sql: `${CUBE}.account_type = 'Revenue'` },
        { sql: `${CUBE}.entry_status = 'Posted'` },
      ],
      title: 'Revenue por servicio',
      description: 'M-EXE-02: Desglosar por dimension documentType para ver por servicio.',
    },

    // Total debitos (costos/gastos)
    totalDebit: {
      type: 'sum',
      sql: `${CUBE}.debit_amount`,
      filters: [
        { sql: `${CUBE}.account_type IN ('Expense', 'Cost')` },
        { sql: `${CUBE}.entry_status = 'Posted'` },
      ],
      title: 'Total gastos',
      description: 'Suma de debitos en cuentas de gasto.',
    },

    // M-EXE-03: Margen operativo = Revenue - Costos (net_amount sum)
    netAmount: {
      type: 'sum',
      sql: `${CUBE}.net_amount`,
      filters: [
        { sql: `${CUBE}.entry_status = 'Posted'` },
      ],
      title: 'Margen neto',
      description: 'M-EXE-03: Suma de (credito - debito) en lineas POSTED.',
    },

    // Saldo por tipo de cuenta (para balance sheet)
    balanceAmount: {
      type: 'sum',
      sql: `${CUBE}.net_amount`,
      title: 'Saldo',
    },
  },

  dimensions: {
    journalLineSk: {
      sql: `${CUBE}.journal_line_sk`,
      type: 'number',
      primaryKey: true,
    },
    journalLineId: {
      sql: `${CUBE}.journal_line_id`,
      type: 'string',
      title: 'ID Linea asiento',
    },
    organizationId: {
      sql: `${CUBE}.organization_id`,
      type: 'string',
      shown: false,
    },
    ledgerKind: {
      sql: `${CUBE}.ledger_kind`,
      type: 'string',
      title: 'Libro contable',
      description: 'FISCAL_SV / IFRS / US_GAAP / MANAGEMENT / BUDGET / STATISTICAL',
    },
    accountCode: {
      sql: `${CUBE}.account_code`,
      type: 'string',
      title: 'Codigo de cuenta',
    },
    accountType: {
      sql: `${CUBE}.account_type`,
      type: 'string',
      title: 'Tipo de cuenta',
      description: 'Asset / Liability / Equity / Revenue / Expense',
    },
    currencyCode: {
      sql: `${CUBE}.currency_code`,
      type: 'string',
      title: 'Moneda',
    },
    documentType: {
      sql: `${CUBE}.document_type`,
      type: 'string',
      title: 'Tipo documento origen',
      description: 'outpatient_encounter / dte_fe / dispensation / MANUAL / etc.',
    },
    documentRef: {
      sql: `${CUBE}.document_ref`,
      type: 'string',
      title: 'Referencia documento',
    },
    entryStatus: {
      sql: `${CUBE}.entry_status`,
      type: 'string',
      title: 'Estado asiento',
      description: 'Posted / Reversed / Voided',
    },
    entryDate: {
      sql: `(SELECT full_date FROM analytics.dim_date WHERE date_sk = ${CUBE}.entry_date_sk)`,
      type: 'time',
      title: 'Fecha asiento',
    },
    loadedAt: {
      sql: `${CUBE}.loaded_at`,
      type: 'time',
      title: 'Ultima actualizacion matview',
    },
  },

  joins: {
    Organizations: {
      relationship: 'many_to_one',
      sql: `${CUBE}.org_sk = ${Organizations}.org_sk`,
    },
  },

  preAggregations: {},
});

// =============================================================================
// Cubes de dimensiones compartidas
// dim_organization y dim_establishment son usadas por multiples cubes.
// Se definen aqui y se usan via joins.
// =============================================================================

cube('Organizations', {
  sql_table: 'analytics.dim_organization',

  measures: {
    count: { type: 'count', title: 'Total organizaciones' },
  },

  dimensions: {
    orgSk: {
      sql: `${CUBE}.org_sk`,
      type: 'number',
      primaryKey: true,
    },
    organizationId: {
      sql: `${CUBE}.organization_id`,
      type: 'string',
      title: 'ID Organizacion',
    },
    orgName: {
      sql: `${CUBE}.org_name`,
      type: 'string',
      title: 'Nombre organizacion',
    },
    countryCode: {
      sql: `${CUBE}.country_code`,
      type: 'string',
      title: 'Pais (ISO3)',
    },
    functionalCurrency: {
      sql: `${CUBE}.functional_currency`,
      type: 'string',
      title: 'Moneda funcional',
    },
    isActive: {
      sql: `${CUBE}.is_active`,
      type: 'boolean',
      title: 'Activa',
    },
  },
  preAggregations: {},
});

cube('Establishments', {
  sql_table: 'analytics.dim_establishment',

  measures: {
    count: { type: 'count', title: 'Total establecimientos' },
  },

  dimensions: {
    estabSk: {
      sql: `${CUBE}.estab_sk`,
      type: 'number',
      primaryKey: true,
    },
    establishmentId: {
      sql: `${CUBE}.establishment_id`,
      type: 'string',
      title: 'ID Establecimiento',
    },
    organizationId: {
      sql: `${CUBE}.organization_id`,
      type: 'string',
      shown: false,
    },
    estabName: {
      sql: `${CUBE}.estab_name`,
      type: 'string',
      title: 'Nombre establecimiento',
    },
    estabCode: {
      sql: `${CUBE}.estab_code`,
      type: 'string',
      title: 'Codigo establecimiento',
    },
    estabType: {
      sql: `${CUBE}.estab_type`,
      type: 'string',
      title: 'Tipo establecimiento',
    },
    isActive: {
      sql: `${CUBE}.is_active`,
      type: 'boolean',
      title: 'Activo',
    },
  },
  preAggregations: {},
});

cube('Patients', {
  sql_table: 'analytics.dim_patient',

  measures: {
    count: { type: 'count', title: 'Total pacientes (versiones activas)' },
  },

  dimensions: {
    patientSk: {
      sql: `${CUBE}.patient_sk`,
      type: 'number',
      primaryKey: true,
    },
    patientId: {
      sql: `${CUBE}.patient_id`,
      type: 'string',
      title: 'ID Paciente',
    },
    organizationId: {
      sql: `${CUBE}.organization_id`,
      type: 'string',
      shown: false,
    },
    ageBand: {
      sql: `${CUBE}.age_band`,
      type: 'string',
      title: 'Banda de edad',
      description: '0-4 / 5-14 / 15-44 / 45-64 / 65+ / UNKNOWN',
    },
    biologicalSex: {
      sql: `${CUBE}.biological_sex`,
      type: 'string',
      title: 'Sexo biologico',
    },
    isCurrent: {
      sql: `${CUBE}.is_current`,
      type: 'boolean',
      title: 'Version actual',
    },
    isActive: {
      sql: `${CUBE}.is_active`,
      type: 'boolean',
      title: 'Activo en OLTP',
    },
  },
  preAggregations: {},
});

cube('Diagnoses', {
  sql_table: 'analytics.dim_diagnosis',

  measures: {
    count: { type: 'count', title: 'Total codigos diagnostico' },
  },

  dimensions: {
    diagSk: {
      sql: `${CUBE}.diag_sk`,
      type: 'number',
      primaryKey: true,
    },
    conceptId: {
      sql: `${CUBE}.concept_id`,
      type: 'string',
      title: 'ID Concepto',
    },
    code: {
      sql: `${CUBE}.code`,
      type: 'string',
      title: 'Codigo CIE-10/SNOMED',
    },
    display: {
      sql: `${CUBE}.display`,
      type: 'string',
      title: 'Descripcion',
    },
    codeSystem: {
      sql: `${CUBE}.code_system`,
      type: 'string',
      title: 'Sistema de codigos',
    },
    chapterCode: {
      sql: `${CUBE}.chapter_code`,
      type: 'string',
      title: 'Capitulo CIE-10',
    },
    chapterNameEs: {
      sql: `${CUBE}.chapter_name_es`,
      type: 'string',
      title: 'Nombre capitulo (es)',
    },
    isActive: {
      sql: `${CUBE}.is_active`,
      type: 'boolean',
      title: 'Activo',
    },
  },
  preAggregations: {},
});
