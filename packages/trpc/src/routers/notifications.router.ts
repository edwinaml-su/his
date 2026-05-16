/**
 * Beta.15 (US.B15.3.1 + US.B15.3.3) — `notificationsRouter`.
 *
 * Inbox personal de cada usuario. Aísla por `recipientUserId = ctx.user.id`
 * AND `organizationId = ctx.tenant.organizationId`. RLS en DB ya enforce
 * el aislamiento por tenant; el filtro `recipientUserId` en el router evita
 * que un user vea notificaciones de otros dentro de su misma org.
 *
 * Procedures:
 *  - `list`           → paginación cursor-based (createdAt DESC, tiebreaker id).
 *  - `markRead`       → set status=READ + readAt=now si la notif es del user.
 *  - `unreadCount`    → conteo de PENDING+SENT del user (alimenta US.B15.3.2 navbar badge).
 *  - `getPreferences` → prefs del user + defaults heredados del rol (US.B15.3.3).
 *  - `setPreferences` → upsert de una fila UserNotificationPreference (US.B15.3.3).
 *  - `resetPreferences` → elimina overrides → vuelve a defaults del rol (US.B15.3.3).
 */
import { TRPCError } from "@trpc/server";
import {
  notificationsListInput,
  notificationsMarkReadInput,
  setPreferencesInput,
  DEFAULT_PREFERENCES_BY_ROLE,
  type NotificationSeverity,
  type NotificationChannel,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const notificationsRouter = router({
  /**
   * Lista las notificaciones del usuario actual ordenadas por `createdAt`
   * descendente. Pagina con cursor por `id`:
   *   - Primera página: sin cursor, retorna hasta `limit` rows.
   *   - Siguientes:    `cursor = lastId`, Prisma usa skip:1 para evitar duplicar.
   *
   * `nextCursor` es el `id` del último elemento del batch, o `null` si no
   * hay más resultados (cuando `items.length < limit`).
   */
  list: tenantProcedure
    .input(notificationsListInput)
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.notification.findMany({
        where: {
          recipientUserId: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
          ...(input.severity && { severity: input.severity }),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit,
        ...(input.cursor && {
          cursor: { id: input.cursor },
          skip: 1,
        }),
      });

      const nextCursor =
        items.length === input.limit ? items[items.length - 1]!.id : null;
      return { items, nextCursor };
    }),

  /**
   * Marca una notificación como leída. Idempotente.
   *
   * Usa `updateMany` con `where: { id, recipientUserId, organizationId }`
   * para que un attacker que adivine un id ajeno reciba count=0 (NOT_FOUND)
   * en vez de mutar la fila — RLS + filtro explícito en code.
   *
   * Si la notif ya está READ, devuelve `{ ok: true }` sin tocar `readAt`
   * (idempotencia: el filtro `status: { not: 'READ' }` evita sobreescribir
   * el timestamp original).
   */
  markRead: tenantProcedure
    .input(notificationsMarkReadInput)
    .mutation(async ({ ctx, input }) => {
      // Verificación previa: la notif debe existir y pertenecer al user.
      const exists = await ctx.prisma.notification.findFirst({
        where: {
          id: input.id,
          recipientUserId: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
        },
        select: { id: true, status: true },
      });
      if (!exists) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notificación no existe o no pertenece al usuario.",
        });
      }
      if (exists.status === "READ") {
        return { ok: true as const, alreadyRead: true };
      }

      await ctx.prisma.notification.updateMany({
        where: {
          id: input.id,
          recipientUserId: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
          status: { not: "READ" },
        },
        data: {
          status: "READ",
          readAt: new Date(),
        },
      });
      return { ok: true as const, alreadyRead: false };
    }),

  /**
   * Cuenta notificaciones no leídas (status IN (PENDING, SENT)) del user
   * actual. Alimenta el badge del navbar (US.B15.3.2, fuera de scope este PR).
   */
  unreadCount: tenantProcedure.query(async ({ ctx }) => {
    const count = await ctx.prisma.notification.count({
      where: {
        recipientUserId: ctx.user.id,
        organizationId: ctx.tenant.organizationId,
        status: { in: ["PENDING", "SENT"] },
      },
    });
    return { count };
  }),

  /**
   * US.B15.3.3 — Retorna las preferencias combinadas del usuario.
   *
   * Estrategia: carga filas de `UserNotificationPreference` del user y
   * los defaults de su rol desde `RoleNotificationDefault`. Combina la
   * matriz completa (severity × channel) marcando cada celda como override
   * (isUserOverride=true) o heredada (isUserOverride=false).
   *
   * No usa withTenantContext porque solo lee del propio userId (RLS aísla
   * automáticamente si la política está configurada; fallback explícito en
   * el where userId=ctx.user.id).
   */
  getPreferences: tenantProcedure.query(async ({ ctx }) => {
    const [userPrefs, roleDefaults] = await Promise.all([
      ctx.prisma.userNotificationPreference.findMany({
        where: { userId: ctx.user.id },
      }),
      ctx.prisma.roleNotificationDefault.findMany({
        where: {
          role: {
            userRoles: {
              some: {
                userId: ctx.user.id,
                organizationId: ctx.tenant.organizationId,
              },
            },
          },
        },
      }),
    ]);

    const SEVERITIES: NotificationSeverity[] = ["CRITICAL", "WARNING", "INFO"];
    const CHANNELS: NotificationChannel[] = ["EMAIL", "INBOX"];

    const userPrefMap = new Map(
      userPrefs.map((p) => [`${p.severity}:${p.channel}`, p.enabled]),
    );

    // Primer rol con defaults disponible (puede haber múltiples roles asignados).
    const roleDefaultMap = new Map(
      roleDefaults.map((d) => [`${d.severity}:${d.channel}`, d.enabled]),
    );

    const preferences = SEVERITIES.flatMap((severity) =>
      CHANNELS.map((channel) => {
        const key = `${severity}:${channel}`;
        const userValue = userPrefMap.get(key);
        if (userValue !== undefined) {
          return { severity, channel, enabled: userValue, isUserOverride: true };
        }
        return {
          severity,
          channel,
          enabled: roleDefaultMap.get(key) ?? false,
          isUserOverride: false,
        };
      }),
    );

    return { preferences };
  }),

  /**
   * US.B15.3.3 — Upsert de una preferencia específica del usuario.
   *
   * Política CRITICAL+INBOX: nunca se puede deshabilitar (AC #3 del backlog).
   * El check es en router (no en DB) para retornar un error útil a la UI.
   */
  setPreferences: tenantProcedure
    .input(setPreferencesInput)
    .mutation(async ({ ctx, input }) => {
      // CRITICAL no se puede deshabilitar en ningún canal.
      if (input.severity === "CRITICAL" && !input.enabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Las alertas CRITICAL no se pueden desactivar por política de cumplimiento.",
        });
      }

      await ctx.prisma.userNotificationPreference.upsert({
        where: {
          userId_severity_channel: {
            userId: ctx.user.id,
            severity: input.severity,
            channel: input.channel,
          },
        },
        create: {
          userId: ctx.user.id,
          severity: input.severity,
          channel: input.channel,
          enabled: input.enabled,
        },
        update: {
          enabled: input.enabled,
        },
      });

      return { ok: true as const };
    }),

  /**
   * US.B15.3.3 — Elimina todas las preferencias del usuario actual.
   * Esto hace que el dispatcher use los defaults del rol nuevamente.
   */
  resetPreferences: tenantProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.userNotificationPreference.deleteMany({
      where: { userId: ctx.user.id },
    });
    return { ok: true as const };
  }),
});
