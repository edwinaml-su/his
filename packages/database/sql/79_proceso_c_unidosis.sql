-- =====================================================================
-- 79_proceso_c_unidosis.sql
-- Proceso C — Preparación unidosis farmacia (re-empaque por paciente).
--
-- Tabla: ece.preparacion_unidosis
-- Secuencia: ece.unidosis_seq  → codigo_unidosis 'UD-NNNN'
-- RLS Cat-E: acceso por establecimiento vía JOIN ece.paciente.
--
-- Dependencias:
--   56_ece_01_catalogos.sql  — schema ece
--   58_ece_03_paciente.sql   — ece.paciente + public."Establishment"
--   62_ece_07_rls.sql        — variables GUC ece_establecimiento_id
--   (ece.gs1_gtin, ece.indicaciones_medicas, ece.personal_salud)
--
-- Idempotente: IF NOT EXISTS en todos los objetos.
-- =====================================================================

-- ─── Secuencia ───────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS ece.unidosis_seq
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE
  CACHE 1;

-- ─── Tabla principal ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ece.preparacion_unidosis (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificación única operativa (impresa en etiqueta QR)
  codigo_unidosis      text        NOT NULL UNIQUE
                                   DEFAULT 'UD-' || nextval('ece.unidosis_seq'),
  etiqueta_qr_generada text        UNIQUE,

  -- Trazabilidad clínica
  paciente_id          uuid        NOT NULL
                                   REFERENCES ece.paciente(id)
                                   ON DELETE RESTRICT ON UPDATE CASCADE,
  indicacion_id        uuid        NOT NULL
                                   REFERENCES ece.indicaciones_medicas(id)
                                   ON DELETE RESTRICT ON UPDATE CASCADE,

  -- Trazabilidad GS1
  -- FK a ece.gs1_gtin(id) — la PK es uuid, el campo 'codigo' (GTIN-14) es descriptivo
  gtin_origen          uuid        NOT NULL
                                   REFERENCES ece.gs1_gtin(id)
                                   ON DELETE RESTRICT ON UPDATE CASCADE,
  lote_origen          text        NOT NULL,

  -- Cantidad re-empacada (unidades de dosis)
  cantidad_preparada   smallint    NOT NULL CHECK (cantidad_preparada > 0),

  -- Ventana temporal de la unidosis (máx 72 h)
  fecha_preparacion    timestamptz NOT NULL DEFAULT now(),
  expiry_unidosis      timestamptz NOT NULL,

  CONSTRAINT chk_expiry_range CHECK (
    expiry_unidosis > fecha_preparacion
    AND expiry_unidosis < fecha_preparacion + INTERVAL '72 hours'
  ),

  -- Personal que preparó (firmante responsable)
  preparado_por        uuid        NOT NULL
                                   REFERENCES ece.personal_salud(id)
                                   ON DELETE RESTRICT ON UPDATE CASCADE,

  -- Auditoría
  creado_en            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ece.preparacion_unidosis IS
  'Proceso C GS1: re-empaque de medicamentos en dosis unitarias por paciente. '
  'Cada fila = un lote de unidosis preparado en farmacia. '
  'codigo_unidosis se imprime en etiqueta QR para verificación al dispensar.';

-- ─── Índices ─────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_unidosis_paciente
  ON ece.preparacion_unidosis (paciente_id);

CREATE INDEX IF NOT EXISTS idx_unidosis_indicacion
  ON ece.preparacion_unidosis (indicacion_id);

CREATE INDEX IF NOT EXISTS idx_unidosis_gtin
  ON ece.preparacion_unidosis (gtin_origen);

CREATE INDEX IF NOT EXISTS idx_unidosis_fecha
  ON ece.preparacion_unidosis (fecha_preparacion DESC);

-- ─── RLS Cat-E ────────────────────────────────────────────────────────
-- Acceso restringido al establecimiento activo de la sesión,
-- determinado vía JOIN ece.paciente.establecimiento_id.

ALTER TABLE ece.preparacion_unidosis ENABLE ROW LEVEL SECURITY;

-- Lectura: personal del mismo establecimiento que el paciente
CREATE POLICY unidosis_select ON ece.preparacion_unidosis
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM ece.paciente p
      WHERE p.id = paciente_id
        AND p.establecimiento_id = (
          current_setting('app.ece_establecimiento_id', true)::uuid
        )
    )
  );

-- Inserción: mismo establecimiento
CREATE POLICY unidosis_insert ON ece.preparacion_unidosis
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ece.paciente p
      WHERE p.id = paciente_id
        AND p.establecimiento_id = (
          current_setting('app.ece_establecimiento_id', true)::uuid
        )
    )
  );

-- No se permite UPDATE ni DELETE (registro inmutable post-preparación)
-- Si se requiere corrección, crear nueva entrada y anotar motivo en bitácora.
