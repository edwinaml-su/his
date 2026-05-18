"use client";

/**
 * RecallBanner — banner rojo/amarillo visible cuando recallStatus !== "NONE".
 *
 * WCAG 2.2 AA: role="alert" + aria-live="assertive" para lectores de pantalla.
 */

import { AlertTriangle, AlertCircle } from "lucide-react";

type RecallStatus = "NONE" | "ALERTA" | "RECALL_VOLUNTARIO" | "RECALL_REGULATORIO";

interface RecallBannerProps {
  recallStatus: RecallStatus;
  recallMotivo?: string | null;
  recallFecha?: Date | null;
}

const STATUS_CONFIG: Record<
  Exclude<RecallStatus, "NONE">,
  { label: string; className: string; Icon: typeof AlertTriangle }
> = {
  ALERTA: {
    label: "Alerta de calidad",
    className: "bg-yellow-50 border-yellow-300 text-yellow-800",
    Icon: AlertCircle,
  },
  RECALL_VOLUNTARIO: {
    label: "Recall voluntario",
    className: "bg-orange-50 border-orange-300 text-orange-800",
    Icon: AlertTriangle,
  },
  RECALL_REGULATORIO: {
    label: "Recall regulatorio",
    className: "bg-red-50 border-red-300 text-red-800",
    Icon: AlertTriangle,
  },
};

export function RecallBanner({ recallStatus, recallMotivo, recallFecha }: RecallBannerProps) {
  if (recallStatus === "NONE") return null;

  const config = STATUS_CONFIG[recallStatus];
  const Icon = config.Icon;

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="recall-banner"
      className={`flex items-start gap-3 rounded-md border p-3 text-sm ${config.className}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-semibold">{config.label}</p>
        {recallMotivo && (
          <p className="mt-0.5 text-xs" data-testid="recall-motivo">
            {recallMotivo}
          </p>
        )}
        {recallFecha && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Desde: {new Date(recallFecha).toLocaleDateString("es-SV")}
          </p>
        )}
      </div>
    </div>
  );
}
