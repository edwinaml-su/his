import { z } from "zod";

/**
 * Beta.15 — schemas Zod del bounded context Notifications.
 *
 * Mapean 1:1 a los enums Prisma (`NotificationChannel`, `NotificationSeverity`,
 * `NotificationStatus`) y al modelo `Notification`. El dispatcher
 * (`@his/notifications`) los consume para tipar payloads de su API.
 *
 * Decisiones de tipo:
 *  - `body` y `subject` con bounds matcheando `@db.VarChar(N)` del schema Prisma.
 *  - `metadata` es `Record<string, unknown>` (JSONB libre, sin shape estricto).
 *
 * Ver blueprint §3.3.
 */

export const notificationChannelSchema = z.enum(["INBOX", "EMAIL"]);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const notificationSeveritySchema = z.enum(["CRITICAL", "WARNING", "INFO"]);
export type NotificationSeverity = z.infer<typeof notificationSeveritySchema>;

export const notificationStatusSchema = z.enum([
  "PENDING",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
]);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

/** Envelope completo de una row de `Notification`. */
export const notificationSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  eventId: z.string().uuid(),
  recipientUserId: z.string().uuid(),
  channel: notificationChannelSchema,
  severity: notificationSeveritySchema,
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  status: notificationStatusSchema,
  sentAt: z.coerce.date().nullable(),
  deliveredAt: z.coerce.date().nullable(),
  readAt: z.coerce.date().nullable(),
  failedAt: z.coerce.date().nullable(),
  failureReason: z.string().max(2000).nullable(),
  providerMessageId: z.string().max(120).nullable(),
  metadata: z.record(z.unknown()).nullable(),
  attempts: z.number().int().min(0),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Notification = z.infer<typeof notificationSchema>;

/**
 * Beta.15 (US.B15.3.1) — input schemas para `notificationsRouter`.
 *
 * `list`     → paginación cursor-based por `id` (más robusto que offset
 *              cuando llegan notificaciones nuevas en background).
 * `markRead` → idempotente: `updateMany` filtrando por recipientUserId
 *              en el router evita escalar a otro user.
 */
export const notificationsListInput = z.object({
  severity: notificationSeveritySchema.optional(),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});
export type NotificationsListInput = z.infer<typeof notificationsListInput>;

export const notificationsMarkReadInput = z.object({
  id: z.string().uuid(),
});
export type NotificationsMarkReadInput = z.infer<typeof notificationsMarkReadInput>;

/** Una fila de `UserNotificationPreference`. PK = (userId, severity, channel). */
export const userNotificationPreferenceSchema = z.object({
  userId: z.string().uuid(),
  severity: notificationSeveritySchema,
  channel: notificationChannelSchema,
  enabled: z.boolean(),
  updatedAt: z.coerce.date(),
});
export type UserNotificationPreference = z.infer<typeof userNotificationPreferenceSchema>;

/** Una fila de `RoleNotificationDefault`. PK = (roleId, severity, channel). */
export const roleNotificationDefaultSchema = z.object({
  roleId: z.string().uuid(),
  severity: notificationSeveritySchema,
  channel: notificationChannelSchema,
  enabled: z.boolean(),
});
export type RoleNotificationDefault = z.infer<typeof roleNotificationDefaultSchema>;

/**
 * Defaults por rol (matriz @PO §6 del backlog). Valores codificados aquí para
 * que el seed JS los reutilice y la UI de preferencias renderice el fallback.
 *
 * Roles canónicos: DOCTOR, NURSE, PHARMACIST, ADMIN.
 */
export const DEFAULT_PREFERENCES_BY_ROLE: ReadonlyArray<{
  roleCode: "DOCTOR" | "NURSE" | "PHARMACIST" | "ADMIN";
  severity: NotificationSeverity;
  channel: NotificationChannel;
  enabled: boolean;
}> = [
  // DOCTOR — CRITICAL + WARNING vía EMAIL+INBOX, INFO solo inbox.
  { roleCode: "DOCTOR", severity: "CRITICAL", channel: "EMAIL", enabled: true },
  { roleCode: "DOCTOR", severity: "CRITICAL", channel: "INBOX", enabled: true },
  { roleCode: "DOCTOR", severity: "WARNING", channel: "EMAIL", enabled: true },
  { roleCode: "DOCTOR", severity: "WARNING", channel: "INBOX", enabled: true },
  { roleCode: "DOCTOR", severity: "INFO", channel: "EMAIL", enabled: false },
  { roleCode: "DOCTOR", severity: "INFO", channel: "INBOX", enabled: true },

  // NURSE — CRITICAL email+inbox, WARNING+INFO solo inbox.
  { roleCode: "NURSE", severity: "CRITICAL", channel: "EMAIL", enabled: true },
  { roleCode: "NURSE", severity: "CRITICAL", channel: "INBOX", enabled: true },
  { roleCode: "NURSE", severity: "WARNING", channel: "EMAIL", enabled: false },
  { roleCode: "NURSE", severity: "WARNING", channel: "INBOX", enabled: true },
  { roleCode: "NURSE", severity: "INFO", channel: "EMAIL", enabled: false },
  { roleCode: "NURSE", severity: "INFO", channel: "INBOX", enabled: true },

  // PHARMACIST — igual que Doctor (interacciones farmacia son su core).
  { roleCode: "PHARMACIST", severity: "CRITICAL", channel: "EMAIL", enabled: true },
  { roleCode: "PHARMACIST", severity: "CRITICAL", channel: "INBOX", enabled: true },
  { roleCode: "PHARMACIST", severity: "WARNING", channel: "EMAIL", enabled: true },
  { roleCode: "PHARMACIST", severity: "WARNING", channel: "INBOX", enabled: true },
  { roleCode: "PHARMACIST", severity: "INFO", channel: "EMAIL", enabled: false },
  { roleCode: "PHARMACIST", severity: "INFO", channel: "INBOX", enabled: true },

  // ADMIN — CRITICAL email+inbox, WARNING inbox, INFO off.
  { roleCode: "ADMIN", severity: "CRITICAL", channel: "EMAIL", enabled: true },
  { roleCode: "ADMIN", severity: "CRITICAL", channel: "INBOX", enabled: true },
  { roleCode: "ADMIN", severity: "WARNING", channel: "EMAIL", enabled: false },
  { roleCode: "ADMIN", severity: "WARNING", channel: "INBOX", enabled: true },
  { roleCode: "ADMIN", severity: "INFO", channel: "EMAIL", enabled: false },
  { roleCode: "ADMIN", severity: "INFO", channel: "INBOX", enabled: false },
];
