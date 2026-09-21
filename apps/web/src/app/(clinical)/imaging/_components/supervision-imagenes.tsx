"use client";

/**
 * CC-0041 — Tablero de supervisión de imagenología (espejo del tablero de
 * laboratorio, extensión CC-0040). Un row por estudio (ImagingOrder), de
 * pacientes hospitalarios Y ambulatorios, con trazabilidad por hitos
 * (solicitado / programado / realizado / informado / validado) y semáforo de
 * cumplimiento contra el SLA parametrizado (`imagingRequest.sla`). Cada
 * estudio tiene su CareTask RAD_TECHNICIAN visible también en /tareas y
 * /tableros. No requiere cuenta seleccionada — vista de área.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Input } from "@his/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";
import { formatDateTime } from "@/lib/i18n/org-locale";
import { PRIO_SEGMENT, PRIO_VALUE_TO_LABEL } from "./field-rule-meta";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;
type SupervisionData = RouterOutput["imagingRequest"]["supervision"];
type SupervisionRow = SupervisionData["rows"][number];
type SlaEstado = SupervisionRow["slaEstado"];

const ALL = "__ALL__";

const SLA_PILL: Record<SlaEstado, { label: string; background: string; color: string }> = {
  EN_TIEMPO: { label: "En tiempo", background: "#d1fae5", color: "#065f46" },
  POR_VENCER: { label: "Por vencer", background: "#fef3c7", color: "#92400e" },
  VENCIDO: { label: "Vencido", background: "#fee2e2", color: "#991b1b" },
  CUMPLIDO_A_TIEMPO: { label: "Cumplido a tiempo", background: "#d1fae5", color: "#065f46" },
  CUMPLIDO_TARDE: { label: "Cumplido tarde", background: "#fee2e2", color: "#b3261e" },
};

const ETAPA_LABEL: Record<SupervisionRow["etapa"], string> = {
  SOLICITADO: "Solicitado",
  PROGRAMADO: "Programado",
  EN_PROCESO: "En proceso",
  REALIZADO: "Realizado",
  INFORMADO: "Informado",
  VALIDADO: "Validado",
};

function hora(d: Date | string | null): string {
  if (!d) return "—";
  return formatDateTime(d, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function SupervisionImagenes(): React.ReactElement {
  const [search, setSearch] = React.useState("");
  const [slaEstado, setSlaEstado] = React.useState<SlaEstado | "">("");
  const [incluirCompletados, setIncluirCompletados] = React.useState(true);

  const query = trpc.imagingRequest.supervision.useQuery(
    {
      ...(search.trim() && { search: search.trim() }),
      ...(slaEstado && { slaEstado }),
      incluirCompletados,
      limit: 200,
    },
    // Tablero operativo: el semáforo depende del reloj — refetch periódico.
    { refetchInterval: 60_000 },
  );
  const data = query.data;

  const kpiChips = data
    ? [
        { label: "Estudios", value: data.kpis.total, background: "#eef4f5", color: "#2a4650" },
        { ...SLA_PILL.EN_TIEMPO, label: "En tiempo", value: data.kpis.enTiempo },
        { ...SLA_PILL.POR_VENCER, label: "Por vencer", value: data.kpis.porVencer },
        { ...SLA_PILL.VENCIDO, label: "Vencidos", value: data.kpis.vencidos },
        { ...SLA_PILL.CUMPLIDO_A_TIEMPO, label: "Cumplidos a tiempo", value: data.kpis.cumplidosATiempo },
        { ...SLA_PILL.CUMPLIDO_TARDE, label: "Cumplidos tarde", value: data.kpis.cumplidosTarde },
      ]
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm uppercase tracking-wide text-primary">
          Supervisión de estudios de imagenología
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {kpiChips.map((k) => (
            <div
              key={k.label}
              data-testid="img-sup-kpi"
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
            placeholder="Buscar paciente, folio, cuenta o estudio..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            value={slaEstado || ALL}
            onValueChange={(v) => setSlaEstado(v === ALL ? "" : (v as SlaEstado))}
          >
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
            <input
              type="checkbox"
              checked={incluirCompletados}
              onChange={(e) => setIncluirCompletados(e.target.checked)}
            />
            Incluir completados
          </label>
        </div>

        {query.error ? (
          <p role="alert" className="text-sm text-destructive">
            {query.error.message}
          </p>
        ) : null}
        {query.isLoading ? <p className="text-sm text-muted-foreground">Cargando supervisión…</p> : null}

        {data ? (
          data.rows.length === 0 ? (
            <p className="italic text-muted-foreground">Sin estudios para estos filtros.</p>
          ) : (
            <div className="overflow-auto rounded-lg border">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-muted/60">
                    {["Paciente", "Atención", "Estudio", "Prioridad", "Etapa", "Trazabilidad", "SLA"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const pill = SLA_PILL[r.slaEstado];
                    const prioLabel = (PRIO_VALUE_TO_LABEL[r.prioridad] ?? r.prioridad) as
                      | "Rutina"
                      | "Urgente"
                      | "STAT";
                    const seg = PRIO_SEGMENT[prioLabel] ?? PRIO_SEGMENT.Rutina;
                    return (
                      <tr key={r.orderId} data-testid="img-sup-row" className="border-t align-top">
                        <td className="px-3 py-2">
                          <div className="font-semibold">{r.paciente.nombre}</div>
                          <div className="text-muted-foreground">
                            {r.paciente.expediente ?? "—"}
                            {r.cuenta ? ` · ${r.cuenta}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{
                              backgroundColor: r.atencion === "HOSPITALARIO" ? "#e2ecfb" : "#e6eef0",
                              color: r.atencion === "HOSPITALARIO" ? "#2f6fb0" : "#2a7d8c",
                            }}
                          >
                            {r.atencion === "HOSPITALARIO" ? "Hospitalario" : "Ambulatorio"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-semibold">{r.estudio}</div>
                          <div className="text-muted-foreground">
                            {r.categoria}
                            {r.folio ? ` · ${r.folio}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                            style={{ backgroundColor: seg.onBg, color: seg.onColor }}
                          >
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seg.dot }} />
                            {prioLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-semibold text-primary">{ETAPA_LABEL[r.etapa]}</td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          <div>Solicitado: {hora(r.hitos.solicitadoAt)}</div>
                          <div>Programado: {hora(r.hitos.programadoAt)}</div>
                          <div>Realizado: {hora(r.hitos.realizadoAt)}</div>
                          <div>Informado: {hora(r.hitos.informadoAt)}</div>
                          <div>Validado: {hora(r.hitos.validadoAt)}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            data-testid="img-sup-sla"
                            className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
                            style={{ backgroundColor: pill.background, color: pill.color }}
                          >
                            {pill.label}
                          </span>
                          <div className="mt-1 tabular-nums text-muted-foreground">Vence: {hora(r.dueAt)}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
