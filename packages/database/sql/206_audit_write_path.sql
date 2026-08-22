-- =============================================================================
-- 206 — P0-0: camino de escritura para audit."AuditLog" desde el rol demotado
-- =============================================================================
-- Hallazgo (verificado en prod 2026-08-22):
--   has_table_privilege('authenticated','audit."AuditLog"','INSERT') = false
--   única policy sobre audit."AuditLog": auditlog_tenant_select (solo SELECT)
--   public."DomainEvent" = 0 filas — el outbox NUNCA se completó de punta a
--     punta: `emitDomainEvent` (packages/database/src/outbox/emit.ts) hace
--     `tx.domainEvent.create(...)` (esto SÍ funciona bajo `authenticated` —
--     `domain_event_tenant_insert` ya trae WITH CHECK organizationId =
--     current_org_id(), ver abajo) seguido de `tx.auditLog.create(...)`
--     DENTRO de la misma transacción. El segundo INSERT revierte TODO
--     porque `authenticated` no tiene grant, y con él se pierde también el
--     DomainEvent que sí se había insertado.
--
-- Por qué esto NO es un GRANT simple:
--   audit."AuditLog" es la cadena de hash inmutable del TDR §6.3 (prevHash →
--   signatureHash, trigger `audit.fn_audit_log_chain` en 05_audit_hash_chain.sql,
--   retención 10 años). `authenticated` es UN SOLO rol de Postgres compartido
--   por TODOS los usuarios logueados de TODAS las organizaciones — no hay un
--   rol por usuario. Un GRANT INSERT abierto (aunque acotado con policy
--   WITH CHECK organizationId=current_org_id()) deja que cualquier código que
--   corra demotado escriba una fila de auditoría con CUALQUIER userId,
--   action, entity, entityId, beforeJson/afterJson — es decir, firmar una
--   entrada de auditoría a nombre de otro usuario, o forjar la prueba de un
--   evento que no ocurrió. La cadena de hash seguiría verificando (el trigger
--   `fn_audit_log_chain` calcula signatureHash sobre el contenido que sea,
--   venga de donde venga) — "verifica" no es lo mismo que "es verdad".
--
-- Opciones evaluadas (detalle completo en el informe @DBA — no se repite
-- aquí para no duplicar la fuente de verdad, ver mensaje de handoff):
--   A. GRANT INSERT + policy WITH CHECK acotada a organizationId.
--      Descartada: cierra el aislamiento de tenant pero NO cierra la
--      suplantación de identidad (userId) ni la fabricación de contenido
--      (action/entity/beforeJson/afterJson) — dos vectores de forjado que sí
--      importan en una cadena de auditoría cuyo propósito es atribución.
--   B. (ELEGIDA) Función SECURITY DEFINER que recibe el payload y hace ella
--      misma el INSERT en audit."AuditLog", derivando/validando identidad y
--      tenant desde el contexto de sesión (GUC) en vez de confiar en
--      parámetros del caller. `authenticated` recibe EXECUTE sobre la
--      función, NUNCA INSERT sobre la tabla. Mismo patrón de la codebase que
--      `audit.fn_audit_row()` (CDC) y los helpers de Vault
--      (`set_portal_mfa_secret_vault`) — SECURITY DEFINER + `SET search_path`
--      fijo + validación explícita del argumento sensible.
--   C. Generalizar el patrón de `encounter-discharge.router.ts` (mover el
--      audit fuera de la transacción demotada, bajo el rol bypass).
--      Descartada como solución GENERAL para `emitDomainEvent`: ese helper
--      es compartido por decenas de call-sites dentro de transacciones de
--      negocio arbitrarias (ver JSDoc de emit.ts — "outbox atómico" es la
--      garantía documentada). Sacar el audit fuera de la tx rompe esa
--      garantía para TODOS los emisores de eventos de dominio, no solo para
--      el caso puntual de epicrisis — y no hay mecanismo de reconciliación
--      si el proceso muere entre el INSERT del evento y el del audit.
--
-- Garantía que se conserva con B: atomicidad completa (la función corre
-- DENTRO de la misma transacción demotada que ya inserta el DomainEvent;
-- si la transacción de negocio revierte, la fila de auditoría también).
-- Identidad no forjable (userId sale de public.current_user_id(), nunca de
-- un parámetro). Tenant no forjable (organizationId del parámetro DEBE
-- coincidir con current_org_id() de la sesión). Cadena de hash intacta (el
-- INSERT real pasa por `trg_auditlog_chain` igual que cualquier otro).
--
-- Garantía que NO cambia (ya era así): el contenido de negocio (entity,
-- entityId, justification, beforeJson/afterJson) sigue siendo el que arma
-- la capa de aplicación — mismo nivel de confianza que cualquier INSERT que
-- la app ya hace hoy en tablas protegidas por RLS con policy WITH CHECK
-- (p.ej. Encounter, DomainEvent). Esta función no es CDC (no deriva el
-- contenido de una fila real como `fn_audit_row`); es el equivalente
-- SECURITY DEFINER de una entrada de auditoría "manual" — el mismo tipo de
-- entrada que hoy escribe `emitDomainEvent` y que
-- `encounter-discharge.router.ts` escribe para la epicrisis.
--
-- Cambio en emit.ts requerido (NO incluido en este archivo — lo coordina
-- el frente que toca TypeScript):
--   Reemplazar el bloque `await tx.auditLog.create({ data: {...} })`
--   (packages/database/src/outbox/emit.ts líneas ~121-130) por una llamada a
--   esta función vía `$queryRaw`/`$executeRaw`, p.ej.:
--     await tx.$executeRaw`
--       SELECT audit.fn_write_manual_audit_entry(
--         ${input.organizationId}::uuid, 'CREATE'::public."AuditAction",
--         'DomainEvent', ${created.id},
--         ${`DOMAIN_EVENT_EMITTED:${input.eventType}`}, NULL, NULL, NULL
--       )`;
--   El resto de `emitDomainEvent` (validación Zod, `tx.domainEvent.create`,
--   payloadHash) NO cambia — ese INSERT ya funciona bajo `authenticated`
--   gracias a `domain_event_tenant_insert`.
-- =============================================================================

