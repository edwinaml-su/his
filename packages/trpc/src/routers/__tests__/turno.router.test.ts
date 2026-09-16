/**
 * Tests unitarios — turnoRouter (CC-0036 Ola 1A, Bloque C de REQ-HIS-AFIL-001).
 *
 * Cobertura: gates RBAC (turno.leer/programar/publicar/sustituir), dotación
 * descubierta al publicar (US.AFIL.1.10.4), advertencia bloqueante >24h
 * continuas (US.AFIL.1.10.3), traslape/duplicado en `asignacion.asignar`, y
 * sustitución (US.AFIL.1.10.5). Mismo patrón que `room.router.test.ts` +
 * `user-admin-reset-password.test.ts` (grant de permisos vía mock de
 * `role`/`rolePermission`).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@his/database";
import { turnoRouter } from "../turno.router";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const ESTABLISHMENT_ID = MOCK_TENANT.establishmentId!;
const PROGRAMACION_ID = "00000000-0000-0000-0000-0000000000f1";
const PLANTILLA_ID = "00000000-0000-0000-0000-0000000000f2";
const USER_ID_A = "00000000-0000-0000-0000-0000000000f3";
const USER_ID_B = "00000000-0000-0000-0000-0000000000f4";

/** Espejo del grant sql/243 §3: JEFE_MEDICO_SEDE -> turno.* completo. */
function grantTurnoPermissions(prisma: DeepMockProxy<PrismaClient>, permCodes: string[]) {
  prisma.role.findMany.mockResolvedValue([
    { id: "role-jefe", code: "JEFE_MEDICO_SEDE", inheritsFromRoleId: null },
  ] as never);
  prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
  prisma.rolePermission.findMany.mockResolvedValue(
    permCodes.map((code) => ({ effect: "ALLOW", permission: { code } })) as never,
  );
}

function caller(prisma: DeepMockProxy<PrismaClient>) {
  return turnoRouter.createCaller(makeCtx({ prisma }));
}

