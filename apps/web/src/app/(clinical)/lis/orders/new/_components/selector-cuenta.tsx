"use client";

/**
 * Selector de cuenta inline para el módulo de escogitación de exámenes de
 * laboratorio (CC-0013). Envoltorio delgado sobre el componente compartido
 * (CC-0015): apps/web/src/components/selector-cuenta.tsx.
 */

import * as React from "react";
import { SelectorCuenta as SelectorCuentaBase } from "@/components/selector-cuenta";

interface SelectorCuentaProps {
  onSelect: (cuentaId: string) => void;
}

export function SelectorCuenta({ onSelect }: SelectorCuentaProps) {
  return (
    <SelectorCuentaBase
      onSelect={onSelect}
      titulo="Nueva orden de laboratorio"
      subtitulo="Seleccione la cuenta del paciente para escoger los exámenes a solicitar."
    />
  );
}
