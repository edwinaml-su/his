-- =============================================================================
-- 183_cc0007_catalogo_cpt_plantilla.sql
-- CC-0007 — Tablas nuevas del schema ECE para catálogo CPT y plantillas texto.
--
-- Tablas creadas (schema ece):
--   ece.catalogo_cpt       — catálogo CPT global (sin tenant). Sembrado aquí.
--   ece.plantilla_texto    — plantillas narrativas tenant-scoped (RLS).
--
-- Dependencia: 182_cc0007_hc_schema.sql (mismo deployment batch).
-- Precondición: ece schema existe (55_ece_00_extensions.sql).
--
-- RLS ece.plantilla_texto:
--   - ENABLE ROW LEVEL SECURITY.
--   - SELECT/ALL restringido a organization_id = current_org_id().
--   - Rol authenticated puede leer y modificar sus propias plantillas.
--   - Rol service_role (BYPASSRLS) puede hacer mantenimiento admin.
--
-- ece.catalogo_cpt es global (no tenant); SELECT para authenticated, sin RLS.
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- =============================================================================

-- ── 1. ece.catalogo_cpt ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ece.catalogo_cpt (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      text         NOT NULL,
  descripcion text         NOT NULL,
  activo      boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT catalogo_cpt_codigo_key UNIQUE (codigo)
);

COMMENT ON TABLE  ece.catalogo_cpt IS
  'CC-0007 RF-09 — catálogo CPT global (sin tenant). '
  'Acceso SELECT para rol authenticated; escritura solo service_role.';
COMMENT ON COLUMN ece.catalogo_cpt.codigo      IS 'Código CPT (p. ej. 99213).';
COMMENT ON COLUMN ece.catalogo_cpt.descripcion IS 'Descripción del procedimiento CPT.';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'ece' AND tablename = 'catalogo_cpt'
      AND indexname = 'idx_catalogo_cpt_activo'
  ) THEN
    CREATE INDEX idx_catalogo_cpt_activo ON ece.catalogo_cpt (activo);
  END IF;
END $$;

-- Grant SELECT a authenticated (catálogo global de solo lectura)
GRANT SELECT ON ece.catalogo_cpt TO authenticated;

-- ── 1a. Seed catálogo CPT (12 procedimientos del mockup historia-clinica-avante.html L1489) ──
-- Idempotente: ON CONFLICT DO NOTHING.
INSERT INTO ece.catalogo_cpt (codigo, descripcion) VALUES
  ('99213', 'Consulta de evaluación y manejo, paciente establecido (nivel 3)'),
  ('93000', 'Electrocardiograma de rutina, ≥12 derivaciones con interpretación'),
  ('71046', 'Radiografía de tórax, 2 vistas'),
  ('80053', 'Panel metabólico completo'),
  ('85025', 'Hemograma completo con diferencial automatizado'),
  ('76700', 'Ecografía abdominal completa'),
  ('12001', 'Reparación simple de heridas superficiales'),
  ('36415', 'Punción venosa para extracción de sangre'),
  ('90471', 'Administración de inmunización (1 vacuna)'),
  ('29075', 'Aplicación de yeso, antebrazo a mano'),
  ('45378', 'Colonoscopía diagnóstica'),
  ('31500', 'Intubación endotraqueal de emergencia')
ON CONFLICT (codigo) DO NOTHING;

-- ── 2. ece.plantilla_texto ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ece.plantilla_texto (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  -- valores permitidos: ENFERMEDAD_ACTUAL | EXAMEN_FISICO (extensible sin DDL)
  campo           text        NOT NULL
                    CHECK (campo IN ('ENFERMEDAD_ACTUAL', 'EXAMEN_FISICO')),
  titulo          text        NOT NULL,
  contenido       text        NOT NULL,
  activo          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  ece.plantilla_texto IS
  'CC-0007 RF-04/RF-07 — plantillas de texto narrativo por organización. '
  'campo: ENFERMEDAD_ACTUAL | EXAMEN_FISICO. Tenant-scoped con RLS.';
COMMENT ON COLUMN ece.plantilla_texto.organization_id IS
  'Tenant owner. RLS enforced: solo la organización propietaria puede leer/modificar.';
COMMENT ON COLUMN ece.plantilla_texto.campo IS
  'Campo narrativo al que aplica la plantilla: ENFERMEDAD_ACTUAL o EXAMEN_FISICO.';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'ece' AND tablename = 'plantilla_texto'
      AND indexname = 'idx_plantilla_texto_org_campo'
  ) THEN
    CREATE INDEX idx_plantilla_texto_org_campo
      ON ece.plantilla_texto (organization_id, campo);
  END IF;
END $$;

-- ── 2a. RLS para ece.plantilla_texto ─────────────────────────────────────────

ALTER TABLE ece.plantilla_texto ENABLE ROW LEVEL SECURITY;

-- SELECT: solo la organización propietaria (o break_glass)
DROP POLICY IF EXISTS plantilla_texto_select ON ece.plantilla_texto;
CREATE POLICY plantilla_texto_select ON ece.plantilla_texto
  FOR SELECT
  USING (
    organization_id = public.current_org_id()
    OR public.is_break_glass()
  );

-- INSERT/UPDATE/DELETE: solo la organización propietaria
DROP POLICY IF EXISTS plantilla_texto_modify ON ece.plantilla_texto;
CREATE POLICY plantilla_texto_modify ON ece.plantilla_texto
  FOR ALL
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

-- Grants para rol authenticated (demotado por withTenantContext)
GRANT SELECT, INSERT, UPDATE, DELETE ON ece.plantilla_texto TO authenticated;

-- ── 3. updated_at ────────────────────────────────────────────────────────────
-- Sin trigger DB: ambas tablas se escriben vía Prisma, que gestiona `updatedAt`
-- con @updatedAt. NO reutilizar ece.fn_set_updated_at(): esa función ya existe
-- (57_ece_02_seguridad.sql) y setea NEW.actualizado_en (columna en español de
-- ece.personal_salud); un CREATE OR REPLACE con NEW.updated_at rompería ese trigger.
