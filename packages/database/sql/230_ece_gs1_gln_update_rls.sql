-- =====================================================================
-- 230_ece_gs1_gln_update_rls.sql
-- Habilita UPDATE en ece.gs1_gln para `authenticated` — falta desde
-- 200_ece_gs1_gln_rls.sql, que dejó la tabla sin policy de UPDATE/DELETE
-- a propósito porque en ese momento el router no exponía edición ni
-- desactivación de GLN ("Sin policy de UPDATE/DELETE: el router no expone
-- edición ni borrado de GLN hoy").
--
-- Contexto: el mantenimiento completo de ubicaciones GS1 (editar
-- descripcion/tipo, desactivar/reactivar nodos) se agrega ahora en
-- gs1-gln-hierarchy.router.ts (`update`, `setActivo`) — ambas corren bajo
-- `withEceContext` (mismo patrón que `createChild`, demoteRole por default
-- true → RLS aplica).
--
-- Scope: igual al de INSERT (200) — un establecimiento solo edita sus
-- propios nodos (establecimiento_id = ece.current_establecimiento_id_safe()).
-- La raíz corporativa (establecimiento_id IS NULL, "entidad") y los nodos de
-- OTRO establecimiento NO son editables vía este router — la policy los
-- filtra silenciosamente (0 filas afectadas); el router detecta el caso via
-- `RETURNING` vacío y devuelve NOT_FOUND. Alta/edición de la raíz corporativa
-- queda reservada a flujos administrativos con `demoteRole: false`.
--
-- DELETE sigue sin policy — el router no expone borrado de GLN (solo
-- desactivación lógica vía `activo`).
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- APLICADO a prod 2026-09-10 vía MCP — NO re-aplicar.
-- =====================================================================

DROP POLICY IF EXISTS gs1_gln_update ON ece.gs1_gln;
CREATE POLICY gs1_gln_update ON ece.gs1_gln
  FOR UPDATE
  TO authenticated
  USING (establecimiento_id = ece.current_establecimiento_id_safe())
  WITH CHECK (establecimiento_id = ece.current_establecimiento_id_safe());

GRANT UPDATE ON ece.gs1_gln TO authenticated;
