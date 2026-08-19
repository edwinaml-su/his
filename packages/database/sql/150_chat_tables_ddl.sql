-- =============================================================================
-- 150_chat_tables_ddl.sql
-- DDL base de public.chat_session / public.chat_message
--
-- ORIGEN: este archivo NO fue escrito de cero. `chat_session`/`chat_message`
-- llevan meses activas en producción (`ejacvsgbewcerxtjtwto`) — las consulta
-- packages/trpc/src/routers/chat-analytics.router.ts con SQL crudo y las
-- referencia docs/runbooks/owasp-2025-deploy.md — pero ningún archivo de este
-- corpus las crea, y no existe `model` Prisma equivalente. Los archivos
-- `156_rls_chat_tables.sql`, `197_owasp2025_a09_chat_audit.sql` y
-- `198_owasp2025_a09_chat_message_metadata_audit.sql` YA asumen que estas
-- tablas existen (RLS/triggers de auditoría) y fallan en una reconstrucción
-- desde cero por esta razón — ver docs/runbooks/db-reconstruccion-fuera-de-supabase.md
-- §5.2 categoría E.
--
-- Este DDL fue RECUPERADO POR INTROSPECCIÓN de la BD de producción (lectura
-- vía information_schema/pg_catalog: columns, pg_constraint, pg_indexes) el
-- 2026-08-19, NO escrito desde el diseño original — es una reconstrucción de
-- lo que ya existe, no la fuente original. Numerado 150 (menor que 156) para
-- que el runner (`packages/database/scripts/reconstruct-schema.mjs`, orden
-- `sort -V`) lo aplique antes de los archivos que dependen de estas tablas.
--
-- Fuera de alcance de este archivo (ya cubierto por otros del corpus, no se
-- duplica aquí): RLS + políticas tenant (156), triggers + función de
-- auditoría genérica (197), función de auditoría/redacción dedicada de
-- chat_message (198). Los GRANT a anon/authenticated/service_role no se
-- listan aquí porque en Supabase se heredan automáticamente de los
-- `ALTER DEFAULT PRIVILEGES` de plataforma sobre el schema `public` — igual
-- que el resto de tablas `CREATE TABLE` sueltas de este corpus.
--
-- NOTA (hallazgo colateral, fuera de alcance de esta tarea): `chat_knowledge_chunk`
-- —referenciada por 156_rls_chat_tables.sql— tiene el MISMO problema (sin
-- CREATE TABLE en el corpus) y NO se resuelve en este archivo porque no fue
-- parte del encargo (solo chat_session/chat_message). Reportado aparte.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- chat_session
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_session (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  user_id           uuid        NOT NULL,
  user_role_codes   text[]      NOT NULL DEFAULT '{}',
  started_at        timestamptz NOT NULL DEFAULT now(),
  last_message_at   timestamptz NOT NULL DEFAULT now(),
  message_count     integer     NOT NULL DEFAULT 0,
  total_tokens_in    integer    NOT NULL DEFAULT 0,
  total_tokens_out   integer    NOT NULL DEFAULT 0,
  total_tool_calls   integer    NOT NULL DEFAULT 0,
  total_rag_hits     integer    NOT NULL DEFAULT 0,
  user_feedback      smallint,
  feedback_comment   text,
  CONSTRAINT chat_session_user_feedback_check CHECK (user_feedback = ANY (ARRAY[1, -1]))
);

CREATE INDEX IF NOT EXISTS idx_chat_session_org_started
  ON public.chat_session (organization_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_session_org_user_last
  ON public.chat_session (organization_id, user_id, last_message_at DESC);

-- ---------------------------------------------------------------------------
-- chat_message
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_message (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid        NOT NULL REFERENCES public.chat_session(id) ON DELETE CASCADE,
  organization_id     uuid        NOT NULL,
  user_id             uuid        NOT NULL,
  role                text        NOT NULL,
  content             text,
  tool_calls          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  current_path        text,
  user_role_codes     text[]      NOT NULL DEFAULT '{}',
  retrieved_sources   text[]      NOT NULL DEFAULT '{}',
  tokens_in           integer,
  tokens_out          integer,
  latency_ms          integer,
  user_feedback       smallint,
  feedback_comment    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_message_role_check CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text])),
  CONSTRAINT chat_message_user_feedback_check CHECK (user_feedback = ANY (ARRAY[1, -1]))
);

CREATE INDEX IF NOT EXISTS idx_chat_message_session
  ON public.chat_message (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_message_org_created
  ON public.chat_message (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_message_feedback
  ON public.chat_message (organization_id, user_feedback)
  WHERE user_feedback IS NOT NULL;
