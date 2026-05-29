import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnvOrNull } from "./env";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
