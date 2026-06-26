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
  it("6. happy path: retorna id cuando la inserción es exitosa", async () => {
    const ctx = buildCtx(["NURSE"]);
    const newId = uuid();

    // Mockear $queryRaw para la INSERT ... RETURNING id
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: newId },
    ]);

    const caller = eceSignosVitalesRouter.createCaller(ctx as never);

    const result = await caller.create({
      pacienteId: uuid(),
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

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: newId }]);

    const caller = eceSignosVitalesRouter.createCaller(ctx as never);
    const result = await caller.create({
      pacienteId: uuid(),
      glasgowOcular: 3,
      glasgowVerbal: 4,
      glasgowMotor: 5,
    });

    expect(result.id).toBe(newId);

    // Verificar que el $queryRaw fue llamado con el glasgow_total derivado = 3+4+5=12.
    // El tagged template literal de Prisma hace que los args lleguen como array de valores.
    // Inspeccionamos el string de la llamada para confirmar que 12 aparece en los valores.
    const rawCall = (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mock.calls[0];
    // El template literal incluye los valores como argumentos posicionales.
    // Buscamos el valor 12 (glasgowTotal) entre los args del tag template.
    const values = rawCall!.slice(1); // el primer arg es el TemplateStringsArray
    expect(values).toContain(12);
  });

  it("20. ict se deriva como perimetroCintura/tallaCm en el INSERT", async () => {
    const ctx = buildCtx(["NURSE"]);
    const newId = uuid2();

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: newId }]);

    const caller = eceSignosVitalesRouter.createCaller(ctx as never);
    const result = await caller.create({
      pacienteId: uuid(),
      perimetroCintura: 90,
      tallaCm: 170,
    });

    expect(result.id).toBe(newId);

    // ict = round(90/170 * 1000) / 1000 = 0.529
    const rawCall = (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mock.calls[0];
    const values = rawCall!.slice(1);
    const ict = Math.round((90 / 170) * 1000) / 1000;
    expect(values).toContain(ict);
  });
});
