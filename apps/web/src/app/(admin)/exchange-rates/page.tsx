"use client";

/**
 * US-1.3 — /exchange-rates — Listado paginado con filtros + acciones.
 *
 * Layout:
 *   - Header con título, descripción y dos CTAs: "Cargar BCR" (Server Action
 *     mock) y "Nueva tasa" (link al form `/exchange-rates/new`).
 *   - Card con tabla paginada y filtros (par origen/destino, tipo, rango de
 *     fechas, toggle "solo vigentes").
 *
 * El form vive en su propia ruta (`/exchange-rates/new`) en lugar de Dialog
 * porque la story pide "form crear nueva tasa" como página propia. Mantiene
 * paridad con el patrón countries (Dialog) pero la story sub-rutea para que
 * el deep-linking a "Nueva tasa" sea posible (ej. accesos directos del menú).
 */
import * as React from "react";
import Link from "next/link";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { ExchangeRateTable } from "./exchange-rate-table";
import { fetchBcrRates, type BcrRateSuggestion } from "@/app/actions/fetch-bcr-rates";

export default function ExchangeRatesPage() {
  const [bcrLoading, setBcrLoading] = React.useState(false);
  const [bcrResult, setBcrResult] = React.useState<{
    warning: string;
    rates: BcrRateSuggestion[];
  } | null>(null);
  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  const onLoadBcr = async () => {
    setBcrLoading(true);
    try {
      const res = await fetchBcrRates();
      setBcrResult({ warning: res.warning, rates: res.rates });
      setToast({
        title: "Tasas BCR cargadas (mock)",
        description: res.warning,
        variant: "default",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido al cargar BCR.";
      setToast({ title: "Error al cargar BCR", description: msg, variant: "destructive" });
    } finally {
      setBcrLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Tasas de cambio</h1>
          <p className="text-sm text-muted-foreground">
            Histórico inmutable de tipos de cambio (compra, venta, promedio, oficial, fiscal).
            Cada cambio genera un nuevo registro versionado.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onLoadBcr} disabled={bcrLoading}>
            {bcrLoading ? "Cargando…" : "Cargar BCR"}
          </Button>
          <Button asChild>
            <Link href="/exchange-rates/new">+ Nueva tasa</Link>
          </Button>
        </div>
      </div>

      {bcrResult ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sugerencias BCR (mock)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              {bcrResult.warning}
            </p>
            <ul className="space-y-1 text-sm">
              {bcrResult.rates.map((r, idx) => (
                <li key={`${r.fromIsoCode}-${r.toIsoCode}-${idx}`} className="font-mono">
                  {r.fromIsoCode} → {r.toIsoCode} · {r.rateType} · {r.rate} ·{" "}
                  <span className="text-muted-foreground">
                    {new Date(r.validFrom).toISOString().slice(0, 10)} ({r.source})
                  </span>
                  {r.note ? (
                    <span className="ml-2 text-xs text-muted-foreground">— {r.note}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Para persistir, usa el formulario "Nueva tasa" copiando los valores deseados.
              La importación batch llegará en Sprint 5 con la integración real.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Registros</CardTitle>
        </CardHeader>
        <CardContent>
          <ExchangeRateTable />
        </CardContent>
      </Card>

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
