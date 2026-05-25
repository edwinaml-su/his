"use client";

/**
 * /finance/price-lists/[id] — Detalle de tarifario con tabla de items.
 * Wave 11 — Sprint UI Finance.
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen } from "lucide-react";
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

type PriceListItem = {
  id: string;
  code: string | null;
  description: string;
  unitPrice: string;
  estimatedCost: string | null;
  serviceUnitId: string | null;
  suggestedCostCenterId: string | null;
  costCenterCode: string | null;
  costCenterName: string | null;
  active: boolean;
};

type PriceListDetail = {
  id: string;
  name: string;
  currencyId: string;
  validFrom: string;
  validTo: string | null;
  active: boolean;
  notes: string | null;
  items: PriceListItem[];
};

type CostCenterRow = { id: string; code: string; name: string };

function fmt(d: string | Date) {
  return new Date(d).toLocaleDateString("es-SV");
}

function fmtMoney(v: string | number) {
  return Number(v).toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Dialog: agregar item
// ---------------------------------------------------------------------------

function AddItemDialog({
  priceListId,
  onSuccess,
  costCenters,
}: {
  priceListId: string;
  onSuccess: () => void;
  costCenters: CostCenterRow[];
}) {
  const [open, setOpen] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [unitPrice, setUnitPrice] = React.useState("");
  const [estimatedCost, setEstimatedCost] = React.useState("");
  const [suggestedCostCenterId, setSuggestedCostCenterId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const addItem = trpcAny.servicePriceList.addItem.useMutation({
    onSuccess: () => {
      setOpen(false);
      // reset
      setCode(""); setDescription(""); setUnitPrice(""); setEstimatedCost(""); setSuggestedCostCenterId(""); setError(null);
      onSuccess();
    },
    onError: (err: { message: string }) => setError(err.message ?? "Error al agregar item."),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!description.trim()) { setError("La descripción es requerida."); return; }
    if (!unitPrice || isNaN(Number(unitPrice)) || Number(unitPrice) < 0) {
      setError("Precio unitario inválido."); return;
    }

    addItem.mutate({
      priceListId,
      ...(code.trim() ? { code: code.trim() } : {}),
      description: description.trim(),
      unitPrice: Number(unitPrice),
      ...(estimatedCost && !isNaN(Number(estimatedCost)) ? { estimatedCost: Number(estimatedCost) } : {}),
      ...(suggestedCostCenterId ? { suggestedCostCenterId } : {}),
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        + Agregar item
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Agregar item al tarifario</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="item-code">Código (opcional)</Label>
                <Input
                  id="item-code"
                  placeholder="CON-GEN"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="item-desc">Descripción *</Label>
                <Input
                  id="item-desc"
                  placeholder="Consulta médica general"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="item-price">Precio unitario *</Label>
                <Input
                  id="item-price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="item-cost">Costo estimado</Label>
                <Input
                  id="item-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={estimatedCost}
                  onChange={(e) => setEstimatedCost(e.target.value)}
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="item-cc">Centro de costo sugerido</Label>
                <Select
                  value={suggestedCostCenterId || "none"}
                  onValueChange={(v) => setSuggestedCostCenterId(v === "none" ? "" : v)}
                >
                  <SelectTrigger id="item-cc">
                    <SelectValue placeholder="Ninguno" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ninguno</SelectItem>
                    {costCenters.map((cc) => (
                      <SelectItem key={cc.id} value={cc.id}>
                        {cc.code} — {cc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={addItem.isPending}>
                {addItem.isPending ? "Guardando…" : "Agregar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function PriceListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const query = trpcAny.servicePriceList.get.useQuery({ id });
  const costCentersQuery = trpcAny.invoice.listCostCenters.useQuery();

  const setItemActive = trpcAny.servicePriceList.setItemActive.useMutation({
    onSuccess: () => query.refetch(),
  });
  const setListActive = trpcAny.servicePriceList.setListActive.useMutation({
    onSuccess: () => query.refetch(),
  });

  const pl = query.data as PriceListDetail | undefined;
  const costCenters: CostCenterRow[] = costCentersQuery.data ?? [];

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando tarifario…</p>;
  }

  if (query.error || !pl) {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {(query.error as { message?: string })?.message ?? "Tarifario no encontrado."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/finance/price-lists" className="hover:underline">
          Tarifarios
        </Link>
        <span>/</span>
        <span className="font-medium text-foreground">{pl.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BookOpen className="h-6 w-6" />
            {pl.name}
          </h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>Vigencia: {fmt(pl.validFrom)}{pl.validTo ? ` – ${fmt(pl.validTo)}` : " (indefinida)"}</span>
            {pl.active ? <Badge variant="success">Activo</Badge> : <Badge variant="outline">Inactivo</Badge>}
          </div>
          {pl.notes ? <p className="text-sm text-muted-foreground">{pl.notes}</p> : null}
        </div>
        <div className="flex gap-2">
          {pl.active ? (
            <Button
              size="sm"
              variant="outline"
              disabled={setListActive.isPending}
              onClick={() => setListActive.mutate({ id: pl.id, active: false })}
            >
              Desactivar tarifario
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={setListActive.isPending}
              onClick={() => setListActive.mutate({ id: pl.id, active: true })}
            >
              Activar tarifario
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => router.back()}>
            Volver
          </Button>
        </div>
      </div>

      {/* Items */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Items ({pl.items.length})
            </CardTitle>
            <AddItemDialog
              priceListId={pl.id}
              onSuccess={() => query.refetch()}
              costCenters={costCenters}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Código</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="w-28 text-right">Precio unit.</TableHead>
                  <TableHead className="w-28 text-right">Costo est.</TableHead>
                  <TableHead className="w-32">C. Costo sug.</TableHead>
                  <TableHead className="w-24">Estado</TableHead>
                  <TableHead className="w-28 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pl.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                      Sin items. Usa "Agregar item" para comenzar.
                    </TableCell>
                  </TableRow>
                ) : null}
                {pl.items.map((item) => (
                  <TableRow key={item.id} className={!item.active ? "opacity-50" : undefined}>
                    <TableCell className="font-mono text-xs">
                      {item.code ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">{item.description}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${fmtMoney(item.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {item.estimatedCost ? `$${fmtMoney(item.estimatedCost)}` : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {item.costCenterCode ? (
                        <span title={item.costCenterName ?? undefined}>{item.costCenterCode}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.active ? (
                        <Badge variant="success">Activo</Badge>
                      ) : (
                        <Badge variant="outline">Inactivo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.active ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={setItemActive.isPending}
                          onClick={() => setItemActive.mutate({ id: item.id, active: false })}
                        >
                          Desactivar
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={setItemActive.isPending}
                          onClick={() => setItemActive.mutate({ id: item.id, active: true })}
                        >
                          Activar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
