/**
 * Tests unitarios — icd10Router.
 *
 * Estrategia: Vitest + vitest-mock-extended. Cero I/O real.
 * mockDeep<PrismaClient> simula todas las queries raw.
 *
 * Casos cubiertos (12 tests):
 *   search:
 *     1. retorna código exacto cuando coincide
 *     2. retorna vacío cuando query tiene menos de 2 caracteres (disabled en client, pero router lo maneja)
 *     3. retorna lista de items en búsqueda por texto
 *     4. NOT_FOUND cuando se busca código que no existe en catálogo
 *   getByCode:
 *     5. retorna código existente
 *     6. lanza NOT_FOUND para código inexistente
 *   validate:
 *     7. ok=true cuando todos los códigos existen y no hay combinaciones inválidas
 *     8. warnings CODIGO_NO_ENCONTRADO cuando un código no está en catálogo
 *     9. warnings COMBINACION_INVALIDA cuando par viola regla sin restricción sexo/edad
 *     10. warnings RESTRICCION_SEXO cuando sexo del paciente coincide con sexo_excluido
 *     11. warnings RESTRICCION_EDAD (edad_max_excluida) cuando paciente excede la edad máxima
 *     12. sin warnings cuando restricción de sexo no aplica al paciente
 *
 * @QA E2E pendiente:
 *   - Flujo picker: escribir "J06" → ver lista → seleccionar → aparece en epicrisis.
 *   - Intento firmar epicrisis sin CIE-10 → hard-stop 412.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { icd10Router } from "../icd10.router";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ID1 = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";

const ROW_J069 = {
  codigo: "J06.9",
  descripcion: "Infección aguda de las vías respiratorias superiores, no especificada",
  capitulo: "X",
  grupo: "J00-J06",
  activo: true,
};

const ROW_N800 = {
  codigo: "N80.0",
  descripcion: "Endometriosis del útero",
  capitulo: "XIV",
  grupo: "N80-N98",
  activo: true,
};

const ROW_P071 = {
  codigo: "P07.1",
  descripcion: "Bajo peso al nacer extremo",
  capitulo: "XVI",
  grupo: "P05-P08",
  activo: true,
};

function buildCtx(roleCodes: string[] = ["PHYSICIAN"]) {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  return {
    prisma,
    user: { id: ID1, email: "test@test.com", fullName: "Test User" },
    tenant: { organizationId: ID1, establishmentId: ID2, roleCodes },
    portalAccount: null,
  };
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe("icd10Router.search", () => {
  it("retorna código exacto cuando la query coincide con el código", async () => {
    const ctx = buildCtx();

    // Primera query (exact match) retorna el row
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([ROW_J069]);

    const caller = icd10Router.createCaller(ctx as never);
    const result = await caller.search({ q: "J06.9", limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.codigo).toBe("J06.9");
  });

  it("hace búsqueda por texto cuando no hay coincidencia exacta", async () => {
    const ctx = buildCtx();

    // Primera query (exact match) retorna vacío
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // exact match falla
      .mockResolvedValueOnce([ROW_J069]); // trigram search

    const caller = icd10Router.createCaller(ctx as never);
    const result = await caller.search({ q: "respiratorias superiores", limit: 10 });

    expect(result.items.length).toBeGreaterThan(0);
  });

  it("retorna lista vacía cuando la búsqueda trigrama no encuentra nada", async () => {
    const ctx = buildCtx();

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const caller = icd10Router.createCaller(ctx as never);
    const result = await caller.search({ q: "codigoxxx", limit: 10 });

    expect(result.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getByCode
// ---------------------------------------------------------------------------

describe("icd10Router.getByCode", () => {
  it("retorna el código cuando existe en catálogo", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([ROW_J069]);

    const caller = icd10Router.createCaller(ctx as never);
    const result = await caller.getByCode({ codigo: "J06.9" });

    expect(result.codigo).toBe("J06.9");
    expect(result.descripcion).toContain("respiratorias");
  });

  it("lanza NOT_FOUND para código inexistente", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const caller = icd10Router.createCaller(ctx as never);
    await expect(caller.getByCode({ codigo: "Z99.9" })).rejects.toThrow(
      TRPCError,
    );
  });

  it("lanza error de validación para formato CIE-10 inválido", async () => {
    const ctx = buildCtx();
    const caller = icd10Router.createCaller(ctx as never);

    await expect(
      caller.getByCode({ codigo: "zzz" as never }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe("icd10Router.validate", () => {
  it("ok=true cuando todos los códigos existen y no hay combinaciones inválidas", async () => {
    const ctx = buildCtx();

    // Catalog check: ambos encontrados
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ codigo: "J06.9" }, { codigo: "I10" }])
      .mockResolvedValueOnce([]); // sin combinaciones inválidas

    const caller = icd10Router.createCaller(ctx as never);
    const result = await caller.validate({
      codigos: ["J06.9", "I10"],
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("warning CODIGO_NO_ENCONTRADO cuando código no existe en catálogo", async () => {
    const ctx = buildCtx();

    // Solo J06.9 encontrado, ZZZ.9 no
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ codigo: "J06.9" }])
      .mockResolvedValueOnce([]);

    const caller = icd10Router.createCaller(ctx as never);
    const result = await caller.validate({
      codigos: ["J06.9", "Z99.9"],
    });

    expect(result.ok).toBe(false);
    expect(result.warnings.some((w) => w.tipo === "CODIGO_NO_ENCONTRADO")).toBe(true);
  });

  it("warning COMBINACION_INVALIDA para par sin restricción sexo/edad", async () => {
    const ctx = buildCtx();
    const combRow = {
      id: ID1,
      codigo_a: "J06.9",
      codigo_b: "I10",
      motivo: "Combinación prueba inválida",
      sexo_excluido: null,
      edad_min_excluida: null,
      edad_max_excluida: null,
      activo: true,
    };

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ codigo: "J06.9" }, { codigo: "I10" }])
      .mockResolvedValueOnce([combRow]);

    const caller = icd10Router.createCaller(ctx as never);
    const result = await caller.validate({
      codigos: ["J06.9", "I10"],
    });

    expect(result.ok).toBe(false);
    expect(result.warnings.some((w) => w.tipo === "COMBINACION_INVALIDA")).toBe(true);
  });

  it("warning RESTRICCION_SEXO cuando sexo del paciente coincide con sexo_excluido", async () => {
    const ctx = buildCtx();
    const combRow = {
      id: ID1,
      codigo_a: "N80.0",
      codigo_b: "J06.9",
      motivo: "Endometriosis no aplica en masculino",
      sexo_excluido: "masculino",
      edad_min_excluida: null,
      edad_max_excluida: null,
      activo: true,
    };

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ codigo: "N80.0" }, { codigo: "J06.9" }])
      .mockResolvedValueOnce([combRow]);

    const caller = icd10Router.createCaller(ctx as never);
    const result = await caller.validate({
      codigos: ["N80.0", "J06.9"],
      sexoPaciente: "masculino",
    });

    expect(result.ok).toBe(false);
    expect(result.warnings.some((w) => w.tipo === "RESTRICCION_SEXO")).toBe(true);
  });

  it("sin warning RESTRICCION_SEXO cuando sexo del paciente es femenino (no excluido)", async () => {
    const ctx = buildCtx();
    const combRow = {
      id: ID1,
      codigo_a: "N80.0",
      codigo_b: "J06.9",
      motivo: "Solo aplica restricción en masculino",
      sexo_excluido: "masculino",
      edad_min_excluida: null,
      edad_max_excluida: null,
      activo: true,
    };

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ codigo: "N80.0" }, { codigo: "J06.9" }])
      .mockResolvedValueOnce([combRow]);

    const caller = icd10Router.createCaller(ctx as never);
    const result = await caller.validate({
      codigos: ["N80.0", "J06.9"],
      sexoPaciente: "femenino",
    });

    // Para femenino: la restricción de sexo_excluido='masculino' no aplica,
    // y no hay restricción general → ok=true
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("warning RESTRICCION_EDAD cuando paciente excede edad_max_excluida", async () => {
    const ctx = buildCtx();
    const combRow = {
      id: ID2,
      codigo_a: "P07.1",
      codigo_b: "J06.9",
      motivo: "P07.1 aplica solo a recién nacidos (≤ 0 años)",
      sexo_excluido: null,
      edad_min_excluida: null,
      edad_max_excluida: 0, // solo recién nacidos
      activo: true,
    };

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ codigo: "P07.1" }, { codigo: "J06.9" }])
      .mockResolvedValueOnce([combRow]);

    const caller = icd10Router.createCaller(ctx as never);
    const result = await caller.validate({
      codigos: ["P07.1", "J06.9"],
      edadPacienteAnios: 45,
    });

    expect(result.ok).toBe(false);
    expect(result.warnings.some((w) => w.tipo === "RESTRICCION_EDAD")).toBe(true);
  });

  it("un solo código no ejecuta query de combinaciones", async () => {
    const ctx = buildCtx();

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { codigo: "J06.9" },
    ]);

    const caller = icd10Router.createCaller(ctx as never);
    const result = await caller.validate({ codigos: ["J06.9"] });

    // Solo 1 query (catalog check), no la de combinaciones
    expect((ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createComb
// ---------------------------------------------------------------------------

describe("icd10Router.createComb", () => {
  it("crea combinación correctamente cuando ambos códigos existen", async () => {
    const ctx = buildCtx(["ADMIN"]);

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ codigo: "N80.0" }, { codigo: "J06.9" }])
      .mockResolvedValueOnce([{ id: ID1 }]);

    const caller = icd10Router.createCaller(ctx as never);
    const result = await caller.createComb({
      codigoA: "N80.0",
      codigoB: "J06.9",
      motivo: "Test combinación",
      sexoExcluido: "masculino",
    });

    expect(result.id).toBe(ID1);
  });

  it("lanza BAD_REQUEST cuando algún código no existe en catálogo", async () => {
    const ctx = buildCtx(["ADMIN"]);

    // Solo N80.0 encontrado, ZZZ.0 no
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { codigo: "N80.0" },
    ]);

    const caller = icd10Router.createCaller(ctx as never);
    await expect(
      caller.createComb({
        codigoA: "N80.0",
        codigoB: "Z99.9",
        motivo: "Test",
      }),
    ).rejects.toThrow(TRPCError);
  });
});
