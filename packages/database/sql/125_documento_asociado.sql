-- =============================================================================
-- 125_documento_asociado.sql
-- DOC_ASOC — Documentos Clínicos Asociados (NTEC §15, §38)
-- Tabla payload para ece.tipo_documento.codigo = 'DOC_ASOC'.
-- Archivos almacenados en Supabase Storage (bucket privado).
-- Retención: 10 años (TDR §6.3, inmutabilidad post-firma).
-- =============================================================================

CREATE TABLE IF NOT EXISTS ece.documento_asociado (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Relación workflow (1:1 con la instancia, única por definición de DOC_ASOC)
  instancia_id        uuid NOT NULL UNIQUE REFERENCES ece.documento_instancia(id) ON DELETE CASCADE,
  paciente_id         uuid NOT NULL,
  episodio_id         uuid,            -- null si documento maestro de nivel paciente
  establecimiento_id  uuid NOT NULL,

  -- Clasificación
  categoria           text NOT NULL CHECK (categoria IN (
    'imagen_diagnostica',
    'laboratorio_externo',
    'referencia_externa',
    'consentimiento_externo',
    'otro'
  )),
  titulo              text NOT NULL CHECK (length(titulo) BETWEEN 3 AND 255),
  descripcion         text,
  fecha_documento     date NOT NULL DEFAULT CURRENT_DATE,

  -- Storage (el archivo va al bucket; la tabla guarda solo metadata)
  storage_bucket      text NOT NULL DEFAULT 'ece-documentos-asociados',
  storage_path        text NOT NULL,        -- ruta relativa dentro del bucket (NO URL firmada)
  mime_type           text NOT NULL,
  tamano_bytes        bigint NOT NULL,
  hash_sha256         text NOT NULL CHECK (length(hash_sha256) = 64), -- SHA-256 hex

  -- Trazabilidad
  adjuntado_por       uuid NOT NULL,        -- his_user_id del que adjuntó
  adjuntado_en        timestamptz NOT NULL DEFAULT now(),
  estado_registro     text NOT NULL DEFAULT 'borrador' CHECK (estado_registro IN ('borrador','firmado','anulado')),
  firmado_por         uuid,
  firmado_en          timestamptz,
  motivo_anulacion    text,

  CONSTRAINT tamano_max CHECK (tamano_bytes BETWEEN 1 AND 52428800) -- máx 50 MB
);

-- Índices de consulta frecuente
CREATE INDEX IF NOT EXISTS idx_doc_asoc_paciente
  ON ece.documento_asociado (paciente_id);

CREATE INDEX IF NOT EXISTS idx_doc_asoc_episodio
  ON ece.documento_asociado (episodio_id)
  WHERE episodio_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doc_asoc_estab_fecha
  ON ece.documento_asociado (establecimiento_id, adjuntado_en DESC);

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE ece.documento_asociado ENABLE ROW LEVEL SECURITY;

-- Solo el establecimiento activo del contexto ECE puede ver/escribir sus documentos
CREATE POLICY doc_asoc_authenticated_all ON ece.documento_asociado
  FOR ALL TO authenticated
  USING (establecimiento_id = ece.current_establecimiento_id())
  WITH CHECK (establecimiento_id = ece.current_establecimiento_id());

-- =============================================================================
-- Trigger de inmutabilidad post-firma
-- Impide modificar contenido/titulo/hash/storage_path una vez firmado.
-- Permite actualizar estado_registro a 'anulado' (proceso administrativo).
-- =============================================================================
CREATE OR REPLACE FUNCTION ece.fn_doc_asoc_inmutabilidad()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado_registro = 'firmado' AND TG_OP = 'UPDATE' THEN
    IF NEW.storage_path   != OLD.storage_path   OR
       NEW.hash_sha256    != OLD.hash_sha256    OR
       NEW.titulo         != OLD.titulo         OR
       NEW.storage_bucket != OLD.storage_bucket OR
       NEW.mime_type      != OLD.mime_type      THEN
      RAISE EXCEPTION
        'documento_asociado id=% está firmado: no se puede modificar contenido, título ni hash.',
        OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_doc_asoc_inmutable
  BEFORE UPDATE ON ece.documento_asociado
  FOR EACH ROW EXECUTE FUNCTION ece.fn_doc_asoc_inmutabilidad();
