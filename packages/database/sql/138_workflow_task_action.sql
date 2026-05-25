-- =============================================================================
-- 138_workflow_task_action.sql
-- Ola 4 BPM — Tabla de auditoría para acciones sobre tareas del Workflow Inbox.
--
-- Cada acción humana sobre una tarea (reasignar, escalar, completar, comentar,
-- cancelar) queda registrada aquí. Permite:
--   - Trazabilidad: quién, cuándo, por qué, a quién se reasignó
--   - Vista de "Mi equipo": tareas reasignadas a/desde miembros del equipo
--   - Historial: timeline completo de una tarea específica
--   - Notificaciones: detectar tareas escaladas o reasignadas
--
-- NO usa FK al "source" (Prescription/LabOrder/etc.) porque taskId es un
-- string compuesto polimórfico `<type>:<sourceId>`. La trazabilidad real al
-- source vive en el detalle individual de cada tabla origen.
--
-- Aplicada a prod: 2026-05-25 vía MCP (workflow_task_action_2026_05_25).
-- =============================================================================

CREATE TABLE IF NOT EXISTS "WorkflowTaskAction" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT,
  "taskId"        varchar(120) NOT NULL, /// Compuesto: "<TaskType>:<sourceUUID>"
  "taskType"      varchar(60) NOT NULL,  /// TaskType enum (denormalizado para queries)
  action          varchar(40) NOT NULL,  /// REASSIGN | ESCALATE | COMPLETE | COMMENT | CANCEL
  "actorId"       uuid NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "targetUserId"  uuid REFERENCES "User"(id) ON DELETE SET NULL,
  reason          text NOT NULL,
  metadata        jsonb,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wta_action_chk CHECK (action IN ('REASSIGN','ESCALATE','COMPLETE','COMMENT','CANCEL'))
);

CREATE INDEX IF NOT EXISTS idx_wta_org_created
  ON "WorkflowTaskAction" ("organizationId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_wta_task
  ON "WorkflowTaskAction" ("taskId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_wta_actor
  ON "WorkflowTaskAction" ("actorId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_wta_target
  ON "WorkflowTaskAction" ("targetUserId", "createdAt" DESC)
  WHERE "targetUserId" IS NOT NULL;

-- RLS — multi-tenant
ALTER TABLE "WorkflowTaskAction" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wta_tenant ON "WorkflowTaskAction";
CREATE POLICY wta_tenant ON "WorkflowTaskAction"
  FOR ALL TO authenticated
  USING ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid);

COMMENT ON TABLE "WorkflowTaskAction" IS
  'Ola 4 BPM — Auditoría de acciones humanas sobre tareas del Workflow Inbox. taskId es polimórfico (type:sourceId).';
