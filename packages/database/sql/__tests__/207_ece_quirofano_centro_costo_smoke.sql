-- =====================================================================
-- 207_ece_quirofano_centro_costo_smoke.sql
-- Smoke test transaccional de 207_ece_quirofano_centro_costo.sql.
--
-- Requiere que 207_ece_quirofano_centro_costo.sql YA esté aplicado en la
-- sesión/BD contra la que se corre este archivo. Corre 100% dentro de UNA
-- transacción que termina en ROLLBACK — no persiste ningún dato (ni los
-- fixtures de personal_salud/sala_qx/episodio_atencion/documento_instancia/
-- reserva_sala_qx/acto_quirurgico que crea).
--
-- Uso:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/__tests__/207_ece_quirofano_centro_costo_smoke.sql
--
-- Falla ruidosamente (RAISE EXCEPTION, aborta la transacción) ante
-- cualquier aserción incumplida — no hay asserts silenciosos.
--
-- Qué verifica:
--   1. Ambas columnas nuevas existen, son uuid y nullable.
--   2. ece.reserva_sala_qx.centro_costo_id acepta un CostCenter real
--      (1-QUI-MAY) al reservar, y rechaza (FK 23503) un uuid inválido.
--   3. ece.acto_quirurgico.centro_costo_id es editable mientras el
--      documento_instancia asociado está en 'borrador' (acepta un
--      CostCenter real, rechaza un uuid inválido) — el gap que este
--      archivo cierra.
--   4. Al pasar el documento_instancia a 'firmado', el trigger Art. 40 YA
--      EXISTENTE (ece.fn_bloquea_mutacion_acto_qx, sql/99) bloquea
--      cualquier UPDATE de la fila — incluida la columna nueva — SIN que
--      207 haya tenido que tocar el trigger. Esta es la aserción central:
--      confirma que la imputación definitiva queda inmutable post-firma
--      sin protección adicional.
--   5. Los índices parciales idx_reserva_sala_qx_centro_costo /
--      idx_acto_quirurgico_centro_costo existen.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Columnas: existen, uuid, nullable.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_type text;
  v_null text;
BEGIN
  SELECT data_type, is_nullable INTO v_type, v_null
    FROM information_schema.columns
   WHERE table_schema = 'ece' AND table_name = 'reserva_sala_qx' AND column_name = 'centro_costo_id';
  IF v_type IS DISTINCT FROM 'uuid' OR v_null IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'FAIL reserva_sala_qx.centro_costo_id: esperado uuid/nullable, obtuvo %/%', v_type, v_null;
  END IF;

  SELECT data_type, is_nullable INTO v_type, v_null
    FROM information_schema.columns
   WHERE table_schema = 'ece' AND table_name = 'acto_quirurgico' AND column_name = 'centro_costo_id';
  IF v_type IS DISTINCT FROM 'uuid' OR v_null IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'FAIL acto_quirurgico.centro_costo_id: esperado uuid/nullable, obtuvo %/%', v_type, v_null;
  END IF;

  RAISE NOTICE 'OK bloque 0 — ambas columnas existen como uuid nullable.';
END $$;

-- ---------------------------------------------------------------------
-- 1. Fixtures — reutiliza catálogos EXISTENTES en prod (institucion,
--    establecimiento, paciente, tipo_documento ACTO_QX, flujo_estado
--    borrador/firmado, los 2 CostCenter reales de quirófano) y crea
--    solo lo que no existe hoy (personal_salud, sala_qx, episodio,
--    documento_instancia, reserva, acto — todas en 0 filas en prod al
--    momento de escribir esto, ver ADR 0021).
-- ---------------------------------------------------------------------

