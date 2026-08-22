-- =====================================================================
-- 205_ece_rls_smoke.sql
-- Smoke test transaccional de 205_ece_rls_tablas_faltantes.sql.
--
-- Requiere que 205_ece_rls_tablas_faltantes.sql YA esté aplicado en la
-- sesión/BD contra la que se corre este archivo. Corre 100% dentro de UNA
-- transacción que termina en ROLLBACK — no persiste ningún dato (ni los
-- fixtures de Organization/Establishment/BiomedicalEquipment/gs1_gln que
-- crea, ni las filas de evento que inserta).
--
-- Uso:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/__tests__/205_ece_rls_smoke.sql
--
-- Falla ruidosamente (RAISE EXCEPTION, aborta la transacción) ante
-- cualquier aserción incumplida — no hay asserts silenciosos.
--
-- Qué verifica:
--   1. ece.epcis_event / ece.epcis_event_equipment:
--      - SELECT desde el tenant dueño del equipo ve su propio evento y
--        NO ve el del otro tenant (aislamiento).
--      - INSERT dentro del propio tenant funciona.
--      - INSERT contra un equipo de OTRO tenant es rechazado por RLS.
--      - Con is_break_glass()=true, SELECT ve los eventos de AMBOS tenants.
--      - UPDATE/DELETE sobre la fila propia son rechazados (append-only).
--   2. ece.catalogo_cpt / ece.lasa_pair / ece.pediatric_max_dose /
--      ece.workflow_plantilla (catálogos REALMENTE de solo lectura — 0
--      hits de escritura de aplicación en el re-grep de 205):
--      - SELECT funciona para `authenticated` sin importar el tenant activo
--        (catálogo global).
--      - INSERT es rechazado (permission denied — REVOKE explícito de
--        205, no solo ausencia de policy).
--   3. ece.workflow_estado_layout (NO es de solo lectura — corregido tras
--      review de @Orq: `estado.setLayout` hace INSERT ... ON CONFLICT DO
--      UPDATE en cada dragEnd del Workflow Designer):
--      - SELECT abierto.
--      - INSERT de una fila nueva funciona.
--      - El upsert completo (ON CONFLICT DO UPDATE, la rama que de verdad
--        usa el diseñador al reposicionar un nodo existente) funciona y
--        persiste el nuevo valor.
--      - DELETE directo sigue rechazado (sin endpoint que lo necesite).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Fixtures — reutiliza 2 organizaciones EXISTENTES (evita depender de
-- columnas NOT NULL sin default de "Organization" como countryId/taxId,
-- que no son responsabilidad de este smoke test) y crea Establishment /
-- BiomedicalEquipment / gs1_gln temporales propios del test.
-- ---------------------------------------------------------------------

CREATE TEMP TABLE smoke_ids (
  key   text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO smoke_ids (key, value)
SELECT 'org_a', id FROM public."Organization" ORDER BY "createdAt" LIMIT 1;

INSERT INTO smoke_ids (key, value)
SELECT 'org_b', id FROM public."Organization"
 WHERE id <> (SELECT value FROM smoke_ids WHERE key = 'org_a')
 ORDER BY "createdAt" LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM smoke_ids WHERE key IN ('org_a', 'org_b')) < 2 THEN
    RAISE EXCEPTION
      'Smoke test requiere al menos 2 filas en public."Organization" — no encontradas. Abortando.';
  END IF;
END $$;

-- GLN temporal (requerido por gln_destino NOT NULL en ece.epcis_event).
INSERT INTO ece.gs1_gln (codigo, descripcion, tipo)
VALUES ('SMOKE205GLN01', 'GLN temporal — smoke test 205', 'UBICACION');

-- Un Establishment por organización de prueba.
WITH new_estab AS (
  INSERT INTO public."Establishment" (id, "organizationId", code, name, "updatedAt")
  SELECT gen_random_uuid(), value, 'SMOKE205A', 'Establecimiento smoke A (205 RLS test)', now()
    FROM smoke_ids WHERE key = 'org_a'
  RETURNING id
)
INSERT INTO smoke_ids (key, value) SELECT 'estab_a', id FROM new_estab;

WITH new_estab AS (
  INSERT INTO public."Establishment" (id, "organizationId", code, name, "updatedAt")
  SELECT gen_random_uuid(), value, 'SMOKE205B', 'Establecimiento smoke B (205 RLS test)', now()
    FROM smoke_ids WHERE key = 'org_b'
  RETURNING id
)
INSERT INTO smoke_ids (key, value) SELECT 'estab_b', id FROM new_estab;

