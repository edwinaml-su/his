/**
 * Tests unitarios — eceHistoriaClinicaRouter.
 *
 * Estrategia: Vitest + vitest-mock-extended. Cero I/O real.
 * withEceContext mockeado para ejecutar el callback con el prisma mock.
 *
 * Casos cubiertos (8 tests):
 *   1. get — retorna shape extendido con patient, signosVitales, diagnosticos
 *   2. get — NOT_FOUND cuando no existe el registro
 *   3. get — patient null cuando no hay episodio vinculado
 *   4. get — diagnosticos[] vacío cuando JSONB es null
 *   5. get — diagnosticos[] parseados desde JSONB
 *   6. list — retorna items con shape liviano (motivoConsulta, createdAt, patient)
 *   7. list — nextCursor presente cuando hay más resultados
 *   8. historiaClinicaGetOutput — Zod schema valida shape completo
 *
 * @QA E2E pendiente:
 *   - Flujo create → enviarRevision → firmar → validar con rol MC real.
 *   - NURSE puede get/list pero no create/update (403).
 *   - firmar sin firmaId devuelve 400.
 */
import { describe, it, expect, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

vi.mock("../../ece/rls-context", () => ({
  withEceContext: async (
    prisma: PrismaClient,
    _personalId: string,
    _establecimientoId: string,
    fn: (tx: PrismaClient) => Promise<unknown>,
  ) => fn(prisma),
}));

import {
  eceHistoriaClinicaRouter,
  historiaClinicaGetOutput,
} from "../historia-clinica.router";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ID1 = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";
const ID3 = "00000000-0000-4000-8000-000000000003";

function buildCtx(roleCodes: string[] = ["PHYSICIAN"]) {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  return {
    prisma,
    user: { id: ID1, email: "dr@test.com", fullName: "Doctor Test" },
    tenant: { organizationId: ID1, establishmentId: ID2, roleCodes },
    portalAccount: null,
  };
}

/** Fila raw base que devuelve el SELECT extendido en `get`. */
function baseGetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID1,
    episodio_id: ID2,
    motivo_consulta: "Cefalea intensa",
    antecedentes: '{"personales":"HTA"}',
    plan_inicial: "Reposo relativo",
    estado: "borrador",
    instancia_id: ID3,
    creado_en: new Date("2026-05-01T10:00:00Z"),
    firmado_en: null,
    validado_en: null,
    patient_id: ID2,
    patient_first_name: "Ana",
    patient_last_name: "García",
    patient_mrn: "MRN-001",
    sv_pa_sistolica: 120,
    sv_pa_diastolica: 80,
    sv_frecuencia_cardiaca: 72,
    sv_frecuencia_respiratoria: 16,
    sv_temperatura: 36.5,
    sv_tomado_en: new Date("2026-05-01T09:30:00Z"),
    diagnosticos_json: null,
    examen_fisico_json: null,
    ...overrides,
  };
}

// ─── Tests: get ──────────────────────────────────────────────────────────────

describe("eceHistoriaClinicaRouter.get", () => {
  it("1. retorna shape extendido con patient, signosVitales y diagnosticos vacíos", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([baseGetRow()]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.get({ id: ID1 });

    expect(result.id).toBe(ID1);
    expect(result.motivoConsulta).toBe("Cefalea intensa");
    expect(result.patient).toEqual({
      id: ID2,
      firstName: "Ana",
      lastName: "García",
      mrn: "MRN-001",
    });
    expect(result.signosVitales).toMatchObject({
      paSistolica: 120,
      paDiastolica: 80,
      frecuenciaCardiaca: 72,
      temperatura: 36.5,
    });
    expect(result.diagnosticos).toEqual([]);
  });

  it("2. lanza NOT_FOUND cuando el registro no existe", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    await expect(caller.get({ id: ID1 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("3. patient es null cuando no hay paciente vinculado", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      baseGetRow({
        patient_id: null,
        patient_first_name: null,
        patient_last_name: null,
        patient_mrn: null,
      }),
    ]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.get({ id: ID1 });

    expect(result.patient).toBeNull();
  });

  it("4. diagnosticos[] vacío cuando diagnosticos_json es null", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      baseGetRow({ diagnosticos_json: null }),
    ]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.get({ id: ID1 });

    expect(result.diagnosticos).toEqual([]);
  });

  it("5. diagnosticos[] parseados desde JSONB con cie10 y descripcion", async () => {
    const ctx = buildCtx();
    const diagJson = JSON.stringify([
      { cie10: "J00", descripcion: "Rinofaringitis aguda", tipo: "presuntivo" },
      { cie10: "I10", descripcion: "Hipertensión esencial", tipo: "definitivo" },
    ]);
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      baseGetRow({ diagnosticos_json: diagJson }),
    ]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.get({ id: ID1 });

    expect(result.diagnosticos).toHaveLength(2);
    expect(result.diagnosticos[0]).toEqual({ codigoCie10: "J00", descripcion: "Rinofaringitis aguda" });
    expect(result.diagnosticos[1]).toEqual({ codigoCie10: "I10", descripcion: "Hipertensión esencial" });
  });
});

// ─── Tests: list ─────────────────────────────────────────────────────────────

describe("eceHistoriaClinicaRouter.list", () => {
  function baseListRow(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      estado: "borrador",
      motivo_consulta: "Consulta general",
      creado_en: new Date("2026-05-01T08:00:00Z"),
      patient_first_name: "Luis",
      patient_last_name: "Pérez",
      ...overrides,
    };
  }

  it("6. retorna items con shape liviano: motivoConsulta, createdAt, patient", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      baseListRow(ID1),
    ]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.list({});

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: ID1,
      estado: "borrador",
      motivoConsulta: "Consulta general",
      patient: { firstName: "Luis", lastName: "Pérez" },
    });
    expect(result.items[0]!.createdAt).toBeInstanceOf(Date);
    expect(result.nextCursor).toBeNull();
  });

  it("7. nextCursor presente y items truncados cuando hay más de limit", async () => {
    const ctx = buildCtx();
    // limit default = 20; devolver 21 rows
    const rows = Array.from({ length: 21 }, (_, i) =>
      baseListRow(`00000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, "0")}`),
    );
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.list({});

    expect(result.items).toHaveLength(20);
    expect(result.nextCursor).not.toBeNull();
  });
});

// ─── Tests: Zod output schema ────────────────────────────────────────────────

describe("historiaClinicaGetOutput (Zod schema)", () => {
  it("8. valida un shape completo correctamente", () => {
    const data = {
      id: ID1,
      episodioId: ID2,
      motivoConsulta: "Dolor abdominal",
      antecedentes: null,
      planInicial: null,
      estado: "firmado",
      instanciaId: ID3,
      createdAt: new Date(),
      firmadoEn: new Date(),
      validadoEn: null,
      patient: { id: ID2, firstName: "Carlos", lastName: "López", mrn: "MRN-999" },
      signosVitales: null,
      diagnosticos: [{ codigoCie10: "K29", descripcion: "Gastritis" }],
      hallazgosAparato: "Abdomen blando",
      planTerapeutico: "Inhibidor bomba protones",
    };

    const result = historiaClinicaGetOutput.safeParse(data);
    expect(result.success).toBe(true);
  });
});
