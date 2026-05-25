/**
 * Compliance tests — JCI IPSG.4 ME 3
 * "Implement a process to ensure correct patient and correct-site surgery."
 * WHO Surgical Safety Checklist — Sign-In, Time-Out, Sign-Out obligatorios.
 *
 * US.JCI.5.13 — El acto quirúrgico NO puede transicionar a estado final
 * sin tener las 3 pausas del WHO Safety Checklist completadas.
 *
 * Estrategia: función pura que replica la lógica del trigger
 * `ece.fn_assert_who_checklist_complete()` sin necesidad de BD.
 * Los estados válidos de who_checklist.estado son:
 *   'iniciado' | 'sign_in_completo' | 'time_out_completo' | 'completo'
 */

// JCI Standard: IPSG.4 ME 3

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Tipos que espeja el modelo de BD
// ---------------------------------------------------------------------------

type WhoChecklistEstado =
  | "iniciado"
  | "sign_in_completo"
  | "time_out_completo"
  | "completo";

interface WhoEnforcementArgs {
  /** true = el estado destino es es_final en flujo_estado */
  esFinal: boolean;
  /** codigo del tipo_documento ('ACTO_QX' u otro) */
  tipoDocumentoCodigo: string;
  /** null = no existe acto_quirurgico vinculado a la instancia */
  actoExists: boolean;
  /** null = no existe WHO checklist para el acto; string = estado actual */
  whoEstado: WhoChecklistEstado | null;
}

// ---------------------------------------------------------------------------
// Función pura que replica la lógica del trigger plpgsql
// Throws Error con el mismo mensaje que el RAISE EXCEPTION de BD.
// Retorna 'NEW' (void) si la transición es permitida.
// ---------------------------------------------------------------------------

