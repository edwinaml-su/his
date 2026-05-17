/**
 * Tests unitarios del validador puro de workflows ECE.
 *
 * La función `validateWorkflow` no toca BD — se prueba con fixtures inline.
 * Cubre las 9 reglas (WF001–WF009):
 *  - WF001: sin estado inicial
 *  - WF002: sin estado final
 *  - WF003: más de un estado inicial
 *  - WF004: estado intermedio sin salida (deadlock)
 *  - WF005: estado intermedio/final sin entrada (inalcanzable)
 *  - WF006: transición referencia estado inexistente
 *  - WF007: sin roles funcionales
 *  - WF008: warning — sin transición hacia estado final
 *  - WF009: warning — acción duplicada desde mismo origen
 */
import { describe, it, expect } from "vitest";
import { validateWorkflow } from "../workflow-validator";
import type { EstadoInput, TransicionInput, DocumentoRolInput } from "../workflow-validator";

// ─── Fixtures base ────────────────────────────────────────────────────────────

const BORRADOR: EstadoInput = { id: "e1", nombre: "Borrador", es_inicial: true, es_final: false };
const REVISION: EstadoInput = { id: "e2", nombre: "En revisión", es_inicial: false, es_final: false };
const APROBADO: EstadoInput = { id: "e3", nombre: "Aprobado", es_inicial: false, es_final: true };

const T_BORRADOR_REVISION: TransicionInput = {
  id: "t1", estado_origen_id: "e1", estado_destino_id: "e2", accion: "enviar",
};
const T_REVISION_APROBADO: TransicionInput = {
  id: "t2", estado_origen_id: "e2", estado_destino_id: "e3", accion: "aprobar",
};

const ROL_DUMMY: DocumentoRolInput = { id: "r1" };

/** Workflow válido mínimo: borrador → revisión → aprobado, con 1 rol. */
function workflowValido() {
  return {
    estados: [BORRADOR, REVISION, APROBADO],
    transiciones: [T_BORRADOR_REVISION, T_REVISION_APROBADO],
    roles: [ROL_DUMMY],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("validateWorkflow — workflow válido", () => {
  it("retorna valid=true sin errores en un workflow correcto", () => {
    const result = validateWorkflow(workflowValido());
    expect(result.valid).toBe(true);
    expect(result.errors.filter((e) => e.severity === "error")).toHaveLength(0);
  });
});

describe("validateWorkflow — WF001: sin estado inicial", () => {
  it("WF001 — retorna error cuando no hay estado inicial", () => {
    const result = validateWorkflow({
      ...workflowValido(),
      estados: [
        { ...BORRADOR, es_inicial: false },
        REVISION,
        APROBADO,
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "WF001", severity: "error" }),
    );
  });
});

describe("validateWorkflow — WF002: sin estado final", () => {
  it("WF002 — retorna error cuando no hay estado final", () => {
    const result = validateWorkflow({
      ...workflowValido(),
      estados: [
        BORRADOR,
        REVISION,
        { ...APROBADO, es_final: false },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "WF002", severity: "error" }),
    );
  });
});

describe("validateWorkflow — WF003: múltiples estados iniciales", () => {
  it("WF003 — retorna error cuando hay más de un estado inicial", () => {
    const OTRO_INICIAL: EstadoInput = { id: "e4", nombre: "Inicio 2", es_inicial: true, es_final: false };
    const result = validateWorkflow({
      estados: [BORRADOR, OTRO_INICIAL, APROBADO],
      transiciones: [
        { id: "t1", estado_origen_id: "e1", estado_destino_id: "e3", accion: "saltar" },
        { id: "t2", estado_origen_id: "e4", estado_destino_id: "e3", accion: "saltar2" },
      ],
      roles: [ROL_DUMMY],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "WF003", severity: "error" }),
    );
  });
});

describe("validateWorkflow — WF004: estado intermedio sin salida", () => {
  it("WF004 — retorna error cuando un estado intermedio no tiene transición saliente", () => {
    // REVISION queda sin salida
    const result = validateWorkflow({
      estados: [BORRADOR, REVISION, APROBADO],
      transiciones: [T_BORRADOR_REVISION], // falta T_REVISION_APROBADO
      roles: [ROL_DUMMY],
    });
    expect(result.valid).toBe(false);
    const wf004 = result.errors.filter((e) => e.code === "WF004");
    expect(wf004.length).toBeGreaterThanOrEqual(1);
    expect(wf004[0]!.message).toContain("En revisión");
  });
});

describe("validateWorkflow — WF005: estado inalcanzable", () => {
  it("WF005 — retorna error cuando un estado intermedio no tiene transición entrante", () => {
    // REVISION no tiene entrada
    const result = validateWorkflow({
      estados: [BORRADOR, REVISION, APROBADO],
      transiciones: [
        { id: "t1", estado_origen_id: "e1", estado_destino_id: "e3", accion: "saltar" },
        { id: "t2", estado_origen_id: "e2", estado_destino_id: "e3", accion: "aprobar" },
      ],
      roles: [ROL_DUMMY],
    });
    expect(result.valid).toBe(false);
    const wf005 = result.errors.filter((e) => e.code === "WF005");
    expect(wf005.length).toBeGreaterThanOrEqual(1);
    expect(wf005[0]!.message).toContain("En revisión");
  });

  it("WF005 — retorna error cuando el estado final no es alcanzable", () => {
    const result = validateWorkflow({
      estados: [BORRADOR, APROBADO],
      transiciones: [], // APROBADO sin entrada
      roles: [ROL_DUMMY],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "WF005", severity: "error" }),
    );
  });
});

