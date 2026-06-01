-- =============================================================================
-- 163_rate_limit_hit.sql
-- Rate limit compartido (Postgres) — reemplaza el guard in-memory de PR #430.
--
-- Problema (deuda Beta.22): el rate limit vivía en un Map por proceso
-- (packages/trpc/src/middleware/rate-limit.ts). En Vercel serverless
-- multi-pod cada instancia tiene su propio contador → un atacante
-- distribuido evade el límite global. Bloqueante para pentest externo.
--
-- Solución: tabla compartida con ventana deslizante por `bucketKey`.
-- El helper cuenta hits en la ventana, rechaza si >= max, si no inserta.
--
-- Sensibilidad: NO contiene PHI. Solo claves de cubeta tipo
-- 'auth:request-login:ip=<ip>' o 'mfa:verify:user=<uuid>' + timestamp.
-- RLS habilitada sin policies (deny-all a anon/authenticated); la app
-- accede vía el rol con BYPASSRLS fuera de withTenantContext.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public."RateLimitHit" (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "bucketKey"  text        NOT NULL,
  "occurredAt" timestamptz NOT NULL DEFAULT now()
);

-- Índice para el COUNT por ventana + el findFirst del oldest (retryAfter).
CREATE INDEX IF NOT EXISTS "RateLimitHit_bucketKey_occurredAt_idx"
  ON public."RateLimitHit" ("bucketKey", "occurredAt" DESC);

-- RLS on, sin policies → deny-all para anon/authenticated. El acceso de la
-- app va por el rol base (BYPASSRLS) ya que rateLimitOrThrow corre FUERA de
-- withTenantContext (no es data tenant-scoped, es seguridad de plataforma).
ALTER TABLE public."RateLimitHit" ENABLE ROW LEVEL SECURITY;

-- Cleanup: borra hits > 7 días (la ventana máxima usada es 1h; 7d es buffer
-- de auditoría operativa). search_path fijo (lección BD-P0-4 / advisor).
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_hits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  DELETE FROM public."RateLimitHit" WHERE "occurredAt" < now() - interval '7 days';
END;
$$;

-- Verificación.
DO $$
BEGIN
  ASSERT (SELECT to_regclass('public."RateLimitHit"') IS NOT NULL),
    'ERROR: RateLimitHit no se creó';
  RAISE NOTICE 'OK: RateLimitHit + índice + cleanup creados';
END $$;
