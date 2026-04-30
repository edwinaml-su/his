"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormField, FormError } from "@his/ui/components/form";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import { Button } from "@his/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

/**
 * Admisión simple (TDR §8.3). Recibe patientId (manual o desde la URL),
 * tipo de admisión y moneda, y crea el encounter.
 */
export default function AdmissionPage() {
  const router = useRouter();
  const currencies = trpc.currency.list.useQuery();
  const admit = trpc.encounter.admit.useMutation({
    onSuccess: (enc) => router.replace(`/encounters/${enc.id}`),
  });
  const [form, setForm] = React.useState({
    patientId: "",
    admissionType: "EMERGENCY" as "EMERGENCY" | "SCHEDULED" | "TRANSFER_IN" | "BIRTH" | "NEWBORN",
    currencyId: "",
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Admisión</h1>
      <Card>
        <CardHeader><CardTitle>Nuevo encuentro</CardTitle></CardHeader>
        <CardContent>
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              admit.mutate({
                patientId: form.patientId,
                admissionType: form.admissionType,
                currencyId: form.currencyId,
              });
            }}
          >
            <FormField>
              <Label htmlFor="patientId">Patient ID</Label>
              <Input
                id="patientId"
                required
                value={form.patientId}
                onChange={(e) => setForm({ ...form, patientId: e.target.value })}
                placeholder="UUID del paciente"
              />
            </FormField>
            <FormField>
              <Label>Tipo de admisión</Label>
              <Select
                value={form.admissionType}
                onValueChange={(v) =>
                  setForm({ ...form, admissionType: v as typeof form.admissionType })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EMERGENCY">Emergencia</SelectItem>
                  <SelectItem value="SCHEDULED">Programada</SelectItem>
                  <SelectItem value="TRANSFER_IN">Traslado entrante</SelectItem>
                  <SelectItem value="BIRTH">Nacimiento</SelectItem>
                  <SelectItem value="NEWBORN">Recién nacido</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              <Label>Moneda</Label>
              <Select
                value={form.currencyId}
                onValueChange={(v) => setForm({ ...form, currencyId: v })}
              >
                <SelectTrigger><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                <SelectContent>
                  {currencies.data?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.isoCode} — {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormError>{admit.error?.message}</FormError>
            <Button type="submit" disabled={admit.isPending}>
              {admit.isPending ? "Admitiendo…" : "Admitir"}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
