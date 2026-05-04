// Seed mínimo para E2E clínicos: 1 paciente "María Pérez" + 1 encounter
// admitido hoy sin triage completed → aparece en queue de /triage.
// Idempotente vía MRN único + check de encounter del día.
import pg from 'pg';

const db = process.env.DIRECT_URL;
if (!db) { console.error('DIRECT_URL faltante'); process.exit(2); }

const cleanUrl = db.replace(/[?&]sslmode=[^&]*/g, '').replace('?&', '?').replace(/[?&]$/, '');
const c = new pg.Client({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } });
await c.connect();

try {
  // Resolver FKs desde catálogos seed.
  const { rows: [country] }  = await c.query(`SELECT id FROM public."Country" LIMIT 1`);
  // Tomar la primera Organization que tenga Establishment (la holding no tiene).
  const { rows: [estab] }    = await c.query(`SELECT id, "organizationId" FROM public."Establishment" LIMIT 1`);
  const org = { id: estab?.organizationId };
  const { rows: [unit] }     = await c.query(`SELECT id FROM public."ServiceUnit" WHERE "organizationId"=$1 LIMIT 1`, [org.id]);
  const { rows: [sex] }      = await c.query(`SELECT id FROM public."BiologicalSex" LIMIT 1`);
  const { rows: [currency] } = await c.query(`SELECT id FROM public."Currency" LIMIT 1`);

  if (!country || !org || !estab || !unit || !sex || !currency) {
    throw new Error('Seed base incompleto — corre `npm run db:seed` primero');
  }

  // Paciente: idempotente por MRN.
  const MRN = 'E2E-MARIA-PEREZ-01';
  const { rows: [patient] } = await c.query(
    `INSERT INTO public."Patient"
       (id, "organizationId", mrn, "firstName", "lastName", "biologicalSexId",
        "isUnknown", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1::uuid, $2, 'María', 'Pérez', $3::uuid,
             false, now(), now())
     ON CONFLICT ("organizationId", mrn) DO UPDATE SET "updatedAt" = now()
     RETURNING id`,
    [org.id, MRN, sex.id]
  );

  // Encounter: idempotente por número (1 por día tagueado).
  const today = new Date();
  const yyyymmdd = today.toISOString().slice(0,10).replaceAll('-','');
  const ENC_NUMBER = `E2E-${yyyymmdd}-001`;

  await c.query(
    `INSERT INTO public."Encounter"
       (id, "countryId", "organizationId", "establishmentId", "serviceUnitId",
        "patientId", "admissionType", "encounterNumber", "admittedAt",
        "currencyId", "exchangeRateToFunc", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid,
             $5::uuid, 'EMERGENCY'::"AdmissionType", $6,
             now(), $7::uuid, 1.0, now(), now())
     ON CONFLICT DO NOTHING`,
    [country.id, org.id, estab.id, unit.id, patient.id, ENC_NUMBER, currency.id]
  );

  // Verificar
  const { rows: [r] } = await c.query(
    `SELECT count(*)::int as n FROM public."Encounter"
       WHERE "patientId"=$1::uuid AND "dischargedAt" IS NULL
         AND "admittedAt" >= date_trunc('day', now())`,
    [patient.id]
  );
  console.log(`patient=${patient.id.slice(0,8)} encounters_today_open=${r.n}`);
} finally {
  await c.end();
}
console.log('done');
