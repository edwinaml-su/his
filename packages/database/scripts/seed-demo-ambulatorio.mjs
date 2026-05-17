/**
 * seed-demo-ambulatorio.mjs
 *
 * Propósito:
 *   Siembra un flujo ambulatorio completo y realista en la BD ECE para
 *   demostración E2E: paciente → episodio → 7 documentos firmados → cierre.
 *   Idempotente: todas las inserciones usan ON CONFLICT / SELECT-before-insert.
 *
 * Requisitos de entorno (archivo .env en packages/database/):
 *   DIRECT_URL — conexión directa Postgres (sin pooler). Obligatorio.
 *
 * Quién debe correrlo:
 *   Desarrolladores o CI que necesiten datos demo para pruebas manuales.
 *   NO ejecutar en producción — los datos son ficticios (DUI de test, etc.).
 *
 * Uso:
 *   node --env-file=.env scripts/seed-demo-ambulatorio.mjs
 *   npm run -w @his/database db:seed:demo
 */

import pg from 'pg';

// ─────────────────────────────────────────────────────────────────────────────
// Configuración
// ─────────────────────────────────────────────────────────────────────────────
const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) {
  console.error('ERROR: DIRECT_URL no definida. Agrega la variable al .env.');
  process.exit(2);
}

const DEMO_DUI               = '12345678-9';
const DEMO_NUI               = 'SV00000000000000001A'; // 20 chars [A-Z0-9]
const DEMO_NUMERO_EXPEDIENTE = 'DEMO-2026-00001';

// argon2id hash placeholder — no verificable en runtime real; solo para seed demo
const STUB_PIN_HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2VlZGRlbW8$ZGVtb2hhc2hzdHViZm9yc2VlZGluZ29ubHk';
const STUB_SALT     = 'seeddemo';

// ─────────────────────────────────────────────────────────────────────────────
// Conexión
// ─────────────────────────────────────────────────────────────────────────────
const cleanUrl = DIRECT_URL
  .replace(/[?&]sslmode=[^&]*/g, '')
  .replace('?&', '?')
  .replace(/[?&]$/, '');

