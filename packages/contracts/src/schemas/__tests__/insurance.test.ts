/**
 * Tests del schema §25 Insurance (Wave 8 / Beta.14 hardening layer 1).
 *
 * Cambios b14:
 *   - PENDING en authorizationStatusEnum.
 *   - coveredProcedures en insurancePlanCreateInput.
 *   - checkCoverageInput / getExpiringAuthorizationsInput.
 *   - authorizationApproveInput: validUntil alias.
 */
import { describe, it, expect } from "vitest";
import {
  insurerKindEnum,
  authorizationStatusEnum,
  insurerCreateInput,
  insurerListInput,
  insurancePlanCreateInput,
  insurancePlanListInput,
  patientCoverageCreateInput,
  patientCoverageListInput,
  patientCoverageDeactivateInput,
  authorizationRequestCreateInput,
  authorizationRequestListInput,
  authorizationApproveInput,
  authorizationDenyInput,
  coveredProcedureEntry,
  checkCoverageInput,
  getExpiringAuthorizationsInput,
} from "../insurance";

const u = "00000000-0000-0000-0000-000000000001";
const from = new Date("2026-01-01");
const to = new Date("2027-01-01");

describe("insurerKindEnum / authorizationStatusEnum", () => {
  it.each(["PUBLIC", "PRIVATE", "SELF_INSURED"])("kind %s válido", (k) =>
    expect(insurerKindEnum.safeParse(k).success).toBe(true),
  );
  it("kind FOO inválido", () =>
    expect(insurerKindEnum.safeParse("FOO").success).toBe(false));

  it.each(["PENDING", "REQUESTED", "APPROVED", "PARTIAL", "DENIED", "EXPIRED", "CANCELLED"])(
    "auth status %s válido",
    (s) => expect(authorizationStatusEnum.safeParse(s).success).toBe(true),
  );
  it("b14: PENDING es estado válido", () =>
    expect(authorizationStatusEnum.safeParse("PENDING").success).toBe(true));
  it("auth status XYZ inválido", () =>
    expect(authorizationStatusEnum.safeParse("XYZ").success).toBe(false));
});

