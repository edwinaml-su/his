"use client";

/**
 * ECE — Detalle del Registro Anestésico Intraoperatorio.
 *
 * Secciones:
 *   1. Datos generales (ASA / tipo / vía / balance)
 *   2. Timeline SVG de signos vitales intraop
 *   3. Tabla de medicamentos administrados
 *   4. Acciones: registrar signo vital, firmar
 *
 * Rol habilitado: ESP (firmar), PHYSICIAN/NURSE (solo lectura).
 */

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos locales (reflejo del JSONB)
// ---------------------------------------------------------------------------

interface SignoVitalIntraop {
  ts: string;
  ta_sistolica?: number;
  ta_diastolica?: number;
  fc?: number;
  fr?: number;
  spo2?: number;
  etco2?: number;
}

interface MedicamentoAdministrado {
  nombre: string;
  dosis: string;
  via: string;
  hora_administracion: string;
}

// ---------------------------------------------------------------------------
// Timeline SVG
// ---------------------------------------------------------------------------

const SV_HEIGHT = 180;
const SV_WIDTH = 600;
const PADDING = { top: 20, right: 20, bottom: 30, left: 40 };

type SignoKey = "ta_sistolica" | "ta_diastolica" | "fc" | "spo2" | "etco2";

const SERIES: {
  key: SignoKey;
  label: string;
  color: string;
  min: number;
  max: number;
}[] = [
  { key: "ta_sistolica", label: "TAS", color: "#ef4444", min: 60, max: 200 },
  { key: "ta_diastolica", label: "TAD", color: "#f97316", min: 40, max: 130 },
  { key: "fc", label: "FC", color: "#3b82f6", min: 30, max: 180 },
  { key: "spo2", label: "SpO2", color: "#22c55e", min: 80, max: 100 },
  { key: "etco2", label: "EtCO2", color: "#a855f7", min: 20, max: 60 },
];

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function SignoVitalTimeline({ data }: { data: SignoVitalIntraop[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        Sin puntos de signos vitales registrados.
      </p>
    );
  }

  const inner = {
    w: SV_WIDTH - PADDING.left - PADDING.right,
    h: SV_HEIGHT - PADDING.top - PADDING.bottom,
  };

  const sorted = [...data].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );
  const tMin = new Date(sorted[0]!.ts).getTime();
  const tMax = new Date(sorted[sorted.length - 1]!.ts).getTime();
  const tRange = tMax - tMin || 1;

  function xOf(ts: string) {
    return ((new Date(ts).getTime() - tMin) / tRange) * inner.w + PADDING.left;
  }

  function yOf(value: number, min: number, max: number) {
    const norm = (clamp(value, min, max) - min) / (max - min);
    return PADDING.top + inner.h * (1 - norm);
  }

  const timeFmt = new Intl.DateTimeFormat("es-SV", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Tick marks en el eje X (hasta 6 ticks)
  const tickCount = Math.min(sorted.length, 6);
  const ticks =
    tickCount <= 1
      ? sorted
      : Array.from({ length: tickCount }, (_, i) =>
          sorted[Math.round((i * (sorted.length - 1)) / (tickCount - 1))]!,
        );

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${SV_WIDTH} ${SV_HEIGHT}`}
        className="w-full max-w-full"
        aria-label="Timeline de signos vitales intraoperatorios"
        role="img"
      >
        {/* Grid horizontal */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = PADDING.top + inner.h * f;
          return (
            <line
              key={f}
              x1={PADDING.left}
              y1={y}
              x2={PADDING.left + inner.w}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.1}
              strokeWidth={1}
            />
          );
        })}

        {/* Eje X ticks */}
        {ticks.map((pt) => {
          const x = xOf(pt.ts);
          return (
            <g key={pt.ts}>
              <line
                x1={x}
                y1={PADDING.top}
                x2={x}
                y2={PADDING.top + inner.h + 5}
                stroke="currentColor"
                strokeOpacity={0.2}
                strokeWidth={1}
              />
              <text
                x={x}
                y={SV_HEIGHT - 4}
                textAnchor="middle"
                fontSize={9}
                fill="currentColor"
                fillOpacity={0.6}
              >
                {timeFmt.format(new Date(pt.ts))}
              </text>
            </g>
          );
        })}

        {/* Series */}
        {SERIES.map(({ key, color, min, max, label }) => {
          const pts = sorted.filter((p) => p[key] !== undefined);
          if (pts.length < 2) {
            // Solo puntos individuales
            return pts.map((p) => (
              <circle
                key={`${key}-${p.ts}`}
                cx={xOf(p.ts)}
                cy={yOf(p[key]!, min, max)}
                r={3}
                fill={color}
                aria-label={`${label}: ${p[key]}`}
              />
            ));
          }

          const d = pts
            .map((p, i) => {
              const x = xOf(p.ts);
              const y = yOf(p[key]!, min, max);
              return `${i === 0 ? "M" : "L"} ${x} ${y}`;
            })
            .join(" ");

          return (
            <g key={key}>
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {pts.map((p) => (
                <circle
                  key={p.ts}
                  cx={xOf(p.ts)}
                  cy={yOf(p[key]!, min, max)}
                  r={2.5}
                  fill={color}
                />
              ))}
            </g>
          );
        })}
      </svg>

      {/* Leyenda */}
      <div className="mt-2 flex flex-wrap gap-3">
        {SERIES.map(({ key, label, color }) => (
          <span key={key} className="flex items-center gap-1 text-xs">
            <span
              className="inline-block h-2.5 w-4 rounded-sm"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulario agregar signo vital
// ---------------------------------------------------------------------------

interface AgregarSignoVitalFormProps {
  registroId: string;
  onSuccess: () => void;
}

function AgregarSignoVitalForm({
  registroId,
  onSuccess,
}: AgregarSignoVitalFormProps) {
  const [ts, setTs] = React.useState(() => {
    const now = new Date();
    // Formato datetime-local: YYYY-MM-DDTHH:mm
    return now.toISOString().slice(0, 16);
  });
  const [fc, setFc] = React.useState("");
  const [tas, setTas] = React.useState("");
  const [tad, setTad] = React.useState("");
  const [spo2, setSpo2] = React.useState("");
  const [etco2, setEtco2] = React.useState("");

  const mutation = trpc.eceRegistroAnestesico.registrarSignoVital.useMutation({
    onSuccess: () => {
      onSuccess();
      setFc("");
      setTas("");
      setTad("");
      setSpo2("");
      setEtco2("");
    },
  });

  function toInt(v: string): number | undefined {
    if (v === "") return undefined;
    const n = parseInt(v, 10);
    return isNaN(n) ? undefined : n;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate({
      id: registroId,
      signoVital: {
        ts: new Date(ts).toISOString(),
        fc: toInt(fc),
        ta_sistolica: toInt(tas),
        ta_diastolica: toInt(tad),
        spo2: toInt(spo2),
        etco2: toInt(etco2),
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="space-y-1 col-span-2 sm:col-span-1">
          <Label htmlFor="sv-ts">Fecha / Hora</Label>
          <Input
            id="sv-ts"
            type="datetime-local"
            value={ts}
            onChange={(e) => setTs(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sv-tas">TAS (mmHg)</Label>
          <Input
            id="sv-tas"
            type="number"
            min={0}
            max={300}
            value={tas}
            onChange={(e) => setTas(e.target.value)}
            placeholder="120"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sv-tad">TAD (mmHg)</Label>
          <Input
            id="sv-tad"
            type="number"
            min={0}
            max={200}
            value={tad}
            onChange={(e) => setTad(e.target.value)}
            placeholder="80"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sv-fc">FC (lpm)</Label>
          <Input
            id="sv-fc"
            type="number"
            min={0}
            max={300}
            value={fc}
            onChange={(e) => setFc(e.target.value)}
            placeholder="72"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sv-spo2">SpO2 (%)</Label>
          <Input
            id="sv-spo2"
            type="number"
            min={0}
            max={100}
            value={spo2}
            onChange={(e) => setSpo2(e.target.value)}
            placeholder="98"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sv-etco2">EtCO2 (mmHg)</Label>
          <Input
            id="sv-etco2"
            type="number"
            min={0}
            max={100}
            value={etco2}
            onChange={(e) => setEtco2(e.target.value)}
            placeholder="35"
          />
        </div>
      </div>
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}
      <Button type="submit" size="sm" disabled={mutation.isPending}>
        {mutation.isPending ? "Registrando…" : "Registrar signo vital"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Page principal
// ---------------------------------------------------------------------------

const TIPO_LABEL: Record<string, string> = {
  general: "General",
  regional: "Regional",
  local: "Local",
  sedacion: "Sedación",
};
const VIA_LABEL: Record<string, string> = {
  intubacion: "Intubación OT",
  mascarilla: "Mascarilla facial",
  lma: "LMA",
};

const dtFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "short",
  timeStyle: "short",
});

export default function RegistroAnestesicoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const query = trpc.eceRegistroAnestesico.get.useQuery({ id });
  const firmarMutation = trpc.eceRegistroAnestesico.firmar.useMutation({
    onSuccess: () => query.refetch(),
  });

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }
  if (query.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {query.error.message}
      </p>
    );
  }

  const r = query.data;
  if (!r) return null;

  const signos = (r.signos_vitales_intraop as SignoVitalIntraop[]) ?? [];
  const medicamentos =
    (r.medicamentos_administrados as MedicamentoAdministrado[]) ?? [];

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">
            Registro Anestésico Intraoperatorio
          </h1>
          <p className="font-mono text-xs text-muted-foreground">{r.id}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            Volver
          </Button>
          {r.estado_registro === "borrador" && (
            <Button
              size="sm"
              onClick={() => firmarMutation.mutate({ id: r.id })}
              disabled={firmarMutation.isPending}
            >
              {firmarMutation.isPending ? "Firmando…" : "Firmar registro"}
            </Button>
          )}
        </div>
      </div>

      {firmarMutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {firmarMutation.error.message}
        </p>
      )}

      {/* Datos generales */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos generales</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Estado</p>
            <Badge
              variant={
                r.estado_registro === "firmado"
                  ? "default"
                  : r.estado_registro === "anulado"
                    ? "destructive"
                    : "secondary"
              }
              className="mt-1"
            >
              {r.estado_registro}
            </Badge>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">ASA</p>
            <p className="font-semibold tabular-nums">{r.asa}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Tipo de anestesia</p>
            <p>{TIPO_LABEL[r.tipo_anestesia] ?? r.tipo_anestesia}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Vía aérea</p>
            <p>{VIA_LABEL[r.via_aerea] ?? r.via_aerea}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fluidoterapia (ml)</p>
            <p className="tabular-nums">{r.fluidoterapia_ml ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">
              Pérdidas sanguíneas (ml)
            </p>
            <p className="tabular-nums">{r.perdidas_sanguineas_ml ?? "—"}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground">Registrado</p>
            <p className="tabular-nums">
              {dtFmt.format(new Date(r.registrado_en))}
            </p>
          </div>
          {r.complicaciones && (
            <div className="col-span-2 sm:col-span-4">
              <p className="text-xs text-muted-foreground">
                Complicaciones / Incidencias
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">
                {r.complicaciones}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timeline signos vitales */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Signos vitales intraoperatorios
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SignoVitalTimeline data={signos} />

          {r.estado_registro === "borrador" && (
            <div className="mt-6 border-t pt-4">
              <p className="mb-3 text-sm font-medium">
                Agregar punto de signos vitales
              </p>
              <AgregarSignoVitalForm
                registroId={r.id}
                onSuccess={() => query.refetch()}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabla medicamentos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Medicamentos administrados ({medicamentos.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {medicamentos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin medicamentos registrados.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Medicamento</TableHead>
                  <TableHead>Dosis</TableHead>
                  <TableHead>Vía</TableHead>
                  <TableHead>Hora</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {medicamentos.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{m.nombre}</TableCell>
                    <TableCell className="tabular-nums">{m.dosis}</TableCell>
                    <TableCell>{m.via}</TableCell>
                    <TableCell className="tabular-nums">
                      {dtFmt.format(new Date(m.hora_administracion))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Firma */}
      {r.firmado_por && r.firmado_en && (
        <Card>
          <CardContent className="pt-4 text-sm">
            <p className="text-muted-foreground">
              Firmado por personal{" "}
              <span className="font-mono">{r.firmado_por.slice(0, 8)}…</span>{" "}
              el {dtFmt.format(new Date(r.firmado_en))}.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
