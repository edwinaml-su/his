/**
 * seed-demo-obstetrico.mjs
 *
 * Propósito: Sembrar datos demo de un parto vaginal eutócico completo (Ana Rivera Demo,
 * DUI 11223344-5, 32 sem gest al momento de la valoración, 38 sem al nacimiento) para
 * demostración y QA del ECE Obstétrico — Fase 2 Avante HIS.
 *
 * Flujo:
 *   1. Admisión emergencia trabajo de parto (Encounter BIRTH)
 *   2. Valoración inicial enfermería obstétrica (firmada)
 *   3. Partograma con 6 registros (4→10 cm en 6 h, curva normal)
 *   4. Periodo expulsivo 30 min activo → nacimiento RN vivo
 *   5. Atención RN: F, 3200 g, 49 cm, PC 34 cm, 38 sem, Apgar 9-10-10
 *   6. Alumbramiento placenta completa <15 min, sin reanimación neonatal
 *   7. Lactancia inmediata + traslado RN alojamiento conjunto
 *   8. Episodio cerrado 24 h después: epicrisis materna + epicrisis RN firmadas
 *   9. Documento obstétrico único (EceDocumentoObstetrico) con todo el flujo en JSON
 *
 * Idempotente: ON CONFLICT por (establecimiento_id, numero_expediente) y encounterNumber.
 * Requisito: DIRECT_URL en .env.
 *
 * Limpiar:
 *   DELETE FROM ece.paciente WHERE numero_expediente IN ('DEMO-OBS-001', 'DEMO-OBS-RN-001');
 *   DELETE FROM public."Patient" WHERE mrn IN ('DEMO-OBS-ANA-001', 'DEMO-OBS-RN-001');
 */

import pg from 'pg';
import crypto from 'crypto';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) {
  console.error('[ERROR] DIRECT_URL faltante en .env');
  process.exit(2);
}

const cleanUrl = DIRECT_URL
  .replace(/[?&]sslmode=[^&]*/g, '')
  .replace('?&', '?')
  .replace(/[?&]$/, '');

const client = new pg.Client({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
});

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/** Crea documento_instancia + primer historial. Devuelve { instanciaId, estadoId }. */
async function crearInstancia(tx, { tipoDocCodigo, episodioId, pacienteId, registroId, estadoCodigo, accion, ejecutadoPor, rolCodigo, observacion }) {
  const { rows: [tipoDoc] } = await tx.query(
    `SELECT id FROM ece.tipo_documento WHERE codigo = $1`, [tipoDocCodigo]
  );
  if (!tipoDoc) throw new Error(`tipo_documento no encontrado: ${tipoDocCodigo}`);

  const { rows: [estado] } = await tx.query(
    `SELECT id FROM ece.flujo_estado WHERE tipo_documento_id = $1 AND codigo = $2`,
    [tipoDoc.id, estadoCodigo]
  );
  if (!estado) throw new Error(`flujo_estado no encontrado: ${tipoDocCodigo}/${estadoCodigo}`);

  const { rows: [rol] } = await tx.query(
    `SELECT id FROM ece.rol WHERE codigo = $1`, [rolCodigo]
  );
  if (!rol) throw new Error(`rol no encontrado: ${rolCodigo}`);

  const { rows: [inst] } = await tx.query(
    `INSERT INTO ece.documento_instancia
       (tipo_documento_id, episodio_id, paciente_id, registro_id, estado_actual_id, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [tipoDoc.id, episodioId ?? null, pacienteId ?? null, registroId ?? null, estado.id, ejecutadoPor]
  );

  await tx.query(
    `INSERT INTO ece.documento_instancia_historial
       (instancia_id, estado_anterior_id, estado_nuevo_id, accion, ejecutado_por, rol_ejecutor_id, observacion)
     VALUES ($1, NULL, $2, $3, $4, $5, $6)`,
    [inst.id, estado.id, accion, ejecutadoPor, rol.id, observacion ?? null]
  );

  return { instanciaId: inst.id, estadoId: estado.id };
}

/** Avanza estado en workflow. Devuelve nuevo estadoId. */
async function avanzarEstado(tx, { instanciaId, estadoAnteriorId, tipoDocCodigo, nuevoEstadoCodigo, accion, ejecutadoPor, rolCodigo, observacion }) {
  const { rows: [tipoDoc] } = await tx.query(
    `SELECT id FROM ece.tipo_documento WHERE codigo = $1`, [tipoDocCodigo]
  );
  const { rows: [nuevoEstado] } = await tx.query(
    `SELECT id FROM ece.flujo_estado WHERE tipo_documento_id = $1 AND codigo = $2`,
    [tipoDoc.id, nuevoEstadoCodigo]
  );
  if (!nuevoEstado) throw new Error(`estado destino no encontrado: ${tipoDocCodigo}/${nuevoEstadoCodigo}`);

  const { rows: [rol] } = await tx.query(
    `SELECT id FROM ece.rol WHERE codigo = $1`, [rolCodigo]
  );

  await tx.query(
    `UPDATE ece.documento_instancia SET estado_actual_id = $1 WHERE id = $2`,
    [nuevoEstado.id, instanciaId]
  );

  await tx.query(
    `INSERT INTO ece.documento_instancia_historial
       (instancia_id, estado_anterior_id, estado_nuevo_id, accion, ejecutado_por, rol_ejecutor_id, observacion)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [instanciaId, estadoAnteriorId, nuevoEstado.id, accion, ejecutadoPor, rol?.id ?? null, observacion ?? null]
  );

  return nuevoEstado.id;
}

