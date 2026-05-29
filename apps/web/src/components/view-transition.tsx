"use client";

import * as React from "react";

/**
 * ViewTransition — wrapper opcional para habilitar animaciones de la
 * View Transitions API en cambios de contenido dentro de una ruta.
 *
 * Next.js habilita las transiciones de RUTA vía `experimental.viewTransition`
 * en next.config.mjs (Tarea 8). Este componente es para transiciones
 * INTRA-página (ej. cambio de tab, apertura de panel) usando la misma API.
 *
 * Degradación elegante: si el browser no soporta `startViewTransition`,
 * el callback se ejecuta directamente sin animación.
 *
 * Restricción §3: `prefers-reduced-motion` desactiva las animaciones CSS
 * vía la regla en globals.css — no requiere JS adicional.
 *
 * Uso:
 *   const { startTransition } = useViewTransition();
 *   startTransition(() => setState(newValue));
 */

interface ViewTransitionContextValue {
  /** Envuelve una mutación de estado en una View Transition si está disponible. */
  startTransition: (callback: () => void) => void;
}

const ViewTransitionContext = React.createContext<ViewTransitionContextValue>({
  startTransition: (cb) => cb(),
});

export function ViewTransitionProvider({ children }: { children: React.ReactNode }) {
  const startTransition = React.useCallback((callback: () => void) => {
    if (typeof document !== "undefined" && "startViewTransition" in document) {
      (document as Document & { startViewTransition: (cb: () => void) => void })
        .startViewTransition(callback);
    } else {
      callback();
    }
  }, []);

  return (
    <ViewTransitionContext.Provider value={{ startTransition }}>
      {children}
    </ViewTransitionContext.Provider>
  );
}

export function useViewTransition(): ViewTransitionContextValue {
  return React.useContext(ViewTransitionContext);
}
