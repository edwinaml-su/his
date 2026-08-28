// Seed de fixtures clínicos para E2E (BD efímera de CI — docker-compose.test.yml).
//
// Cubre los datos transaccionales que `npm run db:seed` (solo catálogos) no crea
// y que las specs @smoke necesitan para renderizar contenido real:
//
//   1. Camas (public."Bed") con mezcla de estados: FREE / OCCUPIED / DIRTY /
//      MAINTENANCE / RESERVED en el ServiceUnit HOSP + 1 FREE en ER.
//      → bed-map.spec.ts, audit-trail.spec.ts (los INSERT disparan los
//        triggers de audit.fn_audit_row aplicados por el bootstrap del workflow).
//   2. Paciente "María Pérez" + Encounter ABIERTO (ENC-{AAAA}-000101, formato
//      ENC-\d{4}-\d{6}) + BedAssignment activo sobre la cama OCCUPIED.
//      → admission-discharge.spec.ts (/transfers lista el encuentro abierto).
//   3. Espejo ECE de la ocupación: institucion → establecimiento → servicio →
//      cama (MISMO id que public."Bed", convención del bridge
//      bridge-bed-to-ece-cama.mjs) → paciente (MISMO id que public."Patient")
//      → episodio_atencion/episodio_hospitalario → asignacion_cama activa.
//      → /beds usa eceCama.mapCompleto, que resuelve "ocupada" por
//        ece.asignacion_cama y navega a /ece/episodio-hospitalario/{episodioId}.
//   4. Datos escaneables GS1: pulsera GSRN del paciente + badge GSRN de
//      enfermera (uno activo, uno revocado) en ece.gs1_gsrn, y catálogo
//      ece.gs1_gtin (Amoxicilina 500mg / Ibuprofeno 400mg). Los valores
//      coinciden con packages/test-utils/src/fixtures/bedside-hardstops.ts
//      (mismo prefijo de empresa 801874130000 + check digit módulo 10).
//      NOTA: ece.gs1_gtin_lote NO se siembra — la tabla es drift SQL-only
//      (sql/170) y no existe en la BD efímera creada por `prisma db push`.
//   5. Indicación médica firmada + item MEDICAMENTO → la cola /bedside
//      (bedside.shiftQueue.pending) devuelve al menos un item.
//
// UUIDs DETERMINISTAS: los ids fijos e2ef1000-... se replican en
// apps/web/e2e/_helpers/fixtures.ts para que las specs puedan referenciarlos.
// Si cambiás uno acá, actualizá ese archivo en el mismo commit.
//
// Idempotente (ON CONFLICT por PK/clave natural). Requiere `npm run db:seed`
// previo (catálogos base) y, para que la auditoría funcione, el paso
// "Bootstrap RLS helpers" del workflow (02_audit_triggers.sql).
import pg from 'pg';

const db = process.env.DIRECT_URL;
if (!db) { console.error('DIRECT_URL faltante'); process.exit(2); }

// Igual que seed-test-users.mjs: contra el Postgres efímero de CI (localhost,
// sin TLS) node-postgres aborta si se fuerza ssl. Solo exigimos TLS para
// hosts remotos (Supabase real).
const dbUrl = new URL(db);
const isLocalNoSsl =
  ['localhost', '127.0.0.1'].includes(dbUrl.hostname) || /[?&]sslmode=disable\b/.test(db);
const cleanUrl = db.replace(/[?&]sslmode=[^&]*/g, '').replace('?&', '?').replace(/[?&]$/, '');
const c = new pg.Client({
  connectionString: cleanUrl,
  ...(isLocalNoSsl ? {} : { ssl: { rejectUnauthorized: false } }),
});
await c.connect();

// ─── IDs deterministas (espejados en apps/web/e2e/_helpers/fixtures.ts) ─────
const IDS = {
  patient:      'e2ef1000-0000-4000-8000-000000000001',
  encounter:    'e2ef1000-0000-4000-8000-000000000002',
  bedAssignment:'e2ef1000-0000-4000-8000-000000000003',
  bedFree:      'e2ef1000-0000-4000-8000-0000000000b1',
  bedOccupied:  'e2ef1000-0000-4000-8000-0000000000b2',
  bedDirty:     'e2ef1000-0000-4000-8000-0000000000b3',
  bedMaint:     'e2ef1000-0000-4000-8000-0000000000b4',
  bedReserved:  'e2ef1000-0000-4000-8000-0000000000b5',
  bedFreeEr:    'e2ef1000-0000-4000-8000-0000000000b6',
  eceInstitucion:  'e2ef1000-0000-4000-8000-00000000e901',
  eceEstab:        'e2ef1000-0000-4000-8000-00000000e902',
  eceServicio:     'e2ef1000-0000-4000-8000-00000000e903',
  eceEpisodio:     'e2ef1000-0000-4000-8000-00000000e904',
  ecePersonal:     'e2ef1000-0000-4000-8000-00000000e905',
  eceAsignacion:   'e2ef1000-0000-4000-8000-00000000e906',
  eceIndicacion:   'e2ef1000-0000-4000-8000-00000000e907',
  gsrnNurseRef:    'e2ef1000-0000-4000-8000-00000000e908',
  gsrnNurseRevRef: 'e2ef1000-0000-4000-8000-00000000e909',
};

