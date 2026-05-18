/**
 * Healthcheck endpoint — `/api/health`
 *
 * Usado por:
 *  - Docker HEALTHCHECK
 *  - Vercel monitoring / external uptime probes (Better Uptime, UptimeRobot)
 *  - Load balancers en deploy on-prem
 *
 * Respuesta:
 *  - 200 OK si DB, auth y RLS responden.
 *  - 503 Service Unavailable si alguno falla.
 *
 * Importante: este endpoint NO debe loguear PII ni autenticarse.
 * Sample rate de Sentry para esta ruta es 0 (ver sentry.server.config.ts).
 */
import { NextResponse } from "next/server";
import { runHealthChecks } from "@his/infrastructure/observability/health-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TIMEOUT_MS = 5_000;
const APP_VERSION =
  process.env.APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
const startedAt = Date.now();

async function checkSupabase(): Promise<{ status: "ok" | "degraded" | "down"; latencyMs?: number; error?: string }> {
  const start = Date.now();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return { status: "degraded", error: "NEXT_PUBLIC_SUPABASE_URL no configurado" };
  try {
    const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    const res = await Promise.race([
      fetch(`${url}/auth/v1/health`, {
        cache: "no-store",
        headers: apikey ? { apikey } : undefined,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("supabase timeout")), TIMEOUT_MS),
      ),
    ]);
    if (!res.ok) {
      return { status: "down", latencyMs: Date.now() - start, error: `HTTP ${res.status}` };
    }
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: "down",
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}

export async function GET() {
  const [core, supabase] = await Promise.all([runHealthChecks({}), checkSupabase()]);

  const coreDown = core.db === "fail" || core.auth === "fail" || core.rls === "fail";
  const supabaseDown = supabase.status === "down";

  const overall: "ok" | "degraded" | "down" =
    coreDown || supabaseDown
      ? "down"
      : supabase.status === "degraded"
        ? "degraded"
        : "ok";

  const body = {
    status: overall,
    version: APP_VERSION,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: core.timestamp,
    checks: {
      db: core.db,
      auth: core.auth,
      rls: core.rls,
      supabase,
    },
  };

  const statusCode = overall === "down" ? 503 : 200;
  return NextResponse.json(body, {
    status: statusCode,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
