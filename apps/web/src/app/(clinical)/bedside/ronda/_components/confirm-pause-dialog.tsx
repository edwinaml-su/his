"use client";

/**
 * ConfirmPauseDialog — diálogo de confirmación antes de pausar la ronda.
 * Simple modal nativo sin dependencias de shadcn para mantener bundle pequeño.
 */

interface Props {
  open: boolean;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmPauseDialog({ open, loading, onConfirm, onCancel }: Props) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="pause-dialog-title" className="text-base font-semibold text-gray-900">
          Pausar ronda
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          El progreso se guardara automaticamente. Podra reanudar desde el punto actual.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {loading ? "Pausando..." : "Pausar ronda"}
          </button>
        </div>
      </div>
    </div>
  );
}
