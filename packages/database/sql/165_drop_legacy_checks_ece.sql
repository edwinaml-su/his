-- =====================================================================
-- 165_drop_legacy_checks_ece.sql
-- Elimina 4 CHECK legacy contradictorios que hacian INESCRIBIBLES
-- historia_clinica, indicaciones_medicas y administracion_medicamento.
--
-- Cada columna tenia DOS CHECK que ningun valor satisface a la vez (Postgres
-- exige todos): el de workflow correcto vs un legacy de drift (vigente/
-- rectificado, o mayusculas PROGRAMADA/ADMINISTRADO). Los routers + tests usan
-- el vocabulario de workflow; se elimina el legacy.
--
-- Aplicado en prod 2026-06-11 via MCP (B1, docs/uat/e2e-2026-06-10/bloqueantes_remediacion.md).
-- Idempotente.
-- =====================================================================

ALTER TABLE ece.historia_clinica
    DROP CONSTRAINT IF EXISTS historia_clinica_estado_registro_check;       -- legacy {vigente,rectificado}

ALTER TABLE ece.indicaciones_medicas
    DROP CONSTRAINT IF EXISTS indicaciones_medicas_vigencia_check;          -- legacy {activa,suspendida,modificada}

ALTER TABLE ece.indicaciones_medicas
    DROP CONSTRAINT IF EXISTS indicaciones_medicas_estado_registro_check;   -- legacy {vigente,rectificado}

ALTER TABLE ece.administracion_medicamento
    DROP CONSTRAINT IF EXISTS chk_admin_med_estado;                         -- legacy {PROGRAMADA,ADMINISTRADO,OMITIDA,RECHAZADA}

-- Permanecen (correctos): chk_hc_estado_registro, chk_ind_estado_registro,
-- chk_ind_vigencia, administracion_medicamento_estado_check.
