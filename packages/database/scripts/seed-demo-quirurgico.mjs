/**
 * seed-demo-quirurgico.mjs
 *
 * Propósito: Flujo quirúrgico completo de demostración — apendicectomía laparoscópica
 * de emergencia ("Carlos Mendoza Demo", DUI 87654321-2).
 *
 * Pasos simulados:
 *   1. Admisión hospitalaria emergencia (ORD_ING firmada+validada)
 *   2. Episodio + episodio_hospitalario abierto
 *   3. Diagnóstico apendicitis aguda (hoja_ingreso + asignación cama quirúrgica)
 *   4. Consentimiento quirúrgico firmado por paciente + MC (CONS_INF tipo=quirurgico)
 *   5. Programación cirugía — public.SurgeryCase (sala 1, cirujano + anestesiólogo)
 *   6. Preop checklist completo (valoracion_preop JSON en acto_quirurgico)
 *   7. WHO sign-in pre-anestesia (SurgeryCase.signInAt)
 *   8. Registro anestésico general endotraqueal + medicamentos + 5 tomas SV (JSON)
 *   9. Acto quirúrgico — apendicectomía laparoscópica 90 min sin complicaciones
 *  10. WHO sign-out (SurgeryCase.signOutAt)
 *  11. URPA recovery — Aldrete 9 → alta a sala (recuperacion_urpa JSON)
 *  12. Epicrisis firmada + validada + certificada (EPICRISIS)
 *  13. Episodio cerrado
 *
 * Idempotente: ON CONFLICT por MRN / numero_expediente / encounterNumber / código OR.
 *
 * Limpiar:
 *   DELETE FROM ece.paciente WHERE numero_expediente = 'DEMO-QUIR-001';
 *   DELETE FROM public."Patient" WHERE mrn = 'DEMO-QUIR-CARLOS-001';
 *
 * Requisito: DIRECT_URL en .env.
 */

import pg from 'pg';

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

// ─── ECE workflow helpers ──────────────────────────────────────────────────────

