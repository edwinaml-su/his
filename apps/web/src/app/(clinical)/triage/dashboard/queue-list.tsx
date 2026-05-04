"use client";

/**
 * US-6.6 — Lista (whiteboard) de TriageCards con polling agresivo.
 *
 * Equipo Sierra. El polling de 10s es más agresivo que `bed.getMap` (15s) y
 * `census` (30s) porque triage es time-critical: 1 minuto extra en un RED
 * Manchester es clínicamente significativo. La compensación: el segundero
 * lo anima el cliente, no la red, así que el polling solo refresca el set
 * de items y los counts.
 *
 * Sonido de alarma: cuando un card cruza a CRITICAL, dispara un beep (si el
 * usuario lo activó). Usamos un ref con set de IDs ya alarmados para no
 * repetir el beep en cada refetch (el item sigue siendo CRITICAL en el
 * próximo poll).
 */
import * as React from "react";
import { TriageCard, type TriageCardItem } from "./triage-card";

const ALARM_LS_KEY = "triage-dashboard.alarm-enabled";

interface QueueListProps {
  items: TriageCardItem[];
  serverNow?: Date | string | null;
  alarmEnabled: boolean;
}

/**
 * Beep generado en el cliente con OscillatorNode — sin file en MVP.
 * 800Hz / 200ms / fade-out exponencial para no clipar.
 */
function playBeep() {
  if (typeof window === "undefined") return;
  const W = window as unknown as { AudioContext?: typeof AudioContext };
  const Ctx = W.AudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 800;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.22);
    osc.onended = () => {
      // Cierra el contexto para liberar el audio device en mobile.
      ctx.close().catch(() => undefined);
    };
  } catch {
    // Silently swallow — el alarm es best-effort.
  }
}

export function QueueList({ items, serverNow, alarmEnabled }: QueueListProps) {
  // IDs ya alarmados — evita re-beepear en cada refetch.
  const alarmed = React.useRef<Set<string>>(new Set());

  // Si el item desaparece de la cola (re-triaged, completed) lo limpiamos
  // del set para que un futuro caso del mismo paciente sí beepee.
  React.useEffect(() => {
    const live = new Set(items.map((i) => i.id));
    for (const id of alarmed.current) {
      if (!live.has(id)) alarmed.current.delete(id);
    }
  }, [items]);

  const handleCritical = React.useCallback(
    (id: string) => {
      if (!alarmEnabled) return;
      if (alarmed.current.has(id)) return;
      alarmed.current.add(id);
      playBeep();
    },
    [alarmEnabled],
  );

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No hay pacientes activos en la cola de triage.
        </p>
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      role="list"
      aria-label="Pacientes activos en triage"
    >
      {items.map((item) => (
        <div role="listitem" key={item.id}>
          <TriageCard item={item} serverNow={serverNow} onCritical={handleCritical} />
        </div>
      ))}
    </div>
  );
}

/**
 * Hook con el estado del toggle de alarma persistido en localStorage.
 * El default es `false` — no queremos sorprender al usuario con sonido.
 * Exportado aquí para que el page.tsx lo consuma sin duplicar lógica.
 */
export function useAlarmToggle(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = React.useState(false);
  // Hidratamos desde localStorage solo en cliente para evitar mismatch SSR.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ALARM_LS_KEY);
      if (raw === "1") setEnabled(true);
    } catch {
      // localStorage puede fallar en modo incógnito o iframe sandboxed.
    }
  }, []);
  const update = React.useCallback((next: boolean) => {
    setEnabled(next);
    try {
      window.localStorage.setItem(ALARM_LS_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);
  return [enabled, update];
}
