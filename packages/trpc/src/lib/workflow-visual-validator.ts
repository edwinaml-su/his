/**
 * Validador visual de workflows — lógica pura para el cliente.
 *
 * Extiende workflow-validator.ts con:
 *  - Detección de ciclos por DFS (WF010)
 *  - Validación de roles contra catálogo (WF011)
 *  - Mapa de nodos afectados para renderizado de badges
 *
 * Diseño: funciones puras, sin efectos secundarios, testeable sin mocks.
 */

export type VisualSeverity = "error" | "warning";

export interface VisualIssue {
  code: string;
  message: string;
  severity: VisualSeverity;
  /** IDs de nodos afectados (para badge en canvas) */
  nodeIds?: string[];
  /** IDs de aristas afectadas */
  edgeIds?: string[];
}

export interface GraphNode {
  id: string;
  nombre: string;
  es_inicial: boolean;
  es_final: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  accion: string;
  /** codigo del rol asignado a esta transición (puede ser undefined si no se asignó) */
  rolCodigo?: string;
}

export interface VisualValidationInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Códigos de roles que existen en catálogo vigente (null = no verificado aún) */
  validRoleCodes: Set<string> | null;
}

export interface VisualValidationResult {
  valid: boolean;
  issues: VisualIssue[];
  /** Mapa nodeId → severity más alta que afecta ese nodo */
  nodeIssueMap: Map<string, VisualSeverity>;
  /** Mapa edgeId → severity más alta que afecta esa arista */
  edgeIssueMap: Map<string, VisualSeverity>;
}

// ─── Detección de ciclos por DFS ───────────────────────────────────────────────

/**
 * Retorna los IDs de nodos que participan en ciclos.
 * Usa DFS iterativo con coloreo (blanco=0, gris=1, negro=2).
 */
function detectCycles(
  nodes: GraphNode[],
  edges: GraphEdge[],
): { cycleNodeIds: string[]; cycleEdgeIds: string[] } {
  const adj = new Map<string, { nodeId: string; edgeId: string }[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.source)?.push({ nodeId: e.target, edgeId: e.id });
  }

  const color = new Map<string, 0 | 1 | 2>();
  for (const n of nodes) color.set(n.id, 0);

  const cycleNodeIds = new Set<string>();
  const cycleEdgeIds = new Set<string>();

  for (const startNode of nodes) {
    if (color.get(startNode.id) !== 0) continue;

    // stack: [nodeId, parentEdgeId, iterator index]
    const stack: Array<{ nodeId: string; edgeId: string | null; childIdx: number }> = [];
    stack.push({ nodeId: startNode.id, edgeId: null, childIdx: 0 });
    color.set(startNode.id, 1);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbors = adj.get(frame.nodeId) ?? [];

      if (frame.childIdx >= neighbors.length) {
        color.set(frame.nodeId, 2);
        stack.pop();
        continue;
      }

      const { nodeId: neighborId, edgeId } = neighbors[frame.childIdx]!;
      frame.childIdx++;

      const neighborColor = color.get(neighborId);
      if (neighborColor === 1) {
        // back edge → ciclo
        // marcar todos los grises (en stack) como parte del ciclo
        for (const f of stack) {
          cycleNodeIds.add(f.nodeId);
          if (f.edgeId) cycleEdgeIds.add(f.edgeId);
        }
        cycleEdgeIds.add(edgeId);
        cycleNodeIds.add(neighborId);
      } else if (neighborColor === 0) {
        color.set(neighborId, 1);
        stack.push({ nodeId: neighborId, edgeId, childIdx: 0 });
      }
    }
  }

  return { cycleNodeIds: [...cycleNodeIds], cycleEdgeIds: [...cycleEdgeIds] };
}

// ─── Validador principal ───────────────────────────────────────────────────────

