"use client";

/**
 * <IdleMonitor /> — US-2.6 (Sprint 1, MVP).
 *
 * Detecta inactividad client-side y cierra sesión transcurridos
 * IDLE_TIMEOUT_MS sin actividad. Un minuto antes muestra un Dialog con
 * countdown y botón "Continuar sesión" que reinicia el timer.
 *
 * Diseño:
 *   - Eventos escuchados: mousemove / keydown / click / scroll.
 *   - Throttle de 5s sobre el handler de actividad: evita resetear el
 *     timer 60 veces por segundo durante un mousemove. La granularidad
 *     de 5s es invisible para el usuario contra un timeout de 15min.
 *   - Dos timers escalonados: warningTimer (14 min) → logoutTimer (1 min).
 *     Cada actividad reinicia ambos.
 *   - El dialog tiene su propio interval (1s) para el countdown visual;
 *     vive sólo mientras el dialog está abierto.
 *   - `enabled` permite montarlo siempre (en Providers) pero desactivarlo
 *     en rutas públicas (login, /api callbacks). Cuando enabled=false el
 *     componente no registra listeners ni timers — coste cero.
 *
 * Cleanup:
 *   - useEffect remueve listeners y limpia los tres timers en su return.
 *   - Re-monta limpio si `enabled` o `onTimeout` cambian.
 *
 * NO server-side revocation — eso es stub en revoke-session.ts (Sprint 2).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@his/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  ACTIVITY_EVENTS,
  ACTIVITY_THROTTLE_MS,
  IDLE_LOGOUT_REASON,
  IDLE_TIMEOUT_MS,
  WARNING_BEFORE_LOGOUT_MS,
  formatRemainingTime,
} from "@/lib/auth/session-policy";

export interface IdleMonitorProps {
  /**
   * Si `false`, el monitor no registra listeners ni timers.
   * El caller (Providers) lo pone en `true` sólo cuando hay sesión.
   */
  enabled: boolean;
}

export function IdleMonitor({ enabled }: IdleMonitorProps) {
  const router = useRouter();
  const [warningOpen, setWarningOpen] = React.useState(false);
  const [remainingMs, setRemainingMs] = React.useState(WARNING_BEFORE_LOGOUT_MS);

  // Refs en lugar de state para timers / throttle: cambiarlos no debe
  // disparar re-render ni re-suscribir listeners.
  const warningTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = React.useRef<number>(Date.now());

  /**
   * signOut + redirect al login con `reason=idle`. Encapsulada en ref-stable
   * via useCallback porque la usan tanto el logoutTimer como el countdown
   * cuando llega a 0.
   */
  const performLogout = React.useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch (err) {
      // Si signOut falla (red caída) igual redirigimos: el middleware del
      // siguiente request va a forzar re-login. No bloquear UX.
      console.error("[IdleMonitor] signOut error", err);
    }
    router.replace(`/login?reason=${IDLE_LOGOUT_REASON}`);
  }, [router]);

  /** Limpia todos los timers — usado en cleanup y en cada reset. */
  const clearAllTimers = React.useCallback(() => {
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  /**
   * Resetea el ciclo idle: cierra el dialog si estaba abierto, programa
   * warning a (IDLE - WARNING) y logout a IDLE desde ahora.
   */
  const resetIdleCycle = React.useCallback(() => {
    clearAllTimers();
    setWarningOpen(false);
    setRemainingMs(WARNING_BEFORE_LOGOUT_MS);

    const warningDelay = IDLE_TIMEOUT_MS - WARNING_BEFORE_LOGOUT_MS;
    warningTimerRef.current = setTimeout(() => {
      // Mostrar dialog y arrancar countdown visual.
      setWarningOpen(true);
      setRemainingMs(WARNING_BEFORE_LOGOUT_MS);

      const startedAt = Date.now();
      countdownIntervalRef.current = setInterval(() => {
        const left = WARNING_BEFORE_LOGOUT_MS - (Date.now() - startedAt);
        setRemainingMs(left > 0 ? left : 0);
      }, 1_000);

      logoutTimerRef.current = setTimeout(() => {
        void performLogout();
      }, WARNING_BEFORE_LOGOUT_MS);
    }, warningDelay);
  }, [clearAllTimers, performLogout]);

  /** Handler "Continuar sesión" — equivale a actividad explícita. */
  const handleContinue = React.useCallback(() => {
    lastActivityRef.current = Date.now();
    resetIdleCycle();
  }, [resetIdleCycle]);

  React.useEffect(() => {
    if (!enabled) {
      clearAllTimers();
      return;
    }

    // Throttle manual: ignoramos eventos a menos de ACTIVITY_THROTTLE_MS
    // del último reset. Mientras el dialog está abierto NO reseteamos por
    // mousemove — el usuario tiene que pulsar "Continuar sesión"
    // explícitamente, si no el aviso pierde sentido.
    const onActivity = () => {
      if (warningOpen) return;
      const now = Date.now();
      if (now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) return;
      lastActivityRef.current = now;
      resetIdleCycle();
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }
    resetIdleCycle();

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity);
      }
      clearAllTimers();
    };
  }, [enabled, warningOpen, resetIdleCycle, clearAllTimers]);

  if (!enabled) return null;

  return (
    <Dialog
      open={warningOpen}
      onOpenChange={(open) => {
        // Cerrar el dialog (X o ESC) cuenta como "Continuar sesión":
        // el usuario está interactuando, no queremos echarle.
        if (!open) handleContinue();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tu sesión expirará en 1 minuto</DialogTitle>
          <DialogDescription>
            Por seguridad cerraremos tu sesión por inactividad en{" "}
            <span className="font-mono font-semibold tabular-nums">
              {formatRemainingTime(remainingMs)}
            </span>
            . Pulsa &quot;Continuar sesión&quot; para seguir trabajando.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => void performLogout()}>
            Cerrar sesión ahora
          </Button>
          <Button onClick={handleContinue}>Continuar sesión</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
