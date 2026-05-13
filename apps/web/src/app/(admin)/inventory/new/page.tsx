"use client";

/**
 * §19 Inventory — Crear item de stock.
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
  sku: string;
  name: string;
  description: string;
  unitOfMeasure: string;
  category: string;
  trackLots: boolean;
  reorderLevel: string;
}

const INITIAL: FormState = {
  sku: "",
  name: "",
  description: "",
  unitOfMeasure: "",
  category: "",
  trackLots: true,
  reorderLevel: "",
};

function validate(f: FormState): string | null {
  if (!f.sku.trim()) return "SKU requerido.";
  if (!f.name.trim()) return "Nombre requerido.";
  if (!f.unitOfMeasure.trim()) return "Unidad de medida requerida.";
  if (f.reorderLevel.trim()) {
    const n = Number(f.reorderLevel);
    if (Number.isNaN(n) || n < 0) return "Nivel de reorden inválido.";
  }
  return null;
}

export default function NewInventoryItemPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const create = trpc.inventory.item.create.useMutation({
    onSuccess: () => router.push("/inventory"),
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
      sku: form.sku.trim(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      unitOfMeasure: form.unitOfMeasure.trim(),
      category: form.category.trim() || undefined,
      trackLots: form.trackLots,
      reorderLevel: form.reorderLevel.trim() ? Number(form.reorderLevel) : undefined,
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;
  const isSubmitting = create.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nuevo item de inventario</h1>
        <p className="text-sm text-muted-foreground">Crea un ítem de stock para el tenant (§19).</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Datos del item</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={onSubmit} noValidate>
            <FormField>
              <Label htmlFor="sku">SKU</Label>
              <Input
                id="sku"
                required
                maxLength={60}
                value={form.sku}
                onChange={(e) => update("sku", e.target.value)}
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
              <Label htmlFor="unitOfMeasure">Unidad de medida</Label>
              <Input
                id="unitOfMeasure"
                required
                maxLength={20}
                placeholder="UN, ML, MG, TAB, BOX…"
                value={form.unitOfMeasure}
                onChange={(e) => update("unitOfMeasure", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="category">Categoría</Label>
              <Input
                id="category"
                maxLength={80}
                placeholder="MEDICAMENTO, INSUMO, REACTIVO…"
                value={form.category}
                onChange={(e) => update("category", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="description">Descripción</Label>
              <Input
                id="description"
                maxLength={400}
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="reorderLevel">Nivel de reorden</Label>
              <Input
                id="reorderLevel"
                type="number"
                min={0}
                step="0.0001"
                value={form.reorderLevel}
                onChange={(e) => update("reorderLevel", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="trackLots" className="flex items-center gap-2">
                <input
                  id="trackLots"
                  type="checkbox"
                  checked={form.trackLots}
                  onChange={(e) => update("trackLots", e.target.checked)}
                />
                <span>Controlar lote + fecha de caducidad</span>
              </Label>
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
                {isSubmitting ? "Guardando…" : "Crear item"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
