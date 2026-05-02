"use client";

/**
 * US-4.4 — Vista lado-a-lado de dos pacientes para selección de fields.
 *
 * Componente controlado: el padre mantiene el estado `fieldsToTake` y
 * lo envía al server en submit. Cada field tiene un par de radios.
 */

import * as React from "react";
import { Badge } from "@his/ui/components/badge";

export type MergeChoice = "from" | "to";

type FieldKey =
  | "mrn"
  | "firstName"
  | "middleName"
  | "lastName"
  | "secondLastName"
  | "preferredName"
  | "birthDate"
  | "biologicalSexId"
  | "genderId"
  | "maritalStatusId"
  | "bloodTypeAbo"
  | "bloodRh";

interface PatientMini {
  id: string;
  mrn: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  secondLastName?: string | null;
  preferredName?: string | null;
  birthDate?: Date | string | null;
  biologicalSex?: { name: string } | null;
  gender?: { name: string } | null;
  maritalStatus?: { name: string } | null;
  bloodTypeAbo?: string | null;
  bloodRh?: string | null;
}

interface FieldDef {
  key: FieldKey;
  label: string;
  /** Cómo extraer el valor visible del paciente. */
  render: (p: PatientMini) => React.ReactNode;
}

const FIELDS: FieldDef[] = [
  { key: "mrn", label: "MRN", render: (p) => <span className="font-mono">{p.mrn}</span> },
  { key: "firstName", label: "Primer nombre", render: (p) => p.firstName },
  { key: "middleName", label: "Segundo nombre", render: (p) => p.middleName ?? "—" },
  { key: "lastName", label: "Primer apellido", render: (p) => p.lastName },
  { key: "secondLastName", label: "Segundo apellido", render: (p) => p.secondLastName ?? "—" },
  { key: "preferredName", label: "Nombre preferido", render: (p) => p.preferredName ?? "—" },
  {
    key: "birthDate",
    label: "Fecha de nacimiento",
    render: (p) =>
      p.birthDate ? new Date(p.birthDate).toLocaleDateString("es-SV") : "—",
  },
  { key: "biologicalSexId", label: "Sexo biológico", render: (p) => p.biologicalSex?.name ?? "—" },
  { key: "genderId", label: "Género", render: (p) => p.gender?.name ?? "—" },
  { key: "maritalStatusId", label: "Estado civil", render: (p) => p.maritalStatus?.name ?? "—" },
  {
    key: "bloodTypeAbo",
    label: "Tipo de sangre (ABO)",
    render: (p) => p.bloodTypeAbo ?? "—",
  },
  { key: "bloodRh", label: "Rh", render: (p) => p.bloodRh ?? "—" },
];

export interface MergeComparisonProps {
  from: PatientMini;
  to: PatientMini;
  value: Partial<Record<FieldKey, MergeChoice>>;
  onChange: (next: Partial<Record<FieldKey, MergeChoice>>) => void;
}

export function MergeComparison({ from, to, value, onChange }: MergeComparisonProps) {
  function setChoice(key: FieldKey, choice: MergeChoice) {
    onChange({ ...value, [key]: choice });
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="grid grid-cols-[180px_1fr_1fr] bg-muted text-xs font-semibold">
        <div className="p-3">Campo</div>
        <div className="border-l p-3">
          From <Badge variant="outline" className="ml-2">se elimina</Badge>
        </div>
        <div className="border-l p-3">
          To <Badge className="ml-2 bg-emerald-600 text-white">superviviente</Badge>
        </div>
      </div>
      <ul className="divide-y text-sm">
        {FIELDS.map((f) => {
          const fromVal = f.render(from);
          const toVal = f.render(to);
          const same =
            React.Children.toArray(fromVal).join("") === React.Children.toArray(toVal).join("");
          const choice = value[f.key] ?? "to";
          return (
            <li key={f.key} className="grid grid-cols-[180px_1fr_1fr] items-center">
              <div className="p-3 text-muted-foreground">{f.label}</div>
              <label
                className={`flex cursor-pointer items-center gap-2 border-l p-3 ${
                  choice === "from" ? "bg-primary/5" : ""
                }`}
              >
                <input
                  type="radio"
                  name={`merge-${f.key}`}
                  value="from"
                  checked={choice === "from"}
                  onChange={() => setChoice(f.key, "from")}
                  disabled={same}
                />
                <span>{fromVal}</span>
              </label>
              <label
                className={`flex cursor-pointer items-center gap-2 border-l p-3 ${
                  choice === "to" ? "bg-primary/5" : ""
                }`}
              >
                <input
                  type="radio"
                  name={`merge-${f.key}`}
                  value="to"
                  checked={choice === "to"}
                  onChange={() => setChoice(f.key, "to")}
                  disabled={same}
                />
                <span>{toVal}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
