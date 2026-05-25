-- 120_morse_sla_watchdog.sql
-- JCI Standard: IPSG.6 ME 2 — Vigilancia SLA Escala Morse cada turno (12 h)
-- US.JCI.5.14 — Re-evaluación riesgo caídas por turno hospitalario
--
-- Lógica:
--   pg_cron dispara cada hora. Por cada episodio hospitalario activo
--   (estado IN ('abierto','en_curso')), obtiene el MAX(registrado_en)
--   de valoracion_inicial_enfermeria donde escala_morse IS NOT NULL.
--   Si han pasado >12 h desde la última evaluación (o nunca se registró),
--   emite DomainEvent 'ipsg6.morse_sla_exceeded'.
--   Un guard de idempotencia evita duplicar alertas dentro de la misma hora.
--
-- Joins reales (verificados via MCP 2026-05-24):
--   ece.episodio_hospitalario (PK: episodio_id) → ece.episodio_atencion(id)
--   ece.valoracion_inicial_enfermeria.episodio_hospitalario_id
--     FK → ece.episodio_hospitalario.episodio_id
--   ece.episodio_atencion.establecimiento_id → ece.institucion(id).organization_id
--
-- DomainEvent columnas (camelCase, verificadas via MCP):
--   "organizationId", "eventType", "aggregateType", "aggregateId",
--   "emittedById", payload, "occurredAt"

DO $$
DECLARE
  existing_job INT;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'morse_sla_watchdog';

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
END $$;

SELECT cron.schedule(
  'morse_sla_watchdog',
  '0 * * * *',
  $$
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
      inst.organization_id,
      'ipsg6.morse_sla_exceeded',
      'EpisodioHospitalario',
      eh.episodio_id,
      NULL,
      jsonb_build_object(
        'pacienteId',         ea.paciente_id,
        'episodioId',         eh.episodio_id,
        'ultimaEvaluacionEn', last_morse.registrado_en,
        'horasTranscurridas', CASE
          WHEN last_morse.registrado_en IS NULL THEN NULL
          ELSE EXTRACT(EPOCH FROM (NOW() - last_morse.registrado_en)) / 3600
        END
      ),
      NOW()
    FROM ece.episodio_hospitalario eh
    JOIN ece.episodio_atencion ea
      ON ea.id = eh.episodio_id
    JOIN ece.institucion inst
      ON inst.id = ea.establecimiento_id
    LEFT JOIN LATERAL (
      SELECT MAX(vie.registrado_en) AS registrado_en
      FROM ece.valoracion_inicial_enfermeria vie
      WHERE vie.episodio_hospitalario_id = eh.episodio_id
        AND vie.escala_morse IS NOT NULL
    ) last_morse ON true
    WHERE ea.estado IN ('abierto', 'en_curso')
      AND (
        last_morse.registrado_en IS NULL
        OR (NOW() - last_morse.registrado_en) > INTERVAL '12 hours'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public."DomainEvent" prev
        WHERE prev."aggregateId" = eh.episodio_id
          AND prev."eventType"   = 'ipsg6.morse_sla_exceeded'
          AND prev."occurredAt"  > NOW() - INTERVAL '1 hour'
      );
  $$
);
