/**
 * Tests: pharmacySubstitutionRouter (US.F2.6.11)
 *
 * Cubre:
 *   - proposeSubstitution: éxito, SIN_EQUIVALENCIA_AUTORIZADA, receta no encontrada
 *   - authorizeSubstitution: éxito, FORBIDDEN (no es prescriptor), estado inválido
 *   - rejectSubstitution: éxito, FORBIDDEN, estado inválido
 *   - listPending: retorna array (puede ser vacío)
 *   - getStatus: NOT_FOUND si no existe
 *
 * Estrategia: mocking de ctx.prisma.$queryRawUnsafe y $executeRawUnsafe.
 * emitDomainEvent se mockea para no necesitar BD real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ─── Mocks globales ────────────────────────────────────────────────────────

vi.mock("@his/database", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-id" }),
}));

// ─── Helpers de contexto ───────────────────────────────────────────────────

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const MEDICO_ID = "00000000-0000-0000-0000-000000000003";
const PRESC_ID = "00000000-0000-0000-0000-000000000010";
const ITEM_ID = "00000000-0000-0000-0000-000000000011";
const SUB_ID = "00000000-0000-0000-0000-000000000020";
const CAT_ID = "00000000-0000-0000-0000-000000000030";
const GTIN_A = "07501000001234"; // 14 digits
const GTIN_B = "07501000005678"; // 14 digits

function makeCtx(roleCodes: string[] = ["PHARM"], userId = USER_ID) {
  const prisma = {
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    domainEvent: { create: vi.fn().mockResolvedValue({ id: "evt-id" }) },
  };

  return {
    prisma,
    user: { id: userId },
    tenant: { organizationId: ORG_ID, roleCodes },
  };
}

// ─── Importación lazy del caller para evitar init de tRPC antes del mock ──

async function buildCaller(ctx: ReturnType<typeof makeCtx>) {
  const { pharmacySubstitutionRouter } = await import("../substitution.router");
  // @ts-expect-error — acceso interno para test sin http
  return pharmacySubstitutionRouter.createCaller(ctx as unknown);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("pharmacySubstitutionRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── proposeSubstitution ─────────────────────────────────────────────────

  describe("proposeSubstitution", () => {
    it("bloquea con SIN_EQUIVALENCIA_AUTORIZADA si no existe catálogo", async () => {
      const ctx = makeCtx(["PHARM"]);
      // Primera llamada: catálogo vacío
      ctx.prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      const caller = await buildCaller(ctx);
      await expect(
        caller.proposeSubstitution({
          prescriptionId: PRESC_ID,
          prescriptionItemId: ITEM_ID,
          gtinOriginal: GTIN_A,
          gtinSustituto: GTIN_B,
        }),
      ).rejects.toThrow(TRPCError);
    });

    it("lanza NOT_FOUND si la receta no pertenece al tenant", async () => {
      const ctx = makeCtx(["PHARM"]);
      // Catálogo existe
      ctx.prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ id: CAT_ID, gtin_original: GTIN_A, gtin_sustituto: GTIN_B, estado: "AUTORIZADA" }])
        // Receta no encontrada
        .mockResolvedValueOnce([]);

      const caller = await buildCaller(ctx);
      await expect(
        caller.proposeSubstitution({
          prescriptionId: PRESC_ID,
          prescriptionItemId: ITEM_ID,
          gtinOriginal: GTIN_A,
          gtinSustituto: GTIN_B,
        }),
      ).rejects.toThrow(TRPCError);
    });

    it("crea la sustitución y emite evento cuando todo está OK", async () => {
      const ctx = makeCtx(["PHARM"]);
      ctx.prisma.$queryRawUnsafe
        // catálogo
        .mockResolvedValueOnce([{ id: CAT_ID, gtin_original: GTIN_A, gtin_sustituto: GTIN_B, estado: "AUTORIZADA" }])
        // receta
        .mockResolvedValueOnce([{ id: PRESC_ID, prescriber_id: MEDICO_ID }])
        // INSERT RETURNING id
        .mockResolvedValueOnce([{ id: SUB_ID }]);

      const { emitDomainEvent } = await import("@his/database");

      const caller = await buildCaller(ctx);
      const result = await caller.proposeSubstitution({
        prescriptionId: PRESC_ID,
        prescriptionItemId: ITEM_ID,
        gtinOriginal: GTIN_A,
        gtinSustituto: GTIN_B,
      });

      expect(result.substitutionId).toBe(SUB_ID);
      expect(result.prescriptorUserId).toBe(MEDICO_ID);
      expect(emitDomainEvent).toHaveBeenCalledOnce();
    });
  });

  // ── authorizeSubstitution ───────────────────────────────────────────────

  describe("authorizeSubstitution", () => {
    const pendingSub = {
      id: SUB_ID,
      prescription_id: PRESC_ID,
      prescription_item_id: ITEM_ID,
      organization_id: ORG_ID,
      gtin_original: GTIN_A,
      gtin_sustituto: GTIN_B,
      sustitucion_catalogo_id: CAT_ID,
      status: "PENDIENTE_AUTORIZACION",
      propuesto_por_id: USER_ID,
      propuesto_en: new Date(),
      autorizado_por_id: null,
      autorizado_en: null,
      motivo: null,
      epcis_what: {},
      creado_en: new Date(),
      actualizado_en: new Date(),
      prescriber_check: MEDICO_ID,
    };

    it("autoriza correctamente cuando el médico es el prescriptor", async () => {
      const ctx = makeCtx(["MEDICO"], MEDICO_ID);
      ctx.prisma.$queryRawUnsafe.mockResolvedValueOnce([pendingSub]);

      const { emitDomainEvent } = await import("@his/database");
      const caller = await buildCaller(ctx);
      const result = await caller.authorizeSubstitution({ substitutionId: SUB_ID, motivo: "Equivalente terapéutico confirmado" });

      expect(result.ok).toBe(true);
      // $executeRawUnsafe se llama: SET LOCAL GUCs (withTenantContext) + UPDATE
      expect(ctx.prisma.$executeRawUnsafe).toHaveBeenCalled();
      expect(emitDomainEvent).toHaveBeenCalledOnce();
    });

    it("rechaza FORBIDDEN si el médico no es el prescriptor", async () => {
      const otroMedico = "00000000-0000-0000-0000-000000000099";
      const ctx = makeCtx(["MEDICO"], otroMedico);
      ctx.prisma.$queryRawUnsafe.mockResolvedValueOnce([pendingSub]);

      const caller = await buildCaller(ctx);
      await expect(
        caller.authorizeSubstitution({ substitutionId: SUB_ID, motivo: "no debería pasar" }),
      ).rejects.toThrow(TRPCError);
    });

    it("rechaza BAD_REQUEST si el status ya no es PENDIENTE", async () => {
      const ctx = makeCtx(["MEDICO"], MEDICO_ID);
      ctx.prisma.$queryRawUnsafe.mockResolvedValueOnce([
        { ...pendingSub, status: "AUTORIZADA" },
      ]);

      const caller = await buildCaller(ctx);
      await expect(
        caller.authorizeSubstitution({ substitutionId: SUB_ID, motivo: "ya autorizada" }),
      ).rejects.toThrow(TRPCError);
    });
  });

  // ── rejectSubstitution ──────────────────────────────────────────────────

  describe("rejectSubstitution", () => {
    const pendingSub = {
      id: SUB_ID,
      prescription_id: PRESC_ID,
      prescription_item_id: ITEM_ID,
      organization_id: ORG_ID,
      gtin_original: GTIN_A,
      gtin_sustituto: GTIN_B,
      sustitucion_catalogo_id: CAT_ID,
      status: "PENDIENTE_AUTORIZACION",
      propuesto_por_id: USER_ID,
      propuesto_en: new Date(),
      autorizado_por_id: null,
      autorizado_en: null,
      motivo: null,
      epcis_what: {},
      creado_en: new Date(),
      actualizado_en: new Date(),
      prescriber_check: MEDICO_ID,
    };

    it("rechaza correctamente cuando el médico es el prescriptor", async () => {
      const ctx = makeCtx(["MEDICO"], MEDICO_ID);
      ctx.prisma.$queryRawUnsafe.mockResolvedValueOnce([pendingSub]);

      const { emitDomainEvent } = await import("@his/database");
      const caller = await buildCaller(ctx);
      const result = await caller.rejectSubstitution({ substitutionId: SUB_ID, motivo: "Interacción contraindicada" });

      expect(result.ok).toBe(true);
      expect(emitDomainEvent).toHaveBeenCalledOnce();
    });

    it("rechaza FORBIDDEN si el médico no es el prescriptor", async () => {
      const otroMedico = "00000000-0000-0000-0000-000000000099";
      const ctx = makeCtx(["MEDICO"], otroMedico);
      ctx.prisma.$queryRawUnsafe.mockResolvedValueOnce([pendingSub]);

      const caller = await buildCaller(ctx);
      await expect(
        caller.rejectSubstitution({ substitutionId: SUB_ID, motivo: "no debería pasar" }),
      ).rejects.toThrow(TRPCError);
    });
  });

  // ── listPending ─────────────────────────────────────────────────────────

  describe("listPending", () => {
    it("retorna array vacío si no hay pendientes", async () => {
      const ctx = makeCtx(["MEDICO"], MEDICO_ID);
      ctx.prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      const caller = await buildCaller(ctx);
      const result = await caller.listPending();
      expect(result).toEqual([]);
    });

    it("retorna sustituciones mapeadas", async () => {
      const ctx = makeCtx(["MEDICO"], MEDICO_ID);
      ctx.prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: SUB_ID,
          prescription_id: PRESC_ID,
          prescription_item_id: ITEM_ID,
          organization_id: ORG_ID,
          gtin_original: GTIN_A,
          gtin_sustituto: GTIN_B,
          sustitucion_catalogo_id: CAT_ID,
          status: "PENDIENTE_AUTORIZACION",
          propuesto_por_id: USER_ID,
          propuesto_en: new Date(),
          autorizado_por_id: null,
          autorizado_en: null,
          motivo: null,
          epcis_what: { original: GTIN_A, sustituto: GTIN_B, substitutionId: SUB_ID },
          creado_en: new Date(),
          actualizado_en: new Date(),
        },
      ]);

      const caller = await buildCaller(ctx);
      const result = await caller.listPending();
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(SUB_ID);
      expect(result[0]?.gtinOriginal).toBe(GTIN_A);
    });
  });

  // ── getStatus ───────────────────────────────────────────────────────────

  describe("getStatus", () => {
    it("lanza NOT_FOUND si no existe la sustitución", async () => {
      const ctx = makeCtx(["PHARM"]);
      ctx.prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      const caller = await buildCaller(ctx);
      await expect(
        caller.getStatus({ substitutionId: SUB_ID }),
      ).rejects.toThrow(TRPCError);
    });
  });
});
