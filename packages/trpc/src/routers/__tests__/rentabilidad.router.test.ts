/**
 * Tests del rentabilidadRouter — CC-0036 Ola 6 (REQ-HIS-AFIL-001 S7,
 * US.AFIL.1.8). Cubre: gate de permiso, merge de filas mes x establecimiento
 * a totales por afiliado, cálculo de "afiliado inactivo comercialmente"
 * (AC4) y ocupación por consultorio (AC3, horas + cupos).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { rentabilidadRouter } from "../rentabilidad.router";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";

const MEDICO_ID = "00000000-0000-0000-0000-000000000100";
const CONSULTORIO_ID = "00000000-0000-0000-0000-000000000101";
const ESTABLECIMIENTO_ID = "00000000-0000-0000-0000-000000000102";
const AGENDA_ID = "00000000-0000-0000-0000-000000000103";

function grant(prisma: DeepMockProxy<PrismaClient>, permissionCode: string): void {
  prisma.role.findMany.mockResolvedValue([{ id: "r1", code: "ADMIN", inheritsFromRoleId: null }] as never);
  prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
  prisma.rolePermission.findMany.mockResolvedValue([
    { effect: "ALLOW", permission: { code: permissionCode } },
  ] as never);
}

function denyAll(prisma: DeepMockProxy<PrismaClient>): void {
  prisma.role.findMany.mockResolvedValue([] as never);
  prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
  prisma.rolePermission.findMany.mockResolvedValue([] as never);
}

const input = { desde: "2026-01-01", hasta: "2026-03-31" };

describe("rentabilidadRouter.tablero.porAfiliado", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  it("deniega sin el permiso tablero_afiliado.leer", async () => {
    denyAll(prisma);
    const caller = rentabilidadRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.tablero.porAfiliado(input)).rejects.toThrow(TRPCError);
  });

  it("US.AFIL.1.8 AC1 — agrega filas mes x establecimiento a un total por afiliado", async () => {
    grant(prisma, "tablero_afiliado.leer");
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        organization_id: "org-1",
        medico_afiliado_id: MEDICO_ID,
        establishment_id: ESTABLECIMIENTO_ID,
        period_month: "2026-01-01",
        renta_devengada: "500.00",
        renta_cobrada: "0.00",
        produccion_total: "1000.00",
        produccion_por_linea: { CONSULTA: "700.00", LABORATORIO: "300.00" },
        honorarios_devengados: "200.00",
        margen_contribucion: "800.00",
        calculado_en: "2026-04-01T00:00:00.000Z",
      },
      {
        organization_id: "org-1",
        medico_afiliado_id: MEDICO_ID,
        establishment_id: ESTABLECIMIENTO_ID,
        period_month: "2026-02-01",
        renta_devengada: "500.00",
        renta_cobrada: "0.00",
        produccion_total: "500.00",
        produccion_por_linea: { CONSULTA: "500.00" },
        honorarios_devengados: "100.00",
        margen_contribucion: "400.00",
        calculado_en: "2026-04-01T00:00:00.000Z",
      },
    ] as never);
    prisma.medicoAfiliado.findMany.mockResolvedValue([
      { id: MEDICO_ID, nombreCompleto: "Dr. Prueba", jvpmNumero: "1234", estado: "ACTIVO" },
    ] as never);
    prisma.contratoArrendamiento.findMany.mockResolvedValue([{ medicoAfiliadoId: MEDICO_ID }] as never);
    prisma.produccionMedica.groupBy.mockResolvedValue([
      { medicoAfiliadoId: MEDICO_ID, _max: { fecha: new Date() } },
    ] as never);

    const caller = rentabilidadRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.tablero.porAfiliado(input);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      medicoAfiliadoId: MEDICO_ID,
      rentaDevengada: 1000,
      produccionTotal: 1500,
      honorariosDevengados: 300,
      margenContribucion: 1200,
      produccionPorLinea: { CONSULTA: 1200, LABORATORIO: 300 },
      inactivoComercialmente: false,
    });
  });

  it("AC4 — marca inactivo comercialmente: contrato VIGENTE + última producción hace más de 90 días", async () => {
    grant(prisma, "tablero_afiliado.leer");
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        organization_id: "org-1",
        medico_afiliado_id: MEDICO_ID,
        establishment_id: ESTABLECIMIENTO_ID,
        period_month: "2026-01-01",
        renta_devengada: "500.00",
        renta_cobrada: "0.00",
        produccion_total: "0.00",
        produccion_por_linea: {},
        honorarios_devengados: "0.00",
        margen_contribucion: "0.00",
        calculado_en: "2026-04-01T00:00:00.000Z",
      },
    ] as never);
    prisma.medicoAfiliado.findMany.mockResolvedValue([
      { id: MEDICO_ID, nombreCompleto: "Dr. Prueba", jvpmNumero: "1234", estado: "ACTIVO" },
    ] as never);
    prisma.contratoArrendamiento.findMany.mockResolvedValue([{ medicoAfiliadoId: MEDICO_ID }] as never);
    const haceMasDe90Dias = new Date(Date.now() - 120 * 86_400_000);
    prisma.produccionMedica.groupBy.mockResolvedValue([
      { medicoAfiliadoId: MEDICO_ID, _max: { fecha: haceMasDe90Dias } },
    ] as never);

    const caller = rentabilidadRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.tablero.porAfiliado(input);

    expect(result[0].inactivoComercialmente).toBe(true);
  });

  it("AC4 — NO marca inactivo sin contrato vigente, aunque no haya producción reciente", async () => {
    grant(prisma, "tablero_afiliado.leer");
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        organization_id: "org-1",
        medico_afiliado_id: MEDICO_ID,
        establishment_id: ESTABLECIMIENTO_ID,
        period_month: "2026-01-01",
        renta_devengada: "0.00",
        renta_cobrada: "0.00",
        produccion_total: "100.00",
        produccion_por_linea: { CONSULTA: "100.00" },
        honorarios_devengados: "10.00",
        margen_contribucion: "90.00",
        calculado_en: "2026-04-01T00:00:00.000Z",
      },
    ] as never);
    prisma.medicoAfiliado.findMany.mockResolvedValue([
      { id: MEDICO_ID, nombreCompleto: "Dr. Prueba", jvpmNumero: "1234", estado: "ACTIVO" },
    ] as never);
    // Sin contrato VIGENTE.
    prisma.contratoArrendamiento.findMany.mockResolvedValue([] as never);
    const haceMasDe90Dias = new Date(Date.now() - 400 * 86_400_000);
    prisma.produccionMedica.groupBy.mockResolvedValue([
      { medicoAfiliadoId: MEDICO_ID, _max: { fecha: haceMasDe90Dias } },
    ] as never);

    const caller = rentabilidadRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.tablero.porAfiliado(input);

    expect(result[0].inactivoComercialmente).toBe(false);
  });

  it("sin filas de la matview en el período, devuelve lista vacía sin tocar MedicoAfiliado", async () => {
    grant(prisma, "tablero_afiliado.leer");
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    const caller = rentabilidadRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.tablero.porAfiliado(input);

    expect(result).toEqual([]);
    expect(prisma.medicoAfiliado.findMany).not.toHaveBeenCalled();
  });
});

describe("rentabilidadRouter.ocupacion.porConsultorio", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  it("US.AFIL.1.8 AC3 — calcula % horas contratadas/disponibles y % cupos usados/publicados", async () => {
    grant(prisma, "tablero_afiliado.leer");
    prisma.consultorio.findMany.mockResolvedValue([
      { id: CONSULTORIO_ID, codigo: "C-01", nombre: "Consultorio 1" },
    ] as never);
    // ContratoJornada: 10h/semana contratadas (lunes 08:00-18:00 -> 10h).
    prisma.contratoJornada.findMany.mockResolvedValue([
      {
        horaInicio: new Date("1970-01-01T08:00:00Z"),
        horaFin: new Date("1970-01-01T18:00:00Z"),
        contrato: { consultorioId: CONSULTORIO_ID },
      },
    ] as never);
    prisma.agendaMedico.findMany.mockResolvedValue([{ id: AGENDA_ID, consultorioId: CONSULTORIO_ID }] as never);
    // AgendaHorario: 20h/semana disponibles.
    prisma.agendaHorario.findMany.mockResolvedValue([
      {
        agendaId: AGENDA_ID,
        horaInicio: new Date("1970-01-01T08:00:00Z"),
        horaFin: new Date("1970-01-01T18:00:00Z"),
      },
      {
        agendaId: AGENDA_ID,
        horaInicio: new Date("1970-01-01T08:00:00Z"),
        horaFin: new Date("1970-01-01T18:00:00Z"),
      },
    ] as never);
    prisma.$queryRaw.mockResolvedValueOnce([{ capacidad: 40, ocupados: 10 }] as never);

    const caller = rentabilidadRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.ocupacion.porConsultorio(input);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      consultorioId: CONSULTORIO_ID,
      horasContratadasSemana: 10,
      horasDisponiblesSemana: 20,
      pctHorasContratadas: 0.5,
      cuposPublicados: 40,
      cuposUsados: 10,
      pctCuposUsados: 0.25,
    });
  });

  it("consultorio sin agendas/jornadas: porcentajes null, no división por cero", async () => {
    grant(prisma, "tablero_afiliado.leer");
    prisma.consultorio.findMany.mockResolvedValue([
      { id: CONSULTORIO_ID, codigo: "C-02", nombre: "Consultorio 2" },
    ] as never);
    prisma.contratoJornada.findMany.mockResolvedValue([] as never);
    prisma.agendaMedico.findMany.mockResolvedValue([] as never);
    prisma.agendaHorario.findMany.mockResolvedValue([] as never);

    const caller = rentabilidadRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.ocupacion.porConsultorio(input);

    expect(result[0]).toMatchObject({
      horasContratadasSemana: 0,
      horasDisponiblesSemana: 0,
      pctHorasContratadas: null,
      cuposPublicados: 0,
      cuposUsados: 0,
      pctCuposUsados: null,
    });
  });
});
