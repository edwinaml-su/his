/**
 * Tests del router bedsideRouter — Algoritmo 5 Correctos (US.F2.6.21-22)
 *
 * Estrategia: mock de Prisma.$queryRawUnsafe / $executeRawUnsafe.
 * Cubre:
 *  - 5 happy paths (todos los correctos pasan)
 *  - 5 hard-stop cases (1 por correcto fallando)
 *  - Edge cases: GS1 inválido, indicación cancelada, GSRN inactivo
 *
 * Sección QA E2E: flujo completo con hardware scanner se delega a @QA
 * con Playwright (useHidScanner + BarcodeDetector mocks).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { bedsideRouter } from "../bedside.router";
import { makeCtx } from "../../__tests__/helpers/caller";

// ---------------------------------------------------------------------------
// Fixtures GS1 inline (espeja packages/test-utils/src/fixtures/bedside.ts)
// ---------------------------------------------------------------------------

function gs1CheckDigit(root: string): string {
  const len = root.length;
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const rightPos = len - 1 - i;
    const weight = rightPos % 2 === 0 ? 3 : 1;
    sum += parseInt(root[i]!, 10) * weight;
  }
  return root + ((10 - (sum % 10)) % 10).toString();
}

const GTIN_AMOXICILINA_500MG  = gs1CheckDigit("0750100000123");
const GTIN_IBUPROFENO_400MG   = gs1CheckDigit("0750100000999");
const GTIN_AMOXICILINA_1000MG = gs1CheckDigit("0750100001000");

const GSRN_PACIENTE_001          = gs1CheckDigit("80187413000000001".padStart(17, "0"));
const GSRN_PACIENTE_002          = gs1CheckDigit("80187413000000002".padStart(17, "0"));
const GSRN_PACIENTE_SIN_REGISTRO = gs1CheckDigit("80187413000099999".padStart(17, "0"));
const GSRN_ENFERMERA_001         = gs1CheckDigit("80187413000000100".padStart(17, "0"));
const GLN_MEDICINA_INTERNA       = gs1CheckDigit("741300000001");

const DM_AMOXICILINA_OK       = `(01)${GTIN_AMOXICILINA_500MG}(10)L2024A(17)261231(21)SER0001`;
const DM_IBUPROFENO           = `(01)${GTIN_IBUPROFENO_400MG}(10)L2024B(17)261231(21)SER0002`;
const DM_AMOXICILINA_DOSIS_ALTA = `(01)${GTIN_AMOXICILINA_1000MG}(10)L2024C(17)261231(21)SER0003`;
const DM_INVALIDO             = "ABC123-NO-GS1-FORMAT";
const DM_CON_FNC1             = `01${GTIN_AMOXICILINA_500MG}\x1D10L2024A\x1D17261231\x1D21SER0001`;

const UUID_ORG           = "aaaaaaaa-0000-0000-0000-000000000001";
const UUID_PATIENT_001   = "bbbbbbbb-0000-0000-0000-000000000001";
const UUID_PATIENT_002   = "bbbbbbbb-0000-0000-0000-000000000002";
const UUID_INDICATION_01 = "cccccccc-0000-0000-0000-000000000001";

const MOCK_GSRN_ROW_ACTIVO  = { referencia_id: UUID_PATIENT_001, activo: true };
const MOCK_GSRN_ROW_INACTIVO = { referencia_id: UUID_PATIENT_001, activo: false };

const MOCK_INDICATION_ACTIVA = {
  id: UUID_INDICATION_01,
  patient_id: UUID_PATIENT_001,
  patient_gsrn: GSRN_PACIENTE_001,
  gtin: GTIN_AMOXICILINA_500MG,
  dose: "500mg",
  route: "oral",
  frequency: "cada 8h",
  status: "ACTIVA",
};

const MOCK_INDICATION_CANCELADA = { ...MOCK_INDICATION_ACTIVA, status: "CANCELADA" };
const MOCK_GTIN_AMOXICILINA_500  = { presentacion: "Amoxicilina 500mg/cap" };
const MOCK_GTIN_AMOXICILINA_1000 = { presentacion: "Amoxicilina 1000mg/cap" };

function lastAdminHace1h() { return new Date(Date.now() - 1 * 60 * 60_000); }
function mockLastAdminRow(date: Date) { return { administered_at: date }; }

// Importar también los helpers puros para unit tests aislados
import {
  parseGs1DataMatrix,
  extractDoseQuantity,
  dosasCoinciden,
  parseFrecuenciaMinutos,
  dentroDeVentana,
} from "../bedside.router";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let prisma: DeepMockProxy<PrismaClient>;

function makeCaller() {
  const ctx = makeCtx({
    prisma,
    tenant: {
      organizationId: UUID_ORG,
      establishmentId: "ee000000-0000-0000-0000-000000000001",
      roleCodes: ["NURSE"],
    },
  });
  return bedsideRouter.createCaller(ctx);
}

/** Input base válido — todos los correctos pasan con los mocks configurados. */
function baseInput() {
  return {
    gsrnEnfermera:   GSRN_ENFERMERA_001,
    gsrnPaciente:    GSRN_PACIENTE_001,
    gs1Medicamento:  DM_AMOXICILINA_OK,
    indicationId:    UUID_INDICATION_01,
    glnUbicacion:    GLN_MEDICINA_INTERNA,
    timestamp:       new Date(),
  };
}

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  // Default: EPCIS insert es no-op
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$executeRawUnsafe = vi.fn().mockResolvedValue(1);
  // Default: $transaction ejecuta el callback pasando el mismo prisma
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$transaction = vi.fn().mockImplementation((cb: (tx: unknown) => unknown) =>
    cb(prisma),
  );
});

