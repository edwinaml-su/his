import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnvOrNull } from "./env";

/**
 * Setea Set-Cookie de expiración para TODAS las cookies sb-* conocidas SIN
 * iterar `request.cookies.getAll()` (que puede fallar con Invalid UTF-8 si
 * alguna cookie tiene bytes corruptos). Le dice al browser que las elimine.
 *
 * @his/ssr chunkea cookies grandes en `.0`, `.1`, `.2`… cuando exceden 4KB.
 * También usa `-code-verifier` durante OAuth PKCE flow. Cubrimos hasta .9.
 */
function nukeSupabaseCookies(response: NextResponse, supabaseUrl: string) {
  // ejacvsgbewcerxtjtwto.supabase.co → "ejacvsgbewcerxtjtwto"
  const ref = supabaseUrl
    .replace(/^https?:\/\//, "")
    .split(".")[0] ?? "";
  if (!ref) return;
  const base = `sb-${ref}-auth-token`;
  const suffixes = ["", ".0", ".1", ".2", ".3", ".4", ".5", ".6", ".7", ".8", ".9", "-code-verifier"];
  for (const sfx of suffixes) {
    try {
      response.cookies.set({
        name: `${base}${sfx}`,
        value: "",
        maxAge: 0,
        path: "/",
      });
    } catch {
      // Edge runtime puede lanzar si el nombre tiene caracteres raros (improbable
      // aquí porque hardcoded). Ignorar — best-effort cleanup.
    }
  }
}

/**
 * Refresh de la sesión Supabase en cada request.
 * Patrón oficial @supabase/ssr middleware.
 *
 * Defensa: si las env vars Supabase faltan (caso típico: Vercel preview deploy
 * sin scope "Preview" configurado), devolvemos `{ response, user: null }` con
 * un warning en console.error. El middleware tratará la request como
 * "sin sesión" y aplicará su política (redirect a /login si no es pública).
 * Esto evita 500 MIDDLEWARE_INVOCATION_FAILED críptico que confunde diagnóstico.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const env = getSupabaseEnvOrNull();
  if (!env) {
    // Loggeado una vez por cold start, no por cada request — Edge runtime
    // mantiene el módulo cargado, así que el throttle es natural.
    if (typeof (globalThis as { __his_env_warned?: boolean }).__his_env_warned === "undefined") {
      console.error(
        "[middleware] NEXT_PUBLIC_SUPABASE_URL/ANON_KEY faltantes en este deploy. " +
        "Configurar en Vercel → Settings → Environment Variables (scope Preview + Production).",
      );
      (globalThis as { __his_env_warned?: boolean }).__his_env_warned = true;
    }
    return { response, user: null };
  }

  const supabase = createServerClient(
    env.url,
    env.anonKey,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    },
  );

  // Defensa: cookie Supabase corrupta o malformada. Casos cubiertos:
  //
  //   1. "Cannot create property 'user' on string" — mismatch versión @supabase/ssr
  //      al setear vs leer (string JSON sin parsear).
  //   2. "Invalid UTF-8 sequence" — bytes corruptos en cookie value (Edge runtime
  //      falla al decodificar). Puede pasar tras rotación parcial de cookies o
  //      ataques de fuzzing.
  //   3. "is not iterable" / "Cannot convert undefined" — variantes documentadas.
  //
  // En todos los casos limpiamos las cookies sb-* del response (sin iterar
  // request.cookies.getAll() que también puede fallar con UTF-8 inválido) y
  // devolvemos user=null para forzar re-login con cookies frescas.
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return { response, user };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isRecoverable =
      msg.includes("Cannot create property") ||
      msg.includes("Cannot convert undefined") ||
      msg.includes("is not iterable") ||
      msg.includes("Invalid UTF-8") ||
      msg.includes("invalid byte sequence");

    if (!isRecoverable) throw err;

    console.error(
      "[middleware] cookie Supabase corrupta — limpiando para forzar re-login. " +
        `Path=${request.nextUrl.pathname}. Tipo=${err instanceof Error ? err.name : "?"}. Mensaje=${msg.slice(0, 200)}`,
    );

    // Limpiar cookies sb-* hardcoded (NO iterar request.cookies — puede fallar
    // con el mismo Invalid UTF-8 que originó el problema).
    const fresh = NextResponse.next({ request });
    nukeSupabaseCookies(fresh, env.url);
    return { response: fresh, user: null };
  }
}
