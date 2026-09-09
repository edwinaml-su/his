-- =============================================================================
-- 221_ece_fks_establecimiento_faltantes.sql — Follow-up ADR 0022 §Riesgos.
--
-- Tres tablas ece.* tenían establecimiento_id SIN constraint FK formal (su
-- alineación al espacio B se infería solo de la policy RLS): nada impedía un
-- INSERT con un UUID inexistente en ece.establecimiento. Verificado 2026-09-09:
-- las tres tablas están en 0 filas → FKs directas, sin migración de datos.
--
-- Idempotente.
-- =============================================================================

DO $$ BEGIN
  ALTER TABLE ece.certificado_incapacidad
    ADD CONSTRAINT certificado_incapacidad_establecimiento_fkey
      FOREIGN KEY (establecimiento_id) REFERENCES ece.establecimiento(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ece.documento_asociado
    ADD CONSTRAINT documento_asociado_establecimiento_fkey
      FOREIGN KEY (establecimiento_id) REFERENCES ece.establecimiento(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ece.gs1_gln
    ADD CONSTRAINT gs1_gln_establecimiento_fkey
      FOREIGN KEY (establecimiento_id) REFERENCES ece.establecimiento(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------
-- 2. Hook de alta (ADR 0022 §Riesgos, "gap operacional real"): no existía
--    NINGÚN mecanismo que cree la fila puente ece.establecimiento al crear
--    un public."Establishment" — un hospital nuevo dejaba TODO el módulo ECE
--    inoperante (resolveEceEstablecimientoId → null). No hay camino de alta
--    en tRPC (se crean por SQL/seed), así que el hook vive como trigger BD:
--    cubre cualquier vía. Crea también la ece.institucion de la organización
--    si aún no existe (FK NOT NULL de establecimiento).
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ece.fn_establishment_bridge_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ece, public, pg_catalog
AS $function$
DECLARE
  v_institucion uuid;
BEGIN
  SELECT id INTO v_institucion
  FROM ece.institucion WHERE organization_id = NEW."organizationId" LIMIT 1;

  IF v_institucion IS NULL THEN
    INSERT INTO ece.institucion (id, codigo, nombre, tipo, organization_id)
    VALUES (gen_random_uuid(), 'INST-' || left(NEW."organizationId"::text, 8),
            'Institución ' || NEW.name, 'privado', NEW."organizationId")
    RETURNING id INTO v_institucion;
  END IF;

  INSERT INTO ece.establecimiento (id, institucion_id, codigo, nombre, nivel_atencion, establishment_id)
  SELECT gen_random_uuid(), v_institucion, 'EST-' || left(NEW.id::text, 8),
         NEW.name, 'hospitalario', NEW.id
  WHERE NOT EXISTS (
    SELECT 1 FROM ece.establecimiento e WHERE e.establishment_id = NEW.id);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_establishment_ece_bridge ON public."Establishment";
CREATE TRIGGER trg_establishment_ece_bridge
  AFTER INSERT ON public."Establishment"
  FOR EACH ROW EXECUTE FUNCTION ece.fn_establishment_bridge_after_insert();

-- Backfill: Establishments existentes sin fila puente (hoy 0 esperados en
-- prod — el único tiene puente desde ADR 0022 — pero idempotente por si acaso).
INSERT INTO ece.establecimiento (id, institucion_id, codigo, nombre, nivel_atencion, establishment_id)
SELECT gen_random_uuid(), i.id, 'EST-' || left(est.id::text, 8), est.name, 'hospitalario', est.id
FROM public."Establishment" est
JOIN ece.institucion i ON i.organization_id = est."organizationId"
WHERE NOT EXISTS (SELECT 1 FROM ece.establecimiento e WHERE e.establishment_id = est.id);
