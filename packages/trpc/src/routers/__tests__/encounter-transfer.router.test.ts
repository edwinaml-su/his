/**
 * Tests del encounterTransfer router (US-5.3 + sql/56 handoff).
 *
 * Cubre:
 *  - transferEncounter crea EncounterTransfer + actualiza Encounter.serviceUnitId.
 *  - valida que reason no sea vacío (Zod min(2)) → input rechazado.
 *  - listByEncounter filtra por encounterId tras verificar pertenencia al tenant.
 *  - confirmReceipt marca RECEIVED + emite outbox.
 *  - confirmReceipt idempotente (RECEIVED ⇒ no-op).
 *  - confirmReceipt rechaza CANCELLED.
 *  - listPendingArrivals filtra por status='SENT'.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { encounterTransferRouter } from "../encounter-transfer.router";
import { makeCtx } from "../../__tests__/helpers/caller";

function fn<T>(returnValue: T) {
  return vi.fn().mockResolvedValue(returnValue);
}

describe("encounterTransferRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
      .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
        fn(prisma),
      );
    // El emit cablea domainEvent.create + auditLog.create — mock genérico.
    prisma.domainEvent.create.mockResolvedValue({ id: "evt-1" } as never);
    prisma.auditLog.create.mockResolvedValue({ id: "audit-1" } as never);
  });

  describe("transferEncounter", () => {
    it("crea EncounterTransfer y actualiza serviceUnitId del encounter", async () => {
      const encId = "00000000-0000-0000-0000-000000000e01";
      const transferId = "00000000-0000-0000-0000-000000000111";
      const patientId = "00000000-0000-0000-0000-000000000aaa";
      const svcOld = "00000000-0000-0000-0000-000000000030";
      prisma.encounter.findFirst.mockResolvedValue({
        id: encId,
        patientId,
        dischargedAt: null,
        serviceUnitId: svcOld,
        bedAssignments: [],
      } as never);
      prisma.encounterTransfer.create.mockResolvedValue({
        id: transferId,
        occurredAt: new Date("2026-05-27T10:00:00Z"),
      } as never);
      prisma.encounter.update.mockResolvedValue({ id: encId } as never);

      const caller = encounterTransferRouter.createCaller(makeCtx({ prisma }));
      await caller.transferEncounter({
        encounterId: "00000000-0000-0000-0000-000000000010",
        toServiceUnitId: "00000000-0000-0000-0000-000000000020",
        reason: "Cambio a UCI por deterioro",
      });

      // 1) EncounterTransfer creado con razón.
      const tArgs = prisma.encounterTransfer.create.mock.calls[0]![0];
      expect(tArgs.data).toMatchObject({
        encounterId: encId,
        toServiceId: "00000000-0000-0000-0000-000000000020",
        reason: "Cambio a UCI por deterioro",
      });
      // 2) Encounter actualizado con nuevo serviceUnitId.
      const uArgs = prisma.encounter.update.mock.calls[0]![0];
      expect(uArgs.data.serviceUnitId).toBe(
        "00000000-0000-0000-0000-000000000020",
      );
      // 3) Outbox event patient.transfer.sent emitido.
      expect(prisma.domainEvent.create).toHaveBeenCalled();
      const evtArgs = prisma.domainEvent.create.mock.calls[0]![0];
      expect(evtArgs.data.eventType).toBe("patient.transfer.sent");
    });

    it("rechaza reason vacío (Zod min(2))", async () => {
      const caller = encounterTransferRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.transferEncounter({
          encounterId: "00000000-0000-0000-0000-000000000010",
          toServiceUnitId: "00000000-0000-0000-0000-000000000020",
          reason: "",
        }),
      ).rejects.toThrow();
    });
  });

  describe("listByEncounter", () => {
    it("filtra por encounterId tras verificar tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: "e1" } as never);
      prisma.encounterTransfer.findMany.mockResolvedValue([] as never);

      const caller = encounterTransferRouter.createCaller(makeCtx({ prisma }));
      await caller.listByEncounter({
        encounterId: "00000000-0000-0000-0000-000000000010",
      });

      const args = prisma.encounterTransfer.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        encounterId: "00000000-0000-0000-0000-000000000010",
      });
      expect(args.orderBy).toEqual({ occurredAt: "asc" });
    });

    it("retorna NOT_FOUND si el encounter no pertenece al tenant", async () => {
      prisma.encounter.findFirst = fn(null) as never;

      const caller = encounterTransferRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.listByEncounter({
          encounterId: "00000000-0000-0000-0000-000000000099",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ---------------------------------------------------------------------------
  // sql/56 — Handoff de recepción
  // ---------------------------------------------------------------------------

  describe("confirmReceipt (sql/56)", () => {
    const TRANSFER_ID = "00000000-0000-0000-0000-000000000aa1";
    const ENC_ID = "00000000-0000-0000-0000-000000000bb1";
    const PATIENT_ID = "00000000-0000-0000-0000-000000000cc1";
    const SVC_FROM = "00000000-0000-0000-0000-000000000dd1";
    const SVC_SOP = "00000000-0000-0000-0000-000000000dd2";
    const USER_ORIGEN = "00000000-0000-0000-0000-000000000ee1";

    const VALID_INPUT = {
      transferId: TRANSFER_ID,
      note: "Paciente alerta, vía aérea estable",
    };

    it("marca el traslado RECEIVED + emite patient.transfer.confirmed", async () => {
      prisma.encounterTransfer.findFirst.mockResolvedValue({
        id: TRANSFER_ID,
        status: "SENT",
        encounterId: ENC_ID,
        fromServiceId: SVC_FROM,
        toServiceId: SVC_SOP,
        fromBedId: null,
        toBedId: null,
        reason: "Pase a quirófano",
        occurredAt: new Date("2026-05-27T10:00:00Z"),
        createdBy: USER_ORIGEN,
        encounter: { patientId: PATIENT_ID },
      } as never);
      prisma.encounterTransfer.update.mockResolvedValue({
        id: TRANSFER_ID,
        status: "RECEIVED",
        encounterId: ENC_ID,
        fromServiceId: SVC_FROM,
        toServiceId: SVC_SOP,
        fromBedId: null,
        toBedId: null,
        reason: "Pase a quirófano",
        occurredAt: new Date("2026-05-27T10:00:00Z"),
        createdBy: USER_ORIGEN,
        receivedAt: new Date("2026-05-27T10:15:00Z"),
        receivedById: "00000000-0000-0000-0000-000000000ee2",
        receivedNote: VALID_INPUT.note,
      } as never);

      const caller = encounterTransferRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.confirmReceipt(VALID_INPUT);

      expect(prisma.encounterTransfer.update).toHaveBeenCalled();
      const upd = prisma.encounterTransfer.update.mock.calls[0]![0];
      expect(upd.data.status).toBe("RECEIVED");
      expect(upd.data.receivedAt).toBeInstanceOf(Date);

      // Outbox: evento confirmed con payload correcto.
      const evt = prisma.domainEvent.create.mock.calls[0]![0];
      expect(evt.data.eventType).toBe("patient.transfer.confirmed");
      expect(out.status).toBe("RECEIVED");
    });

    it("es idempotente: si ya está RECEIVED no hace update", async () => {
      prisma.encounterTransfer.findFirst.mockResolvedValue({
        id: TRANSFER_ID,
        status: "RECEIVED",
        encounterId: ENC_ID,
        fromServiceId: SVC_FROM,
        toServiceId: SVC_SOP,
        fromBedId: null,
        toBedId: null,
        reason: "Pase a quirófano",
        occurredAt: new Date(),
        createdBy: USER_ORIGEN,
        receivedAt: new Date(),
        receivedById: "00000000-0000-0000-0000-000000000ee2",
        receivedNote: null,
        encounter: { patientId: PATIENT_ID },
      } as never);

      const caller = encounterTransferRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.confirmReceipt(VALID_INPUT);

      expect(prisma.encounterTransfer.update).not.toHaveBeenCalled();
      expect(prisma.domainEvent.create).not.toHaveBeenCalled();
      expect(out.status).toBe("RECEIVED");
    });

    it("rechaza CANCELLED con CONFLICT", async () => {
      prisma.encounterTransfer.findFirst.mockResolvedValue({
        id: TRANSFER_ID,
        status: "CANCELLED",
        encounterId: ENC_ID,
        fromServiceId: null,
        toServiceId: SVC_SOP,
        fromBedId: null,
        toBedId: null,
        reason: "Pase a quirófano",
        occurredAt: new Date(),
        createdBy: null,
        encounter: { patientId: PATIENT_ID },
      } as never);

      const caller = encounterTransferRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.confirmReceipt(VALID_INPUT)).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("retorna NOT_FOUND si el transfer no pertenece al tenant", async () => {
      prisma.encounterTransfer.findFirst.mockResolvedValue(null as never);

      const caller = encounterTransferRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.confirmReceipt(VALID_INPUT)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("listPendingArrivals (sql/56)", () => {
    it("filtra por status='SENT' y respeta toServiceUnitId opcional", async () => {
      prisma.encounterTransfer.findMany.mockResolvedValue([] as never);

      const caller = encounterTransferRouter.createCaller(makeCtx({ prisma }));
      await caller.listPendingArrivals({
        toServiceUnitId: "00000000-0000-0000-0000-000000000abc",
        limit: 25,
      });

      const args = prisma.encounterTransfer.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        status: "SENT",
        toServiceId: "00000000-0000-0000-0000-000000000abc",
      });
      expect(args.take).toBe(25);
      expect(args.orderBy).toEqual({ occurredAt: "asc" }); // FIFO
    });
  });
});
