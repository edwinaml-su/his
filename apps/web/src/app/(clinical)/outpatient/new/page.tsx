"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormField, FormHint } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

/**
 * §10 Consulta Externa — Formulario de creación de cita.
 *
 * Form mínimo MVP: IDs como text inputs (TODO autocomplete con tRPC
 * `patient.search` / `user.list`). Validación cliente: scheduledAt > now,
 * duración 5..180 min. La validación de negocio definitiva la aplica el
 * router via Zod en `outpatientAppointmentCreateInput`.
 */

interface FormState {
  patientId: string;
  providerId: string;
  establishmentId: string;
  scheduledAt: string;
  durationMinutes: string;
  reason: string;
}

const INITIAL_FORM: FormState = {
  patientId: "",
  providerId: "",
  establishmentId: "",
  scheduledAt: "",
  durationMinutes: "20",
  reason: "",
};

function validate(form: FormState): string | null {
  if (!form.patientId.trim()) return "Paciente es requerido.";
  if (!form.providerId.trim()) return "Proveedor es requerido.";
  if (!form.establishmentId.trim()) return "Establecimiento es requerido.";
  if (!form.scheduledAt) return "Fecha programada es requerida.";

  const scheduled = new Date(form.scheduledAt);
  if (Number.isNaN(scheduled.getTime())) return "Fecha programada inválida.";
  if (scheduled.getTime() <= Date.now())
    return "La fecha programada debe ser futura.";

  const duration = Number(form.durationMinutes);
  if (!Number.isFinite(duration) || duration < 5 || duration > 180)
    return "La duración debe estar entre 5 y 180 minutos.";

  return null;
}

export default function NewOutpatientAppointmentPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const create = trpc.outpatient.appointment.create.useMutation({
    onSuccess: () => {
      router.push("/outpatient");
    },
  });

  const isSubmitting = create.isPending;

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
      patientId: form.patientId.trim(),
      providerId: form.providerId.trim(),
      establishmentId: form.establishmentId.trim(),
      scheduledAt: new Date(form.scheduledAt),
      durationMinutes: Number(form.durationMinutes),
      reason: form.reason.trim() || undefined,
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva cita ambulatoria</h1>
        <p className="text-sm text-muted-foreground">
          Registra una cita para Consulta Externa (§10).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos de la cita</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={onSubmit} noValidate>
            <FormField>
              <Label htmlFor="patientId">Paciente (ID)</Label>
              <Input
                id="patientId"
                name="patientId"
                required
                placeholder="UUID del paciente"
                value={form.patientId}
                onChange={(e) => update("patientId", e.target.value)}
              />
              <FormHint>
                TODO: autocomplete con búsqueda de pacientes (Sprint próximo).
              </FormHint>
            </FormField>

            <FormField>
              <Label htmlFor="providerId">Proveedor (ID de usuario)</Label>
              <Input
                id="providerId"
                name="providerId"
                required
                placeholder="UUID del médico/proveedor"
                value={form.providerId}
                onChange={(e) => update("providerId", e.target.value)}
              />
            </FormField>

            <FormField>
              <Label htmlFor="establishmentId">Establecimiento (ID)</Label>
              <Input
                id="establishmentId"
                name="establishmentId"
                required
                placeholder="UUID del establecimiento"
                value={form.establishmentId}
                onChange={(e) => update("establishmentId", e.target.value)}
              />
            </FormField>

            <FormField>
              <Label htmlFor="scheduledAt">Fecha y hora programada</Label>
              <Input
                id="scheduledAt"
                name="scheduledAt"
                type="datetime-local"
                required
                value={form.scheduledAt}
                onChange={(e) => update("scheduledAt", e.target.value)}
              />
            </FormField>

            <FormField>
              <Label htmlFor="durationMinutes">Duración (minutos)</Label>
              <Input
                id="durationMinutes"
                name="durationMinutes"
                type="number"
                min={5}
                max={180}
                step={5}
                required
                value={form.durationMinutes}
                onChange={(e) => update("durationMinutes", e.target.value)}
              />
              <FormHint>Entre 5 y 180 minutos. Por defecto 20.</FormHint>
            </FormField>

            <FormField>
              <Label htmlFor="reason">Motivo</Label>
              <textarea
                id="reason"
                name="reason"
                rows={3}
                placeholder="Motivo de la consulta (opcional)"
                value={form.reason}
                onChange={(e) => update("reason", e.target.value)}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </FormField>

            {errorMessage && (
              <p
                role="alert"
                aria-live="polite"
                className="text-sm font-medium text-destructive"
              >
                {errorMessage}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={isSubmitting}
                aria-label="Cancelar y volver"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                aria-label="Crear cita ambulatoria"
              >
                {isSubmitting ? "Creando…" : "Crear cita"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
