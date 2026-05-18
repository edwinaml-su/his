/**
 * Seed — Fixtures de Hard Stops Bedside (US.F2.6.27-30).
 *
 * Crea en Supabase los datos mínimos para que los 8 escenarios de hard stop
 * funcionen en el pipeline E2E:
 *
 *   - 8 pacientes con pulseras GSRN distintas
 *   - 8 enfermeras (1 con GSRN revocado — HS-08)
 *   - 4 medicamentos en catálogo ece.gs1_gtin
 *   - Lotes asociados (ece.gs1_gtin_lote):
 *       L-HS06-VENCIDO  → vencimiento 2024-01-01 (pasado)
 *       L-RECALL-2026   → en_recall = true
 *       Resto            → vencimiento 2027-12-31, sin recall
 *   - 8 indicaciones bedside (ece.indicacion_bedside) una por escenario
 *
 * Idempotente — usa ON CONFLICT DO NOTHING.
 *
 * Uso:
 *   DIRECT_URL=<conexión directa postgres> node seed-bedside-hardstops.mjs
 */

import pg from 'pg';

const db = process.env.DIRECT_URL;
if (!db) {
  console.error('DIRECT_URL faltante');
  process.exit(2);
}

const cleanUrl = db.replace(/[?&]sslmode=[^&]*/g, '')
  .replace('?&', '?').replace(/[?&]$/, '');
const c = new pg.Client({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } });
await c.connect();

// ---------------------------------------------------------------------------
// GS1 check digit — módulo 10
// ---------------------------------------------------------------------------

function calcCheckDigit(digits) {
  const d = digits.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    const weight = i % 2 === 0 ? 3 : 1;
    sum += d[i] * weight;
  }
  return ((10 - (sum % 10)) % 10).toString();
}

function makeGsrn(prefix17) {
  return prefix17 + calcCheckDigit(prefix17);
}

function makeGtin(prefix13) {
  const weights = [1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1];
  const d = prefix13.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += d[i] * weights[i];
  }
  const check = (10 - (sum % 10)) % 10;
  return prefix13 + check;
}

// ---------------------------------------------------------------------------
// Definición de fixtures
// ---------------------------------------------------------------------------

const GSRN_PATIENTS = {
  HS01: makeGsrn('80187413000000001'),
  HS02: makeGsrn('80187413000000002'),
  HS03: makeGsrn('80187413000000003'),
  HS04: makeGsrn('80187413000000004'),
  HS05: makeGsrn('80187413000000005'),
  HS06: makeGsrn('80187413000000006'),
  HS07: makeGsrn('80187413000000007'),
  HS08: makeGsrn('80187413000000008'),
};

const GSRN_NURSES = {
  HS01: makeGsrn('80187413000001001'),
  HS02: makeGsrn('80187413000001002'),
  HS03: makeGsrn('80187413000001003'),
  HS04: makeGsrn('80187413000001004'),
  HS05: makeGsrn('80187413000001005'),
  HS06: makeGsrn('80187413000001006'),
  HS07: makeGsrn('80187413000001007'),
  HS08_REVOCADO: makeGsrn('80187413000001008'),
};

const GTIN_CODES = {
  AMOXICILINA_500:  makeGtin('0750100000123'),
  IBUPROFENO_400:   makeGtin('0750100000999'),
  AMOXICILINA_1000: makeGtin('0750100000124'),
  ENALAPRIL_10:     makeGtin('0750100000125'),
};

// ---------------------------------------------------------------------------
// Resolver FK base
// ---------------------------------------------------------------------------