export function validateGraphVisual(input: VisualValidationInput): VisualValidationResult {
  const { nodes, edges, validRoleCodes } = input;
  const issues: VisualIssue[] = [];
  const nodeIssueMap = new Map<string, VisualSeverity>();
  const edgeIssueMap = new Map<string, VisualSeverity>();

  function markNode(id: string, sev: VisualSeverity) {
    const existing = nodeIssueMap.get(id);
    if (!existing || (existing === "warning" && sev === "error")) {
      nodeIssueMap.set(id, sev);
    }
  }
  function markEdge(id: string, sev: VisualSeverity) {
    const existing = edgeIssueMap.get(id);
    if (!existing || (existing === "warning" && sev === "error")) {
      edgeIssueMap.set(id, sev);
    }
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const iniciales = nodes.filter((n) => n.es_inicial);
  const finales = nodes.filter((n) => n.es_final);
  const idsConSalida = new Set(edges.map((e) => e.source));
  const idsConEntrada = new Set(edges.map((e) => e.target));

  // WF001 — múltiples iniciales
  if (iniciales.length > 1) {
    const ids = iniciales.map((n) => n.id);
    issues.push({
      code: "WF001",
      message: `Múltiples estados iniciales (${iniciales.map((n) => n.nombre).join(", ")})`,
      severity: "error",
      nodeIds: ids,
    });
    ids.forEach((id) => markNode(id, "error"));
  }

  // WF002 — sin estado inicial (solo si hay nodos)
  if (nodes.length > 0 && iniciales.length === 0) {
    issues.push({
      code: "WF002",
      message: "El flujo no tiene estado inicial",
      severity: "error",
    });
  }

  // WF003 — sin estado final alcanzable
  if (nodes.length > 0 && finales.length === 0) {
    issues.push({
      code: "WF003",
      message: "El flujo no tiene estado final",
      severity: "error",
    });
  }

  // WF004 — estado sin salida (excepto finales)
  for (const n of nodes) {
    if (n.es_final) continue;
    if (!idsConSalida.has(n.id)) {
      issues.push({
        code: "WF004",
        message: `Estado "${n.nombre}" no tiene transición de salida`,
        severity: "warning",
        nodeIds: [n.id],
      });
      markNode(n.id, "warning");
    }
  }

  // WF005 — estado sin entrada (excepto iniciales)
  for (const n of nodes) {
    if (n.es_inicial) continue;
    if (!idsConEntrada.has(n.id)) {
      issues.push({
        code: "WF005",
        message: `Estado "${n.nombre}" podría ser inalcanzable (sin transición entrante)`,
        severity: "warning",
        nodeIds: [n.id],
      });
      markNode(n.id, "warning");
    }
  }

  // WF006 — aristas con referencias rotas
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      issues.push({
        code: "WF006",
        message: `Transición "${e.accion}" referencia estado eliminado`,
        severity: "error",
        edgeIds: [e.id],
      });
      markEdge(e.id, "error");
    }
  }

  // WF010 — ciclos (DFS)
  const { cycleNodeIds, cycleEdgeIds } = detectCycles(nodes, edges);
  if (cycleNodeIds.length > 0) {
    issues.push({
      code: "WF010",
      message: `Ciclo detectado en el grafo (nodos: ${cycleNodeIds
        .map((id) => nodes.find((n) => n.id === id)?.nombre ?? id)
        .join(", ")})`,
      severity: "error",
      nodeIds: cycleNodeIds,
      edgeIds: cycleEdgeIds,
    });
    cycleNodeIds.forEach((id) => markNode(id, "error"));
    cycleEdgeIds.forEach((id) => markEdge(id, "error"));
  }

  // WF011 — roles referenciados no existen en catálogo
  if (validRoleCodes !== null) {
    for (const e of edges) {
      if (e.rolCodigo && !validRoleCodes.has(e.rolCodigo)) {
        issues.push({
          code: "WF011",
          message: `El rol "${e.rolCodigo}" no existe en el catálogo vigente (transición: "${e.accion}")`,
          severity: "error",
          edgeIds: [e.id],
        });
        markEdge(e.id, "error");
      }
    }
  }

  const hasErrors = issues.some((i) => i.severity === "error");
  return { valid: !hasErrors, issues, nodeIssueMap, edgeIssueMap };
}
