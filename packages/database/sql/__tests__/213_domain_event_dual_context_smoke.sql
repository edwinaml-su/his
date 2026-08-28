-- =====================================================================
-- 213_domain_event_dual_context_smoke.sql
-- Smoke test transaccional de 213_domain_event_dual_context.sql.
--
-- Requiere que 213_domain_event_dual_context.sql YA esté aplicado en la
-- sesión/BD contra la que se corre este archivo. Corre 100% dentro de UNA
-- transacción que termina en ROLLBACK — no persiste ninguna fila.
--
-- Uso:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/213_domain_event_dual_context.sql
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/__tests__/213_domain_event_dual_context_smoke.sql
--
-- Falla ruidosamente (RAISE EXCEPTION, aborta la transacción) ante
-- cualquier aserción incumplida — no hay asserts silenciosos.
--
-- Qué verifica, reproduciendo los DOS espacios de GUC reales del proyecto
-- (mismo patrón que 209_cc0026_care_task_smoke.sql):
--   Bloque 1 — withTenantContext (app.current_org_id): INSERT propio en
--     DomainEvent funciona, INSERT cruzado (otra org) rechazado, y
--     fn_write_manual_audit_entry inserta en audit."AuditLog" bajo el rol
--     demotado.
--   Bloque 2 — withEceContext puro (app.ece_establecimiento_id, SIN
--     app.current_org_id) — el espacio real de la mayoría de call-sites de
--     emitDomainEvent (ver cabecera de 213). Confirma que
--     current_org_id() da NULL (si no, el bloque no probaría nada), y que
--     TANTO el INSERT en DomainEvent COMO fn_write_manual_audit_entry
--     funcionan igual vía current_org_id_or_ece_context() — este es
--     exactamente el flujo que antes de 213 revertía la transacción
--     completa (insufficient_privilege en el INSERT de DomainEvent, o en
--     el INSERT directo a AuditLog si (A) se hubiera resuelto solo).
-- =====================================================================

BEGIN;

