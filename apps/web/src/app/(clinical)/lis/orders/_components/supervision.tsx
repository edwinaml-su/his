"use client";

/**
 * Extensión CC-0040 (2026-09-18) — Tablero de supervisión de laboratorio.
 *
 * Un row por examen (hospitalario Y ambulatorio) con trazabilidad
 * toma→procesamiento (hitos solicitado/muestra/resultado/validado) y
 * semáforo de cumplimiento contra el SLA parametrizado por prioridad
 * (`lis.sla` — /catalogs/laboratorio pestaña SLA). Cada examen tiene su
 * CareTask (sourceType LAB_ORDER_ITEM) visible también en /tareas y
 * /tableros; este tablero es la vista de supervisión del área.
 *
 * Sin mockup entregado: pantalla derivada de la vista Estudios (mismo
 * design system operativo, MOCK_LAB_PALETTE) — patrón CC-0013b.
 */
import * as React from "react";
import { Input } from "@his/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";
import { MOCK_LAB_PALETTE as MOCK } from "../../_lib/mock-palette";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;
type SupervisionData = RouterOutput["lis"]["order"]["supervision"];
type SupervisionRow = SupervisionData["rows"][number];
type SlaEstado = SupervisionRow["slaEstado"];

const ALL = "__ALL__";

const SLA_PILL: Record<SlaEstado, { label: string; background: string; color: string }> = {
  EN_TIEMPO: { label: "En tiempo", background: "#e0f2e9", color: "#1c7a4a" },
  POR_VENCER: { label: "Por vencer", background: "#fdf1dd", color: "#b9791b" },
  VENCIDO: { label: "Vencido", background: "#f3d9d9", color: "#b3261e" },
  CUMPLIDO_A_TIEMPO: { label: "Cumplido a tiempo", background: "#e0f2e9", color: "#1c7a4a" },
  CUMPLIDO_TARDE: { label: "Cumplido tarde", background: "#fbe4e0", color: "#c0392b" },
};

const ETAPA_LABEL: Record<SupervisionRow["etapa"], string> = {
  SOLICITADO: "Solicitado",
  MUESTRA_TOMADA: "Muestra tomada",
  EN_PROCESO: "En proceso",
  RESULTADO: "Resultado",
  VALIDADO: "Validado",
};

const PRIORIDAD_LABEL: Record<SupervisionRow["prioridad"], string> = {
  ROUTINE: "Rutina",
  URGENT: "Urgente",
  STAT: "STAT",
};

function hora(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-SV", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Supervision(): React.ReactElement {
  const [search, setSearch] = React.useState("");
  const [slaEstado, setSlaEstado] = React.useState<SlaEstado | "">("");
  const [incluirCompletados, setIncluirCompletados] = React.useState(true);

  const query = trpc.lis.order.supervision.useQuery(
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
        { label: "Exámenes", value: data.kpis.total, background: MOCK.cntBg, color: "#2a4650" },
        { ...SLA_PILL.EN_TIEMPO, label: "En tiempo", value: data.kpis.enTiempo },
        { ...SLA_PILL.POR_VENCER, label: "Por vencer", value: data.kpis.porVencer },
        { ...SLA_PILL.VENCIDO, label: "Vencidos", value: data.kpis.vencidos },
        {
          ...SLA_PILL.CUMPLIDO_A_TIEMPO,
          label: "Cumplidos a tiempo",
          value: data.kpis.cumplidosATiempo,
        },
        { ...SLA_PILL.CUMPLIDO_TARDE, label: "Cumplidos tarde", value: data.kpis.cumplidosTarde },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="flex flex-wrap gap-2">
        {kpiChips.map((k) => (
          <div
            key={k.label}
            data-testid="lab-sup-kpi"
            className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ backgroundColor: k.background, color: k.color, borderColor: MOCK.line }}
          >
            <b className="text-sm tabular-nums">{k.value}</b> {k.label}
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="Buscar paciente, expediente, cuenta o examen..."
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
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm" style={{ color: MOCK.inkSoft }}>
          <input
            type="checkbox"
            checked={incluirCompletados}
            onChange={(e) => setIncluirCompletados(e.target.checked)}
            style={{ accentColor: MOCK.teal }}
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
          <p className="italic text-muted-foreground">Sin exámenes para estos filtros.</p>
        ) : (
          <div className="overflow-auto rounded-lg border" style={{ borderColor: MOCK.line }}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr style={{ backgroundColor: MOCK.cntBg }}>
                  {["Paciente", "Atención", "Examen", "Prioridad", "Etapa", "Trazabilidad", "SLA"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-semibold" style={{ color: "#2a4650" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const pill = SLA_PILL[r.slaEstado];
                  return (
                    <tr key={r.itemId} data-testid="lab-sup-row" className="border-t align-top" style={{ borderColor: "#eef1f3" }}>
                      <td className="px-3 py-2">
                        <div className="font-semibold" style={{ color: MOCK.ink }}>
                          {r.paciente.nombre}
                        </div>
                        <div style={{ color: MOCK.hintColor }}>
                          {r.paciente.expediente ?? "—"}
                          {r.cuenta ? ` · ${r.cuenta}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{
                            backgroundColor: r.atencion === "HOSPITALARIO" ? "#e2ecfb" : MOCK.secBadgeBg,
                            color: r.atencion === "HOSPITALARIO" ? "#2f6fb0" : MOCK.tealDark,
                          }}
                        >
                          {r.atencion === "HOSPITALARIO" ? "Hospitalario" : "Ambulatorio"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-semibold" style={{ color: MOCK.ink }}>
                          {r.examen}
                        </div>
                        {r.seccion ? (
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: MOCK.secBadgeBg, color: MOCK.tealDark }}
                          >
                            {r.seccion}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{PRIORIDAD_LABEL[r.prioridad]}</td>
                      <td className="px-3 py-2 font-semibold" style={{ color: MOCK.tealDark }}>
                        {ETAPA_LABEL[r.etapa]}
                      </td>
                      <td className="px-3 py-2 tabular-nums" style={{ color: MOCK.inkSoft }}>
                        <div>Solicitado: {hora(r.hitos.solicitadoAt)}</div>
                        <div>Muestra: {hora(r.hitos.muestraAt)}</div>
                        <div>Resultado: {hora(r.hitos.resultadoAt)}</div>
                        <div>Validado: {hora(r.hitos.validadoAt)}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          data-testid="lab-sup-sla"
                          className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
                          style={{ backgroundColor: pill.background, color: pill.color }}
                        >
                          {pill.label}
                        </span>
                        <div className="mt-1 tabular-nums" style={{ color: MOCK.hintColor }}>
                          Vence: {hora(r.dueAt)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
}
