/**
 * Tests del notificationsRouter (Beta.15 — US.B15.3.1 + US.B15.3.3).
 *
 * Cubre:
 *  - list: filtro por user+tenant, severity, cursor pagination, nextCursor.
 *  - markRead: NOT_FOUND si no es del user, idempotencia si ya READ, happy-path.
 *  - unreadCount: filtro por status IN (PENDING, SENT) del user actual.
 *  - getPreferences: combina prefs user + defaults rol, marca isUserOverride.
 *  - setPreferences: upsert, bloquea deshabilitar CRITICAL.
 *  - resetPreferences: deleteMany filtrado por userId.
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

  // ─── US.B15.3.3 ────────────────────────────────────────────────────────────

  describe("getPreferences", () => {
    it("retorna 6 combinaciones (3 severidades × 2 canales) con isUserOverride=false cuando no hay prefs", async () => {
      prisma.userNotificationPreference.findMany.mockResolvedValue([] as never);
      prisma.roleNotificationDefault.findMany.mockResolvedValue([
        { severity: "CRITICAL", channel: "EMAIL", enabled: true },
        { severity: "CRITICAL", channel: "INBOX", enabled: true },
        { severity: "WARNING", channel: "EMAIL", enabled: false },
        { severity: "WARNING", channel: "INBOX", enabled: true },
        { severity: "INFO", channel: "EMAIL", enabled: false },
        { severity: "INFO", channel: "INBOX", enabled: true },
      ] as never);

      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.getPreferences();

      expect(result.preferences).toHaveLength(6);
      expect(result.preferences.every((p) => !p.isUserOverride)).toBe(true);

      const critEmail = result.preferences.find(
        (p) => p.severity === "CRITICAL" && p.channel === "EMAIL",
      );
      expect(critEmail?.enabled).toBe(true);
      expect(critEmail?.isUserOverride).toBe(false);
    });

    it("marca isUserOverride=true para combinaciones con preferencia explícita del user", async () => {
      prisma.userNotificationPreference.findMany.mockResolvedValue([
        {
          userId: MOCK_USER_ADMIN.id,
          severity: "WARNING",
          channel: "EMAIL",
          enabled: false,
          updatedAt: new Date(),
        },
      ] as never);
      prisma.roleNotificationDefault.findMany.mockResolvedValue([
        { severity: "WARNING", channel: "EMAIL", enabled: true },
        { severity: "WARNING", channel: "INBOX", enabled: true },
        { severity: "CRITICAL", channel: "EMAIL", enabled: true },
        { severity: "CRITICAL", channel: "INBOX", enabled: true },
        { severity: "INFO", channel: "EMAIL", enabled: false },
        { severity: "INFO", channel: "INBOX", enabled: true },
      ] as never);

      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.getPreferences();

      const warnEmail = result.preferences.find(
        (p) => p.severity === "WARNING" && p.channel === "EMAIL",
      );
      // El user desactivó; el role default dice true — debe ganar el override del user.
      expect(warnEmail?.enabled).toBe(false);
      expect(warnEmail?.isUserOverride).toBe(true);

      // Las demás deben ser heredadas.
      const warnInbox = result.preferences.find(
        (p) => p.severity === "WARNING" && p.channel === "INBOX",
      );
      expect(warnInbox?.isUserOverride).toBe(false);
    });

    it("getPreferences: filtra roleDefaults por userId del user actual", async () => {
      prisma.userNotificationPreference.findMany.mockResolvedValue([] as never);
      prisma.roleNotificationDefault.findMany.mockResolvedValue([] as never);

      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      await caller.getPreferences();

      const userPrefArgs = prisma.userNotificationPreference.findMany.mock.calls[0]![0];
      expect(userPrefArgs!.where).toMatchObject({
        userId: MOCK_USER_ADMIN.id,
      });

      const roleArgs = prisma.roleNotificationDefault.findMany.mock.calls[0]![0];
      expect(roleArgs!.where).toMatchObject({
        role: {
          userRoles: {
            some: {
              userId: MOCK_USER_ADMIN.id,
              organizationId: MOCK_TENANT.organizationId,
            },
          },
        },
      });
    });

    it("getPreferences: sin tenant → FORBIDDEN", async () => {
      const caller = notificationsRouter.createCaller(
        makeCtx({ prisma, tenant: null }),
      );
      await expect(caller.getPreferences()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("setPreferences", () => {
    it("hace upsert con userId=ctx.user.id", async () => {
      prisma.userNotificationPreference.upsert.mockResolvedValue({} as never);

      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.setPreferences({
        severity: "WARNING",
        channel: "EMAIL",
        enabled: false,
      });

      expect(result).toEqual({ ok: true });
      const args = prisma.userNotificationPreference.upsert.mock.calls[0]![0];
      expect(args.where.userId_severity_channel).toMatchObject({
        userId: MOCK_USER_ADMIN.id,
        severity: "WARNING",
        channel: "EMAIL",
      });
      expect(args.create).toMatchObject({
        userId: MOCK_USER_ADMIN.id,
        enabled: false,
      });
      expect(args.update).toMatchObject({ enabled: false });
    });

    it("rechaza deshabilitar CRITICAL con BAD_REQUEST", async () => {
      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.setPreferences({ severity: "CRITICAL", channel: "EMAIL", enabled: false }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      // No debe llegar al upsert.
      expect(prisma.userNotificationPreference.upsert).not.toHaveBeenCalled();
    });

    it("permite habilitar CRITICAL (solo deshabilitar está bloqueado)", async () => {
      prisma.userNotificationPreference.upsert.mockResolvedValue({} as never);

      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.setPreferences({
        severity: "CRITICAL",
        channel: "INBOX",
        enabled: true,
      });
      expect(result.ok).toBe(true);
    });

    it("setPreferences: sin tenant → FORBIDDEN", async () => {
      const caller = notificationsRouter.createCaller(
        makeCtx({ prisma, tenant: null }),
      );
      await expect(
        caller.setPreferences({ severity: "INFO", channel: "EMAIL", enabled: false }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("resetPreferences", () => {
    it("elimina todas las prefs del user actual con deleteMany", async () => {
      prisma.userNotificationPreference.deleteMany.mockResolvedValue({ count: 3 } as never);

      const caller = notificationsRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.resetPreferences();

      expect(result).toEqual({ ok: true });
      const args = prisma.userNotificationPreference.deleteMany.mock.calls[0]![0];
      expect(args!.where).toMatchObject({ userId: MOCK_USER_ADMIN.id });
    });

    it("resetPreferences: sin tenant → FORBIDDEN", async () => {
      const caller = notificationsRouter.createCaller(
        makeCtx({ prisma, tenant: null }),
      );
      await expect(caller.resetPreferences()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });
});
