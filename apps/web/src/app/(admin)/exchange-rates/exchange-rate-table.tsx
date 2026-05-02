"use client";

/**
 * US-1.3 — Tabla paginada de tasas de cambio.
 *
 * Filtros:
 *   - Moneda origen / destino (selectors poblados con `currency.list`).
 *   - Tipo de tasa (BUY/SELL/AVERAGE/OFFICIAL/FISCAL).
 *   - Rango de fechas (validFrom desde/hasta).
 *   - Toggle "solo vigentes" (filtra tasas cuyo intervalo cubre `now`).
 *
 * Renderiza:
 *   - Badges color-coded por rateType (semantics: BUY=info, SELL=warning,
 *     AVERAGE=secondary, OFFICIAL=success, FISCAL=critical).
 *   - Estado "Vigente" (validTo IS NULL && validFrom<=now) o "Histórica".
 *   - Paginación simple con prev/next.
 *
 * NO permite editar ni eliminar (histórico inmutable). El único path para
 * "actualizar" una tasa es crear una nueva con `validFrom` posterior — el
 * router cierra automáticamente la vigente previa.
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Badge } from "@his/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

type FxRateType = "BUY" | "SELL" | "AVERAGE" | "OFFICIAL" | "FISCAL";

const RATE_TYPE_LABELS: Record<FxRateType, string> = {
  BUY: "Compra",
  SELL: "Venta",
  AVERAGE: "Promedio",
  OFFICIAL: "Oficial",
  FISCAL: "Fiscal",
};

/**
 * Mapeo color-coded por tipo de tasa. Usa variants ya definidos en
 * `@his/ui/components/badge` (no requiere CSS nuevo).
 */
const RATE_TYPE_VARIANT: Record<
  FxRateType,
  "info" | "warning" | "secondary" | "success" | "critical"
> = {
  BUY: "info",
  SELL: "warning",
  AVERAGE: "secondary",
  OFFICIAL: "success",
  FISCAL: "critical",
};

const RATE_TYPES: FxRateType[] = ["BUY", "SELL", "AVERAGE", "OFFICIAL", "FISCAL"];

const PAGE_SIZE = 25;

export function ExchangeRateTable() {
  const [page, setPage] = React.useState(1);
  const [fromCurrencyId, setFromCurrencyId] = React.useState<string>("");
  const [toCurrencyId, setToCurrencyId] = React.useState<string>("");
  const [rateType, setRateType] = React.useState<string>("");
  const [fromDate, setFromDate] = React.useState<string>("");
  const [toDate, setToDate] = React.useState<string>("");
  const [onlyCurrent, setOnlyCurrent] = React.useState(false);

  const currencies = trpc.currency.list.useQuery();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const query = trpcAny.exchangeRate.list.useQuery({
    page,
    pageSize: PAGE_SIZE,
    ...(fromCurrencyId ? { fromCurrencyId } : {}),
    ...(toCurrencyId ? { toCurrencyId } : {}),
    ...(rateType ? { rateType } : {}),
    ...(fromDate ? { from: new Date(fromDate) } : {}),
    ...(toDate ? { to: new Date(toDate) } : {}),
    ...(onlyCurrent ? { onlyCurrent: true } : {}),
  });

  const data = query.data as
    | {
        rows: Array<{
          id: string;
          rate: string | number;
          rateType: FxRateType;
          validFrom: string | Date;
          validTo: string | Date | null;
          source: string | null;
          createdAt: string | Date;
          from: { isoCode: string; symbol: string };
          to: { isoCode: string; symbol: string };
        }>;
        total: number;
        page: number;
        pageCount: number;
      }
    | undefined;

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = data?.pageCount ?? 1;

  const resetFilters = () => {
    setFromCurrencyId("");
    setToCurrencyId("");
    setRateType("");
    setFromDate("");
    setToDate("");
    setOnlyCurrent(false);
    setPage(1);
  };

  // Reset page cuando cambian filtros para evitar quedar en página vacía.
  React.useEffect(() => {
    setPage(1);
  }, [fromCurrencyId, toCurrencyId, rateType, fromDate, toDate, onlyCurrent]);

  const isVigente = (validTo: string | Date | null) =>
    validTo == null || new Date(validTo) > new Date();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Origen</label>
          <Select value={fromCurrencyId || "all"} onValueChange={(v) => setFromCurrencyId(v === "all" ? "" : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {(currencies.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.isoCode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Destino</label>
          <Select value={toCurrencyId || "all"} onValueChange={(v) => setToCurrencyId(v === "all" ? "" : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {(currencies.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.isoCode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Tipo</label>
          <Select value={rateType || "all"} onValueChange={(v) => setRateType(v === "all" ? "" : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {RATE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {RATE_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Desde</label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Hasta</label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyCurrent}
              onChange={(e) => setOnlyCurrent(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Solo vigentes
          </label>
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Limpiar
          </Button>
        </div>
      </div>

      {query.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Error: {(query.error as { message?: string })?.message ?? "Error al cargar tasas."}
        </p>
      ) : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Par</TableHead>
              <TableHead className="w-28">Tipo</TableHead>
              <TableHead className="w-32 text-right">Tasa</TableHead>
              <TableHead className="w-44">Vigente desde</TableHead>
              <TableHead className="w-44">Vigente hasta</TableHead>
              <TableHead className="w-24">Estado</TableHead>
              <TableHead>Fuente</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && !query.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Sin tasas registradas para los filtros seleccionados.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">
                  {row.from.isoCode} → {row.to.isoCode}
                </TableCell>
                <TableCell>
                  <Badge variant={RATE_TYPE_VARIANT[row.rateType]}>
                    {RATE_TYPE_LABELS[row.rateType]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono">{String(row.rate)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {new Date(row.validFrom).toISOString().slice(0, 16).replace("T", " ")}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {row.validTo
                    ? new Date(row.validTo).toISOString().slice(0, 16).replace("T", " ")
                    : "—"}
                </TableCell>
                <TableCell>
                  {isVigente(row.validTo) ? (
                    <Badge variant="success">Vigente</Badge>
                  ) : (
                    <Badge variant="outline">Histórica</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs">{row.source ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {query.isLoading ? "Cargando…" : `${total} tasa(s) · página ${page}/${pageCount}`}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || query.isLoading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount || query.isLoading}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            Siguiente
          </Button>
        </div>
      </div>
    </div>
  );
}
