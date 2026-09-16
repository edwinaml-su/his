-- ============================================================================
-- 246_cc0036_agenda_core.sql
-- CC-0036 Ola 3 — Motor de agenda: configuración, excepciones y disponibilidad
-- derivada (REQ-HIS-AFIL-001 §6.1 Bloque E2, US.AGE.2.1, US.AGE.2.2, US.AGE.2.3,
-- Sprint S3 del plan §11).
--
-- Correcciones a la numeración del REQ (la numeración real del repo manda,
-- igual que sql/243/244/245): el REQ sugiere sql/245-247 para este bloque
-- (agenda_core / agenda_appointment_alter / agenda_disponibilidad), pero
-- 240-245 ya están ocupados en main (243 turnos Ola 1A, 244 consultorios/
-- afiliados Ola 1B, 245 contratos Ola 2). Esta es la 246 — agrupa el modelo
-- completo (tablas + función de disponibilidad + RBAC) en un solo archivo en
-- vez de partirlo en 3, porque esta ola NO toca `OutpatientAppointment` (el
-- ALTER + EXCLUDE de citas es Ola 4/S4, ver docstring del router).
--
-- D4 del REQ (no reabrir): disponibilidad DERIVADA, no materializada. No hay
-- tabla de slots — `fn_agenda_disponibilidad` calcula todo en el momento de
-- la consulta a partir de AgendaHorario + ContratoJornada + Holiday +
-- AgendaExcepcion + OutpatientAppointment.
--
-- Secciones:
--   1. AgendaMedico — configuración por médico/consultorio (US.AGE.2.1).
--   2. AgendaHorario — horario semanal (hijo de AgendaMedico, sin
--      organizationId propio, mismo patrón que ContratoJornada/sql/245).
--   3. AgendaExcepcion — bloqueos/vacaciones/congresos/extensiones por fecha
--      (US.AGE.2.2). Sin UNIQUE ni EXCLUDE: una fecha puede tener varias
--      excepciones (ej. BLOQUEO parcial en la mañana + EXTENSION en la
--      tarde) — la función de disponibilidad las agrega todas.
--   4. ListaEspera — modelo COMPLETO del REQ aunque la operación (inscribir/
--      notificar/convertir a cita) llega en Ola 4 (US.AGE.2.4/2.5). Se crea
--      ahora porque el REQ la define en el mismo bloque de tablas (§6.1) y
--      así Ola 4 no necesita otra migración de solo esta tabla.
--   5. fn_agenda_disponibilidad(p_agenda_id, p_desde, p_hasta) — STABLE, NO
--      SECURITY DEFINER (ver nota de diseño abajo). Aplica los 6 pasos del
--      REQ usando `int4multirange` (PG14+, disponible en Postgres 15 de
--      Supabase) para el álgebra de intervalos de "minutos del día"
--      (0..1440): evita reimplementar unión/intersección/resta de rangos a
--      mano. AgendaHorario/ContratoJornada nunca cruzan medianoche (CHECK
--      horaFin>horaInicio en ambas), así que el espacio de minutos por día
--      es seguro sin wraparound.
--   6. RLS + audit — patrón exacto sql/245 (loop DO $$ para las tablas con
--      organizationId propio; EXISTS contra el padre para las hijas).
--   7. RBAC — recurso `agenda` (leer, configurar, publicar — las acciones de
--      OPERACIÓN reservar/reprogramar/cancelar/sobrecupo/reservar_suspendida
--      del REQ §7.1 se siembran en Ola 4 junto con su código). Rol nuevo
--      `SECRETARIA_MEDICO_AFILIADO` (uno por organización activa, patrón
--      sql/244 §5) con solo `agenda.leer` — la restricción a "solo sus
--      agendas" es ABAC de aplicación en el router (ver docstring de
--      agenda.router.ts: $user.medicoAfiliadoId aún no vive en
--      TenantContext, así que el guard hace join directo
--      MedicoAfiliado.userId = ctx.user.id). `MEDICO_AFILIADO` (ya sembrado
--      en sql/244) recibe también `agenda.leer` (REQ §7.2 "agenda propia").
--      ADMIN/DIR/ADMIN_CONSULTORIOS reciben leer+configurar+publicar.
--
-- Decisión de diseño — NO SECURITY DEFINER en fn_agenda_disponibilidad: el
-- router SIEMPRE la invoca dentro de `withTenantContext` (rol demotado a
-- `authenticated`, con `app.current_org_id` ya seteado por SET LOCAL). Todas
-- las tablas que la función lee ya tienen policies SELECT que ese rol puede
-- satisfacer: AgendaMedico/AgendaHorario/AgendaExcepcion vía tenant_isolation
-- (mismo `organizationId` del tenant activo — el router ya validó que
-- p_agenda_id pertenece al tenant ANTES de llamar a la función, así que RLS
-- es defensa en profundidad, no la única barrera), ContratoJornada igual vía
-- su policy EXISTS, Holiday es catálogo global `USING (true)`
-- (sql/23_rls_catalog_gaps.sql) y OutpatientAppointment tiene su propia
-- policy tenant_isolation por organizationId. Con SECURITY DEFINER la
-- función correría con BYPASSRLS y un router con un bug de scoping podría
-- filtrar agendas de OTRA organización sin que RLS lo detuviera — al dejarla
-- SECURITY INVOKER, RLS sigue aplicando como red de seguridad real.
--
-- Idempotente. Aplicar vía mcp apply_migration en una sola transacción.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. AgendaMedico (US.AGE.2.1)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."AgendaMedico" (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"          uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "establishmentId"         uuid NOT NULL REFERENCES public."Establishment"(id) ON DELETE CASCADE,
  "medicoAfiliadoId"        uuid NOT NULL REFERENCES public."MedicoAfiliado"(id) ON DELETE RESTRICT,
  "consultorioId"           uuid NOT NULL REFERENCES public."Consultorio"(id) ON DELETE RESTRICT,
  "contratoId"              uuid NULL REFERENCES public."ContratoArrendamiento"(id) ON DELETE SET NULL,
  "specialtyId"             uuid NULL REFERENCES public."MedicalSpecialty"(id) ON DELETE SET NULL,
  "vigenciaDesde"           date NOT NULL,
  "vigenciaHasta"           date NULL,
  "duracionSlotMin"         int NOT NULL DEFAULT 20 CHECK ("duracionSlotMin" > 0 AND "duracionSlotMin" <= 480),
  "capacidadPorSlot"        int NOT NULL DEFAULT 1 CHECK ("capacidadPorSlot" > 0),
  "sobrecupoMaximoDia"      int NOT NULL DEFAULT 0 CHECK ("sobrecupoMaximoDia" >= 0),
  "anticipacionMinimaHoras" int NOT NULL DEFAULT 0 CHECK ("anticipacionMinimaHoras" >= 0),
  "horizonteMaximoDias"     int NOT NULL DEFAULT 90 CHECK ("horizonteMaximoDias" > 0),
  "politicaCancelacionHoras" int NOT NULL DEFAULT 24 CHECK ("politicaCancelacionHoras" >= 0),
  -- Reservado para la fase de portal/autoagenda (D3 del REQ) — sin lector/escritor de negocio esta ola.
  "permiteAutoagenda"       boolean NOT NULL DEFAULT false,
  estado                    varchar(20) NOT NULL DEFAULT 'BORRADOR'
    CONSTRAINT chk_agenda_medico_estado CHECK (estado IN ('BORRADOR', 'PUBLICADA', 'SUSPENDIDA', 'CERRADA')),
  active                    boolean NOT NULL DEFAULT true,
  "createdAt"               timestamptz NOT NULL DEFAULT now(),
  "createdBy"               uuid NULL,
  "updatedAt"               timestamptz NOT NULL DEFAULT now(),
  "updatedBy"               uuid NULL,
  CONSTRAINT chk_agenda_medico_vigencia CHECK ("vigenciaHasta" IS NULL OR "vigenciaHasta" >= "vigenciaDesde")
);

