/**
 * Dispatcher TS — Beta.15 (US.B15.2.3).
 *
 * Dado un `DomainEvent` ya en el outbox (publishedAt = NULL típicamente),
 * resuelve recipient(s), crea filas `Notification` (INBOX + EMAIL según
 * routing rules) e invoca el `EmailProvider` para los canales EMAIL.
 *
 * Diseño:
 *   - Código TS puro. NO abre conexiones; recibe Prisma + EmailProvider
 *     por dependency injection. El caller (Edge Function o cron) hace el
 *     wiring de runtime — esto deja la pieza testeable con mocks.
 *   - Idempotente: si ya existen filas `Notification` para `eventId`,
 *     short-circuit (skipped: "already-dispatched").
 *   - Provider opcional: si `ctx.emailProvider == null`, solo se crean
 *     filas INBOX. Útil para entornos sin RESEND_API_KEY.
 *   - Errores transient vs permanent diferenciados — `TransientProviderError`
 *     deja la fila EMAIL en PENDING (retry futuro); `PermanentProviderError`
 *     la marca FAILED con `failureReason`.
 *
 * Interface `EmailProvider` canónica vive en `@his/contracts` (Track A / #58).
 * Adapter Resend concreto vive en `./resend.ts`.
 */
import {
  domainEventPayloadSchema,
  PermanentProviderError,
  TransientProviderError,
  type EmailProvider,
  type VitalCriticalPayload,
  type LabCriticalValuePayload,
  type DrugInteractionPayload,
  type AllergyMismatchPayload,
} from "@his/contracts";
import type { Prisma, PrismaClient } from "@prisma/client";

import {
  resolveChannels,
  type RoleSeverityMatrix,
  type Severity,
} from "./routing";
import {
  buildAllergyMismatchTemplate,
  buildDrugInteractionTemplate,
  buildLabCriticalValueTemplate,
  buildVitalCriticalTemplate,
  type RenderedTemplate,
} from "./templates";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Cliente Prisma (root o transaction). El dispatcher NO abre transacción. */
export type DispatcherPrisma = PrismaClient | Prisma.TransactionClient;

export interface DispatchContext {
  prisma: DispatcherPrisma;
  /** Provider para canal EMAIL. `null` deshabilita el envío de emails (solo INBOX). */
  emailProvider: EmailProvider | null;
  /** Overrides para tests; en prod se leen desde `RoleNotificationDefault`. */
  defaults?: ReadonlyMap<string, RoleSeverityMatrix>;
  /**
   * Carga preferencias del user (UserNotificationPreference). Si no se
   * provee → solo defaults del rol. Útil para inyectar mock en tests.
   */
  loadUserPreferences?: (userId: string) => Promise<
    ReadonlyArray<{ severity: string; channel: string; enabled: boolean }>
  >;
  /** Email del sender — default `process.env.NOTIFICATIONS_FROM_EMAIL`. */
  fromEmail?: string;
}

export interface DispatchInputEvent {
  id: string;
  organizationId: string;
  eventType: string;
  payload: unknown;
  aggregateType: string;
  aggregateId: string;
}

export interface DispatchResult {
  notificationsCreated: number;
  emailsSent: number;
  emailsFailed: number;
  skippedReason?: "already-dispatched" | "no-recipient" | "no-payload";
}

// -----------------------------------------------------------------------------
// Internals — recipient resolution per eventType
// -----------------------------------------------------------------------------

interface ResolvedRecipient {
  userId: string;
  email: string | null;
  fullName: string | null;
  roleCode: string | null;
  severity: Severity;
}

async function resolveRecipientsAndSeverity(
  event: DispatchInputEvent,
  prisma: DispatcherPrisma,
): Promise<ResolvedRecipient[]> {
  // Validación de payload (discriminated union): si el shape no matchea, retorna [].
  // El catch silencioso aquí está justificado porque `no-payload` se reporta
  // como `skippedReason` al caller — no queremos throw que rompa el poller.
  let parsed: ReturnType<typeof domainEventPayloadSchema.parse> | null;
  try {
    parsed = domainEventPayloadSchema.parse({
      eventType: event.eventType,
      payload: event.payload,
    });
  } catch {
    return [];
  }

  switch (parsed.eventType) {
    case "vital.critical":
      return resolveVitalCritical(parsed.payload, prisma);
    case "lab.criticalValue":
      return resolveLabCriticalValue(parsed.payload, event.organizationId, prisma);
    case "drug.interaction":
      return resolveDrugInteraction(parsed.payload, event.organizationId, prisma);
    case "allergy.mismatch":
      return resolveAllergyMismatch(parsed.payload, event.organizationId, prisma);
    case "transfusion.crossmatchFailed":
    case "transfusion.adverseReaction":
      // Beta.16.1: routing pendiente — emite evento sin destinatarios.
      return [];
  }
}

