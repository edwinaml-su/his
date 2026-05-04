/**
 * US-2.5 — Supabase Auth Callback handler para SSO (OAuth/OIDC).
 *
 * Esta ruta es invocada por el IdP (Google/Microsoft/WorkOS/Auth0) tras la
 * autenticación. La URL completa configurada en cada provider apunta aquí:
 *
 *   https://<host>/sso/callback?code=<authCode>&state=<state>
 *
 * MVP STUB:
 *   - La ruta existe y parsea la query, pero como ningún IdP está cableado
 *     todavía, en condiciones reales esta ruta no debería recibir tráfico.
 *   - Si llega un callback, lo loggeamos y redirigimos a /sso con un mensaje
 *     de error explicando que SSO no está activo.
 *
 * Sprint 2 — implementación completa:
 *   1. Validar `state` contra cookie HTTP-only (CSRF + nonce).
 *   2. `supabase.auth.exchangeCodeForSession(code)` — Supabase intercambia
 *      el authorization code por session JWT.
 *   3. Leer claims (email, sub, given_name, family_name) del token.
 *   4. `handleSsoCallback(claims, provider)` — upsert User local +
 *      UserExternalIdentity (atómico).
 *   5. Set cookie sesión, redirect a `next` (validado contra whitelist).
 *
 * Por qué Route Handler y no Server Action:
 *   - El IdP hace HTTP GET con querystring — es un endpoint público.
 *   - Server Actions requieren POST con CSRF token, no aplicable aquí.
 *   - Route Handlers son la primitiva Next.js correcta para webhooks.
 */

import { NextResponse, type NextRequest } from "next/server";
import { ssoCallbackInputSchema } from "@his/contracts/schemas/sso";

/**
 * Whitelist de paths a los que está permitido redirigir tras login.
 * Evita open-redirect: un atacante podría poner `?next=//evil.com` en su
 * link de phishing.
 */
const SAFE_REDIRECT_PREFIXES = ["/dashboard", "/patients", "/admin", "/sso-config"];

function safeRedirect(req: NextRequest, target: string): URL {
  // Solo paths internos (empiezan con `/` y NO `//`) y prefijos whitelisted.
  if (!target.startsWith("/") || target.startsWith("//")) {
    return new URL("/dashboard", req.url);
  }
  const prefixOk = SAFE_REDIRECT_PREFIXES.some(
    (p) => target === p || target.startsWith(p + "/") || target.startsWith(p + "?"),
  );
  return new URL(prefixOk ? target : "/dashboard", req.url);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams);

  // Parsear con schema. Los tres campos son opcionales por separado pero al
  // menos uno (code o error) debería venir.
  const parsed = ssoCallbackInputSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.redirect(
      new URL("/sso?error=invalid_callback", req.url),
    );
  }

  const { code, state, error, errorDescription } = parsed.data;

  // Caso 1: el IdP devolvió un error (usuario canceló, app no autorizada).
  if (error) {
    console.warn("[SSO CALLBACK] IdP returned error", { error, errorDescription });
    const target = new URL("/sso", req.url);
    target.searchParams.set("error", error);
    if (errorDescription) {
      target.searchParams.set("error_description", errorDescription);
    }
    return NextResponse.redirect(target);
  }

  // Caso 2: callback "exitoso" — pero MVP no procesa porque no hay IdP real.
  // Loggeamos para debugging si alguien activó algo en Supabase dashboard
  // sin coordinar.
  if (code) {
    console.warn("[SSO CALLBACK STUB] Received code but SSO not wired in MVP", {
      hasState: !!state,
      codePrefix: code.slice(0, 8),
    });

    // TODO(Sprint 2): reemplazar por:
    //   const supabase = createSupabaseServerClient(cookies());
    //   const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    //   if (error) return NextResponse.redirect(new URL('/sso?error=exchange_failed', req.url));
    //   const claims = parseClaimsFromSession(data.session);
    //   await upsertUserFromSso(claims, provider);
    //   const next = safeRedirect(req, url.searchParams.get('next') ?? '/dashboard');
    //   return NextResponse.redirect(next);

    const target = new URL("/sso", req.url);
    target.searchParams.set("error", "not_configured");
    target.searchParams.set(
      "error_description",
      "SSO recibido pero MVP no procesa. Activación en Sprint 2.",
    );
    return NextResponse.redirect(target);
  }

  // Caso 3: ni código ni error — request raro, posible scan o reintento manual.
  const next = safeRedirect(req, url.searchParams.get("next") ?? "/dashboard");
  return NextResponse.redirect(next);
}

/**
 * Algunos IdP SAML envían el response como POST x-www-form-urlencoded.
 * MVP: rechazamos con 501 Not Implemented y log para futuras integraciones.
 */
export async function POST(req: NextRequest) {
  console.warn("[SSO CALLBACK] POST received — SAML response handling not implemented in MVP");
  return NextResponse.json(
    {
      error: "not_implemented",
      message: "SAML POST binding pendiente Sprint 2 (WorkOS integration).",
    },
    { status: 501 },
  );
}
