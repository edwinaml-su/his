"use client";

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

export type AdmissionType =
  | "EMERGENCY"
  | "SCHEDULED"
  | "TRANSFER_IN"
  | "BIRTH"
  | "NEWBORN";

export interface AdmissionFormState {
  admissionType: AdmissionType;
  serviceUnitId: string;
  costCenterId: string;
  currencyId: string;
  isReferral: boolean;
  referralOrigin: string;
  accompanyingPersonName: string;
  chiefComplaint: string;
  valuables: string;
}

export interface AdmissionFormProps {
  value: AdmissionFormState;
  onChange: (next: AdmissionFormState) => void;
  currencies: Array<{ id: string; isoCode: string; name: string }>;
  serviceUnits: Array<{ id: string; code: string; name: string }>;
  costCenters: Array<{ id: string; code: string; name: string }>;
  onBack: () => void;
  onContinue: () => void;
  error?: string | null;
}

const ADMISSION_LABEL: Record<AdmissionType, string> = {
  EMERGENCY: "Emergencia",
  SCHEDULED: "Programada",
  TRANSFER_IN: "Traslado entrante",
  BIRTH: "Parto",
  NEWBORN: "Recién nacido",
};

/**
 * US-5.1 — Paso 2 del wizard. Captura tipo de admisión y datos
 * administrativos comunes a los 5 tipos. Los campos de referencia y
 * acompañante son opcionales y persistirán en Sprint 4 cuando el schema
 * agregue las columnas correspondientes.
 */
export function AdmissionForm({
  value,
  onChange,
  currencies,
  serviceUnits,
  costCenters,
  onBack,
  onContinue,
  error,
}: AdmissionFormProps) {
  const isUnsupportedType =
    value.admissionType === "BIRTH" || value.admissionType === "NEWBORN";

  return (
    <Form
      onSubmit={(e) => {
        e.preventDefault();
        onContinue();
      }}
    >
      <FormField>
        <Label>Tipo de admisión</Label>
        <Select
          value={value.admissionType}
          onValueChange={(v) =>
            onChange({ ...value, admissionType: v as AdmissionType })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ADMISSION_LABEL) as AdmissionType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {ADMISSION_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isUnsupportedType ? (
          <p className="mt-1 text-xs text-warning">
            Parto y recién nacido se habilitan en Sprint 4 (vínculo madre/RN).
          </p>
        ) : null}
      </FormField>

      <FormField>
        <Label>Servicio</Label>
        <Select
          value={value.serviceUnitId}
          onValueChange={(v) => onChange({ ...value, serviceUnitId: v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecciona servicio…" />
          </SelectTrigger>
          <SelectContent>
            {serviceUnits.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.code} — {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField>
        <Label>Centro de costo</Label>
        <Select
          value={value.costCenterId}
          onValueChange={(v) => onChange({ ...value, costCenterId: v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecciona centro de costo…" />
          </SelectTrigger>
          <SelectContent>
            {costCenters.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.code} — {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField>
        <Label>Moneda</Label>
        <Select
          value={value.currencyId}
          onValueChange={(v) => onChange({ ...value, currencyId: v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecciona moneda…" />
          </SelectTrigger>
          <SelectContent>
            {currencies.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.isoCode} — {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField>
        <Label htmlFor="chiefComplaint">Motivo de consulta</Label>
        <Input
          id="chiefComplaint"
          value={value.chiefComplaint}
          onChange={(e) =>
            onChange({ ...value, chiefComplaint: e.target.value })
          }
          placeholder="Ej. dolor torácico, fiebre, control programado"
        />
      </FormField>

      <FormField>
        <Label htmlFor="accompanyingPersonName">Acompañante responsable</Label>
        <Input
          id="accompanyingPersonName"
          value={value.accompanyingPersonName}
          onChange={(e) =>
            onChange({ ...value, accompanyingPersonName: e.target.value })
          }
          placeholder="Nombre y parentesco"
        />
      </FormField>

      <FormField>
        <Label htmlFor="valuables">Valuables / pertenencias (separar por coma)</Label>
        <Input
          id="valuables"
          value={value.valuables}
          onChange={(e) => onChange({ ...value, valuables: e.target.value })}
          placeholder="Anillo, billetera, celular"
        />
      </FormField>

      <FormField>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.isReferral}
            onChange={(e) =>
              onChange({ ...value, isReferral: e.target.checked })
            }
          />
          Referencia desde otro establecimiento
        </label>
        {value.isReferral ? (
          <Input
            className="mt-2"
            value={value.referralOrigin}
            onChange={(e) =>
              onChange({ ...value, referralOrigin: e.target.value })
            }
            placeholder="Establecimiento u origen"
          />
        ) : null}
      </FormField>

      <FormError>{error}</FormError>
      <div className="flex justify-between gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Atrás
        </Button>
        <Button type="submit" disabled={isUnsupportedType}>
          Continuar
        </Button>
      </div>
    </Form>
  );
}