async function resolveVitalCritical(
  payload: VitalCriticalPayload,
  prisma: DispatcherPrisma,
): Promise<ResolvedRecipient[]> {
  if (payload.source !== "InpatientVitals" || !payload.admissionId) {
    // VentilatorSession routing en Beta.16 — por ahora skip.
    return [];
  }
  const admission = await prisma.inpatientAdmission.findUnique({
    where: { id: payload.admissionId },
    select: {
      organizationId: true,
      attendingId: true,
      attending: { select: { email: true, fullName: true } },
    },
  });
  if (!admission) return [];
  const roleCode = await loadRoleCode(prisma, admission.attendingId, admission.organizationId);
  // Si CUALQUIER alerta es CRITICAL, severity = CRITICAL; si no, WARNING.
  const severity: Severity = payload.alerts.some((a) => a.severity === "CRITICAL")
    ? "CRITICAL"
    : "WARNING";
  return [
    {
      userId: admission.attendingId,
      email: admission.attending.email,
      fullName: admission.attending.fullName,
      roleCode,
      severity,
    },
  ];
}

async function resolveLabCriticalValue(
  payload: LabCriticalValuePayload,
  organizationId: string,
  prisma: DispatcherPrisma,
): Promise<ResolvedRecipient[]> {
  const user = await prisma.user.findUnique({
    where: { id: payload.prescriberId },
    select: { id: true, email: true, fullName: true },
  });
  if (!user) return [];
  const roleCode = await loadRoleCode(prisma, user.id, organizationId);
  return [
    {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      roleCode,
      severity: "CRITICAL",
    },
  ];
}

async function resolveDrugInteraction(
  payload: DrugInteractionPayload,
  organizationId: string,
  prisma: DispatcherPrisma,
): Promise<ResolvedRecipient[]> {
  const user = await prisma.user.findUnique({
    where: { id: payload.prescriberId },
    select: { id: true, email: true, fullName: true },
  });
  if (!user) return [];
  const roleCode = await loadRoleCode(prisma, user.id, organizationId);
  return [
    {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      roleCode,
      severity: payload.severity,
    },
  ];
}

async function resolveAllergyMismatch(
  payload: AllergyMismatchPayload,
  organizationId: string,
  prisma: DispatcherPrisma,
): Promise<ResolvedRecipient[]> {
  if (!payload.prescriberId) return [];
  const user = await prisma.user.findUnique({
    where: { id: payload.prescriberId },
    select: { id: true, email: true, fullName: true },
  });
  if (!user) return [];
  const roleCode = await loadRoleCode(prisma, user.id, organizationId);
  return [
    {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      roleCode,
      severity: "CRITICAL",
    },
  ];
}

async function loadRoleCode(
  prisma: DispatcherPrisma,
  userId: string,
  organizationId: string,
): Promise<string | null> {
  const link = await prisma.userOrganizationRole.findFirst({
    where: { userId, organizationId },
    select: { role: { select: { code: true } } },
  });
  return link?.role?.code ?? null;
}

// -----------------------------------------------------------------------------
// Internals — template selection
// -----------------------------------------------------------------------------

function renderTemplate(
  event: DispatchInputEvent,
  patientName: string | null,
  recipientName: string | null,
): RenderedTemplate | null {
  const ctx = { patientName, recipientName };
  switch (event.eventType) {
    case "vital.critical":
      return buildVitalCriticalTemplate(event.payload as VitalCriticalPayload, ctx);
    case "lab.criticalValue":
      return buildLabCriticalValueTemplate(event.payload as LabCriticalValuePayload, ctx);
    case "drug.interaction":
      return buildDrugInteractionTemplate(event.payload as DrugInteractionPayload, ctx);
    case "allergy.mismatch":
      return buildAllergyMismatchTemplate(event.payload as AllergyMismatchPayload, ctx);
    default:
      return null;
  }
}