describe("insurerCreateInput", () => {
  it("acepta input mínimo", () =>
    expect(
      insurerCreateInput.safeParse({ code: "ISSS", name: "Instituto Salvadoreño" }).success,
    ).toBe(true));

  it("acepta organizationId null (catálogo global)", () =>
    expect(
      insurerCreateInput.safeParse({
        organizationId: null,
        code: "FOSALUD",
        name: "FOSALUD",
        kind: "PUBLIC",
      }).success,
    ).toBe(true));

  it("rechaza code vacío", () =>
    expect(insurerCreateInput.safeParse({ code: "", name: "x" }).success).toBe(false));

  it("rechaza email inválido", () =>
    expect(
      insurerCreateInput.safeParse({
        code: "X",
        name: "X",
        contactEmail: "no-es-email",
      }).success,
    ).toBe(false));

  it("kind default = PRIVATE", () => {
    const r = insurerCreateInput.safeParse({ code: "X", name: "X" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kind).toBe("PRIVATE");
  });
});

describe("insurerListInput", () => {
  it("activeOnly default true", () => {
    const r = insurerListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.activeOnly).toBe(true);
  });

  it("limit default 50", () => {
    const r = insurerListInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("rechaza limit > 200", () =>
    expect(insurerListInput.safeParse({ limit: 999 }).success).toBe(false));
});

describe("coveredProcedureEntry (b14)", () => {
  it("acepta entry mínimo con code", () =>
    expect(coveredProcedureEntry.safeParse({ code: "MRI" }).success).toBe(true));

  it("acepta entry con maxCoverage y description", () =>
    expect(
      coveredProcedureEntry.safeParse({
        code: "CT-SCAN",
        maxCoverage: 800,
        description: "TAC sin contraste",
      }).success,
    ).toBe(true));

  it("rechaza code vacío", () =>
    expect(coveredProcedureEntry.safeParse({ code: "" }).success).toBe(false));

  it("rechaza maxCoverage negativo", () =>
    expect(
      coveredProcedureEntry.safeParse({ code: "X", maxCoverage: -1 }).success,
    ).toBe(false));
});

describe("insurancePlanCreateInput / listInput", () => {
  it("acepta plan válido", () =>
    expect(
      insurancePlanCreateInput.safeParse({
        insurerId: u,
        code: "PLAN-A",
        name: "Plan A",
        copayPct: 20,
      }).success,
    ).toBe(true));

  it("b14: acepta plan con coveredProcedures", () =>
    expect(
      insurancePlanCreateInput.safeParse({
        insurerId: u,
        code: "PLAN-B",
        name: "Plan B",
        coveredProcedures: [
          { code: "MRI", maxCoverage: 1500 },
          { code: "LAB-CBC" },
        ],
      }).success,
    ).toBe(true));

  it("b14: rechaza procedimiento con code vacío en coveredProcedures", () =>
    expect(
      insurancePlanCreateInput.safeParse({
        insurerId: u,
        code: "PLAN-C",
        name: "Plan C",
        coveredProcedures: [{ code: "" }],
      }).success,
    ).toBe(false));

  it("rechaza copay > 100", () =>
    expect(
      insurancePlanCreateInput.safeParse({
        insurerId: u,
        code: "X",
        name: "X",
        copayPct: 150,
      }).success,
    ).toBe(false));

  it("rechaza copay negativo", () =>
    expect(
      insurancePlanCreateInput.safeParse({
        insurerId: u,
        code: "X",
        name: "X",
        copayPct: -5,
      }).success,
    ).toBe(false));

  it("list permite filtrar por insurerId", () =>
    expect(insurancePlanListInput.safeParse({ insurerId: u }).success).toBe(true));
});

describe("patientCoverageCreateInput", () => {
  it("acepta cobertura válida sin validTo", () =>
    expect(
      patientCoverageCreateInput.safeParse({
        patientId: u,
        planId: u,
        policyNumber: "POL-123",
        validFrom: from,
      }).success,
    ).toBe(true));

  it("rechaza validTo <= validFrom", () =>
    expect(
      patientCoverageCreateInput.safeParse({
        patientId: u,
        planId: u,
        policyNumber: "POL-123",
        validFrom: to,
        validTo: from,
      }).success,
    ).toBe(false));

  it("acepta validTo posterior", () =>
    expect(
      patientCoverageCreateInput.safeParse({
        patientId: u,
        planId: u,
        policyNumber: "POL-456",
        validFrom: from,
        validTo: to,
      }).success,
    ).toBe(true));

  it("rechaza policyNumber vacío", () =>
    expect(
      patientCoverageCreateInput.safeParse({
        patientId: u,
        planId: u,
        policyNumber: "",
        validFrom: from,
      }).success,
    ).toBe(false));

  it("deactivate requiere uuid", () =>
    expect(patientCoverageDeactivateInput.safeParse({ id: "abc" }).success).toBe(false));

  it("list default activeOnly=true", () => {
    const r = patientCoverageListInput.safeParse({});
    if (r.success) expect(r.data.activeOnly).toBe(true);
  });
});

describe("authorizationRequest", () => {
  it("create acepta input mínimo", () =>
    expect(
      authorizationRequestCreateInput.safeParse({
        coverageId: u,
        serviceCode: "MRI",
        serviceDesc: "Resonancia magnética cerebral",
      }).success,
    ).toBe(true));

  it("create rechaza serviceCode vacío", () =>
    expect(
      authorizationRequestCreateInput.safeParse({
        coverageId: u,
        serviceCode: "",
        serviceDesc: "x",
      }).success,
    ).toBe(false));

  it("list default limit=50", () => {
    const r = authorizationRequestListInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("approve acepta amount + externalRef", () =>
    expect(
      authorizationApproveInput.safeParse({
        id: u,
        externalRef: "AUTH-9876",
        approvedAmount: 500,
        validUntil: to,
      }).success,
    ).toBe(true));

  it("b14: approve acepta validUntil como alias de validTo", () => {
    const r = authorizationApproveInput.safeParse({
      id: u,
      externalRef: "X",
      validFrom: from,
      validUntil: to,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.validUntil).toEqual(to);
  });

  it("approve rechaza validUntil <= validFrom", () =>
    expect(
      authorizationApproveInput.safeParse({
        id: u,
        externalRef: "X",
        validFrom: to,
        validUntil: from,
      }).success,
    ).toBe(false));

  it("approve rechaza validTo <= validFrom (backward compat field)", () =>
    expect(
      authorizationApproveInput.safeParse({
        id: u,
        externalRef: "X",
        validFrom: to,
        validTo: from,
      }).success,
    ).toBe(false));

  it("approve partial flag default false", () => {
    const r = authorizationApproveInput.safeParse({ id: u, externalRef: "X" });
    if (r.success) expect(r.data.partial).toBe(false);
  });

  it("deny requiere reason no vacío", () =>
    expect(
      authorizationDenyInput.safeParse({ id: u, denialReason: "" }).success,
    ).toBe(false));

  it("deny acepta razón válida", () =>
    expect(
      authorizationDenyInput.safeParse({
        id: u,
        denialReason: "Servicio no cubierto por póliza.",
      }).success,
    ).toBe(true));
});

describe("b14: checkCoverageInput", () => {
  it("acepta planId uuid + procedureCode", () =>
    expect(
      checkCoverageInput.safeParse({ planId: u, procedureCode: "MRI" }).success,
    ).toBe(true));

  it("rechaza planId no-uuid", () =>
    expect(
      checkCoverageInput.safeParse({ planId: "bad", procedureCode: "MRI" }).success,
    ).toBe(false));

  it("rechaza procedureCode vacío", () =>
    expect(
      checkCoverageInput.safeParse({ planId: u, procedureCode: "" }).success,
    ).toBe(false));
});

describe("b14: getExpiringAuthorizationsInput", () => {
  it("daysAhead default 7", () => {
    const r = getExpiringAuthorizationsInput.safeParse({});
    if (r.success) expect(r.data.daysAhead).toBe(7);
  });

  it("acepta daysAhead=30", () =>
    expect(
      getExpiringAuthorizationsInput.safeParse({ daysAhead: 30 }).success,
    ).toBe(true));

  it("rechaza daysAhead > 90", () =>
    expect(
      getExpiringAuthorizationsInput.safeParse({ daysAhead: 91 }).success,
    ).toBe(false));

  it("rechaza daysAhead < 1", () =>
    expect(
      getExpiringAuthorizationsInput.safeParse({ daysAhead: 0 }).success,
    ).toBe(false));
});
