#!/usr/bin/env node
/**
 * migrate-deaths-to-ece.mjs
 *
 * One-shot migration: public."DeathCertificate" → ece.certificado_defuncion.
 *
 * Mapeo de campos:
 *   id                    → id  (preservado)
 *   patientId             → ece.paciente lookup via public_patient_id, crear si no existe
 *   encounterId           → ece.episodio_atencion lookup via public_encounter_id, crear si no existe
 *   occurredAt            → fecha_hora_defuncion
 *   basicCauseCode        → causa_basica_cie10
 *   manner                → clasificacion (ver MANNER_MAP abajo)
 *   certifyingPhysicianId → medico_certificante_id via ece.personal_salud.his_user_id
 *
 * Idempotencia: skip si ya existe una fila en ece.certificado_defuncion con
 *   _source_legacy_id = dc.id (columna de trazabilidad añadida si no existe).
 *
 * Columnas requeridas sin equivalente legacy que se completan con placeholders:
 *   instancia_id → genera UUID placeholder estable (hash del id origen) como instancia fake
 *   epicrisis_id → NULL por defecto; la epicrisis ECE puede no existir aún
 *
 * Uso:
 *   node --env-file=.env scripts/migrate-deaths-to-ece.mjs [--dry-run]
 *
 * Variables de entorno requeridas:
 *   DIRECT_URL — PostgreSQL connection string con acceso a schemas public + ece.
 */
import pg from 'pg';
import { createHash } from 'node:crypto';

const DRY_RUN = process.argv.includes('--dry-run');

/** Mapeo manner (legacy) → clasificacion (ece CHECK constraint) */
const MANNER_MAP = {
  natural: 'natural',
  accident: 'violenta',
  accidente: 'violenta',
  suicide: 'violenta',
  suicidio: 'violenta',
  homicide: 'violenta',
  homicidio: 'violenta',
  undetermined: 'en_investigacion',
  indeterminado: 'en_investigacion',
  en_investigacion: 'en_investigacion',
  violenta: 'violenta',
};

const VALID_CLASIFICACION = ['natural', 'violenta', 'accidente_transito', 'en_investigacion'];

function mapManner(manner) {
  if (!manner) return 'en_investigacion';
  const normalized = manner.toLowerCase().trim();
  return MANNER_MAP[normalized] ?? 'en_investigacion';
}

/**
 * Genera un UUID v4-like determinista desde un string (para instancia_id placeholder).
 * Usa SHA-256 y formatea los primeros 32 bytes como UUID.
 */
function deterministicUuid(seed) {
  const hash = createHash('sha256').update(`migrate-death:${seed}`).digest('hex');
  // Formato: 8-4-4-4-12
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),     // version 4
    (parseInt(hash[16], 16) & 0x3 | 0x8).toString(16) + hash.slice(17, 20), // variant
    hash.slice(20, 32),
  ].join('-');
}

