-- =============================================================================
-- 197 — OWASP A09:2025 (Security Logging and Alerting Failures)
-- =============================================================================
-- Hallazgo A09-P1 del pentest 2026-05-30: el historial del copiloto de IA
-- (`chat_session`, `chat_message`) no entra en la cadena criptográfica de
-- auditoría. Son consultas clínicas hechas por personal identificado, con
-- contexto de paciente y fuentes RAG recuperadas: si mañana hay que reconstruir
-- qué sugirió la IA en una decisión asistencial, hoy no hay rastro inmutable.
--
-- Dos partes:
--   1. `audit.fn_audit_row()` aprende a leer columnas snake_case. Fue escrita
--      para las tablas que genera Prisma (`"organizationId"` entrecomillado);
--      las tablas creadas a mano en SQL usan `organization_id` y por eso
--      quedaban con `organizationId = NULL` en la auditoría. Cambio aditivo:
--      sólo aplica el fallback cuando la clave camelCase no existe.
--   2. Se enganchan los triggers de auditoría a las dos tablas de chat.
--
-- `chat_knowledge_chunk` NO se audita: es el índice de conocimiento (contenido
-- de la propia app, sin PHI de paciente) y se regenera por lotes — auditarlo
-- sería ruido de miles de filas por reindexación.
-- =============================================================================

CREATE OR REPLACE FUNCTION audit.fn_audit_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, audit
AS $$
DECLARE
  v_action       "AuditAction";
  v_before       jsonb;
  v_after        jsonb;
  v_entity_id    text;
  v_org_id       uuid;
  v_user_id      uuid;
  v_estab_id     uuid;
  v_ip           inet;
  v_user_agent   text;
  v_just         text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action  := 'CREATE'::"AuditAction";
    v_before  := NULL;
    v_after   := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action  := 'UPDATE'::"AuditAction";
    v_before  := to_jsonb(OLD);
    v_after   := to_jsonb(NEW);
    -- Optimización: no auditar updates idempotentes.
    IF v_before = v_after THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_action  := 'DELETE'::"AuditAction";
    v_before  := to_jsonb(OLD);
    v_after   := NULL;
  END IF;

  v_entity_id := coalesce(
    (v_after->>'id'),
    (v_before->>'id')
  );
  -- camelCase (tablas Prisma) con fallback a snake_case (tablas SQL a mano).
  v_org_id := nullif(coalesce(
    (v_after->>'organizationId'),
    (v_before->>'organizationId'),
    (v_after->>'organization_id'),
    (v_before->>'organization_id')
  ),'')::uuid;
  v_estab_id := nullif(coalesce(
    (v_after->>'establishmentId'),
    (v_before->>'establishmentId'),
    (v_after->>'establishment_id'),
    (v_before->>'establishment_id')
  ),'')::uuid;

  v_user_id    := public.current_user_id();
  v_ip         := nullif(current_setting('request.headers.x-forwarded-for', true), '')::inet;
  v_user_agent := nullif(current_setting('request.headers.user-agent', true), '');
  v_just       := nullif(current_setting('app.justification', true), '');

  INSERT INTO audit."AuditLog" (
    "occurredAt","userId","organizationId","establishmentId",
    "ip","userAgent","action","entity","entityId",
    "beforeJson","afterJson","justification"
  )
  VALUES (
    now(), v_user_id, v_org_id, v_estab_id,
    v_ip, v_user_agent, v_action, TG_TABLE_NAME, v_entity_id,
    v_before, v_after, v_just
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_chat_session ON public.chat_session;
CREATE TRIGGER trg_audit_chat_session
  AFTER INSERT OR UPDATE OR DELETE ON public.chat_session
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();

DROP TRIGGER IF EXISTS trg_audit_chat_message ON public.chat_message;
CREATE TRIGGER trg_audit_chat_message
  AFTER INSERT OR UPDATE OR DELETE ON public.chat_message
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();

-- =============================================================================
-- Verificación
--   select tgname from pg_trigger
--    where tgrelid = 'public.chat_message'::regclass and not tgisinternal;
--   -- tras un mensaje nuevo:
--   select entity, "entityId", "organizationId" from audit."AuditLog"
--    where entity = 'chat_message' order by "occurredAt" desc limit 5;
-- =============================================================================
