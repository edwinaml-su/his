/**
 * Tests del reducer y helpers del draft de evolución SOAP (CC-0006).
 *
 * Sin React, sin DOM — lógica pura.
 * @QA E2E: agregar problema → firmar → verificar inmutabilidad en BD.
 */
import { describe, it, expect } from "vitest";
import {
  draftReducer,
  DRAFT_EMPTY,
  calcNumero,
  puedeFirmar,
  tieneSignos,
  SIGNOS_EMPTY,
  type DraftState,
  type EvolucionProblema,
} from "../_lib/types";

// ─── calcNumero ──────────────────────────────────────────────────────────────

describe("calcNumero", () => {
  it("raíz sola → '1'", () => {
    const p: EvolucionProblema = { id: "a", texto: "x", parentId: null, orden: 0 };
    expect(calcNumero(p, [p])).toBe("1");
  });

  it("segunda raíz → '2'", () => {
    const p1: EvolucionProblema = { id: "a", texto: "x", parentId: null, orden: 0 };
    const p2: EvolucionProblema = { id: "b", texto: "y", parentId: null, orden: 1 };
    expect(calcNumero(p2, [p1, p2])).toBe("2");
  });

  it("hijo del primer padre → '1.1'", () => {
    const padre: EvolucionProblema = { id: "p", texto: "padre", parentId: null, orden: 0 };
    const hijo: EvolucionProblema = { id: "c", texto: "hijo", parentId: "p", orden: 1 };
    expect(calcNumero(hijo, [padre, hijo])).toBe("1.1");
  });

  it("segundo hijo del segundo padre → '2.2'", () => {
    const p1: EvolucionProblema = { id: "p1", texto: "p1", parentId: null, orden: 0 };
    const p2: EvolucionProblema = { id: "p2", texto: "p2", parentId: null, orden: 1 };
    const h1: EvolucionProblema = { id: "h1", texto: "h1", parentId: "p2", orden: 2 };
    const h2: EvolucionProblema = { id: "h2", texto: "h2", parentId: "p2", orden: 3 };
    expect(calcNumero(h2, [p1, p2, h1, h2])).toBe("2.2");
  });
});

// ─── tieneSignos ─────────────────────────────────────────────────────────────

describe("tieneSignos", () => {
  it("SIGNOS_EMPTY → false", () => {
    expect(tieneSignos(SIGNOS_EMPTY)).toBe(false);
  });

  it("presionSistolica no vacío → true", () => {
    expect(tieneSignos({ ...SIGNOS_EMPTY, presionSistolica: "120" })).toBe(true);
  });

  it("escalaDolor > 0 → true", () => {
    expect(tieneSignos({ ...SIGNOS_EMPTY, escalaDolor: 3 })).toBe(true);
  });
});

// ─── puedeFirmar ─────────────────────────────────────────────────────────────

describe("puedeFirmar", () => {
  it("draft vacío → false", () => {
    expect(puedeFirmar(DRAFT_EMPTY)).toBe(false);
  });

  it("solo problemas → false (falta analisis y plan)", () => {
    const s = draftReducer(DRAFT_EMPTY, { type: "ADD_PROBLEMA", texto: "p1" });
    expect(puedeFirmar(s)).toBe(false);
  });

  it("problemas + analisis + plan → true", () => {
    let s = draftReducer(DRAFT_EMPTY, { type: "ADD_PROBLEMA", texto: "p1" });
    s = draftReducer(s, { type: "SET_ANALISIS", texto: "diagnóstico" });
    s = draftReducer(s, { type: "ADD_PLAN", texto: "acción 1" });
    expect(puedeFirmar(s)).toBe(true);
  });

  it("sin problemas aunque haya analisis y plan → false", () => {
    let s = draftReducer(DRAFT_EMPTY, { type: "SET_ANALISIS", texto: "dx" });
    s = draftReducer(s, { type: "ADD_PLAN", texto: "acción" });
    expect(puedeFirmar(s)).toBe(false);
  });

  it("subjetivo y objetivo solos no habilitan firma (opcionales)", () => {
    let s = draftReducer(DRAFT_EMPTY, { type: "SET_SUBJETIVO", texto: "me duele" });
    s = draftReducer(s, { type: "SET_OBJETIVO", texto: "examen normal" });
    expect(puedeFirmar(s)).toBe(false);
  });
});

