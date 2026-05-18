/**
 * Tests del consent router (templates, list, get, byPatient, create, revoke).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { consentRouter } from "../consent.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const PAT_ID = "00000000-0000-0000-0000-000000000041";
const CONSENT_ID = "00000000-0000-0000-0000-000000000042";
const USER_ID = "00000000-0000-0000-0000-000000000001";

const BASE_CONSENT = {
  id: CONSENT_ID,
  patientId: PAT_ID,
  purpose: "data-processing",
  signedAt: new Date("2025-01-01"),
  validTo: null,
  revokedAt: null,
  revokedById: null,
  revocationReason: null,
  templateVersion: 1,
  witnessedBy: null,
  notes: null,
  patient: {
    id: PAT_ID,
    organizationId: MOCK_TENANT.organizationId,
    mrn: "MRN-001",
    firstName: "Ana",
    lastName: "Garcia",
  },
  signedBy: { id: USER_ID, fullName: "QA Admin" },
};

describe("consentRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // ------------------------------------------------------------------ templates
  describe("templates", () => {
    it("retorna plantillas del pais del tenant cuando no se especifica iso", async () => {
      prisma.country.findUnique.mockResolvedValue({ isoAlpha3: "SLV" } as never);

      const caller = consentRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.templates({});

      expect(result.countryIso).toBe("SLV");
      expect(result.templates.length).toBeGreaterThan(0);
      expect(result.templates[0]).toHaveProperty("purpose");
      expect(result.templates[0]).toHaveProperty("title");
    });

    it("usa iso3 proporcionado directamente sin consultar BD", async () => {
      const caller = consentRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.templates({ countryIso: "SLV" });

      expect(prisma.country.findUnique).not.toHaveBeenCalled();
      expect(result.countryIso).toBe("SLV");
    });

    it("retorna lista vacia para pais sin plantillas configuradas", async () => {
      const caller = consentRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.templates({ countryIso: "ZZZ" });

      expect(result.templates).toHaveLength(0);
    });

    it("lanza NOT_FOUND si el pais del tenant no existe en BD", async () => {
      prisma.country.findUnique.mockResolvedValue(null as never);

      const caller = consentRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.templates({})).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ------------------------------------------------------------------ list
  describe("list", () => {
    it("lista consentimientos con status derivado", async () => {
      prisma.patientConsent.findMany.mockResolvedValue([BASE_CONSENT] as never);
      prisma.patientConsent.count.mockResolvedValue(1 as never);

      const caller = consentRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.list({ page: 1, pageSize: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].status).toBe("active");
      expect(result.total).toBe(1);
    });

    it("estado revoked cuando revokedAt no es null", async () => {
      const revoked = { ...BASE_CONSENT, revokedAt: new Date() };
      prisma.patientConsent.findMany.mockResolvedValue([revoked] as never);
      prisma.patientConsent.count.mockResolvedValue(1 as never);

      const caller = consentRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.list({ page: 1, pageSize: 20 });

      expect(result.items[0].status).toBe("revoked");
    });

    it("estado expired cuando validTo < ahora", async () => {
      const expired = { ...BASE_CONSENT, validTo: new Date("2020-01-01") };
      prisma.patientConsent.findMany.mockResolvedValue([expired] as never);
      prisma.patientConsent.count.mockResolvedValue(1 as never);

      const caller = consentRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.list({ page: 1, pageSize: 20 });

      expect(result.items[0].status).toBe("expired");
    });

    it("filtra por patientId cuando se provee", async () => {
      prisma.patientConsent.findMany.mockResolvedValue([] as never);
      prisma.patientConsent.count.mockResolvedValue(0 as never);

      const caller = consentRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ patientId: PAT_ID, page: 1, pageSize: 20 });

      const callArg = prisma.patientConsent.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(callArg.where).toMatchObject({ patientId: PAT_ID });
    });
  });

  // ------------------------------------------------------------------ get
  describe("get", () => {
    it("retorna el consentimiento con status derivado", async () => {
      prisma.patientConsent.findUnique.mockResolvedValue(BASE_CONSENT as never);

      const caller = consentRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.get({ id: CONSENT_ID });

      expect(result.id).toBe(CONSENT_ID);
      expect(result.status).toBe("active");
    });

    it("lanza NOT_FOUND si el registro no existe", async () => {
      prisma.patientConsent.findUnique.mockResolvedValue(null as never);

      const caller = consentRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.get({ id: CONSENT_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lanza NOT_FOUND si el paciente pertenece a otra org", async () => {
      const wrongOrg = {
        ...BASE_CONSENT,
        patient: { ...BASE_CONSENT.patient, organizationId: "other-org" },
      };
      prisma.patientConsent.findUnique.mockResolvedValue(wrongOrg as never);

      const caller = consentRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.get({ id: CONSENT_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ------------------------------------------------------------------ byPatient
  describe("byPatient", () => {
    it("lanza NOT_FOUND si el paciente no existe", async () => {
      prisma.patient.findUnique.mockResolvedValue(null as never);

      const caller = consentRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.byPatient({ patientId: PAT_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lanza NOT_FOUND si el paciente es de otra org", async () => {
      prisma.patient.findUnique.mockResolvedValue({
        id: PAT_ID,
        organizationId: "other-org",
      } as never);

      const caller = consentRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.byPatient({ patientId: PAT_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
