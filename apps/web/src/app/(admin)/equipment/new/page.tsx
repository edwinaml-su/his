"use client";

/**
 * §20 Services & Equipment — Crear equipo biomédico.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormField } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

interface FormState {
  establishmentId: string;
  assetTag: string;
  name: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  category: string;
  location: string;
  installDate: string;
}

const INITIAL: FormState = {
  establishmentId: "",
  assetTag: "",
  name: "",
  manufacturer: "",
  model: "",
  serialNumber: "",
  category: "",
  location: "",
  installDate: "",
};

function validate(f: FormState): string | null {
  if (!f.establishmentId.trim()) return "Establecimiento requerido.";
  if (!f.assetTag.trim()) return "Etiqueta de activo requerida.";
  if (!f.name.trim()) return "Nombre requerido.";
  return null;
}

export default function NewEquipmentPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const create = trpc.servicesEquipment.equipment.create.useMutation({
    onSuccess: () => router.push("/equipment"),
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
      establishmentId: form.establishmentId.trim(),
      assetTag: form.assetTag.trim(),
      name: form.name.trim(),
      manufacturer: form.manufacturer.trim() || undefined,
      model: form.model.trim() || undefined,
      serialNumber: form.serialNumber.trim() || undefined,
      category: form.category.trim() || undefined,
      location: form.location.trim() || undefined,
      installDate: form.installDate ? new Date(form.installDate) : undefined,
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;
  const isSubmitting = create.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nuevo equipo biomédico</h1>
        <p className="text-sm text-muted-foreground">Registra un activo biomédico (§20).</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Datos del equipo</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={onSubmit} noValidate>
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
              <Label htmlFor="assetTag">Etiqueta de activo</Label>
              <Input
                id="assetTag"
                required
                maxLength={60}
                value={form.assetTag}
                onChange={(e) => update("assetTag", e.target.value)}
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
              <Label htmlFor="manufacturer">Fabricante</Label>
              <Input
                id="manufacturer"
                maxLength={120}
                value={form.manufacturer}
                onChange={(e) => update("manufacturer", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="model">Modelo</Label>
              <Input
                id="model"
                maxLength={120}
                value={form.model}
                onChange={(e) => update("model", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="serialNumber">Número de serie</Label>
              <Input
                id="serialNumber"
                maxLength={120}
                value={form.serialNumber}
                onChange={(e) => update("serialNumber", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="category">Categoría</Label>
              <Input
                id="category"
                maxLength={80}
                placeholder="VENTILADOR, MONITOR, BOMBA…"
                value={form.category}
                onChange={(e) => update("category", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="location">Ubicación</Label>
              <Input
                id="location"
                maxLength={120}
                placeholder="UCI sala 3, Quirófano 2…"
                value={form.location}
                onChange={(e) => update("location", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="installDate">Fecha de instalación</Label>
              <Input
                id="installDate"
                type="date"
                value={form.installDate}
                onChange={(e) => update("installDate", e.target.value)}
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
                {isSubmitting ? "Guardando…" : "Crear equipo"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
