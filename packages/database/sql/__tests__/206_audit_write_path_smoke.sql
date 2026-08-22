-- =====================================================================
-- 206_audit_write_path_smoke.sql
-- Smoke test transaccional de 206_audit_write_path.sql.
--
-- Requiere que 206_audit_write_path.sql YA esté aplicado en la sesión/BD
-- contra la que se corre este archivo. Corre 100% dentro de UNA
-- transacción que termina en ROLLBACK — no persiste ninguna fila de
-- audit."AuditLog" (ni las escritas por la vía aprobada, ni los intentos
-- de forjado, que además fallan antes de persistir nada).
--
-- Uso:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/__tests__/206_audit_write_path_smoke.sql
--
-- Falla ruidosamente (RAISE EXCEPTION, aborta la transacción) ante
-- cualquier aserción incumplida — no hay asserts silenciosos.
--
-- Qué verifica:
--   1. Rol demotado (authenticated) PUEDE registrar auditoría por la vía
--      aprobada: audit.fn_write_manual_audit_entry(...) inserta una fila
--      con userId/organizationId derivados de la sesión (no de parámetros).
--   2. NO puede forjar entradas:
--      2a. INSERT directo sobre audit."AuditLog" sigue rechazado (sin
--          GRANT INSERT — el único camino sigue siendo la función).
--      2b. La función rechaza organizationId que no coincide con el tenant
--          de la sesión (no se puede escribir auditoría a nombre de OTRA
--          organización).
--      2c. La función rechaza ejecutarse sin contexto de tenant activo
--          (no se puede colar una llamada "a secas" sin haber pasado por
--          withTenantContext / set_tenant_context).
--      2d. UPDATE/DELETE sobre la fila recién escrita siguen rechazados
--          (append-only, sin GRANT UPDATE/DELETE — ni con el trigger
--          audit.fn_audit_log_immutable de respaldo).
--   3. La cadena de hash sigue verificando: el signatureHash de la fila
--      nueva coincide con audit.fn_compute_chain_hash(fila), y
--      audit.fn_verify_chain(from_id) no reporta filas rotas desde el
--      checkpoint tomado al inicio del test.
-- =====================================================================

BEGIN;

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

INSERT INTO smoke_ids (key, value) VALUES ('user_a', gen_random_uuid());

DO $$
BEGIN
  IF (SELECT count(*) FROM smoke_ids WHERE key IN ('org_a', 'org_b')) < 2 THEN
    RAISE EXCEPTION
      'Smoke test requiere al menos 2 filas en public."Organization" — no encontradas. Abortando.';
  END IF;
END $$;

GRANT SELECT ON smoke_ids TO authenticated;

-- Checkpoint de la cadena ANTES de escribir nada — para acotar
-- fn_verify_chain al tramo que este smoke test realmente toca.
CREATE TEMP TABLE smoke_chain_checkpoint AS
SELECT coalesce(max(id), 0) AS last_id FROM audit."AuditLog";

GRANT SELECT ON smoke_chain_checkpoint TO authenticated;

-- ---------------------------------------------------------------------
-- Contexto: organización A, usuario A, demotado a `authenticated`
-- (igual que withTenantContext en packages/trpc/src/rls-context.ts).
-- ---------------------------------------------------------------------

SELECT public.set_tenant_context(
  (SELECT value FROM smoke_ids WHERE key = 'user_a'),
  (SELECT value FROM smoke_ids WHERE key = 'org_a'),
  false
);
SET LOCAL ROLE authenticated;

-- -----------------------------------------------------------------
-- 1) Vía aprobada: authenticated SÍ puede registrar auditoría.
-- -----------------------------------------------------------------
DO $$
DECLARE
  v_org_a    uuid := (SELECT value FROM smoke_ids WHERE key = 'org_a');
  v_user_a   uuid := (SELECT value FROM smoke_ids WHERE key = 'user_a');
  v_new_id   bigint;
  v_row      audit."AuditLog"%ROWTYPE;
