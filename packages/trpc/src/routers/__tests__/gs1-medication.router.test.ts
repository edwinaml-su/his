/**
 * Tests unitarios: gs1MedicationRouter — US.F2.6.4.
 *
 * Cubre: list con filtros, get, update, markRecall, linkSubstitute.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { gs1MedicationRouter } from "../gs1-medication.router";
import { makeCtx } from "../../__tests__/helpers/caller";

vi.mock("../../rls-context", () => ({
  withTenantContext: vi.fn(async (_prisma: unknown, _tenant: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    return fn(_prisma);
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UUID_A  = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID_B  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const UUID_NF = "00000000-0000-0000-0000-000000000001";

const MOCK_MED_ROW = {
  id: UUID_A,
  codigo: "00000000000000",
  descripcion: "Ibuprofeno 400mg",
  fabricante: "Bayer",
  presentacion: "Tableta",
  contenido_unidades: "20",
  principio_activo: "Ibuprofeno",
  codigo_atc: "M01AE01",
  activo: true,
  creado_en: new Date("2025-01-01"),
  principios_activos: ["Ibuprofeno"],
  excipientes_alergenos: [],
  recall_status: "NONE",
  recall_motivo: null,
  // DDL real: columna es recall_iniciado_en, no recall_fecha.
  recall_iniciado_en: null,
  lote_vencimiento: null,
};

let prisma: DeepMockProxy<PrismaClient>;

function mockQuery<T>(value: T) {
  return vi.fn().mockResolvedValue(value);
}

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("gs1Medication.list", () => {
  it("sin filtros retorna filas mapeadas correctamente", async () => {
    prisma.$queryRawUnsafe = mockQuery([MOCK_MED_ROW]);

    const caller = gs1MedicationRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.list({ limit: 50, offset: 0 });

    expect(result).toHaveLength(1);
    expect(result[0]!.contenidoUnidades).toBe(20);
    expect(result[0]!.principiosActivos).toEqual(["Ibuprofeno"]);
    expect(result[0]!.recallStatus).toBe("NONE");
  });

  it("con filtro recallStatus añade COALESCE en WHERE", async () => {
    prisma.$queryRawUnsafe = mockQuery([]);

    const caller = gs1MedicationRouter.createCaller(makeCtx({ prisma }));
    await caller.list({ recallStatus: "ALERTA", limit: 50, offset: 0 });

    const sql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("COALESCE(recall_status");
  });

  it("con filtro vencimientosDias añade lote_vencimiento en WHERE", async () => {
    prisma.$queryRawUnsafe = mockQuery([]);

    const caller = gs1MedicationRouter.createCaller(makeCtx({ prisma }));
    await caller.list({ vencimientosDias: 30, limit: 50, offset: 0 });

    const sql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("lote_vencimiento");
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe("gs1Medication.get", () => {
  it("retorna NOT_FOUND si la BD no devuelve filas", async () => {
    prisma.$queryRawUnsafe = mockQuery([]);

    const caller = gs1MedicationRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.get({ id: UUID_NF })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("mapea excipientes alergenos null a array vacío", async () => {
    prisma.$queryRawUnsafe = mockQuery([{ ...MOCK_MED_ROW, excipientes_alergenos: null }]);

    const caller = gs1MedicationRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.get({ id: UUID_A });

    expect(result.excipientesAlergenos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("gs1Medication.update", () => {
  it("sin campos lanza BAD_REQUEST", async () => {
    const caller = gs1MedicationRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.update({ id: UUID_A })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("pasa principiosActivos como text[] (array nativo) a BD", async () => {
    prisma.$executeRawUnsafe = mockQuery(1);

    const caller = gs1MedicationRouter.createCaller(makeCtx({ prisma }));
    await caller.update({
      id: UUID_A,
      principiosActivos: ["Ibuprofeno", "Excipiente X"],
    });

    const calls = (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mock.calls;
    const params = calls[0] as unknown[];
    // DDL real: text[] — se pasa el array nativo, no JSON.stringify.
    const arrParam = params.find(
      (p) => Array.isArray(p) && (p as string[]).includes("Ibuprofeno"),
    );
    expect(arrParam).toEqual(["Ibuprofeno", "Excipiente X"]);
    // La query debe castear a ::text[]
    const sql = params[0] as string;
    expect(sql).toContain("::text[]");
  });

  it("rechaza codigoAtc con formato inválido (Zod)", async () => {
    const caller = gs1MedicationRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.update({ id: UUID_A, codigoAtc: "INVALIDO" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// markRecall
// ---------------------------------------------------------------------------

describe("gs1Medication.markRecall", () => {
  it("rechaza status NONE (no puede desmarcarse desde markRecall)", async () => {
    const caller = gs1MedicationRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.markRecall({ id: UUID_A, status: "NONE" as "ALERTA", motivo: "motivo largo suficiente" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("ejecuta UPDATE con recall_status y recall_fecha", async () => {
    prisma.$executeRawUnsafe = mockQuery(1);

    const caller = gs1MedicationRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.markRecall({
      id: UUID_A,
      status: "RECALL_REGULATORIO",
      motivo: "Contaminación detectada en lote L001-2026.",
    });

    expect(result.ok).toBe(true);
    const sql = (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("recall_status");
    // DDL real: columna es recall_iniciado_en
    expect(sql).toContain("recall_iniciado_en");
  });

  it("motivo demasiado corto lanza BAD_REQUEST", async () => {
    const caller = gs1MedicationRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.markRecall({ id: UUID_A, status: "ALERTA", motivo: "corto" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// linkSubstitute
// ---------------------------------------------------------------------------

describe("gs1Medication.linkSubstitute", () => {
  it("rechaza si gtinAId === gtinBId", async () => {
    const caller = gs1MedicationRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.linkSubstitute({ gtinAId: UUID_A, gtinBId: UUID_A, autorizada: true }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("llama $executeRawUnsafe con INSERT ... ON CONFLICT", async () => {
    prisma.$executeRawUnsafe = mockQuery(1);

    const caller = gs1MedicationRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.linkSubstitute({
      gtinAId: UUID_A,
      gtinBId: UUID_B,
      autorizada: true,
    });

    expect(result.ok).toBe(true);
    const sql = (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("ON CONFLICT");
    expect(sql).toContain("gs1_gtin_sustitutos");
  });
});
