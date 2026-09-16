-- ============================================================================
-- 243_cc0036_turnos.sql
-- CC-0036 Ola 1A — Rostering 24/7 médicos/enfermería por sede.
-- Fuente: docs/req/REQ-HIS-AFIL-001.md §5.1 Bloque C + US.AFIL.1.9/1.10/1.11
-- (REQ-HIS-AFIL-001, épica E1 sub-épica E1.C). Prioridad explícita de Edwin
-- Martinez 2026-09-15: "módulo de asignaciones de médicos internos donde se
-- puedan agendar por mes tanto médicos como enfermeras por turno".
--
-- ⚠️ APLICADO a prod 2026-09-15 vía MCP (cc0036_turnos_243) — NO
-- re-aplicar. Verificado: btree_gist 1.7 instalada, 3 tablas + EXCLUDE
-- antitraslape + fn_medico_de_turno + RLS/audit + 5 permisos + rol
-- JEFE_MEDICO_SEDE (orgs activas) + cron turno_sin_cobertura_watchdog */10.
--
-- Correcciones al REQ (stack real del repo, ver CLAUDE.md):
--   - Prisma 5 / Postgres 15 / npm (el REQ asume Prisma 6/PG17/pnpm — no
--     existen en este repo).
--   - Numeración: el REQ sugiere sql/239-249 pero 239-242 YA están usados
--     (CC-0031/CC-0032/expiración de reservas/SLA watchdog/poller Vault).
--     Esta es la ÚNICA migración de la Ola 1A — cubre solo Bloque C
--     (turnos). Los Bloques A/B (consultorios, arrendamiento, honorarios,
--     agenda E2) quedan para olas siguientes, numeración 244+.
--   - Correlativo de control de cambio: CC-0036 (el mayor observado en el
--     esquema real es CC-0034/CC-0035, no CC-0028 como asume el REQ).
--
-- Tres secciones, cada una idempotente:
--   1. Extensión btree_gist (prerrequisito EXCLUDE) + tablas PlantillaTurno/
--      ProgramacionTurno/AsignacionTurno + fn_medico_de_turno.
--   2. RLS + grants + audit triggers (patrón exacto de sql/231 §3 Room).
--   3. RBAC: recurso `turno` (Permission) + rol JEFE_MEDICO_SEDE por
--      organización activa (patrón sql/238 §1) + RolePermission (patrón
--      sql/194 §5).
--   4. Cron `turno_sin_cobertura_watchdog` — US.AFIL.1.10.8 (patrón exacto
--      de sql/241_triage_sla_watchdog.sql: guarda por columna, no por
--      ventana de tiempo; reusa `task.escalated` en vez de
--      `task.sla_exceeded` puro para no chocar con el índice de dedup
--      uq_domain_event_pending_dedup si en el futuro conviven ambos —
--      mismo criterio documentado en la lección 241b).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extensión + tablas + función.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- PlantillaTurno — turno tipo por sede (US.AFIL.1.9).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."PlantillaTurno" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"    uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "establishmentId"   uuid NOT NULL REFERENCES public."Establishment"(id) ON DELETE CASCADE,
  "serviceUnitId"     uuid NULL REFERENCES public."ServiceUnit"(id) ON DELETE SET NULL,
  codigo              varchar(40) NOT NULL,
  nombre              varchar(120) NOT NULL,
  "horaInicio"        time NOT NULL,
  "horaFin"           time NOT NULL,
  -- US.AFIL.1.9.1 — "el sistema marca cruzaMedianoche=true automáticamente":
  -- columna generada, no hay forma de que el valor persistido diverja del
  -- cálculo (patrón GENERATED ALWAYS ya usado en sql/124 dias_otorgados).
  "cruzaMedianoche"   boolean GENERATED ALWAYS AS ("horaFin" <= "horaInicio") STORED,
  tipo                varchar(20) NOT NULL,
  "dotacionRequerida" int NOT NULL DEFAULT 1,
  active              boolean NOT NULL DEFAULT true,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "createdBy"         uuid NULL,
  "updatedAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedBy"         uuid NULL,
  CONSTRAINT uq_plantilla_turno_codigo UNIQUE ("organizationId", "establishmentId", codigo)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_plantilla_turno_tipo') THEN
    ALTER TABLE public."PlantillaTurno"
      ADD CONSTRAINT chk_plantilla_turno_tipo
      CHECK (tipo IN ('MEDICO_GENERAL', 'ENFERMERIA', 'APOYO'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_plantilla_turno_dotacion') THEN
    ALTER TABLE public."PlantillaTurno"
      ADD CONSTRAINT chk_plantilla_turno_dotacion CHECK ("dotacionRequerida" > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_plantilla_turno_org ON public."PlantillaTurno" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_plantilla_turno_estab ON public."PlantillaTurno" ("establishmentId", tipo, active);

COMMENT ON TABLE public."PlantillaTurno" IS
  'CC-0036 Ola 1A / US.AFIL.1.9 — turno tipo por sede (horario + dotación '
  'requerida + tipo de personal MEDICO_GENERAL|ENFERMERIA|APOYO). '
  'REQ-HIS-AFIL-001 §5.1 Bloque C.';

-- ---------------------------------------------------------------------------
-- ProgramacionTurno — período de programación (quincenal/mensual) por sede
-- (US.AFIL.1.10).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ProgramacionTurno" (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"            uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "establishmentId"           uuid NOT NULL REFERENCES public."Establishment"(id) ON DELETE CASCADE,
  "periodoDesde"              date NOT NULL,
  "periodoHasta"              date NOT NULL,
  estado                      varchar(20) NOT NULL DEFAULT 'BORRADOR',
  "publicadaBy"               uuid NULL,
  "publicadaAt"               timestamptz NULL,
  "autorizaDescubiertoBy"     uuid NULL,
  "autorizaDescubiertoMotivo" varchar(300) NULL,
  "createdAt"                 timestamptz NOT NULL DEFAULT now(),
  "createdBy"                 uuid NULL,
  "updatedAt"                 timestamptz NOT NULL DEFAULT now(),
  "updatedBy"                 uuid NULL,
  CONSTRAINT uq_programacion_turno_periodo UNIQUE ("organizationId", "establishmentId", "periodoDesde", "periodoHasta"),
  CONSTRAINT chk_programacion_turno_periodo CHECK ("periodoHasta" >= "periodoDesde")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_programacion_turno_estado') THEN
    ALTER TABLE public."ProgramacionTurno"
      ADD CONSTRAINT chk_programacion_turno_estado
      CHECK (estado IN ('BORRADOR', 'PUBLICADA', 'CERRADA'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_programacion_turno_org ON public."ProgramacionTurno" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_programacion_turno_estab_estado ON public."ProgramacionTurno" ("establishmentId", estado);

COMMENT ON TABLE public."ProgramacionTurno" IS
  'CC-0036 Ola 1A / US.AFIL.1.10 — período de programación de turnos '
  '(quincenal/mensual) por sede. BORRADOR->PUBLICADA->CERRADA. '
  'REQ-HIS-AFIL-001 §5.1 Bloque C.';

-- ---------------------------------------------------------------------------
-- AsignacionTurno — asignación de un usuario a un turno en una fecha
-- (US.AFIL.1.10/1.11). `organizationId`/`establishmentId` se denormalizan
-- desde ProgramacionTurno (NFR-3 del REQ: RLS por columna directa, sin
-- subquery entre tablas en el USING de la policy).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."AsignacionTurno" (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"         uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "establishmentId"        uuid NOT NULL REFERENCES public."Establishment"(id) ON DELETE CASCADE,
  "programacionId"         uuid NOT NULL REFERENCES public."ProgramacionTurno"(id) ON DELETE CASCADE,
  "plantillaTurnoId"       uuid NOT NULL REFERENCES public."PlantillaTurno"(id) ON DELETE RESTRICT,
  "userId"                 uuid NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  fecha                    date NOT NULL,
  "inicioProgramado"       timestamptz NOT NULL,
  "finProgramado"          timestamptz NOT NULL,
  "inicioReal"             timestamptz NULL,
  "finReal"                timestamptz NULL,
  estado                   varchar(20) NOT NULL DEFAULT 'PROGRAMADO',
  "sustitutoUserId"        uuid NULL REFERENCES public."User"(id) ON DELETE SET NULL,
  "motivoCambio"           varchar(300) NULL,
  -- Guarda de idempotencia del cron `turno_sin_cobertura_watchdog`
  -- (US.AFIL.1.10.8) — mismo patrón por columna que
  -- TriageEvaluation.slaExceededEmittedAt (sql/241).
  "sinCoberturaEmitidoAt"  timestamptz NULL,
  "createdAt"              timestamptz NOT NULL DEFAULT now(),
  "createdBy"              uuid NULL,
  "updatedAt"              timestamptz NOT NULL DEFAULT now(),
  "updatedBy"              uuid NULL,
  CONSTRAINT uq_asignacion_turno_plantilla_fecha_user UNIQUE ("plantillaTurnoId", fecha, "userId"),
  CONSTRAINT chk_asignacion_turno_rango CHECK ("finProgramado" > "inicioProgramado")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_asignacion_turno_estado') THEN
    ALTER TABLE public."AsignacionTurno"
      ADD CONSTRAINT chk_asignacion_turno_estado
      CHECK (estado IN ('PROGRAMADO', 'CONFIRMADO', 'EN_CURSO', 'CUMPLIDO', 'AUSENTE', 'SUSTITUIDO'));
  END IF;
  -- US.AFIL.1.10.2 — antitraslape: un mismo usuario no puede tener dos
  -- asignaciones vigentes (PROGRAMADO/CONFIRMADO/EN_CURSO) cuyo rango
  -- [inicioProgramado, finProgramado) se solape. SUSTITUIDO queda fuera
  -- del índice a propósito: al sustituir, la fila original conserva su
  -- rango pero ya no "ocupa" al userId original (lo cubre sustitutoUserId).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'excl_asignacion_turno_traslape') THEN
    ALTER TABLE public."AsignacionTurno"
      ADD CONSTRAINT excl_asignacion_turno_traslape
      EXCLUDE USING gist (
        "userId" WITH =,
        tstzrange("inicioProgramado", "finProgramado") WITH &&
      ) WHERE (estado IN ('PROGRAMADO', 'CONFIRMADO', 'EN_CURSO'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_asignacion_turno_org ON public."AsignacionTurno" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_asignacion_turno_estab_estado ON public."AsignacionTurno" ("establishmentId", estado);
CREATE INDEX IF NOT EXISTS idx_asignacion_turno_programacion ON public."AsignacionTurno" ("programacionId");
CREATE INDEX IF NOT EXISTS idx_asignacion_turno_user ON public."AsignacionTurno" ("userId");
-- Índice de soporte de fn_medico_de_turno (US.AFIL.1.11.5 — p95 < 150ms):
-- filtra directo por sede vigente sin tocar filas ya CUMPLIDO/AUSENTE.
CREATE INDEX IF NOT EXISTS idx_asignacion_turno_vigente
  ON public."AsignacionTurno" ("establishmentId", "inicioProgramado", "finProgramado")
  WHERE estado IN ('PROGRAMADO', 'CONFIRMADO', 'EN_CURSO', 'SUSTITUIDO');
-- Índice parcial del watchdog de cobertura — mismo criterio que idx_triage_evaluation_sla_pending (sql/241).
CREATE INDEX IF NOT EXISTS idx_asignacion_turno_sin_cobertura_pending
  ON public."AsignacionTurno" (estado, "inicioProgramado")
  WHERE "sinCoberturaEmitidoAt" IS NULL;

COMMENT ON TABLE public."AsignacionTurno" IS
  'CC-0036 Ola 1A / US.AFIL.1.10-1.11 — asignación de un usuario (médico '
  'general o enfermería) a un turno en una fecha concreta. Antitraslape por '
  'EXCLUDE (mismo usuario, rangos solapados, estados vigentes). '
  'REQ-HIS-AFIL-001 §5.1 Bloque C.';

-- ---------------------------------------------------------------------------
-- fn_medico_de_turno — resuelve quién está de turno vigente en una sede en
-- un instante dado (US.AFIL.1.11). SECURITY DEFINER porque el caller típico
-- (care-task-consumer bajo withEceContext, o el header de /triage) puede no
-- tener acceso RLS directo a AsignacionTurno bajo su contexto; STABLE porque
-- no muta estado y permite al planner cachear dentro de la misma consulta.
-- `inicioProgramado`/`finProgramado` ya son timestamptz absolutos calculados
-- al asignar (fecha + hora de la plantilla, sumando 1 día si cruzaMedianoche)
-- — la función NO necesita lógica especial de medianoche, solo comparar
-- contra el instante pedido.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_medico_de_turno(
  p_establishment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE ("userId" uuid, "fullName" varchar, "plantillaTurnoId" uuid, tipo varchar)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    u.id AS "userId",
    u."fullName",
    pt.id AS "plantillaTurnoId",
    pt.tipo
  FROM public."AsignacionTurno" at
  JOIN public."ProgramacionTurno" pr ON pr.id = at."programacionId"
  JOIN public."PlantillaTurno" pt ON pt.id = at."plantillaTurnoId"
  JOIN public."User" u
    ON u.id = CASE WHEN at.estado = 'SUSTITUIDO' THEN at."sustitutoUserId" ELSE at."userId" END
  WHERE pr."establishmentId" = p_establishment_id
    AND pr.estado = 'PUBLICADA'
    AND at.estado IN ('PROGRAMADO', 'CONFIRMADO', 'EN_CURSO', 'SUSTITUIDO')
    AND p_at >= at."inicioProgramado"
    AND p_at <  at."finProgramado"
    AND u.active = true;
$$;

COMMENT ON FUNCTION public.fn_medico_de_turno(uuid, timestamptz) IS
  'US.AFIL.1.11 — médico/enfermero de turno vigente en una sede en un '
  'instante dado, resolviendo sustituciones (SUSTITUIDO -> sustitutoUserId). '
  'Devuelve `tipo` de la plantilla para servir tanto a MEDICO_GENERAL como a '
  'ENFERMERIA. Puede devolver 0..N filas si dotacionRequerida > 1.';

-- ---------------------------------------------------------------------------
-- 2. RLS + grants + audit — patrón exacto de sql/231 §3 (Room).
-- ---------------------------------------------------------------------------

ALTER TABLE public."PlantillaTurno" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProgramacionTurno" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AsignacionTurno" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."PlantillaTurno" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ProgramacionTurno" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."AsignacionTurno" TO authenticated;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['PlantillaTurno', 'ProgramacionTurno', 'AsignacionTurno'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON public.%I
         FOR SELECT
         USING ("organizationId" = public.current_org_id() OR public.is_break_glass())',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_modify ON public.%I
         FOR ALL
         USING ("organizationId" = public.current_org_id())
         WITH CHECK ("organizationId" = public.current_org_id())',
      t
    );

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_audit_' || t, t);
    EXECUTE format(
      'CREATE TRIGGER %I
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row()',
      'trg_audit_' || t, t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. RBAC — recurso `turno` (Permission) + rol JEFE_MEDICO_SEDE + RolePermission.
--    Patrón sql/238 §1 (rol por organización activa) + sql/194 §5
--    (RolePermission por join de códigos).
-- ---------------------------------------------------------------------------

INSERT INTO public."Permission" (id, code, resource, action, "createdAt")
SELECT gen_random_uuid(), v.code, v.resource, v.action, now()
FROM (VALUES
  ('turno.leer', 'turno', 'leer'),
  ('turno.programar', 'turno', 'programar'),
  ('turno.publicar', 'turno', 'publicar'),
  ('turno.sustituir', 'turno', 'sustituir'),
  ('turno.autorizar_descubierto', 'turno', 'autorizar_descubierto')
) AS v(code, resource, action)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public."Role" (id, "organizationId", code, name, description, active, "createdAt", "updatedAt")
SELECT gen_random_uuid(), o.id, 'JEFE_MEDICO_SEDE', 'Jefe Médico de Sede',
       'CC-0036 — programa y publica el rol de turnos 24/7 de su(s) sede(s) (REQ-HIS-AFIL-001 US.AFIL.1.10).',
       true, now(), now()
FROM public."Organization" o
WHERE o.active = true
ON CONFLICT ("organizationId", code) DO NOTHING;

-- RolePermission — JEFE_MEDICO_SEDE tiene el CRUD completo de turnos;
-- ADMIN/DIR (administración/dirección médica) heredan lectura + autorización
-- de descubierto como respaldo administrativo; el resto de roles clínicos
-- (lectura amplia — saber quién está de turno es transversal) solo `leer`.
INSERT INTO public."RolePermission" ("roleId", "permissionId", effect)
SELECT r.id, p.id, 'ALLOW'
FROM (VALUES
  ('JEFE_MEDICO_SEDE', 'turno.leer'),
  ('JEFE_MEDICO_SEDE', 'turno.programar'),
  ('JEFE_MEDICO_SEDE', 'turno.publicar'),
  ('JEFE_MEDICO_SEDE', 'turno.sustituir'),
  ('JEFE_MEDICO_SEDE', 'turno.autorizar_descubierto'),
  ('ADMIN', 'turno.leer'),
  ('ADMIN', 'turno.programar'),
  ('ADMIN', 'turno.publicar'),
  ('ADMIN', 'turno.sustituir'),
  ('ADMIN', 'turno.autorizar_descubierto'),
  ('DIR', 'turno.leer'),
  ('DIR', 'turno.autorizar_descubierto'),
  ('PHYSICIAN', 'turno.leer'),
  ('MC', 'turno.leer'),
  ('NURSE', 'turno.leer'),
  ('TRIAGE_NURSE', 'turno.leer'),
  ('ADMIN_CLINICO', 'turno.leer')
) AS g(role_code, perm_code)
JOIN public."Role" r ON r.code = g.role_code
JOIN public."Permission" p ON p.code = g.perm_code
ON CONFLICT ("roleId", "permissionId") DO UPDATE SET effect = 'ALLOW';

-- ---------------------------------------------------------------------------
-- 4. Cron — turno_sin_cobertura_watchdog (US.AFIL.1.10.8): asignación
--    PROGRAMADO/CONFIRMADO cuyo inicioProgramado pasó hace >30 min sin
--    inicioReal registrado -> alerta al jefe médico de sede. Cada 10
--    minutos (el margen de la alerta es de 30 min, no necesita la cadencia
--    de 5 min del watchdog de triage). Reusa `task.escalated` como eventType
--    (mismo criterio de la lección 241b: un segundo evento sobre el mismo
--    aggregate con el mismo eventType choca con
--    uq_domain_event_pending_dedup si algún día conviven ambos tipos sobre
--    AsignacionTurno).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  existing_job INT;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'turno_sin_cobertura_watchdog';

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
END $$;

SELECT cron.schedule(
  'turno_sin_cobertura_watchdog',
  '*/10 * * * *',
  $$
    WITH due AS (
      SELECT at.id, at."organizationId", at."establishmentId", at."inicioProgramado",
             pt.nombre AS "plantillaNombre"
      FROM public."AsignacionTurno" at
      JOIN public."ProgramacionTurno" pr ON pr.id = at."programacionId"
      JOIN public."PlantillaTurno" pt ON pt.id = at."plantillaTurnoId"
      WHERE at.estado IN ('PROGRAMADO', 'CONFIRMADO')
        AND at."inicioReal" IS NULL
        AND at."sinCoberturaEmitidoAt" IS NULL
        AND pr.estado = 'PUBLICADA'
        AND NOW() >= at."inicioProgramado" + INTERVAL '30 minutes'
      FOR UPDATE OF at SKIP LOCKED
    ),
    marked AS (
      UPDATE public."AsignacionTurno" at
      SET "sinCoberturaEmitidoAt" = NOW()
      FROM due
      WHERE at.id = due.id
      RETURNING due.*
    )
    INSERT INTO public."DomainEvent" (
      "organizationId", "eventType", "aggregateType", "aggregateId",
      "emittedById", payload, "occurredAt"
    )
    SELECT
      "organizationId",
      'task.escalated',
      'AsignacionTurno',
      id,
      NULL,
      jsonb_build_object(
        'taskType', 'TURNO_SIN_COBERTURA',
        'sourceType', 'ASIGNACION_TURNO',
        'sourceId', id,
        'assignedRoleCode', 'JEFE_MEDICO_SEDE',
        'establishmentId', "establishmentId",
        'serviceUnitId', NULL,
        'dueAt', to_char("inicioProgramado" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'url', '/turnos',
        'resumen', 'Turno "' || "plantillaNombre" || '" sin registro de ingreso — ' ||
          GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - "inicioProgramado")) / 60.0) - 30)::text
          || ' min sobre el margen de 30 min'
      ),
      NOW()
    FROM marked;
  $$
);
