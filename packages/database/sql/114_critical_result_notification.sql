-- Migración 114: Notificación de resultados críticos con SLA + read-back digital
--
-- US.JCI.5.7 — IPSG.2 ME 2: Resultados críticos de laboratorio notificados al
-- médico tratante en < 60 min con confirmación de read-back digital.
--
-- Norma: JCI IPSG.2 ME 2 (Critical Results Communication).
-- Esquema: ece.* (fuera del modelo Prisma principal — acceso vía raw SQL).
-- Idempotente: cada DDL usa IF NOT EXISTS / DO/EXCEPTION.
-- Aplicar: mcp__supabase__apply_migration name="critical_result_notification_2026_05_24"

-- ============================================================
-- 1. Tabla principal
-- ============================================================

CREATE TABLE IF NOT EXISTS ece.critical_result_notification (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL,                              -- RLS tenant key
  lab_result_id       UUID NOT NULL,                              -- FK lógica a LabResult (Prisma)
  paciente_id         UUID NOT NULL,                              -- FK lógica a Patient
  medico_tratante_id  UUID NOT NULL REFERENCES ece.personal_salud(id),
  valor_critico       JSONB NOT NULL,                             -- snapshot del valor + unidades
  severidad           TEXT NOT NULL
                        CHECK (severidad IN ('alta','muy_alta','crítica')),
  notificado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sla_min             INT NOT NULL DEFAULT 60,
  read_back_at        TIMESTAMPTZ,
  read_back_por_id    UUID REFERENCES ece.personal_salud(id),
  -- PIN hash verificado al confirmar read-back (argon2id almacenado externamente; este campo
  -- registra el contador de intentos fallidos para auditabilidad)
  pin_fail_count      SMALLINT NOT NULL DEFAULT 0,
  escalado_a_id       UUID REFERENCES ece.personal_salud(id),
  escalado_en         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ece.critical_result_notification IS
  'JCI IPSG.2 ME 2 — Trazabilidad de notificación y read-back de resultados críticos de LIS.';

-- ============================================================
-- 2. Índices
-- ============================================================

-- Cola de pendientes: resultado crítico sin confirmación del médico.
CREATE INDEX IF NOT EXISTS idx_crn_pending
  ON ece.critical_result_notification (medico_tratante_id, notificado_en)
  WHERE read_back_at IS NULL;

-- Búsqueda por organización (base para RLS)
CREATE INDEX IF NOT EXISTS idx_crn_org
  ON ece.critical_result_notification (organization_id);

-- Búsqueda por lab_result_id (desde LIS)
CREATE INDEX IF NOT EXISTS idx_crn_lab_result
  ON ece.critical_result_notification (lab_result_id);

-- ============================================================
-- 3. updated_at trigger
-- ============================================================

CREATE OR REPLACE FUNCTION ece.crn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  CREATE TRIGGER trg_crn_updated_at
    BEFORE UPDATE ON ece.critical_result_notification
    FOR EACH ROW EXECUTE FUNCTION ece.crn_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 4. RLS
-- ============================================================

ALTER TABLE ece.critical_result_notification ENABLE ROW LEVEL SECURITY;

-- Política: el rol 'authenticated' solo ve registros de su org.
DO $$
BEGIN
  CREATE POLICY crn_tenant_isolation
    ON ece.critical_result_notification
    FOR ALL
    TO authenticated
    USING (organization_id = (current_setting('app.current_org_id', TRUE))::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 5. Outbox: tabla de salida de eventos de dominio (si no existe ya)
-- ============================================================
-- Se reutiliza la infraestructura de outbox existente del proyecto.
-- Los eventos 'critical_result.sla_warning' y 'critical_result.sla_exceeded'
-- se insertan en public.domain_event_outbox (estándar del proyecto).

-- ============================================================
-- 6. pg_cron: SLA watchdog cada 5 minutos
--
-- Precondición: extensión pg_cron debe estar habilitada en el proyecto Supabase.
-- Si no está disponible, el watchdog puede implementarse como Supabase Edge Function
-- con schedule en cron.yaml. Documentado en TODO del router.
-- ============================================================

SELECT cron.schedule(
  'critical_result_sla_watchdog',  -- nombre único del job
  '*/5 * * * *',                   -- cada 5 minutos
  $$
    -- Paso A: emitir SLA warning si > 30 min sin read-back
    INSERT INTO public."DomainEvent" (
      "organizationId",
      "eventType",
      "aggregateType",
      "aggregateId",
      "emittedById",
      payload,
      "occurredAt"
    )
    SELECT
      n.organization_id,
      'critical_result.sla_warning',
      'CriticalResultNotification',
      n.id,
      n.medico_tratante_id,
      jsonb_build_object(
        'labResultId',    n.lab_result_id,
        'pacienteId',     n.paciente_id,
        'medicoId',       n.medico_tratante_id,
        'severidad',      n.severidad,
        'notificadoEn',   n.notificado_en,
        'minutosTranscurridos',
          EXTRACT(EPOCH FROM (NOW() - n.notificado_en)) / 60
      ),
      NOW()
    FROM ece.critical_result_notification n
    WHERE n.read_back_at IS NULL
      AND n.escalado_en IS NULL
      AND (NOW() - n.notificado_en) > INTERVAL '30 minutes'
      AND (NOW() - n.notificado_en) <= INTERVAL '60 minutes'
      -- evitar duplicar warning en cada tick: solo si no hay warning reciente (< 6 min)
      AND NOT EXISTS (
        SELECT 1 FROM public."DomainEvent" o
        WHERE o."aggregateId" = n.id
          AND o."eventType" = 'critical_result.sla_warning'
          AND o."occurredAt" > NOW() - INTERVAL '6 minutes'
      );

    -- Paso B: marcar escalado + emitir SLA exceeded si > 60 min sin read-back
    WITH exceeded AS (
      UPDATE ece.critical_result_notification
      SET escalado_en = NOW(),
          updated_at  = NOW()
      WHERE read_back_at IS NULL
        AND escalado_en IS NULL
        AND (NOW() - notificado_en) > INTERVAL '60 minutes'
      RETURNING
        id,
        organization_id,
        lab_result_id,
        paciente_id,
        medico_tratante_id,
        severidad,
        notificado_en
    )
    INSERT INTO public."DomainEvent" (
      "organizationId",
      "eventType",
      "aggregateType",
      "aggregateId",
      "emittedById",
      payload,
      "occurredAt"
    )
    SELECT
      e.organization_id,
      'critical_result.sla_exceeded',
      'CriticalResultNotification',
      e.id,
      e.medico_tratante_id,
      jsonb_build_object(
        'labResultId',  e.lab_result_id,
        'pacienteId',   e.paciente_id,
        'medicoId',     e.medico_tratante_id,
        'severidad',    e.severidad,
        'notificadoEn', e.notificado_en,
        'slaMinutos',   60
      ),
      NOW()
    FROM exceeded e;
  $$
) ON CONFLICT (jobname) DO UPDATE
  SET schedule  = EXCLUDED.schedule,
      command   = EXCLUDED.command,
      active    = true;
