/**
 * Router tRPC — Analytics del Avante Asistente (Fase 4).
 *
 * Procedures:
 *   - summary({ days })       — totales del rango (sesiones, mensajes, tokens, % CSAT).
 *   - topQueries({ days, n }) — preguntas más frecuentes agrupadas por content user.
 *   - byRole({ days })        — uso por rol activo del usuario.
 *   - recentSessions({ limit }) — últimas conversaciones con feedback / sin feedback.
 *
 * Acceso: requireRole(["ADMIN", "DIR"]).
 *
 * Aislamiento: todas las queries filtran por organizationId del tenant.
 */
import { z } from "zod";
import { router, requireRole } from "../trpc";

const daysInput = z.object({
  days: z.number().int().min(1).max(365).default(30),
});

interface SummaryRow {
  total_sessions: number;
  total_messages: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_tool_calls: number;
  total_rag_hits: number;
  thumbs_up: number;
  thumbs_down: number;
  active_users: number;
}

interface TopQueryRow {
  content: string;
  count: number;
}

interface ByRoleRow {
  role_code: string;
  sessions: number;
  messages: number;
}

interface RecentSessionRow {
  id: string;
  user_id: string;
  user_role_codes: string[];
  started_at: Date;
  last_message_at: Date;
  message_count: number;
  total_tool_calls: number;
  user_feedback: number | null;
  first_user_msg: string | null;
}

export const chatAnalyticsRouter = router({
  summary: requireRole(["ADMIN", "DIR"])
    .input(daysInput)
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const rows = await ctx.prisma.$queryRaw<SummaryRow[]>`
        WITH sess AS (
          SELECT * FROM public.chat_session
          WHERE organization_id = ${orgId}::uuid
            AND started_at >= now() - (${input.days} || ' days')::interval
        ),
        msg AS (
          SELECT * FROM public.chat_message
          WHERE organization_id = ${orgId}::uuid
            AND created_at >= now() - (${input.days} || ' days')::interval
        )
        SELECT
          COUNT(*)::int                                                  AS total_sessions,
          COALESCE(SUM(s.message_count), 0)::int                         AS total_messages,
          COALESCE(SUM(s.total_tokens_in), 0)::int                       AS total_tokens_in,
          COALESCE(SUM(s.total_tokens_out), 0)::int                      AS total_tokens_out,
          COALESCE(SUM(s.total_tool_calls), 0)::int                      AS total_tool_calls,
          COALESCE(SUM(s.total_rag_hits), 0)::int                        AS total_rag_hits,
          COUNT(*) FILTER (WHERE s.user_feedback = 1)::int               AS thumbs_up,
          COUNT(*) FILTER (WHERE s.user_feedback = -1)::int              AS thumbs_down,
          COUNT(DISTINCT s.user_id)::int                                 AS active_users
        FROM sess s
      `;
      const r = rows[0] ?? {
        total_sessions: 0,
        total_messages: 0,
        total_tokens_in: 0,
        total_tokens_out: 0,
        total_tool_calls: 0,
        total_rag_hits: 0,
        thumbs_up: 0,
        thumbs_down: 0,
        active_users: 0,
      };
      const votos = r.thumbs_up + r.thumbs_down;
      return {
        totalSessions: r.total_sessions,
        totalMessages: r.total_messages,
        totalTokensIn: r.total_tokens_in,
        totalTokensOut: r.total_tokens_out,
        totalToolCalls: r.total_tool_calls,
        totalRagHits: r.total_rag_hits,
        thumbsUp: r.thumbs_up,
        thumbsDown: r.thumbs_down,
        csatPercent: votos > 0 ? Math.round((r.thumbs_up / votos) * 100) : null,
        activeUsers: r.active_users,
        // Costo estimado: claude sonnet 4.5 ($3/MT in, $15/MT out)
        // + text-embedding-3-small ($0.02/MT).
        // RAG hits ≈ embeddings calls ≈ tokens negligibles.
        estimatedCostUsd:
          (r.total_tokens_in / 1_000_000) * 3 + (r.total_tokens_out / 1_000_000) * 15,
      };
    }),

  topQueries: requireRole(["ADMIN", "DIR"])
    .input(daysInput.extend({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const rows = await ctx.prisma.$queryRaw<TopQueryRow[]>`
        SELECT
          -- Truncamos a 100 chars + lowercase para agrupar variaciones.
          lower(substring(content, 1, 100)) AS content,
          count(*)::int                      AS count
        FROM public.chat_message
        WHERE organization_id = ${orgId}::uuid
          AND role = 'user'
          AND created_at >= now() - (${input.days} || ' days')::interval
          AND content IS NOT NULL
          AND length(content) >= 5
        GROUP BY lower(substring(content, 1, 100))
        ORDER BY count DESC
        LIMIT ${input.limit}
      `;
      return rows.map((r) => ({
        content: r.content,
        count: r.count,
      }));
    }),

  byRole: requireRole(["ADMIN", "DIR"])
    .input(daysInput)
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const rows = await ctx.prisma.$queryRaw<ByRoleRow[]>`
        WITH role_unnest AS (
          SELECT s.id AS session_id, unnest(s.user_role_codes) AS role_code
          FROM public.chat_session s
          WHERE s.organization_id = ${orgId}::uuid
            AND s.started_at >= now() - (${input.days} || ' days')::interval
        )
        SELECT
          ru.role_code,
          COUNT(DISTINCT ru.session_id)::int AS sessions,
          COALESCE(SUM(s.message_count), 0)::int AS messages
        FROM role_unnest ru
        JOIN public.chat_session s ON s.id = ru.session_id
        GROUP BY ru.role_code
        ORDER BY sessions DESC
        LIMIT 20
      `;
      return rows.map((r) => ({
        roleCode: r.role_code,
        sessions: r.sessions,
        messages: r.messages,
      }));
    }),

  recentSessions: requireRole(["ADMIN", "DIR"])
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const rows = await ctx.prisma.$queryRaw<RecentSessionRow[]>`
        SELECT
          s.id::text,
          s.user_id::text,
          s.user_role_codes,
          s.started_at,
          s.last_message_at,
          s.message_count,
          s.total_tool_calls,
          s.user_feedback,
          (SELECT m.content FROM public.chat_message m
            WHERE m.session_id = s.id AND m.role = 'user'
            ORDER BY m.created_at ASC LIMIT 1) AS first_user_msg
        FROM public.chat_session s
        WHERE s.organization_id = ${orgId}::uuid
        ORDER BY s.last_message_at DESC
        LIMIT ${input.limit}
      `;
      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        userRoleCodes: r.user_role_codes ?? [],
        startedAt: r.started_at.toISOString(),
        lastMessageAt: r.last_message_at.toISOString(),
        messageCount: r.message_count,
        totalToolCalls: r.total_tool_calls,
        userFeedback: r.user_feedback,
        firstUserMsg: r.first_user_msg,
      }));
    }),
});
