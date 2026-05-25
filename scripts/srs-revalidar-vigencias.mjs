#!/usr/bin/env node
/**
 * scripts/srs-revalidar-vigencias.mjs
 *
 * Job de revalidación de registros sanitarios SRS El Salvador.
 *
 * Lee de Postgres todos los Drug con `srsRegistroSanitario` no nulo y
 * consulta el padrón SRS para detectar:
 *   - Cambios de estado (ACTIVO → SUSPENDIDO/CANCELADO/ELIMINADO)
 *   - Renovación de anualidad (fecha de vigencia actualizada)
 *
 * Persiste cambios en Drug + cache local SrsRegistroCache.
 *
 * Cero dependencias — solo Node.js 20+ (fetch nativo, pg via DATABASE_URL).
 *
 * Uso:
 *   DATABASE_URL=postgres://... node scripts/srs-revalidar-vigencias.mjs
 *   DATABASE_URL=... ORG_ID=<uuid> node scripts/srs-revalidar-vigencias.mjs  # solo una org
 *
 * Programar en cron diario (Vercel Cron o sistema externo):
 *   0 3 * * *  node /app/scripts/srs-revalidar-vigencias.mjs
 *
 * NOTA: requiere `pg` instalado en el host. Si no está, usar la mutation tRPC
 * `srsRegistro.revalidarVigencias` desde un endpoint Vercel Cron en su lugar.
 */

import { Client } from "pg";

const SRS_BASE_URL = process.env.SRS_BASE_URL ?? "https://expedientes.srs.gob.sv";
const FETCH_TIMEOUT_MS = Number(process.env.SRS_FETCH_TIMEOUT_MS ?? 20_000);
const DATABASE_URL = process.env.DATABASE_URL;
const ORG_FILTER = process.env.ORG_ID ?? null;

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL no configurada.");
  process.exit(1);
}

