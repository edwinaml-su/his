-- =============================================================================
-- 150a_chat_knowledge_chunk_ddl.sql
-- DDL base de public.chat_knowledge_chunk
--
-- ORIGEN: igual que 150_chat_tables_ddl.sql (chat_session/chat_message),
-- este archivo NO fue escrito de cero. `chat_knowledge_chunk` lleva meses
-- activa en producción (`ejacvsgbewcerxtjtwto`) — es la base de conocimiento
-- RAG del chat asistente, poblada por
-- packages/database/scripts/ingest-chat-knowledge.mjs y leída por la función
-- `public.chat_knowledge_search()` (referenciada en
-- 162_search_path_trigger_functions.sql) — pero ningún archivo de este
-- corpus la crea, y no existe `model` Prisma equivalente. El archivo
-- `156_rls_chat_tables.sql` YA asume que esta tabla existe (RLS) y falla en
-- una reconstrucción desde cero por esta razón — hallazgo colateral
-- documentado en el propio 150_chat_tables_ddl.sql ("NOTA (hallazgo
-- colateral...): chat_knowledge_chunk ... tiene el MISMO problema ... y NO
-- se resuelve en este archivo porque no fue parte del encargo").
--
-- Este DDL fue RECUPERADO POR INTROSPECCIÓN de la BD de producción (lectura
-- vía information_schema.columns, pg_constraint, pg_indexes) el 2026-08-19,
-- NO escrito desde el diseño original.
--
-- ⚠️ GAP DE PORTABILIDAD ADICIONAL (no presente en chat_session/chat_message):
-- la columna `embedding` es `vector(1536)` — tipo de la extensión `pgvector`
-- (`vector`, instalada en prod en el schema `extensions`, versión 0.8.0).
-- pgvector NO es contrib estándar de Postgres — confirmado con
-- `pg_available_extensions` en el mismo Postgres 18.4 nativo usado para esta
-- prueba: 0 filas para `vector` (idéntico resultado al ya documentado para
-- `pg_cron`/`pg_net`/`supabase_vault` en
-- docs/runbooks/db-reconstruccion-fuera-de-supabase.md §3.1). Esto es una
-- CUARTA extensión no-contrib que el runbook original no había catalogado
-- (solo listaba pg_net, pg_cron, supabase_vault). Este archivo declara
-- `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;` para que,
-- en un Postgres SIN pgvector, el fallo sea el esperado y diagnosticable
-- (`0A000 la extensión "vector" no está disponible` — misma categoría A que
-- pg_cron) en vez de un `42704 tipo "vector" no existe` opaco. En un target
-- que sí tenga pgvector (Supabase, RDS con la extensión instalada, o
-- cualquier Postgres con el paquete `pgvector` compilado), este archivo
-- aplica limpio sin cambios.
--
-- Numerado 150a (antes que 152/155/156, que no dependen de él pero sí lo
-- necesitan aplicado primero para no fallar en la RLS de la tabla) — mismo
-- patrón de sufijo de letra que 62a/62b/89a/114a de esta misma pasada.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.chat_knowledge_chunk (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text        NOT NULL,
  title        text        NOT NULL,
  chunk_index  integer     NOT NULL,
  content      text        NOT NULL,
  embedding    extensions.vector(1536),
  metadata     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_knowledge_chunk_source_chunk_index_key UNIQUE (source, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chat_knowledge_source
  ON public.chat_knowledge_chunk (source);

CREATE INDEX IF NOT EXISTS idx_chat_knowledge_embedding_cos
  ON public.chat_knowledge_chunk USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists = '100');
