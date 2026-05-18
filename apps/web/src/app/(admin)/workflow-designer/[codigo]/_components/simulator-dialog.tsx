"use client";

/**
 * SimulatorDialog — Simulación paso a paso del workflow (US.F2.2.08).
 *
 * Modal que recorre el workflow estado por estado usando el router
 * workflowSimulacion.simulate. El estado actual se resalta (azul pulsante)
 * en el grafo mediante la prop `highlightEstadoId` pasada al padre.
 *
 * La simulación es puramente cliente→servidor (query read-only). No persiste BD.
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

// ── Tipos internos ────────────────────────────────────────────────────────────

interface EstadoSim {
  id: string;
  codigo: string;
  nombre: string;
  es_inicial: boolean;
  es_final: boolean;
  descripcion_markdown: string | null;
}

interface TransicionSim {
  id: string;
  accion: string;
  rol_codigo: string;
  rol_nombre: string;
  requiere_firma: boolean;
  estado_destino_id: string;
}

interface SimulatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tipDocumentoId: string;
  workflowNombre: string;
  /** Callback para notificar al padre el estado activo (para highlight en canvas). */
  onEstadoActivo?: (estadoId: string | null) => void;
}

// ── Escenarios de prueba predefinidos ─────────────────────────────────────────

const TEST_SCENARIOS = [
  { label: "HC ambulatoria (primera vez)", payload: { tipo_episodio: "ambulatorio", modalidad: "presencial", primera_vez: true } },
  { label: "HC ambulatoria (subsecuente)", payload: { tipo_episodio: "ambulatorio", modalidad: "presencial", primera_vez: false } },
  { label: "Episodio hospitalario", payload: { tipo_episodio: "hospitalario", modalidad: "presencial" } },
  { label: "Urgencia / Emergencia", payload: { tipo_episodio: "emergencia", modalidad: "presencial" } },
  { label: "Telemedicina", payload: { tipo_episodio: "ambulatorio", modalidad: "telemedicina" } },
];

// ── Componente ────────────────────────────────────────────────────────────────

