/**
 * Estrategias de cache para datos bedside.
 *
 * - `cacheShiftData()` — persiste indicaciones + pacientes + medicamentos en IndexedDB.
 * - `getIndicacionesCached()` — lee indicaciones del cache con TTL guard.
 * - `getPacientesCached()` — lee pacientes del cache con TTL guard.
 *
 * El SW (sw.js) maneja cache de assets estáticos via Workbox.
 * Esta capa maneja cache de datos de turno via IndexedDB.
 */

import {
  getDb,
  STORE,
  markSyncTimestamp,
  getLastSyncTimestamp,
  TURNO_TTL_MS,
  CATALOGO_TTL_MS,
  isExpired,
} from "./db";
import type { IndicacionCache, MedicamentoCache, PacienteCache } from "./db";

export interface ShiftData {
  indicaciones: Omit<IndicacionCache, "cachedAt">[];
  pacientes: Omit<PacienteCache, "cachedAt">[];
  medicamentos: Omit<MedicamentoCache, "cachedAt">[];
}

/**
 * Persiste los datos del turno completos en IndexedDB.
 * Se llama al login y cada 15 min con conexión (refresh schedule).
 */
export async function cacheShiftData(data: ShiftData): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  // Limpiar y re-insertar indicaciones
  await db.clear(STORE.INDICACIONES);
  for (const ind of data.indicaciones) {
    await db.put(STORE.INDICACIONES, { ...ind, cachedAt: now });
  }

  // Limpiar y re-insertar pacientes
  await db.clear(STORE.PACIENTES);
  for (const pac of data.pacientes) {
    await db.put(STORE.PACIENTES, { ...pac, cachedAt: now });
  }

  // Medicamentos: merge (no limpiar todo — TTL catálogo es 8h)
  for (const med of data.medicamentos) {
    await db.put(STORE.MEDICAMENTOS, { ...med, cachedAt: now });
  }

  await markSyncTimestamp("shift_data");
}

/**
 * Lee indicaciones del cache.
 * Retorna null si el cache está vacío o expirado (TTL 60 min).
 */
export async function getIndicacionesCached(): Promise<IndicacionCache[] | null> {
  const lastSync = await getLastSyncTimestamp("shift_data");
  if (!lastSync || isExpired(lastSync, TURNO_TTL_MS)) {
    return null;
  }

  const db = await getDb();
  const items = await db.getAll(STORE.INDICACIONES);
  return items.length > 0 ? items : null;
}

/**
 * Lee pacientes del cache.
 * Retorna null si el cache está vacío o expirado (TTL 60 min).
 */
export async function getPacientesCached(): Promise<PacienteCache[] | null> {
  const lastSync = await getLastSyncTimestamp("shift_data");
  if (!lastSync || isExpired(lastSync, TURNO_TTL_MS)) {
    return null;
  }

  const db = await getDb();
  const items = await db.getAll(STORE.PACIENTES);
  return items.length > 0 ? items : null;
}

/**
 * Lee un medicamento por GTIN del cache.
 * Retorna null si no existe o expirado (TTL 8h catálogo).
 */
export async function getMedicamentoCached(gtin: string): Promise<MedicamentoCache | null> {
  const db = await getDb();
  const item = await db.get(STORE.MEDICAMENTOS, gtin);
  if (!item || isExpired(item.cachedAt, CATALOGO_TTL_MS)) return null;
  return item;
}

/**
 * Verifica si hay datos de turno frescos disponibles offline.
 * Usado por componentes para decidir si mostrar warning de reconectar.
 */
export async function hasValidShiftCache(): Promise<boolean> {
  const lastSync = await getLastSyncTimestamp("shift_data");
  if (!lastSync) return false;
  return !isExpired(lastSync, TURNO_TTL_MS);
}

/**
 * Actualiza el status de una indicación en el cache local
 * (después de una administración offline exitosa o al encolar).
 */
export async function updateIndicacionStatusLocal(
  indicationId: string,
  status: IndicacionCache["status"],
): Promise<void> {
  const db = await getDb();
  const item = await db.get(STORE.INDICACIONES, indicationId);
  if (!item) return;
  await db.put(STORE.INDICACIONES, { ...item, status });
}
