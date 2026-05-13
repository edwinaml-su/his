"use client";

/**
 * §18 RIS/PACS — Crear orden de estudio de imagen.
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

type ModalityType =
  | "CR"
  | "CT"
  | "MR"
  | "US"
  | "XA"
  | "MG"
  | "NM"
  | "PT"
  | "OTHER";

type Priority = "ROUTINE" | "URGENT" | "STAT";

const MODALITY_OPTIONS: { value: ModalityType; label: string }[] = [
  { value: "CR", label: "RX (CR)" },
  { value: "CT", label: "TAC (CT)" },
  { value: "MR", label: "RMN (MR)" },
  { value: "US", label: "Ecografía (US)" },
  { value: "XA", label: "Angiografía (XA)" },
  { value: "MG", label: "Mamografía (MG)" },
  { value: "NM", label: "Medicina Nuclear (NM)" },
  { value: "PT", label: "PET (PT)" },
  { value: "OTHER", label: "Otra" },
];

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "ROUTINE", label: "Rutina" },
  { value: "URGENT", label: "Urgente" },
  { value: "STAT", label: "STAT (inmediato)" },
];

interface FormState {
  encounterId: string;
  establishmentId: string;
  patientId: string;
  modalityType: ModalityType;
  studyDescription: string;
  bodySite: string;
  clinicalIndication: string;
  priority: Priority;
}

const INITIAL: FormState = {
  encounterId: "",
  establishmentId: "",
  patientId: "",
  modalityType: "CR",
  studyDescription: "",
  bodySite: "",
  clinicalIndication: "",
  priority: "ROUTINE",
};

function validate(f: FormState): string | null {
  if (!f.encounterId.trim()) return "Encuentro es requerido.";
  if (!f.establishmentId.trim()) return "Establecimiento es requerido.";
  if (!f.patientId.trim()) return "Paciente es requerido.";
  if (!f.studyDescription.trim()) return "Descripción del estudio es requerida.";
  if (!f.clinicalIndication.trim()) return "Indicación clínica es requerida.";
  return null;
}

export default function NewImagingOrderPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const create = trpc.imaging.order.create.useMutation({
    onSuccess: () => router.push("/imaging"),
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
      modalityType: form.modalityType,
      studyDescription: form.studyDescription.trim(),
      bodySite: form.bodySite.trim() || undefined,
      clinicalIndication: form.clinicalIndication.trim(),
      priority: form.priority,
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;
  const isSubmitting = create.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva orden de imagen</h1>
        <p className="text-sm text-muted-foreground">
          Solicita un estudio de imagen (§18).
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Datos del estudio</CardTitle>
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
              <Label htmlFor="modalityType">Modalidad</Label>
              <Select
                value={form.modalityType}
                onValueChange={(v) => update("modalityType", v as ModalityType)}
              >
                <SelectTrigger id="modalityType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODALITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              <Label htmlFor="studyDescription">Descripción del estudio</Label>
              <Input
                id="studyDescription"
                required
                placeholder="Rx tórax PA y lateral"
                value={form.studyDescription}
                onChange={(e) => update("studyDescription", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="bodySite">Sitio anatómico (opcional)</Label>
              <Input
                id="bodySite"
                placeholder="Tórax, cráneo, abdomen..."
                value={form.bodySite}
                onChange={(e) => update("bodySite", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="clinicalIndication">Indicación clínica</Label>
              <textarea
                id="clinicalIndication"
                rows={3}
                required
                value={form.clinicalIndication}
                onChange={(e) => update("clinicalIndication", e.target.value)}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </FormField>
            <FormField>
              <Label htmlFor="priority">Prioridad</Label>
              <Select
                value={form.priority}
                onValueChange={(v) => update("priority", v as Priority)}
              >
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                {isSubmitting ? "Creando…" : "Crear orden"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
