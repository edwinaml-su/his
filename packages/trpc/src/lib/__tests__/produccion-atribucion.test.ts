/**
 * CC-0036 Ola 5 (REQ-HIS-AFIL-001 US.AFIL.1.6) — tests de
 * `atribuirProduccionMedica`/`revertirProduccionMedica`.
 *
 * Mismo patrón que charge-capture.test.ts: `mockDeep<PrismaClient>()` +
 * `emitDomainEvent` mockeado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "event-id" }),
  };
});

import { emitDomainEvent } from "@his/database";
import { atribuirProduccionMedica, revertirProduccionMedica } from "../produccion-atribucion";

const ORG = "00000000-0000-0000-0000-000000000001";
const ESTABLISHMENT = "00000000-0000-0000-0000-000000000002";
const MEDICO = "00000000-0000-0000-0000-000000000003";
const CARGO_ORIGEN = "00000000-0000-0000-0000-000000000004";
const ACCOUNT = "00000000-0000-0000-0000-000000000005";
const ACTOR = "00000000-0000-0000-0000-000000000006";
const CONVENIO = "00000000-0000-0000-0000-000000000007";
const REGLA = "00000000-0000-0000-0000-000000000008";
const PRODUCCION = "00000000-0000-0000-0000-000000000009";
const CARGO_HONORARIO = "00000000-0000-0000-0000-00000000000a";
const CARGO_REVERSION = "00000000-0000-0000-0000-00000000000b";

const emitDomainEventMock = vi.mocked(emitDomainEvent);

const baseParams = {
  organizationId: ORG,
  establishmentId: ESTABLISHMENT,
  medicoAfiliadoId: MEDICO,
  rolMedico: "TRATANTE" as const,
  patientAccountServiceId: CARGO_ORIGEN,
  ambito: "CONSULTA",
  fecha: new Date("2026-09-15"),
  actorId: ACTOR,
};

describe("atribuirProduccionMedica", () => {
  let tx: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    tx = mockDeep<PrismaClient>();
    emitDomainEventMock.mockClear();
    tx.produccionMedica.findFirst.mockResolvedValue(null as never);
    tx.patientAccountService.findUnique.mockResolvedValue({
      accountId: ACCOUNT,
      totalPrice: 50,
      encounterId: null,
      tipo: "NO_HOSPITALARIO",
    } as never);
  });

  it("AC3 — idempotente: producción ya existente para el mismo cargo/médico/rol es un no-op", async () => {
    tx.produccionMedica.findFirst.mockResolvedValue({ id: "existente" } as never);

    const resultado = await atribuirProduccionMedica(tx, baseParams);

    expect(resultado).toBeNull();
    expect(tx.produccionMedica.create).not.toHaveBeenCalled();
  });

  it("sin monto facturado resuelto (cargo PENDIENTE_TARIFA), no atribuye todavía", async () => {
    tx.patientAccountService.findUnique.mockResolvedValue({
      accountId: ACCOUNT,
      totalPrice: null,
      encounterId: null,
      tipo: "NO_HOSPITALARIO",
    } as never);

    const resultado = await atribuirProduccionMedica(tx, baseParams);

    expect(resultado).toBeNull();
    expect(tx.produccionMedica.create).not.toHaveBeenCalled();
  });

  it("AC6 — STAFF_INTERNO: EXCLUIDO PERSONAL_DE_PLANTA, honorario 0, sin cargo nuevo", async () => {
    tx.medicoAfiliado.findFirst.mockResolvedValue({ tipoRelacion: "STAFF_INTERNO" } as never);
    tx.produccionMedica.create.mockResolvedValue({ id: PRODUCCION } as never);

    const resultado = await atribuirProduccionMedica(tx, baseParams);

    expect(resultado).toMatchObject({
      estado: "EXCLUIDO",
      honorarioCalculado: 0,
      motivoExclusion: "PERSONAL_DE_PLANTA",
      cargoHonorarioId: null,
    });
    expect(tx.patientAccountService.create).not.toHaveBeenCalled();
    expect(tx.convenioHonorario.findFirst).not.toHaveBeenCalled();
  });

  it("AC5 — sin convenio VIGENTE: EXCLUIDO SIN_REGLA, sin cargo nuevo", async () => {
    tx.medicoAfiliado.findFirst.mockResolvedValue({ tipoRelacion: "AFILIADO_SIN_CONSULTORIO" } as never);
    tx.convenioHonorario.findFirst.mockResolvedValue(null as never);
    tx.produccionMedica.create.mockResolvedValue({ id: PRODUCCION } as never);

    const resultado = await atribuirProduccionMedica(tx, baseParams);

    expect(resultado).toMatchObject({ estado: "EXCLUIDO", honorarioCalculado: 0, motivoExclusion: "SIN_REGLA" });
    expect(tx.patientAccountService.create).not.toHaveBeenCalled();
  });

  it("AC5 — convenio VIGENTE sin regla que haga match en el ámbito: EXCLUIDO SIN_REGLA", async () => {
    tx.medicoAfiliado.findFirst.mockResolvedValue({ tipoRelacion: "AFILIADO_SIN_CONSULTORIO" } as never);
    tx.convenioHonorario.findFirst.mockResolvedValue({ id: CONVENIO } as never);
    tx.reglaHonorario.findMany.mockResolvedValue([] as never);
    tx.produccionMedica.create.mockResolvedValue({ id: PRODUCCION } as never);

    const resultado = await atribuirProduccionMedica(tx, baseParams);

    expect(resultado).toMatchObject({ estado: "EXCLUIDO", motivoExclusion: "SIN_REGLA" });
  });

  it("con regla resuelta: crea ProduccionMedica PENDIENTE + cargo HONORARIO_MEDICO enlazado", async () => {
    tx.medicoAfiliado.findFirst.mockResolvedValue({ tipoRelacion: "AFILIADO_SIN_CONSULTORIO" } as never);
    tx.convenioHonorario.findFirst.mockResolvedValue({ id: CONVENIO } as never);
    tx.reglaHonorario.findMany.mockResolvedValue([
      {
        id: REGLA,
        ambito: "CONSULTA",
        rolMedico: null,
        serviceCategoryId: null,
        codigoServicio: null,
        tipoCalculo: "PORCENTAJE",
        porcentaje: 0.4,
        montoFijo: null,
        montoMinimo: null,
        montoMaximo: null,
        prioridad: 0,
        createdAt: new Date("2026-01-01"),
      },
    ] as never);
    tx.produccionMedica.create.mockResolvedValue({ id: PRODUCCION } as never);
    tx.patientAccountService.create.mockResolvedValue({ id: CARGO_HONORARIO } as never);

    const resultado = await atribuirProduccionMedica(tx, baseParams);

    expect(resultado).toMatchObject({
      estado: "PENDIENTE",
      honorarioCalculado: 20, // 40% de 50
      cargoHonorarioId: CARGO_HONORARIO,
    });
    expect(tx.patientAccountService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountId: ACCOUNT,
          origen: "HONORARIO_MEDICO",
          unitPrice: 20,
          totalPrice: 20,
          referenciaId: PRODUCCION,
        }),
      }),
    );
    expect(tx.produccionMedica.update).toHaveBeenCalledWith({
      where: { id: PRODUCCION },
      data: { cargoHonorarioId: CARGO_HONORARIO },
    });
    expect(emitDomainEventMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: "produccion.registrada" }),
    );
  });

  it("US.AFIL.1.6 AC2 — multi-rol: 3 filas de producción sobre el mismo cargo (cirugía)", async () => {
    tx.medicoAfiliado.findFirst.mockResolvedValue({ tipoRelacion: "AFILIADO_SIN_CONSULTORIO" } as never);
    tx.convenioHonorario.findFirst.mockResolvedValue({ id: CONVENIO } as never);
    tx.reglaHonorario.findMany.mockResolvedValue([
      {
        id: REGLA,
        ambito: "CIRUGIA",
        rolMedico: null,
        serviceCategoryId: null,
        codigoServicio: null,
        tipoCalculo: "MONTO_FIJO",
        porcentaje: null,
        montoFijo: 100,
        montoMinimo: null,
        montoMaximo: null,
        prioridad: 0,
        createdAt: new Date("2026-01-01"),
      },
    ] as never);
    tx.produccionMedica.create.mockResolvedValue({ id: PRODUCCION } as never);
    tx.patientAccountService.create.mockResolvedValue({ id: CARGO_HONORARIO } as never);

    for (const rolMedico of ["CIRUJANO", "AYUDANTE", "ANESTESISTA"] as const) {
      await atribuirProduccionMedica(tx, { ...baseParams, ambito: "CIRUGIA", rolMedico });
    }

    expect(tx.produccionMedica.create).toHaveBeenCalledTimes(3);
    const roles = tx.produccionMedica.create.mock.calls.map((c) => (c[0] as { data: { rolMedico: string } }).data.rolMedico);
    expect(roles).toEqual(["CIRUJANO", "AYUDANTE", "ANESTESISTA"]);
  });
});

describe("revertirProduccionMedica", () => {
  let tx: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    tx = mockDeep<PrismaClient>();
  });

  it("no hace nada si el cargo no es una reversión (sin reversalOfId)", async () => {
    tx.patientAccountService.findUnique.mockResolvedValue({ reversalOfId: null } as never);

    await revertirProduccionMedica(tx, { reversionCargoId: CARGO_REVERSION, actorId: ACTOR });

    expect(tx.produccionMedica.findMany).not.toHaveBeenCalled();
  });

  it("PENDIENTE -> REVERSADO sin crear fila negativa", async () => {
    tx.patientAccountService.findUnique.mockResolvedValue({ reversalOfId: CARGO_ORIGEN } as never);
    tx.produccionMedica.findMany.mockResolvedValue([
      { id: PRODUCCION, estado: "PENDIENTE" },
    ] as never);

    await revertirProduccionMedica(tx, { reversionCargoId: CARGO_REVERSION, actorId: ACTOR });

    expect(tx.produccionMedica.update).toHaveBeenCalledWith({
      where: { id: PRODUCCION },
      data: { estado: "REVERSADO" },
    });
    expect(tx.produccionMedica.create).not.toHaveBeenCalled();
  });

  it("AC4 — LIQUIDADO -> REVERSADO + fila negativa anclada al cargo REVERSION", async () => {
    tx.patientAccountService.findUnique.mockResolvedValue({ reversalOfId: CARGO_ORIGEN } as never);
    tx.produccionMedica.findMany.mockResolvedValue([
      {
        id: PRODUCCION,
        estado: "LIQUIDADO",
        organizationId: ORG,
        establishmentId: ESTABLISHMENT,
        medicoAfiliadoId: MEDICO,
        rolMedico: "TRATANTE",
        encounterId: null,
        montoFacturado: 50,
        honorarioCalculado: 20,
        reglaHonorarioId: REGLA,
      },
    ] as never);

    await revertirProduccionMedica(tx, { reversionCargoId: CARGO_REVERSION, actorId: ACTOR });

    expect(tx.produccionMedica.update).toHaveBeenCalledWith({
      where: { id: PRODUCCION },
      data: { estado: "REVERSADO" },
    });
    expect(tx.produccionMedica.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patientAccountServiceId: CARGO_REVERSION,
        montoFacturado: -50,
        honorarioCalculado: -20,
        estado: "PENDIENTE",
      }),
    });
  });

  it("EXCLUIDO no se reversa (nada que hacer)", async () => {
    tx.patientAccountService.findUnique.mockResolvedValue({ reversalOfId: CARGO_ORIGEN } as never);
    tx.produccionMedica.findMany.mockResolvedValue([
      { id: PRODUCCION, estado: "EXCLUIDO" },
    ] as never);

    await revertirProduccionMedica(tx, { reversionCargoId: CARGO_REVERSION, actorId: ACTOR });

    expect(tx.produccionMedica.update).not.toHaveBeenCalled();
    expect(tx.produccionMedica.create).not.toHaveBeenCalled();
  });
});
