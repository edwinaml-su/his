/**
 * Tests del contratoRouter — CC-0036 Ola 2 (REQ-HIS-AFIL-001 S2, US.AFIL.1.3 /
 * US.AFIL.1.4). Cubre folio, gates de permiso, traslape EXCLUSIVO (mensaje
 * es-SV con folio bloqueante), traslape de jornadas entre contratos, devengo
 * prorrateado en activar/terminar, idempotencia de generación manual, gate
 * PROSPECTO→ACTIVO del afiliado al activar, y anulación de cargo.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { contratoRouter } from "../contrato.router";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const CONTRATO_ID = "00000000-0000-0000-0000-000000000080";
const AFILIADO_ID = "00000000-0000-0000-0000-000000000081";
const CONSULTORIO_ID = "00000000-0000-0000-0000-000000000082";
const CURRENCY_ID = "00000000-0000-0000-0000-000000000083";
const CARGO_ID = "00000000-0000-0000-0000-000000000084";

/** Otorga `permissionCode` al rol ADMIN (el rol por defecto de MOCK_TENANT). */
function grantAdmin(prisma: DeepMockProxy<PrismaClient>, permissionCode: string): void {
  prisma.role.findMany.mockResolvedValue([
    { id: "r1", code: "ADMIN", inheritsFromRoleId: null },
  ] as never);
  prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
  prisma.rolePermission.findMany.mockResolvedValue([
    { effect: "ALLOW", permission: { code: permissionCode } },
  ] as never);
}

/** decimal-like con .toNumber() — suficiente para el router (no usa otros métodos de Prisma.Decimal). */
function dec(n: number): { toNumber: () => number } {
  return { toNumber: () => n };
}