export function SimulatorDialog({
  open,
  onOpenChange,
  tipDocumentoId,
  workflowNombre,
  onEstadoActivo,
}: SimulatorDialogProps) {
  const [estadoActualId, setEstadoActualId] = React.useState<string | undefined>(undefined);
  const [historial, setHistorial] = React.useState<Array<{ estado: EstadoSim; accion: string | null }>>([]);
  const [scenarioIndex, setScenarioIndex] = React.useState(0);

  const scenario = TEST_SCENARIOS[scenarioIndex];

  // Query al router de simulación
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading, error } = (trpc as any).workflowSimulacion.simulate.useQuery(
    {
      tipDocumentoId,
      estadoActualId,
      testPayload: scenario?.payload ?? {},
    },
    {
      enabled: open && !!tipDocumentoId,
      // No cachear — cada paso es una llamada fresca
      staleTime: 0,
    },
  );

  // Notificar estado activo al padre
  React.useEffect(() => {
    if (data?.estadoActual) {
      onEstadoActivo?.(data.estadoActual.id as string);
    }
  }, [data?.estadoActual, onEstadoActivo]);

  // Resetear al abrir
  React.useEffect(() => {
    if (open) {
      setEstadoActualId(undefined);
      setHistorial([]);
    } else {
      onEstadoActivo?.(null);
    }
  }, [open, onEstadoActivo]);

  function handleElegirTransicion(transicion: TransicionSim) {
    if (!data?.estadoActual) return;
    // Registrar en historial
    setHistorial((prev) => [
      ...prev,
      { estado: data.estadoActual as EstadoSim, accion: transicion.accion },
    ]);
    setEstadoActualId(transicion.estado_destino_id);
  }

  function handleReiniciar() {
    setEstadoActualId(undefined);
    setHistorial([]);
  }

  const estadoActual: EstadoSim | null = data?.estadoActual ?? null;
  const transicionesDisponibles: TransicionSim[] = data?.transicionesDisponibles ?? [];
  const esFinal: boolean = data?.esFinal ?? false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        aria-label="Simulación de workflow paso a paso"
      >
        <DialogHeader>
          <DialogTitle>Simulación — {workflowNombre}</DialogTitle>
          <DialogDescription>
            Recorre el workflow paso a paso con datos de prueba. No modifica la base de datos.
          </DialogDescription>
        </DialogHeader>

        {/* Selector de escenario */}
        <div className="flex flex-wrap gap-1.5 border-b pb-3">
          <span className="text-xs text-muted-foreground self-center mr-1">Escenario:</span>
          {TEST_SCENARIOS.map((s, i) => (
            <button
              key={i}
              onClick={() => { setScenarioIndex(i); handleReiniciar(); }}
              className={`rounded-full px-2 py-0.5 text-xs border transition-colors ${
                i === scenarioIndex
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
              }`}
              aria-pressed={i === scenarioIndex}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Estado actual */}
        {isLoading && (
          <div className="h-20 animate-pulse rounded bg-muted" aria-label="Cargando simulación..." />
        )}

        {error && (
          <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {String((error as { message?: string }).message ?? "Error al cargar simulación")}
          </div>
        )}

        {estadoActual && !isLoading && (
          <div className="space-y-3">
            {/* Estado activo resaltado */}
            <div
              className={`rounded-lg border-2 p-3 transition-all ${
                estadoActual.es_inicial
                  ? "border-green-500 bg-green-50"
                  : estadoActual.es_final
                  ? "border-blue-500 bg-blue-50"
                  : "border-primary bg-primary/5 animate-pulse"
              }`}
              aria-live="polite"
              aria-label={`Estado actual: ${estadoActual.nombre}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{estadoActual.nombre}</span>
                {estadoActual.es_inicial && (
                  <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">INICIAL</Badge>
                )}
                {estadoActual.es_final && (
                  <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">FINAL</Badge>
                )}
              </div>
              <code className="text-xs text-muted-foreground">{estadoActual.codigo}</code>
            </div>

            {/* Mensaje de flujo completado */}
            {esFinal && (
              <div className="rounded border border-blue-300 bg-blue-50 p-3 text-sm text-blue-800">
                Flujo completado en el estado <strong>{estadoActual.nombre}</strong>.
              </div>
            )}

            {/* Transiciones disponibles */}
            {!esFinal && transicionesDisponibles.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Transiciones disponibles desde aquí:
                </p>
                <div className="space-y-1.5">
                  {transicionesDisponibles.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleElegirTransicion(t)}
                      className="w-full flex items-center justify-between rounded border border-border p-2 text-left text-sm hover:border-primary hover:bg-primary/5 transition-colors"
                      aria-label={`Ejecutar transición: ${t.accion}, rol requerido: ${t.rol_codigo}`}
                    >
                      <div>
                        <span className="font-medium">{t.accion}</span>
                        {t.requiere_firma && (
                          <span className="ml-1.5 text-xs text-muted-foreground">(requiere firma)</span>
                        )}
                      </div>
                      <Badge variant="outline" className="text-xs ml-2 shrink-0">
                        {t.rol_codigo}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!esFinal && transicionesDisponibles.length === 0 && (
              <div className="text-sm text-muted-foreground">
                Este estado no tiene transiciones salientes configuradas.
              </div>
            )}

            {/* Historial */}
            {historial.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Historial ({historial.length} paso{historial.length !== 1 ? "s" : ""})
                </summary>
                <ol className="mt-1 space-y-0.5 list-decimal list-inside pl-1">
                  {historial.map((h, i) => (
                    <li key={i} className="text-muted-foreground">
                      {h.estado.nombre}
                      {h.accion && <span className="ml-1 font-mono text-foreground">→ {h.accion}</span>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        )}

        {/* Acciones del modal */}
        <div className="flex justify-between pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReiniciar}
            disabled={historial.length === 0}
            aria-label="Reiniciar simulación"
            data-testid="simulator-reiniciar"
          >
            Reiniciar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar simulación"
          >
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
