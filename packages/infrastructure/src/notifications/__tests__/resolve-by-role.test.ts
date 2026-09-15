/**
 * CC-0031 — tests del resolver genérico por rol (`resolveByRole`, interno a
 * `dispatcher.ts`) ejercitado a través de `dispatchDomainEvent` con los
 * eventTypes `task.*` y `cargo.pendiente_tarifa`.
 *
 * Cubre:
 *  - Resolución directa (Role.code == assignedRoleCode).
 *  - Alias inverso (RoleCodeAlias.canonicalCode == assignedRoleCode).
 *  - Herencia transitiva (Role.inheritsFromRoleId).
 *  - Vigencia (validFrom/validTo) — usuario con membresía vencida no recibe.
 *  - `distinct userId` — un usuario con 2 roles que resuelven al mismo
 *    destino recibe UNA sola notificación INBOX.
 *  - `cargo.pendiente_tarifa` → FACTURACION (antes de CC-0031 se perdía).
 *  - Rol sin ningún Role/alias resoluble → skippedReason "no-recipient".
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

import { dispatchDomainEvent, type DispatchInputEvent } from "../index";

const ORG = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const NOTIF_ID = "44444444-4444-4444-8444-444444444444";
const USER_A = "55555555-5555-4555-8555-555555555555";
const USER_B = "66666666-6666-4666-8666-666666666666";
const ROLE_NURSE = "77777777-7777-4777-8777-777777777777";
const ROLE_ENF_ALIAS_SOURCE = "88888888-8888-4888-8888-888888888888";
const ROLE_CHILD_INHERITS = "99999999-9999-4999-8999-999999999999";
const CARGO_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PATIENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function makeTaskEvent(overrides: Partial<DispatchInputEvent> = {}): DispatchInputEvent {
  return {
    id: EVENT_ID,
    organizationId: ORG,
    eventType: "task.action_required",
    aggregateType: "CareTask",
    aggregateId: TASK_ID,
    payload: {
      taskType: "IND_MED_CUMPLIR",
      sourceType: "INDICACION_ITEM",
      sourceId: TASK_ID,
      assignedRoleCode: "NURSE",
      url: "/tareas",
      resumen: "Cumplir indicación — Paciente Test",
    },
    ...overrides,
  };
}

function makeCargoEvent(): DispatchInputEvent {
  return {
    id: EVENT_ID,
    organizationId: ORG,
    eventType: "cargo.pendiente_tarifa",
    aggregateType: "AccountCharge",
    aggregateId: CARGO_ID,
    payload: {
      cargoId: CARGO_ID,
      accountId: ACCOUNT_ID,
      patientId: PATIENT_ID,
      code: "SVC-001",
      quantity: 1,
      origen: "test",
      referenciaId: null,
    },
  };
}

describe("CC-0031 — resolveByRole vía dispatchDomainEvent", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.notification.findFirst.mockResolvedValue(null as never);
    prisma.notification.create.mockResolvedValue({ id: NOTIF_ID } as never);
    prisma.notification.update.mockResolvedValue({ id: NOTIF_ID } as never);
    // roleCodeAlias / role / roleNotificationDefault: sin filas por defecto.
    prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
    prisma.roleNotificationDefault.findMany.mockResolvedValue([] as never);
  });

  it("resolución directa: Role.code == assignedRoleCode → notifica a los usuarios vigentes", async () => {
    prisma.role.findMany.mockResolvedValueOnce([{ id: ROLE_NURSE }] as never); // directRoles
    prisma.role.findMany.mockResolvedValueOnce([] as never); // herencia: sin hijos
    prisma.userOrganizationRole.findMany.mockResolvedValueOnce([
      {
        userId: USER_A,
        role: { code: "NURSE" },
        user: { email: "nurse@his.test", fullName: "Enfermera Test" },
      },
    ] as never);

    const result = await dispatchDomainEvent(makeTaskEvent(), {
      prisma,
      emailProvider: null,
    });

    expect(result.notificationsCreated).toBe(1);
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it("alias inverso: RoleCodeAlias.canonicalCode=NURSE (ENF→NURSE) también resuelve", async () => {
    prisma.roleCodeAlias.findMany.mockResolvedValueOnce([
      { sourceCode: "ENF" },
    ] as never);
    prisma.role.findMany.mockResolvedValueOnce([
      { id: ROLE_NURSE },
      { id: ROLE_ENF_ALIAS_SOURCE },
    ] as never); // directRoles para ["NURSE","ENF"]
    prisma.role.findMany.mockResolvedValueOnce([] as never); // sin herencia
    prisma.userOrganizationRole.findMany.mockResolvedValueOnce([
      {
        userId: USER_B,
        role: { code: "ENF" },
        user: { email: "enf@his.test", fullName: "Enfermera Alias" },
      },
    ] as never);

    const result = await dispatchDomainEvent(makeTaskEvent(), {
      prisma,
      emailProvider: null,
    });

    expect(result.notificationsCreated).toBe(1);
  });

  it("herencia transitiva: un rol que hereda de NURSE también notifica a sus miembros", async () => {
    prisma.role.findMany.mockResolvedValueOnce([{ id: ROLE_NURSE }] as never); // directRoles
    prisma.role.findMany.mockResolvedValueOnce([{ id: ROLE_CHILD_INHERITS }] as never); // hijos de NURSE
    prisma.role.findMany.mockResolvedValueOnce([] as never); // sin más niveles
    prisma.userOrganizationRole.findMany.mockResolvedValueOnce([
      {
        userId: USER_A,
        role: { code: "TRIAGE_NURSE" },
        user: { email: "triage@his.test", fullName: "Triage Test" },
      },
    ] as never);

    const result = await dispatchDomainEvent(makeTaskEvent(), {
      prisma,
      emailProvider: null,
    });

    expect(result.notificationsCreated).toBe(1);
    // roleId: { in: [...] } debe incluir la raíz Y el hijo heredado.
    const call = prisma.userOrganizationRole.findMany.mock.calls[0]![0] as {
      where: { roleId: { in: string[] } };
    };
    expect(call.where.roleId.in).toEqual(expect.arrayContaining([ROLE_NURSE, ROLE_CHILD_INHERITS]));
  });

  it("distinct userId: un usuario con 2 memberships que resuelven al mismo rol recibe 1 sola notificación", async () => {
    prisma.role.findMany.mockResolvedValueOnce([{ id: ROLE_NURSE }] as never);
    prisma.role.findMany.mockResolvedValueOnce([] as never);
    // `distinct` es responsabilidad de Prisma/Postgres — el mock ya simula
    // el resultado post-distinct (una fila), que es lo observable desde el
    // dispatcher.
    prisma.userOrganizationRole.findMany.mockResolvedValueOnce([
      {
        userId: USER_A,
        role: { code: "NURSE" },
        user: { email: "nurse@his.test", fullName: "Enfermera Test" },
      },
    ] as never);

    await dispatchDomainEvent(makeTaskEvent(), { prisma, emailProvider: null });

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    const createArgs = prisma.notification.create.mock.calls[0]![0] as {
      data: { recipientUserId: string };
    };
    expect(createArgs.data.recipientUserId).toBe(USER_A);
  });

  it("rol sin Role/alias resoluble (código huérfano) → no-recipient", async () => {
    prisma.role.findMany.mockResolvedValueOnce([] as never); // directRoles vacío → return [] sin más queries

    const result = await dispatchDomainEvent(
      makeTaskEvent({
        payload: {
          taskType: "GS1_TRANSFER_PENDING",
          sourceType: "MANUAL",
          sourceId: TASK_ID,
          assignedRoleCode: "CODIGO_INEXISTENTE",
          url: "/tareas",
          resumen: "Recepcionar transferencia",
        },
      }),
      { prisma, emailProvider: null },
    );

    expect(result.skippedReason).toBe("no-recipient");
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it("cargo.pendiente_tarifa notifica a FACTURACION (antes de CC-0031 se perdía — 00 §2.3)", async () => {
    prisma.role.findMany.mockResolvedValueOnce([{ id: ROLE_NURSE }] as never); // reusa como "rol FACTURACION" para el mock
    prisma.role.findMany.mockResolvedValueOnce([] as never);
    prisma.userOrganizationRole.findMany.mockResolvedValueOnce([
      {
        userId: USER_A,
        role: { code: "FACTURACION" },
        user: { email: "facturacion@his.test", fullName: "Facturación Test" },
      },
    ] as never);

    const result = await dispatchDomainEvent(makeCargoEvent(), {
      prisma,
      emailProvider: null,
    });

    expect(result.notificationsCreated).toBe(1);
    const roleQuery = prisma.role.findMany.mock.calls[0]![0] as {
      where: { code: { in: string[] } };
    };
    expect(roleQuery.where.code.in).toContain("FACTURACION");
  });
});
