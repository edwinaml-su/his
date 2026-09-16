-- ============================================================================
-- 247_cc0036_agenda_operacion.sql
-- CC-0036 Ola 4 — Operación de agenda: reserva, reprogramación, sobrecupo,
-- no-show y check-in→Encounter+cuenta (REQ-HIS-AFIL-001 §6.1 Bloque E2,
-- US.AGE.2.4, US.AGE.2.5, US.AGE.2.6, US.AGE.2.7, Sprint S4 del plan §11).
--
-- ⚠️ APLICADO a prod 2026-09-15 vía MCP (cc0036_agenda_operacion_247) — NO
-- re-aplicar. Verificado: 18 columnas + 9 FKs + 2 CHECKs + 2 EXCLUDE (vía
-- fn_cita_rango IMMUTABLE — fix sobre la expresión del REQ, que dio 42P17
-- "functions in index expression must be marked IMMUTABLE" en el primer
-- apply) + 4 índices + fn_cita_no_show + cron cita_no_show */10 + 5
-- permisos de operación. Requiere sql/243-246 ya aplicados.
--
-- Corrección al REQ: la numeración sugerida (§10) da 246 a este archivo y
-- 247 a `fn_agenda_disponibilidad`, pero esa función YA se aplicó como parte
-- de sql/246_cc0036_agenda_core.sql (Ola 3 agrupó todo el bloque de
-- configuración en un solo archivo — ver su cabecera). Esta es la 247 real.
--
-- Verificación de columnas del REQ §6.1 contra schema.prisma (2026-09-16):
--   `providerId`/`scheduledAt`/`durationMinutes`/`status`/`deletedAt` en el
--   `EXCLUDE`/`ALTER` del REQ YA coinciden 1:1 con las columnas reales de
--   `OutpatientAppointment` — sin ajuste de nombres. `deletedAt` YA EXISTE
--   (no está en esta migración). Todas las columnas NUEVAS de este archivo
--   son "FK lógica" (sin `@relation` en schema.prisma, mismo patrón que
--   `PatientAccountService.priceListId`) — evita relaciones inversas nuevas
--   en MedicoAfiliado/Consultorio/AgendaMedico/TipoCuenta/Insurer/User/
--   Encounter solo para columnas que el router nunca necesita `include`ar
--   (usa `$queryRaw`/lookups puntuales donde hace falta el join).
--
-- Secciones:
--   1. ALTER OutpatientAppointment — columnas nuevas de operación.
--   2. CHECKs de vocabulario (tipoCita, canal).
--   3. EXCLUDE USING gist — antirreserva doble sobre médico y sobre
--      consultorio (idénticos al REQ, exentos si esSobrecupo=true).
--   4. Índices de soporte (agendaId+scheduledAt, consultorioId+scheduledAt).
--   5. fn_cita_no_show() + cron cada 10 min (US.AGE.2.7 AC1) — idempotente
--      por transición de estado (igual criterio que sql/238b): una vez
--      NO_SHOW, el WHERE de `due` ya no la vuelve a tomar.
--   6. RBAC — agenda.reservar/reprogramar/cancelar/sobrecupo/
--      reservar_suspendida (los 3 de leer/configurar/publicar ya están en
--      sql/246). Grants: ADMIN/DIR/ADMIN_CONSULTORIOS todo;
--      SECRETARIA_MEDICO_AFILIADO reservar/reprogramar/cancelar (ABAC en
--      router); ADMISSION_CLERK reservar/reprogramar/cancelar + leer.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ALTER OutpatientAppointment — columnas nuevas de operación (§6.1).
-- ---------------------------------------------------------------------------

ALTER TABLE "OutpatientAppointment"
  ADD COLUMN IF NOT EXISTS "medicoAfiliadoId" uuid,
  ADD COLUMN IF NOT EXISTS "consultorioId" uuid,
  ADD COLUMN IF NOT EXISTS "agendaId" uuid,
  ADD COLUMN IF NOT EXISTS "tipoCita" varchar(30),
  ADD COLUMN IF NOT EXISTS "canal" varchar(20),
  ADD COLUMN IF NOT EXISTS "tipoCuentaId" uuid,
  ADD COLUMN IF NOT EXISTS "insurerId" uuid,
  ADD COLUMN IF NOT EXISTS "esSobrecupo" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "autorizaSobrecupoBy" uuid,
  ADD COLUMN IF NOT EXISTS "llegadaAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "inicioAtencionAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "finAtencionAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "encounterId" uuid,
  ADD COLUMN IF NOT EXISTS "reprogramadaDeId" uuid,
  ADD COLUMN IF NOT EXISTS "motivoCancelacion" varchar(500),
  ADD COLUMN IF NOT EXISTS "canceladaBy" uuid,
  ADD COLUMN IF NOT EXISTS "canceladaAt" timestamptz;

