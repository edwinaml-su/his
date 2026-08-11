/**
 * CC-0019 — cliente admin de Supabase Auth (GoTrue) vía REST directo.
 *
 * `@his/trpc` NO tiene `@supabase/supabase-js` como dependencia (solo
 * `apps/web` la tiene — ver `apps/web/src/app/api/ece/documento-asociado/
 * signed-url/route.ts`). En vez de agregar la dependencia al paquete, este
 * módulo llama al Admin API de GoTrue con `fetch` nativo (Node 20+),
 * espejando el patrón YA usado en `packages/database/scripts/
 * seed-test-users.mjs` (POST a `/auth/v1/admin/users` con
 * `apikey`/`Authorization: Bearer <service_role>`). Es el mismo tradeoff que
 * `userAdmin.resetPassword` resolvió con SQL raw en vez del SDK admin.
 *
 * Endpoints usados (Admin API de GoTrue, documentados por Supabase):
 *   - POST   /auth/v1/admin/users          → crea la cuenta (sin password).
 *   - DELETE /auth/v1/admin/users/{id}      → compensación si el alta local falla.
 *   - POST   /auth/v1/admin/generate_link   → genera (NO envía) un enlace de
 *     acción. El envío del correo lo hace el caller vía el SMTP M365 propio
 *     del proyecto (`sendMail` de `@his/infrastructure`), no el SMTP de GoTrue.
 */

export class SupabaseAdminNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase Auth admin no configurado: define NEXT_PUBLIC_SUPABASE_URL y " +
        "SUPABASE_SERVICE_ROLE_KEY en el entorno.",
    );
    this.name = "SupabaseAdminNotConfiguredError";
  }
}

export class SupabaseAdminRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SupabaseAdminRequestError";
    this.status = status;
  }
}

interface SupabaseAdminEnv {
  url: string;
  serviceRoleKey: string;
}

function readSupabaseAdminEnv(): SupabaseAdminEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new SupabaseAdminNotConfiguredError();
  }
  return { url: url.replace(/\/+$/, ""), serviceRoleKey };
}

function adminHeaders(serviceRoleKey: string): Record<string, string> {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

export interface CreatedAuthUser {
  id: string;
}

/**
 * Crea la cuenta en Supabase Auth (`auth.users`) SIN password — el acceso lo
 * fija el propio usuario vía el enlace de invitación (ver
 * `generateAuthActionLink`). `email_confirm: true` porque el enlace de
 * invitación ya prueba posesión del correo, y habilita el account-linking
 * automático de GoTrue si el mismo usuario más tarde entra por Azure SSO
 * (mismo valor que usa `seed-test-users.mjs`; documentado en
 * `userAdmin.resetPassword` como el patrón de login dual).
 */
export async function createAuthUser(email: string): Promise<CreatedAuthUser> {
  const { url, serviceRoleKey } = readSupabaseAdminEnv();
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders(serviceRoleKey),
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new SupabaseAdminRequestError(
      `No se pudo crear la cuenta en Supabase Auth (HTTP ${res.status}): ${detail.slice(0, 300)}`,
      res.status,
    );
  }
  const body = (await res.json()) as { id?: string };
  if (!body.id) {
    throw new SupabaseAdminRequestError("Supabase Auth respondió sin id de usuario.", res.status);
  }
  return { id: body.id };
}

/**
 * Compensación best-effort: borra la cuenta Auth recién creada si el alta de
 * `public.User` falla después (evita huérfanos). NUNCA lanza — no debe
 * enmascarar el error original que disparó la compensación; el caller ya
 * está propagando ese error.
 */
export async function deleteAuthUser(id: string): Promise<void> {
  try {
    const { url, serviceRoleKey } = readSupabaseAdminEnv();
    await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: adminHeaders(serviceRoleKey),
    });
  } catch {
    // best-effort.
  }
}

export type AuthLinkType = "invite" | "recovery";

/**
 * Genera (sin enviar) un enlace de acción de Supabase Auth.
 * `/admin/generate_link` nunca envía email — solo lo emite para que el
 * caller lo entregue por su propio canal.
 *
 * Decisión CC-0019: se usa `type="recovery"` tanto para la invitación inicial
 * como para reenvíos, en vez de `type="invite"`. `/recover/reset`
 * (`apps/web/src/app/(auth)/recover/reset/page.tsx`) YA sabe consumir un
 * enlace `recovery` (escucha el evento `PASSWORD_RECOVERY` de supabase-js y
 * llama `updateUser({ password })`) — es el mecanismo de "fijar contraseña"
 * ya probado en este código base. `type="invite"` dispararía un evento de
 * supabase-js no ejercitado aquí; reutilizar `recovery` evita ese riesgo sin
 * costo (la cuenta ya la creamos nosotros vía `createAuthUser`, así que no
 * necesitamos la semántica "auto-crear cuenta" propia de `invite`).
 */
export async function generateAuthActionLink(opts: {
  type: AuthLinkType;
  email: string;
  redirectTo: string;
}): Promise<string> {
  const { url, serviceRoleKey } = readSupabaseAdminEnv();
  const res = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: adminHeaders(serviceRoleKey),
    body: JSON.stringify({
      type: opts.type,
      email: opts.email,
      redirect_to: opts.redirectTo,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new SupabaseAdminRequestError(
      `No se pudo generar el enlace de invitación (HTTP ${res.status}): ${detail.slice(0, 300)}`,
      res.status,
    );
  }
  const body = (await res.json()) as {
    action_link?: string;
    properties?: { action_link?: string };
  };
  const actionLink = body.action_link ?? body.properties?.action_link;
  if (!actionLink) {
    throw new SupabaseAdminRequestError("Supabase Auth respondió sin action_link.", res.status);
  }
  return actionLink;
}
