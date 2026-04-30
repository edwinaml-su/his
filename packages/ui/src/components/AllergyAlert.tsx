"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "../lib/utils";

export interface AllergyItem {
  id: string;
  substanceText: string;
  severity: "mild" | "moderate" | "severe" | "life-threatening";
  reaction?: string | null;
}

interface AllergyAlertProps {
  allergies: AllergyItem[];
  className?: string;
}

/**
 * Banner persistente con alergias activas del paciente (TDR §8.1).
 * Diseño coherente con design-system: usa color `--allergy` (no triage red).
 */
export function AllergyAlert({ allergies, className }: AllergyAlertProps) {
  if (allergies.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-success/40 bg-success/5 p-2 text-xs text-success",
          className,
        )}
        role="status"
      >
        Sin alergias conocidas registradas.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border-2 border-allergy bg-allergy/10 p-3 text-allergy",
        className,
      )}
      role="alert"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-bold uppercase tracking-wide">
          Alergias del paciente ({allergies.length})
        </p>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {allergies.map((a) => (
            <li key={a.id} className="flex items-baseline gap-1">
              <span className="font-semibold">{a.substanceText}</span>
              <span className="text-xs uppercase opacity-80">[{a.severity}]</span>
              {a.reaction ? <span className="text-xs">— {a.reaction}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
