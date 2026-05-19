"use client";

/**
 * useScanInputType — detecta si el último scan fue por pistola HID o cámara.
 *
 * Criterio:
 *  - Pistola HID: el string completo llega muy rápido (≤ 20 ms entre caracteres)
 *    + termina con ENTER (keyCode 13).
 *  - Cámara (@zxing/browser): llega como evento onScan del hook de cámara (single event).
 *
 * La preferencia se persiste en localStorage bajo "his.scanInputType".
 *
 * US.F2.6.41
 */

import { useState, useEffect, useCallback } from "react";

export type ScanInputType = "hid" | "camera" | "unknown";

const LS_KEY = "his.scanInputType";

function readPreference(): ScanInputType {
  if (typeof window === "undefined") return "unknown";
  const v = window.localStorage.getItem(LS_KEY);
  if (v === "hid" || v === "camera") return v;
  return "unknown";
}

/**
 * Hook que devuelve el tipo de scanner activo y una función para forzar la preferencia.
 *
 * La detección automática ocurre cuando `autoDetect: true` (default).
 * Se considera pistola cuando la cadena completa de teclado llega en ≤ 20ms/char.
 *
 * @param opts.autoDetect - habilita detección automática por timing. Default true.
 */
export function useScanInputType(opts?: { autoDetect?: boolean }): {
  inputType: ScanInputType;
  setPreference: (type: ScanInputType) => void;
  /** Notificar al hook que se detectó un scan HID (llamado internamente por useHidScanner). */
  notifyHidScan: () => void;
  /** Notificar al hook que se detectó un scan por cámara. */
  notifyCameraScan: () => void;
} {
  const autoDetect = opts?.autoDetect ?? true;
  const [inputType, setInputType] = useState<ScanInputType>(readPreference);

  const setPreference = useCallback((type: ScanInputType) => {
    setInputType(type);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LS_KEY, type);
    }
  }, []);

  const notifyHidScan = useCallback(() => {
    if (autoDetect) setPreference("hid");
  }, [autoDetect, setPreference]);

  const notifyCameraScan = useCallback(() => {
    if (autoDetect) setPreference("camera");
  }, [autoDetect, setPreference]);

  // Sincroniza cuando otra pestaña cambia el localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: StorageEvent) => {
      if (e.key === LS_KEY && (e.newValue === "hid" || e.newValue === "camera")) {
        setInputType(e.newValue as ScanInputType);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return { inputType, setPreference, notifyHidScan, notifyCameraScan };
}