CREATE INDEX IF NOT EXISTS idx_agenda_medico_org ON public."AgendaMedico" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_agenda_medico_establishment ON public."AgendaMedico" ("establishmentId");
CREATE INDEX IF NOT EXISTS idx_agenda_medico_medico ON public."AgendaMedico" ("medicoAfiliadoId");
CREATE INDEX IF NOT EXISTS idx_agenda_medico_consultorio ON public."AgendaMedico" ("consultorioId");
CREATE INDEX IF NOT EXISTS idx_agenda_medico_estado ON public."AgendaMedico" (estado);
CREATE INDEX IF NOT EXISTS idx_agenda_medico_specialty ON public."AgendaMedico" ("specialtyId") WHERE "specialtyId" IS NOT NULL;

COMMENT ON TABLE public."AgendaMedico" IS
  'CC-0036 Ola 3 / US.AGE.2.1 — configuración de agenda de un médico afiliado '
  'en un consultorio (duración de slot, capacidad, anticipación, horizonte). '
  'estado SUSPENDIDA por mora del contrato es DERIVADO en el router (no '
  'persistido por job) — ver agenda.router.ts. REQ-HIS-AFIL-001 §6.1.';

-- ---------------------------------------------------------------------------
-- 2. AgendaHorario — horario semanal (US.AGE.2.1 AC1/AC3).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."AgendaHorario" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agendaId"   uuid NOT NULL REFERENCES public."AgendaMedico"(id) ON DELETE CASCADE,
  "diaSemana"  smallint NOT NULL CHECK ("diaSemana" BETWEEN 0 AND 6),
  "horaInicio" time NOT NULL,
  "horaFin"    time NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "createdBy"  uuid NULL,
  CONSTRAINT chk_agenda_horario_rango CHECK ("horaFin" > "horaInicio")
);

