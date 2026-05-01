-- =============================================================================
-- HIS Multi-país | Triggers de Auditoría
-- TDR §5.5 (regla 3) y §6.3: append-only en audit.AuditLog.
-- Captura before/after en JSONB y mantiene la tabla append-only.
-- =============================================================================

-- 1) Función genérica que escribe la fila de auditoría --------------------
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
  v_org_id := nullif(coalesce(
    (v_after->>'organizationId'),
    (v_before->>'organizationId')
  ),'')::uuid;
  v_estab_id := nullif(coalesce(
    (v_after->>'establishmentId'),
    (v_before->>'establishmentId')
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

-- 2) Función que niega cualquier UPDATE/DELETE sobre AuditLog (append-only)
CREATE OR REPLACE FUNCTION audit.fn_audit_log_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.AuditLog es append-only (TDR §6.3): operación % bloqueada', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_auditlog_no_update ON audit."AuditLog";
CREATE TRIGGER trg_auditlog_no_update
  BEFORE UPDATE OR DELETE OR TRUNCATE ON audit."AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit.fn_audit_log_immutable();

-- 3) Aplicar el trigger genérico a tablas sensibles ----------------------
--    Cobertura MVP: persona, MPI, encuentros, triage, seguridad, ledger.
DO $$
DECLARE
  t text;
  audited text[] := ARRAY[
    'Organization','Establishment','Ledger','ServiceUnit','Bed',
    'User','UserCredential','UserExternalIdentity','Session',
    'Role','Permission','RolePermission','UserOrganizationRole',
    'Patient','PatientIdentifier','PatientAddress','PatientPhone',
    'PatientEmail','PatientEmergencyContact','PatientEthnicity',
    'PatientReligion','PatientLanguage','PatientAllergy','PatientConsent',
    'PatientMerge',
    'Encounter','BedAssignment','EncounterTransfer',
    'TriageLevel','TriageFlowchart','TriageDiscriminator',
    'TriageFlowchartVitalSign','TriageEvaluation','TriageVitalSign',
    'TriageDiscriminatorHit'
  ];
BEGIN
  FOREACH t IN ARRAY audited LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%I
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row()',
      t, t
    );
  END LOOP;
END$$;

-- 4) Trigger reforzado: break-glass exige justificación obligatoria -------
CREATE OR REPLACE FUNCTION public.fn_require_break_glass_justification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF public.is_break_glass()
     AND nullif(current_setting('app.justification', true), '') IS NULL THEN
    RAISE EXCEPTION 'break-the-glass requiere justificación (TDR §6.2)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_patient_break_glass ON public."Patient";
CREATE TRIGGER trg_patient_break_glass
  BEFORE SELECT OR UPDATE OR DELETE ON public."Patient"
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_require_break_glass_justification();
-- Nota: BEFORE SELECT no existe en Postgres; se reemplaza por chequeo en
-- la capa de aplicación (middleware) que setea app.justification antes del SELECT.
-- El trigger anterior solo aplica a UPDATE/DELETE.
DROP TRIGGER IF EXISTS trg_patient_break_glass ON public."Patient";
CREATE TRIGGER trg_patient_break_glass
  BEFORE UPDATE OR DELETE ON public."Patient"
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_require_break_glass_justification();

-- 5) Trigger de soft-delete: bloquea DELETE físico en Patient -------------
CREATE OR REPLACE FUNCTION public.fn_block_hard_delete_patient()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'HCE no permite eliminación física (TDR §5.5 regla 7). Use deletedAt.';
END;
$$;

DROP TRIGGER IF EXISTS trg_patient_no_hard_delete ON public."Patient";
CREATE TRIGGER trg_patient_no_hard_delete
  BEFORE DELETE ON public."Patient"
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_hard_delete_patient();
