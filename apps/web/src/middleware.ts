import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  // /sso y /sso/callback: callback OAuth/OIDC (Microsoft Azure AD via Supabase).
  // CRÍTICO que sea público: la sesión Supabase la CREA el route handler de
  // /sso/callback haciendo exchangeCodeForSession(code). Si el middleware lo
  // bloquea por "no hay sesión", el callback nunca corre y el usuario queda
  // en loop /login → Microsoft → /sso/callback → /login.
  "/sso",
  // /recover y /recover/reset: flujo de recuperación de contraseña (PR #306).
  // El usuario llega aquí sin sesión activa por definición.
  "/recover",
  "/api/health",
  "/_next",
  "/favicon.ico",
];

// Endpoints tRPC que usan publicProcedure y deben ser accesibles sin sesión.
// /api/trpc completo fue removido de PUBLIC_PATHS (hallazgo OWASP A05-2,
// pentest 2026-05-30): el middleware ahora valida sesión para todo /api/trpc/*
// y solo los prefijos listados aquí se eximen.
//
// publicProcedure activos documentados (packages/trpc/src/routers/):
//   - currency.list, currency.exchangeRates (catálogos)
//   - country.list (catálogo)
//   - locale.geoDivisions, locale.holidays, locale.currentLocale (config SV)
//   - portal.register, portal.verifyEmail, portal.requestLogin, portal.verifyLogin
//   - firma.requestRecovery, firma.completeRecovery (recuperación PIN pre-sesión)
//
// Si se agrega un publicProcedure nuevo, añadir su prefijo aquí.
const TRPC_PUBLIC_PREFIXES = [
  "/api/trpc/currency.",
  "/api/trpc/country.",
  "/api/trpc/locale.",
  "/api/trpc/portal.",
  "/api/trpc/firma.requestRecovery",
  "/api/trpc/firma.completeRecovery",
  // Batch: tRPC batch queries pueden incluir procedures públicos.
  // El batch endpoint no se puede filtrar por procedure individual en el path
  // — se mantiene público para no romper llamadas compuestas desde el login.
  "/api/trpc/batch",
];

// K-11: rutas del portal del paciente que no requieren sesión portal.
const PORTAL_PUBLIC_PATHS = ["/portal/login", "/portal/verify", "/portal/register"];

// K-11: nombre de cookie de sesión portal (debe coincidir con PORTAL_SESSION_COOKIE
// en @/lib/portal-session, duplicado aquí porque middleware corre en Edge runtime
// y no puede importar módulos Node.js como node:crypto que usa portal-session.ts).
const PORTAL_SESSION_COOKIE = "his.portal.session";

// Dominio canónico de producción. Cualquier acceso a un alias "alternativo"
// (típicamente el dominio largo de Vercel del proyecto) se redirige aquí.
// Esto evita que los usuarios queden atrapados en deployments protegidos por
// Vercel Deployment Protection, y garantiza que las cookies/sesiones siempre
// vivan en un único dominio.
const CANONICAL_HOST =
  process.env.NEXT_PUBLIC_CANONICAL_HOST ?? "his-avante.vercel.app";

// Aliases que se redirigen al canónico. NO incluimos dominios `*-git-*`
// (previews por feature branch) — esos deben seguir accesibles para QA.
// Solo el alias largo del project root del último deploy de production,
// que es el que confunde a los usuarios al aparecer en historial/autofill.
const STALE_ALIASES = new Set<string>([
  "his-avante-edwinaml-sus-projects.vercel.app",
]);

export async function middleware(request: NextRequest) {
  try {
    return await middlewareCore(request);
  } catch (err) {
    // Última defensa: cualquier error no atrapado abajo (típicamente Invalid
    // UTF-8 sequence en cookie parsing del runtime Edge ANTES de llegar al
    // try/catch específico de updateSession). Dejamos pasar la request sin
    // contexto de sesión + log con detalle. Mejor servir páginas públicas o
    // forzar relogin en protegidas que 500 MIDDLEWARE_INVOCATION_FAILED.
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(
      "[middleware] error no atrapado — degradando a pass-through. " +
        `Path=${request.nextUrl.pathname}. Mensaje=${msg.slice(0, 200)}`,
    );
    return NextResponse.next({ request });
  }
}

async function middlewareCore(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // 0) Canonical host redirect — si llegamos por un alias "stale", redirigir
  //    308 al canónico preservando path + query. 308 (vs 301) garantiza que
  //    el método HTTP no se cambia (POST sigue siendo POST tras redirect)
  //    y que el navegador cachea el redirect agresivamente.
  const host = request.headers.get("host");
  if (host && STALE_ALIASES.has(host) && host !== CANONICAL_HOST) {
    const canonical = request.nextUrl.clone();
    canonical.host = CANONICAL_HOST;
    canonical.protocol = "https:";
    canonical.port = "";
    return NextResponse.redirect(canonical, 308);
  }

  // K-11: las rutas /portal/* usan auth propia (PortalSession cookie); sacarlas
  // del flow Supabase para evitar redireccionamientos incorrectos a /login admin.
  if (pathname.startsWith("/portal/")) {
    const isPortalPublic = PORTAL_PUBLIC_PATHS.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    );
    if (!isPortalPublic) {
      const hasSession = request.cookies.has(PORTAL_SESSION_COOKIE);
      if (!hasSession) {
        const url = request.nextUrl.clone();
        url.pathname = "/portal/login";
        url.searchParams.set("redirect", pathname);
        return NextResponse.redirect(url);
      }
    }
    return NextResponse.next();
  }

  const { response, user } = await updateSession(request);

  const isPublic =
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    TRPC_PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static, _next/image, favicon
     * - public assets con extensión
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
  ],
};
