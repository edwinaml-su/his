"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormError } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";
import {
  computeAlerts,
  maxSeverity,
  type VitalAlert,
  type TriageVitalCode,
} from "@/lib/triage/vital-alerts";

interface VitalsFormProps {
  triageEvaluationId: string;
}

interface FieldDef {
  code: TriageVitalCode;
  label: string;
  unit: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
}

const FIELDS: FieldDef[] = [
  { code: "BP_SYS", label: "PA Sistólica", unit: "mmHg", min: 30, max: 300 },
  { code: "BP_DIA", label: "PA Diastólica", unit: "mmHg", min: 20, max: 220 },
  { code: "HR", label: "Frecuencia cardíaca", unit: "lpm", min: 20, max: 260 },
  { code: "RR", label: "Frecuencia respiratoria", unit: "rpm", min: 4, max: 80 },
  { code: "TEMP", label: "Temperatura", unit: "°C", min: 25, max: 45, step: 0.1 },
  { code: "SPO2", label: "SpO₂", unit: "%", min: 40, max: 100 },
  { code: "GLUCOSE", label: "Glucemia capilar", unit: "mg/dL", min: 10, max: 1200 },
];

export function VitalsForm({ triageEvaluationId }: VitalsFormProps) {
  const router = useRouter();
  const [values, setValues] = React.useState<Partial<Record<TriageVitalCode, string>>>({});

  const numericReadings = React.useMemo(() => {
    return (Object.entries(values) as [TriageVitalCode, string][]).flatMap(([code, raw]) => {
      if (raw == null || raw.trim() === "") return [];
      const n = Number(raw);
      if (!Number.isFinite(n)) return [];
      return [{ vitalCode: code, valueNumeric: n }];
    });
  }, [values]);

  const alerts = React.useMemo(() => computeAlerts(numericReadings), [numericReadings]);

  const record = trpc.triage.recordVitals.useMutation({
    onSuccess: () => {
      // TODO: cuando US-6.4 (discriminadores) llegue, navegar a /triage/[id]/discriminators.
      router.replace(`/triage`);
    },
  });

  const setVal = (code: TriageVitalCode, raw: string) =>
    setValues((p) => ({ ...p, [code]: raw }));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const vitals = (Object.entries(values) as [TriageVitalCode, string][])
      .filter(([, v]) => v != null && v.trim() !== "")
      .map(([code, raw]) => {
        const num = Number(raw);
        const unit =
          FIELDS.find((f) => f.code === code)?.unit ??
          (code === "GCS" || code === "PAIN" ? "" : "");
        return {
          vitalCode: code,
          valueNumeric: Number.isFinite(num) ? num : undefined,
          unit,
        };
      });
    if (vitals.length === 0) return;
    record.mutate({ triageEvaluationId, vitals });
  };

  return (
    <div className="space-y-4">
      <AlertBanner alerts={alerts} />

      <Card>
        <CardHeader>
          <CardTitle>Captura</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={onSubmit}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {FIELDS.map((f) => (
                <div key={f.code} className="space-y-1.5">
                  <Label htmlFor={`vital-${f.code}`}>{f.label}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`vital-${f.code}`}
                      type="number"
                      inputMode="decimal"
                      step={f.step ?? 1}
                      min={f.min}
                      max={f.max}
                      value={values[f.code] ?? ""}
                      onChange={(e) => setVal(f.code, e.target.value)}
                      className="tabular-nums"
                    />
                    <span className="text-xs text-muted-foreground">{f.unit}</span>
                  </div>
                </div>
              ))}

              {/* Glasgow: dropdown 3..15 */}
              <div className="space-y-1.5">
                <Label>Glasgow (GCS)</Label>
                <Select
                  value={values.GCS ?? ""}
                  onValueChange={(v) => setVal("GCS", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="3-15" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 13 }, (_, i) => i + 3).map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Dolor: slider 0..10 */}
              <div className="space-y-1.5">
                <Label htmlFor="vital-PAIN">
                  Dolor (EVA): <span className="font-mono">{values.PAIN ?? "—"}</span>
                </Label>
                <input
                  id="vital-PAIN"
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={values.PAIN ?? "0"}
                  onChange={(e) => setVal("PAIN", e.target.value)}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>0</span>
                  <span>5</span>
                  <span>10</span>
                </div>
              </div>
            </div>

            {record.error && <FormError>{record.error.message}</FormError>}

            <div className="flex gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => router.back()}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={record.isPending || numericReadings.length === 0}
              >
                {record.isPending ? "Guardando…" : "Guardar y continuar"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

function AlertBanner({ alerts }: { alerts: VitalAlert[] }) {
  if (alerts.length === 0) return null;
  const sev = maxSeverity(alerts);
  const tone =
    sev === "CRITICAL"
      ? "border-destructive bg-destructive/10 text-destructive"
      : sev === "WARNING"
      ? "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      : "border-sky-500 bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200";
  return (
    <div
      role="alert"
      aria-live="polite"
      className={`rounded-md border p-3 text-sm ${tone}`}
    >
      <p className="font-semibold">
        {sev === "CRITICAL"
          ? "Alertas críticas detectadas"
          : sev === "WARNING"
          ? "Atención: signos fuera de rango"
          : "Información clínica"}
      </p>
      <ul className="mt-1 list-disc pl-5">
        {alerts.map((a) => (
          <li key={`${a.vitalCode}-${a.severity}`}>
            <span className="font-mono text-xs">[{a.vitalCode}]</span> {a.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
