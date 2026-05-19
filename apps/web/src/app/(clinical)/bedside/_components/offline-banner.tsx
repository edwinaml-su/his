"use client";

/**
 * OfflineBanner — indicador de estado de conexión en la parte superior del módulo bedside.
 *
 * Estados:
 *  - Online:               fondo verde tenue, texto "Online"
 *  - Offline < 60 min:     fondo amarillo, "Sin conexión — N en cola"
 *  - Offline >= 60 min:    fondo rojo, "Sin conexión > 60 min — datos desactualizados"
 *
 * US.F2.6.49
 */

import { useState } from "react";
import { WifiOff, Wifi, AlertTriangle } from "lucide-react";
import { useOnlineStatus } from "@/lib/offline/hooks";
import { useSyncQueue } from "@/lib/offline/hooks";
import { SyncQueueModal } from "./sync-queue-modal";

export function OfflineBanner() {
  const { status, isStale } = useOnlineStatus();
  const { pending, failed } = useSyncQueue();
  const [showModal, setShowModal] = useState(false);

  const pendingCount = pending.length;
  const failedCount = failed.length;
  const totalPending = pendingCount + failedCount;

  if (status === "online" && totalPending === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700"
      >
        <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
        Online
      </div>
    );
  }

  if (status === "online" && totalPending > 0) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          aria-label={`${totalPending} elementos pendientes de sincronización`}
          className="flex items-center gap-2 rounded-md bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
        >
          <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
          Sincronizando — {totalPending} en cola
        </button>
        {showModal && <SyncQueueModal onClose={() => setShowModal(false)} />}
      </>
    );
  }

  if (isStale) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          aria-label="Sin conexión por más de 60 minutos, datos pueden estar desactualizados"
          className="flex items-center gap-2 rounded-md bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-200"
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          Sin conexión &gt; 60 min — datos desactualizados
          {totalPending > 0 && (
            <span className="ml-1 rounded-full bg-red-700 px-1.5 py-0.5 text-white">
              {totalPending}
            </span>
          )}
        </button>
        {showModal && <SyncQueueModal onClose={() => setShowModal(false)} />}
      </>
    );
  }

  // Offline < 60 min
  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        aria-label={`Modo sin conexión, ${totalPending} en cola`}
        className="flex items-center gap-2 rounded-md bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-200"
      >
        <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
        Sin conexión
        {totalPending > 0 && (
          <span className="ml-1 rounded-full bg-amber-700 px-1.5 py-0.5 text-white">
            {totalPending} en cola
          </span>
        )}
      </button>
      {showModal && <SyncQueueModal onClose={() => setShowModal(false)} />}
    </>
  );
}
