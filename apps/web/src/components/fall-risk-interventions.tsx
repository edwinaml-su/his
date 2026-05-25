"use client";

/**
 * FallRiskInterventions — US.5.15, JCI Standard: IPSG.6 ME 3.
 *
 * Muestra el protocolo de intervenciones de caídas según puntaje Morse:
 *   Bajo    0-24:   protocolo estándar
 *   Moderado 25-50: pulsera ámbar + baño asistido + barandas
 *   Alto    51-125: pulsera roja + supervisión continua + alarma de cama + monitor de movimiento
 */

import {
  AlertTriangle,
  BedDouble,
  Bell,
  Eye,
  HandHelping,
  Shield,
  ShieldCheck,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type RiskLevel = "bajo" | "moderado" | "alto";

interface Intervention {
  icon: React.ReactNode;
  label: string;
}

// ---------------------------------------------------------------------------
// Lógica de clasificación
// ---------------------------------------------------------------------------

function classifyMorse(score: number): RiskLevel {
  if (score <= 24) return "bajo";
  if (score <= 50) return "moderado";
  return "alto";
}

const RISK_META: Record<
  RiskLevel,
  { label: string; range: string; colorClass: string; badgeClass: string }
> = {
  bajo: {
    label: "Riesgo Bajo",
    range: "0–24",
    colorClass: "text-green-700",
    badgeClass: "bg-green-100 text-green-800 border border-green-300",
  },
  moderado: {
    label: "Riesgo Moderado",
    range: "25–50",
    colorClass: "text-amber-700",
    badgeClass: "bg-amber-100 text-amber-800 border border-amber-300",
  },
  alto: {
    label: "Riesgo Alto",
    range: "51–125",
    colorClass: "text-red-700",
    badgeClass: "bg-red-100 text-red-800 border border-red-300",
  },
};

const INTERVENTIONS: Record<RiskLevel, Intervention[]> = {
  bajo: [
    { icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />, label: "Protocolo estándar de seguridad" },
    { icon: <BedDouble className="h-4 w-4" aria-hidden="true" />, label: "Cama en posición baja con frenos activos" },
    { icon: <Bell className="h-4 w-4" aria-hidden="true" />, label: "Timbre de llamada al alcance del paciente" },
  ],
  moderado: [
    { icon: <Shield className="h-4 w-4 text-amber-600" aria-hidden="true" />, label: "Pulsera identificadora ámbar" },
    { icon: <HandHelping className="h-4 w-4" aria-hidden="true" />, label: "Baño y deambulación asistidos" },
    { icon: <BedDouble className="h-4 w-4" aria-hidden="true" />, label: "Barandas laterales elevadas" },
    { icon: <Bell className="h-4 w-4" aria-hidden="true" />, label: "Timbre de llamada al alcance del paciente" },
  ],
  alto: [
    { icon: <Shield className="h-4 w-4 text-red-600" aria-hidden="true" />, label: "Pulsera identificadora roja" },
    { icon: <Eye className="h-4 w-4" aria-hidden="true" />, label: "Supervisión continua 1:1" },
    { icon: <Bell className="h-4 w-4" aria-hidden="true" />, label: "Alarma de cama activada" },
    { icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />, label: "Monitor de movimiento conectado" },
    { icon: <BedDouble className="h-4 w-4" aria-hidden="true" />, label: "Barandas laterales elevadas" },
    { icon: <HandHelping className="h-4 w-4" aria-hidden="true" />, label: "Traslados y actividades únicamente con personal" },
  ],
};

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

interface FallRiskInterventionsProps {
  morseScore: number;
}

export function FallRiskInterventions({ morseScore }: FallRiskInterventionsProps) {
  const level = classifyMorse(morseScore);
  const meta = RISK_META[level];
  const interventions = INTERVENTIONS[level];

  return (
    <section
      aria-label={`Protocolo de intervenciones: ${meta.label}`}
      className="rounded-lg border bg-white p-4 shadow-sm"
    >
      {/* Encabezado con badge de nivel */}
      <div className="mb-3 flex items-center gap-3">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${meta.badgeClass}`}
          aria-live="polite"
        >
          {meta.label} (Morse {morseScore} — rango {meta.range})
        </span>
      </div>

      {/* Lista de intervenciones */}
      <ul className="space-y-2" role="list" aria-label="Intervenciones requeridas">
        {interventions.map((item) => (
          <li key={item.label} className={`flex items-center gap-2 text-sm ${meta.colorClass}`}>
            {item.icon}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
