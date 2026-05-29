"use client";

import * as React from "react";

export type Density = "comfortable" | "compact";

const STORAGE_KEY = "his.density";
const DEFAULT: Density = "comfortable";

/**
 * Hook cliente para leer y cambiar la densidad de la interfaz.
 *
 * Persiste la preferencia en localStorage (key `his.density`) y sincroniza
 * el atributo `data-density` en `<html>` para que los tokens CSS de densidad
 * definidos en globals.css (Tarea 1) surtan efecto globalmente.
 *
 * `mounted` es `false` durante SSR/hidratación — usar para evitar mismatch.
 */
export function useDensity(): {
  density: Density;
  setDensity: (d: Density) => void;
  mounted: boolean;
} {
  const [density, setDensityState] = React.useState<Density>(DEFAULT);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initial: Density = stored === "compact" ? "compact" : DEFAULT;
    setDensityState(initial);
    document.documentElement.setAttribute("data-density", initial);
    setMounted(true);
  }, []);

  const setDensity = React.useCallback((d: Density) => {
    setDensityState(d);
    window.localStorage.setItem(STORAGE_KEY, d);
    document.documentElement.setAttribute("data-density", d);
  }, []);

  return { density, setDensity, mounted };
}