// ─── ADD_PROBLEMA ────────────────────────────────────────────────────────────

describe("draftReducer ADD_PROBLEMA", () => {
  it("agrega problema raíz", () => {
    const s = draftReducer(DRAFT_EMPTY, { type: "ADD_PROBLEMA", texto: "cefalea" });
    expect(s.problemas).toHaveLength(1);
    expect(s.problemas[0]!.texto).toBe("cefalea");
    expect(s.problemas[0]!.parentId).toBeNull();
  });

  it("segundo problema incrementa orden", () => {
    let s = draftReducer(DRAFT_EMPTY, { type: "ADD_PROBLEMA", texto: "p1" });
    s = draftReducer(s, { type: "ADD_PROBLEMA", texto: "p2" });
    expect(s.problemas[1]!.orden).toBeGreaterThan(s.problemas[0]!.orden);
  });
});

// ─── EDIT_PROBLEMA ───────────────────────────────────────────────────────────

describe("draftReducer EDIT_PROBLEMA", () => {
  it("actualiza solo el texto del problema indicado", () => {
    let s = draftReducer(DRAFT_EMPTY, { type: "ADD_PROBLEMA", texto: "original" });
    const id = s.problemas[0]!.id;
    s = draftReducer(s, { type: "EDIT_PROBLEMA", id, texto: "editado" });
    expect(s.problemas[0]!.texto).toBe("editado");
  });
});

// ─── DELETE_PROBLEMA ─────────────────────────────────────────────────────────

describe("draftReducer DELETE_PROBLEMA", () => {
  it("elimina el problema", () => {
    let s = draftReducer(DRAFT_EMPTY, { type: "ADD_PROBLEMA", texto: "p1" });
    const id = s.problemas[0]!.id;
    s = draftReducer(s, { type: "DELETE_PROBLEMA", id });
    expect(s.problemas).toHaveLength(0);
  });

  it("eliminar padre mueve hijos a raíz (no los borra)", () => {
    let s = draftReducer(DRAFT_EMPTY, { type: "ADD_PROBLEMA", texto: "padre" });
    const padreId = s.problemas[0]!.id;
    s = draftReducer(s, { type: "ADD_PROBLEMA", texto: "hijo" });
    // Hacer que el hijo apunte al padre manualmente (GROUP_PROBLEMAS lo hace)
    s = {
      ...s,
      problemas: s.problemas.map((p) =>
        p.texto === "hijo" ? { ...p, parentId: padreId } : p,
      ),
    };
    s = draftReducer(s, { type: "DELETE_PROBLEMA", id: padreId });
    // padre eliminado, hijo pasa a raíz
    expect(s.problemas).toHaveLength(1);
    expect(s.problemas[0]!.parentId).toBeNull();
    expect(s.problemas[0]!.texto).toBe("hijo");
  });
});

// ─── GROUP_PROBLEMAS ─────────────────────────────────────────────────────────

describe("draftReducer GROUP_PROBLEMAS", () => {
  function tresProblemas(): DraftState {
    let s = draftReducer(DRAFT_EMPTY, { type: "ADD_PROBLEMA", texto: "A" });
    s = draftReducer(s, { type: "ADD_PROBLEMA", texto: "B" });
    s = draftReducer(s, { type: "ADD_PROBLEMA", texto: "C" });
    return s;
  }

  it("crea problema padre e inserta en posición mínima de seleccionados", () => {
    const s0 = tresProblemas();
    const ids = [s0.problemas[0]!.id, s0.problemas[1]!.id];
    const s1 = draftReducer(s0, {
      type: "GROUP_PROBLEMAS",
      ids,
      nombrePadre: "Grupo AB",
    });
    // El padre debe existir
    const padre = s1.problemas.find((p) => p.texto === "Grupo AB");
    expect(padre).toBeDefined();
    expect(padre!.parentId).toBeNull();
    // Los seleccionados son hijos del padre
    const hijos = s1.problemas.filter((p) => p.parentId === padre!.id);
    expect(hijos).toHaveLength(2);
    // C sigue siendo raíz
    const c = s1.problemas.find((p) => p.texto === "C");
    expect(c!.parentId).toBeNull();
  });

  it("menos de 2 seleccionados → estado sin cambios", () => {
    const s0 = tresProblemas();
    const s1 = draftReducer(s0, {
      type: "GROUP_PROBLEMAS",
      ids: [s0.problemas[0]!.id],
      nombrePadre: "Grupo",
    });
    expect(s1.problemas).toHaveLength(s0.problemas.length);
  });
});

