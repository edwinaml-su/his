import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isPublicTrpcPath } from "@/lib/auth/trpc-public";

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

// La allowlist de procedures tRPC sin sesión vive en `@/lib/auth/trpc-public`
// (parsea los batches `proc1,proc2` y exige que TODOS sean públicos).

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

/** ¿La ruta es accesible sin sesión Supabase? */
function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    isPublicTrpcPath(pathname)
  );
}

/**
 * OWASP A09:2025 — los paths llevan identificadores de paciente
 * (`/patients/<uuid>/historia`). Los logs de Vercel no son un almacén PHI:
 * se sustituyen UUIDs y correlativos numéricos largos antes de loggear.
 */
export function redactPath(pathname: string): string {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b\d{6,}\b/g, "<num>");
}

export async function middleware(request: NextRequest) {
  try {
    return await middlewareCore(request);
  } catch (err) {
    // Última defensa: cualquier error no atrapado abajo (típicamente Invalid
    // UTF-8 sequence en cookie parsing del runtime Edge ANTES de llegar al
    // try/catch específico de updateSession).
    //
    // OWASP A10:2025 (Mishandling of Exceptional Conditions) — antes esto
    // degradaba a pass-through para TODA ruta: un fallo del middleware dejaba
    // pasar requests a rutas protegidas sin evaluar sesión (fail-open). Ahora
    // falla CERRADO: las rutas públicas siguen sirviéndose, las protegidas se
    // mandan a /login. Mejor un relogin que un gate abierto ante un error que
    // no sabemos interpretar.
    const msg = err instanceof Error ? err.message : String(err);
    const { pathname } = request.nextUrl;
    // eslint-disable-next-line no-console
    console.error(
      `[middleware] error no atrapado. Path=${redactPath(pathname)}. ` +
        `Mensaje=${msg.slice(0, 200)}`,
    );

    const isPortalPublic = PORTAL_PUBLIC_PATHS.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    );
    if (isPublicPath(pathname) || isPortalPublic) {
      return NextResponse.next({ request });
    }
    const url = request.nextUrl.clone();
    url.pathname = pathname.startsWith("/portal/") ? "/portal/login" : "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
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

  const isPublic = isPublicPath(pathname);
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
