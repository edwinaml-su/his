"use client";

/**
 * Selector de cuenta inline para la Historia Clínica (CC-0007).
 *
 * Se muestra cuando se entra a /ece/historia-clinica/nueva sin `?cuentaId=`.
 * Envoltorio delgado sobre el componente compartido (CC-0015):
 * apps/web/src/components/selector-cuenta.tsx.
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
      titulo="Nueva Historia Clínica"
      subtitulo="Seleccione la cuenta del paciente para iniciar la historia clínica."
    />
  );
}
