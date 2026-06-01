/**
 * ENDPOINT TEMPORAL DE VERIFICACIÓN SENTRY — Sprint 5 Beta.22.
 *
 * Propósito: confirmar end-to-end que el SDK de Sentry (server) captura
 * excepciones con el DSN configurado en Vercel. Se prueba en el deploy de
 * PREVIEW (las env vars SENTRY_DSN/NEXT_PUBLIC_SENTRY_DSN tienen scope
 * Production + Preview) → NO toca producción.
 *
 * GUARDADO por token: sin `?token=<valor>` correcto responde 404 (no revela
 * que el endpoint existe). El token NO es un secreto real — solo evita que
 * bots disparen ruido en Sentry. Este archivo se ELIMINA tras verificar.
 *
 * Uso: GET /api/_sentry-check?token=avante-sentry-verify-7f3a9c2e
 */
import * as Sentry from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";

// Node runtime: el SDK server de Sentry necesita el runtime Node (no Edge).
export const runtime = "nodejs";
// Nunca cachear — siempre ejecuta y reporta.
export const dynamic = "force-dynamic";

const CHECK_TOKEN = "avante-sentry-verify-7f3a9c2e";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (token !== CHECK_TOKEN) {
    // 404 — no revelar que el endpoint existe sin el token.
    return new NextResponse("Not found", { status: 404 });
  }

  const err = new Error(
    "Sentry verification test — endpoint temporal Sprint 5 Beta.22 (ignorar este issue)",
  );
  const eventId = Sentry.captureException(err, {
    tags: { source: "sentry-verify-endpoint", temporary: "true" },
  });
  // Asegurar el envío antes de responder (serverless puede cortar el proceso).
  await Sentry.flush(2000);

  return NextResponse.json({
    ok: true,
    sentToSentry: true,
    eventId,
    note: "Si eventId no es undefined y aparece en Sentry → Issues, la integración funciona. Endpoint temporal: será removido.",
  });
}
