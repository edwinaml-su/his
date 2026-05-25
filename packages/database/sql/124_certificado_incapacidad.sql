-- =============================================================================
-- 124_certificado_incapacidad.sql
--
-- Tabla satélite ece.certificado_incapacidad (CERT_INC).
-- Normativa: ISSS El Salvador — Reglamento de Evaluación de Incapacidades.
-- NTEC §22 — Informes ISSS.
--
-- El tipo_documento CERT_INC ya existe en ece.tipo_documento con
-- tabla_datos = 'certificado_incapacidad'. Esta migración crea la tabla física.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ece.certificado_incapacidad (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instancia_id             uuid NOT NULL REFERENCES ece.documento_instancia(id) ON DELETE CASCADE,
  paciente_id              uuid NOT NULL,
  episodio_id              uuid,                       -- opcional (ambulatorio aislado)
  establecimiento_id       uuid NOT NULL,
  medico_id                uuid NOT NULL,              -- ece.personal_salud.id
  tipo_incapacidad         text NOT NULL
    CHECK (tipo_incapacidad IN (
      'enfermedad_comun',
      'accidente_comun',
      'riesgo_profesional',
      'maternidad',
      'paternidad',
      'accidente_trabajo'
    )),
  fecha_inicio             date NOT NULL,
  fecha_fin                date NOT NULL,
  dias_otorgados           int GENERATED ALWAYS AS ((fecha_fin - fecha_inicio + 1)) STORED,
  diagnostico_cie10        text NOT NULL,
  diagnostico_descripcion  text NOT NULL,
  numero_afiliacion_isss   text,                       -- NUI del trabajador ISSS (9 dígitos)
  patrono_nit              text,                       -- NIT del empleador
  observaciones            text,
  estado_registro          text NOT NULL DEFAULT 'borrador'
    CHECK (estado_registro IN ('borrador', 'firmado', 'anulado')),
  motivo_anulacion         text,
  registrado_en            timestamptz NOT NULL DEFAULT now(),
  registrado_por           uuid NOT NULL,
  CONSTRAINT fecha_fin_gte_inicio CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX IF NOT EXISTS idx_cert_inc_paciente
  ON ece.certificado_incapacidad (paciente_id);

CREATE INDEX IF NOT EXISTS idx_cert_inc_medico
  ON ece.certificado_incapacidad (medico_id);

CREATE INDEX IF NOT EXISTS idx_cert_inc_estab_fecha
  ON ece.certificado_incapacidad (establecimiento_id, fecha_inicio DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cert_inc_instancia_unique
  ON ece.certificado_incapacidad (instancia_id);

-- RLS: sólo el establecimiento activo puede ver/escribir sus certificados.
ALTER TABLE ece.certificado_incapacidad ENABLE ROW LEVEL SECURITY;

CREATE POLICY cert_inc_authenticated_all ON ece.certificado_incapacidad
  FOR ALL TO authenticated
  USING (establecimiento_id = ece.current_establecimiento_id())
  WITH CHECK (establecimiento_id = ece.current_establecimiento_id());
