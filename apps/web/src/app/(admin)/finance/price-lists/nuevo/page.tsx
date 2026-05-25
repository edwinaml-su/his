"use client";

/**
 * /finance/price-lists/nuevo — Formulario de nuevo tarifario.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

export default function NuevoTarifarioPage() {
  const router = useRouter();

  const [name, setName] = React.useState("");
  const [currencyId, setCurrencyId] = React.useState("");
  const [validFrom, setValidFrom] = React.useState(new Date().toISOString().slice(0, 10));
  const [validTo, setValidTo] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const currenciesQuery = trpcAny.currency.list.useQuery();
  const currencies: { id: string; isoCode: string; name: string }[] =
    currenciesQuery.data ?? [];

  const createMutation = trpcAny.servicePriceList.create.useMutation({
    onSuccess: (data: { id: string }) => {
      router.push(`/finance/price-lists/${data.id}`);
    },
    onError: (err: { message: string }) => {
      setError(err.message ?? "Error al crear tarifario.");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) { setError("El nombre es requerido."); return; }
    if (!currencyId) { setError("Selecciona la moneda."); return; }
    if (!validFrom) { setError("La fecha de inicio de vigencia es requerida."); return; }

    createMutation.mutate({
      name: name.trim(),
      currencyId,
      validFrom: new Date(validFrom).toISOString(),
      ...(validTo ? { validTo: new Date(validTo).toISOString() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nuevo tarifario</h1>
        <p className="text-sm text-muted-foreground">
          Define el tarifario base. Los items se agregan desde el detalle.
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Datos del tarifario</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                placeholder="Ej. Tarifario Estándar 2026"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="currency">Moneda *</Label>
              <Select
                value={currencyId || "none"}
                onValueChange={(v) => setCurrencyId(v === "none" ? "" : v)}
              >
                <SelectTrigger id="currency">
                  <SelectValue placeholder="Selecciona moneda" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— seleccionar —</SelectItem>
                  {currencies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.isoCode} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="validFrom">Vigencia desde *</Label>
              <Input
                id="validFrom"
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="validTo">Vigencia hasta (opcional)</Label>
              <Input
                id="validTo"
                type="date"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="notes">Notas (opcional)</Label>
              <Input
                id="notes"
                placeholder="Observaciones o referencias normativas"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <div className="mt-4 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancelar
          </Button>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creando…" : "Crear tarifario"}
          </Button>
        </div>
      </form>
    </div>
  );
}
