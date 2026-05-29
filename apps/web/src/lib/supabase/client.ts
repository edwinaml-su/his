"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

/**
 * Supabase client para Client Components.
 * Patrón oficial @supabase/ssr (Next.js 14 App Router).
 *
 * Si las env vars faltan, `getSupabaseEnv()` lanza con mensaje accionable
 * (qué env var falta + dónde configurarla) en lugar de un error críptico.
 */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient(url, anonKey);
}

/**
 * Limpia toda la sesión Supabase del lado cliente.
 *
 * Útil para recuperarse de:
 *   - Cookie/localStorage stale post-upgrade de @supabase/supabase-js.
 *   - Safari TypeError "Attempted to assign to readonly property" en
 *     _recoverAndRefresh (la lib intenta mutar el response object y Safari
 *     lo trata como frozen).
 *   - Sesión expirada que el lib no puede refresh por race condition.
 *
 * Borra:
 *   - localStorage keys que empiecen con "sb-" o "supabase."
 *   - sessionStorage keys análogas
 *   - Cookies sb-* (las accesibles desde JS — HttpOnly cookies las limpia
 *     el server-side via updateSession() del middleware).
 *
 * Llamar sobre window. No-op si SSR.
 */
export function clearSupabaseClientStorage(): void {
  if (typeof window === "undefined") return;

  // localStorage + sessionStorage
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && (key.startsWith("sb-") || key.startsWith("supabase."))) {
          keysToRemove.push(key);
        }
      }
      for (const k of keysToRemove) storage.removeItem(k);
    } catch {
      // Algunos modos Safari (incógnito) lanzan SecurityError. Ignorar.
    }
  }

  // Cookies sb-* visibles desde JS (sb-...-auth-token chunks .0/.1/.2 etc.)
  try {
    const cookies = document.cookie.split(";");
    for (const raw of cookies) {
      const name = raw.split("=")[0]?.trim();
      if (!name) continue;
      if (name.startsWith("sb-")) {
        // Expire por dominio actual + raíz
        const expire = "Thu, 01 Jan 1970 00:00:00 GMT";
        document.cookie = `${name}=; expires=${expire}; path=/`;
        document.cookie = `${name}=; expires=${expire}; path=/; domain=${window.location.hostname}`;
      }
    }
  } catch {
    // Cookies API puede fallar en sandbox iframes; ignorar.
  }
}

/**
 * Wrapper resiliente para getSession() en client components.
 * Si Safari throws "Attempted to assign to readonly property" (bug interno
 * GoTrueClient _recoverAndRefresh), limpia el storage corrupto y devuelve
 * `{ session: null }` para que la app trate como "sin sesión" — el usuario
 * relogueará con storage limpio.
 */
export async function safeGetSession(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
): Promise<{ session: { user: unknown } | null }> {
  try {
    const { data } = await supabase.auth.getSession();
    return { session: data.session };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isReadonlyAssignBug =
      err instanceof TypeError &&
      (msg.includes("readonly property") ||
        msg.includes("Cannot create property") ||
        msg.includes("read-only"));
    if (!isReadonlyAssignBug) throw err;
    // Auto-heal: limpiar storage + devolver sin sesión.
    // eslint-disable-next-line no-console
    console.warn(
      "[supabase-client] getSession() Safari readonly bug detectado — limpiando storage.",
    );
    clearSupabaseClientStorage();
    return { session: null };
  }
}
