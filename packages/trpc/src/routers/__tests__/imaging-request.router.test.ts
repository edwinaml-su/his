/**
 * CC-0016 — Tests del imagingRequestRouter (solicitud de radiología e
 * imágenes: cabecera ImagingRequest + N ImagingOrder hijas, catálogo,
 * parametrización de campos/reglas).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { imagingRequestRouter } from "../imaging-request.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_TENANT_NO_ESTABLISHMENT } from "@his/test-utils";

const u = "00000000-0000-0000-0000-000000000001";
const cuentaId = "00000000-0000-0000-0000-000000000010";
const patientId = "00000000-0000-0000-0000-000000000011";
const labTestId = "00000000-0000-0000-0000-000000000012";
const panelId = "00000000-0000-0000-0000-000000000013";

const TENANT_NO_ADMIN = { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] };

function wireTransaction(prisma: DeepMockProxy<PrismaClient>): void {
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
}

const CUENTA_ROW = { id: cuentaId, patientId, encounterId: null };
const TEST_ROW = {
  id: labTestId,
  name: "RX TORAX",
  imagingAttrs: {
    labTestId,
    requiereContraste: false,
    requiereAyuno: false,
    requiereAutorizacion: false,
    duracionMin: 15,
    modalityType: "CR",
    modalityId: null,
    preparacionPaciente: null,
  },
};

describe("imagingRequestRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    wireTransaction(prisma);
  });

  // ---------------------------------------------------------------------------
  // crear
  // ---------------------------------------------------------------------------
  describe("crear", () => {
    function stubHappyPath() {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([] as never);
      prisma.imagingModuleRule.findMany.mockResolvedValue([] as never);
      prisma.labTest.findMany.mockResolvedValue([TEST_ROW] as never);
      prisma.imagingOrder.findMany.mockResolvedValue([] as never);
      prisma.$queryRaw.mockResolvedValue([{ n: 7 }] as never);
      prisma.imagingRequest.create.mockResolvedValue({ id: u } as never);
      prisma.costCenter.findFirst.mockResolvedValue(null as never);
      prisma.imagingOrder.create.mockResolvedValue({ id: "order-1" } as never);
    }

    const validInput = {
      cuentaId,
      prestaciones: [{ labTestId }],
      dx: "M54.5",
      justificacion: "lumbalgia",
      prioridad: "ROUTINE" as const,
    };

    it("FORBIDDEN si no hay establecimiento seleccionado", async () => {
      const caller = imagingRequestRouter.createCaller(
        makeCtx({ prisma, tenant: MOCK_TENANT_NO_ESTABLISHMENT }),
      );
      await expect(caller.crear(validInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("NOT_FOUND si la cuenta no existe", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(null as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.crear(validInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si falta un campo obligatorio por defecto (dx)", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([] as never);
      prisma.imagingModuleRule.findMany.mockResolvedValue([] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.crear({
          cuentaId,
          prestaciones: [{ labTestId }],
          justificacion: "lumbalgia",
          prioridad: "ROUTINE",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("respeta la parametrización: dx opcional deja pasar sin dx", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([
        { fieldKey: "dx", estado: "opcional" },
      ] as never);
      prisma.imagingModuleRule.findMany.mockResolvedValue([] as never);
      prisma.labTest.findMany.mockResolvedValue([TEST_ROW] as never);
      prisma.imagingOrder.findMany.mockResolvedValue([] as never);
      prisma.$queryRaw.mockResolvedValue([{ n: 1 }] as never);
      prisma.imagingRequest.create.mockResolvedValue({ id: u } as never);
      prisma.costCenter.findFirst.mockResolvedValue(null as never);
      prisma.imagingOrder.create.mockResolvedValue({ id: "order-1" } as never);

      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.crear({
        cuentaId,
        prestaciones: [{ labTestId }],
        justificacion: "lumbalgia",
        prioridad: "ROUTINE",
      });
      expect(result.folio).toMatch(/^SOL-\d{4}-0001$/);
    });

    it("BAD_REQUEST si supera la regla maxN", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([] as never);
      prisma.imagingModuleRule.findMany.mockResolvedValue([
        { ruleKey: "maxN", enabled: true, valorNum: 1 },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.crear({ ...validInput, prestaciones: [{ labTestId }, { labTestId }] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("NOT_FOUND si una prestación no existe en el catálogo", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([] as never);
      prisma.imagingModuleRule.findMany.mockResolvedValue([] as never);
      prisma.labTest.findMany.mockResolvedValue([] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.crear(validInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST: contraste requiere creatinina cuando el campo no está oculto", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([] as never);
      prisma.imagingModuleRule.findMany.mockResolvedValue([] as never);
      prisma.labTest.findMany.mockResolvedValue([
        { ...TEST_ROW, imagingAttrs: { ...TEST_ROW.imagingAttrs, requiereContraste: true } },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.crear(validInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("OK: contraste + creatinina provista pasa la validación", async () => {
      stubHappyPath();
      prisma.labTest.findMany.mockResolvedValue([
        { ...TEST_ROW, imagingAttrs: { ...TEST_ROW.imagingAttrs, requiereContraste: true } },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.crear({ ...validInput, creatinina: "0.9" });
      expect(result.folio).toBe(`SOL-${new Date().getFullYear()}-0007`);
    });

    it("crea la solicitud y sus ImagingOrder hijas con folio SOL-{YYYY}-{NNNN}", async () => {
      stubHappyPath();
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.crear(validInput);

      expect(result.folio).toBe(`SOL-${new Date().getFullYear()}-0007`);
      expect(result.advertencias).toEqual([]);

      const createArgs = prisma.imagingOrder.create.mock.calls[0]![0];
      expect(createArgs.data).toMatchObject({
        requestId: u,
        patientAccountId: cuentaId,
        patientId,
        studyDescription: "RX TORAX",
        modalityType: "CR",
      });
    });

    it("devuelve advertencia de duplicado (dupWarn) sin bloquear la creación", async () => {
      stubHappyPath();
      prisma.imagingOrder.findMany.mockResolvedValue([
        { studyDescription: "RX TORAX" },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.crear(validInput);
      expect(result.advertencias.length).toBe(1);
      expect(result.advertencias[0]).toContain("RX TORAX");
    });

    it("BAD_REQUEST si la regla firma está habilitada y no se envía pin", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([] as never);
      prisma.imagingModuleRule.findMany.mockResolvedValue([
        { ruleKey: "firma", enabled: true, valorNum: null },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.crear(validInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ---------------------------------------------------------------------------
  // listarPorCuenta / listarPorPaciente — estado derivado
  // ---------------------------------------------------------------------------
  describe("listarPorCuenta / listarPorPaciente", () => {
    it("deriva estado y concatena categorías por modalidad", async () => {
      prisma.imagingRequest.findMany.mockResolvedValue([
        {
          id: u,
          folio: "SOL-2026-0001",
          createdAt: new Date("2026-08-01"),
          prioridad: "ROUTINE",
          orders: [
            { status: "ORDERED", modalityType: "CR" },
            { status: "COMPLETED", modalityType: "CT" },
          ],
        },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const rows = await caller.listarPorCuenta({ cuentaId });
      expect(rows[0]!.estado).toBe("pend"); // mínimo = ORDERED
      expect(rows[0]!.categorias).toBe("Radiografías, Tomografías");
      expect(rows[0]!.nPrestaciones).toBe(2);
    });

    it("listarPorPaciente filtra por patientId", async () => {
      prisma.imagingRequest.findMany.mockResolvedValue([] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await caller.listarPorPaciente({ patientId });
      const args = prisma.imagingRequest.findMany.mock.calls[0]![0];
      expect(args!.where).toMatchObject({ patientId });
    });
  });

  // ---------------------------------------------------------------------------
  // detalle / resolverDeepLink
  // ---------------------------------------------------------------------------
  describe("detalle", () => {
    it("NOT_FOUND si la solicitud no existe", async () => {
      prisma.imagingRequest.findFirst.mockResolvedValue(null as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.detalle({ id: u })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("incluye estado derivado en el detalle", async () => {
      prisma.imagingRequest.findFirst.mockResolvedValue({
        id: u,
        folio: "SOL-2026-0001",
        orders: [{ status: "VALIDATED" }],
      } as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.detalle({ id: u });
      expect(r.estado).toBe("inf");
    });
  });

  describe("resolverDeepLink", () => {
    it("NOT_FOUND si la orden no existe", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue(null as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.resolverDeepLink({ orderId: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("devuelve requestId null para una orden legada sin solicitud", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u, requestId: null } as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.resolverDeepLink({ orderId: u });
      expect(r.requestId).toBeNull();
    });

    it("devuelve el requestId cuando la orden viene del módulo de solicitud", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u, requestId: "req-1" } as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.resolverDeepLink({ orderId: u });
      expect(r.requestId).toBe("req-1");
    });
  });

  // ---------------------------------------------------------------------------
  // catalogoImagen
  // ---------------------------------------------------------------------------
  describe("catalogoImagen.list", () => {
    it("aplana paneles + tests + attrs en ImagingCatalogoItem[]", async () => {
      prisma.labPanel.findMany.mockResolvedValue([
        {
          id: panelId,
          code: "IMG-RX",
          name: "Radiografías",
          displayOrder: 1,
          active: true,
          tests: [
            {
              id: labTestId,
              code: "RX001",
              name: "RX TORAX",
              displayOrder: 1,
              active: true,
              imagingAttrs: { requiereContraste: false, requiereAyuno: true, requiereAutorizacion: false, duracionMin: 15, modalityId: null, preparacionPaciente: null },
            },
          ],
        },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const items = await caller.catalogoImagen.list();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ labTestId, code: "RX001", panelNombre: "Radiografías", requiereAyuno: true });
    });
  });

  describe("catalogoImagen.upsert", () => {
    it("FORBIDDEN sin rol ADMIN/DIR", async () => {
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma, tenant: TENANT_NO_ADMIN }));
      await expect(
        caller.catalogoImagen.upsert({ panelId, code: "RX999", name: "RX PRUEBA" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("NOT_FOUND si la categoría no existe", async () => {
      prisma.labPanel.findFirst.mockResolvedValue(null as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.catalogoImagen.upsert({ panelId, code: "RX999", name: "RX PRUEBA" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("CONFLICT si el código ya existe al crear", async () => {
      prisma.labPanel.findFirst.mockResolvedValue({ id: panelId, code: "IMG-RX" } as never);
      prisma.labTest.findFirst.mockResolvedValue({ id: "existing" } as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.catalogoImagen.upsert({ panelId, code: "RX999", name: "RX PRUEBA" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("crea LabTest + ImagingTestAttrs con el modalityType derivado del panel", async () => {
      prisma.labPanel.findFirst.mockResolvedValue({ id: panelId, code: "IMG-TAC" } as never);
      prisma.labTest.findFirst.mockResolvedValue(null as never);
      prisma.labTest.create.mockResolvedValue({ id: labTestId } as never);
      prisma.imagingTestAttrs.upsert.mockResolvedValue({} as never);

      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await caller.catalogoImagen.upsert({ panelId, code: "TC999", name: "TOMOGRAFIA PRUEBA" });

      const attrsArgs = prisma.imagingTestAttrs.upsert.mock.calls[0]![0];
      expect(attrsArgs.create).toMatchObject({ labTestId, modalityType: "CT" });
    });

    it("NOT_FOUND al actualizar una prestación fuera del tenant", async () => {
      prisma.labPanel.findFirst.mockResolvedValue({ id: panelId, code: "IMG-RX" } as never);
      prisma.labTest.findFirst.mockResolvedValue(null as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.catalogoImagen.upsert({ labTestId, panelId, name: "RX PRUEBA" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ---------------------------------------------------------------------------
  // fieldConfig / rules
  // ---------------------------------------------------------------------------
  describe("fieldConfig", () => {
    it("list devuelve defaults del mockup cuando la org no tiene filas", async () => {
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const rows = await caller.fieldConfig.list();
      expect(rows.find((r) => r.fieldKey === "dx")!.estado).toBe("obligatorio");
      expect(rows.find((r) => r.fieldKey === "obs")!.estado).toBe("oculto");
    });

    it("set requiere rol ADMIN/DIR", async () => {
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma, tenant: TENANT_NO_ADMIN }));
      await expect(
        caller.fieldConfig.set({ fieldKey: "dx", estado: "opcional" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("set hace upsert por (organizationId, fieldKey)", async () => {
      prisma.imagingFormFieldConfig.upsert.mockResolvedValue({} as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await caller.fieldConfig.set({ fieldKey: "obs", estado: "opcional" });
      const args = prisma.imagingFormFieldConfig.upsert.mock.calls[0]![0];
      expect(args.update).toEqual({ estado: "opcional" });
    });
  });

  describe("rules", () => {
    it("list devuelve defaults del mockup cuando la org no tiene filas", async () => {
      prisma.imagingModuleRule.findMany.mockResolvedValue([] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const rows = await caller.rules.list();
      expect(rows.find((r) => r.ruleKey === "multi")!.enabled).toBe(true);
      expect(rows.find((r) => r.ruleKey === "maxN")).toMatchObject({ enabled: false, valorNum: 10 });
    });

    it("set requiere rol ADMIN/DIR", async () => {
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma, tenant: TENANT_NO_ADMIN }));
      await expect(caller.rules.set({ ruleKey: "multi", enabled: false })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("set persiste valorNum en maxN", async () => {
      prisma.imagingModuleRule.upsert.mockResolvedValue({} as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await caller.rules.set({ ruleKey: "maxN", enabled: true, valorNum: 5 });
      const args = prisma.imagingModuleRule.upsert.mock.calls[0]![0];
      expect(args.create).toMatchObject({ ruleKey: "maxN", enabled: true, valorNum: 5 });
    });
  });
});
