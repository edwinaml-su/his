"use client";

import { useEffect } from "react";
import { applyUppercase, isUppercaseTarget } from "@/lib/uppercase";

/**
 * UppercaseEnforcer — fuerza MAYÚSCULAS en todo campo de texto editable.
 *
 * Escucha el evento `input` en fase de CAPTURA a nivel document, antes de que
 * React procese su onChange (bubble). Transforma el valor con el setter nativo
 * del prototipo para que React reciba el onChange ya en mayúsculas. Se monta
 * una sola vez en el layout raíz y no renderiza UI.
 *
 * Exclusiones (ver lib/uppercase): contraseñas, email, url, campos numéricos/
 * fecha, readOnly/disabled y cualquier elemento con [data-no-uppercase].
 */
export function UppercaseEnforcer(): null {
  useEffect(() => {
    function handleInput(e: Event): void {
      // No interferir con composición IME (acentos con teclas muertas, CJK).
      if ((e as InputEvent).isComposing) return;
      if (!isUppercaseTarget(e.target)) return;
      applyUppercase(e.target);
    }

    document.addEventListener("input", handleInput, true);
    return () => document.removeEventListener("input", handleInput, true);
  }, []);

  return null;
}