CREATE OR REPLACE FUNCTION audit.fn_write_manual_audit_entry(
  p_organization_id  uuid,
  p_action            public."AuditAction",
  p_entity            text,
  p_entity_id         text,
  p_justification     text DEFAULT NULL,
  p_before_json       jsonb DEFAULT NULL,
  p_after_json        jsonb DEFAULT NULL,
  p_establishment_id  uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, audit, pg_catalog
AS $$
DECLARE
  v_session_org_id uuid;
  v_user_id        uuid;
  v_ip             inet;
  v_user_agent     text;
  v_new_id         bigint;
BEGIN
  IF p_entity IS NULL OR p_entity_id IS NULL THEN
    RAISE EXCEPTION 'audit.fn_write_manual_audit_entry: entity/entityId son obligatorios';
  END IF;

  -- Tenant: la función es el ÚNICO camino de escritura del rol demotado, y
  -- exige contexto de sesión activo (set_tenant_context) — no se admite
  -- invocarla "a secas" para colarse sin haber pasado por withTenantContext.
  v_session_org_id := public.current_org_id();
  IF v_session_org_id IS NULL THEN
    RAISE EXCEPTION
      'audit.fn_write_manual_audit_entry: requiere contexto de tenant activo (app.current_org_id) — llamar dentro de withTenantContext.';
  END IF;
  IF p_organization_id IS NULL OR v_session_org_id <> p_organization_id THEN
    RAISE EXCEPTION
      'audit.fn_write_manual_audit_entry: organizationId (%) no coincide con el tenant de la sesión (%)',
      p_organization_id, v_session_org_id;
  END IF;

  -- Identidad: SIEMPRE se deriva de la sesión, nunca de un parámetro del
  -- caller — cierra el vector "authenticated firma una entrada a nombre de
  -- otro usuario". Mismo criterio que audit.fn_audit_row().
  v_user_id    := public.current_user_id();
  v_ip         := nullif(current_setting('request.headers.x-forwarded-for', true), '')::inet;
  v_user_agent := nullif(current_setting('request.headers.user-agent', true), '');

  INSERT INTO audit."AuditLog" (
    "occurredAt", "userId", "organizationId", "establishmentId",
    "ip", "userAgent", "action", "entity", "entityId",
    "beforeJson", "afterJson", "justification"
  )
  VALUES (
    now(), v_user_id, p_organization_id, p_establishment_id,
    v_ip, v_user_agent, p_action, p_entity, p_entity_id,
    p_before_json, p_after_json, p_justification
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION audit.fn_write_manual_audit_entry(
  uuid, public."AuditAction", text, text, text, jsonb, jsonb, uuid
) IS
  'P0-0 (206) — único camino de escritura para audit.AuditLog desde el rol '
  'demotado authenticated. SECURITY DEFINER: userId sale de '
  'public.current_user_id() (nunca de un parámetro — no falsificable) y '
  'organizationId debe coincidir con public.current_org_id() de la sesión '
  '(no falsificable el tenant). authenticated NO tiene GRANT INSERT directo '
  'sobre audit."AuditLog" — solo EXECUTE sobre esta función.';

-- authenticated recibe EXECUTE sobre la función — nada de PUBLIC (a
-- diferencia de audit.fn_audit_chat_message, que quedó con EXECUTE a PUBLIC
-- como efecto colateral de CREATE FUNCTION sin REVOKE explícito; no se
-- corrige aquí por estar fuera de alcance de este archivo, pero esta función
-- nueva no repite ese patrón).
REVOKE ALL ON FUNCTION audit.fn_write_manual_audit_entry(
  uuid, public."AuditAction", text, text, text, jsonb, jsonb, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION audit.fn_write_manual_audit_entry(
  uuid, public."AuditAction", text, text, text, jsonb, jsonb, uuid
) TO authenticated;

-- Defensa en profundidad explícita y documentada: `authenticated` NUNCA debe
-- tener INSERT directo sobre audit."AuditLog" — verificado en prod que hoy
-- no lo tiene (ver hallazgo arriba); este REVOKE deja constancia de la
-- intención y es idempotente/seguro de re-correr si algún script futuro
-- otorgara el grant por error.
REVOKE INSERT ON audit."AuditLog" FROM authenticated;

-- =============================================================================
-- Verificación manual post-apply (además del smoke transaccional en
-- __tests__/206_audit_write_path_smoke.sql):
--   select has_table_privilege('authenticated','audit."AuditLog"','INSERT');
--   -- esperado: false
--   select has_function_privilege('authenticated',
--     'audit.fn_write_manual_audit_entry(uuid,public."AuditAction",text,text,text,jsonb,jsonb,uuid)',
--     'EXECUTE');
--   -- esperado: true
-- =============================================================================
