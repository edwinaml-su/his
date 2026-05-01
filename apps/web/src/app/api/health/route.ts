/**
 * Healthcheck endpoint — `/api/health`
 *
 * Usado por:
 *  - Docker HEALTHCHECK
 *  - Vercel monitoring / external uptime probes (Better Uptime, UptimeRobot)
 *  - Load balancers en deploy on-prem
 *
 * Respuesta:
 *  - 200 OK si DB y Supabase Auth responden.
 *  - 503 Service Unavailable si alguno falla.
 *
 * Importante: este endpoint NO debe loguear PII ni autenticarse.
 * Sample rate de Sentry para esta ruta es 0 (ver sentry.server.config.ts).
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TIMEOUT_MS = 5_000;
const APP_VERSION =
  process.env.APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
const startedAt = Date.now();

type CheckResult = {
  status: "ok" | "degraded" | "down";
  latencyMs?: number;
  error?: string;
};

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now();
  try {
    // Import dinámico para no bloquear el bundle si Prisma no está cargado
    const { prisma } = await import("@his/database");
    await withTimeout(prisma.$queryRaw`SELECT 1`, TIMEOUT_MS, "db");
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: "down",
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}

async function checkSupabase(): Promise<CheckResult> {
  const start = Date.now();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return { status: "degraded", error: "NEXT_PUBLIC_SUPABASE_URL no configurado" };
  try {
    // Healthcheck Supabase Auth — requiere header apikey (cualquier publishable/anon key sirve).
    const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    const res = await withTimeout(
      fetch(`${url}/auth/v1/health`, {
        cache: "no-store",
        headers: apikey ? { apikey } : undefined,
      }),
      TIMEOUT_MS,
      "supabase",
    );
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
  const [db, supabase] = await Promise.all([checkDatabase(), checkSupabase()]);

  const overall: "ok" | "degraded" | "down" =
    db.status === "down" || supabase.status === "down"
      ? "down"
      : db.status === "degraded" || supabase.status === "degraded"
        ? "degraded"
        : "ok";

  const body = {
    status: overall,
    version: APP_VERSION,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    checks: {
      db,
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
