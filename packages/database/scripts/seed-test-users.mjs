// Crea test users en Supabase Auth + filas correspondientes en public.User +
// UserOrganizationRole. Idempotente: si los users ya existen, sólo se aseguran
// los UOR.
//
// Roles agregados para E2E del Sprint F2-S2 (ECE):
//   - qa.physician   → requireRole(["PHYSICIAN"]) en routers HIS clínicos
//   - qa.nurse       → requireRole(["NURSE"])     en signos vitales, registro enfermería
//   - qa.director    → requireRole(["DIR"])       en certificación, bitácora, anulación
// Si `Role.name` no existe en la BD, el script emite warning y continúa
// (no rompe). El seed base puebla los roles administrativos; los roles
// clínicos pueden requerir seed adicional según el ambiente.
//
// Requiere: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + DATABASE_URL.
// Uso:
//   node --env-file=.env scripts/seed-test-users.mjs
import pg from 'pg';

const TEST_USERS = [
  { email: 'qa.admin@his.test',     password: 'TestPass123!', fullName: 'QA Admin',     roleName: 'Administrador' },
  { email: 'qa.triagist@his.test',  password: 'TestPass123!', fullName: 'QA Triagist',  roleName: 'Administrador' },
  { email: 'qa.physician@his.test', password: 'TestPass123!', fullName: 'QA Physician', roleName: 'Médico' },
  { email: 'qa.nurse@his.test',     password: 'TestPass123!', fullName: 'QA Nurse',     roleName: 'Enfermería' },
  // qa.director usa rol 'Administrador' temporalmente hasta que se cree el rol
  // 'Director' formalmente en public.Role (ECE define DIR en ece.rol pero el
  // RBAC del HIS requiere mapping en public.Role para `tenant.roleCodes`).
  { email: 'qa.director@his.test',  password: 'TestPass123!', fullName: 'QA Director',  roleName: 'Administrador' },
];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db  = process.env.DIRECT_URL;
if (!url || !svc || !db) {
  console.error('Falta NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/DIRECT_URL');
  process.exit(2);
}

async function ensureAuthUser({ email, password }) {
  // Intentar create; si ya existe (422), buscar por listado.
  const create = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { 'apikey': svc, 'Authorization': `Bearer ${svc}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (create.status === 200 || create.status === 201) {
    const j = await create.json();
    return { id: j.id, created: true };
  }
  if (create.status === 422 || create.status === 409 || create.status === 400) {
    // Existe — listar y buscar por email.
    const list = await fetch(`${url}/auth/v1/admin/users?per_page=200`, {
      headers: { 'apikey': svc, 'Authorization': `Bearer ${svc}` },
    });
    const j = await list.json();
    const found = (j.users || []).find(u => u.email === email);
    if (!found) throw new Error(`No pude crear ni encontrar ${email}: ${create.status}`);
    return { id: found.id, created: false };
  }
  throw new Error(`Error inesperado ${create.status}: ${await create.text()}`);
}

const cleanUrl = db.replace(/[?&]sslmode=[^&]*/g, '').replace('?&', '?').replace(/[?&]$/, '');
const client = new pg.Client({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  // Asignar UOR a la organización que tenga Establishment (subsidiaria operativa).
  // La holding no tiene Establishment ni ServiceUnits — UOR ahí no puede ver encuentros.
  const orgRes = await client.query(
    `SELECT "organizationId" FROM public."Establishment" LIMIT 1`
  );
  const orgId = orgRes.rows[0]?.organizationId;
  if (!orgId) throw new Error('No hay Establishment en la BD — corre seed primero');

  for (const u of TEST_USERS) {
    process.stdout.write(`> ${u.email.padEnd(28)} ... `);
    const { id, created } = await ensureAuthUser(u);
    // Asegurar fila en public.User con MISMO id que auth.users.
    await client.query(
      `INSERT INTO public."User" (id, email, "fullName", active, "createdAt", "updatedAt")
         VALUES ($1::uuid, $2, $3, true, now(), now())
       ON CONFLICT (id) DO UPDATE SET "fullName"=EXCLUDED."fullName", active=true, "updatedAt"=now()`,
      [id, u.email, u.fullName]
    );
    // Buscar Role por nombre (cualquiera de cualquier org sirve para esto).
    const roleRes = await client.query(
      `SELECT id FROM public."Role" WHERE name=$1 LIMIT 1`,
      [u.roleName]
    );
    if (!roleRes.rows[0]) {
      console.log(`SIN ROLE "${u.roleName}"`);
      continue;
    }
    // Limpiar UORs previos (de runs anteriores con orgId distinto) y asegurar
    // sólo el UOR a la org operativa para que sea tenant default sin ambigüedad.
    await client.query(
      `DELETE FROM public."UserOrganizationRole"
         WHERE "userId"=$1::uuid AND "organizationId" <> $2::uuid`,
      [id, orgId]
    );
    await client.query(
      `INSERT INTO public."UserOrganizationRole" (id, "userId","organizationId","roleId")
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid)
       ON CONFLICT ("userId","organizationId","roleId") DO NOTHING`,
      [id, orgId, roleRes.rows[0].id]
    );
    console.log(`${created ? 'CREATED' : 'EXISTED'} id=${id.slice(0,8)}`);
  }
} finally {
  await client.end();
}
console.log('done');
