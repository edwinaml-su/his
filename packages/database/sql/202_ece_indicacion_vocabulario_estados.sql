-- =============================================================================
-- 202_ece_indicacion_vocabulario_estados.sql
--
-- Cierra el drift CHECK-vs-Zod que dejaba INESCRIBIBLES dos columnas del
-- bounded context de indicaciones médicas (NTEC §3.6 / §3.7).
--
-- ─── Diagnóstico (sprint remediación críticos, 2026-08-20) ──────────────────
--
-- 1. ece.indicacion_item.tipo
--    CHECK en prod (indicacion_item_tipo_check, del DDL original
--    61_ece_06_documentos.sql): {medicamento,dieta,cuidado,estudio,reposo}.
--    Escritores/lectores en código: TODOS en MAYUSCULAS.
--      · indicaciones-medicas.router.ts create()/update() escribe
--        {MEDICAMENTO,PROCEDIMIENTO,DIETA,CUIDADO_GENERAL,ESTUDIO}
--        → viola el CHECK en CADA llamada real contra Postgres.
--      · bedside.router.ts:680 y bedside-ronda.router.ts:206 leen con
--        ii.tipo = 'MEDICAMENTO' → JOIN vacío silencioso (gtin NULL).
--      · mar-consumer.ts usa lower(ii.tipo) = 'medicamento' → tolerante.
--
-- 2. ece.administracion_medicamento.estado
--    CHECK en prod (administracion_medicamento_estado_check, del mismo DDL):
--    {administrado,omitido,diferido}.
--      · indicaciones-medicas.router.ts registrarAdministracion() escribe
--        {PROGRAMADA,ADMINISTRADO,OMITIDA,RECHAZADA} → viola el CHECK siempre.
--      · registro-enfermeria.router.ts escribía minúsculas (único camino que
--        funcionaba); se migra a MAYUSCULAS en el mismo PR que este archivo.
--
--    165_drop_legacy_checks_ece.sql resolvió esta columna al revés: dropeó
--    chk_admin_med_estado (98_ind_constraints.sql, MAYUSCULAS) tratándolo de
--    legacy bajo la premisa "los routers usan el vocabulario de workflow".
--    Esa premisa era cierta para historia_clinica e indicaciones_medicas, pero
--    NO para administracion_medicamento: ahí el vocabulario de los routers de
--    escritura es el de MAYUSCULAS. Este archivo revierte esa decisión puntual.
--
-- ─── Decisión de vocabulario ────────────────────────────────────────────────
--
-- Gana el vocabulario MAYUSCULAS del router/contracts, y la BD se alinea:
--   · Es el que usa la mayoría de los caminos de código (routers de escritura,
--     JOINs de bedside/GS1, @his/contracts, y el Select de la UI en
--     apps/web/src/app/(clinical)/ece/indicaciones/nueva/page.tsx).
--   · Es semánticamente más rico: PROCEDIMIENTO y CUIDADO_GENERAL (tipo) y
--     PROGRAMADA y RECHAZADA (estado) no tienen equivalente en minúsculas.
--     PROGRAMADA es imprescindible para un eMAR: la dosis pendiente existe
--     como fila antes de administrarse.
--   · Es consistente con ece.indicaciones_medicas.vigencia, que ya es
--     {ACTIVA,SUSPENDIDA,CANCELADA} (chk_ind_vigencia, 98_ind_constraints.sql).
--
-- Los sets finales son la UNION de ambos vocabularios: se conservan 'reposo'
-- (→ REPOSO) y 'diferido' (→ DIFERIDA) para no perder categorías clínicas que
-- el DDL original sí soportaba.
--
-- ─── Seguridad del cambio ───────────────────────────────────────────────────
--
-- Las 4 tablas del dominio están VACIAS en prod (verificado 2026-08-20 vía MCP:
--   ece.indicacion_item = 0, ece.administracion_medicamento = 0,
--   ece.indicaciones_medicas = 0, ece.registro_enfermeria = 0).
-- No hay datos que migrar: nunca se logró escribir una indicación. El bloque
-- de guarda de abajo aborta si eso dejara de ser cierto.
--
-- ─── Efectos colaterales deseados (constraints hoy inertes que se activan) ──
--
--   · chk_motivo_omision_requerido (146_indicacion_motivo_omision_check.sql)
--     exige motivo_omision para estado IN ('OMITIDA','RECHAZADA','omitida',
--     'rechazada'). Ninguno de esos valores era escribible → el CHECK nunca
--     disparó. Tras este archivo, OMITIDA y RECHAZADA sí lo son y el CHECK
--     pasa a proteger de verdad. El router registro-enfermeria gana el
--     superRefine equivalente en el mismo PR para devolver BAD_REQUEST en vez
--     de un error crudo de Postgres.
--   · trg_admin_med_immutable → ece.fn_admin_med_immutable()
--     (142_indicacion_item_structured_and_trigger.sql) bloquea UPDATE/DELETE
--     cuando OLD.estado IN ('ADMINISTRADO','RECHAZADA'). Mismo caso: valores
--     no escribibles → trigger instalado pero inerte. Tras este archivo queda
--     efectivo. Verificado que ningún camino de código hace UPDATE ni DELETE
--     sobre ece.administracion_medicamento (solo INSERT), así que no rompe
--     nada existente; cierra IND-003 de verdad.
--
-- Idempotente. Aplicar vía Supabase SQL Editor o mcp__supabase__apply_migration.
-- =============================================================================

