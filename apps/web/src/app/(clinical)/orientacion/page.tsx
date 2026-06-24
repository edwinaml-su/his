import { Suspense } from "react";
import { OrientacionKiosko } from "@/components/orientacion-kiosko";

/**
 * Ruta /orientacion — Navegación táctil de orientación (kioskos/tablets de admisión).
 *
 * Por defecto (`montaje=embebido`) se renderiza DENTRO del AppShell del grupo
 * (clinical), heredando el sidebar y header del HIS. Para el kiosko físico a
 * pantalla completa, abrir con ?montaje=kiosko&device=kiosk (idealmente bajo un
 * route group sin AppShell).
 *
 * Todos los parámetros son opcionales y se pueden pasar por query string:
 *   ?montaje=embebido|kiosko  ?estilo=claro|inmersivo|senaletica
 *   ?device=tablet|kiosk      ?baseUrl=https://...   ?mostrarRutas=false
 */
export const metadata = { title: "Orientación táctil — HIS Avante" };

export default function OrientacionPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  return (
    <Suspense fallback={null}>
      <OrientacionKiosko
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        montaje={(searchParams.montaje as any) ?? "embebido"}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        estilo={(searchParams.estilo as any) ?? "claro"}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        device={(searchParams.device as any) ?? "tablet"}
        baseUrl={searchParams.baseUrl}
        mostrarRutas={searchParams.mostrarRutas !== "false"}
        triageDestacado={searchParams.triageDestacado !== "false"}
      />
    </Suspense>
  );
}
