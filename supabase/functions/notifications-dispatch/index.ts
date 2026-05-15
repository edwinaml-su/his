// supabase/functions/notifications-dispatch/index.ts
// =============================================================================
// HIS Beta.15 — Edge Function `notifications-dispatch` (PLACEHOLDER)
//
// Invocada por `notifications.process_outbox_batch` (SQL 44) via pg_net
// con body = { eventId, eventType, organizationId, payload }.
//
// Track B (US.B15.2.x) reemplazará este stub con el dispatcher real:
//   - importar la lógica de routing desde packages/infrastructure/src/notifications/dispatcher.ts
//   - resolver recipients via Notification + UserNotificationPreference
//   - enviar via providers (Resend, in-app, etc.)
//   - marcar Notification.status final (SENT / DELIVERED / FAILED)
//
// Por ahora: log + 200 OK, para no romper el contrato del poller.
// =============================================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

interface DispatchPayload {
  eventId: string;
  eventType: string;
  organizationId: string;
  payload: Record<string, unknown>;
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: DispatchPayload;
  try {
    body = (await req.json()) as DispatchPayload;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // TODO Track B — reemplazar con dispatcher real.
  console.log("[notifications-dispatch] received", {
    eventId: body?.eventId,
    eventType: body?.eventType,
    organizationId: body?.organizationId,
  });

  return new Response(
    JSON.stringify({ ok: true, stub: true, eventId: body?.eventId ?? null }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
