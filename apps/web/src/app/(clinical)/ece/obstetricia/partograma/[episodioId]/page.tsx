"use client";

/**
 * ECE — Partograma OMS por episodio obstétrico (NTEC Doc 14).
 *
 * Renderiza:
 *   - Gráfico SVG con curvas alerta (naranja) y acción (rojo) OMS.
 *   - Puntos de dilatación registrados sobre la línea de tiempo.
 *   - Zona coloreada según alerta_oms del último punto.
 *   - Formulario de nueva lectura.
 *
 * Curvas OMS graficadas:
 *   X-axis: horas (0-12 h, resolución 1 h).
 *   Y-axis: dilatación cervical 0-10 cm.
 *   Curva alerta: empieza en (0, 4) y sube 1 cm/hora → punto (8, 10) "completa".
 *   Curva acción: desplazada 4 horas a la derecha → empieza en (4, 4).
 */
import * as React from "react";
import { use } from "react";
import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

// ─── Constantes SVG ──────────────────────────────────────────────────────────

const SVG_W = 720;
const SVG_H = 340;
const PAD = { top: 24, right: 32, bottom: 48, left: 56 };
const PLOT_W = SVG_W - PAD.left - PAD.right;
const PLOT_H = SVG_H - PAD.top - PAD.bottom;

// Dominio: 0-12 horas en X, 0-10 cm en Y
const MAX_H = 12;
const MAX_CM = 10;

function xScale(h: number): number {
  return PAD.left + (h / MAX_H) * PLOT_W;
}
function yScale(cm: number): number {
  return PAD.top + PLOT_H - (cm / MAX_CM) * PLOT_H;
}

// Curva alerta OMS: (0,4) → (6,10) a 1 cm/hora
const ALERTA_POINTS = Array.from({ length: 7 }, (_, i) => ({
  h: i,
  cm: 4 + i,
})).filter((p) => p.cm <= 10);

// Curva acción OMS: desplazada 4 horas (0,4) → empieza en hora 4
const ACCION_POINTS = ALERTA_POINTS.map((p) => ({ h: p.h + 4, cm: p.cm }));

