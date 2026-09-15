/**
 * C5 auditoría P0-5 — Tests de `hayConflictoQuirofano`.
 *
 * Cubre el único algoritmo de overlap compartido entre `surgery.router.ts`
 * (vía `operatingRoomId`, sobre `SurgeryCase`) y
 * `ece/bridge-cirugia.router.ts` (vía `salaQxId`, sobre `EceReservaSalaQx`).
 * Cada caller consulta SU PROPIA tabla — ver limitación documentada en
 * `quirofano-conflicto.ts` sobre por qué no se cruzan los dos catálogos.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { hayConflictoQuirofano } from "../quirofano-conflicto";

const OR_ID = "00000000-0000-0000-0000-000000000001";
const SALA_ID = "00000000-0000-0000-0000-000000000002";
const CASE_ID = "00000000-0000-0000-0000-000000000003";
const RESERVA_ID = "00000000-0000-0000-0000-000000000004";
const start = new Date("2026-10-01T08:00:00Z");
const end = new Date("2026-10-01T10:00:00Z");

describe("hayConflictoQuirofano", () => {
  let tx: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    tx = mockDeep<PrismaClient>();
  });

  it("vía legacy (operatingRoomId): true si SurgeryCase tiene overlap activo", async () => {
    tx.surgeryCase.findFirst.mockResolvedValue({ id: CASE_ID } as never);
    const result = await hayConflictoQuirofano(tx, {
      operatingRoomId: OR_ID,
      scheduledStart: start,
      scheduledEnd: end,
    });
    expect(result).toBe(true);
    const args = tx.surgeryCase.findFirst.mock.calls[0]![0];
    expect((args!.where as { operatingRoomId: string }).operatingRoomId).toBe(OR_ID);
    expect((args!.where as { deletedAt: null }).deletedAt).toBeNull();
  });

  it("vía legacy: false si no hay overlap", async () => {
    tx.surgeryCase.findFirst.mockResolvedValue(null as never);
    const result = await hayConflictoQuirofano(tx, {
      operatingRoomId: OR_ID,
      scheduledStart: start,
      scheduledEnd: end,
    });
    expect(result).toBe(false);
  });

  it("vía legacy: excludeSurgeryCaseId se pasa al where (reagenda el mismo caso)", async () => {
    tx.surgeryCase.findFirst.mockResolvedValue(null as never);
    await hayConflictoQuirofano(tx, {
      operatingRoomId: OR_ID,
      scheduledStart: start,
      scheduledEnd: end,
      excludeSurgeryCaseId: CASE_ID,
    });
    const args = tx.surgeryCase.findFirst.mock.calls[0]![0];
    expect((args!.where as { id: { not: string } }).id).toEqual({ not: CASE_ID });
  });

  it("vía NTEC (salaQxId): true si EceReservaSalaQx tiene overlap activo", async () => {
    tx.eceReservaSalaQx.findFirst.mockResolvedValue({ id: RESERVA_ID } as never);
    const result = await hayConflictoQuirofano(tx, {
      salaQxId: SALA_ID,
      scheduledStart: start,
      scheduledEnd: end,
    });
    expect(result).toBe(true);
    const args = tx.eceReservaSalaQx.findFirst.mock.calls[0]![0];
    expect((args!.where as { salaQxId: string }).salaQxId).toBe(SALA_ID);
  });

  it("vía NTEC: false si no hay overlap", async () => {
    tx.eceReservaSalaQx.findFirst.mockResolvedValue(null as never);
    const result = await hayConflictoQuirofano(tx, {
      salaQxId: SALA_ID,
      scheduledStart: start,
      scheduledEnd: end,
    });
    expect(result).toBe(false);
    expect(tx.surgeryCase.findFirst).not.toHaveBeenCalled();
  });

  it("sin operatingRoomId ni salaQxId: false, sin consultar ninguna tabla", async () => {
    const result = await hayConflictoQuirofano(tx, {
      scheduledStart: start,
      scheduledEnd: end,
    });
    expect(result).toBe(false);
    expect(tx.surgeryCase.findFirst).not.toHaveBeenCalled();
    expect(tx.eceReservaSalaQx.findFirst).not.toHaveBeenCalled();
  });
});