describe("turnoRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  describe("gates RBAC", () => {
    it("plantilla.create rechaza sin permiso turno.programar (FORBIDDEN)", async () => {
      await expect(
        caller(prisma).plantilla.create({
          establishmentId: ESTABLISHMENT_ID,
          codigo: "T-DIA",
          nombre: "Diurno",
          horaInicio: "07:00",
          horaFin: "19:00",
          tipo: "MEDICO_GENERAL",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("plantilla.list rechaza sin permiso turno.leer (FORBIDDEN)", async () => {
      await expect(caller(prisma).plantilla.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("plantilla.create", () => {
    it("crea sin enviar cruzaMedianoche (columna GENERATED, sql/243)", async () => {
      grantTurnoPermissions(prisma, ["turno.programar"]);
      prisma.plantillaTurno.create.mockResolvedValue({ id: PLANTILLA_ID } as never);

      await caller(prisma).plantilla.create({
        establishmentId: ESTABLISHMENT_ID,
        codigo: "T-DIA",
        nombre: "Diurno",
        horaInicio: "07:00",
        horaFin: "19:00",
        tipo: "MEDICO_GENERAL",
      });

      const data = prisma.plantillaTurno.create.mock.calls[0]![0].data as Record<string, unknown>;
      expect(data).not.toHaveProperty("cruzaMedianoche");
      expect(data).toMatchObject({ organizationId: MOCK_TENANT.organizationId, codigo: "T-DIA" });
    });

    it("traduce el código duplicado (P2002) a CONFLICT", async () => {
      grantTurnoPermissions(prisma, ["turno.programar"]);
      prisma.plantillaTurno.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "5.22.0",
        }) as never,
      );

      await expect(
        caller(prisma).plantilla.create({
          establishmentId: ESTABLISHMENT_ID,
          codigo: "T-DIA",
          nombre: "Diurno",
          horaInicio: "07:00",
          horaFin: "19:00",
          tipo: "MEDICO_GENERAL",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("plantilla.setActive", () => {
    it("US.AFIL.1.9.3 — impide desactivar con asignaciones futuras vigentes", async () => {
      grantTurnoPermissions(prisma, ["turno.programar"]);
      prisma.plantillaTurno.findFirst.mockResolvedValue({
        id: PLANTILLA_ID,
        active: true,
      } as never);
      prisma.asignacionTurno.count.mockResolvedValue(3 as never);

      await expect(
        caller(prisma).plantilla.setActive({ id: PLANTILLA_ID, active: false }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(prisma.plantillaTurno.update).not.toHaveBeenCalled();
    });

    it("desactiva cuando no hay asignaciones futuras", async () => {
      grantTurnoPermissions(prisma, ["turno.programar"]);
      prisma.plantillaTurno.findFirst.mockResolvedValue({
        id: PLANTILLA_ID,
        active: true,
      } as never);
      prisma.asignacionTurno.count.mockResolvedValue(0 as never);
      prisma.plantillaTurno.update.mockResolvedValue({ id: PLANTILLA_ID, active: false } as never);

      const result = await caller(prisma).plantilla.setActive({ id: PLANTILLA_ID, active: false });
      expect(result).toMatchObject({ active: false });
    });
  });

  describe("programacion.publicar — US.AFIL.1.10.4 (dotación descubierta)", () => {
    const periodo = {
      id: PROGRAMACION_ID,
      establishmentId: ESTABLISHMENT_ID,
      estado: "BORRADOR",
      periodoDesde: new Date("2026-10-01T00:00:00Z"),
      periodoHasta: new Date("2026-10-01T00:00:00Z"),
    };

    it("bloquea con PRECONDITION_FAILED si hay dotación descubierta sin motivo/permiso", async () => {
      grantTurnoPermissions(prisma, ["turno.publicar"]); // sin turno.autorizar_descubierto
      prisma.programacionTurno.findFirst.mockResolvedValue(periodo as never);
      prisma.plantillaTurno.findMany.mockResolvedValue([
        { id: PLANTILLA_ID, nombre: "Diurno", dotacionRequerida: 1 },
      ] as never);
      prisma.asignacionTurno.findMany.mockResolvedValue([] as never); // 0 asignaciones -> shortfall

      await expect(caller(prisma).programacion.publicar({ id: PROGRAMACION_ID })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(prisma.programacionTurno.update).not.toHaveBeenCalled();
    });

    it("publica con dotación descubierta cuando hay motivo + permiso turno.autorizar_descubierto", async () => {
      grantTurnoPermissions(prisma, ["turno.publicar", "turno.autorizar_descubierto"]);
      prisma.programacionTurno.findFirst.mockResolvedValue(periodo as never);
      prisma.plantillaTurno.findMany.mockResolvedValue([
        { id: PLANTILLA_ID, nombre: "Diurno", dotacionRequerida: 1 },
      ] as never);
      prisma.asignacionTurno.findMany.mockResolvedValue([] as never);
      prisma.programacionTurno.update.mockResolvedValue({ id: PROGRAMACION_ID, estado: "PUBLICADA" } as never);

      const result = await caller(prisma).programacion.publicar({
        id: PROGRAMACION_ID,
        autorizaDescubiertoMotivo: "Falta de personal — cubierto por guardia telefónica",
      });
      expect(result).toMatchObject({ estado: "PUBLICADA" });
      const data = prisma.programacionTurno.update.mock.calls[0]![0].data as Record<string, unknown>;
      expect(data).toMatchObject({ estado: "PUBLICADA", autorizaDescubiertoMotivo: expect.any(String) });
    });

    it("publica sin trabas cuando la dotación está completa", async () => {
      grantTurnoPermissions(prisma, ["turno.publicar"]);
      prisma.programacionTurno.findFirst.mockResolvedValue(periodo as never);
      prisma.plantillaTurno.findMany.mockResolvedValue([
        { id: PLANTILLA_ID, nombre: "Diurno", dotacionRequerida: 1 },
      ] as never);
      prisma.asignacionTurno.findMany.mockResolvedValue([
        { plantillaTurnoId: PLANTILLA_ID, fecha: new Date("2026-10-01T00:00:00Z") },
      ] as never);
      prisma.programacionTurno.update.mockResolvedValue({ id: PROGRAMACION_ID, estado: "PUBLICADA" } as never);

      const result = await caller(prisma).programacion.publicar({ id: PROGRAMACION_ID });
      expect(result).toMatchObject({ estado: "PUBLICADA" });
    });

    it("rechaza publicar una programación que no está en BORRADOR", async () => {
      grantTurnoPermissions(prisma, ["turno.publicar"]);
      prisma.programacionTurno.findFirst.mockResolvedValue({ ...periodo, estado: "PUBLICADA" } as never);

      await expect(caller(prisma).programacion.publicar({ id: PROGRAMACION_ID })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  describe("asignacion.asignar", () => {
    const programacionBorrador = {
      id: PROGRAMACION_ID,
      establishmentId: ESTABLISHMENT_ID,
      estado: "BORRADOR",
    };
    const plantillaDiurna = {
      id: PLANTILLA_ID,
      establishmentId: ESTABLISHMENT_ID,
      active: true,
      horaInicio: new Date("1970-01-01T07:00:00Z"),
      horaFin: new Date("1970-01-01T19:00:00Z"),
      cruzaMedianoche: false,
    };

    it("rechaza el traslape del mismo usuario (EXCLUDE) con CONFLICT", async () => {
      grantTurnoPermissions(prisma, ["turno.programar"]);
      prisma.programacionTurno.findFirst.mockResolvedValue(programacionBorrador as never);
      prisma.plantillaTurno.findFirst.mockResolvedValue(plantillaDiurna as never);
      prisma.asignacionTurno.findMany.mockResolvedValue([] as never); // sin vecinos para el chequeo de 24h
      prisma.asignacionTurno.create.mockRejectedValue(
        new Error('conflicting key value violates exclusion constraint "excl_asignacion_turno_traslape"'),
      );

      await expect(
        caller(prisma).asignacion.asignar({
          programacionId: PROGRAMACION_ID,
          plantillaTurnoId: PLANTILLA_ID,
          userId: USER_ID_A,
          fecha: "2026-10-01",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("US.AFIL.1.10.3 — bloquea con PRECONDITION_FAILED si supera 24h continuas sin justificación", async () => {
      grantTurnoPermissions(prisma, ["turno.programar"]);
      prisma.programacionTurno.findFirst.mockResolvedValue(programacionBorrador as never);
      prisma.plantillaTurno.findFirst.mockResolvedValue(plantillaDiurna as never);
      // plantillaDiurna 07:00-19:00 America/El_Salvador (UTC-6) => instantes
      // reales 2026-10-01T13:00:00Z .. 2026-10-02T01:00:00Z (12h). Turno
      // vecino que termina justo cuando empieza el nuevo (18h) => cadena de
      // 30h > 24h.
      prisma.asignacionTurno.findMany.mockResolvedValue([
        {
          inicioProgramado: new Date("2026-09-30T19:00:00Z"),
          finProgramado: new Date("2026-10-01T13:00:00Z"),
        },
      ] as never);

      await expect(
        caller(prisma).asignacion.asignar({
          programacionId: PROGRAMACION_ID,
          plantillaTurnoId: PLANTILLA_ID,
          userId: USER_ID_A,
          fecha: "2026-10-01",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(prisma.asignacionTurno.create).not.toHaveBeenCalled();
    });

    it("permite >24h continuas cuando se envía justificacion24h", async () => {
      grantTurnoPermissions(prisma, ["turno.programar"]);
      prisma.programacionTurno.findFirst.mockResolvedValue(programacionBorrador as never);
      prisma.plantillaTurno.findFirst.mockResolvedValue(plantillaDiurna as never);
      prisma.asignacionTurno.findMany.mockResolvedValue([
        {
          inicioProgramado: new Date("2026-09-30T19:00:00Z"),
          finProgramado: new Date("2026-10-01T13:00:00Z"),
        },
      ] as never);
      prisma.asignacionTurno.create.mockResolvedValue({ id: "00000000-0000-0000-0000-0000000000f5" } as never);

      const result = await caller(prisma).asignacion.asignar({
        programacionId: PROGRAMACION_ID,
        plantillaTurnoId: PLANTILLA_ID,
        userId: USER_ID_A,
        fecha: "2026-10-01",
        justificacion24h: "Cobertura de emergencia — sin relevo disponible",
      });
      expect(result).toMatchObject({ id: "00000000-0000-0000-0000-0000000000f5" });
    });

    it("rechaza asignar fuera de BORRADOR", async () => {
      grantTurnoPermissions(prisma, ["turno.programar"]);
      prisma.programacionTurno.findFirst.mockResolvedValue({ ...programacionBorrador, estado: "PUBLICADA" } as never);

      await expect(
        caller(prisma).asignacion.asignar({
          programacionId: PROGRAMACION_ID,
          plantillaTurnoId: PLANTILLA_ID,
          userId: USER_ID_A,
          fecha: "2026-10-01",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("asignacion.sustituir — US.AFIL.1.10.5", () => {
    it("rechaza sin permiso turno.sustituir (FORBIDDEN)", async () => {
      await expect(
        caller(prisma).asignacion.sustituir({ id: "00000000-0000-0000-0000-0000000000f5", sustitutoUserId: USER_ID_B, motivo: "Enfermedad" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("sustituye un turno vigente de una programación PUBLICADA", async () => {
      grantTurnoPermissions(prisma, ["turno.sustituir"]);
      prisma.asignacionTurno.findFirst.mockResolvedValue({
        id: "00000000-0000-0000-0000-0000000000f5",
        estado: "PROGRAMADO",
        inicioProgramado: new Date("2026-10-01T07:00:00Z"),
        programacion: { estado: "PUBLICADA", establishmentId: ESTABLISHMENT_ID },
        plantillaTurno: { nombre: "Diurno", tipo: "MEDICO_GENERAL" },
      } as never);
      prisma.asignacionTurno.update.mockResolvedValue({
        id: "00000000-0000-0000-0000-0000000000f5",
        estado: "SUSTITUIDO",
        sustitutoUserId: USER_ID_B,
        inicioProgramado: new Date("2026-10-01T07:00:00Z"),
      } as never);

      const result = await caller(prisma).asignacion.sustituir({
        id: "00000000-0000-0000-0000-0000000000f5",
        sustitutoUserId: USER_ID_B,
        motivo: "Enfermedad",
      });
      expect(result).toMatchObject({ estado: "SUSTITUIDO", sustitutoUserId: USER_ID_B });
    });

    it("rechaza sustituir un turno de una programación no PUBLICADA", async () => {
      grantTurnoPermissions(prisma, ["turno.sustituir"]);
      prisma.asignacionTurno.findFirst.mockResolvedValue({
        id: "00000000-0000-0000-0000-0000000000f5",
        estado: "PROGRAMADO",
        programacion: { estado: "BORRADOR", establishmentId: ESTABLISHMENT_ID },
        plantillaTurno: { nombre: "Diurno", tipo: "MEDICO_GENERAL" },
      } as never);

      await expect(
        caller(prisma).asignacion.sustituir({ id: "00000000-0000-0000-0000-0000000000f5", sustitutoUserId: USER_ID_B, motivo: "Enfermedad" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("medicoDeTurno — US.AFIL.1.11", () => {
    it("invoca fn_medico_de_turno con el establishmentId dado", async () => {
      grantTurnoPermissions(prisma, ["turno.leer"]);
      prisma.establishment.findFirst.mockResolvedValue({ id: ESTABLISHMENT_ID } as never);
      prisma.$queryRaw.mockResolvedValue([
        { userId: USER_ID_A, fullName: "Dr. Prueba", plantillaTurnoId: PLANTILLA_ID, tipo: "MEDICO_GENERAL" },
      ] as never);

      const result = await caller(prisma).medicoDeTurno({ establishmentId: ESTABLISHMENT_ID });
      expect(result).toHaveLength(1);
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it("rechaza con FORBIDDEN un establishmentId de otra organización (fuga cross-tenant)", async () => {
      grantTurnoPermissions(prisma, ["turno.leer"]);
      prisma.establishment.findFirst.mockResolvedValue(null as never); // no pertenece a la org del tenant

      await expect(
        caller(prisma).medicoDeTurno({ establishmentId: "00000000-0000-0000-0000-0000000000f9" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
