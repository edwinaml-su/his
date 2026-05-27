/**
 * Telemetría del Avante Asistente — Fase 4.
 *
 * Persiste cada turno (mensaje user + mensaje assistant) en
 * `chat_session` + `chat_message`. Edge-friendly: usa fetch a PostgREST
 * con SERVICE_ROLE_KEY, no Prisma.
 *
 * Best-effort: si la persistencia falla, NO bloquea la respuesta del bot.
 * Errores se loggean a console; el usuario ni se entera.
 */

interface PersistTurnInput {
  sessionId: string;
  userId: string;
  organizationId: string;
  userRoleCodes: string[];
  currentPath?: string;
  /** Texto del mensaje del usuario. */
  userText: string;
  /** Texto final del mensaje del assistant (concatenado tras streaming). */
  assistantText: string;
  /** Tool calls del assistant — array de { toolName, input, output? }. */
  toolCalls: Array<{ toolName: string; input?: unknown; output?: unknown }>;
  /** Sources de RAG citadas (paths de archivos como docs/flujos/X.md). */
  retrievedSources: string[];
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function pgRest(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<Response> {
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase no configurado.");
  }
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...init.headers,
    },
  });
}

/**
 * Upsert de la sesión (crea si no existe, actualiza counters si existe).
 * Lo más simple: SELECT por id; si existe, UPDATE; si no, INSERT.
 * Hacemos un INSERT con ON CONFLICT DO UPDATE via Prefer: resolution.
 */
async function upsertSession(
  sessionId: string,
  userId: string,
  organizationId: string,
  userRoleCodes: string[],
  deltas: {
    tokensIn: number;
    tokensOut: number;
    toolCalls: number;
    ragHits: number;
  },
): Promise<void> {
  // Verificamos existencia.
  const res = await pgRest(`chat_session?id=eq.${sessionId}&select=id`);
  if (!res.ok) throw new Error(`chat_session lookup failed: ${res.status}`);
  const existing = (await res.json()) as Array<{ id: string }>;

  if (existing.length === 0) {
    // INSERT.
    const insertRes = await pgRest("chat_session", {
      method: "POST",
      body: JSON.stringify({
        id: sessionId,
        organization_id: organizationId,
        user_id: userId,
        user_role_codes: userRoleCodes,
        started_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        message_count: 2, // este turno: user + assistant
        total_tokens_in: deltas.tokensIn,
        total_tokens_out: deltas.tokensOut,
        total_tool_calls: deltas.toolCalls,
        total_rag_hits: deltas.ragHits,
      }),
    });
    if (!insertRes.ok) {
      const txt = await insertRes.text();
      throw new Error(`chat_session insert failed: ${insertRes.status} ${txt.slice(0, 200)}`);
    }
  } else {
    // UPDATE: incrementar contadores. PostgREST no soporta SET col = col + N
    // directamente — hacemos read-modify-write.
    const readRes = await pgRest(
      `chat_session?id=eq.${sessionId}&select=message_count,total_tokens_in,total_tokens_out,total_tool_calls,total_rag_hits`,
    );
    if (!readRes.ok) throw new Error(`chat_session read failed: ${readRes.status}`);
    const rows = (await readRes.json()) as Array<{
      message_count: number;
      total_tokens_in: number;
      total_tokens_out: number;
      total_tool_calls: number;
      total_rag_hits: number;
    }>;
    const row = rows[0]!;
    const updateRes = await pgRest(`chat_session?id=eq.${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        last_message_at: new Date().toISOString(),
        message_count: row.message_count + 2,
        total_tokens_in: row.total_tokens_in + deltas.tokensIn,
        total_tokens_out: row.total_tokens_out + deltas.tokensOut,
        total_tool_calls: row.total_tool_calls + deltas.toolCalls,
        total_rag_hits: row.total_rag_hits + deltas.ragHits,
      }),
    });
    if (!updateRes.ok) {
      throw new Error(`chat_session update failed: ${updateRes.status}`);
    }
  }
}

/** Persiste user msg + assistant msg en una sola llamada batch. */
async function insertMessages(
  payloads: Array<Record<string, unknown>>,
): Promise<void> {
  const res = await pgRest("chat_message", {
    method: "POST",
    body: JSON.stringify(payloads),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`chat_message insert failed: ${res.status} ${txt.slice(0, 200)}`);
  }
}

/**
 * Persiste el turno completo (user msg + assistant msg + counters de sesión).
 * Best-effort: nunca lanza al caller (envuelve internamente try/catch).
 */
export async function persistTurn(input: PersistTurnInput): Promise<void> {
  try {
    await upsertSession(
      input.sessionId,
      input.userId,
      input.organizationId,
      input.userRoleCodes,
      {
        tokensIn: input.tokensIn ?? 0,
        tokensOut: input.tokensOut ?? 0,
        toolCalls: input.toolCalls.length,
        ragHits: input.retrievedSources.length,
      },
    );

    const now = new Date().toISOString();
    await insertMessages([
      {
        session_id: input.sessionId,
        organization_id: input.organizationId,
        user_id: input.userId,
        role: "user",
        content: input.userText,
        tool_calls: [],
        current_path: input.currentPath ?? null,
        user_role_codes: input.userRoleCodes,
        retrieved_sources: input.retrievedSources,
        created_at: now,
      },
      {
        session_id: input.sessionId,
        organization_id: input.organizationId,
        user_id: input.userId,
        role: "assistant",
        content: input.assistantText,
        tool_calls: input.toolCalls,
        current_path: input.currentPath ?? null,
        user_role_codes: input.userRoleCodes,
        retrieved_sources: input.retrievedSources,
        tokens_in: input.tokensIn ?? null,
        tokens_out: input.tokensOut ?? null,
        latency_ms: input.latencyMs ?? null,
        created_at: now,
      },
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[telemetry]", err instanceof Error ? err.message : err);
  }
}

/**
 * Endpoint helper para que el usuario marque la sesión completa con
 * thumbs up/down. MVP simple — sin tracking de IDs por mensaje.
 */
export async function setSessionFeedback(
  sessionId: string,
  feedback: 1 | -1,
  comment?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await pgRest(`chat_session?id=eq.${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        user_feedback: feedback,
        feedback_comment: comment ?? null,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `${res.status}: ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