CREATE INDEX IF NOT EXISTS idx_agenda_horario_agenda ON public."AgendaHorario" ("agendaId");
CREATE INDEX IF NOT EXISTS idx_agenda_horario_dia ON public."AgendaHorario" ("agendaId", "diaSemana");

COMMENT ON TABLE public."AgendaHorario" IS
  'CC-0036 Ola 3 / US.AGE.2.1 — bloques de horario semanal de una AgendaMedico. '
  'Nunca cruza medianoche (CHECK horaFin>horaInicio) — a diferencia de '
  'PlantillaTurno, la consulta externa no opera en turnos nocturnos. '
  'REQ-HIS-AFIL-001 §6.1.';

-- ---------------------------------------------------------------------------
-- 3. AgendaExcepcion — bloqueos/vacaciones/congresos/extensiones (US.AGE.2.2).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."AgendaExcepcion" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agendaId"   uuid NOT NULL REFERENCES public."AgendaMedico"(id) ON DELETE CASCADE,
  fecha        date NOT NULL,
  tipo         varchar(20) NOT NULL
    CONSTRAINT chk_agenda_excepcion_tipo CHECK (tipo IN ('BLOQUEO', 'EXTENSION', 'VACACION', 'CONGRESO')),
  "horaInicio" time NULL,
  "horaFin"    time NULL,
  motivo       varchar(500) NOT NULL,
  "createdBy"  uuid NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_agenda_excepcion_horas_par CHECK (("horaInicio" IS NULL) = ("horaFin" IS NULL)),
  CONSTRAINT chk_agenda_excepcion_rango CHECK ("horaInicio" IS NULL OR "horaFin" > "horaInicio")
);

CREATE INDEX IF NOT EXISTS idx_agenda_excepcion_agenda ON public."AgendaExcepcion" ("agendaId");
CREATE INDEX IF NOT EXISTS idx_agenda_excepcion_fecha ON public."AgendaExcepcion" ("agendaId", fecha);

COMMENT ON TABLE public."AgendaExcepcion" IS
  'CC-0036 Ola 3 / US.AGE.2.2 — excepciones puntuales por fecha. '
  'BLOQUEO/VACACION/CONGRESO restan disponibilidad; EXTENSION la agrega '
  '(incluso en día feriado — ver diseño de fn_agenda_disponibilidad). '
  'horaInicio/horaFin NULL = día completo. Eliminación auditada por trigger '
  '(quién creó via createdBy, quién eliminó vía audit.audit_log/GUC de sesión). '
  'REQ-HIS-AFIL-001 §6.1.';

