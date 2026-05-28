/**
 * Supabase Auth Callback handler — OAuth/OIDC (Microsoft Azure AD).
 *
 * Activado por el provider Azure habilitado en Supabase Dashboard. URL:
 *
 *   https://<host>/sso/callback?code=<authCode>&state=<state>
 *
 * Flujo:
 *   1. Intercambia el code por una sesión Supabase (cookies HTTP-only).
 *   2. Lee el email del usuario federado.
 *   3. Busca `public.User` por email (case-insensitive vía citext).
 *   4. Regla de admisión (opción B): si NO existe ⇒ signOut + redirect a
 *      /login con `error=not_authorized`. Si existe pero `active=false`
 *      ⇒ signOut + `error=account_inactive`. Solo entran usuarios
 *      pre-creados por el ADMIN desde /users.
 *   5. Upsert `UserExternalIdentity { provider=OIDC, issuer='azure',
 *      subject=auth.users.id }` para mantener el linker auth ↔ public.User.
 *   6. Redirect a `/dashboard` (o `next` si está en la whitelist).
 *
 * Por qué Route Handler y no Server Action:
 *   - El IdP hace HTTP GET con querystring — endpoint público.
 *   - Server Actions requieren POST con CSRF token, no aplicable aquí.
 */

import { NextResponse, type NextRequest } from "next/server";
import { ssoCallbackInputSchema } from "@his/contracts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@his/database";

/**
 * Whitelist de paths a los que está permitido redirigir tras login.
 * Evita open-redirect: un atacante podría poner `?next=//evil.com`.
 */
const SAFE_REDIRECT_PREFIXES = ["/dashboard", "/patients", "/admin", "/sso-config", "/users"];

function safeRedirect(req: NextRequest, target: string): URL {
  if (!target.startsWith("/") || target.startsWith("//")) {
    return new URL("/dashboard", req.url);
  }
  const prefixOk = SAFE_REDIRECT_PREFIXES.some(
    (p) => target === p || target.startsWith(p + "/") || target.startsWith(p + "?"),
  );
  return new URL(prefixOk ? target : "/dashboard", req.url);
}

/**
 * Mapeo provider Supabase → issuer canónico que persistimos en
 * `UserExternalIdentity.issuer`. Por ahora solo Azure (single-tenant Avante).
 */
const SUPPORTED_ISSUERS: Record<string, string> = {
  azure: "azure",
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams);

  const parsed = ssoCallbackInputSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_callback", req.url),
    );
  }

  const { code, error, errorDescription } = parsed.data;

  // Caso 1: el IdP devolvió error (usuario canceló, app no autorizada, etc.).
  if (error) {
    console.warn("[SSO CALLBACK] IdP returned error", { error, errorDescription });
    const target = new URL("/login", req.url);
    target.searchParams.set("error", error);
    if (errorDescription) {
      target.searchParams.set("error_description", errorDescription);
    }
    return NextResponse.redirect(target);
  }

  // Caso 2: sin code ni error — request raro (scan o reintento). Redirect home.
  if (!code) {
    return NextResponse.redirect(
      safeRedirect(req, url.searchParams.get("next") ?? "/dashboard"),
    );
  }

  // 2.1) Intercambio code → session. Supabase setea cookies HTTP-only.
  const supabase = createSupabaseServerClient();
  const exchange = await supabase.auth.exchangeCodeForSession(code);
  if (exchange.error || !exchange.data.session) {
    console.warn("[SSO CALLBACK] exchangeCodeForSession failed", exchange.error?.message);
    const target = new URL("/login", req.url);
    target.searchParams.set("error", "exchange_failed");
    if (exchange.error?.message) {
      target.searchParams.set("error_description", exchange.error.message);
    }
    return NextResponse.redirect(target);
  }

  const supaUser = exchange.data.session.user;
  const email = supaUser.email?.toLowerCase().trim();

  // Detección del provider OAuth federado:
  //
  // `app_metadata.provider` puede ser "email" cuando el usuario ya existía en
  // auth.users por sign-up email/password antes de vincular Microsoft — esa
  // propiedad refleja la identidad PRIMARY, no la última usada para entrar.
  // Por eso buscamos en `identities[]` (que tiene todas las identidades
  // vinculadas) un provider soportado. También revisamos
  // `app_metadata.providers[]` como fallback (algunos drivers de Supabase
  // lo exponen así).
  const identityProviders = (supaUser.identities ?? [])
    .map((i) => i.provider)
    .filter((p): p is string => typeof p === "string");
  const metadataProviders = (
    supaUser.app_metadata?.providers as string[] | undefined
  ) ?? [];
  const candidateProviders = [
    ...identityProviders,
    ...metadataProviders,
    supaUser.app_metadata?.provider,
  ].filter(Boolean) as string[];

  const matchedProvider = candidateProviders.find((p) => SUPPORTED_ISSUERS[p]);
  const issuer = matchedProvider ? SUPPORTED_ISSUERS[matchedProvider] : null;

  if (!email) {
    await supabase.auth.signOut();
    const target = new URL("/login", req.url);
    target.searchParams.set("error", "missing_email");
    return NextResponse.redirect(target);
  }

  if (!issuer) {
    await supabase.auth.signOut();
    const target = new URL("/login", req.url);
    target.searchParams.set("error", "unsupported_provider");
    target.searchParams.set(
      "error_description",
      candidateProviders.join(",") || "unknown",
    );
    return NextResponse.redirect(target);
  }

  // 2.2) Buscar User local por email (case-insensitive — citext).
  const hisUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, active: true },
  });

  // Regla opción B: si NO existe en public.User ⇒ NO autorizado.
  if (!hisUser) {
    await supabase.auth.signOut();
    const target = new URL("/login", req.url);
    target.searchParams.set("error", "not_authorized");
    target.searchParams.set("email", email);
    return NextResponse.redirect(target);
  }

  if (!hisUser.active) {
    await supabase.auth.signOut();
    const target = new URL("/login", req.url);
    target.searchParams.set("error", "account_inactive");
    target.searchParams.set("email", email);
    return NextResponse.redirect(target);
  }

  // 2.3) Upsert UserExternalIdentity (idempotente vía unique [provider, issuer, subject]).
  //      best-effort: si falla, NO bloqueamos el login — el usuario ya está
  //      autenticado contra Supabase, solo nos quedamos sin el row de linker
  //      que el ADMIN puede recrear desde /users.
  try {
    await prisma.userExternalIdentity.upsert({
      where: {
        provider_issuer_subject: {
          provider: "OIDC",
          issuer,
          subject: supaUser.id,
        },
      },
      update: {},
      create: {
        userId: hisUser.id,
        provider: "OIDC",
        issuer,
        subject: supaUser.id,
      },
    });
  } catch (e) {
    console.warn("[SSO CALLBACK] upsert UserExternalIdentity failed", (e as Error).message);
  }

  // 2.4) Redirect final.
  const next = safeRedirect(req, url.searchParams.get("next") ?? "/dashboard");
  return NextResponse.redirect(next);
}

/**
 * SAML POST binding — pendiente WorkOS integration (no Azure).
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "not_implemented",
      message: "SAML POST binding pendiente (WorkOS).",
    },
    { status: 501 },
  );
}
