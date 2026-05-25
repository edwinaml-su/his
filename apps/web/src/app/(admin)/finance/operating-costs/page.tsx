"use client";

/**
 * Wave 9 — /finance/operating-costs
 * Lista paginada de costos operativos del HIS.
 */
import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Input } from "@his/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
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

type CostRow = {
  id: string;
  organizationId: string | null;
  category: string;
  description: string;
  vendor: string | null;
  amount: string;
  currencyCode: string | null;
  periodStart: string;
  periodEnd: string;
};

function fmt(amount: string) {
  const n = parseFloat(amount) || 0;
  return n.toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function OperatingCostsPage() {
  const [categoryFilter, setCategoryFilter] = React.useState<string>("");
  const [periodStartFilter, setPeriodStartFilter] = React.useState<string>("");
  const [periodEndFilter, setPeriodEndFilter] = React.useState<string>("");
  const [onlyShared, setOnlyShared] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<CostRow | null>(null);
  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  const utils = trpc.useUtils();

  const query = trpcAny.operatingCost.list.useQuery({
    ...(categoryFilter ? { category: categoryFilter } : {}),
    ...(periodStartFilter ? { periodStart: periodStartFilter } : {}),
    ...(periodEndFilter ? { periodEnd: periodEndFilter } : {}),
    ...(onlyShared ? { onlyShared: true } : {}),
  });

  const deleteMutation = trpcAny.operatingCost.delete.useMutation({
    onSuccess: () => {
      utils.invalidate();
      setToast({ title: "Costo eliminado", variant: "success" });
      setConfirmDelete(null);
    },
    onError: (err: { message: string }) => {
      setToast({ title: "Error al eliminar", description: err.message, variant: "destructive" });
    },
  });

  const rows: CostRow[] = query.data ?? [];

  // Total agregado del periodo filtrado
  const total = rows.reduce((acc, r) => acc + (parseFloat(r.amount) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Costos Operativos HIS</h1>
          <p className="text-sm text-muted-foreground">
            Subscripciones, infraestructura, soporte y licencias del sistema.
          </p>
        </div>
        <Button asChild>
          <Link href="/finance/operating-costs/nuevo">+ Nuevo costo</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Categoría</label>
              <Select
                value={categoryFilter || "todas"}
                onValueChange={(v) => setCategoryFilter(v === "todas" ? "" : v)}
              >
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {(Object.entries(CATEGORY_LABEL) as [Category, string][]).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Periodo desde</label>
              <Input
                type="date"
                className="w-40"
                value={periodStartFilter}
                onChange={(e) => setPeriodStartFilter(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Periodo hasta</label>
              <Input
                type="date"
                className="w-40"
                value={periodEndFilter}
                onChange={(e) => setPeriodEndFilter(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="onlyShared"
                type="checkbox"
                checked={onlyShared}
                onChange={(e) => setOnlyShared(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <label htmlFor="onlyShared" className="text-sm font-medium cursor-pointer">
                Solo compartidos
              </label>
            </div>

            <span className="ml-auto text-xs text-muted-foreground">
              {query.isLoading ? "Cargando…" : `${rows.length} registro(s)`}
            </span>
          </div>
        </CardContent>
      </Card>

      {query.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {(query.error as { message?: string })?.message ?? "Error al cargar costos."}
        </p>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <div className="rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="w-32">Proveedor</TableHead>
                  <TableHead className="w-36">Categoría</TableHead>
                  <TableHead className="w-32 text-right">Monto</TableHead>
                  <TableHead className="w-48">Periodo</TableHead>
                  <TableHead className="w-36">Organización</TableHead>
                  <TableHead className="w-32 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !query.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                      Sin costos para los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                ) : null}
                {rows.map((row) => {
                  const cat = row.category as Category;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link
                          href={`/finance/operating-costs/${row.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {row.description}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.vendor ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={CATEGORY_VARIANT[cat] ?? "outline"}>
                          {CATEGORY_LABEL[cat] ?? cat}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {row.currencyCode ?? "USD"} {fmt(row.amount)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.periodStart} — {row.periodEnd}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.organizationId ? (
                          <Badge variant="outline">Org específica</Badge>
                        ) : (
                          <Badge variant="secondary">Compartido</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-2">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/finance/operating-costs/${row.id}`}>Ver</Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setConfirmDelete(row)}
                          >
                            Eliminar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Total agregado */}
      {rows.length > 0 ? (
        <div className="flex justify-end">
          <div className="rounded-md border px-4 py-2 text-sm">
            <span className="text-muted-foreground">Total periodo filtrado: </span>
            <span className="font-mono font-semibold">
              USD {total.toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      ) : null}

      {/* Confirmación eliminar */}
      <Dialog
        open={Boolean(confirmDelete)}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar costo operativo</DialogTitle>
            <DialogDescription>
              Se eliminará permanentemente:{" "}
              <span className="font-medium">{confirmDelete?.description}</span>. Esta acción no
              puede deshacerse.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (confirmDelete) {
                  deleteMutation.mutate({ id: confirmDelete.id });
                }
              }}
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
