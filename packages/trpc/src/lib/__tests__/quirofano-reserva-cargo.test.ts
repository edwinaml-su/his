/**
 * C5 auditoría P0-4 — Tests de `capturarCargoReservaQuirofano`.
 *
 * `capturarCargo` (charge-capture.ts) ya tiene su propia suite — aquí solo
 * se ejercita el contrato de este wrapper: idempotencia por `referenciaId`
 * y el fallback sintético `QX-<code>` cuando no hay `chargeCode`, mismo
 * patrón que `surgery.router.ts case.create` ya cubría antes de extraerse.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

const capturarCargoMock = vi.fn();
vi.mock("../charge-capture", () => ({
  capturarCargo: (...args: unknown[]) => capturarCargoMock(...args),
}));

import { capturarCargoReservaQuirofano } from "../quirofano-reserva-cargo";

const ORG = "00000000-0000-0000-0000-000000000001";
const PATIENT = "00000000-0000-0000-0000-000000000002";
const REFERENCIA = "00000000-0000-0000-0000-000000000003";
const ACTOR = "00000000-0000-0000-0000-000000000004";

const baseParams = {
  organizationId: ORG,
  patientId: PATIENT,
  descripcionProcedimiento: "Apendicectomía",
  chargeCode: null as string | null,
  codigoSalaFallback: "QX-1",
  referenciaId: REFERENCIA,
  actorId: ACTOR,
};

describe("capturarCargoReservaQuirofano", () => {
  let tx: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    tx = mockDeep<PrismaClient>();
    capturarCargoMock.mockReset();
    capturarCargoMock.mockResolvedValue({
      cargoId: "cargo-nuevo",
      status: "VIGENTE",
      unitPrice: 50,
    });
  });

  it("idempotente: retorna el cargo VIGENTE existente sin llamar a capturarCargo", async () => {
    tx.patientAccountService.findFirst.mockResolvedValue({
      id: "cargo-existente",
      status: "VIGENTE",
      unitPrice: 42 as never,
    } as never);

    const result = await capturarCargoReservaQuirofano(tx, baseParams);

    expect(result).toEqual({ cargoId: "cargo-existente", status: "VIGENTE", unitPrice: 42 });
    expect(capturarCargoMock).not.toHaveBeenCalled();
  });

  it("idempotente: retorna el cargo PENDIENTE_TARIFA existente sin duplicar", async () => {
    tx.patientAccountService.findFirst.mockResolvedValue({
      id: "cargo-pendiente",
      status: "PENDIENTE_TARIFA",
      unitPrice: null,
    } as never);

    const result = await capturarCargoReservaQuirofano(tx, baseParams);

    expect(result.cargoId).toBe("cargo-pendiente");
    expect(result.status).toBe("PENDIENTE_TARIFA");
    expect(result.unitPrice).toBeNull();
    expect(capturarCargoMock).not.toHaveBeenCalled();
  });

  it("sin cargo previo y con chargeCode: llama a capturarCargo con ese code", async () => {
    tx.patientAccountService.findFirst.mockResolvedValue(null as never);

    await capturarCargoReservaQuirofano(tx, { ...baseParams, chargeCode: "TARIFA-QX-1" });

    expect(capturarCargoMock).toHaveBeenCalledTimes(1);
    expect(capturarCargoMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        code: "TARIFA-QX-1",
        origen: "USO_INSTALACIONES",
        referenciaId: REFERENCIA,
        quantity: 1,
      }),
    );
  });

  it("sin cargo previo y sin chargeCode: usa el sintético QX-<codigoSalaFallback> (R3, nunca silencio)", async () => {
    tx.patientAccountService.findFirst.mockResolvedValue(null as never);

    await capturarCargoReservaQuirofano(tx, { ...baseParams, chargeCode: null, codigoSalaFallback: "SIN_SALA" });

    expect(capturarCargoMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ code: "QX-SIN_SALA" }),
    );
  });

  it("filtra la búsqueda de idempotencia por referenciaId + origen USO_INSTALACIONES", async () => {
    tx.patientAccountService.findFirst.mockResolvedValue(null as never);

    await capturarCargoReservaQuirofano(tx, baseParams);

    const args = tx.patientAccountService.findFirst.mock.calls[0]![0];
    const where = args!.where as { referenciaId: string; origen: string; status: { in: string[] } };
    expect(where.referenciaId).toBe(REFERENCIA);
    expect(where.origen).toBe("USO_INSTALACIONES");
    expect(where.status.in).toEqual(expect.arrayContaining(["VIGENTE", "PENDIENTE_TARIFA"]));
  });
});
