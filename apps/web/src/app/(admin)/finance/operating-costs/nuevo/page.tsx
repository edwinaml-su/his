"use client";

/**
 * Wave 9 — /finance/operating-costs/nuevo
 * Formulario de creación de costo operativo.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormError, FormField, FormHint } from "@his/ui/components/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

type Category = "SUBSCRIPTION" | "INFRASTRUCTURE" | "SUPPORT" | "LICENSE" | "OTHER";

const CATEGORY_LABEL: Record<Category, string> = {
  SUBSCRIPTION: "Subscripción",
  INFRASTRUCTURE: "Infraestructura",
  SUPPORT: "Soporte",
  LICENSE: "Licencia",
  OTHER: "Otro",
};

export default function NuevoOperatingCostPage() {
  const router = useRouter();

  // Queries para selects
  const currenciesQuery = trpcAny.currency.list.useQuery();
  const orgsQuery = trpc.organization.current.useQuery();

  const currencies: { id: string; isoCode: string; name: string }[] =
    currenciesQuery.data ?? [];
  const currentOrg = orgsQuery.data;

  // Campos del formulario
  const [category, setCategory] = React.useState<Category | "">("");
  const [description, setDescription] = React.useState("");
  const [vendor, setVendor] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [currencyId, setCurrencyId] = React.useState("");
  const [periodStart, setPeriodStart] = React.useState("");
  const [periodEnd, setPeriodEnd] = React.useState("");
  const [organizationMode, setOrganizationMode] = React.useState<"shared" | "current">("shared");
  const [notes, setNotes] = React.useState("");

  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  const createMutation = trpcAny.operatingCost.create.useMutation({
    onSuccess: (data: { id: string }) => {
      setToast({ title: "Costo creado correctamente", variant: "success" });
      setTimeout(() => router.push(`/finance/operating-costs/${data.id}`), 900);
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const validate = (): boolean => {
    const fe: Record<string, string> = {};
    if (!category) fe.category = "Selecciona una categoría.";
    if (!description.trim()) fe.description = "La descripción es requerida.";
    else if (description.trim().length > 200) fe.description = "Máximo 200 caracteres.";
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < 0) fe.amount = "El monto debe ser un número >= 0.";
    if (!currencyId) fe.currencyId = "Selecciona la moneda.";
    if (!periodStart) fe.periodStart = "La fecha de inicio es requerida.";
    if (!periodEnd) fe.periodEnd = "La fecha de fin es requerida.";
    else if (periodStart && periodEnd < periodStart)
      fe.periodEnd = "La fecha de fin debe ser >= fecha de inicio.";
    setErrors(fe);
    return Object.keys(fe).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;

    createMutation.mutate({
      category,
      description: description.trim(),
      ...(vendor.trim() ? { vendor: vendor.trim() } : {}),
      amount: parseFloat(amount),
      currencyId,
      periodStart,
      periodEnd,
      ...(organizationMode === "current" && currentOrg?.id
        ? { organizationId: currentOrg.id }
        : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  };

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/finance/operating-costs">← Costos Operativos</Link>
      </Button>

      <div>
        <h1 className="text-2xl font-bold">Nuevo costo operativo</h1>
        <p className="text-sm text-muted-foreground">
          Registra una subscripción, servicio de infraestructura, soporte o licencia del HIS.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Datos del costo</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={handleSubmit}>
            <FormField>
              <Label htmlFor="category">
                Categoría<span className="text-destructive"> *</span>
              </Label>
              <Select
                value={category || ""}
                onValueChange={(v) => setCategory(v as Category)}
              >
                <SelectTrigger aria-invalid={Boolean(errors.category)}>
                  <SelectValue placeholder="Selecciona categoría…" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(CATEGORY_LABEL) as [Category, string][]).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormError>{errors.category}</FormError>
            </FormField>

            <FormField>
              <Label htmlFor="description">
                Descripción<span className="text-destructive"> *</span>
              </Label>
              <Input
                id="description"
                placeholder="Ej. Vercel Pro — hosting + builds + edge functions"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
                aria-invalid={Boolean(errors.description)}
              />
              <FormError>{errors.description}</FormError>
            </FormField>

            <FormField>
              <Label htmlFor="vendor">Proveedor (opcional)</Label>
              <Input
                id="vendor"
                placeholder="Ej. Vercel Inc."
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                maxLength={120}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField>
                <Label htmlFor="amount">
                  Monto<span className="text-destructive"> *</span>
                </Label>
                <Input
                  id="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-invalid={Boolean(errors.amount)}
                />
                <FormError>{errors.amount}</FormError>
              </FormField>

              <FormField>
                <Label htmlFor="currencyId">
                  Moneda<span className="text-destructive"> *</span>
                </Label>
                <Select
                  value={currencyId || ""}
                  onValueChange={setCurrencyId}
                >
                  <SelectTrigger aria-invalid={Boolean(errors.currencyId)}>
                    <SelectValue placeholder="Selecciona moneda…" />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.isoCode} — {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormError>{errors.currencyId}</FormError>
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField>
                <Label htmlFor="periodStart">
                  Periodo desde<span className="text-destructive"> *</span>
                </Label>
                <Input
                  id="periodStart"
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  aria-invalid={Boolean(errors.periodStart)}
                />
                <FormError>{errors.periodStart}</FormError>
              </FormField>

              <FormField>
                <Label htmlFor="periodEnd">
                  Periodo hasta<span className="text-destructive"> *</span>
                </Label>
                <Input
                  id="periodEnd"
                  type="date"
                  value={periodEnd}
                  min={periodStart}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  aria-invalid={Boolean(errors.periodEnd)}
                />
                <FormError>{errors.periodEnd}</FormError>
              </FormField>
            </div>

            <FormField>
              <Label htmlFor="orgMode">Organización</Label>
              <Select
                value={organizationMode}
                onValueChange={(v) => setOrganizationMode(v as "shared" | "current")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="shared">
                    Compartido (todas las organizaciones)
                  </SelectItem>
                  {currentOrg ? (
                    <SelectItem value="current">
                      {currentOrg.tradeName ?? currentOrg.legalName} (solo esta org)
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              <FormHint>
                "Compartido" = costo prorrateable entre todas las orgs activas. El campo
                organizationId quedará NULL en BD.
              </FormHint>
            </FormField>

            <FormField>
              <Label htmlFor="notes">Notas (opcional)</Label>
              <textarea
                id="notes"
                rows={3}
                placeholder="Detalles adicionales, número de contrato, etc."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                maxLength={5000}
              />
            </FormField>

            {serverError ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {serverError}
              </p>
            ) : null}

            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/finance/operating-costs")}
                disabled={createMutation.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Guardando…" : "Crear costo"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      {toast ? (
        <Toast
          variant={toast.variant ?? "default"}
          open={Boolean(toast)}
          onOpenChange={(o) => !o && setToast(null)}
        >
          <div className="flex flex-col gap-1">
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
          </div>
        </Toast>
      ) : null}
    </div>
  );
}
