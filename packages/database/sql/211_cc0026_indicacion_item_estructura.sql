-- =============================================================================
-- 211_cc0026_indicacion_item_estructura.sql
-- CC-0026 Ola 2 — amplía `ece.indicacion_item` para el CPOE de 8 categorías
-- (ESP-MOCKUP-0026): agrega los tipos MOVIMIENTO e INTERCONSULTA al vocabulario
-- (mov y inter son categorías del mockup sin tipo equivalente en el CHECK de
-- 202) y dos columnas nullable para capturar el detalle estructurado que hoy
-- solo vive como texto libre en `descripcion`.
--
-- ─── Por qué no basta con 202 ────────────────────────────────────────────────
--
-- `chk_ind_item_tipo` (202) cubre {MEDICAMENTO,PROCEDIMIENTO,DIETA,
-- CUIDADO_GENERAL,ESTUDIO,REPOSO} — 6 valores. El mockup define 8 categorías
-- de captura; 6 mapean 1:1 a esos tipos (mov→MOVIMIENTO no existía,
-- inter→INTERCONSULTA no existía). lab/gab comparten tipo=ESTUDIO (ya en el
-- CHECK) y se distinguen por `detalle->>'categoriaUI'` ('LABORATORIO' |
-- 'GABINETE') — no se agrega un tipo nuevo por cada uno para no inflar el
-- vocabulario con una distinción que ya vive en el JSON estructurado.
--
-- Sigue el mismo patrón DROP+re-add de 202 (mismo constraint, superset de
-- valores) para no dejar dos CHECK compitiendo.
--
-- ─── drug_id ──────────────────────────────────────────────────────────────────
--
-- FK opcional a `public."Drug"` (catálogo real del HIS, NO el MED_DATA
-- embebido del mockup). Cierra parcialmente R06 (trazabilidad de medicamento
-- prescrito) en el punto de prescripción — antes de este archivo,
-- MEDICAMENTO solo tenía `descripcion` en texto libre. ON DELETE SET NULL:
-- una indicación firmada es inmutable en su intención clínica aunque el
-- catálogo de fármacos cambie o el registro se desactive/borre — nunca debe
-- perderse el ítem completo por un borrado en otra tabla.
--
-- ─── detalle ──────────────────────────────────────────────────────────────────
--
-- jsonb NULL: payload estructurado por categoría (lo que el modal de captura
-- de cada categoría compone además del texto de `descripcion`). Sin CHECK de
-- forma — cada categoría define sus propias claves (ver
-- ESP-MOCKUP-0026-indicacion-medica.md); estructurar esto con columnas
-- separadas por categoría multiplicaría el ancho de la tabla sin necesidad
-- real de indexarlo por ahora. Si una categoría futura necesita consultarlo
-- (p. ej. reportes por modalidad de gabinete), se puede indexar con GIN sin
-- migrar el dato.
--
-- Verificado 2026-08-26 vía MCP: `ece.indicacion_item` = 0 filas en prod
-- (mismo hecho que motivó 202/210 — el módulo nunca corrió end-to-end). No
-- hace falta backfill.
--
-- NO aplicado a prod por este archivo — pendiente de review de @Orq (mismo
-- criterio que 209/210, que este archivo acompaña).
-- Idempotente. Aplicar vía Supabase SQL Editor o mcp__supabase__apply_migration.
-- =============================================================================

BEGIN;

-- ─── Guarda: abortar si aparecieron filas con un tipo fuera del vocabulario ──

DO $$
DECLARE
  v_tipo INT;
BEGIN
  SELECT count(*) INTO v_tipo
  FROM ece.indicacion_item
  WHERE tipo NOT IN ('MEDICAMENTO','PROCEDIMIENTO','DIETA',
                     'CUIDADO_GENERAL','ESTUDIO','REPOSO');

  IF v_tipo > 0 THEN
    RAISE EXCEPTION
      'Hay % fila(s) con un tipo fuera del vocabulario de 202. Revisar antes de reintentar este archivo.',
      v_tipo;
  END IF;
END $$;

-- ─── chk_ind_item_tipo — superset con MOVIMIENTO + INTERCONSULTA ─────────────

ALTER TABLE ece.indicacion_item
  DROP CONSTRAINT IF EXISTS chk_ind_item_tipo; -- 202, idempotencia

ALTER TABLE ece.indicacion_item
  ADD CONSTRAINT chk_ind_item_tipo
  CHECK (tipo IN (
    'MEDICAMENTO',
    'PROCEDIMIENTO',
    'DIETA',
    'CUIDADO_GENERAL',
    'ESTUDIO',
    'REPOSO',
    'MOVIMIENTO',
    'INTERCONSULTA'
  ));

COMMENT ON CONSTRAINT chk_ind_item_tipo ON ece.indicacion_item IS
  'Vocabulario canónico de tipo de indicación (211, superset de 202 con '
  'MOVIMIENTO/INTERCONSULTA — ESP-MOCKUP-0026). Espejo de tipoIndicacionEnum '
  'en packages/trpc/src/routers/ece/indicaciones-medicas.router.ts y '
  'packages/contracts/src/schemas/ece-indicaciones.ts. Ver '
  'packages/trpc/src/routers/ece/__tests__/vocabulario-bd-drift.test.ts.';

-- ─── drug_id + detalle ────────────────────────────────────────────────────────

ALTER TABLE ece.indicacion_item
  ADD COLUMN IF NOT EXISTS drug_id uuid NULL
    REFERENCES public."Drug"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS detalle jsonb NULL;

CREATE INDEX IF NOT EXISTS idx_indicacion_item_drug_id
  ON ece.indicacion_item (drug_id)
  WHERE drug_id IS NOT NULL;

COMMENT ON COLUMN ece.indicacion_item.drug_id IS
  'CC-0026 Ola 2 — FK opcional a public."Drug" (catálogo real, NO el '
  'MED_DATA del mockup). Solo poblado cuando tipo=MEDICAMENTO y el médico '
  'seleccionó un producto del catálogo (búsqueda 3+ letras). Cierra '
  'parcialmente R06 en el punto de prescripción. ON DELETE SET NULL: no '
  'debe perderse el ítem de la indicación firmada si el fármaco se '
  'desactiva o borra del catálogo.';

COMMENT ON COLUMN ece.indicacion_item.detalle IS
  'CC-0026 Ola 2 — payload JSON estructurado por categoría (ESP-MOCKUP-0026): '
  'lo que el modal de captura de cada categoría arma además del texto de '
  '`descripcion`. Sin CHECK de forma — cada categoría define sus propias '
  'claves. NULL para ítems creados antes de este cambio o por caminos que '
  'todavía no lo pueblan.';

-- -----------------------------------------------------------------------------
-- Verificación
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'ece' AND table_name = 'indicacion_item'
      AND column_name IN ('drug_id', 'detalle')
  ) = 2,
    'ERROR: faltan columnas drug_id/detalle en ece.indicacion_item';
  ASSERT (
    SELECT count(*) FROM pg_constraint
    WHERE conname = 'chk_ind_item_tipo'
      AND conrelid = 'ece.indicacion_item'::regclass
  ) = 1,
    'ERROR: falta chk_ind_item_tipo';
  RAISE NOTICE 'OK: chk_ind_item_tipo ampliado + drug_id + detalle creados en ece.indicacion_item';
END $$;

COMMIT;
