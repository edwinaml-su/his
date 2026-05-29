-- =============================================================================
-- 148_operating_room_default_qx_trigger.sql
--
-- Wave 4 Nivel B (PR #325) — cierre de loop preventivo.
--
-- Después de añadir OperatingRoom.serviceUnitId (sql/61), garantizamos que
-- todo nuevo INSERT en OperatingRoom queda asociado al ServiceUnit code='QX'
-- de su organización SIN requerir que el caller lo asigne manualmente.
--
-- Esto evita la necesidad de backfill manual cuando empiezan a crearse
-- quirófanos en UAT/capacitación/producción.
--
-- Comportamiento:
--   - Si NEW."serviceUnitId" viene NOT NULL: respeta el valor del caller.
--   - Si viene NULL: busca QX activo en la org del establecimiento y lo asigna.
--   - Si la org no tiene QX activo: queda NULL (no rompe — col nullable).
--
-- Aplicado a Supabase prod 2026-05-29 vía MCP apply_migration.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_operating_room_default_qx()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  qx_id uuid;
  org_id uuid;
BEGIN
  -- Si ya viene con serviceUnitId, respetar el valor del caller.
  IF NEW."serviceUnitId" IS NOT NULL THEN RETURN NEW; END IF;

  -- Resolver organizationId desde el establecimiento.
  SELECT e."organizationId" INTO org_id
    FROM "Establishment" e
    WHERE e.id = NEW."establishmentId";

  IF org_id IS NULL THEN RETURN NEW; END IF;

  -- Buscar ServiceUnit code='QX' activo en esta org.
  SELECT id INTO qx_id
    FROM "ServiceUnit"
    WHERE code = 'QX' AND "organizationId" = org_id AND active = true
    LIMIT 1;

  NEW."serviceUnitId" := qx_id;  -- NULL si no hay QX (no rompe — col nullable)
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.fn_operating_room_default_qx()
  IS 'Defensa preventiva: autocompleta OperatingRoom.serviceUnitId con el ServiceUnit code=QX de la org al INSERT cuando viene NULL. Si no hay QX activo en la org, queda NULL.';

DROP TRIGGER IF EXISTS trg_operating_room_default_qx ON "OperatingRoom";
CREATE TRIGGER trg_operating_room_default_qx
  BEFORE INSERT ON "OperatingRoom"
  FOR EACH ROW EXECUTE FUNCTION public.fn_operating_room_default_qx();

COMMENT ON TRIGGER trg_operating_room_default_qx ON "OperatingRoom"
  IS 'BEFORE INSERT — autocompleta serviceUnitId=QX si NULL. Cierra Wave 4 Nivel B (PR #325/#350).';
