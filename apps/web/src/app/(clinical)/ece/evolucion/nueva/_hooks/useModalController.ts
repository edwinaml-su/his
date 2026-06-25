"use client";

/**
 * Controlador de modales para la pantalla de evolución SOAP.
 *
 * Modela el modal activo como un estado discreto (discriminated union).
 * Cada sección abre su modal directamente vía `abrir({ tipo })`.
 */

import * as React from "react";

export type ModalActivo =
  | { tipo: "none" }
  | { tipo: "problema"; problemaId?: string }
  | { tipo: "agrupar" }
  | { tipo: "subjetivo" }
  | { tipo: "vitales" }
  | { tipo: "objetivo" }
  | { tipo: "analisis" }
  | { tipo: "plan"; indicacionId?: string };

interface UseModalController {
  modal: ModalActivo;
  abrir: (m: ModalActivo) => void;
  cerrar: () => void;
}

export function useModalController(): UseModalController {
  const [modal, setModal] = React.useState<ModalActivo>({ tipo: "none" });

  function abrir(m: ModalActivo) {
    setModal(m);
  }

  function cerrar() {
    setModal({ tipo: "none" });
  }

  return { modal, abrir, cerrar };
}
