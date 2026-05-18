/**
 * Tests de lógica de MobileView — US.F2.2.16
 *
 * Verifica el agrupamiento/ordenación de estados y transiciones que
 * hace el componente antes de renderizar. Testea la lógica pura
 * sin montar el DOM (environment: node es más rápido para lógica).
 */
import { describe, it, expect } from "vitest";

// ─── Lógica extraída del componente (replicada aquí para tests aislados) ──────

type EstadoRow = {
  id: string;
  codigo: string;
  nombre: string;
  es_inicial: boolean;
  es_final: boolean;
  orden: number;
};

type TransicionRow = {
  id: string;
  estado_origen_id: string;
  estado_destino_id: string;
  accion: string;
  requiere_firma: boolean;
  rol_codigo?: string;
};

function buildSalientes(transiciones: TransicionRow[]): Map<string, TransicionRow[]> {
  const map = new Map<string, TransicionRow[]>();
  for (const t of transiciones) {
    const arr = map.get(t.estado_origen_id) ?? [];
    arr.push(t);
    map.set(t.estado_origen_id, arr);
  }
  return map;
}

function sortEstados(estados: EstadoRow[]): EstadoRow[] {
  return [...estados].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const E_INICIAL: EstadoRow = { id: "e1", codigo: "INICIO", nombre: "Inicio", es_inicial: true, es_final: false, orden: 0 };
const E_INTER: EstadoRow = { id: "e2", codigo: "PROCESO", nombre: "En proceso", es_inicial: false, es_final: false, orden: 1 };
const E_FINAL: EstadoRow = { id: "e3", codigo: "FIN", nombre: "Finalizado", es_inicial: false, es_final: true, orden: 2 };

const T1: TransicionRow = { id: "t1", estado_origen_id: "e1", estado_destino_id: "e2", accion: "iniciar", requiere_firma: false, rol_codigo: "MC" };
const T2: TransicionRow = { id: "t2", estado_origen_id: "e2", estado_destino_id: "e3", accion: "finalizar", requiere_firma: true, rol_codigo: "ENF" };
const T3: TransicionRow = { id: "t3", estado_origen_id: "e1", estado_destino_id: "e3", accion: "omitir", requiere_firma: false };

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("MobileView — lógica de agrupación (US.F2.2.16)", () => {
  describe("buildSalientes", () => {
    it("agrupa transiciones por estado_origen_id", () => {
      const map = buildSalientes([T1, T2, T3]);
      expect(map.get("e1")).toHaveLength(2);
      expect(map.get("e2")).toHaveLength(1);
      expect(map.get("e3")).toBeUndefined();
    });

    it("devuelve mapa vacío para lista vacía", () => {
      const map = buildSalientes([]);
      expect(map.size).toBe(0);
    });

    it("una sola transición queda correctamente indexada", () => {
      const map = buildSalientes([T1]);
      const arr = map.get("e1") ?? [];
      expect(arr).toHaveLength(1);
      expect(arr[0]?.accion).toBe("iniciar");
    });

    it("preserva todas las propiedades de la transición", () => {
      const map = buildSalientes([T2]);
      const items = map.get("e2") ?? [];
      const t = items[0];
      expect(t?.requiere_firma).toBe(true);
      expect(t?.rol_codigo).toBe("ENF");
    });
  });

  describe("sortEstados", () => {
    it("ordena por campo `orden` ascendente", () => {
      const desordenados = [E_FINAL, E_INICIAL, E_INTER];
      const result = sortEstados(desordenados);
      expect(result[0]?.codigo).toBe("INICIO");
      expect(result[1]?.codigo).toBe("PROCESO");
      expect(result[2]?.codigo).toBe("FIN");
    });

    it("no muta el array original", () => {
      const original = [E_FINAL, E_INICIAL];
      sortEstados(original);
      expect(original[0]?.codigo).toBe("FIN"); // no mutado
    });

    it("desempata por nombre cuando orden es igual", () => {
      const a: EstadoRow = { id: "a", codigo: "A", nombre: "Zeta", es_inicial: false, es_final: false, orden: 1 };
      const b: EstadoRow = { id: "b", codigo: "B", nombre: "Alpha", es_inicial: false, es_final: false, orden: 1 };
      const result = sortEstados([a, b]);
      expect(result[0]?.nombre).toBe("Alpha");
    });

    it("lista vacía devuelve vacío", () => {
      expect(sortEstados([])).toEqual([]);
    });

    it("lista con un elemento devuelve el mismo elemento", () => {
      expect(sortEstados([E_INICIAL])).toHaveLength(1);
    });
  });
});
