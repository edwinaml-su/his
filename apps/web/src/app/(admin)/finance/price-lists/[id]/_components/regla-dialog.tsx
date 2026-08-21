"use client";

/**
 * CC-0021 — Alta/edición de una regla de precio (product.pricelist.item de Odoo).
 *
 * El formulario muestra solo los campos que aplican al tipo de cálculo elegido:
 * un precio fijo no necesita base ni márgenes, y un porcentaje no necesita
 * redondeo ni recargo. Las combinaciones inválidas las rechaza el contrato
 * (packages/contracts/src/schemas/service-price-rule.ts) antes de llegar a la BD.
 */
import * as React from "react";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

export type CategoriaOption = { id: string; nombre: string };
export type ListaOption = { id: string; name: string };

type Estado = {
  appliedOn: "item" | "category" | "global";
  itemCode: string;
  categoryId: string;
  minQuantity: string;
  dateStart: string;
  dateEnd: string;
  computePrice: "fixed" | "percentage" | "formula";
  fixedPrice: string;
  percentPrice: string;
  base: "list_price" | "standard_cost" | "pricelist";
  basePriceListId: string;
  priceDiscount: string;
  priceSurcharge: string;
  priceRound: string;
  priceMinMargin: string;
  priceMaxMargin: string;
  sequence: string;
};

const ESTADO_INICIAL: Estado = {
  appliedOn: "item",
  itemCode: "",
  categoryId: "",
  minQuantity: "0",
  dateStart: "",
  dateEnd: "",
  computePrice: "fixed",
  fixedPrice: "",
  percentPrice: "0",
  base: "list_price",
  basePriceListId: "",
  priceDiscount: "0",
  priceSurcharge: "0",
  priceRound: "0",
  priceMinMargin: "0",
  priceMaxMargin: "0",
  sequence: "0",
};

/** Convierte un `datetime-local` a ISO; vacío → undefined. */
function aIso(valor: string): string | undefined {
  return valor ? new Date(valor).toISOString() : undefined;
}

