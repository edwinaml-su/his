/**
 * Tests unitarios — atencionEmergenciaRouter (ECE ATN_EMERG).
 *
 * Estrategia:
 *   - Vitest + vitest-mock-extended (DeepMockProxy<PrismaClient>).
 *   - Prisma completamente mockeado; cero I/O real.
 *   - emitDomainEvent mockeado para aislar la prueba del outbox.
 *   - $transaction ejecuta el callback con el mock (mismo patrón que signos-vitales.test.ts).
 *
 * Casos cubiertos (8 tests):
 *   1. Zod create — episodioId requerido (uuid)
 *   2. Zod create — motivoConsulta mínimo 5 chars
 *   3. create — happy path, retorna id
 *   4. create — PRECONDITION_FAILED si no hay personal_salud activo
 *   5. update — CONFLICT si estado no es borrador|en_revision
 *   6. firmar — NOT_FOUND cuando el doc no existe
 *   7. firmar — CONFLICT si estado ya es firmado/validado
 *   8. anular — FORBIDDEN si rol no incluye DIR ni ADMIN
 *
 * @QA E2E pendiente:
 *   - Flujo completo create → firmar → validar con rol MT real.
 *   - MT no puede anular en estado validado.
 *   - anular con ADMIN devuelve ok.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

// ─── Schemas inline (evitan symlink @his/contracts en worktree) ──────────────

const schema = {
  create: z.object({
    episodioId: z.string().uuid(),
    motivoConsulta: z.string().min(5).max(2000),
    exploracion: z.string().min(5).max(5000),
    diagnostico: z.string().min(5).max(2000),
    planTerapeutico: z.string().min(5).max(5000),
  }),
};

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@his/database", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@his/database")>();
  return {
    ...mod,
    emitDomainEvent: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../ece/rls-context", () => ({
  withEceContext: async (
    prisma: PrismaClient,
    _personalId: string,
    _establecimientoId: string,
    fn: (tx: PrismaClient) => Promise<unknown>,
  ) => fn(prisma),
}));

// Importar router DESPUÉS de los mocks
import { atencionEmergenciaRouter } from "../atencion-emergencia.router";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const uuid = () => "00000000-0000-4000-8000-000000000001";
const uuid2 = () => "00000000-0000-4000-8000-000000000002";

function buildCtx(roleCodes: string[] = ["MT"]) {
  const prisma = mockDeep<PrismaClient>();

  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(0);

  return {
    prisma,
    user: { id: uuid(), email: "mt@test.com", fullName: "Médico Turno" },
    tenant: {
      organizationId: uuid(),
      establishmentId: uuid2(),
      roleCodes,
    },
    portalAccount: null,
  };
}

const validCreateInput = {
  episodioId: uuid(),
  motivoConsulta: "Dolor torácico agudo",
  exploracion: "PA 140/90, FC 98, buen estado general",
  diagnostico: "Síndrome coronario agudo. I20.0",
  planTerapeutico: "Aspirina 300 mg VO stat. Monitoreo continuo.",
};

// ─── Zod validation tests ────────────────────────────────────────────────────

describe("eceAtencionEmergenciaCreateSchema — validación", () => {
  it("1. rechaza episodioId vacío o no-uuid", () => {
    const r1 = schema.create.safeParse({ ...validCreateInput, episodioId: "" });
    const r2 = schema.create.safeParse({ ...validCreateInput, episodioId: "no-uuid" });
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
  });

  it("2. rechaza motivoConsulta con menos de 5 chars", () => {
    const r = schema.create.safeParse({ ...validCreateInput, motivoConsulta: "abc" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.motivoConsulta).toBeDefined();
    }
  });
});

// ─── create ──────────────────────────────────────────────────────────────────

describe("atencionEmergenciaRouter — create", () => {
  it("3. happy path: retorna id cuando la inserción es exitosa", async () => {
    const ctx = buildCtx(["MT"]);
    const newId = uuid();

    // personal_salud lookup → retorna un id
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: uuid2() }]) // personal_salud
      .mockResolvedValueOnce([{ id: newId }]); // INSERT RETURNING id

    const caller = atencionEmergenciaRouter.createCaller(ctx as never);
    const result = await caller.create(validCreateInput);

    expect(result.id).toBe(newId);
  });

  it("4. PRECONDITION_FAILED si no hay personal_salud activo para el usuario", async () => {
    const ctx = buildCtx(["MT"]);

    // personal_salud lookup → vacío
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const caller = atencionEmergenciaRouter.createCaller(ctx as never);

    await expect(caller.create(validCreateInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});

// ─── update ──────────────────────────────────────────────────────────────────

describe("atencionEmergenciaRouter — update", () => {
  it("5. CONFLICT si el documento está en estado firmado (no editable)", async () => {
    const ctx = buildCtx(["MT"]);

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { estado_workflow: "firmado" },
    ]);

    const caller = atencionEmergenciaRouter.createCaller(ctx as never);

    await expect(
      caller.update({ id: uuid(), motivoConsulta: "Nuevo motivo actualizado" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

// ─── firmar ──────────────────────────────────────────────────────────────────

describe("atencionEmergenciaRouter — firmar", () => {
  it("6. NOT_FOUND cuando el documento no existe", async () => {
    const ctx = buildCtx(["MT"]);

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const caller = atencionEmergenciaRouter.createCaller(ctx as never);

    await expect(
      caller.firmar({ id: uuid(), firmaId: uuid2() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("7. CONFLICT si el documento ya está en estado validado", async () => {
    const ctx = buildCtx(["MT"]);

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: uuid(),
        episodio_id: uuid2(),
        medico_turno_id: uuid(),
        motivo_consulta: "Dolor",
        exploracion: "Exploración normal",
        diagnostico: "Dx",
        plan_terapeutico: "Plan",
        estado_workflow: "validado",
        firmado_en: null,
        validado_en: null,
        anulado_en: null,
        motivo_anulacion: null,
        registrado_en: new Date(),
      },
    ]);

    const caller = atencionEmergenciaRouter.createCaller(ctx as never);

    await expect(
      caller.firmar({ id: uuid(), firmaId: uuid2() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

// ─── autorización ────────────────────────────────────────────────────────────

describe("atencionEmergenciaRouter — autorización", () => {
  it("8. FORBIDDEN al anular si el rol es solo MT (sin DIR/ADMIN)", async () => {
    const ctx = buildCtx(["MT"]);
    const caller = atencionEmergenciaRouter.createCaller(ctx as never);

    await expect(
      caller.anular({ id: uuid(), motivoAnulacion: "Motivo de anulación suficientemente largo" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
