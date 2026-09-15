// supabase/functions/notifications-dispatch/index.ts
// =============================================================================
// HIS Beta.15 — Edge Function `notifications-dispatch` (US.B15.2.x).
//
// Invocada por `notifications.process_outbox_batch` (SQL 44) via pg_net
// con body = { eventId, eventType, organizationId, payload }.
//
// Responsabilidades:
//   1. Idempotencia: si ya hay Notification para `eventId` → skip.
//   2. Validar payload (shallow, sin Zod — la validación robusta corre
//      en `emitDomainEvent` antes de insertar en outbox).
//   3. Resolver recipient(s) por eventType (consulta InpatientAdmission /
//      User).
//   4. Resolver severity + canales (defaults hardcoded por rol; reglas
//      duras: CRITICAL siempre INBOX + EMAIL si user.email).
//   5. INSERT filas Notification (PENDING) por canal aplicable.
//   6. Si canal=EMAIL → POST `https://api.resend.com/emails`. Mapea status:
//        - 2xx → Notification.status = SENT, sentAt = now, providerMessageId.
//        - 4xx → Notification.status = FAILED, failedAt = now.
//        - 5xx → status queda PENDING + attempts++ (el poller hace retry).
//   7. Audit log: row en AuditLog (action=UPDATE, entity=DomainEvent) con
//      duración del dispatch + recipients en justification.
//
// Decisión @AS: Deno NO puede importar `@prisma/client` ni `@his/contracts`
// (workspace deps). Reimplementamos lógica esencial usando supabase-js como
// thin client al schema (RLS bypass via service_role) + fetch directo a Resend.
//
// Decisión @SRE: secrets via Deno.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// inyectados automáticamente; RESEND_API_KEY + NOTIFICATIONS_FROM_EMAIL via
// `supabase secrets set`).
//
// Helpers puros (routing/templates/severity mapping) en `./lib.ts` para tests.
// =============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  clip,
  mapEventTypeToSeverity,
  renderTemplate,
  resolveChannels,
  validatePayloadShallow,
  withRetry,
  type ChannelSet,
  type RoleSeverityMatrix,
  type Severity,
} from "./lib.ts";

// -----------------------------------------------------------------------------
// Env + cliente Supabase singleton
// -----------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL =
  Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "no-reply@avante.example";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // Fatal — no podemos arrancar sin credenciales. En cold-start Supabase
  // Edge esto produce un 500 inmediato (deseable: no callamos el error).
  throw new Error(
    "[notifications-dispatch] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
  );
}

const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// -----------------------------------------------------------------------------
// Tipos del request
// -----------------------------------------------------------------------------

interface DispatchPayload {
  eventId: string;
  eventType: string;
  organizationId: string;
  payload: Record<string, unknown>;
}

interface DispatchResult {
  ok: true;
  eventId: string;
  notificationsCreated: number;
  emailsSent: number;
  emailsFailed: number;
  skipped?: string;
}

interface ResolvedRecipient {
  userId: string;
  email: string | null;
  fullName: string | null;
  roleCode: string | null;
}

// -----------------------------------------------------------------------------
// Helpers de respuesta HTTP
// -----------------------------------------------------------------------------

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// -----------------------------------------------------------------------------
// Recipient resolution por eventType
// -----------------------------------------------------------------------------

/**
 * CC-0031 — resuelve N recipients para un eventType. Los 4 eventTypes
 * pre-existentes siguen siendo single-recipient (envueltos en array de
 * 0-1); `task.*`/`cargo.pendiente_tarifa` usan `resolveByRole` (N usuarios).
 */
