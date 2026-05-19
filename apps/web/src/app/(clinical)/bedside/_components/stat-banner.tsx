"use client";

/**
 * StatBanner — Banner rojo global cuando hay sesión STAT activa (US.F2.6.47).
 *
 * Muestra un countdown de segundos restantes.
 * Se cierra automáticamente cuando la sesión se completa o expira.
 * El prop onComplete permite al wizard padre notificar que completó.
 */

import { useEffect, useState } from "react";

interface StatBannerProps {
  statEventId: string;
  motivo: string;
  motivoLibre?: string | null;
  expiraEn: Date;
  onExpired: () => void;
}

export function StatBanner({
  statEventId,
  motivo,
  motivoLibre,
  expiraEn,
  onExpired,
}: StatBannerProps) {
  const [secsLeft, setSecsLeft] = useState(() =>
    Math.max(0, Math.floor((expiraEn.getTime() - Date.now()) / 1000)),
  );

  useEffect(() => {
    if (secsLeft <= 0) { onExpired(); return; }
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiraEn.getTime() - Date.now()) / 1000));
      setSecsLeft(remaining);
      if (remaining === 0) { onExpired(); }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiraEn, onExpired, secsLeft]);

  const mins = Math.floor(secsLeft / 60);
  const secs = secsLeft % 60;
  const label = motivoLibre ?? motivo.replace(/_/g, " ");

  return (
    <div
      role="banner"
      aria-live="polite"
      aria-label="Modo STAT activo"
      className="flex items-center justify-between gap-3 bg-red-600 px-4 py-2 text-white"
      data-testid="stat-banner"
    >
      <div className="flex items-center gap-2">
        <span className="animate-pulse text-lg font-extrabold tracking-wider">
          STAT ACTIVO
        </span>
        <span className="hidden text-sm opacity-90 sm:inline">— {label}</span>
      </div>

      <div className="flex items-center gap-3">
        <span
          className="font-mono text-sm font-semibold tabular-nums"
          aria-label={`Expira en ${mins} minutos ${secs} segundos`}
        >
          {mins}:{secs.toString().padStart(2, "0")}
        </span>
        <span className="hidden font-mono text-xs opacity-70 sm:inline">
          ID:{statEventId.slice(0, 8)}
        </span>
      </div>
    </div>
  );
}
