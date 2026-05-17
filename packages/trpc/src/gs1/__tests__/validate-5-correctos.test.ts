/**
 * Tests — validate5Correctos + applyGs1Validation
 *
 * 01. Paciente OK (GSRN válido + match)
 * 02. Paciente FAIL — GSRN checksum incorrecto
 * 03. Paciente FAIL — GSRN sin registro en catálogo
 * 04. Paciente FAIL — GSRN registrado pero otro paciente
 * 05. Paciente WARNING — sin GSRN
 * 06. Medicamento FAIL — GTIN no encontrado
 * 07. Medicamento FAIL — vencido (BD)
 * 08. Medicamento FAIL — vencido (escaneado)
 * 09. Dosis FAIL — fuera de tolerancia
 * 10. Dosis FAIL — unidad distinta
 * 11. Dosis OK — dentro de tolerancia ±10 %
 * 12. Via FAIL — no coincide
 * 13. Hora FAIL — fuera de ventana ±30 min
 * 14. Hora OK — justo en el límite 30 min
 * 15. Happy path completo — 5/5 correctos
 * 16. applyGs1Validation — PRECONDITION_FAILED cuando valid=false
 * 17. applyGs1Validation — pass-through cuando valid=true
 * 18. applyGs1Validation — skip si input sin campos GS1
 */

import { describe, it, expect, vi } from "vitest";
import { validate5Correctos } from "../validate-5-correctos";
import { applyGs1Validation } from "../require-gs1-validation";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const GTIN_OK  = "00012345678905"; // 14 dígitos
const LOTE_OK  = "L-2024-001";
const PAC_ID   = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const IND_ID   = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// GSRN válido: 17 dígitos + checksum GS1-18
// Construimos uno manualmente:
// gsrn prefix: 80181234567890123 (17 dígitos)
// weights: [3,1,3,1,3,1,3,1,3,1,3,1,3,1,3,1,3]
// sum = 8*3 + 0*1 + 1*3 + 8*1 + 1*3 + 2*1 + 3*3 + 4*1 + 5*3 + 6*1 + 7*3 + 8*1 + 9*3 + 0*1 + 1*3 + 2*1 + 3*3
//     = 24+0+3+8+3+2+9+4+15+6+21+8+27+0+3+2+9 = 144
// check = (10 - 144%10) % 10 = (10 - 4) % 10 = 6
const GSRN_OK  = "801812345678901236";
const GSRN_BAD = "801812345678901239"; // checksum incorrecto

const FUTURE  = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // +1 año
const PAST    = new Date(Date.now() - 24 * 60 * 60 * 1000);        // ayer

const HORA_BASE  = new Date("2026-05-17T08:00:00Z");
const HORA_29MIN = new Date(HORA_BASE.getTime() + 29 * 60 * 1000);
const HORA_31MIN = new Date(HORA_BASE.getTime() + 31 * 60 * 1000);
const HORA_30MIN = new Date(HORA_BASE.getTime() + 30 * 60 * 1000); // límite exacto — OK

// ─── Mock DB builder ────────────────────────────────────────────────────────

interface MockDbConfig {
  gsrnRows?: Array<{ gsrn: string; referencia_id: string; activo: boolean }>;
  gtinRows?: Array<{ gtin: string; lote: string; vencimiento: Date; activo: boolean }>;
  itemRows?: Array<{ dosis: string | null; via: string | null; hora_programada: Date | null }>;
}

function makeDb(cfg: MockDbConfig): Pick<PrismaClient, "$queryRaw"> {
  const gsrnRows = cfg.gsrnRows ?? [];
  const gtinRows = cfg.gtinRows ?? [];
  const itemRows = cfg.itemRows ?? [];

  let call = 0;
  const mock = vi.fn().mockImplementation(() => {
    // Las queries se hacen en orden fijo: gsrn (si aplica), gtin, item
    const seq = [gsrnRows, gtinRows, itemRows];
    return Promise.resolve(seq[call++ % seq.length]);
  });

  return { $queryRaw: mock as unknown as PrismaClient["$queryRaw"] };
}

