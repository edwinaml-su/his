/**
 * Tests del bed router — list, getMap, updateStatus.
 *
 * Nota sobre transiciones permitidas:
 *   El router actual NO impone máquina de estados (FREE→OCCUPIED→DIRTY,
 *   etc.). Esa regla aún no está implementada. Marcamos como SKIP el test
 *   correspondiente para dejar trazabilidad: cuando @Dev añada la lógica,
 *   se quita el `.skip` y se valida que rechaza transiciones ilegales.
 *   Backlog ref: US-BED-08.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@his/database";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// docs/48 §5 C3-2 — capturarCargo ya tiene su propia suite (charge-capture.test.ts);
// aquí solo importa que assignToEncounter la invoque con code/origen/referenciaId
// correctos, mismo patrón que imaging-request.router.test.ts.
const capturarCargoMock = vi.fn().mockResolvedValue({
  cargoId: "cargo-default",
  status: "VIGENTE",
  unitPrice: 10,
});
vi.mock("../../lib/charge-capture", () => ({
  capturarCargo: (...args: unknown[]) => capturarCargoMock(...args),
  revertirCargo: vi.fn(),
}));

import { bedRouter } from "../bed.router";

const BED_ID = "00000000-0000-0000-0000-000000000060";
const GLN_ACTIVO = "7410398000262";

describe("bedRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
    capturarCargoMock.mockClear();
  });

  describe("list", () => {
    it("filtra por organizationId + active=true", async () => {
      prisma.bed.findMany.mockResolvedValue([] as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.list({});

      const args = prisma.bed.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
        active: true,
      });
    });

    it("aplica filtro por status si se provee", async () => {
      prisma.bed.findMany.mockResolvedValue([] as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ status: "FREE" });

      expect(prisma.bed.findMany.mock.calls[0]![0].where).toMatchObject({
        status: "FREE",
      });
    });
  });

  describe("getMap", () => {
    it("retorna servicios con al menos una cama", async () => {
      prisma.serviceUnit.findMany.mockResolvedValue([
        { id: "s1", code: "URG-A", beds: [{ id: "b1" }] },
        { id: "s2", code: "EMPTY", beds: [] },
      ] as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.getMap();

      expect(out).toHaveLength(1);
      expect((out[0] as { id: string }).id).toBe("s1");
    });
  });

  describe("updateStatus", () => {
    it("actualiza el estado de la cama", async () => {
      // Nivel B (PR #324) — updateStatus ahora hace findFirst previo para
      // validar que la cama pertenece a un servicio del usuario. Para el
      // tenant default (ADMIN, cross-service) la validación pasa siempre.
      prisma.bed.findFirst.mockResolvedValue({
        id: "00000000-0000-0000-0000-000000000010",
        serviceUnitId: "00000000-0000-0000-0000-0000000000ER",
      } as never);
      prisma.bed.update.mockResolvedValue({ id: "b1", status: "DIRTY" } as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.updateStatus({
        bedId: "00000000-0000-0000-0000-000000000010",
        status: "DIRTY",
      });

      expect(prisma.bed.update.mock.calls[0]![0]).toMatchObject({
        where: { id: "00000000-0000-0000-0000-000000000010" },
        data: { status: "DIRTY" },
      });
    });

    it.skip("rechaza transición ilegal (US-BED-08, pendiente en @Dev)", async () => {
      // Intencional: la lógica de máquina de estados aún no existe.
      // Cuando se implemente: FREE → OCCUPIED debe requerir BedAssignment;
      // OCCUPIED → FREE debe pasar por DIRTY primero, etc.
      expect.fail("Habilitar cuando @Dev implemente bedStateMachine.");
    });
  });

  // docs/48 §5 C3-2 — decisión Edwin 2026-09-12: la asignación de cama
  // dispara el cargo de estancia.
  describe("assignToEncounter", () => {
    const ENCOUNTER_ID = "00000000-0000-0000-0000-000000000080";
    const ASSIGNMENT_ID = "00000000-0000-0000-0000-000000000081";
    const PATIENT_ID = "00000000-0000-0000-0000-000000000082";

    it("captura cargo HABITACION con el chargeCode de la Room de la cama", async () => {
      prisma.bed.findFirst.mockResolvedValue({
        id: BED_ID,
        code: "CAMA-101",
        status: "FREE",
        serviceUnitId: null,
        roomRef: { chargeCode: "TARIFA-HAB-GENERAL", roomType: "GENERAL" },
      } as never);
      prisma.encounter.findFirst.mockResolvedValue({
        id: ENCOUNTER_ID,
        patientId: PATIENT_ID,
        bedAssignments: [],
      } as never);
      prisma.bedAssignment.create.mockResolvedValue({ id: ASSIGNMENT_ID } as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.assignToEncounter({ bedId: BED_ID, encounterId: ENCOUNTER_ID });

      expect(capturarCargoMock).toHaveBeenCalledTimes(1);
      expect(capturarCargoMock).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          patientId: PATIENT_ID,
          encounterId: ENCOUNTER_ID,
          code: "TARIFA-HAB-GENERAL",
          origen: "HABITACION",
          referenciaId: ASSIGNMENT_ID,
          quantity: 1,
        }),
      );
    });

    it("code sintético HAB-<roomType|SIN_HABITACION> cuando la cama no tiene Room con chargeCode", async () => {
      prisma.bed.findFirst.mockResolvedValue({
        id: BED_ID,
        code: "CAMA-102",
        status: "FREE",
        serviceUnitId: null,
        roomRef: null,
      } as never);
      prisma.encounter.findFirst.mockResolvedValue({
        id: ENCOUNTER_ID,
        patientId: PATIENT_ID,
        bedAssignments: [],
      } as never);
      prisma.bedAssignment.create.mockResolvedValue({ id: ASSIGNMENT_ID } as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.assignToEncounter({ bedId: BED_ID, encounterId: ENCOUNTER_ID });

      expect(capturarCargoMock).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ code: "HAB-SIN_HABITACION" }),
      );
    });

    it("CONFLICT si la cama no está FREE — no captura cargo", async () => {
      prisma.bed.findFirst.mockResolvedValue({
        id: BED_ID,
        code: "CAMA-103",
        status: "OCCUPIED",
        serviceUnitId: null,
        roomRef: null,
      } as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.assignToEncounter({ bedId: BED_ID, encounterId: ENCOUNTER_ID }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(capturarCargoMock).not.toHaveBeenCalled();
    });
  });

  // CC-0027 — gate de egreso físico (lib/egreso-fisico-gate.ts).
  describe("release", () => {
    const ENCOUNTER_ID = "00000000-0000-0000-0000-0000000000e1";

    it("bloquea la liberación si el encuentro tiene cuenta activa sin alta administrativa", async () => {
      prisma.bed.findFirst.mockResolvedValue({ id: BED_ID, status: "OCCUPIED" } as never);
      prisma.bedAssignment.findFirst.mockResolvedValue({
        id: "ba-1",
        encounterId: ENCOUNTER_ID,
      } as never);
      prisma.encounter.findFirst.mockResolvedValue({ egresoAutorizadoAt: null } as never);
      prisma.patientAccount.findFirst.mockResolvedValue({ id: "acc-1" } as never); // cuenta activa

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.release({ bedId: BED_ID, reason: "Liberación manual" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(prisma.bedAssignment.update).not.toHaveBeenCalled();
      expect(prisma.bed.update).not.toHaveBeenCalled();
    });

    it("permite liberar cuando el encuentro ya tiene egresoAutorizadoAt", async () => {
      prisma.bed.findFirst.mockResolvedValue({ id: BED_ID, status: "OCCUPIED" } as never);
      prisma.bedAssignment.findFirst.mockResolvedValue({
        id: "ba-1",
        encounterId: ENCOUNTER_ID,
      } as never);
      prisma.encounter.findFirst.mockResolvedValue({ egresoAutorizadoAt: new Date() } as never);
      prisma.bedAssignment.update.mockResolvedValue({} as never);
      prisma.bed.update.mockResolvedValue({} as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.release({ bedId: BED_ID, reason: "Liberación manual" }),
      ).resolves.toMatchObject({ ok: true });
      expect(prisma.patientAccount.findFirst).not.toHaveBeenCalled();
    });

    it("permite liberar cuando el encuentro no tiene ninguna cuenta activa", async () => {
      prisma.bed.findFirst.mockResolvedValue({ id: BED_ID, status: "OCCUPIED" } as never);
      prisma.bedAssignment.findFirst.mockResolvedValue({
        id: "ba-1",
        encounterId: ENCOUNTER_ID,
      } as never);
      prisma.encounter.findFirst.mockResolvedValue({ egresoAutorizadoAt: null } as never);
      prisma.patientAccount.findFirst.mockResolvedValue(null as never); // sin cuenta activa
      prisma.bedAssignment.update.mockResolvedValue({} as never);
      prisma.bed.update.mockResolvedValue({} as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.release({ bedId: BED_ID, reason: "Liberación manual" }),
      ).resolves.toMatchObject({ ok: true });
      expect(prisma.bedAssignment.update).toHaveBeenCalled();
    });
  });

  // Parametrización admin (2026-09-11) — espejo Odoo ACS HMS (roomId/bedType/
  // billingClass/glnCodigo), sql/231_room_bed_odoo_mirror.sql.
  describe("adminList", () => {
    it("filtra por organizationId del tenant e incluye habitación/servicio/establecimiento", async () => {
      prisma.bed.findMany.mockResolvedValue([] as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.adminList({});

      expect(prisma.bed.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: MOCK_TENANT.organizationId },
          include: expect.objectContaining({
            establishment: expect.anything(),
            serviceUnit: expect.anything(),
            roomRef: expect.anything(),
          }),
        }),
      );
    });

    it("aplica el filtro roomId cuando se provee", async () => {
      prisma.bed.findMany.mockResolvedValue([] as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.adminList({ roomId: "00000000-0000-0000-0000-000000000070" });

      expect(prisma.bed.findMany.mock.calls[0]![0].where).toMatchObject({
        roomId: "00000000-0000-0000-0000-000000000070",
      });
    });

    it("lanza FORBIDDEN si el rol no es ADMIN/DIR", async () => {
      const caller = bedRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] } }),
      );
      await expect(caller.adminList({})).rejects.toThrow(/Rol requerido/);
    });
  });

  describe("create", () => {
    it("crea la cama en la org del tenant", async () => {
      prisma.bed.create.mockResolvedValue({ id: BED_ID, code: "CAMA_1" } as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.create({
        establishmentId: MOCK_TENANT.establishmentId!,
        serviceUnitId: "00000000-0000-0000-0000-000000000051",
        code: "CAMA_1",
      });

      expect(result).toEqual({ id: BED_ID, code: "CAMA_1" });
      expect(prisma.bed.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: MOCK_TENANT.organizationId,
            code: "CAMA_1",
          }),
        }),
      );
    });

    it("traduce el código duplicado (P2002) a CONFLICT", async () => {
      prisma.bed.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "5.22.0",
        }) as never,
      );

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({
          establishmentId: MOCK_TENANT.establishmentId!,
          serviceUnitId: "00000000-0000-0000-0000-000000000051",
          code: "CAMA_1",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("lanza FORBIDDEN si el rol no es ADMIN/DIR", async () => {
      const caller = bedRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] } }),
      );
      await expect(
        caller.create({
          establishmentId: MOCK_TENANT.establishmentId!,
          serviceUnitId: "00000000-0000-0000-0000-000000000051",
          code: "CAMA_1",
        }),
      ).rejects.toThrow(/Rol requerido/);
    });

    it("valida el GLN contra ece.gs1_gln antes de crear", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([{ tipo: "cama", activo: true }]);
      prisma.bed.create.mockResolvedValue({ id: BED_ID, code: "CAMA_1" } as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.create({
        establishmentId: MOCK_TENANT.establishmentId!,
        serviceUnitId: "00000000-0000-0000-0000-000000000051",
        code: "CAMA_1",
        glnCodigo: GLN_ACTIVO,
      });

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("ece.gs1_gln"),
        GLN_ACTIVO,
      );
    });

    it("rechaza un GLN inactivo", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([{ tipo: "cama", activo: false }]);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({
          establishmentId: MOCK_TENANT.establishmentId!,
          serviceUnitId: "00000000-0000-0000-0000-000000000051",
          code: "CAMA_1",
          glnCodigo: GLN_ACTIVO,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(prisma.bed.create).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("exige que la cama sea del tenant", async () => {
      prisma.bed.findFirst.mockResolvedValue(null as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.update({ id: BED_ID, isolation: "contacto" })).rejects.toThrow(
        "Cama no encontrada",
      );
    });

    it("actualiza solo los campos enviados", async () => {
      prisma.bed.findFirst.mockResolvedValue({ id: BED_ID } as never);
      prisma.bed.update.mockResolvedValue({ id: BED_ID, isolation: "contacto" } as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await caller.update({ id: BED_ID, isolation: "contacto" });

      const data = prisma.bed.update.mock.calls[0]![0].data as Record<string, unknown>;
      expect(data).toMatchObject({ isolation: "contacto" });
      expect(data).not.toHaveProperty("code");
      expect(data).not.toHaveProperty("roomId");
    });
  });

  describe("setActive", () => {
    it("exige que la cama sea del tenant", async () => {
      prisma.bed.findFirst.mockResolvedValue(null as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.setActive({ id: BED_ID, active: false })).rejects.toThrow(
        "Cama no encontrada",
      );
    });

    it("es idempotente si el estado ya coincide", async () => {
      prisma.bed.findFirst.mockResolvedValue({ id: BED_ID, active: true } as never);

      const caller = bedRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.setActive({ id: BED_ID, active: true });

      expect(result).toEqual({ id: BED_ID, active: true });
      expect(prisma.bed.update).not.toHaveBeenCalled();
    });
  });
});