// GS1 — mismos valores que packages/test-utils/src/fixtures/bedside-hardstops.ts
// (prefijo 801874130000 + check digit módulo 10, calculado y verificado).
const GSRN_PACIENTE       = '801874130000000011'; // PAC HS-01
const GSRN_ENFERMERA      = '801874130000010010'; // ENF HS-01 (activa)
const GSRN_ENF_REVOCADA   = '801874130000010089'; // ENF HS-08 (revocada)
const GTIN_AMOXICILINA500 = '07501000001233';
const GTIN_IBUPROFENO400  = '07501000009998';

try {
  // ─── Resolver catálogos del seed base ─────────────────────────────────────
  const { rows: [country] }  = await c.query(`SELECT id FROM public."Country" LIMIT 1`);
  // Primera Organization con Establishment (la holding no tiene).
  const { rows: [estab] }    = await c.query(`SELECT id, "organizationId" FROM public."Establishment" LIMIT 1`);
  const orgId = estab?.organizationId;
  const { rows: units }      = await c.query(
    `SELECT id, code FROM public."ServiceUnit" WHERE "organizationId"=$1 AND code IN ('HOSP','ER')`,
    [orgId],
  );
  const unitHosp = units.find((u) => u.code === 'HOSP') ?? units[0];
  const unitEr   = units.find((u) => u.code === 'ER') ?? unitHosp;
  const { rows: [sex] }      = await c.query(`SELECT id FROM public."BiologicalSex" WHERE code='F' LIMIT 1`);
  const { rows: [currency] } = await c.query(`SELECT id FROM public."Currency" WHERE "isoCode"='USD' LIMIT 1`);

  if (!country || !orgId || !unitHosp || !sex || !currency) {
    throw new Error('Seed base incompleto — corre `npm run db:seed` primero');
  }

  // ─── 1. Camas (5 estados en HOSP + 1 FREE en ER) ─────────────────────────
  const beds = [
    { id: IDS.bedFree,     code: 'E2E-01', status: 'FREE',        unit: unitHosp.id },
    { id: IDS.bedOccupied, code: 'E2E-02', status: 'OCCUPIED',    unit: unitHosp.id },
    { id: IDS.bedDirty,    code: 'E2E-03', status: 'DIRTY',       unit: unitHosp.id },
    { id: IDS.bedMaint,    code: 'E2E-04', status: 'MAINTENANCE', unit: unitHosp.id },
    { id: IDS.bedReserved, code: 'E2E-05', status: 'RESERVED',    unit: unitHosp.id },
    { id: IDS.bedFreeEr,   code: 'E2E-06', status: 'FREE',        unit: unitEr.id },
  ];
  for (const b of beds) {
    await c.query(
      `INSERT INTO public."Bed"
         (id, "organizationId", "establishmentId", "serviceUnitId", code, status,
          active, "createdAt", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::"BedStatus",
               true, now(), now())
       ON CONFLICT ("establishmentId", code)
         DO UPDATE SET status = EXCLUDED.status, "updatedAt" = now()`,
      [b.id, orgId, estab.id, b.unit, b.code, b.status],
    );
  }
  console.log(`beds=${beds.length}`);

  // ─── 2. Paciente + Encounter abierto + BedAssignment ─────────────────────
  const MRN = 'E2E-MARIA-PEREZ-01';
  const { rows: [patient] } = await c.query(
    `INSERT INTO public."Patient"
       (id, "organizationId", mrn, "firstName", "lastName", "biologicalSexId",
        "isUnknown", gsrn, "createdAt", "updatedAt")
     VALUES ($1::uuid, $2::uuid, $3, 'María', 'Pérez', $4::uuid, false, $5, now(), now())
     ON CONFLICT ("organizationId", mrn)
       DO UPDATE SET gsrn = EXCLUDED.gsrn, "updatedAt" = now()
     RETURNING id`,
    [IDS.patient, orgId, MRN, sex.id, GSRN_PACIENTE],
  );
  const patientId = patient.id;

  // encounterNumber con formato ENC-\d{4}-\d{6} (bed-map/transfers lo muestran).
  const encNumber = `ENC-${new Date().getUTCFullYear()}-000101`;
  await c.query(
    `INSERT INTO public."Encounter"
       (id, "countryId", "organizationId", "establishmentId", "serviceUnitId",
        "patientId", "admissionType", "encounterNumber", "admittedAt",
        "currencyId", "exchangeRateToFunc", "createdAt", "updatedAt")
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
             'EMERGENCY'::"AdmissionType", $7, now(), $8::uuid, 1.0, now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [IDS.encounter, country.id, orgId, estab.id, unitHosp.id, patientId, encNumber, currency.id],
  );

  await c.query(
    `INSERT INTO public."BedAssignment"
       (id, "encounterId", "bedId", "assignedAt", reason, "createdAt")
     VALUES ($1::uuid, $2::uuid, $3::uuid, now(), 'Fixture E2E', now())
     ON CONFLICT (id) DO NOTHING`,
    [IDS.bedAssignment, IDS.encounter, IDS.bedOccupied],
  );
  console.log(`patient=${patientId.slice(0, 8)} encounter=${encNumber}`);

  // ─── 3. Espejo ECE (para /beds → eceCama.mapCompleto) ────────────────────
  await c.query(
    `INSERT INTO ece.institucion (id, codigo, nombre, tipo, organization_id)
     VALUES ($1::uuid, 'E2E-INST', 'Institución E2E', 'privado', $2::uuid)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.eceInstitucion, orgId],
  );
  await c.query(
    `INSERT INTO ece.establecimiento
       (id, institucion_id, codigo, nombre, nivel_atencion, establishment_id)
     VALUES ($1::uuid, $2::uuid, 'E2E-EST', 'Hospital E2E', 'hospitalario', $3::uuid)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.eceEstab, IDS.eceInstitucion, estab.id],
  );
  await c.query(
    `INSERT INTO ece.servicio (id, establecimiento_id, codigo, nombre, categoria)
     VALUES ($1::uuid, $2::uuid, 'HOSP', 'Hospitalización', 'hospitalizacion')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.eceServicio, IDS.eceEstab],
  );
  // ece.cama espeja public."Bed" con el MISMO id (convención bridge-bed-to-ece-cama).
  for (const b of beds) {
    await c.query(
      `INSERT INTO ece.cama (id, servicio_id, codigo, estado)
       VALUES ($1::uuid, $2::uuid, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [b.id, IDS.eceServicio, b.code, b.status === 'OCCUPIED' ? 'ocupada' : 'disponible'],
    );
  }
  // ece.paciente espeja public."Patient" con el MISMO id (bridge-patient).
  await c.query(
    `INSERT INTO ece.paciente (id, establecimiento_id, numero_expediente)
     VALUES ($1::uuid, $2::uuid, 'E2E-00001')
     ON CONFLICT (id) DO NOTHING`,
    [patientId, IDS.eceEstab],
  );
  await c.query(
    `INSERT INTO ece.personal_salud
       (id, institucion_id, establecimiento_id, documento_identidad, nombre_completo, profesion)
     VALUES ($1::uuid, $2::uuid, $3::uuid, '00000000-1', 'Dra. E2E Prescriptora', 'Medicina General')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ecePersonal, IDS.eceInstitucion, IDS.eceEstab],
  );
  await c.query(
    `INSERT INTO ece.episodio_atencion
       (id, paciente_id, establecimiento_id, modalidad, servicio_categoria,
        servicio_id, estado, public_encounter_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'hospitalario', 'hospitalizacion',
             $4::uuid, 'abierto', $5::uuid)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.eceEpisodio, patientId, IDS.eceEstab, IDS.eceServicio, IDS.encounter],
  );
  await c.query(
    `INSERT INTO ece.episodio_hospitalario
       (episodio_id, circunstancia_ingreso, procedencia_ingreso,
        modalidad_hospitalaria, fecha_hora_orden_ingreso, servicio_id, cama_id)
     VALUES ($1::uuid, 'emergencia', 'emergencia', 'hospitalizacion', now(),
             $2::uuid, $3::uuid)
     ON CONFLICT (episodio_id) DO NOTHING`,
    [IDS.eceEpisodio, IDS.eceServicio, IDS.bedOccupied],
  );
  await c.query(
    `INSERT INTO ece.asignacion_cama (id, episodio_id, cama_id, desde, hasta)
     VALUES ($1::uuid, $2::uuid, $3::uuid, now(), NULL)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.eceAsignacion, IDS.eceEpisodio, IDS.bedOccupied],
  );
  console.log(`ece episodio=${IDS.eceEpisodio.slice(0, 8)} asignacion=ocupada`);

  // ─── 4. GS1 escaneable: GSRN + catálogo GTIN ─────────────────────────────
  const gsrns = [
    { gsrn: GSRN_PACIENTE, tipo: 'paciente', ref: patientId, activo: true,
      desc: 'Pulsera E2E — María Pérez' },
    { gsrn: GSRN_ENFERMERA, tipo: 'profesional', ref: IDS.gsrnNurseRef, activo: true,
      desc: 'Badge E2E — enfermera activa' },
    { gsrn: GSRN_ENF_REVOCADA, tipo: 'profesional', ref: IDS.gsrnNurseRevRef, activo: false,
      desc: 'Badge E2E — enfermera revocada (HS-08)' },
  ];
  for (const g of gsrns) {
    await c.query(
      // $1 no puede reutilizarse para gsrn (varchar) y codigo (char(18)) a la
      // vez — Postgres deduce tipos inconsistentes (42P08). Parámetros aparte.
      `INSERT INTO ece.gs1_gsrn (gsrn, codigo, tipo, referencia_id, activo, descripcion)
       VALUES ($1, $2, $3, $4::uuid, $5, $6)
       ON CONFLICT (gsrn) DO UPDATE SET referencia_id = EXCLUDED.referencia_id,
                                        activo = EXCLUDED.activo`,
      [g.gsrn, g.gsrn, g.tipo, g.ref, g.activo, g.desc],
    );
  }
  const gtins = [
    { codigo: GTIN_AMOXICILINA500, descripcion: 'Amoxicilina 500mg — Cápsula',
      presentacion: '500mg', principio: 'Amoxicilina', atc: 'J01CA04' },
    { codigo: GTIN_IBUPROFENO400, descripcion: 'Ibuprofeno 400mg — Tableta',
      presentacion: '400mg', principio: 'Ibuprofeno', atc: 'M01AE01' },
  ];
  for (const g of gtins) {
    await c.query(
      `INSERT INTO ece.gs1_gtin
         (codigo, descripcion, fabricante, presentacion, contenido_unidades,
          principio_activo, codigo_atc, principios_activos, excipientes_alergenos)
       VALUES ($1, $2, 'Laboratorios QA Test SV', $3, 1, $4, $5,
               ARRAY[$6]::text[], '{}'::text[])
       ON CONFLICT (codigo) DO NOTHING`,
      [g.codigo, g.descripcion, g.presentacion, g.principio, g.atc, g.principio],
    );
  }
  console.log(`gsrn=${gsrns.length} gtin=${gtins.length}`);

  // ─── 5. Indicación firmada + item MEDICAMENTO (cola /bedside) ────────────
  await c.query(
    `INSERT INTO ece.indicaciones_medicas
       (id, episodio_id, paciente_id, fecha_hora, vigencia, medico_prescriptor,
        estado_registro)
     VALUES ($1::uuid, $2::uuid, $3::uuid, now(), 'ACTIVA', $4::uuid, 'firmado')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.eceIndicacion, IDS.eceEpisodio, patientId, IDS.ecePersonal],
  );
  await c.query(
    `INSERT INTO ece.indicacion_item
       (indicacion_id, tipo, descripcion, dosis, via, frecuencia, frecuencia_horas)
     SELECT $1::uuid, 'MEDICAMENTO', $2, '500mg', 'IV', 'cada 8 horas', 8
     WHERE NOT EXISTS (
       SELECT 1 FROM ece.indicacion_item WHERE indicacion_id = $1::uuid
     )`,
    [IDS.eceIndicacion, GTIN_AMOXICILINA500],
  );
  console.log('indicacion=firmada/ACTIVA');

  // ─── Verificación final ───────────────────────────────────────────────────
  const { rows: [chk] } = await c.query(
    `SELECT
       (SELECT count(*)::int FROM public."Bed" WHERE code LIKE 'E2E-%')        AS beds,
       (SELECT count(*)::int FROM public."Encounter"
         WHERE "patientId"=$1::uuid AND "dischargedAt" IS NULL)                AS open_enc,
       (SELECT count(*)::int FROM ece.asignacion_cama WHERE hasta IS NULL)     AS asignaciones,
       (SELECT count(*)::int FROM ece.gs1_gsrn WHERE gsrn = ANY($2::text[]))   AS gsrns`,
    [patientId, [GSRN_PACIENTE, GSRN_ENFERMERA, GSRN_ENF_REVOCADA]],
  );
  console.log(`check beds=${chk.beds} open_enc=${chk.open_enc} asignaciones=${chk.asignaciones} gsrns=${chk.gsrns}`);
  if (chk.beds < 6 || chk.open_enc < 1 || chk.asignaciones < 1 || chk.gsrns < 3) {
    throw new Error('Verificación de fixtures falló — revisar salida anterior');
  }
} finally {
  await c.end();
}
console.log('done');
