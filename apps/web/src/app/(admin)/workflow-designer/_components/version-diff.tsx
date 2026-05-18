"use client";

/**
 * VersionDiff — Vista lado a lado de diferencias entre dos versiones.
 * US.F2.2.07
 *
 * Renderiza el resultado de workflowPublicacion.diff:
 *  - Nodos/aristas agregados en verde
 *  - Nodos/aristas eliminados en rojo
 *  - Nodos/aristas modificados en amarillo
 *  - Sin cambios en gris
 */
import { Badge } from "@his/ui/components/badge";

type SnapNode = { id: string; nombre: string; [k: string]: unknown };
type SnapEdge = { id: string; accion: string; [k: string]: unknown };

interface DiffData {
  nodes: {
    added: SnapNode[];
    removed: SnapNode[];
    modified: Array<{ before: SnapNode; after: SnapNode }>;
    unchanged: SnapNode[];
  };
  edges: {
    added: SnapEdge[];
    removed: SnapEdge[];
    modified: Array<{ before: SnapEdge; after: SnapEdge }>;
    unchanged: SnapEdge[];
  };
}

interface VersionDiffProps {
  versionA: number;
  versionB: number;
  diff: DiffData;
}

export function VersionDiff({ versionA, versionB, diff }: VersionDiffProps) {
  const totalChanges =
    diff.nodes.added.length +
    diff.nodes.removed.length +
    diff.nodes.modified.length +
    diff.edges.added.length +
    diff.edges.removed.length +
    diff.edges.modified.length;

  return (
    <section aria-label={`Diff versión ${versionA} vs ${versionB}`} data-testid="version-diff">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Comparando v{versionA} → v{versionB}
        </h3>
        <span className="text-xs text-muted-foreground">
          {totalChanges === 0 ? "Sin cambios" : `${totalChanges} cambio${totalChanges !== 1 ? "s" : ""}`}
        </span>
      </div>

      {totalChanges === 0 && (
        <p className="text-sm text-muted-foreground">Las versiones son idénticas.</p>
      )}

      {/* Estados */}
      {(diff.nodes.added.length > 0 ||
        diff.nodes.removed.length > 0 ||
        diff.nodes.modified.length > 0) && (
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Estados
          </h4>
          <ul className="space-y-1">
            {diff.nodes.added.map((n) => (
              <DiffRow key={n.id} type="added" label={String(n.nombre)} />
            ))}
            {diff.nodes.removed.map((n) => (
              <DiffRow key={n.id} type="removed" label={String(n.nombre)} />
            ))}
            {diff.nodes.modified.map(({ before, after }) => (
              <DiffRow
                key={before.id}
                type="modified"
                label={String(before.nombre)}
                detail={`→ ${String(after.nombre)}`}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Transiciones */}
      {(diff.edges.added.length > 0 ||
        diff.edges.removed.length > 0 ||
        diff.edges.modified.length > 0) && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Transiciones
          </h4>
          <ul className="space-y-1">
            {diff.edges.added.map((e) => (
              <DiffRow key={e.id} type="added" label={String(e.accion)} />
            ))}
            {diff.edges.removed.map((e) => (
              <DiffRow key={e.id} type="removed" label={String(e.accion)} />
            ))}
            {diff.edges.modified.map(({ before, after }) => (
              <DiffRow
                key={before.id}
                type="modified"
                label={String(before.accion)}
                detail={
                  before.rolCodigo !== after.rolCodigo
                    ? `rol: ${String(before.rolCodigo ?? "—")} → ${String(after.rolCodigo ?? "—")}`
                    : "modificada"
                }
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

type DiffType = "added" | "removed" | "modified";

function DiffRow({
  type,
  label,
  detail,
}: {
  type: DiffType;
  label: string;
  detail?: string;
}) {
  const config: Record<DiffType, { badge: string; cls: string; symbol: string }> = {
    added: {
      badge: "Agregado",
      cls: "border-green-200 bg-green-50 text-green-800",
      symbol: "+",
    },
    removed: {
      badge: "Eliminado",
      cls: "border-red-200 bg-red-50 text-red-800",
      symbol: "−",
    },
    modified: {
      badge: "Modificado",
      cls: "border-yellow-200 bg-yellow-50 text-yellow-800",
      symbol: "~",
    },
  };
  const { badge, cls, symbol } = config[type];

  return (
    <li
      className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${cls}`}
    >
      <span aria-hidden="true" className="shrink-0 font-bold">
        {symbol}
      </span>
      <span className="flex-1">{label}</span>
      {detail && <span className="opacity-70">{detail}</span>}
      <Badge className={`ml-auto text-xs ${cls}`} variant="outline">
        {badge}
      </Badge>
    </li>
  );
}
