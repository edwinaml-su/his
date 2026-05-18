-- ============================================================================
-- 72b_sala_expulsion_eventos.sql
--
-- Agrega columna `eventos` JSONB a ece.sala_expulsion para registrar
-- el cronograma de eventos del período expulsivo y alumbramiento.
--
-- Cada elemento del array sigue el schema ExpulsionEvento:
-- {
--   id:        UUID  (generado en router),
--   tipo:      inicio_pujos | posicion_madre_cambio | amniotomia | episiotomia
--              | desgarro | nacimiento | alumbramiento | sangrado_anormal,
--   timestamp: ISO-8601,
--   nota:      string opcional,
--   datos:     objeto libre con metadatos específicos del tipo
-- }
--
-- La validación del intervalo alumbramiento-nacimiento (<30 min) y la
-- emisión del evento `ece.expulsion.hemorragia_post_parto_alerta` se realizan
-- en el router tRPC (lógica de dominio, no en triggers para mantener
-- el stack de rollback explícito).
--
-- Idempotente: ALTER ... ADD COLUMN IF NOT EXISTS.
-- ============================================================================

ALTER TABLE ece.sala_expulsion
    ADD COLUMN IF NOT EXISTS eventos JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN ece.sala_expulsion.eventos IS
    'Cronograma de eventos del período expulsivo (NTEC Doc 14). '
    'Array de ExpulsionEvento ordenado por timestamp. '
    'Validación HPP: alumbramiento debe registrarse <30 min post-nacimiento.';
