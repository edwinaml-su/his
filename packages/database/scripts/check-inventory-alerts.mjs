/**
 * check-inventory-alerts.mjs
 *
 * Job batch horario: cruza ece.inventory_threshold con StockLot para detectar
 * alertas activas y emitir eventos DomainEvent en el outbox.
 *
 * Eventos emitidos:
 *   - inventory.stock_critico  (nivel <= stock_critico)
 *   - inventory.proximo_vencer (caducidad en <= dias_caducidad_alerta)
 *
 * Uso:
 *   node --env-file=.env packages/database/scripts/check-inventory-alerts.mjs
 *
 * Requiere: DATABASE_URL (pooler) o DIRECT_URL en env.
 * Programa vía cron (cada hora): 0 * * * * node check-inventory-alerts.mjs
 */

import pg from 'pg';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('[alerts] DIRECT_URL o DATABASE_URL requerido');
  process.exit(2);
}

const cleanUrl = url.replace(/[?&]sslmode=[^&]*/g, '').replace('?&', '?').replace(/[?&]$/, '');
const client = new pg.Client({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log('[alerts] conectado:', url.split('@')[1]?.split('?')[0] ?? 'db');

// ---------------------------------------------------------------------------
// 1. Cargar todos los thresholds activos con datos GS1
// ---------------------------------------------------------------------------
const { rows: thresholds } = await client.query(`
  SELECT
    t.gtin_id::text,
    t.ubicacion_gln,
    t.organization_id::text,
    t.stock_minimo,
    t.stock_critico,
    t.dias_caducidad_alerta,
    g.codigo       AS gtin_codigo,
    g.descripcion  AS gtin_descripcion
  FROM ece.inventory_threshold t
  JOIN ece.gs1_gtin g ON g.id = t.gtin_id
`);

console.log(`[alerts] thresholds cargados: ${thresholds.length}`);

if (thresholds.length === 0) {
  console.log('[alerts] sin thresholds configurados — fin');
  await client.end();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2. Por cada threshold, calcular stock y caducidades via StockLot
// ---------------------------------------------------------------------------
const today = new Date();
let emitidos = 0;

for (const th of thresholds) {
  // Stock total activo: items cuyo SKU coincida con el código GTIN
  const { rows: stockRows } = await client.query(`
    SELECT
      sl.id,
      sl."lotNumber",
      sl."expiryDate",
      sl."quantityOnHand"
    FROM public."StockItem" si
    JOIN public."StockLot"  sl ON sl."itemId" = si.id
    WHERE si.sku               = $1
      AND si."organizationId"  = $2::uuid
      AND sl."organizationId"  = $2::uuid
      AND sl.active            = true
      AND sl."quantityOnHand"  > 0
  `, [th.gtin_codigo.trim(), th.organization_id]);

  const stockTotal = stockRows.reduce(
    (acc, r) => acc + Number(r.quantityOnHand),
    0,
  );

  // --- Alerta stock_critico ---
  if (stockTotal <= Number(th.stock_critico)) {
    await emitirEvento(client, {
      type: 'inventory.stock_critico',
      organizationId: th.organization_id,
      payload: {
        gtinId: th.gtin_id,
        gtinCodigo: th.gtin_codigo,
        gtinDescripcion: th.gtin_descripcion,
        ubicacionGln: th.ubicacion_gln,
        stockActual: stockTotal,
        stockCritico: Number(th.stock_critico),
        stockMinimo: Number(th.stock_minimo),
      },
    });
    emitidos++;
    console.log(`[alerts] stock_critico → ${th.gtin_codigo} (${stockTotal} uds)`);
  }

  // --- Alertas caducidad ---
  for (const lot of stockRows) {
    if (!lot.expiryDate) continue;

    const expiry = new Date(lot.expiryDate);
    const msRestantes = expiry.getTime() - today.getTime();
    const diasRestantes = Math.ceil(msRestantes / (1000 * 60 * 60 * 24));

    if (diasRestantes <= Number(th.dias_caducidad_alerta)) {
      await emitirEvento(client, {
        type: 'inventory.proximo_vencer',
        organizationId: th.organization_id,
        payload: {
          gtinId: th.gtin_id,
          gtinCodigo: th.gtin_codigo,
          gtinDescripcion: th.gtin_descripcion,
          ubicacionGln: th.ubicacion_gln,
          loteId: lot.id,
          loteNumero: lot.lotNumber,
          expiryDate: expiry.toISOString(),
          diasRestantes,
        },
      });
      emitidos++;
      console.log(
        `[alerts] proximo_vencer → ${th.gtin_codigo} lote ${lot.lotNumber} (${diasRestantes}d)`,
      );
    }
  }
}

await client.end();
console.log(`[alerts] fin — ${emitidos} eventos emitidos`);

// ---------------------------------------------------------------------------
// Helper: insertar en public."DomainEvent" outbox
// ---------------------------------------------------------------------------
async function emitirEvento(db, { type, organizationId, payload }) {
  await db.query(`
    INSERT INTO public."DomainEvent"
      (type, "organizationId", payload, "occurredAt", attempts)
    VALUES ($1, $2::uuid, $3::jsonb, now(), 0)
    ON CONFLICT DO NOTHING
  `, [type, organizationId, JSON.stringify(payload)]);
}
