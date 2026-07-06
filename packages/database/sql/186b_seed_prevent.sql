-- =============================================================================
-- CC-0009 — AHA PREVENT™ · Parte B: siembra la calculadora nativa PUBLICADA
-- Schema: ece
-- Aplicar vía Supabase SQL Editor / MCP (mcp__supabase__apply_migration)
--
-- Requisito: 186a aplicado (enum `nativo` disponible) en una transacción previa.
--
-- Por qué SQL y no el seed JS: el motor de PREVENT es una regresión logística de
-- 5 salidas (código en @his/infrastructure/formula/prevent.ts), no una
-- fórmula/score data-driven. Su validación es la suite de 12 casos oficiales en
-- prevent.test.ts (gobernada por PR/DoD), no los casos de prueba en BD — por eso
-- se publica directamente aquí en lugar de pasar por el gate `calculadoras.publicar`.
--
-- Idempotente: si ya existe la calculadora por `codigo`, no hace nada.
-- =============================================================================

DO $$
DECLARE
  v_calc_id UUID;
  v_ver_id  UUID;
  v_def     JSONB := $json$
{
  "engine": "aha-prevent",
  "out": { "label": "Riesgo CV total a 10 años", "u": "%", "dec": 1 },
  "interp": [],
  "attribution": "Ecuaciones AHA PREVENT™ © American Heart Association — Khan SS et al., Circulation 2024;149:430-449. Implementación de referencia: preventr (Martin G. Mayer · licencia MIT).",
  "disclaimer": "Solo con fines informativos; no reemplaza el juicio clínico. Válida en adultos de 30 a 79 años sin enfermedad cardiovascular establecida."
}
$json$::jsonb;
BEGIN
  SELECT id INTO v_calc_id FROM ece.calculadora WHERE codigo = 'CALC-CARD-PREVENT';
  IF v_calc_id IS NOT NULL THEN
    RAISE NOTICE 'PREVENT ya existe (%). No se re-siembra.', v_calc_id;
    RETURN;
  END IF;

  INSERT INTO ece.calculadora
    (codigo, nombre, tipo, categoria, "alto_riesgo", sub, ref, estado, paises, paginas)
  VALUES (
    'CALC-CARD-PREVENT',
    'AHA PREVENT™ — Riesgo cardiovascular (10 y 30 años)',
    'nativo',
    'Cardiología',
    false,
    'Predicting Risk of CVD EVENTs — 5 desenlaces × 2 horizontes',
    'Khan SS, et al. Novel Prediction Equations for Absolute Risk Assessment of Total Cardiovascular Disease. Circulation. 2024;149:430-449.',
    'publicada',
    '{"SV": true, "GT": true, "HN": true}'::jsonb,
    '"*"'::jsonb
  )
  RETURNING id INTO v_calc_id;

  -- Versión 1: publicada e inmutable (no pasa por el gate de casos de prueba).
  INSERT INTO ece.calculadora_version
    ("calculadora_id", version, definicion, "publicada_en", inmutable)
  VALUES (v_calc_id, 1, v_def, now(), true)
  RETURNING id INTO v_ver_id;

  UPDATE ece.calculadora
    SET "version_actual_id" = v_ver_id, "updated_at" = now()
    WHERE id = v_calc_id;

  RAISE NOTICE 'PREVENT sembrada y publicada: calculadora=% versión=%', v_calc_id, v_ver_id;
END $$;