async function fetchDetalle(registroSanitario) {
  const url = `${SRS_BASE_URL}/productos/infogeneral?param=${encodeURIComponent(registroSanitario)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "HIS-Avante-Cron/1.0" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.status !== 200) throw new Error(`SRS status=${json.status}`);
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

function parseVidaUtilMeses(texto) {
  if (!texto) return null;
  const t = String(texto).toUpperCase().trim();
  const m = t.match(/^(\d+)\s*(MESES?|A[ÑN]OS?)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  return m[2].startsWith("A") ? n * 12 : n;
}

function normalizeEstado(raw) {
  const v = String(raw ?? "").toUpperCase();
  if (["ACTIVO", "CANCELADO", "SUSPENDIDO", "ELIMINADO"].includes(v)) return v;
  return "ELIMINADO";
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log(`▶ Conectado. Buscando Drug con srsRegistroSanitario${ORG_FILTER ? ` (org=${ORG_FILTER})` : ""}...`);

  const sql = ORG_FILTER
    ? `SELECT DISTINCT "srsRegistroSanitario", "srsEstado", "organizationId"
       FROM "Drug"
       WHERE "srsRegistroSanitario" IS NOT NULL AND "organizationId" = $1`
    : `SELECT DISTINCT "srsRegistroSanitario", "srsEstado", "organizationId"
       FROM "Drug"
       WHERE "srsRegistroSanitario" IS NOT NULL`;
  const params = ORG_FILTER ? [ORG_FILTER] : [];
  const { rows: drugs } = await client.query(sql, params);

  console.log(`▶ ${drugs.length} registro(s) Drug con SRS. Procesando…\n`);

  let ok = 0;
  let errores = 0;
  const cambios = [];

  for (const d of drugs) {
    const reg = d.srsRegistroSanitario;
    try {
      const detalle = await fetchDetalle(reg);
      const estado = normalizeEstado(detalle.estado);
      const anualidad = detalle.anualidad || null;
      const vidaUtilMeses = parseVidaUtilMeses(detalle.vidaUtil);

      // Persistir cache (UPSERT minimal — solo cabecera)
      await client.query(
        `INSERT INTO "SrsRegistroCache" (
          "registroSanitario","idProductoSrs","nombreRegistro","titular","estado",
          "categoria","clasificacion","modalidadVenta","vidaUtilTexto","vidaUtilMeses",
          "viaAdministracion","primeraAutorizacion","anualidad",
          "condicionesAlmacenamiento","indicacionesTerapeuticas","mecanismoAccion",
          "regimenDosificacion","farmacocinetica","efectosAdversos",
          "contraindicaciones","precauciones","principalesInteracciones",
          "fichaTecnicaUrl","expedienteUrl","informeEvaluacionUrl",
          "rawPayload","fetchedAt","expiresAt"
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb,now(),now() + interval '90 days'
        )
        ON CONFLICT ("registroSanitario") DO UPDATE SET
          "estado" = EXCLUDED."estado",
          "anualidad" = EXCLUDED."anualidad",
          "vidaUtilTexto" = EXCLUDED."vidaUtilTexto",
          "vidaUtilMeses" = EXCLUDED."vidaUtilMeses",
          "titular" = EXCLUDED."titular",
          "rawPayload" = EXCLUDED."rawPayload",
          "fetchedAt" = now(),
          "expiresAt" = now() + interval '90 days'`,
        [
          reg,
          detalle.idProducto ?? reg,
          detalle.nombreRegistro,
          detalle.titular ?? null,
          estado,
          detalle.categoria ?? null,
          detalle.clasificacion ?? null,
          detalle.modalidadVenta ?? null,
          detalle.vidaUtil ?? null,
          vidaUtilMeses,
          detalle.viaAdministracion ?? null,
          detalle.primeraAutorizacion ?? null,
          anualidad,
          detalle.condicionesAlmacenamiento ?? null,
          detalle.INDICACIONES_TERAPEUTICAS ?? null,
          detalle.MECANISMO_ACCION ?? null,
          detalle.REGIMEN_DOSIFICACION ?? null,
          detalle.FARMACOCINETICA ?? null,
          detalle.EFECTOS_ADVERSOS ?? null,
          detalle.CONTRAINDICACIONES ?? null,
          detalle.PRECAUCIONES ?? null,
          detalle.PRINCIPALES_INTERACCIONES ?? null,
          null,
          null,
          null,
          JSON.stringify(detalle),
        ],
      );

      // Update Drug si cambió estado o anualidad
      const cambioEstado = estado !== d.srsEstado;
      await client.query(
        `UPDATE "Drug" SET
           "srsEstado" = $1,
           "srsAnualidad" = $2,
           "active" = $3,
           "srsUltimaSincronizacion" = now(),
           "updatedAt" = now()
         WHERE "srsRegistroSanitario" = $4 AND "organizationId" = $5`,
        [estado, anualidad, estado === "ACTIVO", reg, d.organizationId],
      );

      ok++;
      if (cambioEstado) {
        cambios.push({ reg, antes: d.srsEstado, despues: estado, org: d.organizationId });
        console.log(`  ⚠  ${reg}: ${d.srsEstado} → ${estado} (org ${d.organizationId})`);
      } else {
        console.log(`  ✓  ${reg}: ${estado} (vigencia ${anualidad ?? "—"})`);
      }
    } catch (err) {
      errores++;
      console.error(`  ✗  ${reg}: ${err.message}`);
    }

    // throttle suave para no abusar de SRS
    await new Promise((r) => setTimeout(r, 250));
  }

  await client.end();

  console.log("\n▶ Resumen");
  console.log(`   Total:           ${drugs.length}`);
  console.log(`   OK:              ${ok}`);
  console.log(`   Errores:         ${errores}`);
  console.log(`   Cambios estado:  ${cambios.length}`);

  if (cambios.length > 0) {
    console.log("\n   Detalle cambios:");
    for (const c of cambios) {
      console.log(`     - ${c.reg}: ${c.antes ?? "?"} → ${c.despues} (${c.org})`);
    }
  }

  process.exit(errores > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
