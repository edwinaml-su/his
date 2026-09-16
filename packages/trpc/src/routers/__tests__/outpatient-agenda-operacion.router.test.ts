/**
 * Tests de la operación de agenda (CC-0036 Ola 4, REQ-HIS-AFIL-001 S4,
 * US.AGE.2.4/2.5/2.6/2.7) sobre `outpatientRouter.appointment.*` — se
 * extiende `outpatient.router.ts` en vez de duplicar router (ver docstring
 * del archivo).
 *
 * Cubre: reserva feliz / duplicado / agenda suspendida / tope de sobrecupo /
 * carrera mapeada a CONFLICT; reprogramación (cadena consultable);
 * cancelación tardía; check-in idempotente y datos incompletos; revertir
 * no-show.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { outpatientRouter } from "../outpatient.router";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_USER_ADMIN } from "@his/test-utils";

const AGENDA_ID = "00000000-0000-0000-0000-0000000000a1";
const MEDICO_ID = "00000000-0000-0000-0000-0000000000a2";
const MEDICO_USER_ID = "00000000-0000-0000-0000-0000000000a3";
const CONSULTORIO_ID = "00000000-0000-0000-0000-0000000000a4";
const PATIENT_ID = "00000000-0000-0000-0000-0000000000a5";
const CITA_ID = "00000000-0000-0000-0000-0000000000a6";
const ESTABLISHMENT_ID = MOCK_TENANT.establishmentId!;

/** Otorga uno o más `permissionCode` al rol ADMIN (rol por defecto de MOCK_TENANT). */
function grantPermissions(prisma: DeepMockProxy<PrismaClient>, ...permissionCodes: string[]): void {
  prisma.role.findMany.mockResolvedValue([{ id: "r1", code: "ADMIN", inheritsFromRoleId: null }] as never);
  prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
  prisma.rolePermission.findMany.mockResolvedValue(
    permissionCodes.map((code) => ({ effect: "ALLOW", permission: { code } })) as never,
  );
}

function baseAgenda(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENDA_ID,
    establishmentId: ESTABLISHMENT_ID,
    medicoAfiliadoId: MEDICO_ID,
    consultorioId: CONSULTORIO_ID,
    estado: "PUBLICADA",
    duracionSlotMin: 20,
    sobrecupoMaximoDia: 2,
    medicoAfiliado: { id: MEDICO_ID, userId: MEDICO_USER_ID, nombreCompleto: "Dr. Prueba" },
    consultorio: { id: CONSULTORIO_ID, serviceUnitId: null },
    contrato: { estado: "VIGENTE" },
    ...overrides,
  };
}