-- ---------------------------------------------------------------------------
-- 4. ListaEspera — modelo completo (operación real llega en Ola 4).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."ListaEspera" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"     uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "agendaId"           uuid NOT NULL REFERENCES public."AgendaMedico"(id) ON DELETE CASCADE,
  "patientId"          uuid NOT NULL REFERENCES public."Patient"(id) ON DELETE CASCADE,
  prioridad            varchar(20) NOT NULL DEFAULT 'NORMAL'
    CONSTRAINT chk_lista_espera_prioridad CHECK (prioridad IN ('NORMAL', 'PREFERENTE')),
  "fechaDeseadaDesde"  date NULL,
  "fechaDeseadaHasta"  date NULL,
  estado               varchar(20) NOT NULL DEFAULT 'ESPERANDO'
    CONSTRAINT chk_lista_espera_estado CHECK (estado IN ('ESPERANDO', 'CONTACTADO', 'AGENDADO', 'DESISTIO', 'VENCIDO')),
  "citaGeneradaId"     uuid NULL REFERENCES public."OutpatientAppointment"(id) ON DELETE SET NULL,
  notas                text NULL,
  "createdAt"          timestamptz NOT NULL DEFAULT now(),
  "createdBy"          uuid NULL,
  "updatedAt"          timestamptz NOT NULL DEFAULT now(),
  "updatedBy"          uuid NULL,
  CONSTRAINT chk_lista_espera_rango_fechas CHECK (
    "fechaDeseadaDesde" IS NULL OR "fechaDeseadaHasta" IS NULL OR "fechaDeseadaHasta" >= "fechaDeseadaDesde"
  )
);

CREATE INDEX IF NOT EXISTS idx_lista_espera_org ON public."ListaEspera" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_lista_espera_agenda ON public."ListaEspera" ("agendaId");
CREATE INDEX IF NOT EXISTS idx_lista_espera_patient ON public."ListaEspera" ("patientId");
CREATE INDEX IF NOT EXISTS idx_lista_espera_estado ON public."ListaEspera" (estado);

COMMENT ON TABLE public."ListaEspera" IS
  'CC-0036 Ola 3 — modelo REQ-fiel (§6.1) de lista de espera por agenda sin '
  'cupos en el rango deseado. Sin router/UI de operación en esta ola (llega '
  'en Ola 4, US.AGE.2.4 AC7 / US.AGE.2.5 AC3) — se crea ahora porque el REQ '
  'la define en el mismo bloque de tablas E2.';

