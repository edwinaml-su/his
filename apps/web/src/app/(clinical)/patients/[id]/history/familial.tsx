"use client";

/**
 * US-4.8 — Antecedentes familiares (sub-componente del tab "familial").
 *
 * Form controlado con shape `FamilialHistory`. Llama `onChange` con la nueva
 * estructura cada vez que el usuario edita; el padre (page.tsx) decide cuándo
 * persistir.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { FormField, FormHint } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import type { FamilialHistory } from "@his/contracts";

export function FamilialHistoryForm({
  value,
  onChange,
}: {
  value: FamilialHistory;
  onChange: (next: FamilialHistory) => void;
}) {
  const setFlag = (k: keyof FamilialHistory, v: boolean) =>
    onChange({ ...value, [k]: v });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Antecedentes familiares</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Checkbox
            label="Diabetes"
            checked={value.diabetes}
            onChange={(v) => setFlag("diabetes", v)}
          />
          <Checkbox
            label="Hipertensión"
            checked={value.hypertension}
            onChange={(v) => setFlag("hypertension", v)}
          />
          <Checkbox
            label="Cardiopatía"
            checked={value.heartDisease}
            onChange={(v) => setFlag("heartDisease", v)}
          />
          <Checkbox
            label="Enfermedad mental"
            checked={value.mentalIllness}
            onChange={(v) => setFlag("mentalIllness", v)}
          />
        </div>

        <FormField>
          <Checkbox
            label="Cáncer en familiar directo"
            checked={value.cancer.present}
            onChange={(v) =>
              onChange({ ...value, cancer: { ...value.cancer, present: v } })
            }
          />
          {value.cancer.present && (
            <Input
              placeholder="Tipo y parentesco"
              value={value.cancer.detail ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  cancer: { ...value.cancer, detail: e.target.value || null },
                })
              }
            />
          )}
        </FormField>

        <FormField>
          <Label>Otros antecedentes familiares</Label>
          <Input
            value={value.other ?? ""}
            onChange={(e) =>
              onChange({ ...value, other: e.target.value || null })
            }
          />
          <FormHint>Texto libre, máx. 800 caracteres.</FormHint>
        </FormField>
      </CardContent>
    </Card>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
