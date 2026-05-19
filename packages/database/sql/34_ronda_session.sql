-- =============================================================================
-- F2-S14 Stream A — Modo Rondas Bedside
-- US.F2.6.46 (flujo optimizado 8-15 pacientes/turno)
-- US.F2.6.50 (ruta optimizada por hora / por ubicación)
-- US.F2.6.51 (pausa y reanudación de sesión de ronda)
-- =============================================================================

-- Tabla de sesiones de ronda (schema ece, tenant por organization_id)
CREATE TABLE IF NOT EXISTS ece.ronda_session (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL,
  organization_id         UUID        NOT NULL,
  -- POR_HORA | POR_UBICACION
  modo                    VARCHAR(20) NOT NULL DEFAULT 'POR_HORA',
  iniciado_en             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pausado_en              TIMESTAMPTZ,
  reanudado_en            TIMESTAMPTZ,
  completado_en           TIMESTAMPTZ,
  total_pacientes         INTEGER     NOT NULL DEFAULT 0,
  -- Array de IndicacionRonda pendientes (serializado como JSONB)
  indicaciones_pending    JSONB       NOT NULL DEFAULT '[]',
  -- Array de IndicacionRonda completadas en esta sesión
  indicaciones_completadas JSONB      NOT NULL DEFAULT '[]',

  CONSTRAINT ck_ronda_modo
    CHECK (modo IN ('POR_HORA', 'POR_UBICACION')),
  CONSTRAINT ck_ronda_total_positivo
    CHECK (total_pacientes >= 0)
);

-- Índices para consulta de sesión activa por usuario
CREATE INDEX IF NOT EXISTS idx_ronda_session_user_activa
  ON ece.ronda_session (user_id, organization_id, completado_en)
  WHERE completado_en IS NULL;

CREATE INDEX IF NOT EXISTS idx_ronda_session_org_inicio
  ON ece.ronda_session (organization_id, iniciado_en DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE ece.ronda_session ENABLE ROW LEVEL SECURITY;

-- Lectura: sólo puede ver sus propias sesiones (o sesiones de su org con rol supervisor)
CREATE POLICY ronda_session_select ON ece.ronda_session
  FOR SELECT
  USING (
    organization_id::TEXT = current_setting('app.current_org_id', TRUE)
    AND (
      user_id::TEXT = current_setting('app.current_user_id', TRUE)
      OR current_setting('app.is_break_glass', TRUE) = 'true'
    )
  );

-- Escritura: sólo la misma org, usuario autenticado
CREATE POLICY ronda_session_insert ON ece.ronda_session
  FOR INSERT
  WITH CHECK (
    organization_id::TEXT = current_setting('app.current_org_id', TRUE)
    AND user_id::TEXT     = current_setting('app.current_user_id', TRUE)
  );

CREATE POLICY ronda_session_update ON ece.ronda_session
  FOR UPDATE
  USING (
    organization_id::TEXT = current_setting('app.current_org_id', TRUE)
    AND user_id::TEXT     = current_setting('app.current_user_id', TRUE)
  );

-- Sin DELETE — las sesiones son inmutables (completado_en marca el fin)
