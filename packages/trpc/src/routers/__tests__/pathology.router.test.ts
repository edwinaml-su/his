/**
 * Tests del pathologyRouter (§16 — Beta.17).
 *
 * Cubre:
 *  - Validaciones Zod y reglas de negocio (state machine, constraints).
 *  - Aislamiento cross-tenant: tenant B no puede ver/mutar registros de tenant A.
 *  - Constraint immutable post-sign: report.sign sobre un reporte ya FINAL → NOT_FOUND.
 *  - Emisión de eventos: pathology.reportSigned y pathology.criticalFinding.
 *  - HH-18: report.sign requiere PIN argon2id — rechaza PIN incorrecto con UNAUTHORIZED.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { pathologyRouter } from "../pathology.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN, MOCK_TENANT, MOCK_TENANT_OTHER_ORG } from "@his/test-utils";
import type { TenantContext } from "@his/contracts";

// Mock del módulo argon2 de @his/infrastructure para controlar verify en tests.
vi.mock("@his/infrastructure", () => ({
  argon2: {
    verify: vi.fn().mockResolvedValue(true), // PIN correcto por defecto
    hash: vi.fn().mockResolvedValue("$argon2id$mock"),
    argon2id: 2,
  },
}));

// UUIDs de fixtures
const ORG_A = MOCK_TENANT.organizationId;
const ORG_B = MOCK_TENANT_OTHER_ORG.organizationId;

/** Contexto para operaciones de patólogo (requiere rol PATHOLOGIST). */
const MOCK_TENANT_PATHOLOGIST: TenantContext = {
  ...MOCK_TENANT,
  roleCodes: [...MOCK_TENANT.roleCodes, "PATHOLOGIST"],
};

/** Contexto para técnico de laboratorio. */
const MOCK_TENANT_LAB_TECH: TenantContext = {
  ...MOCK_TENANT,
  roleCodes: [...MOCK_TENANT.roleCodes, "LAB_TECHNICIAN"],
};
const U1 = "00000000-0000-0000-0000-000000000001";
const U2 = "00000000-0000-0000-0000-000000000002";
const U3 = "00000000-0000-0000-0000-000000000003";
const REPORT_ID = "00000000-0000-0000-0000-000000000010";
const ORDER_ID  = "00000000-0000-0000-0000-000000000020";

/**
 * withTenantContext llama a prisma.$transaction internamente.
 * El mock debe delegar el callback al mismo prisma mock.
 */
function wireTransaction(prisma: DeepMockProxy<PrismaClient>): void {
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  // applyTenantContext usa $executeRawUnsafe (SET LOCAL / set_tenant_context)
  prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
}

/**
 * Stub de $queryRaw para simular personal_salud + firma_electronica válidos.
 * verifyPinOrThrow hace dos llamadas secuenciales: primero personal, luego firma.
 * El comportamiento real del PIN (correcto/incorrecto) lo controla el mock de argon2.
 */
function wireQueryRawForPin(
  prisma: DeepMockProxy<PrismaClient>,
  opts: { personalId?: string; pinHash?: string; failedAttempts?: number } = {},
): void {
  const personalId = opts.personalId ?? "00000000-0000-0000-0000-000000000099";
  const pinHash = opts.pinHash ?? "$argon2id$mock_hash";
  const failedAttempts = opts.failedAttempts ?? 0;

  let callCount = 0;
  prisma.$queryRaw.mockImplementation(async () => {
    callCount += 1;
    if (callCount === 1) {
      // Primera llamada: personal_salud
      return [{ id: personalId }];
    }
    // Segunda llamada: firma_electronica
    return [
      {
        id: "00000000-0000-0000-0000-000000000098",
        pin_hash: pinHash,
        failed_attempts: failedAttempts,
        locked_until: null,
      },
    ];
  });
  prisma.$executeRaw.mockResolvedValue(1 as never);
}

