"use client";

/**
 * ECE — Período Expulsivo + Alumbramiento (NTEC Doc 14).
 *
 * Muestra el cronograma visual de eventos de la sala de expulsión
 * y permite registrar nuevos eventos via `ecePeriodoExpulsivo.registrarEvento`.
 *
 * No crea sidebar item — es funcionalidad integrada en el flujo obstétrico.
 * La alerta HPP (alumbramiento > 30 min post-nacimiento) se muestra inline
 * con banner rojo si el servidor emitió alertaHPP:true en la respuesta.
 */
import * as React from "react";
import { use } from "react";
import {
  AlertTriangle,
  Baby,
  CheckCircle2,
  Circle,
  Clock,
  Droplets,
  Scissors,
  Zap,
} from "lucide-react";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

// ─── Tipos locales ────────────────────────────────────────────────────────────

type TipoEvento =
  | "inicio_pujos"
  | "posicion_madre_cambio"
  | "amniotomia"
  | "episiotomia"
  | "desgarro"
  | "nacimiento"
  | "alumbramiento"
  | "sangrado_anormal";

interface Evento {
  id: string;
  tipo: TipoEvento;
  timestamp: string;
  nota?: string;
}

// ─── Helpers visuales ─────────────────────────────────────────────────────────

const TIPO_CONFIG: Record<TipoEvento, { label: string; icon: React.ReactNode; color: string }> = {
  inicio_pujos: {
    label: "Inicio de pujos",
    icon: <Zap className="h-4 w-4" />,
    color: "text-blue-600",
  },
  posicion_madre_cambio: {
    label: "Cambio de posición",
    icon: <Circle className="h-4 w-4" />,
    color: "text-slate-600",
  },
  amniotomia: {
    label: "Amniotomía",
    icon: <Scissors className="h-4 w-4" />,
    color: "text-amber-600",
  },
  episiotomia: {
    label: "Episiotomía",
    icon: <Scissors className="h-4 w-4" />,
    color: "text-orange-600",
  },
  desgarro: {
    label: "Desgarro perineal",
    icon: <AlertTriangle className="h-4 w-4" />,
    color: "text-orange-700",
  },
  nacimiento: {
    label: "Nacimiento",
    icon: <Baby className="h-4 w-4" />,
    color: "text-green-700",
  },
  alumbramiento: {
    label: "Alumbramiento",
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: "text-green-600",
  },
  sangrado_anormal: {
    label: "Sangrado anormal",
    icon: <Droplets className="h-4 w-4" />,
    color: "text-red-600",
  },
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-SV", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ─── Componente timeline ───────────────────────────────────────────────────────

function EventoTimeline({ eventos }: { eventos: Evento[] }) {
  if (eventos.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Sin eventos registrados aún.
      </p>
    );
  }

  const sorted = [...eventos].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  return (
    <ol className="relative ml-4 border-l border-border">
      {sorted.map((ev) => {
        const cfg = TIPO_CONFIG[ev.tipo] ?? {
          label: ev.tipo,
          icon: <Circle className="h-4 w-4" />,
          color: "text-slate-500",
        };
        return (
          <li key={ev.id} className="mb-6 ml-6">
            <span
              className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full border bg-background ring-8 ring-background ${cfg.color}`}
            >
              {cfg.icon}
            </span>
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-sm font-semibold leading-none">{cfg.label}</p>
                {ev.nota && (
                  <p className="mt-1 text-xs text-muted-foreground">{ev.nota}</p>
                )}
              </div>
              <Badge variant="outline" className="shrink-0 gap-1 text-xs">
                <Clock className="h-3 w-3" />
                {formatTime(ev.timestamp)}
              </Badge>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Formulario registro evento ────────────────────────────────────────────────

function RegistrarEventoForm({ salaId }: { salaId: string }) {
  const [tipo, setTipo] = React.useState<TipoEvento>("inicio_pujos");
  const [nota, setNota] = React.useState("");
  const [alertaHPP, setAlertaHPP] = React.useState(false);
  const utils = trpc.useUtils();

  const registrar = trpc.ecePeriodoExpulsivo.registrarEvento.useMutation({
    onSuccess: (data) => {
      if (data.alertaHPP) setAlertaHPP(true);
      setNota("");
      void utils.ecePeriodoExpulsivo.listEventos.invalidate({ salaId });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    registrar.mutate({ salaId, tipo, nota: nota.trim() || undefined });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {alertaHPP && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>Alerta HPP:</strong> el alumbramiento supera los 30 min post-nacimiento.
            Considerar protocolo de hemorragia postparto.
          </span>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="tipo-evento">Tipo de evento</Label>
        <Select
          value={tipo}
          onValueChange={(v) => setTipo(v as TipoEvento)}
        >
          <SelectTrigger id="tipo-evento">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TIPO_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>
                {cfg.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="nota-evento">Nota (opcional)</Label>
        <Textarea
          id="nota-evento"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          maxLength={500}
          placeholder="Observación clínica..."
          rows={2}
        />
      </div>

      <Button type="submit" disabled={registrar.isPending} className="w-full">
        {registrar.isPending ? "Registrando..." : "Registrar evento"}
      </Button>

      {registrar.isError && (
        <p className="text-sm text-destructive">{registrar.error.message}</p>
      )}
    </form>
  );
}

// ─── Página principal ──────────────────────────────────────────────────────────

export default function ExpulsionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: salaId } = use(params);

  const salaQuery = trpc.ecePeriodoExpulsivo.get.useQuery({ id: salaId });
  const eventosQuery = trpc.ecePeriodoExpulsivo.listEventos.useQuery({ salaId });

  if (salaQuery.isLoading || eventosQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Cargando...
      </div>
    );
  }

  if (salaQuery.isError) {
    return (
      <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
        {salaQuery.error.message}
      </div>
    );
  }

  const sala = salaQuery.data!;
  const eventos = (eventosQuery.data ?? []) as Evento[];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Período Expulsivo</h1>
        <p className="text-sm text-muted-foreground">
          NTEC Doc 14 — Sala de Expulsión
        </p>
      </div>

      {/* Datos principales */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos del parto</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <p className="font-medium text-muted-foreground">Tipo de parto</p>
            <p className="capitalize">{sala.tipo_parto.replace("_", " ")}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Nacimiento</p>
            <p>{sala.nacimiento_ts ? formatTime(new Date(sala.nacimiento_ts).toISOString()) : "—"}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Alumbramiento</p>
            <p>{sala.alumbramiento_ts ? formatTime(new Date(sala.alumbramiento_ts).toISOString()) : "Pendiente"}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Episiotomía</p>
            <p>{sala.episiotomia ? "Sí" : "No"}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Sangrado est.</p>
            <p>{sala.sangrado_estimado_ml != null ? `${sala.sangrado_estimado_ml} mL` : "—"}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Estado</p>
            <Badge variant={sala.estado_registro === "firmado" ? "default" : "secondary"}>
              {sala.estado_registro}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cronograma de eventos</CardTitle>
        </CardHeader>
        <CardContent>
          <EventoTimeline eventos={eventos} />
        </CardContent>
      </Card>

      {/* Formulario solo si no está firmado */}
      {sala.estado_registro !== "firmado" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registrar evento</CardTitle>
          </CardHeader>
          <CardContent>
            <RegistrarEventoForm salaId={salaId} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
