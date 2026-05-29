/**
 * Validación centralizada de env vars Supabase.
 *
 * Reemplaza el patrón `process.env.NEXT_PUBLIC_SUPABASE_URL!` (non-null
 * assertion) que producía 500 MIDDLEWARE_INVOCATION_FAILED críptico cuando
 * las env vars faltaban en deploys (típicamente previews Vercel sin
 * env scope "Preview" configurado).
 *
 * Estrategia: validar al primer uso, lanzar Error con mensaje accionable
 * para el operador (qué env var falta + dónde configurarla). Next.js lo
 * convierte en 500 igualmente pero el log es legible.
 *
 * NO importar en el middleware Edge runtime — usa `getSupabaseEnvOrNull()`
 * que es defensivo. El middleware decide qué hacer si faltan.
 */

const SUPABASE_DASHBOARD_HINT =
  "Vercel: Project Settings → Environment Variables (scope Production + Preview + Development).";

/** Devuelve env vars validadas; lanza si faltan. Para uso en server/client/SSR. */
export function getSupabaseEnv(): {
  url: string;
  anonKey: string;
} {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    const missing = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !anonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `[supabase-env] Variables requeridas faltan: ${missing}. ${SUPABASE_DASHBOARD_HINT}`,
    );
  }

  return { url, anonKey };
}

/**
 * Variante para middleware Edge runtime — devuelve null si faltan en vez de throw.
 * Permite al middleware degradar grácilmente (deja pasar la request sin verificar
 * sesión + log de warning) en lugar de 500.
 */
export function getSupabaseEnvOrNull(): {
  url: string;
  anonKey: string;
} | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}
