import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

/**
 * Supabase client para Server Components / Server Actions / Route Handlers.
 * Patrón oficial @supabase/ssr.
 *
 * Si las env vars faltan, `getSupabaseEnv()` lanza con mensaje accionable.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();
  const { url, anonKey } = getSupabaseEnv();
  return createServerClient(
    url,
    anonKey,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // En Server Components readonly. Lo refrescará el middleware.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // ignore
          }
        },
      },
    },
  );
}
