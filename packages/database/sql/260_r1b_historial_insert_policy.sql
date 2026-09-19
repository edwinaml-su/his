-- =============================================================================
-- 260_r1b_historial_insert_policy.sql — R1.2: policy de INSERT faltante en
-- ece.documento_instancia_historial (prerrequisito del demote de bridge-admision)
--
-- NO APLICAR — la aplica @Orq (guarda local `guard-sql-reapply` + convención
-- del proyecto: los SQL numerados los aplica el orquestador vía MCP contra
-- prod, @Dev solo los escribe/versiona).
--
-- Contexto (revisión independiente de fix/r1b-ece-mixtos-rls, P1-1):
--   `bridge-admision.router.ts` (Paso 9, admitirDesdeOrden) fue migrado en
--   R1.2 para que TODA la transacción de admisión corra dentro de
--   `withWorkflowContext` (demota a rol `authenticated`). El INSERT del
--   Paso 9 en `ece.documento_instancia_historial` quedó así, sin cambios en
--   BD, bajo ese rol demotado — pero la ÚNICA policy que existe hoy en prod
--   sobre esa tabla es `historial_read_by_instancia` (SELECT). RLS deniega
--   por default cualquier comando sin policy PERMISSIVE que lo cubra: el
--   INSERT revienta con 42501 (`new row violates row-level security policy`)
--   y aborta la transacción de admisión COMPLETA (episodio, hoja_ingreso,
--   asignación de cama — todo revierte).
--
--   Es una rotura DETERMINISTA, no condicional: pasará el 100% de las veces
--   que `admitirDesdeOrden` llegue al Paso 9 bajo el rol `authenticated`.
--   Hoy es LATENTE porque `ece.personal_salud` tiene 0 filas en prod (R03,
--   ver packages/trpc/src/lib/identity-resolver.ts) — el flujo nunca llega
--   tan lejos, aborta antes en el Paso 1 (PRECONDITION_FAILED). Los tests
--   unitarios tampoco lo detectan: mockean `workflow/context`, así que jamás
--   ejecutan una policy real. Se cierra ahora para que la rama R1A (que puebla
--   personal_salud) no destape esto en producción sin aviso.
--
-- Patrón calcado de `documento_instancia_tenant_insert` (INSERT sobre
-- ece.documento_instancia, ver sql/*) y de la policy de lectura ya existente
-- en esta misma tabla (`historial_read_by_instancia`): ambas resuelven el
-- establecimiento vía la cadena instancia → episodio_atencion, comparado
-- contra `ece.current_establecimiento_id_safe()` (GUC `app.ece_establecimiento_id`,
-- seteado por `ece.set_ece_context` dentro de `withWorkflowContext`/
-- `withEceContext`). No requiere `search_path` propio — no define funciones,
-- solo una policy sobre una tabla existente.
--
-- Idempotente: DROP POLICY IF EXISTS + CREATE POLICY.
-- =============================================================================

DROP POLICY IF EXISTS documento_instancia_historial_tenant_insert
  ON ece.documento_instancia_historial;

CREATE POLICY documento_instancia_historial_tenant_insert
  ON ece.documento_instancia_historial
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ece.documento_instancia di
      JOIN ece.episodio_atencion ea ON ea.id = di.episodio_id
      WHERE di.id = documento_instancia_historial.instancia_id
        AND ea.establecimiento_id = ece.current_establecimiento_id_safe()
    )
  );

-- Nota (misma limitación que la policy de SELECT ya existente,
-- `historial_read_by_instancia`, no introducida por este SQL): si
-- `di.episodio_id IS NULL` (instancias de tipos de documento que aún no
-- tienen episodio, p.ej. ORD_ING antes de la admisión) el JOIN a
-- episodio_atencion no matchea y el INSERT se deniega igual que el SELECT ya
-- se denegaba. No es un caso que ejercite bridge-admision (el historial del
-- Paso 9 referencia siempre la instancia HOJA_ING, creada con episodio_id
-- poblado) — se documenta para el próximo caller que toque esta tabla.
