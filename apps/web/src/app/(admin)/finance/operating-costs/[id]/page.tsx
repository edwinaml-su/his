"use client";

/**
 * Wave 9 — /finance/operating-costs/[id]
 * Detalle + edición inline + botón Eliminar.
 */
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormError, FormField, FormHint } from "@his/ui/components/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
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

const CATEGORY_VARIANT: Record<Category, "info" | "success" | "warning" | "secondary" | "outline"> = {
  SUBSCRIPTION: "info",
  INFRASTRUCTURE: "success",
  SUPPORT: "warning",
  LICENSE: "secondary",
  OTHER: "outline",
};

type CostDetail = {
  id: string;
  organizationId: string | null;
  category: string;
  description: string;
  vendor: string | null;
  amount: string;
  currencyId: string;
  currencyCode: string | null;
  periodStart: string;
  periodEnd: string;
  notes: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export default function OperatingCostDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const query = trpcAny.operatingCost.get.useQuery({ id }, { enabled: Boolean(id) });
  const cost = query.data as CostDetail | undefined;

  const currenciesQuery = trpcAny.currency.list.useQuery();
  const orgsQuery = trpc.organization.current.useQuery();
  const currentOrg = orgsQuery.data;
  const currencies: { id: string; isoCode: string; name: string }[] =
    currenciesQuery.data ?? [];

  const utils = trpc.useUtils();

  // Formulario de edición
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
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  // Sync formulario cuando lleguen datos
  React.useEffect(() => {
    if (cost) {
      setCategory((cost.category as Category) ?? "");
      setDescription(cost.description);
      setVendor(cost.vendor ?? "");
      setAmount(parseFloat(cost.amount).toFixed(2));
      setCurrencyId(cost.currencyId);
      setPeriodStart(cost.periodStart);
      setPeriodEnd(cost.periodEnd);
      setOrganizationMode(cost.organizationId ? "current" : "shared");
      setNotes(cost.notes ?? "");
    }
  }, [cost]);

  const updateMutation = trpcAny.operatingCost.update.useMutation({
    onSuccess: () => {
      utils.invalidate();
      setToast({ title: "Costo actualizado", variant: "success" });
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const deleteMutation = trpcAny.operatingCost.delete.useMutation({
    onSuccess: () => {
      router.push("/finance/operating-costs");
    },
    onError: (err: { message: string }) => {
      setToast({ title: "Error al eliminar", description: err.message, variant: "destructive" });
      setConfirmDelete(false);
    },
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
    if (!validate() || !cost) return;

    updateMutation.mutate({
      id: cost.id,
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

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando costo operativo…</p>;
  }

  if (query.error || !cost) {
    return (
      <div className="space-y-3">
        <Button asChild variant="outline" size="sm">
          <Link href="/finance/operating-costs">← Volver</Link>
        </Button>
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {(query.error as { message?: string })?.message ?? "Costo no encontrado."}
        </p>
      </div>
    );
  }

  const cat = cost.category as Category;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Button asChild variant="ghost" size="sm">
            <Link href="/finance/operating-costs">← Costos Operativos</Link>
          </Button>
          <h1 className="text-2xl font-bold">{cost.description}</h1>
          <div className="flex items-center gap-2">
            <Badge variant={CATEGORY_VARIANT[cat] ?? "outline"}>
              {CATEGORY_LABEL[cat] ?? cat}
            </Badge>
            {cost.organizationId ? (
              <Badge variant="outline">Org específica</Badge>
            ) : (
              <Badge variant="secondary">Compartido</Badge>
            )}
          </div>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmDelete(true)}
        >
          Eliminar
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Panel información */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Información actual</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 text-sm">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Proveedor</dt>
                <dd>{cost.vendor ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Monto</dt>
                <dd className="font-mono font-medium">
                  {cost.currencyCode ?? "USD"}{" "}
                  {parseFloat(cost.amount).toLocaleString("es-SV", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Periodo</dt>
                <dd className="font-mono text-xs">
                  {cost.periodStart} — {cost.periodEnd}
                </dd>
              </div>
              {cost.notes ? (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Notas</dt>
                  <dd className="whitespace-pre-line text-xs">{cost.notes}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Creado</dt>
                <dd className="font-mono text-xs">
                  {new Date(cost.createdAt).toISOString().slice(0, 10)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Actualizado</dt>
                <dd className="font-mono text-xs">
                  {new Date(cost.updatedAt).toISOString().slice(0, 10)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Panel edición */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Editar</CardTitle>
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
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={200}
                  aria-invalid={Boolean(errors.description)}
                />
                <FormError>{errors.description}</FormError>
              </FormField>

              <FormField>
                <Label htmlFor="vendor">Proveedor</Label>
                <Input
                  id="vendor"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  maxLength={120}
                  placeholder="Opcional"
                />
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField>
                  <Label htmlFor="amount">
                    Monto<span className="text-destructive"> *</span>
                  </Label>
                  <Input
                    id="amount"
                    type="number"
                    min="0"
                    step="0.01"
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
                  <Select value={currencyId || ""} onValueChange={setCurrencyId}>
                    <SelectTrigger aria-invalid={Boolean(errors.currencyId)}>
                      <SelectValue placeholder="Selecciona…" />
                    </SelectTrigger>
                    <SelectContent>
                      {currencies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.isoCode}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormError>{errors.currencyId}</FormError>
                </FormField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField>
                  <Label htmlFor="periodStart">
                    Desde<span className="text-destructive"> *</span>
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
                    Hasta<span className="text-destructive"> *</span>
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
                    <SelectItem value="shared">Compartido (todas las orgs)</SelectItem>
                    {currentOrg ? (
                      <SelectItem value="current">
                        {currentOrg.tradeName ?? currentOrg.legalName}
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
                <FormHint>
                  "Compartido" → organizationId NULL en BD (prorrateable entre todas las orgs).
                </FormHint>
              </FormField>

              <FormField>
                <Label htmlFor="notes">Notas</Label>
                <textarea
                  id="notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  maxLength={5000}
                  placeholder="Opcional"
                />
              </FormField>

              {serverError ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  {serverError}
                </p>
              ) : null}

              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Guardando…" : "Guardar cambios"}
              </Button>
            </Form>
          </CardContent>
        </Card>
      </div>

      {/* Confirmación eliminar */}
      <Dialog open={confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar costo operativo</DialogTitle>
            <DialogDescription>
              Se eliminará permanentemente:{" "}
              <span className="font-medium">{cost.description}</span>. Esta acción no puede
              deshacerse.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate({ id: cost.id })}
            >
              {deleteMutation.isPending ? "Eliminando…" : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
