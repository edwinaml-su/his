"use client";

import * as React from "react";
import { cn } from "../lib/utils";
import { Input } from "./input";
import { Label } from "./label";

export interface VitalSignField {
  code: string;
  label: string;
  unit?: string;
  required?: boolean;
}

export interface VitalSignValue {
  code: string;
  valueNumeric?: number | null;
  valueText?: string | null;
  unit?: string | null;
}

interface VitalSignsCaptureProps {
  fields?: VitalSignField[];
  value?: VitalSignValue[];
  onChange: (next: VitalSignValue[]) => void;
  className?: string;
}

const DEFAULT_FIELDS: VitalSignField[] = [
  { code: "BP_SYS", label: "PA Sistólica", unit: "mmHg" },
  { code: "BP_DIA", label: "PA Diastólica", unit: "mmHg" },
  { code: "HR", label: "Frecuencia cardíaca", unit: "lpm" },
  { code: "RR", label: "Frecuencia respiratoria", unit: "rpm" },
  { code: "TEMP", label: "Temperatura", unit: "°C" },
  { code: "SPO2", label: "SpO₂", unit: "%" },
  { code: "PAIN", label: "Dolor (EVA 0–10)", unit: "" },
  { code: "GCS", label: "Glasgow", unit: "" },
];

/**
 * Captura de signos vitales (TDR §9.3). Numérico simple con código fijo.
 */
export function VitalSignsCapture({
  fields = DEFAULT_FIELDS,
  value = [],
  onChange,
  className,
}: VitalSignsCaptureProps) {
  const map = React.useMemo(() => new Map(value.map((v) => [v.code, v])), [value]);

  const setValue = (code: string, raw: string, unit?: string) => {
    const num = raw.trim() === "" ? null : Number(raw);
    const next: VitalSignValue = {
      code,
      valueNumeric: Number.isFinite(num) ? num : null,
      unit: unit ?? null,
    };
    const others = value.filter((v) => v.code !== code);
    onChange([...others, next]);
  };

  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4", className)}>
      {fields.map((f) => {
        const current = map.get(f.code);
        return (
          <div key={f.code} className="space-y-1.5">
            <Label htmlFor={`vital-${f.code}`}>
              {f.label}
              {f.required ? <span className="ml-0.5 text-destructive">*</span> : null}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id={`vital-${f.code}`}
                inputMode="decimal"
                type="number"
                step="0.1"
                value={current?.valueNumeric ?? ""}
                onChange={(e) => setValue(f.code, e.target.value, f.unit)}
                className="tabular-nums"
                aria-required={f.required}
              />
              {f.unit ? (
                <span className="text-xs text-muted-foreground">{f.unit}</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