CREATE TEMP TABLE smoke_ids (
  key   text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO smoke_ids (key, value) SELECT 'institucion', id FROM ece.institucion ORDER BY id LIMIT 1;
INSERT INTO smoke_ids (key, value) SELECT 'establecimiento', id FROM ece.establecimiento ORDER BY id LIMIT 1;
INSERT INTO smoke_ids (key, value) SELECT 'paciente', id FROM ece.paciente ORDER BY id LIMIT 1;

DO $$ BEGIN
  IF (SELECT count(*) FROM smoke_ids WHERE key IN ('institucion', 'establecimiento', 'paciente')) < 3 THEN
    RAISE EXCEPTION 'Smoke test requiere institucion/establecimiento/paciente sembrados — no encontrados. Abortando.';
  END IF;
END $$;

INSERT INTO smoke_ids (key, value) SELECT 'cc_mayor', id FROM "CostCenter" WHERE code = '1-QUI-MAY';
INSERT INTO smoke_ids (key, value) SELECT 'cc_menor', id FROM "CostCenter" WHERE code = '1-QUI-MEN';

DO $$ BEGIN
  IF (SELECT count(*) FROM smoke_ids WHERE key IN ('cc_mayor', 'cc_menor')) < 2 THEN
    RAISE EXCEPTION 'Smoke test requiere los CostCenter 1-QUI-MAY/1-QUI-MEN (sql/131) — no encontrados. Abortando.';
  END IF;
END $$;

INSERT INTO smoke_ids (key, value) SELECT 'td_acto_qx', id FROM ece.tipo_documento WHERE codigo = 'ACTO_QX';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM smoke_ids WHERE key = 'td_acto_qx') THEN
    RAISE EXCEPTION 'Smoke test requiere ece.tipo_documento.codigo=ACTO_QX (sql/63_ece_08_seed.sql) — no encontrado. Abortando.';
  END IF;
END $$;

INSERT INTO smoke_ids (key, value)
SELECT 'fe_borrador', fe.id FROM ece.flujo_estado fe
 WHERE fe.tipo_documento_id = (SELECT value FROM smoke_ids WHERE key = 'td_acto_qx') AND fe.codigo = 'borrador';

INSERT INTO smoke_ids (key, value)
SELECT 'fe_firmado', fe.id FROM ece.flujo_estado fe
 WHERE fe.tipo_documento_id = (SELECT value FROM smoke_ids WHERE key = 'td_acto_qx') AND fe.codigo = 'firmado';

DO $$ BEGIN
  IF (SELECT count(*) FROM smoke_ids WHERE key IN ('fe_borrador', 'fe_firmado')) < 2 THEN
    RAISE EXCEPTION 'Smoke test requiere flujo_estado borrador/firmado para ACTO_QX — no encontrados. Abortando.';
  END IF;
END $$;

-- `authenticated` no se usa en este smoke (corre con el rol de conexión,
-- BYPASSRLS, igual que cualquier seed real) — no hace falta GRANT sobre
-- smoke_ids.

-- Bypass del trigger ece.fn_assert_dependencias_firmadas (sql/101): ACTO_QX
-- depende de CONS_INF/otros documentos firmados en el episodio (motor de
-- workflow ECE, ver CLAUDE.md §Motor de workflow ECE). Este smoke no ejerce
-- esa cadena de dependencias — no es su objeto — así que usa el mismo
-- escape hatch documentado para seeders.
SET LOCAL app.skip_dependencias_enforcement = 'true';

WITH ins AS (
  INSERT INTO ece.personal_salud (institucion_id, establecimiento_id, documento_identidad, nombre_completo)
  SELECT (SELECT value FROM smoke_ids WHERE key = 'institucion'),
         (SELECT value FROM smoke_ids WHERE key = 'establecimiento'),
         'SMOKE207-DUI', 'Cirujano Smoke 207'
  RETURNING id
)
INSERT INTO smoke_ids (key, value) SELECT 'cirujano', id FROM ins;

WITH ins AS (
  INSERT INTO ece.sala_qx (establecimiento_id, codigo, nombre, tipo)
  SELECT (SELECT value FROM smoke_ids WHERE key = 'establecimiento'), 'SMOKE207-SALA', 'Sala Smoke 207', 'mayor'
  RETURNING id
)
INSERT INTO smoke_ids (key, value) SELECT 'sala', id FROM ins;

WITH ins AS (
  INSERT INTO ece.episodio_atencion (paciente_id, establecimiento_id, modalidad, servicio_categoria)
  SELECT (SELECT value FROM smoke_ids WHERE key = 'paciente'),
         (SELECT value FROM smoke_ids WHERE key = 'establecimiento'),
         'hospitalario', 'hospitalizacion'
  RETURNING id
)
INSERT INTO smoke_ids (key, value) SELECT 'episodio', id FROM ins;

