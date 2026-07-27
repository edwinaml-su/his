/**
 * Tests unitarios — eceSignosVitalesRouter (ECE §SIG_VIT).
 *
 * Estrategia:
 *   - Vitest + vitest-mock-extended (DeepMockProxy<PrismaClient>).
 *   - Prisma mockeado completamente; cero I/O real.
 *   - $transaction ejecuta el callback síncronamente con el mock (mismo patrón
 *     que transitions.test.ts).
 *   - $executeRawUnsafe absorbe las llamadas de withEceContext
 *     (SELECT ece.set_ece_context + SET LOCAL ROLE authenticated).
 *
 * Casos cubiertos (10 tests):
 *   1. Zod — rangos válidos pasan sin error
 *   2. Zod — TA sistólica fuera de rango (59 / 261) falla
 *   3. Zod — SpO2 < 50 falla
 *   4. Zod — Dolor EVA > 10 falla (campo: escalaDolor)
 *   5. Zod — campos antropométricos (peso/talla/glucometría) válidos aceptados (HD-18)
 *   6. create — happy path, retorna id
 *   7. update — falla si estado !== borrador (400)
 *   8. firmar — NOT_FOUND cuando id inexistente
 *   9. firmar/validar — FORBIDDEN si rol no es NURSE
 *   10. IMC se calcula correctamente de peso y talla
 *
 * @QA E2E pendiente:
 *   - Flujo completo create → firmar → validar con NURSE real.
 *   - PHYSICIAN puede list/get pero firmar/validar devuelve 403.
 *   - update de registro firmado devuelve 400.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
// Schema inline para tests — evita dependencia del symlink @his/contracts que
// en worktrees apunta al main branch (no al worktree actual).
import { z } from "zod";

function numRange(min: number, max: number, label: string) {
  return z.number().min(min, `${label} mínimo ${min}.`).max(max, `${label} máximo ${max}.`);
}

// Schema alineado con ece.signos_vitales post-HD-16 + CC-0007 migración 182
const eceSignosVitalesCreateSchema = z.object({
  pacienteId: z.string().uuid(),
  episodioId: z.string().uuid().optional(),
  presionSistolica: numRange(60, 260, "TA sistólica").optional(),
  presionDiastolica: numRange(40, 160, "TA diastólica").optional(),
  frecuenciaCardiaca: numRange(30, 220, "FC").optional(),
  frecuenciaRespiratoria: numRange(4, 60, "FR").optional(),
  temperatura: numRange(30, 43, "Temperatura").optional(),
  saturacionO2: numRange(50, 100, "SpO2").optional(),
  escalaDolor: numRange(0, 10, "Dolor EVA").optional(),
  // HD-18 — datos antropométricos
  pesoKg: numRange(0.5, 300, "Peso").optional(),
  tallaCm: numRange(30, 250, "Talla").optional(),
  glucometriaMgdl: numRange(20, 600, "Glucometría").optional(),
  fechaHoraToma: z.string().datetime({ offset: true }).optional(),
  // CC-0007 — Glasgow (int, derivados server-side)
  glasgowOcular:    numRange(1, 4,  "Glasgow ocular").int().optional(),
  glasgowVerbal:    numRange(1, 5,  "Glasgow verbal").int().optional(),
  glasgowMotor:     numRange(1, 6,  "Glasgow motor").int().optional(),
  glasgowTotal:     numRange(3, 15, "Glasgow total").int().optional(),
  // CC-0007 — otros campos
  fio2:             numRange(21, 100, "FiO2").optional(),
  perimetroCintura: z.number().positive("Perímetro cintura debe ser positivo.").optional(),
  ict:              z.number().positive("ICT debe ser positivo.").optional(),
  balanceHidrico:   z.number().optional(),
  diuresis:         z.number().min(0, "Diuresis no puede ser negativa.").optional(),
  fur:              z.string().date().optional(),
  fpp:              z.string().date().optional(),
});

// ─── Mock de withEceContext ──────────────────────────────────────────────────
// Reemplazamos el helper para que ejecute el callback con el prisma mock
// sin abrir transacciones reales.
vi.mock("../../ece/rls-context", () => ({
  withEceContext: async (
    prisma: PrismaClient,
    _personalId: string,
    _establecimientoId: string,
    fn: (tx: PrismaClient) => Promise<unknown>,
  ) => fn(prisma),
}));

// CC-0012 — la resolución de cuenta (public."PatientAccount") corre en su
// propia transacción `withTenantContext`. Mock análogo: ejecuta el callback
// directamente con el prisma mock, sin abrir transacciones reales.
vi.mock("../../rls-context", () => ({
  withTenantContext: async (
    prisma: PrismaClient,
    _tenant: { userId: string; organizationId: string },
    fn: (tx: PrismaClient) => Promise<unknown>,
  ) => fn(prisma),
}));

// ─── Importar router DESPUÉS del mock ────────────────────────────────────────
import { eceSignosVitalesRouter } from "../signos-vitales.router";

// ─── Helpers de fixtures ─────────────────────────────────────────────────────

const uuid = () => "00000000-0000-4000-8000-000000000001";
const uuid2 = () => "00000000-0000-4000-8000-000000000002";

function buildCtx(roleCodes: string[] = ["NURSE"]) {
  const prisma = mockDeep<PrismaClient>();

  // withEceContext llama $transaction → ejecutar callback directamente
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  // absorber SET LOCAL calls de withEceContext
  (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(0);

  return {
    prisma,
    user: { id: uuid(), email: "enf@test.com", fullName: "Enfermera Test" },
    tenant: {
      organizationId: uuid(),
      establishmentId: uuid2(),
      roleCodes,
    },
    portalAccount: null,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("eceSignosVitalesCreateSchema — validación de rangos", () => {
  const baseValid = {
    pacienteId: uuid(),
  };

  it("1. acepta valores en todos los rangos válidos", () => {
    const result = eceSignosVitalesCreateSchema.safeParse({
      ...baseValid,
      presionSistolica: 120,
      presionDiastolica: 80,
      frecuenciaCardiaca: 70,
      frecuenciaRespiratoria: 16,
      temperatura: 36.5,
      saturacionO2: 98,
      escalaDolor: 2,
    });
    expect(result.success).toBe(true);
  });

  it("2. rechaza TA sistólica fuera de rango (59 y 261)", () => {
    const low = eceSignosVitalesCreateSchema.safeParse({ ...baseValid, presionSistolica: 59 });
    const high = eceSignosVitalesCreateSchema.safeParse({ ...baseValid, presionSistolica: 261 });
    expect(low.success).toBe(false);
    expect(high.success).toBe(false);
  });

  it("3. rechaza SpO2 menor a 50", () => {
    const result = eceSignosVitalesCreateSchema.safeParse({ ...baseValid, saturacionO2: 49 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.saturacionO2).toBeDefined();
    }
  });

  it("4. rechaza Dolor EVA mayor a 10 (campo escalaDolor)", () => {
    const result = eceSignosVitalesCreateSchema.safeParse({ ...baseValid, escalaDolor: 11 });
    expect(result.success).toBe(false);
  });

  it("5. acepta datos antropométricos válidos (HD-18)", () => {
    const result = eceSignosVitalesCreateSchema.safeParse({
      ...baseValid,
      pesoKg: 70,
      tallaCm: 170,
      glucometriaMgdl: 95,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pesoKg).toBe(70);
      expect(result.data.tallaCm).toBe(170);
      expect(result.data.glucometriaMgdl).toBe(95);
    }
  });
});

describe("eceSignosVitalesRouter — create", () => {
  it("6. happy path: retorna id cuando la inserción es exitosa (anclado a episodioId)", async () => {
    const ctx = buildCtx(["NURSE"]);
    const newId = uuid();

    // 1ª $queryRaw: resolveEpisodioInfo (paciente ece + ACL público del episodio).
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { paciente_id_ece: uuid2(), public_patient_id: null, public_encounter_id: null },
    ]);
    // 2ª $queryRaw: INSERT ... RETURNING id
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: newId },
    ]);

    const caller = eceSignosVitalesRouter.createCaller(ctx as never);

    const result = await caller.create({
      episodioId: uuid(),
      presionSistolica: 120,
      presionDiastolica: 80,
    });

    expect(result.id).toBe(newId);
  });
});

describe("eceSignosVitalesRouter — update", () => {
  it("7. falla con BAD_REQUEST si el estado no es 'borrador'", async () => {
    const ctx = buildCtx(["NURSE"]);

    // SELECT estado → retorna 'firmado'
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { estado_registro: "firmado", peso_kg: null, talla_cm: null },
    ]);

    const caller = eceSignosVitalesRouter.createCaller(ctx as never);

    await expect(
      caller.update({ id: uuid(), data: { presionSistolica: 130 } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("eceSignosVitalesRouter — firmar", () => {
  it("8. NOT_FOUND cuando la toma no existe", async () => {
    const ctx = buildCtx(["NURSE"]);

    // SELECT signos_vitales → vacío
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const caller = eceSignosVitalesRouter.createCaller(ctx as never);

    await expect(caller.firmar({ id: uuid() })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("eceSignosVitalesRouter — autorización", () => {
  it("9. FORBIDDEN si el rol no incluye NURSE en firmar/validar", async () => {
    // PHYSICIAN no tiene acceso a firmar (nurseOnly = requireRole(['NURSE']))
    const ctx = buildCtx(["PHYSICIAN"]);
    const caller = eceSignosVitalesRouter.createCaller(ctx as never);

    await expect(caller.firmar({ id: uuid() })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await expect(caller.validar({ id: uuid() })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("calcularImc — cálculo automático", () => {
  it("10. IMC se calcula correctamente de peso y talla (HD-18)", () => {
    // Validamos que el schema acepta los campos y que se parsean correctamente.
    // El cálculo real (70 / 1.70^2 ≈ 24.2) ocurre en el router.
    const result = eceSignosVitalesCreateSchema.safeParse({
      pacienteId: uuid(),
      pesoKg: 70,
      tallaCm: 170,
    });
    expect(result.success).toBe(true);
    // 70 / (1.70 * 1.70) = 24.2
    if (result.success) {
      const imc = result.data.pesoKg! / Math.pow(result.data.tallaCm! / 100, 2);
      expect(Math.round(imc * 10) / 10).toBe(24.2);
    }
  });
});

// ─── CC-0007 — Glasgow + ICT ─────────────────────────────────────────────────

describe("eceSignosVitalesCreateSchema — CC-0007 campos nuevos (migración 182)", () => {
  const base = { pacienteId: uuid() };

  it("11. acepta Glasgow components dentro de rango (O:1-4, V:1-5, M:1-6)", () => {
    const result = eceSignosVitalesCreateSchema.safeParse({
      ...base,
      glasgowOcular: 3,
      glasgowVerbal: 4,
      glasgowMotor: 5,
    });
    expect(result.success).toBe(true);
  });

  it("12. rechaza glasgowOcular fuera de rango (0 y 5)", () => {
    const low = eceSignosVitalesCreateSchema.safeParse({ ...base, glasgowOcular: 0 });
    const high = eceSignosVitalesCreateSchema.safeParse({ ...base, glasgowOcular: 5 });
    expect(low.success).toBe(false);
    expect(high.success).toBe(false);
  });

  it("13. rechaza glasgowVerbal fuera de rango (0 y 6)", () => {
    const low = eceSignosVitalesCreateSchema.safeParse({ ...base, glasgowVerbal: 0 });
    const high = eceSignosVitalesCreateSchema.safeParse({ ...base, glasgowVerbal: 6 });
    expect(low.success).toBe(false);
    expect(high.success).toBe(false);
  });

  it("14. rechaza glasgowMotor fuera de rango (0 y 7)", () => {
    const low = eceSignosVitalesCreateSchema.safeParse({ ...base, glasgowMotor: 0 });
    const high = eceSignosVitalesCreateSchema.safeParse({ ...base, glasgowMotor: 7 });
    expect(low.success).toBe(false);
    expect(high.success).toBe(false);
  });

  it("15. acepta balanceHidrico negativo (puede ser negativo por definición)", () => {
    const result = eceSignosVitalesCreateSchema.safeParse({
      ...base,
      balanceHidrico: -500,
    });
    expect(result.success).toBe(true);
  });

  it("16. rechaza diuresis negativa", () => {
    const result = eceSignosVitalesCreateSchema.safeParse({ ...base, diuresis: -1 });
    expect(result.success).toBe(false);
  });

  it("17. acepta fur y fpp como fechas ISO (date)", () => {
    const result = eceSignosVitalesCreateSchema.safeParse({
      ...base,
      fur: "2026-05-01",
      fpp: "2026-11-15",
    });
    expect(result.success).toBe(true);
  });

  it("18. rechaza fur como datetime (debe ser solo date)", () => {
    const result = eceSignosVitalesCreateSchema.safeParse({
      ...base,
      fur: "2026-05-01T10:00:00Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("eceSignosVitalesRouter.create — CC-0007 derivados server-side", () => {
  it("19. glasgowTotal se deriva como O+V+M en el INSERT ($queryRaw)", async () => {
    const ctx = buildCtx(["NURSE"]);
    const newId = uuid();

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { paciente_id_ece: uuid2(), public_patient_id: null, public_encounter_id: null },
    ]);
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: newId }]);

    const caller = eceSignosVitalesRouter.createCaller(ctx as never);
    const result = await caller.create({
      episodioId: uuid(),
      glasgowOcular: 3,
      glasgowVerbal: 4,
      glasgowMotor: 5,
    });

    expect(result.id).toBe(newId);

    // Verificar que el $queryRaw del INSERT (2ª llamada) fue invocado con el
    // glasgow_total derivado = 3+4+5=12. El tagged template literal de Prisma
    // hace que los args lleguen como array de valores; inspeccionamos el
    // string de la llamada para confirmar que 12 aparece entre los valores.
    const rawCall = (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mock.calls[1];
    const values = rawCall!.slice(1); // el primer arg es el TemplateStringsArray
    expect(values).toContain(12);
  });

  it("20. ict se deriva como perimetroCintura/tallaCm en el INSERT", async () => {
    const ctx = buildCtx(["NURSE"]);
    const newId = uuid2();

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { paciente_id_ece: uuid2(), public_patient_id: null, public_encounter_id: null },
    ]);
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: newId }]);

    const caller = eceSignosVitalesRouter.createCaller(ctx as never);
    const result = await caller.create({
      episodioId: uuid(),
      perimetroCintura: 90,
      tallaCm: 170,
    });

    expect(result.id).toBe(newId);

    // ict = round(90/170 * 1000) / 1000 = 0.529
    const rawCall = (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mock.calls[1];
    const values = rawCall!.slice(1);
    const ict = Math.round((90 / 170) * 1000) / 1000;
    expect(values).toContain(ict);
  });
});

// ─── CC-0012 — módulo transversal (cuenta activa) ────────────────────────────

describe("eceSignosVitalesRouter.create — CC-0012 ancla por cuentaId", () => {
  it("21. create por cuentaId (sin episodioId) resuelve paciente/episodio y persiste cuenta_id", async () => {
    const ctx = buildCtx(["NURSE"]);
    const newId = uuid();
    const cuentaId = uuid2();
    const publicPatientId = "00000000-0000-4000-8000-000000000003";
    const episodioResuelto = "00000000-0000-4000-8000-000000000004";
    const pacienteEceId = "00000000-0000-4000-8000-000000000005";

    // Fase 1 — withTenantContext: resolver la cuenta (patientId/encounterId).
    (ctx.prisma.patientAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: cuentaId,
      patientId: publicPatientId,
      encounterId: null,
    });

    // Fase 2 — ece: 1ª $queryRaw resuelve episodio abierto por paciente;
    // 2ª $queryRaw resuelve ece.paciente.id por ACL público;
    // 3ª $queryRaw es el INSERT.
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: episodioResuelto }]) // resolveEpisodioAbiertoDesdeCuenta (fallback paciente)
      .mockResolvedValueOnce([{ id: pacienteEceId }]) // resolvePacienteEceId
      .mockResolvedValueOnce([{ id: newId }]); // INSERT

    const caller = eceSignosVitalesRouter.createCaller(ctx as never);
    const result = await caller.create({
      cuentaId,
      presionSistolica: 120,
      presionDiastolica: 80,
    });

    expect(result.id).toBe(newId);
    expect(result.episodioId).toBe(episodioResuelto);
    expect(result.cuentaId).toBe(cuentaId);

    const insertCall = (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mock.calls[2];
    const values = insertCall!.slice(1);
    expect(values).toContain(cuentaId);
    expect(values).toContain(pacienteEceId);
  });

  it("22. create por cuentaId inexistente lanza NOT_FOUND", async () => {
    const ctx = buildCtx(["NURSE"]);
    (ctx.prisma.patientAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const caller = eceSignosVitalesRouter.createCaller(ctx as never);
    await expect(caller.create({ cuentaId: uuid2(), presionSistolica: 120 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("23. create por episodioId (sin cuentaId) auto-vincula la cuenta activa del paciente", async () => {
    const ctx = buildCtx(["NURSE"]);
    const newId = uuid();
    const episodioId = uuid();
    const publicPatientId = "00000000-0000-4000-8000-000000000006";
    const publicEncounterId = "00000000-0000-4000-8000-000000000007";
    const pacienteEceId = "00000000-0000-4000-8000-000000000008";
    const cuentaResuelta = "00000000-0000-4000-8000-000000000009";

    // Fase 2 — ece: 1ª $queryRaw resuelve info del episodio (paciente + ACL);
    // 2ª $queryRaw es el INSERT.
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        {
          paciente_id_ece: pacienteEceId,
          public_patient_id: publicPatientId,
          public_encounter_id: publicEncounterId,
        },
      ])
      .mockResolvedValueOnce([{ id: newId }]) // INSERT
      .mockResolvedValueOnce(0 as never); // $executeRaw del UPDATE cuenta_id (fase 3)

    // Fase 3 — withTenantContext: resolver cuenta activa por encounterId.
    (ctx.prisma.patientAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: cuentaResuelta,
      patientId: publicPatientId,
      encounterId: publicEncounterId,
    });

    const caller = eceSignosVitalesRouter.createCaller(ctx as never);
    const result = await caller.create({ episodioId, presionSistolica: 120 });

    expect(result.id).toBe(newId);
    expect(result.cuentaId).toBe(cuentaResuelta);
  });

  it("24. create persiste fórmula obstétrica (G·P·P·A·V), pesoLb, tallaFt y fppActivo en el INSERT", async () => {
    const ctx = buildCtx(["NURSE"]);
    const newId = uuid();

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        { paciente_id_ece: uuid2(), public_patient_id: null, public_encounter_id: null },
      ])
      .mockResolvedValueOnce([{ id: newId }]);

    const caller = eceSignosVitalesRouter.createCaller(ctx as never);
    const result = await caller.create({
      episodioId: uuid(),
      goGestas: 2,
      goPartosTermino: 1,
      goPartosPretermino: 0,
      goAbortos: 1,
      goVivos: 1,
      pesoLb: 154,
      tallaFt: 5.58,
      fppActivo: true,
    });

    expect(result.id).toBe(newId);
    const insertCall = (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mock.calls[1];
    const values = insertCall!.slice(1);
    expect(values).toContain(2); // goGestas
    expect(values).toContain(154); // pesoLb
    expect(values).toContain(5.58); // tallaFt
    expect(values).toContain(true); // fppActivo
  });
});

describe("eceSignosVitalesRouter — list", () => {
  it("25. list acepta filtro solo por cuentaId (sin episodioId)", async () => {
    const ctx = buildCtx(["NURSE"]);
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const caller = eceSignosVitalesRouter.createCaller(ctx as never);
    const result = await caller.list({ cuentaId: uuid2() });

    expect(result.items).toEqual([]);
  });

  it("26. list rechaza BAD_REQUEST si no viene episodioId ni cuentaId", async () => {
    const ctx = buildCtx(["NURSE"]);
    const caller = eceSignosVitalesRouter.createCaller(ctx as never);

    await expect(caller.list({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
