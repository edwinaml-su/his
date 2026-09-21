import { Suspense } from "react";
import { OrientacionKiosko } from "@/components/orientacion-kiosko";
import { getTenantContext } from "@/lib/auth/session";
import { prisma } from "@his/database";

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

export default async function OrientacionPage(
  props: {
    searchParams: Promise<Record<string, string | undefined>>;
  }
) {
  const searchParams = await props.searchParams;

  // CC-B — nombre real de la organización para el encabezado del kiosko
  // (antes hardcoded "AVANTE" dentro de OrientacionKiosko). `ctx.tenant` solo
  // trae el id; se resuelve Organization.name en este Server Component, el
  // punto más cercano al origen de datos.
  const tenant = await getTenantContext();
  const organization = tenant
    ? await prisma.organization.findUnique({
        where: { id: tenant.organizationId },
        select: { tradeName: true, legalName: true },
      })
    : null;
  const organizationName = organization
    ? (organization.tradeName ?? organization.legalName)
    : undefined;

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
        organizationName={organizationName}
      />
    </Suspense>
  );
}
