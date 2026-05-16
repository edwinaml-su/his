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

async function resolveRecipient(
  eventType: string,
  payload: any,
  organizationId: string,
): Promise<ResolvedRecipient | null> {
  switch (eventType) {
    case "vital.critical": {
      // Solo source = "InpatientVitals" + admissionId. VentilatorSession en Beta.16.
      if (payload?.source !== "InpatientVitals" || typeof payload?.admissionId !== "string") {
        return null;
      }
      const { data: admission, error } = await supabase
        .from("InpatientAdmission")
        .select("id, attendingId, organizationId")
        .eq("id", payload.admissionId)
        .maybeSingle();
      if (error) {
        console.error("[dispatch] InpatientAdmission lookup failed", error);
        return null;
      }
      if (!admission) return null;
      return loadUser(admission.attendingId, admission.organizationId);
    }
    case "lab.criticalValue":
    case "drug.interaction": {
      if (typeof payload?.prescriberId !== "string") return null;
      return loadUser(payload.prescriberId, organizationId);
    }
    case "allergy.mismatch": {
      if (payload?.prescriberId == null) return null; // skip explícito si null
      if (typeof payload.prescriberId !== "string") return null;
      return loadUser(payload.prescriberId, organizationId);
    }
    default:
      return null;
  }
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

  // 3. Resolver recipient.
  const recipient = await resolveRecipient(
    body.eventType,
    body.payload,
    body.organizationId,
  );
  if (!recipient) {
    return { ...result, skipped: "no-recipient" };
  }

  // 4. Determinar severity.
  const severity: Severity | null = mapEventTypeToSeverity(body.eventType, body.payload);
  if (!severity) {
    return { ...result, skipped: "unknown-eventType" };
  }

  // 5. Resolver canales. UserNotificationPreference NO se consulta en este PR
  //    (simplification — defaults hardcoded por rol son suficientes para
  //    Beta.15; preferences UI es US.B15.3.3 scope separado).
  const channels = resolveChannels({
    roleCode: recipient.roleCode,
    severity,
    hasEmail: !!recipient.email,
  });

  // 6. Construir template.
  const template = renderTemplate(body.eventType, body.payload, /*patientName*/ null);
  if (!template) {
    return { ...result, skipped: "no-template" };
  }
  const subject = clip(template.subject, 200);
  const bodyText = clip(template.text, 5000);

  // 7. INSERT Notification por canal.
  // Notification.id se genera con DEFAULT gen_random_uuid(); leemos el id
  // de vuelta para luego UPDATE el estado del email.
  if (channels.inbox) {
    const { error: insertErr } = await supabase.from("Notification").insert({
      organizationId: body.organizationId,
      eventId: body.eventId,
      recipientUserId: recipient.userId,
      channel: "INBOX",
      severity,
      subject,
      body: bodyText,
      status: "PENDING",
    });
    if (insertErr) {
      console.error("[dispatch] INBOX insert failed", insertErr);
      throw new Error(`inbox_insert_failed: ${insertErr.message}`);
    }
    result.notificationsCreated += 1;
  }

  if (channels.email && recipient.email) {
    const { data: emailRow, error: emailInsertErr } = await supabase
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
      .single();
    if (emailInsertErr || !emailRow) {
      console.error("[dispatch] EMAIL insert failed", emailInsertErr);
      throw new Error(`email_insert_failed: ${emailInsertErr?.message ?? "no row"}`);
    }
    result.notificationsCreated += 1;

    // 8. Envío Resend.
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

  // 9. Audit log (acción UPDATE, entity DomainEvent — paralelo al dispatcher Node).
  const durationMs = Date.now() - dispatchStartedAt;
  const { error: auditErr } = await supabase.from("AuditLog").insert({
    organizationId: body.organizationId,
    userId: null,
    action: "UPDATE",
    entity: "DomainEvent",
    entityId: body.eventId,
    justification: `DOMAIN_EVENT_PUBLISHED:${body.eventType} duration=${durationMs}ms recipients=${result.notificationsCreated}`,
  });
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