function pointsToPath(pts: { h: number; cm: number }[]): string {
  return pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.h)} ${yScale(p.cm)}`)
    .join(" ");
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface RegistroRow {
  id: string;
  registrado_en: string;
  dilatacion_cm: string;
  frecuencia_cardiaca_fetal: number | null;
  contracciones_10min: number | null;
  intensidad: string | null;
  dolor_paciente: number | null;
  alerta_oms: "normal" | "zona_alerta" | "zona_accion";
  observaciones: string | null;
}

// ─── Helpers UI ──────────────────────────────────────────────────────────────

const ALERTA_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  normal: { label: "Normal", variant: "default" },
  zona_alerta: { label: "Zona Alerta", variant: "secondary" },
  zona_accion: { label: "Zona Acción — Distocia", variant: "destructive" },
};

function AlertaBadge({ alerta }: { alerta: string }) {
  const cfg = ALERTA_BADGE[alerta] ?? ALERTA_BADGE["normal"]!;
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

// ─── Componente SVG ──────────────────────────────────────────────────────────

function PartogramaChart({
  registros,
  baseTime,
}: {
  registros: RegistroRow[];
  baseTime: Date | null;
}) {
  const alertaPath = pointsToPath(ALERTA_POINTS);
  const accionPath = pointsToPath(ACCION_POINTS);

  // Puntos del paciente en coordenadas SVG
  const patientPoints = baseTime
    ? registros.map((r) => {
        const t = new Date(r.registrado_en);
        const horasDesdeBase = (t.getTime() - baseTime.getTime()) / 3_600_000;
        const cm = Number(r.dilatacion_cm);
        return {
          x: xScale(Math.min(horasDesdeBase, MAX_H)),
          y: yScale(Math.min(cm, MAX_CM)),
          alerta: r.alerta_oms,
          label: `${cm} cm`,
        };
      })
    : [];

  const dotColor = (alerta: string): string => {
    if (alerta === "zona_accion") return "#dc2626"; // red-600
    if (alerta === "zona_alerta") return "#ea580c"; // orange-600
    return "#16a34a"; // green-600
  };

  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      width="100%"
      aria-label="Partograma OMS — Curva de dilatación cervical"
      role="img"
    >
      {/* Grid horizontal cada 2 cm */}
      {[0, 2, 4, 6, 8, 10].map((cm) => (
        <g key={cm}>
          <line
            x1={PAD.left}
            y1={yScale(cm)}
            x2={SVG_W - PAD.right}
            y2={yScale(cm)}
            stroke="#e5e7eb"
            strokeWidth="1"
          />
          <text
            x={PAD.left - 8}
            y={yScale(cm) + 4}
            fontSize="10"
            textAnchor="end"
            fill="#6b7280"
          >
            {cm}
          </text>
        </g>
      ))}

      {/* Grid vertical cada 1 hora */}
      {Array.from({ length: MAX_H + 1 }, (_, h) => h).map((h) => (
        <g key={h}>
          <line
            x1={xScale(h)}
            y1={PAD.top}
            x2={xScale(h)}
            y2={SVG_H - PAD.bottom}
            stroke="#e5e7eb"
            strokeWidth={h % 2 === 0 ? "1" : "0.5"}
          />
          <text
            x={xScale(h)}
            y={SVG_H - PAD.bottom + 16}
            fontSize="10"
            textAnchor="middle"
            fill="#6b7280"
          >
            {h}h
          </text>
        </g>
      ))}

      {/* Área entre curvas (zona alerta/acción) */}
      <path
        d={`${alertaPath} L ${xScale(10)} ${yScale(4)} L ${xScale(4)} ${yScale(4)} Z`}
        fill="#fed7aa"
        opacity="0.35"
      />
      <path
        d={`${accionPath} L ${xScale(SVG_W)} ${yScale(4)} L ${xScale(4)} ${yScale(4)} Z`}
        fill="#fecaca"
        opacity="0.3"
      />

      {/* Curva alerta (naranja) */}
      <path
        d={alertaPath}
        fill="none"
        stroke="#ea580c"
        strokeWidth="2"
        strokeDasharray="6 3"
      />
      <text
        x={xScale(ALERTA_POINTS[ALERTA_POINTS.length - 1]!.h) + 4}
        y={yScale(ALERTA_POINTS[ALERTA_POINTS.length - 1]!.cm) - 4}
        fontSize="9"
        fill="#ea580c"
      >
        Alerta
      </text>

      {/* Curva acción (rojo) */}
      <path
        d={accionPath}
        fill="none"
        stroke="#dc2626"
        strokeWidth="2"
        strokeDasharray="4 2"
      />
      <text
        x={xScale(ACCION_POINTS[ACCION_POINTS.length - 1]!.h) + 4}
        y={yScale(ACCION_POINTS[ACCION_POINTS.length - 1]!.cm) - 4}
        fontSize="9"
        fill="#dc2626"
      >
        Acción
      </text>

      {/* Puntos del paciente */}
      {patientPoints.map((pt, idx) => (
        <g key={idx}>
          <circle
            cx={pt.x}
            cy={pt.y}
            r={5}
            fill={dotColor(pt.alerta)}
            stroke="white"
            strokeWidth="1.5"
          />
          <text
            x={pt.x + 7}
            y={pt.y + 4}
            fontSize="9"
            fill={dotColor(pt.alerta)}
          >
            {pt.label}
          </text>
        </g>
      ))}

      {/* Línea del paciente */}
      {patientPoints.length > 1 && (
        <path
          d={patientPoints
            .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
            .join(" ")}
          fill="none"
          stroke="#2563eb"
          strokeWidth="2"
        />
      )}

      {/* Ejes */}
      <line
        x1={PAD.left}
        y1={PAD.top}
        x2={PAD.left}
        y2={SVG_H - PAD.bottom}
        stroke="#374151"
        strokeWidth="1.5"
      />
      <line
        x1={PAD.left}
        y1={SVG_H - PAD.bottom}
        x2={SVG_W - PAD.right}
        y2={SVG_H - PAD.bottom}
        stroke="#374151"
        strokeWidth="1.5"
      />

      {/* Labels ejes */}
      <text
        x={PAD.left - 40}
        y={PAD.top + PLOT_H / 2}
        fontSize="11"
        fill="#374151"
        transform={`rotate(-90, ${PAD.left - 40}, ${PAD.top + PLOT_H / 2})`}
        textAnchor="middle"
      >
        Dilatación (cm)
      </text>
      <text
        x={PAD.left + PLOT_W / 2}
        y={SVG_H - 4}
        fontSize="11"
        fill="#374151"
        textAnchor="middle"
      >
        Tiempo desde fase activa (horas)
      </text>
    </svg>
  );
}

// ─── Formulario nueva lectura ─────────────────────────────────────────────────

interface FormState {
  docObstetricoId: string;
  dilatacionCm: string;
  borramientoPct: string;
  fcf: string;
  contracciones: string;
  dolor: string;
  observaciones: string;
}

function NuevaLecturaForm({
  episodioId,
  docObstetricoId,
  onSuccess,
}: {
  episodioId: string;
  docObstetricoId: string;
  onSuccess: () => void;
}) {
  const [form, setForm] = React.useState<FormState>({
    docObstetricoId,
    dilatacionCm: "",
    borramientoPct: "",
    fcf: "",
    contracciones: "",
    dolor: "",
    observaciones: "",
  });

  const registrar = trpc.ecePartograma.registrar.useMutation({
    onSuccess,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    registrar.mutate({
      docObstetricoId,
      episodioId,
      dilatacionCm: Number(form.dilatacionCm),
      borramientoPct: form.borramientoPct ? Number(form.borramientoPct) : undefined,
      frecuenciaCardiacaFetal: form.fcf ? Number(form.fcf) : undefined,
      contracciones10min: form.contracciones ? Number(form.contracciones) : undefined,
      dolorPaciente: form.dolor ? Number(form.dolor) : undefined,
      observaciones: form.observaciones || undefined,
    });
  }

  function field(
    key: keyof FormState,
    label: string,
    type = "number",
    placeholder = "",
  ) {
    return (
      <div className="space-y-1">
        <Label htmlFor={key}>{label}</Label>
        <Input
          id={key}
          type={type}
          placeholder={placeholder}
          value={form[key]}
          onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
        />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {field("dilatacionCm", "Dilatación (cm) *", "number", "0-10")}
      {field("borramientoPct", "Borramiento (%)", "number", "0-100")}
      {field("fcf", "FCF (lpm)", "number", "60-200")}
      {field("contracciones", "Contracciones /10min", "number", "0-10")}
      {field("dolor", "Dolor EVA (0-10)", "number", "0-10")}
      <div className="col-span-2 space-y-1 sm:col-span-3">
        <Label htmlFor="observaciones">Observaciones</Label>
        <Input
          id="observaciones"
          type="text"
          value={form.observaciones}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, observaciones: e.target.value }))
          }
        />
      </div>
      <div className="col-span-2 sm:col-span-3">
        <Button
          type="submit"
          disabled={!form.dilatacionCm || registrar.isPending}
        >
          {registrar.isPending ? "Registrando..." : "Registrar lectura"}
        </Button>
        {registrar.error && (
          <p className="mt-1 text-sm text-destructive">
            {registrar.error.message}
          </p>
        )}
      </div>
    </form>
  );
}

// ─── Page principal ──────────────────────────────────────────────────────────

export default function PartogramaPage({
  params,
}: {
  params: Promise<{ episodioId: string }>;
}) {
  const { episodioId } = use(params);

  // Buscar el documento obstétrico activo para este episodio
  const [docObstetricoId, setDocObstetricoId] = React.useState<string | null>(null);

  // Lista de registros del partograma
  const listQuery = trpc.ecePartograma.list.useQuery(
    { docObstetricoId: docObstetricoId ?? "" },
    { enabled: !!docObstetricoId },
  );

  const alertasQuery = trpc.ecePartograma.detectarAlertasOMS.useQuery(
    { docObstetricoId: docObstetricoId ?? "" },
    { enabled: !!docObstetricoId },
  );

  // TODO(@Dev fase3): obtener docObstetricoId desde episodio-hospitalario router
  // Por ahora se recibe como query param
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const id = params.get("docId");
      if (id) setDocObstetricoId(id);
    }
  }, []);

  const registros = (listQuery.data ?? []) as RegistroRow[];

  // Base OMS: primer registro en fase activa
  const baseRow = registros.find((r) => Number(r.dilatacion_cm) >= 4);
  const baseTime = baseRow ? new Date(baseRow.registrado_en) : null;

  const ultimaAlerta = registros.length > 0
    ? registros[registros.length - 1]!.alerta_oms
    : "normal";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Activity className="h-6 w-6 text-primary" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold">Partograma OMS</h1>
          <p className="text-sm text-muted-foreground">
            Episodio {episodioId} — Curva de dilatación cervical
          </p>
        </div>
        {registros.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {ultimaAlerta === "zona_accion" && (
              <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
            )}
            {ultimaAlerta === "normal" && (
              <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden="true" />
            )}
            <AlertaBadge alerta={ultimaAlerta} />
          </div>
        )}
      </div>

      {/* Alerta distocia */}
      {alertasQuery.data?.hayDistocia && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <strong>Alerta OMS:</strong> progreso de dilatación por debajo de la
          curva de acción. Evaluar intervención obstétrica.
        </div>
      )}

      {/* Gráfico partograma */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Curva de Dilatación Cervical</CardTitle>
        </CardHeader>
        <CardContent>
          {!docObstetricoId ? (
            <p className="text-sm text-muted-foreground">
              Agregue <code>?docId=&lt;uuid&gt;</code> a la URL para cargar el partograma.
            </p>
          ) : listQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : (
            <PartogramaChart registros={registros} baseTime={baseTime} />
          )}
        </CardContent>
      </Card>

      {/* Tabla de registros */}
      {registros.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registros ({registros.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Hora</th>
                    <th className="pb-2 pr-4">Dil. cm</th>
                    <th className="pb-2 pr-4">FCF</th>
                    <th className="pb-2 pr-4">Contracciones</th>
                    <th className="pb-2 pr-4">Dolor</th>
                    <th className="pb-2">Alerta</th>
                  </tr>
                </thead>
                <tbody>
                  {registros.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">
                        {new Date(r.registrado_en).toLocaleTimeString("es-SV")}
                      </td>
                      <td className="py-2 pr-4 font-semibold">
                        {Number(r.dilatacion_cm).toFixed(1)}
                      </td>
                      <td className="py-2 pr-4">
                        {r.frecuencia_cardiaca_fetal ?? "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {r.contracciones_10min != null
                          ? `${r.contracciones_10min} ${r.intensidad ?? ""}`
                          : "—"}
                      </td>
                      <td className="py-2 pr-4">{r.dolor_paciente ?? "—"}</td>
                      <td className="py-2">
                        <AlertaBadge alerta={r.alerta_oms} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Formulario nueva lectura */}
      {docObstetricoId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nueva Lectura</CardTitle>
          </CardHeader>
          <CardContent>
            <NuevaLecturaForm
              episodioId={episodioId}
              docObstetricoId={docObstetricoId}
              onSuccess={() => listQuery.refetch()}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
