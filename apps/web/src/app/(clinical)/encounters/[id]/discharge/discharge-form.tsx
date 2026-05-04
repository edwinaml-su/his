"use client";

/**
 * US-5.5 — Paso 1: tipo de alta + diagnóstico principal CIE-10.
 * (equipo Lima · Sprint 3)
 */
import * as React from "react";
import { Form, FormField, FormError } from "@his/ui/components/form";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

export type DischargeType =
  | "MEDICAL"
  | "VOLUNTARY"
  | "TRANSFER_OUT"
  | "ABSCONDED"
  | "AGAINST_MEDICAL_ADVICE";

export interface DischargeFormState {
  dischargeType: DischargeType;
  primaryDiagnosisCode: string;
  primaryDiagnosisDesc: string;
}

export interface DischargeFormProps {
  value: DischargeFormState;
  onChange: (next: DischargeFormState) => void;
  onCancel: () => void;
  onContinue: () => void;
  error?: string | null;
}

const DISCHARGE_LABEL: Record<DischargeType, string> = {
  MEDICAL: "Médica (resolución del cuadro)",
  VOLUNTARY: "Voluntaria",
  TRANSFER_OUT: "Traslado externo",
  ABSCONDED: "Fuga del paciente",
  AGAINST_MEDICAL_ADVICE: "Contra opinión médica",
};

interface ConceptHit {
  id: string;
  code: string;
  display: string;
}

/**
 * Autocomplete sobre `ClinicalConcept` (CIE-10). Se usa la búsqueda
 * genérica del catálogo cuando exista; mientras tanto, fallback al
 * input libre + persistencia del código tal cual.
 *
 * El equipo de Catálogos (Quito) expondrá `catalog.searchConcepts`
 * en Sprint 3. Hasta que aterrice, dejamos el componente preparado:
 * intenta consultar y si la ruta no existe, degrada a input texto.
 */
function DiagnosisAutocomplete({
  value,
  onChange,
}: {
  value: { code: string; display: string };
  onChange: (next: { code: string; display: string }) => void;
}) {
  const [query, setQuery] = React.useState(value.display);
  const [open, setOpen] = React.useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const search = (trpc as any).catalog?.searchConcepts?.useQuery
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (trpc as any).catalog.searchConcepts.useQuery(
        { codeSystemCode: "CIE-10", query, limit: 10 },
        { enabled: query.trim().length >= 2 },
      )
    : null;

  const hits = (search?.data ?? []) as ConceptHit[];

  return (
    <div className="space-y-2">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Buscar diagnóstico CIE-10 (ej. 'I10' o 'hipertensión')"
      />
      {open && hits.length > 0 ? (
        <ul className="max-h-48 divide-y overflow-auto rounded-md border bg-background">
          {hits.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onChange({ code: c.code, display: c.display });
                  setQuery(`${c.code} — ${c.display}`);
                  setOpen(false);
                }}
              >
                <span>{c.display}</span>
                <Badge variant="outline">{c.code}</Badge>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Si no encuentras el diagnóstico, ingresa el código y descripción
        manualmente abajo (se persistirá tal cual).
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Input
          aria-label="Código CIE-10"
          value={value.code}
          onChange={(e) =>
            onChange({ code: e.target.value, display: value.display })
          }
          placeholder="Código"
          className="col-span-1"
          maxLength={60}
        />
        <Input
          aria-label="Descripción del diagnóstico"
          value={value.display}
          onChange={(e) =>
            onChange({ code: value.code, display: e.target.value })
          }
          placeholder="Descripción"
          className="col-span-2"
          maxLength={400}
        />
      </div>
    </div>
  );
}

export function DischargeForm({
  value,
  onChange,
  onCancel,
  onContinue,
  error,
}: DischargeFormProps) {
  const valid =
    value.primaryDiagnosisCode.trim().length > 0 &&
    value.primaryDiagnosisDesc.trim().length > 0;

  return (
    <Form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onContinue();
      }}
    >
      <FormField>
        <Label>Tipo de alta</Label>
        <Select
          value={value.dischargeType}
          onValueChange={(v) =>
            onChange({ ...value, dischargeType: v as DischargeType })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(DISCHARGE_LABEL) as DischargeType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {DISCHARGE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">
          Las altas por defunción se gestionan desde el flujo de
          Defunción (US-5.6).
        </p>
      </FormField>

      <FormField>
        <Label>Diagnóstico principal (CIE-10)</Label>
        <DiagnosisAutocomplete
          value={{
            code: value.primaryDiagnosisCode,
            display: value.primaryDiagnosisDesc,
          }}
          onChange={(d) =>
            onChange({
              ...value,
              primaryDiagnosisCode: d.code,
              primaryDiagnosisDesc: d.display,
            })
          }
        />
      </FormField>

      <FormError>{error}</FormError>

      <div className="flex justify-between gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!valid}>
          Continuar a epicrisis
        </Button>
      </div>
    </Form>
  );
}
