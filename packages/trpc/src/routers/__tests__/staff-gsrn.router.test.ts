/**
 * Tests del router staffGsrnRouter — Catálogo GSRN Profesionales (US.F2.6.2).
 *
 * Cubre:
 *   - Alta con GSRN explícito válido
 *   - Alta con autoGenerate (formato GSRN Módulo-10)
 *   - Detección de GSRN duplicado (CONFLICT)
 *   - Revocación con motivo
 *   - Intento de revocar GSRN ya revocado (PRECONDITION_FAILED)
 *   - validate → ACTIVE retorna nombre/rol
 *   - validate → REVOKED lanza PROFESIONAL_NO_HABILITADO (Hard Stop)
 *   - validate → no encontrado lanza NOT_FOUND
 *   - printBadge → payload GS1 correcto
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { staffGsrnRouter } from "../staff-gsrn.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

// ---------------------------------------------------------------------------
// Helper: calcula dígito verificador GS1 Módulo-10
// ---------------------------------------------------------------------------

function gs1AppendCheckDigit(root: string): string {
  let sum = 0;
  for (let i = 0; i < root.length; i++) {
    const weight = (root.length - 1 - i) % 2 === 0 ? 3 : 1;
    sum += parseInt(root[i]!, 10) * weight;
  }
  const check = (10 - (sum % 10)) % 10;
  return root + check.toString();
}

// GSRN-18 todos-ceros: matemáticamente válido por cualquier implementación GS1
// sum=0 → check digit=0. Usado en inputs de mutaciones.
const VALID_GSRN   = "000000000000000000"; // 18 dígitos, check digit 0
const VALID_GSRN_2 = "000000000000000000";

const UUID_GSRN_1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID_USER_1 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let prisma: DeepMockProxy<PrismaClient>;
let caller: ReturnType<typeof staffGsrnRouter.createCaller>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  caller = staffGsrnRouter.createCaller(
    makeCtx({
      prisma,
      user:   MOCK_USER_ADMIN,
      tenant: MOCK_TENANT,
    }),
  );
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("staffGsrn.list", () => {
  it("retorna lista de GSRNs profesionales", async () => {
    const mockRow = {
      id: UUID_GSRN_1,
      codigo: VALID_GSRN,
      referencia_id: UUID_USER_1,
      establecimiento_id: null,
      activo: true,
      nombre: "Dr. Mario García",
      rol: "PHYSICIAN",
      turno: null,
      creado_en: new Date("2026-05-01"),
      actualizado_en: null,
    };
    prisma.$queryRawUnsafe.mockResolvedValueOnce([mockRow]);

    const result = await caller.list({});

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id:     UUID_GSRN_1,
      gsrn:   VALID_GSRN,
      userId: UUID_USER_1,
      nombre: "Dr. Mario García",
      rol:    "PHYSICIAN",
      status: "ACTIVE",
    });
  });

  it("retorna lista vacía si no hay registros", async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([]);
    const result = await caller.list({});
    expect(result).toHaveLength(0);
  });

  it("filtra por status REVOKED mapea activo=false", async () => {
    const mockRow = {
      id: UUID_GSRN_1, codigo: VALID_GSRN, referencia_id: UUID_USER_1,
      establecimiento_id: null, activo: false, nombre: "Enf. Ana López",
      rol: "NURSE", turno: null, creado_en: new Date(), actualizado_en: null,
    };
    prisma.$queryRawUnsafe.mockResolvedValueOnce([mockRow]);

    const result = await caller.list({ status: "REVOKED" });
    expect(result[0]?.status).toBe("REVOKED");
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("staffGsrn.create", () => {
  it("crea GSRN con código explícito válido", async () => {
    // check unicidad → 0
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ cnt: "0" }])          // unicidad
      .mockResolvedValueOnce([{ id: UUID_GSRN_1 }]);  // insert

    const result = await caller.create({
      userId: UUID_USER_1,
      gsrn:   VALID_GSRN,
    });

    expect(result.id).toBe(UUID_GSRN_1);
    expect(result.gsrn).toBe(VALID_GSRN);
  });

  it("crea GSRN con autoGenerate — retorna 18 dígitos numéricos", async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ cnt: "0" }])
      .mockResolvedValueOnce([{ id: UUID_GSRN_1 }]);

    const result = await caller.create({
      userId:       UUID_USER_1,
      autoGenerate: true,
    });

    expect(result.gsrn).toHaveLength(18);
    expect(result.gsrn).toMatch(/^\d{18}$/);
    expect(result.id).toBe(UUID_GSRN_1);
  });

  it("lanza CONFLICT si GSRN duplicado", async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ cnt: "1" }]);

    await expect(
      caller.create({ userId: UUID_USER_1, gsrn: VALID_GSRN }),
    ).rejects.toThrow(expect.objectContaining({
      code:    "CONFLICT",
      message: "ValidationError: GSRN_DUPLICADO",
    }));
  });

  it("lanza BAD_REQUEST si no se provee gsrn ni autoGenerate", async () => {
    await expect(
      caller.create({ userId: UUID_USER_1 }),
    ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  it("rechaza GSRN con dígito verificador incorrecto", async () => {
    await expect(
      caller.create({ userId: UUID_USER_1, gsrn: "800000000000000001" }),
    ).rejects.toThrow(TRPCError);
  });
});

// ---------------------------------------------------------------------------
// revoke
// ---------------------------------------------------------------------------

describe("staffGsrn.revoke", () => {
  it("revoca un GSRN activo y registra motivo", async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ activo: true }]); // check status
    prisma.$executeRawUnsafe
      .mockResolvedValueOnce(1)  // UPDATE activo=false
      .mockResolvedValueOnce(1); // UPDATE motivo_revocacion (opcional)

    const result = await caller.revoke({
      id:     UUID_GSRN_1,
      motivo: "Licencia suspendida por JUNTA_VIGILANCIA",
    });
    expect(result.ok).toBe(true);
  });

  it("lanza NOT_FOUND si el GSRN no existe", async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

    await expect(
      caller.revoke({ id: UUID_GSRN_1, motivo: "prueba" }),
    ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("lanza PRECONDITION_FAILED si ya está revocado", async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ activo: false }]);

    await expect(
      caller.revoke({ id: UUID_GSRN_1, motivo: "doble revocación" }),
    ).rejects.toThrow(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe("staffGsrn.validate", () => {
  it("retorna datos del profesional si GSRN activo", async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{
        id: UUID_GSRN_1,
        referencia_id: UUID_USER_1,
        activo: true,
        nombre: "Enf. María Torres",
        rol:    "NURSE",
      }])
      .mockResolvedValueOnce([{ turno: "MANANA_07_15" }]); // staff_schedule

    const result = await caller.validate({ gsrn: VALID_GSRN });

    expect(result.status).toBe("ACTIVE");
    expect(result.nombre).toBe("Enf. María Torres");
    expect(result.rol).toBe("NURSE");
    expect(result.turno).toBe("MANANA_07_15");
  });

  it("Hard Stop — lanza PROFESIONAL_NO_HABILITADO si GSRN revocado", async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{
      id: UUID_GSRN_1,
      referencia_id: UUID_USER_1,
      activo: false,
      nombre: "Dr. Pedro Vega",
      rol:    "PHYSICIAN",
    }]);

    await expect(
      caller.validate({ gsrn: VALID_GSRN }),
    ).rejects.toThrow(expect.objectContaining({
      code:    "FORBIDDEN",
      message: "PROFESIONAL_NO_HABILITADO",
    }));
  });

  it("lanza NOT_FOUND si GSRN no existe en catálogo", async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

    await expect(
      caller.validate({ gsrn: "999999999999999999" }),
    ).rejects.toThrow(expect.objectContaining({
      code:    "NOT_FOUND",
      message: "GSRN_PROFESIONAL_NO_ENCONTRADO",
    }));
  });

  it("retorna turno null si staff_schedule no tiene registro hoy", async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{
        id: UUID_GSRN_1,
        referencia_id: UUID_USER_1,
        activo: true,
        nombre: "Farm. Luis Díaz",
        rol:    "PHARMACIST",
      }])
      .mockResolvedValueOnce([]); // sin turno

    const result = await caller.validate({ gsrn: VALID_GSRN });
    expect(result.turno).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// printBadge
// ---------------------------------------------------------------------------

describe("staffGsrn.printBadge", () => {
  it("genera payload GS1 correcto para DataMatrix", async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{
      id:             UUID_GSRN_1,
      codigo:         VALID_GSRN,
      referencia_id:  UUID_USER_1,
      activo:         true,
      nombre:         "Dr. Mario García",
      rol:            "PHYSICIAN",
    }]);

    const result = await caller.printBadge({ id: UUID_GSRN_1 });

    expect(result.gsrn).toBe(VALID_GSRN);
    expect(result.gs1Payload).toBe(`(8018)${VALID_GSRN}`);
    expect(result.rendererHints.bcid).toBe("datamatrix");
    expect(result.nombre).toBe("Dr. Mario García");
  });

  it("lanza NOT_FOUND si el GSRN no existe", async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

    await expect(
      caller.printBadge({ id: UUID_GSRN_1 }),
    ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("payload incluye AI (8018) como prefijo GS1 correcto", async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{
      id: UUID_GSRN_1, codigo: VALID_GSRN_2,
      referencia_id: UUID_USER_1, activo: true, nombre: null, rol: null,
    }]);

    const result = await caller.printBadge({ id: UUID_GSRN_1 });
    expect(result.gs1Payload).toMatch(/^\(8018\)\d{18}$/);
  });
});