BEGIN
  SELECT audit.fn_write_manual_audit_entry(
    v_org_a, 'CREATE'::public."AuditAction",
    'DomainEvent', 'smoke-206-entity-1',
    'DOMAIN_EVENT_EMITTED:smoke.test', NULL, NULL, NULL
  ) INTO v_new_id;

  IF v_new_id IS NULL THEN
    RAISE EXCEPTION 'FAIL fn_write_manual_audit_entry: no devolvió id.';
  END IF;

  SELECT * INTO v_row FROM audit."AuditLog" WHERE id = v_new_id;

  IF v_row."organizationId" <> v_org_a THEN
    RAISE EXCEPTION 'FAIL organizationId persistido (%) distinto del tenant de sesión (%).', v_row."organizationId", v_org_a;
  END IF;
  IF v_row."userId" <> v_user_a THEN
    RAISE EXCEPTION 'FAIL userId persistido (%) distinto del usuario de sesión (%) — la identidad debe derivarse de la sesión.', v_row."userId", v_user_a;
  END IF;
  IF v_row.entity <> 'DomainEvent' OR v_row."entityId" <> 'smoke-206-entity-1' THEN
    RAISE EXCEPTION 'FAIL entity/entityId no coinciden con lo enviado.';
  END IF;
  IF v_row."signatureHash" IS NULL THEN
    RAISE EXCEPTION 'FAIL signatureHash nulo — el trigger trg_auditlog_chain no corrió.';
  END IF;

  RAISE NOTICE 'OK 1) fn_write_manual_audit_entry inserta bajo authenticated (id=%, org=%, user=%).', v_new_id, v_org_a, v_user_a;

  -- Guarda el id para los pasos 2d)/3) más abajo (custom GUC transaccional).
  PERFORM set_config('smoke.audit_row_id', v_new_id::text, true);
END $$;

-- -----------------------------------------------------------------
-- 2a) INSERT directo sobre audit."AuditLog" sigue rechazado.
-- -----------------------------------------------------------------
DO $$
DECLARE
  v_org_a uuid := (SELECT value FROM smoke_ids WHERE key = 'org_a');
BEGIN
  BEGIN
    INSERT INTO audit."AuditLog" ("organizationId", action, entity, "entityId", justification)
    VALUES (v_org_a, 'CREATE'::public."AuditAction", 'ForgedEntity', 'forged-1', 'intento de forjado directo');
    RAISE EXCEPTION 'FAIL INSERT directo sobre audit."AuditLog": debió ser rechazado y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK 2a) INSERT directo sobre audit."AuditLog" correctamente rechazado (sin GRANT).';
  END;
END $$;

-- -----------------------------------------------------------------
-- 2b) La función rechaza organizationId ajeno al tenant de la sesión
--     (sigue en contexto org A, se intenta escribir a nombre de org B).
-- -----------------------------------------------------------------
DO $$
DECLARE
  v_org_b uuid := (SELECT value FROM smoke_ids WHERE key = 'org_b');
BEGIN
  BEGIN
    PERFORM audit.fn_write_manual_audit_entry(
      v_org_b, 'CREATE'::public."AuditAction",
      'DomainEvent', 'smoke-206-forged-org',
      'intento de forjar auditoria de otra organizacion', NULL, NULL, NULL
    );
    RAISE EXCEPTION 'FAIL fn_write_manual_audit_entry con organizationId ajeno: debió ser rechazado y no lo fue.';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%no coincide con el tenant de la sesión%' THEN
        RAISE EXCEPTION 'FAIL excepción inesperada al forjar organizationId ajeno: %', SQLERRM;
      END IF;
      RAISE NOTICE 'OK 2b) fn_write_manual_audit_entry rechaza organizationId que no coincide con la sesión.';
  END;
END $$;

-- -----------------------------------------------------------------
-- 2c) La función rechaza ejecutarse sin contexto de tenant activo.
-- -----------------------------------------------------------------
DO $$
DECLARE
  v_org_a uuid := (SELECT value FROM smoke_ids WHERE key = 'org_a');
