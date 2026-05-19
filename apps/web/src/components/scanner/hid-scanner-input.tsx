"use client";

/**
 * HidScannerInput — componente wrapper que activa el listener de pistola HID global.
 *
 * Normalmente se monta una sola instancia en el layout clínico (bedside).
 * Propaga onScan al hook useHidScanner y notifica al detector de tipo de input.
 *
 * US.F2.6.42
 */

import { useCallback } from "react";
import { useHidScanner } from "@/hooks/use-hid-scanner";
import { useScanInputType } from "@/hooks/use-scan-input-type";

interface HidScannerInputProps {
  onScan: (raw: string) => void;
  enabled?: boolean;
}

/**
 * Componente sin UI visible — solo registra el listener global de teclado.
 * Renderiza null pero tiene efectos de lado.
 */
export function HidScannerInput({ onScan, enabled = true }: HidScannerInputProps) {
  const { notifyHidScan } = useScanInputType({ autoDetect: true });

  const handleScan = useCallback(
    (raw: string) => {
      notifyHidScan();
      onScan(raw);
    },
    [notifyHidScan, onScan],
  );

  useHidScanner({ onScan: handleScan, enabled });

  return null;
}