describe("pathologyRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    wireTransaction(prisma);
  });

  // ---------------------------------------------------------------------------
  // order.list
  // ---------------------------------------------------------------------------
  describe("order.list", () => {
    it("filtra por organizationId del tenant", async () => {
      prisma.pathologyOrder.findMany.mockResolvedValue([] as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma }));
      await caller.order.list({});
      const args = prisma.pathologyOrder.findMany.mock.calls[0]![0];
      expect(args!.where!.organizationId).toBe(ORG_A);
    });

    it("aplica filtro opcional por patientId", async () => {
      prisma.pathologyOrder.findMany.mockResolvedValue([] as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma }));
      await caller.order.list({ patientId: U1 });
      const args = prisma.pathologyOrder.findMany.mock.calls[0]![0];
      expect(args!.where!.patientId).toBe(U1);
    });
  });

  // ---------------------------------------------------------------------------
  // order.create
  // ---------------------------------------------------------------------------
  describe("order.create", () => {
    it("NOT_FOUND si el encounter no pertenece al tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: U1,
          patientId: U2,
          studyType: "BIOPSY",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si patientId no coincide con encounter.patientId", async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: U1,
        patientId: U3, // diferente del input U2
      } as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: U1,
          patientId: U2,
          studyType: "HISTOPATHOLOGY",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("crea orden con status=REQUESTED y requestingPhysicianId=ctx.user.id", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: U1, patientId: U2 } as never);
      prisma.pathologyOrder.create.mockResolvedValue({ id: ORDER_ID } as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma }));
      await caller.order.create({
        encounterId: U1,
        patientId: U2,
        studyType: "CYTOLOGY",
        priority: "URGENT",
      });
      const args = prisma.pathologyOrder.create.mock.calls[0]![0];
      expect(args.data.status).toBe("REQUESTED");
      expect(args.data.requestingPhysicianId).toBe(MOCK_USER_ADMIN.id);
      expect(args.data.priority).toBe("URGENT");
      expect(args.data.organizationId).toBe(ORG_A);
    });
  });

  // ---------------------------------------------------------------------------
  // order.cancel
  // ---------------------------------------------------------------------------
  describe("order.cancel", () => {
    it("NOT_FOUND si orden no existe en el tenant", async () => {
      prisma.pathologyOrder.findFirst.mockResolvedValue(null as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.cancel({ id: ORDER_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("BAD_REQUEST si la orden ya está REPORTED", async () => {
      prisma.pathologyOrder.findFirst.mockResolvedValue({
        id: ORDER_ID,
        status: "REPORTED",
      } as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.cancel({ id: ORDER_ID })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("cancela una orden en estado REQUESTING", async () => {
      prisma.pathologyOrder.findFirst.mockResolvedValue({
        id: ORDER_ID,
        status: "REQUESTED",
      } as never);
      prisma.pathologyOrder.update.mockResolvedValue({
        id: ORDER_ID,
        status: "CANCELLED",
      } as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma }));
      await caller.order.cancel({ id: ORDER_ID });
      const args = prisma.pathologyOrder.update.mock.calls[0]![0];
      expect(args.data.status).toBe("CANCELLED");
    });
  });

  // ---------------------------------------------------------------------------
  // specimen.receive
  // ---------------------------------------------------------------------------
  describe("specimen.receive", () => {
    it("NOT_FOUND si orden no existe en el tenant", async () => {
      prisma.pathologyOrder.findFirst.mockResolvedValue(null as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_LAB_TECH }));
      await expect(
        caller.specimen.receive({
          orderId: ORDER_ID,
          anatomicSite: "Colon sigmoides",
          fixative: "FORMALIN",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si la orden está CANCELLED", async () => {
      prisma.pathologyOrder.findFirst.mockResolvedValue({
        id: ORDER_ID,
        status: "CANCELLED",
      } as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_LAB_TECH }));
      await expect(
        caller.specimen.receive({
          orderId: ORDER_ID,
          anatomicSite: "Colon",
          fixative: "FRESH",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("crea espécimen con status=RECEIVED y receivedById=ctx.user.id", async () => {
      prisma.pathologyOrder.findFirst.mockResolvedValue({
        id: ORDER_ID,
        status: "REQUESTED",
      } as never);
      prisma.pathologySpecimen.create.mockResolvedValue({ id: U1 } as never);
      prisma.pathologyOrder.update.mockResolvedValue({} as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_LAB_TECH }));
      await caller.specimen.receive({
        orderId: ORDER_ID,
        anatomicSite: "Próstata",
        fixative: "FORMALIN",
        blockCount: 3,
        slideCount: 6,
      });
      const args = prisma.pathologySpecimen.create.mock.calls[0]![0];
      expect(args.data.status).toBe("RECEIVED");
      expect(args.data.receivedById).toBe(MOCK_USER_ADMIN.id);
      expect(args.data.blockCount).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // specimen.gross
  // ---------------------------------------------------------------------------
  describe("specimen.gross", () => {
    it("NOT_FOUND si espécimen no existe en el tenant", async () => {
      prisma.pathologySpecimen.findFirst.mockResolvedValue(null as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_PATHOLOGIST }));
      await expect(
        caller.specimen.gross({
          specimenId: U1,
          description: "Fragmento tisular",
          photoUrls: [],
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea descripción macroscópica con pathologistId del usuario", async () => {
      prisma.pathologySpecimen.findFirst.mockResolvedValue({
        id: U1,
        status: "RECEIVED",
      } as never);
      prisma.pathologyMacroDescription.create.mockResolvedValue({ id: U2 } as never);
      prisma.pathologySpecimen.update.mockResolvedValue({} as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_PATHOLOGIST }));
      await caller.specimen.gross({
        specimenId: U1,
        description: "Fragmento de 3x2 cm, pardo grisáceo",
        dimensions: "3x2x1.5 cm",
        photoUrls: ["https://storage.example.com/photo1.jpg"],
      });
      const args = prisma.pathologyMacroDescription.create.mock.calls[0]![0];
      expect(args.data.pathologistId).toBe(MOCK_USER_ADMIN.id);
      expect(args.data.specimenId).toBe(U1);
    });
  });

  // ---------------------------------------------------------------------------
  // specimen.micro
  // ---------------------------------------------------------------------------
  describe("specimen.micro", () => {
    it("NOT_FOUND si espécimen no existe en el tenant", async () => {
      prisma.pathologySpecimen.findFirst.mockResolvedValue(null as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_PATHOLOGIST }));
      await expect(
        caller.specimen.micro({
          specimenId: U1,
          description: "Descripción micro",
          stains: ["HE"],
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea descripción microscópica con las tinciones provistas", async () => {
      prisma.pathologySpecimen.findFirst.mockResolvedValue({
        id: U1,
        status: "GROSSING",
      } as never);
      prisma.pathologyMicroDescription.create.mockResolvedValue({ id: U3 } as never);
      prisma.pathologySpecimen.update.mockResolvedValue({} as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_PATHOLOGIST }));
      await caller.specimen.micro({
        specimenId: U1,
        description: "Células con atipias moderadas",
        stains: ["HE", "PAS", "IHQ-ER"],
      });
      const args = prisma.pathologyMicroDescription.create.mock.calls[0]![0];
      expect(args.data.stains).toEqual(["HE", "PAS", "IHQ-ER"]);
    });
  });

  // ---------------------------------------------------------------------------
  // report.draft
  // ---------------------------------------------------------------------------
  describe("report.draft", () => {
    it("NOT_FOUND si la orden no existe en el tenant", async () => {
      prisma.pathologyOrder.findFirst.mockResolvedValue(null as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_PATHOLOGIST }));
      await expect(
        caller.report.draft({
          orderId: ORDER_ID,
          primaryDiagnosis: "Adenocarcinoma tubular",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("CONFLICT si ya existe un reporte DRAFT para la misma orden", async () => {
      prisma.pathologyOrder.findFirst.mockResolvedValue({
        id: ORDER_ID,
        status: "IN_PROCESS",
      } as never);
      prisma.pathologyReport.findFirst.mockResolvedValue({ id: REPORT_ID } as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_PATHOLOGIST }));
      await expect(
        caller.report.draft({
          orderId: ORDER_ID,
          primaryDiagnosis: "Adenocarcinoma",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("crea reporte con status=DRAFT y criticalFinding=false por default", async () => {
      prisma.pathologyOrder.findFirst.mockResolvedValue({
        id: ORDER_ID,
        status: "IN_PROCESS",
      } as never);
      prisma.pathologyReport.findFirst.mockResolvedValue(null as never);
      prisma.pathologyReport.create.mockResolvedValue({ id: REPORT_ID } as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_PATHOLOGIST }));
      await caller.report.draft({
        orderId: ORDER_ID,
        primaryDiagnosis: "Carcinoma in situ",
      });
      const args = prisma.pathologyReport.create.mock.calls[0]![0];
      expect(args.data.status).toBe("DRAFT");
      expect(args.data.criticalFinding).toBe(false);
      expect(args.data.organizationId).toBe(ORG_A);
    });
  });

  // ---------------------------------------------------------------------------
  // report.sign — incluyendo inmutabilidad post-sign y emisión de eventos
  // ---------------------------------------------------------------------------
  describe("report.sign", () => {
    it("NOT_FOUND si el reporte no existe o ya está FINAL", async () => {
      // El query filtra status in [DRAFT, PRELIMINARY], si está FINAL no retorna nada.
      // verifyPinOrThrow corre primero — $queryRaw debe devolver personal y firma válidos.
      wireQueryRawForPin(prisma);
      prisma.pathologyReport.findFirst.mockResolvedValue(null as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_PATHOLOGIST }));
      await expect(
        caller.report.sign({ reportId: REPORT_ID, pin: "1234" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("firma el reporte: status → FINAL, signedAt seteado, orden → REPORTED", async () => {
      wireQueryRawForPin(prisma);
      prisma.pathologyReport.findFirst.mockResolvedValue({
        id: REPORT_ID,
        status: "DRAFT",
        orderId: ORDER_ID,
        criticalFinding: false,
        primaryDiagnosis: "Adenocarcinoma bien diferenciado",
        order: { id: ORDER_ID, requestingPhysicianId: U2, patientId: U3 },
      } as never);
      prisma.pathologyReport.update.mockResolvedValue({
        id: REPORT_ID,
        status: "FINAL",
        signedAt: new Date(),
        criticalFinding: false,
        orderId: ORDER_ID,
        primaryDiagnosis: "Adenocarcinoma bien diferenciado",
        organizationId: ORG_A,
      } as never);
      prisma.pathologyOrder.update.mockResolvedValue({} as never);
      prisma.domainEvent.create.mockResolvedValue({ id: U1 } as never);
      prisma.auditLog.create.mockResolvedValue({} as never);

      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_PATHOLOGIST }));
      await caller.report.sign({ reportId: REPORT_ID, pin: "1234" });

      const updateArgs = prisma.pathologyReport.update.mock.calls[0]![0];
      expect(updateArgs.data.status).toBe("FINAL");
      expect(updateArgs.data.signedAt).toBeInstanceOf(Date);

      const orderUpdateArgs = prisma.pathologyOrder.update.mock.calls[0]![0];
      expect(orderUpdateArgs.data.status).toBe("REPORTED");
    });

    it("emite pathology.reportSigned al firmar", async () => {
      wireQueryRawForPin(prisma);
      prisma.pathologyReport.findFirst.mockResolvedValue({
        id: REPORT_ID,
        status: "DRAFT",
        orderId: ORDER_ID,
        criticalFinding: false,
        primaryDiagnosis: "Carcinoma de células escamosas",
        order: { id: ORDER_ID, requestingPhysicianId: U2, patientId: U3 },
      } as never);
      prisma.pathologyReport.update.mockResolvedValue({
        id: REPORT_ID,
        status: "FINAL",
        signedAt: new Date(),
        criticalFinding: false,
        orderId: ORDER_ID,
        primaryDiagnosis: "Carcinoma de células escamosas",
        organizationId: ORG_A,
      } as never);
      prisma.pathologyOrder.update.mockResolvedValue({} as never);
      prisma.domainEvent.create.mockResolvedValue({ id: U1 } as never);
      prisma.auditLog.create.mockResolvedValue({} as never);

      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_PATHOLOGIST }));
      await caller.report.sign({ reportId: REPORT_ID, pin: "1234" });

      // Verifica que emitDomainEvent (implementado como domainEvent.create) fue llamado
      // con eventType pathology.reportSigned.
      const createCalls = prisma.domainEvent.create.mock.calls;
      const signedEvent = createCalls.find(
        (c) => c[0]?.data?.eventType === "pathology.reportSigned",
      );
      expect(signedEvent).toBeDefined();
      expect(signedEvent![0].data.payload.requestingPhysicianId).toBe(U2);
    });

    it("emite pathology.criticalFinding adicional cuando criticalFinding=true", async () => {
      wireQueryRawForPin(prisma);
      prisma.pathologyReport.findFirst.mockResolvedValue({
        id: REPORT_ID,
        status: "PRELIMINARY",
        orderId: ORDER_ID,
        criticalFinding: true,
        primaryDiagnosis: "Linfoma de Hodgkin",
        order: { id: ORDER_ID, requestingPhysicianId: U2, patientId: U3 },
      } as never);
      prisma.pathologyReport.update.mockResolvedValue({
        id: REPORT_ID,
        status: "FINAL",
        signedAt: new Date(),
        criticalFinding: true,
        orderId: ORDER_ID,
        primaryDiagnosis: "Linfoma de Hodgkin",
        organizationId: ORG_A,
      } as never);
      prisma.pathologyOrder.update.mockResolvedValue({} as never);
      prisma.domainEvent.create.mockResolvedValue({ id: U1 } as never);
      prisma.auditLog.create.mockResolvedValue({} as never);

      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_PATHOLOGIST }));
      await caller.report.sign({ reportId: REPORT_ID, pin: "1234", serviceHeadId: U3 });

      const createCalls = prisma.domainEvent.create.mock.calls;
      const criticalEvent = createCalls.find(
        (c) => c[0]?.data?.eventType === "pathology.criticalFinding",
      );
      expect(criticalEvent).toBeDefined();
      expect(criticalEvent![0].data.payload.serviceHeadId).toBe(U3);
      // También debe emitir reportSigned
      const signedEvent = createCalls.find(
        (c) => c[0]?.data?.eventType === "pathology.reportSigned",
      );
      expect(signedEvent).toBeDefined();
    });

    // HH-18 — PIN incorrecto → UNAUTHORIZED (no llega a buscar el reporte).
    it("HH-18: report.sign rechaza PIN incorrecto con UNAUTHORIZED", async () => {
      const { argon2: mockArgon2 } = await import("@his/infrastructure");
      vi.mocked(mockArgon2.verify).mockResolvedValueOnce(false);
      wireQueryRawForPin(prisma, { failedAttempts: 0 });

      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_PATHOLOGIST }));
      await expect(
        caller.report.sign({ reportId: REPORT_ID, pin: "9999" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      // El reporte NO debe haberse buscado — la verificación de PIN falla primero.
      expect(prisma.pathologyReport.findFirst).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // report.amend — ADR 0004: enmienda crea nueva fila, no modifica el FINAL
  // ---------------------------------------------------------------------------
  describe("report.amend", () => {
    it("NOT_FOUND si el reporte original no está en estado FINAL", async () => {
      prisma.pathologyReport.findFirst.mockResolvedValue(null as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_PATHOLOGIST }));
      await expect(
        caller.report.amend({
          originalReportId: REPORT_ID,
          amendmentReason: "Corrección diagnóstica",
          primaryDiagnosis: "Adenocarcinoma moderadamente diferenciado",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea nueva fila AMENDED sin modificar el original FINAL", async () => {
      prisma.pathologyReport.findFirst.mockResolvedValue({
        id: REPORT_ID,
        status: "FINAL",
        orderId: ORDER_ID,
        order: { requestingPhysicianId: U2 },
      } as never);
      prisma.pathologyReport.create.mockResolvedValue({
        id: U3,
        status: "AMENDED",
        amendedFromId: REPORT_ID,
      } as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT_PATHOLOGIST }));
      await caller.report.amend({
        originalReportId: REPORT_ID,
        amendmentReason: "Error en diagnóstico primario",
        primaryDiagnosis: "Carcinoma neuroendocrino bien diferenciado",
      });

      // El original NO debe haber recibido update
      expect(prisma.pathologyReport.update).not.toHaveBeenCalled();

      // Se creó nueva fila con amendedFromId
      const createArgs = prisma.pathologyReport.create.mock.calls[0]![0];
      expect(createArgs.data.status).toBe("AMENDED");
      expect(createArgs.data.amendedFromId).toBe(REPORT_ID);
      expect(createArgs.data.amendmentReason).toBe("Error en diagnóstico primario");
    });
  });

  // ---------------------------------------------------------------------------
  // report.get
  // ---------------------------------------------------------------------------
  describe("report.get", () => {
    it("NOT_FOUND si el reporte no existe en el tenant", async () => {
      prisma.pathologyReport.findFirst.mockResolvedValue(null as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.report.get({ id: REPORT_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("retorna el reporte con sus relaciones cuando existe", async () => {
      const mockReport = {
        id: REPORT_ID,
        status: "FINAL",
        organizationId: ORG_A,
        order: { id: ORDER_ID, specimens: [] },
        amendedFrom: null,
        amendments: [],
      };
      prisma.pathologyReport.findFirst.mockResolvedValue(mockReport as never);
      const caller = pathologyRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.report.get({ id: REPORT_ID });
      expect(result.id).toBe(REPORT_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // Aislamiento cross-tenant
  // ---------------------------------------------------------------------------
  describe("cross-tenant isolation", () => {
    it("order.list de OrgB no retorna órdenes de OrgA", async () => {
      prisma.pathologyOrder.findMany.mockResolvedValue([] as never);
      // Caller con tenant OrgB
      const caller = pathologyRouter.createCaller(
        makeCtx({ prisma, tenant: MOCK_TENANT_OTHER_ORG }),
      );
      await caller.order.list({});
      const args = prisma.pathologyOrder.findMany.mock.calls[0]![0];
      // El filtro debe usar organizationId de OrgB, no OrgA
      expect(args!.where!.organizationId).toBe(ORG_B);
      expect(args!.where!.organizationId).not.toBe(ORG_A);
    });

    it("report.get no puede leer un reporte de OrgA si el caller es OrgB", async () => {
      // findFirst devuelve null porque el filtro organizationId=OrgB no matchea un reporte de OrgA
      prisma.pathologyReport.findFirst.mockResolvedValue(null as never);
      const caller = pathologyRouter.createCaller(
        makeCtx({ prisma, tenant: MOCK_TENANT_OTHER_ORG }),
      );
      await expect(caller.report.get({ id: REPORT_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      const args = prisma.pathologyReport.findFirst.mock.calls[0]![0];
      expect(args!.where!.organizationId).toBe(ORG_B);
    });
  });

  // ---------------------------------------------------------------------------
  // Validaciones Zod — inputs inválidos rechazan antes de llegar al DB
  // ---------------------------------------------------------------------------
  describe("validaciones Zod", () => {
    it("order.create rechaza studyType inválido", async () => {
      const caller = pathologyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: U1,
          patientId: U2,
          // @ts-expect-error: valor inválido a propósito
          studyType: "INVALID_TYPE",
        }),
      ).rejects.toThrow();
    });

    it("specimen.receive rechaza fixative inválido", async () => {
      const caller = pathologyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.specimen.receive({
          orderId: ORDER_ID,
          anatomicSite: "Colon",
          // @ts-expect-error: valor inválido a propósito
          fixative: "ALCOHOL",
        }),
      ).rejects.toThrow();
    });

    it("specimen.micro requiere al menos 1 tinción", async () => {
      const caller = pathologyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.specimen.micro({
          specimenId: U1,
          description: "Desc",
          stains: [], // array vacío → falla z.array.min(1)
        }),
      ).rejects.toThrow();
    });

    it("report.amend requiere amendmentReason no vacío", async () => {
      const caller = pathologyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.report.amend({
          originalReportId: REPORT_ID,
          amendmentReason: "", // string vacío → falla z.string.min(1)
          primaryDiagnosis: "Diagnóstico",
        }),
      ).rejects.toThrow();
    });
  });
});