async function resolveRecipients(
  eventType: string,
  payload: any,
  organizationId: string,
): Promise<ResolvedRecipient[]> {
  switch (eventType) {
    case "vital.critical": {
      // Solo source = "InpatientVitals" + admissionId. VentilatorSession en Beta.16.
      if (payload?.source !== "InpatientVitals" || typeof payload?.admissionId !== "string") {
        return [];
      }
      const { data: admission, error } = await supabase
        .from("InpatientAdmission")
        .select("id, attendingId, organizationId")
        .eq("id", payload.admissionId)
        .maybeSingle();
      if (error) {
        console.error("[dispatch] InpatientAdmission lookup failed", error);
        return [];
      }
      if (!admission) return [];
      const user = await loadUser(admission.attendingId, admission.organizationId);
      return user ? [user] : [];
    }
    case "lab.criticalValue":
    case "drug.interaction": {
      if (typeof payload?.prescriberId !== "string") return [];
      const user = await loadUser(payload.prescriberId, organizationId);
      return user ? [user] : [];
    }
    case "allergy.mismatch": {
      if (payload?.prescriberId == null) return []; // skip explícito si null
      if (typeof payload.prescriberId !== "string") return [];
      const user = await loadUser(payload.prescriberId, organizationId);
      return user ? [user] : [];
    }
    // CC-0035 (auditoría C6 2026-09-15, P0-10/P0-11) — cierra el wiring del
    // médico tratante para `critical_result.emitted` (motor de valor
    // crítico con SLA + read-back, IPSG.2 ME 2). El payload usa
    // `medicoTratanteUserId` (User.id) para resolver directo, igual que
    // `lab.criticalValue`/`prescriberId` — `medicoTratanteId` (FK a
    // ece.personal_salud) queda solo para la fila de
    // ece.critical_result_notification, no sirve para loadUser().
    case "critical_result.emitted": {
      if (typeof payload?.medicoTratanteUserId !== "string") return [];
      const user = await loadUser(payload.medicoTratanteUserId, organizationId);
      return user ? [user] : [];
    }
    // CC-0031 — puente tarea→notificación (4 eventTypes, mismo resolver).
    case "task.action_required":
    case "task.sla_warning":
    case "task.sla_exceeded":
    case "task.escalated": {
      if (typeof payload?.assignedRoleCode !== "string") return [];
      return resolveByRole(payload.assignedRoleCode, organizationId);
    }
    // docs/48 Ola 2 (C2-1) — antes de CC-0031 este eventType no resolvía
    // ningún recipient acá (00 §2.3, "el agujero").
    case "cargo.pendiente_tarifa":
      return resolveByRole("FACTURACION", organizationId);
    default:
      return [];
  }
}

// -----------------------------------------------------------------------------
// CC-0031 — resolver genérico por rol. Espejo de `resolveByRole` /
// `resolveRoleIdsForCode` en packages/infrastructure/src/notifications/dispatcher.ts
// (TS) — MISMA lógica (alias inverso + herencia transitiva + vigencia +
// dedupe por userId), reimplementada con supabase-js porque Deno no puede
// importar `@prisma/client`. Si cambias uno, cambia el otro — ver test de
// paridad `packages/infrastructure/src/notifications/__tests__/resolve-by-role.test.ts`
// y `supabase/functions/notifications-dispatch/lib.test.ts`.
// -----------------------------------------------------------------------------

const MAX_ROLE_INHERITANCE_DEPTH = 20;

