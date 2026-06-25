"use client";

/**
 * Controlador de modales para la pantalla de evolución SOAP.
 *
 * Modela el modal activo como un estado discreto (discriminated union).
 * El encadenamiento Objetivo⇄Vitales se implementa con un campo `alGuardar`
 * en el estado 'vitales' que se invoca tras guardar signos.
 */

import * as React from "react";

export type ModalActivo =
  | { tipo: "none" }
  | { tipo: "problema"; problemaId?: string }
  | { tipo: "agrupar" }
  | { tipo: "subjetivo" }
  | { tipo: "objetivo" }
  | { tipo: "vitales"; alGuardar?: () => void }
  | { tipo: "analisis" }
  | { tipo: "plan"; indicacionId?: string };

interface UseModalController {
  modal: ModalActivo;
  abrir: (m: ModalActivo) => void;
  cerrar: () => void;
  /**
   * Abre "objetivo": si vitals NO llenos → abre vitales primero con callback
   * para encadenar al objetivo. Si ya llenos → abre objetivo directo.
   */
  abrirObjetivo: (tieneSignos: boolean) => void;
  /**
   * Desde dentro del modal Objetivo: guarda borrador del textarea y reabre vitales.
   */
  modVitals: (objetivoTmp: string, onVuelve: () => void) => void;
}

export function useModalController(): UseModalController {
  const [modal, setModal] = React.useState<ModalActivo>({ tipo: "none" });

  function abrir(m: ModalActivo) {
    setModal(m);
  }

  function cerrar() {
    setModal({ tipo: "none" });
  }

  function abrirObjetivo(tieneSignos: boolean) {
    if (tieneSignos) {
      setModal({ tipo: "objetivo" });
    } else {
      // Abrir vitales; al guardar, encadenar al objetivo
      setModal({ tipo: "vitales", alGuardar: () => setModal({ tipo: "objetivo" }) });
    }
  }

  function modVitals(objetivoTmp: string, onVuelve: () => void) {
    // El callback recibe el tmp para que ObjetivoModal lo restaure
    // al volver; pasamos el setter de vuelta al objetivo via alGuardar
    void objetivoTmp; // el caller mantiene el tmp en su estado local
    setModal({
      tipo: "vitales",
      alGuardar: () => {
        onVuelve();
        setModal({ tipo: "objetivo" });
      },
    });
  }

  return { modal, abrir, cerrar, abrirObjetivo, modVitals };
}
