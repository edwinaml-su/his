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

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
              <Label>Sexo biológico</Label>
              <Select
                value={form.biologicalSexId}
                onValueChange={(v) => setForm({ ...form, biologicalSexId: v })}
              >
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
              <Label htmlFor="birthDate">Fecha de nacimiento</Label>
              <Input
                id="birthDate"
                type="date"
                value={form.birthDate}
                onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
              />
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
