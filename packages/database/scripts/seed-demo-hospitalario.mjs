/**
 * seed-demo-hospitalario.mjs
 *
 * Propósito: Sembrar datos demo de un episodio hospitalario completo (apendicitis,
 * 3 días de estancia, intervención quirúrgica, alta por mejoría) para demostración
 * y QA del ECE — Fase 2 Avante HIS.
 *
 * Qué genera:
 *   - ece.paciente + public.Patient vinculados ("María Hernández Demo", DUI 98765432-1)
 *   - Flujo hospitalario completo: orden_ingreso → episodio → hoja_ingreso → asignacion_cama
 *     → valoracion_inicial → 3×signos_vitales → indicaciones_medicas (3 items) →
 *     2×administracion_medicamento → 3×evolucion_medica → epicrisis → cierre episodio
 *   - documento_instancia + documento_instancia_historial por cada documento
 *
 * Cómo limpiar (tag='demo-hospitalario' vía numero_expediente):
 *   DELETE FROM ece.paciente WHERE numero_expediente = 'DEMO-HOSP-001';
 *   -- Cascada elimina episodios, documentos, historial, asignaciones, signos vitales.
 *   DELETE FROM public."Patient" WHERE mrn = 'DEMO-HOSP-MARIA-001';
 *
 * Requisitos: DIRECT_URL en .env. Re-ejecutable (idempotente por numero_expediente / mrn).
 */

import pg from 'pg';
import crypto from 'crypto';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) {
  console.error('[ERROR] DIRECT_URL faltante en .env');
  process.exit(2);
}

// Eliminar sslmode del URL para evitar conflicto con ssl: { rejectUnauthorized: false }
const cleanUrl = DIRECT_URL
  .replace(/[?&]sslmode=[^&]*/g, '')
  .replace('?&', '?')
  .replace(/[?&]$/, '');

const client = new pg.Client({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
});

/** SHA-256 hex de un string — para payload_hash en historial */
function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/** Inserta en documento_instancia y documento_instancia_historial.
 *  Devuelve { instanciaId, estadoId }. */
async function crearInstancia(tx, { tipoDocCodigo, episodioId, pacienteId, registroId, estadoCodigo, accion, ejecutadoPor, rolEjecutorCodigo, observacion }) {
  // Resolver IDs
  const { rows: [tipoDoc] } = await tx.query(
    `SELECT id FROM ece.tipo_documento WHERE codigo = $1`, [tipoDocCodigo]
  );
  if (!tipoDoc) throw new Error(`tipo_documento no encontrado: ${tipoDocCodigo}`);

  const { rows: [estado] } = await tx.query(
    `SELECT fe.id FROM ece.flujo_estado fe WHERE fe.tipo_documento_id = $1 AND fe.codigo = $2`,
    [tipoDoc.id, estadoCodigo]
  );
  if (!estado) throw new Error(`flujo_estado no encontrado: ${tipoDocCodigo}/${estadoCodigo}`);

  const { rows: [rol] } = await tx.query(
    `SELECT id FROM ece.rol WHERE codigo = $1`, [rolEjecutorCodigo]
  );
  if (!rol) throw new Error(`rol no encontrado: ${rolEjecutorCodigo}`);

  const { rows: [inst] } = await tx.query(
    `INSERT INTO ece.documento_instancia
       (tipo_documento_id, episodio_id, paciente_id, registro_id, estado_actual_id, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [tipoDoc.id, episodioId ?? null, pacienteId, registroId ?? null, estado.id, ejecutadoPor]
  );

  const payload = JSON.stringify({ tipo: tipoDocCodigo, accion, estado: estadoCodigo, registro_id: registroId });
  await tx.query(
    `INSERT INTO ece.documento_instancia_historial
       (instancia_id, estado_anterior_id, estado_nuevo_id, accion, ejecutado_por, rol_ejecutor_id, observacion)
     VALUES ($1, NULL, $2, $3, $4, $5, $6)`,
    [inst.id, estado.id, accion, ejecutadoPor, rol.id, observacion ?? null]
  );

  return { instanciaId: inst.id, estadoId: estado.id };
}

/** Avanza el estado de una instancia (nueva entrada en historial). */
async function avanzarEstado(tx, { instanciaId, estadoAnteriorId, nuevoEstadoCodigo, tipoDocCodigo, accion, ejecutadoPor, rolEjecutorCodigo, observacion }) {
  const { rows: [tipoDoc] } = await tx.query(
    `SELECT id FROM ece.tipo_documento WHERE codigo = $1`, [tipoDocCodigo]
  );
  const { rows: [nuevoEstado] } = await tx.query(
    `SELECT id FROM ece.flujo_estado WHERE tipo_documento_id = $1 AND codigo = $2`,
    [tipoDoc.id, nuevoEstadoCodigo]
  );
  if (!nuevoEstado) throw new Error(`estado destino no encontrado: ${tipoDocCodigo}/${nuevoEstadoCodigo}`);

  const { rows: [rol] } = await tx.query(
    `SELECT id FROM ece.rol WHERE codigo = $1`, [rolEjecutorCodigo]
  );

  await tx.query(
    `UPDATE ece.documento_instancia SET estado_actual_id = $1 WHERE id = $2`,
    [nuevoEstado.id, instanciaId]
  );

  const payload = JSON.stringify({ accion, estado_nuevo: nuevoEstadoCodigo });
  await tx.query(
    `INSERT INTO ece.documento_instancia_historial
       (instancia_id, estado_anterior_id, estado_nuevo_id, accion, ejecutado_por, rol_ejecutor_id, observacion)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [instanciaId, estadoAnteriorId, nuevoEstado.id, accion, ejecutadoPor, rol.id, observacion ?? null]
  );

  return nuevoEstado.id;
}