describe("validateWorkflow — WF006: transición con estado inexistente", () => {
  it("WF006 — retorna error cuando la transición referencia un estado origen eliminado", () => {
    const result = validateWorkflow({
      estados: [BORRADOR, APROBADO],
      transiciones: [
        { id: "t1", estado_origen_id: "FANTASMA", estado_destino_id: "e3", accion: "actuar" },
        { id: "t2", estado_origen_id: "e1", estado_destino_id: "e3", accion: "aprobar" },
      ],
      roles: [ROL_DUMMY],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "WF006", severity: "error" }),
    );
  });

  it("WF006 — retorna error cuando la transición referencia un estado destino eliminado", () => {
    const result = validateWorkflow({
      estados: [BORRADOR, APROBADO],
      transiciones: [
        { id: "t1", estado_origen_id: "e1", estado_destino_id: "FANTASMA", accion: "actuar" },
        { id: "t2", estado_origen_id: "e1", estado_destino_id: "e3", accion: "aprobar" },
      ],
      roles: [ROL_DUMMY],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "WF006", severity: "error" }),
    );
  });
});

describe("validateWorkflow — WF007: sin roles funcionales", () => {
  it("WF007 — retorna error cuando documento_rol está vacío", () => {
    const result = validateWorkflow({
      ...workflowValido(),
      roles: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "WF007", severity: "error" }),
    );
  });
});

describe("validateWorkflow — WF008: warning sin transición a estado final", () => {
  it("WF008 — emite warning cuando ninguna transición llega al estado final", () => {
    // Solo hay transición borrador→revision, nunca llegan a APROBADO
    const result = validateWorkflow({
      estados: [BORRADOR, REVISION, APROBADO],
      transiciones: [T_BORRADOR_REVISION],
      roles: [ROL_DUMMY],
    });
    // Hay errores (WF004 en REVISION sin salida, WF005 en APROBADO sin entrada)
    // pero también debe existir WF008
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "WF008", severity: "warning" }),
    );
  });
});

describe("validateWorkflow — WF009: acción duplicada", () => {
  it("WF009 — emite warning cuando la misma acción aparece dos veces desde el mismo origen", () => {
    const result = validateWorkflow({
      estados: [BORRADOR, REVISION, APROBADO],
      transiciones: [
        T_BORRADOR_REVISION,
        T_REVISION_APROBADO,
        // Duplicado: misma acción "enviar" desde BORRADOR hacia APROBADO
        { id: "t3", estado_origen_id: "e1", estado_destino_id: "e3", accion: "enviar" },
      ],
      roles: [ROL_DUMMY],
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "WF009", severity: "warning" }),
    );
    expect(result.errors.find((e) => e.code === "WF009")!.message).toContain("enviar");
  });
});

describe("validateWorkflow — múltiples errores simultáneos", () => {
  it("puede reportar varios errores en un workflow completamente vacío", () => {
    const result = validateWorkflow({ estados: [], transiciones: [], roles: [] });
    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("WF001");
    expect(codes).toContain("WF002");
    expect(codes).toContain("WF007");
  });
});
