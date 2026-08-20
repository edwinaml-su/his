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

-- ---------------------------------------------------------------------------
-- SEGUIMIENTO (2026-08-20) — el DROP de la linea 25 fue en la direccion
-- equivocada.
--
-- La premisa "los routers + tests usan el vocabulario de workflow" es cierta
-- para historia_clinica e indicaciones_medicas, pero NO para
-- administracion_medicamento: ahi el router de escritura
-- (indicaciones-medicas.router.ts) usa MAYUSCULAS, o sea justo el CHECK que
-- este archivo dropeo como "legacy". Al conservar
-- administracion_medicamento_estado_check ({administrado,omitido,diferido})
-- la columna dejo de estar bloqueada por contradiccion, pero quedo
-- inescribible para el router principal, y ademas dejo inertes el CHECK de
-- 146 y el trigger de 142 (ambos escritos contra los valores en MAYUSCULAS).
--
-- Corregido en 202_ece_indicacion_vocabulario_estados.sql, que fija el
-- vocabulario canonico en MAYUSCULAS para la columna. Este archivo se deja
-- intacto: ya se aplico a prod y sigue siendo correcto para las otras 3
-- columnas. En una reconstruccion desde cero el orden 98 → 146 → 165 → 202
-- converge al estado correcto.
-- ---------------------------------------------------------------------------
