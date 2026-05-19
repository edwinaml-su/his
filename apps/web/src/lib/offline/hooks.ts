/**
 * Hooks React para el sistema offline bedside.
 *
 * - `useOnlineStatus()` — estado de conexión reactivo.
 * - `useSyncQueue()` — cola de sync: pending, failed, acciones.
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getOnlineStatus,
  subscribeOnlineStatus,
  getOfflineDurationMs,
  OFFLINE_ALERT_THRESHOLD_MS,
  type OnlineStatus,
} from "./online-status";
import {
  getPendingItems,
  getFailedItems,
  replayQueue,
  retryItem,
  clearFailedItems,
  type ReplayResult,
} from "./sync-queue";
import type { SyncQueueItem } from "./db";

// ─── useOnlineStatus ─────────────────────────────────────────────────────────

export interface OnlineStatusState {
  status: OnlineStatus;
  /** Timestamp (epoch ms) cuando cayó la conexión. null si online. */
  offlineSince: number | null;
  /** true si llevamos > 60 min offline (datos desactualizados). */
  isStale: boolean;
}

export function useOnlineStatus(): OnlineStatusState {
  const [status, setStatus] = useState<OnlineStatus>(getOnlineStatus());
  const [offlineSince, setOfflineSince] = useState<number | null>(
    getOnlineStatus() === "offline" ? Date.now() : null,
  );
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    const unsub = subscribeOnlineStatus((next) => {
      setStatus(next);
      if (next === "offline") {
        setOfflineSince(Date.now());
      } else {
        setOfflineSince(null);
        setIsStale(false);
      }
    });
    return unsub;
  }, []);

  // Actualiza isStale cada minuto cuando offline
  useEffect(() => {
    if (status !== "offline" || offlineSince === null) return;
    const check = () => {
      setIsStale(getOfflineDurationMs(offlineSince) > OFFLINE_ALERT_THRESHOLD_MS);
    };
    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [status, offlineSince]);

  return { status, offlineSince, isStale };
}

// ─── useSyncQueue ────────────────────────────────────────────────────────────

export interface SyncQueueState {
  pending: SyncQueueItem[];
  failed: SyncQueueItem[];
  isReplaying: boolean;
  lastResult: ReplayResult | null;
  /** Dispara replay manual de la cola pendiente. */
  replayAll: () => Promise<void>;
  /** Reintenta un item específico FAILED. */
  retryOne: (id_local: string) => Promise<void>;
  /** Descarta todos los items FAILED. */
  clearFailed: () => Promise<void>;
  /** Refresca los conteos desde IndexedDB. */
  refresh: () => Promise<void>;
}

export function useSyncQueue(): SyncQueueState {
  const [pending, setPending] = useState<SyncQueueItem[]>([]);
  const [failed, setFailed] = useState<SyncQueueItem[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const [lastResult, setLastResult] = useState<ReplayResult | null>(null);

  const refresh = useCallback(async () => {
    const [p, f] = await Promise.all([getPendingItems(), getFailedItems()]);
    setPending(p);
    setFailed(f);
  }, []);

  // Carga inicial
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Escucha mensajes del SW para trigger de sync automático
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const handler = (event: MessageEvent<{ type: string }>) => {
      if (event.data?.type === "BEDSIDE_SYNC_TRIGGER") {
        void refresh();
      }
    };
    navigator.serviceWorker?.addEventListener("message", handler);
    return () => navigator.serviceWorker?.removeEventListener("message", handler);
  }, [refresh]);

  const replayAll = useCallback(async () => {
    setIsReplaying(true);
    try {
      const result = await replayQueue();
      setLastResult(result);
      await refresh();
    } finally {
      setIsReplaying(false);
    }
  }, [refresh]);

  const retryOne = useCallback(async (id_local: string) => {
    await retryItem(id_local);
    await refresh();
  }, [refresh]);

  const clearFailed = useCallback(async () => {
    await clearFailedItems();
    await refresh();
  }, [refresh]);

  // Auto-replay cuando vuelve la conexión
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => {
      void refresh().then(() => {
        void replayAll();
      });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refresh, replayAll]);

  return { pending, failed, isReplaying, lastResult, replayAll, retryOne, clearFailed, refresh };
}
