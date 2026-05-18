"use client";

/**
 * ECE — Sala de Expulsión (Doc 14 NTEC).
 *
 * Cronómetro de cuatro fases:
 *   latente     → inicio de trabajo de parto (referencial, sin persistencia)
 *   activa      → inicio del período expulsivo (inicio_expulsivo_ts)
 *   expulsiva   → nacimiento registrado (nacimiento_ts)
 *   alumbramiento → expulsión de placenta (alumbramiento_ts)
 *
 * Roles: PHYSICIAN, MC (registro + firma). NURSE (solo lectura/lista).
 */

import * as React from "react";
import Link from "next/link";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos locales
// ---------------------------------------------------------------------------

type FaseCronometro = "latente" | "activa" | "expulsiva" | "alumbramiento";

const FASES: { key: FaseCronometro; label: string; color: string }[] = [
  { key: "latente", label: "Latente", color: "bg-blue-100 text-blue-800" },
  { key: "activa", label: "Activa", color: "bg-yellow-100 text-yellow-800" },
  { key: "expulsiva", label: "Expulsiva", color: "bg-orange-100 text-orange-800" },
  { key: "alumbramiento", label: "Alumbramiento", color: "bg-green-100 text-green-800" },
];

const TIPO_PARTO_OPTS = [
  { value: "eutocico", label: "Eutócico" },
  { value: "distocico", label: "Distócico" },
  { value: "cesarea_emergencia", label: "Cesárea de emergencia" },
];

const PRESENTACION_OPTS = [
  { value: "cefalica", label: "Cefálica" },
  { value: "pelvica", label: "Pélvica" },
  { value: "transversa", label: "Transversa" },
  { value: "otra", label: "Otra" },
];

const MECANISMO_OPTS = [
  { value: "espontaneo", label: "Espontáneo" },
  { value: "forceps", label: "Fórceps" },
  { value: "vacuoextractor", label: "Vacuoextractor" },
  { value: "espatulas", label: "Espátulas" },
];

// ---------------------------------------------------------------------------
// Hook cronómetro
// ---------------------------------------------------------------------------

function useCronometro() {
  const [fase, setFase] = React.useState<FaseCronometro>("latente");
  const [timestamps, setTimestamps] = React.useState<
    Partial<Record<FaseCronometro, Date>>
  >({});
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const inicio = timestamps[fase];
    if (!inicio) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - inicio.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [fase, timestamps]);

  function avanzarFase() {
    const orden: FaseCronometro[] = [
      "latente",
      "activa",
      "expulsiva",
      "alumbramiento",
    ];
    const idx = orden.indexOf(fase);
    const siguiente = orden[idx + 1];
    if (!siguiente) return;
    const ahora = new Date();
    setTimestamps((prev) => ({ ...prev, [siguiente]: ahora }));
    setFase(siguiente);
    setElapsed(0);
  }

  function iniciar() {
    setTimestamps({ latente: new Date() });
    setFase("latente");
    setElapsed(0);
  }

  return { fase, timestamps, elapsed, avanzarFase, iniciar };
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

// ---------------------------------------------------------------------------
// Formulario de registro
// ---------------------------------------------------------------------------