export function ReglaDialog({
  priceListId,
  categorias,
  listas,
  onSuccess,
}: {
  priceListId: string;
  categorias: CategoriaOption[];
  listas: ListaOption[];
  onSuccess: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<Estado>(ESTADO_INICIAL);
  const [error, setError] = React.useState<string | null>(null);

  const addRule = trpcAny.servicePriceList.addRule.useMutation({
    onSuccess: () => {
      setOpen(false);
      setForm(ESTADO_INICIAL);
      setError(null);
      onSuccess();
    },
    onError: (err: { message?: string }) => setError(err.message ?? "No se pudo crear la regla."),
  });

  const set = <K extends keyof Estado>(campo: K, valor: Estado[K]) =>
    setForm((prev) => ({ ...prev, [campo]: valor }));

  function guardar() {
    setError(null);
    addRule.mutate({
      priceListId,
      appliedOn: form.appliedOn,
      itemCode: form.appliedOn === "item" ? form.itemCode.trim() : undefined,
      categoryId: form.appliedOn === "category" ? form.categoryId || undefined : undefined,
      minQuantity: Number(form.minQuantity) || 0,
      dateStart: aIso(form.dateStart),
      dateEnd: aIso(form.dateEnd),
      computePrice: form.computePrice,
      fixedPrice: form.computePrice === "fixed" ? Number(form.fixedPrice) : undefined,
      percentPrice: form.computePrice === "percentage" ? Number(form.percentPrice) || 0 : 0,
      base: form.computePrice === "fixed" ? "list_price" : form.base,
      basePriceListId:
        form.computePrice !== "fixed" && form.base === "pricelist" ? form.basePriceListId || undefined : undefined,
      priceDiscount: form.computePrice === "formula" ? Number(form.priceDiscount) || 0 : 0,
      priceSurcharge: form.computePrice === "formula" ? Number(form.priceSurcharge) || 0 : 0,
      priceRound: form.computePrice === "formula" ? Number(form.priceRound) || 0 : 0,
      priceMinMargin: form.computePrice === "formula" ? Number(form.priceMinMargin) || 0 : 0,
      priceMaxMargin: form.computePrice === "formula" ? Number(form.priceMaxMargin) || 0 : 0,
      sequence: Number(form.sequence) || 0,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        Nueva regla
      </Button>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nueva regla de precio</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="regla-aplica">Aplica a</Label>
            <Select value={form.appliedOn} onValueChange={(v) => set("appliedOn", v as Estado["appliedOn"])}>
              <SelectTrigger id="regla-aplica">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="item">Un código del tarifario</SelectItem>
                <SelectItem value="category">Una categoría</SelectItem>
                <SelectItem value="global">Toda la lista</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.appliedOn === "item" ? (
            <div className="space-y-1">
              <Label htmlFor="regla-code">Código</Label>
              <Input
                id="regla-code"
                value={form.itemCode}
                onChange={(e) => set("itemCode", e.target.value)}
                placeholder="Ej. AVT-HEM-001"
              />
            </div>
          ) : null}

          {form.appliedOn === "category" ? (
            <div className="space-y-1">
              <Label htmlFor="regla-categoria">Categoría</Label>
              <Select value={form.categoryId} onValueChange={(v) => set("categoryId", v)}>
                <SelectTrigger id="regla-categoria">
                  <SelectValue placeholder="Elegir categoría" />
                </SelectTrigger>
                <SelectContent>
                  {categorias.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="regla-minqty">Cantidad mínima</Label>
            <Input
              id="regla-minqty"
              type="number"
              min={0}
              step="0.001"
              value={form.minQuantity}
              onChange={(e) => set("minQuantity", e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="regla-seq">Prioridad (mayor gana)</Label>
            <Input
              id="regla-seq"
              type="number"
              value={form.sequence}
              onChange={(e) => set("sequence", e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="regla-desde">Vigente desde</Label>
            <Input
              id="regla-desde"
              type="datetime-local"
              value={form.dateStart}
              onChange={(e) => set("dateStart", e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="regla-hasta">Vigente hasta</Label>
            <Input
              id="regla-hasta"
              type="datetime-local"
              value={form.dateEnd}
              onChange={(e) => set("dateEnd", e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="regla-calculo">Cálculo</Label>
            <Select value={form.computePrice} onValueChange={(v) => set("computePrice", v as Estado["computePrice"])}>
              <SelectTrigger id="regla-calculo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Precio fijo</SelectItem>
                <SelectItem value="percentage">Descuento porcentual</SelectItem>
                <SelectItem value="formula">Fórmula</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.computePrice === "fixed" ? (
            <div className="space-y-1">
              <Label htmlFor="regla-precio">Precio</Label>
              <Input
                id="regla-precio"
                type="number"
                min={0}
                step="0.01"
                value={form.fixedPrice}
                onChange={(e) => set("fixedPrice", e.target.value)}
              />
            </div>
          ) : null}

          {form.computePrice === "percentage" ? (
            <div className="space-y-1">
              <Label htmlFor="regla-pct">Descuento %</Label>
              <Input
                id="regla-pct"
                type="number"
                step="0.01"
                value={form.percentPrice}
                onChange={(e) => set("percentPrice", e.target.value)}
              />
            </div>
          ) : null}

          {form.computePrice !== "fixed" ? (
            <div className="space-y-1">
              <Label htmlFor="regla-base">Precio base</Label>
              <Select value={form.base} onValueChange={(v) => set("base", v as Estado["base"])}>
                <SelectTrigger id="regla-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="list_price">Precio de catálogo</SelectItem>
                  <SelectItem value="standard_cost">Costo estimado</SelectItem>
                  <SelectItem value="pricelist">Otra lista</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {form.computePrice !== "fixed" && form.base === "pricelist" ? (
            <div className="space-y-1">
              <Label htmlFor="regla-base-lista">Lista base</Label>
              <Select value={form.basePriceListId} onValueChange={(v) => set("basePriceListId", v)}>
                <SelectTrigger id="regla-base-lista">
                  <SelectValue placeholder="Elegir lista" />
                </SelectTrigger>
                <SelectContent>
                  {listas
                    .filter((l) => l.id !== priceListId)
                    .map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {form.computePrice === "formula" ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="regla-desc">Descuento % (negativo = markup)</Label>
                <Input
                  id="regla-desc"
                  type="number"
                  step="0.01"
                  value={form.priceDiscount}
                  onChange={(e) => set("priceDiscount", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="regla-round">Redondear a múltiplo de</Label>
                <Input
                  id="regla-round"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.priceRound}
                  onChange={(e) => set("priceRound", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="regla-recargo">Recargo fijo</Label>
                <Input
                  id="regla-recargo"
                  type="number"
                  step="0.01"
                  value={form.priceSurcharge}
                  onChange={(e) => set("priceSurcharge", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="regla-min">Margen mínimo sobre el base</Label>
                <Input
                  id="regla-min"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.priceMinMargin}
                  onChange={(e) => set("priceMinMargin", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="regla-max">Margen máximo sobre el base</Label>
                <Input
                  id="regla-max"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.priceMaxMargin}
                  onChange={(e) => set("priceMaxMargin", e.target.value)}
                />
              </div>
            </>
          ) : null}
        </div>

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={addRule.isPending}>
            {addRule.isPending ? "Guardando…" : "Crear regla"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
