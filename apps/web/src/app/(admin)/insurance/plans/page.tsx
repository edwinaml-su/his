"use client";

/**
 * CC-0028 — Planes de aseguradoras: lista + alta.
 * Extiende §25 Insurer Agreements (Beta.14) con el modelo por-plan espejo de
 * Odoo (acs.insurance.plan): lista de precios propia + coberturas por ámbito
 * + reglas, editadas en /insurance/plans/[id].
 */
import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";

function NuevoPlanDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [insurerId, setInsurerId] = React.useState("");
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [priceListId, setPriceListId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const insurersQuery = trpc.insurance.insurer.list.useQuery({ activeOnly: true, limit: 200 });
  const priceListsQuery = trpc.servicePriceList.list.useQuery({ active: true });

  React.useEffect(() => {
    if (!open) return;
    setInsurerId("");
    setCode("");
    setName("");
    setPriceListId("");
    setError(null);
  }, [open]);

  const createMutation = trpc.insurance.plan.create.useMutation({
    onSuccess: () => {
      onOpenChange(false);
      onSuccess();
    },
    onError: (err) => setError(err.message ?? "Error al crear el plan."),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!insurerId) return setError("Selecciona la aseguradora.");
    if (!code.trim()) return setError("El código es requerido.");
    if (!name.trim()) return setError("El nombre es requerido.");

    createMutation.mutate({
      insurerId,
      code: code.trim(),
      name: name.trim(),
      priceListId: priceListId || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo plan</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="plan-insurer">Aseguradora</Label>
            <Select value={insurerId} onValueChange={setInsurerId}>
              <SelectTrigger id="plan-insurer">
                <SelectValue placeholder="Seleccionar…" />
              </SelectTrigger>
              <SelectContent>
                {(insurersQuery.data ?? []).map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-code">Código</Label>
            <Input id="plan-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">Nombre</Label>
            <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-pricelist">Lista de precios (opcional)</Label>
            <Select value={priceListId} onValueChange={setPriceListId}>
              <SelectTrigger id="plan-pricelist">
                <SelectValue placeholder="Sin lista propia" />
              </SelectTrigger>
              <SelectContent>
                {(priceListsQuery.data ?? []).map((pl) => (
                  <SelectItem key={pl.id} value={pl.id}>
                    {pl.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Guardando…" : "Crear plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function InsurancePlansPage() {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const query = trpc.insurance.plan.list.useQuery({ activeOnly: true, limit: 200 });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Planes de aseguradoras</h1>
          <p className="text-sm text-muted-foreground">
            Plan por aseguradora (CC-0028) — espejo de acs.insurance.plan de Odoo.
            Coberturas por ámbito y reglas de reparto se editan en el detalle del plan.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/insurance">Volver a aseguradoras</Link>
          </Button>
          <Button onClick={() => setDialogOpen(true)}>Nuevo plan</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Planes</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin planes.</p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Aseguradora</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono">{p.code}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.insurer.name}</TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/insurance/plans/${p.id}`}>Configurar</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NuevoPlanDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => void query.refetch()}
      />
    </div>
  );
}
