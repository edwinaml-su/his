"use client";

/**
 * §21 Respiratory — Crear orden respiratoria.
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

type OrderType =
  | "OXYGEN_THERAPY"
  | "MECHANICAL_VENT"
  | "NEBULIZATION"
  | "AEROSOL"
  | "CPAP_BIPAP"
  | "CHEST_PHYSIO";

const TYPE_OPTIONS: { value: OrderType; label: string }[] = [
  { value: "OXYGEN_THERAPY", label: "Oxigenoterapia" },
  { value: "MECHANICAL_VENT", label: "Ventilación mecánica" },
  { value: "NEBULIZATION", label: "Nebulización" },
  { value: "AEROSOL", label: "Aerosol" },
  { value: "CPAP_BIPAP", label: "CPAP/BIPAP" },
  { value: "CHEST_PHYSIO", label: "Fisioterapia torácica" },
];

interface FormState {
  encounterId: string;
  patientId: string;
  prescriberId: string;
  type: OrderType;
  flowRate: string;
  fio2: string;
  notes: string;
}

const INITIAL: FormState = {
  encounterId: "",
  patientId: "",
  prescriberId: "",
  type: "OXYGEN_THERAPY",
  flowRate: "",
  fio2: "",
  notes: "",
};

function validate(f: FormState): string | null {
  if (!f.encounterId.trim()) return "Encuentro requerido.";
  if (!f.patientId.trim()) return "Paciente requerido.";
  if (!f.prescriberId.trim()) return "Prescriptor requerido.";
  if (f.fio2.trim()) {
    const n = Number(f.fio2);
    if (Number.isNaN(n) || n < 21 || n > 100)
      return "FiO₂ debe estar entre 21 y 100.";
  }
  if (f.flowRate.trim()) {
    const n = Number(f.flowRate);
    if (Number.isNaN(n) || n < 0) return "Flujo inválido.";
  }
  return null;
}

export default function NewRespiratoryOrderPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const create = trpc.respiratory.order.create.useMutation({
    onSuccess: () => router.push("/respiratory"),
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
      patientId: form.patientId.trim(),
      prescriberId: form.prescriberId.trim(),
      type: form.type,
      flowRate: form.flowRate.trim() ? Number(form.flowRate) : undefined,
      fio2: form.fio2.trim() ? Number(form.fio2) : undefined,
      notes: form.notes.trim() || undefined,
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;
  const isSubmitting = create.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva orden respiratoria</h1>
        <p className="text-sm text-muted-foreground">
          Prescribe terapia respiratoria para un encuentro activo (§21).
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Datos de la orden</CardTitle>
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
              <Label htmlFor="patientId">Paciente (UUID)</Label>
              <Input
                id="patientId"
                required
                value={form.patientId}
                onChange={(e) => update("patientId", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="prescriberId">Prescriptor (UUID)</Label>
              <Input
                id="prescriberId"
                required
                value={form.prescriberId}
                onChange={(e) => update("prescriberId", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="type">Tipo de orden</Label>
              <Select
                value={form.type}
                onValueChange={(v) => update("type", v as OrderType)}
              >
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              <Label htmlFor="flowRate">Flujo (L/min)</Label>
              <Input
                id="flowRate"
                type="number"
                min={0}
                step="0.1"
                value={form.flowRate}
                onChange={(e) => update("flowRate", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="fio2">FiO₂ (%, 21–100)</Label>
              <Input
                id="fio2"
                type="number"
                min={21}
                max={100}
                step="0.1"
                value={form.fio2}
                onChange={(e) => update("fio2", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="notes">Notas</Label>
              <Input
                id="notes"
                maxLength={4000}
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
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
                {isSubmitting ? "Guardando…" : "Crear orden"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
