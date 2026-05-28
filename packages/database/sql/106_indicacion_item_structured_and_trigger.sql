-- =============================================================================
-- Migration: 106_indicacion_item_structured_and_trigger.sql
--
-- IND-002 (audit Stream B — P1 ALTA): ece.indicacion_item campos dosis/via/
-- frecuencia son text libre — divergen de pharmacy.PrescriptionItem que usa
-- DECIMAL(12,4), AdminRoute enum y frequency VARCHAR con enum Zod.
-- Solución: columnas estructuradas que coexisten con los campos texto legacy.
--
-- IND-003 (audit Stream B — P1 ALTA): ece.administracion_medicamento.estado
-- sin enum constraint ni trigger de inmutabilidad. El file 98_ind_constraints.sql
-- ya agrega el CHECK de enum; este file agrega el trigger de inmutabilidad
-- análogo al de public.MedicationAdministration.
--
-- PENDIENTE DE APPLY MANUAL en Supabase SQL Editor / MCP apply_migration.
-- =============================================================================

-- ─── IND-002: columnas estructuradas en ece.indicacion_item ─────────────────

ALTER TABLE ece.indicacion_item
  ADD COLUMN IF NOT EXISTS dosis_valor    DECIMAL(10,3),
  ADD COLUMN IF NOT EXISTS dosis_unidad   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS via_enum       VARCHAR(40),
  ADD COLUMN IF NOT EXISTS frecuencia_horas INT;

-- CHECK opcional: via_enum debe coincidir con valores de AdminRoute si está presente.
-- Los valores se alinean con el enum AdminRoute de pharmacy (packages/contracts).
ALTER TABLE ece.indicacion_item
  DROP CONSTRAINT IF EXISTS chk_ind_via_enum;

ALTER TABLE ece.indicacion_item
  ADD CONSTRAINT chk_ind_via_enum
  CHECK (
    via_enum IS NULL OR via_enum IN (
      'ORAL','IV','IM','SC','SL','TOPICAL','INHALATION',
      'NASAL','OPHTHALMIC','OTIC','RECTAL','VAGINAL',
      'INTRADERMAL','INTRATHECAL','OTHER'
    )
  );

COMMENT ON COLUMN ece.indicacion_item.dosis_valor
  IS 'IND-002: dosis numérica estructurada (DECIMAL 10,3). Coexiste con campo text "dosis" para transición.';

COMMENT ON COLUMN ece.indicacion_item.dosis_unidad
  IS 'IND-002: unidad de la dosis ("mg","g","mL","UI",...). Max 20 chars.';

COMMENT ON COLUMN ece.indicacion_item.via_enum
  IS 'IND-002: vía de administración estructurada (valores AdminRoute de pharmacy). Coexiste con campo text "via".';

COMMENT ON COLUMN ece.indicacion_item.frecuencia_horas
  IS 'IND-002: frecuencia en horas (ej. 8 para c/8h). Coexiste con campo text "frecuencia".';

-- ─── IND-003: trigger de inmutabilidad en ece.administracion_medicamento ─────
-- Análogo al trigger fn_emar_immutable de public.MedicationAdministration.
-- Bloquea UPDATE cuando estado ya es ADMINISTRADO o RECHAZADA.

CREATE OR REPLACE FUNCTION ece.fn_admin_med_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.estado IN ('ADMINISTRADO', 'RECHAZADA') THEN
    RAISE EXCEPTION
      'administracion_medicamento inmutable: no se puede modificar un registro en estado % (IND-003)',
      OLD.estado
    USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'DELETE' AND OLD.estado IN ('ADMINISTRADO', 'RECHAZADA') THEN
    RAISE EXCEPTION
      'administracion_medicamento inmutable: no se puede eliminar un registro en estado % (IND-003)',
      OLD.estado
    USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ece.fn_admin_med_immutable()
  IS 'IND-003: bloquea modificación/eliminación de administraciones en estado ADMINISTRADO o RECHAZADA.';

DROP TRIGGER IF EXISTS trg_admin_med_immutable ON ece.administracion_medicamento;

CREATE TRIGGER trg_admin_med_immutable
  BEFORE UPDATE OR DELETE ON ece.administracion_medicamento
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_admin_med_immutable();
