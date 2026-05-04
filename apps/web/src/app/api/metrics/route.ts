/**
 * Endpoint Prometheus-compatible — `/api/metrics`
 *
 * Devuelve métricas básicas en formato text/plain (Prometheus exposition format v0.0.4).
 * Útil para scraping desde un Prometheus/Grafana Agent o desde Vercel Otel collector.
 *
 * MVP: valores hardcoded / derivados del healthcheck en runtime.
 * TODO Sprint 6: integración real con un agente de monitoreo y métricas RED del runtime.
 *
 * Restricciones:
 *  - NO autenticado (típico de /metrics) — pero NO debe exponer PHI ni labels con tenant id.
 *  - Cache-Control no-store para que el scraper siempre obtenga fresh data.
 *  - tracesSampleRate de Sentry para esta ruta es 0 (ver sentry.shared.ts).
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const startedAt = Date.now();
const APP_VERSION =
  process.env.APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
const ENVIRONMENT = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";

const CHECK_TIMEOUT_MS = 3_000;

type Sample = {
  name: string;
  help: string;
  type: "gauge" | "counter";
  value: number;
  labels?: Record<string, string>;
};

function renderPrometheus(samples: Sample[]): string {
  const lines: string[] = [];
  const seenNames = new Set<string>();
  for (const s of samples) {
    if (!seenNames.has(s.name)) {
      lines.push(`# HELP ${s.name} ${s.help}`);
      lines.push(`# TYPE ${s.name} ${s.type}`);
      seenNames.add(s.name);
    }
    const labelStr = s.labels
      ? `{${Object.entries(s.labels)
          .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
          .join(",")}}`
      : "";
    lines.push(`${s.name}${labelStr} ${Number.isFinite(s.value) ? s.value : 0}`);
  }
  return lines.join("\n") + "\n";
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout`)), ms),
    ),
  ]);
}

async function probeDb(): Promise<{ latencyMs: number; up: boolean }> {
  const start = Date.now();
  try {
    const { prisma } = await import("@his/database");
    await withTimeout(prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS, "db");
    return { latencyMs: Date.now() - start, up: true };
  } catch {
    return { latencyMs: Date.now() - start, up: false };
  }
}

async function probeSupabase(): Promise<{ latencyMs: number; up: boolean }> {
  const start = Date.now();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return { latencyMs: 0, up: false };
  try {
    const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    const res = await withTimeout(
      fetch(`${url}/auth/v1/health`, {
        cache: "no-store",
        headers: apikey ? { apikey } : undefined,
      }),
      CHECK_TIMEOUT_MS,
      "supabase",
    );
    return { latencyMs: Date.now() - start, up: res.ok };
  } catch {
    return { latencyMs: Date.now() - start, up: false };
  }
}

export async function GET() {
  const [db, supabase] = await Promise.all([probeDb(), probeSupabase()]);
  const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);

  const samples: Sample[] = [
    {
      name: "his_uptime_seconds",
      help: "Tiempo en segundos desde que el proceso del servidor arrancó.",
      type: "gauge",
      value: uptimeSec,
      labels: { env: ENVIRONMENT, version: APP_VERSION },
    },
    {
      name: "his_db_latency_ms",
      help: "Latencia (ms) de un SELECT 1 contra la base de datos primaria.",
      type: "gauge",
      value: db.latencyMs,
    },
    {
      name: "his_db_up",
      help: "1 si la BD respondió OK al último probe, 0 si no.",
      type: "gauge",
      value: db.up ? 1 : 0,
    },
    {
      name: "his_supabase_latency_ms",
      help: "Latencia (ms) del healthcheck contra Supabase Auth.",
      type: "gauge",
      value: supabase.latencyMs,
    },
    {
      name: "his_supabase_up",
      help: "1 si Supabase Auth respondió OK al último probe, 0 si no.",
      type: "gauge",
      value: supabase.up ? 1 : 0,
    },
    {
      name: "his_build_info",
      help: "Información del build actual (siempre 1, los datos viven en labels).",
      type: "gauge",
      value: 1,
      labels: { env: ENVIRONMENT, version: APP_VERSION },
    },
  ];

  const body = renderPrometheus(samples);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
