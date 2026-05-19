/**
 * Cola de sincronización offline — operaciones sobre IndexedDB.
 *
 * Flujo:
 *  1. offline: `enqueue()` guarda la mutation con estado PENDING_SYNC.
 *  2. online: `replayQueue()` procesa en orden cronológico, max 3 en paralelo.
 *  3. Fallo: incrementa `intentos`. Si >= MAX_RETRIES → estado FAILED.
 *  4. Éxito: elimina el item de la cola (SYNCED se purga inmediato).
 *
 * Idempotencia en servidor: el endpoint POST /api/sync/replay recibe `id_local`
 * para deduplique server-side.
 */

import { getDb, STORE } from "./db";
import type { SyncQueueItem } from "./db";

export const MAX_RETRIES = 5;
export const CONCURRENCY_LIMIT = 3;

/** Backoff exponencial: intento 1→1s, 2→2s, 3→4s, 4→8s, 5→16s */
export function backoffMs(intentos: number): number {
  return Math.min(1000 * Math.pow(2, intentos - 1), 30_000);
}

/** Agrega una mutation a la cola offline. */
export async function enqueue(
  item: Omit<SyncQueueItem, "id_local" | "intentos" | "status" | "created_at" | "last_attempt_at" | "error_message">,
): Promise<string> {
  const db = await getDb();
  const id_local = crypto.randomUUID();
  const entry: SyncQueueItem = {
    ...item,
    id_local,
    intentos: 0,
    status: "PENDING_SYNC",
    created_at: Date.now(),
    last_attempt_at: null,
    error_message: null,
  };
  await db.add(STORE.SYNC_QUEUE, entry);
  return id_local;
}

/** Retorna todos los items con status PENDING_SYNC ordenados por created_at. */
export async function getPendingItems(): Promise<SyncQueueItem[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex(STORE.SYNC_QUEUE, "by-status", "PENDING_SYNC");
  return all.sort((a, b) => a.created_at - b.created_at);
}

/** Retorna todos los items con status FAILED. */
export async function getFailedItems(): Promise<SyncQueueItem[]> {
  const db = await getDb();
  return db.getAllFromIndex(STORE.SYNC_QUEUE, "by-status", "FAILED");
}

/** Retorna todos los items (cualquier estado). */
export async function getAllQueueItems(): Promise<SyncQueueItem[]> {
  const db = await getDb();
  return db.getAll(STORE.SYNC_QUEUE);
}

/** Marca un item como SYNCING (en vuelo). */
async function markSyncing(id_local: string): Promise<void> {
  const db = await getDb();
  const item = await db.get(STORE.SYNC_QUEUE, id_local);
  if (!item) return;
  await db.put(STORE.SYNC_QUEUE, {
    ...item,
    status: "SYNCING",
    last_attempt_at: Date.now(),
  });
}

/** Marca un item como SYNCED y lo elimina de la cola. */
async function markSynced(id_local: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE.SYNC_QUEUE, id_local);
}

/** Incrementa intentos; si >= MAX_RETRIES marca FAILED, si no vuelve a PENDING_SYNC. */
async function markFailed(id_local: string, error_message: string): Promise<void> {
  const db = await getDb();
  const item = await db.get(STORE.SYNC_QUEUE, id_local);
  if (!item) return;
  const intentos = item.intentos + 1;
  await db.put(STORE.SYNC_QUEUE, {
    ...item,
    status: intentos >= MAX_RETRIES ? "FAILED" : "PENDING_SYNC",
    intentos,
    last_attempt_at: Date.now(),
    error_message,
  });
}

export type ReplayResult = {
  synced: number;
  failed: number;
  conflicts: string[];
};

/**
 * Procesa la cola pendiente contra el endpoint /api/sync/replay.
 * Concurrencia limitada a CONCURRENCY_LIMIT (3 en paralelo).
 * Retorna un resumen del replay.
 */
export async function replayQueue(baseUrl = ""): Promise<ReplayResult> {
  const pending = await getPendingItems();
  const result: ReplayResult = { synced: 0, failed: 0, conflicts: [] };

  // Procesa en chunks de CONCURRENCY_LIMIT
  for (let i = 0; i < pending.length; i += CONCURRENCY_LIMIT) {
    const chunk = pending.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.all(chunk.map((item) => processItem(item, baseUrl, result)));
  }

  return result;
}

async function processItem(
  item: SyncQueueItem,
  baseUrl: string,
  result: ReplayResult,
): Promise<void> {
  await markSyncing(item.id_local);

  try {
    const res = await fetch(`${baseUrl}/api/sync/replay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id_local: item.id_local,
        tipo: item.tipo,
        payload: item.payload,
        created_at: item.created_at,
      }),
    });

    if (res.ok) {
      await markSynced(item.id_local);
      result.synced++;
    } else if (res.status === 409) {
      // Conflicto de negocio (ej. indicación ya administrada): va directo a FAILED
      // sin retry — requiere resolución manual.
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const conflictMsg = `Conflicto 409: ${String(body.message ?? "colisión")}`;
      result.conflicts.push(item.id_local);
      // Marcar como FAILED directo (no retryable)
      const db = await getDb();
      const stored = await db.get(STORE.SYNC_QUEUE, item.id_local);
      if (stored) {
        await db.put(STORE.SYNC_QUEUE, {
          ...stored,
          status: "FAILED",
          intentos: MAX_RETRIES, // fuerza FAILED sin más retries
          last_attempt_at: Date.now(),
          error_message: conflictMsg,
        });
      }
      result.failed++;
    } else {
      const text = await res.text().catch(() => `HTTP ${res.status}`);
      await markFailed(item.id_local, text);
      result.failed++;
    }
  } catch (err) {
    await markFailed(item.id_local, err instanceof Error ? err.message : "Error de red");
    result.failed++;
  }
}

/** Reintenta un item FAILED específico. */
export async function retryItem(id_local: string, baseUrl = ""): Promise<void> {
  const db = await getDb();
  const item = await db.get(STORE.SYNC_QUEUE, id_local);
  if (!item) return;

  // Reset intentos para permitir nuevo ciclo de retries
  await db.put(STORE.SYNC_QUEUE, {
    ...item,
    status: "PENDING_SYNC",
    intentos: 0,
    error_message: null,
  });

  const result: ReplayResult = { synced: 0, failed: 0, conflicts: [] };
  await processItem({ ...item, intentos: 0, status: "PENDING_SYNC" }, baseUrl, result);
}

/** Elimina todos los items con status FAILED (acción manual del usuario). */
export async function clearFailedItems(): Promise<void> {
  const failed = await getFailedItems();
  const db = await getDb();
  await Promise.all(failed.map((f) => db.delete(STORE.SYNC_QUEUE, f.id_local)));
}