DO $$ BEGIN
  ALTER TABLE "OutpatientAppointment"
    ADD CONSTRAINT fk_outpatient_appointment_medico_afiliado
    FOREIGN KEY ("medicoAfiliadoId") REFERENCES "MedicoAfiliado"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OutpatientAppointment"
    ADD CONSTRAINT fk_outpatient_appointment_consultorio
    FOREIGN KEY ("consultorioId") REFERENCES "Consultorio"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OutpatientAppointment"
    ADD CONSTRAINT fk_outpatient_appointment_agenda
    FOREIGN KEY ("agendaId") REFERENCES "AgendaMedico"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OutpatientAppointment"
    ADD CONSTRAINT fk_outpatient_appointment_tipo_cuenta
    FOREIGN KEY ("tipoCuentaId") REFERENCES "TipoCuenta"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OutpatientAppointment"
    ADD CONSTRAINT fk_outpatient_appointment_insurer
    FOREIGN KEY ("insurerId") REFERENCES "Insurer"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OutpatientAppointment"
    ADD CONSTRAINT fk_outpatient_appointment_autoriza_sobrecupo
    FOREIGN KEY ("autorizaSobrecupoBy") REFERENCES "User"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OutpatientAppointment"
    ADD CONSTRAINT fk_outpatient_appointment_encounter
    FOREIGN KEY ("encounterId") REFERENCES "Encounter"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OutpatientAppointment"
    ADD CONSTRAINT fk_outpatient_appointment_reprogramada_de
    FOREIGN KEY ("reprogramadaDeId") REFERENCES "OutpatientAppointment"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OutpatientAppointment"
    ADD CONSTRAINT fk_outpatient_appointment_cancelada_by
    FOREIGN KEY ("canceladaBy") REFERENCES "User"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. CHECKs de vocabulario (cerrado, igual criterio que Consultorio.tipoUso).
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE "OutpatientAppointment"
    ADD CONSTRAINT chk_outpatient_appointment_tipo_cita
    CHECK ("tipoCita" IS NULL OR "tipoCita" IN ('PRIMERA_VEZ', 'SUBSECUENTE', 'CONTROL_POSTQX', 'PROCEDIMIENTO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OutpatientAppointment"
    ADD CONSTRAINT chk_outpatient_appointment_canal
    CHECK ("canal" IS NULL OR "canal" IN ('RECEPCION', 'TELEFONO', 'MEDICO', 'PORTAL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 3. EXCLUDE USING gist — antirreserva doble médico / consultorio (§6.1).
--    btree_gist ya está instalada (sql/243). Exenta si esSobrecupo=true
--    (US.AGE.2.5 AC5 — el sobrecupo es intencional, fuera de esta guarda).
-- ---------------------------------------------------------------------------

-- Rango de la cita como función IMMUTABLE — requerido por el EXCLUDE gist
-- (42P17: "functions in index expression must be marked IMMUTABLE"; la
-- expresión del REQ `("durationMinutes" || ' minutes')::interval` no lo es).
-- Declararla IMMUTABLE es correcto: suma de minutos puros a timestamptz es
-- determinista (sin componentes día/mes; El Salvador además no tiene DST).
CREATE OR REPLACE FUNCTION public.fn_cita_rango(p_inicio timestamptz, p_duracion_min int)
RETURNS tstzrange
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT tstzrange(p_inicio, p_inicio + make_interval(mins => p_duracion_min));
$$;

DO $$ BEGIN
  ALTER TABLE "OutpatientAppointment"
    ADD CONSTRAINT excl_cita_medico
    EXCLUDE USING gist (
      "providerId" WITH =,
      public.fn_cita_rango("scheduledAt", "durationMinutes") WITH &&
    )
    WHERE (status IN ('SCHEDULED', 'CONFIRMED', 'CHECKED_IN') AND "esSobrecupo" = false AND "deletedAt" IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OutpatientAppointment"
    ADD CONSTRAINT excl_cita_consultorio
    EXCLUDE USING gist (
      "consultorioId" WITH =,
      public.fn_cita_rango("scheduledAt", "durationMinutes") WITH &&
    )
    WHERE (status IN ('SCHEDULED', 'CONFIRMED', 'CHECKED_IN') AND "esSobrecupo" = false AND "deletedAt" IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 4. Índices de soporte.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_outpatient_appointment_agenda_scheduled
  ON "OutpatientAppointment" ("agendaId", "scheduledAt")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_outpatient_appointment_consultorio_scheduled
  ON "OutpatientAppointment" ("consultorioId", "scheduledAt")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_outpatient_appointment_encounter
  ON "OutpatientAppointment" ("encounterId")
  WHERE "encounterId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outpatient_appointment_lista_espera_pendiente
  ON "OutpatientAppointment" ("agendaId", status)
  WHERE status IN ('SCHEDULED', 'CONFIRMED') AND "deletedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- 5. fn_cita_no_show() + cron cada 10 min (US.AGE.2.7 AC1).
--    Idempotente por transición de estado (mismo criterio que sql/238b): la
--    condición `status IN ('SCHEDULED','CONFIRMED')` deja de matchear la
--    fila apenas se marca NO_SHOW — no hace falta columna de guarda aparte.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_cita_no_show()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  WITH due AS (
    SELECT id, "organizationId", "patientId", "providerId", "agendaId",
           "consultorioId", "establishmentId", "scheduledAt"
    FROM public."OutpatientAppointment"
    WHERE status IN ('SCHEDULED', 'CONFIRMED')
      AND "deletedAt" IS NULL
      AND "llegadaAt" IS NULL
      AND "scheduledAt" + INTERVAL '60 minutes' < now()
    FOR UPDATE SKIP LOCKED
  ),
  marked AS (
    UPDATE public."OutpatientAppointment" oa
    SET status = 'NO_SHOW', "updatedAt" = now()
    FROM due
    WHERE oa.id = due.id
    RETURNING due.*
  )
  INSERT INTO public."DomainEvent" (
    "organizationId", "eventType", "aggregateType", "aggregateId", "emittedById", payload, "occurredAt"
  )
  SELECT
    "organizationId",
    'cita.no_show',
    'OutpatientAppointment',
    id,
    NULL,
    jsonb_build_object(
      'citaId', id,
      'patientId', "patientId",
      'providerId', "providerId",
      'agendaId', "agendaId",
      'consultorioId', "consultorioId",
      'establishmentId', "establishmentId",
      'scheduledAt', to_char("scheduledAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    now()
  FROM marked;
END;
$$;

COMMENT ON FUNCTION public.fn_cita_no_show() IS
  'US.AGE.2.7 AC1 — marca NO_SHOW las citas SCHEDULED/CONFIRMED cuya hora '
  'programada pasó hace más de 60 min sin llegadaAt, y emite cita.no_show. '
  'Llamada por pg_cron cada 10 min (cron cita_no_show).';

DO $$
DECLARE
  existing_job INT;
BEGIN
  SELECT jobid INTO existing_job FROM cron.job WHERE jobname = 'cita_no_show';
  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- pg_cron puede no estar disponible fuera de Supabase.
END $$;

SELECT cron.schedule(
  'cita_no_show',
  '*/10 * * * *',
  $$SELECT public.fn_cita_no_show();$$
);

-- ---------------------------------------------------------------------------
-- 6. RBAC — acciones de OPERACIÓN del recurso `agenda` (§7.1). leer/
--    configurar/publicar ya están en sql/246.
-- ---------------------------------------------------------------------------

INSERT INTO public."Permission" (id, code, resource, action, "createdAt")
SELECT gen_random_uuid(), v.code, v.resource, v.action, now()
FROM (VALUES
  ('agenda.reservar', 'agenda', 'reservar'),
  ('agenda.reprogramar', 'agenda', 'reprogramar'),
  ('agenda.cancelar', 'agenda', 'cancelar'),
  ('agenda.sobrecupo', 'agenda', 'sobrecupo'),
  ('agenda.reservar_suspendida', 'agenda', 'reservar_suspendida')
) AS v(code, resource, action)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public."RolePermission" ("roleId", "permissionId", effect)
SELECT r.id, p.id, 'ALLOW'
FROM (VALUES
  ('ADMIN',                       'agenda.reservar'),
  ('ADMIN',                       'agenda.reprogramar'),
  ('ADMIN',                       'agenda.cancelar'),
  ('ADMIN',                       'agenda.sobrecupo'),
  ('ADMIN',                       'agenda.reservar_suspendida'),
  ('DIR',                         'agenda.reservar'),
  ('DIR',                         'agenda.reprogramar'),
  ('DIR',                         'agenda.cancelar'),
  ('DIR',                         'agenda.sobrecupo'),
  ('DIR',                         'agenda.reservar_suspendida'),
  ('ADMIN_CONSULTORIOS',          'agenda.reservar'),
  ('ADMIN_CONSULTORIOS',          'agenda.reprogramar'),
  ('ADMIN_CONSULTORIOS',          'agenda.cancelar'),
  ('ADMIN_CONSULTORIOS',          'agenda.sobrecupo'),
  ('ADMIN_CONSULTORIOS',          'agenda.reservar_suspendida'),
  ('SECRETARIA_MEDICO_AFILIADO',  'agenda.reservar'),
  ('SECRETARIA_MEDICO_AFILIADO',  'agenda.reprogramar'),
  ('SECRETARIA_MEDICO_AFILIADO',  'agenda.cancelar'),
  ('ADMISSION_CLERK',             'agenda.leer'),
  ('ADMISSION_CLERK',             'agenda.reservar'),
  ('ADMISSION_CLERK',             'agenda.reprogramar'),
  ('ADMISSION_CLERK',             'agenda.cancelar')
) AS g(role_code, perm_code)
JOIN public."Role" r ON r.code = g.role_code
JOIN public."Permission" p ON p.code = g.perm_code
ON CONFLICT ("roleId", "permissionId") DO UPDATE SET effect = 'ALLOW';

COMMIT;
