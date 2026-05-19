"use client";

/**
 * useHidScanner — captura input de pistola USB HID a nivel global.
 *
 * Estrategia:
 *  - Escucha `keydown` a nivel `window`.
 *  - Acumula caracteres en un buffer.
 *  - Cuando llega ENTER: despacha el buffer como scan si tiene ≥ 4 chars.
 *  - Debounce de 100ms: si no llega ENTER en 100ms → descarta buffer (no es pistola).
 *  - Detección de velocidad: si el intervalo entre `keydown` consecutivos > 20ms
 *    → no es pistola (es teclado humano) → descarta.
 *
 * Compatibilidad probada: Zebra DS2278, DS4308, DS9908.
 *
 * US.F2.6.41, US.F2.6.42
 */

import { useEffect, useRef, useCallback } from "react";

const MIN_SCAN_LENGTH   = 4;    // longitud mínima para considerar scan válido
const MAX_CHAR_INTERVAL = 20;   // ms máximos entre chars (pistola vs teclado)
const DEBOUNCE_MS       = 100;  // reset buffer si no llega ENTER en este tiempo

interface UseHidScannerOptions {
  onScan: (raw: string) => void;
  /** Si false, el listener no se activa. Útil para deshabilitar cuando la cámara está activa. */
  enabled?: boolean;
}

export function useHidScanner({ onScan, enabled = true }: UseHidScannerOptions): void {
  const bufferRef      = useRef<string>("");
  const lastKeyTimeRef = useRef<number>(0);
  const debounceTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    const scan = bufferRef.current;
    bufferRef.current = "";
    if (scan.length >= MIN_SCAN_LENGTH) {
      onScan(scan);
    }
  }, [onScan]);

  const resetBuffer = useCallback(() => {
    bufferRef.current = "";
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // Ignorar cuando el foco está en un input/textarea (el usuario está escribiendo)
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      const now = Date.now();

      if (e.key === "Enter") {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        flush();
        return;
      }

      // Verificar velocidad: si tarda más de MAX_CHAR_INTERVAL → reset (es teclado humano)
      if (bufferRef.current.length > 0 && now - lastKeyTimeRef.current > MAX_CHAR_INTERVAL) {
        resetBuffer();
      }

      lastKeyTimeRef.current = now;

      // Acumular solo caracteres imprimibles de un solo carácter
      if (e.key.length === 1) {
        bufferRef.current += e.key;

        // Reiniciar debounce (pistola sin ENTER final)
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(resetBuffer, DEBOUNCE_MS);
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [enabled, flush, resetBuffer]);
}
