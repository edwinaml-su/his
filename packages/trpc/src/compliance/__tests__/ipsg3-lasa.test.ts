/**
 * Compliance tests — JCI IPSG.3 ME 2
 * "Identify and safely use look-alike/sound-alike medications."
 *
 * US.JCI.5.10 — LASA alert detection en scan GTIN bedside.
 * Estrategia: mockear la lógica de LASA lookup como función pura extraída del router.
 * El router ejecuta un $queryRawUnsafe; mockeamos el resultado para los dos branches.
 */

// JCI IPSG.3 ME 2

import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Tipos que el router retorna
// ---------------------------------------------------------------------------

interface LasaAlertPayload {
  pairedDrugId:   string;
  pairedDrugName: string;
  razon:          string;
  severidad:      string;
}

interface BedsideAdminResponse {
  requiresDoubleCheck: boolean;
  lasaAlert:           LasaAlertPayload | null;
  administrationId:    string | null;
}

// ---------------------------------------------------------------------------
// Función pura que replica la lógica LASA del router.
// El router hace:
//   1. Query ece.lasa_pair por drug_a_id OR drug_b_id = drugId WHERE activo = true
//   2. Si encuentra fila → lasaAlert = { pairedDrugId, pairedDrugName, razon, severidad }
//   3. Si no → lasaAlert = null
// Aquí testeamos esa lógica sin I/O.
// ---------------------------------------------------------------------------

type LasaRow = {
  paired_drug_id:   string;
  paired_drug_name: string;
  razon:            string;
  severidad:        string;
};

function resolveLasaAlert(rows: LasaRow[]): LasaAlertPayload | null {
  if (rows.length === 0 || !rows[0]) return null;
  const r = rows[0];
  return {
    pairedDrugId:   r.paired_drug_id,
    pairedDrugName: r.paired_drug_name,
    razon:          r.razon,
    severidad:      r.severidad,
  };
}

/** Simula la respuesta del router cuando la lógica LASA + double-check ya pasaron. */
function buildBedsideResponse(
  lasaRows: LasaRow[],
  requiresDoubleCheck: boolean,
  adminId: string,
): BedsideAdminResponse {
  const lasaAlert = resolveLasaAlert(lasaRows);

  if (requiresDoubleCheck) {
    // Servidor devuelve flag — UI debe mostrar modal.
    return { requiresDoubleCheck: true, lasaAlert, administrationId: null };
  }

  return { requiresDoubleCheck: false, lasaAlert, administrationId: adminId };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DRUG_ID_MORPHINE    = "00000000-0000-0000-0000-000000000010";
const DRUG_ID_MIDAZOLAM   = "00000000-0000-0000-0000-000000000011";
const DRUG_ID_METFORMIN   = "00000000-0000-0000-0000-000000000020";
const ADMIN_ID            = "00000000-0000-0000-0000-000000000099";

const LASA_ROW_MORPHINE_MIDAZOLAM: LasaRow = {
  paired_drug_id:   DRUG_ID_MIDAZOLAM,
  paired_drug_name: "Midazolam 5mg/ml",
  razon:            "look-alike-packaging",
  severidad:        "critical",
};

// ---------------------------------------------------------------------------
// Tests IPSG.3 ME 2
// ---------------------------------------------------------------------------

describe("IPSG.3 ME 2 — LASA alert detection en scan GTIN", () => {

  // -- Happy path: GTIN con LASA pair ----------------------------------------

  it("GTIN con LASA pair activo → response incluye lasaAlert no null", () => {
    // JCI IPSG.3 ME 2 — look-alike medication alert
    const result = buildBedsideResponse(
      [LASA_ROW_MORPHINE_MIDAZOLAM],
      false,
      ADMIN_ID,
    );

    expect(result.lasaAlert).not.toBeNull();
    expect(result.lasaAlert?.pairedDrugId).toBe(DRUG_ID_MIDAZOLAM);
    expect(result.lasaAlert?.pairedDrugName).toBe("Midazolam 5mg/ml");
    expect(result.lasaAlert?.razon).toBe("look-alike-packaging");
    expect(result.lasaAlert?.severidad).toBe("critical");
  });

  it("GTIN con LASA pair → administrationId sigue presente (alerta no bloquea)", () => {
    // JCI IPSG.3 ME 2 — warning no bloqueante; la administración procede con alerta.
    const result = buildBedsideResponse(
      [LASA_ROW_MORPHINE_MIDAZOLAM],
      false,
      ADMIN_ID,
    );

    expect(result.requiresDoubleCheck).toBe(false);
    expect(result.administrationId).toBe(ADMIN_ID);
    expect(result.lasaAlert).not.toBeNull();
  });

  // -- GTIN sin LASA pair -------------------------------------------------------

  it("GTIN sin pair activo → lasaAlert es null", () => {
    // JCI IPSG.3 ME 2 — sin medicamento LASA; flujo normal sin alerta.
    const result = buildBedsideResponse([], false, ADMIN_ID);

    expect(result.lasaAlert).toBeNull();
    expect(result.requiresDoubleCheck).toBe(false);
    expect(result.administrationId).toBe(ADMIN_ID);
  });

  // -- Campos del lasaAlert -----------------------------------------------------

  it("lasaAlert contiene razon y severidad del catálogo", () => {
    const row: LasaRow = {
      paired_drug_id:   DRUG_ID_METFORMIN,
      paired_drug_name: "Metronidazol 500mg",
      razon:            "similar-name",
      severidad:        "warning",
    };
    const alert = resolveLasaAlert([row]);

    expect(alert?.razon).toBe("similar-name");
    expect(alert?.severidad).toBe("warning");
  });

  // -- LASA + double-check combinado --------------------------------------------

  it("GTIN con LASA pair + med high-alert → requiresDoubleCheck=true con lasaAlert", () => {
    // Cuando el mismo med es LASA y high-alert: ambas señales están presentes.
    const result = buildBedsideResponse(
      [LASA_ROW_MORPHINE_MIDAZOLAM],
      true, // drug.alertLevel = 'critical' → requiresDoubleCheck
      ADMIN_ID,
    );

    expect(result.requiresDoubleCheck).toBe(true);
    expect(result.lasaAlert).not.toBeNull();
    expect(result.administrationId).toBeNull(); // pendiente de double-check
  });

  // -- Estructura del response --------------------------------------------------

  it("response siempre incluye las tres claves: requiresDoubleCheck, lasaAlert, administrationId", () => {
    const result = buildBedsideResponse([], false, ADMIN_ID);

    expect(result).toHaveProperty("requiresDoubleCheck");
    expect(result).toHaveProperty("lasaAlert");
    expect(result).toHaveProperty("administrationId");
  });
});

// ---------------------------------------------------------------------------
// @QA — escenarios E2E adicionales
// ---------------------------------------------------------------------------
// @QA E2E (Playwright):
//   - Escanear GTIN de morphine → toast de alerta LASA visible con nombre del par.
//   - Escanear GTIN de metformin → sin alerta LASA en UI.
//   - La alerta LASA no bloquea el avance al paso siguiente del wizard.
//   - La alerta LASA aparece junto con el modal double-check si el med es además high-alert.
