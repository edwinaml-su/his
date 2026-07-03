-- =============================================================================
-- CC-0009 — Módulo de Calculadoras y Fórmulas Clínicas
-- Schema: ece
-- Aplicar vía Supabase SQL Editor / MCP mcp__supabase__apply_migration
-- =============================================================================

-- ──────────────────────────────────────────────────────────────────
-- 1. Enums idempotentes
-- ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE ece."CalcTipo" AS ENUM ('formula', 'score', 'dosis');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ece."CalcEstado" AS ENUM ('borrador', 'publicada', 'retirada');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ece."CalcResultadoCasoPrueba" AS ENUM ('pasa', 'falla');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────────
-- 2. calculadora — catálogo global
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ece.calculadora (
  id               UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo           VARCHAR(30)          NOT NULL,
  nombre           VARCHAR(200)         NOT NULL,
  tipo             ece."CalcTipo"       NOT NULL,
  categoria        VARCHAR(80)          NOT NULL,
  "alto_riesgo"    BOOLEAN              NOT NULL DEFAULT false,
  sub              VARCHAR(200)         NULL,
  ref              TEXT                 NULL,
  estado           ece."CalcEstado"     NOT NULL DEFAULT 'borrador',
  paises           JSONB                NOT NULL DEFAULT '{}',
  paginas          JSONB                NOT NULL DEFAULT '"*"',
  "version_actual_id" UUID              NULL,
  "created_at"     TIMESTAMPTZ          NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ          NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_calculadora_codigo
  ON ece.calculadora (codigo);

CREATE INDEX IF NOT EXISTS idx_calculadora_estado
  ON ece.calculadora (estado);

-- ──────────────────────────────────────────────────────────────────
-- 3. calculadora_version — versión inmutable
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ece.calculadora_version (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "calculadora_id" UUID        NOT NULL REFERENCES ece.calculadora (id),
  version          INTEGER     NOT NULL,
  definicion       JSONB       NOT NULL,
  "publicada_en"   TIMESTAMPTZ NULL,
  "publicada_por"  UUID        NULL,
  inmutable        BOOLEAN     NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_calculadora_version_calc_ver
  ON ece.calculadora_version ("calculadora_id", version);

CREATE INDEX IF NOT EXISTS idx_calculadora_version_calc
  ON ece.calculadora_version ("calculadora_id");

-- FK diferida: calculadora.version_actual_id → calculadora_version.id
-- Se agrega después de crear ambas tablas para evitar dependencia circular.
DO $$ BEGIN
  ALTER TABLE ece.calculadora
    ADD CONSTRAINT fk_calc_version_actual
    FOREIGN KEY ("version_actual_id") REFERENCES ece.calculadora_version (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────────
-- 4. calculadora_caso_prueba — gate de publicación
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ece.calculadora_caso_prueba (
  id          UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
  "version_id" UUID                         NOT NULL REFERENCES ece.calculadora_version (id),
  entradas    JSONB                          NOT NULL,
  esperado    NUMERIC(18, 6)                NOT NULL,
  tolerancia  NUMERIC(18, 6)                NOT NULL,
  resultado   ece."CalcResultadoCasoPrueba" NULL
);

CREATE INDEX IF NOT EXISTS idx_calc_caso_prueba_version
  ON ece.calculadora_caso_prueba ("version_id");

-- ──────────────────────────────────────────────────────────────────
-- 5. calculadora_pantalla — catálogo de pantallas (semilla 10 filas)
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ece.calculadora_pantalla (
  id       VARCHAR(60) PRIMARY KEY,
  etiqueta VARCHAR(100) NOT NULL,
  orden    INTEGER      NOT NULL,
  activo   BOOLEAN      NOT NULL DEFAULT true
);

INSERT INTO ece.calculadora_pantalla (id, etiqueta, orden) VALUES
  ('evolucion',          'Evolución médica',         1),
  ('historia_clinica',   'Historia clínica',          2),
  ('signos_vitales',     'Signos vitales',            3),
  ('indicaciones',       'Indicaciones médicas',      4),
  ('enfermeria',         'Registro de enfermería',    5),
  ('emergencia',         'Atención de emergencia',    6),
  ('triage',             'Triaje',                    7),
  ('prescripcion',       'Prescripción',              8),
  ('laboratorio',        'Órdenes de laboratorio',    9),
  ('hoja_ingreso',       'Hoja de ingreso',          10)
ON CONFLICT (id) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────
-- 6. registro_calculo — tenant-scoped, auditable
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ece.registro_calculo (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "calculadora_id" UUID        NOT NULL,
  "version_id"     UUID        NOT NULL,
  "paciente_id"    UUID        NOT NULL,
  entradas         JSONB       NOT NULL,
  resultado        NUMERIC(18, 6) NOT NULL,
  interpretacion   TEXT        NULL,
  pantalla         VARCHAR(60) NULL,
  "usuario_id"     UUID        NOT NULL,
  "organization_id" UUID       NOT NULL,
  "creado_en"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registro_calculo_org
  ON ece.registro_calculo ("organization_id");

CREATE INDEX IF NOT EXISTS idx_registro_calculo_paciente
  ON ece.registro_calculo ("paciente_id");

CREATE INDEX IF NOT EXISTS idx_registro_calculo_calc
  ON ece.registro_calculo ("calculadora_id");

-- ──────────────────────────────────────────────────────────────────
-- 7. RLS — habilitar en todas las tablas
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE ece.calculadora            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.calculadora_version    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.calculadora_caso_prueba ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.calculadora_pantalla   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.registro_calculo       ENABLE ROW LEVEL SECURITY;

-- Catálogo global: lectura libre para authenticated
DO $$ BEGIN
  CREATE POLICY calc_select ON ece.calculadora
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY calc_write ON ece.calculadora
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY calc_ver_select ON ece.calculadora_version
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY calc_ver_write ON ece.calculadora_version
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY calc_cp_select ON ece.calculadora_caso_prueba
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY calc_cp_write ON ece.calculadora_caso_prueba
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY calc_pantalla_select ON ece.calculadora_pantalla
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY calc_pantalla_write ON ece.calculadora_pantalla
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- registro_calculo: tenant-scoped por organizationId
DO $$ BEGIN
  CREATE POLICY rc_tenant_select ON ece.registro_calculo
    FOR SELECT TO authenticated
    USING ("organization_id" = COALESCE(current_setting('app.current_org_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY rc_tenant_insert ON ece.registro_calculo
    FOR INSERT TO authenticated
    WITH CHECK ("organization_id" = COALESCE(current_setting('app.current_org_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────────
-- 8. GRANTs
-- ──────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ece.calculadora              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ece.calculadora_version      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ece.calculadora_caso_prueba  TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON ece.calculadora_pantalla     TO authenticated;
GRANT SELECT, INSERT                 ON ece.registro_calculo         TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 9. Trigger de auditoría hash-chain en registro_calculo
--    (patrón 02_audit_triggers.sql — audit.fn_audit_row ya existe)
-- ──────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit_registro_calculo ON ece.registro_calculo;
CREATE TRIGGER trg_audit_registro_calculo
  AFTER INSERT OR UPDATE OR DELETE ON ece.registro_calculo
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();
