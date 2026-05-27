/**
 * POST /api/chat/feedback
 *
 * Recibe el voto del usuario (thumbs up/down) sobre la SESIÓN completa.
 * Actualiza chat_session.user_feedback + opcional comment.
 *
 * Body:
 *   { sessionId, feedback: 1 | -1, comment?: string }
 */
import { setSessionFeedback } from "@/lib/chat/telemetry";

export const runtime = "edge";

interface FeedbackBody {
  sessionId?: string;
  feedback?: 1 | -1;
  comment?: string;
}

export async function POST(req: Request) {
  let body: FeedbackBody;
  try {
    body = (await req.json()) as FeedbackBody;
  } catch {
    return jsonError("JSON inválido", 400);
  }

  if (!body.sessionId) {
    return jsonError("sessionId es requerido", 400);
  }
  if (body.feedback !== 1 && body.feedback !== -1) {
    return jsonError("feedback debe ser 1 (up) o -1 (down)", 400);
  }
  if (body.comment && body.comment.length > 1000) {
    return jsonError("comment max 1000 chars", 400);
  }

  const result = await setSessionFeedback(
    body.sessionId,
    body.feedback,
    body.comment,
  );
  if (!result.ok) {
    return jsonError(result.error ?? "Error al guardar feedback", 500);
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