/** Trunca string a `max` chars (BD constraint). Solo guard, no debería suceder. */
function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function dispatchDomainEvent(
  event: DispatchInputEvent,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  const result: DispatchResult = {
    notificationsCreated: 0,
    emailsSent: 0,
    emailsFailed: 0,
  };
  // US.B15.1.4 — Timestamp para medir duración occurredAt → publishedAt.
  // Capturamos `now()` al inicio del dispatch como aproximación de
  // publishedAt; la duración se reporta en el justification del audit log.
  const dispatchStartedAt = Date.now();

  // 1. Idempotencia: si ya hay Notification para este eventId+org → skip.
  const existing = await ctx.prisma.notification.findFirst({
    where: { eventId: event.id, organizationId: event.organizationId },
    select: { id: true },
  });
  if (existing) {
    return { ...result, skippedReason: "already-dispatched" };
  }

  // 2. Resolución de recipients (incluye validación payload). Si no hay
  // recipients y el payload era válido, marcamos "no-recipient"; si el
  // payload era inválido, también caemos aquí — distinguimos con un
  // re-parse barato.
  const recipients = await resolveRecipientsAndSeverity(event, ctx.prisma);
  if (recipients.length === 0) {
    const payloadOk = domainEventPayloadSchema.safeParse({
      eventType: event.eventType,
      payload: event.payload,
    }).success;
    return {
      ...result,
      skippedReason: payloadOk ? "no-recipient" : "no-payload",
    };
  }

  const template = renderTemplate(event, /*patientName*/ null, /*recipientName*/ null);
  if (!template) {
    // EventType no soportado para templates — shouldn't happen si Zod pasó.
    return { ...result, skippedReason: "no-payload" };
  }

  const subject = clip(template.subject, 200);
  const body = clip(template.text, 5000);
  const fromEmail = ctx.fromEmail ?? process.env["NOTIFICATIONS_FROM_EMAIL"] ?? "";

  // 3. Para cada recipient, resolver canales y crear filas.
  for (const recipient of recipients) {
    const userPrefs = ctx.loadUserPreferences
      ? await ctx.loadUserPreferences(recipient.userId)
      : undefined;

    const channels = resolveChannels({
      roleCode: recipient.roleCode,
      severity: recipient.severity,
      hasEmail: !!recipient.email,
      userPrefs,
      overrides: ctx.defaults,
    });

    // 3a. INBOX
    if (channels.inbox) {
      await ctx.prisma.notification.create({
        data: {
          organizationId: event.organizationId,
          eventId: event.id,
          recipientUserId: recipient.userId,
          channel: "INBOX",
          severity: recipient.severity,
          subject,
          body,
          status: "PENDING",
        },
      });
      result.notificationsCreated += 1;
    }

    // 3b. EMAIL
    if (channels.email && recipient.email) {
      const created = await ctx.prisma.notification.create({
        data: {
          organizationId: event.organizationId,
          eventId: event.id,
          recipientUserId: recipient.userId,
          channel: "EMAIL",
          severity: recipient.severity,
          subject,
          body,
          status: "PENDING",
        },
        select: { id: true },
      });
      result.notificationsCreated += 1;

      if (ctx.emailProvider && fromEmail) {
        try {
          const sendResult = await ctx.emailProvider.send({
            to: recipient.email,
            from: fromEmail,
            subject: template.subject,
            html: template.html,
            text: template.text,
            tags: {
              eventId: event.id,
              eventType: event.eventType,
              severity: recipient.severity,
            },
          });
          await ctx.prisma.notification.update({
            where: { id: created.id },
            data: {
              status: "SENT",
              sentAt: new Date(),
              providerMessageId: sendResult.providerMessageId,
              metadata: {
                provider: ctx.emailProvider.providerName,
                providerStatus: sendResult.status ?? null,
              } satisfies Prisma.InputJsonValue,
            },
          });
          result.emailsSent += 1;
        } catch (err) {
          if (err instanceof TransientProviderError) {
            // PENDING + attempts++ — el caller/poller hace retry.
            await ctx.prisma.notification.update({
              where: { id: created.id },
              data: {
                attempts: { increment: 1 },
                failureReason: clip(`transient: ${err.message}`, 2000),
              },
            });
            result.emailsFailed += 1;
            continue;
          }
          if (err instanceof PermanentProviderError) {
            await ctx.prisma.notification.update({
              where: { id: created.id },
              data: {
                status: "FAILED",
                failedAt: new Date(),
                attempts: { increment: 1 },
                failureReason: clip(`permanent: ${err.message}`, 2000),
              },
            });
            result.emailsFailed += 1;
            continue;
          }
          // Error desconocido: tratamos como transient (conservador — retry).
          const msg = err instanceof Error ? err.message : String(err);
          await ctx.prisma.notification.update({
            where: { id: created.id },
            data: {
              attempts: { increment: 1 },
              failureReason: clip(`unknown: ${msg}`, 2000),
            },
          });
          result.emailsFailed += 1;
        }
      }
    }
  }

  // US.B15.1.4 — audit log wiring (publish).
  // Tras procesar todos los recipients (INBOX + EMAIL filas creadas y
  // eventualmente actualizadas con SENT/FAILED), registramos un audit log
  // con action=UPDATE indicando que el DomainEvent fue publicado.
  //
  // Action: `UPDATE` del enum AuditAction existente (NO añadimos valor
  // nuevo). El sentido semántico "DOMAIN_EVENT_PUBLISHED" + eventType +
  // duración + recipients se preserva en `justification`.
  //
  // El insert corre en la misma `ctx.prisma` recibida — si el caller pasó
  // una transacción, el audit es atómico con las creaciones de Notification.
  // El trigger SQL `audit.fn_audit_log_chain` calcula prevHash + signatureHash
  // automáticamente.
  const durationMs = Date.now() - dispatchStartedAt;
  await ctx.prisma.auditLog.create({
    data: {
      organizationId: event.organizationId,
      userId: null,
      action: "UPDATE",
      entity: "DomainEvent",
      entityId: event.id,
      justification: `DOMAIN_EVENT_PUBLISHED:${event.eventType} duration=${durationMs}ms recipients=${result.notificationsCreated}`,
    },
  });

  return result;
}