function runWhoEnforcementCheck(args: WhoEnforcementArgs): void {
  // Paso 1: transición no final → permitir sin checks
  if (!args.esFinal) return;

  // Paso 2: tipo documento no es ACTO_QX → permitir
  if (args.tipoDocumentoCodigo !== "ACTO_QX") return;

  // Paso 3: acto quirúrgico no encontrado
  if (!args.actoExists) {
    throw new Error(
      "PRECONDITION_FAILED: IPSG4_ACTO_QX_NOT_FOUND — No se encontró acto quirúrgico para la instancia",
    );
  }

  // Paso 4a: WHO checklist no existe
  if (args.whoEstado === null) {
    throw new Error(
      "PRECONDITION_FAILED: IPSG4_WHO_CHECKLIST_MISSING — WHO Safety Checklist no existe para el acto quirúrgico",
    );
  }

  // Paso 4b: WHO checklist incompleto
  if (args.whoEstado !== "completo") {
    throw new Error(
      `PRECONDITION_FAILED: IPSG4_WHO_CHECKLIST_INCOMPLETE — Las 3 pausas del WHO deben estar completas (Sign-In, Time-Out, Sign-Out). Estado actual: ${args.whoEstado}`,
    );
  }

  // WHO completo → permitir transición
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTO_QX_BASE: Pick<WhoEnforcementArgs, "tipoDocumentoCodigo" | "actoExists"> = {
  tipoDocumentoCodigo: "ACTO_QX",
  actoExists:          true,
};

// ---------------------------------------------------------------------------
// Tests IPSG.4 ME 3
// ---------------------------------------------------------------------------

describe("IPSG.4 ME 3 — WHO Safety Checklist enforcement en cierre de acto quirúrgico", () => {

  // -- Transición a estado NO final (borrador → borrador) ----------------------

  it("transición a estado no-final → permitido sin verificar WHO", () => {
    // JCI IPSG.4 ME 3 — solo estados finales requieren WHO completo.
    expect(() =>
      runWhoEnforcementCheck({
        ...ACTO_QX_BASE,
        esFinal:    false,
        whoEstado:  null, // no existe WHO — pero no importa porque no es cierre
      }),
    ).not.toThrow();
  });

  // -- Tipo de documento diferente a ACTO_QX -----------------------------------

  it("tipo_documento != ACTO_QX (ej. EPICRISIS) → permitido sin verificar WHO", () => {
    // El trigger solo aplica a actos quirúrgicos.
    expect(() =>
      runWhoEnforcementCheck({
        esFinal:             true,
        tipoDocumentoCodigo: "EPICRISIS",
        actoExists:          true,
        whoEstado:           null,
      }),
    ).not.toThrow();
  });

  // -- ACTO_QX sin WHO checklist existente ------------------------------------

  it("cierre de ACTO_QX sin WHO checklist → IPSG4_WHO_CHECKLIST_MISSING", () => {
    // JCI IPSG.4 ME 3 — el checklist debe existir antes de cerrar.
    expect(() =>
      runWhoEnforcementCheck({
        ...ACTO_QX_BASE,
        esFinal:   true,
        whoEstado: null,
      }),
    ).toThrow("IPSG4_WHO_CHECKLIST_MISSING");
  });

  // -- ACTO_QX con WHO solo en Sign-In ----------------------------------------

  it("cierre con WHO en estado 'iniciado' → IPSG4_WHO_CHECKLIST_INCOMPLETE", () => {
    // JCI IPSG.4 ME 3 — 'iniciado' no tiene ninguna pausa completa.
    expect(() =>
      runWhoEnforcementCheck({
        ...ACTO_QX_BASE,
        esFinal:   true,
        whoEstado: "iniciado",
      }),
    ).toThrow("IPSG4_WHO_CHECKLIST_INCOMPLETE");
  });

  it("cierre con WHO en estado 'sign_in_completo' → IPSG4_WHO_CHECKLIST_INCOMPLETE", () => {
    // JCI IPSG.4 ME 3 — solo Sign-In no es suficiente; faltan Time-Out y Sign-Out.
    expect(() =>
      runWhoEnforcementCheck({
        ...ACTO_QX_BASE,
        esFinal:   true,
        whoEstado: "sign_in_completo",
      }),
    ).toThrow("IPSG4_WHO_CHECKLIST_INCOMPLETE");
  });

  it("cierre con WHO en estado 'time_out_completo' → IPSG4_WHO_CHECKLIST_INCOMPLETE", () => {
    // JCI IPSG.4 ME 3 — Sign-In + Time-Out completados, pero falta Sign-Out.
    expect(() =>
      runWhoEnforcementCheck({
        ...ACTO_QX_BASE,
        esFinal:   true,
        whoEstado: "time_out_completo",
      }),
    ).toThrow("IPSG4_WHO_CHECKLIST_INCOMPLETE");
  });

  // -- ACTO_QX sin acto_quirurgico vinculado ----------------------------------

  it("instancia ACTO_QX sin acto_quirurgico row → IPSG4_ACTO_QX_NOT_FOUND", () => {
    // Integridad referencial rota — el trigger lo detecta explícitamente.
    expect(() =>
      runWhoEnforcementCheck({
        esFinal:             true,
        tipoDocumentoCodigo: "ACTO_QX",
        actoExists:          false,
        whoEstado:           "completo",
      }),
    ).toThrow("IPSG4_ACTO_QX_NOT_FOUND");
  });

  // -- Happy path: WHO completo → cierre permitido ----------------------------

  it("cierre con WHO en estado 'completo' → permitido (Sign-In + Time-Out + Sign-Out OK)", () => {
    // JCI IPSG.4 ME 3 — happy path: las 3 pausas completadas.
    expect(() =>
      runWhoEnforcementCheck({
        ...ACTO_QX_BASE,
        esFinal:   true,
        whoEstado: "completo",
      }),
    ).not.toThrow();
  });

  // -- Mensaje de error incluye estado actual para diagnóstico ----------------

  it("error INCOMPLETE incluye el estado actual para trazabilidad", () => {
    // Facilita diagnóstico en logs clínicos — el estado debe aparecer en el mensaje.
    expect(() =>
      runWhoEnforcementCheck({
        ...ACTO_QX_BASE,
        esFinal:   true,
        whoEstado: "sign_in_completo",
      }),
    ).toThrow("sign_in_completo");
  });

  // -- Variantes de tipo_documento que NO deben disparar el check -------------

  it.each(["EPICRISIS", "HIST_CLIN", "EVOL_MED", "CONS_QX", "PREOP_CHECK"])(
    "tipo_documento=%s → no aplica check WHO aunque sea estado final",
    (codigo) => {
      expect(() =>
        runWhoEnforcementCheck({
          esFinal:             true,
          tipoDocumentoCodigo: codigo,
          actoExists:          true,
          whoEstado:           null,
        }),
      ).not.toThrow();
    },
  );
});

// ---------------------------------------------------------------------------
// @QA — escenarios E2E adicionales (Playwright)
// ---------------------------------------------------------------------------
// @QA E2E:
//   - Intentar firmar acto quirúrgico sin abrir WHO checklist → error BD MISSING.
//   - Completar solo Sign-In y firmar → error INCOMPLETE con estado 'sign_in_completo'.
//   - Completar Sign-In + Time-Out y firmar → error INCOMPLETE con estado 'time_out_completo'.
//   - Completar las 3 pausas (estado='completo') y firmar → transición exitosa.
//   - Firmar epicrisis del mismo episodio → no dispara validación WHO.
//   - Verificar que `documento_instancia_historial` contiene la row de cierre tras happy path.
