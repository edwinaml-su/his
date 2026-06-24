"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Umbral (px) para considerar el equipo "tablet/kiosko". Tunable.
 * 1024 = ancho típico de tablet (iPad portrait); combinado con pointer:coarse
 * capta también tablets en horizontal (iPad Pro landscape) sin atrapar laptops.
 */
const TABLET_MAX_PX = 1024;

/**
 * Redirección de landing para tablets / kioskos de admisión.
 *
 * Se monta SOLO en /dashboard (el destino post-login de login/SSO/MFA). En
 * equipos táctiles o de pantalla chica reemplaza la navegación por la vista de
 * orientación en modo kiosko full-screen. En workstations (desktop con mouse)
 * no hace nada — ahí la orientación queda como ítem fijado del sidebar.
 *
 * Detección por tamaño de pantalla (decisión del usuario): `max-width:1024px`
 * O `pointer:coarse` (pantalla táctil). El tradeoff aceptado es que un iPad de
 * personal clínico arranca en kiosko hasta tocar "Menú normal".
 *
 * El botón "Menú normal" del kiosko vuelve con `?vista=completa`, que aquí
 * desactiva el redirect — así el escape funciona sin loop. No se persiste: un
 * reload de /dashboard vuelve a kiosko, acorde a "por tamaño de pantalla".
 */
export function KioskAutoRedirect() {
  const router = useRouter();

  React.useEffect(() => {
    // Escape explícito desde el botón "Menú normal".
    const params = new URLSearchParams(window.location.search);
    if (params.get("vista") === "completa") return;

    const esTactilOChico =
      window.matchMedia(`(max-width: ${TABLET_MAX_PX}px)`).matches ||
      window.matchMedia("(pointer: coarse)").matches;

    if (esTactilOChico) {
      router.replace("/orientacion?montaje=kiosko");
    }
  }, [router]);

  return null;
}

export default KioskAutoRedirect;
