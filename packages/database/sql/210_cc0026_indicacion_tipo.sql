-- =============================================================================
-- 210_cc0026_indicacion_tipo.sql
-- CC-0026 — Indicación INICIAL/SUBSECUENTE + regla de 32h entre firmas.
--
-- El mockup (ESP-MOCKUP-0026, §Estructura) exige, TEXTO LITERAL: "el tipo de
-- indicación y el plazo máximo de 32 h entre indicaciones deben implementarse
-- y validarse en el servidor (guardar en BD el timestamp de la última
-- indicación firmada y rechazar la mutación que incumpla la regla o el tipo
-- que no corresponda)."
--
-- `ece.indicaciones_medicas` (sql/61, CHECK ajustado en sql/98) NO tiene:
--   - ninguna columna de tipo (INICIAL/SUBSECUENTE),
--   - ninguna columna de timestamp que capture EL MOMENTO DE LA FIRMA.
--     `fecha_hora` y `registrado_en` se escriben en `create()` (estado
--     'borrador') y jamás se tocan de nuevo en `firmar()` — usarlas como
--     proxy del "timestamp de la última indicación firmada" mediría mal la
--     regla de 32h para cualquier indicación que no se firme en el mismo
--     instante en que se crea (el caso normal). No hay `updated_at` genérico
--     en esta tabla (a diferencia de `ece.episodio_atencion.actualizado_en`)
--     que pudiera servir de proxy razonable — por eso este archivo agrega la
--     columna real en vez de reusar una existente con semántica distinta.
--
-- Verificado 2026-08-26 vía MCP: `ece.indicaciones_medicas` tiene 0 filas en
-- prod (el módulo nunca corrió end-to-end — ver REQ-CC-0026 §Hechos
-- verificados). No hace falta backfill de datos.
--
-- NO aplicado a prod por este archivo — pendiente de review de @Orq (mismo
-- criterio que sql/209, que este archivo acompaña).
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- =============================================================================

ALTER TABLE ece.indicaciones_medicas
  ADD COLUMN IF NOT EXISTS tipo_indicacion varchar(12),
  ADD COLUMN IF NOT EXISTS fecha_firma timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_ind_tipo_indicacion'
      AND conrelid = 'ece.indicaciones_medicas'::regclass
  ) THEN
    ALTER TABLE ece.indicaciones_medicas
      ADD CONSTRAINT chk_ind_tipo_indicacion
      CHECK (tipo_indicacion IN ('INICIAL', 'SUBSECUENTE'));
  END IF;
END $$;

COMMENT ON COLUMN ece.indicaciones_medicas.tipo_indicacion IS
  'CC-0026 — INICIAL (primera indicación firmada del episodio) | SUBSECUENTE '
  '(hay al menos una previa firmada/validada). NULL para indicaciones creadas '
  'antes de este cambio o cuando el caller de firmar() no envía tipoIndicacion '
  '(retrocompatible — ver packages/trpc/src/routers/ece/indicaciones-medicas.router.ts, '
  'input opcional, default no valida tipo).';

COMMENT ON COLUMN ece.indicaciones_medicas.fecha_firma IS
  'CC-0026 — timestamp de la transición borrador→firmado, seteado por '
  'firmar(). Base de la regla de 32h (ESP-MOCKUP-0026 §Estructura): MAX(fecha_firma) '
  'de las indicaciones firmado|validado de un episodio. NULL para '
  'indicaciones aún no firmadas.';

-- -----------------------------------------------------------------------------
-- Índice para el query de firmar() (MAX(fecha_firma) por episodio, filtrado
-- por estado_registro firmado|validado).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ind_episodio_firma
  ON ece.indicaciones_medicas (episodio_id, fecha_firma DESC)
  WHERE estado_registro IN ('firmado', 'validado');

-- -----------------------------------------------------------------------------
-- Verificación
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'ece' AND table_name = 'indicaciones_medicas'
      AND column_name IN ('tipo_indicacion', 'fecha_firma')
  ) = 2,
    'ERROR: faltan columnas tipo_indicacion/fecha_firma en ece.indicaciones_medicas';
  ASSERT (
    SELECT count(*) FROM pg_constraint
    WHERE conname = 'chk_ind_tipo_indicacion'
      AND conrelid = 'ece.indicaciones_medicas'::regclass
  ) = 1,
    'ERROR: falta chk_ind_tipo_indicacion';
  RAISE NOTICE 'OK: tipo_indicacion + fecha_firma + índice creados en ece.indicaciones_medicas';
END $$;
