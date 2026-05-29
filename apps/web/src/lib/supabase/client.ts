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
