"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client para Client Components.
 * Patrón oficial @supabase/ssr (Next.js 14 App Router).
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
