/**
 * Tests: patientIdentificationRouter (US.F2.6.37-40)
 *
 * Cubre: lookupByGsrn (OK, GSRN_NO_REGISTRADO, PULSERA_INACTIVA),
 *        refreshGsrn (OK, GSRN_DUPLICADO, paciente no encontrado, sin rol),
 *        getHistory (OK, NOT_FOUND).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { patientIdentificationRouter } from "../patient-identification.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ---------------------------------------------------------------------------
// Fixtures — GSRNs válidos según algoritmo gs1CheckDigitValid del router
// (len-1-i) % 2 === 0 ? 3 : 1
// ---------------------------------------------------------------------------

const PAT_ID = "00000000-0000-0000-0000-000000000001";
const ORG_ID = MOCK_TENANT.organizationId;
const HIST_ID = "00000000-0000-0000-0000-000000000002";

// GSRN-18 válidos (verificados con el algoritmo del router)
const VALID_GSRN = "750300000000000018";
const NEW_GSRN = "750300000000000063";

// GSRN con dígito verificador incorrecto (válido en formato, inválido en checkdigit)
const BAD_CD_GSRN = "750300000000000019";

const BASE_HISTORY = {
  id: HIST_ID,
  patientId: PAT_ID,
  organizationId: ORG_ID,
  gsrn: VALID_GSRN,
  status: "ACTIVE" as const,
  assignedAt: new Date("2026-05-01T10:00:00Z"),
  revokedAt: null,
  assignedById: null,
  revokedById: null,
  motivoRevocacion: null,
  createdAt: new Date("2026-05-01T10:00:00Z"),
  updatedAt: new Date("2026-05-01T10:00:00Z"),
  patient: {
    id: PAT_ID,
    mrn: "MRN-001",
    firstName: "Ana",
    middleName: null,
    lastName: "Garcia",
    secondLastName: null,
    birthDate: new Date("1990-03-15"),
    bloodTypeAbo: "O",
    bloodRh: "+",
    active: true,
    allergies: [
      {
        id: "allergy-01",
        substanceText: "Penicilina",
        severity: "severe",
        reaction: "Anafilaxis",
        verified: true,
      },
    ],
    encounters: [],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrisma() {
  return mockDeep<PrismaClient>();
}

/** withTenantContext usa prisma.$transaction — mock para ejecutar el callback directo. */
function mockTransaction(prisma: DeepMockProxy<PrismaClient>) {
  prisma.$transaction.mockImplementation(async (fn) => {
    if (typeof fn === "function") {
      return fn(prisma as unknown as PrismaClient);
    }
    return fn;
  });
  prisma.$executeRaw.mockResolvedValue(1);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("patientIdentificationRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makePrisma();
    mockTransaction(prisma);
  });

  // ────────────────────── lookupByGsrn ──────────────────────

  describe("lookupByGsrn", () => {
    it("retorna ficha completa cuando la pulsera está activa", async () => {
      prisma.gsrnHistory.findFirst.mockResolvedValue(BASE_HISTORY as never);

      const caller = patientIdentificationRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.lookupByGsrn({ gsrn: VALID_GSRN });

      expect(result.gsrn).toBe(VALID_GSRN);
      expect(result.patient.mrn).toBe("MRN-001");
      expect(result.allergies).toHaveLength(1);
      expect(result.allergies[0]?.substanceText).toBe("Penicilina");
      expect(result.activeEncounter).toBeNull();
    });

    it("lanza NOT_FOUND con message=GSRN_NO_REGISTRADO cuando no existe", async () => {
      prisma.gsrnHistory.findFirst.mockResolvedValue(null);

      const caller = patientIdentificationRouter.createCaller(makeCtx({ prisma }));

      await expect(caller.lookupByGsrn({ gsrn: VALID_GSRN })).rejects.toSatisfy(
        (err) => err instanceof TRPCError && err.code === "NOT_FOUND" && err.message === "GSRN_NO_REGISTRADO",
      );
    });

    it("lanza FORBIDDEN con message=PULSERA_INACTIVA cuando la pulsera está revocada", async () => {
      prisma.gsrnHistory.findFirst.mockResolvedValue({
        ...BASE_HISTORY,
        status: "REVOKED",
        revokedAt: new Date("2026-05-10"),
      } as never);

      const caller = patientIdentificationRouter.createCaller(makeCtx({ prisma }));

      await expect(caller.lookupByGsrn({ gsrn: VALID_GSRN })).rejects.toSatisfy(
        (err) => err instanceof TRPCError && err.code === "FORBIDDEN" && err.message === "PULSERA_INACTIVA",
      );
    });

    it("rechaza GSRN con longitud incorrecta (validación Zod)", async () => {
      const caller = patientIdentificationRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.lookupByGsrn({ gsrn: "12345" }),
      ).rejects.toBeInstanceOf(TRPCError);
    });

    it("rechaza GSRN con dígito verificador incorrecto (validación Zod)", async () => {
      const caller = patientIdentificationRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.lookupByGsrn({ gsrn: BAD_CD_GSRN }),
      ).rejects.toBeInstanceOf(TRPCError);
    });
  });

  // ────────────────────── refreshGsrn ──────────────────────

  describe("refreshGsrn", () => {
    it("emite nueva pulsera y revoca la anterior", async () => {
      prisma.patient.findFirst.mockResolvedValue({ id: PAT_ID, mrn: "MRN-001" } as never);
      prisma.gsrnHistory.findUnique.mockResolvedValue(null);
      prisma.gsrnHistory.updateMany.mockResolvedValue({ count: 1 });
      prisma.gsrnHistory.create.mockResolvedValue({
        id: "new-hist-id",
        gsrn: NEW_GSRN,
        assignedAt: new Date(),
        patientId: PAT_ID,
        organizationId: ORG_ID,
        status: "ACTIVE",
        revokedAt: null,
        assignedById: MOCK_TENANT.userId,
        revokedById: null,
        motivoRevocacion: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      prisma.patient.update.mockResolvedValue({} as never);

      const caller = patientIdentificationRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.refreshGsrn({
        patientId: PAT_ID,
        newGsrn: NEW_GSRN,
        motivoRevocacion: "DETERIORO_PULSERA",
      });

      expect(result.gsrn).toBe(NEW_GSRN);
      expect(prisma.gsrnHistory.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "ACTIVE", patientId: PAT_ID }),
        }),
      );
      expect(prisma.patient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ gsrn: NEW_GSRN }),
        }),
      );
    });

    it("lanza CONFLICT con message=GSRN_DUPLICADO si el GSRN ya está en uso", async () => {
      prisma.patient.findFirst.mockResolvedValue({ id: PAT_ID, mrn: "MRN-001" } as never);
      prisma.gsrnHistory.findUnique.mockResolvedValue({ id: "existing" } as never);

      const caller = patientIdentificationRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.refreshGsrn({
          patientId: PAT_ID,
          newGsrn: NEW_GSRN,
          motivoRevocacion: "DETERIORO_PULSERA",
        }),
      ).rejects.toSatisfy(
        (err) => err instanceof TRPCError && err.code === "CONFLICT" && err.message === "GSRN_DUPLICADO",
      );
    });

    it("lanza NOT_FOUND si el paciente no pertenece al tenant", async () => {
      prisma.patient.findFirst.mockResolvedValue(null);

      const caller = patientIdentificationRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.refreshGsrn({
          patientId: PAT_ID,
          newGsrn: NEW_GSRN,
          motivoRevocacion: "DETERIORO_PULSERA",
        }),
      ).rejects.toSatisfy(
        (err) => err instanceof TRPCError && err.code === "NOT_FOUND",
      );
    });

    it("requiere rol ADMIN/ADMISION — sin rol correcto lanza FORBIDDEN", async () => {
      const caller = patientIdentificationRouter.createCaller(
        makeCtx({
          prisma,
          tenant: { ...MOCK_TENANT, roleCodes: ["NURSE"] },
        }),
      );

      await expect(
        caller.refreshGsrn({
          patientId: PAT_ID,
          newGsrn: NEW_GSRN,
          motivoRevocacion: "DETERIORO_PULSERA",
        }),
      ).rejects.toSatisfy(
        (err) => err instanceof TRPCError && err.code === "FORBIDDEN",
      );
    });
  });

  // ────────────────────── getHistory ──────────────────────

  describe("getHistory", () => {
    it("retorna historial completo del paciente", async () => {
      prisma.patient.findFirst.mockResolvedValue({ id: PAT_ID } as never);
      prisma.gsrnHistory.findMany.mockResolvedValue([
        {
          id: HIST_ID,
          gsrn: VALID_GSRN,
          status: "ACTIVE",
          assignedAt: new Date("2026-05-01"),
          revokedAt: null,
          assignedById: null,
          revokedById: null,
          motivoRevocacion: null,
        },
      ] as never);

      const caller = patientIdentificationRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.getHistory({ patientId: PAT_ID });

      expect(result).toHaveLength(1);
      expect(result[0]?.gsrn).toBe(VALID_GSRN);
      expect(result[0]?.status).toBe("ACTIVE");
    });

    it("lanza NOT_FOUND si el paciente no existe en el tenant", async () => {
      prisma.patient.findFirst.mockResolvedValue(null);

      const caller = patientIdentificationRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.getHistory({ patientId: PAT_ID }),
      ).rejects.toSatisfy(
        (err) => err instanceof TRPCError && err.code === "NOT_FOUND",
      );
    });
  });
});