// ─── UNGROUP_PROBLEMA ────────────────────────────────────────────────────────

describe("draftReducer UNGROUP_PROBLEMA", () => {
  it("hijos vuelven a raíz", () => {
    const s = draftReducer(DRAFT_EMPTY, { type: "ADD_PROBLEMA", texto: "A" });
    let s2 = draftReducer(s, { type: "ADD_PROBLEMA", texto: "B" });
    const ids = [s2.problemas[0]!.id, s2.problemas[1]!.id];
    s2 = draftReducer(s2, { type: "GROUP_PROBLEMAS", ids, nombrePadre: "Padre" });
    const padre = s2.problemas.find((p) => p.texto === "Padre")!;
    s2 = draftReducer(s2, { type: "UNGROUP_PROBLEMA", parentId: padre.id });
    // Los hijos vuelven a raíz
    const hijos = s2.problemas.filter((p) => p.parentId !== null);
    expect(hijos).toHaveLength(0);
  });
});

// ─── Plan ────────────────────────────────────────────────────────────────────

describe("draftReducer plan", () => {
  it("ADD_PLAN agrega indicación numerada", () => {
    const s = draftReducer(DRAFT_EMPTY, { type: "ADD_PLAN", texto: "indicación 1" });
    expect(s.plan).toHaveLength(1);
    expect(s.plan[0]!.texto).toBe("indicación 1");
  });

  it("EDIT_PLAN actualiza texto", () => {
    let s = draftReducer(DRAFT_EMPTY, { type: "ADD_PLAN", texto: "original" });
    const id = s.plan[0]!.id;
    s = draftReducer(s, { type: "EDIT_PLAN", id, texto: "editado" });
    expect(s.plan[0]!.texto).toBe("editado");
  });

  it("DELETE_PLAN elimina la indicación", () => {
    let s = draftReducer(DRAFT_EMPTY, { type: "ADD_PLAN", texto: "a eliminar" });
    const id = s.plan[0]!.id;
    s = draftReducer(s, { type: "DELETE_PLAN", id });
    expect(s.plan).toHaveLength(0);
  });
});

// ─── SET_SIGNOS / SET_SUBJETIVO / SET_OBJETIVO / SET_ANALISIS ────────────────

describe("draftReducer textos", () => {
  it("SET_SUBJETIVO actualiza subjetivo", () => {
    const s = draftReducer(DRAFT_EMPTY, { type: "SET_SUBJETIVO", texto: "dolor" });
    expect(s.subjetivo).toBe("dolor");
  });

  it("SET_OBJETIVO actualiza objetivo", () => {
    const s = draftReducer(DRAFT_EMPTY, { type: "SET_OBJETIVO", texto: "examen" });
    expect(s.objetivo).toBe("examen");
  });

  it("SET_ANALISIS actualiza analisis", () => {
    const s = draftReducer(DRAFT_EMPTY, { type: "SET_ANALISIS", texto: "dx" });
    expect(s.analisis).toBe("dx");
  });

  it("SET_SIGNOS actualiza signos", () => {
    const signos = { ...SIGNOS_EMPTY, presionSistolica: "120", escalaDolor: 3 };
    const s = draftReducer(DRAFT_EMPTY, { type: "SET_SIGNOS", signos });
    expect(s.signos.presionSistolica).toBe("120");
    expect(s.signos.escalaDolor).toBe(3);
  });
});