describe("contratoRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
    // fn_next_contrato_arrendamiento (y la sonda interna de emitDomainEvent,
    // que no le presta atención al campo `n`) comparten $queryRaw.
    prisma.$queryRaw.mockResolvedValue([{ n: 1 }] as never);
    prisma.domainEvent.create.mockResolvedValue({ id: "event-1" } as never);
  });

  describe("create", () => {
    const baseInput = {
      medicoAfiliadoId: AFILIADO_ID,
      consultorioId: CONSULTORIO_ID,
      modalidad: "EXCLUSIVO" as const,
      fechaInicio: "2026-01-01",
      rentaMensual: 1000,
      currencyId: CURRENCY_ID,
    };

    it("crea el contrato en BORRADOR con folio ARR-000001", async () => {
      grantAdmin(prisma, "contrato_arrendamiento.crear");
      prisma.medicoAfiliado.findFirst.mockResolvedValue({ id: AFILIADO_ID, estado: "ACTIVO" } as never);
      prisma.consultorio.findFirst.mockResolvedValue({ id: CONSULTORIO_ID, active: true } as never);
      prisma.contratoArrendamiento.findFirst
        .mockResolvedValueOnce(null as never) // assertSinTraslapeExclusivo
        .mockResolvedValueOnce({ id: CONTRATO_ID, folio: "ARR-000001", jornadas: [] } as never); // return final
      prisma.contratoArrendamiento.create.mockResolvedValue({ id: CONTRATO_ID, folio: "ARR-000001" } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await caller.create(baseInput);

      expect(prisma.contratoArrendamiento.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: MOCK_TENANT.organizationId,
            folio: "ARR-000001",
            estado: "BORRADOR",
          }),
        }),
      );
    });

    it("rechaza si el afiliado no está ACTIVO (US.AFIL.1.3 AC1)", async () => {
      grantAdmin(prisma, "contrato_arrendamiento.crear");
      prisma.medicoAfiliado.findFirst.mockResolvedValue({ id: AFILIADO_ID, estado: "PROSPECTO" } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.create(baseInput)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("PROSPECTO"),
      });
      expect(prisma.contratoArrendamiento.create).not.toHaveBeenCalled();
    });

    it("rechaza si el consultorio está inactivo", async () => {
      grantAdmin(prisma, "contrato_arrendamiento.crear");
      prisma.medicoAfiliado.findFirst.mockResolvedValue({ id: AFILIADO_ID, estado: "ACTIVO" } as never);
      prisma.consultorio.findFirst.mockResolvedValue({ id: CONSULTORIO_ID, active: false } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.create(baseInput)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("US.AFIL.1.3 AC2 — rechaza traslape EXCLUSIVO con el folio bloqueante en el mensaje", async () => {
      grantAdmin(prisma, "contrato_arrendamiento.crear");
      prisma.medicoAfiliado.findFirst.mockResolvedValue({ id: AFILIADO_ID, estado: "ACTIVO" } as never);
      prisma.consultorio.findFirst.mockResolvedValue({ id: CONSULTORIO_ID, active: true } as never);
      prisma.contratoArrendamiento.findFirst.mockResolvedValue({ folio: "ARR-000123" } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.create(baseInput)).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("ARR-000123"),
      });
      expect(prisma.contratoArrendamiento.create).not.toHaveBeenCalled();
    });

    it("deniega sin el permiso contrato_arrendamiento.crear", async () => {
      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.create(baseInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("jornada.create", () => {
    it("rechaza el traslape con la jornada de otro contrato VIGENTE del mismo consultorio", async () => {
      grantAdmin(prisma, "contrato_arrendamiento.editar");
      prisma.contratoArrendamiento.findFirst.mockResolvedValue({
        id: CONTRATO_ID,
        consultorioId: CONSULTORIO_ID,
        modalidad: "COMPARTIDO_POR_JORNADA",
      } as never);
      prisma.contratoJornada.findMany.mockResolvedValue([
        {
          horaInicio: new Date("1970-01-01T14:00:00.000Z"),
          horaFin: new Date("1970-01-01T18:00:00.000Z"),
          contrato: { folio: "ARR-000050" },
        },
      ] as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.jornada.create({
          contratoId: CONTRATO_ID,
          diaSemana: 2,
          horaInicio: "16:00",
          horaFin: "20:00",
        }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("ARR-000050"),
      });
      expect(prisma.contratoJornada.create).not.toHaveBeenCalled();
    });

    it("rechaza jornadas sobre un contrato EXCLUSIVO", async () => {
      grantAdmin(prisma, "contrato_arrendamiento.editar");
      prisma.contratoArrendamiento.findFirst.mockResolvedValue({
        id: CONTRATO_ID,
        consultorioId: CONSULTORIO_ID,
        modalidad: "EXCLUSIVO",
      } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.jornada.create({ contratoId: CONTRATO_ID, diaSemana: 2, horaInicio: "16:00", horaFin: "20:00" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  describe("activar", () => {
    it("US.AFIL.1.3 AC4 — pasa a VIGENTE, devenga prorrateado y promueve al afiliado PROSPECTO a ACTIVO", async () => {
      grantAdmin(prisma, "contrato_arrendamiento.activar");
      prisma.contratoArrendamiento.findFirst
        .mockResolvedValueOnce({
          id: CONTRATO_ID,
          organizationId: MOCK_TENANT.organizationId,
          consultorioId: CONSULTORIO_ID,
          medicoAfiliadoId: AFILIADO_ID,
          folio: "ARR-000001",
          modalidad: "EXCLUSIVO",
          estado: "BORRADOR",
          fechaInicio: new Date("2026-09-15T00:00:00.000Z"),
          fechaFin: null,
          rentaMensual: dec(1000),
          cuotaServicios: dec(0),
          currencyId: CURRENCY_ID,
          jornadas: [],
        } as never) // findFirst con include jornadas
        .mockResolvedValueOnce(null as never); // assertSinTraslapeExclusivo
      prisma.contratoArrendamiento.update.mockResolvedValue({ id: CONTRATO_ID, estado: "VIGENTE" } as never);
      prisma.contratoCargo.findUnique.mockResolvedValue(null as never);
      prisma.contratoCargo.create.mockResolvedValue({ id: CARGO_ID } as never);
      prisma.medicoAfiliado.findFirst.mockResolvedValue({ estado: "PROSPECTO" } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.activar({ id: CONTRATO_ID });

      expect(result).toMatchObject({ estado: "VIGENTE" });
      expect(prisma.contratoCargo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ concepto: "RENTA", estado: "DEVENGADO" }),
        }),
      );
      // Septiembre 2026: 30 días, inicia el 15 -> 16/30 * 1000 = 533.33.
      const cargoData = prisma.contratoCargo.create.mock.calls[0]![0].data as { monto: number };
      expect(cargoData.monto).toBeCloseTo(533.33, 2);

      expect(prisma.domainEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: "contrato.activado", aggregateId: CONTRATO_ID }),
        }),
      );
      expect(prisma.domainEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: "contrato.cargo.devengado", aggregateId: CARGO_ID }),
        }),
      );
      expect(prisma.medicoAfiliado.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ estado: "ACTIVO" }) }),
      );
    });

    it("rechaza activar un contrato que no está en BORRADOR", async () => {
      grantAdmin(prisma, "contrato_arrendamiento.activar");
      prisma.contratoArrendamiento.findFirst.mockResolvedValue({
        id: CONTRATO_ID,
        estado: "VIGENTE",
        modalidad: "EXCLUSIVO",
        jornadas: [],
      } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.activar({ id: CONTRATO_ID })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(prisma.contratoArrendamiento.update).not.toHaveBeenCalled();
    });

    it("rechaza activar COMPARTIDO_POR_JORNADA sin ninguna jornada registrada", async () => {
      grantAdmin(prisma, "contrato_arrendamiento.activar");
      prisma.contratoArrendamiento.findFirst.mockResolvedValue({
        id: CONTRATO_ID,
        estado: "BORRADOR",
        modalidad: "COMPARTIDO_POR_JORNADA",
        jornadas: [],
      } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.activar({ id: CONTRATO_ID })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });
  });

  describe("terminar", () => {
    it("US.AFIL.1.3 AC7 — termina con devengo prorrateado del período parcial", async () => {
      grantAdmin(prisma, "contrato_arrendamiento.terminar");
      prisma.contratoArrendamiento.findFirst.mockResolvedValue({
        id: CONTRATO_ID,
        organizationId: MOCK_TENANT.organizationId,
        folio: "ARR-000001",
        estado: "VIGENTE",
        fechaInicio: new Date("2026-01-01T00:00:00.000Z"),
        rentaMensual: dec(1000),
        cuotaServicios: dec(0),
        currencyId: CURRENCY_ID,
        notas: null,
      } as never);
      prisma.contratoArrendamiento.update.mockResolvedValue({ id: CONTRATO_ID, estado: "TERMINADO" } as never);
      prisma.contratoCargo.findUnique.mockResolvedValue(null as never);
      prisma.contratoCargo.create.mockResolvedValue({ id: CARGO_ID } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.terminar({
        id: CONTRATO_ID,
        fechaEfectiva: "2026-09-15",
        motivo: "Cierre de consultorio",
      });

      expect(result).toMatchObject({ estado: "TERMINADO" });
      // FIN a mitad de septiembre (día 15/30) -> factor 0.5 -> 500.
      const cargoData = prisma.contratoCargo.create.mock.calls[0]![0].data as { monto: number };
      expect(cargoData.monto).toBe(500);
      expect(prisma.domainEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: "contrato.terminado" }),
        }),
      );
    });

    it("rechaza terminar un contrato que no está VIGENTE/EN_MORA", async () => {
      grantAdmin(prisma, "contrato_arrendamiento.terminar");
      prisma.contratoArrendamiento.findFirst.mockResolvedValue({ id: CONTRATO_ID, estado: "BORRADOR" } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.terminar({ id: CONTRATO_ID, fechaEfectiva: "2026-09-15", motivo: "X" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("marcarMora / desmarcarMora", () => {
    it("marcarMora exige estado VIGENTE", async () => {
      grantAdmin(prisma, "contrato_arrendamiento.editar");
      prisma.contratoArrendamiento.findFirst.mockResolvedValue({ id: CONTRATO_ID, estado: "TERMINADO", notas: null } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.marcarMora({ id: CONTRATO_ID, motivo: "Renta vencida" })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("marcarMora pasa VIGENTE -> EN_MORA con motivo en notas", async () => {
      grantAdmin(prisma, "contrato_arrendamiento.editar");
      prisma.contratoArrendamiento.findFirst.mockResolvedValue({ id: CONTRATO_ID, estado: "VIGENTE", notas: null } as never);
      prisma.contratoArrendamiento.update.mockResolvedValue({ id: CONTRATO_ID, estado: "EN_MORA" } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.marcarMora({ id: CONTRATO_ID, motivo: "Renta vencida 60 días" });

      expect(result).toMatchObject({ estado: "EN_MORA" });
      const data = prisma.contratoArrendamiento.update.mock.calls[0]![0].data as { notas: string };
      expect(data.notas).toContain("Renta vencida 60 días");
    });

    it("desmarcarMora exige estado EN_MORA", async () => {
      grantAdmin(prisma, "contrato_arrendamiento.editar");
      prisma.contratoArrendamiento.findFirst.mockResolvedValue({ id: CONTRATO_ID, estado: "VIGENTE", notas: null } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.desmarcarMora({ id: CONTRATO_ID, motivo: "Pago recibido" })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  describe("cargo.generar", () => {
    it("genera el devengo manual del período (idempotente)", async () => {
      grantAdmin(prisma, "contrato_cargo.generar");
      prisma.contratoArrendamiento.findFirst.mockResolvedValue({
        id: CONTRATO_ID,
        organizationId: MOCK_TENANT.organizationId,
        folio: "ARR-000001",
        estado: "VIGENTE",
        rentaMensual: dec(1000),
        cuotaServicios: dec(200),
        currencyId: CURRENCY_ID,
      } as never);
      prisma.contratoCargo.findUnique.mockResolvedValue(null as never);
      prisma.contratoCargo.create.mockResolvedValue({ id: CARGO_ID } as never);
      prisma.contratoCargo.findMany.mockResolvedValue([{ id: CARGO_ID, concepto: "RENTA" }] as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await caller.cargo.generar({ contratoId: CONTRATO_ID, periodo: "2026-10-01" });

      // RENTA + SERVICIOS (cuotaServicios > 0) -> 2 cargos creados.
      expect(prisma.contratoCargo.create).toHaveBeenCalledTimes(2);
    });

    it("segunda llamada al mismo período no duplica (CONFLICT idempotente)", async () => {
      grantAdmin(prisma, "contrato_cargo.generar");
      prisma.contratoArrendamiento.findFirst.mockResolvedValue({
        id: CONTRATO_ID,
        organizationId: MOCK_TENANT.organizationId,
        folio: "ARR-000001",
        estado: "VIGENTE",
        rentaMensual: dec(1000),
        cuotaServicios: dec(0),
        currencyId: CURRENCY_ID,
      } as never);
      // Ya existe un cargo RENTA para ese período -> findUnique lo encuentra.
      prisma.contratoCargo.findUnique.mockResolvedValue({ id: CARGO_ID } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.cargo.generar({ contratoId: CONTRATO_ID, periodo: "2026-10-01" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(prisma.contratoCargo.create).not.toHaveBeenCalled();
    });

    it("rechaza un período que no es el primer día del mes", async () => {
      grantAdmin(prisma, "contrato_cargo.generar");
      prisma.contratoArrendamiento.findFirst.mockResolvedValue({
        id: CONTRATO_ID,
        estado: "VIGENTE",
        rentaMensual: dec(1000),
        cuotaServicios: dec(0),
      } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.cargo.generar({ contratoId: CONTRATO_ID, periodo: "2026-10-15" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("cargo.anular", () => {
    it("anula un cargo DEVENGADO con motivo", async () => {
      grantAdmin(prisma, "contrato_cargo.anular");
      prisma.contratoCargo.findFirst.mockResolvedValue({ id: CARGO_ID, estado: "DEVENGADO" } as never);
      prisma.contratoCargo.update.mockResolvedValue({ id: CARGO_ID, estado: "ANULADO" } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.cargo.anular({ id: CARGO_ID, motivo: "Error de captura" });

      expect(result).toMatchObject({ estado: "ANULADO" });
    });

    it("rechaza anular un cargo que no está DEVENGADO", async () => {
      grantAdmin(prisma, "contrato_cargo.anular");
      prisma.contratoCargo.findFirst.mockResolvedValue({ id: CARGO_ID, estado: "ANULADO" } as never);

      const caller = contratoRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.cargo.anular({ id: CARGO_ID, motivo: "X" })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });
});
