/**
 * Tests del agendaRouter — CC-0036 Ola 3 (REQ-HIS-AFIL-001 S3, US.AGE.2.1 /
 * US.AGE.2.2 / US.AGE.2.3). Cubre gates de permiso, jornada contratada
 * (AC2), traslape entre agendas del mismo médico (AC4), publicar sin
 * horarios / con contrato en mora (AC3/AC6), estado efectivo derivado por
 * mora (AC6), excepción con citas afectadas exigiendo `forzar` (US.AGE.2.2
 * AC2), y el guard ABAC de `resolveMedicoAfiliadoScope`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { agendaRouter } from "../agenda.router";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_USER_ADMIN } from "@his/test-utils";

const AGENDA_ID = "00000000-0000-0000-0000-000000000090";
const MEDICO_ID = "00000000-0000-0000-0000-000000000091";
const CONSULTORIO_ID = "00000000-0000-0000-0000-000000000092";
const CONTRATO_ID = "00000000-0000-0000-0000-000000000093";
const ESTABLISHMENT_ID = "00000000-0000-0000-0000-000000000094";
const HORARIO_ID = "00000000-0000-0000-0000-000000000095";

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

function toTime(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

describe("agendaRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  describe("create", () => {
    const baseInput = {
      medicoAfiliadoId: MEDICO_ID,
      consultorioId: CONSULTORIO_ID,
      vigenciaDesde: "2026-10-01",
    };

    it("deniega sin el permiso agenda.configurar", async () => {
      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.create(baseInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("US.AGE.2.1 AC1 — crea en BORRADOR heredando el contratoId VIGENTE", async () => {
      grantAdmin(prisma, "agenda.configurar");
      prisma.consultorio.findFirst.mockResolvedValue({
        id: CONSULTORIO_ID,
        establishmentId: ESTABLISHMENT_ID,
        active: true,
      } as never);
      prisma.contratoArrendamiento.findFirst.mockResolvedValue({ id: CONTRATO_ID } as never);
      prisma.agendaMedico.create.mockResolvedValue({ id: AGENDA_ID } as never);
      prisma.agendaMedico.findFirst.mockResolvedValue({ id: AGENDA_ID, estado: "BORRADOR" } as never);

      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      await caller.create(baseInput);

      expect(prisma.agendaMedico.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: MOCK_TENANT.organizationId,
            establishmentId: ESTABLISHMENT_ID,
            contratoId: CONTRATO_ID,
            estado: "BORRADOR",
          }),
        }),
      );
    });

    it("US.AGE.2.1 AC1 — rechaza si el médico no tiene contrato VIGENTE sobre el consultorio", async () => {
      grantAdmin(prisma, "agenda.configurar");
      prisma.consultorio.findFirst.mockResolvedValue({
        id: CONSULTORIO_ID,
        establishmentId: ESTABLISHMENT_ID,
        active: true,
      } as never);
      prisma.contratoArrendamiento.findFirst.mockResolvedValue(null as never);

      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.create(baseInput)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("VIGENTE"),
      });
      expect(prisma.agendaMedico.create).not.toHaveBeenCalled();
    });

    it("rechaza si el consultorio está inactivo", async () => {
      grantAdmin(prisma, "agenda.configurar");
      prisma.consultorio.findFirst.mockResolvedValue({
        id: CONSULTORIO_ID,
        establishmentId: ESTABLISHMENT_ID,
        active: false,
      } as never);

      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.create(baseInput)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  describe("horario.create", () => {
    it("US.AGE.2.1 AC2 — rechaza horario fuera de la jornada contratada (COMPARTIDO_POR_JORNADA)", async () => {
      grantAdmin(prisma, "agenda.configurar");
      prisma.agendaMedico.findFirst.mockResolvedValue({
        id: AGENDA_ID,
        medicoAfiliadoId: MEDICO_ID,
        contrato: { id: CONTRATO_ID, modalidad: "COMPARTIDO_POR_JORNADA" },
      } as never);
      prisma.contratoJornada.findMany.mockResolvedValue([
        { horaInicio: toTime("14:00"), horaFin: toTime("18:00") },
      ] as never);

      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.horario.create({ agendaId: AGENDA_ID, diaSemana: 2, horaInicio: "08:00", horaFin: "12:00" }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("14:00"),
      });
      expect(prisma.agendaHorario.create).not.toHaveBeenCalled();
    });

    it("US.AGE.2.1 AC2 — acepta horario contenido en la jornada contratada", async () => {
      grantAdmin(prisma, "agenda.configurar");
      prisma.agendaMedico.findFirst.mockResolvedValue({
        id: AGENDA_ID,
        medicoAfiliadoId: MEDICO_ID,
        contrato: { id: CONTRATO_ID, modalidad: "COMPARTIDO_POR_JORNADA" },
      } as never);
      prisma.contratoJornada.findMany.mockResolvedValue([
        { horaInicio: toTime("14:00"), horaFin: toTime("18:00") },
      ] as never);
      prisma.agendaHorario.findMany.mockResolvedValue([]);
      prisma.agendaHorario.create.mockResolvedValue({ id: HORARIO_ID } as never);

      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      await caller.horario.create({ agendaId: AGENDA_ID, diaSemana: 2, horaInicio: "14:00", horaFin: "16:00" });

      expect(prisma.agendaHorario.create).toHaveBeenCalled();
    });

    it("US.AGE.2.1 AC4 — rechaza traslape con horario de otra agenda del mismo médico", async () => {
      grantAdmin(prisma, "agenda.configurar");
      prisma.agendaMedico.findFirst.mockResolvedValue({
        id: AGENDA_ID,
        medicoAfiliadoId: MEDICO_ID,
        contrato: null,
      } as never);
      prisma.agendaHorario.findMany.mockResolvedValue([
        {
          horaInicio: toTime("08:00"),
          horaFin: toTime("12:00"),
          agenda: { consultorio: { codigo: "CE-201" } },
        },
      ] as never);

      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.horario.create({ agendaId: AGENDA_ID, diaSemana: 1, horaInicio: "10:00", horaFin: "14:00" }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("CE-201"),
      });
      expect(prisma.agendaHorario.create).not.toHaveBeenCalled();
    });
  });

  describe("publicar", () => {
    it("US.AGE.2.1 AC3 — rechaza publicar sin horarios", async () => {
      grantAdmin(prisma, "agenda.publicar");
      prisma.agendaMedico.findFirst.mockResolvedValue({
        id: AGENDA_ID,
        estado: "BORRADOR",
        horarios: [],
        contrato: null,
      } as never);

      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.publicar({ id: AGENDA_ID })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(prisma.agendaMedico.update).not.toHaveBeenCalled();
    });

    it("US.AGE.2.1 AC6 — rechaza publicar si el contrato asociado está EN_MORA", async () => {
      grantAdmin(prisma, "agenda.publicar");
      prisma.agendaMedico.findFirst.mockResolvedValue({
        id: AGENDA_ID,
        estado: "BORRADOR",
        horarios: [{ id: HORARIO_ID }],
        contrato: { estado: "EN_MORA" },
      } as never);

      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.publicar({ id: AGENDA_ID })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("EN_MORA"),
      });
    });

    it("US.AGE.2.1 AC3 — publica con al menos un horario y contrato sano", async () => {
      grantAdmin(prisma, "agenda.publicar");
      prisma.agendaMedico.findFirst.mockResolvedValue({
        id: AGENDA_ID,
        estado: "BORRADOR",
        horarios: [{ id: HORARIO_ID }],
        contrato: { estado: "VIGENTE" },
      } as never);
      prisma.agendaMedico.update.mockResolvedValue({ id: AGENDA_ID, estado: "PUBLICADA" } as never);

      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.publicar({ id: AGENDA_ID });

      expect(result).toMatchObject({ estado: "PUBLICADA" });
    });
  });

  describe("get — estado efectivo (AC6)", () => {
    it("aparece SUSPENDIDA cuando el contrato está EN_MORA aunque el estado persistido sea PUBLICADA", async () => {
      grantAdmin(prisma, "agenda.leer");
      prisma.medicoAfiliado.findMany.mockResolvedValue([]);
      prisma.agendaMedico.findFirst.mockResolvedValue({
        id: AGENDA_ID,
        estado: "PUBLICADA",
        contrato: { estado: "EN_MORA" },
      } as never);

      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.get({ id: AGENDA_ID });

      expect(result).toMatchObject({ estado: "PUBLICADA", estadoEfectivo: "SUSPENDIDA" });
    });

    it("respeta el estado persistido cuando el contrato está VIGENTE", async () => {
      grantAdmin(prisma, "agenda.leer");
      prisma.medicoAfiliado.findMany.mockResolvedValue([]);
      prisma.agendaMedico.findFirst.mockResolvedValue({
        id: AGENDA_ID,
        estado: "PUBLICADA",
        contrato: { estado: "VIGENTE" },
      } as never);

      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.get({ id: AGENDA_ID });

      expect(result).toMatchObject({ estadoEfectivo: "PUBLICADA" });
    });
  });

  describe("excepcion.create", () => {
    it("US.AGE.2.2 AC2 — rechaza sin `forzar` si hay citas reservadas en la fecha", async () => {
      grantAdmin(prisma, "agenda.configurar");
      prisma.agendaMedico.findFirst.mockResolvedValue({
        id: AGENDA_ID,
        medicoAfiliado: { userId: MOCK_USER_ADMIN.id },
      } as never);
      prisma.outpatientAppointment.findMany.mockResolvedValue([
        {
          id: "cita-1",
          scheduledAt: new Date("2026-10-05T14:00:00.000Z"),
          durationMinutes: 20,
          patientId: "pac-1",
        },
      ] as never);

      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.excepcion.create({
          agendaId: AGENDA_ID,
          fecha: "2026-10-05",
          tipo: "VACACION",
          motivo: "Vacaciones",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(prisma.agendaExcepcion.create).not.toHaveBeenCalled();
    });

    it("US.AGE.2.2 AC2 — con `forzar:true` crea la excepción pese a citas afectadas", async () => {
      grantAdmin(prisma, "agenda.configurar");
      prisma.agendaMedico.findFirst.mockResolvedValue({
        id: AGENDA_ID,
        medicoAfiliado: { userId: MOCK_USER_ADMIN.id },
      } as never);
      prisma.agendaExcepcion.create.mockResolvedValue({ id: "exc-1" } as never);

      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      await caller.excepcion.create({
        agendaId: AGENDA_ID,
        fecha: "2026-10-05",
        tipo: "VACACION",
        motivo: "Vacaciones",
        forzar: true,
      });

      expect(prisma.agendaExcepcion.create).toHaveBeenCalled();
      expect(prisma.outpatientAppointment.findMany).not.toHaveBeenCalled();
    });

    it("US.AGE.2.2 AC4 — EXTENSION nunca exige `forzar` (no valida citas)", async () => {
      grantAdmin(prisma, "agenda.configurar");
      prisma.agendaMedico.findFirst.mockResolvedValue({
        id: AGENDA_ID,
        medicoAfiliado: { userId: MOCK_USER_ADMIN.id },
      } as never);
      prisma.agendaExcepcion.create.mockResolvedValue({ id: "exc-2" } as never);

      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      await caller.excepcion.create({
        agendaId: AGENDA_ID,
        fecha: "2026-10-05",
        tipo: "EXTENSION",
        horaInicio: "18:00",
        horaFin: "20:00",
        motivo: "Cupos extra",
      });

      expect(prisma.agendaExcepcion.create).toHaveBeenCalled();
      expect(prisma.outpatientAppointment.findMany).not.toHaveBeenCalled();
    });
  });

  describe("ABAC — resolveMedicoAfiliadoScope (vía list)", () => {
    it("SECRETARIA_MEDICO_AFILIADO solo ve agendas de su médico afiliado vinculado", async () => {
      const tenant = { ...MOCK_TENANT, roleCodes: ["SECRETARIA_MEDICO_AFILIADO"] };
      grantAdmin(prisma, "agenda.leer"); // grantAdmin solo puebla el mock genérico de permisos; el rol real viene del tenant.
      prisma.role.findMany.mockResolvedValue([
        { id: "r2", code: "SECRETARIA_MEDICO_AFILIADO", inheritsFromRoleId: null },
      ] as never);
      prisma.rolePermission.findMany.mockResolvedValue([
        { effect: "ALLOW", permission: { code: "agenda.leer" } },
      ] as never);
      prisma.medicoAfiliado.findMany.mockResolvedValue([{ id: MEDICO_ID }] as never);
      prisma.agendaMedico.findMany.mockResolvedValue([]);

      const caller = agendaRouter.createCaller(makeCtx({ prisma, tenant }));
      await caller.list(undefined);

      expect(prisma.agendaMedico.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ medicoAfiliadoId: { in: [MEDICO_ID] } }),
        }),
      );
    });

    it("un rol sin acotar (ADMIN) no filtra por medicoAfiliadoId", async () => {
      grantAdmin(prisma, "agenda.leer");
      prisma.agendaMedico.findMany.mockResolvedValue([]);

      const caller = agendaRouter.createCaller(makeCtx({ prisma }));
      await caller.list(undefined);

      const args = prisma.agendaMedico.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
      expect(args.where.medicoAfiliadoId).toBeUndefined();
    });
  });
});
