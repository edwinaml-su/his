"use client";

/**
 * US-4.8 — Antecedentes personales (sub-componente del tab "personal").
 *
 * Cubre: condiciones crónicas, cirugías, medicaciones, hábitos. Las alergias
 * se enlazan por ID a `PatientAllergy` existente — mostramos las alergias
 * activas del paciente para checkbox-link.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { FormField, FormHint } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import type { PersonalHistory } from "@his/contracts";
import { parseDateOnly } from "@/lib/date-only";

export function PersonalHistoryForm({
  value,
  onChange,
  allergies,
}: {
  value: PersonalHistory;
  onChange: (next: PersonalHistory) => void;
  allergies: Array<{ id: string; substanceText: string; severity: string }>;
}) {
  const [chronicDraft, setChronicDraft] = React.useState("");
  const [surgeryDraft, setSurgeryDraft] = React.useState({
    date: "",
    procedure: "",
    notes: "",
  });
  const [medDraft, setMedDraft] = React.useState({
    name: "",
    dose: "",
    chronic: false,
  });

  const toggleAllergy = (id: string) => {
    const has = value.allergyRefs.includes(id);
    onChange({
      ...value,
      allergyRefs: has
        ? value.allergyRefs.filter((x) => x !== id)
        : [...value.allergyRefs, id],
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Antecedentes personales</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Condiciones crónicas */}
        <FormField>
          <Label>Condiciones crónicas</Label>
          <div className="flex gap-2">
            <Input
              value={chronicDraft}
              onChange={(e) => setChronicDraft(e.target.value)}
              placeholder="Ej. Diabetes Mellitus tipo 2"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (!chronicDraft.trim()) return;
                onChange({
                  ...value,
                  chronicConditions: [...value.chronicConditions, chronicDraft.trim()],
                });
                setChronicDraft("");
              }}
            >
              Agregar
            </Button>
          </div>
          <ul className="mt-1 space-y-1">
            {value.chronicConditions.map((c, i) => (
              <li key={i} className="flex items-center justify-between text-sm">
                <span>{c}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onChange({
                      ...value,
                      chronicConditions: value.chronicConditions.filter(
                        (_, idx) => idx !== i,
                      ),
                    })
                  }
                >
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
        </FormField>

        {/* Cirugías */}
        <FormField>
          <Label>Cirugías previas</Label>
          <div className="grid grid-cols-3 gap-2">
            <Input
              type="date"
              value={surgeryDraft.date}
              onChange={(e) =>
                setSurgeryDraft({ ...surgeryDraft, date: e.target.value })
              }
            />
            <Input
              placeholder="Procedimiento"
              value={surgeryDraft.procedure}
              onChange={(e) =>
                setSurgeryDraft({ ...surgeryDraft, procedure: e.target.value })
              }
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (!surgeryDraft.procedure.trim()) return;
                onChange({
                  ...value,
                  surgeries: [
                    ...value.surgeries,
                    {
                      date: parseDateOnly(surgeryDraft.date),
                      procedure: surgeryDraft.procedure.trim(),
                      notes: surgeryDraft.notes || null,
                    },
                  ],
                });
                setSurgeryDraft({ date: "", procedure: "", notes: "" });
              }}
            >
              Agregar
            </Button>
          </div>
          <ul className="mt-1 space-y-1 text-sm">
            {value.surgeries.map((s, i) => (
              <li key={i} className="flex items-center justify-between">
                <span>
                  {s.date ? new Date(s.date).toLocaleDateString("es-SV") : "s/f"}
                  {" · "}
                  {s.procedure}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onChange({
                      ...value,
                      surgeries: value.surgeries.filter((_, idx) => idx !== i),
                    })
                  }
                >
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
        </FormField>

        {/* Alergias (link a PatientAllergy) */}
        <FormField>
          <Label>Alergias relevantes (vincular a registros existentes)</Label>
          <FormHint>
            Las alergias se gestionan en su propia sección. Aquí solo marcamos
            cuáles están relacionadas con la historia clínica.
          </FormHint>
          <div className="space-y-1">
            {allergies.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Sin alergias registradas.
              </p>
            )}
            {allergies.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={value.allergyRefs.includes(a.id)}
                  onChange={() => toggleAllergy(a.id)}
                />
                {a.substanceText}{" "}
                <Badge variant="secondary">{a.severity}</Badge>
              </label>
            ))}
          </div>
        </FormField>

        {/* Medicaciones */}
        <FormField>
          <Label>Medicaciones actuales</Label>
          <div className="grid grid-cols-3 gap-2">
            <Input
              placeholder="Nombre"
              value={medDraft.name}
              onChange={(e) => setMedDraft({ ...medDraft, name: e.target.value })}
            />
            <Input
              placeholder="Dosis"
              value={medDraft.dose}
              onChange={(e) => setMedDraft({ ...medDraft, dose: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={medDraft.chronic}
                onChange={(e) =>
                  setMedDraft({ ...medDraft, chronic: e.target.checked })
                }
              />
              Crónico
            </label>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (!medDraft.name.trim()) return;
              onChange({
                ...value,
                medications: [
                  ...value.medications,
                  {
                    name: medDraft.name.trim(),
                    dose: medDraft.dose || null,
                    chronic: medDraft.chronic,
                  },
                ],
              });
              setMedDraft({ name: "", dose: "", chronic: false });
            }}
          >
            Agregar medicación
          </Button>
          <ul className="mt-1 space-y-1 text-sm">
            {value.medications.map((m, i) => (
              <li key={i} className="flex items-center justify-between">
                <span>
                  {m.name} {m.dose ? `(${m.dose})` : ""}{" "}
                  {m.chronic && <Badge variant="secondary">Crónico</Badge>}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onChange({
                      ...value,
                      medications: value.medications.filter((_, idx) => idx !== i),
                    })
                  }
                >
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
        </FormField>

        {/* Hábitos */}
        <FormField>
          <Label>Hábitos</Label>
          <div className="flex flex-wrap gap-3 text-sm">
            {(["tobacco", "alcohol", "drugs"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={value.habits[k]}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      habits: { ...value.habits, [k]: e.target.checked },
                    })
                  }
                />
                {k === "tobacco" ? "Tabaco" : k === "alcohol" ? "Alcohol" : "Drogas"}
              </label>
            ))}
          </div>
          <Input
            className="mt-1"
            placeholder="Detalle (frecuencia, cantidad)"
            value={value.habits.detail ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                habits: { ...value.habits, detail: e.target.value || null },
              })
            }
          />
        </FormField>
      </CardContent>
    </Card>
  );
}
