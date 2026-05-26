import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/api/trpc",
  "/api/health",
  "/_next",
  "/favicon.ico",
];

// K-11: rutas del portal del paciente que no requieren sesión portal.
const PORTAL_PUBLIC_PATHS = ["/portal/login", "/portal/verify", "/portal/register"];

// K-11: nombre de cookie de sesión portal (debe coincidir con PORTAL_SESSION_COOKIE
// en @/lib/portal-session, duplicado aquí porque middleware corre en Edge runtime
// y no puede importar módulos Node.js como node:crypto que usa portal-session.ts).
const PORTAL_SESSION_COOKIE = "his.portal.session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
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
