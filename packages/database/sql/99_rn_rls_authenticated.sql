-- HF-23: RLS de ece.reanimacion_neonatal debe restringir a authenticated, no public.
-- Las policies rn_read, rn_write, rn_update estaban definidas con roles={public}
-- lo que permite acceso a conexiones no autenticadas. Violación HIPAA/LOPD directa.
-- Se replica USING/WITH_CHECK exactos capturados de pg_policies antes del cambio.

DROP POLICY IF EXISTS rn_read ON ece.reanimacion_neonatal;
DROP POLICY IF EXISTS rn_write ON ece.reanimacion_neonatal;
DROP POLICY IF EXISTS rn_update ON ece.reanimacion_neonatal;

-- Antes: roles = {public}
-- Después: roles = {authenticated}

CREATE POLICY rn_read ON ece.reanimacion_neonatal
  FOR SELECT TO authenticated
  USING (current_setting('app.current_org_id'::text, true) IS NOT NULL);

CREATE POLICY rn_write ON ece.reanimacion_neonatal
  FOR INSERT TO authenticated
  WITH CHECK (current_setting('app.current_org_id'::text, true) IS NOT NULL);

CREATE POLICY rn_update ON ece.reanimacion_neonatal
  FOR UPDATE TO authenticated
  USING (
    (current_setting('app.current_org_id'::text, true) IS NOT NULL)
    AND (cerrado_en IS NULL)
  );
