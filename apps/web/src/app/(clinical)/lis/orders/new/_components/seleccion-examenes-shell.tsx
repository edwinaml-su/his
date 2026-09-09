"use client";

/**
 * Rediseño lab 2026-09 — envoltorio client-side de `/lis/orders/new`.
 *
 * Separado de `page.tsx` (Server Component) porque `useSearchParams` requiere
 * un Client Component. Resuelve el flujo `?cuentaId=` (SelectorCuenta si no
 * hay cuenta elegida) y pasa `roleCodes` (resuelto server-side) hacia abajo.
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SelectorCuenta } from "./selector-cuenta";
import { SeleccionExamenes } from "./seleccion-examenes";

interface SeleccionExamenesShellProps {
  roleCodes: string[];
}

export function SeleccionExamenesShell({ roleCodes }: SeleccionExamenesShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cuentaId = searchParams.get("cuentaId");

  if (!cuentaId) {
    return <SelectorCuenta onSelect={(id) => router.push(`/lis/orders/new?cuentaId=${id}`)} />;
  }

  return <SeleccionExamenes cuentaId={cuentaId} roleCodes={roleCodes} />;
}
