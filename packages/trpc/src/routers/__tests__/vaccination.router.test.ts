/**
 * Tests del vaccination router (US-4.5 / US-7.3).
 *
 * Cubre:
 *  - listVaccines combina catálogo del país del tenant + globales (countryId IS NULL).
 *  - recordVaccination dispara alerta de alergia (BAD_REQUEST) sin override.
 *  - byPatient incluye `expected` calculado por expectedDosesFor (PAI_SCHEDULE_SV).
 *  - recordVaccination rechaza dosis duplicada (CONFLICT).
 *  - byPatient retorna NOT_FOUND si paciente no pertenece al tenant.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { vaccinationRouter } from "../vaccination.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

function fn<T>(returnValue: T) {
  return vi.fn().mockResolvedValue(returnValue);
}

describe("vaccinationRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("listVaccines", () => {
    it("sin filtro de país combina del tenant + globales (countryId NULL)", async () => {
      prisma.vaccine.findMany.mockResolvedValue([] as never);

      const caller = vaccinationRouter.createCaller(makeCtx({ prisma }));
      await caller.listVaccines({ activeOnly: true });

      const args = prisma.vaccine.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        OR: [{ countryId: MOCK_TENANT.countryId }, { countryId: null }],
        active: true,
      });
    });
  });

  describe("recordVaccination", () => {
    it("rechaza con BAD_REQUEST si paciente tiene alergia matching y no hay override", async () => {
      prisma.patient.findUnique = fn({
        id: "p1",
        organizationId: MOCK_TENANT.organizationId,
        allergies: [
          { id: "al1", substanceText: "huevo", severity: "MODERATE" },
        ],
      }) as never;
      prisma.vaccine.findUnique = fn({
        id: "v1",
        active: true,
        code: "INFLUENZA",
        name: "Influenza inactivada",
      }) as never;

      const caller = vaccinationRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.recordVaccination({
          patientId: "00000000-0000-0000-0000-000000000010",
          vaccineId: "00000000-0000-0000-0000-000000000020",
          doseNumber: 1,
          administeredAt: new Date("2026-05-01T10:00:00Z"),
          overrideAllergyAlert: false,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rechaza dosis duplicada (CONFLICT) por (patient, vaccine, doseNumber)", async () => {
      prisma.patient.findUnique = fn({
        id: "p1",
        organizationId: MOCK_TENANT.organizationId,
        allergies: [],
      }) as never;
      prisma.vaccine.findUnique = fn({
        id: "v1",
        active: true,
        code: "BCG",
        name: "BCG",
      }) as never;
      prisma.patientVaccination.findFirst = fn({ id: "pv-existing" }) as never;

      const caller = vaccinationRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.recordVaccination({
          patientId: "00000000-0000-0000-0000-000000000010",
          vaccineId: "00000000-0000-0000-0000-000000000020",
          doseNumber: 1,
          administeredAt: new Date("2026-05-01T10:00:00Z"),
          overrideAllergyAlert: false,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("retorna NOT_FOUND si paciente pertenece a otra org (tenant isolation)", async () => {
      prisma.patient.findUnique = fn({
        id: "p1",
        organizationId: "other-org",
        allergies: [],
      }) as never;
      prisma.vaccine.findUnique = fn({
        id: "v1",
        active: true,
        code: "BCG",
        name: "BCG",
      }) as never;

      const caller = vaccinationRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.recordVaccination({
          patientId: "00000000-0000-0000-0000-000000000010",
          vaccineId: "00000000-0000-0000-0000-000000000020",
          doseNumber: 1,
          administeredAt: new Date("2026-05-01T10:00:00Z"),
          overrideAllergyAlert: false,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("byPatient", () => {
    it("agrupa por vaccineId y calcula expected con expectedDosesFor (PAI_SCHEDULE_SV)", async () => {
      prisma.patient.findUnique = fn({
        id: "p1",
        organizationId: MOCK_TENANT.organizationId,
      }) as never;
      // 1 dosis aplicada de PENTAVALENTE (expected=3 por PAI_SCHEDULE_SV).
      prisma.patientVaccination.findMany.mockResolvedValue([
        {
          id: "pv1",
          vaccineId: "v-penta",
          doseNumber: 1,
          administeredAt: new Date("2026-04-01T10:00:00Z"),
          lotNumber: "L1",
          anatomicalSite: "left-anterolateral-thigh",
          expirationDate: null,
          reactionsObserved: null,
          notes: null,
          vaccine: {
            id: "v-penta",
            code: "PENTAVALENTE",
            name: "Pentavalente",
            routeOfAdmin: "IM",
            scheduleNote: null,
          },
        },
      ] as never);

      const caller = vaccinationRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.byPatient({
        patientId: "00000000-0000-0000-0000-000000000010",
      });

      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        code: "PENTAVALENTE",
        applied: 1,
        expected: 3,
        complete: false,
      });
    });

    it("retorna NOT_FOUND si paciente pertenece a otra org", async () => {
      prisma.patient.findUnique = fn({
        id: "p1",
        organizationId: "other-org",
      }) as never;

      const caller = vaccinationRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.byPatient({
          patientId: "00000000-0000-0000-0000-000000000099",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
