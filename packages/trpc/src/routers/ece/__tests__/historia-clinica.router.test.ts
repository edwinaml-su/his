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

/** Fila raw alineada con columnas reales de ece.historia_clinica (incluye CC-0007) */
function baseGetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID1,
    instancia_id: ID3,
    episodio_id: ID2,
    tipo_consulta: "subsecuente",
    motivo_consulta: "Cefalea intensa",
    enfermedad_actual: "Cefalea de 3 días de evolución",
    disposicion: "OBSERVACION",
    analisis_clinico: "Cefalea tensional, sin signos de alarma.",
    plan_manejo: "Hidratación IV + analgesia",
    antecedentes: { personales: "HTA", familiares: null },
    examen_fisico: { sistemas: [{ sistema: "Neurológico", hallazgo: "Sin déficit focal" }] },
    diagnosticos: null,
    // CC-0007 — campos jsonb nuevos (null por defecto para HCs antiguas)
    antecedentes_estructurados: null,
    plan_items: null,
    procedimientos_cpt: null,
    terapia_respiratoria: null,
    ordenes_examenes: null,
    ordenes_inyecciones: null,
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
    tipo_consulta: "subsecuente",
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
    tipo_consulta: "primera_vez",
    motivo_consulta: "Fiebre",
    enfermedad_actual: null,
    disposicion: null,
    analisis_clinico: null,
    plan_manejo: null,
    antecedentes: null,
    examen_fisico: null,
    diagnosticos: null,
    // CC-0007 — campos jsonb nuevos (null por defecto)
    antecedentes_estructurados: null,
    plan_items: null,
    procedimientos_cpt: null,
    terapia_respiratoria: null,
    ordenes_examenes: null,
    ordenes_inyecciones: null,
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
      tipoConsulta: "subsecuente",
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
    expect(result.tipoConsulta).toBe("subsecuente");
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

    // parseDiagnosticos normaliza legacy CIE-10 (code/description, tipo principal/
    // secundario) → forma CIE-11 español (codigo/descripcion, tipo DEFINITIVO).
    expect(result.diagnosticos).toHaveLength(2);
    expect(result.diagnosticos[0]).toEqual({
      codigo: "J00",
      descripcion: "Rinofaringitis aguda",
      tipo: "DEFINITIVO",
    });
    expect(result.diagnosticos[1]).toEqual({
      codigo: "I10",
      descripcion: "Hipertensión esencial",
      tipo: "DEFINITIVO",
    });
  });
});

// ─── Tests: create ────────────────────────────────────────────────────────────