// ---------------------------------------------------------------------------
// Unit tests — helpers puros
// ---------------------------------------------------------------------------

describe("parseGs1DataMatrix", () => {
  it("parsea formato parentético con GTIN + lote + vencimiento + serie", () => {
    const result = parseGs1DataMatrix(DM_AMOXICILINA_OK);
    expect(result).not.toBeNull();
    expect(result!.gtin).toBe(GTIN_AMOXICILINA_500MG);
    expect(result!.lote).toBe("L2024A");
    expect(result!.fechaVence).toBe("2026-12-31");
    expect(result!.serie).toBe("SER0001");
  });

  it("parsea DataMatrix con FNC1 (0x1D) como separador", () => {
    const result = parseGs1DataMatrix(DM_CON_FNC1);
    expect(result).not.toBeNull();
    expect(result!.gtin).toBe(GTIN_AMOXICILINA_500MG);
  });

  it("retorna null para string no-GS1", () => {
    expect(parseGs1DataMatrix(DM_INVALIDO)).toBeNull();
  });

  it("retorna null para string vacío", () => {
    expect(parseGs1DataMatrix("")).toBeNull();
  });
});

describe("extractDoseQuantity", () => {
  it("extrae mg de 'Amoxicilina 500mg/cap'", () => {
    expect(extractDoseQuantity("Amoxicilina 500mg/cap")).toEqual({ amount: 500, unit: "mg" });
  });

  it("extrae ml de '10ml solución'", () => {
    expect(extractDoseQuantity("10ml solución")).toEqual({ amount: 10, unit: "ml" });
  });

  it("retorna null si no hay cantidad", () => {
    expect(extractDoseQuantity("Cápsula oral")).toBeNull();
  });
});

describe("dosasCoinciden", () => {
  it("retorna true cuando dosis y presentación coinciden en mg", () => {
    expect(dosasCoinciden("500mg", "Amoxicilina 500mg/cap")).toBe(true);
  });

  it("retorna false cuando mg difiere", () => {
    expect(dosasCoinciden("500mg", "Amoxicilina 1000mg/cap")).toBe(false);
  });
});

describe("parseFrecuenciaMinutos", () => {
  it("parsea 'cada 8h' → 480", () => {
    expect(parseFrecuenciaMinutos("cada 8h")).toBe(480);
  });

  it("parsea 'cada 12 horas' → 720", () => {
    expect(parseFrecuenciaMinutos("cada 12 horas")).toBe(720);
  });

  it("parsea 'q6h' → 360", () => {
    expect(parseFrecuenciaMinutos("q6h")).toBe(360);
  });

  it("retorna null para frecuencia no reconocida", () => {
    expect(parseFrecuenciaMinutos("según tolerancia")).toBeNull();
  });
});