async function crearInstancia(tx, { tipoDocCodigo, episodioId, pacienteId, registroId, estadoCodigo, accion, ejecutadoPor, rolEjecutorCodigo, observacion }) {
  const { rows: [tipoDoc] } = await tx.query(`SELECT id FROM ece.tipo_documento WHERE codigo = $1`, [tipoDocCodigo]);
  if (!tipoDoc) throw new Error(`tipo_documento no encontrado: ${tipoDocCodigo}`);

  const { rows: [estado] } = await tx.query(
    `SELECT id FROM ece.flujo_estado WHERE tipo_documento_id = $1 AND codigo = $2`,
    [tipoDoc.id, estadoCodigo]
  );
  if (!estado) throw new Error(`flujo_estado no encontrado: ${tipoDocCodigo}/${estadoCodigo}`);

  const { rows: [rol] } = await tx.query(`SELECT id FROM ece.rol WHERE codigo = $1`, [rolEjecutorCodigo]);
  if (!rol) throw new Error(`rol no encontrado: ${rolEjecutorCodigo}`);

  const { rows: [inst] } = await tx.query(
    `INSERT INTO ece.documento_instancia
       (tipo_documento_id, episodio_id, paciente_id, registro_id, estado_actual_id, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tipoDoc.id, episodioId ?? null, pacienteId, registroId ?? null, estado.id, ejecutadoPor]
  );

  await tx.query(
    `INSERT INTO ece.documento_instancia_historial
       (instancia_id, estado_anterior_id, estado_nuevo_id, accion, ejecutado_por, rol_ejecutor_id, observacion)
     VALUES ($1, NULL, $2, $3, $4, $5, $6)`,
    [inst.id, estado.id, accion, ejecutadoPor, rol.id, observacion ?? null]
  );

  return { instanciaId: inst.id, estadoId: estado.id };
}

async function avanzarEstado(tx, { instanciaId, estadoAnteriorId, nuevoEstadoCodigo, tipoDocCodigo, accion, ejecutadoPor, rolEjecutorCodigo, observacion }) {
  const { rows: [tipoDoc] } = await tx.query(`SELECT id FROM ece.tipo_documento WHERE codigo = $1`, [tipoDocCodigo]);
  const { rows: [nuevoEstado] } = await tx.query(
    `SELECT id FROM ece.flujo_estado WHERE tipo_documento_id = $1 AND codigo = $2`,
    [tipoDoc.id, nuevoEstadoCodigo]
  );
  if (!nuevoEstado) throw new Error(`estado destino no encontrado: ${tipoDocCodigo}/${nuevoEstadoCodigo}`);

  const { rows: [rol] } = await tx.query(`SELECT id FROM ece.rol WHERE codigo = $1`, [rolEjecutorCodigo]);

  await tx.query(`UPDATE ece.documento_instancia SET estado_actual_id = $1 WHERE id = $2`, [nuevoEstado.id, instanciaId]);
  await tx.query(
    `INSERT INTO ece.documento_instancia_historial
       (instancia_id, estado_anterior_id, estado_nuevo_id, accion, ejecutado_por, rol_ejecutor_id, observacion)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [instanciaId, estadoAnteriorId, nuevoEstado.id, accion, ejecutadoPor, rol?.id ?? null, observacion ?? null]
  );

  return nuevoEstado.id;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await client.connect();

  const report = {
    pacienteId: null,
    publicPatientId: null,
    episodioId: null,
    surgeryCaseId: null,
    actoQuirurgicoId: null,
    documentos: [],
    errores: [],
  };

  try {
    await client.query('BEGIN');

    // ── 0. FKs base del sistema ──────────────────────────────────────────────
    const { rows: [estab] } = await client.query(`SELECT id, "organizationId" FROM public."Establishment" LIMIT 1`);
    if (!estab) throw new Error('No existe Establishment — corre npm run db:seed primero');

    const { rows: [country] } = await client.query(`SELECT id FROM public."Country" LIMIT 1`);
    const { rows: [sex] } = await client.query(`SELECT id FROM public."BiologicalSex" LIMIT 1`);
    const { rows: [currency] } = await client.query(`SELECT id FROM public."Currency" LIMIT 1`);
    const { rows: [serviceUnit] } = await client.query(
      `SELECT id FROM public."ServiceUnit" WHERE "organizationId" = $1 LIMIT 1`,
      [estab.organizationId]
    );
    if (!country || !sex || !currency || !serviceUnit) {
      throw new Error('Catálogos base incompletos (Country/BiologicalSex/Currency/ServiceUnit)');
    }

    const { rows: [eceEstab] } = await client.query(
      `SELECT id FROM ece.establecimiento WHERE establishment_id = $1 LIMIT 1`, [estab.id]
    );
    if (!eceEstab) throw new Error('ece.establecimiento no vinculado — seed base ECE requerido');

    const { rows: [eceInst] } = await client.query(`SELECT id FROM ece.institucion LIMIT 1`);
    if (!eceInst) throw new Error('ece.institucion vacía — seed base ECE requerido');

    const { rows: [eceServicio] } = await client.query(
      `SELECT id FROM ece.servicio WHERE establecimiento_id = $1 LIMIT 1`, [eceEstab.id]
    );

    // Cama quirúrgica — sala preoperatoria
    let camaId = null;
    if (eceServicio) {
      const { rows: [cama] } = await client.query(
        `INSERT INTO ece.cama (servicio_id, codigo, estado)
         VALUES ($1, 'PREOP-01', 'disponible')
         ON CONFLICT (servicio_id, codigo) DO UPDATE SET estado = ece.cama.estado
         RETURNING id`,
        [eceServicio.id]
      );
      camaId = cama.id;
    }

    // OperatingRoom sala 1
    const { rows: [or] } = await client.query(
      `INSERT INTO public."OperatingRoom" (id, "establishmentId", code, name)
       VALUES (gen_random_uuid(), $1, 'QX-01', 'Quirófano 1 — Cirugía General')
       ON CONFLICT ("establishmentId", code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [estab.id]
    );
    const operatingRoomId = or.id;

    // ── 1. Paciente público ──────────────────────────────────────────────────
    const MRN = 'DEMO-QUIR-CARLOS-001';
    const { rows: [publicPatient] } = await client.query(
      `INSERT INTO public."Patient"
         (id, "organizationId", mrn, "firstName", "lastName", "biologicalSexId",
          "dateOfBirth", "isUnknown", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'Carlos', 'Mendoza Demo', $3,
               '1991-03-15', false, now(), now())
       ON CONFLICT ("organizationId", mrn) DO UPDATE SET "updatedAt" = now()
       RETURNING id`,
      [estab.organizationId, MRN, sex.id]
    );
    report.publicPatientId = publicPatient.id;

    // ── 2. Encounter ─────────────────────────────────────────────────────────
    const ENC_NUMBER = 'DEMO-QUIR-ENC-001';
    const t0 = new Date('2026-05-15T06:00:00-06:00'); // Ingreso emergencia
    const { rows: [encounter] } = await client.query(
      `INSERT INTO public."Encounter"
         (id, "countryId", "organizationId", "establishmentId", "serviceUnitId",
          "patientId", "admissionType", "encounterNumber", "admittedAt",
          "currencyId", "exchangeRateToFunc", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'INPATIENT', $6, $7, $8, 1.0, now(), now())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [country.id, estab.organizationId, estab.id, serviceUnit.id,
       publicPatient.id, ENC_NUMBER, t0.toISOString(), currency.id]
    );
    let encounterId = encounter?.id;
    if (!encounterId) {
      const { rows: [ex] } = await client.query(
        `SELECT id FROM public."Encounter" WHERE "encounterNumber" = $1`, [ENC_NUMBER]
      );
      encounterId = ex?.id;
    }
    if (!encounterId) throw new Error('No se pudo obtener encounterId');

    // ── 3. Personal de salud demo ────────────────────────────────────────────
    const FAKE_HASH = '$argon2id$v=19$m=65536,t=3,p=4$DEMO_SALT_PLACEHOLDER$DEMO_HASH_PLACEHOLDER';

    async function upsertPersonal(doc, nombre, jvpm) {
      const { rows: [p] } = await client.query(
        `INSERT INTO ece.personal_salud
           (documento_identidad, nombre_completo, institucion_id, establecimiento_id, jvpm_codigo)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING RETURNING id`,
        [doc, nombre, eceInst.id, eceEstab.id, jvpm]
      );
      if (p) return p.id;
      const { rows: [ex] } = await client.query(
        `SELECT id FROM ece.personal_salud WHERE documento_identidad = $1 AND establecimiento_id = $2`,
        [doc, eceEstab.id]
      );
      return ex.id;
    }

    async function asignarRol(personalId, rolCodigo) {
      await client.query(
        `INSERT INTO ece.asignacion_rol (personal_id, rol_id, establecimiento_id)
         SELECT $1, r.id, $2 FROM ece.rol r WHERE r.codigo = $3
         ON CONFLICT (personal_id, rol_id, establecimiento_id, servicio_id) DO NOTHING`,
        [personalId, eceEstab.id, rolCodigo]
      );
    }

    const idMT  = await upsertPersonal('61234567-8', 'Dr. Ramón Torres Demo',      'JVPM-MT-Q01');
    const idMC  = await upsertPersonal('72345678-9', 'Dr. Patricia Cirujana Demo', 'JVPM-MC-Q01');
    const idANE = await upsertPersonal('83456789-0', 'Dr. Luis Anestesia Demo',    'JVPM-ANE-Q01');
    const idENF = await upsertPersonal('94567890-1', 'Enf. Sandra Quirofano Demo', 'JVPM-ENF-Q01');
    const idADM = await upsertPersonal('05678901-2', 'Adm. Pedro Admin Demo',      null);
    const idESP = await upsertPersonal('16789012-3', 'Dr. Hugo Especialista Demo', 'JVPM-ESP-Q01');
    const idDIR = await upsertPersonal('27890123-4', 'Dra. Elena Directora Demo',  'JVPM-DIR-Q01');

    for (const pid of [idMT, idMC, idANE, idENF, idADM, idESP, idDIR]) {
      await client.query(
        `INSERT INTO ece.firma_electronica (personal_id, pin_hash, salt_extra)
         VALUES ($1, $2, 'demo-salt-quir')
         ON CONFLICT (personal_id) DO NOTHING`,
        [pid, FAKE_HASH]
      );
    }

    await asignarRol(idMT,  'MT');
    await asignarRol(idMC,  'MC');
    await asignarRol(idANE, 'MC'); // anestesiólogo — rol MC en ECE
    await asignarRol(idENF, 'ENF');
    await asignarRol(idADM, 'ADM');
    await asignarRol(idESP, 'ESP');
    await asignarRol(idDIR, 'DIR');

    // Necesitamos un User público para primarySurgeonId en SurgeryCase
    // Buscar user existente (MC demo o cualquiera) — si no hay, creamos placeholder
    const { rows: [surgeonUser] } = await client.query(
      `SELECT u.id FROM public."User" u WHERE u."organizationId" = $1 LIMIT 1`,
      [estab.organizationId]
    );
    if (!surgeonUser) throw new Error('No existe User en la organización — seed base requerido');
    const surgeonUserId = surgeonUser.id;

    // ── 4. ECE paciente ──────────────────────────────────────────────────────
    const NUM_EXP = 'DEMO-QUIR-001';
    const NUI_DEMO = 'DEMOQUIRCARLOS00001X'; // 19 chars — ajustar si constraint es exactamente 20
    const DUI_DEMO = '87654321-2';

    const { rows: [pacienteRow] } = await client.query(
      `INSERT INTO ece.paciente
         (public_patient_id, establecimiento_id, numero_expediente,
          nui, dui, tipo_registro_identidad,
          estado_familiar, ocupacion, nacionalidad, direccion, telefono,
          responsable_toma_datos)
       VALUES ($1, $2, $3, $4, $5, 'verificado',
               'casado', 'Técnico electricista', 'Salvadoreño',
               'Col. Escalón, Calle Los Bambúes #42, San Salvador', '7654-3210',
               NULL)
       ON CONFLICT (establecimiento_id, numero_expediente)
         DO UPDATE SET public_patient_id = EXCLUDED.public_patient_id
       RETURNING id`,
      [publicPatient.id, eceEstab.id, NUM_EXP, NUI_DEMO, DUI_DEMO]
    );
    const pacienteId = pacienteRow.id;
    report.pacienteId = pacienteId;

    // ── PASO 1: Admisión hospitalaria emergencia — Orden de Ingreso ──────────
    const tOrden = new Date('2026-05-15T06:00:00-06:00');

    const { rows: [ordenRow] } = await client.query(
      `INSERT INTO ece.orden_ingreso
         (paciente_id, circunstancia_ingreso, fecha_hora_orden,
          motivo_ingreso, procedencia, modalidad, medico_ordena,
          data)
       VALUES ($1, 'demanda_espontanea', $2,
               'Dolor abdominal agudo en fosa ilíaca derecha — 18 horas de evolución. Signos peritonitis localizada. Sospecha apendicitis aguda.',
               'emergencia', 'hospitalizacion', $3,
               $4::jsonb)
       RETURNING id`,
      [pacienteId, tOrden.toISOString(), idMT,
       JSON.stringify({
         diagnostico_ingreso: [{ cie10: 'K35.8', descripcion: 'Apendicitis aguda', tipo: 'presuntivo' }],
         prioridad: 'urgente',
       })]
    );
    const ordenIngresoId = ordenRow.id;

    const instOrden = await crearInstancia(client, {
      tipoDocCodigo: 'ORD_ING',
      episodioId: null,
      pacienteId,
      registroId: null,
      estadoCodigo: 'borrador',
      accion: 'crear',
      ejecutadoPor: idMT,
      rolEjecutorCodigo: 'MT',
      observacion: 'Orden ingreso emergencia — apendicitis aguda',
    });
    await client.query(`UPDATE ece.documento_instancia SET registro_id = $1 WHERE id = $2`, [ordenIngresoId, instOrden.instanciaId]);
    await client.query(`UPDATE ece.orden_ingreso SET instancia_id = $1 WHERE id = $2`, [instOrden.instanciaId, ordenIngresoId]);

    const e1 = await avanzarEstado(client, {
      instanciaId: instOrden.instanciaId, estadoAnteriorId: instOrden.estadoId,
      nuevoEstadoCodigo: 'en_revision', tipoDocCodigo: 'ORD_ING',
      accion: 'enviar_revision', ejecutadoPor: idMT, rolEjecutorCodigo: 'MT',
    });
    const e2 = await avanzarEstado(client, {
      instanciaId: instOrden.instanciaId, estadoAnteriorId: e1,
      nuevoEstadoCodigo: 'firmado', tipoDocCodigo: 'ORD_ING',
      accion: 'firmar', ejecutadoPor: idMT, rolEjecutorCodigo: 'MT',
      observacion: 'Firma MT — admisión urgente',
    });
    await avanzarEstado(client, {
      instanciaId: instOrden.instanciaId, estadoAnteriorId: e2,
      nuevoEstadoCodigo: 'validado', tipoDocCodigo: 'ORD_ING',
      accion: 'validar', ejecutadoPor: idMC, rolEjecutorCodigo: 'MC',
      observacion: 'Validado MC — indica cirugía de urgencia',
    });
    report.documentos.push({ paso: 1, tipo: 'ORD_ING', id: instOrden.instanciaId, estado: 'validado' });

    // ── PASO 2: Episodio hospitalario ────────────────────────────────────────
    const { rows: [existingEp] } = await client.query(
      `SELECT ea.id FROM ece.episodio_atencion ea WHERE ea.paciente_id = $1 AND ea.establecimiento_id = $2 LIMIT 1`,
      [pacienteId, eceEstab.id]
    );

    let episodioId;
    if (existingEp) {
      episodioId = existingEp.id;
    } else {
      const { rows: [ep] } = await client.query(
        `INSERT INTO ece.episodio_atencion
           (paciente_id, establecimiento_id, public_encounter_id,
            modalidad, servicio_categoria, servicio_id,
            origen_consulta, modalidad_atencion, motivo,
            fecha_hora_inicio, estado, creado_por)
         VALUES ($1, $2, $3, 'hospitalario', 'hospitalizacion', $4,
                 'espontanea', 'presencial',
                 'Apendicitis aguda — intervención quirúrgica urgente',
                 $5, 'abierto', $6)
         RETURNING id`,
        [pacienteId, eceEstab.id, encounterId, eceServicio?.id ?? null, t0.toISOString(), idMT]
      );
      episodioId = ep.id;

      await client.query(
        `INSERT INTO ece.episodio_hospitalario
           (episodio_id, circunstancia_ingreso, procedencia_ingreso,
            modalidad_hospitalaria, servicio_id, cama_id, fecha_hora_orden_ingreso)
         VALUES ($1, 'demanda_espontanea', 'emergencia', 'hospitalizacion', $2, $3, $4)`,
        [episodioId, eceServicio?.id ?? null, camaId, tOrden.toISOString()]
      );
      await client.query(`UPDATE ece.episodio_atencion SET estado = 'en_curso' WHERE id = $1`, [episodioId]);
    }
    report.episodioId = episodioId;

    await client.query(`UPDATE ece.documento_instancia SET episodio_id = $1 WHERE id = $2`, [episodioId, instOrden.instanciaId]);

    // ── PASO 3: Diagnóstico + Hoja de Ingreso (cama preop) ──────────────────
    const tIngreso = new Date('2026-05-15T06:30:00-06:00');

    const { rows: [existingHI] } = await client.query(`SELECT id FROM ece.hoja_ingreso WHERE episodio_id = $1`, [episodioId]);
    let hojaIngresoId;
    if (existingHI) {
      hojaIngresoId = existingHI.id;
    } else {
      const { rows: [hi] } = await client.query(
        `INSERT INTO ece.hoja_ingreso
           (episodio_id, orden_ingreso_id, servicio_id, cama_id,
            fecha_hora_ingreso, responsable_admision,
            data)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING id`,
        [episodioId, ordenIngresoId, eceServicio?.id ?? null, camaId,
         tIngreso.toISOString(), idADM,
         JSON.stringify({
           numero_cama: 'PREOP-01',
           piso: '2',
           pabellon: 'Cirugía',
           medico_responsable_nombre: 'Dra. Patricia Cirujana Demo',
           diagnostico_presuntivo: 'Apendicitis aguda — pendiente cirugía urgente',
         })]
      );
      hojaIngresoId = hi.id;
    }

    const instHI = await crearInstancia(client, {
      tipoDocCodigo: 'HOJA_ING', episodioId, pacienteId,
      registroId: hojaIngresoId, estadoCodigo: 'borrador',
      accion: 'crear', ejecutadoPor: idADM, rolEjecutorCodigo: 'ADM',
    });
    await client.query(`UPDATE ece.hoja_ingreso SET instancia_id = $1 WHERE id = $2`, [instHI.instanciaId, hojaIngresoId]);

    const hi1 = await avanzarEstado(client, {
      instanciaId: instHI.instanciaId, estadoAnteriorId: instHI.estadoId,
      nuevoEstadoCodigo: 'en_revision', tipoDocCodigo: 'HOJA_ING',
      accion: 'enviar_revision', ejecutadoPor: idADM, rolEjecutorCodigo: 'ADM',
    });
    await avanzarEstado(client, {
      instanciaId: instHI.instanciaId, estadoAnteriorId: hi1,
      nuevoEstadoCodigo: 'firmado', tipoDocCodigo: 'HOJA_ING',
      accion: 'firmar', ejecutadoPor: idADM, rolEjecutorCodigo: 'ADM',
      observacion: 'Ingreso urgente — cama PREOP-01 asignada',
    });
    report.documentos.push({ paso: 3, tipo: 'HOJA_ING', id: instHI.instanciaId, estado: 'firmado' });

    if (camaId) {
      await client.query(
        `INSERT INTO ece.asignacion_cama (episodio_id, cama_id, desde)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [episodioId, camaId, tIngreso.toISOString()]
      );
      await client.query(`UPDATE ece.cama SET estado = 'ocupada' WHERE id = $1 AND estado = 'disponible'`, [camaId]);
    }

    // ── PASO 4: Consentimiento Quirúrgico firmado paciente + MC ──────────────
    const tConsent = new Date('2026-05-15T07:00:00-06:00');

    const { rows: [existingCons] } = await client.query(
      `SELECT id FROM ece.consentimiento_informado WHERE paciente_id = $1 AND tipo = 'quirurgico' AND episodio_id = $2`,
      [pacienteId, episodioId]
    );
    let consentimientoId;
    if (existingCons) {
      consentimientoId = existingCons.id;
    } else {
      const { rows: [cons] } = await client.query(
        `INSERT INTO ece.consentimiento_informado
           (paciente_id, episodio_id, tipo,
            procedimiento_descrito, riesgos_explicados, alternativas,
            medico_que_informa, firmante_rol, firmante_nombre, firmante_documento,
            fecha_hora, data)
         VALUES ($1, $2, 'quirurgico',
                 'Apendicectomía laparoscópica bajo anestesia general endotraqueal',
                 'Riesgos: hemorragia, infección, conversión a cirugía abierta, reacción anestésica, lesión de estructuras adyacentes.',
                 'Manejo conservador antibiótico (menor éxito en apendicitis aguda confirmada). Cirugía abierta.',
                 $3, 'paciente', 'Carlos Mendoza Demo', '87654321-2',
                 $4, $5::jsonb)
         RETURNING id`,
        [pacienteId, episodioId, idMC, tConsent.toISOString(),
         JSON.stringify({
           firmado_por_mc_en: tConsent.toISOString(),
           firma_mc_id: idMC,
           testigo_nombre: 'Enf. Sandra Quirofano Demo',
           acepta: true,
           idioma: 'es-SV',
         })]
      );
      consentimientoId = cons.id;
    }

    const instCons = await crearInstancia(client, {
      tipoDocCodigo: 'CONS_INF', episodioId, pacienteId,
      registroId: consentimientoId, estadoCodigo: 'borrador',
      accion: 'crear', ejecutadoPor: idMC, rolEjecutorCodigo: 'MC',
    });
    await client.query(`UPDATE ece.consentimiento_informado SET instancia_id = $1 WHERE id = $2`, [instCons.instanciaId, consentimientoId]);

    const c1 = await avanzarEstado(client, {
      instanciaId: instCons.instanciaId, estadoAnteriorId: instCons.estadoId,
      nuevoEstadoCodigo: 'firmado', tipoDocCodigo: 'CONS_INF',
      accion: 'firmar', ejecutadoPor: idMC, rolEjecutorCodigo: 'MC',
      observacion: 'Consentimiento quirúrgico firmado — paciente y médico informante',
    });
    await avanzarEstado(client, {
      instanciaId: instCons.instanciaId, estadoAnteriorId: c1,
      nuevoEstadoCodigo: 'validado', tipoDocCodigo: 'CONS_INF',
      accion: 'validar', ejecutadoPor: idDIR, rolEjecutorCodigo: 'DIR',
      observacion: 'Consentimiento validado — Dirección',
    });
    report.documentos.push({ paso: 4, tipo: 'CONS_INF (quirurgico)', id: instCons.instanciaId, estado: 'validado' });

    // ── PASO 5: Programación cirugía — public.SurgeryCase ───────────────────
    const tCirugiaInicio = new Date('2026-05-15T08:00:00-06:00');
    const tCirugiaFin    = new Date('2026-05-15T09:30:00-06:00'); // 90 min programado

    const { rows: [existingSC] } = await client.query(
      `SELECT id FROM public."SurgeryCase" WHERE "encounterId" = $1`, [encounterId]
    );
    let surgeryCaseId;
    if (existingSC) {
      surgeryCaseId = existingSC.id;
    } else {
      const { rows: [sc] } = await client.query(
        `INSERT INTO public."SurgeryCase"
           (id, "organizationId", "establishmentId", "encounterId", "patientId",
            "operatingRoomId", "primarySurgeonId",
            "scheduledStart", "scheduledEnd",
            "procedureDescription", "procedureCode",
            "asaClass", "anesthesiaType",
            "status", "preopNotes", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8,
                 'Apendicectomía laparoscópica de emergencia', '47562',
                 'ASA_II', 'GENERAL',
                 'SCHEDULED',
                 'Paciente ASA II. Apendicitis aguda confirmada ecográficamente. DM negada. Alergias: ninguna conocida.',
                 now(), now())
         RETURNING id`,
        [estab.organizationId, estab.id, encounterId, publicPatient.id,
         operatingRoomId, surgeonUserId,
         tCirugiaInicio.toISOString(), tCirugiaFin.toISOString()]
      );
      surgeryCaseId = sc.id;
    }
    report.surgeryCaseId = surgeryCaseId;
    report.documentos.push({ paso: 5, tipo: 'SurgeryCase (programacion)', id: surgeryCaseId, estado: 'SCHEDULED' });

    // ── PASOS 6+7: Preop checklist + WHO sign-in ─────────────────────────────
    // Ambos se registran al actualizar SurgeryCase + crear acto_quirurgico con preop JSON
    const tSignIn = new Date('2026-05-15T07:50:00-06:00');

    await client.query(
      `UPDATE public."SurgeryCase"
       SET "status" = 'IN_PROGRESS',
           "actualStart" = $1,
           "anesthesiaStartAt" = $2,
           "signInAt" = $3, "signInById" = $4,
           "updatedAt" = now()
       WHERE id = $5`,
      [tCirugiaInicio.toISOString(), tCirugiaInicio.toISOString(), tSignIn.toISOString(), surgeonUserId, surgeryCaseId]
    );

    // ── PASOS 8+9+10: Acto quirúrgico (anestesia + acto + WHO timeout+signout + URPA) ──
    const tAnestesiaFin = new Date('2026-05-15T09:35:00-06:00');
    const tSignOut      = new Date('2026-05-15T09:40:00-06:00');
    const tUrpaInicio   = new Date('2026-05-15T09:45:00-06:00');
    const tUrpaAlta     = new Date('2026-05-15T11:00:00-06:00');

    const { rows: [existingAQ] } = await client.query(
      `SELECT id FROM ece.acto_quirurgico WHERE episodio_id = $1`, [episodioId]
    );

    let actoQuirurgicoId;
    if (existingAQ) {
      actoQuirurgicoId = existingAQ.id;
    } else {
      const valoracionPreop = {
        completado_en: tSignIn.toISOString(),
        asa_clase: 'II',
        alergias: 'ninguna conocida',
        ayuno_horas: 0, // emergencia — sin ayuno previo
        anestesia_previa: false,
        via_aerea_dificil: false,
        consentimiento_firmado: true,
        sitio_marcado: true, // fosa ilíaca derecha
        equipo_verificado: true,
        implantes: 'ninguno',
        profilaxis_antibiotica: 'Ceftriaxona 1g IV administrada 30 min antes',
        tromboprofilaxis: 'medias de compresion, heparina LMWH',
      };

      const checklistCirugiaSe = {
        sign_in: {
          timestamp: tSignIn.toISOString(),
          ejecutado_por: 'Enf. Sandra Quirofano Demo',
          paciente_identificado: true,
          consentimiento_verificado: true,
          sitio_marcado: true,
          equipo_anestesia_verificado: true,
          pulso_oximetro_funcionando: true,
          alergias_conocidas: false,
          via_aerea_dificil_anticipada: false,
          riesgo_perdida_sangre: 'bajo',
        },
        time_out: {
          timestamp: tCirugiaInicio.toISOString(),
          nombre_confirmado: 'Carlos Mendoza Demo',
          procedimiento_confirmado: 'Apendicectomía laparoscópica derecha',
          sitio_confirmado: 'FID',
          profilaxis_antibiotica_60min: true,
          estudios_imagen_disponibles: true,
          equipo_presentado: true,
          instrumentista_confirma_esterilizacion: true,
          anestesiologo_confirma: true,
        },
        sign_out: {
          timestamp: tSignOut.toISOString(),
          procedimiento_registrado: 'Apendicectomía laparoscópica',
          recuento_instrumental_completo: true,
          recuento_gasas_completo: true,
          especimen_etiquetado: 'Apéndice cecal — anatomía patológica',
          equipos_deficiencias: 'ninguna',
          riesgos_postop: 'infección herida, íleo transitorio',
        },
      };

      const registroAnestesico = {
        tipo: 'general_endotraqueal',
        induccion: {
          farmacos: [
            { nombre: 'Propofol 200mg IV',         hora: '08:00' },
            { nombre: 'Fentanilo 150mcg IV',        hora: '08:02' },
            { nombre: 'Succinilcolina 100mg IV',    hora: '08:03' },
            { nombre: 'Vecuronio 8mg IV',           hora: '08:10' },
            { nombre: 'Sevoflurano 2% inhalado',    hora: '08:05' },
          ],
        },
        mantenimiento: 'Sevoflurano 1.5-2% + O2/Aire 50%. Ventilación mecánica: VC 500mL, FR 14/min, PEEP 5.',
        monitoreo: ['SpO2', 'ECG', 'PANI', 'Capnografía', 'Temperatura'],
        reversal: { nombre: 'Neostigmina 2.5mg + Atropina 1.2mg IV', hora: '09:30' },
        anestesiologo: 'Dr. Luis Anestesia Demo',
        signos_vitales_intraop: [
          { hora: '08:00', ps: 130, pd: 80, fc: 88, spo2: 99, etco2: 38, temp: 36.8 },
          { hora: '08:15', ps: 125, pd: 75, fc: 82, spo2: 99, etco2: 37, temp: 36.7 },
          { hora: '08:30', ps: 122, pd: 74, fc: 80, spo2: 100, etco2: 36, temp: 36.6 },
          { hora: '08:45', ps: 118, pd: 72, fc: 78, spo2: 100, etco2: 36, temp: 36.6 },
          { hora: '09:00', ps: 120, pd: 75, fc: 80, spo2: 99, etco2: 37, temp: 36.7 },
        ],
        duracion_anestesia_min: 95,
        incidentes: 'ninguno',
      };

      const recuperacionUrpa = {
        ingreso_urpa: tUrpaInicio.toISOString(),
        alta_urpa: tUrpaAlta.toISOString(),
        duracion_min: 75,
        anestesiologo_entrega: 'Dr. Luis Anestesia Demo',
        aldrete: [
          { hora: tUrpaInicio.toISOString(),                     puntaje: 7, actividad: 2, respiracion: 2, circulacion: 2, consciencia: 1, color: 0 },
          { hora: new Date(tUrpaInicio.getTime() + 15*60000).toISOString(), puntaje: 8, actividad: 2, respiracion: 2, circulacion: 2, consciencia: 1, color: 1 },
          { hora: new Date(tUrpaInicio.getTime() + 45*60000).toISOString(), puntaje: 9, actividad: 2, respiracion: 2, circulacion: 2, consciencia: 2, color: 1 },
        ],
        aldrete_alta: 9,
        criterio_alta: 'Aldrete ≥ 9, dolor EVA ≤ 3, hemodinamia estable',
        dolor_eva_alta: 2,
        nauseas: false,
        vomitos: false,
        sangrado_sitio_quirurgico: 'mínimo — apósito limpio',
        destino_alta: 'sala_cirugia',
        enfermera_urpa: 'Enf. Sandra Quirofano Demo',
      };

      const { rows: [aq] } = await client.query(
        `INSERT INTO ece.acto_quirurgico
           (episodio_id, paciente_id,
            valoracion_preop, checklist_cirugia_segura,
            diagnostico_pre, diagnostico_post,
            procedimiento_realizado, hallazgos,
            cirujano, anestesiologo,
            registro_anestesico,
            hora_inicio, hora_fin,
            recuperacion_urpa, data)
         VALUES ($1, $2, $3::jsonb, $4::jsonb,
                 'Apendicitis aguda (K35.8) confirmada por ecografía abdominal',
                 'Apendicitis aguda supurativa sin perforación. Cavidad peritoneal sin signos de contaminación.',
                 'Apendicectomía laparoscópica — técnica 3 trocares',
                 'Apéndice cecal aumentado de tamaño (11mm), hipervascularizado, supurativo. Sin perforación. Sin plastron. Sin líquido libre.',
                 $5, $6,
                 $7::jsonb,
                 $8, $9,
                 $10::jsonb,
                 $11::jsonb)
         RETURNING id`,
        [episodioId, pacienteId,
         JSON.stringify(valoracionPreop),
         JSON.stringify(checklistCirugiaSe),
         idMC, idANE,
         JSON.stringify(registroAnestesico),
         tCirugiaInicio.toISOString(), tCirugiaFin.toISOString(),
         JSON.stringify(recuperacionUrpa),
         JSON.stringify({
           ayudante_1: 'Enf. Sandra Quirofano Demo',
           tecnica: 'laparoscopica_3_trocares',
           conversion: false,
           complicaciones: 'ninguna',
           sangrado_estimado_ml: 30,
           duracion_cirugia_min: 90,
           muestra_anatomia_patologica: true,
         })]
      );
      actoQuirurgicoId = aq.id;
    }
    report.actoQuirurgicoId = actoQuirurgicoId;

    // Crear instancia ECE para el acto quirúrgico
    const instAQ = await crearInstancia(client, {
      tipoDocCodigo: 'ACTO_QX', episodioId, pacienteId,
      registroId: actoQuirurgicoId, estadoCodigo: 'borrador',
      accion: 'crear', ejecutadoPor: idESP, rolEjecutorCodigo: 'ESP',
    });
    await client.query(`UPDATE ece.acto_quirurgico SET instancia_id = $1 WHERE id = $2`, [instAQ.instanciaId, actoQuirurgicoId]);

    const aq1 = await avanzarEstado(client, {
      instanciaId: instAQ.instanciaId, estadoAnteriorId: instAQ.estadoId,
      nuevoEstadoCodigo: 'firmado', tipoDocCodigo: 'ACTO_QX',
      accion: 'firmar', ejecutadoPor: idESP, rolEjecutorCodigo: 'ESP',
      observacion: 'Acto quirúrgico firmado — cirujano principal (ESP). Duración 90 min, sin complicaciones.',
    });
    await avanzarEstado(client, {
      instanciaId: instAQ.instanciaId, estadoAnteriorId: aq1,
      nuevoEstadoCodigo: 'validado', tipoDocCodigo: 'ACTO_QX',
      accion: 'validar', ejecutadoPor: idESP, rolEjecutorCodigo: 'ESP',
      observacion: 'Validado jefe Cirugía — intervención conforme protocolo',
    });
    report.documentos.push({ paso: '6-11', tipo: 'ACTO_QX (preop+WHO+anestesia+acto+urpa)', id: instAQ.instanciaId, estado: 'validado' });

    // Completar SurgeryCase: WHO timeout + sign-out + fin
    await client.query(
      `UPDATE public."SurgeryCase"
       SET "actualEnd" = $1,
           "anesthesiaEndAt" = $2,
           "timeOutAt" = $3, "timeOutById" = $4,
           "signOutAt" = $5, "signOutById" = $6,
           "status" = 'POST_OP',
           "intraopNotes" = 'Apendicectomía laparoscópica completada. Sin complicaciones. Hemostasia cuidadosa. Apéndice enviado a AP.',
           "postopNotes" = 'Traslado a URPA. Paciente estable. Aldrete 9 al alta URPA.',
           "updatedAt" = now()
       WHERE id = $7`,
      [tCirugiaFin.toISOString(), tAnestesiaFin.toISOString(),
       tCirugiaInicio.toISOString(), surgeonUserId,
       tSignOut.toISOString(), surgeonUserId,
       surgeryCaseId]
    );
    await client.query(
      `UPDATE public."SurgeryCase" SET "status" = 'COMPLETED', "updatedAt" = now() WHERE id = $1`,
      [surgeryCaseId]
    );
    report.documentos.push({ paso: '7+10', tipo: 'SurgeryCase WHO sign-in+timeout+sign-out', id: surgeryCaseId, estado: 'COMPLETED' });

    // ── PASO 12: Epicrisis firmada + validada + certificada ──────────────────
    const tEgreso = new Date('2026-05-16T10:00:00-06:00'); // Alta a 28h post-cirugía

    const { rows: [existingEpi] } = await client.query(`SELECT id FROM ece.epicrisis_egreso WHERE episodio_id = $1`, [episodioId]);
    let epicrisisId;
    if (existingEpi) {
      epicrisisId = existingEpi.id;
    } else {
      const { rows: [epi] } = await client.query(
        `INSERT INTO ece.epicrisis_egreso
           (episodio_id, paciente_id,
            fecha_hora_egreso, tipo_egreso, circunstancia_alta,
            diagnosticos_egreso, resumen_evolucion,
            procedimientos_realizados, manejo_terapeutico, indicaciones_alta,
            medico_tratante, visto_jefe_servicio,
            citas_seguimiento)
         VALUES ($1, $2,
                 $3, 'vivo', 'alta_hospitalaria',
                 $4::jsonb,
                 'Paciente masculino 34 años con apendicitis aguda supurativa. Se realizó apendicectomía laparoscópica urgente bajo anestesia general. Recuperación en URPA sin incidentes (Aldrete 9). Evolución post-quirúrgica satisfactoria. Afebril desde 12h post-op. Tolerando dieta blanda. Alta hospitalaria a 28h.',
                 $5::jsonb,
                 'Ceftriaxona 1g IV c/12h + Metronidazol 500mg IV c/8h × 48h post-op (completado). Analgesia: Dipirona 1g IV PRN. Antiemético: Ondansetrón 4mg IV PRN.',
                 'Dieta normal. Cefuroxima 500mg VO c/12h × 5 días. Omeprazol 20mg VO QD × 5 días. Reposo relativo 7 días. Cuidado herida: cambio de apósito cada 48h. Retiro de puntos en 7-10 días.',
                 $6, $7,
                 $8::jsonb)
         RETURNING id`,
        [episodioId, pacienteId,
         tEgreso.toISOString(),
         JSON.stringify([
           { cie10: 'K35.8', descripcion: 'Apendicitis aguda supurativa sin perforación', tipo: 'principal' },
           { cie10: 'Z87.39', descripcion: 'Antecedente procedimiento quirúrgico abdominal', tipo: 'secundario' },
         ]),
         JSON.stringify([
           { codigo: '47562', descripcion: 'Apendicectomía laparoscópica', fecha: '2026-05-15', cirujano: 'Dra. Patricia Cirujana Demo' },
           { codigo: '00844', descripcion: 'Anestesia general endotraqueal', fecha: '2026-05-15', anestesiologo: 'Dr. Luis Anestesia Demo' },
         ]),
         idMC, idESP,
         JSON.stringify([
           { tipo: 'consulta_externa', especialidad: 'Cirugía General', dias_desde_alta: 7, motivo: 'Control herida y resultado anatomía patológica' },
         ])]
      );
      epicrisisId = epi.id;
    }

    const instEpi = await crearInstancia(client, {
      tipoDocCodigo: 'EPICRISIS', episodioId, pacienteId,
      registroId: epicrisisId, estadoCodigo: 'borrador',
      accion: 'crear', ejecutadoPor: idMC, rolEjecutorCodigo: 'MC',
    });
    await client.query(`UPDATE ece.epicrisis_egreso SET instancia_id = $1 WHERE id = $2`, [instEpi.instanciaId, epicrisisId]);

    const ep1 = await avanzarEstado(client, {
      instanciaId: instEpi.instanciaId, estadoAnteriorId: instEpi.estadoId,
      nuevoEstadoCodigo: 'firmado', tipoDocCodigo: 'EPICRISIS',
      accion: 'firmar', ejecutadoPor: idMC, rolEjecutorCodigo: 'MC',
      observacion: 'Epicrisis firmada MC — alta por mejoría post-apendicectomía laparoscópica',
    });
    const ep2 = await avanzarEstado(client, {
      instanciaId: instEpi.instanciaId, estadoAnteriorId: ep1,
      nuevoEstadoCodigo: 'validado', tipoDocCodigo: 'EPICRISIS',
      accion: 'validar', ejecutadoPor: idESP, rolEjecutorCodigo: 'ESP',
      observacion: 'Validado jefe Cirugía — Dra. Hugo Especialista Demo',
    });
    await avanzarEstado(client, {
      instanciaId: instEpi.instanciaId, estadoAnteriorId: ep2,
      nuevoEstadoCodigo: 'certificado', tipoDocCodigo: 'EPICRISIS',
      accion: 'certificar', ejecutadoPor: idDIR, rolEjecutorCodigo: 'DIR',
      observacion: 'Certificado Dirección — Art. 21 NTEC',
    });
    report.documentos.push({ paso: 12, tipo: 'EPICRISIS', id: instEpi.instanciaId, estado: 'certificado' });

    // ── PASO 13: Episodio cerrado ────────────────────────────────────────────
    await client.query(
      `UPDATE ece.episodio_atencion SET estado = 'cerrado', fecha_hora_cierre = $1 WHERE id = $2 AND estado = 'en_curso'`,
      [tEgreso.toISOString(), episodioId]
    );
    await client.query(
      `UPDATE ece.episodio_hospitalario
       SET fecha_hora_egreso = $1, tipo_egreso = 'vivo', circunstancia_alta = 'alta_hospitalaria'
       WHERE episodio_id = $2`,
      [tEgreso.toISOString(), episodioId]
    );
    if (camaId) {
      await client.query(`UPDATE ece.asignacion_cama SET hasta = $1 WHERE episodio_id = $2 AND hasta IS NULL`, [tEgreso.toISOString(), episodioId]);
      await client.query(`UPDATE ece.cama SET estado = 'limpieza' WHERE id = $1 AND estado = 'ocupada'`, [camaId]);
    }

    await client.query('COMMIT');

  } catch (err) {
    await client.query('ROLLBACK');
    report.errores.push(err.message);
    console.error('[ERROR] Rollback ejecutado:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await client.end();
  }

  // ─── Reporte ──────────────────────────────────────────────────────────────
  console.log('\n=== SEED DEMO QUIRÚRGICO — REPORTE ===');
  console.log(`paciente ECE       : ${report.pacienteId}`);
  console.log(`public.Patient     : ${report.publicPatientId}`);
  console.log(`episodio ECE       : ${report.episodioId}`);
  console.log(`SurgeryCase        : ${report.surgeryCaseId}`);
  console.log(`acto_quirurgico    : ${report.actoQuirurgicoId}`);
  console.log(`\nDocumentos (${report.documentos.length}):`);
  for (const d of report.documentos) {
    const paso = String(d.paso).padEnd(5);
    console.log(`  Paso ${paso} [${String(d.estado).padEnd(12)}] ${d.tipo.padEnd(45)} ${d.id}`);
  }
  if (report.errores.length) {
    console.log(`\nErrores (${report.errores.length}):`);
    for (const e of report.errores) console.log(`  !! ${e}`);
  } else {
    console.log('\nSeed completado exitosamente.');
    console.log('\nPara limpiar:');
    console.log(`  DELETE FROM ece.paciente WHERE numero_expediente = 'DEMO-QUIR-001';`);
    console.log(`  DELETE FROM public."Patient" WHERE mrn = 'DEMO-QUIR-CARLOS-001';`);
  }
}

main();
