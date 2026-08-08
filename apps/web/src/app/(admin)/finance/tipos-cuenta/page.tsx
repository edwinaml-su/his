"use client";

/**
 * /finance/tipos-cuenta — Catálogo de Tipos de Cuenta (CC-0015).
 *
 * Pivote de lista de precios: cada TipoCuenta (PARTICULAR, ISBM, MAPFRE, ...)
 * apunta a una ServicePriceList (o ninguna — fallback a LabTest.standardPrice).
 * Patrón calcado de /finance/price-lists: tabla + Dialog de crear/editar.
 */
import * as React from "react";
import { CreditCard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

interface TipoCuentaRow {
  id: string;
  code: string;
  nombre: string;
  priceListId: string | null;
  priceListName: string | null;
  insurerId: string | null;
  esParticular: boolean;
  active: boolean;
}

interface PriceListOption {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Dialog: crear / editar
// ---------------------------------------------------------------------------

function TipoCuentaFormDialog({
  open,
  onOpenChange,
  tipo,
  priceLists,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tipo: TipoCuentaRow | null;
  priceLists: PriceListOption[];
  onSuccess: () => void;
}) {
  const [code, setCode] = React.useState("");
  const [nombre, setNombre] = React.useState("");
  const [priceListId, setPriceListId] = React.useState("");
  const [esParticular, setEsParticular] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCode(tipo?.code ?? "");
    setNombre(tipo?.nombre ?? "");
    setPriceListId(tipo?.priceListId ?? "");
    setEsParticular(tipo?.esParticular ?? false);
    setError(null);
  }, [open, tipo]);

  const createMutation = trpcAny.tipoCuenta.create.useMutation({
    onSuccess: () => {
      onOpenChange(false);
      onSuccess();
    },
    onError: (err: { message: string }) => setError(err.message ?? "Error al crear tipo de cuenta."),
  });

  const updateMutation = trpcAny.tipoCuenta.update.useMutation({
    onSuccess: () => {
      onOpenChange(false);
      onSuccess();
    },
    onError: (err: { message: string }) => setError(err.message ?? "Error al editar tipo de cuenta."),
  });

  const saving = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!code.trim()) { setError("El código es requerido."); return; }
    if (!nombre.trim()) { setError("El nombre es requerido."); return; }

    if (tipo) {
      updateMutation.mutate({
        id: tipo.id,
        code: code.trim(),
        nombre: nombre.trim(),
        priceListId: priceListId || null,
        esParticular,
      });
    } else {
      createMutation.mutate({
        code: code.trim(),
        nombre: nombre.trim(),
        ...(priceListId ? { priceListId } : {}),
        esParticular,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setError(null); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tipo ? "Editar tipo de cuenta" : "Nuevo tipo de cuenta"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="tc-code">Código *</Label>
              <Input
                id="tc-code"
                placeholder="ISBM"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="tc-nombre">Nombre *</Label>
              <Input
                id="tc-nombre"
                placeholder="ISBM"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="tc-price-list">Lista de precios</Label>
              <Select
                value={priceListId || "none"}
                onValueChange={(v) => setPriceListId(v === "none" ? "" : v)}
              >
                <SelectTrigger id="tc-price-list">
                  <SelectValue placeholder="Sin lista asignada" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin lista asignada</SelectItem>
                  {priceLists.map((pl) => (
                    <SelectItem key={pl.id} value={pl.id}>
                      {pl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={esParticular}
                onChange={(e) => setEsParticular(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Es tipo Particular (paciente paga directo, sin aseguradora)
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando…" : tipo ? "Guardar cambios" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function TiposCuentaPage() {
  const [activeFilter, setActiveFilter] = React.useState("activos");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<TipoCuentaRow | null>(null);

  const query = trpcAny.tipoCuenta.list.useQuery(
    activeFilter === "activos"
      ? { activeOnly: true }
      : undefined,
  );
  const priceListsQuery = trpcAny.servicePriceList.list.useQuery({ active: true });

  const deactivate = trpcAny.tipoCuenta.deactivate.useMutation({ onSuccess: () => query.refetch() });
  const reactivate = trpcAny.tipoCuenta.reactivate.useMutation({ onSuccess: () => query.refetch() });

  const allRows = (query.data ?? []) as TipoCuentaRow[];
  const rows =
    activeFilter === "inactivos" ? allRows.filter((r) => !r.active) : allRows;
  const priceLists: PriceListOption[] = (priceListsQuery.data ?? []).map(
    (pl: { id: string; name: string }) => ({ id: pl.id, name: pl.name }),
  );

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(tipo: TipoCuentaRow) {
    setEditing(tipo);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CreditCard className="h-6 w-6" />
            Tipos de Cuenta
          </h1>
          <p className="text-sm text-muted-foreground">
            Pivote de cobro: determina qué lista de precios aplica a los cargos de cada cuenta
            (PARTICULAR, ISBM, MAPFRE, etc.).
          </p>
        </div>
        <Button onClick={openCreate}>+ Nuevo tipo de cuenta</Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Tipos de cuenta</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={activeFilter} onValueChange={setActiveFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="activos">Solo activos</SelectItem>
                  <SelectItem value="inactivos">Solo inactivos</SelectItem>
                  <SelectItem value="todos">Todos</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {query.isLoading ? "Cargando…" : `${rows.length} tipo(s)`}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {query.error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {(query.error as { message?: string })?.message ?? "Error al cargar tipos de cuenta."}
            </p>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Lista de precios</TableHead>
                  <TableHead className="w-24">Particular</TableHead>
                  <TableHead className="w-24">Estado</TableHead>
                  <TableHead className="w-40 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !query.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      Sin tipos de cuenta para los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                ) : null}
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell className="text-sm font-medium">{row.nombre}</TableCell>
                    <TableCell className="text-sm">
                      {row.priceListName ?? <span className="text-muted-foreground">Sin lista asignada</span>}
                    </TableCell>
                    <TableCell>
                      {row.esParticular ? <Badge variant="outline">Sí</Badge> : null}
                    </TableCell>
                    <TableCell>
                      {row.active ? (
                        <Badge variant="success">Activo</Badge>
                      ) : (
                        <Badge variant="outline">Inactivo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                          Editar
                        </Button>
                        {row.active ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={deactivate.isPending}
                            onClick={() => deactivate.mutate({ id: row.id })}
                          >
                            Desactivar
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={reactivate.isPending}
                            onClick={() => reactivate.mutate({ id: row.id })}
                          >
                            Activar
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <TipoCuentaFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tipo={editing}
        priceLists={priceLists}
        onSuccess={() => query.refetch()}
      />
    </div>
  );
}