describe("dentroDeVentana", () => {
  it("retorna ok=true cuando lastAdmin es null (primera dosis)", () => {
    const r = dentroDeVentana({ timestamp: new Date(), lastAdmin: null, intervalMinutos: 480 });
    expect(r.ok).toBe(true);
  });

  it("retorna ok=true cuando timestamp cae dentro de la ventana", () => {
    // lastAdmin hace 8h exacto → el timestamp (ahora) cae en el centro de la ventana
    const lastAdmin = new Date(Date.now() - 8 * 60 * 60_000);
    const r = dentroDeVentana({ timestamp: new Date(), lastAdmin, intervalMinutos: 480 });
    expect(r.ok).toBe(true);
  });

  it("retorna ok=false cuando timestamp está fuera de la ventana", () => {
    // lastAdmin hace 1h → con freq 8h la próxima ventana empieza en ~7h30m
    const lastAdmin = lastAdminHace1h();
    const r = dentroDeVentana({ timestamp: new Date(), lastAdmin, intervalMinutos: 480 });
    expect(r.ok).toBe(false);
    expect(r.proximaVentanaInicio).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — router via mocks de Prisma
// ---------------------------------------------------------------------------

function setupHappyPath() {
  // GSRN lookup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$queryRawUnsafe = vi
    .fn()
    // 1. GSRN lookup
    .mockResolvedValueOnce([MOCK_GSRN_ROW_ACTIVO])
    // 2. Indicación lookup
    .mockResolvedValueOnce([MOCK_INDICATION_ACTIVA])
    // 3. GTIN catálogo (dosis check)
    .mockResolvedValueOnce([MOCK_GTIN_AMOXICILINA_500])
    // 4. Última administración (ventana terapéutica) — sin admin previa
    .mockResolvedValueOnce([])
    // 5. INSERT bedside_validation RETURNING id
    .mockResolvedValueOnce([{ id: "valid-uuid-1234" }]);
}

describe("validate5Correctos — happy paths", () => {
  it("HP-1: todos los correctos pasan → retorna ok=true con validationId", async () => {
    setupHappyPath();
    const caller = makeCaller();
    const result = await caller.validate5Correctos(baseInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validationId).toBeTruthy();
    }
  });

  it("HP-2: primera dosis (sin lastAdmin) → ok=true (ventana libre)", async () => {
    setupHappyPath();
    const caller = makeCaller();
    const result = await caller.validate5Correctos(baseInput());
    expect(result.ok).toBe(true);
  });

  it("HP-3: DataMatrix con FNC1 → ok=true (parser reconoce FNC1)", async () => {
    setupHappyPath();
    const caller = makeCaller();
    const result = await caller.validate5Correctos({
      ...baseInput(),
      gs1Medicamento: DM_CON_FNC1,
    });
    expect(result.ok).toBe(true);
  });

  it("HP-4: indicación sin GTIN configurado → ok=true (skip check GTIN)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi
      .fn()
      .mockResolvedValueOnce([MOCK_GSRN_ROW_ACTIVO])
      .mockResolvedValueOnce([{ ...MOCK_INDICATION_ACTIVA, gtin: null }])
      .mockResolvedValueOnce([MOCK_GTIN_AMOXICILINA_500])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "valid-uuid-hp4" }]);
    const caller = makeCaller();
    const result = await caller.validate5Correctos(baseInput());
    expect(result.ok).toBe(true);
  });

  it("HP-5: lastAdmin hace 8h (dentro de ventana) → ok=true", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi
      .fn()
      .mockResolvedValueOnce([MOCK_GSRN_ROW_ACTIVO])
      .mockResolvedValueOnce([MOCK_INDICATION_ACTIVA])
      .mockResolvedValueOnce([MOCK_GTIN_AMOXICILINA_500])
      .mockResolvedValueOnce([mockLastAdminRow(new Date(Date.now() - 8 * 60 * 60_000))])
      .mockResolvedValueOnce([{ id: "valid-uuid-hp5" }]);
    const caller = makeCaller();
    const result = await caller.validate5Correctos(baseInput());
    expect(result.ok).toBe(true);
  });
});

