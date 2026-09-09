/**
 * docs/48 Ola 2 (C2-1) — Tests de `capturarCargo`/`revertirCargo`.
 *
 * `resolverPrecio` se mockea aparte (ya tiene su propia suite en
 * price-resolver.test.ts) — aquí solo se ejercita el contrato de captura:
 * resolución de cuenta activa, mapeo de fuente→priceSource, camino
 * PENDIENTE_TARIFA (nunca 0) y reversión.
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

vi.mock("../price-resolver", async (importOriginal) => {
  const original = await importOriginal<typeof import("../price-resolver")>();
  return {
    ...original,
    resolverPrecio: vi.fn(),
  };
});

import { emitDomainEvent } from "@his/database";
import { resolverPrecio } from "../price-resolver";
import { capturarCargo, revertirCargo } from "../charge-capture";

const ORG = "00000000-0000-0000-0000-000000000001";
const PATIENT = "00000000-0000-0000-0000-000000000002";
const ENCOUNTER = "00000000-0000-0000-0000-000000000003";
const ACCOUNT = "00000000-0000-0000-0000-000000000004";
const ACCOUNT_SIN_ENCOUNTER = "00000000-0000-0000-0000-000000000005";
const ACTOR = "00000000-0000-0000-0000-000000000006";
const PRICE_LIST_ID = "00000000-0000-0000-0000-000000000007";
const RULE_ID = "00000000-0000-0000-0000-000000000008";
const CARGO_ID = "00000000-0000-0000-0000-000000000009";
const REFERENCIA = "00000000-0000-0000-0000-00000000000a";

const resolverPrecioMock = vi.mocked(resolverPrecio);
const emitDomainEventMock = vi.mocked(emitDomainEvent);

describe("capturarCargo", () => {
  let tx: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    tx = mockDeep<PrismaClient>();
    resolverPrecioMock.mockReset();
    emitDomainEventMock.mockClear();
  });

  const baseParams = {
    organizationId: ORG,
    patientId: PATIENT,
    encounterId: ENCOUNTER,
    code: "MED-001",
    descripcion: "Amoxicilina 500mg",
    quantity: 2,
    origen: "DISPENSACION_FARMACIA",
    referenciaId: REFERENCIA,
    actorId: ACTOR,
  };

  it("PRECONDITION_FAILED cuando el paciente no tiene cuenta activa", async () => {
    tx.patientAccount.findFirst.mockResolvedValue(null as never);

    await expect(capturarCargo(tx, baseParams)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    expect(tx.patientAccountService.create).not.toHaveBeenCalled();
  });

  it("prefiere la cuenta activa del encounterId sobre cualquier otra", async () => {
    tx.patientAccount.findFirst.mockResolvedValueOnce({ id: ACCOUNT } as never);
    resolverPrecioMock.mockResolvedValue({
      precio: 10,
      fuente: "regla",
      priceListId: PRICE_LIST_ID,
      reglaId: RULE_ID,
    });
    tx.patientAccountService.create.mockResolvedValue({ id: CARGO_ID } as never);

    await capturarCargo(tx, baseParams);

    expect(tx.patientAccount.findFirst).toHaveBeenCalledTimes(1);
    const where = tx.patientAccount.findFirst.mock.calls[0]![0]!.where as {
      encounterId?: string;
    };
    expect(where.encounterId).toBe(ENCOUNTER);
    expect(resolverPrecioMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ cuentaId: ACCOUNT, code: "MED-001", cantidad: 2 }),
    );
  });

  it("docs/48 C3-1: con accountId, resuelve esa cuenta directo (sin buscar por encounterId)", async () => {
    tx.patientAccount.findFirst.mockResolvedValue({ id: ACCOUNT } as never);
    resolverPrecioMock.mockResolvedValue({
      precio: 10,
      fuente: "estandar",
      priceListId: null,
      reglaId: null,
    });
    tx.patientAccountService.create.mockResolvedValue({ id: CARGO_ID } as never);

    await capturarCargo(tx, { ...baseParams, accountId: ACCOUNT });

    expect(tx.patientAccount.findFirst).toHaveBeenCalledTimes(1);
    const where = tx.patientAccount.findFirst.mock.calls[0]![0]!.where as {
      id?: string;
      encounterId?: string;
    };
    expect(where.id).toBe(ACCOUNT);
    expect(where.encounterId).toBeUndefined();
  });

  it("docs/48 C3-1: accountId de una cuenta no activa/ajena → PRECONDITION_FAILED (mismo contrato que sin cuenta)", async () => {
    tx.patientAccount.findFirst.mockResolvedValue(null as never);

    await expect(
      capturarCargo(tx, { ...baseParams, accountId: ACCOUNT }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(tx.patientAccountService.create).not.toHaveBeenCalled();
  });

  it("docs/48 C3-3: origen fuera de la taxonomía cerrada → BAD_REQUEST, sin tocar la cuenta", async () => {
    await expect(
      capturarCargo(tx, { ...baseParams, origen: "dispensacion" as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(tx.patientAccount.findFirst).not.toHaveBeenCalled();
    expect(tx.patientAccountService.create).not.toHaveBeenCalled();
  });

  it("cae a la cuenta activa más reciente del paciente si el encounterId no tiene ninguna", async () => {
    tx.patientAccount.findFirst
      .mockResolvedValueOnce(null as never) // sin cuenta activa para ese encounter
      .mockResolvedValueOnce({ id: ACCOUNT_SIN_ENCOUNTER } as never); // fallback
    resolverPrecioMock.mockResolvedValue({
      precio: 10,
      fuente: "estandar",
      priceListId: null,
      reglaId: null,
    });
    tx.patientAccountService.create.mockResolvedValue({ id: CARGO_ID } as never);

    const result = await capturarCargo(tx, baseParams);

    expect(tx.patientAccount.findFirst).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("VIGENTE");
  });

  it("crea la línea VIGENTE con precio congelado y mapea fuente 'regla' tal cual", async () => {
    tx.patientAccount.findFirst.mockResolvedValue({ id: ACCOUNT } as never);
    resolverPrecioMock.mockResolvedValue({
      precio: 12.5,
      fuente: "regla",
      priceListId: PRICE_LIST_ID,
      reglaId: RULE_ID,
    });
    tx.patientAccountService.create.mockResolvedValue({ id: CARGO_ID } as never);

    const result = await capturarCargo(tx, baseParams);

    expect(result).toEqual({ cargoId: CARGO_ID, status: "VIGENTE", unitPrice: 12.5 });
    expect(tx.patientAccountService.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: ACCOUNT,
        tipo: "HOSPITALARIO",
        code: "MED-001",
        quantity: 2,
        unitPrice: 12.5,
        totalPrice: 25,
        priceListId: PRICE_LIST_ID,
        priceRuleId: RULE_ID,
        priceSource: "regla",
        status: "VIGENTE",
        origen: "DISPENSACION_FARMACIA",
        referenciaId: REFERENCIA,
        createdBy: ACTOR,
      }),
    });
    expect(emitDomainEventMock).not.toHaveBeenCalled();
  });

  it("mapea fuente 'lista' tal cual y 'estandar' → 'standard'", async () => {
    tx.patientAccount.findFirst.mockResolvedValue({ id: ACCOUNT } as never);
    tx.patientAccountService.create.mockResolvedValue({ id: CARGO_ID } as never);

    resolverPrecioMock.mockResolvedValue({
      precio: 5,
      fuente: "lista",
      priceListId: PRICE_LIST_ID,
      reglaId: null,
    });
    await capturarCargo(tx, baseParams);
    expect(tx.patientAccountService.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ priceSource: "lista" }),
    });

    resolverPrecioMock.mockResolvedValue({
      precio: 5,
      fuente: "estandar",
      priceListId: null,
      reglaId: null,
    });
    await capturarCargo(tx, baseParams);
    expect(tx.patientAccountService.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ priceSource: "standard" }),
    });
  });

  it("sin tipo HOSPITALARIO cuando no hay encounterId (NO_HOSPITALARIO)", async () => {
    tx.patientAccount.findFirst.mockResolvedValue({ id: ACCOUNT_SIN_ENCOUNTER } as never);
    resolverPrecioMock.mockResolvedValue({
      precio: 5,
      fuente: "estandar",
      priceListId: null,
      reglaId: null,
    });
    tx.patientAccountService.create.mockResolvedValue({ id: CARGO_ID } as never);

    await capturarCargo(tx, { ...baseParams, encounterId: null });

    expect(tx.patientAccountService.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tipo: "NO_HOSPITALARIO", encounterId: null }),
    });
  });

  it("precio no resoluble: crea línea PENDIENTE_TARIFA con unitPrice/totalPrice NULL y emite el evento", async () => {
    tx.patientAccount.findFirst.mockResolvedValue({ id: ACCOUNT } as never);
    resolverPrecioMock.mockResolvedValue({
      precio: null,
      fuente: null,
      priceListId: null,
      reglaId: null,
    });
    tx.patientAccountService.create.mockResolvedValue({ id: CARGO_ID } as never);

    const result = await capturarCargo(tx, baseParams);

    expect(result).toEqual({ cargoId: CARGO_ID, status: "PENDIENTE_TARIFA", unitPrice: null });
    expect(tx.patientAccountService.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        unitPrice: null,
        totalPrice: null,
        priceListId: null,
        priceRuleId: null,
        priceSource: null,
        status: "PENDIENTE_TARIFA",
      }),
    });
    expect(emitDomainEventMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: "cargo.pendiente_tarifa",
        aggregateType: "PatientAccountService",
        aggregateId: CARGO_ID,
        organizationId: ORG,
        payload: expect.objectContaining({ cargoId: CARGO_ID, code: "MED-001" }),
      }),
    );
  });
});

describe("revertirCargo", () => {
  let tx: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    tx = mockDeep<PrismaClient>();
  });

  const CARGO_ORIGINAL = {
    id: CARGO_ID,
    accountId: ACCOUNT,
    tipo: "HOSPITALARIO",
    encounterId: ENCOUNTER,
    code: "MED-001",
    quantity: 2,
    unitPrice: 12.5,
    totalPrice: 25,
    priceListId: PRICE_LIST_ID,
    priceRuleId: RULE_ID,
    resolvedAt: new Date("2026-09-01T00:00:00Z"),
    priceSource: "regla",
    status: "VIGENTE",
    origen: "dispensacion",
    referenciaId: REFERENCIA,
  };

  it("NOT_FOUND si el cargo no existe", async () => {
    tx.patientAccountService.findUnique.mockResolvedValue(null as never);

    await expect(
      revertirCargo(tx, { cargoId: CARGO_ID, motivo: "devolución", actorId: ACTOR }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("marca el original REVERTIDO y crea la línea REVERSION con signo negativo enlazada por reversalOfId", async () => {
    tx.patientAccountService.findUnique.mockResolvedValue(CARGO_ORIGINAL as never);
    tx.patientAccountService.update.mockResolvedValue({
      ...CARGO_ORIGINAL,
      status: "REVERTIDO",
    } as never);
    tx.patientAccountService.create.mockResolvedValue({ id: "reversion-1" } as never);

    const result = await revertirCargo(tx, {
      cargoId: CARGO_ID,
      motivo: "devolución de 2 unidades",
      actorId: ACTOR,
    });

    expect(result).toEqual({ reversionId: "reversion-1" });
    expect(tx.patientAccountService.update).toHaveBeenCalledWith({
      where: { id: CARGO_ID },
      data: { status: "REVERTIDO" },
    });
    expect(tx.patientAccountService.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: ACCOUNT,
        reversalOfId: CARGO_ID,
        status: "REVERSION",
        quantity: -2,
        totalPrice: -25,
        unitPrice: 12.5,
        origen: "dispensacion",
        referenciaId: REFERENCIA,
        createdBy: ACTOR,
      }),
    });
  });

  it("rechaza revertir un cargo que no está VIGENTE (doble reversión)", async () => {
    tx.patientAccountService.findUnique.mockResolvedValue({
      ...CARGO_ORIGINAL,
      status: "REVERTIDO",
    } as never);

    await expect(
      revertirCargo(tx, { cargoId: CARGO_ID, motivo: "otra vez", actorId: ACTOR }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(tx.patientAccountService.update).not.toHaveBeenCalled();
    expect(tx.patientAccountService.create).not.toHaveBeenCalled();
  });
});
