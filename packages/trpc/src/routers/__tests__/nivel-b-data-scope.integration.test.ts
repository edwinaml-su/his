/**
 * nivel-b-data-scope.integration.test.ts
 *
 * Integration tests de Nivel B: acoplan helper (service-unit-scope) +
 * router + prisma mock. Verifican que el `where` que llega al mock de
 * Prisma refleje correctamente el scope del tenant, no solo el output.
 *
 * Suites:
 *   1. bedRouter.list             — campo directo, required
 *   2. encounterRouter.listOpenByOrg — campo directo, nullable (OR)
 *   3. triageRouter.listPending   — campo directo via encounter, nullable (OR)
 *   4. emergencyRouter.visit.list — relacion encounter, nullable (OR)
 *   5. inpatientRouter.admission.list — relacion encounter, nullable (OR)
 *
 * Cada suite cubre:
 *   - cross-service tenant → no aplica filtro de serviceUnit
 *   - scoped tenant        → filtro IN restringido
 *   - sin asignaciones     → backward compat, no aplica filtro
 *   - escenario adicional especifico de cada router
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { bedRouter } from "../bed.router";
import { encounterRouter } from "../encounter.router";
import { triageRouter } from "../triage.router";
import { emergencyRouter } from "../emergency.router";
import { inpatientRouter } from "../inpatient.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import type { TenantContext } from "@his/contracts";

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------
const ORG_ID = "00000000-0000-0000-0000-0000000000aa";
const ER_ID = "00000000-0000-0000-0000-000000000e01";
const UCIN_ID = "00000000-0000-0000-0000-000000000e02";
const QX_ID = "00000000-0000-0000-0000-000000000e03";

// ---------------------------------------------------------------------------
// Helpers de tenant
// ---------------------------------------------------------------------------
function crossServiceTenant(): TenantContext {
  return {
    userId: "00000000-0000-0000-0000-000000000001",
    countryId: "00000000-0000-0000-0000-0000000000bb",
    organizationId: ORG_ID,
    establishmentId: "00000000-0000-0000-0000-0000000000cc",
    roleCodes: ["ADMIN"],
    assignedServiceUnitIds: [],
    assignedServiceUnitCodes: [],
    isCrossServiceRole: true,
  };
}

function scopedTenant(ids: string[]): TenantContext {
  return {
    userId: "00000000-0000-0000-0000-000000000002",
    countryId: "00000000-0000-0000-0000-0000000000bb",
    organizationId: ORG_ID,
    establishmentId: "00000000-0000-0000-0000-0000000000cc",
    roleCodes: ["NURSE"],
    assignedServiceUnitIds: ids,
    assignedServiceUnitCodes: [],
    isCrossServiceRole: false,
  };
}

function noAssignmentsTenant(): TenantContext {
  return {
    userId: "00000000-0000-0000-0000-000000000003",
    countryId: "00000000-0000-0000-0000-0000000000bb",
    organizationId: ORG_ID,
    establishmentId: "00000000-0000-0000-0000-0000000000cc",
    roleCodes: ["NURSE"],
    assignedServiceUnitIds: [],
    assignedServiceUnitCodes: [],
    isCrossServiceRole: false,
  };
}

// ---------------------------------------------------------------------------
// Suite 1: bedRouter.list — campo directo, required
// ---------------------------------------------------------------------------
describe("Suite 1: bedRouter.list — Nivel B scope (campo directo, required)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.bed.findMany.mockResolvedValue([] as never);
  });

  it("cross-service tenant: where SIN filtro de serviceUnitId", async () => {
    const caller = bedRouter.createCaller(makeCtx({ prisma, tenant: crossServiceTenant() }));
    await caller.list({});
    const where = prisma.bed.findMany.mock.calls[0]![0].where;
    // El helper devuelve {} → no se agrega serviceUnitId al where
    expect(where).not.toHaveProperty("serviceUnitId");
    expect(where).not.toHaveProperty("OR");
  });

  it("scoped tenant [ER]: where con serviceUnitId: { in: [ER] }", async () => {
    const caller = bedRouter.createCaller(makeCtx({ prisma, tenant: scopedTenant([ER_ID]) }));
    await caller.list({});
    const where = prisma.bed.findMany.mock.calls[0]![0].where;
    expect(where.serviceUnitId).toEqual({ in: [ER_ID] });
  });

  it("tenant sin asignaciones: where SIN filtro (backward compat)", async () => {
    const caller = bedRouter.createCaller(makeCtx({ prisma, tenant: noAssignmentsTenant() }));
    await caller.list({});
    const where = prisma.bed.findMany.mock.calls[0]![0].where;
    expect(where).not.toHaveProperty("serviceUnitId");
    expect(where).not.toHaveProperty("OR");
  });

  it("input.serviceUnitId dentro de scope: filtra por ese ID exacto (no IN)", async () => {
    const caller = bedRouter.createCaller(makeCtx({ prisma, tenant: scopedTenant([ER_ID]) }));
    await caller.list({ serviceUnitId: ER_ID });
    const where = prisma.bed.findMany.mock.calls[0]![0].where;
    // Cuando input.serviceUnitId llega, el router usa { serviceUnitId: input.serviceUnitId }
    expect(where.serviceUnitId).toBe(ER_ID);
  });

  it("input.serviceUnitId FUERA de scope: lanza FORBIDDEN", async () => {
    const caller = bedRouter.createCaller(makeCtx({ prisma, tenant: scopedTenant([ER_ID]) }));
    await expect(
      caller.list({ serviceUnitId: QX_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.bed.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: encounterRouter.listOpenByOrg — campo directo, nullable (OR)
// ---------------------------------------------------------------------------
describe("Suite 2: encounterRouter.listOpenByOrg — Nivel B scope (campo nullable, OR)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.encounter.findMany.mockResolvedValue([] as never);
    prisma.encounter.count.mockResolvedValue(0 as never);
  });

  it("cross-service tenant: where SIN filtro de serviceUnitId ni OR", async () => {
    const caller = encounterRouter.createCaller(makeCtx({ prisma, tenant: crossServiceTenant() }));
    await caller.listOpenByOrg({});
    const where = prisma.encounter.findMany.mock.calls[0]![0].where;
    expect(where).not.toHaveProperty("serviceUnitId");
    expect(where).not.toHaveProperty("OR");
  });

  it("scoped tenant [ER]: where con OR [serviceUnitId IN + null] (includeNullable=true)", async () => {
    const caller = encounterRouter.createCaller(makeCtx({ prisma, tenant: scopedTenant([ER_ID]) }));
    await caller.listOpenByOrg({});
    const where = prisma.encounter.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([
      { serviceUnitId: { in: [ER_ID] } },
      { serviceUnitId: null },
    ]);
  });

  it("tenant sin asignaciones: where SIN filtro (backward compat)", async () => {
    const caller = encounterRouter.createCaller(
      makeCtx({ prisma, tenant: noAssignmentsTenant() }),
    );
    await caller.listOpenByOrg({});
    const where = prisma.encounter.findMany.mock.calls[0]![0].where;
    expect(where).not.toHaveProperty("OR");
    expect(where).not.toHaveProperty("serviceUnitId");
  });

  it("input.serviceUnitId FUERA de scope: lanza FORBIDDEN", async () => {
    const caller = encounterRouter.createCaller(
      makeCtx({ prisma, tenant: scopedTenant([ER_ID]) }),
    );
    await expect(
      caller.listOpenByOrg({ serviceUnitId: QX_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.encounter.findMany).not.toHaveBeenCalled();
  });

  it("scoped tenant multiples IDs: OR contiene IN con todos los IDs asignados", async () => {
    const caller = encounterRouter.createCaller(
      makeCtx({ prisma, tenant: scopedTenant([ER_ID, UCIN_ID]) }),
    );
    await caller.listOpenByOrg({});
    const where = prisma.encounter.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([
      { serviceUnitId: { in: [ER_ID, UCIN_ID] } },
      { serviceUnitId: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: triageRouter.listPending — campo directo via encounter, nullable
// ---------------------------------------------------------------------------
describe("Suite 3: triageRouter.listPending — Nivel B scope (nullable, OR)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // El router hace un sweep de expiry IN_PROGRESS antes del findMany
    prisma.triageEvaluation.updateMany.mockResolvedValue({ count: 0 } as never);
    prisma.encounter.findMany.mockResolvedValue([] as never);
  });

  it("cross-service tenant: where SIN filtro de serviceUnitId ni OR", async () => {
    const caller = triageRouter.createCaller(makeCtx({ prisma, tenant: crossServiceTenant() }));
    await caller.listPending();
    const where = prisma.encounter.findMany.mock.calls[0]![0].where;
    expect(where).not.toHaveProperty("OR");
    expect(where).not.toHaveProperty("serviceUnitId");
  });

  it("scoped tenant [ER]: where con OR [serviceUnitId IN + null]", async () => {
    const caller = triageRouter.createCaller(makeCtx({ prisma, tenant: scopedTenant([ER_ID]) }));
    await caller.listPending();
    const where = prisma.encounter.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([
      { serviceUnitId: { in: [ER_ID] } },
      { serviceUnitId: null },
    ]);
  });

  it("tenant sin asignaciones: where SIN filtro (backward compat)", async () => {
    const caller = triageRouter.createCaller(
      makeCtx({ prisma, tenant: noAssignmentsTenant() }),
    );
    await caller.listPending();
    const where = prisma.encounter.findMany.mock.calls[0]![0].where;
    expect(where).not.toHaveProperty("OR");
    expect(where).not.toHaveProperty("serviceUnitId");
  });

  it("el sweep de expiry siempre se ejecuta (organizationId + status IN_PROGRESS)", async () => {
    const caller = triageRouter.createCaller(makeCtx({ prisma, tenant: crossServiceTenant() }));
    await caller.listPending();
    expect(prisma.triageEvaluation.updateMany).toHaveBeenCalledOnce();
    const sweepWhere = prisma.triageEvaluation.updateMany.mock.calls[0]![0].where;
    expect(sweepWhere).toMatchObject({
      organizationId: ORG_ID,
      status: "IN_PROGRESS",
    });
  });
});

// ---------------------------------------------------------------------------
// Suite 4: emergencyRouter.visit.list — relacion encounter
// ---------------------------------------------------------------------------
describe("Suite 4: emergencyRouter.visit.list — Nivel B scope (via relacion encounter)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.emergencyVisit.findMany.mockResolvedValue([] as never);
  });

  it("cross-service tenant: where SIN propiedad encounter (sin filtro de scope)", async () => {
    const caller = emergencyRouter.createCaller(
      makeCtx({ prisma, tenant: crossServiceTenant() }),
    );
    await caller.visit.list({});
    const where = prisma.emergencyVisit.findMany.mock.calls[0]![0].where;
    expect(where).not.toHaveProperty("encounter");
  });

  it("scoped tenant [ER]: where.encounter.OR con serviceUnitId IN + null", async () => {
    const caller = emergencyRouter.createCaller(
      makeCtx({ prisma, tenant: scopedTenant([ER_ID]) }),
    );
    await caller.visit.list({});
    const where = prisma.emergencyVisit.findMany.mock.calls[0]![0].where;
    expect(where.encounter).toEqual({
      OR: [
        { serviceUnitId: { in: [ER_ID] } },
        { serviceUnitId: null },
      ],
    });
  });

  it("tenant sin asignaciones: where SIN encounter (backward compat)", async () => {
    const caller = emergencyRouter.createCaller(
      makeCtx({ prisma, tenant: noAssignmentsTenant() }),
    );
    await caller.visit.list({});
    const where = prisma.emergencyVisit.findMany.mock.calls[0]![0].where;
    expect(where).not.toHaveProperty("encounter");
  });

  it("scoped tenant multiples IDs: OR contiene todos los IDs asignados", async () => {
    const caller = emergencyRouter.createCaller(
      makeCtx({ prisma, tenant: scopedTenant([ER_ID, UCIN_ID]) }),
    );
    await caller.visit.list({});
    const where = prisma.emergencyVisit.findMany.mock.calls[0]![0].where;
    expect(where.encounter).toEqual({
      OR: [
        { serviceUnitId: { in: [ER_ID, UCIN_ID] } },
        { serviceUnitId: null },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Suite 5: inpatientRouter.admission.list — relacion encounter
// ---------------------------------------------------------------------------
describe("Suite 5: inpatientRouter.admission.list — Nivel B scope (via relacion encounter)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.inpatientAdmission.findMany.mockResolvedValue([] as never);
  });

  it("cross-service tenant: where SIN propiedad encounter (sin filtro de scope)", async () => {
    const caller = inpatientRouter.createCaller(
      makeCtx({ prisma, tenant: crossServiceTenant() }),
    );
    await caller.admission.list({});
    const where = prisma.inpatientAdmission.findMany.mock.calls[0]![0].where;
    expect(where).not.toHaveProperty("encounter");
  });

  it("scoped tenant [UCIN]: where.encounter.OR con serviceUnitId IN + null", async () => {
    const caller = inpatientRouter.createCaller(
      makeCtx({ prisma, tenant: scopedTenant([UCIN_ID]) }),
    );
    await caller.admission.list({});
    const where = prisma.inpatientAdmission.findMany.mock.calls[0]![0].where;
    expect(where.encounter).toEqual({
      OR: [
        { serviceUnitId: { in: [UCIN_ID] } },
        { serviceUnitId: null },
      ],
    });
  });

  it("tenant sin asignaciones: where SIN encounter (backward compat)", async () => {
    const caller = inpatientRouter.createCaller(
      makeCtx({ prisma, tenant: noAssignmentsTenant() }),
    );
    await caller.admission.list({});
    const where = prisma.inpatientAdmission.findMany.mock.calls[0]![0].where;
    expect(where).not.toHaveProperty("encounter");
  });

  it("scoped tenant multiples IDs: OR contiene todos los IDs", async () => {
    const caller = inpatientRouter.createCaller(
      makeCtx({ prisma, tenant: scopedTenant([UCIN_ID, QX_ID]) }),
    );
    await caller.admission.list({});
    const where = prisma.inpatientAdmission.findMany.mock.calls[0]![0].where;
    expect(where.encounter).toEqual({
      OR: [
        { serviceUnitId: { in: [UCIN_ID, QX_ID] } },
        { serviceUnitId: null },
      ],
    });
  });
});