async function resolveRoleIdsForCode(
  roleCode: string,
  organizationId: string,
): Promise<string[]> {
  const { data: aliasRows, error: aliasErr } = await supabase
    .from("RoleCodeAlias")
    .select("sourceCode")
    .eq("canonicalCode", roleCode)
    .or(`organizationId.eq.${organizationId},organizationId.is.null`);
  if (aliasErr) {
    console.error("[dispatch] RoleCodeAlias lookup failed", aliasErr);
  }
  const codes = Array.from(
    new Set([roleCode, ...((aliasRows ?? []) as Array<{ sourceCode: string }>).map((a) => a.sourceCode)]),
  );

  const { data: directRoles, error: roleErr } = await supabase
    .from("Role")
    .select("id")
    .in("code", codes)
    .or(`organizationId.eq.${organizationId},organizationId.is.null`);
  if (roleErr) {
    console.error("[dispatch] Role lookup failed", roleErr);
    return [];
  }
  const allIds = new Set(((directRoles ?? []) as Array<{ id: string }>).map((r) => r.id));
  if (allIds.size === 0) return [];

  let frontier = Array.from(allIds);
  let depth = 0;
  while (frontier.length > 0 && depth < MAX_ROLE_INHERITANCE_DEPTH) {
    depth++;
    const { data: children, error: childErr } = await supabase
      .from("Role")
      .select("id")
      .in("inheritsFromRoleId", frontier);
    if (childErr) {
      console.error("[dispatch] Role inheritance lookup failed", childErr);
      break;
    }
    const newIds = ((children ?? []) as Array<{ id: string }>)
      .map((c) => c.id)
      .filter((id) => !allIds.has(id));
    if (newIds.length === 0) break;
    for (const id of newIds) allIds.add(id);
    frontier = newIds;
  }
  return Array.from(allIds);
}

// -----------------------------------------------------------------------------
// CC-0031 Fase 1(d) — `RoleNotificationDefault` en BD con fallback a
// `resolveChannels` (mapa hardcodeado). Espejo de `resolveChannelsFromDb`
// (packages/infrastructure/src/notifications/routing.ts) — el dispatcher Node
// hoy NO tiene ningún caller de runtime (solo tests + mar-consumer.ts en
// modo directo), así que ESTA es la ruta que de verdad ejecuta en prod
// (poller pg_cron → pg_net → esta Edge Function). Sin este espejo, sembrar
// `RoleNotificationDefault` (sql/238 §3) no tendría ningún efecto observable.
// -----------------------------------------------------------------------------

async function resolveChannelsFromDb(args: {
  organizationId: string;
  roleCode: string | null;
  severity: Severity;
  hasEmail: boolean;
}): Promise<ChannelSet> {
  const { organizationId, roleCode, severity, hasEmail } = args;
  if (!roleCode) {
    return resolveChannels({ roleCode, severity, hasEmail });
  }
  try {
    const { data: role, error: roleErr } = await supabase
      .from("Role")
      .select("id")
      .eq("code", roleCode)
      .or(`organizationId.eq.${organizationId},organizationId.is.null`)
      .limit(1)
      .maybeSingle();
    if (roleErr || !role) {
      return resolveChannels({ roleCode, severity, hasEmail });
    }
    const { data: rows, error: rowsErr } = await supabase
      .from("RoleNotificationDefault")
      .select("severity, channel, enabled")
      .eq("roleId", role.id);
    if (rowsErr || !rows || rows.length === 0) {
      return resolveChannels({ roleCode, severity, hasEmail });
    }
    const matrix: RoleSeverityMatrix = {
      critical: pickRow(rows, "CRITICAL"),
      warning: pickRow(rows, "WARNING"),
      info: pickRow(rows, "INFO"),
    };
    return resolveChannels({
      roleCode,
      severity,
      hasEmail,
      overrides: new Map([[roleCode, matrix]]),
    });
  } catch (err) {
    console.error("[dispatch] resolveChannelsFromDb failed (fail-safe: usando mapa hardcodeado)", err);
    return resolveChannels({ roleCode, severity, hasEmail });
  }
}

function pickRow(
  rows: Array<{ severity: string; channel: string; enabled: boolean }>,
  severity: string,
): ChannelSet {
  const get = (channel: "INBOX" | "EMAIL") => {
    const row = rows.find((r) => r.severity === severity && r.channel === channel);
    return row ? row.enabled : fallbackCellEnabled(severity, channel);
  };
  return { inbox: get("INBOX"), email: get("EMAIL") };
}

