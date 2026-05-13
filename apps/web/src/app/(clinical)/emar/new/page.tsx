"use client";

/**
 * §16 eMAR — Registrar administración de medicamento.
 *
 * Form skeleton MVP. BCMA real (escaneo de barcode + cross-check con wristband)
 * llega en iteración futura; aquí permitimos marcar el flag declarativamente.
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

type MedAdminStatus =
  | "GIVEN"
  | "HELD"
  | "REFUSED"
  | "MISSED"
  | "DOCUMENTED_LATE";

const STATUS_OPTIONS: { value: MedAdminStatus; label: string }[] = [
  { value: "GIVEN", label: "Administrado" },
  { value: "HELD", label: "Pendiente" },
  { value: "REFUSED", label: "Rechazado" },
  { value: "MISSED", label: "Omitido" },
  { value: "DOCUMENTED_LATE", label: "Documentado tarde" },
];

type AdminRoute =
  | "ORAL"
  | "IV"
  | "IM"
  | "SC"
  | "TOPICAL"
  | "INHALED"
  | "RECTAL"
  | "SUBLINGUAL"
  | "OPHTHALMIC"
  | "OTIC"
  | "NASAL";

const ROUTE_OPTIONS: { value: AdminRoute | "NONE"; label: string }[] = [
  { value: "NONE", label: "Sin especificar" },
  { value: "ORAL", label: "Oral" },
  { value: "IV", label: "IV" },
  { value: "IM", label: "IM" },
  { value: "SC", label: "SC" },
  { value: "TOPICAL", label: "Tópica" },
  { value: "INHALED", label: "Inhalada" },
  { value: "RECTAL", label: "Rectal" },
  { value: "SUBLINGUAL", label: "Sublingual" },
  { value: "OPHTHALMIC", label: "Oftálmica" },
  { value: "OTIC", label: "Ótica" },
  { value: "NASAL", label: "Nasal" },
];

interface FormState {
  prescriptionItemId: string;
  status: MedAdminStatus;
  doseAmount: string;
  doseUnit: string;
  route: AdminRoute | "NONE";
  site: string;
  patientWristbandScanned: boolean;
  doubleCheckById: string;
  notes: string;
}

const INITIAL: FormState = {
  prescriptionItemId: "",
  status: "GIVEN",
  doseAmount: "",
  doseUnit: "",
  route: "NONE",
  site: "",
  patientWristbandScanned: false,
  doubleCheckById: "",
  notes: "",
};

function validate(f: FormState): string | null {
  if (!f.prescriptionItemId.trim()) return "Item de prescripción es requerido.";
  if (f.doseAmount.trim()) {
    const n = Number(f.doseAmount);
    if (!Number.isFinite(n) || n <= 0) return "Dosis debe ser positiva.";
  }
  return null;
}

export default function NewMedicationAdminPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const record = trpc.medicationAdmin.record.useMutation({
    onSuccess: () => router.push("/emar"),
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
    record.mutate({
      prescriptionItemId: form.prescriptionItemId.trim(),
      status: form.status,
      doseAmount: form.doseAmount.trim() ? Number(form.doseAmount) : undefined,
      doseUnit: form.doseUnit.trim() || undefined,
      route: form.route === "NONE" ? undefined : form.route,
      site: form.site.trim() || undefined,
      patientWristbandScanned: form.patientWristbandScanned,
      doubleCheckById: form.doubleCheckById.trim() || undefined,
      notes: form.notes.trim() || undefined,
    });
  }

  const errorMessage = clientError ?? record.error?.message ?? null;
  const isSubmitting = record.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Registrar administración</h1>
        <p className="text-sm text-muted-foreground">
          Registra una administración de medicamento (§16).
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Datos de la administración</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={onSubmit} noValidate>
            <FormField>
              <Label htmlFor="prescriptionItemId">Item de prescripción (UUID)</Label>
              <Input
                id="prescriptionItemId"
                required
                value={form.prescriptionItemId}
                onChange={(e) => update("prescriptionItemId", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="status">Estado</Label>
              <Select
                value={form.status}
                onValueChange={(v) => update("status", v as MedAdminStatus)}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              <Label htmlFor="doseAmount">Dosis administrada</Label>
              <Input
                id="doseAmount"
                type="number"
                step="0.0001"
                min="0"
                value={form.doseAmount}
                onChange={(e) => update("doseAmount", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="doseUnit">Unidad</Label>
              <Input
                id="doseUnit"
                placeholder="mg, ml, UI..."
                value={form.doseUnit}
                onChange={(e) => update("doseUnit", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="route">Vía</Label>
              <Select
                value={form.route}
                onValueChange={(v) => update("route", v as AdminRoute | "NONE")}
              >
                <SelectTrigger id="route">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUTE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              <Label htmlFor="site">Sitio anatómico</Label>
              <Input
                id="site"
                placeholder="brazo izq, abdomen..."
                value={form.site}
                onChange={(e) => update("site", e.target.value)}
              />
            </FormField>
            <FormField>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.patientWristbandScanned}
                  onChange={(e) =>
                    update("patientWristbandScanned", e.target.checked)
                  }
                />
                Brazalete del paciente escaneado (BCMA)
              </label>
            </FormField>
            <FormField>
              <Label htmlFor="doubleCheckById">Doble verificación (UUID usuario, opcional)</Label>
              <Input
                id="doubleCheckById"
                value={form.doubleCheckById}
                onChange={(e) => update("doubleCheckById", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="notes">Notas</Label>
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
                {isSubmitting ? "Registrando…" : "Registrar administración"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