BEGIN;

-- ─── Guarda: abortar si aparecieron filas con el vocabulario viejo ───────────

DO $$
DECLARE
  v_tipo   INT;
  v_estado INT;
BEGIN
  SELECT count(*) INTO v_tipo
  FROM ece.indicacion_item
  WHERE tipo NOT IN ('MEDICAMENTO','PROCEDIMIENTO','DIETA',
                     'CUIDADO_GENERAL','ESTUDIO','REPOSO');

  SELECT count(*) INTO v_estado
  FROM ece.administracion_medicamento
  WHERE estado NOT IN ('PROGRAMADA','ADMINISTRADO','OMITIDA',
                       'DIFERIDA','RECHAZADA');

  IF v_tipo > 0 OR v_estado > 0 THEN
    RAISE EXCEPTION
      'Hay datos con el vocabulario viejo (indicacion_item.tipo: % filas, administracion_medicamento.estado: % filas). Migrar los valores con UPDATE antes de reintentar este archivo.',
      v_tipo, v_estado;
  END IF;
END $$;

-- ─── ece.indicacion_item.tipo ────────────────────────────────────────────────

ALTER TABLE ece.indicacion_item
  DROP CONSTRAINT IF EXISTS indicacion_item_tipo_check;   -- DDL original, minúsculas
ALTER TABLE ece.indicacion_item
  DROP CONSTRAINT IF EXISTS chk_ind_item_tipo;            -- idempotencia

ALTER TABLE ece.indicacion_item
  ADD CONSTRAINT chk_ind_item_tipo
  CHECK (tipo IN (
    'MEDICAMENTO',
    'PROCEDIMIENTO',
    'DIETA',
    'CUIDADO_GENERAL',
    'ESTUDIO',
    'REPOSO'
  ));

COMMENT ON CONSTRAINT chk_ind_item_tipo ON ece.indicacion_item IS
  'Vocabulario canónico de tipo de indicación (202). Espejo de tipoIndicacionEnum en packages/trpc/src/routers/ece/indicaciones-medicas.router.ts y packages/contracts/src/schemas/ece-indicaciones.ts. REPOSO existe en BD pero todavía no está expuesto en el enum Zod ni en la UI (delta declarado en packages/trpc/src/routers/ece/__tests__/vocabulario-bd-drift.test.ts).';

-- ─── ece.administracion_medicamento.estado ───────────────────────────────────

ALTER TABLE ece.administracion_medicamento
  DROP CONSTRAINT IF EXISTS administracion_medicamento_estado_check; -- DDL original, minúsculas
ALTER TABLE ece.administracion_medicamento
  DROP CONSTRAINT IF EXISTS chk_admin_med_estado;                    -- 98, ya dropeado por 165
ALTER TABLE ece.administracion_medicamento
  DROP CONSTRAINT IF EXISTS chk_admin_med_estado_v2;                 -- idempotencia

ALTER TABLE ece.administracion_medicamento
  ADD CONSTRAINT chk_admin_med_estado_v2
  CHECK (estado IN (
    'PROGRAMADA',
    'ADMINISTRADO',
    'OMITIDA',
    'DIFERIDA',
    'RECHAZADA'
  ));

COMMENT ON CONSTRAINT chk_admin_med_estado_v2 ON ece.administracion_medicamento IS
  'Vocabulario canónico de estado de administración (202). Union de estadoAdminEnum (indicaciones-medicas.router.ts: PROGRAMADA|ADMINISTRADO|OMITIDA|RECHAZADA) y estadoAdminMedEnum (registro-enfermeria.router.ts: ADMINISTRADO|OMITIDA|DIFERIDA). Sufijo _v2 porque 165_drop_legacy_checks_ece.sql dropea chk_admin_med_estado por nombre.';

COMMIT;

-- ─── Verificación post-apply ─────────────────────────────────────────────────
-- SELECT con.conname, pg_get_constraintdef(con.oid)
-- FROM pg_constraint con
-- JOIN pg_class rel ON rel.oid = con.conrelid
-- JOIN pg_namespace ns ON ns.oid = rel.relnamespace
-- WHERE ns.nspname = 'ece'
--   AND rel.relname IN ('indicacion_item','administracion_medicamento')
--   AND con.contype = 'c'
-- ORDER BY rel.relname, con.conname;
--
-- Esperado: chk_ind_item_tipo (6 valores MAYUSCULAS), chk_admin_med_estado_v2
-- (5 valores MAYUSCULAS), chk_ind_via_enum y chk_motivo_omision_requerido
-- intactos. NO debe quedar ni indicacion_item_tipo_check ni
-- administracion_medicamento_estado_check.
