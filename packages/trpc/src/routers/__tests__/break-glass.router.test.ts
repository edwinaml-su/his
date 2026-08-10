/**
 * CC-0017 F3 — `breakGlassRouter.activate` encola la notificación al jefe de
 * servicio (fallback DIR/ADMIN/MEDICAL_DIRECTOR) vía el outbox existente
 * (`emitDomainEvent`), además del audit log inmutable action=BREAK_GLASS que
 * ya existía. Un fallo al encolar NO debe convertir la activación (ya
 * exitosa) en un error — el acceso de emergencia siempre debe completarse.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { breakGlassRouter } from "../break-glass.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

describe("breakGlassRouter.activate — notificación (CC-0017 F3)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.patient.findUnique.mockResolvedValue({ id: PATIENT_ID } as never);
    prisma.auditLog.create.mockResolvedValue({
      id: 1n,
      occurredAt: new Date(),
    } as never);
    prisma.domainEvent.create.mockResolvedValue({ id: "event-1" } as never);
  });

  const input = {
    patientId: PATIENT_ID,
    justification: "Paciente inconsciente, requiere revisión urgente de alergias.",
    chiefNotifiedAck: true,
  };

  it("activación exitosa encola security.breakGlass.activated (domainEvent.create) sin bloquear la respuesta", async () => {
    const caller = breakGlassRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT }));

    const result = await caller.activate(input);

    expect(result.ok).toBe(true);
    expect(prisma.domainEvent.create).toHaveBeenCalledTimes(1);
    const call = prisma.domainEvent.create.mock.calls[0]![0] as {
      data: { eventType: string; payload: Record<string, unknown> };
    };
    expect(call.data.eventType).toBe("security.breakGlass.activated");
    expect(call.data.payload).toMatchObject({
      patientId: PATIENT_ID,
      organizationId: MOCK_TENANT.organizationId,
    });
  });

  it("emitDomainEvent falla → activación igual responde ok:true (best-effort)", async () => {
    prisma.domainEvent.create.mockRejectedValueOnce(new Error("outbox down") as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const caller = breakGlassRouter.createCaller(makeCtx({ prisma, tenant: MOCK_TENANT }));
    const result = await caller.activate(input);

    expect(result.ok).toBe(true);
    consoleSpy.mockRestore();
  });
});