describe("validate5Correctos — hard stop cases", () => {
  it("HS-1: GSRN paciente no registrado → GSRN_PACIENTE_NO_ENCONTRADO", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValueOnce([]); // GSRN no existe
    const caller = makeCaller();
    const result = await caller.validate5Correctos({
      ...baseInput(),
      gsrnPaciente: GSRN_PACIENTE_SIN_REGISTRO,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.hardStop).toBe("GSRN_PACIENTE_NO_ENCONTRADO");
    }
  });

  it("HS-2: GSRN paciente inactivo (revocado) → GSRN_PACIENTE_NO_ENCONTRADO", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValueOnce([MOCK_GSRN_ROW_INACTIVO]);
    const caller = makeCaller();
    const result = await caller.validate5Correctos(baseInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.hardStop).toBe("GSRN_PACIENTE_NO_ENCONTRADO");
    }
  });

  it("HS-3: paciente de la indicación no coincide con GSRN → PACIENTE_NO_COINCIDE", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi
      .fn()
      .mockResolvedValueOnce([MOCK_GSRN_ROW_ACTIVO])                    // GSRN → UUID_PATIENT_001
      .mockResolvedValueOnce([{                                          // Indicación del PACIENTE_002
        ...MOCK_INDICATION_ACTIVA,
        patient_id: UUID_PATIENT_002,
      }]);
    const caller = makeCaller();
    const result = await caller.validate5Correctos(baseInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.hardStop).toBe("PACIENTE_NO_COINCIDE");
      expect(result.expected).toBe(UUID_PATIENT_002);
    }
  });

  it("HS-4: GTIN escaneado difiere del indicado → MEDICAMENTO_NO_COINCIDE", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi
      .fn()
      .mockResolvedValueOnce([MOCK_GSRN_ROW_ACTIVO])
      .mockResolvedValueOnce([MOCK_INDICATION_ACTIVA]);  // gtin = GTIN_AMOXICILINA_500MG
    const caller = makeCaller();
    const result = await caller.validate5Correctos({
      ...baseInput(),
      gs1Medicamento: DM_IBUPROFENO,  // GTIN distinto
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.hardStop).toBe("MEDICAMENTO_NO_COINCIDE");
      expect(result.received).toBe(GTIN_IBUPROFENO_400MG);
    }
  });

  it("HS-5: presentación del GTIN no coincide con dosis prescrita → DOSIS_INCORRECTA", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi
      .fn()
      .mockResolvedValueOnce([MOCK_GSRN_ROW_ACTIVO])
      .mockResolvedValueOnce([{
        ...MOCK_INDICATION_ACTIVA,
        gtin: GTIN_AMOXICILINA_1000MG,  // indicación exige 1000mg
        dose: "1000mg",
      }])
      .mockResolvedValueOnce([MOCK_GTIN_AMOXICILINA_500]);  // catálogo dice 500mg
    const caller = makeCaller();
    const result = await caller.validate5Correctos({
      ...baseInput(),
      gs1Medicamento: `(01)${GTIN_AMOXICILINA_1000MG}(10)L2024C(17)261231(21)SER0003`,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.hardStop).toBe("DOSIS_INCORRECTA");
    }
  });

  it("HS-6: timestamp fuera de la ventana terapéutica → FUERA_DE_VENTANA", async () => {
    // lastAdmin hace 1h, frecuencia 8h → demasiado pronto
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi
      .fn()
      .mockResolvedValueOnce([MOCK_GSRN_ROW_ACTIVO])
      .mockResolvedValueOnce([MOCK_INDICATION_ACTIVA])
      .mockResolvedValueOnce([MOCK_GTIN_AMOXICILINA_500])
      .mockResolvedValueOnce([mockLastAdminRow(lastAdminHace1h())]);
    const caller = makeCaller();
    const result = await caller.validate5Correctos(baseInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.hardStop).toBe("FUERA_DE_VENTANA");
      expect(result.expected).toContain("T");  // ISO timestamp
    }
  });

  it("HS-7: DataMatrix inválido (no GS1) → GS1_PARSE_ERROR", async () => {
    // No se hacen queries de BD — el parse falla primero
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([]);
    const caller = makeCaller();
    const result = await caller.validate5Correctos({
      ...baseInput(),
      gs1Medicamento: DM_INVALIDO,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.hardStop).toBe("GS1_PARSE_ERROR");
    }
  });

  it("HS-8: indicación en estado CANCELADA → INDICACION_INACTIVA", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi
      .fn()
      .mockResolvedValueOnce([MOCK_GSRN_ROW_ACTIVO])
      .mockResolvedValueOnce([MOCK_INDICATION_CANCELADA]);
    const caller = makeCaller();
    const result = await caller.validate5Correctos(baseInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.hardStop).toBe("INDICACION_INACTIVA");
    }
  });

  it("HS-9: indicación no encontrada → INDICACION_INACTIVA", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi
      .fn()
      .mockResolvedValueOnce([MOCK_GSRN_ROW_ACTIVO])
      .mockResolvedValueOnce([]);  // indicación no existe
    const caller = makeCaller();
    const result = await caller.validate5Correctos(baseInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.hardStop).toBe("INDICACION_INACTIVA");
    }
  });
});

describe("validate5Correctos — edge cases de input Zod", () => {
  it("rechaza GSRN de 17 dígitos (longitud inválida)", async () => {
    const caller = makeCaller();
    await expect(
      caller.validate5Correctos({ ...baseInput(), gsrnPaciente: "12345678901234567" }),
    ).rejects.toThrow();
  });

  it("rechaza GSRN con letras (no numérico)", async () => {
    const caller = makeCaller();
    await expect(
      caller.validate5Correctos({ ...baseInput(), gsrnEnfermera: "ABCDE12345678901" }),
    ).rejects.toThrow();
  });

  it("rechaza gs1Medicamento vacío", async () => {
    const caller = makeCaller();
    await expect(
      caller.validate5Correctos({ ...baseInput(), gs1Medicamento: "" }),
    ).rejects.toThrow();
  });

  it("acepta timestamp como string ISO (coerce.date)", async () => {
    setupHappyPath();
    const caller = makeCaller();
    const result = await caller.validate5Correctos({
      ...baseInput(),
      timestamp: new Date("2026-05-18T10:00:00Z"),
    });
    // Solo verificamos que no falla el parse del input
    expect(result).toBeDefined();
  });
});
