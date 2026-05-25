"use client";

/**
 * /finance — Dashboard ejecutivo del módulo Finance (Wave 11).
 *
 * Secciones:
 *   1. Hero KPIs — 4 cards del mes actual.
 *   2. Alertas / Acciones requeridas — draft, overdue, claims.
 *   3. Tendencia ingresos — tabla de últimos 6 meses.
 *   4. Top 5 centros productivos — por ingresos del periodo.
 *   5. Accesos rápidos — grid de links a sub-páginas Finance.
 *
 * Decisión Client Component: el date range picker requiere estado reactivo
 * y re-fetch por periodo — no hay ventaja en SSR para datos financieros
 * protegidos por tenant.
 */
import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function firstOfQuarterStr(): string {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  const month = String(q * 3 + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}-01`;
}

function firstOfYearStr(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function prevMonthRange(): { start: string; end: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    start: first.toISOString().slice(0, 10),
    end: last.toISOString().slice(0, 10),
  };
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMonthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleString("es-SV", { month: "short", year: "2-digit" });
}

// Semafórico basado en umbral
function semaforo(value: number, goodAbove: number, warnAbove: number): string {
  if (value >= goodAbove) return "text-green-600";
  if (value >= warnAbove) return "text-amber-600";
  return "text-red-600";
}

// ---------------------------------------------------------------------------
// Sub-componentes de KPI card
// ---------------------------------------------------------------------------

interface KpiCardProps {
  title: string;
  value: string;
  sub?: string;
  colorClass?: string;
  loading?: boolean;
}

function KpiCard({ title, value, sub, colorClass = "", loading }: KpiCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        ) : (
          <>
            <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
            {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Accesos rápidos
// ---------------------------------------------------------------------------

interface QuickLink {
  label: string;
  href: string;
  desc: string;
}

const QUICK_LINKS: QuickLink[] = [
  { label: "Facturas", href: "/finance/invoices", desc: "Listado y emisión" },
  { label: "+ Nueva Factura", href: "/finance/invoices/nuevo", desc: "Emitir factura" },
  { label: "Centros de Costo", href: "/finance/cost-centers", desc: "41 centros activos" },
  { label: "Costos Operativos", href: "/finance/operating-costs", desc: "HisOperatingCost" },
  { label: "Reglas de Prorrateo", href: "/finance/allocation-rules", desc: "Distribución apoyo" },
  { label: "Reportes Financieros", href: "/finance/reportes", desc: "7 reportes MINSAL" },
];

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function FinanceOverviewPage() {
  const today = todayStr();
  const [periodStart, setPeriodStart] = React.useState(firstOfMonthStr());
  const [periodEnd, setPeriodEnd] = React.useState(today);

  const summaryQ = trpcAny.financeOverview.summary.useQuery(
    { periodStart, periodEnd },
    { keepPreviousData: true },
  );

  const topCentersQ = trpcAny.financeOverview.topCostCenters.useQuery(
    { periodStart, periodEnd, limit: 5 },
    { keepPreviousData: true },
  );

  const trendQ = trpcAny.financeOverview.revenueByMonth.useQuery(
    { months: 6 },
    // Trend no cambia con el dateRange — siempre últimos 6 meses
  );

  const s = summaryQ.data as
    | {
        revenueTotal: number;
        cobrado: number;
        cobradoPct: number;
        cxc: number;
        margenPct: number;
        operatingCostsTotal: number;
        claimsPendingCount: number;
        invoicesDraftCount: number;
        invoicesOverdueCount: number;
      }
    | undefined;

  const topCenters = (topCentersQ.data ?? []) as Array<{
    centroId: string;
    code: string;
    name: string;
    tipo: string;
    ingresos: number;
    margenPct: number;
  }>;

  const trend = (trendQ.data ?? []) as Array<{ mes: string; revenue: number }>;

  // Handlers de rangos rápidos
  function setRange(start: string, end: string) {
    setPeriodStart(start);
    setPeriodEnd(end);
  }

  return (
    <div className="space-y-8">
      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Finance — Resumen Ejecutivo</h1>
          <p className="text-sm text-muted-foreground">
            KPIs financieros del establecimiento. TDR §23.
          </p>
        </div>
      </div>

      {/* Date range picker */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Desde</Label>
              <Input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="w-36 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="w-36 text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRange(firstOfMonthStr(), today)}
              >
                Este mes
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const prev = prevMonthRange();
                  setRange(prev.start, prev.end);
                }}
              >
                Mes anterior
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRange(firstOfQuarterStr(), today)}
              >
                Trimestre
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRange(firstOfYearStr(), today)}
              >
                Año actual
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sección 1: Hero KPIs */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-muted-foreground uppercase tracking-wide">
          KPIs del periodo
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            title="Ingresos"
            value={s ? `$${fmtCurrency(s.revenueTotal)}` : "—"}
            sub="Σ facturas no anuladas"
            loading={summaryQ.isLoading}
          />
          <KpiCard
            title="Cobrado"
            value={s ? `$${fmtCurrency(s.cobrado)}` : "—"}
            sub={s ? `${s.cobradoPct}% del total` : undefined}
            colorClass={s ? semaforo(s.cobradoPct, 80, 50) : ""}
            loading={summaryQ.isLoading}
          />
          <KpiCard
            title="CxC Pendiente"
            value={s ? `$${fmtCurrency(s.cxc)}` : "—"}
            sub="Facturas emitidas sin cobrar"
            colorClass={s && s.cxc > 0 ? "text-amber-600" : ""}
            loading={summaryQ.isLoading}
          />
          <KpiCard
            title="Margen Bruto"
            value={s ? `${s.margenPct}%` : "—"}
            sub="(Precio - Costo estimado) / Precio"
            colorClass={s ? semaforo(s.margenPct, 30, 10) : ""}
            loading={summaryQ.isLoading}
          />
        </div>
      </section>

      {/* Sección 2: Alertas / Acciones requeridas */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-muted-foreground uppercase tracking-wide">
          Acciones requeridas
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className={s && s.invoicesDraftCount > 0 ? "border-amber-400" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Facturas en Borrador</CardTitle>
            </CardHeader>
            <CardContent className="flex items-end justify-between">
              <span className="text-3xl font-bold">
                {summaryQ.isLoading ? "…" : (s?.invoicesDraftCount ?? 0)}
              </span>
              <Button asChild size="sm" variant="outline">
                <Link href="/finance/invoices?status=DRAFT">Ver borradores</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className={s && s.invoicesOverdueCount > 0 ? "border-red-400" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Facturas Vencidas</CardTitle>
            </CardHeader>
            <CardContent className="flex items-end justify-between">
              <span className="text-3xl font-bold">
                {summaryQ.isLoading ? "…" : (s?.invoicesOverdueCount ?? 0)}
              </span>
              <Button asChild size="sm" variant="outline">
                <Link href="/finance/invoices?status=ISSUED">Ver vencidas</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className={s && s.claimsPendingCount > 0 ? "border-amber-400" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Claims Pendientes</CardTitle>
            </CardHeader>
            <CardContent className="flex items-end justify-between">
              <span className="text-3xl font-bold">
                {summaryQ.isLoading ? "…" : (s?.claimsPendingCount ?? 0)}
              </span>
              <Button asChild size="sm" variant="outline">
                <Link href="/finance/invoices">Ver claims</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Sección 3: Tendencia ingresos */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-muted-foreground uppercase tracking-wide">
          Tendencia ingresos — últimos 6 meses
        </h2>
        <Card>
          <CardContent className="pt-4">
            {trendQ.isLoading ? (
              <div className="h-20 animate-pulse rounded bg-muted" />
            ) : trend.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin datos de facturas históricas.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 text-left font-medium text-muted-foreground">Mes</th>
                      <th className="pb-2 text-right font-medium text-muted-foreground">
                        Ingresos
                      </th>
                      <th className="pb-2 pl-4 text-left font-medium text-muted-foreground">
                        Tendencia
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((row, i) => {
                      const prev = i > 0 ? trend[i - 1]!.revenue : null;
                      const delta =
                        prev !== null && prev > 0
                          ? ((row.revenue - prev) / prev) * 100
                          : null;
                      // Sparkline simple: 1 bloque = ~$10k
                      const maxRevenue = Math.max(...trend.map((r) => r.revenue), 1);
                      const barPct = (row.revenue / maxRevenue) * 100;
                      return (
                        <tr key={row.mes} className="border-b last:border-0">
                          <td className="py-2 font-medium">{fmtMonthLabel(row.mes)}</td>
                          <td className="py-2 text-right font-mono">
                            ${fmtCurrency(row.revenue)}
                          </td>
                          <td className="py-2 pl-4">
                            <div className="flex items-center gap-2">
                              <div className="h-2 rounded bg-primary" style={{ width: `${barPct}%`, minWidth: "2px", maxWidth: "120px" }} />
                              {delta !== null ? (
                                <span
                                  className={`text-xs ${delta >= 0 ? "text-green-600" : "text-red-600"}`}
                                >
                                  {delta >= 0 ? "+" : ""}
                                  {delta.toFixed(1)}%
                                </span>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Sección 4: Top 5 centros productivos */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-muted-foreground uppercase tracking-wide">
          Top 5 centros por ingresos
        </h2>
        <Card>
          <CardContent className="pt-4">
            {topCentersQ.isLoading ? (
              <div className="h-24 animate-pulse rounded bg-muted" />
            ) : topCenters.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin movimientos en el periodo seleccionado.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 text-left font-medium text-muted-foreground">Código</th>
                      <th className="pb-2 text-left font-medium text-muted-foreground">Centro</th>
                      <th className="pb-2 text-left font-medium text-muted-foreground">Tipo</th>
                      <th className="pb-2 text-right font-medium text-muted-foreground">
                        Ingresos
                      </th>
                      <th className="pb-2 text-right font-medium text-muted-foreground">
                        Margen
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCenters.map((c) => (
                      <tr key={c.centroId} className="border-b last:border-0">
                        <td className="py-2 font-mono text-xs">{c.code}</td>
                        <td className="py-2">{c.name}</td>
                        <td className="py-2">
                          <Badge variant="secondary" className="text-xs">
                            {c.tipo}
                          </Badge>
                        </td>
                        <td className="py-2 text-right font-mono">${fmtCurrency(c.ingresos)}</td>
                        <td className={`py-2 text-right font-mono ${semaforo(c.margenPct, 30, 10)}`}>
                          {c.margenPct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Sección 5: Accesos rápidos */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-muted-foreground uppercase tracking-wide">
          Accesos rápidos
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_LINKS.map((ql) => (
            <Card key={ql.href} className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-center justify-between pt-4">
                <div>
                  <p className="font-medium">{ql.label}</p>
                  <p className="text-xs text-muted-foreground">{ql.desc}</p>
                </div>
                <Button asChild size="sm" variant="ghost">
                  <Link href={ql.href}>Ir</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
