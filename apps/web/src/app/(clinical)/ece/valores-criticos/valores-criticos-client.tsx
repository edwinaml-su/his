"use client";

/**
 * ECE — Valores críticos: bandeja de read-back (IPSG.2 ME 2).
 *
 * Remediación auditoría 2026-09-18 (P0): `eceCriticalResult` (emit desde LIS
 * result.enter + confirmReadback con PIN CC-0035 + escalación pg_cron) existía
 * completo en el server con CERO callers en la UI — el circuito de seguridad
 * del paciente era invisible para el médico tratante. Esta bandeja lo cierra:
 *
 *  · `pending` — el médico ve SUS notificaciones sin read-back (DIR/ADMIN ven
 *    todas), ordenadas por severidad y antigüedad, refetch cada 60 s.
 *  · «Confirmar read-back» — PIN de firma electrónica (mismo mecanismo que la
 *    firma de HC); el server calcula si llegó dentro del SLA.
 *
 * Dominio NTEC/JCI nuevo sin equivalente legacy (no aplica «adecuar legacy»).
 * Nota conocida (comentario del router): mientras `ece.personal_salud` no
 * tenga filas para el personal clínico, la emisión desde LIS queda inerte y
 * la bandeja estará vacía — el cableado UI queda listo para cuando se pueble.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;
type NotifRow = RouterOutput["eceCriticalResult"]["pending"]["items"][number];

type ToastState = { title: string; description?: string; variant?: "default" | "success" | "destructive" } | null;

const SEVERIDAD_BADGE: Record<string, { label: string; className: string }> = {
  crítica: { label: "Crítica", className: "bg-red-100 text-red-900 border-red-300" },
  muy_alta: { label: "Muy alta", className: "bg-amber-100 text-amber-900 border-amber-300" },
  alta: { label: "Alta", className: "bg-yellow-100 text-yellow-900 border-yellow-300" },
};

/** Payload `valor_critico` que emite LIS result.enter (shape best-effort). */
interface ValorCritico {
  testCode?: string;
  testName?: string;
  flag?: string;
  value?: number;
  unit?: string | null;
  referenceRange?: { low?: number | null; high?: number | null };
}

function minutosDesde(fecha: Date | string): number {
  return Math.round((Date.now() - new Date(fecha).getTime()) / 60_000);
}

function DetalleValor({ valor }: { valor: unknown }) {
  const v = (valor ?? {}) as ValorCritico;
  if (v.testName || v.value !== undefined) {
    return (
      <p className="text-sm">
        <b>{v.testName ?? v.testCode ?? "Resultado"}</b>
        {v.value !== undefined ? (
          <>
            {": "}
            <span className="font-semibold text-destructive">
              {v.value} {v.unit ?? ""}
            </span>
          </>
        ) : null}
        {v.flag ? <span className="ml-1 text-xs text-muted-foreground">({v.flag})</span> : null}
        {v.referenceRange && (v.referenceRange.low != null || v.referenceRange.high != null) ? (
          <span className="ml-2 text-xs text-muted-foreground">
            Ref: {v.referenceRange.low ?? "—"} – {v.referenceRange.high ?? "—"}
          </span>
        ) : null}
      </p>
    );
  }
  return <pre className="max-w-md overflow-auto text-xs text-muted-foreground">{JSON.stringify(valor)}</pre>;
}

