/**
 * Backfill script: sincroniza public.Patient + public.Encounter → ece.*
 *
 * El script es IDEMPOTENTE: antes de cada INSERT verifica si ya existe.
 * Puede correrse múltiples veces sin efecto acumulativo.
 *
 * Uso:
 *   DATABASE_URL=<conn-string> node scripts/backfill-ece.mjs
 *   DATABASE_URL=<conn-string> node scripts/backfill-ece.mjs --dry-run
 *
 * Notas de schema real (verificado via MCP 2026-05-29):
 *   ece.paciente.establecimiento_id → FK a public."Establishment" (directo)
 *   ece.episodio_atencion.establecimiento_id → FK a ece.establecimiento
 *   ece.establecimiento.establishment_id (nullable, índice no-unique) → public."Establishment"
 *   ece.establecimiento.codigo → UNIQUE
 *   ece.paciente.public_patient_id → índice no-unique (usamos SELECT-then-INSERT)
 *   ece.episodio_atencion.public_encounter_id → índice no-unique (ídem)
 *   ece.paciente.nui nullable; si null → tipo_registro_identidad='sin_documento'
 *   ece.paciente.numero_expediente NOT NULL, UNIQUE(establecimiento_id, numero_expediente)
 */

// Usamos postgres.js — disponible como dep transitiva en el monorepo (Supabase JS SDK la trae).
let sql;
try {
  const { default: postgres } = await import("postgres");
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL no definido.");
    console.error(
      "Uso: DATABASE_URL=<conn-string> node scripts/backfill-ece.mjs",
    );
    process.exit(1);
  }
  sql = postgres(DATABASE_URL, { max: 1 });
} catch {
  console.error(
    "ERROR: no se pudo importar 'postgres'. Instálalo con: npm install -g postgres",
  );
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");

if (DRY_RUN) {
  console.log("=== MODO DRY-RUN: no se escribirá nada en la BD ===\n");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logError(msg, err) {
  console.error(
    `[${new Date().toISOString()}] ERROR: ${msg}`,
    err?.message ?? err ?? "",
  );
}

// ─── Paso 0: estado inicial ───────────────────────────────────────────────────

async function getStats() {
  const [patients, encounters, ecePacientes, eceEpisodios] = await Promise.all([
    sql`SELECT COUNT(*) AS cnt FROM public."Patient" WHERE "deletedAt" IS NULL`,
    sql`SELECT COUNT(*) AS cnt FROM public."Encounter" WHERE "dischargedAt" IS NULL`,
    sql`SELECT COUNT(*) AS cnt FROM ece.paciente`,
    sql`SELECT COUNT(*) AS cnt FROM ece.episodio_atencion`,
  ]);
  return {
    patients: Number(patients[0].cnt),
    encounters: Number(encounters[0].cnt),
    ecePacientes: Number(ecePacientes[0].cnt),
    eceEpisodios: Number(eceEpisodios[0].cnt),
  };
}

// ─── Paso 1: garantizar ece.institucion ──────────────────────────────────────

async function upsertInstitucion(org) {
  if (DRY_RUN) {
    log(`  [dry-run] ece.institucion para org "${org.legalName}" (${org.id})`);
    return `dry-run-inst-${org.id}`;
  }

  // Verificar si ya existe (usando organization_id como clave lógica)
  const existing = await sql`
    SELECT id FROM ece.institucion WHERE organization_id = ${org.id}::uuid LIMIT 1
  `;
  if (existing.length > 0) {
    log(`  ece.institucion ya existe: ${existing[0].id}`);
    return existing[0].id;
  }

  // codigo es UNIQUE — usamos el org id como codigo para unicidad garantizada
  const result = await sql`
    INSERT INTO ece.institucion (codigo, nombre, tipo, organization_id)
    VALUES (${org.id}, ${org.legalName}, 'privada', ${org.id}::uuid)
    ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id
  `;
  log(`  ece.institucion creada: ${result[0].id}`);
  return result[0].id;
}

// ─── Paso 2: garantizar ece.establecimiento ──────────────────────────────────

async function upsertEstablecimiento(estab, institucionEceId) {
  if (DRY_RUN) {
    log(
      `  [dry-run] ece.establecimiento para "${estab.name}" → inst ECE ${institucionEceId}`,
    );
    return `dry-run-estab-${estab.id}`;
  }

  // Verificar por establishment_id (no tiene UNIQUE constraint, pero usamos el valor como búsqueda)
  const existing = await sql`
    SELECT id FROM ece.establecimiento
    WHERE establishment_id = ${estab.id}::uuid
    LIMIT 1
  `;
  if (existing.length > 0) {
    log(`  ece.establecimiento ya existe: ${existing[0].id}`);
    return existing[0].id;
  }

  // codigo es UNIQUE en ece.establecimiento
  const result = await sql`
    INSERT INTO ece.establecimiento (
      institucion_id,
      codigo,
      nombre,
      nivel_atencion,
      establishment_id,
      activo
    )
    VALUES (
      ${institucionEceId}::uuid,
      ${estab.code},
      ${estab.name},
      'tercer',
      ${estab.id}::uuid,
      true
    )
    ON CONFLICT (codigo) DO UPDATE
      SET nombre = EXCLUDED.nombre,
          establishment_id = EXCLUDED.establishment_id,
          activo = true
    RETURNING id
  `;
  log(`  ece.establecimiento creado: ${result[0].id}`);
  return result[0].id;
}

// ─── Paso 3: backfill ece.paciente ───────────────────────────────────────────

async function backfillPacientes(establecimientoPublicId) {
  // ece.paciente.establecimiento_id → FK a public."Establishment" directamente
  const patients = await sql`
    SELECT id, mrn
    FROM public."Patient"
    WHERE "deletedAt" IS NULL
    ORDER BY "createdAt"
  `;

  log(`Pacientes activos encontrados: ${patients.length}`);

  let creados = 0;
  let omitidos = 0;
  const errors = [];

  for (const p of patients) {
    try {
      if (DRY_RUN) {
        log(
          `  [dry-run] ece.paciente: patient_id=${p.id} mrn=${p.mrn}`,
        );
        creados++;
        continue;
      }

      // Verificar si ya existe (public_patient_id no tiene UNIQUE — usamos SELECT primero)
      const existing = await sql`
        SELECT id FROM ece.paciente
        WHERE public_patient_id = ${p.id}::uuid
        LIMIT 1
      `;
      if (existing.length > 0) {
        omitidos++;
        continue;
      }

      // Verificar si el mrn ya existe como numero_expediente en este establecimiento
      // Si colisiona, agregamos sufijo numérico.
      let expediente = p.mrn;
      const mrnConflict = await sql`
        SELECT id FROM ece.paciente
        WHERE establecimiento_id = ${establecimientoPublicId}::uuid
          AND numero_expediente = ${expediente}
        LIMIT 1
      `;
      if (mrnConflict.length > 0) {
        // Paciente distinto con el mismo MRN (raro pero posible en data sucia)
        expediente = `${p.mrn}-${p.id.substring(0, 8)}`;
      }

      await sql`
        INSERT INTO ece.paciente (
          public_patient_id,
          establecimiento_id,
          numero_expediente,
          tipo_registro_identidad,
          estado_expediente,
          estado_registro
        )
        VALUES (
          ${p.id}::uuid,
          ${establecimientoPublicId}::uuid,
          ${expediente},
          'sin_documento',
          'activo',
          'vigente'
        )
      `;
      creados++;
    } catch (err) {
      errors.push({ patientId: p.id, mrn: p.mrn, error: err?.message });
      logError(`ece.paciente patient_id=${p.id}`, err);
    }
  }

  log(
    `ece.paciente — creados: ${creados}, ya existían: ${omitidos}, errores: ${errors.length}`,
  );
  return { creados, omitidos, errors };
}

// ─── Paso 4: backfill ece.episodio_atencion ──────────────────────────────────

function admissionTypeToServicioCategoria(admissionType) {
  switch (admissionType) {
    case "EMERGENCY":
      return "emergencia";
    case "OUTPATIENT":
      return "consulta_externa";
    case "SCHEDULED":
    case "TRANSFER":
    default:
      return "hospitalizacion";
  }
}

function admissionTypeToModalidad(admissionType) {
  return admissionType === "OUTPATIENT" ? "ambulatorio" : "hospitalario";
}

async function backfillEpisodios(eceEstablecimientoId) {
  const encounters = await sql`
    SELECT id, "patientId", "admittedAt", "admissionType"
    FROM public."Encounter"
    WHERE "dischargedAt" IS NULL
    ORDER BY "admittedAt"
  `;

  log(`Encounters abiertos encontrados: ${encounters.length}`);

  let creados = 0;
  let omitidos = 0;
  const errors = [];

  for (const enc of encounters) {
    try {
      if (DRY_RUN) {
        const modalidad = admissionTypeToModalidad(enc.admissionType);
        const servicio = admissionTypeToServicioCategoria(enc.admissionType);
        log(
          `  [dry-run] ece.episodio_atencion: encounter=${enc.id} modalidad=${modalidad} servicio=${servicio}`,
        );
        creados++;
        continue;
      }

      // Verificar si ya existe episodio para este encounter
      const existing = await sql`
        SELECT id FROM ece.episodio_atencion
        WHERE public_encounter_id = ${enc.id}::uuid
        LIMIT 1
      `;
      if (existing.length > 0) {
        omitidos++;
        continue;
      }

      // Resolver ece.paciente por public_patient_id
      const pacienteRows = await sql`
        SELECT id FROM ece.paciente
        WHERE public_patient_id = ${enc.patientId}::uuid
        LIMIT 1
      `;
      if (pacienteRows.length === 0) {
        errors.push({
          encounterId: enc.id,
          patientId: enc.patientId,
          error: "ece.paciente no encontrado — paciente posiblemente no fue backfilleado",
        });
        logError(
          `episodio encounter=${enc.id}: ece.paciente no existe para patient=${enc.patientId}`,
          null,
        );
        continue;
      }

      const pacienteEceId = pacienteRows[0].id;
      const modalidad = admissionTypeToModalidad(enc.admissionType);
      const servicio = admissionTypeToServicioCategoria(enc.admissionType);

      await sql`
        INSERT INTO ece.episodio_atencion (
          paciente_id,
          establecimiento_id,
          public_encounter_id,
          modalidad,
          servicio_categoria,
          fecha_hora_inicio,
          estado,
          creado_en,
          actualizado_en
        )
        VALUES (
          ${pacienteEceId}::uuid,
          ${eceEstablecimientoId}::uuid,
          ${enc.id}::uuid,
          ${modalidad},
          ${servicio},
          ${enc.admittedAt}::timestamptz,
          'abierto',
          now(),
          now()
        )
      `;
      creados++;
    } catch (err) {
      errors.push({ encounterId: enc.id, error: err?.message });
      logError(`ece.episodio_atencion encounter=${enc.id}`, err);
    }
  }

  log(
    `ece.episodio_atencion — creados: ${creados}, ya existían: ${omitidos}, errores: ${errors.length}`,
  );
  return { creados, omitidos, errors };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log("=== Backfill ECE iniciado ===");

  const before = await getStats();
  log("Estado INICIAL:");
  log(`  public.Patient activos:       ${before.patients}`);
  log(`  public.Encounter abiertos:    ${before.encounters}`);
  log(`  ece.paciente:                 ${before.ecePacientes}`);
  log(`  ece.episodio_atencion:        ${before.eceEpisodios}`);
  log("");

  // Cargar todos los Establishments activos con su Org
  const establishments = await sql`
    SELECT e.id, e.code, e.name, e."organizationId", o."legalName"
    FROM public."Establishment" e
    JOIN public."Organization" o ON o.id = e."organizationId"
    WHERE e.active = true
  `;

  if (establishments.length === 0) {
    logError("No hay Establishments activos en public.Establishment", null);
    await sql.end();
    process.exit(1);
  }

  log(`Establishments activos: ${establishments.length}`);

  const establecimientoMap = new Map(); // public.Establishment.id → ece.establecimiento.id

  for (const estab of establishments) {
    log(`\nProcesando: "${estab.name}"`);

    const institucionEceId = await upsertInstitucion({
      id: estab.organizationId,
      legalName: estab.legalName,
    });

    const eceEstabId = await upsertEstablecimiento(estab, institucionEceId);
    establecimientoMap.set(estab.id, eceEstabId);
  }

  // Para el backfill de pacientes usamos el primer establishment (hay solo 1 en prod).
  // Los Encounters ya tienen su establishmentId — al crear episodios usamos el mapa.
  const mainEstabPublicId = establishments[0].id;
  const mainEceEstabId = establecimientoMap.get(mainEstabPublicId);

  if (!mainEceEstabId) {
    logError("No se pudo obtener ece.establecimiento.id para el establishment principal", null);
    await sql.end();
    process.exit(1);
  }

  log("\n--- Paso 3: backfill ece.paciente ---");
  const pacienteResult = await backfillPacientes(mainEstabPublicId);

  log("\n--- Paso 4: backfill ece.episodio_atencion ---");
  const episodioResult = await backfillEpisodios(mainEceEstabId);

  if (!DRY_RUN) {
    const after = await getStats();
    log("\nEstado FINAL:");
    log(`  ece.paciente:          ${after.ecePacientes} (delta: +${after.ecePacientes - before.ecePacientes})`);
    log(`  ece.episodio_atencion: ${after.eceEpisodios} (delta: +${after.eceEpisodios - before.eceEpisodios})`);
  }

  log("\n=== Resumen ===");
  log(`ece.paciente    — creados: ${pacienteResult.creados}, ya existían: ${pacienteResult.omitidos}, errores: ${pacienteResult.errors.length}`);
  log(`ece.episodio    — creados: ${episodioResult.creados}, ya existían: ${episodioResult.omitidos}, errores: ${episodioResult.errors.length}`);

  const totalErrors = [...pacienteResult.errors, ...episodioResult.errors];
  if (totalErrors.length > 0) {
    log("\nDetalle de errores:");
    for (const e of totalErrors) {
      console.error("  ", JSON.stringify(e));
    }
  }

  await sql.end();
  const exitCode = totalErrors.length > 0 ? 1 : 0;
  log(`\n=== Backfill ECE ${DRY_RUN ? "(dry-run) " : ""}finalizado (exit ${exitCode}) ===`);
  process.exit(exitCode);
}

main().catch(async (err) => {
  logError("Error fatal en backfill", err);
  await sql?.end().catch(() => {});
  process.exit(1);
});