-- Un BiomedicalEquipment por organización de prueba (equipment_id es el
-- ancla de tenant para epcis_event/epcis_event_equipment — ver 205).
WITH new_eq AS (
  INSERT INTO public."BiomedicalEquipment"
    (id, "organizationId", "establishmentId", "assetTag", name, "updatedAt")
  SELECT gen_random_uuid(),
         (SELECT value FROM smoke_ids WHERE key = 'org_a'),
         (SELECT value FROM smoke_ids WHERE key = 'estab_a'),
         'SMOKE205-EQ-A', 'Equipo smoke A (205 RLS test)', now()
  RETURNING id
)
INSERT INTO smoke_ids (key, value) SELECT 'equip_a', id FROM new_eq;

WITH new_eq AS (
  INSERT INTO public."BiomedicalEquipment"
    (id, "organizationId", "establishmentId", "assetTag", name, "updatedAt")
  SELECT gen_random_uuid(),
         (SELECT value FROM smoke_ids WHERE key = 'org_b'),
         (SELECT value FROM smoke_ids WHERE key = 'estab_b'),
         'SMOKE205-EQ-B', 'Equipo smoke B (205 RLS test)', now()
  RETURNING id
)
INSERT INTO smoke_ids (key, value) SELECT 'equip_b', id FROM new_eq;

-- Dos Drug temporales (prod tiene 0 filas en "Drug" hoy — no hay ninguna
-- existente que reutilizar) + un flujo_estado EXISTENTE (152 filas en prod,
-- no se crea uno nuevo). Se usan como FK válidas en los intentos de INSERT
-- "debe ser rechazado" de lasa_pair/pediatric_max_dose/workflow_estado_layout
-- más abajo, para que el único motivo posible de rechazo sea RLS/permiso —
-- nunca una violación de FK que enmascare un falso OK.
WITH new_drug AS (
  INSERT INTO public."Drug" (id, "genericName", "pharmaceuticalForm", "strengthValue", "strengthUnit", "updatedAt")
  VALUES (gen_random_uuid(), 'Smoke Drug X (205 RLS test)', 'TABLET', 1, 'mg', now())
  RETURNING id
)
INSERT INTO smoke_ids (key, value) SELECT 'drug_x', id FROM new_drug;

WITH new_drug AS (
  INSERT INTO public."Drug" (id, "genericName", "pharmaceuticalForm", "strengthValue", "strengthUnit", "updatedAt")
  VALUES (gen_random_uuid(), 'Smoke Drug Y (205 RLS test)', 'TABLET', 1, 'mg', now())
  RETURNING id
)
INSERT INTO smoke_ids (key, value) SELECT 'drug_y', id FROM new_drug;

INSERT INTO smoke_ids (key, value)
SELECT 'estado_existente', id FROM ece.flujo_estado LIMIT 1;

-- Un evento sembrado por tabla y por equipo (seed hecho con el rol de
-- conexión, que tiene BYPASSRLS — igual que cualquier seed real).
INSERT INTO ece.epcis_event (equipment_id, gln_destino, registrado_por)
SELECT value, 'SMOKE205GLN01', gen_random_uuid() FROM smoke_ids WHERE key = 'equip_a';
INSERT INTO ece.epcis_event (equipment_id, gln_destino, registrado_por)
SELECT value, 'SMOKE205GLN01', gen_random_uuid() FROM smoke_ids WHERE key = 'equip_b';

INSERT INTO ece.epcis_event_equipment (equipment_id, gln_destino, biz_step, recorded_by)
SELECT value, 'SMOKE205GLN01', 'storing', gen_random_uuid() FROM smoke_ids WHERE key = 'equip_a';
INSERT INTO ece.epcis_event_equipment (equipment_id, gln_destino, biz_step, recorded_by)
SELECT value, 'SMOKE205GLN01', 'storing', gen_random_uuid() FROM smoke_ids WHERE key = 'equip_b';

-- `authenticated` necesita poder leer la tabla temporal de fixtures desde
-- dentro de los DO blocks que corren ya demotados.
GRANT SELECT ON smoke_ids TO authenticated;