-- reserva_sala_qx: imputación ESTIMADA al reservar — la sala reservada es
-- tipo 'mayor', se imputa a 1-QUI-MAY (consistente con el razonamiento de
-- 207: la clasificación nace de qué sala se reserva).
WITH ins AS (
  INSERT INTO ece.reserva_sala_qx (
    orden_qx_id, episodio_id, sala_qx_id, cirujano_id,
    fecha_inicio, fecha_fin, duracion_estimada_min, procedimiento_cie10,
    reservado_por, centro_costo_id
  )
  SELECT
    gen_random_uuid(),
    (SELECT value FROM smoke_ids WHERE key = 'episodio'),
    (SELECT value FROM smoke_ids WHERE key = 'sala'),
    (SELECT value FROM smoke_ids WHERE key = 'cirujano'),
    now(), now() + interval '2 hours', 120, 'K35.8',
    (SELECT value FROM smoke_ids WHERE key = 'cirujano'),
    (SELECT value FROM smoke_ids WHERE key = 'cc_mayor')
  RETURNING id
)
INSERT INTO smoke_ids (key, value) SELECT 'reserva', id FROM ins;

WITH ins AS (
  INSERT INTO ece.documento_instancia (tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por)
  SELECT (SELECT value FROM smoke_ids WHERE key = 'td_acto_qx'),
         (SELECT value FROM smoke_ids WHERE key = 'episodio'),
         (SELECT value FROM smoke_ids WHERE key = 'paciente'),
         (SELECT value FROM smoke_ids WHERE key = 'fe_borrador'),
         (SELECT value FROM smoke_ids WHERE key = 'cirujano')
  RETURNING id
)
INSERT INTO smoke_ids (key, value) SELECT 'instancia', id FROM ins;

-- acto_quirurgico: se crea SIN centro_costo_id (borrador) — se completa
-- durante la redacción, antes de firmar, como haría el router real.
WITH ins AS (
  INSERT INTO ece.acto_quirurgico (instancia_id, episodio_id, cirujano_id, procedimiento_realizado)
  SELECT (SELECT value FROM smoke_ids WHERE key = 'instancia'),
         (SELECT value FROM smoke_ids WHERE key = 'episodio'),
         (SELECT value FROM smoke_ids WHERE key = 'cirujano'),
         'Apendicectomía (smoke 207)'
  RETURNING id
)
INSERT INTO smoke_ids (key, value) SELECT 'acto', id FROM ins;

DO $$ BEGIN
  RAISE NOTICE 'OK bloque 1 — fixtures creados (reserva con cc_mayor, acto en borrador sin centro de costo).';
END $$;

-- ---------------------------------------------------------------------
-- 2. reserva_sala_qx.centro_costo_id — FK real (1-QUI-MAY) ya aceptada
--    en el INSERT de arriba; ahora confirma que un uuid inválido es
--    rechazado por la FK.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_reserva uuid := (SELECT value FROM smoke_ids WHERE key = 'reserva');
BEGIN
  BEGIN
    UPDATE ece.reserva_sala_qx SET centro_costo_id = gen_random_uuid() WHERE id = v_reserva;
    RAISE EXCEPTION 'FAIL reserva_sala_qx.centro_costo_id: un uuid inválido debió ser rechazado por la FK y no lo fue.';
  EXCEPTION
    WHEN foreign_key_violation THEN
      RAISE NOTICE 'OK reserva_sala_qx.centro_costo_id rechaza CostCenter inválido (FK 23503).';
  END;

  -- Reasignar a un centro válido (cambio de plan: pasa a menor) confirma
  -- que la columna sigue editable en la reserva (no hay trigger de
  -- inmutabilidad sobre reserva_sala_qx — es planificación, no acto).
  UPDATE ece.reserva_sala_qx SET centro_costo_id = (SELECT value FROM smoke_ids WHERE key = 'cc_menor')
   WHERE id = v_reserva;

  IF (SELECT centro_costo_id FROM ece.reserva_sala_qx WHERE id = v_reserva)
       <> (SELECT value FROM smoke_ids WHERE key = 'cc_menor') THEN
    RAISE EXCEPTION 'FAIL reserva_sala_qx.centro_costo_id: reasignación a CostCenter válido no persistió.';
  END IF;
  RAISE NOTICE 'OK reserva_sala_qx.centro_costo_id editable con CostCenter válido (estimado, sin inmutabilidad).';
END $$;

