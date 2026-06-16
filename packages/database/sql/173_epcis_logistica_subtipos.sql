-- =====================================================================
-- 173_epcis_logistica_subtipos.sql
-- EPCIS de logística — Nivel 3 (guía GS1 El Salvador).
--
-- Amplía los subtipos de evento EPCIS para cubrir los procesos logísticos
-- que el estándar exige rastrear (recepción, cuarentena, almacenamiento,
-- fraccionamiento), además de los ya soportados de farmacia/bedside.
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- =====================================================================

ALTER TABLE ece.gs1_epcis_event DROP CONSTRAINT IF EXISTS gs1_epcis_event_subtipo_check;
ALTER TABLE ece.gs1_epcis_event
  ADD CONSTRAINT gs1_epcis_event_subtipo_check
  CHECK (subtipo IN (
    -- Procesos D/E ya existentes (farmacia + bedside)
    'BEDSIDE_ADMIN', 'PHARMACY_DISPENSE', 'RESERVATION', 'SUBSTITUTION', 'RETURN',
    -- Procesos logísticos A/B/C (Nivel 3 GS1 El Salvador)
    'RECEPTION', 'QUARANTINE', 'STORAGE', 'FRACTIONATION'
  ));

COMMENT ON COLUMN ece.gs1_epcis_event.subtipo IS
  'Subtipo operacional. Farmacia/bedside: BEDSIDE_ADMIN|PHARMACY_DISPENSE|RESERVATION|'
  'SUBSTITUTION|RETURN. Logística: RECEPTION|QUARANTINE|STORAGE|FRACTIONATION.';
