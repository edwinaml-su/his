"use client";

/**
 * SyncQueueModal — detalle de la cola de sincronización offline.
 *
 * Muestra:
 *  - # pending (PENDING_SYNC) y # failed (FAILED)
 *  - Lista de items con tipo, timestamp y error si falla
 *  - Botón "Reintentar todo" (re-encola todos los FAILED)
 *  - Botón por item "Reintentar" individual
 *  - Botón "Descartar fallidos" (limpia FAILED — acción destructiva, pide confirmación)
 *
 * US.F2.6.49
 */

import { useState } from "react";
import { X, RefreshCw, Trash2, AlertCircle, Clock } from "lucide-react";
import { useSyncQueue } from "@/lib/offline/hooks";
import type { SyncQueueItem } from "@/lib/offline/db";

interface SyncQueueModalProps {
  onClose: () => void;
}

export function SyncQueueModal({ onClose }: SyncQueueModalProps) {
  const { pending, failed, isReplaying, lastResult, replayAll, retryOne, clearFailed } =
    useSyncQueue();
  const [confirmClear, setConfirmClear] = useState(false);

  const handleClearFailed = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    await clearFailed();
    setConfirmClear(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-queue-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 id="sync-queue-modal-title" className="text-base font-semibold text-gray-900">
            Cola de sincronización
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal"
            className="rounded-md p-1 text-gray-400 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Summary */}
        <div className="flex gap-4 border-b px-5 py-3 text-sm">
          <span className="flex items-center gap-1.5 text-amber-700">
            <Clock className="h-4 w-4" />
            <strong>{pending.length}</strong> pendientes
          </span>
          <span className="flex items-center gap-1.5 text-red-700">
            <AlertCircle className="h-4 w-4" />
            <strong>{failed.length}</strong> fallidos
          </span>
        </div>

        {/* Lista */}
        <div className="max-h-72 overflow-y-auto px-5 py-3">
          {pending.length === 0 && failed.length === 0 && (
            <p className="py-4 text-center text-sm text-gray-500">
              No hay elementos en la cola.
            </p>
          )}

          {pending.map((item) => (
            <QueueRow key={item.id_local} item={item} onRetry={retryOne} />
          ))}

          {failed.map((item) => (
            <QueueRow key={item.id_local} item={item} onRetry={retryOne} />
          ))}
        </div>

        {/* Resultado último replay */}
        {lastResult && (
          <div className="border-t px-5 py-2 text-xs text-gray-500">
            Último sync: {lastResult.synced} enviados, {lastResult.failed} fallidos
            {lastResult.conflicts.length > 0 && (
              <span className="ml-2 text-amber-600">
                · {lastResult.conflicts.length} conflictos (revisión manual)
              </span>
            )}
          </div>
        )}

        {/* Acciones */}
        <div className="flex flex-wrap gap-3 border-t px-5 py-4">
          <button
            type="button"
            onClick={() => void replayAll()}
            disabled={isReplaying || pending.length === 0}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isReplaying ? "animate-spin" : ""}`} />
            {isReplaying ? "Sincronizando..." : "Reintentar todo"}
          </button>

          {failed.length > 0 && (
            <button
              type="button"
              onClick={() => void handleClearFailed()}
              className="flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              {confirmClear ? "Confirmar descarte" : "Descartar fallidos"}
            </button>
          )}

          {confirmClear && (
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QueueRow({
  item,
  onRetry,
}: {
  item: SyncQueueItem;
  onRetry: (id: string) => Promise<void>;
}) {
  const time = new Date(item.created_at).toLocaleTimeString("es-SV", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const tipoLabel: Record<SyncQueueItem["tipo"], string> = {
    validate5Correctos: "Validación 5 correctos",
    administrationRecord: "Registro administración",
    statOverride: "Override STAT",
  };

  return (
    <div className="flex items-start justify-between gap-3 border-b py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800">{tipoLabel[item.tipo]}</p>
        <p className="mt-0.5 text-xs text-gray-500">
          {time} · {item.intentos > 0 ? `${item.intentos} intento(s)` : "Pendiente"}
        </p>
        {item.error_message && (
          <p className="mt-0.5 truncate text-xs text-red-600" title={item.error_message}>
            {item.error_message}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            item.status === "FAILED"
              ? "bg-red-100 text-red-700"
              : item.status === "SYNCING"
                ? "bg-blue-100 text-blue-700"
                : "bg-amber-100 text-amber-700"
          }`}
        >
          {item.status === "FAILED"
            ? "Fallido"
            : item.status === "SYNCING"
              ? "Enviando"
              : "Pendiente"}
        </span>
        {item.status === "FAILED" && (
          <button
            type="button"
            onClick={() => void onRetry(item.id_local)}
            aria-label={`Reintentar ${tipoLabel[item.tipo]}`}
            className="rounded-md p-1 text-gray-400 hover:text-blue-600"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
