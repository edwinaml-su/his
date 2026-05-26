"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormField, FormError } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";
import { parseDateOnly } from "@/lib/date-only";

/**
 * Registro nuevo paciente (TDR §8.1). Formulario mínimo MVP.
 * TODO(Sprint 2): wizard completo con direcciones, alergias, identificadores en el mismo flujo.
 */
export default function NewPatientPage() {
  const router = useRouter();
  const sexes = trpc.catalog.list.useQuery({ catalog: "biologicalSex", activeOnly: true });
  const create = trpc.patient.create.useMutation({
    onSuccess: (p) => router.replace(`/patients/${p.id}`),
  });

  const [form, setForm] = React.useState({
    mrn: "",
    firstName: "",
    lastName: "",
    biologicalSexId: "",
    birthDate: "",
  });

  // H1-02 (audit Stream A): validación client-side previa al submit — el Select
  // de Shadcn no acepta `required` HTML, así que se enmascara como UUID inválido
  // en el servidor sin feedback visual. Aquí marcamos los campos obligatorios
  // antes de invocar la mutación.
  const [validationError, setValidationError] = React.useState<{
    field: "biologicalSexId" | "birthDate" | null;
    message: string;
  }>({ field: null, message: "" });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.biologicalSexId) {
      setValidationError({
        field: "biologicalSexId",
        message: "Selecciona el sexo biológico — campo obligatorio para protocolos clínicos.",
      });
      return;
    }
    if (!form.birthDate) {
      setValidationError({
        field: "birthDate",
        message: "Ingresa la fecha de nacimiento — requerida para cálculo de edad y rangos pediátricos.",
      });
      return;
    }
    setValidationError({ field: null, message: "" });

    create.mutate({
      mrn: form.mrn,
      firstName: form.firstName,
      lastName: form.lastName,
      biologicalSexId: form.biologicalSexId,
      birthDate: parseDateOnly(form.birthDate),
      birthDateEstimated: false,
      isUnknown: false,
    });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Nuevo paciente</h1>
      <Card>
        <CardHeader>
          <CardTitle>Datos básicos</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={onSubmit}>
            <FormField>
              <Label htmlFor="mrn">MRN</Label>
              <Input
                id="mrn"
                required
                value={form.mrn}
                onChange={(e) => setForm({ ...form, mrn: e.target.value })}
              />
            </FormField>
            <FormField>
              <Label htmlFor="firstName">Nombre</Label>
              <Input
                id="firstName"
                required
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </FormField>
            <FormField>
              <Label htmlFor="lastName">Apellido</Label>
              <Input
                id="lastName"
                required
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </FormField>
            <FormField>
              <Label htmlFor="biologicalSexId">
                Sexo biológico <span aria-hidden className="text-destructive">*</span>
                <span className="sr-only"> (obligatorio)</span>
              </Label>
              <Select
                value={form.biologicalSexId}
                onValueChange={(v) => {
                  setForm({ ...form, biologicalSexId: v });
                  if (validationError.field === "biologicalSexId") {
                    setValidationError({ field: null, message: "" });
                  }
                }}
              >
                <SelectTrigger
                  id="biologicalSexId"
                  aria-required="true"
                  aria-invalid={validationError.field === "biologicalSexId"}
                  aria-describedby={validationError.field === "biologicalSexId" ? "biologicalSexId-error" : undefined}
                >
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
              {validationError.field === "biologicalSexId" && (
                <p id="biologicalSexId-error" role="alert" className="text-sm text-destructive">
                  {validationError.message}
                </p>
              )}
            </FormField>
            <FormField>
              <Label htmlFor="birthDate">
                Fecha de nacimiento <span aria-hidden className="text-destructive">*</span>
                <span className="sr-only"> (obligatorio)</span>
              </Label>
              <Input
                id="birthDate"
                type="date"
                required
                value={form.birthDate}
                onChange={(e) => {
                  setForm({ ...form, birthDate: e.target.value });
                  if (validationError.field === "birthDate") {
                    setValidationError({ field: null, message: "" });
                  }
                }}
                aria-invalid={validationError.field === "birthDate"}
                aria-describedby={validationError.field === "birthDate" ? "birthDate-error" : undefined}
              />
              {validationError.field === "birthDate" && (
                <p id="birthDate-error" role="alert" className="text-sm text-destructive">
                  {validationError.message}
                </p>
              )}
            </FormField>
            <FormError>{create.error?.message}</FormError>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Guardando…" : "Crear paciente"}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
