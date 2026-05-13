"use client";

/**
 * §25 Insurer Agreements — Crear aseguradora.
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

type InsurerKind = "PUBLIC" | "PRIVATE" | "SELF_INSURED";

const KIND_OPTIONS: { value: InsurerKind; label: string }[] = [
  { value: "PRIVATE", label: "Privada" },
  { value: "PUBLIC", label: "Pública" },
  { value: "SELF_INSURED", label: "Auto-asegurada" },
];

interface FormState {
  code: string;
  name: string;
  taxId: string;
  kind: InsurerKind;
  contactPhone: string;
  contactEmail: string;
}

const INITIAL: FormState = {
  code: "",
  name: "",
  taxId: "",
  kind: "PRIVATE",
  contactPhone: "",
  contactEmail: "",
};

function validate(f: FormState): string | null {
  if (!f.code.trim()) return "Código requerido.";
  if (!f.name.trim()) return "Nombre requerido.";
  if (f.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contactEmail.trim()))
    return "Email inválido.";
  return null;
}

export default function NewInsurerPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const create = trpc.insurance.insurer.create.useMutation({
    onSuccess: () => router.push("/insurance"),
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
      code: form.code.trim(),
      name: form.name.trim(),
      taxId: form.taxId.trim() || undefined,
      kind: form.kind,
      contactPhone: form.contactPhone.trim() || undefined,
      contactEmail: form.contactEmail.trim() || undefined,
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;
  const isSubmitting = create.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva aseguradora</h1>
        <p className="text-sm text-muted-foreground">Registra una aseguradora del tenant (§25).</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Datos</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={onSubmit} noValidate>
            <FormField>
              <Label htmlFor="code">Código</Label>
              <Input
                id="code"
                required
                maxLength={40}
                value={form.code}
                onChange={(e) => update("code", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                required
                maxLength={200}
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="taxId">NIT (opcional)</Label>
              <Input
                id="taxId"
                maxLength={40}
                value={form.taxId}
                onChange={(e) => update("taxId", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="kind">Tipo</Label>
              <Select
                value={form.kind}
                onValueChange={(v) => update("kind", v as InsurerKind)}
              >
                <SelectTrigger id="kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              <Label htmlFor="contactPhone">Teléfono (opcional)</Label>
              <Input
                id="contactPhone"
                maxLength={40}
                value={form.contactPhone}
                onChange={(e) => update("contactPhone", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="contactEmail">Email (opcional)</Label>
              <Input
                id="contactEmail"
                type="email"
                maxLength={200}
                value={form.contactEmail}
                onChange={(e) => update("contactEmail", e.target.value)}
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
                {isSubmitting ? "Guardando…" : "Crear aseguradora"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
