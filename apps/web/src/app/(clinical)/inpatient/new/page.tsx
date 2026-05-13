"use client";

/**
 * §11 Inpatient — Crear admisión hospitalaria.
 *
 * Form skeleton MVP: IDs como text inputs (TODO autocomplete encounter+patient+user).
 * Validación cliente mínima delegada al router via Zod.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormField, FormHint } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

interface FormState {
  encounterId: string;
  establishmentId: string;
  patientId: string;
  attendingId: string;
  reason: string;
  expectedLos: string;
  notes: string;
}

const INITIAL: FormState = {
  encounterId: "",
  establishmentId: "",
  patientId: "",
  attendingId: "",
  reason: "",
  expectedLos: "",
  notes: "",
};

function validate(f: FormState): string | null {
  if (!f.encounterId.trim()) return "Encuentro es requerido.";
  if (!f.establishmentId.trim()) return "Establecimiento es requerido.";
  if (!f.patientId.trim()) return "Paciente es requerido.";
  if (!f.attendingId.trim()) return "Médico tratante es requerido.";
  if (!f.reason.trim()) return "Motivo es requerido.";
  if (f.expectedLos.trim()) {
    const los = Number(f.expectedLos);
    if (!Number.isFinite(los) || los < 1 || los > 365)
      return "Estancia esperada debe estar entre 1 y 365 días.";
  }
  return null;
}

export default function NewInpatientAdmissionPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const create = trpc.inpatient.admission.create.useMutation({
    onSuccess: () => router.push("/inpatient"),
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
      attendingId: form.attendingId.trim(),
      reason: form.reason.trim(),
      expectedLos: form.expectedLos.trim() ? Number(form.expectedLos) : undefined,
      notes: form.notes.trim() || undefined,
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;
  const isSubmitting = create.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva admisión hospitalaria</h1>
        <p className="text-sm text-muted-foreground">
          Registra el inicio de una hospitalización (§11).
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Datos de la admisión</CardTitle>
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
              <FormHint>Encuentro de tipo INPATIENT.</FormHint>
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
              <Label htmlFor="attendingId">Médico tratante (UUID)</Label>
              <Input
                id="attendingId"
                required
                value={form.attendingId}
                onChange={(e) => update("attendingId", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="reason">Motivo de admisión</Label>
              <Input
                id="reason"
                required
                value={form.reason}
                onChange={(e) => update("reason", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="expectedLos">Estancia esperada (días)</Label>
              <Input
                id="expectedLos"
                type="number"
                min={1}
                max={365}
                value={form.expectedLos}
                onChange={(e) => update("expectedLos", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="notes">Notas iniciales (opcional)</Label>
              <textarea
                id="notes"
                rows={3}
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
                {isSubmitting ? "Creando…" : "Crear admisión"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