-- ---------------------------------------------------------------------
-- Contexto: organización A, demotado a `authenticated` (igual que
-- withTenantContext en packages/trpc/src/rls-context.ts).
-- ---------------------------------------------------------------------

SELECT public.set_tenant_context(
  gen_random_uuid(),
  (SELECT value FROM smoke_ids WHERE key = 'org_a'),
  false
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_equip_a uuid := (SELECT value FROM smoke_ids WHERE key = 'equip_a');
  v_equip_b uuid := (SELECT value FROM smoke_ids WHERE key = 'equip_b');
  v_cnt     int;
BEGIN
  -- 1a. epcis_event: SELECT ve solo el evento propio (org A).
  SELECT count(*) INTO v_cnt FROM ece.epcis_event WHERE equipment_id = v_equip_a;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL epcis_event SELECT propio (org A): esperado 1, obtuvo %', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt FROM ece.epcis_event WHERE equipment_id = v_equip_b;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL epcis_event SELECT ajeno (org B) desde org A: esperado 0, obtuvo %', v_cnt;
  END IF;

  -- 1b. epcis_event_equipment: mismo aislamiento.
  SELECT count(*) INTO v_cnt FROM ece.epcis_event_equipment WHERE equipment_id = v_equip_a;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL epcis_event_equipment SELECT propio (org A): esperado 1, obtuvo %', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt FROM ece.epcis_event_equipment WHERE equipment_id = v_equip_b;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL epcis_event_equipment SELECT ajeno (org B) desde org A: esperado 0, obtuvo %', v_cnt;
  END IF;

  -- 2a. INSERT propio (org A): debe funcionar.
  INSERT INTO ece.epcis_event (equipment_id, gln_destino, registrado_por)
  VALUES (v_equip_a, 'SMOKE205GLN01', gen_random_uuid());

  INSERT INTO ece.epcis_event_equipment (equipment_id, gln_destino, biz_step, recorded_by)
  VALUES (v_equip_a, 'SMOKE205GLN01', 'transporting', gen_random_uuid());

  -- 2b. INSERT cruzado (equipo de org B mientras el contexto es org A):
  -- debe ser rechazado por la policy WITH CHECK (violación RLS = 42501).
  BEGIN
    INSERT INTO ece.epcis_event (equipment_id, gln_destino, registrado_por)
    VALUES (v_equip_b, 'SMOKE205GLN01', gen_random_uuid());
    RAISE EXCEPTION 'FAIL epcis_event INSERT cruzado: debió ser rechazado por RLS y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK epcis_event INSERT cruzado correctamente rechazado.';
  END;

  BEGIN
    INSERT INTO ece.epcis_event_equipment (equipment_id, gln_destino, biz_step, recorded_by)
    VALUES (v_equip_b, 'SMOKE205GLN01', 'transporting', gen_random_uuid());
    RAISE EXCEPTION 'FAIL epcis_event_equipment INSERT cruzado: debió ser rechazado por RLS y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK epcis_event_equipment INSERT cruzado correctamente rechazado.';
  END;

  -- 2c. UPDATE/DELETE deben estar bloqueados incluso sobre la fila propia
  -- (son bitácoras append-only — sin policy de UPDATE/DELETE + REVOKE).
  BEGIN
    UPDATE ece.epcis_event SET notas = 'intento' WHERE equipment_id = v_equip_a;
    RAISE EXCEPTION 'FAIL epcis_event UPDATE propio: debió ser rechazado (tabla append-only) y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK epcis_event UPDATE correctamente rechazado (append-only).';
  END;

  BEGIN
    DELETE FROM ece.epcis_event WHERE equipment_id = v_equip_a;
    RAISE EXCEPTION 'FAIL epcis_event DELETE propio: debió ser rechazado (tabla append-only) y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK epcis_event DELETE correctamente rechazado (append-only).';
  END;

  RAISE NOTICE 'OK bloque 1 (epcis_event / epcis_event_equipment) — org A.';
END $$;

-- ---------------------------------------------------------------------
-- Break-glass: mismo tenant (org A) pero con app.is_break_glass=true —
-- SELECT debe ver los eventos de AMBAS organizaciones (política de
-- BiomedicalEquipment replicada: is_break_glass() OR org match).
-- ---------------------------------------------------------------------

SELECT public.set_tenant_context(
  gen_random_uuid(),
  (SELECT value FROM smoke_ids WHERE key = 'org_a'),
  true
);

DO $$
DECLARE
  v_equip_a uuid := (SELECT value FROM smoke_ids WHERE key = 'equip_a');
  v_equip_b uuid := (SELECT value FROM smoke_ids WHERE key = 'equip_b');
  v_cnt     int;
BEGIN
  SELECT count(*) INTO v_cnt
    FROM ece.epcis_event
   WHERE equipment_id IN (v_equip_a, v_equip_b);
  -- 2 sembrados + 1 insertado en el bloque anterior para equip_a = 3.
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION 'FAIL epcis_event SELECT con break-glass: esperado 3 (ambas orgs), obtuvo %', v_cnt;
  END IF;

  RAISE NOTICE 'OK break-glass ve eventos de ambas organizaciones (%).', v_cnt;
END $$;

-- ---------------------------------------------------------------------
-- Contexto: organización B — el aislamiento debe verse también desde el
-- otro lado (no es un artefacto de cuál organización se probó primero).
-- ---------------------------------------------------------------------

SELECT public.set_tenant_context(
  gen_random_uuid(),
  (SELECT value FROM smoke_ids WHERE key = 'org_b'),
  false
);

DO $$
DECLARE
  v_equip_a uuid := (SELECT value FROM smoke_ids WHERE key = 'equip_a');
  v_equip_b uuid := (SELECT value FROM smoke_ids WHERE key = 'equip_b');
  v_cnt     int;
BEGIN
  SELECT count(*) INTO v_cnt FROM ece.epcis_event WHERE equipment_id = v_equip_b;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL epcis_event SELECT propio (org B): esperado 1, obtuvo %', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt FROM ece.epcis_event WHERE equipment_id = v_equip_a;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL epcis_event SELECT ajeno (org A) desde org B: esperado 0, obtuvo %', v_cnt;
  END IF;

  RAISE NOTICE 'OK bloque 2 (epcis_event) — aislamiento simétrico confirmado desde org B.';
END $$;

-- ---------------------------------------------------------------------
-- Catálogos REALMENTE de solo lectura (catalogo_cpt / lasa_pair /
-- pediatric_max_dose / workflow_plantilla — 0 hits de escritura de
-- aplicación en el re-grep, ver 205_ece_rls_tablas_faltantes.sql §2):
-- SELECT abierto para `authenticated` (contexto sigue siendo org B,
-- cualquiera sirve — son globales); INSERT rechazado.
--
-- ece.workflow_estado_layout NO entra en este bloque — es el caso
-- corregido tras el review de @Orq (sí tiene escritura de aplicación
-- real vía `estado.setLayout`) y se prueba aparte, como éxito, abajo.
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_cnt     int;
  v_drug_x  uuid := (SELECT value FROM smoke_ids WHERE key = 'drug_x');
  v_drug_y  uuid := (SELECT value FROM smoke_ids WHERE key = 'drug_y');
BEGIN
  -- SELECT no debe lanzar error de permisos en ninguna de las 4 tablas.
  PERFORM count(*) FROM ece.catalogo_cpt;
  PERFORM count(*) FROM ece.lasa_pair;
  PERFORM count(*) FROM ece.pediatric_max_dose;
  PERFORM count(*) FROM ece.workflow_plantilla;
  RAISE NOTICE 'OK SELECT abierto en los 4 catálogos realmente de solo lectura.';

  BEGIN
    INSERT INTO ece.catalogo_cpt (codigo, descripcion) VALUES ('SMOKE205', 'smoke test');
    RAISE EXCEPTION 'FAIL catalogo_cpt INSERT: debió ser rechazado (catálogo solo-lectura) y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK catalogo_cpt INSERT correctamente rechazado.';
  END;

  -- FK válida (drug_x/drug_y creados arriba) para que el único motivo de
  -- rechazo posible sea RLS/permiso, nunca una violación de FK.
  BEGIN
    INSERT INTO ece.lasa_pair (drug_a_id, drug_b_id, razon, severidad)
    VALUES (v_drug_x, v_drug_y, 'sound-alike', 'warning');
    RAISE EXCEPTION 'FAIL lasa_pair INSERT: debió ser rechazado (catálogo solo-lectura) y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK lasa_pair INSERT correctamente rechazado.';
  END;

  BEGIN
    INSERT INTO ece.pediatric_max_dose (drug_id, max_dose_absolute_mg, fuente)
    VALUES (v_drug_x, 10, 'smoke test');
    RAISE EXCEPTION 'FAIL pediatric_max_dose INSERT: debió ser rechazado (catálogo solo-lectura) y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK pediatric_max_dose INSERT correctamente rechazado.';
  END;

  BEGIN
    INSERT INTO ece.workflow_plantilla (codigo, nombre, categoria)
    VALUES ('SMOKE205', 'smoke test', 'Ambulatorio');
    RAISE EXCEPTION 'FAIL workflow_plantilla INSERT: debió ser rechazado (catálogo solo-lectura) y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK workflow_plantilla INSERT correctamente rechazado.';
  END;

  RAISE NOTICE 'OK bloque 3 (catálogos de solo lectura) — SELECT abierto, escritura bloqueada en las 4.';
END $$;

-- ---------------------------------------------------------------------
-- ece.workflow_estado_layout: caso corregido tras el review de @Orq.
-- Reproduce el patrón EXACTO de `estado.setLayout`
-- (workflow-estado.router.ts:379-389) bajo `authenticated`: primero un
-- INSERT sobre un estado_id sin fila previa (rama INSERT del upsert),
-- después el MISMO INSERT ... ON CONFLICT DO UPDATE contra el estado_id
-- que YA tiene fila (rama UPDATE del upsert — la más común en uso real,
-- porque estado_id es PK y el diseñador reposiciona nodos existentes en
-- cada dragEnd). Ambas ramas deben funcionar para `authenticated`; si
-- solo la rama INSERT funcionara (como en la versión anterior de este
-- archivo, que ni siquiera esa dejaba), el guardado de posiciones se
-- rompería en cuanto workflow-estado.router.ts se demote a
-- `authenticated` (migración en curso, frente R02).
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_estado uuid := (SELECT value FROM smoke_ids WHERE key = 'estado_existente');
  v_x      double precision;
  v_y      double precision;
BEGIN
  -- Rama INSERT (fila nueva, sin conflicto).
  INSERT INTO ece.workflow_estado_layout (estado_id, x, y, updated_at)
  VALUES (v_estado, 10, 20, now())
  ON CONFLICT (estado_id)
    DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y, updated_at = now();

  SELECT x, y INTO v_x, v_y FROM ece.workflow_estado_layout WHERE estado_id = v_estado;
  IF v_x <> 10 OR v_y <> 20 THEN
    RAISE EXCEPTION 'FAIL workflow_estado_layout INSERT (rama nueva): esperado (10,20), obtuvo (%,%)', v_x, v_y;
  END IF;
  RAISE NOTICE 'OK workflow_estado_layout INSERT (rama nueva) — setLayout funciona bajo authenticated.';

  -- Rama UPDATE del mismo upsert (ON CONFLICT DO UPDATE) — dragEnd sobre
  -- un nodo que el diseñador ya había posicionado antes.
  INSERT INTO ece.workflow_estado_layout (estado_id, x, y, updated_at)
  VALUES (v_estado, 111, 222, now())
  ON CONFLICT (estado_id)
    DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y, updated_at = now();

  SELECT x, y INTO v_x, v_y FROM ece.workflow_estado_layout WHERE estado_id = v_estado;
  IF v_x <> 111 OR v_y <> 222 THEN
    RAISE EXCEPTION 'FAIL workflow_estado_layout UPDATE (rama ON CONFLICT): esperado (111,222), obtuvo (%,%)', v_x, v_y;
  END IF;
  RAISE NOTICE 'OK workflow_estado_layout UPDATE vía ON CONFLICT — rama de reposicionamiento funciona bajo authenticated.';

  -- DELETE directo SÍ debe seguir bloqueado — no hay endpoint que lo use.
  BEGIN
    DELETE FROM ece.workflow_estado_layout WHERE estado_id = v_estado;
    RAISE EXCEPTION 'FAIL workflow_estado_layout DELETE: debió ser rechazado (sin endpoint que lo necesite) y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK workflow_estado_layout DELETE correctamente rechazado.';
  END;

  RAISE NOTICE 'OK bloque 4 (workflow_estado_layout) — setLayout (INSERT + upsert) funciona, DELETE bloqueado.';
  RAISE NOTICE 'SMOKE 205: TODAS LAS ASERCIONES PASARON.';
END $$;

-- Nada de lo anterior persiste — fixtures, eventos sembrados/insertados y
-- el GUC de tenant quedan descartados junto con la transacción.
ROLLBACK;
