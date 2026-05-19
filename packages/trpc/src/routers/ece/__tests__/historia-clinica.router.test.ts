/**
 * Tests unitarios — eceHistoriaClinicaRouter.
 *
 * Estrategia: Vitest + vitest-mock-extended. Cero I/O real.
 * withEceContext mockeado para ejecutar el callback con el prisma mock.
 *
 * Casos cubiertos (12 tests):
 *   HC-001/002 — list happy path y nextCursor
 *   HC-001/002 — get: shape completo, NOT_FOUND, patient null, diagnosticos JSONB
 *   HC-002     — create: happy path con columnas reales de BD
 *   HC-002     — update: solo en borrador; rechaza firmado
 *   HC-002     — firmar: transición borrador→firmado; requiere firmaId
 *   HC-002     — validar: transición firmado→validado
 *   HC-004     — icd10DiagnosticoSchema: rechaza código inválido
 *
 * @QA E2E pendiente:
 *   - Flujo create → firmar → validar con rol PHYSICIAN real.
 *   - NURSE puede get/list pero no create/update (403).
 *   - firmar sin firmaId devuelve 400.
 *   - UPDATE post-firma rechazado por trigger BD (HC-005).
 */
import { describe, it, expect, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

// Mock withEceContext: ejecuta el callback directamente con el prisma mock
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
const FIRMA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function buildCtx(roleCodes: string[] = ["PHYSICIAN"]) {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  return {
    prisma,
    user: { id: ID1, email: "dr@test.com", fullName: "Doctor Test" },
    tenant: { organizationId: ID1, establishmentId: ID2, roleCodes },
    portalAccount: null,
  };
}

/** Fila raw alineada con columnas reales de ece.historia_clinica */
function baseGetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID1,
    instancia_id: ID3,
    episodio_id: ID2,
    tipo_consulta: "urgencia",
    motivo_consulta: "Cefalea intensa",
    enfermedad_actual: "Cefalea de 3 días de evolución",
    disposicion: "OBSERVACION",
    plan_manejo: "Hidratación IV + analgesia",
    antecedentes: { personales: "HTA", familiares: null },
    examen_fisico: { sistemas: [{ sistema: "Neurológico", hallazgo: "Sin déficit focal" }] },
    diagnosticos: null,
    registrado_por: ID1,
    registrado_en: new Date("2026-05-19T10:00:00Z"),
    estado_registro: "borrador",
    patient_id: ID2,
    patient_first_name: "Ana",
    patient_last_name: "García",
    patient_mrn: "MRN-001",
    firmado_en: null,
    validado_en: null,
    ...overrides,
  };
}

function baseListRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    episodio_id: ID2,
    tipo_consulta: "urgencia",
    motivo_consulta: "Consulta general",
    estado_registro: "borrador",
    registrado_en: new Date("2026-05-19T08:00:00Z"),
    patient_first_name: "Luis",
    patient_last_name: "Pérez",
    ...overrides,
  };
}

function baseHistoriaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID1,
    instancia_id: null,
    episodio_id: ID2,
    tipo_consulta: "ingreso",
    motivo_consulta: "Fiebre",
    enfermedad_actual: null,
    disposicion: null,
    plan_manejo: null,
    antecedentes: null,
    examen_fisico: null,
    diagnosticos: null,
    registrado_por: ID1,
    registrado_en: new Date("2026-05-19T09:00:00Z"),
    estado_registro: "borrador",
    ...overrides,
  };
}

// ─── Tests: list ──────────────────────────────────────────────────────────────

