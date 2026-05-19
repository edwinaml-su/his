"use client";

/**
 * RondaToolbar — barra de acciones de la ronda activa.
 * Expone: Pausar / Reanudar / Abandonar ronda.
 * Llama los callbacks del padre; el padre gestiona el estado tRPC.
 */

interface Props {
  pausada: boolean;
  loading: boolean;
  onPausar: () => void;
  onReanudar: () => void;
  onAbandonar: () => void;
}

export function RondaToolbar({ pausada, loading, onPausar, onReanudar, onAbandonar }: Props) {
  return (
    <div className="flex items-center gap-2">
      {pausada ? (
        <button
          onClick={onReanudar}
          disabled={loading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Reanudar ronda
        </button>
      ) : (
        <button
          onClick={onPausar}
          disabled={loading}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
        >
          Pausar ronda
        </button>
      )}
      <button
        onClick={onAbandonar}
        disabled={loading}
        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        Abandonar
      </button>
    </div>
  );
}
