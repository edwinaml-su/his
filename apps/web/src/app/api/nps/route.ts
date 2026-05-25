/**
 * POST /api/nps — recibe una respuesta NPS del usuario.
 * Body: { score: 0-10, comment?: string }
 *
 * El score lo escribe el usuario en /feedback. Alimenta el KPI
 * gob_satisfaccion del dashboard ejecutivo.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@his/database";
import { cookies } from "next/headers";
import { getCurrentUser, HIS_COOKIES } from "@/lib/auth/session";

interface Payload {
  score: number;
  comment?: string | null;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "no autenticado" }, { status: 401 });

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ ok: false, error: "json inválido" }, { status: 400 });
  }
  if (typeof body.score !== "number" || body.score < 0 || body.score > 10) {
    return NextResponse.json({ ok: false, error: "score 0-10" }, { status: 400 });
  }

  const orgId = cookies().get(HIS_COOKIES.ORG_COOKIE)?.value ?? null;
  const comment = (body.comment ?? "").trim().slice(0, 1000) || null;

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "NpsResponse" ("userId", "organizationId", score, comment)
       VALUES ($1, $2, $3, $4)`,
      user.id,
      orgId,
      body.score,
      comment,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