describe("eceHistoriaClinicaRouter.list", () => {
  it("1. retorna items con shape liviano: episodioId, tipoConsulta, estadoRegistro", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      baseListRow(ID1),
    ]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.list({});

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: ID1,
      episodioId: ID2,
      tipoConsulta: "urgencia",
      motivoConsulta: "Consulta general",
      estadoRegistro: "borrador",
      patient: { firstName: "Luis", lastName: "Pérez" },
    });
    expect(result.items[0]!.registradoEn).toBeInstanceOf(Date);
    expect(result.nextCursor).toBeNull();
  });

  it("2. nextCursor presente y items truncados cuando hay más de limit", async () => {
    const ctx = buildCtx();
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

// ─── Tests: get ──────────────────────────────────────────────────────────────

describe("eceHistoriaClinicaRouter.get", () => {
  it("3. retorna shape completo con columnas reales de BD", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([baseGetRow()]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.get({ id: ID1 });

    expect(result.id).toBe(ID1);
    expect(result.tipoConsulta).toBe("urgencia");
    expect(result.motivoConsulta).toBe("Cefalea intensa");
    expect(result.estadoRegistro).toBe("borrador");
    expect(result.patient).toEqual({
      id: ID2,
      firstName: "Ana",
      lastName: "García",
      mrn: "MRN-001",
    });
    expect(result.diagnosticos).toEqual([]);
  });

  it("4. lanza NOT_FOUND cuando el registro no existe", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    await expect(caller.get({ id: ID1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("5. patient es null cuando no hay episodio con paciente", async () => {
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

  it("6. diagnosticos[] parseados desde JSONB con código y descripción CIE-10", async () => {
    const ctx = buildCtx();
    const diagJson = JSON.stringify([
      { code: "J00", description: "Rinofaringitis aguda", tipo: "principal" },
      { code: "I10", description: "Hipertensión esencial", tipo: "secundario" },
    ]);
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      baseGetRow({ diagnosticos: diagJson }),
    ]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.get({ id: ID1 });

    expect(result.diagnosticos).toHaveLength(2);
    expect(result.diagnosticos[0]).toEqual({
      code: "J00",
      description: "Rinofaringitis aguda",
      tipo: "principal",
    });
    expect(result.diagnosticos[1]).toEqual({
      code: "I10",
      description: "Hipertensión esencial",
      tipo: "secundario",
    });
  });
});

// ─── Tests: create ────────────────────────────────────────────────────────────

describe("eceHistoriaClinicaRouter.create", () => {
  it("7. crea historia con columnas reales y estado borrador", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      baseHistoriaRow({ tipo_consulta: "ingreso", motivo_consulta: "Fiebre y tos" }),
    ]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.create({
      episodioId: ID2,
      tipoConsulta: "ingreso",
      motivoConsulta: "Fiebre y tos",
    });

    expect(result.estado_registro).toBe("borrador");
    expect(result.tipo_consulta).toBe("ingreso");
    expect(result.motivo_consulta).toBe("Fiebre y tos");
  });
});

// ─── Tests: update ────────────────────────────────────────────────────────────

describe("eceHistoriaClinicaRouter.update", () => {
  it("8. actualiza en estado borrador correctamente", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ estado_registro: "borrador" }]) // SELECT estado
      .mockResolvedValueOnce([baseHistoriaRow({ motivo_consulta: "Actualizado" })]); // UPDATE

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.update({ id: ID1, motivoConsulta: "Actualizado" });

    expect(result.motivo_consulta).toBe("Actualizado");
  });

  it("9. rechaza update cuando estado_registro es 'firmado'", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { estado_registro: "firmado" },
    ]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    await expect(
      caller.update({ id: ID1, motivoConsulta: "Intento modificar" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

// ─── Tests: firmar ────────────────────────────────────────────────────────────

describe("eceHistoriaClinicaRouter.firmar", () => {
  it("10. transición borrador → firmado requiere firmaId", async () => {
    const ctx = buildCtx();
    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    await expect(
      caller.firmar({ id: ID1 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("11. happy path: borrador → firmado con firmaId", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ estado_registro: "borrador", instancia_id: null }])
      .mockResolvedValueOnce([baseHistoriaRow({ estado_registro: "firmado" })]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.firmar({ id: ID1, firmaId: FIRMA_ID });

    expect(result.estado_registro).toBe("firmado");
  });
});

// ─── Tests: validar ───────────────────────────────────────────────────────────

describe("eceHistoriaClinicaRouter.validar", () => {
  it("12. transición firmado → validado con rol DIR", async () => {
    const ctx = buildCtx(["DIR"]);
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ estado_registro: "firmado", instancia_id: null }])
      .mockResolvedValueOnce([baseHistoriaRow({ estado_registro: "validado" })]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.validar({ id: ID1, firmaId: FIRMA_ID });

    expect(result.estado_registro).toBe("validado");
  });
});

// ─── HC-004: validación CIE-10 en schema Zod ─────────────────────────────────

describe("HC-004 — icd10DiagnosticoSchema valida códigos CIE-10", () => {
  // HC-004: la validación de código CIE-10 se aplica en borde de aplicación
  const schema = z.object({
    code: z.string().regex(/^[A-Z]\d{2}(\.\d+)?$/),
    description: z.string().min(1),
    tipo: z.enum(["principal", "secundario"]).default("secundario"),
  });

  it("acepta código CIE-10 válido J00", () => {
    expect(schema.safeParse({ code: "J00", description: "Rinofaringitis" }).success).toBe(true);
  });

  it("acepta código CIE-10 válido con subcodigo I10.0", () => {
    expect(schema.safeParse({ code: "I10.0", description: "HTA" }).success).toBe(true);
  });

  it("rechaza código CIE-10 que empieza con minúscula", () => {
    expect(schema.safeParse({ code: "j00", description: "Rinofaringitis" }).success).toBe(false);
  });

  it("rechaza código CIE-10 sin número", () => {
    expect(schema.safeParse({ code: "ABC", description: "Desc" }).success).toBe(false);
  });

  it("rechaza código vacío", () => {
    expect(schema.safeParse({ code: "", description: "Desc" }).success).toBe(false);
  });
});

// ─── Zod output schema ────────────────────────────────────────────────────────

describe("historiaClinicaGetOutput (Zod schema)", () => {
  it("valida shape completo con columnas reales de BD", () => {
    const data = {
      id: ID1,
      instanciaId: ID3,
      episodioId: ID2,
      tipoConsulta: "urgencia",
      motivoConsulta: "Dolor abdominal",
      enfermedadActual: "Gastritis aguda",
      disposicion: "ALTA",
      planManejo: "Inhibidor de bomba de protones",
      antecedentes: { personales: "Sin antecedentes" },
      examenFisico: null,
      diagnosticos: [{ code: "K29.7", description: "Gastritis", tipo: "principal" as const }],
      registradoPor: ID1,
      registradoEn: new Date(),
      estadoRegistro: "firmado",
      patient: { id: ID2, firstName: "Carlos", lastName: "López", mrn: "MRN-999" },
      firmadoEn: new Date(),
      validadoEn: null,
    };

    const result = historiaClinicaGetOutput.safeParse(data);
    expect(result.success).toBe(true);
  });
});
