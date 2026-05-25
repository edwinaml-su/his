/**
 * POST /api/perf/sample
 *
 * Recibe muestras de performance del cliente (page load / fetch / mutation).
 * Body: { route, kind, durationMs }
 *
 * El cliente registra `performance.now()` antes y después de la operación,
 * y reporta el delta aquí. La tabla PerformanceSample alimenta el KPI
 * tec_response_time del dashboard ejecutivo.
 *
 * No throw en flujos esperados — silenciosamente acepta o ignora.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@his/database";
import { cookies } from "next/headers";
import { getCurrentUser, HIS_COOKIES } from "@/lib/auth/session";

interface Payload {
  route: string;
  kind: "pageload" | "fetch" | "mutation";
  durationMs: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Payload;
    if (
      typeof body?.route !== "string" ||
      typeof body?.kind !== "string" ||
      typeof body?.durationMs !== "number" ||
      body.durationMs < 0 ||
      body.durationMs > 300_000
    ) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const user = await getCurrentUser();
    const orgId = cookies().get(HIS_COOKIES.ORG_COOKIE)?.value ?? null;

    await prisma.$executeRawUnsafe(
      `INSERT INTO "PerformanceSample" (route, kind, duration_ms, "userId", "organizationId")
       VALUES ($1, $2, $3, $4, $5)`,
      body.route.slice(0, 200),
      body.kind.slice(0, 40),
      body.durationMs,
      user?.id ?? null,
      orgId,
    );

    return NextResponse.json({ ok: true });
  } catch {
    // Performance sampling no debe romper UX si falla
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