const client = new pg.Client({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de logging
// ─────────────────────────────────────────────────────────────────────────────
function step(msg) {
  process.stdout.write(`  → ${msg} ... `);
}
function ok(detail = '') {
  console.log(`OK${detail ? ' ' + detail : ''}`);
}

/**
 * Crea (o recupera existente) una ece.documento_instancia + entrada en historial.
 *
 * Orden correcto para evitar FK circular:
 *   1. Crear instancia con registro_id = NULL
 *   2. Llamador inserta la fila clínica usando inst.id como instancia_id
 *   3. Actualizar instancia.registro_id con el id de la fila clínica
 *
 * Este helper hace los pasos 1 + historial. El llamador hace 2 + llama a
 * fijarRegistroId() para el paso 3.
 */
async function crearInstancia({
  tipoDocCodigo, episodioId, pacienteId,
  estadoCodigo, personalId, rolId, accion, firmaId = null,
}) {
  const { rows: [tdRow] } = await client.query(
    `SELECT id FROM ece.tipo_documento WHERE codigo = $1`,
    [tipoDocCodigo],
  );
  if (!tdRow) throw new Error(`tipo_documento no encontrado: ${tipoDocCodigo}`);

  const { rows: [feRow] } = await client.query(
    `SELECT id FROM ece.flujo_estado
      WHERE tipo_documento_id = $1 AND codigo = $2`,
    [tdRow.id, estadoCodigo],
  );
  if (!feRow) throw new Error(`flujo_estado no encontrado: ${tipoDocCodigo}/${estadoCodigo}`);

  const { rows: [feInicial] } = await client.query(
    `SELECT id FROM ece.flujo_estado
      WHERE tipo_documento_id = $1 AND es_inicial = true`,
    [tdRow.id],
  );

  // INSERT instancia. Usamos episodio_id + tipo_documento_id como clave de
  // idempotencia — un episodio solo tiene una instancia activa de cada tipo.
  const { rows: [inst] } = await client.query(
    `INSERT INTO ece.documento_instancia
       (tipo_documento_id, episodio_id, paciente_id, registro_id,
        estado_actual_id, version, estado_registro, creado_por)
     SELECT $1, $2, $3, NULL, $4, 1, 'vigente', $5
     WHERE NOT EXISTS (
       SELECT 1 FROM ece.documento_instancia
        WHERE tipo_documento_id = $1
          AND episodio_id       = $2
          AND estado_registro   = 'vigente'
     )
     RETURNING id`,
    [tdRow.id, episodioId, pacienteId, feRow.id, personalId],
  );

  let instanciaId;
  if (inst) {
    instanciaId = inst.id;
  } else {
    // Ya existía — recuperar y actualizar estado
    const { rows: [existing] } = await client.query(
      `UPDATE ece.documento_instancia
          SET estado_actual_id = $3
        WHERE tipo_documento_id = $1
          AND episodio_id       = $2
          AND estado_registro   = 'vigente'
        RETURNING id`,
      [tdRow.id, episodioId, feRow.id],
    );
    instanciaId = existing.id;
  }

  // Historial — append-only; evitar duplicado de accion por instancia
  await client.query(
    `INSERT INTO ece.documento_instancia_historial
       (instancia_id, estado_anterior_id, estado_nuevo_id, accion,
        ejecutado_por, rol_ejecutor_id, firma_id, observacion)
     SELECT $1, $2, $3, $4, $5, $6, $7, 'Seed demo ambulatorio'
     WHERE NOT EXISTS (
       SELECT 1 FROM ece.documento_instancia_historial
        WHERE instancia_id = $1 AND accion = $4
     )`,
    [instanciaId, feInicial?.id ?? null, feRow.id, accion,
     personalId, rolId, firmaId],
  );

  return instanciaId;
}

async function fijarRegistroId(instanciaId, registroId) {
  await client.query(
    `UPDATE ece.documento_instancia
        SET registro_id = $2
      WHERE id = $1 AND registro_id IS DISTINCT FROM $2`,
    [instanciaId, registroId],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
await client.connect();

let docCount = 0;
let pacienteId, episodioId;

try {
  // ── 0. Lookups de infraestructura ───────────────────────────────────────

  step('ece.institucion');
  const { rows: [instRow] } = await client.query(
    `SELECT id FROM ece.institucion LIMIT 1`,
  );
  if (!instRow) throw new Error('Sin ece.institucion. Ejecuta los seeds base ECE primero.');
  const institucionId = instRow.id;
  ok(institucionId.slice(0, 8));

  step('ece.establecimiento');
  const { rows: [estRow] } = await client.query(
    `SELECT id FROM ece.establecimiento WHERE institucion_id = $1 LIMIT 1`,
    [institucionId],
  );
  if (!estRow) throw new Error('Sin ece.establecimiento. Ejecuta los seeds base ECE primero.');
  const establecimientoId = estRow.id;
  ok(establecimientoId.slice(0, 8));

  // ── 1. Roles ECE ─────────────────────────────────────────────────────────
  step('roles ENF/MT/MC en ece.rol');
  const { rows: rolRows } = await client.query(
    `SELECT codigo, id FROM ece.rol WHERE codigo IN ('ENF','MT','MC','DIR')`,
  );
  const rolMap = Object.fromEntries(rolRows.map(r => [r.codigo, r.id]));
  if (!rolMap.ENF || !rolMap.MT || !rolMap.MC) {
    throw new Error('Faltan roles ECE. Ejecuta 63_ece_08_seed.sql primero.');
  }
  ok();

  // ── 2. personal_salud para qa.nurse y qa.physician ───────────────────────

  async function upsertPersonal(email, nombre, profesion) {
    const { rows: [userRow] } = await client.query(
      `SELECT id FROM public."User" WHERE email = $1`, [email],
    );
    if (!userRow) {
      throw new Error(`Usuario ${email} no encontrado. Corre seed-test-users.mjs primero.`);
    }

    // auth.users — puede no existir en BD de test local sin Supabase Auth real
    let authUserId = null;
    try {
      const { rows: [authRow] } = await client.query(
        `SELECT id FROM auth.users WHERE email = $1`, [email],
      );
      authUserId = authRow?.id ?? null;
    } catch {
      // schema auth no disponible en BD de test — aceptable
    }

    const { rows: [ps] } = await client.query(
      `INSERT INTO ece.personal_salud
         (his_user_id, auth_user_id, institucion_id, establecimiento_id,
          documento_identidad, nombre_completo, profesion, activo)
       VALUES ($1, $2, $3, $4, 'DUI-DEMO-SEED', $5, $6, true)
       ON CONFLICT (his_user_id)
         DO UPDATE SET activo         = true,
                       nombre_completo = EXCLUDED.nombre_completo
       RETURNING id`,
      [userRow.id, authUserId, institucionId, establecimientoId, nombre, profesion],
    );
    return ps.id;
  }

  step('personal_salud qa.nurse');
  const nursePersonalId = await upsertPersonal(
    'qa.nurse@his.test', 'QA Nurse Demo', 'Enfermería',
  );
  ok(nursePersonalId.slice(0, 8));

  step('personal_salud qa.physician');
  const physicianPersonalId = await upsertPersonal(
    'qa.physician@his.test', 'QA Physician Demo', 'Medicina',
  );
  ok(physicianPersonalId.slice(0, 8));

  // ── 3. firma_electronica stubs ────────────────────────────────────────────
  async function upsertFirma(personalId) {
    const { rows: [f] } = await client.query(
      `INSERT INTO ece.firma_electronica (personal_id, pin_hash, salt_extra)
       VALUES ($1, $2, $3)
       ON CONFLICT (personal_id) DO NOTHING
       RETURNING id`,
      [personalId, STUB_PIN_HASH, STUB_SALT],
    );
    if (f) return f.id;
    const { rows: [existing] } = await client.query(
      `SELECT id FROM ece.firma_electronica WHERE personal_id = $1`, [personalId],
    );
    return existing.id;
  }

  step('firma_electronica nurse');
  const nurseFiremaId = await upsertFirma(nursePersonalId);
  ok(nurseFiremaId.slice(0, 8));

  step('firma_electronica physician');
  const physicianFirmaId = await upsertFirma(physicianPersonalId);
  ok(physicianFirmaId.slice(0, 8));

  // ── 4. public.Patient (MPI) ───────────────────────────────────────────────
  step('public.Patient "Juan Pérez Demo"');
  const { rows: [pubOrgRow] } = await client.query(
    `SELECT "organizationId" FROM public."Establishment" LIMIT 1`,
  );
  if (!pubOrgRow) throw new Error('Sin public.Establishment. Ejecuta seed base primero.');

  // SELECT-then-INSERT para evitar ON CONFLICT en tabla sin constraint único ad-hoc
  let publicPatientId;
  const { rows: [existPub] } = await client.query(
    `SELECT id FROM public."Patient"
      WHERE "firstName" = 'Juan' AND "lastName" = 'Pérez Demo' LIMIT 1`,
  );
  if (existPub) {
    publicPatientId = existPub.id;
  } else {
    const { rows: [newPub] } = await client.query(
      `INSERT INTO public."Patient"
         (id, "firstName", "lastName", "dateOfBirth", gender,
          "organizationId", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), 'Juan', 'Pérez Demo',
               '1985-03-15'::date, 'male',
               $1, now(), now())
       RETURNING id`,
      [pubOrgRow.organizationId],
    );
    publicPatientId = newPub.id;
  }
  ok(publicPatientId.slice(0, 8));

  // ── 5. ece.paciente ──────────────────────────────────────────────────────
  step('ece.paciente (DUI 12345678-9)');
  const { rows: [pacienteRow] } = await client.query(
    `INSERT INTO ece.paciente
       (public_patient_id, establecimiento_id, numero_expediente,
        dui, nui, tipo_registro_identidad, estado_expediente,
        responsable_toma_datos)
     VALUES ($1, $2, $3, $4, $5, 'verificado', 'activo', $6)
     ON CONFLICT (establecimiento_id, numero_expediente)
       DO UPDATE SET public_patient_id = EXCLUDED.public_patient_id
     RETURNING id`,
    [publicPatientId, establecimientoId, DEMO_NUMERO_EXPEDIENTE,
     DEMO_DUI, DEMO_NUI, nursePersonalId],
  );
  pacienteId = pacienteRow.id;
  ok(pacienteId.slice(0, 8));

  // ── 6. ece.episodio_atencion ─────────────────────────────────────────────
  step('ece.episodio_atencion');
  const { rows: [existEp] } = await client.query(
    `SELECT id, estado FROM ece.episodio_atencion
      WHERE paciente_id = $1 LIMIT 1`,
    [pacienteId],
  );
  if (existEp) {
    episodioId = existEp.id;
  } else {
    const { rows: [newEp] } = await client.query(
      `INSERT INTO ece.episodio_atencion
         (paciente_id, establecimiento_id, modalidad, servicio_categoria,
          origen_consulta, modalidad_atencion, motivo, estado, creado_por)
       VALUES ($1, $2, 'ambulatorio', 'emergencia',
               'espontanea', 'presencial',
               'Cefalea de inicio brusco',
               'abierto', $3)
       RETURNING id`,
      [pacienteId, establecimientoId, nursePersonalId],
    );
    episodioId = newEp.id;
  }
  ok(episodioId.slice(0, 8));

  // ─────────────────────────────────────────────────────────────────────────
  // DOCUMENTOS CLÍNICOS
  //
  // Patrón por documento:
  //   a) crearInstancia() → obtiene instancia_id (sin registro_id todavía)
  //   b) INSERT fila clínica usando instancia_id
  //   c) fijarRegistroId() → actualiza instancia.registro_id
  // ─────────────────────────────────────────────────────────────────────────

  // ── Doc 1: Signos Vitales (firmado por ENF) ──────────────────────────────
  step('Doc 1: ece.signos_vitales');
  const svInstId = await crearInstancia({
    tipoDocCodigo: 'SIG_VIT', episodioId, pacienteId,
    estadoCodigo: 'firmado', personalId: nursePersonalId,
    rolId: rolMap.ENF, accion: 'firmar', firmaId: nurseFiremaId,
  });
  const { rows: [svRow] } = await client.query(
    `INSERT INTO ece.signos_vitales
       (instancia_id, episodio_id,
        presion_sistolica, presion_diastolica,
        frecuencia_cardiaca, frecuencia_respiratoria,
        temperatura, saturacion_o2, escala_dolor, registrado_por)
     SELECT $1, $2, 120, 80, 78, 16, 36.5, 98, 2, $3
     WHERE NOT EXISTS (
       SELECT 1 FROM ece.signos_vitales WHERE instancia_id = $1
     )
     RETURNING id`,
    [svInstId, episodioId, nursePersonalId],
  );
  const svId = svRow?.id ?? (await client.query(
    `SELECT id FROM ece.signos_vitales WHERE instancia_id = $1`, [svInstId],
  )).rows[0].id;
  await fijarRegistroId(svInstId, svId);
  docCount++;
  ok(`sv=${svId.slice(0, 8)}`);

  // ── Doc 2: Hoja de Triaje (firmada ENF, validada MT) ────────────────────
  step('Doc 2: ece.hoja_triaje (Manchester 3)');
  const trInstId = await crearInstancia({
    tipoDocCodigo: 'TRIAJE', episodioId, pacienteId,
    estadoCodigo: 'validado', personalId: physicianPersonalId,
    rolId: rolMap.MT, accion: 'validar', firmaId: null,
  });
  const { rows: [trRow] } = await client.query(
    `INSERT INTO ece.hoja_triaje
       (instancia_id, episodio_id,
        nivel_prioridad, destino_asignado, signos_vitales_id,
        motivo_consulta, evaluacion_triaje, registrado_por)
     SELECT $1, $2,
       'Manchester-3-Amarillo', 'Box Emergencias', $3,
       'Cefalea intensa de inicio brusco',
       '{"nivel":"3","color":"amarillo","discriminador":"Dolor de cabeza"}'::jsonb,
       $4
     WHERE NOT EXISTS (
       SELECT 1 FROM ece.hoja_triaje WHERE instancia_id = $1
     )
     RETURNING id`,
    [trInstId, episodioId, svId, nursePersonalId],
  );
  const trId = trRow?.id ?? (await client.query(
    `SELECT id FROM ece.hoja_triaje WHERE instancia_id = $1`, [trInstId],
  )).rows[0].id;
  await fijarRegistroId(trInstId, trId);
  docCount++;
  ok(`triaje=${trId.slice(0, 8)}`);

  // ── Doc 3: Atención Emergencia (firmada+validada MT) ─────────────────────
  step('Doc 3: ece.atencion_emergencia');
  const aeInstId = await crearInstancia({
    tipoDocCodigo: 'ATN_EMERG', episodioId, pacienteId,
    estadoCodigo: 'validado', personalId: physicianPersonalId,
    rolId: rolMap.MT, accion: 'validar', firmaId: physicianFirmaId,
  });
  const { rows: [aeRow] } = await client.query(
    `INSERT INTO ece.atencion_emergencia
       (instancia_id, episodio_id,
        circunstancia_llegada, motivo_consulta, examen_fisico,
        disposicion, diagnosticos, manejo_realizado, registrado_por)
     SELECT $1, $2,
       'Por medios propios',
       'Cefalea intensa de inicio brusco, EVA 7/10',
       'Paciente alerta, orientado. PA 120/80. Sin signos meníngeos.',
       'alta_ambulatoria',
       '[{"cie10":"G44.2","descripcion":"Cefalea tensional","tipo":"definitivo"}]'::jsonb,
       '[{"tipo":"medicamento","descripcion":"Acetaminofén 500mg IV stat"}]'::jsonb,
       $3
     WHERE NOT EXISTS (
       SELECT 1 FROM ece.atencion_emergencia WHERE instancia_id = $1
     )
     RETURNING id`,
    [aeInstId, episodioId, physicianPersonalId],
  );
  const aeId = aeRow?.id ?? (await client.query(
    `SELECT id FROM ece.atencion_emergencia WHERE instancia_id = $1`, [aeInstId],
  )).rows[0].id;
  await fijarRegistroId(aeInstId, aeId);
  docCount++;
  ok(`ae=${aeId.slice(0, 8)}`);

  // ── Doc 4: Historia Clínica (borrador por physician) ─────────────────────
  step('Doc 4: ece.historia_clinica (borrador)');
  const hcInstId = await crearInstancia({
    tipoDocCodigo: 'HIST_CLIN', episodioId, pacienteId,
    estadoCodigo: 'borrador', personalId: physicianPersonalId,
    rolId: rolMap.MC, accion: 'crear', firmaId: null,
  });
  const { rows: [hcRow] } = await client.query(
    `INSERT INTO ece.historia_clinica
       (instancia_id, episodio_id,
        tipo_consulta, motivo_consulta, enfermedad_actual,
        disposicion, plan_manejo, antecedentes, diagnosticos, registrado_por)
     SELECT $1, $2,
       'primera_vez',
       'Cefalea tensional',
       'Paciente masculino de 40 años con cefalea de 6 horas de evolución, sin fiebre.',
       'alta_ambulatoria',
       'Analgesia, reposo, control en 72h si persiste',
       '{"personales":"Sin antecedentes de relevancia","alergias":"NKDA"}'::jsonb,
       '[{"cie10":"G44.2","descripcion":"Cefalea tensional","tipo":"definitivo"}]'::jsonb,
       $3
     WHERE NOT EXISTS (
       SELECT 1 FROM ece.historia_clinica WHERE instancia_id = $1
     )
     RETURNING id`,
    [hcInstId, episodioId, physicianPersonalId],
  );
  const hcId = hcRow?.id ?? (await client.query(
    `SELECT id FROM ece.historia_clinica WHERE instancia_id = $1`, [hcInstId],
  )).rows[0].id;
  await fijarRegistroId(hcInstId, hcId);
  docCount++;
  ok(`hc=${hcId.slice(0, 8)}`);

  // ── Doc 5: Indicaciones Médicas + ítem (firmadas MC) ────────────────────
  step('Doc 5: ece.indicaciones_medicas + indicacion_item');
  const imInstId = await crearInstancia({
    tipoDocCodigo: 'IND_MED', episodioId, pacienteId,
    estadoCodigo: 'firmado', personalId: physicianPersonalId,
    rolId: rolMap.MC, accion: 'firmar', firmaId: physicianFirmaId,
  });
  const { rows: [imRow] } = await client.query(
    `INSERT INTO ece.indicaciones_medicas
       (instancia_id, episodio_id, version, vigencia, medico_prescriptor)
     SELECT $1, $2, 1, 'activa', $3
     WHERE NOT EXISTS (
       SELECT 1 FROM ece.indicaciones_medicas WHERE instancia_id = $1
     )
     RETURNING id`,
    [imInstId, episodioId, physicianPersonalId],
  );
  const imId = imRow?.id ?? (await client.query(
    `SELECT id FROM ece.indicaciones_medicas WHERE instancia_id = $1`, [imInstId],
  )).rows[0].id;
  await fijarRegistroId(imInstId, imId);

  // Ítem de indicación
  const { rows: [iiRow] } = await client.query(
    `INSERT INTO ece.indicacion_item
       (indicacion_id, tipo, descripcion, dosis, via, frecuencia, duracion)
     SELECT $1, 'medicamento', 'Acetaminofén 500mg', '500mg', 'oral', 'cada 8 horas', '3 días'
     WHERE NOT EXISTS (
       SELECT 1 FROM ece.indicacion_item WHERE indicacion_id = $1
     )
     RETURNING id`,
    [imId],
  );
  const iiId = iiRow?.id ?? (await client.query(
    `SELECT id FROM ece.indicacion_item WHERE indicacion_id = $1`, [imId],
  )).rows[0].id;
  docCount++;
  ok(`im=${imId.slice(0, 8)} item=${iiId.slice(0, 8)}`);

  // ── Doc 6: Registro Enfermería + administracion_medicamento ─────────────
  step('Doc 6: ece.registro_enfermeria + kardex');
  const reInstId = await crearInstancia({
    tipoDocCodigo: 'REG_ENF', episodioId, pacienteId,
    estadoCodigo: 'firmado', personalId: nursePersonalId,
    rolId: rolMap.ENF, accion: 'firmar', firmaId: nurseFiremaId,
  });
  const { rows: [reRow] } = await client.query(
    `INSERT INTO ece.registro_enfermeria
       (instancia_id, episodio_id, turno,
        nota_evolucion, plan_cuidados, valoracion_enf, registrado_por)
     SELECT $1, $2, 'matutino',
       'Paciente estable. Signos vitales dentro de límites normales. Dolor controlado.',
       'Control de signos vitales cada 4h. Administrar analgésico pautado.',
       '{"dolor":2,"caidas_riesgo":"bajo"}'::jsonb,
       $3
     WHERE NOT EXISTS (
       SELECT 1 FROM ece.registro_enfermeria WHERE instancia_id = $1
     )
     RETURNING id`,
    [reInstId, episodioId, nursePersonalId],
  );
  const reId = reRow?.id ?? (await client.query(
    `SELECT id FROM ece.registro_enfermeria WHERE instancia_id = $1`, [reInstId],
  )).rows[0].id;
  await fijarRegistroId(reInstId, reId);

  // Kardex de administración
  await client.query(
    `INSERT INTO ece.administracion_medicamento
       (registro_enf_id, indicacion_item_id,
        hora_aplicada, estado, responsable)
     SELECT $1, $2, now(), 'administrado', $3
     WHERE NOT EXISTS (
       SELECT 1 FROM ece.administracion_medicamento
        WHERE registro_enf_id = $1 AND indicacion_item_id = $2
     )`,
    [reId, iiId, nursePersonalId],
  );
  docCount++;
  ok(`re=${reId.slice(0, 8)}`);

  // ── Doc 7: Evolución Médica SOAP (firmada MC) ────────────────────────────
  step('Doc 7: ece.evolucion_medica (SOAP)');
  const evInstId = await crearInstancia({
    tipoDocCodigo: 'EVOL_MED', episodioId, pacienteId,
    estadoCodigo: 'firmado', personalId: physicianPersonalId,
    rolId: rolMap.MC, accion: 'firmar', firmaId: physicianFirmaId,
  });
  const { rows: [evRow] } = await client.query(
    `INSERT INTO ece.evolucion_medica
       (instancia_id, episodio_id,
        subjetivo, objetivo, analisis, plan,
        diagnostico_cie10, registrado_por)
     SELECT $1, $2,
       'Paciente refiere mejoría del dolor a EVA 2/10 tras analgesia.',
       'Alerta, PA 118/76, FC 74, afebril. Neurológico sin focalización.',
       'Cefalea tensional en resolución. Sin datos de alarma.',
       'Alta ambulatoria con indicaciones escritas. Control médico en 72h si persiste.',
       '[{"cie10":"G44.2","descripcion":"Cefalea tensional"}]'::jsonb,
       $3
     WHERE NOT EXISTS (
       SELECT 1 FROM ece.evolucion_medica WHERE instancia_id = $1
     )
     RETURNING id`,
    [evInstId, episodioId, physicianPersonalId],
  );
  const evId = evRow?.id ?? (await client.query(
    `SELECT id FROM ece.evolucion_medica WHERE instancia_id = $1`, [evInstId],
  )).rows[0].id;
  await fijarRegistroId(evInstId, evId);
  docCount++;
  ok(`ev=${evId.slice(0, 8)}`);

  // ── 8. Cierre del episodio: abierto → en_curso → cerrado ─────────────────
  // El trigger trg_episodio_valida_transicion solo permite:
  //   abierto → en_curso | cancelado
  //   en_curso → cerrado | cancelado
  // Por tanto se requieren dos UPDATE secuenciales si el estado es 'abierto'.
  step('Cierre episodio (abierto→en_curso→cerrado)');
  const { rows: [epState] } = await client.query(
    `SELECT estado FROM ece.episodio_atencion WHERE id = $1`, [episodioId],
  );
  if (epState.estado === 'abierto') {
    await client.query(
      `UPDATE ece.episodio_atencion SET estado = 'en_curso' WHERE id = $1`,
      [episodioId],
    );
  }
  if (epState.estado !== 'cerrado') {
    await client.query(
      `UPDATE ece.episodio_atencion
          SET estado            = 'cerrado',
              fecha_hora_cierre = now(),
              disposicion       = 'alta_ambulatoria'
        WHERE id = $1`,
      [episodioId],
    );
  }
  ok();

  // ── Resumen final ─────────────────────────────────────────────────────────
  console.log('');
  console.log(`Paciente demo creado: id=${pacienteId}`);
  console.log(`Episodio: id=${episodioId} estado=cerrado`);
  console.log(`${docCount} documentos firmados/validados`);
  console.log(`Test users vinculados como autores: qa.nurse@his.test, qa.physician@his.test`);

} catch (err) {
  console.error('\nERROR en seed-demo-ambulatorio:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
