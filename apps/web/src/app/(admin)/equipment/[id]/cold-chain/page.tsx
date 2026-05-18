"use client";

/**
 * Cold Chain Monitoring — historial 24 h + alertas pendientes.
 *
 * Placeholder: sensor IoT real en F2-S15. Por ahora sólo ingreso manual.
 * Accesible vía /equipment/[id]/cold-chain (sin item en sidebar).
 */
import * as React from "react";
import { useParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos locales
// ---------------------------------------------------------------------------

interface Lectura {
  id: string;
  temperatura_c: number;
  humedad_pct: number | null;
  registrado_en: Date;
  dentro_rango: boolean;
  fuente: string;
}

interface Alerta {
  id: string;
  lectura_id: string;
  severidad: string;
  mensaje: string;
  creada_en: Date;
}

// ---------------------------------------------------------------------------
// Helpers SVG chart
// ---------------------------------------------------------------------------

const CHART_W = 600;
const CHART_H = 120;
const PAD = 10;

function TempChart({ lecturas }: { lecturas: Lectura[] }) {
  if (lecturas.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">Sin datos suficientes para graficar.</p>
    );
  }

  const temps = lecturas.map((l) => l.temperatura_c);
  const minT = Math.min(...temps);
  const maxT = Math.max(...temps);
  const rangeT = maxT - minT || 1;

  const innerW = CHART_W - PAD * 2;
  const innerH = CHART_H - PAD * 2;

  const points = lecturas.map((l, i) => {
    const x = PAD + (i / (lecturas.length - 1)) * innerW;
    const y = PAD + innerH - ((l.temperatura_c - minT) / rangeT) * innerH;
    return `${x},${y}`;
  });

  const polyline = points.join(" ");

  // Marca roja para lecturas fuera de rango
  const outPoints = lecturas.filter((l) => !l.dentro_rango);

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="w-full h-32 border rounded bg-muted/30"
      aria-label="Historial de temperatura 24 h"
    >
      {/* Eje baseline */}
      <line
        x1={PAD}
        y1={CHART_H - PAD}
        x2={CHART_W - PAD}
        y2={CHART_H - PAD}
        stroke="currentColor"
        strokeOpacity={0.3}
        strokeWidth={1}
      />
      {/* Línea de temperatura */}
      <polyline
        points={polyline}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {/* Puntos fuera de rango */}
      {outPoints.map((l) => {
        const i = lecturas.indexOf(l);
        const x = PAD + (i / (lecturas.length - 1)) * innerW;
        const y = PAD + innerH - ((l.temperatura_c - minT) / rangeT) * innerH;
        return (
          <circle key={l.id} cx={x} cy={y} r={4} fill="#ef4444">
            <title>{`${l.temperatura_c}°C — fuera de rango`}</title>
          </circle>
        );
      })}
      {/* Etiquetas min/max */}
      <text x={PAD} y={PAD + 8} fontSize={9} fill="currentColor" opacity={0.6}>
        {maxT.toFixed(1)}°C
      </text>
      <text x={PAD} y={CHART_H - 2} fontSize={9} fill="currentColor" opacity={0.6}>
        {minT.toFixed(1)}°C
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Formulario de registro manual
// ---------------------------------------------------------------------------

function RegistroForm({ equipmentId }: { equipmentId: string }) {
  const [temp, setTemp] = React.useState("");
  const [humedad, setHumedad] = React.useState("");
  const utils = trpc.useUtils();

  const { mutate, isPending, error } = trpc.coldChain.registrarLectura.useMutation({
    onSuccess: () => {
      setTemp("");
      setHumedad("");
      void utils.coldChain.listLecturasHistorial.invalidate({ equipmentId });
      void utils.coldChain.listAlertas.invalidate({ equipmentId });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const tVal = parseFloat(temp);
    if (isNaN(tVal)) return;
    mutate({
      equipmentId,
      temperaturaC: tVal,
      humedadPct: humedad ? parseFloat(humedad) : undefined,
      fuente: "manual",
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
      <div className="flex flex-col gap-1">
        <Label htmlFor="temp">Temperatura (°C)</Label>
        <Input
          id="temp"
          type="number"
          step="0.1"
          value={temp}
          onChange={(e) => setTemp(e.target.value)}
          required
          className="w-32"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="hum">Humedad (%)</Label>
        <Input
          id="hum"
          type="number"
          step="0.1"
          min="0"
          max="100"
          value={humedad}
          onChange={(e) => setHumedad(e.target.value)}
          className="w-28"
          placeholder="Opcional"
        />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Guardando..." : "Registrar lectura"}
      </Button>
      {error && (
        <p className="text-sm text-destructive w-full">{error.message}</p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ColdChainPage() {
  const params = useParams<{ id: string }>();
  const equipmentId = params.id;

  const { data: lecturas = [], isLoading: loadingLect } =
    trpc.coldChain.listLecturasHistorial.useQuery({ equipmentId });

  const { data: alertas = [], isLoading: loadingAlert } =
    trpc.coldChain.listAlertas.useQuery({ equipmentId });

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Cold Chain — Monitoreo de temperatura</h1>
      <p className="text-sm text-muted-foreground">
        Placeholder IoT. Sensor en tiempo real disponible en F2-S15. Por ahora: registro manual.
      </p>

      {/* Registro manual */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registrar lectura manual</CardTitle>
        </CardHeader>
        <CardContent>
          <RegistroForm equipmentId={equipmentId} />
        </CardContent>
      </Card>

      {/* Gráfico 24 h */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Temperatura — últimas 24 h</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingLect ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : (
            <TempChart lecturas={lecturas as Lectura[]} />
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Puntos rojos = fuera de rango configurado. Total: {lecturas.length} lectura(s).
          </p>
        </CardContent>
      </Card>

      {/* Alertas pendientes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Alertas pendientes{" "}
            {alertas.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {alertas.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingAlert ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : alertas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin alertas pendientes.</p>
          ) : (
            <ul className="space-y-2">
              {(alertas as Alerta[]).map((a) => (
                <li
                  key={a.id}
                  className="flex items-start gap-2 rounded border p-2 text-sm"
                >
                  <Badge
                    variant={a.severidad === "CRITICAL" ? "destructive" : "secondary"}
                    className="shrink-0"
                  >
                    {a.severidad}
                  </Badge>
                  <span className="flex-1">{a.mensaje}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(a.creada_en).toLocaleString("es-SV")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
