"use client";

/**
 * CC-0042 — Worklist / tablero de supervisión de terapia respiratoria
 * (mockup MOCK-HIS-TR-001, tab «Worklist del turno»). Un row por SESIÓN
 * (RespiratoryOrderItem) con semáforo SLA parametrizado (TrSlaConfig).
 *
 * Ejecutar ⇒ el cargo se devenga en ese momento (RN-TR-24: precio por lista
 * del tipo de cuenta con fallback a la tarifa base del catálogo) y la
 * CareTask del área se cumple. No ejecutada ⇒ causa codificada (Anexo B),
 * SIN cargo. Vista de área — no requiere cuenta seleccionada.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
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
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";
import { TR_CAUSAS_NO_EJECUCION } from "@his/contracts";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;
type SupervisionTr = RouterOutput["respiratory"]["tr"]["supervision"];
type RowTr = SupervisionTr["rows"][number];
type SlaEstado = RowTr["slaEstado"];

const ALL = "__ALL__";

const SLA_PILL: Record<SlaEstado, { label: string; background: string; color: string }> = {
  EN_TIEMPO: { label: "En tiempo", background: "#d1fae5", color: "#065f46" },
  POR_VENCER: { label: "Por vencer", background: "#fef3c7", color: "#92400e" },
  VENCIDO: { label: "Vencida", background: "#fee2e2", color: "#991b1b" },
  CUMPLIDO_A_TIEMPO: { label: "Cumplida a tiempo", background: "#d1fae5", color: "#065f46" },
  CUMPLIDO_TARDE: { label: "Cumplida tarde", background: "#fee2e2", color: "#b3261e" },
};

const ESTADO_LABEL: Record<string, string> = {
  PROGRAMADA: "Programada",
  EJECUTADA: "Ejecutada",
  NO_EJECUTADA: "No ejecutada",
  CANCELADA: "Cancelada",
};

const PRIO_LABEL: Record<string, string> = { ROUTINE: "Rutina", URGENT: "Urgente", STAT: "STAT" };

type ToastState = { title: string; description?: string; variant?: "default" | "success" | "destructive" } | null;

function hora(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-SV", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function WorklistTr(): React.ReactElement {
  const utils = trpc.useUtils();
  const [search, setSearch] = React.useState("");
  const [slaEstado, setSlaEstado] = React.useState<SlaEstado | "">("");
  const [incluirCompletados, setIncluirCompletados] = React.useState(true);
  const [cerrar, setCerrar] = React.useState<{ row: RowTr; resultado: "EJECUTADA" | "NO_EJECUTADA" } | null>(null);
  const [causa, setCausa] = React.useState<string>(TR_CAUSAS_NO_EJECUCION[0]);
  const [obs, setObs] = React.useState("");
  const [toast, setToast] = React.useState<ToastState>(null);

  const query = trpc.respiratory.tr.supervision.useQuery(
    {
      ...(search.trim() && { search: search.trim() }),
      ...(slaEstado && { slaEstado }),
      incluirCompletados,
      limit: 200,
    },
    { refetchInterval: 60_000 },
  );
  const data = query.data;

  const ejecutar = trpc.respiratory.tr.sesion.ejecutar.useMutation({
    onSuccess: (r, vars) => {
      utils.respiratory.tr.supervision.invalidate();
      setCerrar(null);
      setObs("");
      if (vars.resultado === "EJECUTADA") {
        setToast({
          title: "Sesión ejecutada y firmada",
          description:
            r.cargoStatus === "VIGENTE"
              ? `Cargo de $${(r.unitPrice ?? 0).toFixed(2)} devengado en la cuenta.`
              : "Cargo registrado PENDIENTE DE TARIFA — parametrice el precio del procedimiento.",
          variant: "success",
        });
      } else {
        setToast({ title: "Sesión cerrada como no ejecutada — sin cargo generado." });
      }
    },
    onError: (err) => setToast({ title: "No se pudo cerrar la sesión", description: err.message, variant: "destructive" }),
  });

  const kpiChips = data
    ? [
        { label: "Programadas", value: data.kpis.programadas, background: "#eef4f5", color: "#2a4650" },
        { ...SLA_PILL.CUMPLIDO_A_TIEMPO, label: "Ejecutadas", value: data.kpis.ejecutadas },
        { label: "No ejecutadas", value: data.kpis.noEjecutadas, background: "#e5e7eb", color: "#374151" },
        { ...SLA_PILL.POR_VENCER, label: "Por vencer", value: data.kpis.porVencer },
        { ...SLA_PILL.VENCIDO, label: "Vencidas", value: data.kpis.vencidas },
      ]
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm uppercase tracking-wide text-primary">
          Worklist / supervisión de terapia respiratoria
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {kpiChips.map((k) => (
            <div
              key={k.label}
              data-testid="tr-kpi"
              className="rounded-lg border px-3 py-1.5 text-xs"
              style={{ backgroundColor: k.background, color: k.color }}
            >
              <b className="text-sm tabular-nums">{k.value}</b> {k.label}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="max-w-xs"
            placeholder="Buscar paciente, cuenta o procedimiento..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={slaEstado || ALL} onValueChange={(v) => setSlaEstado(v === ALL ? "" : (v as SlaEstado))}>
            <SelectTrigger className="w-48" aria-label="Filtrar por cumplimiento SLA">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los SLA</SelectItem>
              {(Object.keys(SLA_PILL) as SlaEstado[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {SLA_PILL[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
            <input type="checkbox" checked={incluirCompletados} onChange={(e) => setIncluirCompletados(e.target.checked)} />
            Incluir cerradas
          </label>
        </div>

        {query.error ? (
          <p role="alert" className="text-sm text-destructive">
            {query.error.message}
          </p>
        ) : null}
        {query.isLoading ? <p className="text-sm text-muted-foreground">Cargando worklist…</p> : null}

        {data ? (
          data.rows.length === 0 ? (
            <p className="italic text-muted-foreground">Sin sesiones para estos filtros.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.rows.map((r) => {
                const pill = SLA_PILL[r.slaEstado];
                const abierta = r.estado === "PROGRAMADA";
                return (
                  <div
                    key={r.itemId}
                    data-testid="tr-task"
                    className="space-y-2 rounded-md border border-l-4 p-3 text-sm"
                    style={{ borderLeftColor: pill.color }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{r.paciente.nombre}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.paciente.expediente ?? "—"}
                          {r.cuenta ? ` · ${r.cuenta}` : ""} ·{" "}
                          {r.atencion === "HOSPITALARIO" ? "Hospitalario" : "Ambulatorio"}
                        </p>
                      </div>
                      <span
                        className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
                        style={{ backgroundColor: pill.background, color: pill.color }}
                      >
                        {abierta ? pill.label : ESTADO_LABEL[r.estado]}
                      </span>
                    </div>
                    <p>
                      <b>{r.procedimiento}</b>
                      {r.medicamento ? (
                        <span className="block text-xs text-muted-foreground">
                          {String((r.medicamento as { nombre?: unknown }).nombre ?? "")} ·{" "}
                          {String((r.medicamento as { dosis?: unknown }).dosis ?? "")}{" "}
                          {String((r.medicamento as { unidad?: unknown }).unidad ?? "")} ·{" "}
                          {String((r.medicamento as { frecuencia?: unknown }).frecuencia ?? "")}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {PRIO_LABEL[r.prioridad]} · {r.dx ?? "—"} · Vence: {hora(r.dueAt)}
                      {r.estado === "NO_EJECUTADA" ? ` · Causa: ${r.causaNoEjecucion}` : ""}
                      {r.estado === "EJECUTADA" && !r.cargoId ? " · ⚠ sin cargo" : ""}
                    </p>
                    {abierta ? (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          data-testid={`tr-ejecutar-${r.codigo}`}
                          onClick={() => setCerrar({ row: r, resultado: "EJECUTADA" })}
                        >
                          Ejecutar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setCerrar({ row: r, resultado: "NO_EJECUTADA" })}
                        >
                          No ejecutada
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )
        ) : null}
      </CardContent>

      {/* Cierre de sesión (ejecutar / no ejecutada) */}
      <Dialog open={cerrar !== null} onOpenChange={(o) => !o && setCerrar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {cerrar?.resultado === "EJECUTADA" ? "Firmar sesión ejecutada" : "Registrar no ejecución"}
            </DialogTitle>
          </DialogHeader>
          {cerrar ? (
            <div className="space-y-3 text-sm">
              <p>
                <b>{cerrar.row.procedimiento}</b> — {cerrar.row.paciente.nombre}
              </p>
              {cerrar.resultado === "EJECUTADA" ? (
                <p className="text-xs text-muted-foreground">
                  Al firmar se devenga el cargo a la cuenta (precio por lista del tipo de cuenta; sin tarifa
                  resoluble queda PENDIENTE DE TARIFA, nunca $0). Registro inmutable.
                </p>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="tr-causa">Causa codificada (Anexo B) — obligatoria, no genera cargo</Label>
                  <Select value={causa} onValueChange={setCausa}>
                    <SelectTrigger id="tr-causa">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TR_CAUSAS_NO_EJECUCION.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="tr-cerrar-obs">Observaciones</Label>
                <Textarea id="tr-cerrar-obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCerrar(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              data-testid="tr-confirmar-cierre"
              disabled={ejecutar.isPending}
              onClick={() =>
                cerrar &&
                ejecutar.mutate({
                  itemId: cerrar.row.itemId,
                  resultado: cerrar.resultado,
                  ...(cerrar.resultado === "NO_EJECUTADA"
                    ? { causaNoEjecucion: causa as (typeof TR_CAUSAS_NO_EJECUCION)[number] }
                    : {}),
                  ...(obs.trim() ? { observaciones: obs.trim() } : {}),
                })
              }
            >
              {ejecutar.isPending ? "Guardando…" : cerrar?.resultado === "EJECUTADA" ? "Firmar y devengar" : "Registrar"}
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
    </Card>
  );
}
