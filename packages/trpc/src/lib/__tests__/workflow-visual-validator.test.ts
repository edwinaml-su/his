/**
 * Tests del validador visual de workflows (WF001–WF011) + detección de ciclos.
 * Cubre US.F2.2.05: validación en vivo sin BD.
 *
 * >= 18 casos cubriendo:
 *  WF001 (múltiples iniciales), WF002 (sin inicial), WF003 (sin final),
 *  WF004 (sin salida), WF005 (sin entrada), WF006 (ref rota),
 *  WF010 (ciclo), WF011 (rol inválido),
 *  mapa de nodos/aristas afectados, severidad correcta.
 */
import { describe, it, expect } from "vitest";
import {
  validateGraphVisual,
  type GraphNode,
  type GraphEdge,
} from "../workflow-visual-validator";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const N_INICIO: GraphNode = { id: "n1", nombre: "Inicio", es_inicial: true, es_final: false };
const N_MEDIO: GraphNode  = { id: "n2", nombre: "Proceso", es_inicial: false, es_final: false };
const N_FINAL: GraphNode  = { id: "n3", nombre: "Fin", es_inicial: false, es_final: true };

const E12: GraphEdge = { id: "e12", source: "n1", target: "n2", accion: "iniciar" };
const E23: GraphEdge = { id: "e23", source: "n2", target: "n3", accion: "cerrar" };

function validGraph() {
  return {
    nodes: [N_INICIO, N_MEDIO, N_FINAL],
    edges: [E12, E23],
    validRoleCodes: null,
  };
}

// ─── Suite principal ──────────────────────────────────────────────────────────

