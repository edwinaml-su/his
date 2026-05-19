/**
 * Utilidades de detección online/offline.
 *
 * - `getOnlineStatus()` — snapshot actual de `navigator.onLine`.
 * - `subscribeOnlineStatus()` — callback para cambios online/offline.
 * - `OFFLINE_ALERT_THRESHOLD_MS` — umbral 60 min para bandera "datos desactualizados".
 */

/** Umbral tras el que los datos cacheados se consideran desactualizados (60 min). */
export const OFFLINE_ALERT_THRESHOLD_MS = 60 * 60 * 1000;

export type OnlineStatus = "online" | "offline";

/** Retorna el estado actual. Safe server-side (retorna "online" si no hay navigator). */
export function getOnlineStatus(): OnlineStatus {
  if (typeof navigator === "undefined") return "online";
  return navigator.onLine ? "online" : "offline";
}

type StatusCallback = (status: OnlineStatus) => void;

/**
 * Suscribe a cambios de conectividad.
 * Retorna función de cleanup (para useEffect).
 */
export function subscribeOnlineStatus(callback: StatusCallback): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onOnline = () => callback("online");
  const onOffline = () => callback("offline");

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}

/**
 * Calcula el tiempo (ms) que lleva offline desde `offlineSince`.
 * Retorna 0 si `offlineSince` es null (no está offline).
 */
export function getOfflineDurationMs(offlineSince: number | null): number {
  if (offlineSince === null) return 0;
  return Date.now() - offlineSince;
}