/** Upsert personal_salud. Devuelve id. */
async function upsertPersonal(tx, { doc, nombre, jvpm, institId, estabId }) {
  const { rows: [p] } = await tx.query(
    `INSERT INTO ece.personal_salud
       (documento_identidad, nombre_completo, institucion_id, establecimiento_id, jvpm_o_jvp)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [doc, nombre, institId, estabId, jvpm ?? null]
  );
  if (p) return p.id;
  const { rows: [ex] } = await tx.query(
    `SELECT id FROM ece.personal_salud WHERE documento_identidad = $1 AND establecimiento_id = $2`,
    [doc, estabId]
  );
  return ex.id;
}

/** Asignar rol ECE (idempotente). servicio_id es null — ON CONFLICT no aplica con NULLs,
 *  así que verificamos existencia antes de insertar. */
async function asignarRol(tx, personalId, rolCodigo, estabId) {
  const { rows: [existing] } = await tx.query(
    `SELECT ar.id FROM ece.asignacion_rol ar
     JOIN ece.rol r ON r.id = ar.rol_id
     WHERE ar.personal_id = $1 AND r.codigo = $2 AND ar.servicio_id IS NULL`,
    [personalId, rolCodigo]
  );
  if (!existing) {
    await tx.query(
      `INSERT INTO ece.asignacion_rol (personal_id, rol_id, establecimiento_id)
       SELECT $1, r.id, $2 FROM ece.rol r WHERE r.codigo = $3`,
      [personalId, estabId, rolCodigo]
    );
  }
}

const FAKE_HASH = '$argon2id$v=19$m=65536,t=3,p=4$DEMO_SALT_PLACEHOLDER$DEMO_HASH_PLACEHOLDER';

/** Upsert firma electrónica stub (solo demo).
 *  BD física usa pin_hash + salt_extra (schema.prisma tiene drift — hash_credencial). */
async function upsertFirma(tx, personalId) {
  await tx.query(
    `INSERT INTO ece.firma_electronica (personal_id, pin_hash, salt_extra)
     VALUES ($1, $2, 'demo-salt')
     ON CONFLICT (personal_id) DO NOTHING`,
    [personalId, FAKE_HASH]
  );
}

async function main() {
  await client.connect();

  const report = {
    madrePacienteId: null,
    rnPacienteId: null,
    madreEncounterId: null,
    rnEncounterId: null,
    madreEpisodioId: null,
    rnEpisodioId: null,
    documentos: [],
    errores: [],
  };

  try {
    await client.query('BEGIN');

    // ── 0. FKs base ──────────────────────────────────────────────────────
    const { rows: [estabHIS] } = await client.query(
      `SELECT id, "organizationId" FROM public."Establishment" LIMIT 1`
    );
    if (!estabHIS) throw new Error('No existe Establishment — corre npm run db:seed primero');

    const { rows: [country] }   = await client.query(`SELECT id FROM public."Country" LIMIT 1`);
    const { rows: [sexF] }      = await client.query(`SELECT id FROM public."BiologicalSex" WHERE code = 'F' LIMIT 1`);
    const { rows: [sexFallback] } = await client.query(`SELECT id FROM public."BiologicalSex" LIMIT 1`);
    const sexId = sexF?.id ?? sexFallback?.id;
    const { rows: [currency] }  = await client.query(`SELECT id FROM public."Currency" LIMIT 1`);
    const { rows: [serviceUnit] } = await client.query(
      `SELECT id FROM public."ServiceUnit" WHERE "organizationId" = $1 LIMIT 1`,
      [estabHIS.organizationId]
    );

    if (!country || !sexId || !currency || !serviceUnit) {
      throw new Error('Catálogos base incompletos (Country/BiologicalSex/Currency/ServiceUnit)');
    }

    const { rows: [eceEstab] } = await client.query(
      `SELECT id FROM ece.establecimiento WHERE establishment_id = $1 LIMIT 1`,
      [estabHIS.id]
    );
    if (!eceEstab) throw new Error('ece.establecimiento no vinculado — seed base ECE requerido');

    const { rows: [eceInst] } = await client.query(`SELECT id FROM ece.institucion LIMIT 1`);
    if (!eceInst) throw new Error('ece.institucion vacía — seed base ECE requerido');

    // Servicio maternidad (o cualquier servicio disponible)
    const { rows: [eceServicioMatern] } = await client.query(
      `SELECT id FROM ece.servicio WHERE establecimiento_id = $1 LIMIT 1`,
      [eceEstab.id]
    );

    // Cama sala de partos
    let camaId = null;
    if (eceServicioMatern) {
      const { rows: [cama] } = await client.query(
        `INSERT INTO ece.cama (servicio_id, codigo, estado)
         VALUES ($1, 'SP-01', 'disponible')
         ON CONFLICT (servicio_id, codigo) DO UPDATE SET estado = ece.cama.estado
         RETURNING id`,
        [eceServicioMatern.id]
      );
      camaId = cama.id;
    }

    // ── 1. Personal obstétrico demo ────────────────────────────────────
    const basePersonal = { institId: eceInst.id, estabId: eceEstab.id };

    const idTO  = await upsertPersonal(client, { doc: '60100001-1', nombre: 'Dra. Carmen Ortega Demo (Toco)', jvpm: 'JVPM-TO-01', ...basePersonal });
    const idMC  = await upsertPersonal(client, { doc: '60100002-2', nombre: 'Dr. Luis Medina Demo (MC)',     jvpm: 'JVPM-MC-02', ...basePersonal });
    const idENF = await upsertPersonal(client, { doc: '60100003-3', nombre: 'Enf. Rosa Pérez Demo (ENF)',   jvpm: 'JVPM-ENF-02', ...basePersonal });
    const idADM = await upsertPersonal(client, { doc: '60100004-4', nombre: 'Adm. Pedro Fuentes Demo',      jvpm: null,           ...basePersonal });
    const idNEO = await upsertPersonal(client, { doc: '60100005-5', nombre: 'Dr. Mario Neonatólogo Demo',   jvpm: 'JVPM-NEO-01', ...basePersonal });
    const idDIR = await upsertPersonal(client, { doc: '60100006-6', nombre: 'Dra. Ana Directora Demo',      jvpm: 'JVPM-DIR-02', ...basePersonal });

    for (const [pid, rol] of [[idTO, 'MT'], [idMC, 'MC'], [idENF, 'ENF'], [idADM, 'ADM'], [idNEO, 'MT'], [idDIR, 'DIR']]) {
      await asignarRol(client, pid, rol, eceEstab.id);
    }
    for (const pid of [idTO, idMC, idENF, idADM, idNEO, idDIR]) {
      await upsertFirma(client, pid);
    }

    // ── 2. Paciente madre (public.Patient + ece.paciente) ───────────────
    const MRN_MADRE = 'DEMO-OBS-ANA-001';
    const EXP_MADRE = 'DEMO-OBS-001';
    const DUI_MADRE = '11223344-5';
    const NUI_MADRE = 'DEMOOBSANA0000000001';

    const { rows: [pubMadre] } = await client.query(
      `INSERT INTO public."Patient"
         (id, "organizationId", mrn, "firstName", "lastName", "biologicalSexId",
          "dateOfBirth", "isUnknown", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1::uuid, $2, 'Ana', 'Rivera Demo', $3::uuid,
               '1993-08-15'::date, false, now(), now())
       ON CONFLICT ("organizationId", mrn) DO UPDATE SET "updatedAt" = now()
       RETURNING id`,
      [estabHIS.organizationId, MRN_MADRE, sexId]
    );
    report.madrePublicPatientId = pubMadre.id;

    const { rows: [eceMadre] } = await client.query(
      `INSERT INTO ece.paciente
         (public_patient_id, establecimiento_id, numero_expediente,
          nui, dui, origen_identidad,
          estado_familiar, ocupacion, nacionalidad, direccion, telefono,
          primer_nombre, primer_apellido, fecha_nacimiento, sexo)
       VALUES ($1, $2, $3, $4, $5, 'verificado',
               'casada', 'Ama de casa', 'Salvadoreña',
               'Col. Miramundo, Pje. 4, San Salvador', '7234-5678',
               'Ana', 'Rivera Demo', '1993-08-15'::date, 'F')
       ON CONFLICT (establecimiento_id, numero_expediente)
         DO UPDATE SET public_patient_id = EXCLUDED.public_patient_id
       RETURNING id`,
      [pubMadre.id, eceEstab.id, EXP_MADRE, NUI_MADRE, DUI_MADRE]
    );
    const madreId = eceMadre.id;
    report.madrePacienteId = madreId;

    // ── 3. Encounter madre (AdmissionType = BIRTH) ──────────────────────
    const ENC_MADRE = 'DEMO-OBS-ENC-ANA-001';
    const t0 = new Date('2026-05-16T22:00:00-06:00'); // ingreso trabajo de parto

    const { rows: [encMadre] } = await client.query(
      `INSERT INTO public."Encounter"
         (id, "countryId", "organizationId", "establishmentId", "serviceUnitId",
          "patientId", "admissionType", "encounterNumber", "admittedAt",
          "currencyId", "exchangeRateToFunc", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid,
               $5::uuid, 'BIRTH'::"AdmissionType", $6,
               $7::timestamptz, $8::uuid, 1.0, now(), now())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [country.id, estabHIS.organizationId, estabHIS.id, serviceUnit.id,
       pubMadre.id, ENC_MADRE, t0.toISOString(), currency.id]
    );
    let madreEncounterId = encMadre?.id;
    if (!madreEncounterId) {
      const { rows: [ex] } = await client.query(
        `SELECT id FROM public."Encounter" WHERE "encounterNumber" = $1`, [ENC_MADRE]
      );
      madreEncounterId = ex?.id;
    }
    report.madreEncounterId = madreEncounterId;

    // ── 4. Episodio madre ────────────────────────────────────────────────
    const { rows: [existEpiMadre] } = await client.query(
      `SELECT id FROM ece.episodio_atencion WHERE paciente_id = $1 AND establecimiento_id = $2 LIMIT 1`,
      [madreId, eceEstab.id]
    );

    let madreEpisodioId;
    if (existEpiMadre) {
      madreEpisodioId = existEpiMadre.id;
    } else {
      const { rows: [epiMadre] } = await client.query(
        `INSERT INTO ece.episodio_atencion
           (paciente_id, establecimiento_id, public_encounter_id,
            modalidad, servicio_categoria, servicio_id,
            origen_consulta, modalidad_atencion, motivo,
            fecha_hora_inicio, estado, creado_por)
         VALUES ($1, $2, $3,
                 'hospitalario', 'maternidad', $4,
                 'espontanea', 'presencial',
                 'Trabajo de parto activo — 32 semanas de gestación (FUR 2026-02-21)',
                 $5, 'en_curso', $6)
         RETURNING id`,
        [madreId, eceEstab.id, madreEncounterId,
         eceServicioMatern?.id ?? null, t0.toISOString(), idTO]
      );
      madreEpisodioId = epiMadre.id;

      await client.query(
        `INSERT INTO ece.episodio_hospitalario
           (episodio_id, circunstancia_ingreso, procedencia_ingreso,
            modalidad_hospitalaria, fecha_hora_orden_ingreso, servicio_ingreso_id)
         VALUES ($1, 'demanda_espontanea', 'emergencia',
                 'maternidad', $2, $3)`,
        [madreEpisodioId, t0.toISOString(), eceServicioMatern?.id ?? null]
      );

      if (camaId) {
        await client.query(
          `INSERT INTO ece.asignacion_cama (episodio_id, cama_id, desde)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [madreEpisodioId, camaId, t0.toISOString()]
        );
        await client.query(
          `UPDATE ece.cama SET estado = 'ocupada' WHERE id = $1 AND estado = 'disponible'`,
          [camaId]
        );
      }
    }
    report.madreEpisodioId = madreEpisodioId;

    // ── 5. Valoración inicial enfermería obstétrica (firmada) ────────────
    const tValEnf = new Date('2026-05-16T22:30:00-06:00');

    const { rows: [valEnfRow] } = await client.query(
      `INSERT INTO ece.registro_enfermeria
         (instancia_id, episodio_id, turno, nota_evolucion, plan_cuidados, valoracion_enf, registrado_por)
       VALUES (gen_random_uuid(), $1, 'nocturno',
               'Valoración inicial obstétrica: paciente consciente, orientada, dinámica uterina irregular c/5 min. CTG reactivo. FU 30 cm. Borramiento 50%, dilatación 4 cm, encajamiento III plano. Membranas íntegras.',
               'Monitoreo electrónico fetal continuo. VSV c/30 min. Hidratación IV. Posición lateral izquierda. Preparar sala de partos.',
               $2::jsonb, $3)
       RETURNING id`,
      [
        madreEpisodioId,
        JSON.stringify({
          semanas_gestacion: 38,
          fur: '2026-02-21',
          fum: '2026-02-21',
          gestas_previas: 1,
          partos_previos: 1,
          abortos: 0,
          cesareas: 0,
          control_prenatal: true,
          numero_controles: 6,
          dinamica_uterina: 'irregular c/5 min',
          fhu_cm: 30,
          borramiento_pct: 50,
          dilatacion_cm: 4,
          plano_hodge: 3,
          membranas: 'integras',
          bcf: 148,
          presentacion: 'cefalica',
          posicion: 'OAI',
          dolor_eva: 6,
          braden: 20,
          caidas_riesgo: 'bajo',
        }),
        idENF,
      ]
    );

    const instValEnf = await crearInstancia(client, {
      tipoDocCodigo: 'REG_ENF', episodioId: madreEpisodioId, pacienteId: madreId,
      registroId: valEnfRow.id, estadoCodigo: 'borrador', accion: 'crear',
      ejecutadoPor: idENF, rolCodigo: 'ENF', observacion: 'Valoración inicial obstétrica',
    });
    await client.query(
      `UPDATE ece.registro_enfermeria SET instancia_id = $1 WHERE id = $2`,
      [instValEnf.instanciaId, valEnfRow.id]
    );
    const veRev = await avanzarEstado(client, {
      instanciaId: instValEnf.instanciaId, estadoAnteriorId: instValEnf.estadoId,
      tipoDocCodigo: 'REG_ENF', nuevoEstadoCodigo: 'en_revision',
      accion: 'enviar_revision', ejecutadoPor: idENF, rolCodigo: 'ENF',
    });
    await avanzarEstado(client, {
      instanciaId: instValEnf.instanciaId, estadoAnteriorId: veRev,
      tipoDocCodigo: 'REG_ENF', nuevoEstadoCodigo: 'firmado',
      accion: 'firmar', ejecutadoPor: idENF, rolCodigo: 'ENF',
      observacion: 'Valoración inicial obstétrica firmada por ENF',
    });
    report.documentos.push({ tipo: 'REG_ENF (valoracion_obs_inicial)', id: instValEnf.instanciaId, estado: 'firmado' });

    // ── 6. Signos vitales maternos — c/1 h durante trabajo de parto ──────
    const svMaternosData = [
      { ts: '2026-05-16T22:30:00-06:00', ps: 110, pd: 70, fc: 90, fr: 18, temp: 37.0, spo2: 98, dolor: 6 },
      { ts: '2026-05-16T23:30:00-06:00', ps: 112, pd: 72, fc: 92, fr: 18, temp: 37.1, spo2: 98, dolor: 7 },
      { ts: '2026-05-17T00:30:00-06:00', ps: 108, pd: 68, fc: 94, fr: 20, temp: 37.2, spo2: 97, dolor: 8 },
    ];
    for (const sv of svMaternosData) {
      const { rows: [svRow] } = await client.query(
        `INSERT INTO ece.signos_vitales
           (instancia_id, episodio_id, fecha_hora_toma,
            presion_sistolica, presion_diastolica, frecuencia_cardiaca,
            frecuencia_respiratoria, temperatura, saturacion_o2,
            escala_dolor, registrado_por)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [madreEpisodioId, new Date(sv.ts).toISOString(),
         sv.ps, sv.pd, sv.fc, sv.fr, sv.temp, sv.spo2, sv.dolor, idENF]
      );
      const instSV = await crearInstancia(client, {
        tipoDocCodigo: 'SIG_VIT', episodioId: madreEpisodioId, pacienteId: madreId,
        registroId: svRow.id, estadoCodigo: 'firmado', accion: 'firmar',
        ejecutadoPor: idENF, rolCodigo: 'ENF',
      });
      await client.query(
        `UPDATE ece.signos_vitales SET instancia_id = $1 WHERE id = $2`,
        [instSV.instanciaId, svRow.id]
      );
      report.documentos.push({ tipo: 'SIG_VIT (materno)', id: instSV.instanciaId, estado: 'firmado' });
    }

    // ── 7. Partograma (EceDocumentoObstetrico) — 6 registros en JSON ─────
    //    Dilatación: 4→6→7→8→9→10 cm en 6 h (curva OMS normal)
    const tPartInicio = new Date('2026-05-16T22:00:00-06:00');
    const partograma = {
      inicio_vigilancia: tPartInicio.toISOString(),
      curva_alerta_inicio_dilatacion: 4,
      curva_alerta_inicio_tiempo: tPartInicio.toISOString(),
      registros: [
        { hora: '2026-05-16T22:00:00-06:00', dilatacion_cm: 4,  contracciones_10min: 2, duracion_cont_seg: 30, bcf: 148, plano_hodge: 3 },
        { hora: '2026-05-16T23:00:00-06:00', dilatacion_cm: 6,  contracciones_10min: 3, duracion_cont_seg: 40, bcf: 145, plano_hodge: 3 },
        { hora: '2026-05-17T00:00:00-06:00', dilatacion_cm: 7,  contracciones_10min: 3, duracion_cont_seg: 45, bcf: 142, plano_hodge: 2 },
        { hora: '2026-05-17T01:00:00-06:00', dilatacion_cm: 8,  contracciones_10min: 4, duracion_cont_seg: 50, bcf: 140, plano_hodge: 2 },
        { hora: '2026-05-17T02:00:00-06:00', dilatacion_cm: 9,  contracciones_10min: 4, duracion_cont_seg: 55, bcf: 138, plano_hodge: 1 },
        { hora: '2026-05-17T03:00:00-06:00', dilatacion_cm: 10, contracciones_10min: 5, duracion_cont_seg: 60, bcf: 136, plano_hodge: 0 },
      ],
      curva_alerta_cruzada: false,
      observaciones: 'Progresión normal. Curva por debajo de alerta OMS. Ruptura espontánea de membranas a las 03:00 (líquido amniótico claro).',
    };

    // Periodo expulsivo (30 min activo)
    const tExpInicio = new Date('2026-05-17T03:00:00-06:00');
    const tExpFin    = new Date('2026-05-17T03:30:00-06:00');
    const laborParto = {
      inicio_periodo_expulsivo: tExpInicio.toISOString(),
      fin_periodo_expulsivo:    tExpFin.toISOString(),
      duracion_expulsivo_min:   30,
      tipo_parto:    'vaginal_eutocico',
      presentacion:  'cefalica',
      posicion_parto: 'litotomia',
      pujos: 'efectivos c/3 min',
      ruptura_membranas: { tipo: 'espontanea', hora: '2026-05-17T03:00:00-06:00', liquido: 'claro' },
      uso_oxitocina: false,
      uso_forzeps:   false,
      uso_vacuum:    false,
      episiotomia:   false,
      desgarros:     'primero_grado_perineal',
      sutura:        'vicryl_2_0',
      complicaciones_maternas: 'ninguna',
    };

    // Nacimiento RN
    const tNacimiento = new Date('2026-05-17T03:30:00-06:00');
    const salaExpulsion = {
      fecha_hora_nacimiento: tNacimiento.toISOString(),
      tipo_nacimiento: 'cefálico espontáneo',
      circular_cordon: false,
      liquido_amniotico: 'claro',
      placenta: {
        hora_alumbramiento: new Date('2026-05-17T03:44:00-06:00').toISOString(),
        mecanismo: 'Duncan',
        completa: true,
        peso_g: 480,
        membranas: 'completas',
        cordon_normal: true,
        minutos_desde_nacimiento: 14,
      },
      perdida_sangre_ml: 280,
      uterotonicos: [{ medicamento: 'Oxitocina 10 UI IM', hora: '2026-05-17T03:30:00-06:00' }],
    };

    // Atención RN
    const atencionRn = {
      fecha_hora_nacimiento: tNacimiento.toISOString(),
      sexo:              'F',
      peso_g:            3200,
      talla_cm:          49,
      perimetro_cefalico_cm: 34,
      edad_gestacional_semanas: 38,
      apgar: { minuto1: 9, minuto5: 10, minuto10: 10 },
      reanimacion_neonatal: false,
      motivo_no_reanimacion: 'RN vigoroso — llanto inmediato, tono y color adecuados',
      temperatura_inicial: 36.9,
      saturacion_o2: 97,
      frecuencia_cardiaca: 152,
      frecuencia_respiratoria: 48,
      lactancia_inicio: {
        hora: new Date('2026-05-17T03:45:00-06:00').toISOString(),
        tipo: 'lactancia_materna_exclusiva',
        prendida: true,
      },
      contacto_piel_piel: true,
      profilaxsis: {
        vitamina_k: true,
        nitrato_plata_ocular: true,
        bcg: false,
        hep_b: false,
      },
      traslado_alojamiento_conjunto: {
        hora: new Date('2026-05-17T04:30:00-06:00').toISOString(),
        condicion: 'estable',
      },
    };

    // Insertar EceDocumentoObstetrico (un registro para el episodio madre)
    const { rows: [existDocObs] } = await client.query(
      `SELECT id FROM ece.documento_obstetrico WHERE episodio_id = $1 LIMIT 1`,
      [madreEpisodioId]
    );

    let docObsId;
    if (existDocObs) {
      docObsId = existDocObs.id;
    } else {
      const { rows: [docObs] } = await client.query(
        `INSERT INTO ece.documento_obstetrico
           (instancia_id, episodio_id, paciente_id,
            partograma, labor_parto, sala_expulsion, atencion_rn,
            registrado_por)
         VALUES (gen_random_uuid(), $1, $2,
                 $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb,
                 $7)
         RETURNING id`,
        [
          madreEpisodioId, madreId,
          JSON.stringify(partograma), JSON.stringify(laborParto),
          JSON.stringify(salaExpulsion), JSON.stringify(atencionRn),
          idTO,
        ]
      );
      docObsId = docObs.id;
    }

    // Instancia + firma del documento obstétrico
    const instDocObs = await crearInstancia(client, {
      tipoDocCodigo: 'DOC_OBS', episodioId: madreEpisodioId, pacienteId: madreId,
      registroId: docObsId, estadoCodigo: 'borrador', accion: 'crear',
      ejecutadoPor: idTO, rolCodigo: 'MT', observacion: 'Partograma + atención neonatal',
    });
    await client.query(
      `UPDATE ece.documento_obstetrico SET instancia_id = $1 WHERE id = $2`,
      [instDocObs.instanciaId, docObsId]
    );
    const doRev = await avanzarEstado(client, {
      instanciaId: instDocObs.instanciaId, estadoAnteriorId: instDocObs.estadoId,
      tipoDocCodigo: 'DOC_OBS', nuevoEstadoCodigo: 'en_revision',
      accion: 'enviar_revision', ejecutadoPor: idTO, rolCodigo: 'MT',
    });
    const doFirm = await avanzarEstado(client, {
      instanciaId: instDocObs.instanciaId, estadoAnteriorId: doRev,
      tipoDocCodigo: 'DOC_OBS', nuevoEstadoCodigo: 'firmado',
      accion: 'firmar', ejecutadoPor: idTO, rolCodigo: 'MT',
      observacion: 'Partograma y atención neonatal firmados por tocólogo',
    });
    await avanzarEstado(client, {
      instanciaId: instDocObs.instanciaId, estadoAnteriorId: doFirm,
      tipoDocCodigo: 'DOC_OBS', nuevoEstadoCodigo: 'validado',
      accion: 'validar', ejecutadoPor: idMC, rolCodigo: 'MC',
      observacion: 'Validado por MC — partograma con curva normal sin cruzar alerta',
    });
    report.documentos.push({ tipo: 'DOC_OBS (partograma+atencionRN)', id: instDocObs.instanciaId, estado: 'validado' });

    // ── 8. Paciente RN (public.Patient + ece.paciente) ───────────────────
    const MRN_RN = 'DEMO-OBS-RN-001';
    const EXP_RN = 'DEMO-OBS-RN-001';
    const NUI_RN = 'DEMOOBSRN00000000001';

    // sexId ya corresponde a F (o fallback)
    const { rows: [pubRN] } = await client.query(
      `INSERT INTO public."Patient"
         (id, "organizationId", mrn, "firstName", "lastName", "biologicalSexId",
          "dateOfBirth", "isUnknown", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1::uuid, $2, 'RN de', 'Rivera Demo', $3::uuid,
               '2026-05-17'::date, false, now(), now())
       ON CONFLICT ("organizationId", mrn) DO UPDATE SET "updatedAt" = now()
       RETURNING id`,
      [estabHIS.organizationId, MRN_RN, sexId]
    );
    report.rnPublicPatientId = pubRN.id;

    const { rows: [eceRN] } = await client.query(
      `INSERT INTO ece.paciente
         (public_patient_id, establecimiento_id, numero_expediente,
          nui, origen_identidad, sexo, fecha_nacimiento,
          primer_nombre, primer_apellido)
       VALUES ($1, $2, $3, $4, 'verificado', 'F', '2026-05-17'::date,
               'RN de', 'Rivera Demo')
       ON CONFLICT (establecimiento_id, numero_expediente)
         DO UPDATE SET public_patient_id = EXCLUDED.public_patient_id
       RETURNING id`,
      [pubRN.id, eceEstab.id, EXP_RN, NUI_RN]
    );
    const rnId = eceRN.id;
    report.rnPacienteId = rnId;

    // Vincular RN al documento obstétrico
    await client.query(
      `UPDATE ece.documento_obstetrico SET recien_nacido_paciente_id = $1 WHERE id = $2`,
      [rnId, docObsId]
    );

    // ── 9. Encounter + episodio RN (AdmissionType = NEWBORN) ────────────
    const ENC_RN = 'DEMO-OBS-ENC-RN-001';
    const { rows: [encRN] } = await client.query(
      `INSERT INTO public."Encounter"
         (id, "countryId", "organizationId", "establishmentId", "serviceUnitId",
          "patientId", "admissionType", "encounterNumber", "admittedAt",
          "currencyId", "exchangeRateToFunc", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid,
               $5::uuid, 'NEWBORN'::"AdmissionType", $6,
               $7::timestamptz, $8::uuid, 1.0, now(), now())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [country.id, estabHIS.organizationId, estabHIS.id, serviceUnit.id,
       pubRN.id, ENC_RN, tNacimiento.toISOString(), currency.id]
    );
    let rnEncounterId = encRN?.id;
    if (!rnEncounterId) {
      const { rows: [ex] } = await client.query(
        `SELECT id FROM public."Encounter" WHERE "encounterNumber" = $1`, [ENC_RN]
      );
      rnEncounterId = ex?.id;
    }
    report.rnEncounterId = rnEncounterId;

    const { rows: [existEpiRN] } = await client.query(
      `SELECT id FROM ece.episodio_atencion WHERE paciente_id = $1 AND establecimiento_id = $2 LIMIT 1`,
      [rnId, eceEstab.id]
    );

    let rnEpisodioId;
    if (existEpiRN) {
      rnEpisodioId = existEpiRN.id;
    } else {
      const { rows: [epiRN] } = await client.query(
        `INSERT INTO ece.episodio_atencion
           (paciente_id, establecimiento_id, public_encounter_id,
            modalidad, servicio_categoria, servicio_id,
            origen_consulta, modalidad_atencion, motivo,
            fecha_hora_inicio, estado, creado_por)
         VALUES ($1, $2, $3,
                 'hospitalario', 'neonatologia', $4,
                 'referencia_interna', 'presencial',
                 'Recién nacido vivo — parto vaginal eutócico, 38 sem, 3200g, Apgar 9-10-10',
                 $5, 'en_curso', $6)
         RETURNING id`,
        [rnId, eceEstab.id, rnEncounterId,
         eceServicioMatern?.id ?? null, tNacimiento.toISOString(), idNEO]
      );
      rnEpisodioId = epiRN.id;

      // Hospitalario RN (alojamiento conjunto)
      await client.query(
        `INSERT INTO ece.episodio_hospitalario
           (episodio_id, circunstancia_ingreso, procedencia_ingreso,
            modalidad_hospitalaria, fecha_hora_orden_ingreso)
         VALUES ($1, 'nacimiento', 'sala_partos',
                 'alojamiento_conjunto', $2)`,
        [rnEpisodioId, tNacimiento.toISOString()]
      );
    }
    report.rnEpisodioId = rnEpisodioId;

    // SV neonatal inicial
    const { rows: [svRNRow] } = await client.query(
      `INSERT INTO ece.signos_vitales
         (instancia_id, episodio_id, fecha_hora_toma,
          frecuencia_cardiaca, frecuencia_respiratoria, temperatura,
          saturacion_o2, peso, talla, perimetro_cefalico, registrado_por)
       VALUES (gen_random_uuid(), $1, $2, 152, 48, 36.9, 97,
               3.20, 49.0, 34.0, $3)
       RETURNING id`,
      [rnEpisodioId, tNacimiento.toISOString(), idNEO]
    );
    const instSVRN = await crearInstancia(client, {
      tipoDocCodigo: 'SIG_VIT', episodioId: rnEpisodioId, pacienteId: rnId,
      registroId: svRNRow.id, estadoCodigo: 'firmado', accion: 'firmar',
      ejecutadoPor: idNEO, rolCodigo: 'MT',
      observacion: 'Signos vitales neonatales al nacimiento',
    });
    await client.query(
      `UPDATE ece.signos_vitales SET instancia_id = $1 WHERE id = $2`,
      [instSVRN.instanciaId, svRNRow.id]
    );
    report.documentos.push({ tipo: 'SIG_VIT (neonatal)', id: instSVRN.instanciaId, estado: 'firmado' });

    // ── 10. Epicrisis materna — 24 h después, firmada TO → validada MC ───
    const tEgresoMadre = new Date('2026-05-17T22:00:00-06:00');

    const { rows: [existEpicrisisMadre] } = await client.query(
      `SELECT id FROM ece.epicrisis_egreso WHERE episodio_id = $1`, [madreEpisodioId]
    );

    let epicrisisMadreId;
    if (existEpicrisisMadre) {
      epicrisisMadreId = existEpicrisisMadre.id;
    } else {
      const { rows: [epiMadre] } = await client.query(
        `INSERT INTO ece.epicrisis_egreso
           (instancia_id, episodio_id, paciente_id, fecha_hora_egreso,
            tipo_egreso, circunstancia_alta,
            diagnosticos_egreso, resumen_evolucion,
            procedimientos_realizados, manejo_terapeutico, indicaciones_alta,
            medico_tratante_id, visto_jefe_servicio_id)
         VALUES (gen_random_uuid(), $1, $2, $3,
                 'vivo', 'alta_puerpera',
                 $4::jsonb,
                 'Paciente de 32 años (G2P2) con parto vaginal eutócico a las 38 semanas. Evolución normal. RN vivo en buen estado. Lactancia materna instaurada. Egresa en buenas condiciones.',
                 $5::jsonb,
                 'Oxitocina 10 UI IM intraparto. Sutura periné desgarros I grado. Sin complicaciones.',
                 'Lactancia materna exclusiva. Higiene perineal. Control puerperio 7 días. Planificación familiar.',
                 $6, $7)
         RETURNING id`,
        [
          madreEpisodioId, madreId, tEgresoMadre.toISOString(),
          JSON.stringify([
            { cie10: 'O80', descripcion: 'Parto único espontáneo, presentación de vértice', tipo: 'principal' },
          ]),
          JSON.stringify([
            { codigo: 'O80', descripcion: 'Parto vaginal eutócico', fecha: '2026-05-17' },
          ]),
          idTO, idMC,
        ]
      );
      epicrisisMadreId = epiMadre.id;
    }

    const instEpiMadre = await crearInstancia(client, {
      tipoDocCodigo: 'EPICRISIS', episodioId: madreEpisodioId, pacienteId: madreId,
      registroId: epicrisisMadreId, estadoCodigo: 'borrador', accion: 'crear',
      ejecutadoPor: idTO, rolCodigo: 'MT',
    });
    await client.query(
      `UPDATE ece.epicrisis_egreso SET instancia_id = $1 WHERE id = $2`,
      [instEpiMadre.instanciaId, epicrisisMadreId]
    );
    const emFirm = await avanzarEstado(client, {
      instanciaId: instEpiMadre.instanciaId, estadoAnteriorId: instEpiMadre.estadoId,
      tipoDocCodigo: 'EPICRISIS', nuevoEstadoCodigo: 'firmado',
      accion: 'firmar', ejecutadoPor: idTO, rolCodigo: 'MT',
      observacion: 'Epicrisis materna firmada por tocólogo',
    });
    const emVal = await avanzarEstado(client, {
      instanciaId: instEpiMadre.instanciaId, estadoAnteriorId: emFirm,
      tipoDocCodigo: 'EPICRISIS', nuevoEstadoCodigo: 'validado',
      accion: 'validar', ejecutadoPor: idMC, rolCodigo: 'MC',
      observacion: 'Validado por MC',
    });
    await avanzarEstado(client, {
      instanciaId: instEpiMadre.instanciaId, estadoAnteriorId: emVal,
      tipoDocCodigo: 'EPICRISIS', nuevoEstadoCodigo: 'certificado',
      accion: 'certificar', ejecutadoPor: idDIR, rolCodigo: 'DIR',
      observacion: 'Certificación Dirección — Art. 21 NTEC',
    });
    report.documentos.push({ tipo: 'EPICRISIS (materna)', id: instEpiMadre.instanciaId, estado: 'certificado' });

    // Cerrar episodio materno
    await client.query(
      `UPDATE ece.episodio_atencion
       SET estado = 'cerrado', fecha_hora_cierre = $1
       WHERE id = $2 AND estado = 'en_curso'`,
      [tEgresoMadre.toISOString(), madreEpisodioId]
    );
    await client.query(
      `UPDATE ece.episodio_hospitalario
       SET fecha_hora_egreso = $1, tipo_egreso = 'vivo', circunstancia_alta = 'alta_puerpera'
       WHERE episodio_id = $2`,
      [tEgresoMadre.toISOString(), madreEpisodioId]
    );
    if (camaId) {
      await client.query(
        `UPDATE ece.asignacion_cama SET hasta = $1 WHERE episodio_id = $2 AND hasta IS NULL`,
        [tEgresoMadre.toISOString(), madreEpisodioId]
      );
      await client.query(
        `UPDATE ece.cama SET estado = 'limpieza' WHERE id = $1 AND estado = 'ocupada'`,
        [camaId]
      );
    }

    // ── 11. Epicrisis RN ─────────────────────────────────────────────────
    const tEgresoRN = new Date('2026-05-17T22:00:00-06:00');

    const { rows: [existEpicrisisRN] } = await client.query(
      `SELECT id FROM ece.epicrisis_egreso WHERE episodio_id = $1`, [rnEpisodioId]
    );

    let epicrisisRNId;
    if (existEpicrisisRN) {
      epicrisisRNId = existEpicrisisRN.id;
    } else {
      const { rows: [epiRNDoc] } = await client.query(
        `INSERT INTO ece.epicrisis_egreso
           (instancia_id, episodio_id, paciente_id, fecha_hora_egreso,
            tipo_egreso, circunstancia_alta,
            diagnosticos_egreso, resumen_evolucion,
            procedimientos_realizados, manejo_terapeutico, indicaciones_alta,
            medico_tratante_id)
         VALUES (gen_random_uuid(), $1, $2, $3,
                 'vivo', 'alta_neonato',
                 $4::jsonb,
                 'RN femenino de 38 semanas, 3200 g, Apgar 9-10-10. Sin reanimación. Lactancia materna. Profilaxis completa. Evolución neonatal normal. Egresa en alojamiento conjunto con madre.',
                 $5::jsonb,
                 'Vitamina K IM. Nitrato de plata ocular. Sin medicación adicional.',
                 'Lactancia materna exclusiva. Control neonatal en 3 días.',
                 $6)
         RETURNING id`,
        [
          rnEpisodioId, rnId, tEgresoRN.toISOString(),
          JSON.stringify([
            { cie10: 'Z38.0', descripcion: 'Recién nacido único, nacido en hospital', tipo: 'principal' },
          ]),
          JSON.stringify([
            { codigo: 'PROFILAXIS_NEO', descripcion: 'Profilaxis neonatal completa', fecha: '2026-05-17' },
          ]),
          idNEO,
        ]
      );
      epicrisisRNId = epiRNDoc.id;
    }

    const instEpiRN = await crearInstancia(client, {
      tipoDocCodigo: 'EPICRISIS', episodioId: rnEpisodioId, pacienteId: rnId,
      registroId: epicrisisRNId, estadoCodigo: 'borrador', accion: 'crear',
      ejecutadoPor: idNEO, rolCodigo: 'MT',
    });
    await client.query(
      `UPDATE ece.epicrisis_egreso SET instancia_id = $1 WHERE id = $2`,
      [instEpiRN.instanciaId, epicrisisRNId]
    );
    const erFirm = await avanzarEstado(client, {
      instanciaId: instEpiRN.instanciaId, estadoAnteriorId: instEpiRN.estadoId,
      tipoDocCodigo: 'EPICRISIS', nuevoEstadoCodigo: 'firmado',
      accion: 'firmar', ejecutadoPor: idNEO, rolCodigo: 'MT',
      observacion: 'Epicrisis neonatal firmada por neonatólogo',
    });
    const erVal = await avanzarEstado(client, {
      instanciaId: instEpiRN.instanciaId, estadoAnteriorId: erFirm,
      tipoDocCodigo: 'EPICRISIS', nuevoEstadoCodigo: 'validado',
      accion: 'validar', ejecutadoPor: idMC, rolCodigo: 'MC',
    });
    await avanzarEstado(client, {
      instanciaId: instEpiRN.instanciaId, estadoAnteriorId: erVal,
      tipoDocCodigo: 'EPICRISIS', nuevoEstadoCodigo: 'certificado',
      accion: 'certificar', ejecutadoPor: idDIR, rolCodigo: 'DIR',
    });
    report.documentos.push({ tipo: 'EPICRISIS (neonatal)', id: instEpiRN.instanciaId, estado: 'certificado' });

    // Cerrar episodio RN
    await client.query(
      `UPDATE ece.episodio_atencion
       SET estado = 'cerrado', fecha_hora_cierre = $1
       WHERE id = $2 AND estado = 'en_curso'`,
      [tEgresoRN.toISOString(), rnEpisodioId]
    );
    await client.query(
      `UPDATE ece.episodio_hospitalario
       SET fecha_hora_egreso = $1, tipo_egreso = 'vivo', circunstancia_alta = 'alta_neonato'
       WHERE episodio_id = $2`,
      [tEgresoRN.toISOString(), rnEpisodioId]
    );

    await client.query('COMMIT');

  } catch (err) {
    await client.query('ROLLBACK');
    report.errores.push(err.message);
    console.error('[ERROR] Rollback:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await client.end();
  }

  // ─── Reporte ─────────────────────────────────────────────────────────
  console.log('\n=== SEED DEMO OBSTÉTRICO — REPORTE ===');
  console.log(`madre ECE      : ${report.madrePacienteId}`);
  console.log(`madre Encounter: ${report.madreEncounterId}`);
  console.log(`madre episodio : ${report.madreEpisodioId}`);
  console.log(`RN ECE         : ${report.rnPacienteId}`);
  console.log(`RN Encounter   : ${report.rnEncounterId}`);
  console.log(`RN episodio    : ${report.rnEpisodioId}`);
  console.log(`\nDocumentos (${report.documentos.length}):`);
  for (const d of report.documentos) {
    console.log(`  [${d.estado.padEnd(12)}] ${d.tipo.padEnd(45)} ${d.id}`);
  }
  if (report.errores.length) {
    console.log(`\nErrores (${report.errores.length}):`);
    for (const e of report.errores) console.log(`  !! ${e}`);
  } else {
    console.log('\nSeed completado exitosamente.');
    console.log('\nPara limpiar:');
    console.log(`  DELETE FROM ece.paciente WHERE numero_expediente IN ('DEMO-OBS-001','DEMO-OBS-RN-001');`);
    console.log(`  DELETE FROM public."Patient" WHERE mrn IN ('DEMO-OBS-ANA-001','DEMO-OBS-RN-001');`);
  }
}

main();
