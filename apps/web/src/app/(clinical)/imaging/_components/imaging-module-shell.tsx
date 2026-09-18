"use client";

/**
 * CC-0016 — Shell del módulo: resuelve `cuentaId` desde `?cuentaId=` (patrón
 * `/lis/orders/new`) mostrando `<SelectorCuenta>` cuando falta, y delega el
 * resto a `<ModuloImagenes>`.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SelectorCuenta } from "@/components/selector-cuenta";
import { ModuloImagenes } from "./modulo-imagenes";
import { SupervisionImagenes } from "./supervision-imagenes";

interface ImagingModuleShellProps {
  roleCodes: string[];
}

export function ImagingModuleShell({ roleCodes }: ImagingModuleShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cuentaId = searchParams.get("cuentaId");
  const deepLinkOrderId = searchParams.get("id");
  const vista = searchParams.get("vista");

  // CC-0041 — el tablero de supervisión es de ÁREA (hospitalario y
  // ambulatorio): accesible sin seleccionar cuenta (deep-link de la
  // notificación task.action_required: /imaging?vista=supervision).
  if (!cuentaId && vista === "supervision") {
    return <SupervisionImagenes />;
  }

  if (!cuentaId) {
    return (
      <SelectorCuenta
        titulo="Radiología e Imágenes"
        subtitulo="Seleccione la cuenta del paciente para solicitar estudios de imagen."
        onSelect={(id) => {
          const params = new URLSearchParams({ cuentaId: id });
          if (deepLinkOrderId) params.set("id", deepLinkOrderId);
          router.replace(`/imaging?${params.toString()}`);
        }}
      />
    );
  }

  return (
    <ModuloImagenes cuentaId={cuentaId} roleCodes={roleCodes} deepLinkOrderId={deepLinkOrderId} />
  );
}
