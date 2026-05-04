"use client";

/**
 * US-4.8 — Antecedentes pediátricos.
 *
 * Aplicable a pacientes en edad pediátrica (criterio típico ≤14 años, validado
 * en el padre). Captura edad gestacional, peso al nacer, lactancia, hitos.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { FormField, FormHint } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import type { PediatricHistory } from "@his/contracts";

export function PediatricHistoryForm({
  value,
  onChange,
}: {
  value: PediatricHistory;
  onChange: (next: PediatricHistory) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Antecedentes pediátricos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField>
            <Label>Edad gestacional (semanas)</Label>
            <Input
              type="number"
              min={20}
              max={45}
              value={value.gestationalAgeWeeks ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  gestationalAgeWeeks: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
            />
          </FormField>
          <FormField>
            <Label>Peso al nacer (g)</Label>
            <Input
              type="number"
              min={200}
              max={8000}
              value={value.birthWeightGrams ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  birthWeightGrams: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
            />
          </FormField>
        </div>

        <FormField>
          <Label>Lactancia materna</Label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.breastfeeding.given}
              onChange={(e) =>
                onChange({
                  ...value,
                  breastfeeding: {
                    ...value.breastfeeding,
                    given: e.target.checked,
                  },
                })
              }
            />
            Recibió lactancia materna
          </label>
          {value.breastfeeding.given && (
            <div className="grid grid-cols-2 gap-3">
              <FormField>
                <Label>Meses totales</Label>
                <Input
                  type="number"
                  min={0}
                  max={36}
                  value={value.breastfeeding.months ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      breastfeeding: {
                        ...value.breastfeeding,
                        months: e.target.value ? Number(e.target.value) : null,
                      },
                    })
                  }
                />
              </FormField>
              <FormField>
                <Label>Meses exclusiva</Label>
                <Input
                  type="number"
                  min={0}
                  max={12}
                  value={value.breastfeeding.exclusiveMonths ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      breastfeeding: {
                        ...value.breastfeeding,
                        exclusiveMonths: e.target.value
                          ? Number(e.target.value)
                          : null,
                      },
                    })
                  }
                />
              </FormField>
            </div>
          )}
        </FormField>

        <FormField>
          <Label>Hitos del desarrollo</Label>
          <Input
            value={value.milestones ?? ""}
            onChange={(e) =>
              onChange({ ...value, milestones: e.target.value || null })
            }
          />
          <FormHint>
            Camina, primeras palabras, control de esfínteres, etc.
          </FormHint>
        </FormField>

        <FormField>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.immunizationsUpToDate}
              onChange={(e) =>
                onChange({
                  ...value,
                  immunizationsUpToDate: e.target.checked,
                })
              }
            />
            Esquema de vacunación al día
          </label>
        </FormField>
      </CardContent>
    </Card>
  );
}