export function ValoresCriticosClient({ roleCodes }: { roleCodes: string[] }) {
  const utils = trpc.useUtils();
  // `confirmReadback` es mcProc (MC/ESP/PHYSICIAN): DIR/ADMIN ven la bandeja
  // completa pero el read-back lo firma el médico tratante — sin esto el
  // botón era un control muerto a FORBIDDEN para los roles supervisores.
  const puedeConfirmar = roleCodes.some((r) => ["MC", "ESP", "PHYSICIAN"].includes(r));
  const [confirmar, setConfirmar] = React.useState<NotifRow | null>(null);
  const [pin, setPin] = React.useState("");
  const [toast, setToast] = React.useState<ToastState>(null);

  const pending = trpc.eceCriticalResult.pending.useQuery({ limit: 50 }, { refetchInterval: 60_000 });

  const confirm = trpc.eceCriticalResult.confirmReadback.useMutation({
    onSuccess: (r) => {
      utils.eceCriticalResult.pending.invalidate();
      setConfirmar(null);
      setPin("");
      setToast({
        title: "Read-back confirmado",
        description: r.dentroSla
          ? `Registrado a los ${r.minutosTranscurridos} min — dentro del SLA.`
          : `Registrado a los ${r.minutosTranscurridos} min — FUERA del SLA (queda trazado para IPSG.2).`,
        variant: r.dentroSla ? "success" : "destructive",
      });
    },
    onError: (err) =>
      setToast({ title: "No se pudo confirmar el read-back", description: err.message, variant: "destructive" }),
  });

  const items = pending.data?.items ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wide text-primary">
            Valores críticos — read-back pendiente (IPSG.2)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Resultados críticos notificados que aún no tienen read-back del médico tratante. La
            confirmación exige su PIN de firma electrónica y queda trazada con el tiempo transcurrido
            contra el SLA. Sin confirmación, la notificación se escala automáticamente.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {pending.error ? (
            <p role="alert" className="text-sm text-destructive">
              {pending.error.message}
            </p>
          ) : null}
          {pending.isLoading ? <p className="text-sm text-muted-foreground">Cargando bandeja…</p> : null}

          {pending.data && items.length === 0 ? (
            <p className="italic text-muted-foreground">
              Sin valores críticos pendientes de read-back. ✔
            </p>
          ) : null}

          {items.map((n) => {
            const sev = SEVERIDAD_BADGE[n.severidad] ?? SEVERIDAD_BADGE.alta!;
            const minutos = minutosDesde(n.notificado_en);
            const vencida = minutos > n.sla_min;
            return (
              <div
                key={n.id}
                data-testid="vc-notif"
                className={`space-y-1 rounded-md border border-l-4 p-3 ${
                  vencida ? "border-l-red-600" : "border-l-amber-500"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={sev.className}>
                      {sev.label}
                    </Badge>
                    {n.escalado_a_id ? (
                      <Badge variant="outline" className="text-xs">
                        Escalada
                      </Badge>
                    ) : null}
                    <span className={`text-xs ${vencida ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                      {minutos} min transcurridos · SLA {n.sla_min} min{vencida ? " · VENCIDA" : ""}
                    </span>
                  </div>
                  {puedeConfirmar ? (
                    <Button type="button" size="sm" data-testid={`vc-confirmar-${n.id}`} onClick={() => setConfirmar(n)}>
                      Confirmar read-back
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      El read-back lo firma el médico tratante.
                    </span>
                  )}
                </div>
                <DetalleValor valor={n.valor_critico} />
                <p className="text-xs text-muted-foreground">
                  Notificado: {new Date(n.notificado_en).toLocaleString("es-SV")}
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Confirmación con PIN (CC-0035 — misma firma electrónica que la HC) */}
      <Dialog open={confirmar !== null} onOpenChange={(o) => !o && setConfirmar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar read-back del valor crítico</DialogTitle>
          </DialogHeader>
          {confirmar ? (
            <div className="space-y-3 text-sm">
              <DetalleValor valor={confirmar.valor_critico} />
              <p className="text-xs text-muted-foreground">
                Al confirmar declara que recibió el resultado, lo repitió de vuelta (read-back) y asumió
                la conducta clínica correspondiente. Queda registrado con su identidad y la hora exacta.
              </p>
              <div className="space-y-1">
                <Label htmlFor="vc-pin">PIN de firma electrónica</Label>
                <Input
                  id="vc-pin"
                  type="password"
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  data-testid="vc-pin"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmar(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              data-testid="vc-confirmar-pin"
              disabled={confirm.isPending || pin.trim().length < 4}
              onClick={() => confirmar && confirm.mutate({ notificationId: confirmar.id, pin: pin.trim() })}
            >
              {confirm.isPending ? "Confirmando…" : "Firmar read-back"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast ? (
        <Toast variant={toast.variant ?? "default"} open onOpenChange={(o) => !o && setToast(null)}>
          <div className="flex flex-col gap-1">
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
          </div>
        </Toast>
      ) : null}
    </div>
  );
}
