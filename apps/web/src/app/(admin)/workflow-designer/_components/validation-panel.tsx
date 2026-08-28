"use client";

/**
 * ValidationPanel — Panel de validación de integridad del workflow.
 * US.F2.2.05
 *
 * Muestra errores y advertencias del grafo, con botón para (re)ejecutar la
 * validación y enlaces directos al editor por cada issue.
 *
 * Consolidado desde la copia inline de `workflow-designer/[codigo]/page.tsx`
 * (inventario huérfanos 2026-08-26, patrón B): este componente estaba
 * definido aquí pero sin importadores (huérfano Tier 2), mientras la página
 * del grafo reimplementaba su propia versión, más completa, en línea. Se
 * consolida la lógica superset (botón "Validar", `tipoDocCodigo` para los
 * enlaces "Ir al item") aquí y la página pasa a importar este archivo.
 */
// Tipos inline para evitar dependencia de path interno de @his/trpc
type ValidationSeverity = "error" | "warning";
export interface ValidationIssue {
  code: string;
  message: string;
  severity: ValidationSeverity;
  nodeIds?: string[];
  edgeIds?: string[];
}

import Link from "next/link";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";

interface ValidationPanelProps {
  issues: ValidationIssue[] | undefined;
  onValidate: () => void;
  isLoading: boolean;
  tipoDocCodigo: string;
}

export function ValidationPanel({
  issues,
  onValidate,
  isLoading,
  tipoDocCodigo,
}: ValidationPanelProps) {
  const errores = (issues ?? []).filter((i) => i.severity === "error");
  const warnings = (issues ?? []).filter((i) => i.severity === "warning");
  const badgeCount = errores.length + warnings.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            Validación de integridad
            {badgeCount > 0 && (
              <Badge
                variant={errores.length > 0 ? "destructive" : "outline"}
                className="ml-2 text-xs"
                aria-label={`${errores.length} errores, ${warnings.length} advertencias`}
              >
                {errores.length > 0
                  ? `${errores.length} error${errores.length > 1 ? "es" : ""}`
                  : `${warnings.length} advertencia${warnings.length > 1 ? "s" : ""}`}
              </Badge>
            )}
            {issues !== undefined && badgeCount === 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                Valido
              </Badge>
            )}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={onValidate}
            disabled={isLoading}
            aria-label="Validar integridad del workflow"
          >
            {isLoading ? "Validando..." : "Validar workflow"}
          </Button>
        </div>
      </CardHeader>
      {issues !== undefined && badgeCount > 0 && (
        <CardContent className="space-y-2">
          {errores.length > 0 && (
            <details open>
              <summary className="cursor-pointer select-none text-sm font-medium text-destructive">
                Errores ({errores.length})
              </summary>
              <ul className="mt-2 space-y-1" role="list" aria-label="Lista de errores de validación">
                {errores.map((issue) => (
                  <li
                    key={`${issue.code}-${issue.message}`}
                    className="flex items-start justify-between gap-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
                  >
                    <span>
                      <span className="mr-1 font-mono font-semibold text-destructive">
                        [{issue.code}]
                      </span>
                      {issue.message}
                    </span>
                    <Link
                      href={`/workflow-designer/${tipoDocCodigo}/editar`}
                      className="shrink-0 text-xs text-muted-foreground underline hover:text-foreground"
                      aria-label={`Ir al editor para corregir: ${issue.message}`}
                    >
                      Ir al item
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {warnings.length > 0 && (
            <details open>
              <summary className="cursor-pointer select-none text-sm font-medium text-amber-600 dark:text-amber-400">
                Advertencias ({warnings.length})
              </summary>
              <ul className="mt-2 space-y-1" role="list" aria-label="Lista de advertencias de validación">
                {warnings.map((issue) => (
                  <li
                    key={`${issue.code}-${issue.message}`}
                    className="flex items-start justify-between gap-2 rounded border border-amber-300/40 bg-amber-50/50 px-3 py-2 text-xs dark:border-amber-700/30 dark:bg-amber-900/10"
                  >
                    <span>
                      <span className="mr-1 font-mono font-semibold text-amber-600 dark:text-amber-400">
                        [{issue.code}]
                      </span>
                      {issue.message}
                    </span>
                    <Link
                      href={`/workflow-designer/${tipoDocCodigo}/editar`}
                      className="shrink-0 text-xs text-muted-foreground underline hover:text-foreground"
                      aria-label={`Ir al editor para revisar: ${issue.message}`}
                    >
                      Ir al item
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      )}
      {issues !== undefined && badgeCount === 0 && (
        <CardContent>
          <p className="text-xs text-muted-foreground">
            El workflow cumple todas las reglas de integridad.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
