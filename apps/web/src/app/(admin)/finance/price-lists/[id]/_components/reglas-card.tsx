"use client";

/**
 * CC-0021 — Reglas de precio de un tarifario + probador.
 *
 * Las reglas se listan en el MISMO orden en que las evalúa el motor
 * (packages/trpc/src/lib/price-resolver.ts): la primera que matchea gana. El
 * probador muestra qué precio saldría para un código, cantidad y fecha, y de
 * dónde vino (regla explícita, ítem del tarifario o precio de catálogo).
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";
import { ReglaDialog, type CategoriaOption, type ListaOption } from "./regla-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

type Regla = {
  id: string;
  appliedOn: "item" | "category" | "global";
  itemCode: string | null;
  categoryNombre: string | null;
  minQuantity: string;
  dateStart: string | null;
  dateEnd: string | null;
  computePrice: "fixed" | "percentage" | "formula";
  fixedPrice: string | null;
  percentPrice: string;
  base: "list_price" | "standard_cost" | "pricelist";
  basePriceListName: string | null;
  priceDiscount: string;
  priceSurcharge: string;
  priceRound: string;
  priceMinMargin: string;
  priceMaxMargin: string;
  sequence: number;
  odooItemId: number | null;
  active: boolean;
};

const APLICA_LABEL = { item: "Código", category: "Categoría", global: "Toda la lista" } as const;
const BASE_LABEL = { list_price: "catálogo", standard_cost: "costo", pricelist: "otra lista" } as const;
const FUENTE_LABEL = {
  regla: "Regla explícita",
  lista: "Ítem del tarifario",
  estandar: "Precio de catálogo",
} as const;

function fmtFecha(v: string | null) {
  return v ? new Date(v).toLocaleDateString("es-SV") : null;
}

function fmtMoney(v: string | number) {
  return Number(v).toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Describe en una línea qué precio produce la regla. */
function describirCalculo(r: Regla): string {
  if (r.computePrice === "fixed") return `$${fmtMoney(r.fixedPrice ?? 0)}`;
  if (r.computePrice === "percentage") return `${fmtMoney(r.percentPrice)}% menos sobre ${BASE_LABEL[r.base]}`;

  const partes: string[] = [];
  const descuento = Number(r.priceDiscount);
  if (descuento > 0) partes.push(`−${fmtMoney(descuento)}%`);
  if (descuento < 0) partes.push(`+${fmtMoney(-descuento)}%`);
  if (Number(r.priceRound) > 0) partes.push(`redondeo a ${fmtMoney(r.priceRound)}`);
  if (Number(r.priceSurcharge) !== 0) partes.push(`recargo $${fmtMoney(r.priceSurcharge)}`);
  if (Number(r.priceMinMargin) > 0) partes.push(`mín. +$${fmtMoney(r.priceMinMargin)}`);
  if (Number(r.priceMaxMargin) > 0) partes.push(`máx. +$${fmtMoney(r.priceMaxMargin)}`);

  const detalle = partes.length ? partes.join(" · ") : "sin ajustes";
  return `${detalle} sobre ${r.base === "pricelist" ? (r.basePriceListName ?? "otra lista") : BASE_LABEL[r.base]}`;
}

