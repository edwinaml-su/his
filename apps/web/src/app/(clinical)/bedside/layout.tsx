"use client";

/**
 * Layout de /bedside — monta el listener global de pistola HID.
 *
 * `HidScannerInput` documenta (JSDoc del componente) que "normalmente se
 * monta una sola instancia en el layout clínico (bedside)". Antes de este
 * cambio ningún archivo lo importaba (US.F2.6.42, inventario de componentes
 * huérfanos 2026-08-26, Tier 1).
 *
 * Su único efecto observable hoy es actualizar la preferencia persistida de
 * tipo de escaneo (`useScanInputType` → localStorage "his.scanInputType")
 * cuando detecta un scan de pistola mientras ningún <input> tiene foco — el
 * mismo criterio que `useHidScanner` usa para no competir con el listener
 * propio de `ScanStep` (que sí tiene el input enfocado durante el wizard).
 * No hay backend/target de navegación asociado al scan a nivel de layout
 * (los pacientes/indicaciones no se resuelven por GSRN fuera del wizard) —
 * eso queda documentado como gap, no se fabrica aquí.
 */

import * as React from "react";
import { HidScannerInput } from "@/components/scanner/hid-scanner-input";

export default function BedsideLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <HidScannerInput onScan={() => {}} />
      {children}
    </>
  );
}
