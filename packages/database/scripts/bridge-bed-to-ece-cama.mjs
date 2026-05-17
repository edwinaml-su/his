/**
 * bridge-bed-to-ece-cama.mjs
 *
 * Propósito (NO permanente): migración one-shot de camas del catálogo legacy
 * `public."Bed"` hacia `ece.cama`, creando entradas en `ece.servicio` cuando
 * el Ward correspondiente aún no tiene equivalente ECE.
 *
 * Cuándo usar:
 *   Antes de poner /beds en producción con el router ECE, o en entornos donde
 *   los datos de camas viven sólo en `public."Bed"`.
 *
 * Qué hace:
 *   1. Para cada Ward activo que tenga camas activas, inserta en `ece.servicio`
 *      si aún no existe (matching por nombre + establecimiento_id).
 *   2. Para cada Bed activa, inserta en `ece.cama` si no existe (matching por
 *      codigo + servicio_id). Mapea estado:
 *        FREE / RESERVED → disponible
 *        OCCUPIED         → ocupada
 *        BLOCKED          → bloqueada
 *        DIRTY / MAINTENANCE → mantenimiento
 *
 * Reversión:
 *   DELETE FROM ece.cama    WHERE id IN (SELECT id FROM ece.cama WHERE codigo LIKE 'BRIDGE-%');
 *   -- O, si quieres limpiar todo lo creado por este script, usa el tag en servicio.nombre
 *   -- NO elimina public."Bed"; es un bridge de sólo lectura en la fuente.
 *
 * Requisitos: DIRECT_URL y ECE_ESTABLECIMIENTO_ID en .env
 */

import pg from 'pg';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) {
  console.error('[ERROR] DIRECT_URL faltante en .env');
  process.exit(2);
}

// UUID del establecimiento ECE al que mapear. Si no se provee, el script
// buscará el primer establecimiento registrado en ece.establecimiento.
const ECE_EST_ID = process.env.ECE_ESTABLECIMIENTO_ID ?? null;

const client = new pg.Client({ connectionString: DIRECT_URL });

async function main() {
  await client.connect();
  console.log('[bridge] Conectado a la BD.');

  // 1. Resolver establecimiento ECE
  let estId = ECE_EST_ID;
  if (!estId) {
    const { rows } = await client.query(
      `SELECT id FROM ece.establecimiento ORDER BY created_at ASC LIMIT 1`
    );
    if (!rows.length) {
      console.error('[ERROR] No hay registros en ece.establecimiento. Crea uno primero.');
      process.exit(3);
    }
    estId = rows[0].id;
    console.log(`[bridge] Usando establecimiento ECE: ${estId}`);
  }

  // 2. Obtener Wards con camas activas
  const { rows: wards } = await client.query(`
    SELECT DISTINCT w.id, w.code, w.name
    FROM public."Ward" w
    JOIN public."Bed" b ON b."wardId" = w.id
    WHERE b.active = true
    ORDER BY w.name
  `);

  console.log(`[bridge] Wards encontrados: ${wards.length}`);

  let serviciosCreados = 0;
  let camasCreadas = 0;
  let camasOmitidas = 0;

  for (const ward of wards) {
    // 3. Insertar ece.servicio si no existe
    const { rows: servicioRows } = await client.query(`
      INSERT INTO ece.servicio (establecimiento_id, codigo, nombre)
      VALUES ($1, $2, $3)
      ON CONFLICT (establecimiento_id, codigo) DO UPDATE
        SET nombre = EXCLUDED.nombre
      RETURNING id
    `, [estId, ward.code ?? ward.id, ward.name]);

    const servicioId = servicioRows[0].id;
    if (servicioRows[0]) serviciosCreados++;

    // 4. Obtener camas del Ward
    const { rows: beds } = await client.query(`
      SELECT id, code, status
      FROM public."Bed"
      WHERE "wardId" = $1 AND active = true
      ORDER BY code
    `, [ward.id]);

    for (const bed of beds) {
      const estadoEce = mapBedStatus(bed.status);

      const { rowCount } = await client.query(`
        INSERT INTO ece.cama (servicio_id, codigo, estado)
        VALUES ($1, $2, $3)
        ON CONFLICT (servicio_id, codigo) DO NOTHING
      `, [servicioId, bed.code, estadoEce]);

      if (rowCount > 0) {
        camasCreadas++;
      } else {
        camasOmitidas++;
      }
    }

    console.log(`  [ward] ${ward.name}: ${beds.length} camas → servicio_id=${servicioId}`);
  }

  console.log(`\n[bridge] Resumen:`);
  console.log(`  Servicios procesados: ${wards.length} (nuevos o actualizados: ${serviciosCreados})`);
  console.log(`  Camas insertadas:     ${camasCreadas}`);
  console.log(`  Camas omitidas (ya existían): ${camasOmitidas}`);
  console.log('[bridge] Completado sin errores.');
}

/** Mapeo de BedStatus legacy → estado de ece.cama */
function mapBedStatus(status) {
  switch (status) {
    case 'FREE':
    case 'RESERVED':
      return 'disponible';
    case 'OCCUPIED':
      return 'ocupada';
    case 'BLOCKED':
      return 'bloqueada';
    case 'DIRTY':
    case 'MAINTENANCE':
    default:
      return 'mantenimiento';
  }
}

main()
  .catch((err) => {
    console.error('[bridge] Error fatal:', err);
    process.exit(1);
  })
  .finally(() => client.end());