async function main() {
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error('Error: DIRECT_URL no definido en env.');
    process.exit(2);
  }

  const cleanUrl = url
    .replace(/[?&]sslmode=[^&]*/g, '')
    .replace('?&', '?')
    .replace(/[?&]$/, '');

  const client = new pg.Client({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log(`Conectado a ${url.split('@')[1]?.split('?')[0] ?? 'DB'}`);
  if (DRY_RUN) console.log('[DRY-RUN] No se ejecutarán INSERTs.\n');

  const stats = { total: 0, migrated: 0, skipped: 0, errors: 0 };
  const errorDetails = [];

  try {
    // ----------------------------------------------------------------
    // 0. Asegurar que la columna de trazabilidad existe en destino.
    //    Idempotente: ALTER TABLE IF NOT EXISTS equivalente.
    // ----------------------------------------------------------------
    if (!DRY_RUN) {
      await client.query(`
        ALTER TABLE ece.certificado_defuncion
        ADD COLUMN IF NOT EXISTS _source_legacy_id UUID;
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_cd_source_legacy
          ON ece.certificado_defuncion(_source_legacy_id)
          WHERE _source_legacy_id IS NOT NULL;
      `);
    }

    // ----------------------------------------------------------------
    // 1. Cargar todos los registros fuente.
    // ----------------------------------------------------------------
    const { rows: sources } = await client.query(`
      SELECT
        id,
        "patientId",
        "encounterId",
        "occurredAt",
        "basicCauseCode",
        "basicCauseDesc",
        "intermediateCauseCode",
        "intermediateCauseDesc",
        "directCauseCode",
        "directCauseDesc",
        "contributingCauses",
        "manner",
        "certifyingPhysicianId",
        "notes",
        "createdAt"
      FROM public."DeathCertificate"
      ORDER BY "createdAt" ASC
    `);

    stats.total = sources.length;
    console.log(`Total registros fuente: ${stats.total}\n`);

    // ----------------------------------------------------------------
    // 2. Migrar fila por fila dentro de transacción individual.
    //    Transacciones individuales garantizan que un error aislado
    //    no aborta toda la migración (cada fila es atómica).
    // ----------------------------------------------------------------
    for (const dc of sources) {
      let rowTx;
      try {
        // 2a. Chequeo de idempotencia
        const { rows: existing } = await client.query(
          `SELECT id FROM ece.certificado_defuncion WHERE _source_legacy_id = $1 LIMIT 1`,
          [dc.id],
        );

        if (existing.length > 0) {
          stats.skipped++;
          continue;
        }

        // 2b. Resolver ece.paciente por public_patient_id
        const { rows: pacienteRows } = await client.query(
          `SELECT id FROM ece.paciente WHERE public_patient_id = $1 LIMIT 1`,
          [dc.patientId],
        );

        let pacienteEceId;
        if (pacienteRows.length > 0) {
          pacienteEceId = pacienteRows[0].id;
        } else {
          // No hay ece.paciente para este paciente — crear un registro mínimo.
          // Requiere establecimiento_id; usamos el de la organización del paciente si
          // está disponible, de lo contrario el primer establecimiento activo.
          const { rows: estRows } = await client.query(`
            SELECT e.id
            FROM public."Establishment" e
            JOIN public."Patient" p ON p."organizationId" = e."organizationId"
            WHERE p.id = $1
            LIMIT 1
          `, [dc.patientId]);

          if (estRows.length === 0) {
            throw new Error(
              `Sin establecimiento para patientId=${dc.patientId} — no se puede crear ece.paciente`,
            );
          }

          if (DRY_RUN) {
            pacienteEceId = deterministicUuid(`patient:${dc.patientId}`);
          } else {
            const { rows: newPaciente } = await client.query(`
              INSERT INTO ece.paciente (
                public_patient_id,
                establecimiento_id,
                numero_expediente,
                tipo_registro_identidad
              ) VALUES ($1, $2, $3, 'version_paciente')
              RETURNING id
            `, [
              dc.patientId,
              estRows[0].id,
              `MIGRADO-${dc.patientId.slice(0, 8)}`,
            ]);
            pacienteEceId = newPaciente[0].id;
          }
        }

        // 2c. Resolver ece.episodio_atencion por public_encounter_id
        let episodioEceId;
        if (dc.encounterId) {
          const { rows: epRows } = await client.query(
            `SELECT id FROM ece.episodio_atencion WHERE public_encounter_id = $1 LIMIT 1`,
            [dc.encounterId],
          );

          if (epRows.length > 0) {
            episodioEceId = epRows[0].id;
          } else {
            // Crear episodio mínimo vinculado al encounter legacy.
            // Requiere establecimiento_id via ece.paciente ya resuelto.
            const { rows: pacEst } = await client.query(
              `SELECT establecimiento_id FROM ece.paciente WHERE id = $1`,
              [pacienteEceId],
            );

            const estId = pacEst[0]?.establecimiento_id;
            if (!estId) {
              throw new Error(`Sin establecimiento en ece.paciente id=${pacienteEceId}`);
            }

            if (DRY_RUN) {
              episodioEceId = deterministicUuid(`encounter:${dc.encounterId}`);
            } else {
              const { rows: newEp } = await client.query(`
                INSERT INTO ece.episodio_atencion (
                  paciente_id,
                  establecimiento_id,
                  public_encounter_id,
                  modalidad,
                  servicio_categoria,
                  fecha_hora_inicio,
                  fecha_hora_cierre,
                  estado
                ) VALUES ($1, $2, $3, 'hospitalario', 'hospitalizacion', $4, $4, 'cerrado')
                RETURNING id
              `, [pacienteEceId, estId, dc.encounterId, dc.occurredAt]);
              episodioEceId = newEp[0].id;
            }
          }
        } else {
          // Sin encounter: crear episodio mínimo sin public_encounter_id
          if (DRY_RUN) {
            episodioEceId = deterministicUuid(`noencounter:${dc.id}`);
          } else {
            const { rows: pacEst } = await client.query(
              `SELECT establecimiento_id FROM ece.paciente WHERE id = $1`,
              [pacienteEceId],
            );
            const estId = pacEst[0]?.establecimiento_id;
            if (!estId) throw new Error(`Sin establecimiento en ece.paciente id=${pacienteEceId}`);

            const { rows: newEp } = await client.query(`
              INSERT INTO ece.episodio_atencion (
                paciente_id,
                establecimiento_id,
                modalidad,
                servicio_categoria,
                fecha_hora_inicio,
                fecha_hora_cierre,
                estado
              ) VALUES ($1, $2, 'hospitalario', 'hospitalizacion', $3, $3, 'cerrado')
              RETURNING id
            `, [pacienteEceId, estId, dc.occurredAt]);
            episodioEceId = newEp[0].id;
          }
        }

        // 2d. Resolver medico_certificante_id via ece.personal_salud.his_user_id
        const { rows: psRows } = await client.query(
          `SELECT id FROM ece.personal_salud WHERE his_user_id = $1 LIMIT 1`,
          [dc.certifyingPhysicianId],
        );

        if (psRows.length === 0) {
          throw new Error(
            `No existe ece.personal_salud con his_user_id=${dc.certifyingPhysicianId}`,
          );
        }
        const medicoCertificanteId = psRows[0].id;

        // 2e. Construir causas intermedias en JSONB
        const causasIntermedias = [];
        if (dc.intermediateCauseCode) {
          causasIntermedias.push({
            cie10: dc.intermediateCauseCode,
            descripcion: dc.intermediateCauseDesc ?? '',
            intervalo_aproximado: null,
          });
        }
        if (dc.directCauseCode) {
          causasIntermedias.push({
            cie10: dc.directCauseCode,
            descripcion: dc.directCauseDesc ?? '',
            intervalo_aproximado: null,
          });
        }

        // 2f. Causas contribuyentes (texto libre en legacy → array JSONB)
        const causasContribuyentes = dc.contributingCauses
          ? [{ cie10: null, descripcion: dc.contributingCauses }]
          : null;

        // 2g. Clasificacion
        const clasificacion = mapManner(dc.manner);

        // 2h. instancia_id placeholder (el motor de workflow no tiene instancia para esto)
        const instanciaId = deterministicUuid(`instancia:${dc.id}`);

        if (DRY_RUN) {
          console.log(`[DRY-RUN] id=${dc.id} → paciente=${pacienteEceId} episodio=${episodioEceId} clasificacion=${clasificacion}`);
          stats.migrated++;
          continue;
        }

        // 2i. INSERT con idempotencia via ON CONFLICT DO NOTHING en id
        await client.query(`
          INSERT INTO ece.certificado_defuncion (
            id,
            instancia_id,
            episodio_id,
            epicrisis_id,
            fecha_hora_defuncion,
            causa_basica_cie10,
            causas_intermedias,
            causas_contribuyentes,
            clasificacion,
            medico_certificante_id,
            registrado_en,
            _source_legacy_id
          ) VALUES (
            $1, $2, $3,
            NULL,
            $4, $5, $6, $7, $8, $9, $10,
            $1
          )
          ON CONFLICT (id) DO NOTHING
        `, [
          dc.id,
          instanciaId,
          episodioEceId,
          dc.occurredAt,
          dc.basicCauseCode,
          causasIntermedias.length > 0 ? JSON.stringify(causasIntermedias) : null,
          causasContribuyentes ? JSON.stringify(causasContribuyentes) : null,
          clasificacion,
          medicoCertificanteId,
          dc.createdAt,
        ]);

        stats.migrated++;
      } catch (err) {
        stats.errors++;
        errorDetails.push({ id: dc.id, error: err.message });
        console.error(`  ERROR id=${dc.id}: ${err.message}`);
      }
    }
  } finally {
    await client.end();
  }

  // ----------------------------------------------------------------
  // 3. Reporte final
  // ----------------------------------------------------------------
  console.log('\n========== Resumen de migración ==========');
  console.log(`  Total fuente  : ${stats.total}`);
  console.log(`  Migrados      : ${stats.migrated}`);
  console.log(`  Skipped       : ${stats.skipped}  (ya existían)`);
  console.log(`  Errores       : ${stats.errors}`);
  if (DRY_RUN) console.log('\n  [DRY-RUN] No se persistió ningún cambio.');

  if (errorDetails.length > 0) {
    console.log('\n  Detalle de errores:');
    for (const e of errorDetails) {
      console.log(`    id=${e.id} → ${e.error}`);
    }
  }

  if (stats.errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Error fatal:', err.message);
  process.exit(2);
});