/** Mismo criterio que FALLBACK_DEFAULTS de lib.ts, para celdas ausentes en BD. */
function fallbackCellEnabled(severity: string, channel: "INBOX" | "EMAIL"): boolean {
  if (severity === "CRITICAL") return true;
  return channel === "INBOX";
}

async function resolveByRole(
  roleCode: string,
  organizationId: string,
): Promise<ResolvedRecipient[]> {
  const roleIds = await resolveRoleIdsForCode(roleCode, organizationId);
  if (roleIds.length === 0) return [];

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("UserOrganizationRole")
    .select("userId, Role:roleId(code), User:userId(email, fullName)")
    .eq("organizationId", organizationId)
    .in("roleId", roleIds)
    .lte("validFrom", nowIso)
    .or(`validTo.is.null,validTo.gte.${nowIso}`);
  if (error) {
    console.error("[dispatch] UserOrganizationRole lookup failed (resolveByRole)", error);
    return [];
  }

  // supabase-js no soporta `distinct` en este tipo de query — dedupe por userId en JS.
  const byUser = new Map<string, ResolvedRecipient>();
  for (const row of (data ?? []) as any[]) {
    if (byUser.has(row.userId)) continue;
    byUser.set(row.userId, {
      userId: row.userId,
      email: row.User?.email ?? null,
      fullName: row.User?.fullName ?? null,
      roleCode: row.Role?.code ?? null,
    });
  }
  return Array.from(byUser.values());
}

async function loadUser(
  userId: string,
  organizationId: string,
): Promise<ResolvedRecipient | null> {
  const { data: user, error } = await supabase
    .from("User")
    .select("id, email, fullName")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[dispatch] User lookup failed", error);
    return null;
  }
  if (!user) return null;
  const roleCode = await loadRoleCode(userId, organizationId);
  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: user.fullName ?? null,
    roleCode,
  };
}

async function loadRoleCode(
  userId: string,
  organizationId: string,
): Promise<string | null> {
  // UserOrganizationRole → Role (foreign relation via role_id). Tomamos el
  // primero — si el user tiene múltiples roles en la org, esto es un
  // simplification consciente (mismo trade-off que el dispatcher Node).
  const { data, error } = await supabase
    .from("UserOrganizationRole")
    .select("Role:roleId(code)")
    .eq("userId", userId)
    .eq("organizationId", organizationId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[dispatch] UserOrganizationRole lookup failed", error);
    return null;
  }
  // supabase-js representa el join como objeto anidado.
  const role = (data as any)?.Role;
  return role?.code ?? null;
}

// -----------------------------------------------------------------------------
// Resend (fetch directo, sin SDK)
// -----------------------------------------------------------------------------

interface ResendSendResult {
  status: "sent" | "transient" | "permanent" | "no-api-key";
  providerMessageId?: string;
  reason?: string;
}

async function sendEmailViaResend(args: {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  tags: Record<string, string>;
}): Promise<ResendSendResult> {
  if (!RESEND_API_KEY) {
    return { status: "no-api-key", reason: "RESEND_API_KEY_NOT_CONFIGURED" };
  }
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: args.from,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
        // Resend acepta `tags` como array de {name, value}.
        tags: Object.entries(args.tags).map(([name, value]) => ({ name, value })),
      }),
    });
  } catch (err) {
    // Network error → transient (deja PENDING para retry).
    return { status: "transient", reason: `network: ${(err as Error).message}` };
  }

  if (response.ok) {
    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { status: "sent", providerMessageId: body?.id };
  }

  const errText = await response.text().catch(() => "");
  if (response.status >= 500) {
    return { status: "transient", reason: `resend_5xx_${response.status}: ${errText.slice(0, 200)}` };
  }
  return { status: "permanent", reason: `resend_${response.status}: ${errText.slice(0, 200)}` };
}

// -----------------------------------------------------------------------------
// Main dispatch
// -----------------------------------------------------------------------------

