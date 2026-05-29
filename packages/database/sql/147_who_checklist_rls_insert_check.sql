-- =============================================================================
-- 147_who_checklist_rls_insert_check.sql
-- HE-18 (audit Stream E 2026-05-19): policy RLS INSERT en ece.who_checklist
-- carece de WITH CHECK — permite insertar filas de cualquier acto_quirurgico_id
-- sin verificar que el acto pertenezca al establecimiento del usuario.
--
-- La policy USING existe (lectura filtrada), pero el INSERT no tiene WITH CHECK,
-- lo que significa que RLS no restringe qué filas se pueden insertar.
--
-- APLICAR: manualmente via Supabase SQL Editor o mcp__supabase__execute_sql.
-- =============================================================================

-- Verificar el nombre exacto de la policy existente antes de reemplazar.
-- Si la policy tiene un nombre diferente, ajustar el DROP accordingly.
DO $$
BEGIN
  -- Recrea la policy INSERT agregando WITH CHECK.
  -- Si no existe, la crea de nuevo.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'ece'
      AND tablename = 'who_checklist'
      AND cmd = 'INSERT'
  ) THEN
    -- Eliminar la policy existente sin WITH CHECK.
    EXECUTE (
      SELECT 'DROP POLICY ' || quote_ident(policyname) || ' ON ece.who_checklist'
      FROM pg_policies
      WHERE schemaname = 'ece'
        AND tablename = 'who_checklist'
        AND cmd = 'INSERT'
      LIMIT 1
    );
  END IF;
END
$$;

-- FK chain real (verificada via information_schema):
--   who_checklist.acto_quirurgico_id → acto_quirurgico.id
--   acto_quirurgico.episodio_id      → ece.episodio_atencion.id (directo, no via episodio_hospitalario)
--   episodio_atencion.establecimiento_id → public.Establishment.id
-- Recrear la policy INSERT con WITH CHECK que verifica que el acto_quirurgico
-- pertenezca al establecimiento del usuario autenticado.
CREATE POLICY who_checklist_insert
  ON ece.who_checklist
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM ece.acto_quirurgico aq
        JOIN ece.episodio_atencion ea ON ea.id = aq.episodio_id
       WHERE aq.id = who_checklist.acto_quirurgico_id
         AND ea.establecimiento_id = (current_setting('app.current_estab_id', true))::uuid
    )
  );

COMMENT ON POLICY who_checklist_insert ON ece.who_checklist
  IS 'HE-18 (audit 2026-05-19): WITH CHECK verifica que acto_quirurgico pertenezca al establecimiento del usuario (via episodio_atencion).';
