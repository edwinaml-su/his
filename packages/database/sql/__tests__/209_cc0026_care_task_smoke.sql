-- =====================================================================
-- 209_cc0026_care_task_smoke.sql
-- Smoke test transaccional de 209_cc0026_care_task.sql.
--
-- Requiere que 209_cc0026_care_task.sql YA esté aplicado en la sesión/BD
-- contra la que se corre este archivo. Corre 100% dentro de UNA transacción
-- que termina en ROLLBACK — no persiste ninguna fila.
--
-- Uso:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/209_cc0026_care_task.sql
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/__tests__/209_cc0026_care_task_smoke.sql
--
-- Falla ruidosamente (RAISE EXCEPTION, aborta la transacción) ante
-- cualquier aserción incumplida — no hay asserts silenciosos.
--
-- Qué verifica, reproduciendo los DOS espacios de GUC reales del proyecto:
--   Bloque 1 — withTenantContext (app.current_org_id, packages/trpc/src/
--     rls-context.ts): patrón que usará el futuro router de tableros
--     (Ola 3). INSERT/SELECT/UPDATE propios funcionan; INSERT con
--     organizationId de otra organización es rechazado; DELETE está
--     bloqueado siempre (sin policy ni GRANT).
--   Bloque 2 — withEceContext (app.ece_establecimiento_id, packages/trpc/
--     src/ece/rls-context.ts, SIN app.current_org_id): el espacio que usa
--     `firmar()` en indicaciones-medicas.router.ts (Ola 2). Confirma
--     primero que app.current_org_id efectivamente quedó NULL (si no, el
--     bloque no probaría nada), y que el INSERT/SELECT/UPDATE igual
--     funcionan gracias a `public.current_org_id_or_ece_context()`
--     resolviendo organizationId vía
--     ece.establecimiento.establishment_id -> public."Establishment".
--     Repite la verificación de aislamiento cross-tenant en este espacio.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE smoke_ids (
  key   text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

-- ---------------------------------------------------------------------
-- Fixtures — reutiliza filas EXISTENTES:
--   - Una fila de ece.establecimiento con establishment_id YA vinculado a
--     public."Establishment" (el mismo linkage que resolveEceEstablecimientoId
--     exige en producción real para que ECE funcione en ese establecimiento —
--     ver indicaciones-medicas.router.ts líneas 296-330). Sin esta fila, el
--     bloque 2 no tiene nada realista que probar.
--   - Una segunda organización con Establishment propio, usada SOLO como
--     "organización ajena" para las aserciones de aislamiento cross-tenant.
-- ---------------------------------------------------------------------

INSERT INTO smoke_ids (key, value)
SELECT 'ece_estab', id FROM ece.establecimiento
 WHERE establishment_id IS NOT NULL
 ORDER BY id LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM smoke_ids WHERE key = 'ece_estab') THEN
    RAISE EXCEPTION
      'Smoke test requiere >=1 fila en ece.establecimiento con establishment_id '
      'poblado (linkage real HIS<->ECE, sql/56_ece_01_catalogos.sql) — no '
      'encontrada. Abortando.';
  END IF;
END $$;

INSERT INTO smoke_ids (key, value)
SELECT 'estab_a', establishment_id FROM ece.establecimiento
 WHERE id = (SELECT value FROM smoke_ids WHERE key = 'ece_estab');

INSERT INTO smoke_ids (key, value)
SELECT 'org_a', "organizationId" FROM public."Establishment"
 WHERE id = (SELECT value FROM smoke_ids WHERE key = 'estab_a');

INSERT INTO smoke_ids (key, value)
SELECT 'org_b', id FROM public."Organization"
 WHERE id <> (SELECT value FROM smoke_ids WHERE key = 'org_a')
 ORDER BY id LIMIT 1;

INSERT INTO smoke_ids (key, value)
SELECT 'estab_b', id FROM public."Establishment"
 WHERE "organizationId" = (SELECT value FROM smoke_ids WHERE key = 'org_b')
 ORDER BY id LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM smoke_ids WHERE key IN ('estab_a', 'org_a', 'org_b', 'estab_b')) < 4 THEN
    RAISE EXCEPTION
      'Smoke test requiere 2 organizaciones con al menos 1 Establishment cada '
      'una — no encontradas. Abortando.';
  END IF;
