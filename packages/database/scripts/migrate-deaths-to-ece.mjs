/**
 * migrate-deaths-to-ece.mjs
 *
 * Script one-shot idempotente que copia registros de public."DeathCertificate"
 * al esquema ECE (ece.certificado_defuncion).
 *
 * Estrategia:
 *   - WHERE NOT EXISTS por episodio_id → seguro re-ejecutar.
 *   - Los registros legacy quedan en public."DeathCertificate" intactos (no se borran).
 *   - El estado_workflow se asigna según notifiedToCivilRegistryAt:
 *       notificado  → 'certificado'
 *       sin notificar → 'validado'  (asumimos que estaban firmados y validados en el proceso anterior)
 *   - manera legacy → manera ECE (mapeo explícito).
 *   - causas: basicCause → causa_principal_cie10 + causa_basica_cie10 (mismo valor).
 *   - Episodio ECE: se asigna el encounterId directamente como episodio_id.
 *     Si no existe en ece.episodio_atencion, el registro se omite (safe skip).
 *
 * Requisito: DIRECT_URL en .env con acceso a service_role (BYPASSRLS).
 *
 * Uso:
 *   node packages/database/scripts/migrate-deaths-to-ece.mjs [--dry-run]
 */

import pg from 'pg';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) {
  console.error('[ERROR] DIRECT_URL faltante en .env');
  process.exit(2);
}

const DRY_RUN = process.argv.includes('--dry-run');

if (DRY_RUN) {
  console.log('[DRY-RUN] No se escribirá en BD. Solo se mostrará cuántos registros se migrarían.');
}

// Mapeo manera legacy → manera ECE
const MANERA_MAP = {
  natural: 'natural',
  accident: 'accidental',
  suicide: 'suicidio',
  homicide: 'homicidio',
  undetermined: 'indeterminada',
};

async function main() {
  const client = new pg.Client({ connectionString: DIRECT_URL });
  await client.connect();

  try {
    // 1. Leer todos los DeathCertificate legacy.
    const { rows: legacy } = await client.query(`
      SELECT
        dc.id,
        dc."encounterId"         AS encounter_id,
        dc."patientId"           AS patient_id,
        dc."organizationId"      AS organization_id,
        dc."establishmentId"     AS establishment_id,
        dc."occurredAt"          AS occurred_at,
        dc."basicCauseCode"      AS basic_cause_code,
        dc."basicCauseDesc"      AS basic_cause_desc,
        dc."intermediateCauseCode" AS intermediate_code,
        dc."intermediateCauseDesc" AS intermediate_desc,
        dc."directCauseCode"     AS direct_code,
        dc."directCauseDesc"     AS direct_desc,
        dc.manner,
        dc."autopsyPerformed"    AS autopsy,
        dc."notes",
        dc."notifiedToCivilRegistryAt" AS notified_at,
        dc."certifiedAt"         AS certified_at,
        dc."certifiedById"       AS certified_by_id
      FROM public."DeathCertificate" dc
      ORDER BY dc."occurredAt" ASC
    `);

    console.log(`[INFO] Legacy DeathCertificate encontrados: ${legacy.length}`);

    if (legacy.length === 0) {
      console.log('[INFO] Nada que migrar.');
      return;
    }

    // 2. Verificar cuáles ya existen en ECE (por episodio_id = encounterId).
    const { rows: existentes } = await client.query(`
      SELECT episodio_id::text FROM ece.certificado_defuncion
    `);
    const existentesSet = new Set(existentes.map((r) => r.episodio_id));

    let migrated = 0;
    let skipped = 0;
    let noEpisodio = 0;

    for (const dc of legacy) {
      // Idempotencia: si ya existe en ECE, skip.
      if (existentesSet.has(dc.encounter_id)) {
        skipped++;
        continue;
      }

      // Verificar si el encounterId existe en ece.episodio_atencion.
      // Si no existe, se omite — el episodio puede no haber sido migrado aún.
      const { rows: episodioRows } = await client.query(
        `SELECT id::text FROM ece.episodio_atencion WHERE id = $1::uuid LIMIT 1`,
        [dc.encounter_id],
      );
      if (!episodioRows[0]) {
        noEpisodio++;
        console.log(`[SKIP] Sin episodio ECE para encounter ${dc.encounter_id}`);
        continue;
      }

      // Mapear manera.
      const manera = MANERA_MAP[dc.manner] ?? 'indeterminada';

      // Determinar estado_workflow según notificación al Registro Civil.
      const estadoWorkflow = dc.notified_at ? 'certificado' : 'validado';

      // Construir causas intermedias (si existen).
      const causasIntermedias = [];
      if (dc.intermediate_code) causasIntermedias.push(dc.intermediate_code);
      if (dc.direct_code) causasIntermedias.push(dc.direct_code);
      const causasJson = JSON.stringify(causasIntermedias);

      if (!DRY_RUN) {
        await client.query(`
          INSERT INTO ece.certificado_defuncion (
            episodio_id,
            paciente_id,
            establecimiento_id,
            fecha_hora_defuncion,
            lugar_defuncion,
            causa_principal_cie10,
            causas_intermedias_cie10,
            causa_basica_cie10,
            manera,
            autopsia_realizada,
            observaciones,
            estado_workflow,
            firmado_en,
            validado_en,
            certificado_en
          ) VALUES (
            $1::uuid,
            $2::uuid,
            $3::uuid,
            $4::timestamptz,
            'intrahospitalaria',
            $5,
            $6::jsonb,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $12,
            $13
          )
        `, [
          dc.encounter_id,       // $1 episodio_id
          dc.patient_id,         // $2 paciente_id
          dc.establishment_id,   // $3 establecimiento_id
          dc.occurred_at,        // $4 fecha_hora_defuncion
          dc.basic_cause_code,   // $5 causa_principal_cie10
          causasJson,            // $6 causas_intermedias_cie10
          dc.basic_cause_code,   // $7 causa_basica_cie10
          manera,                // $8 manera
          dc.autopsy ?? false,   // $9 autopsia_realizada
          dc.notes ?? null,      // $10 observaciones
          estadoWorkflow,        // $11 estado_workflow
          dc.certified_at,       // $12 firmado_en + validado_en
          dc.notified_at ?? null, // $13 certificado_en
        ]);
      }

      migrated++;
      console.log(`[OK] Migrado ${dc.id} → episodio ${dc.encounter_id} (${estadoWorkflow})`);
    }

    console.log(`\n[RESUMEN]`);
    console.log(`  Migrados:          ${migrated}`);
    console.log(`  Omitidos (ya ECE): ${skipped}`);
    console.log(`  Sin episodio ECE:  ${noEpisodio}`);

    if (DRY_RUN) {
      console.log('\n[DRY-RUN] Ningún registro fue escrito.');
    } else {
      console.log('\n[OK] Migración completada.');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[ERROR]', err);
  process.exit(1);
});
