/**
 * Tests del honorarioRouter — CC-0036 Ola 5 (REQ-HIS-AFIL-001 S6,
 * US.AFIL.1.5/1.6/1.7). Cubre: generar-reemplaza-BORRADOR, prorrateo de
 * compensación sin neto negativo, aprobar inmutable + segregación
 * generador≠aprobador, y anular devuelve producción a PENDIENTE.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { honorarioRouter } from "../honorario.router";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_USER_ADMIN, MOCK_USER_TRIAGIST } from "@his/test-utils";

const AFILIADO_ID = "00000000-0000-0000-0000-000000000090";
const CONVENIO_ID = "00000000-0000-0000-0000-000000000091";
const LIQUIDACION_ID = "00000000-0000-0000-0000-000000000092";
const CURRENCY_ID = "00000000-0000-0000-0000-000000000093";
const PRODUCCION_ID = "00000000-0000-0000-0000-000000000094";
const CARGO_HONORARIO_ID = "00000000-0000-0000-0000-000000000095";

function grant(prisma: DeepMockProxy<PrismaClient>, permissionCode: string): void {
  prisma.role.findMany.mockResolvedValue([
    { id: "r1", code: "ADMIN", inheritsFromRoleId: null },
  ] as never);
  prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
  prisma.rolePermission.findMany.mockResolvedValue([
    { effect: "ALLOW", permission: { code: permissionCode } },
  ] as never);
}

function dec(n: number): { toNumber: () => number } {
  return { toNumber: () => n };
}

describe("honorarioRouter.liquidacion.generar", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
    prisma.$queryRaw.mockResolvedValue([{ n: 1 }] as never);
    prisma.medicoAfiliado.findFirst.mockResolvedValue({ id: AFILIADO_ID, permiteCompensacion: true } as never);
    prisma.convenioHonorario.findFirst.mockResolvedValue({ retencionRentaPct: dec(0.1) } as never);
    prisma.contratoArrendamiento.findFirst.mockResolvedValue({ currencyId: CURRENCY_ID } as never);
    prisma.contratoCargo.findMany.mockResolvedValue([] as never);
    prisma.liquidacion.create.mockResolvedValue({ id: LIQUIDACION_ID, folio: "LIQ-000001" } as never);
  });

  const input = { medicoAfiliadoId: AFILIADO_ID, periodoDesde: "2026-09-01", periodoHasta: "2026-09-30" };

  it("US.AFIL.1.7 AC1 — calcula totalBruto/totalRetenciones a partir de la producción PENDIENTE del período", async () => {
    grant(prisma, "liquidacion.generar");
    prisma.liquidacion.findFirst.mockResolvedValue(null as never);
    prisma.produccionMedica.findMany.mockResolvedValue([
      { honorarioCalculado: dec(100) },
      { honorarioCalculado: dec(50) },
    ] as never);

    const caller = honorarioRouter.createCaller(makeCtx({ prisma }));
    await caller.liquidacion.generar(input);

    expect(prisma.liquidacion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalBruto: 150,
          totalRetenciones: 15, // 10% de 150
          totalNeto: 135,
          estado: "BORRADOR",
        }),
      }),
    );
  });

  it("US.AFIL.1.7 AC3 — regenerar reemplaza el BORRADOR existente (borra antes de recrear)", async () => {
    grant(prisma, "liquidacion.generar");
    prisma.liquidacion.findFirst.mockResolvedValue({ id: "borrador-viejo", estado: "BORRADOR" } as never);
    prisma.produccionMedica.findMany.mockResolvedValue([] as never);

    const caller = honorarioRouter.createCaller(makeCtx({ prisma }));
    await caller.liquidacion.generar(input);

    expect(prisma.liquidacion.delete).toHaveBeenCalledWith({ where: { id: "borrador-viejo" } });
    expect(prisma.liquidacion.create).toHaveBeenCalled();
  });

  it("rechaza regenerar sobre una liquidación ya APROBADA (no la reemplaza silenciosamente)", async () => {
    grant(prisma, "liquidacion.generar");
    prisma.liquidacion.findFirst.mockResolvedValue({ id: "ya-aprobada", estado: "APROBADA" } as never);
    prisma.produccionMedica.findMany.mockResolvedValue([] as never);

    const caller = honorarioRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.liquidacion.generar(input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(prisma.liquidacion.delete).not.toHaveBeenCalled();
  });

  it("US.AFIL.1.7 AC2 — compensa ContratoCargo vencidos sin dejar totalNeto negativo", async () => {
    grant(prisma, "liquidacion.generar");
    prisma.liquidacion.findFirst.mockResolvedValue(null as never);
    prisma.produccionMedica.findMany.mockResolvedValue([{ honorarioCalculado: dec(100) }] as never);
    // netoAntesCompensacion = 100 - 10 = 90. Dos cargos vencidos: 60 y 50 (orden antigüedad).
    // Solo el de 60 cabe completo sin dejar neto negativo (v1 no fracciona).
    prisma.contratoCargo.findMany.mockResolvedValue([
      { id: "cargo-1", monto: dec(60) },
      { id: "cargo-2", monto: dec(50) },
    ] as never);

    const caller = honorarioRouter.createCaller(makeCtx({ prisma }));
    await caller.liquidacion.generar(input);

    expect(prisma.liquidacion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalCompensaciones: 60, totalNeto: 30 }),
      }),
    );
    expect(prisma.liquidacionCompensacion.createMany).toHaveBeenCalledWith({
      data: [{ liquidacionId: LIQUIDACION_ID, contratoCargoId: "cargo-1", monto: 60 }],
    });
  });

  it("sin convenio VIGENTE, rechaza con PRECONDITION_FAILED", async () => {
    grant(prisma, "liquidacion.generar");
    prisma.convenioHonorario.findFirst.mockResolvedValue(null as never);

    const caller = honorarioRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.liquidacion.generar(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("hallazgo #3 (pre-PR) — bruto negativo (reversiones) NUNCA se clampea a 0: rechaza con PRECONDITION_FAILED", async () => {
    grant(prisma, "liquidacion.generar");
    prisma.liquidacion.findFirst.mockResolvedValue(null as never);
    // totalBruto = -50, retención 10% = -5, netoAntesCompensacion = -50 - (-5) = -45.
    prisma.produccionMedica.findMany.mockResolvedValue([{ honorarioCalculado: dec(-50) }] as never);

    const caller = honorarioRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.liquidacion.generar(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("revisión manual"),
    });
    // No debe haber borrado ni creado nada — el guard corre antes de tocar la BD.
    expect(prisma.liquidacion.delete).not.toHaveBeenCalled();
    expect(prisma.liquidacion.create).not.toHaveBeenCalled();
  });
});

describe("honorarioRouter.produccion.excluir", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  it("hallazgo #1 (pre-PR) — persiste motivoExclusion=MANUAL + motivoDetalle (no hardcodea SIN_REGLA)", async () => {
    grant(prisma, "produccion_medica.excluir");
    prisma.produccionMedica.findFirst.mockResolvedValue({ id: PRODUCCION_ID, estado: "PENDIENTE" } as never);
    prisma.produccionMedica.update.mockResolvedValue({ id: PRODUCCION_ID } as never);

    const caller = honorarioRouter.createCaller(makeCtx({ prisma }));
    await caller.produccion.excluir({ id: PRODUCCION_ID, motivo: "Cargo facturado por error administrativo" });

    expect(prisma.produccionMedica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          motivoExclusion: "MANUAL",
          motivoDetalle: "Cargo facturado por error administrativo",
        }),
      }),
    );
  });
});

describe("honorarioRouter.produccion.reprocesar", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  it("hallazgo #2 (pre-PR) — cuando la regla resuelve, crea el cargo HONORARIO_MEDICO y fija cargoHonorarioId", async () => {
    grant(prisma, "produccion_medica.reprocesar");
    prisma.produccionMedica.findFirst.mockResolvedValue({
      id: PRODUCCION_ID,
      estado: "EXCLUIDO",
      patientAccountServiceId: "cargo-origen",
      medicoAfiliadoId: AFILIADO_ID,
      rolMedico: "TRATANTE",
      fecha: new Date("2026-09-01"),
      montoFacturado: dec(50),
    } as never);
    prisma.patientAccountService.findUnique.mockResolvedValue({
      origen: "CONSULTA",
      accountId: "cuenta-1",
      tipo: "NO_HOSPITALARIO",
      encounterId: null,
    } as never);
    prisma.convenioHonorario.findFirst.mockResolvedValue({ id: CONVENIO_ID } as never);
    prisma.reglaHonorario.findMany.mockResolvedValue([
      {
        id: "regla-1",
        ambito: "CONSULTA",
        rolMedico: null,
        serviceCategoryId: null,
        codigoServicio: null,
        tipoCalculo: "PORCENTAJE",
        porcentaje: dec(0.4),
        montoFijo: null,
        montoMinimo: null,
        montoMaximo: null,
        prioridad: 0,
        createdAt: new Date("2026-01-01"),
      },
    ] as never);
    prisma.produccionMedica.update.mockResolvedValue({ id: PRODUCCION_ID, rolMedico: "TRATANTE" } as never);
    prisma.patientAccountService.create.mockResolvedValue({ id: CARGO_HONORARIO_ID } as never);

    const caller = honorarioRouter.createCaller(makeCtx({ prisma }));
    await caller.produccion.reprocesar({ id: PRODUCCION_ID });

    expect(prisma.patientAccountService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ origen: "HONORARIO_MEDICO", referenciaId: PRODUCCION_ID, unitPrice: 20 }),
      }),
    );
    expect(prisma.produccionMedica.update).toHaveBeenLastCalledWith({
      where: { id: PRODUCCION_ID },
      data: { cargoHonorarioId: CARGO_HONORARIO_ID },
    });
  });

  it("sin regla que resuelva, deja motivoExclusion=SIN_REGLA sin crear cargo", async () => {
    grant(prisma, "produccion_medica.reprocesar");
    prisma.produccionMedica.findFirst.mockResolvedValue({
      id: PRODUCCION_ID,
      estado: "EXCLUIDO",
      patientAccountServiceId: "cargo-origen",
      medicoAfiliadoId: AFILIADO_ID,
      rolMedico: "TRATANTE",
      fecha: new Date("2026-09-01"),
      montoFacturado: dec(50),
    } as never);
    prisma.patientAccountService.findUnique.mockResolvedValue({
      origen: "CONSULTA",
      accountId: "cuenta-1",
      tipo: "NO_HOSPITALARIO",
      encounterId: null,
    } as never);
    prisma.convenioHonorario.findFirst.mockResolvedValue(null as never);
    prisma.produccionMedica.update.mockResolvedValue({ id: PRODUCCION_ID } as never);

    const caller = honorarioRouter.createCaller(makeCtx({ prisma }));
    await caller.produccion.reprocesar({ id: PRODUCCION_ID });

    expect(prisma.patientAccountService.create).not.toHaveBeenCalled();
  });
});

describe("honorarioRouter.liquidacion.aprobar", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
    prisma.domainEvent.create.mockResolvedValue({ id: "event-1" } as never);
  });

  it("US.AFIL.1.7 AC4 — segregación: quien generó la liquidación no puede aprobarla", async () => {
    grant(prisma, "liquidacion.aprobar");
    prisma.liquidacion.findFirst.mockResolvedValue({
      id: LIQUIDACION_ID,
      estado: "BORRADOR",
      createdBy: MOCK_USER_ADMIN.id,
    } as never);

    // MOCK_TENANT.userId = MOCK_USER_ADMIN.id — el caller es el mismo que generó.
    const caller = honorarioRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.liquidacion.aprobar({ id: LIQUIDACION_ID })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.liquidacion.update).not.toHaveBeenCalled();
  });

  it("aprobación exitosa: sella aprobadaBy/At, mueve producción a LIQUIDADO y emite liquidacion.aprobada", async () => {
    grant(prisma, "liquidacion.aprobar");
    prisma.liquidacion.findFirst.mockResolvedValue({
      id: LIQUIDACION_ID,
      estado: "BORRADOR",
      createdBy: MOCK_USER_ADMIN.id, // generador distinto del aprobador de este test
      medicoAfiliadoId: AFILIADO_ID,
      periodoDesde: new Date("2026-09-01"),
      periodoHasta: new Date("2026-09-30"),
      folio: "LIQ-000001",
      totalBruto: dec(100),
      totalRetenciones: dec(10),
      totalCompensaciones: dec(0),
      totalNeto: dec(90),
    } as never);
    prisma.liquidacion.update.mockResolvedValue({
      id: LIQUIDACION_ID,
      medicoAfiliadoId: AFILIADO_ID,
      folio: "LIQ-000001",
      periodoDesde: new Date("2026-09-01"),
      periodoHasta: new Date("2026-09-30"),
      totalBruto: dec(100),
      totalRetenciones: dec(10),
      totalCompensaciones: dec(0),
      totalNeto: dec(90),
    } as never);

    // Aprobador distinto del generador (MOCK_USER_TRIAGIST).
    const caller = honorarioRouter.createCaller(
      makeCtx({ prisma, user: MOCK_USER_TRIAGIST, tenant: { ...MOCK_TENANT, userId: MOCK_USER_TRIAGIST.id } }),
    );
    await caller.liquidacion.aprobar({ id: LIQUIDACION_ID });

    expect(prisma.liquidacion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: "APROBADA", aprobadaBy: MOCK_USER_TRIAGIST.id }),
      }),
    );
    expect(prisma.produccionMedica.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estado: "LIQUIDADO", liquidacionId: LIQUIDACION_ID } }),
    );
    expect(prisma.domainEvent.create).toHaveBeenCalled();
  });

  it("rechaza aprobar una liquidación que no está en BORRADOR (inmutable post-aprobación)", async () => {
    grant(prisma, "liquidacion.aprobar");
    prisma.liquidacion.findFirst.mockResolvedValue({
      id: LIQUIDACION_ID,
      estado: "APROBADA",
      createdBy: MOCK_USER_TRIAGIST.id,
    } as never);

    const caller = honorarioRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.liquidacion.aprobar({ id: LIQUIDACION_ID })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("honorarioRouter.liquidacion.anular", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  it("US.AFIL.1.7 AC5 — anular una APROBADA devuelve su producción a PENDIENTE", async () => {
    grant(prisma, "liquidacion.anular");
    prisma.liquidacion.findFirst.mockResolvedValue({ id: LIQUIDACION_ID, estado: "APROBADA" } as never);
    prisma.liquidacion.update.mockResolvedValue({ id: LIQUIDACION_ID, estado: "ANULADA" } as never);

    const caller = honorarioRouter.createCaller(makeCtx({ prisma }));
    await caller.liquidacion.anular({ id: LIQUIDACION_ID, motivo: "Error de cálculo" });

    expect(prisma.produccionMedica.updateMany).toHaveBeenCalledWith({
      where: { liquidacionId: LIQUIDACION_ID },
      data: { estado: "PENDIENTE", liquidacionId: null },
    });
    expect(prisma.liquidacion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "ANULADA", motivoAnulacion: "Error de cálculo" }) }),
    );
  });

  it("rechaza anular una liquidación que no está APROBADA", async () => {
    grant(prisma, "liquidacion.anular");
    prisma.liquidacion.findFirst.mockResolvedValue({ id: LIQUIDACION_ID, estado: "BORRADOR" } as never);

    const caller = honorarioRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.liquidacion.anular({ id: LIQUIDACION_ID, motivo: "x" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("honorarioRouter.convenio.activar", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  it("US.AFIL.1.5 AC1 — rechaza activar un convenio sin ninguna regla activa", async () => {
    grant(prisma, "convenio_honorario.activar");
    prisma.convenioHonorario.findFirst.mockResolvedValue({ id: CONVENIO_ID, estado: "BORRADOR", reglas: [] } as never);

    const caller = honorarioRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.convenio.activar({ id: CONVENIO_ID })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(prisma.convenioHonorario.update).not.toHaveBeenCalled();
  });

  it("activa cuando hay al menos una regla activa", async () => {
    grant(prisma, "convenio_honorario.activar");
    prisma.convenioHonorario.findFirst.mockResolvedValue({
      id: CONVENIO_ID,
      estado: "BORRADOR",
      reglas: [{ id: "regla-1" }],
    } as never);
    prisma.convenioHonorario.update.mockResolvedValue({ id: CONVENIO_ID, estado: "VIGENTE" } as never);

    const caller = honorarioRouter.createCaller(makeCtx({ prisma }));
    await caller.convenio.activar({ id: CONVENIO_ID });

    expect(prisma.convenioHonorario.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "VIGENTE" }) }),
    );
  });
});