function Probador({ priceListId }: { priceListId: string }) {
  const [code, setCode] = React.useState("");
  const [cantidad, setCantidad] = React.useState("1");
  const [consulta, setConsulta] = React.useState<{ code: string; cantidad: number } | null>(null);

  const query = trpcAny.servicePriceList.simularPrecio.useQuery(
    { priceListId, code: consulta?.code ?? "", cantidad: consulta?.cantidad ?? 1 },
    { enabled: Boolean(consulta) },
  );

  const resultado = query.data as
    | { precio: number | null; fuente: "regla" | "lista" | "estandar" | null; reglaId: string | null }
    | undefined;

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3">
      <div className="space-y-1">
        <Label htmlFor="probador-code">Código a probar</Label>
        <Input
          id="probador-code"
          className="w-56"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Ej. AVT-HEM-001"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="probador-cantidad">Cantidad</Label>
        <Input
          id="probador-cantidad"
          className="w-24"
          type="number"
          min={0}
          step="1"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
        />
      </div>
      <Button
        variant="outline"
        disabled={!code.trim()}
        onClick={() => setConsulta({ code: code.trim(), cantidad: Number(cantidad) || 1 })}
      >
        Probar
      </Button>

      {consulta ? (
        <p className="text-sm" role="status">
          {query.isFetching ? (
            <span className="text-muted-foreground">Calculando…</span>
          ) : resultado?.precio != null ? (
            <>
              <span className="font-mono font-semibold">${fmtMoney(resultado.precio)}</span>{" "}
              <span className="text-muted-foreground">
                — {FUENTE_LABEL[resultado.fuente ?? "estandar"]}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              Sin precio para «{consulta.code}» — se pediría captura manual.
            </span>
          )}
        </p>
      ) : null}
    </div>
  );
}

export function ReglasCard({ priceListId }: { priceListId: string }) {
  const reglasQuery = trpcAny.servicePriceList.listRules.useQuery({ priceListId });
  const categoriasQuery = trpcAny.servicePriceList.listCategories.useQuery({ activeOnly: true });
  const listasQuery = trpcAny.servicePriceList.list.useQuery({ active: true });

  const setRuleActive = trpcAny.servicePriceList.setRuleActive.useMutation({
    onSuccess: () => reglasQuery.refetch(),
  });

  const reglas: Regla[] = reglasQuery.data ?? [];
  const categorias: CategoriaOption[] = categoriasQuery.data ?? [];
  const listas: ListaOption[] = listasQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Reglas de precio ({reglas.length})</CardTitle>
            <p className="text-sm text-muted-foreground">
              Se evalúan en este orden; gana la primera que aplica. Un código sin regla usa su ítem del
              tarifario y, si tampoco existe, el precio de catálogo.
            </p>
          </div>
          <ReglaDialog
            priceListId={priceListId}
            categorias={categorias}
            listas={listas}
            onSuccess={() => reglasQuery.refetch()}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Probador priceListId={priceListId} />

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Aplica a</TableHead>
                <TableHead className="w-48">Objetivo</TableHead>
                <TableHead className="w-24 text-right">Cant. mín.</TableHead>
                <TableHead className="w-36">Vigencia</TableHead>
                <TableHead>Cálculo</TableHead>
                <TableHead className="w-24">Estado</TableHead>
                <TableHead className="w-28 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reglasQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    Cargando reglas…
                  </TableCell>
                </TableRow>
              ) : null}
              {!reglasQuery.isLoading && reglas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    Sin reglas. La lista funciona con los precios fijos de sus ítems.
                  </TableCell>
                </TableRow>
              ) : null}
              {reglas.map((r) => {
                const desde = fmtFecha(r.dateStart);
                const hasta = fmtFecha(r.dateEnd);
                return (
                  <TableRow key={r.id} className={!r.active ? "opacity-50" : undefined}>
                    <TableCell className="text-sm">{APLICA_LABEL[r.appliedOn]}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.appliedOn === "item" ? r.itemCode : null}
                      {r.appliedOn === "category" ? r.categoryNombre : null}
                      {r.appliedOn === "global" ? <span className="text-muted-foreground">—</span> : null}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtMoney(r.minQuantity)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {desde || hasta ? `${desde ?? "…"} – ${hasta ?? "…"}` : "Sin límite"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {describirCalculo(r)}
                      {r.odooItemId ? (
                        <span className="ml-2 text-xs text-muted-foreground">(Odoo #{r.odooItemId})</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {r.active ? <Badge variant="success">Activa</Badge> : <Badge variant="outline">Inactiva</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={setRuleActive.isPending}
                        onClick={() => setRuleActive.mutate({ id: r.id, active: !r.active })}
                      >
                        {r.active ? "Desactivar" : "Activar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
