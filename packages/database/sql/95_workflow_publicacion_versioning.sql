-- =============================================================================
-- F2-S16-B: Publicación de workflows + versionado + audit
-- US.F2.2.05-07, 18-20
-- Aplicar vía Supabase SQL Editor / MCP mcp__supabase__apply_migration
-- =============================================================================

-- ──────────────────────────────────────────────────────────────────
-- 1. Enum estado de publicación
-- ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE ece.workflow_pub_estado AS ENUM ('BORRADOR', 'PUBLICADO', 'HISTORICO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────────
-- 2. workflow_publicacion_audit — snapshot inmutable por versión
--    Art. 42 NTEC: inmutabilidad; hash chain para verificación
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ece.workflow_publicacion_audit (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_doc_id       UUID        NOT NULL,
  version           INTEGER     NOT NULL,
  estado            ece.workflow_pub_estado NOT NULL DEFAULT 'BORRADOR',
  publicado_por_id  UUID        NULL,
  publicado_en      TIMESTAMPTZ NULL,
  snapshot_jsonb    JSONB       NOT NULL DEFAULT '{}',
  motivo_cambio     TEXT        NULL,
  restored_from_id  UUID        NULL REFERENCES ece.workflow_publicacion_audit(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  prev_hash         TEXT        NULL,
  chain_hash        TEXT        NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_pub_tipo_version
  ON ece.workflow_publicacion_audit(tipo_doc_id, version);

CREATE INDEX IF NOT EXISTS idx_workflow_pub_tipo_doc
  ON ece.workflow_publicacion_audit(tipo_doc_id);

CREATE INDEX IF NOT EXISTS idx_workflow_pub_estado
  ON ece.workflow_publicacion_audit(estado);

-- ──────────────────────────────────────────────────────────────────
-- 3. workflow_role_orphan — roles huérfanos detectados nightly
--    US.F2.2.18
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ece.workflow_role_orphan (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_doc_id   UUID        NOT NULL,
  rol_codigo    TEXT        NOT NULL,
  detectado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelto_en   TIMESTAMPTZ NULL,
  resuelto      BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_workflow_role_orphan_tipo
  ON ece.workflow_role_orphan(tipo_doc_id);

CREATE INDEX IF NOT EXISTS idx_workflow_role_orphan_resuelto
  ON ece.workflow_role_orphan(resuelto);

-- ──────────────────────────────────────────────────────────────────
-- 4. workflow_draft — borrador activo por tipo_documento
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ece.workflow_draft (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_doc_id     UUID        NOT NULL UNIQUE,
  draft_jsonb     JSONB       NOT NULL DEFAULT '{}',
  updated_by_id   UUID        NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────────
-- 5. Función: siguiente número de versión
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ece.next_workflow_version(p_tipo_doc_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(MAX(version), 0) + 1
    FROM ece.workflow_publicacion_audit
   WHERE tipo_doc_id = p_tipo_doc_id;
$$;

-- ──────────────────────────────────────────────────────────────────
-- 6. RLS
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE ece.workflow_publicacion_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.workflow_role_orphan       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.workflow_draft             ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY wf_pub_audit_read ON ece.workflow_publicacion_audit
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY wf_role_orphan_read ON ece.workflow_role_orphan
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY wf_draft_read ON ece.workflow_draft
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
