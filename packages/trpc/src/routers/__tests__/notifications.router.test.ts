/**
 * Tests del notificationsRouter (Beta.15 — US.B15.3.1).
 *
 * Cubre:
 *  - list: filtro por user+tenant, severity, cursor pagination, nextCursor.
 *  - markRead: NOT_FOUND si no es del user, idempotencia si ya READ, happy-path.
 *  - unreadCount: filtro por status IN (PENDING, SENT) del user actual.
 *  - Cross-tenant: aislamiento por organizationId + recipientUserId.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { notificationsRouter } from "../notifications.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

const idA = "00000000-0000-0000-0000-00000000aaa1";
const idB = "00000000-0000-0000-0000-00000000aaa2";
const idC = "00000000-0000-0000-0000-00000000aaa3";

describe("notificationsRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("list", () => {
    it("filtra por recipientUserId del user y organizationId del tenant", async () => {
      prisma.notification.findMany.mockResolvedValue([] as never);

      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ limit: 25 });

      const args = prisma.notification.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        recipientUserId: MOCK_USER_ADMIN.id,
        organizationId: MOCK_TENANT.organizationId,
      });
      expect(args.take).toBe(25);
      expect(args.orderBy).toEqual([
        { createdAt: "desc" },
        { id: "desc" },
      ]);
    });

    it("aplica filtro por severity cuando se provee", async () => {
      prisma.notification.findMany.mockResolvedValue([] as never);
      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ severity: "CRITICAL", limit: 25 });

      expect(prisma.notification.findMany.mock.calls[0]![0].where).toMatchObject({
        severity: "CRITICAL",
      });
    });

    it("retorna nextCursor=null cuando hay menos items que limit", async () => {
      prisma.notification.findMany.mockResolvedValue([
        { id: idA, createdAt: new Date() },
      ] as never);
      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.list({ limit: 25 });
      expect(r.items).toHaveLength(1);
      expect(r.nextCursor).toBeNull();
    });

    it("retorna nextCursor=lastId cuando se llenó el batch (hay más)", async () => {
      const rows = Array.from({ length: 25 }, (_, i) => ({
        id: `00000000-0000-0000-0000-000000000${(100 + i).toString().padStart(3, "0")}`,
        createdAt: new Date(),
      }));
      prisma.notification.findMany.mockResolvedValue(rows as never);

      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.list({ limit: 25 });
      expect(r.items).toHaveLength(25);
      expect(r.nextCursor).toBe(rows[24]!.id);
    });

    it("aplica cursor + skip:1 cuando se provee", async () => {
      prisma.notification.findMany.mockResolvedValue([] as never);
      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ limit: 25, cursor: idA });

      const args = prisma.notification.findMany.mock.calls[0]![0];
      expect(args.cursor).toEqual({ id: idA });
      expect(args.skip).toBe(1);
    });
  });

  describe("markRead", () => {
    it("NOT_FOUND si la notif no existe o no es del user", async () => {
      prisma.notification.findFirst.mockResolvedValue(null as never);
      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.markRead({ id: idA })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(prisma.notification.updateMany).not.toHaveBeenCalled();
    });

    it("idempotente: si ya está READ no toca readAt y devuelve alreadyRead", async () => {
      prisma.notification.findFirst.mockResolvedValue({
        id: idA,
        status: "READ",
      } as never);
      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.markRead({ id: idA });
      expect(r).toEqual({ ok: true, alreadyRead: true });
      expect(prisma.notification.updateMany).not.toHaveBeenCalled();
    });

    it("marca como READ con readAt=now cuando estaba PENDING", async () => {
      prisma.notification.findFirst.mockResolvedValue({
        id: idA,
        status: "PENDING",
      } as never);
      prisma.notification.updateMany.mockResolvedValue({ count: 1 } as never);

      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.markRead({ id: idA });
      expect(r).toEqual({ ok: true, alreadyRead: false });

      const args = prisma.notification.updateMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        id: idA,
        recipientUserId: MOCK_USER_ADMIN.id,
        organizationId: MOCK_TENANT.organizationId,
      });
      const data = args.data as { status: string; readAt: Date };
      expect(data.status).toBe("READ");
      expect(data.readAt).toBeInstanceOf(Date);
    });

    it("marca como READ cuando estaba SENT", async () => {
      prisma.notification.findFirst.mockResolvedValue({
        id: idB,
        status: "SENT",
      } as never);
      prisma.notification.updateMany.mockResolvedValue({ count: 1 } as never);

      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.markRead({ id: idB });
      expect(r.ok).toBe(true);
      expect(r.alreadyRead).toBe(false);
    });
  });

  describe("unreadCount", () => {
    it("cuenta solo PENDING+SENT del user en su tenant", async () => {
      prisma.notification.count.mockResolvedValue(7 as never);

      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.unreadCount();

      expect(r).toEqual({ count: 7 });
      const args = prisma.notification.count.mock.calls[0]![0];
      expect(args!.where).toMatchObject({
        recipientUserId: MOCK_USER_ADMIN.id,
        organizationId: MOCK_TENANT.organizationId,
        status: { in: ["PENDING", "SENT"] },
      });
    });

    it("retorna 0 si no hay notificaciones unread", async () => {
      prisma.notification.count.mockResolvedValue(0 as never);
      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.unreadCount();
      expect(r.count).toBe(0);
    });
  });

  describe("aislamiento cross-tenant", () => {
    it("list: si el user no tiene tenant → FORBIDDEN", async () => {
      const caller = notificationsRouter.createCaller(
        makeCtx({ prisma, tenant: null }),
      );
      await expect(caller.list({ limit: 25 })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("markRead: filtro por recipientUserId impide marcar notif ajena", async () => {
      // Aunque attacker provea un id válido, findFirst devuelve null
      // porque el where filtra por recipientUserId=ctx.user.id.
      prisma.notification.findFirst.mockResolvedValue(null as never);
      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.markRead({ id: idC })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      const args = prisma.notification.findFirst.mock.calls[0]![0];
      expect(args!.where).toMatchObject({
        id: idC,
        recipientUserId: MOCK_USER_ADMIN.id,
        organizationId: MOCK_TENANT.organizationId,
      });
    });
  });
});
