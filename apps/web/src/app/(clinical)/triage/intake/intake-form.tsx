"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Form, FormField, FormError } from "@his/ui/components/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { PatientSearchBar } from "@his/ui/components/PatientSearchBar";
import { trpc } from "@/lib/trpc/react";

type Mode = "CHOICE" | "EXISTING_PATIENT" | "NN";

/**
 * US-6.1 — formulario de recepción rápida en triage.
 *
 * Estado: 'CHOICE' (dos botones grandes), 'EXISTING_PATIENT' (buscador) o
 * 'NN' (mini form). Submit → triage.quickIntake → toast + redirect al
 * step de signos vitales.
 */
export function IntakeForm() {
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>("CHOICE");

  const intake = trpc.triage.quickIntake.useMutation({
    onSuccess: (res) => {
      // Toast simple (Sonner no está cableado al app-shell aún) +
      // redirección al step de captura de vitales (US-6.2).
      if (typeof window !== "undefined") {
        // eslint-disable-next-line no-alert
        window.alert("Recepción registrada. Continuemos con signos vitales.");
      }
      router.replace(`/triage/${res.triageEvaluationId}/vitals`);
    },
  });

  if (mode === "CHOICE") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Button
          size="lg"
          variant="default"
          className="h-32 flex-col gap-2 text-lg"
          onClick={() => setMode("EXISTING_PATIENT")}
        >
          <span className="text-2xl">Paciente conocido</span>
          <span className="text-xs opacity-80">Buscar por nombre, MRN o documento</span>
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="h-32 flex-col gap-2 text-lg"
          onClick={() => setMode("NN")}
        >
          <span className="text-2xl">Paciente NN</span>
          <span className="text-xs opacity-80">No identificable — registro mínimo</span>
        </Button>
      </div>
    );
  }

  if (mode === "EXISTING_PATIENT") {
    return (
      <ExistingPatientPanel
        onCancel={() => setMode("CHOICE")}
        onConfirm={(patientId) => intake.mutate({ mode: "EXISTING_PATIENT", patientId })}
        loading={intake.isPending}
        error={intake.error?.message}
      />
    );
  }

  return (
    <NNPatientPanel
      onCancel={() => setMode("CHOICE")}
      onConfirm={(nnFields) => intake.mutate({ mode: "NN", nnFields })}
      loading={intake.isPending}
      error={intake.error?.message}
    />
  );
}

interface ExistingPanelProps {
  onCancel: () => void;
  onConfirm: (patientId: string) => void;
  loading: boolean;
  error?: string;
}

function ExistingPatientPanel({ onCancel, onConfirm, loading, error }: ExistingPanelProps) {
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<{ id: string; label: string } | null>(null);

  const search = trpc.patient.search.useQuery(
    { query, limit: 10 },
    { enabled: query.length >= 2 },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Buscar paciente</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <PatientSearchBar onSearch={setQuery} />

        {query.length >= 2 && (
          <div className="rounded-md border">
            {search.isLoading && (
              <p className="p-3 text-sm text-muted-foreground">Buscando…</p>
            )}
            {search.data && search.data.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">Sin resultados.</p>
            )}
            <ul className="divide-y">
              {search.data?.map((p) => {
                const label = `${p.firstName} ${p.lastName} — ${p.mrn}`;
                const isSel = selected?.id === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelected({ id: p.id, label })}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                        isSel ? "bg-muted font-medium" : ""
                      }`}
                    >
                      {label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {selected && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            Seleccionado: <span className="font-medium">{selected.label}</span>
          </div>
        )}

        {error && <FormError>{error}</FormError>}

        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Volver
          </Button>
          <Button
            onClick={() => selected && onConfirm(selected.id)}
            disabled={!selected || loading}
          >
            {loading ? "Registrando…" : "Confirmar y abrir triage"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface NNPanelProps {
  onCancel: () => void;
  onConfirm: (nnFields: {
    estimatedAge?: number;
    sexAtBirthId: string;
    description: string;
  }) => void;
  loading: boolean;
  error?: string;
}

function NNPatientPanel({ onCancel, onConfirm, loading, error }: NNPanelProps) {
  const sexes = trpc.catalog.list.useQuery({ catalog: "biologicalSex", activeOnly: true });
  const [estimatedAge, setEstimatedAge] = React.useState<string>("");
  const [sexAtBirthId, setSexAtBirthId] = React.useState<string>("");
  const [description, setDescription] = React.useState<string>("");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm({
      estimatedAge: estimatedAge ? Number(estimatedAge) : undefined,
      sexAtBirthId,
      description: description.slice(0, 100),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Paciente NN</CardTitle>
      </CardHeader>
      <CardContent>
        <Form onSubmit={onSubmit}>
          <FormField>
            <Label htmlFor="estimatedAge">Edad estimada (años)</Label>
            <Input
              id="estimatedAge"
              type="number"
              inputMode="numeric"
              min={0}
              max={130}
              value={estimatedAge}
              onChange={(e) => setEstimatedAge(e.target.value)}
              placeholder="Ej. 45"
            />
          </FormField>
          <FormField>
            <Label>Sexo biológico</Label>
            <Select value={sexAtBirthId} onValueChange={setSexAtBirthId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona…" />
              </SelectTrigger>
              <SelectContent>
                {sexes.data?.map((s: { id: string; name: string }) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField>
            <Label htmlFor="description">
              Descripción visible <span className="text-xs text-muted-foreground">(máx. 100)</span>
            </Label>
            <Input
              id="description"
              required
              maxLength={100}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Hombre adulto, camisa azul, herida frontal"
            />
            <span className="text-xs text-muted-foreground">{description.length}/100</span>
          </FormField>
          {error && <FormError>{error}</FormError>}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>
              Volver
            </Button>
            <Button
              type="submit"
              disabled={loading || !sexAtBirthId || description.trim().length < 2}
            >
              {loading ? "Registrando…" : "Registrar NN y abrir triage"}
            </Button>
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}