/**
 * Cuando no hay pacienteGsrn, la primera query es gtin, no gsrn.
 * Usamos un builder alternativo que respeta ese orden.
 */
function makeDbNoGsrn(cfg: Omit<MockDbConfig, "gsrnRows">): Pick<PrismaClient, "$queryRaw"> {
  const gtinRows = cfg.gtinRows ?? [];
  const itemRows = cfg.itemRows ?? [];
  let call = 0;
  const mock = vi.fn().mockImplementation(() => {
    const seq = [gtinRows, itemRows];
    return Promise.resolve(seq[call++ % seq.length]);
  });
  return { $queryRaw: mock as unknown as PrismaClient["$queryRaw"] };
}

const GTIN_ROW_OK = { gtin: GTIN_OK, lote: LOTE_OK, vencimiento: FUTURE, activo: true };
const GSRN_ROW_OK = { gsrn: GSRN_OK, referencia_id: PAC_ID, activo: true };
const ITEM_ROW_OK = { dosis: "500mg", via: "oral", hora_programada: HORA_BASE };

const BASE_INPUT = {
  gtin: GTIN_OK,
  lote: LOTE_OK,
  expiry: FUTURE,
  pacienteId: PAC_ID,
  pacienteGsrn: GSRN_OK,
  dosis: "500mg",
  via: "oral",
  hora: HORA_BASE,
  indicacionItemId: IND_ID,
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("validate5Correctos", () => {
  // 01
  it("01 — paciente OK: GSRN válido + match", async () => {
    const db = makeDb({ gsrnRows: [GSRN_ROW_OK], gtinRows: [GTIN_ROW_OK], itemRows: [ITEM_ROW_OK] });
    const r = await validate5Correctos(db, BASE_INPUT);
    expect(r.correctos.paciente).toBe(true);
    expect(r.errores.filter((e) => e.campo === "paciente")).toHaveLength(0);
  });

  // 02
  it("02 — paciente FAIL: GSRN checksum incorrecto", async () => {
    const db = makeDb({ gsrnRows: [], gtinRows: [GTIN_ROW_OK], itemRows: [ITEM_ROW_OK] });
    const r = await validate5Correctos(db, { ...BASE_INPUT, pacienteGsrn: GSRN_BAD });
    expect(r.correctos.paciente).toBe(false);
    expect(r.errores.find((e) => e.campo === "paciente")?.severity).toBe("error");
    expect(r.errores.find((e) => e.campo === "paciente")?.mensaje).toMatch(/checksum/i);
  });

  // 03
  it("03 — paciente FAIL: GSRN no en catálogo", async () => {
    const db = makeDb({ gsrnRows: [], gtinRows: [GTIN_ROW_OK], itemRows: [ITEM_ROW_OK] });
    const r = await validate5Correctos(db, BASE_INPUT); // GSRN_OK pero no en catálogo
    expect(r.correctos.paciente).toBe(false);
    expect(r.errores.find((e) => e.campo === "paciente")?.mensaje).toMatch(/no registrado/i);
  });

  // 04
  it("04 — paciente FAIL: GSRN registrado pero otro paciente", async () => {
    const db = makeDb({
      gsrnRows: [{ ...GSRN_ROW_OK, referencia_id: "cccccccc-cccc-cccc-cccc-cccccccccccc" }],
      gtinRows: [GTIN_ROW_OK],
      itemRows: [ITEM_ROW_OK],
    });
    const r = await validate5Correctos(db, BASE_INPUT);
    expect(r.correctos.paciente).toBe(false);
    expect(r.errores.find((e) => e.campo === "paciente")?.mensaje).toMatch(/otro paciente/i);
  });

  // 05
  it("05 — paciente WARNING: sin GSRN", async () => {
    const db = makeDbNoGsrn({ gtinRows: [GTIN_ROW_OK], itemRows: [ITEM_ROW_OK] });
    const input = { ...BASE_INPUT, pacienteGsrn: undefined };
    const r = await validate5Correctos(db, input);
    expect(r.correctos.paciente).toBe(false);
    const err = r.errores.find((e) => e.campo === "paciente");
    expect(err?.severity).toBe("warning");
  });

  // 06
  it("06 — medicamento FAIL: GTIN no encontrado", async () => {
    const db = makeDb({ gsrnRows: [GSRN_ROW_OK], gtinRows: [], itemRows: [ITEM_ROW_OK] });
    const r = await validate5Correctos(db, BASE_INPUT);
    expect(r.correctos.medicamento).toBe(false);
    expect(r.errores.find((e) => e.campo === "medicamento")?.mensaje).toMatch(/no encontrado/i);
  });

  // 07
  it("07 — medicamento FAIL: vencido según BD", async () => {
    const db = makeDb({
      gsrnRows: [GSRN_ROW_OK],
      gtinRows: [{ ...GTIN_ROW_OK, vencimiento: PAST }],
      itemRows: [ITEM_ROW_OK],
    });
    const r = await validate5Correctos(db, BASE_INPUT);
    expect(r.correctos.medicamento).toBe(false);
    expect(r.errores.find((e) => e.campo === "medicamento")?.mensaje).toMatch(/vencido/i);
  });

  // 08
  it("08 — medicamento FAIL: vencido según código escaneado", async () => {
    const db = makeDb({ gsrnRows: [GSRN_ROW_OK], gtinRows: [GTIN_ROW_OK], itemRows: [ITEM_ROW_OK] });
    const r = await validate5Correctos(db, { ...BASE_INPUT, expiry: PAST });
    expect(r.correctos.medicamento).toBe(false);
    expect(r.errores.find((e) => e.campo === "medicamento")?.mensaje).toMatch(/vencido/i);
  });

  // 09
  it("09 — dosis FAIL: fuera de tolerancia ±10%", async () => {
    const db = makeDb({ gsrnRows: [GSRN_ROW_OK], gtinRows: [GTIN_ROW_OK], itemRows: [ITEM_ROW_OK] });
    // indicación=500mg, administrada=600mg (20% diff)
    const r = await validate5Correctos(db, { ...BASE_INPUT, dosis: "600mg" });
    expect(r.correctos.dosis).toBe(false);
    expect(r.errores.find((e) => e.campo === "dosis")?.mensaje).toMatch(/tolerancia/i);
  });

  // 10
  it("10 — dosis FAIL: unidad distinta", async () => {
    const db = makeDb({ gsrnRows: [GSRN_ROW_OK], gtinRows: [GTIN_ROW_OK], itemRows: [ITEM_ROW_OK] });
    const r = await validate5Correctos(db, { ...BASE_INPUT, dosis: "500ml" });
    expect(r.correctos.dosis).toBe(false);
    expect(r.errores.find((e) => e.campo === "dosis")?.mensaje).toMatch(/unidad/i);
  });

  // 11
  it("11 — dosis OK: dentro de tolerancia ±10% (549mg → diff 9.8%)", async () => {
    const db = makeDb({ gsrnRows: [GSRN_ROW_OK], gtinRows: [GTIN_ROW_OK], itemRows: [ITEM_ROW_OK] });
    const r = await validate5Correctos(db, { ...BASE_INPUT, dosis: "549mg" });
    expect(r.correctos.dosis).toBe(true);
    expect(r.errores.filter((e) => e.campo === "dosis" && e.severity === "error")).toHaveLength(0);
  });

  // 12
  it("12 — vía FAIL: no coincide", async () => {
    const db = makeDb({ gsrnRows: [GSRN_ROW_OK], gtinRows: [GTIN_ROW_OK], itemRows: [ITEM_ROW_OK] });
    const r = await validate5Correctos(db, { ...BASE_INPUT, via: "IV" });
    expect(r.correctos.via).toBe(false);
    expect(r.errores.find((e) => e.campo === "via")?.mensaje).toMatch(/no coincide/i);
  });

  // 13
  it("13 — hora FAIL: fuera de ventana ±30 min (31 min)", async () => {
    const db = makeDb({ gsrnRows: [GSRN_ROW_OK], gtinRows: [GTIN_ROW_OK], itemRows: [ITEM_ROW_OK] });
    const r = await validate5Correctos(db, { ...BASE_INPUT, hora: HORA_31MIN });
    expect(r.correctos.hora).toBe(false);
    expect(r.errores.find((e) => e.campo === "hora")?.mensaje).toMatch(/ventana/i);
  });

  // 14
  it("14 — hora OK: justo en el límite (30 min exactos)", async () => {
    const db = makeDb({ gsrnRows: [GSRN_ROW_OK], gtinRows: [GTIN_ROW_OK], itemRows: [ITEM_ROW_OK] });
    const r = await validate5Correctos(db, { ...BASE_INPUT, hora: HORA_30MIN });
    expect(r.correctos.hora).toBe(true);
  });

  // 15
  it("15 — happy path: 5/5 correctos, valid=true", async () => {
    const db = makeDb({ gsrnRows: [GSRN_ROW_OK], gtinRows: [GTIN_ROW_OK], itemRows: [ITEM_ROW_OK] });
    const r = await validate5Correctos(db, BASE_INPUT);
    expect(r.valid).toBe(true);
    expect(r.errores.filter((e) => e.severity === "error")).toHaveLength(0);
    expect(r.correctos).toEqual({
      paciente: true,
      medicamento: true,
      dosis: true,
      via: true,
      hora: true,
    });
  });
});

describe("applyGs1Validation", () => {
  function makeCtx(db: Pick<PrismaClient, "$queryRaw">) {
    return { prisma: db as unknown as PrismaClient, user: null, tenant: null, portalAccount: null };
  }

  // 16
  it("16 — PRECONDITION_FAILED cuando valid=false", async () => {
    // GTIN no en catálogo → medicamento falla
    const db = makeDb({ gsrnRows: [GSRN_ROW_OK], gtinRows: [], itemRows: [ITEM_ROW_OK] });
    const input = {
      ...BASE_INPUT,
      dosis: "500mg",
      via: "oral",
      hora: HORA_29MIN,
      indicacionItemId: IND_ID,
    };
    // applyGs1Validation espera el shape plano con campos GS1 en raíz
    const flatInput = {
      gtin: input.gtin,
      lote: input.lote,
      expiry: input.expiry,
      pacienteId: input.pacienteId,
      pacienteGsrn: input.pacienteGsrn,
      dosis: input.dosis,
      via: input.via,
      hora: input.hora,
      indicacionItemId: input.indicacionItemId,
    };
    await expect(applyGs1Validation(makeCtx(db), flatInput)).rejects.toThrowError(
      TRPCError,
    );
    await expect(applyGs1Validation(makeCtx(db), flatInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("GS1_HARDSTOP"),
    });
  });

  // 17
  it("17 — no lanza cuando valid=true", async () => {
    const db = makeDb({ gsrnRows: [GSRN_ROW_OK], gtinRows: [GTIN_ROW_OK], itemRows: [ITEM_ROW_OK] });
    const flatInput = {
      gtin: BASE_INPUT.gtin,
      lote: BASE_INPUT.lote,
      expiry: BASE_INPUT.expiry,
      pacienteId: BASE_INPUT.pacienteId,
      pacienteGsrn: BASE_INPUT.pacienteGsrn,
      dosis: "500mg",
      via: "oral",
      hora: HORA_BASE,
      indicacionItemId: IND_ID,
    };
    await expect(applyGs1Validation(makeCtx(db), flatInput)).resolves.toBeUndefined();
  });

  // 18
  it("18 — skip si input no trae campos GS1 (legacy)", async () => {
    const db = makeDbNoGsrn({ gtinRows: [], itemRows: [] });
    const input = {
      registroId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      indicacionItemId: IND_ID,
      horaAdministrada: new Date(),
      dosisAdministrada: "500mg",
      viaUsada: "oral",
    };
    // No debe lanzar aunque no haya catálogo
    await expect(applyGs1Validation(makeCtx(db), input)).resolves.toBeUndefined();
  });
});