function RegistrarNacimientoForm({
  timestamps,
  onSuccess,
}: {
  timestamps: Partial<Record<FaseCronometro, Date>>;
  onSuccess: () => void;
}) {
  const [episodioId, setEpisodioId] = React.useState("");
  const [tipoParto, setTipoParto] = React.useState("eutocico");
  const [presentacion, setPresentacion] = React.useState("cefalica");
  const [mecanismo, setMecanismo] = React.useState("espontaneo");
  const [episiotomia, setEpisiotomia] = React.useState(false);
  const [desgarro, setDesgarro] = React.useState("");
  const [sangrado, setSangrado] = React.useState("");
  const [placentaCompleta, setPlacentaCompleta] = React.useState<string>("si");

  const mutation = trpc.eceSalaExpulsion.registrarNacimiento.useMutation({
    onSuccess,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!episodioId || !timestamps.expulsiva) return;
    mutation.mutate({
      episodioHospitalarioId: episodioId.trim(),
      tipoParto: tipoParto as "eutocico" | "distocico" | "cesarea_emergencia",
      inicioExpulsivoTs: timestamps.activa,
      nacimientoTs: timestamps.expulsiva,
      presentacionFetal: presentacion as
        | "cefalica"
        | "pelvica"
        | "transversa"
        | "otra",
      mecanismoParto: mecanismo as
        | "espontaneo"
        | "forceps"
        | "vacuoextractor"
        | "espatulas",
      episiotomia,
      desgarroPeriNealGrado: desgarro ? Number(desgarro) : undefined,
      alumbramiento_ts: timestamps.alumbramiento,
      placentaCompleta: placentaCompleta === "si",
      sangradoEstimadoMl: sangrado ? Number(sangrado) : undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="episodio-id">Episodio hospitalario (UUID)</Label>
        <Input
          id="episodio-id"
          className="font-mono text-sm"
          placeholder="xxxxxxxx-xxxx-…"
          value={episodioId}
          onChange={(e) => setEpisodioId(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Tipo de parto</Label>
          <Select value={tipoParto} onValueChange={setTipoParto}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPO_PARTO_OPTS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Presentación fetal</Label>
          <Select value={presentacion} onValueChange={setPresentacion}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESENTACION_OPTS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Mecanismo de parto</Label>
          <Select value={mecanismo} onValueChange={setMecanismo}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MECANISMO_OPTS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Integridad placentaria</Label>
          <Select value={placentaCompleta} onValueChange={setPlacentaCompleta}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="si">Completa</SelectItem>
              <SelectItem value="no">Incompleta</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="desgarro">Desgarro perineal (grado 0-4)</Label>
          <Input
            id="desgarro"
            type="number"
            min={0}
            max={4}
            value={desgarro}
            onChange={(e) => setDesgarro(e.target.value)}
            placeholder="0"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sangrado">Sangrado estimado (mL)</Label>
          <Input
            id="sangrado"
            type="number"
            min={0}
            value={sangrado}
            onChange={(e) => setSangrado(e.target.value)}
            placeholder="500"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="episiotomia"
          type="checkbox"
          checked={episiotomia}
          onChange={(e) => setEpisiotomia(e.target.checked)}
          className="h-4 w-4"
        />
        <Label htmlFor="episiotomia">Episiotomía realizada</Label>
      </div>

      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}

      <Button
        type="submit"
        disabled={mutation.isPending || !timestamps.expulsiva || !episodioId}
      >
        {mutation.isPending ? "Registrando…" : "Registrar nacimiento"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Tabla de registros
// ---------------------------------------------------------------------------

const dtFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "short",
  timeStyle: "short",
});

function EstadoBadge({ estado }: { estado: string }) {
  const variant =
    estado === "firmado"
      ? ("default" as const)
      : ("secondary" as const);
  return (
    <Badge variant={variant}>
      {estado === "firmado" ? "Firmado" : "Borrador"}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function SalaExpulsionPage() {
  const cronometro = useCronometro();
  const [showForm, setShowForm] = React.useState(false);
  const [registroExitoso, setRegistroExitoso] = React.useState<string | null>(
    null,
  );

  const listQuery = trpc.eceSalaExpulsion.list.useQuery({ limit: 20 });
  const utils = trpc.useUtils();

  const firmarMutation = trpc.eceSalaExpulsion.firmar.useMutation({
    onSuccess: () => utils.eceSalaExpulsion.list.invalidate(),
  });

  const faseCfg = FASES.find((f) => f.key === cronometro.fase) ?? FASES[0]!;
  const tieneNacimiento = Boolean(cronometro.timestamps.expulsiva);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Sala de Expulsión</h1>
          <p className="text-sm text-muted-foreground">
            Doc 14 NTEC — Período expulsivo y alumbramiento.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            cronometro.iniciar();
            setShowForm(false);
            setRegistroExitoso(null);
          }}
        >
          Iniciar nuevo evento
        </Button>
      </div>

      {/* Cronómetro de fases */}
      <Card>
        <CardHeader>
          <CardTitle>Cronómetro de fases</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Indicadores de fase */}
          <div className="flex gap-2 flex-wrap">
            {FASES.map((f) => {
              const ts = cronometro.timestamps[f.key];
              const activa = f.key === cronometro.fase;
              return (
                <div
                  key={f.key}
                  className={`rounded-lg px-3 py-2 text-sm font-medium border-2 ${
                    activa
                      ? `${f.color} border-current`
                      : ts
                        ? "bg-muted text-muted-foreground border-transparent"
                        : "bg-background text-muted-foreground border-dashed border-muted-foreground/30"
                  }`}
                >
                  <div>{f.label}</div>
                  {ts && (
                    <div className="text-xs tabular-nums">
                      {dtFmt.format(ts)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Contador */}
          {cronometro.timestamps[cronometro.fase] && (
            <div className="flex items-center gap-4">
              <span
                className={`text-3xl font-mono font-bold ${faseCfg.color} rounded px-3 py-1`}
              >
                {formatElapsed(cronometro.elapsed)}
              </span>
              <span className="text-sm text-muted-foreground">
                Fase: {faseCfg.label}
              </span>
            </div>
          )}

          {/* Botones de avance */}
          <div className="flex gap-2 flex-wrap">
            {!cronometro.timestamps.latente && (
              <Button onClick={cronometro.iniciar}>Iniciar (fase latente)</Button>
            )}
            {cronometro.timestamps.latente && cronometro.fase === "latente" && (
              <Button onClick={cronometro.avanzarFase}>
                Iniciar fase activa
              </Button>
            )}
            {cronometro.fase === "activa" && (
              <Button onClick={cronometro.avanzarFase} variant="destructive">
                Registrar nacimiento (fase expulsiva)
              </Button>
            )}
            {cronometro.fase === "expulsiva" && (
              <Button onClick={cronometro.avanzarFase}>
                Registrar alumbramiento
              </Button>
            )}
          </div>

          {/* Formulario aparece cuando hay nacimiento */}
          {tieneNacimiento && !registroExitoso && (
            <div className="border rounded-lg p-4 mt-4">
              <h3 className="font-semibold mb-3">Completar registro de nacimiento</h3>
              <RegistrarNacimientoForm
                timestamps={cronometro.timestamps}
                onSuccess={() => {
                  setRegistroExitoso("ok");
                  utils.eceSalaExpulsion.list.invalidate();
                }}
              />
            </div>
          )}

          {registroExitoso && (
            <p className="text-sm text-green-700 font-medium">
              Nacimiento registrado. El evento fue emitido al sistema de recien nacido.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Lista de registros */}
      <Card>
        <CardHeader>
          <CardTitle>Registros recientes</CardTitle>
        </CardHeader>
        <CardContent>
          {listQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )}
          {listQuery.error && (
            <p role="alert" className="text-sm text-destructive">
              {listQuery.error.message}
            </p>
          )}
          {!listQuery.isLoading &&
            (listQuery.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                Sin registros.
              </p>
            )}
          {(listQuery.data ?? []).length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nacimiento</TableHead>
                  <TableHead>Episodio</TableHead>
                  <TableHead>Tipo parto</TableHead>
                  <TableHead>Sangrado (mL)</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="sr-only">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(listQuery.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums">
                      {dtFmt.format(new Date(r.nacimiento_ts))}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.episodio_hospitalario_id.slice(0, 8)}…
                    </TableCell>
                    <TableCell>{r.tipo_parto}</TableCell>
                    <TableCell className="tabular-nums">
                      {r.sangrado_estimado_ml ?? "—"}
                    </TableCell>
                    <TableCell>
                      <EstadoBadge estado={r.estado_registro} />
                    </TableCell>
                    <TableCell>
                      {r.estado_registro === "borrador" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => firmarMutation.mutate({ id: r.id })}
                          disabled={firmarMutation.isPending}
                        >
                          Firmar
                        </Button>
                      )}
                      {r.estado_registro === "firmado" && (
                        <Button asChild size="sm" variant="ghost">
                          <Link
                            href={`/ece/obstetricia/expulsion/${r.id}`}
                          >
                            Ver
                          </Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
