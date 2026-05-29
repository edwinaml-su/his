"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@his/ui/components/tooltip";
import { ToastProvider, ToastViewport } from "@his/ui/components/toast";
import { TRPCProvider } from "@/lib/trpc/react";
import { IdleMonitor } from "@/components/idle-monitor";
import { createSupabaseBrowserClient, safeGetSession } from "@/lib/supabase/client";

/**
 * Hook interno: indica si hay sesión Supabase activa en el cliente.
 *
 * Se usa exclusivamente para activar/desactivar `<IdleMonitor>` (US-2.6).
 * No reemplaza a `getCurrentUser()` server-side — sólo necesitamos un
 * boolean reactivo para no instalar listeners de actividad en /login.
 *
 * Estrategia:
 *   - Initial value via `getSession()` (no bloquea con red porque es cache local).
 *   - Subscribe a `onAuthStateChange` para reaccionar a login/logout sin
 *     forzar reload completo.
 */
function useHasSession(): boolean {
  const [hasSession, setHasSession] = React.useState(false);

  React.useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    // Wrapper resiliente: Safari + _recoverAndRefresh bug → auto-heal limpiando storage.
    void safeGetSession(supabase).then(({ session }) => {
      if (!cancelled) setHasSession(!!session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setHasSession(!!session);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return hasSession;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const hasSession = useHasSession();

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <TRPCProvider>
        <TooltipProvider>
          <ToastProvider>
            {children}
            {/*
             * IdleMonitor (US-2.6): solo activo con sesión. Renderizado
             * dentro de TooltipProvider para que cualquier tooltip futuro
             * dentro del dialog herede config; fuera de ToastViewport para
             * no interferir con stacking de toasts.
             */}
            <IdleMonitor enabled={hasSession} />
            <ToastViewport />
          </ToastProvider>
        </TooltipProvider>
      </TRPCProvider>
    </ThemeProvider>
  );
}