BEGIN
  PERFORM public.clear_tenant_context();

  BEGIN
    PERFORM audit.fn_write_manual_audit_entry(
      v_org_a, 'CREATE'::public."AuditAction",
      'DomainEvent', 'smoke-206-no-context',
      'intento sin contexto de tenant', NULL, NULL, NULL
    );
    RAISE EXCEPTION 'FAIL fn_write_manual_audit_entry sin contexto de tenant: debió ser rechazado y no lo fue.';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%requiere contexto de tenant activo%' THEN
        RAISE EXCEPTION 'FAIL excepción inesperada al llamar sin contexto: %', SQLERRM;
      END IF;
      RAISE NOTICE 'OK 2c) fn_write_manual_audit_entry rechaza llamada sin contexto de tenant.';
  END;

  -- Restaura el contexto para los pasos siguientes.
  PERFORM public.set_tenant_context(
    (SELECT value FROM smoke_ids WHERE key = 'user_a'),
    v_org_a,
    false
  );
END $$;

-- -----------------------------------------------------------------
-- 2d) UPDATE/DELETE sobre la fila recién escrita siguen rechazados
--     (append-only, ni siquiera con la fila creada por la vía aprobada).
-- -----------------------------------------------------------------
DO $$
DECLARE
  v_id bigint := current_setting('smoke.audit_row_id')::bigint;
BEGIN
  BEGIN
    UPDATE audit."AuditLog" SET justification = 'alterado' WHERE id = v_id;
    RAISE EXCEPTION 'FAIL UPDATE sobre fila de auditoría propia: debió ser rechazado y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK 2d) UPDATE sobre audit."AuditLog" correctamente rechazado (append-only).';
  END;

  BEGIN
    DELETE FROM audit."AuditLog" WHERE id = v_id;
    RAISE EXCEPTION 'FAIL DELETE sobre fila de auditoría propia: debió ser rechazado y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK 2d) DELETE sobre audit."AuditLog" correctamente rechazado (append-only).';
  END;
END $$;

-- ---------------------------------------------------------------------
-- 3) Cadena de hash: la fila insertada en el paso 1) verifica, y no hay
--    filas rotas desde el checkpoint tomado antes de escribir nada.
--    Corre con el rol original (bypass) — verificar la cadena no es
--    responsabilidad de `authenticated` en este test.
-- ---------------------------------------------------------------------
RESET ROLE;

DO $$
DECLARE
  v_id       bigint := current_setting('smoke.audit_row_id')::bigint;
  v_row      audit."AuditLog"%ROWTYPE;
  v_expected text;
  v_broken   int;
  v_checkpoint bigint := (SELECT last_id FROM smoke_chain_checkpoint);
BEGIN
  SELECT * INTO v_row FROM audit."AuditLog" WHERE id = v_id;
  v_expected := audit.fn_compute_chain_hash(v_row);

  IF v_row."signatureHash" <> v_expected THEN
    RAISE EXCEPTION 'FAIL cadena de hash: signatureHash persistido (%) no coincide con el recalculado (%) para id=%.',
      v_row."signatureHash", v_expected, v_id;
  END IF;
  RAISE NOTICE 'OK 3) signatureHash de la fila nueva (id=%) verifica contra fn_compute_chain_hash.', v_id;

  SELECT count(*) INTO v_broken FROM audit.fn_verify_chain(v_checkpoint);
  IF v_broken <> 0 THEN
    RAISE EXCEPTION 'FAIL fn_verify_chain desde checkpoint %: reportó % fila(s) rota(s), esperado 0.', v_checkpoint, v_broken;
  END IF;
  RAISE NOTICE 'OK 3) fn_verify_chain desde checkpoint % — 0 filas rotas.', v_checkpoint;

  RAISE NOTICE 'SMOKE 206: TODAS LAS ASERCIONES PASARON.';
END $$;

-- Nada de lo anterior persiste — fixtures, la fila de auditoría escrita
-- por la vía aprobada y el GUC de tenant quedan descartados junto con la
-- transacción. Los intentos de forjado (2a-2c) ya fallaron antes de
-- persistir nada.
ROLLBACK;
