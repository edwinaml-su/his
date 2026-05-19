"use client";

/**
 * US-4.8 — Antecedentes gineco-obstétricos.
 *
 * Solo aplica a pacientes con biologicalSex = F (validación duplicada en router).
 * Captura GPAC, FUM, ciclo, método anticonceptivo.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { FormField, FormHint } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import type { GynecoHistory } from "@his/contracts";
import { parseDateOnly } from "@/lib/date-only";

const CYCLE_OPTIONS: Array<{ value: NonNullable<GynecoHistory["cycle"]>; label: string }> = [
  { value: "regular", label: "Regular" },
  { value: "irregular", label: "Irregular" },
  { value: "amenorrhea", label: "Amenorrea" },
  { value: "menopause", label: "Menopausia" },
];

const METHOD_OPTIONS: Array<{
  value: NonNullable<GynecoHistory["contraceptiveMethod"]>;
  label: string;
}> = [
  { value: "none", label: "Ninguno" },
  { value: "oral", label: "Oral" },
  { value: "iud", label: "DIU" },
  { value: "injection", label: "Inyección" },
  { value: "barrier", label: "Barrera" },
  { value: "implant", label: "Implante" },
  { value: "tubal", label: "Ligadura" },
  { value: "other", label: "Otro" },
];

export function GynecoHistoryForm({
  value,
  onChange,
}: {
  value: GynecoHistory;
  onChange: (next: GynecoHistory) => void;
}) {
  const gpacWarning =
    value.gpac.P + value.gpac.A + value.gpac.C > value.gpac.G
      ? "Suma P+A+C > G — verifica la captura."
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gineco-obstétricos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <FormField>
            <Label>Edad menarquia</Label>
            <Input
              type="number"
              min={7}
              max={20}
              value={value.menarcheAge ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  menarcheAge: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </FormField>
          <FormField>
            <Label>Ciclo</Label>
            <Select
              value={value.cycle ?? ""}
              onValueChange={(v) =>
                onChange({
                  ...value,
                  cycle: v as GynecoHistory["cycle"],
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {CYCLE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField>
            <Label>FUM (última menstruación)</Label>
            <Input
              type="date"
              value={
                value.lastPeriod
                  ? new Date(value.lastPeriod).toISOString().slice(0, 10)
                  : ""
              }
              onChange={(e) =>
                onChange({
                  ...value,
                  lastPeriod: parseDateOnly(e.target.value),
                })
              }
            />
          </FormField>
        </div>

        <FormField>
          <Label>GPAC</Label>
          <div className="grid grid-cols-4 gap-2">
            {(["G", "P", "A", "C"] as const).map((k) => (
              <FormField key={k}>
                <Label>{k}</Label>
                <Input
                  type="number"
                  min={0}
                  max={30}
                  value={value.gpac[k]}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      gpac: { ...value.gpac, [k]: Number(e.target.value || 0) },
                    })
                  }
                />
              </FormField>
            ))}
          </div>
          <FormHint>G=gestaciones, P=partos, A=abortos, C=cesáreas.</FormHint>
          {gpacWarning && (
            <p className="text-xs text-amber-600">{gpacWarning}</p>
          )}
        </FormField>

        <FormField>
          <Label>Método anticonceptivo</Label>
          <Select
            value={value.contraceptiveMethod ?? ""}
            onValueChange={(v) =>
              onChange({
                ...value,
                contraceptiveMethod: v as GynecoHistory["contraceptiveMethod"],
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {METHOD_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField>
          <Label>Notas</Label>
          <Input
            value={value.notes ?? ""}
            onChange={(e) =>
              onChange({ ...value, notes: e.target.value || null })
            }
          />
        </FormField>
      </CardContent>
    </Card>
  );
}
