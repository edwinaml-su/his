-- =============================================================================
-- 215_preparacion_unidosis_update_policy.sql
--
-- Hallazgo de la remediación Code Castle (2026-08-22, bloqueante nº3):
-- ece.preparacion_unidosis tenía RLS habilitado con policies de SELECT
-- (unidosis_select) e INSERT (unidosis_insert) pero NINGUNA de UPDATE.
-- Efecto: el `UPDATE ... SET etiqueta_qr_generada = true` del flujo de
-- unidosis (Proceso C GS1) afectaba 0 filas EN SILENCIO bajo demote —
-- sin error, sin fila actualizada.
--
-- El GRANT de UPDATE a `authenticated` ya existía (verificado con
-- has_table_privilege el 2026-09-07); solo faltaba la policy. Se crea con
-- el MISMO predicado que unidosis_select/unidosis_insert: tenant-scoping
-- transitivo vía ece.paciente + GUC ECE (app.ece_establecimiento_id).
--
-- APLICADO a prod el 2026-09-07 (migración preparacion_unidosis_update_policy_215
-- vía MCP). Idempotente.
-- =============================================================================

DROP POLICY IF EXISTS unidosis_update ON ece.preparacion_unidosis;
CREATE POLICY unidosis_update ON ece.preparacion_unidosis
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM ece.paciente p
    WHERE p.id = preparacion_unidosis.paciente_id
      AND p.establecimiento_id = (current_setting('app.ece_establecimiento_id', true))::uuid))
  WITH CHECK (EXISTS (
    SELECT 1 FROM ece.paciente p
    WHERE p.id = preparacion_unidosis.paciente_id
      AND p.establecimiento_id = (current_setting('app.ece_establecimiento_id', true))::uuid));
