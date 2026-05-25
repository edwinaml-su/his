-- =============================================================================
-- 130_performance_sample_and_nps.sql
-- Wave 7 — APM cliente (PerformanceSample) + Encuestas NPS (NpsResponse)
-- Habilita: tec_response_time + gob_satisfaccion del dashboard ejecutivo.
-- Aplicado a prod 2026-05-25 via MCP (performance_sample_and_nps_response_2026_05_25).
-- =============================================================================

CREATE TABLE IF NOT EXISTS "PerformanceSample" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid REFERENCES "Organization"(id) ON DELETE SET NULL,
  route           varchar(200) NOT NULL,
  kind            varchar(40) NOT NULL,
  duration_ms     numeric(10,2) NOT NULL,
  "userId"        uuid,
  "occurredAt"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT perf_sample_duration_chk CHECK (duration_ms >= 0 AND duration_ms < 300000)
);
CREATE INDEX IF NOT EXISTS idx_perf_sample_occurred ON "PerformanceSample" ("occurredAt" DESC);
CREATE INDEX IF NOT EXISTS idx_perf_sample_route    ON "PerformanceSample" (route, "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS idx_perf_sample_org      ON "PerformanceSample" ("organizationId") WHERE "organizationId" IS NOT NULL;

ALTER TABLE "PerformanceSample" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS perf_sample_insert ON "PerformanceSample";
CREATE POLICY perf_sample_insert ON "PerformanceSample" FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS perf_sample_select ON "PerformanceSample";
CREATE POLICY perf_sample_select ON "PerformanceSample"
  FOR SELECT TO authenticated
  USING ("organizationId" IS NULL
         OR "organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid);

CREATE TABLE IF NOT EXISTS "NpsResponse" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"         uuid REFERENCES "User"(id) ON DELETE SET NULL,
  "organizationId" uuid REFERENCES "Organization"(id) ON DELETE SET NULL,
  score            int NOT NULL,
  comment          text,
  "submittedAt"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nps_score_range_chk CHECK (score BETWEEN 0 AND 10)
);
CREATE INDEX IF NOT EXISTS idx_nps_submitted ON "NpsResponse" ("submittedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_nps_org       ON "NpsResponse" ("organizationId") WHERE "organizationId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nps_user      ON "NpsResponse" ("userId")         WHERE "userId" IS NOT NULL;

ALTER TABLE "NpsResponse" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nps_response_insert ON "NpsResponse";
CREATE POLICY nps_response_insert ON "NpsResponse" FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS nps_response_select ON "NpsResponse";
CREATE POLICY nps_response_select ON "NpsResponse"
  FOR SELECT TO authenticated
  USING ("organizationId" IS NULL
         OR "organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid);
