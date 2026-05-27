/**
 * Endpoint del Asistente HIS — chat conversacional con Claude (Anthropic).
 *
 * Streaming SSE vía Vercel AI SDK. El cliente usa `useChat()` de la lib `ai`.
 *
 * Env vars requeridas en Vercel:
 *   - ANTHROPIC_API_KEY — sk-ant-... (Settings → Environment Variables, Production)
 *
 * Modelo: claude-sonnet-4 (balance precio/calidad). Cambiar a opus si se requiere
 * más razonamiento; haiku si se quiere reducir costo.
 *
 * Rate limit: por sesión Supabase (ctx.user.id) — middleware fuera de scope MVP.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToModelMessages } from "ai";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";

// Edge runtime para streaming low-latency.
export const runtime = "edge";
export const maxDuration = 60;

interface ChatRequestBody {
  messages: Array<{
    role: "user" | "assistant" | "system";
    content?: string;
    parts?: Array<{ type: string; text?: string }>;
  }>;
  context?: {
    currentPath?: string;
    roleCodes?: string[];
    organizationName?: string;
  };
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "ANTHROPIC_API_KEY no configurada en el servidor. Pídele al ADMIN que la agregue en Vercel.",
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return new Response(
      JSON.stringify({ error: "JSON inválido en el cuerpo de la petición." }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  if (!body.messages || !Array.isArray(body.messages)) {
    return new Response(
      JSON.stringify({ error: "Falta el campo `messages` (array)." }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const modelMessages = await convertToModelMessages(
    body.messages.map((m) => ({
      role: m.role,
      parts:
        m.parts && m.parts.length > 0
          ? m.parts
          : [{ type: "text" as const, text: m.content ?? "" }],
    })) as Parameters<typeof convertToModelMessages>[0],
  );

  const result = streamText({
    model: anthropic("claude-sonnet-4-5"),
    system: buildSystemPrompt(body.context),
    messages: modelMessages,
    // Tokens generosos: el prompt incluye el catálogo (~1500 tok),
    // respuestas típicas <500 tok, max 2K para flujos largos.
    maxOutputTokens: 2048,
    // Temperature media-baja: factual + conversacional pero no creativo.
    temperature: 0.3,
  });

  return result.toUIMessageStreamResponse();
}
