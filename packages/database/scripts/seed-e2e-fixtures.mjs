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
  ecePersonalNurse:'e2ef1000-0000-4000-8000-00000000e90a',
  eceAsignacion:   'e2ef1000-0000-4000-8000-00000000e906',
  eceIndicacion:   'e2ef1000-0000-4000-8000-00000000e907',
  gsrnNurseRef:    'e2ef1000-0000-4000-8000-00000000e908',
  gsrnNurseRevRef: 'e2ef1000-0000-4000-8000-00000000e909',
  drug:            'e2ef1000-0000-4000-8000-00000000d001',
  prescription:    'e2ef1000-0000-4000-8000-00000000d002',
  prescriptionItem:'e2ef1000-0000-4000-8000-00000000d003',
};

// GS1 — mismos valores que packages/test-utils/src/fixtures/bedside-hardstops.ts
// (prefijo 801874130000 + check digit módulo 10, calculado y verificado).
const GSRN_PACIENTE       = '801874130000000011'; // PAC HS-01
const GSRN_ENFERMERA      = '801874130000010010'; // ENF HS-01 (activa)
const GSRN_ENF_REVOCADA   = '801874130000010089'; // ENF HS-08 (revocada)
const GTIN_AMOXICILINA500 = '07501000001231';
const GTIN_IBUPROFENO400  = '07501000009992';

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
  // his_user_id enlaza el personal ECE con los usuarios QA de GoTrue (creados
  // por seed-test-users.mjs en el paso anterior). buildEceCtx (p. ej.
  // eceWhoChecklist.get) exige ece.personal_salud.his_user_id = ctx.user.id —
  // sin esto los routers ECE con contexto de personal dan PRECONDITION_FAILED.
  const { rows: [qaPhysician] } = await c.query(
    `SELECT id FROM public."User" WHERE email = 'qa.physician@his.test' LIMIT 1`,
  );
  const { rows: [qaNurse] } = await c.query(
    `SELECT id FROM public."User" WHERE email = 'qa.nurse@his.test' LIMIT 1`,
  );
  await c.query(
    `INSERT INTO ece.personal_salud
       (id, institucion_id, establecimiento_id, documento_identidad,
        nombre_completo, profesion, his_user_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, '00000000-1', 'Dra. E2E Prescriptora',
             'Medicina General', $4::uuid)
     ON CONFLICT (id) DO UPDATE SET his_user_id = EXCLUDED.his_user_id`,
    [IDS.ecePersonal, IDS.eceInstitucion, IDS.eceEstab, qaPhysician?.id ?? null],
  );
  if (qaNurse) {
    await c.query(
      `INSERT INTO ece.personal_salud
         (id, institucion_id, establecimiento_id, documento_identidad,
          nombre_completo, profesion, his_user_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, '00000000-2', 'Enf. E2E Bedside',
               'Enfermería', $4::uuid)
       ON CONFLICT (id) DO UPDATE SET his_user_id = EXCLUDED.his_user_id`,
      [IDS.ecePersonalNurse, IDS.eceInstitucion, IDS.eceEstab, qaNurse.id],
    );
  }
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

  // ─── 6. Receta conciliada por farmacia (camino feliz BCMA) ────────────────
  // administration.record resuelve el PrescriptionItem vía la cola R04
  // ece.indicacion_farmacia_pendiente con estado=RECONCILIADO (sql/201+222).
  // Sembramos el resultado de esa conciliación: Drug estructurado + receta
  // SIGNED + fila de cola conciliada apuntando al item. alertLevel 'standard'
  // a propósito — el double-check IPSG.3 ME 4 tiene su propio flujo de UI y
  // no es parte del camino feliz del wizard.
  await c.query(
    `INSERT INTO public."Drug"
       (id, "genericName", "brandName", "pharmaceuticalForm", "strengthValue",
        "strengthUnit", "dispensingClass", active, "alertLevel", "createdAt", "updatedAt")
     VALUES ($1::uuid, 'Amoxicilina', 'Amoxi QA 500', 'CAPSULE', 500, 'mg',
             'RX', true, 'standard', now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [IDS.drug],
  );
  await c.query(
    `INSERT INTO public."Prescription"
       (id, "organizationId", "encounterId", "prescriberId", "patientId",
        status, "signedAt", "createdAt", "updatedAt")
     SELECT $1::uuid, $2::uuid, $3::uuid, u.id, $4::uuid,
            'SIGNED', now(), now(), now()
       FROM public."User" u LIMIT 1
     ON CONFLICT (id) DO NOTHING`,
    [IDS.prescription, orgId, IDS.encounter, patientId],
  );
  await c.query(
    `INSERT INTO public."PrescriptionItem"
       (id, "prescriptionId", "drugId", dosage, route, frequency, "prescribedQty")
     VALUES ($1::uuid, $2::uuid, $3::uuid, '500mg cada 8h', 'IV', 'cada 8 horas', 6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.prescriptionItem, IDS.prescription, IDS.drug],
  );
  await c.query(
    `INSERT INTO ece.indicacion_farmacia_pendiente
       (indicacion_id, indicacion_item_id, episodio_id, medico_prescriptor,
        descripcion, dosis, via, frecuencia, estado, prescription_item_id,
        reconciliado_en, reconciliado_por)
     SELECT $1::uuid, ii.id, $2::uuid, $3::uuid,
            ii.descripcion, ii.dosis, ii.via, ii.frecuencia,
            'RECONCILIADO', $4::uuid, now(), $3::uuid
       FROM ece.indicacion_item ii
      WHERE ii.indicacion_id = $1::uuid
      LIMIT 1
     ON CONFLICT (indicacion_item_id) DO UPDATE
       SET estado = 'RECONCILIADO',
           prescription_item_id = EXCLUDED.prescription_item_id`,
    [IDS.eceIndicacion, IDS.eceEpisodio, IDS.ecePersonal, IDS.prescriptionItem],
  );
  console.log('receta=SIGNED conciliacion=RECONCILIADO');

  // ─── 7. RN-HIS-BOT-001 (docs/48 C5-2) — tarifario de prueba + cuentas ────
  // Fixtures para las 8 pruebas de aceptación de docs/47 §4 (spec:
  // apps/web/e2e/cargos-rn-bot-001.spec.ts). "ServicePriceList"/
  // "ServicePriceListItem"/"ServicePriceRule" son tablas fuera de
  // schema.prisma (drift documentado, sql/133 + sql/204 + sql/228) — el
  // workflow E2E las crea con `prisma db execute` ANTES de este seeder (ver
  // .github/workflows/e2e.yml / e2e-smoke.yml, paso "Bootstrap RLS
  // helpers"). Si corrés este script localmente sin ese paso, fallará con
  // "relation \"ServicePriceList\" does not exist".
  //
  // 7 pacientes dedicados, uno por escenario de precio — NO se reutiliza un
  // solo paciente con varias cuentas: `capturarCargo`→`resolverCuentaActiva`
  // (packages/trpc/src/lib/charge-capture.ts) cae a "la cuenta ACTIVA más
  // reciente del paciente" cuando no hay match de encounterId, así que dos
  // cuentas del mismo paciente harían que el escenario más viejo se
  // resolviera contra la cuenta del más nuevo — un paciente por escenario
  // elimina esa ambigüedad por diseño, no por disciplina de test.
  //
  // Ids deterministas con prefijo e2ef2000 (namespace propio, no colisiona
  // con el bloque e2ef1000 de arriba): botId(escena, rol), escena 1-7 en el
  // orden de `BOT_SCENARIOS`, rol de 2 dígitos por tipo de fila. Espejado en
  // apps/web/e2e/_helpers/fixtures.ts (E2E_BOT) — mismo esquema en ambos
  // archivos, actualizar los dos en el mismo commit.
  function botId(escena, rol) {
    return `e2ef2000-0000-4000-8000-000000000${escena}${rol}`;
  }

  const BOT = {
    isbmTipo: 'e2ef2000-0000-4000-8000-000000000801',
    mapfreTipo: 'e2ef2000-0000-4000-8000-000000000802',
    doctorsvTipo: 'e2ef2000-0000-4000-8000-000000000803',
    isbmList: 'e2ef2000-0000-4000-8000-000000000901',
    mapfreList: 'e2ef2000-0000-4000-8000-000000000902',
    doctorsvList: 'e2ef2000-0000-4000-8000-000000000903',
    defaultList: 'e2ef2000-0000-4000-8000-000000000904',
    isbmRule: 'e2ef2000-0000-4000-8000-000000000a01',
    tarifaHoyRule: 'e2ef2000-0000-4000-8000-000000000a02',
    mapfreItem: 'e2ef2000-0000-4000-8000-000000000b01',
    doctorsvItem: 'e2ef2000-0000-4000-8000-000000000b02',
    defaultItem: 'e2ef2000-0000-4000-8000-000000000b03',
    devolucionItem: 'e2ef2000-0000-4000-8000-000000000b04',
  };

  // 4 listas de precio: ISBM (via ServicePriceRule — cubre el camino
  // "regla" del resolver) + MAPFRE/DoctorSV (via ServicePriceListItem plano
  // — cubre el camino "lista") + DEFAULT (isDefault=true, org-wide,
  // resuelve la cuenta de emergencia sin tipoCuentaId).
  const priceLists = [
    { id: BOT.isbmList, name: 'E2E — ISBM Licitación', isDefault: false },
    { id: BOT.mapfreList, name: 'E2E — MAPFRE Seguro', isDefault: false },
    { id: BOT.doctorsvList, name: 'E2E — DoctorSV', isDefault: false },
    { id: BOT.defaultList, name: 'E2E — Default Complejo', isDefault: true },
  ];
  for (const pl of priceLists) {
    await c.query(
      `INSERT INTO "ServicePriceList" (id, "organizationId", name, "currencyId", active, "isDefault")
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, true, $5)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, "isDefault" = EXCLUDED."isDefault"`,
      [pl.id, orgId, pl.name, currency.id, pl.isDefault],
    );
  }

  const tiposCuenta = [
    { id: BOT.isbmTipo, code: 'ISBM_TEST', nombre: 'ISBM (E2E test)', priceListId: BOT.isbmList },
    { id: BOT.mapfreTipo, code: 'MAPFRE_TEST', nombre: 'MAPFRE (E2E test)', priceListId: BOT.mapfreList },
    { id: BOT.doctorsvTipo, code: 'DOCTORSV_TEST', nombre: 'DoctorSV (E2E test)', priceListId: BOT.doctorsvList },
  ];
  for (const tc of tiposCuenta) {
    await c.query(
      `INSERT INTO "TipoCuenta" (id, "organizationId", code, nombre, "priceListId", "esParticular", active)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, false, true)
       ON CONFLICT (id) DO UPDATE SET "priceListId" = EXCLUDED."priceListId", nombre = EXCLUDED.nombre`,
      [tc.id, orgId, tc.code, tc.nombre, tc.priceListId],
    );
  }

  // Ítems planos — prueba #2 (MAPFRE), #3 (DoctorSV), #7 (default de
  // emergencia) y el insumo de #6 (devolución, misma lista MAPFRE).
  const flatItems = [
    { id: BOT.mapfreItem, list: BOT.mapfreList, code: 'BOT-E2E-MAPFRE', desc: 'Insumo E2E — MAPFRE', price: 18.75 },
    { id: BOT.doctorsvItem, list: BOT.doctorsvList, code: 'BOT-E2E-DOCTORSV', desc: 'Insumo E2E — DoctorSV', price: 9.99 },
    { id: BOT.defaultItem, list: BOT.defaultList, code: 'BOT-E2E-EMERGENCIA', desc: 'Insumo E2E — Emergencia (lista default)', price: 5.00 },
    { id: BOT.devolucionItem, list: BOT.mapfreList, code: 'BOT-E2E-DEVOLUCION', desc: 'Insumo E2E — Devolución', price: 7.25 },
  ];
  for (const it of flatItems) {
    await c.query(
      `INSERT INTO "ServicePriceListItem" (id, "priceListId", code, description, "unitPrice", active)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::numeric, true)
       ON CONFLICT (id) DO UPDATE SET "unitPrice" = EXCLUDED."unitPrice"`,
      [it.id, it.list, it.code, it.desc, it.price],
    );
  }

  // Reglas explícitas — prueba #1 (ISBM, camino "regla" del resolver) y el
  // precio INICIAL de #8 (tarifahoy; el spec agrega una 2ª regla "hoy" vía
  // servicePriceList.addRule, la API real — no seed). dateStart=ayer: la
  // regla ya está vigente cuando el spec corre "hoy".
  const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rules = [
    { id: BOT.isbmRule, list: BOT.isbmList, code: 'BOT-E2E-ISBM', price: 12.50 },
    { id: BOT.tarifaHoyRule, list: BOT.isbmList, code: 'BOT-E2E-TARIFAHOY', price: 15.00 },
  ];
  for (const r of rules) {
    await c.query(
      `INSERT INTO "ServicePriceRule"
         (id, "priceListId", "appliedOn", "itemCode", "minQuantity", "dateStart",
          "computePrice", "fixedPrice", base, active)
       VALUES ($1::uuid, $2::uuid, 'item', $3, 0, $4::timestamptz, 'fixed', $5::numeric, 'list_price', true)
       ON CONFLICT (id) DO UPDATE SET "fixedPrice" = EXCLUDED."fixedPrice"`,
      [r.id, r.list, r.code, ayer, r.price],
    );
  }
  console.log(`priceLists=${priceLists.length} tiposCuenta=${tiposCuenta.length} items=${flatItems.length} rules=${rules.length}`);

  // 7 escenarios — un paciente+cuenta+receta+lote GS1 dedicados por prueba.
  // GTIN-14 con checksum GS1 válido (mismo algoritmo mod10 que los GTIN de
  // §4 arriba — verificado con Node antes de escribir este archivo).
  const BOT_SCENARIOS = [
    { escena: 1, key: 'isbm', mrn: 'E2E-BOT-ISBM-01', tipoCuentaId: BOT.isbmTipo, accountStatus: 'ABIERTA',
      admissionType: 'SCHEDULED', code: 'BOT-E2E-ISBM', gtin: '07501000020010',
      lote: 'LOTE-E2E-ISBM-01', drugName: 'Botiquín E2E — ISBM' },
    { escena: 2, key: 'mapfre', mrn: 'E2E-BOT-MAPFRE-01', tipoCuentaId: BOT.mapfreTipo, accountStatus: 'ABIERTA',
      admissionType: 'SCHEDULED', code: 'BOT-E2E-MAPFRE', gtin: '07501000030019',
      lote: 'LOTE-E2E-MAPFRE-01', drugName: 'Botiquín E2E — MAPFRE' },
    { escena: 3, key: 'doctorsv', mrn: 'E2E-BOT-DOCTORSV-01', tipoCuentaId: BOT.doctorsvTipo, accountStatus: 'ABIERTA',
      admissionType: 'SCHEDULED', code: 'BOT-E2E-DOCTORSV', gtin: '07501000040018',
      lote: 'LOTE-E2E-DOCTORSV-01', drugName: 'Botiquín E2E — DoctorSV' },
    { escena: 4, key: 'sinprecio', mrn: 'E2E-BOT-SINPRECIO-01', tipoCuentaId: BOT.isbmTipo, accountStatus: 'ABIERTA',
      admissionType: 'SCHEDULED', code: 'BOT-E2E-SINPRECIO', gtin: '07501000050017',
      lote: 'LOTE-E2E-SINPRECIO-01', drugName: 'Botiquín E2E — Sin Precio' },
    { escena: 5, key: 'devolucion', mrn: 'E2E-BOT-DEVOLUCION-01', tipoCuentaId: BOT.mapfreTipo, accountStatus: 'ABIERTA',
      admissionType: 'SCHEDULED', code: 'BOT-E2E-DEVOLUCION', gtin: '07501000060016',
      lote: 'LOTE-E2E-DEVOLUCION-01', drugName: 'Botiquín E2E — Devolución' },
    { escena: 6, key: 'emergencia', mrn: 'E2E-BOT-EMERGENCIA-01', tipoCuentaId: null, accountStatus: 'PENDIENTE_REGULARIZAR',
      admissionType: 'EMERGENCY', code: 'BOT-E2E-EMERGENCIA', gtin: '07501000070015',
      lote: 'LOTE-E2E-EMERGENCIA-01', drugName: 'Botiquín E2E — Emergencia' },
    { escena: 7, key: 'tarifahoy', mrn: 'E2E-BOT-TARIFAHOY-01', tipoCuentaId: BOT.isbmTipo, accountStatus: 'ABIERTA',
      admissionType: 'SCHEDULED', code: 'BOT-E2E-TARIFAHOY', gtin: '07501000080014',
      lote: 'LOTE-E2E-TARIFAHOY-01', drugName: 'Botiquín E2E — Tarifario Hoy' },
  ];

  if (!qaPhysician) {
    throw new Error(
      'qa.physician@his.test no existe en public."User" — corré seed-test-users.mjs antes de este script (RN-HIS-BOT-001 necesita un prescriptor real).',
    );
  }

  for (const s of BOT_SCENARIOS) {
    const patientIdBot = botId(s.escena, '01');
    const encounterIdBot = botId(s.escena, '03');
    const accountIdBot = botId(s.escena, '02');
    const drugIdBot = botId(s.escena, '06');
    const prescriptionIdBot = botId(s.escena, '04');
    const prescriptionItemIdBot = botId(s.escena, '05');
    const stockItemIdBot = botId(s.escena, '07');
    const stockLotIdBot = botId(s.escena, '08');

    await c.query(
      `INSERT INTO public."Patient"
         (id, "organizationId", mrn, "firstName", "lastName", "biologicalSexId",
          "isUnknown", "createdAt", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3, 'Paciente', $4, $5::uuid, false, now(), now())
       ON CONFLICT ("organizationId", mrn) DO UPDATE SET "updatedAt" = now()`,
      [patientIdBot, orgId, s.mrn, `RN-BOT-001 (${s.key})`, sex.id],
    );

    // Prescription exige encounterId NOT NULL (FK) — un Encounter dedicado
    // por escenario, ya cerrado (dischargedAt=now()) para no aparecer en
    // /transfers ni en conteos de "encuentros abiertos" de otros specs.
    await c.query(
      `INSERT INTO public."Encounter"
         (id, "countryId", "organizationId", "establishmentId", "serviceUnitId",
          "patientId", "admissionType", "encounterNumber", "admittedAt",
          "dischargedAt", "currencyId", "exchangeRateToFunc", "createdAt", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
               $7::"AdmissionType", $8, now(), now(), $9::uuid, 1.0, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [encounterIdBot, country.id, orgId, estab.id, unitHosp.id, patientIdBot,
        s.admissionType, `ENC-${new Date().getUTCFullYear()}-0002${String(s.escena).padStart(2, '0')}`, currency.id],
    );

    await c.query(
      `INSERT INTO public."PatientAccount"
         (id, "organizationId", "patientId", "numeroCuenta", "tipoCuentaId", status, "createdAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'CTA00001', $4::uuid, $5::"AccountStatus", now())
       ON CONFLICT (id) DO UPDATE SET "tipoCuentaId" = EXCLUDED."tipoCuentaId", status = EXCLUDED.status`,
      [accountIdBot, orgId, patientIdBot, s.tipoCuentaId, s.accountStatus],
    );

    await c.query(
      `INSERT INTO public."Drug"
         (id, "genericName", "pharmaceuticalForm", "strengthValue", "strengthUnit",
          "dispensingClass", active, "alertLevel", "createdAt", "updatedAt")
       VALUES ($1::uuid, $2, 'TABLET'::"PharmaceuticalForm", 500, 'mg',
               'RX'::"DispensingClass", true, 'standard', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [drugIdBot, s.drugName],
    );

    // prescriberId = qaPhysician (ya resuelto arriba, §3) — R9 exige que sea
    // distinto de quien dispensa; los specs dispensan logueados como "admin".
    await c.query(
      `INSERT INTO public."Prescription"
         (id, "organizationId", "encounterId", "prescriberId", "patientId",
          status, "signedAt", "createdAt", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
               'SIGNED'::"PrescriptionStatus", now(), now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [prescriptionIdBot, orgId, encounterIdBot, qaPhysician.id, patientIdBot],
    );

    await c.query(
      `INSERT INTO public."PrescriptionItem"
         (id, "prescriptionId", "drugId", dosage, route, frequency, "prescribedQty")
       VALUES ($1::uuid, $2::uuid, $3::uuid, '1 tableta', 'ORAL'::"AdminRoute", 'cada 8 horas', 10)
       ON CONFLICT (id) DO NOTHING`,
      [prescriptionItemIdBot, prescriptionIdBot, drugIdBot],
    );

    // StockItem.sku = el `code` del tarifario — así `capturarCargo` (que usa
    // sku como código de cargo cuando el GTIN resuelve a un StockItem real,
    // ver dispensation.router.ts codigoCargoDispensacion) llega exactamente
    // al code sembrado arriba en ServicePriceListItem/Rule.
    await c.query(
      `INSERT INTO public."StockItem"
         (id, "organizationId", sku, name, "unitOfMeasure", category, "trackLots", gtin, active, "createdAt", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3, $4, 'UN', 'MEDICAMENTO', true, $5, true, now(), now())
       ON CONFLICT ("organizationId", sku) DO UPDATE SET gtin = EXCLUDED.gtin`,
      [stockItemIdBot, orgId, s.code, s.drugName, s.gtin],
    );

    await c.query(
      `INSERT INTO public."StockLot"
         (id, "organizationId", "establishmentId", "itemId", "lotNumber",
          "gtinFisico", "expiryDate", "qualityStatus", "quantityOnHand", active, "createdAt", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, (CURRENT_DATE + interval '1 year'),
               'AVAILABLE', 20, true, now(), now())
       ON CONFLICT ("organizationId", "establishmentId", "itemId", "lotNumber")
         DO UPDATE SET "quantityOnHand" = 20, "qualityStatus" = 'AVAILABLE'`,
      [stockLotIdBot, orgId, estab.id, stockItemIdBot, s.lote, s.gtin],
    );
  }
  console.log(`RN-HIS-BOT-001: ${BOT_SCENARIOS.length} escenarios sembrados (patient+encounter+cuenta+receta+stock)`);

  const { rows: [chkBot] } = await c.query(
    `SELECT
       (SELECT count(*)::int FROM "ServicePriceList" WHERE id = ANY($1::uuid[]))     AS listas,
       (SELECT count(*)::int FROM "TipoCuenta" WHERE id = ANY($2::uuid[]))           AS tipos,
       (SELECT count(*)::int FROM public."StockLot" lot
          JOIN public."StockItem" si ON si.id = lot."itemId"
         WHERE si.sku = ANY($3::text[]) AND lot."quantityOnHand" >= 10)              AS lotes,
       (SELECT count(*)::int FROM public."PatientAccount" WHERE id = ANY($4::uuid[])) AS cuentas`,
    [
      priceLists.map((p) => p.id),
      tiposCuenta.map((t) => t.id),
      BOT_SCENARIOS.map((s) => s.code),
      BOT_SCENARIOS.map((s) => botId(s.escena, '02')),
    ],
  );
  console.log(`check RN-HIS-BOT-001: listas=${chkBot.listas} tipos=${chkBot.tipos} lotes=${chkBot.lotes} cuentas=${chkBot.cuentas}`);
  if (chkBot.listas < 4 || chkBot.tipos < 3 || chkBot.lotes < 7 || chkBot.cuentas < 7) {
    throw new Error('Verificación de fixtures RN-HIS-BOT-001 falló — revisar salida anterior');
  }

  // ─── Verificación final ───────────────────────────────────────────────────
  const { rows: [chk] } = await c.query(
    `SELECT
       (SELECT count(*)::int FROM public."Bed" WHERE code LIKE 'E2E-%')        AS beds,
       (SELECT count(*)::int FROM public."Encounter"
         WHERE "patientId"=$1::uuid AND "dischargedAt" IS NULL)                AS open_enc,
       (SELECT count(*)::int FROM ece.asignacion_cama WHERE hasta IS NULL)     AS asignaciones,
       (SELECT count(*)::int FROM ece.gs1_gsrn WHERE gsrn = ANY($2::text[]))   AS gsrns,
       (SELECT count(*)::int FROM ece.indicacion_farmacia_pendiente
         WHERE indicacion_id = $3::uuid AND estado = 'RECONCILIADO'
           AND prescription_item_id IS NOT NULL)                               AS reconciliadas`,
    [patientId, [GSRN_PACIENTE, GSRN_ENFERMERA, GSRN_ENF_REVOCADA], IDS.eceIndicacion],
  );
  console.log(`check beds=${chk.beds} open_enc=${chk.open_enc} asignaciones=${chk.asignaciones} gsrns=${chk.gsrns} reconciliadas=${chk.reconciliadas}`);
  if (chk.beds < 6 || chk.open_enc < 1 || chk.asignaciones < 1 || chk.gsrns < 3 || chk.reconciliadas < 1) {
    throw new Error('Verificación de fixtures falló — revisar salida anterior');
  }
} finally {
  await c.end();
}
console.log('done');
