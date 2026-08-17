-- =============================================================================
-- 198 — OWASP A09:2025 (H8, minimización de datos — LOPD/Decreto 143)
-- =============================================================================
-- Hallazgo @AE sobre la remediación 197 (2026-08-17): `audit.fn_audit_row()`
-- copia `to_jsonb(NEW)` completo. Enganchado a `chat_message` (197), eso
-- replica el PROMPT clínico del usuario y la RESPUESTA del modelo dentro de
-- `audit."AuditLog"`, que tiene retención INMUTABLE de 10 años (cadena hash,
-- `05_audit_hash_chain.sql`) — nunca se puede purgar ni corregir. Es PHI
-- duplicada sin fecha de expiración propia, justo lo que el mismo lote de
-- trabajo redactó en los logs de consola (`redactPhi`, `log-redact.ts`).
--
-- Esta migración reemplaza el trigger genérico en `chat_message` por uno
-- dedicado que audita METADATOS, no contenido:
--   - Sustituye `content` por `content_length` (nº de caracteres) + un flag
--     `content_redacted: true`.
--   - Sustituye `tool_calls` (jsonb, puede incluir inputs/outputs de
--     herramientas con datos de paciente) por `tool_calls_count`.
--   - Sustituye `retrieved_sources` (paths RAG, no son PHI en sí, pero se
--     cuentan igual por consistencia) por `retrieved_sources_count`.
--   - Sustituye `feedback_comment` (texto libre que el usuario puede escribir
--     al calificar la respuesta — no estaba en el alcance original del
--     hallazgo, pero es la MISMA clase de dato: texto libre potencialmente
--     con contexto de paciente) por un flag `feedback_comment_redacted`.
--   - Conserva session_id/organization_id/user_id/role/current_path/
--     user_role_codes/tokens_in/tokens_out/latency_ms/user_feedback/created_at
--     — suficiente para reconstruir QUIÉN preguntó QUÉ TIPO de cosa, CUÁNDO,
--     con qué costo — sin el contenido.
--
-- Quién/cuándo/costo queda igual de trazable; el contenido clínico deja de
-- vivir dos veces. La fuente de verdad del contenido sigue siendo la propia
-- `chat_message` (retención gestionada por su propio ciclo de vida, no la
-- cadena de auditoría inmutable).
--
-- `chat_session` NO se toca aquí — sigue en `audit.fn_audit_row()` (trigger
-- genérico de 197). Verificado (2026-08-17): no lleva prompt/respuesta, PERO
-- SÍ tiene `feedback_comment` (texto libre, igual que en `chat_message`) que
-- el trigger genérico seguiría copiando en claro. Se deja fuera del alcance
-- de este SQL — @AE debe decidir si `chat_session` también necesita un
-- trigger dedicado o si el volumen/sensibilidad de ese campo no lo amerita.
-- =============================================================================

CREATE OR REPLACE FUNCTION audit.fn_redact_chat_message(msg public.chat_message)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, audit, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'id', msg.id,
    'session_id', msg.session_id,
    'organization_id', msg.organization_id,
    'user_id', msg.user_id,
    'role', msg.role,
    'current_path', msg.current_path,
    'user_role_codes', to_jsonb(msg.user_role_codes),
    'tokens_in', msg.tokens_in,
    'tokens_out', msg.tokens_out,
    'latency_ms', msg.latency_ms,
    'user_feedback', msg.user_feedback,
    'created_at', msg.created_at,
    'content_redacted', true,
    'content_length', coalesce(length(msg.content), 0),
    'tool_calls_count', coalesce(jsonb_array_length(msg.tool_calls), 0),
    'retrieved_sources_count', coalesce(array_length(msg.retrieved_sources, 1), 0),
    'feedback_comment_redacted', (msg.feedback_comment IS NOT NULL)
  );
$$;

CREATE OR REPLACE FUNCTION audit.fn_audit_chat_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, audit, pg_catalog
AS $$
DECLARE
  v_action     "AuditAction";
  v_before     jsonb;
  v_after      jsonb;
  v_entity_id  text;
  v_org_id     uuid;
  v_user_id    uuid;
  v_ip         inet;
  v_user_agent text;
  v_just       text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action    := 'CREATE'::"AuditAction";
    v_before    := NULL;
    v_after     := audit.fn_redact_chat_message(NEW);
    v_entity_id := NEW.id::text;
    v_org_id    := NEW.organization_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action    := 'UPDATE'::"AuditAction";
    v_before    := audit.fn_redact_chat_message(OLD);
    v_after     := audit.fn_redact_chat_message(NEW);
    -- Igual que fn_audit_row: no auditar updates idempotentes.
    IF v_before = v_after THEN
      RETURN NEW;
    END IF;
    v_entity_id := NEW.id::text;
    v_org_id    := NEW.organization_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_action    := 'DELETE'::"AuditAction";
    v_before    := audit.fn_redact_chat_message(OLD);
    v_after     := NULL;
    v_entity_id := OLD.id::text;
    v_org_id    := OLD.organization_id;
  END IF;

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
    now(), v_user_id, v_org_id, NULL,
    v_ip, v_user_agent, v_action, TG_TABLE_NAME, v_entity_id,
    v_before, v_after, v_just
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Reemplaza el trigger genérico de 197 (fn_audit_row → to_jsonb completo)
-- por el dedicado de arriba. `chat_session` conserva trg_audit_chat_session
-- (fn_audit_row) sin cambios — ver nota de alcance arriba.
DROP TRIGGER IF EXISTS trg_audit_chat_message ON public.chat_message;
CREATE TRIGGER trg_audit_chat_message
  AFTER INSERT OR UPDATE OR DELETE ON public.chat_message
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_chat_message();

-- =============================================================================
-- Verificación
--   select tgname, p.proname from pg_trigger t
--     join pg_proc p on p.oid = t.tgfunction
--    where tgrelid = 'public.chat_message'::regclass and not tgisinternal;
--   -- tras un mensaje nuevo: "afterJson" NO debe tener las keys
--   -- content/tool_calls/retrieved_sources/feedback_comment, solo los
--   -- *_redacted / *_count derivados:
--   select entity, "entityId", "afterJson" from audit."AuditLog"
--    where entity = 'chat_message' order by "occurredAt" desc limit 5;
-- =============================================================================
