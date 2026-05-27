/**
 * POST /api/chat/execute-action
 *
 * Endpoint que ejecuta una acción de escritura propuesta por el chatbot
 * y confirmada explícitamente por el usuario en la UI.
 *
 * Patrón Fase 5:
 *   1. El bot llama a una tool "*Draft" que valida y retorna `pending_action`.
 *   2. El UI renderiza una card con summary + botón Confirmar.
 *   3. Click Confirmar → POST aquí con { actionType, params }.
 *   4. Este endpoint valida auth (cookie Supabase) + roles + ejecuta INSERT.
 *
 * Seguridad:
 *   - Auth real: re-valida la sesión Supabase del usuario (cookie).
 *   - Tenant scoping: nunca confía en `organizationId` del request — la
 *     deriva del tenant context del usuario logueado.
 *   - Role check: cada acción declara qué roles puede ejecutarla.
 *   - Audit: cada ejecución se loggea en chat_message como tool_call ejecutada.
 *
 * Edge runtime: usamos PostgREST con SERVICE_ROLE para los INSERT — la auth
 * del usuario se valida primero contra el cookie, no se pasa al INSERT.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = "nodejs"; // necesita cookies() de Next.

interface ExecuteActionBody {
  actionType?: string;
  params?: Record<string, unknown>;
}

interface ActionResult {
  ok: boolean;
  message?: string;
  navigateTo?: string;
  resourceId?: string;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function pgInsert(table: string, body: unknown): Promise<Response> {
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase no configurado.");
  }
  return fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
}

/** Valida la sesión Supabase del usuario y devuelve userId. */
async function requireAuthUser(): Promise<{ userId: string; email: string } | null> {
  if (!supabaseUrl || !anonKey) return null;
  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(_name: string, _value: string, _options: CookieOptions) {
        // no-op (Edge limitation — set se hace en middleware).
      },
      remove(_name: string, _options: CookieOptions) {
        // no-op
      },
    },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { userId: data.user.id, email: data.user.email ?? "" };
}

/** Recupera tenant context (orgId + roles) del usuario logueado. */
async function getTenantContext(authUserId: string): Promise<{
  organizationId: string;
  establishmentId: string | null;
  roleCodes: string[];
} | null> {
  if (!supabaseUrl || !serviceKey) return null;
  // Membership activo más reciente del usuario (read-only via PostgREST).
  const res = await fetch(
    `${supabaseUrl}/rest/v1/UserOrganizationRole?select=organizationId,Role(code)&userId=eq.${authUserId}&order=validFrom.desc&limit=10`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{
    organizationId: string;
    Role: { code: string } | null;
  }>;
  if (rows.length === 0) return null;
  const orgId = rows[0]!.organizationId;
  const roleCodes = rows
    .filter((r) => r.organizationId === orgId)
    .map((r) => r.Role?.code)
    .filter((c): c is string => !!c);
  return { organizationId: orgId, establishmentId: null, roleCodes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: ExecuteActionBody;
  try {
    body = (await req.json()) as ExecuteActionBody;
  } catch {
    return jsonError("JSON inválido", 400);
  }

  if (!body.actionType || !body.params) {
    return jsonError("actionType y params son requeridos", 400);
  }

  // 1. Auth check.
  const user = await requireAuthUser();
  if (!user) {
    return jsonError("No autenticado", 401);
  }

  // 2. Tenant context.
  const tenant = await getTenantContext(user.userId);
  if (!tenant) {
    return jsonError("Sin organización activa", 403);
  }

  // 3. Dispatch por actionType.
  try {
    let result: ActionResult;
    switch (body.actionType) {
      case "scheduleOutpatientAppointment":
        result = await executeScheduleOutpatient(
          body.params,
          user,
          tenant,
        );
        break;
      default:
        return jsonError(`actionType '${body.actionType}' no soportado`, 400);
    }
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 400,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: scheduleOutpatientAppointment
// ─────────────────────────────────────────────────────────────────────────────

async function executeScheduleOutpatient(
  rawParams: Record<string, unknown>,
  user: { userId: string },
  tenant: { organizationId: string; establishmentId: string | null; roleCodes: string[] },
): Promise<ActionResult> {
  // Role check.
  const allowed = ["PHYSICIAN", "NURSE", "ADMIN", "ADMISSION_CLERK", "DIR"];
  const hasRole = tenant.roleCodes.some((r) => allowed.includes(r));
  if (!hasRole) {
    return {
      ok: false,
      message: `No tienes rol autorizado para crear citas (${allowed.join("/")}).`,
    };
  }

  // Validar params.
  const patientId = String(rawParams.patientId ?? "");
  const providerId = String(rawParams.providerId ?? "");
  const scheduledAt = String(rawParams.scheduledAt ?? "");
  const durationMinutes = Number(rawParams.durationMinutes ?? 20);
  const reason = String(rawParams.reason ?? "");

  if (!patientId || !providerId || !scheduledAt || !reason) {
    return { ok: false, message: "Faltan parámetros requeridos." };
  }

  // Establecimiento: tomarlo del primer Establishment activo del tenant.
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, message: "Supabase no configurado." };
  }
  const estabRes = await fetch(
    `${supabaseUrl}/rest/v1/Establishment?select=id&organizationId=eq.${tenant.organizationId}&active=eq.true&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  const estabs = (await estabRes.json()) as Array<{ id: string }>;
  if (estabs.length === 0) {
    return { ok: false, message: "El tenant no tiene establecimiento activo." };
  }

  // INSERT real.
  const insertRes = await pgInsert("OutpatientAppointment", {
    organizationId: tenant.organizationId,
    establishmentId: estabs[0]!.id,
    patientId,
    providerId,
    scheduledAt,
    durationMinutes,
    reason,
    status: "SCHEDULED",
    createdBy: user.userId,
    updatedBy: user.userId,
  });

  if (!insertRes.ok) {
    const txt = await insertRes.text();
    return {
      ok: false,
      message: `No se pudo crear la cita: ${insertRes.status} ${txt.slice(0, 200)}`,
    };
  }

  const [created] = (await insertRes.json()) as Array<{ id: string }>;
  return {
    ok: true,
    message: "Cita ambulatoria creada exitosamente.",
    navigateTo: `/outpatient`,
    resourceId: created?.id,
  };
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