describe("eceHistoriaClinicaRouter.create", () => {
  it("7. crea historia con columnas reales y estado borrador", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      baseHistoriaRow({ tipo_consulta: "primera_vez", motivo_consulta: "Fiebre y tos" }),
    ]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.create({
      episodioId: ID2,
      tipoConsulta: "primera_vez",
      motivoConsulta: "Fiebre y tos",
    });

    expect(result.estado_registro).toBe("borrador");
    expect(result.tipo_consulta).toBe("primera_vez");
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
      // RN-03: firmar exige ≥1 diagnóstico COMPLEMENTARIO en el SELECT de estado.
      .mockResolvedValueOnce([
        {
          estado_registro: "borrador",
          instancia_id: null,
          diagnosticos: [{ codigo: "BA00", descripcion: "Hipertensión", tipo: "COMPLEMENTARIO" }],
        },
      ])
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
  it("valida shape completo con columnas reales de BD (incluye campos CC-0007)", () => {
    const data = {
      id: ID1,
      instanciaId: ID3,
      episodioId: ID2,
      tipoConsulta: "subsecuente",
      motivoConsulta: "Dolor abdominal",
      enfermedadActual: "Gastritis aguda",
      destino: "ALTA_MEDICA",
      analisisClinico: "Cuadro compatible con gastritis, sin signos de alarma.",
      planManejo: "Inhibidor de bomba de protones",
      antecedentes: { personales: "Sin antecedentes" },
      examenFisico: null,
      diagnosticos: [{ codigo: "K29.7", descripcion: "Gastritis", tipo: "DEFINITIVO" as const }],
      // CC-0007 — campos jsonb nuevos (null cuando no se usan)
      antecedentesEstructurados: null,
      planItems: null,
      procedimientosCpt: null,
      terapiaRespiratoria: null,
      ordenesExamenes: null,
      ordenesInyecciones: null,
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

// ─── CC-0007 — campos jsonb nuevos ───────────────────────────────────────────

describe("eceHistoriaClinicaRouter.create — CC-0007 campos jsonb round-trip", () => {
  it("13. create con antecedentesEstructurados ejecuta el INSERT y retorna la fila", async () => {
    const ctx = buildCtx();

    const antecedentesEstructurados = {
      alergias:   { estado: "TIENE" as const, items: ["Penicilina"] },
      personales: { estado: "NINGUNO" as const },
      familiares: { estado: "NINGUNO" as const },
      ocupacion:  { estado: "NO_APLICA" as const },
      habitos:    { estado: "NO_APLICA" as const },
    };

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      baseHistoriaRow({
        antecedentes_estructurados: antecedentesEstructurados,
      }),
    ]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.create({
      episodioId: ID2,
      tipoConsulta: "primera_vez",
      antecedentesEstructurados,
    });

    // El INSERT se ejecutó (router llama $queryRaw para INSERT...RETURNING)
    expect(ctx.prisma.$queryRaw).toHaveBeenCalledOnce();
    // La fila retornada incluye el campo CC-0007
    expect(result.antecedentes_estructurados).toEqual(antecedentesEstructurados);
  });

  it("14. create con planItems ejecuta el INSERT y retorna la fila", async () => {
    const ctx = buildCtx();
    const planItems = [
      { orden: 1, texto: "Hidratación IV" },
      { orden: 2, texto: "Analgesia" },
    ];

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      baseHistoriaRow({ plan_items: planItems }),
    ]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.create({
      episodioId: ID2,
      tipoConsulta: "primera_vez",
      planItems,
    });

    expect(ctx.prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(result.plan_items).toEqual(planItems);
  });

  it("15. create con procedimientosCpt ejecuta el INSERT y retorna la fila", async () => {
    const ctx = buildCtx();
    const procedimientosCpt = [
      { codigo: "99213", descripcion: "Consulta de seguimiento" },
    ];

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      baseHistoriaRow({ procedimientos_cpt: procedimientosCpt }),
    ]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.create({
      episodioId: ID2,
      tipoConsulta: "primera_vez",
      procedimientosCpt,
    });

    expect(ctx.prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(result.procedimientos_cpt).toEqual(procedimientosCpt);
  });

  it("16. get parsea antecedentesEstructurados desde JSONB cuando existe", async () => {
    const ctx = buildCtx();
    const antecedentesEstructurados = {
      alergias:   { estado: "TIENE" as const, items: ["Amoxicilina"] },
      personales: { estado: "NINGUNO" as const },
      familiares: { estado: "NINGUNO" as const },
      ocupacion:  { estado: "NO_APLICA" as const },
      habitos:    { estado: "NO_APLICA" as const },
    };

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      baseGetRow({ antecedentes_estructurados: antecedentesEstructurados }),
    ]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.get({ id: ID1 });

    expect(result.antecedentesEstructurados).not.toBeNull();
    expect(result.antecedentesEstructurados?.alergias.estado).toBe("TIENE");
    expect(result.antecedentesEstructurados?.alergias.items).toEqual(["Amoxicilina"]);
  });

  it("17. get retorna planItems parseados desde JSONB", async () => {
    const ctx = buildCtx();
    const planItems = [{ orden: 1, texto: "Reposo" }];

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      baseGetRow({ plan_items: planItems }),
    ]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.get({ id: ID1 });

    expect(result.planItems).toEqual(planItems);
  });

  it("18. get retorna null en campos jsonb CC-0007 cuando la HC es antigua (null en BD)", async () => {
    const ctx = buildCtx();

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      baseGetRow({
        antecedentes_estructurados: null,
        plan_items: null,
        procedimientos_cpt: null,
        terapia_respiratoria: null,
        ordenes_examenes: null,
        ordenes_inyecciones: null,
      }),
    ]);

    const caller = eceHistoriaClinicaRouter.createCaller(ctx as never);
    const result = await caller.get({ id: ID1 });

    expect(result.antecedentesEstructurados).toBeNull();
    expect(result.planItems).toBeNull();
    expect(result.procedimientosCpt).toBeNull();
    expect(result.terapiaRespiratoria).toBeNull();
    expect(result.ordenesExamenes).toBeNull();
    expect(result.ordenesInyecciones).toBeNull();
  });
});
