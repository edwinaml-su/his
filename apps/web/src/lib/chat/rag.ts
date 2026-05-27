/**
 * RAG (Retrieval-Augmented Generation) para el Avante Asistente.
 *
 * Flujo:
 *   1. Embedding del query del usuario con OpenAI text-embedding-3-small.
 *   2. Llamada a `chat_knowledge_search(embedding, k)` en Supabase.
 *   3. Top-k chunks devueltos al caller (route.ts) para inyección en system.
 *
 * Robustez:
 *   - Si OPENAI_API_KEY no está, retorna [] (degradación graceful: el bot
 *     responde con el catálogo curado del system prompt, sin RAG).
 *   - Timeout corto (5s) para no bloquear streaming en caso de problemas.
 */

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const SEARCH_TOP_K = 5;
const SEARCH_MIN_SIMILARITY = 0.45;
const EMBEDDING_TIMEOUT_MS = 5000;

export interface KnowledgeChunk {
  id: string;
  source: string;
  title: string;
  content: string;
  similarity: number;
}

/**
 * Embed un texto vía OpenAI Embeddings API.
 * Lanza si falla — el caller debe manejar el error con try/catch para no
 * romper el chat principal.
 */
async function embedQuery(query: string, signal?: AbortSignal): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY no configurada");
  }
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: query,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI embeddings ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0]!.embedding;
}

/**
 * Busca chunks relevantes en Supabase via PostgREST RPC.
 * Retorna [] en cualquier error (degradación graceful — no rompe el chat).
 */
export async function searchKnowledge(query: string): Promise<KnowledgeChunk[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceKey || !process.env.OPENAI_API_KEY) {
    // RAG opcional — si falta config, retorna vacío.
    return [];
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EMBEDDING_TIMEOUT_MS);

  try {
    const embedding = await embedQuery(query, ctrl.signal);

    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/chat_knowledge_search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        query_embedding: embedding,
        match_count: SEARCH_TOP_K,
        min_similarity: SEARCH_MIN_SIMILARITY,
      }),
      signal: ctrl.signal,
    });

    if (!rpcRes.ok) {
      // eslint-disable-next-line no-console
      console.error("[RAG] chat_knowledge_search failed:", rpcRes.status);
      return [];
    }

    const chunks = (await rpcRes.json()) as KnowledgeChunk[];
    return Array.isArray(chunks) ? chunks : [];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[RAG] search failed:", err instanceof Error ? err.message : err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Formatea chunks como bloque de contexto inyectable en el system prompt.
 * Cada chunk lleva su fuente para que el bot pueda citarla.
 */
export function formatChunksForContext(chunks: KnowledgeChunk[]): string {
  if (chunks.length === 0) return "";
  const blocks = chunks
    .map(
      (c, i) =>
        `[Fuente ${i + 1}: ${c.source} — "${c.title}"]\n${c.content.trim()}`,
    )
    .join("\n\n---\n\n");

  return `\n## Contexto regulatorio recuperado (cita estas fuentes cuando aplique)\n\n${blocks}\n`;
}
