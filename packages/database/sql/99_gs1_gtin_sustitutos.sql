-- HI-13: tabla de sustitutos GTIN para procedimiento linkSubstitute
-- Referenciada por packages/trpc/src/routers/gs1-medication.router.ts:linkSubstitute
-- Catálogo compartido (no tenant-scoped): un GTIN es global por definición GS1.

CREATE TABLE IF NOT EXISTS ece.gs1_gtin_sustitutos (
  gtin_a_id      uuid NOT NULL REFERENCES ece.gs1_gtin(id) ON DELETE CASCADE,
  gtin_b_id      uuid NOT NULL REFERENCES ece.gs1_gtin(id) ON DELETE CASCADE,
  autorizada     boolean NOT NULL DEFAULT false,
  motivo         text,
  registrado_por uuid NOT NULL,
  registrado_en  timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_gtin_sustitutos PRIMARY KEY (gtin_a_id, gtin_b_id),
  CONSTRAINT chk_gtin_sustitutos_distinct CHECK (gtin_a_id <> gtin_b_id)
);

-- Permite buscar sustitutos en ambas direcciones (A→B y B→A)
CREATE INDEX IF NOT EXISTS idx_gs1_sustitutos_b ON ece.gs1_gtin_sustitutos (gtin_b_id);

-- RLS: catálogo global; lectura abierta a authenticated, escritura restringida a autorizada=true
ALTER TABLE ece.gs1_gtin_sustitutos ENABLE ROW LEVEL SECURITY;

CREATE POLICY gs1_sustitutos_select ON ece.gs1_gtin_sustitutos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY gs1_sustitutos_insert ON ece.gs1_gtin_sustitutos
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY gs1_sustitutos_update ON ece.gs1_gtin_sustitutos
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON ece.gs1_gtin_sustitutos TO authenticated;
