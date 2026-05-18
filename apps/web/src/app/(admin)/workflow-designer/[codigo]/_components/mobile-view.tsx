/**
 * MobileView — Vista simplificada del workflow para viewports < 768px.
 *
 * Motivo: React Flow no es utilizable con touch en pantallas pequeñas.
 * Esta vista presenta los estados como cards verticales con las transiciones
 * salientes enumeradas, sin drag/drop. Siempre read-only (US.F2.2.16).
 *
 * Accesibilidad:
 *  - Cada estado es un <details> nativo (teclado + screen reader).
 *  - Badges con aria-label descriptivo.
 *  - Focus visible por defecto del navegador.
 */
"use client";

import * as React from "react";
import { Badge } from "@his/ui/components/badge";
import { Alert, AlertDescription } from "@his/ui/components/alert";
import type { EstadoRow, TransicionRow } from "./workflow-graph";

interface MobileViewProps {
  estados: EstadoRow[];
  transiciones: TransicionRow[];
  tipoDocNombre: string;
}

export function MobileView({ estados, transiciones, tipoDocNombre }: MobileViewProps) {
  // Índice de transiciones salientes por estado para O(1)
  const salientes = React.useMemo(() => {
    const map = new Map<string, TransicionRow[]>();
    for (const t of transiciones) {
      const arr = map.get(t.estado_origen_id) ?? [];
      arr.push(t);
      map.set(t.estado_origen_id, arr);
    }
    return map;
  }, [transiciones]);

  const ordenados = React.useMemo(
    () => [...estados].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)),
    [estados],
  );

  return (
    <section aria-label={`Workflow de ${tipoDocNombre} — vista móvil`}>
      {/* Banner: edición solo en desktop */}
      <Alert className="mb-4 border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-200">
        <AlertDescription>
          <strong>Solo lectura en móvil.</strong> Para editar este workflow usa un equipo de escritorio.
        </AlertDescription>
      </Alert>

      <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Estados del flujo ({ordenados.length})
      </h2>

      <ol
        className="space-y-3"
        aria-label="Lista de estados del workflow"
        role="list"
      >
        {ordenados.map((estado) => {
          const transicionesSalientes = salientes.get(estado.id) ?? [];

          return (
            <li key={estado.id}>
              <details
                className="rounded-lg border bg-card text-card-foreground shadow-sm"
                data-testid={`estado-card-${estado.codigo}`}
              >
                <summary
                  className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  aria-label={`Estado ${estado.nombre}${estado.es_inicial ? ", estado inicial" : ""}${estado.es_final ? ", estado final" : ""}. ${transicionesSalientes.length} transición${transicionesSalientes.length !== 1 ? "es" : ""} saliente${transicionesSalientes.length !== 1 ? "s" : ""}.`}
                >
                  <span className="flex-1 font-medium text-sm">{estado.nombre}</span>
                  <span className="flex gap-1">
                    {estado.es_inicial && (
                      <Badge
                        className="text-xs bg-green-100 text-green-700 border-green-300"
                        aria-label="Estado inicial del flujo"
                      >
                        INICIO
                      </Badge>
                    )}
                    {estado.es_final && (
                      <Badge
                        className="text-xs bg-blue-100 text-blue-700 border-blue-300"
                        aria-label="Estado final del flujo"
                      >
                        FIN
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {transicionesSalientes.length} trans.
                    </Badge>
                  </span>
                </summary>

                <div className="border-t px-4 py-3">
                  <p className="text-xs text-muted-foreground mb-1">
                    <span className="font-mono">{estado.codigo}</span> · Orden {estado.orden}
                  </p>

                  {transicionesSalientes.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      Sin transiciones salientes.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs font-semibold mb-1 mt-2">Transiciones:</p>
                      <ul className="space-y-1" aria-label="Transiciones salientes">
                        {transicionesSalientes.map((t) => (
                          <li
                            key={t.id}
                            className="flex items-center gap-2 text-xs text-muted-foreground"
                          >
                            <span aria-hidden="true" className="text-gray-400">→</span>
                            <span>
                              {t.accion}
                              {t.rol_codigo && (
                                <span className="ml-1 font-mono text-xs opacity-70">
                                  ({t.rol_codigo})
                                </span>
                              )}
                              {t.requiere_firma && (
                                <span
                                  className="ml-1 opacity-60"
                                  aria-label="requiere firma"
                                  title="Requiere firma"
                                >
                                  ✎
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ol>

      {ordenados.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Este workflow no tiene estados configurados.
        </p>
      )}
    </section>
  );
}
