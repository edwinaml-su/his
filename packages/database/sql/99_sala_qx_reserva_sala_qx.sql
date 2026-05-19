-- =============================================================================
-- Migración HE-01: ece.sala_qx + ece.reserva_sala_qx
-- Rama: fix/s4-sala-qx-reserva
--
-- Columnas alineadas al contrato exacto de:
--   packages/trpc/src/routers/ece/bridge-cirugia.router.ts
--
-- También extiende ece.orden_ingreso con columnas que el router asume
-- pero que no existen aún (motivo_ingreso_tipo, procedimiento_cie10,
-- episodio_id, reserva_sala_qx_id).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Catálogo de salas quirúrgicas por establecimiento
-- ---------------------------------------------------------------------------
CREATE TABLE ece.sala_qx (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  establecimiento_id uuid        NOT NULL
    REFERENCES ece.establecimiento(id) ON DELETE RESTRICT,
  codigo             text        NOT NULL,
  nombre             text        NOT NULL,
  tipo               text        NOT NULL
    CHECK (tipo IN ('mayor', 'menor', 'ambulatoria')),
  activa             boolean     NOT NULL DEFAULT true,
  registrado_en      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (establecimiento_id, codigo)
);

COMMENT ON TABLE ece.sala_qx IS
  'Catálogo de salas quirúrgicas por establecimiento. Usada por ece.reserva_sala_qx.';

-- RLS: sala visible solo si pertenece al establecimiento del usuario en sesión
ALTER TABLE ece.sala_qx ENABLE ROW LEVEL SECURITY;

CREATE POLICY sala_qx_by_estab ON ece.sala_qx
  FOR ALL
  USING (establecimiento_id = ece.current_establecimiento_id_safe());

GRANT SELECT, INSERT, UPDATE ON ece.sala_qx TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reservas de sala quirúrgica
--    Columnas derivadas del INSERT/SELECT/UPDATE en bridge-cirugia.router.ts
-- ---------------------------------------------------------------------------
CREATE TABLE ece.reserva_sala_qx (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FK lógica a ece.orden_ingreso (sin FK estructural hasta que exista la columna)
  orden_qx_id           uuid        NOT NULL,
  episodio_id           uuid        NOT NULL
    REFERENCES ece.episodio_atencion(id) ON DELETE CASCADE,
  sala_qx_id            uuid        NOT NULL
    REFERENCES ece.sala_qx(id) ON DELETE RESTRICT,
  cirujano_id           uuid        NOT NULL,   -- ece.personal_salud.id
  anestesiologo_id      uuid,                   -- nullable: cirugías sin anestesiología
  fecha_inicio          timestamptz NOT NULL,
  fecha_fin             timestamptz NOT NULL,
  duracion_estimada_min integer     NOT NULL CHECK (duracion_estimada_min BETWEEN 1 AND 1440),
  procedimiento_cie10   text        NOT NULL,
  estado                text        NOT NULL DEFAULT 'programado'
    CHECK (estado IN ('programado', 'confirmado', 'en_curso', 'cancelado')),
  reservado_por         uuid        NOT NULL,   -- ece.personal_salud.id
  reservado_en          timestamptz NOT NULL DEFAULT now(),
  motivo_cancelacion    text,
  cancelado_en          timestamptz,
  cancelado_por         uuid,
  CONSTRAINT chk_fecha_coherente CHECK (fecha_fin > fecha_inicio)
);

COMMENT ON TABLE ece.reserva_sala_qx IS
  'Reserva de sala quirúrgica para una cirugía programada. '
  'Una sala no puede tener dos reservas activas con overlap de horario (validado en router).';

-- Índice principal: detección de conflictos de horario (detectarConflictoSala)
CREATE INDEX idx_reserva_sala_qx_overlap
  ON ece.reserva_sala_qx (sala_qx_id, fecha_inicio, fecha_fin)
  WHERE estado IN ('programado', 'confirmado', 'en_curso');

-- Índice para listProgramacionDia (filtro por fecha)
CREATE INDEX idx_reserva_sala_qx_fecha_inicio
  ON ece.reserva_sala_qx (fecha_inicio)
  WHERE estado <> 'cancelado';

-- Índice para lookups por episodio
CREATE INDEX idx_reserva_sala_qx_episodio
  ON ece.reserva_sala_qx (episodio_id);

-- RLS: reserva visible si la sala pertenece al establecimiento del usuario
ALTER TABLE ece.reserva_sala_qx ENABLE ROW LEVEL SECURITY;

CREATE POLICY reserva_sala_by_estab ON ece.reserva_sala_qx
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ece.sala_qx s
      WHERE s.id = reserva_sala_qx.sala_qx_id
        AND s.establecimiento_id = ece.current_establecimiento_id_safe()
    )
  );

GRANT SELECT, INSERT, UPDATE ON ece.reserva_sala_qx TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Extender ece.orden_ingreso con columnas que bridge-cirugia.router.ts asume
--    (Columnas ausentes confirmadas via information_schema)
-- ---------------------------------------------------------------------------

-- motivo_ingreso_tipo: discrimina cirugía de otras órdenes de ingreso
ALTER TABLE ece.orden_ingreso
  ADD COLUMN IF NOT EXISTS motivo_ingreso_tipo text
    CHECK (motivo_ingreso_tipo IN ('cirugia', 'emergencia', 'hospitalizacion', 'obs', 'otro'));

-- procedimiento_cie10: código del procedimiento quirúrgico principal
ALTER TABLE ece.orden_ingreso
  ADD COLUMN IF NOT EXISTS procedimiento_cie10 text;

-- establecimiento_id: necesario para filtros y RLS
ALTER TABLE ece.orden_ingreso
  ADD COLUMN IF NOT EXISTS establecimiento_id uuid
    REFERENCES ece.establecimiento(id) ON DELETE RESTRICT;

-- episodio_id: vínculo al episodio_atencion creado en la misma tx
ALTER TABLE ece.orden_ingreso
  ADD COLUMN IF NOT EXISTS episodio_id uuid
    REFERENCES ece.episodio_atencion(id) ON DELETE SET NULL;

-- reserva_sala_qx_id: vínculo a la reserva quirúrgica (nullable)
ALTER TABLE ece.orden_ingreso
  ADD COLUMN IF NOT EXISTS reserva_sala_qx_id uuid
    REFERENCES ece.reserva_sala_qx(id) ON DELETE SET NULL;

-- Índice para findOrdenQx (lookup por id + motivo_ingreso_tipo = 'cirugia')
CREATE INDEX IF NOT EXISTS idx_orden_ingreso_cirugia
  ON ece.orden_ingreso (id)
  WHERE motivo_ingreso_tipo = 'cirugia';
