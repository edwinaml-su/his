"use client";

/**
 * §12 Emergency — Crear visita a urgencias.
 *
 * Form skeleton MVP. Triage formal queda en §9; aquí sólo registramos la visita.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormField } from "@his/ui/components/form";
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

type ArrivalMode =
  | "WALK_IN"
  | "AMBULANCE"
  | "POLICE"
  | "REFERRAL"
  | "PRIVATE_VEHICLE"
  | "OTHER";

const ARRIVAL_OPTIONS: { value: ArrivalMode; label: string }[] = [
  { value: "WALK_IN", label: "A pie" },
  { value: "AMBULANCE", label: "Ambulancia" },
  { value: "POLICE", label: "Policía" },
  { value: "REFERRAL", label: "Referencia" },
  { value: "PRIVATE_VEHICLE", label: "Vehículo particular" },
  { value: "OTHER", label: "Otro" },
];

interface FormState {
  encounterId: string;
  establishmentId: string;
  patientId: string;
  chiefComplaint: string;
  arrivalMode: ArrivalMode;
}

const INITIAL: FormState = {
  encounterId: "",
  establishmentId: "",
  patientId: "",
  chiefComplaint: "",
  arrivalMode: "WALK_IN",
};

function validate(f: FormState): string | null {
  if (!f.encounterId.trim()) return "Encuentro es requerido.";
  if (!f.establishmentId.trim()) return "Establecimiento es requerido.";
  if (!f.patientId.trim()) return "Paciente es requerido.";
  if (!f.chiefComplaint.trim()) return "Motivo principal es requerido.";
  return null;
}

export default function NewEmergencyVisitPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const create = trpc.emergency.visit.create.useMutation({
    onSuccess: () => router.push("/emergency"),
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate(form);
    if (err) {
      setClientError(err);
      return;
    }
    setClientError(null);
    create.mutate({
      encounterId: form.encounterId.trim(),
      establishmentId: form.establishmentId.trim(),
      patientId: form.patientId.trim(),
      chiefComplaint: form.chiefComplaint.trim(),
      arrivalMode: form.arrivalMode,
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;
  const isSubmitting = create.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva visita a urgencias</h1>
        <p className="text-sm text-muted-foreground">Registra una llegada a urgencias (§12).</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Datos de la visita</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={onSubmit} noValidate>
            <FormField>
              <Label htmlFor="encounterId">Encuentro (UUID)</Label>
              <Input
                id="encounterId"
                required
                value={form.encounterId}
                onChange={(e) => update("encounterId", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="establishmentId">Establecimiento (UUID)</Label>
              <Input
                id="establishmentId"
                required
                value={form.establishmentId}
                onChange={(e) => update("establishmentId", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="patientId">Paciente (UUID)</Label>
              <Input
                id="patientId"
                required
                value={form.patientId}
                onChange={(e) => update("patientId", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="arrivalMode">Modo de llegada</Label>
              <Select
                value={form.arrivalMode}
                onValueChange={(v) => update("arrivalMode", v as ArrivalMode)}
              >
                <SelectTrigger id="arrivalMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ARRIVAL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              <Label htmlFor="chiefComplaint">Motivo principal</Label>
              <Input
                id="chiefComplaint"
                required
                value={form.chiefComplaint}
                onChange={(e) => update("chiefComplaint", e.target.value)}
              />
            </FormField>
            {errorMessage && (
              <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
                {errorMessage}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creando…" : "Registrar visita"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
