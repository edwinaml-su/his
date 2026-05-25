/**
 * Tests unitarios — certificadoIncapacidadRouter (ECE CERT_INC).
 *
 * Normativa: ISSS El Salvador — Reglamento de Evaluación de Incapacidades.
 * NTEC §22.
 *
 * Casos cubiertos (5 tests):
 *   1. Zod create — rejects invalid CIE-10 code
 *   2. Zod create — rejects diagnosticoDescripcion < 10 chars
 *   3. create — happy path returns id, instanciaId, estado borrador
 *   4. firmar — CONFLICT when estado is already firmado
 *   5. anular — CONFLICT when estado is borrador (only valid on firmado)
 *   6. list — filters by pacienteId (returns matching rows)
 *   7. anular sin motivo suficiente — Zod rejects < 10 chars
 *
 * @QA E2E pendiente:
 *   - Flujo completo create → firmar con PIN válido → verificar outbox.
 *   - firmar rechaza PIN incorrecto (UNAUTHORIZED + incrementa failed_attempts).
 *   - anular en borrador devuelve CONFLICT.
 *   - MC puede firmar; DIR no puede firmar (FORBIDDEN).
 */
import { describe, it, expect, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { certificadoIncapacidadCreateInput } from "@his/contracts/schemas/certificado-incapacidad";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@his/database", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@his/database")>();
  return {
    ...mod,
    emitDomainEvent: vi.fn().mockResolvedValue(undefined),
  };
});

// withWorkflowContext ejecuta el callback directamente con el mismo prisma
vi.mock("../../workflow/context", () => ({
  withWorkflowContext: async (
    prisma: PrismaClient,
    _ctx: unknown,
    fn: (tx: PrismaClient) => Promise<unknown>,
  ) => fn(prisma),
}));

// argon2 mockeado — PIN siempre válido por defecto
vi.mock("@his/infrastructure", () => ({
  argon2: {
    verify: vi.fn().mockResolvedValue(true),
    hash: vi.fn().mockResolvedValue("$argon2id$mocked"),
  },
}));

// assertDependenciasFirmadas — no-op en tests unitarios
vi.mock("../../../ece/dependencias-enforcement", () => ({
  assertDependenciasFirmadas: vi.fn().mockResolvedValue(undefined),
}));

// Importar router DESPUÉS de los mocks
import { certificadoIncapacidadRouter } from "../certificado-incapacidad.router";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const uuid  = () => "00000000-0000-4000-8000-000000000001";
const uuid2 = () => "00000000-0000-4000-8000-000000000002";
const uuid3 = () => "00000000-0000-4000-8000-000000000003";
const uuid4 = () => "00000000-0000-4000-8000-000000000004";

const validCreateInput: z.infer<typeof certificadoIncapacidadCreateInput> = {
  pacienteId:             uuid(),
  medicoId:               uuid2(),
  tipoIncapacidad:        "enfermedad_comun",
  fechaInicio:            "2026-05-20",
  fechaFin:               "2026-05-25",
  diagnosticoCie10:       "J20",
  diagnosticoDescripcion: "Bronquitis aguda — reposo indicado",
};

/** Fixture row con estado_documento. */
const makeCertRow = (estadoDocumento = "borrador", estadoRegistro = "borrador") => ({
  id:                      uuid(),
  instancia_id:            uuid2(),
  paciente_id:             uuid(),
  episodio_id:             null,
  establecimiento_id:      uuid3(),
  medico_id:               uuid2(),
  tipo_incapacidad:        "enfermedad_comun",
  fecha_inicio:            new Date("2026-05-20"),
  fecha_fin:               new Date("2026-05-25"),
  dias_otorgados:          6,
  diagnostico_cie10:       "J20",
  diagnostico_descripcion: "Bronquitis aguda — reposo indicado",
  numero_afiliacion_isss:  null,
  patrono_nit:             null,
  observaciones:           null,
  estado_registro:         estadoRegistro,
  motivo_anulacion:        null,
  registrado_en:           new Date("2026-05-20T08:00:00Z"),
  registrado_por:          uuid4(),
  estado_documento:        estadoDocumento,
});

// ─── Context helper ───────────────────────────────────────────────────────────

function buildCtx(roleCodes: string[] = ["MC"]) {
  const prisma = mockDeep<PrismaClient>();

  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(0);

  return {
    prisma,
    user: { id: uuid(), email: "mc@test.com", fullName: "Médico General" },
    tenant: {
      organizationId: uuid3(),
      establishmentId: uuid2(),
      roleCodes,
    },
    portalAccount: null,
  };
}

