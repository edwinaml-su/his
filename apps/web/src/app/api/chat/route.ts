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
import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { searchKnowledge, formatChunksForContext } from "@/lib/chat/rag";
import { buildTools } from "@/lib/chat/tools";

// Edge runtime para streaming low-latency.
export const runtime = "edge";
export const maxDuration = 60;

/** Extrae el último mensaje del usuario para alimentar el retrieval RAG. */
function extractLastUserText(messages: ChatRequestBody["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    if (typeof m.content === "string" && m.content.trim()) return m.content;
    if (Array.isArray(m.parts)) {
      const text = m.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join(" ")
        .trim();
      if (text) return text;
    }
  }
  return "";
}

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
    /** Fase 3: identidad para tools tenant-scoped. */
    userId?: string;
    organizationId?: string;
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

  // RAG: recuperar chunks relevantes del último query del usuario.
  // Degrada graceful — si falla embeddings o BD, el bot responde solo con
  // el catálogo curado.
  const lastUserText = extractLastUserText(body.messages);
  let ragContext = "";
  if (lastUserText.length >= 4) {
    try {
      const chunks = await searchKnowledge(lastUserText);
      ragContext = formatChunksForContext(chunks);
    } catch {
      // ignore — degradación graceful.
    }
  }

  // Fase 3: tools tenant-scoped (read-only).
  const tools = buildTools({
    userId: body.context?.userId,
    organizationId: body.context?.organizationId,
    roleCodes: body.context?.roleCodes,
  });

  const result = streamText({
    model: anthropic("claude-sonnet-4-5"),
    system: buildSystemPrompt(body.context) + ragContext,
    messages: modelMessages,
    tools,
    // stopWhen: el modelo puede hacer hasta 3 pasos (call tool → ver
    // resultado → responder). Suficiente para flujos como "busca al
    // paciente X y dime su última cirugía".
    stopWhen: stepCountIs(3),
    maxOutputTokens: 2048,
    temperature: 0.3,
  });

  return result.toUIMessageStreamResponse();
}
