"use client";

/**
 * ValidationPanel — Panel de issues en el pie del canvas.
 * US.F2.2.05
 *
 * Muestra la lista de errores y warnings del grafo en tiempo real.
 * Errores bloquean el botón Publicar. Warnings son informativos.
 */
// Tipos inline para evitar dependencia de path interno de @his/trpc
type VisualSeverity = "error" | "warning";
interface VisualIssue {
  code: string;
  message: string;
  severity: VisualSeverity;
  nodeIds?: string[];
  edgeIds?: string[];
}
import { Badge } from "@his/ui/components/badge";

interface ValidationPanelProps {
  issues: VisualIssue[];
  loadingRoles?: boolean;
}

export function ValidationPanel({ issues, loadingRoles }: ValidationPanelProps) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  if (issues.length === 0 && !loadingRoles) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
        data-testid="validation-panel-ok"
      >
        <span aria-hidden>&#10003;</span>
        Sin errores de validación
      </div>
    );
  }

  return (
    <section
      aria-label="Panel de errores de validación"
      className="rounded-md border border-border bg-background"
      data-testid="validation-panel"
    >
      <header className="flex items-center gap-3 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
        <span>Validación</span>
        {errors.length > 0 && (
          <Badge variant="destructive" className="text-xs">
            {errors.length} error{errors.length !== 1 ? "es" : ""}
          </Badge>
        )}
        {warnings.length > 0 && (
          <Badge
            variant="outline"
            className="border-yellow-400 bg-yellow-50 text-xs text-yellow-700"
          >
            {warnings.length} advertencia{warnings.length !== 1 ? "s" : ""}
          </Badge>
        )}
        {loadingRoles && (
          <span className="ml-auto text-xs text-muted-foreground">
            Verificando roles…
          </span>
        )}
      </header>

      <ul className="max-h-40 divide-y overflow-y-auto" role="list">
        {errors.map((issue, idx) => (
          <IssueRow key={`${issue.code}-${idx}`} issue={issue} />
        ))}
        {warnings.map((issue, idx) => (
          <IssueRow key={`${issue.code}-${idx}`} issue={issue} />
        ))}
      </ul>
    </section>
  );
}

function IssueRow({ issue }: { issue: VisualIssue }) {
  const isError = issue.severity === "error";
  return (
    <li
      role="listitem"
      className={`flex items-start gap-2 px-3 py-2 text-xs ${
        isError ? "text-destructive" : "text-yellow-700"
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 shrink-0 font-bold ${isError ? "text-destructive" : "text-yellow-600"}`}
      >
        {isError ? "✕" : "!"}
      </span>
      <span>
        <span className="mr-1 font-mono opacity-60">[{issue.code}]</span>
        {issue.message}
      </span>
    </li>
  );
}
