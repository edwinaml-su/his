"use client";

/**
 * US-5.3 — Formulario para registrar un traslado interno (equipo Lima).
 * Se renderiza dentro del tablero `/transfers` como un dialog/sheet
 * embebido. Para MVP el componente es un panel inline expandible.
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
import { trpc } from "@/lib/trpc/react";

export interface TransferFormProps {
  onCancel: () => void;
  onSuccess: () => void;
}

interface OpenEncounterHit {
  id: string;
  encounterNumber: string;
  patientLabel: string;
  serviceUnitId: string | null;
  serviceUnitName: string | null;
}

/**
 * Form de traslado:
 *   1. Buscar encuentro abierto (autocomplete sobre listOpenByOrg).
 *   2. Seleccionar servicio destino.
 *   3. Seleccionar cama destino opcional (filtrada por servicio).
 *   4. Razón clínica obligatoria.
 *   5. Confirmar → encounterTransfer.transferEncounter.
 */
export function TransferForm({ onCancel, onSuccess }: TransferFormProps) {
  const [search, setSearch] = React.useState("");
  const open = trpc.encounter.listOpenByOrg.useQuery(
    { query: search || undefined, page: 1, pageSize: 10 },
    { enabled: true },
  );
  const [encounter, setEncounter] = React.useState<OpenEncounterHit | null>(
    null,
  );

  const services = trpc.bed.getMap.useQuery();
  const [toServiceUnitId, setToServiceUnitId] = React.useState<string>("");
  const [toBedId, setToBedId] = React.useState<string>("");
  const [reason, setReason] = React.useState("");

  const bedOptions = React.useMemo(() => {
    if (!toServiceUnitId) return [];
    const svc = services.data?.find((s) => s.id === toServiceUnitId);
    if (!svc) return [];
    return svc.beds.filter((b) => b.status === "FREE");
  }, [services.data, toServiceUnitId]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transfer = (trpc as any).encounterTransfer.transferEncounter.useMutation(
    {
      onSuccess: () => onSuccess(),
    },
  );

  function submit() {
    if (!encounter || !toServiceUnitId || reason.trim().length < 2) return;
    transfer.mutate({
      encounterId: encounter.id,
      toServiceUnitId,
      toBedId: toBedId || undefined,
      reason: reason.trim(),
    });
  }

  const sameLocation =
    encounter?.serviceUnitId === toServiceUnitId && !toBedId;

  return (
    <Form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <FormField>
        <Label htmlFor="encQuery">Encuentro a trasladar</Label>
        <Input
          id="encQuery"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por MRN o nombre del paciente"
        />
        <ul className="mt-2 max-h-48 divide-y overflow-auto rounded-md border">
          {open.data?.items.map((e) => {
            const label = `${e.patient.firstName} ${e.patient.lastName} · MRN ${e.patient.mrn}`;
            const selected = encounter?.id === e.id;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted ${
                    selected ? "bg-muted" : ""
                  }`}
                  onClick={() =>
                    setEncounter({
                      id: e.id,
                      encounterNumber: e.encounterNumber,
                      patientLabel: label,
                      serviceUnitId: e.serviceUnit?.id ?? null,
                      serviceUnitName: e.serviceUnit?.name ?? null,
                    })
                  }
                >
                  <span>
                    <span className="font-semibold">{e.encounterNumber}</span>
                    <span className="ml-2 text-muted-foreground">{label}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.serviceUnit?.name ?? "Sin servicio"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </FormField>

      <FormField>
        <Label>Servicio destino</Label>
        <Select value={toServiceUnitId} onValueChange={setToServiceUnitId}>
          <SelectTrigger>
            <SelectValue placeholder="Selecciona servicio…" />
          </SelectTrigger>
          <SelectContent>
            {services.data?.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.code} — {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField>
        <Label>Cama destino (opcional)</Label>
        <Select
          value={toBedId}
          onValueChange={setToBedId}
          disabled={!toServiceUnitId || bedOptions.length === 0}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                toServiceUnitId
                  ? bedOptions.length === 0
                    ? "Sin camas FREE en este servicio"
                    : "Selecciona cama…"
                  : "Selecciona servicio primero"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {bedOptions.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField>
        <Label htmlFor="reason">Razón clínica</Label>
        <Input
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej. requiere monitoreo en UCI"
          maxLength={200}
        />
      </FormField>

      <FormError>
        {transfer.error?.message ??
          (sameLocation
            ? "El destino coincide con la ubicación actual."
            : null)}
      </FormError>

      <div className="flex justify-between gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={
            !encounter ||
            !toServiceUnitId ||
            reason.trim().length < 2 ||
            transfer.isPending ||
            sameLocation
          }
        >
          {transfer.isPending ? "Trasladando…" : "Confirmar traslado"}
        </Button>
      </div>
    </Form>
  );
}
