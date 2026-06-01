/**
 * ENDPOINT TEMPORAL DE VERIFICACIÓN SENTRY — Sprint 5 Beta.22.
 *
 * Propósito: confirmar end-to-end que el SDK de Sentry (server) captura
 * excepciones con el DSN configurado en Vercel. Se prueba en el deploy de
 * PREVIEW (env vars SENTRY_DSN/NEXT_PUBLIC_SENTRY_DSN scope Production+Preview).
 *
 * Acceso: este path se agrega a PUBLIC_PATHS del middleware (sin gate de auth),
 * pero queda guardado por token → sin `?token=<valor>` correcto responde 404.
 * El token NO es secreto real (solo evita ruido de bots). Se ELIMINA tras verificar.
 *
 * NOTA: la carpeta NO lleva prefijo "_" — en Next App Router las carpetas
 * `_foo` son private folders (excluidas del routing → 404).
 *
 * Uso: GET /api/sentry-check?token=avante-sentry-verify-7f3a9c2e
 */
import * as Sentry from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECK_TOKEN = "avante-sentry-verify-7f3a9c2e";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (token !== CHECK_TOKEN) {
    return new NextResponse("Not found", { status: 404 });
  }

  const err = new Error(
    "Sentry verification test — endpoint temporal Sprint 5 Beta.22 (ignorar este issue)",
  );
  const eventId = Sentry.captureException(err, {
    tags: { source: "sentry-verify-endpoint", temporary: "true" },
  });
  await Sentry.flush(2000);

  return NextResponse.json({
    ok: true,
    sentToSentry: true,
    eventId,
    note: "Si eventId no es undefined y aparece en Sentry → Issues, la integración funciona. Endpoint temporal.",
  });
}