// ─── 1-2: Zod validaciones schema ────────────────────────────────────────────

describe("certificadoIncapacidadCreateInput — validación Zod", () => {
  it("1. rechaza código CIE-10 inválido", () => {
    const r1 = certificadoIncapacidadCreateInput.safeParse({
      ...validCreateInput,
      diagnosticoCie10: "j20",        // minúscula
    });
    const r2 = certificadoIncapacidadCreateInput.safeParse({
      ...validCreateInput,
      diagnosticoCie10: "ABCDEF",     // formato incorrecto
    });
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
  });

  it("2. rechaza diagnosticoDescripcion con menos de 10 chars", () => {
    const r = certificadoIncapacidadCreateInput.safeParse({
      ...validCreateInput,
      diagnosticoDescripcion: "corto",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.diagnosticoDescripcion).toBeDefined();
    }
  });
});

// ─── 3: create happy path ────────────────────────────────────────────────────

describe("certificadoIncapacidadRouter — create", () => {
  it("3. happy path: crea instancia + certificado, retorna id + instanciaId + estado borrador", async () => {
    const ctx = buildCtx(["MC"]);
    const newCertId = "aaaaaaaa-0000-4000-8000-000000000001";
    const newInstanciaId = "bbbbbbbb-0000-4000-8000-000000000001";

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: uuid4() }])                                     // 1. personal_salud
      .mockResolvedValueOnce([{ tipo_doc_id: uuid(), estado_inicial_id: uuid2() }]) // 2. tipo_documento CERT_INC
      .mockResolvedValueOnce([{ id: newInstanciaId }])                              // 3. INSERT documento_instancia
      .mockResolvedValueOnce([{ id: newCertId }]);                                  // 4. INSERT certificado_incapacidad

    const caller = certificadoIncapacidadRouter.createCaller(ctx as never);
    const result = await caller.create(validCreateInput);

    expect(result.id).toBe(newCertId);
    expect(result.instanciaId).toBe(newInstanciaId);
    expect(result.estado).toBe("borrador");
    expect(result.ok).toBe(true);
  });
});

// ─── 4: firmar ───────────────────────────────────────────────────────────────

describe("certificadoIncapacidadRouter — firmar", () => {
  it("4. CONFLICT si el certificado ya está firmado", async () => {
    const ctx = buildCtx(["MC"]);

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      makeCertRow("firmado", "firmado"),
    ]);

    const caller = certificadoIncapacidadRouter.createCaller(ctx as never);

    await expect(
      caller.firmar({ id: uuid(), firmaPin: "123456" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("borrador"),
    });
  });
});

// ─── 5: anular ───────────────────────────────────────────────────────────────

describe("certificadoIncapacidadRouter — anular", () => {
  it("5. CONFLICT al anular un certificado en estado borrador (solo válido en firmado)", async () => {
    const ctx = buildCtx(["MC"]);

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { estado_registro: "borrador", instancia_id: uuid2(), paciente_id: uuid() },
    ]);

    const caller = certificadoIncapacidadRouter.createCaller(ctx as never);

    await expect(
      caller.anular({
        id: uuid(),
        motivoAnulacion: "Motivo suficientemente largo para pasar Zod",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("firmado"),
    });
  });

  it("6. Zod rechaza motivoAnulacion con menos de 10 chars", async () => {
    const ctx = buildCtx(["MC"]);
    const caller = certificadoIncapacidadRouter.createCaller(ctx as never);

    await expect(
      caller.anular({ id: uuid(), motivoAnulacion: "corto" }),
    ).rejects.toBeDefined();
  });
});

// ─── 7: list filtra por pacienteId ───────────────────────────────────────────

describe("certificadoIncapacidadRouter — list", () => {
  it("7. list con pacienteId filtra y retorna items + total", async () => {
    const ctx = buildCtx(["MC"]);
    const certRow = makeCertRow();

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([certRow])             // rows
      .mockResolvedValueOnce([{ total: BigInt(1) }]); // count

    const caller = certificadoIncapacidadRouter.createCaller(ctx as never);
    const result = await caller.list({ pacienteId: uuid(), page: 1, pageSize: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.items[0]!.tipo_incapacidad).toBe("enfermedad_comun");
  });
});