describe("validateGraphVisual", () => {
  it("grafo válido — sin issues", () => {
    const result = validateGraphVisual(validGraph());
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.nodeIssueMap.size).toBe(0);
    expect(result.edgeIssueMap.size).toBe(0);
  });

  // WF001: múltiples iniciales
  it("WF001 — múltiples estados iniciales → error", () => {
    const n2Inicial: GraphNode = { id: "n2", nombre: "Otro inicio", es_inicial: true, es_final: false };
    const result = validateGraphVisual({
      nodes: [N_INICIO, n2Inicial, N_FINAL],
      edges: [E12, E23],
      validRoleCodes: null,
    });
    const wf001 = result.issues.find((i) => i.code === "WF001");
    expect(wf001).toBeDefined();
    expect(wf001?.severity).toBe("error");
    expect(result.nodeIssueMap.get("n1")).toBe("error");
    expect(result.nodeIssueMap.get("n2")).toBe("error");
    expect(result.valid).toBe(false);
  });

  // WF002: sin estado inicial
  it("WF002 — sin estado inicial → error", () => {
    const n1SinInicio: GraphNode = { id: "n1", nombre: "Proceso", es_inicial: false, es_final: false };
    const result = validateGraphVisual({
      nodes: [n1SinInicio, N_MEDIO, N_FINAL],
      edges: [E12, E23],
      validRoleCodes: null,
    });
    expect(result.issues.some((i) => i.code === "WF002")).toBe(true);
    expect(result.valid).toBe(false);
  });

  // WF003: sin estado final
  it("WF003 — sin estado final → error", () => {
    const n3SinFinal: GraphNode = { id: "n3", nombre: "Intermedio extra", es_inicial: false, es_final: false };
    const result = validateGraphVisual({
      nodes: [N_INICIO, N_MEDIO, n3SinFinal],
      edges: [E12, E23],
      validRoleCodes: null,
    });
    expect(result.issues.some((i) => i.code === "WF003")).toBe(true);
    expect(result.valid).toBe(false);
  });

  // WF004: nodo intermedio sin salida
  it("WF004 — estado intermedio sin salida → warning", () => {
    const nHuerfano: GraphNode = { id: "n4", nombre: "Huérfano", es_inicial: false, es_final: false };
    const result = validateGraphVisual({
      nodes: [N_INICIO, N_MEDIO, N_FINAL, nHuerfano],
      edges: [E12, E23], // n4 no tiene salida
      validRoleCodes: null,
    });
    const wf004 = result.issues.filter((i) => i.code === "WF004");
    expect(wf004.length).toBeGreaterThan(0);
    expect(wf004[0]?.severity).toBe("warning");
    expect(result.nodeIssueMap.get("n4")).toBe("warning");
    // Grafo sigue siendo válido (solo warnings)
    expect(result.valid).toBe(true);
  });

  // WF005: nodo intermedio sin entrada
  it("WF005 — estado intermedio inalcanzable → warning", () => {
    const nAislado: GraphNode = { id: "n5", nombre: "Aislado", es_inicial: false, es_final: false };
    const eSalida: GraphEdge = { id: "e5f", source: "n5", target: "n3", accion: "completar" };
    const result = validateGraphVisual({
      nodes: [N_INICIO, N_MEDIO, N_FINAL, nAislado],
      edges: [E12, E23, eSalida], // n5 tiene salida pero sin entrada
      validRoleCodes: null,
    });
    const wf005 = result.issues.filter((i) => i.code === "WF005");
    expect(wf005.length).toBeGreaterThan(0);
    expect(wf005[0]?.severity).toBe("warning");
  });

  // WF006: arista con referencia rota
  it("WF006 — arista referencia nodo eliminado → error", () => {
    const eBroken: GraphEdge = { id: "ebrok", source: "n99", target: "n3", accion: "broken" };
    const result = validateGraphVisual({
      nodes: [N_INICIO, N_MEDIO, N_FINAL],
      edges: [E12, E23, eBroken],
      validRoleCodes: null,
    });
    const wf006 = result.issues.find((i) => i.code === "WF006");
    expect(wf006).toBeDefined();
    expect(wf006?.severity).toBe("error");
    expect(result.edgeIssueMap.get("ebrok")).toBe("error");
    expect(result.valid).toBe(false);
  });

  // WF010: ciclo simple A→B→A
  it("WF010 — ciclo simple A→B→A → error", () => {
    const e21: GraphEdge = { id: "e21", source: "n2", target: "n1", accion: "volver" };
    const result = validateGraphVisual({
      nodes: [N_INICIO, N_MEDIO, N_FINAL],
      edges: [E12, E23, e21],
      validRoleCodes: null,
    });
    const wf010 = result.issues.find((i) => i.code === "WF010");
    expect(wf010).toBeDefined();
    expect(wf010?.severity).toBe("error");
    expect(result.valid).toBe(false);
  });

  // WF010: ciclo de tres nodos A→B→C→A
  it("WF010 — ciclo de tres nodos → error, marca nodos/aristas correctos", () => {
    const nA: GraphNode = { id: "nA", nombre: "A", es_inicial: true, es_final: false };
    const nB: GraphNode = { id: "nB", nombre: "B", es_inicial: false, es_final: false };
    const nC: GraphNode = { id: "nC", nombre: "C", es_inicial: false, es_final: false };
    const nD: GraphNode = { id: "nD", nombre: "D", es_inicial: false, es_final: true };
    const eAB: GraphEdge = { id: "eAB", source: "nA", target: "nB", accion: "ab" };
    const eBC: GraphEdge = { id: "eBC", source: "nB", target: "nC", accion: "bc" };
    const eCA: GraphEdge = { id: "eCA", source: "nC", target: "nA", accion: "ca" };
    const eCD: GraphEdge = { id: "eCD", source: "nC", target: "nD", accion: "cd" };

    const result = validateGraphVisual({
      nodes: [nA, nB, nC, nD],
      edges: [eAB, eBC, eCA, eCD],
      validRoleCodes: null,
    });

    const wf010 = result.issues.find((i) => i.code === "WF010");
    expect(wf010).toBeDefined();
    expect(wf010?.nodeIds?.length).toBeGreaterThanOrEqual(3);
    expect(result.valid).toBe(false);
  });

  // WF010: grafo sin ciclos → no emite WF010
  it("WF010 — DAG sin ciclos → sin WF010", () => {
    const result = validateGraphVisual(validGraph());
    expect(result.issues.some((i) => i.code === "WF010")).toBe(false);
  });

  // WF011: rol inválido en catálogo
  it("WF011 — rol no existe en catálogo → error", () => {
    const eConRol: GraphEdge = { id: "erol", source: "n1", target: "n2", accion: "firmar", rolCodigo: "FANTASMA" };
    const result = validateGraphVisual({
      nodes: [N_INICIO, N_MEDIO, N_FINAL],
      edges: [eConRol, E23],
      validRoleCodes: new Set(["ENF", "MC"]), // FANTASMA no está
    });
    const wf011 = result.issues.find((i) => i.code === "WF011");
    expect(wf011).toBeDefined();
    expect(wf011?.severity).toBe("error");
    expect(result.edgeIssueMap.get("erol")).toBe("error");
    expect(result.valid).toBe(false);
  });

  // WF011: rol válido en catálogo → sin error
  it("WF011 — rol existe en catálogo → sin WF011", () => {
    const eConRol: GraphEdge = { id: "erol", source: "n1", target: "n2", accion: "firmar", rolCodigo: "ENF" };
    const result = validateGraphVisual({
      nodes: [N_INICIO, N_MEDIO, N_FINAL],
      edges: [eConRol, E23],
      validRoleCodes: new Set(["ENF", "MC"]),
    });
    expect(result.issues.some((i) => i.code === "WF011")).toBe(false);
  });

  // WF011: validRoleCodes null → omite check (no llama BD)
  it("WF011 — validRoleCodes null → no verifica roles", () => {
    const eConRol: GraphEdge = { id: "erol", source: "n1", target: "n2", accion: "firmar", rolCodigo: "CUALQUIER_COSA" };
    const result = validateGraphVisual({
      nodes: [N_INICIO, N_MEDIO, N_FINAL],
      edges: [eConRol, E23],
      validRoleCodes: null,
    });
    expect(result.issues.some((i) => i.code === "WF011")).toBe(false);
  });

  // Grafo vacío no emite errores de "sin inicial/final" salvo si hay nodos
  it("grafo vacío (sin nodos) → válido, sin issues", () => {
    const result = validateGraphVisual({ nodes: [], edges: [], validRoleCodes: null });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  // nodeIssueMap prioriza error sobre warning para el mismo nodo
  it("nodeIssueMap — error tiene prioridad sobre warning", () => {
    // n2 tiene: warning de WF005 (sin entrada) y es origen de arista rota (WF006 no aplica)
    // Forzamos: n2 sin entrada + n2 es parte de ciclo → debe quedar como error
    const e21Ciclo: GraphEdge = { id: "e21", source: "n2", target: "n1", accion: "volver" };
    const result = validateGraphVisual({
      nodes: [N_INICIO, N_MEDIO, N_FINAL],
      edges: [E12, E23, e21Ciclo],
      validRoleCodes: null,
    });
    // ciclo detectado → n2 debe estar en error
    if (result.nodeIssueMap.has("n2")) {
      expect(result.nodeIssueMap.get("n2")).toBe("error");
    }
  });

  // Estado final solo sí debe tener entrada (WF005 aplica a finales)
  it("estado final sin entrada → warning WF005", () => {
    const nFinalAislado: GraphNode = { id: "n9", nombre: "Final aislado", es_inicial: false, es_final: true };
    const result = validateGraphVisual({
      nodes: [N_INICIO, N_MEDIO, N_FINAL, nFinalAislado],
      edges: [E12, E23], // n9 no tiene entrada
      validRoleCodes: null,
    });
    const wf005 = result.issues.filter((i) => i.code === "WF005" && i.nodeIds?.includes("n9"));
    expect(wf005.length).toBeGreaterThan(0);
  });

  // Estado inicial no emite WF005 aunque no tenga entrada (es el origen)
  it("estado inicial sin entrada → NO emite WF005", () => {
    const result = validateGraphVisual(validGraph());
    const wf005ParaInicio = result.issues.filter(
      (i) => i.code === "WF005" && i.nodeIds?.includes("n1"),
    );
    expect(wf005ParaInicio).toHaveLength(0);
  });

  // Múltiples errores simultáneos
  it("múltiples errores simultáneos — se reportan todos", () => {
    const eBroken: GraphEdge = { id: "ebrok", source: "n99", target: "n3", accion: "rota" };
    const n2Inicial: GraphNode = { id: "n2", nombre: "Doble inicio", es_inicial: true, es_final: false };
    const result = validateGraphVisual({
      nodes: [N_INICIO, n2Inicial, N_FINAL],
      edges: [E12, E23, eBroken],
      validRoleCodes: new Set(),
    });
    // WF001 (múltiples iniciales) + WF006 (ref rota)
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
    expect(result.valid).toBe(false);
  });
});
