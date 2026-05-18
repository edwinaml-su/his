/**
 * Tests US.F2.6.1 — gsrnPulseraRouter.
 *
 * Cobertura:
 *   assign  — nueva asignación, duplicate Hard Stop
 *   get     — paciente con/sin GSRN
 *   print   — con GSRN, sin GSRN (PRECONDITION_FAILED)
 *   reprint — con GSRN, sin GSRN (PRECONDITION_FAILED)
 *   formato GSRN — 18 dígitos, dígito verificador módulo-10 válido
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { gsrnPulseraRouter } from "../gsrn-pulsera.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { validateGSRN } from "@his/contracts";

/** UUID helper. */
const u = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

const PATIENT_ID = u(1);
const ORG_ID = "00000000-0000-0000-0000-0000000000aa"; // coincide con MOCK_TENANT

describe("gsrnPulseraRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();

    // withTenantContext usa $transaction internamente.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
      .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
  });

  // ---------------------------------------------------------------------------
  // assign
  // ---------------------------------------------------------------------------

  describe("assign", () => {
    it("asigna GSRN nuevo — 18 dígitos — válido módulo-10", async () => {
      prisma.patient.findFirst.mockResolvedValue({
        id: PATIENT_ID,
        organizationId: ORG_ID,
        gsrn: null,
        mrn: "MRN-0042",
        deletedAt: null,
      } as never);
      prisma.organization.findUnique.mockResolvedValue({
        gs1CompanyPrefix: "7503000",
      } as never);
      prisma.patient.update.mockImplementation(((args: { data: { gsrn: string } }) => {
        return Promise.resolve({ id: PATIENT_ID, gsrn: args.data.gsrn });
      }) as never);

      const caller = gsrnPulseraRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.assign({ patientId: PATIENT_ID });

      expect(result.patientId).toBe(PATIENT_ID);
      expect(result.gsrn).toHaveLength(18);
      expect(validateGSRN(result.gsrn)).toBe(true);
    });

    it("usa prefijo fallback cuando org no tiene gs1CompanyPrefix", async () => {
      prisma.patient.findFirst.mockResolvedValue({
        id: PATIENT_ID,
        organizationId: ORG_ID,
        gsrn: null,
        mrn: "MRN-0001",
        deletedAt: null,
      } as never);
      prisma.organization.findUnique.mockResolvedValue({
        gs1CompanyPrefix: null,
      } as never);
      prisma.patient.update.mockImplementation(((args: { data: { gsrn: string } }) => {
        return Promise.resolve({ id: PATIENT_ID, gsrn: args.data.gsrn });
      }) as never);

      const caller = gsrnPulseraRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.assign({ patientId: PATIENT_ID });

      expect(validateGSRN(result.gsrn)).toBe(true);
    });

    it("Hard Stop (CONFLICT) si el paciente ya tiene GSRN", async () => {
      prisma.patient.findFirst.mockResolvedValue({
        id: PATIENT_ID,
        organizationId: ORG_ID,
        gsrn: "750300000000000004", // ya asignado
        mrn: "MRN-0042",
        deletedAt: null,
      } as never);

      const caller = gsrnPulseraRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.assign({ patientId: PATIENT_ID })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("NOT_FOUND si el paciente no existe en el tenant", async () => {
      prisma.patient.findFirst.mockResolvedValue(null as never);

      const caller = gsrnPulseraRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.assign({ patientId: PATIENT_ID })).rejects.toBeInstanceOf(TRPCError);
    });
  });

  // ---------------------------------------------------------------------------
  // get
  // ---------------------------------------------------------------------------

  describe("get", () => {
    it("devuelve GSRN cuando está asignado", async () => {
      prisma.patient.findFirst.mockResolvedValue({
        id: PATIENT_ID,
        organizationId: ORG_ID,
        gsrn: "750300000000000004",
        deletedAt: null,
      } as never);

      const caller = gsrnPulseraRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.get({ patientId: PATIENT_ID });

      expect(result.gsrn).toBe("750300000000000004");
    });

    it("devuelve gsrn=null cuando no está asignado", async () => {
      prisma.patient.findFirst.mockResolvedValue({
        id: PATIENT_ID,
        organizationId: ORG_ID,
        gsrn: null,
        deletedAt: null,
      } as never);

      const caller = gsrnPulseraRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.get({ patientId: PATIENT_ID });

      expect(result.gsrn).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // print
  // ---------------------------------------------------------------------------

  describe("print", () => {
    it("devuelve ZPL + dataMatrixB64 cuando el paciente tiene GSRN", async () => {
      prisma.patient.findFirst.mockResolvedValue({
        id: PATIENT_ID,
        organizationId: ORG_ID,
        gsrn: "750300000000000004",
        mrn: "MRN-0042",
        firstName: "María",
        lastName: "Pérez",
        deletedAt: null,
      } as never);

      const caller = gsrnPulseraRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.print({ patientId: PATIENT_ID });

      expect(result.gsrn).toBe("750300000000000004");
      expect(result.zpl).toContain("^XA");
      expect(result.zpl).toContain("750300000000000004");
      expect(result.dataMatrixB64).toBeTruthy();
      expect(result.printedAt).toBeTruthy();
    });

    it("PRECONDITION_FAILED si el paciente no tiene GSRN", async () => {
      prisma.patient.findFirst.mockResolvedValue({
        id: PATIENT_ID,
        organizationId: ORG_ID,
        gsrn: null,
        mrn: "MRN-0042",
        firstName: "María",
        lastName: "Pérez",
        deletedAt: null,
      } as never);

      const caller = gsrnPulseraRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.print({ patientId: PATIENT_ID }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  // ---------------------------------------------------------------------------
  // reprint
  // ---------------------------------------------------------------------------

  describe("reprint", () => {
    it("NO reasigna GSRN — usa el existente para generar el payload", async () => {
      const existingGsrn = "750300000000000004";
      prisma.patient.findFirst.mockResolvedValue({
        id: PATIENT_ID,
        organizationId: ORG_ID,
        gsrn: existingGsrn,
        mrn: "MRN-0042",
        firstName: "María",
        lastName: "Pérez",
        deletedAt: null,
      } as never);

      const caller = gsrnPulseraRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.reprint({ patientId: PATIENT_ID });

      // El GSRN no cambió.
      expect(result.gsrn).toBe(existingGsrn);
      // patient.update NO fue llamado (no reasignar).
      expect(prisma.patient.update).not.toHaveBeenCalled();
      expect(result.reprintedAt).toBeTruthy();
    });

    it("PRECONDITION_FAILED si el paciente no tiene GSRN", async () => {
      prisma.patient.findFirst.mockResolvedValue({
        id: PATIENT_ID,
        organizationId: ORG_ID,
        gsrn: null,
        mrn: "MRN-0042",
        firstName: "María",
        lastName: "Pérez",
        deletedAt: null,
      } as never);

      const caller = gsrnPulseraRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.reprint({ patientId: PATIENT_ID }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });
});
