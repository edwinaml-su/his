"use client";

/**
 * Barra de contexto del paciente (CC-0006 R3).
 *
 * Muestra — solo lectura — nombre, expediente, sexo, edad y estado de la cuenta
 * hospitalaria tomados del episodio. Sexo/edad alimentan las reglas condicionales
 * de signos vitales (R2: gineco-obstétrico solo si femenino; FPP si edad fértil).
 *
 * Degrada en silencio (no renderiza) mientras no haya contexto de paciente
 * —p. ej. sin episodeId o mientras carga— para no romper la página.
 */

import * as React from "react";
import { Badge } from "@his/ui/components/badge";
import { useEvolucionDraft } from "../_hooks/useEvolucionDraft";

/** Etiqueta legible del sexo biológico. */
function sexoLabel(sexo: string | null): string {
  switch ((sexo ?? "").trim().toUpperCase()) {
    case "M":
      return "Masculino";
    case "F":
      return "Femenino";
    case "I":
      return "Intersexual";
    default:
      return "No especificado";
  }
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{etiqueta}</span>
      <span className="text-sm font-medium text-foreground">{valor}</span>
    </div>
  );
}

export function PacienteContextoBar() {
  const { paciente, pacienteSexo, pacienteEdad } = useEvolucionDraft();

  // Sin contexto (sin episodio o cargando): no renderiza.
  if (!paciente) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/30 px-4 py-3">
      <Dato etiqueta="Paciente" valor={paciente.nombre ?? "—"} />
      <Dato etiqueta="Expediente" valor={<span className="font-mono">{paciente.numeroExpediente}</span>} />
      <Dato etiqueta="Sexo" valor={sexoLabel(pacienteSexo)} />
      <Dato etiqueta="Edad" valor={pacienteEdad != null ? `${pacienteEdad} años` : "—"} />
      <div className="ml-auto">
        {paciente.cuentaActiva ? (
          <Badge className="bg-green-600 text-white hover:bg-green-600">Cuenta activa</Badge>
        ) : (
          <Badge variant="secondary">Cuenta inactiva</Badge>
        )}
      </div>
    </div>
  );
}