async function dispatchEvent(body: DispatchPayload): Promise<DispatchResult> {
  const result: DispatchResult = {
    ok: true,
    eventId: body.eventId,
    notificationsCreated: 0,
    emailsSent: 0,
    emailsFailed: 0,
  };
  const dispatchStartedAt = Date.now();

  // 1. Idempotencia: si ya hay Notification con (eventId, organizationId) → skip.
  const { data: existing, error: existingErr } = await supabase
    .from("Notification")
    .select("id")
    .eq("eventId", body.eventId)
    .eq("organizationId", body.organizationId)
    .limit(1)
    .maybeSingle();
  if (existingErr) {
    console.error("[dispatch] idempotency check failed", existingErr);
    throw new Error(`idempotency_check_failed: ${existingErr.message}`);
  }
  if (existing) {
    return { ...result, skipped: "already-dispatched" };
  }

  // 2. Validación shallow del payload.
  const validationErr = validatePayloadShallow(body.eventType, body.payload);
  if (validationErr) {
    return { ...result, skipped: `invalid-payload:${validationErr}` };
  }

  // 3. Resolver recipients (CC-0031: 0..N — antes 0..1).
  const recipients = await resolveRecipients(
    body.eventType,
    body.payload,
    body.organizationId,
  );
  if (recipients.length === 0) {
    return { ...result, skipped: "no-recipient" };
  }

  // 4. Determinar severity.
  const severity: Severity | null = mapEventTypeToSeverity(body.eventType, body.payload);
  if (!severity) {
    return { ...result, skipped: "unknown-eventType" };
  }

  // 5. Construir template (una sola vez — mismo contenido para todos los recipients).
  const template = renderTemplate(body.eventType, body.payload, /*patientName*/ null);
  if (!template) {
    return { ...result, skipped: "no-template" };
  }
  const subject = clip(template.subject, 200);
  const bodyText = clip(template.text, 5000);

  // 6. Por cada recipient: resolver canales (UserNotificationPreference NO
  //    se consulta acá — defaults hardcoded/BD son suficientes, preferences
  //    UI es scope separado) + INSERT Notification por canal aplicable.
  for (const recipient of recipients) {
    const channels = await resolveChannelsFromDb({
      organizationId: body.organizationId,
      roleCode: recipient.roleCode,
      severity,
      hasEmail: !!recipient.email,
    });

    // Notification.id se genera con DEFAULT gen_random_uuid(); leemos el id
    // de vuelta para luego UPDATE el estado del email.
    if (channels.inbox) {
      // withRetry: solo reintenta 40P01 (deadlock en la cadena de hash de
      // auditoría bajo ráfagas del poller) — otros errores pasan directo.
      const { error: insertErr } = await withRetry(() =>
        supabase.from("Notification").insert({
          organizationId: body.organizationId,
          eventId: body.eventId,
          recipientUserId: recipient.userId,
          channel: "INBOX",
          severity,
          subject,
          body: bodyText,
          status: "PENDING",
        })
      );
      if (insertErr) {
        console.error("[dispatch] INBOX insert failed", insertErr);
        throw new Error(`inbox_insert_failed: ${insertErr.message}`);
      }
      result.notificationsCreated += 1;
    }

    if (channels.email && recipient.email) {
      const { data: emailRow, error: emailInsertErr } = await withRetry(() =>
        supabase
          .from("Notification")
          .insert({
            organizationId: body.organizationId,
            eventId: body.eventId,
            recipientUserId: recipient.userId,
            channel: "EMAIL",
            severity,
            subject,
            body: bodyText,
            status: "PENDING",
          })
          .select("id")
          .single()
      );
      if (emailInsertErr || !emailRow) {
        console.error("[dispatch] EMAIL insert failed", emailInsertErr);
        throw new Error(`email_insert_failed: ${emailInsertErr?.message ?? "no row"}`);
      }
      result.notificationsCreated += 1;

      // 7. Envío Resend.
      const sendResult = await sendEmailViaResend({
        to: recipient.email,
        from: FROM_EMAIL,
        subject: template.subject,
        html: template.html,
        text: template.text,
        tags: {
          eventId: body.eventId,
          eventType: body.eventType,
          severity,
        },
      });

      switch (sendResult.status) {
        case "sent": {
          const { error: updErr } = await supabase
            .from("Notification")
            .update({
              status: "SENT",
              sentAt: new Date().toISOString(),
              providerMessageId: sendResult.providerMessageId ?? null,
              metadata: { provider: "resend" },
            })
            .eq("id", emailRow.id);
          if (updErr) console.error("[dispatch] SENT update failed", updErr);
          result.emailsSent += 1;
          break;
        }
        case "permanent": {
          const { error: updErr } = await supabase
            .from("Notification")
            .update({
              status: "FAILED",
              failedAt: new Date().toISOString(),
              attempts: 1,
              failureReason: clip(`permanent: ${sendResult.reason ?? ""}`, 2000),
            })
            .eq("id", emailRow.id);
          if (updErr) console.error("[dispatch] FAILED update failed", updErr);
          result.emailsFailed += 1;
          break;
        }
        case "transient": {
          // PENDING + attempts++ → el poller del outbox o un retry futuro
          // reprocesará. (En este PR, el poller no re-invoca; mejora futura.)
          const { error: updErr } = await supabase
            .from("Notification")
            .update({
              attempts: 1,
              failureReason: clip(`transient: ${sendResult.reason ?? ""}`, 2000),
            })
            .eq("id", emailRow.id);
          if (updErr) console.error("[dispatch] transient update failed", updErr);
          result.emailsFailed += 1;
          break;
        }
        case "no-api-key": {
          const { error: updErr } = await supabase
            .from("Notification")
            .update({
              status: "FAILED",
              failedAt: new Date().toISOString(),
              failureReason: "RESEND_API_KEY_NOT_CONFIGURED",
            })
            .eq("id", emailRow.id);
          if (updErr) console.error("[dispatch] no-api-key update failed", updErr);
          result.emailsFailed += 1;
          break;
        }
      }
    }
  }

  // 9. Audit log (acción UPDATE, entity DomainEvent — paralelo al dispatcher Node).
  const durationMs = Date.now() - dispatchStartedAt;
  const { error: auditErr } = await withRetry(() =>
    supabase.from("AuditLog").insert({
      organizationId: body.organizationId,
      userId: null,
      action: "UPDATE",
      entity: "DomainEvent",
      entityId: body.eventId,
      justification: `DOMAIN_EVENT_PUBLISHED:${body.eventType} duration=${durationMs}ms recipients=${result.notificationsCreated}`,
    })
  );
  if (auditErr) {
    // No relanzamos — auditoría ausente no debe revertir un dispatch ya hecho.
    console.error("[dispatch] AuditLog insert failed (non-fatal)", auditErr);
  }

  return result;
}

// -----------------------------------------------------------------------------
// HTTP entrypoint
// -----------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResp(405, { error: "method_not_allowed" });
  }

  let body: DispatchPayload;
  try {
    body = (await req.json()) as DispatchPayload;
  } catch {
    return jsonResp(400, { error: "invalid_json" });
  }

  if (
    !body?.eventId ||
    !body?.eventType ||
    !body?.organizationId ||
    typeof body.payload !== "object"
  ) {
    return jsonResp(400, { error: "missing_required_fields" });
  }

  try {
    const result = await dispatchEvent(body);
    return jsonResp(200, result);
  } catch (err) {
    console.error("[notifications-dispatch] dispatch error", {
      eventId: body.eventId,
      eventType: body.eventType,
      err: err instanceof Error ? err.message : String(err),
    });
    return jsonResp(500, {
      ok: false,
      eventId: body.eventId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
