-- =============================================================================
-- 251_lab_sla_config_supervision.sql — Supervisión de laboratorio con SLA
-- parametrizable (extensión CC-0040, pedido Edwin 2026-09-18)
--
-- Laboratorio atiende pacientes hospitalarios Y ambulatorios; cada examen
-- solicitado genera una CareTask trackeable (sourceType LAB_ORDER_ITEM) para
-- el tablero de supervisión. El SLA por prioridad deja de estar hardcodeado
-- (SLA_MINUTES_BY_MOCKUP en order-consumer.ts) y se parametriza por tenant:
--
--   LabSlaConfig(organizationId, priority) → slaMinutes + warningMinutes
--
-- Fallback en código cuando no hay fila: STAT 60' / URGENT 240' /
-- ROUTINE 1440' (mismos valores que el hardcode que reemplaza) con
-- warning 30'. El watchdog caretask_sla_watchdog (sql/238b) consume
-- CareTask.slaMinutes/dueAt como siempre — las tareas nuevas lo aprovechan
-- sin cambios. RLS patrón tenant clásico. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public."LabSlaConfig" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  priority         varchar(10) NOT NULL CHECK (priority IN ('ROUTINE', 'URGENT', 'STAT')),
  -- Minutos desde la solicitud hasta el vencimiento del SLA del examen.
  "slaMinutes"     integer NOT NULL CHECK ("slaMinutes" > 0 AND "slaMinutes" <= 10080),
  -- Minutos ANTES del vencimiento en que el tablero marca "por vencer".
  "warningMinutes" integer NOT NULL DEFAULT 30 CHECK ("warningMinutes" >= 0),
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "LabSlaConfig_organizationId_priority_key"
  ON public."LabSlaConfig" ("organizationId", priority);

ALTER TABLE public."LabSlaConfig" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."LabSlaConfig" TO authenticated;

DROP POLICY IF EXISTS lab_sla_config_tenant ON public."LabSlaConfig";
CREATE POLICY lab_sla_config_tenant ON public."LabSlaConfig"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_lab_sla_config_updated_at') THEN
      CREATE TRIGGER trg_lab_sla_config_updated_at BEFORE UPDATE ON public."LabSlaConfig"
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
  END IF;
END $$;