-- ---------------------------------------------------------------------
-- 3. acto_quirurgico.centro_costo_id — editable en 'borrador': acepta un
--    CostCenter real y rechaza un uuid inválido (misma FK).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_acto uuid := (SELECT value FROM smoke_ids WHERE key = 'acto');
BEGIN
  BEGIN
    UPDATE ece.acto_quirurgico SET centro_costo_id = gen_random_uuid() WHERE id = v_acto;
    RAISE EXCEPTION 'FAIL acto_quirurgico.centro_costo_id: un uuid inválido debió ser rechazado por la FK y no lo fue.';
  EXCEPTION
    WHEN foreign_key_violation THEN
      RAISE NOTICE 'OK acto_quirurgico.centro_costo_id (borrador) rechaza CostCenter inválido (FK 23503).';
  END;

  UPDATE ece.acto_quirurgico SET centro_costo_id = (SELECT value FROM smoke_ids WHERE key = 'cc_mayor')
   WHERE id = v_acto;

  IF (SELECT centro_costo_id FROM ece.acto_quirurgico WHERE id = v_acto)
       <> (SELECT value FROM smoke_ids WHERE key = 'cc_mayor') THEN
    RAISE EXCEPTION 'FAIL acto_quirurgico.centro_costo_id: asignación en borrador no persistió.';
  END IF;
  RAISE NOTICE 'OK acto_quirurgico.centro_costo_id editable en borrador (imputación definitiva en redacción).';
END $$;

-- ---------------------------------------------------------------------
-- 4. Firma el documento_instancia (fe_firmado) — desde este punto el
--    trigger Art. 40 YA EXISTENTE (sql/99) debe bloquear CUALQUIER
--    UPDATE de ece.acto_quirurgico, incluida centro_costo_id, SIN que
--    207 haya tocado el trigger. Esta es la aserción que justifica el
--    diseño: la imputación definitiva queda inmutable post-firma gratis.
-- ---------------------------------------------------------------------
UPDATE ece.documento_instancia
   SET estado_actual_id = (SELECT value FROM smoke_ids WHERE key = 'fe_firmado')
 WHERE id = (SELECT value FROM smoke_ids WHERE key = 'instancia');

DO $$
DECLARE
  v_acto uuid := (SELECT value FROM smoke_ids WHERE key = 'acto');
BEGIN
  BEGIN
    UPDATE ece.acto_quirurgico SET centro_costo_id = (SELECT value FROM smoke_ids WHERE key = 'cc_menor')
     WHERE id = v_acto;
    RAISE EXCEPTION 'FAIL acto_quirurgico.centro_costo_id: debió quedar inmutable post-firma (Art. 40) y no lo fue.';
  EXCEPTION
    WHEN SQLSTATE '2F003' THEN
      RAISE NOTICE 'OK acto_quirurgico.centro_costo_id inmutable post-firma — trigger Art. 40 existente cubre la columna nueva sin cambios adicionales.';
  END;

  -- El valor definitivo (cc_mayor, asignado en borrador) debe seguir
  -- intacto: el intento de mutación bloqueado no debió alterar nada.
  IF (SELECT centro_costo_id FROM ece.acto_quirurgico WHERE id = v_acto)
       <> (SELECT value FROM smoke_ids WHERE key = 'cc_mayor') THEN
    RAISE EXCEPTION 'FAIL acto_quirurgico.centro_costo_id: el valor definitivo cambió pese al rechazo del trigger.';
  END IF;
  RAISE NOTICE 'OK acto_quirurgico.centro_costo_id conserva el valor definitivo (1-QUI-MAY) tras el intento bloqueado.';
END $$;

-- ---------------------------------------------------------------------
-- 5. Índices parciales de 207 existen.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'ece' AND indexname = 'idx_reserva_sala_qx_centro_costo') THEN
    RAISE EXCEPTION 'FAIL falta índice idx_reserva_sala_qx_centro_costo.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'ece' AND indexname = 'idx_acto_quirurgico_centro_costo') THEN
    RAISE EXCEPTION 'FAIL falta índice idx_acto_quirurgico_centro_costo.';
  END IF;
  RAISE NOTICE 'OK bloque 5 — ambos índices parciales existen.';
END $$;

DO $$ BEGIN
  RAISE NOTICE 'SMOKE 207: TODAS LAS ASERCIONES PASARON.';
END $$;

-- Nada de lo anterior persiste — fixtures y el cambio de estado del
-- documento_instancia quedan descartados junto con la transacción.
ROLLBACK;