CREATE TEMP TABLE smoke_ids (
  key   text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

-- Fixtures — mismo criterio que 209: reutiliza una fila real de
-- ece.establecimiento con establishment_id poblado (linkage HIS<->ECE), más
-- una segunda organización para las aserciones de aislamiento cross-tenant.

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

INSERT INTO smoke_ids (key, value) VALUES ('user_a', gen_random_uuid());

DO $$
BEGIN
  IF (SELECT count(*) FROM smoke_ids WHERE key IN ('estab_a', 'org_a', 'org_b')) < 3 THEN
    RAISE EXCEPTION
      'Smoke test requiere 2 organizaciones con al menos 1 Establishment cada '
      'una — no encontradas. Abortando.';
  END IF;
END $$;

GRANT SELECT ON smoke_ids TO authenticated;

-- Checkpoint de la cadena de auditoría ANTES de escribir nada.
CREATE TEMP TABLE smoke_chain_checkpoint AS
SELECT coalesce(max(id), 0) AS last_id FROM audit."AuditLog";

GRANT SELECT ON smoke_chain_checkpoint TO authenticated;

-- ---------------------------------------------------------------------
-- Bloque 1 — espacio withTenantContext: app.current_org_id = org_a,
-- demotado a `authenticated`.
-- ---------------------------------------------------------------------

SELECT public.set_tenant_context(
  (SELECT value FROM smoke_ids WHERE key = 'user_a'),
  (SELECT value FROM smoke_ids WHERE key = 'org_a'),
  false
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_org_a   uuid := (SELECT value FROM smoke_ids WHERE key = 'org_a');
  v_org_b   uuid := (SELECT value FROM smoke_ids WHERE key = 'org_b');
  v_user_a  uuid := (SELECT value FROM smoke_ids WHERE key = 'user_a');
  v_evt_a   uuid;
  v_audit_id bigint;
BEGIN
  -- 1a. INSERT propio (org A) vía withTenantContext: debe funcionar.
  INSERT INTO public."DomainEvent" (
    "organizationId", "eventType", "aggregateType", "aggregateId",
    payload, "payloadHash", "emittedById"
  ) VALUES (
    v_org_a, 'smoke.213.tenant_context', 'SmokeTest', gen_random_uuid(),
    '{"smoke":true}'::jsonb, 'smoke-hash-1', v_user_a
  ) RETURNING id INTO v_evt_a;

  IF NOT EXISTS (SELECT 1 FROM public."DomainEvent" WHERE id = v_evt_a) THEN
    RAISE EXCEPTION 'FAIL 1a) DomainEvent propio (org A, tenant context) no visible tras INSERT.';
  END IF;

  -- 1b. INSERT cruzado (organizationId de org B mientras el GUC activo es
  -- org A): debe ser rechazado por la policy WITH CHECK.
  BEGIN
    INSERT INTO public."DomainEvent" (
      "organizationId", "eventType", "aggregateType", "aggregateId",
      payload, "payloadHash"
    ) VALUES (
      v_org_b, 'smoke.213.cruzado', 'SmokeTest', gen_random_uuid(),
      '{"smoke":true}'::jsonb, 'smoke-hash-cruzado'
    );
    RAISE EXCEPTION 'FAIL 1b) INSERT cruzado (org B) bajo contexto tenant org A debió ser rechazado y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK 1b) INSERT cruzado correctamente rechazado (withTenantContext).';
  END;

  -- 1c. fn_write_manual_audit_entry funciona bajo este espacio (ya lo
  -- cubría 206; confirma que 213 no lo rompió).
  SELECT audit.fn_write_manual_audit_entry(
    v_org_a, 'CREATE'::public."AuditAction",
    'DomainEvent', v_evt_a::text,
    'DOMAIN_EVENT_EMITTED:smoke.213.tenant_context', NULL, NULL, NULL
  ) INTO v_audit_id;

  IF v_audit_id IS NULL THEN
    RAISE EXCEPTION 'FAIL 1c) fn_write_manual_audit_entry (tenant context) no devolvió id.';
  END IF;

  RAISE NOTICE 'OK bloque 1 (withTenantContext) — INSERT propio + audit OK, INSERT cruzado rechazado.';
END $$;

-- ---------------------------------------------------------------------
-- Bloque 2 — espacio withEceContext puro: app.ece_establecimiento_id,
-- SIN app.current_org_id — el espacio real de la mayoría de call-sites de
-- emitDomainEvent (ver cabecera de 213).
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
  v_evt_ece  uuid;
  v_audit_id bigint;
  v_guc_org  uuid;
BEGIN
  -- Precondición: si app.current_org_id quedara seteado, este bloque
  -- probaría la rama withTenantContext otra vez, no la rama ECE.
  v_guc_org := public.current_org_id();
  IF v_guc_org IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 2) precondición: app.current_org_id no quedó limpio (%) — el bloque no aislaría la rama ECE.', v_guc_org;
  END IF;

  -- 2a. INSERT propio (org A) bajo withEceContext puro: antes de 213, esto
  -- reventaba con insufficient_privilege (domain_event_tenant_insert exigía
  -- current_org_id(), NULL en este contexto).
  INSERT INTO public."DomainEvent" (
    "organizationId", "eventType", "aggregateType", "aggregateId",
    payload, "payloadHash"
  ) VALUES (
    v_org_a, 'smoke.213.ece_context', 'SmokeTest', gen_random_uuid(),
    '{"smoke":true}'::jsonb, 'smoke-hash-ece'
  ) RETURNING id INTO v_evt_ece;

  IF NOT EXISTS (SELECT 1 FROM public."DomainEvent" WHERE id = v_evt_ece) THEN
    RAISE EXCEPTION 'FAIL 2a) DomainEvent (org A, ece context) no visible tras INSERT — el resolver dual-GUC no funcionó.';
  END IF;
  RAISE NOTICE 'OK 2a) INSERT en DomainEvent bajo withEceContext puro funciona vía current_org_id_or_ece_context().';

  -- 2b. INSERT cruzado (org B mientras el establecimiento ECE activo
  -- resuelve a org A): debe ser rechazado.
  BEGIN
    INSERT INTO public."DomainEvent" (
      "organizationId", "eventType", "aggregateType", "aggregateId",
      payload, "payloadHash"
    ) VALUES (
      v_org_b, 'smoke.213.cruzado_ece', 'SmokeTest', gen_random_uuid(),
      '{"smoke":true}'::jsonb, 'smoke-hash-cruzado-ece'
    );
    RAISE EXCEPTION 'FAIL 2b) INSERT cruzado (org B) bajo contexto ECE de org A debió ser rechazado y no lo fue.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK 2b) INSERT cruzado correctamente rechazado (withEceContext).';
  END;

  -- 2c. fn_write_manual_audit_entry bajo contexto ECE puro: antes de 213,
  -- la sonda de emit.ts habría caído a la rama "rol privilegiado" (INSERT
  -- directo a AuditLog) y reventado con insufficient_privilege porque el
  -- rol SÍ está demotado aquí. Con 213, la función misma resuelve el
  -- tenant vía current_org_id_or_ece_context() y funciona igual que en
  -- el espacio withTenantContext.
  SELECT audit.fn_write_manual_audit_entry(
    v_org_a, 'CREATE'::public."AuditAction",
    'DomainEvent', v_evt_ece::text,
    'DOMAIN_EVENT_EMITTED:smoke.213.ece_context', NULL, NULL, NULL
  ) INTO v_audit_id;

  IF v_audit_id IS NULL THEN
    RAISE EXCEPTION 'FAIL 2c) fn_write_manual_audit_entry (ece context) no devolvió id — el outbox seguiría revirtiendo bajo este espacio.';
  END IF;
  RAISE NOTICE 'OK 2c) fn_write_manual_audit_entry funciona bajo withEceContext puro vía current_org_id_or_ece_context().';

  -- 2d. Sigue exigiendo ALGÚN contexto — organizationId ajeno al resuelto
  -- por el espacio ECE activo (org B) debe ser rechazado igual que en el
  -- espacio tenant (2b de 206_audit_write_path_smoke.sql).
  BEGIN
    PERFORM audit.fn_write_manual_audit_entry(
      v_org_b, 'CREATE'::public."AuditAction",
      'DomainEvent', 'smoke-213-forged-org',
      'intento de forjar auditoria de otra organizacion (ece context)', NULL, NULL, NULL
    );
    RAISE EXCEPTION 'FAIL 2d) fn_write_manual_audit_entry con organizationId ajeno (ece context): debió ser rechazado y no lo fue.';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%no coincide con el tenant de la sesión%' THEN
        RAISE EXCEPTION 'FAIL 2d) excepción inesperada al forjar organizationId ajeno (ece context): %', SQLERRM;
      END IF;
      RAISE NOTICE 'OK 2d) fn_write_manual_audit_entry rechaza organizationId ajeno también bajo contexto ECE.';
  END;

  RAISE NOTICE 'OK bloque 2 (withEceContext) — INSERT DomainEvent + audit OK vía resolver dual-GUC, casos cruzados rechazados.';
END $$;

DO $$
BEGIN
  RAISE NOTICE 'SMOKE 213: TODAS LAS ASERCIONES PASARON.';
END $$;

-- Nada de lo anterior persiste — fixtures, eventos/auditoría insertados y
-- los GUC de contexto quedan descartados junto con la transacción.
ROLLBACK;