try {
  const { rows: [estab] } = await c.query(
    `SELECT id, "organizationId" FROM public."Establishment" LIMIT 1`
  );
  if (!estab) throw new Error('Sin establecimiento — corre db:seed primero');
  const orgId = estab.organizationId;
  console.log(`Org ID: ${orgId}`);

  // -------------------------------------------------------------------------
  // 1. GSRN pacientes en ece.gs1_gsrn
  // -------------------------------------------------------------------------
  console.log('Sembrando GSRN pacientes...');
  for (const [key, gsrn] of Object.entries(GSRN_PATIENTS)) {
    await c.query(
      `INSERT INTO ece.gs1_gsrn (codigo, tipo, referencia_id, activo)
       VALUES ($1, 'paciente', gen_random_uuid(), true)
       ON CONFLICT (codigo) DO NOTHING`,
      [gsrn]
    );
    console.log(`  PAC-${key}: ${gsrn}`);
  }

  // -------------------------------------------------------------------------
  // 2. GSRN enfermeras en ece.gs1_gsrn
  //    HS08_REVOCADO → activo = false
  // -------------------------------------------------------------------------
  console.log('Sembrando GSRN enfermeras...');
  for (const [key, gsrn] of Object.entries(GSRN_NURSES)) {
    const activo = key !== 'HS08_REVOCADO';
    await c.query(
      `INSERT INTO ece.gs1_gsrn (codigo, tipo, referencia_id, activo)
       VALUES ($1, 'profesional', gen_random_uuid(), $2)
       ON CONFLICT (codigo) DO NOTHING`,
      [gsrn, activo]
    );
    console.log(`  ENF-${key}: ${gsrn} activo=${activo}`);
  }

  // -------------------------------------------------------------------------
  // 3. Catálogo GTIN en ece.gs1_gtin
  // -------------------------------------------------------------------------
  console.log('Sembrando catálogo GTIN...');
  const gtinData = [
    {
      codigo: GTIN_CODES.AMOXICILINA_500,
      descripcion: 'Amoxicilina 500mg — Cápsula',
      fabricante: 'Laboratorios QA Test SV',
      presentacion: '500mg',
      contenido_unidades: 1,
      principio_activo: 'Amoxicilina',
      codigo_atc: 'J01CA04',
    },
    {
      codigo: GTIN_CODES.IBUPROFENO_400,
      descripcion: 'Ibuprofeno 400mg — Tableta',
      fabricante: 'Laboratorios QA Test SV',
      presentacion: '400mg',
      contenido_unidades: 1,
      principio_activo: 'Ibuprofeno',
      codigo_atc: 'M01AE01',
    },
    {
      codigo: GTIN_CODES.AMOXICILINA_1000,
      descripcion: 'Amoxicilina 1000mg — Vial IV',
      fabricante: 'Laboratorios QA Test SV',
      presentacion: '1000mg',
      contenido_unidades: 1,
      principio_activo: 'Amoxicilina',
      codigo_atc: 'J01CA04',
    },
    {
      codigo: GTIN_CODES.ENALAPRIL_10,
      descripcion: 'Enalapril 10mg — Tableta VO',
      fabricante: 'Laboratorios QA Test SV',
      presentacion: '10mg',
      contenido_unidades: 1,
      principio_activo: 'Enalapril',
      codigo_atc: 'C09AA02',
    },
  ];

  for (const g of gtinData) {
    await c.query(
      `INSERT INTO ece.gs1_gtin
         (codigo, descripcion, fabricante, presentacion, contenido_unidades,
          principio_activo, codigo_atc)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (codigo) DO NOTHING`,
      [g.codigo, g.descripcion, g.fabricante, g.presentacion,
       g.contenido_unidades, g.principio_activo, g.codigo_atc]
    );
    console.log(`  GTIN: ${g.codigo} (${g.descripcion})`);
  }

  // -------------------------------------------------------------------------
  // 4. Lotes en ece.gs1_gtin_lote
  //    HS-06: vencido
  //    HS-07: en_recall = true
  //    Resto: vigentes
  // -------------------------------------------------------------------------
  console.log('Sembrando lotes...');
  const lotes = [
    { gtin: GTIN_CODES.AMOXICILINA_500, lote: 'L-HS01-2026', vencimiento: '2027-12-31', en_recall: false },
    { gtin: GTIN_CODES.IBUPROFENO_400,  lote: 'L-HS02-2026', vencimiento: '2027-12-31', en_recall: false },
    { gtin: GTIN_CODES.AMOXICILINA_1000,lote: 'L-HS03-2026', vencimiento: '2027-12-31', en_recall: false },
    { gtin: GTIN_CODES.ENALAPRIL_10,    lote: 'L-HS04-2026', vencimiento: '2027-12-31', en_recall: false },
    { gtin: GTIN_CODES.AMOXICILINA_500, lote: 'L-HS05-2026', vencimiento: '2027-12-31', en_recall: false },
    { gtin: GTIN_CODES.AMOXICILINA_500, lote: 'L-HS06-VENCIDO', vencimiento: '2024-01-01', en_recall: false }, // HS-06
    { gtin: GTIN_CODES.AMOXICILINA_500, lote: 'L-RECALL-2026',  vencimiento: '2027-12-31', en_recall: true  }, // HS-07
    { gtin: GTIN_CODES.AMOXICILINA_500, lote: 'L-HS08-2026', vencimiento: '2027-12-31', en_recall: false },
    { gtin: GTIN_CODES.AMOXICILINA_500, lote: 'L-VALID-2026', vencimiento: '2027-12-31', en_recall: false }, // happy path
    { gtin: GTIN_CODES.AMOXICILINA_500, lote: 'L-PERF-2026',  vencimiento: '2029-12-31', en_recall: false }, // performance
  ];

  for (const l of lotes) {
    await c.query(
      `INSERT INTO ece.gs1_gtin_lote (gtin, lote, vencimiento, en_recall)
       VALUES ($1, $2, $3::date, $4)
       ON CONFLICT (gtin, lote) DO NOTHING`,
      [l.gtin, l.lote, l.vencimiento, l.en_recall]
    );
    console.log(`  Lote: ${l.lote} recall=${l.en_recall} venc=${l.vencimiento}`);
  }

  // -------------------------------------------------------------------------
  // 5. Indicaciones bedside (ece.indicacion_bedside)
  //    Una por escenario — vinculadas al patient_id del GSRN correspondiente
  // -------------------------------------------------------------------------
  console.log('Sembrando indicaciones bedside...');

  // Obtener patient_id de cada GSRN paciente
  for (const [key, gsrn] of Object.entries(GSRN_PATIENTS)) {
    const { rows: [gsrnRow] } = await c.query(
      `SELECT referencia_id FROM ece.gs1_gsrn WHERE codigo = $1 LIMIT 1`,
      [gsrn]
    );
    if (!gsrnRow) {
      console.warn(`  WARN: GSRN no encontrado para PAC-${key}`);
      continue;
    }
    const patientId = gsrnRow.referencia_id;

    // Configuración por escenario
    const configs = {
      HS01: { gtin: GTIN_CODES.AMOXICILINA_500, via: 'IV', concentracion: '500mg', hora: '08:00', ventana: 30 },
      HS02: { gtin: GTIN_CODES.AMOXICILINA_500, via: 'IV', concentracion: '500mg', hora: '08:00', ventana: 30 },
      HS03: { gtin: GTIN_CODES.AMOXICILINA_500, via: 'IV', concentracion: '500mg', hora: '10:00', ventana: 30 },
      HS04: { gtin: GTIN_CODES.AMOXICILINA_500, via: 'IV', concentracion: '500mg', hora: '12:00', ventana: 30 },
      HS05: { gtin: GTIN_CODES.AMOXICILINA_500, via: 'IV', concentracion: '500mg', hora: '08:00', ventana: 30 },
      HS06: { gtin: GTIN_CODES.AMOXICILINA_500, via: 'IV', concentracion: '500mg', hora: '08:00', ventana: 30 },
      HS07: { gtin: GTIN_CODES.AMOXICILINA_500, via: 'IV', concentracion: '500mg', hora: '08:00', ventana: 30 },
      HS08: { gtin: GTIN_CODES.AMOXICILINA_500, via: 'IV', concentracion: '500mg', hora: '08:00', ventana: 30 },
    };

    const cfg = configs[key];
    if (!cfg) continue;

    // Hora programada hoy a la hora configurada (zona El Salvador UTC-6)
    const today = new Date();
    const [hh, mm] = cfg.hora.split(':').map(Number);
    const horaProgramada = new Date(Date.UTC(
      today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(),
      hh + 6, mm, 0, // UTC-6 → suma 6 horas para que en SV sea hh:mm
    ));

    await c.query(
      `INSERT INTO ece.indicacion_bedside
         (organization_id, patient_id, gtin_prescripto, concentracion_prescrita,
          via_administracion, hora_programada, ventana_minutos, status)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, 'activa')
       ON CONFLICT DO NOTHING`,
      [orgId, patientId, cfg.gtin, cfg.concentracion, cfg.via, horaProgramada, cfg.ventana]
    );
    console.log(`  Indicacion PAC-${key}: GTIN=${cfg.gtin} via=${cfg.via}`);
  }

  console.log('\nSeed completado.');
} finally {
  await c.end();
}