describe("outpatientRouter — operación de agenda (Ola 4)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
    prisma.domainEvent.create.mockResolvedValue({ id: "00000000-0000-0000-0000-0000000000e1" } as never);
  });

  describe("appointment.reservar", () => {
    const slotInicio = new Date(Date.now() + 7 * 86_400_000);
    const baseInput = {
      agendaId: AGENDA_ID,
      patientId: PATIENT_ID,
      slotInicio,
      tipoCita: "PRIMERA_VEZ" as const,
      canal: "RECEPCION" as const,
    };

    it("deniega sin el permiso agenda.reservar", async () => {
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.appointment.reservar(baseInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("US.AGE.2.4 AC1 — reserva feliz: crea SCHEDULED y emite cita.reservada", async () => {
      grantPermissions(prisma, "agenda.reservar");
      prisma.agendaMedico.findFirst.mockResolvedValue(baseAgenda() as never);
      prisma.$queryRaw.mockResolvedValueOnce([
        { inicio: slotInicio, fin: new Date(slotInicio.getTime() + 20 * 60_000), capacidad: 1, ocupados: 0, disponible: 1 },
      ] as never);
      prisma.outpatientAppointment.findFirst.mockResolvedValueOnce(null as never); // sin duplicado
      prisma.outpatientAppointment.create.mockResolvedValue({
        id: CITA_ID,
        patientId: PATIENT_ID,
        providerId: MEDICO_USER_ID,
        scheduledAt: slotInicio,
      } as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.appointment.reservar(baseInput);

      expect(result.cita.id).toBe(CITA_ID);
      const createArgs = prisma.outpatientAppointment.create.mock.calls[0]![0];
      expect(createArgs.data.status).toBe("SCHEDULED");
      expect(createArgs.data.providerId).toBe(MEDICO_USER_ID);
      expect(createArgs.data.agendaId).toBe(AGENDA_ID);
      expect(prisma.domainEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: "cita.reservada", aggregateId: CITA_ID }),
        }),
      );
    });

    it("US.AGE.2.4 AC4 — duplicado mismo paciente+agenda+fecha exige confirmarDuplicado", async () => {
      grantPermissions(prisma, "agenda.reservar");
      prisma.agendaMedico.findFirst.mockResolvedValue(baseAgenda() as never);
      prisma.$queryRaw.mockResolvedValueOnce([
        { inicio: slotInicio, fin: new Date(slotInicio.getTime() + 20 * 60_000), capacidad: 1, ocupados: 0, disponible: 1 },
      ] as never);
      prisma.outpatientAppointment.findFirst.mockResolvedValueOnce({ id: "cita-existente" } as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.appointment.reservar(baseInput)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("US.AGE.2.4 AC6 — agenda SUSPENDIDA (mora) sin permiso reservar_suspendida rechaza", async () => {
      grantPermissions(prisma, "agenda.reservar");
      prisma.agendaMedico.findFirst.mockResolvedValue(
        baseAgenda({ contrato: { estado: "EN_MORA" } }) as never,
      );

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.appointment.reservar(baseInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("US.AGE.2.4 AC6 — agenda SUSPENDIDA con permiso + motivo permite reservar", async () => {
      grantPermissions(prisma, "agenda.reservar", "agenda.reservar_suspendida");
      prisma.agendaMedico.findFirst.mockResolvedValue(
        baseAgenda({ contrato: { estado: "EN_MORA" } }) as never,
      );
      prisma.$queryRaw.mockResolvedValueOnce([
        { inicio: slotInicio, fin: new Date(slotInicio.getTime() + 20 * 60_000), capacidad: 1, ocupados: 0, disponible: 1 },
      ] as never);
      prisma.outpatientAppointment.findFirst.mockResolvedValueOnce(null as never);
      prisma.outpatientAppointment.create.mockResolvedValue({ id: CITA_ID, patientId: PATIENT_ID, providerId: MEDICO_USER_ID, scheduledAt: slotInicio } as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.appointment.reservar({ ...baseInput, motivoReservarSuspendida: "Autorizado por gerencia" });
      expect(result.cita.id).toBe(CITA_ID);
    });

    it("US.AGE.2.5 AC4 — sobrecupo en el tope del día rechaza", async () => {
      grantPermissions(prisma, "agenda.reservar", "agenda.sobrecupo");
      prisma.agendaMedico.findFirst.mockResolvedValue(baseAgenda({ sobrecupoMaximoDia: 2 }) as never);
      prisma.outpatientAppointment.count.mockResolvedValue(2 as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.appointment.reservar({ ...baseInput, esSobrecupo: true, motivoSobrecupo: "Urgencia médica" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("US.AGE.2.4 AC3 — carrera (EXCLUDE) se mapea a mensaje de cupo ocupado", async () => {
      grantPermissions(prisma, "agenda.reservar");
      prisma.agendaMedico.findFirst.mockResolvedValue(baseAgenda() as never);
      prisma.$queryRaw.mockResolvedValueOnce([
        { inicio: slotInicio, fin: new Date(slotInicio.getTime() + 20 * 60_000), capacidad: 1, ocupados: 0, disponible: 1 },
      ] as never);
      prisma.outpatientAppointment.findFirst.mockResolvedValueOnce(null as never);
      prisma.outpatientAppointment.create.mockRejectedValue(
        new Error('conflicting key value violates exclusion constraint "excl_cita_medico"'),
      );

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.appointment.reservar(baseInput)).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("médico afiliado sin userId (D5) rechaza con PRECONDITION_FAILED", async () => {
      grantPermissions(prisma, "agenda.reservar");
      prisma.agendaMedico.findFirst.mockResolvedValue(
        baseAgenda({ medicoAfiliado: { id: MEDICO_ID, userId: null, nombreCompleto: "Dr. Sin Cuenta" } }) as never,
      );

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.appointment.reservar(baseInput)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  describe("appointment.reprogramar", () => {
    const slotInicio = new Date(Date.now() + 10 * 86_400_000);

    it("US.AGE.2.5 AC1 — original -> CANCELLED (REPROGRAMADA), nueva con reprogramadaDeId", async () => {
      grantPermissions(prisma, "agenda.reprogramar");
      prisma.outpatientAppointment.findFirst.mockResolvedValueOnce({
        id: CITA_ID,
        status: "SCHEDULED",
        patientId: PATIENT_ID,
        reason: null,
        reasonCategory: null,
        tipoCita: "PRIMERA_VEZ",
        canal: "RECEPCION",
        tipoCuentaId: null,
        insurerId: null,
      } as never);
      prisma.agendaMedico.findFirst.mockResolvedValue(baseAgenda() as never);
      prisma.$queryRaw.mockResolvedValueOnce([
        { inicio: slotInicio, fin: new Date(slotInicio.getTime() + 20 * 60_000), capacidad: 1, ocupados: 0, disponible: 1 },
      ] as never);
      const NUEVA_CITA_ID = "00000000-0000-0000-0000-0000000000b1";
      prisma.outpatientAppointment.create.mockResolvedValue({
        id: NUEVA_CITA_ID,
        patientId: PATIENT_ID,
        providerId: MEDICO_USER_ID,
        scheduledAt: slotInicio,
        tipoCita: "PRIMERA_VEZ",
        canal: "RECEPCION",
      } as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.appointment.reprogramar({ id: CITA_ID, agendaId: AGENDA_ID, slotInicio, motivo: "Paciente lo pidió" });

      expect(result.original.status).toBe("CANCELLED");
      expect(result.nueva.id).toBe(NUEVA_CITA_ID);
      expect(prisma.outpatientAppointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CITA_ID },
          data: expect.objectContaining({ status: "CANCELLED", motivoCancelacion: "REPROGRAMADA" }),
        }),
      );
      const createArgs = prisma.outpatientAppointment.create.mock.calls[0]![0];
      expect(createArgs.data.reprogramadaDeId).toBe(CITA_ID);
    });

    it("no reprograma una cita COMPLETED (AC6, terminal)", async () => {
      grantPermissions(prisma, "agenda.reprogramar");
      prisma.outpatientAppointment.findFirst.mockResolvedValueOnce({ id: CITA_ID, status: "COMPLETED" } as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.appointment.reprogramar({ id: CITA_ID, agendaId: AGENDA_ID, slotInicio }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("appointment.reprogramacionChain", () => {
    it("reconstruye la cadena hacia atrás y hacia adelante", async () => {
      const idA = "00000000-0000-0000-0000-0000000000c1";
      const idB = "00000000-0000-0000-0000-0000000000c2";
      const idC = "00000000-0000-0000-0000-0000000000c3";
      const A = { id: idA, reprogramadaDeId: null };
      const B = { id: idB, reprogramadaDeId: idA };
      const C = { id: idC, reprogramadaDeId: idB };

      prisma.outpatientAppointment.findFirst.mockImplementation(((args: unknown) => {
        const where = (args as { where: { id?: string; reprogramadaDeId?: string } }).where;
        if (where.id === idB) return Promise.resolve(B);
        if (where.id === idA) return Promise.resolve(A);
        if (where.reprogramadaDeId === idB) return Promise.resolve(C);
        if (where.reprogramadaDeId === idC) return Promise.resolve(null);
        return Promise.resolve(null);
      }) as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const chain = await caller.appointment.reprogramacionChain({ id: idB });
      expect(chain.map((c) => c.id)).toEqual([idA, idB, idC]);
    });
  });

  describe("appointment.cancelar", () => {
    it("US.AGE.2.5 AC2 — cancelación con menos de politicaCancelacionHoras marca tardia=true", async () => {
      grantPermissions(prisma, "agenda.cancelar");
      const scheduledAt = new Date(Date.now() + 2 * 3_600_000); // en 2h
      prisma.outpatientAppointment.findFirst.mockResolvedValue({
        id: CITA_ID,
        status: "SCHEDULED",
        patientId: PATIENT_ID,
        agendaId: AGENDA_ID,
        scheduledAt,
        establishmentId: ESTABLISHMENT_ID,
      } as never);
      prisma.agendaMedico.findFirst.mockResolvedValue({ politicaCancelacionHoras: 24 } as never);
      prisma.listaEspera.findMany.mockResolvedValue([] as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.appointment.cancelar({ id: CITA_ID, motivo: "PACIENTE_NO_PUEDE" });

      expect(result.tardia).toBe(true);
      expect(prisma.domainEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ eventType: "cita.cancelada" }) }),
      );
    });

    it("US.AGE.2.5 AC3 — libera cupo y notifica al primero en ListaEspera", async () => {
      grantPermissions(prisma, "agenda.cancelar");
      const scheduledAt = new Date(Date.now() + 48 * 3_600_000);
      prisma.outpatientAppointment.findFirst.mockResolvedValue({
        id: CITA_ID,
        status: "SCHEDULED",
        patientId: PATIENT_ID,
        agendaId: AGENDA_ID,
        scheduledAt,
        establishmentId: ESTABLISHMENT_ID,
      } as never);
      prisma.agendaMedico.findFirst.mockResolvedValue({ politicaCancelacionHoras: 24 } as never);
      const LISTA_ESPERA_ID = "00000000-0000-0000-0000-0000000000d1";
      prisma.listaEspera.findMany.mockResolvedValue([
        { id: LISTA_ESPERA_ID, patientId: "00000000-0000-0000-0000-0000000000d2", prioridad: "NORMAL", createdAt: new Date() },
      ] as never);
      prisma.patient.findFirst.mockResolvedValue({ firstName: "Ana", lastName: "Pérez", mrn: "MRN-9" } as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.appointment.cancelar({ id: CITA_ID, motivo: "MEDICO_NO_DISPONIBLE" });

      expect(prisma.listaEspera.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: LISTA_ESPERA_ID }, data: expect.objectContaining({ estado: "CONTACTADO" }) }),
      );
      expect(prisma.domainEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ eventType: "task.action_required" }) }),
      );
    });

    it("no cancela una cita ya CANCELLED", async () => {
      grantPermissions(prisma, "agenda.cancelar");
      prisma.outpatientAppointment.findFirst.mockResolvedValue({ id: CITA_ID, status: "CANCELLED" } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.appointment.cancelar({ id: CITA_ID, motivo: "OTRO" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("appointment.checkIn", () => {
    it("US.AGE.2.6 AC3 — idempotente: cita ya con encounterId no vuelve a crear nada", async () => {
      grantPermissions(prisma, "agenda.reservar");
      prisma.outpatientAppointment.findFirst.mockResolvedValue({
        id: CITA_ID,
        encounterId: "encounter-existente",
        status: "CHECKED_IN",
      } as never);
      prisma.patientAccount.findFirst.mockResolvedValue({ id: "cuenta-1", numeroCuenta: "CTA00001" } as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.appointment.checkIn({ id: CITA_ID });

      expect(result.yaExistia).toBe(true);
      expect(result.encounterId).toBe("encounter-existente");
      expect(prisma.encounter.create).not.toHaveBeenCalled();
      expect(prisma.patientAccount.create).not.toHaveBeenCalled();
    });

    it("US.AGE.2.6 AC4 — datos incompletos del paciente bloquea el check-in", async () => {
      grantPermissions(prisma, "agenda.reservar");
      prisma.outpatientAppointment.findFirst.mockResolvedValue({
        id: CITA_ID,
        encounterId: null,
        status: "SCHEDULED",
        patientId: PATIENT_ID,
        tipoCuentaId: null,
        establishmentId: ESTABLISHMENT_ID,
        serviceUnitId: null,
        consultorioId: null,
        notes: null,
      } as never);
      prisma.patient.findFirst.mockResolvedValue({
        id: PATIENT_ID,
        birthDate: null, // incompleto
        traeDocumento: true,
        documentType: null,
        documentNumber: null,
      } as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.appointment.checkIn({ id: CITA_ID })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(prisma.encounter.create).not.toHaveBeenCalled();
    });

    it("US.AGE.2.6 AC1/AC2 — crea Encounter + PatientAccount y marca CHECKED_IN", async () => {
      grantPermissions(prisma, "agenda.reservar");
      prisma.outpatientAppointment.findFirst.mockResolvedValue({
        id: CITA_ID,
        encounterId: null,
        status: "SCHEDULED",
        patientId: PATIENT_ID,
        tipoCuentaId: "tipo-cuenta-1",
        establishmentId: ESTABLISHMENT_ID,
        serviceUnitId: null,
        consultorioId: null,
        notes: null,
      } as never);
      prisma.patient.findFirst.mockResolvedValue({
        id: PATIENT_ID,
        birthDate: new Date("1990-01-01"),
        traeDocumento: true,
        documentType: "DUI",
        documentNumber: "12345678-9",
        mrn: "MRN-77",
      } as never);
      prisma.organization.findUnique.mockResolvedValue({
        functionalCurrency: "00000000-0000-0000-0000-0000000000c1",
        countryId: MOCK_TENANT.countryId,
      } as never);
      prisma.encounter.count.mockResolvedValue(0 as never);
      prisma.encounter.create.mockResolvedValue({ id: "encounter-nuevo", admittedAt: new Date() } as never);
      prisma.patientAccount.create.mockResolvedValue({ id: "cuenta-nueva", numeroCuenta: "CTA00042" } as never);
      // Orden real de $queryRaw dentro de realizarCheckIn->crearEncounterAmbulatorio:
      //   1) resolveEceEstablecimientoId  2) hookEceEpisodioAfterAdmit (idempotencia)  3) nextCuenta
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: "ece-estab-1" }] as never)
        .mockResolvedValueOnce([{ id: "episodio-existente" }] as never)
        .mockResolvedValueOnce([{ n: 42 }] as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.appointment.checkIn({ id: CITA_ID });

      expect(result.yaExistia).toBe(false);
      expect(result.encounterId).toBe("encounter-nuevo");
      expect(result.cuentaId).toBe("cuenta-nueva");
      expect(prisma.outpatientAppointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CITA_ID },
          data: expect.objectContaining({ status: "CHECKED_IN", encounterId: "encounter-nuevo" }),
        }),
      );
    });
  });

  describe("appointment.revertirNoShow", () => {
    it("US.AGE.2.7 AC2 — revierte NO_SHOW a CHECKED_IN con motivo trazado", async () => {
      grantPermissions(prisma, "agenda.reservar");
      prisma.outpatientAppointment.findFirst.mockResolvedValue({
        id: CITA_ID,
        status: "NO_SHOW",
        patientId: PATIENT_ID,
        tipoCuentaId: null,
        establishmentId: ESTABLISHMENT_ID,
        serviceUnitId: null,
        consultorioId: null,
        notes: null,
      } as never);
      prisma.patient.findFirst.mockResolvedValue({
        id: PATIENT_ID,
        birthDate: new Date("1990-01-01"),
        traeDocumento: false,
        documentType: null,
        documentNumber: null,
        mrn: "MRN-88",
      } as never);
      prisma.organization.findUnique.mockResolvedValue({
        functionalCurrency: "00000000-0000-0000-0000-0000000000c1",
        countryId: MOCK_TENANT.countryId,
      } as never);
      prisma.encounter.count.mockResolvedValue(0 as never);
      prisma.encounter.create.mockResolvedValue({ id: "encounter-tardio", admittedAt: new Date() } as never);
      prisma.patientAccount.create.mockResolvedValue({ id: "cuenta-tardia", numeroCuenta: "CTA00043" } as never);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: "ece-estab-1" }] as never)
        .mockResolvedValueOnce([{ id: "episodio-existente" }] as never)
        .mockResolvedValueOnce([{ n: 43 }] as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.appointment.revertirNoShow({ id: CITA_ID, motivo: "Llegó tarde, se atiende igual" });

      expect(result.encounterId).toBe("encounter-tardio");
      const updateArgs = prisma.outpatientAppointment.update.mock.calls[0]![0];
      expect(updateArgs.data.status).toBe("CHECKED_IN");
      expect(String(updateArgs.data.notes)).toContain("Revertido de NO_SHOW");
    });

    it("rechaza revertir una cita que no está en NO_SHOW", async () => {
      grantPermissions(prisma, "agenda.reservar");
      prisma.outpatientAppointment.findFirst.mockResolvedValue({ id: CITA_ID, status: "SCHEDULED" } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.appointment.revertirNoShow({ id: CITA_ID, motivo: "x" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("appointment.completar", () => {
    it("US.AGE.2.6 AC5 (fallback manual) — CHECKED_IN -> COMPLETED con finAtencionAt", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue({ id: CITA_ID, status: "CHECKED_IN" } as never);
      prisma.outpatientAppointment.update.mockResolvedValue({ id: CITA_ID, status: "COMPLETED" } as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.appointment.completar({ id: CITA_ID });

      expect(prisma.outpatientAppointment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }),
      );
    });

    it("no completa una cita que no está CHECKED_IN", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue({ id: CITA_ID, status: "SCHEDULED" } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.appointment.completar({ id: CITA_ID })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("listaEspera.create", () => {
    it("US.AGE.2.4 AC7 — inscribe al paciente cuando no hay cupos", async () => {
      grantPermissions(prisma, "agenda.reservar");
      prisma.agendaMedico.findFirst.mockResolvedValue({ id: AGENDA_ID } as never);
      prisma.listaEspera.create.mockResolvedValue({ id: "le-nueva", estado: "ESPERANDO" } as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.listaEspera.create({ agendaId: AGENDA_ID, patientId: PATIENT_ID });
      expect(result.estado).toBe("ESPERANDO");
    });
  });

  describe("tablero.dia", () => {
    it("US.AGE.2.7 AC3 — agrupa citas del día en los 6 buckets", async () => {
      grantPermissions(prisma, "agenda.leer");
      const hoy = "2026-10-01";
      prisma.outpatientAppointment.findMany.mockResolvedValue([
        { id: "1", status: "SCHEDULED", esSobrecupo: false, consultorioId: null, medicoAfiliadoId: null, scheduledAt: new Date(), llegadaAt: null, inicioAtencionAt: null, patient: { firstName: "A", lastName: "B", mrn: "M1" }, patientId: "p1" },
        { id: "2", status: "CHECKED_IN", esSobrecupo: false, consultorioId: null, medicoAfiliadoId: null, scheduledAt: new Date(), llegadaAt: new Date(), inicioAtencionAt: null, patient: { firstName: "C", lastName: "D", mrn: "M2" }, patientId: "p2" },
        { id: "3", status: "CHECKED_IN", esSobrecupo: false, consultorioId: null, medicoAfiliadoId: null, scheduledAt: new Date(), llegadaAt: new Date(), inicioAtencionAt: new Date(), patient: { firstName: "E", lastName: "F", mrn: "M3" }, patientId: "p3" },
        { id: "4", status: "COMPLETED", esSobrecupo: false, consultorioId: null, medicoAfiliadoId: null, scheduledAt: new Date(), llegadaAt: new Date(), inicioAtencionAt: new Date(), patient: { firstName: "G", lastName: "H", mrn: "M4" }, patientId: "p4" },
        { id: "5", status: "NO_SHOW", esSobrecupo: false, consultorioId: null, medicoAfiliadoId: null, scheduledAt: new Date(), llegadaAt: null, inicioAtencionAt: null, patient: { firstName: "I", lastName: "J", mrn: "M5" }, patientId: "p5" },
        { id: "6", status: "SCHEDULED", esSobrecupo: true, consultorioId: null, medicoAfiliadoId: null, scheduledAt: new Date(), llegadaAt: null, inicioAtencionAt: null, patient: { firstName: "K", lastName: "L", mrn: "M6" }, patientId: "p6" },
      ] as never);

      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.tablero.dia({ fecha: hoy });

      expect(result.resumen).toEqual({
        programadas: 2,
        llegadas: 1,
        enAtencion: 1,
        completadas: 1,
        noShow: 1,
        sobrecupos: 1,
      });
      expect(result.items).toHaveLength(6);
    });
  });
});