END $$;

-- `authenticated` necesita leer la tabla temporal de fixtures desde dentro
-- de los DO blocks que corren ya demotados.
GRANT SELECT ON smoke_ids TO authenticated;

-- ---------------------------------------------------------------------
-- Bloque 1 — espacio withTenantContext: app.current_org_id = org_a,
-- demotado a `authenticated` (igual que packages/trpc/src/rls-context.ts).
-- ---------------------------------------------------------------------

SELECT public.set_tenant_context(
  gen_random_uuid(),
  (SELECT value FROM smoke_ids WHERE key = 'org_a'),
  false
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_org_a   uuid := (SELECT value FROM smoke_ids WHERE key = 'org_a');
  v_org_b   uuid := (SELECT value FROM smoke_ids WHERE key = 'org_b');
  v_estab_a uuid := (SELECT value FROM smoke_ids WHERE key = 'estab_a');
  v_estab_b uuid := (SELECT value FROM smoke_ids WHERE key = 'estab_b');
  v_task_a  uuid;
BEGIN
  -- 1a. INSERT propio (org A) vía withTenantContext: debe funcionar.
  INSERT INTO public."CareTask" (
    "organizationId", "establishmentId", "assignedRoleCode",
    "sourceType", "sourceId", "taskType", title, "createdBy"
  ) VALUES (
    v_org_a, v_estab_a, 'NURSE',
    'MANUAL', gen_random_uuid(), 'SMOKE_TEST',
    'Tarea smoke 209 (org A, tenant context)', gen_random_uuid()
  ) RETURNING id INTO v_task_a;

  -- 1b. SELECT ve la tarea propia.
  IF NOT EXISTS (SELECT 1 FROM public."CareTask" WHERE id = v_task_a) THEN
    RAISE EXCEPTION 'FAIL 1b) CareTask propia (org A, tenant context) no visible tras INSERT.';
  END IF;

  -- 1c. INSERT cruzado (organizationId de org B mientras el GUC activo es
  -- org A): debe ser rechazado por la policy WITH CHECK.
  BEGIN
    INSERT INTO public."CareTask" (
      "organizationId", "establishmentId", "assignedRoleCode",
      "sourceType", "sourceId", "taskType", title, "createdBy"
    ) VALUES (
      v_org_b, v_estab_b, 'NURSE',
      'MANUAL', gen_random_uuid(), 'SMOKE_TEST',
      'Tarea smoke 209 (cruzada, debe fallar)', gen_random_uuid()
    );
    RAISE EXCEPTION 'FAIL 1c) INSERT cruzado (org B) bajo contexto tenant org A debió ser rechazado y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK 1c) INSERT cruzado correctamente rechazado (withTenantContext).';
  END;

  -- 1d. UPDATE propio: debe funcionar.
  UPDATE public."CareTask" SET status = 'EN_PROCESO' WHERE id = v_task_a;
  IF (SELECT status FROM public."CareTask" WHERE id = v_task_a) <> 'EN_PROCESO' THEN
    RAISE EXCEPTION 'FAIL 1d) UPDATE propio (tenant context) no persistió.';
  END IF;

  -- 1e. DELETE: sin policy y sin GRANT (D1 — las tareas se cancelan, no se
  -- borran) — debe ser rechazado incluso sobre la fila propia.
  BEGIN
    DELETE FROM public."CareTask" WHERE id = v_task_a;
    RAISE EXCEPTION 'FAIL 1e) DELETE debió ser rechazado (sin policy/GRANT) y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK 1e) DELETE correctamente rechazado.';
  END;

  RAISE NOTICE 'OK bloque 1 (withTenantContext) — INSERT/SELECT/UPDATE propios OK, INSERT cruzado y DELETE rechazados.';
END $$;

-- ---------------------------------------------------------------------
-- Bloque 2 — espacio withEceContext: app.ece_personal_id /
-- app.ece_establecimiento_id, SIN app.current_org_id — el espacio real que
-- usa `firmar()` en indicaciones-medicas.router.ts (ver docstring de
-- sql/209 — "la trampa de los dos espacios de GUC").
--
-- RESET ROLE vuelve al rol de conexión (BYPASSRLS) para poder limpiar el
-- contexto tenant y setear el contexto ECE exactamente en el mismo orden
-- que withEceContext real: set_ece_context() con el rol original, DESPUÉS
-- demota a authenticated.
-- ---------------------------------------------------------------------

RESET ROLE;
SELECT public.clear_tenant_context();
SELECT ece.set_ece_context(
  gen_random_uuid(),
  (SELECT value FROM smoke_ids WHERE key = 'ece_estab')
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_org_a    uuid := (SELECT value FROM smoke_ids WHERE key = 'org_a');
  v_org_b    uuid := (SELECT value FROM smoke_ids WHERE key = 'org_b');
  v_estab_a  uuid := (SELECT value FROM smoke_ids WHERE key = 'estab_a');
  v_estab_b  uuid := (SELECT value FROM smoke_ids WHERE key = 'estab_b');
  v_task_ece uuid;
  v_guc_org  uuid;
BEGIN
  -- Precondición: si app.current_org_id quedara seteado, este bloque
  -- probaría la rama withTenantContext otra vez, no la rama ECE.
  v_guc_org := public.current_org_id();
  IF v_guc_org IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 2) precondición: app.current_org_id no quedó limpio (%) — el bloque no aislaría la rama ECE.', v_guc_org;
  END IF;

  -- 2a. INSERT propio (org A) bajo withEceContext puro: solo puede
  -- funcionar vía la rama ECE de current_org_id_or_ece_context(), porque
  -- current_org_id() es NULL en este contexto.
  INSERT INTO public."CareTask" (
    "organizationId", "establishmentId", "assignedRoleCode",
    "sourceType", "sourceId", "taskType", title, "createdBy"
  ) VALUES (
    v_org_a, v_estab_a, 'NURSE',
    'INDICACION_ITEM', gen_random_uuid(), 'SIGNOS_VITALES',
    'Tarea smoke 209 (org A, ece context — patrón firmar())', gen_random_uuid()
  ) RETURNING id INTO v_task_ece;

  IF NOT EXISTS (SELECT 1 FROM public."CareTask" WHERE id = v_task_ece) THEN
    RAISE EXCEPTION 'FAIL 2a) CareTask (org A, ece context) no visible tras INSERT — el resolver dual-GUC no funcionó.';
  END IF;
  RAISE NOTICE 'OK 2a) INSERT+SELECT bajo withEceContext puro (sin app.current_org_id) funcionan vía current_org_id_or_ece_context().';

  -- 2b. INSERT cruzado (org B mientras el establecimiento ECE activo
  -- resuelve a org A): debe ser rechazado.
  BEGIN
    INSERT INTO public."CareTask" (
      "organizationId", "establishmentId", "assignedRoleCode",
      "sourceType", "sourceId", "taskType", title, "createdBy"
    ) VALUES (
      v_org_b, v_estab_b, 'NURSE',
      'MANUAL', gen_random_uuid(), 'SMOKE_TEST',
      'Tarea smoke 209 (cruzada bajo ece context, debe fallar)', gen_random_uuid()
    );
    RAISE EXCEPTION 'FAIL 2b) INSERT cruzado (org B) bajo contexto ECE de org A debió ser rechazado y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK 2b) INSERT cruzado correctamente rechazado (withEceContext).';
  END;

  -- 2c. UPDATE propio bajo ece context: debe funcionar (relevante para el
  -- futuro router de tableros si alguna acción de tablero corre bajo
  -- withEceContext en vez de withTenantContext).
  UPDATE public."CareTask" SET status = 'CUMPLIDA', "completedAt" = now() WHERE id = v_task_ece;
  IF (SELECT status FROM public."CareTask" WHERE id = v_task_ece) <> 'CUMPLIDA' THEN
    RAISE EXCEPTION 'FAIL 2c) UPDATE bajo ece context no persistió.';
  END IF;

  RAISE NOTICE 'OK bloque 2 (withEceContext) — INSERT/SELECT/UPDATE propios OK vía resolver dual-GUC, INSERT cruzado rechazado.';
END $$;

DO $$
BEGIN
  RAISE NOTICE 'SMOKE 209: TODAS LAS ASERCIONES PASARON.';
END $$;

-- Nada de lo anterior persiste — fixtures, tareas insertadas y los GUC de
-- contexto quedan descartados junto con la transacción.
ROLLBACK;
