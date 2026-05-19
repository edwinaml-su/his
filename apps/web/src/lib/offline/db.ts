/**
 * IndexedDB schema para el modo offline bedside.
 *
 * Tablas:
 *  - indicaciones_cache   — indicaciones del turno activo del enfermero
 *  - medicamentos_cache   — catálogos GTIN disponibles
 *  - pacientes_cache      — pacientes asignados al turno
 *  - sync_queue           — mutations pendientes de sincronizar con el servidor
 *  - last_sync_timestamp  — timestamps de último sync por tabla
 *
 * TTL 60 min para datos de turno (precache login + refresh cada 15 min).
 * Catálogos GSRN/GTIN/GLN: TTL 8 h (1 turno completo).
 */

import { openDB, type IDBPDatabase } from "idb";

export const DB_NAME = "his_bedside_offline";
export const DB_VERSION = 1;

export const STORE = {
  INDICACIONES: "indicaciones_cache",
  MEDICAMENTOS: "medicamentos_cache",
  PACIENTES: "pacientes_cache",
  SYNC_QUEUE: "sync_queue",
  LAST_SYNC: "last_sync_timestamp",
} as const;

export interface IndicacionCache {
  indicationId: string;
  patientId: string;
  patientGsrn: string | null;
  gtinMedicamento: string | null;
  horaProgramada: number | null; // epoch ms
  status: "PENDING" | "DONE" | "OVERDUE";
  cachedAt: number; // epoch ms
}

export interface MedicamentoCache {
  gtin: string;
  nombre: string;
  presentacion: string | null;
  cachedAt: number;
}

export interface PacienteCache {
  patientId: string;
  gsrn: string | null;
  nombre: string;
  habitacion: string | null;
  cachedAt: number;
}

export type SyncQueueStatus = "PENDING_SYNC" | "SYNCING" | "SYNCED" | "FAILED";

export interface SyncQueueItem {
  /** UUID local generado en el cliente al momento de la mutation offline. */
  id_local: string;
  tipo: "validate5Correctos" | "administrationRecord" | "statOverride";
  payload: unknown;
  intentos: number;
  status: SyncQueueStatus;
  created_at: number; // epoch ms
  last_attempt_at: number | null;
  error_message: string | null;
}

export interface LastSyncEntry {
  tabla: string;
  synced_at: number; // epoch ms
}

export type HisBedsideDB = IDBPDatabase<{
  indicaciones_cache: {
    key: string;
    value: IndicacionCache;
    indexes: { "by-patient": string };
  };
  medicamentos_cache: {
    key: string;
    value: MedicamentoCache;
  };
  pacientes_cache: {
    key: string;
    value: PacienteCache;
  };
  sync_queue: {
    key: string;
    value: SyncQueueItem;
    indexes: { "by-status": string; "by-created-at": number };
  };
  last_sync_timestamp: {
    key: string;
    value: LastSyncEntry;
  };
}>;

// Exportado para poder resetear en tests (no usar en producción)
export let _db: HisBedsideDB | null = null;

export function _resetDbForTests(): void {
  _db = null;
}

export async function getDb(): Promise<HisBedsideDB> {
  if (_db) return _db;

  _db = await openDB<{
    indicaciones_cache: {
      key: string;
      value: IndicacionCache;
      indexes: { "by-patient": string };
    };
    medicamentos_cache: {
      key: string;
      value: MedicamentoCache;
    };
    pacientes_cache: {
      key: string;
      value: PacienteCache;
    };
    sync_queue: {
      key: string;
      value: SyncQueueItem;
      indexes: { "by-status": string; "by-created-at": number };
    };
    last_sync_timestamp: {
      key: string;
      value: LastSyncEntry;
    };
  }>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE.INDICACIONES)) {
        const s = db.createObjectStore(STORE.INDICACIONES, { keyPath: "indicationId" });
        s.createIndex("by-patient", "patientId");
      }
      if (!db.objectStoreNames.contains(STORE.MEDICAMENTOS)) {
        db.createObjectStore(STORE.MEDICAMENTOS, { keyPath: "gtin" });
      }
      if (!db.objectStoreNames.contains(STORE.PACIENTES)) {
        db.createObjectStore(STORE.PACIENTES, { keyPath: "patientId" });
      }
      if (!db.objectStoreNames.contains(STORE.SYNC_QUEUE)) {
        const sq = db.createObjectStore(STORE.SYNC_QUEUE, { keyPath: "id_local" });
        sq.createIndex("by-status", "status");
        sq.createIndex("by-created-at", "created_at");
      }
      if (!db.objectStoreNames.contains(STORE.LAST_SYNC)) {
        db.createObjectStore(STORE.LAST_SYNC, { keyPath: "tabla" });
      }
    },
  });

  return _db;
}

/** Marca el timestamp de último sync para una tabla. */
export async function markSyncTimestamp(tabla: string): Promise<void> {
  const db = await getDb();
  await db.put(STORE.LAST_SYNC, { tabla, synced_at: Date.now() });
}

/** Retorna el timestamp del último sync para una tabla, o null si nunca. */
export async function getLastSyncTimestamp(tabla: string): Promise<number | null> {
  const db = await getDb();
  const entry = await db.get(STORE.LAST_SYNC, tabla);
  return entry?.synced_at ?? null;
}

/** TTL en ms para datos de turno (60 min). */
export const TURNO_TTL_MS = 60 * 60 * 1000;

/** TTL en ms para catálogos GS1 (8 h = 1 turno). */
export const CATALOGO_TTL_MS = 8 * 60 * 60 * 1000;

export function isExpired(cachedAt: number, ttlMs: number): boolean {
  return Date.now() - cachedAt > ttlMs;
}