-- ---------------------------------------------------------------------------
-- 5. fn_agenda_disponibilidad — ver nota de diseño en la cabecera (NO SECDEF).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_agenda_disponibilidad(
  p_agenda_id uuid,
  p_desde     date,
  p_hasta     date
)
RETURNS TABLE (
  inicio     timestamptz,
  fin        timestamptz,
  capacidad  int,
  ocupados   int,
  disponible int
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_agenda        RECORD;
  v_hoy           date;
  v_dia           date;
  v_dia_semana    smallint;
  v_base          int4multirange;
  v_jornada       int4multirange;
  v_bloqueo       int4multirange;
  v_extension     int4multirange;
  v_ventana       int4multirange;
  v_rango         int4range;
  v_slot_start    int;
  v_slot_end      int;
  v_now           timestamptz := now();
  v_slot_inicio   timestamptz;
  v_slot_fin      timestamptz;
  v_ocupados      int;
  v_cita          RECORD;
  v_citas_arr     int4range[];
BEGIN
  SELECT
    am.*,
    o."countryId"        AS org_country_id,
    e."geoDivisionId"    AS estab_geo_division_id,
    ma."userId"          AS medico_user_id,
    ca.modalidad         AS contrato_modalidad
  INTO v_agenda
  FROM public."AgendaMedico" am
  JOIN public."Organization" o ON o.id = am."organizationId"
  JOIN public."Establishment" e ON e.id = am."establishmentId"
  JOIN public."MedicoAfiliado" ma ON ma.id = am."medicoAfiliadoId"
  LEFT JOIN public."ContratoArrendamiento" ca ON ca.id = am."contratoId"
  WHERE am.id = p_agenda_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_hoy := (v_now AT TIME ZONE 'America/El_Salvador')::date;

  FOR v_dia IN SELECT generate_series(p_desde, p_hasta, interval '1 day')::date LOOP
    CONTINUE WHEN v_dia < v_agenda."vigenciaDesde";
    CONTINUE WHEN v_agenda."vigenciaHasta" IS NOT NULL AND v_dia > v_agenda."vigenciaHasta";
    -- US.AGE.2.3 AC4 — horizonteMaximoDias.
    CONTINUE WHEN v_dia > v_hoy + v_agenda."horizonteMaximoDias";

    v_dia_semana := EXTRACT(DOW FROM v_dia)::smallint;

    -- Paso 1: horario semanal de la agenda para este día.
    SELECT COALESCE(
             range_agg(int4range(
               EXTRACT(HOUR FROM ah."horaInicio")::int * 60 + EXTRACT(MINUTE FROM ah."horaInicio")::int,
               EXTRACT(HOUR FROM ah."horaFin")::int * 60 + EXTRACT(MINUTE FROM ah."horaFin")::int
             )),
             '{}'::int4multirange
           )
      INTO v_base
      FROM public."AgendaHorario" ah
     WHERE ah."agendaId" = p_agenda_id AND ah."diaSemana" = v_dia_semana;

    -- Paso 2: intersección con ContratoJornada si el contrato es COMPARTIDO_POR_JORNADA.
    IF v_agenda.contrato_modalidad = 'COMPARTIDO_POR_JORNADA' THEN
      SELECT COALESCE(
               range_agg(int4range(
                 EXTRACT(HOUR FROM cj."horaInicio")::int * 60 + EXTRACT(MINUTE FROM cj."horaInicio")::int,
                 EXTRACT(HOUR FROM cj."horaFin")::int * 60 + EXTRACT(MINUTE FROM cj."horaFin")::int
               )),
               '{}'::int4multirange
             )
        INTO v_jornada
        FROM public."ContratoJornada" cj
       WHERE cj."contratoId" = v_agenda."contratoId" AND cj."diaSemana" = v_dia_semana;
      v_base := v_base * v_jornada;
    END IF;

    -- Paso 3: feriado nacional/local anula el horario base del día — salvo
    -- que exista una excepción EXTENSION (que se SUMA más abajo de todos
    -- modos, sea o no feriado — es la lectura literal de US.AGE.2.2 AC4, que
    -- no condiciona la extensión a que el día NO sea feriado).
    IF EXISTS (
      SELECT 1 FROM public."Holiday" h
       WHERE h."countryId" = v_agenda.org_country_id
         AND h.date = v_dia
         AND (h."geoDivisionId" IS NULL OR h."geoDivisionId" = v_agenda.estab_geo_division_id)
    ) THEN
      v_base := '{}'::int4multirange;
    END IF;

    SELECT COALESCE(
             range_agg(int4range(
               COALESCE(EXTRACT(HOUR FROM ae."horaInicio")::int * 60 + EXTRACT(MINUTE FROM ae."horaInicio")::int, 0),
               COALESCE(EXTRACT(HOUR FROM ae."horaFin")::int * 60 + EXTRACT(MINUTE FROM ae."horaFin")::int, 1440)
             )),
             '{}'::int4multirange
           )
      INTO v_extension
      FROM public."AgendaExcepcion" ae
     WHERE ae."agendaId" = p_agenda_id AND ae.fecha = v_dia AND ae.tipo = 'EXTENSION';
    v_base := v_base + v_extension;

    -- Paso 4: BLOQUEO/VACACION/CONGRESO restan del resultado (incluida la extensión recién sumada).
    SELECT COALESCE(
             range_agg(int4range(
               COALESCE(EXTRACT(HOUR FROM ae."horaInicio")::int * 60 + EXTRACT(MINUTE FROM ae."horaInicio")::int, 0),
               COALESCE(EXTRACT(HOUR FROM ae."horaFin")::int * 60 + EXTRACT(MINUTE FROM ae."horaFin")::int, 1440)
             )),
             '{}'::int4multirange
           )
      INTO v_bloqueo
      FROM public."AgendaExcepcion" ae
     WHERE ae."agendaId" = p_agenda_id AND ae.fecha = v_dia AND ae.tipo IN ('BLOQUEO', 'VACACION', 'CONGRESO');
    v_ventana := v_base - v_bloqueo;

    CONTINUE WHEN isempty(v_ventana);

    -- Paso 5: citas SCHEDULED|CONFIRMED|CHECKED_IN del provider vinculado
    -- (MedicoAfiliado.userId) ese día. Si el afiliado no tiene userId (D5:
    -- puede no tener cuenta HIS), no hay bridge posible hasta que se vincule
    -- (medicoAfiliado.router.ts#vincularUsuario) — no resta nada, documentado.
    v_citas_arr := ARRAY[]::int4range[];
    IF v_agenda.medico_user_id IS NOT NULL THEN
      FOR v_cita IN
        SELECT oa."scheduledAt", oa."durationMinutes"
          FROM public."OutpatientAppointment" oa
         WHERE oa."providerId" = v_agenda.medico_user_id
           AND oa.status IN ('SCHEDULED', 'CONFIRMED', 'CHECKED_IN')
           AND oa."deletedAt" IS NULL
           AND (oa."scheduledAt" AT TIME ZONE 'America/El_Salvador')::date = v_dia
      LOOP
        v_citas_arr := v_citas_arr || int4range(
          EXTRACT(HOUR FROM (v_cita."scheduledAt" AT TIME ZONE 'America/El_Salvador'))::int * 60
            + EXTRACT(MINUTE FROM (v_cita."scheduledAt" AT TIME ZONE 'America/El_Salvador'))::int,
          EXTRACT(HOUR FROM (v_cita."scheduledAt" AT TIME ZONE 'America/El_Salvador'))::int * 60
            + EXTRACT(MINUTE FROM (v_cita."scheduledAt" AT TIME ZONE 'America/El_Salvador'))::int
            + v_cita."durationMinutes"
        );
      END LOOP;
    END IF;

    -- Paso 6 (parte 1 — horizonte ya filtrado arriba; acá anticipación
    -- mínima) + partir la ventana resultante en slots de duracionSlotMin.
    FOR v_rango IN SELECT unnest(v_ventana) LOOP
      v_slot_start := lower(v_rango);
      WHILE v_slot_start + v_agenda."duracionSlotMin" <= upper(v_rango) LOOP
        v_slot_end := v_slot_start + v_agenda."duracionSlotMin";

        SELECT count(*) INTO v_ocupados
          FROM unnest(v_citas_arr) c
         WHERE c && int4range(v_slot_start, v_slot_end);

        -- Wall-clock naive -> AT TIME ZONE interpreta como hora local
        -- America/El_Salvador y produce el timestamptz absoluto (UTC-6 fijo,
        -- sin DST — NFR-6).
        v_slot_inicio := (v_dia::timestamp + make_interval(mins => v_slot_start)) AT TIME ZONE 'America/El_Salvador';
        v_slot_fin := (v_dia::timestamp + make_interval(mins => v_slot_end)) AT TIME ZONE 'America/El_Salvador';

        IF v_slot_inicio >= v_now + make_interval(hours => v_agenda."anticipacionMinimaHoras") THEN
          inicio := v_slot_inicio;
          fin := v_slot_fin;
          capacidad := v_agenda."capacidadPorSlot";
          ocupados := v_ocupados;
          disponible := GREATEST(v_agenda."capacidadPorSlot" - v_ocupados, 0);
          RETURN NEXT;
        END IF;

        v_slot_start := v_slot_end;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.fn_agenda_disponibilidad(uuid, date, date) IS
  'CC-0036 Ola 3 (US.AGE.2.3, REQ-HIS-AFIL-001 §6.1) — disponibilidad '
  'DERIVADA (D4, sin tabla de slots). NO SECURITY DEFINER: se invoca dentro '
  'de withTenantContext (rol authenticated) y RLS de las tablas leídas aplica '
  'como defensa en profundidad (ver cabecera sql/246). NFR-1: p95 < 300ms '
  '(30 días, un médico) — índices idx_agenda_horario_dia/idx_agenda_excepcion_fecha '
  'soportan el patrón de acceso.';

-- ---------------------------------------------------------------------------
-- 6. RLS + audit — AgendaMedico/ListaEspera (organizationId propio),
--    AgendaHorario/AgendaExcepcion (EXISTS contra AgendaMedico).
-- ---------------------------------------------------------------------------

ALTER TABLE public."AgendaMedico" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ListaEspera" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."AgendaMedico" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ListaEspera" TO authenticated;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['AgendaMedico', 'ListaEspera'];
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

-- AgendaHorario / AgendaExcepcion — sin organizationId propio, RLS vía EXISTS
-- contra AgendaMedico (mismo patrón que ContratoJornada, sql/245 §5).
ALTER TABLE public."AgendaHorario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AgendaExcepcion" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."AgendaHorario" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."AgendaExcepcion" TO authenticated;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['AgendaHorario', 'AgendaExcepcion'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS agenda_child_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY agenda_child_isolation ON public.%I
         FOR ALL
         USING (EXISTS (
           SELECT 1 FROM public."AgendaMedico" am
           WHERE am.id = "agendaId"
             AND (am."organizationId" = public.current_org_id() OR public.is_break_glass())
         ))
         WITH CHECK (EXISTS (
           SELECT 1 FROM public."AgendaMedico" am
           WHERE am.id = "agendaId"
             AND am."organizationId" = public.current_org_id()
         ))',
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
-- 7. RBAC — recurso `agenda` (leer, configurar, publicar). Rol nuevo
--    SECRETARIA_MEDICO_AFILIADO + grant a MEDICO_AFILIADO (ya sembrado
--    sql/244) + ADMIN/DIR/ADMIN_CONSULTORIOS con todo.
-- ---------------------------------------------------------------------------

INSERT INTO public."Permission" (id, code, resource, action, "createdAt")
SELECT gen_random_uuid(), v.code, v.resource, v.action, now()
FROM (VALUES
  ('agenda.leer',        'agenda', 'leer'),
  ('agenda.configurar',  'agenda', 'configurar'),
  ('agenda.publicar',    'agenda', 'publicar')
) AS v(code, resource, action)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public."Role" (id, "organizationId", code, name, description, active, "createdAt", "updatedAt")
SELECT gen_random_uuid(), o.id, 'SECRETARIA_MEDICO_AFILIADO', 'Secretaria de Médico Afiliado',
       'CC-0036 Ola 3 — acceso acotado a la agenda del médico afiliado que representa (ABAC MedicoAfiliado.userId = ctx.user.id hasta que exista $user.medicoAfiliadoId en sesión, REQ-HIS-AFIL-001 §7.2/7.3)',
       true, now(), now()
FROM public."Organization" o
WHERE o.active = true
ON CONFLICT ("organizationId", code) DO NOTHING;

INSERT INTO public."RolePermission" ("roleId", "permissionId", effect)
SELECT r.id, p.id, 'ALLOW'
FROM (VALUES
  ('ADMIN',                       'agenda.leer'),
  ('ADMIN',                       'agenda.configurar'),
  ('ADMIN',                       'agenda.publicar'),
  ('DIR',                         'agenda.leer'),
  ('DIR',                         'agenda.configurar'),
  ('DIR',                         'agenda.publicar'),
  ('ADMIN_CONSULTORIOS',          'agenda.leer'),
  ('ADMIN_CONSULTORIOS',          'agenda.configurar'),
  ('ADMIN_CONSULTORIOS',          'agenda.publicar'),
  ('SECRETARIA_MEDICO_AFILIADO',  'agenda.leer'),
  ('MEDICO_AFILIADO',             'agenda.leer')
) AS g(role_code, perm_code)
JOIN public."Role" r ON r.code = g.role_code
JOIN public."Permission" p ON p.code = g.perm_code
ON CONFLICT ("roleId", "permissionId") DO UPDATE SET effect = 'ALLOW';

COMMIT;
