"use client";

/**
 * useWorkflowValidator — hook cliente para validación visual en vivo.
 * US.F2.2.05
 *
 * Ejecuta validateGraphVisual localmente (sin BD) en cada cambio de grafo.
 * Para la validación de roles contra catálogo, llama al endpoint tRPC con
 * debounce 300ms y actualiza el resultado cuando responde.
 *
 * Trade-off: la validación local es instantánea pero no verifica roles (BD).
 * La verificación de roles tiene 300ms de retraso pero es definitiva.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// Tipos del validador (duplicados aquí para no importar desde path interno de package)
export type VisualSeverity = "error" | "warning";

export interface VisualIssue {
  code: string;
  message: string;
  severity: VisualSeverity;
  nodeIds?: string[];
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
  rolCodigo?: string;
}

export interface ValidationState {
  valid: boolean;
  issues: VisualIssue[];
  /** nodeId → severity más alta */
  nodeIssueMap: Map<string, VisualSeverity>;
  /** edgeId → severity más alta */
  edgeIssueMap: Map<string, VisualSeverity>;
  loadingRoles: boolean;
}

const DEBOUNCE_MS = 300;

// ─── Importación lazy del validador para evitar circular deps ─────────────────
// El validador vive en el package trpc pero es lógica pura — lo importamos
// directamente del archivo de lib (no del barrel del router).

type ValidateGraphVisualFn = (input: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  validRoleCodes: Set<string> | null;
}) => {
  valid: boolean;
  issues: VisualIssue[];
  nodeIssueMap: Map<string, VisualSeverity>;
  edgeIssueMap: Map<string, VisualSeverity>;
};

let _validateGraphVisual: ValidateGraphVisualFn | null = null;

async function getValidator(): Promise<ValidateGraphVisualFn> {
  if (_validateGraphVisual) return _validateGraphVisual;
  // Dynamic import para evitar SSR issues con el módulo
  const mod = await import(
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — path interno del package, resuelto en runtime por tsconfig paths
    "@his/trpc/src/lib/workflow-visual-validator"
  );
  _validateGraphVisual = mod.validateGraphVisual as ValidateGraphVisualFn;
  return _validateGraphVisual;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const EMPTY_RESULT: Omit<ValidationState, "loadingRoles"> = {
  valid: true,
  issues: [],
  nodeIssueMap: new Map(),
  edgeIssueMap: new Map(),
};

export function useWorkflowValidator(
  nodes: GraphNode[],
  edges: GraphEdge[],
): ValidationState {
  const [result, setResult] = useState<Omit<ValidationState, "loadingRoles">>(EMPTY_RESULT);
  const [validRoleCodes, setValidRoleCodes] = useState<Set<string> | null>(null);
  const [loadingRoles, setLoadingRoles] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const runValidation = useCallback(
    async (
      currentNodes: GraphNode[],
      currentEdges: GraphEdge[],
      roles: Set<string> | null,
    ) => {
      const validate = await getValidator();
      const res = validate({ nodes: currentNodes, edges: currentEdges, validRoleCodes: roles });
      setResult({
        valid: res.valid,
        issues: res.issues,
        nodeIssueMap: res.nodeIssueMap,
        edgeIssueMap: res.edgeIssueMap,
      });
    },
    [],
  );

  useEffect(() => {
    // Validación local inmediata
    void runValidation(nodes, edges, validRoleCodes);

    // Debounce para validación de roles en servidor
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const referencedRoles = [
      ...new Set(edges.map((e) => e.rolCodigo).filter((r): r is string => !!r)),
    ];

    if (referencedRoles.length > 0) {
      setLoadingRoles(true);
      debounceRef.current = setTimeout(() => {
        // Llamada al endpoint de validación de roles vía fetch directo
        // para evitar la dependencia de tipo en el trpc client generado
        fetch("/api/trpc/workflowValidatorVisual.validateGraph?batch=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            "0": {
              json: {
                nodes: nodesRef.current,
                edges: nodesRef.current.length > 0
                  ? edgesRef.current.map((e) => ({
                      id: e.id,
                      source: e.source,
                      target: e.target,
                      accion: e.accion,
                      rolCodigo: e.rolCodigo,
                    }))
                  : [],
                checkRoles: true,
              },
            },
          }),
        })
          .then(async (res) => {
            if (!res.ok) return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = (await res.json()) as any[];
            const payload = data?.[0]?.result?.data?.json as {
              issues?: Array<{ code: string; edgeIds?: string[] }>;
            } | undefined;
            if (!payload) return;

            const invalidRoleEdgeIds = new Set(
              (payload.issues ?? [])
                .filter((i) => i.code === "WF011")
                .flatMap((i) => i.edgeIds ?? []),
            );

            const newValidRoles = new Set<string>();
            for (const edge of edgesRef.current) {
              if (edge.rolCodigo && !invalidRoleEdgeIds.has(edge.id)) {
                newValidRoles.add(edge.rolCodigo);
              }
            }
            setValidRoleCodes(newValidRoles);
          })
          .catch(() => {
            // Red error — mantener validación local sin roles
          })
          .finally(() => {
            setLoadingRoles(false);
          });
      }, DEBOUNCE_MS);
    } else {
      setValidRoleCodes(new Set());
      setLoadingRoles(false);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // Re-validar cuando llegan roles del servidor
  useEffect(() => {
    void runValidation(nodesRef.current, edgesRef.current, validRoleCodes);
  }, [validRoleCodes, runValidation]);

  return { ...result, loadingRoles };
}