async function main() {
  await client.connect();

  const report = {
    pacienteId: null,
    publicPatientId: null,
    episodioId: null,
    documentos: [],
    errores: [],
  };

  try {
    await client.query('BEGIN');

    // ──────────────────────────────────────────────────────────────────
    // 0. Resolver FKs base del sistema
    // ──────────────────────────────────────────────────────────────────
    const { rows: [estabHIS] } = await client.query(
      `SELECT id, "organizationId" FROM public."Establishment" LIMIT 1`
    );
    if (!estabHIS) throw new Error('No existe Establishment en BD — corre npm run db:seed primero');

    const { rows: [country] } = await client.query(
      `SELECT id FROM public."Country" LIMIT 1`
    );
    const { rows: [sex] } = await client.query(
      `SELECT id FROM public."BiologicalSex" LIMIT 1`
    );
    const { rows: [currency] } = await client.query(
      `SELECT id FROM public."Currency" LIMIT 1`
    );
    const { rows: [serviceUnit] } = await client.query(
      `SELECT id FROM public."ServiceUnit" WHERE "organizationId" = $1 LIMIT 1`,
      [estabHIS.organizationId]
    );

    if (!country || !sex || !currency || !serviceUnit) {
      throw new Error('Catálogos base incompletos (Country/BiologicalSex/Currency/ServiceUnit)');
    }

    // ece.establecimiento linked al HIS establishment
    const { rows: [eceEstab] } = await client.query(
      `SELECT id FROM ece.establecimiento WHERE establishment_id = $1 LIMIT 1`,
      [estabHIS.id]
    );
    if (!eceEstab) throw new Error('ece.establecimiento no vinculado — asegúrate que el seed base ECE esté aplicado');

    // ece.institucion (cualquiera)
    const { rows: [eceInst] } = await client.query(
      `SELECT id FROM ece.institucion LIMIT 1`
    );
    if (!eceInst) throw new Error('ece.institucion vacía — seed base ECE requerido');

    // Servicio de hospitalización/cirugía
    const { rows: [eceServicio] } = await client.query(
      `SELECT id FROM ece.servicio WHERE establecimiento_id = $1 LIMIT 1`,
      [eceEstab.id]
    );
    // Cama 302 — crear si no existe
    let camaId;
    if (eceServicio) {
      const { rows: [cama] } = await client.query(
        `INSERT INTO ece.cama (servicio_id, codigo, estado)
         VALUES ($1, '302', 'disponible')
         ON CONFLICT (servicio_id, codigo) DO UPDATE SET estado = ece.cama.estado
         RETURNING id`,
        [eceServicio.id]
      );
      camaId = cama.id;
    }

    // ──────────────────────────────────────────────────────────────────
    // 1. Paciente público (public.Patient) — idempotente por MRN
    // ──────────────────────────────────────────────────────────────────
    const MRN = 'DEMO-HOSP-MARIA-001';
    const { rows: [publicPatient] } = await client.query(
      `INSERT INTO public."Patient"
         (id, "organizationId", mrn, "firstName", "lastName", "biologicalSexId",
          "dateOfBirth", "isUnknown", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1::uuid, $2, 'María', 'Hernández Demo', $3::uuid,
               '1992-08-20'::date, false, now(), now())
       ON CONFLICT ("organizationId", mrn) DO UPDATE SET "updatedAt" = now()
       RETURNING id`,
      [estabHIS.organizationId, MRN, sex.id]
    );
    report.publicPatientId = publicPatient.id;

    // ──────────────────────────────────────────────────────────────────
    // 2. Encounter HIS (public.Encounter) — idempotente por encounterNumber
    // ──────────────────────────────────────────────────────────────────
    const ENC_NUMBER = 'DEMO-HOSP-ENC-001';
    const t0 = new Date('2026-05-14T08:00:00-06:00'); // Día 1 admisión
    const { rows: [encounter] } = await client.query(
      `INSERT INTO public."Encounter"
         (id, "countryId", "organizationId", "establishmentId", "serviceUnitId",
          "patientId", "admissionType", "encounterNumber", "admittedAt",
          "currencyId", "exchangeRateToFunc", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid,
               $5::uuid, 'INPATIENT'::"AdmissionType", $6,
               $7::timestamptz, $8::uuid, 1.0, now(), now())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [country.id, estabHIS.organizationId, estabHIS.id, serviceUnit.id,
       publicPatient.id, ENC_NUMBER, t0.toISOString(), currency.id]
    );
    // Si ON CONFLICT DO NOTHING no retorna, buscar el existente
    let encounterId = encounter?.id;
    if (!encounterId) {
      const { rows: [existing] } = await client.query(
        `SELECT id FROM public."Encounter" WHERE "encounterNumber" = $1`, [ENC_NUMBER]
      );
      encounterId = existing?.id;
    }

    // ──────────────────────────────────────────────────────────────────
    // 3. Personal de salud demo (si no existe)
    //    Roles: MT, MC, ENF, ADM, ESP, DIR
    // ──────────────────────────────────────────────────────────────────
    async function upsertPersonal(doc, nombre, jvpm) {
      const { rows: [p] } = await client.query(
        `INSERT INTO ece.personal_salud
           (documento_identidad, nombre_completo, institucion_id, establecimiento_id, jvpm_codigo)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [doc, nombre, eceInst.id, eceEstab.id, jvpm]
      );
      if (p) return p.id;
      const { rows: [ex] } = await client.query(
        `SELECT id FROM ece.personal_salud WHERE documento_identidad = $1 AND establecimiento_id = $2`,
        [doc, eceEstab.id]
      );
      return ex.id;
    }

    const idMT  = await upsertPersonal('01234567-8', 'Dr. Roberto Turno Demo', 'JVPM-MT-01');
    const idMC  = await upsertPersonal('12345678-9', 'Dr. Carlos Cabecera Demo', 'JVPM-MC-01');
    const idENF = await upsertPersonal('23456789-0', 'Enf. Laura Sánchez Demo', 'JVPM-ENF-01');
    const idADM = await upsertPersonal('34567890-1', 'Adm. José Recepción Demo', null);
    const idESP = await upsertPersonal('45678901-2', 'Dr. Mario Especialista Demo', 'JVPM-ESP-01');
    const idDIR = await upsertPersonal('56789012-3', 'Dr. Ana Dirección Demo', 'JVPM-DIR-01');

    // Asignar roles ECE a personal demo
    async function asignarRol(personalId, rolCodigo) {
      await client.query(
        `INSERT INTO ece.asignacion_rol (personal_id, rol_id, establecimiento_id)
         SELECT $1, r.id, $2 FROM ece.rol r WHERE r.codigo = $3
         ON CONFLICT (personal_id, rol_id, establecimiento_id, servicio_id) DO NOTHING`,
        [personalId, eceEstab.id, rolCodigo]
      );
    }
    await asignarRol(idMT,  'MT');
    await asignarRol(idMC,  'MC');
    await asignarRol(idENF, 'ENF');
    await asignarRol(idADM, 'ADM');
    await asignarRol(idESP, 'ESP');
    await asignarRol(idDIR, 'DIR');

    // firma_electronica stub (argon2id placeholder — no funcional, solo demo)
    const FAKE_HASH = '$argon2id$v=19$m=65536,t=3,p=4$DEMO_SALT_PLACEHOLDER$DEMO_HASH_PLACEHOLDER';
    for (const pid of [idMT, idMC, idENF, idADM, idESP, idDIR]) {
      await client.query(
        `INSERT INTO ece.firma_electronica (personal_id, pin_hash, salt_extra)
         VALUES ($1, $2, 'demo-salt')
         ON CONFLICT (personal_id) DO NOTHING`,
        [pid, FAKE_HASH]
      );
    }

    // ──────────────────────────────────────────────────────────────────
    // 4. ece.paciente — idempotente por (establecimiento_id, numero_expediente)
    // ──────────────────────────────────────────────────────────────────
    const NUM_EXP = 'DEMO-HOSP-001';
    const NUI_DEMO = 'DEMOPACIENTE00000001'; // 20 chars [A-Z0-9]
    const DUI_DEMO = '98765432-1';

    // El trigger trg_dedup_nui_dui bloquea DUI duplicado en mismo establecimiento.
    // Usar ON CONFLICT (establecimiento_id, numero_expediente) para idempotencia.
    const { rows: [pacienteRow] } = await client.query(
      `INSERT INTO ece.paciente
         (public_patient_id, establecimiento_id, numero_expediente,
          nui, dui, tipo_registro_identidad,
          estado_familiar, ocupacion, nacionalidad, direccion, telefono,
          responsable_toma_datos)
       VALUES ($1, $2, $3, $4, $5, 'verificado',
               'soltera', 'Empleada doméstica', 'Salvadoreña',
               'Col. Las Flores, Pje. 3, San Salvador', '7123-4567',
               NULL)
       ON CONFLICT (establecimiento_id, numero_expediente)
         DO UPDATE SET public_patient_id = EXCLUDED.public_patient_id
       RETURNING id`,
      [publicPatient.id, eceEstab.id, NUM_EXP, NUI_DEMO, DUI_DEMO]
    );
    const pacienteId = pacienteRow.id;
    report.pacienteId = pacienteId;

    // ──────────────────────────────────────────────────────────────────
    // 5. Orden de Ingreso (ORD_ING) — firmada MT, validada MC
    //    Timestamps: Día 1 06:00
    // ──────────────────────────────────────────────────────────────────
    const tOrden = new Date('2026-05-14T06:00:00-06:00');

    // Primero necesitamos episodio_origen (nulo — ingresa por emergencia directa)
    // Crear episodio_atencion de origen tipo ambulatorio/emergencia brevemente
    // (opcional — en este demo la orden de ingreso no tiene episodio origen)

    // documento_instancia para ORD_ING — necesita paciente_id sin episodio_id todavía
    const { rows: [ordenIngresoData] } = await client.query(
      `INSERT INTO ece.orden_ingreso
         (instancia_id, paciente_id, circunstancia_ingreso, fecha_hora_orden,
          motivo_ingreso, procedencia, modalidad, diagnostico_ingreso, medico_ordena)
       VALUES (gen_random_uuid(), $1, 'demanda_espontanea', $2,
               'Apendicitis aguda — dolor abdominal fosa ilíaca derecha 12 horas de evolución',
               'emergencia', 'hospitalizacion',
               '[{"cie10":"K35.8","descripcion":"Otras formas de apendicitis aguda y las no especificadas","tipo":"presuntivo"}]'::jsonb,
               $3)
       RETURNING id`,
      [pacienteId, tOrden.toISOString(), idMT]
    );
    const ordenIngresoId = ordenIngresoData.id;

    // Ahora crear la instancia con episodio_id = NULL (pre-episodio)
    // y actualizar registro_id
    const instOrdenIngreso = await crearInstancia(client, {
      tipoDocCodigo: 'ORD_ING',
      episodioId: null,
      pacienteId,
      registroId: null,
      estadoCodigo: 'borrador',
      accion: 'crear',
      ejecutadoPor: idMT,
      rolEjecutorCodigo: 'MT',
      observacion: 'Orden de ingreso demo — apendicitis aguda',
    });

    // Actualizar registro_id y actualizar orden_ingreso.instancia_id
    await client.query(
      `UPDATE ece.documento_instancia SET registro_id = $1 WHERE id = $2`,
      [ordenIngresoId, instOrdenIngreso.instanciaId]
    );
    await client.query(
      `UPDATE ece.orden_ingreso SET instancia_id = $1 WHERE id = $2`,
      [instOrdenIngreso.instanciaId, ordenIngresoId]
    );

    // Avanzar: borrador → en_revision (MT)
    const estadoOrdenRev = await avanzarEstado(client, {
      instanciaId: instOrdenIngreso.instanciaId,
      estadoAnteriorId: instOrdenIngreso.estadoId,
      nuevoEstadoCodigo: 'en_revision',
      tipoDocCodigo: 'ORD_ING',
      accion: 'enviar_revision',
      ejecutadoPor: idMT,
      rolEjecutorCodigo: 'MT',
    });

    // en_revision → firmado (MT)
    const estadoOrdenFirm = await avanzarEstado(client, {
      instanciaId: instOrdenIngreso.instanciaId,
      estadoAnteriorId: estadoOrdenRev,
      nuevoEstadoCodigo: 'firmado',
      tipoDocCodigo: 'ORD_ING',
      accion: 'firmar',
      ejecutadoPor: idMT,
      rolEjecutorCodigo: 'MT',
      observacion: 'Firma electrónica MT — orden de ingreso',
    });

    // firmado → validado (MC)
    const estadoOrdenVal = await avanzarEstado(client, {
      instanciaId: instOrdenIngreso.instanciaId,
      estadoAnteriorId: estadoOrdenFirm,
      nuevoEstadoCodigo: 'validado',
      tipoDocCodigo: 'ORD_ING',
      accion: 'validar',
      ejecutadoPor: idMC,
      rolEjecutorCodigo: 'MC',
      observacion: 'Validado por médico de cabecera',
    });

    report.documentos.push({ tipo: 'ORD_ING', id: instOrdenIngreso.instanciaId, estado: 'validado' });

    // ──────────────────────────────────────────────────────────────────
    // 6. Episodio de Atención + Episodio Hospitalario
    // ──────────────────────────────────────────────────────────────────
    // Check if episodio for this paciente already exists (idempotencia)
    const { rows: [existingEpisodio] } = await client.query(
      `SELECT ea.id FROM ece.episodio_atencion ea
       JOIN ece.episodio_hospitalario eh ON eh.episodio_id = ea.id
       WHERE ea.paciente_id = $1 AND ea.establecimiento_id = $2
       LIMIT 1`,
      [pacienteId, eceEstab.id]
    );

    let episodioId;
    if (existingEpisodio) {
      episodioId = existingEpisodio.id;
    } else {
      const { rows: [episodio] } = await client.query(
        `INSERT INTO ece.episodio_atencion
           (paciente_id, establecimiento_id, public_encounter_id,
            modalidad, servicio_categoria, servicio_id,
            origen_consulta, modalidad_atencion, motivo,
            fecha_hora_inicio, estado, creado_por)
         VALUES ($1, $2, $3,
                 'hospitalario', 'hospitalizacion', $4,
                 'espontanea', 'presencial',
                 'Dolor abdominal agudo — apendicitis confirmada',
                 $5, 'abierto', $6)
         RETURNING id`,
        [pacienteId, eceEstab.id, encounterId,
         eceServicio?.id ?? null, t0.toISOString(), idMT]
      );
      episodioId = episodio.id;

      await client.query(
        `INSERT INTO ece.episodio_hospitalario
           (episodio_id, circunstancia_ingreso, procedencia_ingreso,
            modalidad_hospitalaria, servicio_id, cama_id,
            fecha_hora_orden_ingreso)
         VALUES ($1, 'demanda_espontanea', 'emergencia',
                 'hospitalizacion', $2, $3, $4)`,
        [episodioId, eceServicio?.id ?? null, camaId ?? null, tOrden.toISOString()]
      );

      // Transición episodio: abierto → en_curso
      await client.query(
        `UPDATE ece.episodio_atencion SET estado = 'en_curso' WHERE id = $1`,
        [episodioId]
      );
    }
    report.episodioId = episodioId;

    // Actualizar instancia ORD_ING con episodioId
    await client.query(
      `UPDATE ece.documento_instancia SET episodio_id = $1 WHERE id = $2`,
      [episodioId, instOrdenIngreso.instanciaId]
    );

    // ──────────────────────────────────────────────────────────────────
    // 7. Hoja de Ingreso (HOJA_ING) — firmada ADM
    // ──────────────────────────────────────────────────────────────────
    const tIngreso = new Date('2026-05-14T08:30:00-06:00');

    // Idempotencia: UNIQUE en episodio_id
    const { rows: [existingHI] } = await client.query(
      `SELECT hi.id FROM ece.hoja_ingreso hi WHERE hi.episodio_id = $1`, [episodioId]
    );

    let hojaIngresoId;
    if (existingHI) {
      hojaIngresoId = existingHI.id;
    } else {
      const { rows: [hi] } = await client.query(
        `INSERT INTO ece.hoja_ingreso
           (instancia_id, episodio_id, orden_ingreso_id, servicio_id, cama_id,
            fecha_hora_ingreso, datos_administrativos, responsable_admision)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5,
                 '{"numero_cama":"302","piso":"3","pabellon":"Cirugía","medico_responsable_nombre":"Dr. Carlos Cabecera Demo"}'::jsonb,
                 $6)
         RETURNING id`,
        [episodioId, ordenIngresoId, eceServicio?.id ?? null, camaId ?? null,
         tIngreso.toISOString(), idADM]
      );
      hojaIngresoId = hi.id;
    }

    const instHojaIng = await crearInstancia(client, {
      tipoDocCodigo: 'HOJA_ING',
      episodioId,
      pacienteId,
      registroId: hojaIngresoId,
      estadoCodigo: 'borrador',
      accion: 'crear',
      ejecutadoPor: idADM,
      rolEjecutorCodigo: 'ADM',
    });
    await client.query(
      `UPDATE ece.hoja_ingreso SET instancia_id = $1 WHERE id = $2`,
      [instHojaIng.instanciaId, hojaIngresoId]
    );

    // Avanzar HOJA_ING: borrador → en_revision → firmado
    const hiRev = await avanzarEstado(client, {
      instanciaId: instHojaIng.instanciaId,
      estadoAnteriorId: instHojaIng.estadoId,
      nuevoEstadoCodigo: 'en_revision',
      tipoDocCodigo: 'HOJA_ING',
      accion: 'enviar_revision',
      ejecutadoPor: idADM,
      rolEjecutorCodigo: 'ADM',
    });
    const hiFirm = await avanzarEstado(client, {
      instanciaId: instHojaIng.instanciaId,
      estadoAnteriorId: hiRev,
      nuevoEstadoCodigo: 'firmado',
      tipoDocCodigo: 'HOJA_ING',
      accion: 'firmar',
      ejecutadoPor: idADM,
      rolEjecutorCodigo: 'ADM',
      observacion: 'Admisión firmada — cama 302 asignada',
    });

    report.documentos.push({ tipo: 'HOJA_ING', id: instHojaIng.instanciaId, estado: 'firmado' });

    // ──────────────────────────────────────────────────────────────────
    // 8. Asignación de cama 302
    // ──────────────────────────────────────────────────────────────────
    if (camaId) {
      await client.query(
        `INSERT INTO ece.asignacion_cama (episodio_id, cama_id, desde)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [episodioId, camaId, tIngreso.toISOString()]
      );
      // Marcar cama como ocupada
      await client.query(
        `UPDATE ece.cama SET estado = 'ocupada' WHERE id = $1 AND estado = 'disponible'`,
        [camaId]
      );
    }

    // ──────────────────────────────────────────────────────────────────
    // 9. Valoración inicial enfermería (como registro_enfermeria turno matutino)
    //    Braden 18, Morse 35, dolor 7
    //    Modelada como REG_ENF con valoracion_enf que incluye escalas
    // ──────────────────────────────────────────────────────────────────
    const tValEnf = new Date('2026-05-14T09:00:00-06:00');

    const { rows: [valEnfData] } = await client.query(
      `INSERT INTO ece.registro_enfermeria
         (instancia_id, episodio_id, turno, nota_evolucion, plan_cuidados, valoracion_enf, registrado_por)
       VALUES (gen_random_uuid(), $1, 'matutino',
               'Valoración inicial: paciente consciente, orientada, con dolor en FID EVA 7/10. Abdomen rígido, signos de irritación peritoneal.',
               'Monitoreo de signos vitales c/2h. Ayuno. Canalizar vena periférica. NPO. Posición semifowler.',
               '{"braden":18,"morse":35,"dolor_eva":7,"caidas_riesgo":"medio","ulceras_presion":"bajo_riesgo","estado_emocional":"ansioso"}'::jsonb,
               $2)
       RETURNING id`,
      [episodioId, idENF]
    );
    const valEnfId = valEnfData.id;

    const instValEnf = await crearInstancia(client, {
      tipoDocCodigo: 'REG_ENF',
      episodioId,
      pacienteId,
      registroId: valEnfId,
      estadoCodigo: 'borrador',
      accion: 'crear',
      ejecutadoPor: idENF,
      rolEjecutorCodigo: 'ENF',
      observacion: 'Valoración inicial ingreso enfermería',
    });
    await client.query(
      `UPDATE ece.registro_enfermeria SET instancia_id = $1 WHERE id = $2`,
      [instValEnf.instanciaId, valEnfId]
    );

    const veRev = await avanzarEstado(client, {
      instanciaId: instValEnf.instanciaId, estadoAnteriorId: instValEnf.estadoId,
      nuevoEstadoCodigo: 'en_revision', tipoDocCodigo: 'REG_ENF',
      accion: 'enviar_revision', ejecutadoPor: idENF, rolEjecutorCodigo: 'ENF',
    });
    await avanzarEstado(client, {
      instanciaId: instValEnf.instanciaId, estadoAnteriorId: veRev,
      nuevoEstadoCodigo: 'firmado', tipoDocCodigo: 'REG_ENF',
      accion: 'firmar', ejecutadoPor: idENF, rolEjecutorCodigo: 'ENF',
      observacion: 'Valoración inicial firmada por enfermería',
    });

    report.documentos.push({ tipo: 'REG_ENF (valoracion_inicial)', id: instValEnf.instanciaId, estado: 'firmado' });

    // ──────────────────────────────────────────────────────────────────
    // 10. 3 Tomas de signos vitales — cada 8h, día 1
    // ──────────────────────────────────────────────────────────────────
    const svTimes = [
      new Date('2026-05-14T08:00:00-06:00'),
      new Date('2026-05-14T16:00:00-06:00'),
      new Date('2026-05-15T00:00:00-06:00'),
    ];
    const svData = [
      { ps: 125, pd: 82, fc: 98, fr: 20, temp: 38.2, spo2: 97, dolor: 7 },
      { ps: 118, pd: 76, fc: 90, fr: 18, temp: 37.8, spo2: 98, dolor: 5 },
      { ps: 112, pd: 72, fc: 82, fr: 16, temp: 37.1, spo2: 99, dolor: 3 },
    ];

    for (let i = 0; i < 3; i++) {
      const { rows: [sv] } = await client.query(
        `INSERT INTO ece.signos_vitales
           (instancia_id, episodio_id, fecha_hora_toma,
            presion_sistolica, presion_diastolica, frecuencia_cardiaca,
            frecuencia_respiratoria, temperatura, saturacion_o2,
            escala_dolor, registrado_por)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [episodioId, svTimes[i].toISOString(),
         svData[i].ps, svData[i].pd, svData[i].fc,
         svData[i].fr, svData[i].temp, svData[i].spo2,
         svData[i].dolor, idENF]
      );

      const instSV = await crearInstancia(client, {
        tipoDocCodigo: 'SIG_VIT',
        episodioId,
        pacienteId,
        registroId: sv.id,
        estadoCodigo: 'firmado',
        accion: 'firmar',
        ejecutadoPor: idENF,
        rolEjecutorCodigo: 'ENF',
        observacion: `Toma signos vitales ${i + 1}/3`,
      });
      await client.query(
        `UPDATE ece.signos_vitales SET instancia_id = $1 WHERE id = $2`,
        [instSV.instanciaId, sv.id]
      );
      report.documentos.push({ tipo: 'SIG_VIT', id: instSV.instanciaId, estado: 'firmado' });
    }

    // ──────────────────────────────────────────────────────────────────
    // 11. Indicaciones médicas día 1 — firmadas MC
    //     Items: Ceftriaxona 1g IV c/12h, Metronidazol 500mg IV c/8h, Dipirona 1g IV PRN
    // ──────────────────────────────────────────────────────────────────
    const tIndMed = new Date('2026-05-14T10:00:00-06:00');

    const { rows: [indMedData] } = await client.query(
      `INSERT INTO ece.indicaciones_medicas
         (instancia_id, episodio_id, fecha_hora, version, vigencia, medico_prescriptor)
       VALUES (gen_random_uuid(), $1, $2, 1, 'activa', $3)
       RETURNING id`,
      [episodioId, tIndMed.toISOString(), idMC]
    );
    const indMedId = indMedData.id;

    const itemsCeftriaxona = [
      { tipo: 'medicamento', desc: 'Ceftriaxona 1g IV', dosis: '1g', via: 'IV', freq: 'c/12h', dur: '5 días' },
      { tipo: 'medicamento', desc: 'Metronidazol 500mg IV', dosis: '500mg', via: 'IV', freq: 'c/8h', dur: '5 días' },
      { tipo: 'medicamento', desc: 'Dipirona 1g IV PRN', dosis: '1g', via: 'IV', freq: 'PRN dolor EVA>4', dur: 'según necesidad' },
    ];
    const itemIds = [];
    for (const it of itemsCeftriaxona) {
      const { rows: [item] } = await client.query(
        `INSERT INTO ece.indicacion_item
           (indicacion_id, tipo, descripcion, dosis, via, frecuencia, duracion)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [indMedId, it.tipo, it.desc, it.dosis, it.via, it.freq, it.dur]
      );
      itemIds.push(item.id);
    }

    const instIndMed = await crearInstancia(client, {
      tipoDocCodigo: 'IND_MED',
      episodioId,
      pacienteId,
      registroId: indMedId,
      estadoCodigo: 'borrador',
      accion: 'crear',
      ejecutadoPor: idMC,
      rolEjecutorCodigo: 'MC',
    });
    await client.query(
      `UPDATE ece.indicaciones_medicas SET instancia_id = $1 WHERE id = $2`,
      [instIndMed.instanciaId, indMedId]
    );

    const imRev = await avanzarEstado(client, {
      instanciaId: instIndMed.instanciaId, estadoAnteriorId: instIndMed.estadoId,
      nuevoEstadoCodigo: 'en_revision', tipoDocCodigo: 'IND_MED',
      accion: 'enviar_revision', ejecutadoPor: idMC, rolEjecutorCodigo: 'MC',
    });
    const imFirm = await avanzarEstado(client, {
      instanciaId: instIndMed.instanciaId, estadoAnteriorId: imRev,
      nuevoEstadoCodigo: 'firmado', tipoDocCodigo: 'IND_MED',
      accion: 'firmar', ejecutadoPor: idMC, rolEjecutorCodigo: 'MC',
      observacion: 'Indicaciones médicas día 1 post-quirúrgicas',
    });
    // ENF valida transcripción
    await avanzarEstado(client, {
      instanciaId: instIndMed.instanciaId, estadoAnteriorId: imFirm,
      nuevoEstadoCodigo: 'validado', tipoDocCodigo: 'IND_MED',
      accion: 'validar', ejecutadoPor: idENF, rolEjecutorCodigo: 'ENF',
      observacion: 'Transcripción verificada por enfermería',
    });

    report.documentos.push({ tipo: 'IND_MED', id: instIndMed.instanciaId, estado: 'validado' });

    // ──────────────────────────────────────────────────────────────────
    // 12. 2 Administraciones de medicamentos
    // ──────────────────────────────────────────────────────────────────
    // Crear un registro de enfermería para el kardex
    const { rows: [regEnfKardex] } = await client.query(
      `INSERT INTO ece.registro_enfermeria
         (instancia_id, episodio_id, turno, nota_evolucion, registrado_por)
       VALUES (gen_random_uuid(), $1, 'matutino', 'Kardex administración día 1', $2)
       RETURNING id`,
      [episodioId, idENF]
    );

    const instRegEnfK = await crearInstancia(client, {
      tipoDocCodigo: 'REG_ENF',
      episodioId,
      pacienteId,
      registroId: regEnfKardex.id,
      estadoCodigo: 'firmado',
      accion: 'firmar',
      ejecutadoPor: idENF,
      rolEjecutorCodigo: 'ENF',
      observacion: 'Registro kardex medicamentos día 1',
    });
    await client.query(
      `UPDATE ece.registro_enfermeria SET instancia_id = $1 WHERE id = $2`,
      [instRegEnfK.instanciaId, regEnfKardex.id]
    );

    const admTimes = [
      new Date('2026-05-14T12:00:00-06:00'),
      new Date('2026-05-14T20:00:00-06:00'),
    ];
    for (let i = 0; i < 2; i++) {
      await client.query(
        `INSERT INTO ece.administracion_medicamento
           (registro_enf_id, indicacion_item_id, hora_programada, hora_aplicada, estado, responsable)
         VALUES ($1, $2, $3, $3, 'administrado', $4)`,
        [regEnfKardex.id, itemIds[i % itemIds.length],
         admTimes[i].toISOString(), idENF]
      );
    }

    report.documentos.push({ tipo: 'REG_ENF (kardex)', id: instRegEnfK.instanciaId, estado: 'firmado' });

    // ──────────────────────────────────────────────────────────────────
    // 13. 3 Evoluciones médicas — días 1, 2, 3
    //     firmadas y validadas por MC
    // ──────────────────────────────────────────────────────────────────
    const evoluciones = [
      {
        ts: new Date('2026-05-14T18:00:00-06:00'),
        s: 'Paciente refiere dolor moderado en herida quirúrgica EVA 5/10. Sin náuseas.',
        o: 'T 37.8°C FC 88 FR 18. Herida limpia sin signos de infección. Abdomen blando.',
        a: 'Post-apendicectomía día 1. Evolución satisfactoria.',
        p: 'Continuar antibioticoterapia. Analgesia según escala. Iniciar líquidos vía oral.',
        dx: [{ cie10: 'K37', descripcion: 'Apendicitis sin mención de peritonitis', }],
      },
      {
        ts: new Date('2026-05-15T10:00:00-06:00'),
        s: 'Paciente tolera líquidos. Dolor leve EVA 2/10. Gases presentes.',
        o: 'T 37.0°C FC 76 FR 16. Herida sin signos de infección. Abdomen ruidos presentes.',
        a: 'Post-apendicectomía día 2. Evolución favorable.',
        p: 'Avanzar dieta blanda. Deambulación asistida. Continuar antibióticos.',
        dx: [{ cie10: 'K37', descripcion: 'Apendicitis sin mención de peritonitis' }],
      },
      {
        ts: new Date('2026-05-16T09:00:00-06:00'),
        s: 'Sin dolor. Tolerando dieta normal. Deambula sin dificultad.',
        o: 'T 36.5°C FC 72 FR 14. Herida en buenas condiciones. Abdomen normal.',
        a: 'Post-apendicectomía día 3. Candidata a alta hospitalaria.',
        p: 'Alta hospitalaria. Antibiótico oral 3 días. Control en consulta externa 7 días.',
        dx: [{ cie10: 'K37', descripcion: 'Apendicitis sin mención de peritonitis' }],
      },
    ];

    for (const ev of evoluciones) {
      const { rows: [evolRow] } = await client.query(
        `INSERT INTO ece.evolucion_medica
           (instancia_id, episodio_id, fecha_hora, subjetivo, objetivo, analisis, plan,
            diagnostico_cie10, registrado_por)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING id`,
        [episodioId, ev.ts.toISOString(), ev.s, ev.o, ev.a, ev.p,
         JSON.stringify(ev.dx), idMC]
      );

      const instEv = await crearInstancia(client, {
        tipoDocCodigo: 'EVOL_MED',
        episodioId,
        pacienteId,
        registroId: evolRow.id,
        estadoCodigo: 'borrador',
        accion: 'crear',
        ejecutadoPor: idMC,
        rolEjecutorCodigo: 'MC',
      });
      await client.query(
        `UPDATE ece.evolucion_medica SET instancia_id = $1 WHERE id = $2`,
        [instEv.instanciaId, evolRow.id]
      );

      const evRev = await avanzarEstado(client, {
        instanciaId: instEv.instanciaId, estadoAnteriorId: instEv.estadoId,
        nuevoEstadoCodigo: 'en_revision', tipoDocCodigo: 'EVOL_MED',
        accion: 'enviar_revision', ejecutadoPor: idMC, rolEjecutorCodigo: 'MC',
      });
      const evFirm = await avanzarEstado(client, {
        instanciaId: instEv.instanciaId, estadoAnteriorId: evRev,
        nuevoEstadoCodigo: 'firmado', tipoDocCodigo: 'EVOL_MED',
        accion: 'firmar', ejecutadoPor: idMC, rolEjecutorCodigo: 'MC',
      });
      await avanzarEstado(client, {
        instanciaId: instEv.instanciaId, estadoAnteriorId: evFirm,
        nuevoEstadoCodigo: 'validado', tipoDocCodigo: 'EVOL_MED',
        accion: 'validar', ejecutadoPor: idMC, rolEjecutorCodigo: 'MC',
      });

      report.documentos.push({ tipo: 'EVOL_MED', id: instEv.instanciaId, estado: 'validado' });
    }

    // ──────────────────────────────────────────────────────────────────
    // 14. Epicrisis — firmado MC → validado ESP → certificado DIR
    // ──────────────────────────────────────────────────────────────────
    const tEgreso = new Date('2026-05-16T14:00:00-06:00');

    // Idempotencia: UNIQUE en episodio_id
    const { rows: [existingEpi] } = await client.query(
      `SELECT id FROM ece.epicrisis_egreso WHERE episodio_id = $1`, [episodioId]
    );

    let epicrisisId;
    if (existingEpi) {
      epicrisisId = existingEpi.id;
    } else {
      const { rows: [epi] } = await client.query(
        `INSERT INTO ece.epicrisis_egreso
           (instancia_id, episodio_id, fecha_hora_egreso, tipo_egreso, circunstancia_alta,
            diagnosticos_egreso, resumen_evolucion, procedimientos_realizados,
            manejo_terapeutico, indicaciones_alta, medico_tratante_id, visto_jefe_servicio_id)
         VALUES (gen_random_uuid(), $1, $2, 'vivo', 'alta_hospitalaria',
                 '[{"cie10":"K37","descripcion":"Apendicitis aguda operada","tipo":"principal"}]'::jsonb,
                 'Paciente de 33 años ingresó por cuadro de apendicitis aguda. Se realizó apendicectomía laparoscópica sin complicaciones. Evolución post-quirúrgica satisfactoria, egresa por mejoría.',
                 '[{"codigo":"47562","descripcion":"Apendicectomía laparoscópica","fecha":"2026-05-14"}]'::jsonb,
                 'Ceftriaxona 1g IV c/12h + Metronidazol 500mg IV c/8h × 5 días (completados). Analgesia EVA.',
                 'Dieta normal. Cefuroxima 500mg VO c/12h × 3 días. Cuidado de herida. Reposo relativo 7 días.',
                 $3, $4)
         RETURNING id`,
        [episodioId, tEgreso.toISOString(), idMC, idESP]
      );
      epicrisisId = epi.id;
    }

    const instEpi = await crearInstancia(client, {
      tipoDocCodigo: 'EPICRISIS',
      episodioId,
      pacienteId,
      registroId: epicrisisId,
      estadoCodigo: 'borrador',
      accion: 'crear',
      ejecutadoPor: idMC,
      rolEjecutorCodigo: 'MC',
    });
    await client.query(
      `UPDATE ece.epicrisis_egreso SET instancia_id = $1 WHERE id = $2`,
      [instEpi.instanciaId, epicrisisId]
    );

    // EPICRISIS es inmutable: borrador → firmado directo (sin en_revision)
    const epiFirm = await avanzarEstado(client, {
      instanciaId: instEpi.instanciaId, estadoAnteriorId: instEpi.estadoId,
      nuevoEstadoCodigo: 'firmado', tipoDocCodigo: 'EPICRISIS',
      accion: 'firmar', ejecutadoPor: idMC, rolEjecutorCodigo: 'MC',
      observacion: 'Firma MC — alta por mejoría post-apendicectomía',
    });

    // ESP valida (visto jefe de servicio)
    const epiVal = await avanzarEstado(client, {
      instanciaId: instEpi.instanciaId, estadoAnteriorId: epiFirm,
      nuevoEstadoCodigo: 'validado', tipoDocCodigo: 'EPICRISIS',
      accion: 'validar', ejecutadoPor: idESP, rolEjecutorCodigo: 'ESP',
      observacion: 'Visto bueno jefe de servicio Cirugía',
    });

    // DIR certifica (Art. 21 NTEC)
    await avanzarEstado(client, {
      instanciaId: instEpi.instanciaId, estadoAnteriorId: epiVal,
      nuevoEstadoCodigo: 'certificado', tipoDocCodigo: 'EPICRISIS',
      accion: 'certificar', ejecutadoPor: idDIR, rolEjecutorCodigo: 'DIR',
      observacion: 'Certificación Dirección — Art. 21 NTEC',
    });

    report.documentos.push({ tipo: 'EPICRISIS', id: instEpi.instanciaId, estado: 'certificado' });

    // ──────────────────────────────────────────────────────────────────
    // 15. Episodio cerrado + cama liberada
    // ──────────────────────────────────────────────────────────────────
    // Primero en_curso → cerrado (trigger valida la transición)
    await client.query(
      `UPDATE ece.episodio_atencion
       SET estado = 'cerrado', fecha_hora_cierre = $1
       WHERE id = $2 AND estado = 'en_curso'`,
      [tEgreso.toISOString(), episodioId]
    );

    // Actualizar episodio_hospitalario con datos de egreso
    await client.query(
      `UPDATE ece.episodio_hospitalario
       SET fecha_hora_egreso = $1, tipo_egreso = 'vivo', circunstancia_alta = 'alta_hospitalaria'
       WHERE episodio_id = $2`,
      [tEgreso.toISOString(), episodioId]
    );

    // Liberar cama
    if (camaId) {
      await client.query(
        `UPDATE ece.asignacion_cama SET hasta = $1 WHERE episodio_id = $2 AND hasta IS NULL`,
        [tEgreso.toISOString(), episodioId]
      );
      await client.query(
        `UPDATE ece.cama SET estado = 'limpieza' WHERE id = $1 AND estado = 'ocupada'`,
        [camaId]
      );
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

  // ─── Reporte final ───────────────────────────────────────────────────
  console.log('\n=== SEED DEMO HOSPITALARIO — REPORTE ===');
  console.log(`paciente ECE  : ${report.pacienteId}`);
  console.log(`public.Patient: ${report.publicPatientId}`);
  console.log(`episodio      : ${report.episodioId}`);
  console.log(`\nDocumentos (${report.documentos.length}):`);
  for (const d of report.documentos) {
    console.log(`  [${d.estado.padEnd(12)}] ${d.tipo.padEnd(35)} ${d.id}`);
  }
  if (report.errores.length) {
    console.log(`\nErrores (${report.errores.length}):`);
    for (const e of report.errores) console.log(`  !! ${e}`);
  } else {
    console.log('\nSeed completado exitosamente.');
    console.log('\nPara limpiar:');
    console.log(`  DELETE FROM ece.paciente WHERE numero_expediente = 'DEMO-HOSP-001';`);
    console.log(`  DELETE FROM public."Patient" WHERE mrn = 'DEMO-HOSP-MARIA-001';`);
  }
}

main();
