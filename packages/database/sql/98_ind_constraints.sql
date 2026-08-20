-- Migration: 98_ind_constraints.sql
-- Sprint S2 — Hallazgo IND-005 (P2): CHECK constraints en ece.indicaciones_medicas
-- y ece.administracion_medicamento para forzar valores controlados.
--
-- La BD está vacía en estas tablas al momento de aplicar (verificado 2026-05-19).
-- Si hubiera datos, ejecutar primero:
--   SELECT DISTINCT vigencia FROM ece.indicaciones_medicas;
--   SELECT DISTINCT estado_registro FROM ece.indicaciones_medicas;
--   SELECT DISTINCT estado FROM ece.administracion_medicamento;
-- para confirmar que no haya valores fuera del enum antes de agregar los CHECKs.

BEGIN;

-- ─── ece.indicaciones_medicas.vigencia ───────────────────────────────────────

ALTER TABLE ece.indicaciones_medicas
  ADD CONSTRAINT chk_ind_vigencia
  CHECK (vigencia IN ('ACTIVA', 'SUSPENDIDA', 'CANCELADA'));

-- ─── ece.indicaciones_medicas.estado_registro ────────────────────────────────

ALTER TABLE ece.indicaciones_medicas
  ADD CONSTRAINT chk_ind_estado_registro
  CHECK (estado_registro IN ('borrador', 'firmado', 'validado'));

-- ─── ece.administracion_medicamento.estado ───────────────────────────────────

-- SEGUIMIENTO (2026-08-20): este CHECK tenía el vocabulario correcto (es el
-- que usan los routers de escritura) pero convivía con
-- administracion_medicamento_estado_check ({administrado,omitido,diferido}) del
-- DDL original — dos CHECK que ningún valor satisface a la vez. 165 resolvió la
-- contradicción dropeando ESTE en vez del otro; 202 lo repone bajo el nombre
-- chk_admin_med_estado_v2 (con DIFERIDA añadido) y dropea el del DDL original.
-- Ver 202_ece_indicacion_vocabulario_estados.sql.
ALTER TABLE ece.administracion_medicamento
  ADD CONSTRAINT chk_admin_med_estado
  CHECK (estado IN ('PROGRAMADA', 'ADMINISTRADO', 'OMITIDA', 'RECHAZADA'));

-- ─── Comentarios de seguimiento ──────────────────────────────────────────────
-- IND-004 (P2 — FOLLOW-UP): CHECK condicional motivo_omision NOT NULL
-- cuando estado IN ('OMITIDA','RECHAZADA'). Se aplicará en migración separada
-- post-Go-Live tras validar que el trigger de inmutabilidad (IND-003) esté activo.
--
-- IND-003 (P1 — FOLLOW-UP): trigger fn_emar_immutable análogo al de
-- public.MedicationAdministration para ece.administracion_medicamento.
-- Garantiza inmutabilidad post-ADMINISTRADO a nivel BD.

COMMIT;
