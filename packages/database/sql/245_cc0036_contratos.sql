-- ============================================================================
-- 245_cc0036_contratos.sql
-- CC-0036 Ola 2 — Contratos de arrendamiento de consultorio y devengo mensual
-- al hub de eventos (REQ-HIS-AFIL-001 §5.1 Bloque A, US.AFIL.1.3, US.AFIL.1.4).
--
-- ⚠️ DECISIÓN DE EDWIN MARTINEZ 2026-09-15 que SUPERSEDE §9 del REQ y parte
-- de US.AFIL.1.4 (verbatim: "todo el tema de escritura a nivel transaccional
-- se manejará a nivel de interface por hub de eventos; eso se hará en otra
-- fase"): CERO integración con Odoo en esta ola. El devengo llega hasta
-- DEVENGADO y emite `contrato.cargo.devengado` al outbox `DomainEvent` — ESE
-- es el "hub de eventos". Los estados ENVIADO_ODOO/FACTURADO/PAGADO y las
-- columnas odooInvoiceId/odooSyncedAt quedan declarados (vocabulario
-- RESERVADO del CHECK/columna) pero NINGÚN código de esta ola los produce ni
-- los consume. US.AFIL.1.4.5/1.4.6 (confirmación de factura, mora por
-- factura vencida) NO se implementan — EN_MORA en esta ola es un toggle
-- MANUAL con motivo (contrato.router.marcarMora), documentado como TODO Ola
-- de integración; es necesario ahora porque la agenda (Épica E2, Ola 3)
-- suspende agendas cuando el contrato está EN_MORA.
--
-- Correcciones a la numeración del REQ (la numeración real del repo manda,
-- igual que sql/243 y sql/244): el REQ sugiere sql/241 para este bloque,
-- pero 239-244 ya están ocupados en main (239 CC-0032, 240 expiración de
-- reservas, 241 triage SLA watchdog, 242 poller vault, 243 turnos Ola 1A,
-- 244 consultorios/afiliados Ola 1B). Esta es la 245. btree_gist ya está
-- instalada (sql/243) — no se re-crea acá.
--
-- Secciones:
--   1. ContratoArrendamiento — folio fn_next_contrato_arrendamiento (patrón
--      CC-0020: secuencia_* con RLS deny-all + sin grants API desde el
--      origen, no como hardening posterior). EXCLUDE gist antitraslape
--      EXCLUSIVO en estados VIGENTE/EN_MORA (US.AFIL.1.3 AC2) — la validación
--      de traslape EXCLUSIVO en `create` (contrato en BORRADOR) es de
--      aplicación (el EXCLUDE con WHERE parcial no evalúa filas que no
--      satisfacen el predicado, así que un BORRADOR nunca dispara el
--      EXCLUDE): el EXCLUDE de BD es la red de seguridad real en el UPDATE de
--      `activar` (BORRADOR->VIGENTE, ahí sí satisface el predicado) contra
--      condiciones de carrera entre activaciones concurrentes.
--   2. ContratoJornada — solo CHECK horaFin>horaInicio; el no-traslape entre
--      jornadas de contratos vigentes del mismo consultorio se valida en el
--      ROUTER (cruza contratos distintos, no modelable con un solo EXCLUDE
--      por fila sin duplicar el join contra ContratoArrendamiento en cada
--      constraint).
--   3. ContratoCargo — UNIQUE (contratoId, periodo, concepto) para
--      idempotencia del devengo (US.AFIL.1.4 AC2) y de la carga manual.
--   4. RLS + audit — patrón exacto sql/243 §2 (loop DO $$ sobre las 3 tablas).
--   5. RBAC — recursos `contrato_arrendamiento` (leer,crear,editar,activar,
--      terminar) y `contrato_cargo` (leer,generar,anular) — nota: difiere de
--      REQ §7.1 (que incluye contrato_cargo:publicar_odoo) porque esa acción
--      no tiene código detrás en esta ola (cero Odoo, ver arriba). Roles
--      ADMIN/DIR/ADMIN_CONSULTORIOS (ADMIN_CONSULTORIOS ya sembrado en
--      sql/244).
--   6. Cron `contrato_devengo_mensual` — 08:00 UTC = 02:00 America/El_Salvador
--      (UTC-6 fijo, sin DST — NFR-6), diario. Procesa contratos VIGENTES cuyo
--      diaCorte coincide con el día del mes LOCAL de hoy (con LEAST contra
--      los días del mes para que diaCorte=31 no se salte febrero/meses de 30
--      días — cae el último día del mes en su lugar). Esto soporta
--      diaCorte≠1 con UN solo cron diario en vez de N crons por diaCorte.
--      Idempotente por el UNIQUE de ContratoCargo (ON CONFLICT DO NOTHING).
--      `periodo` es SIEMPRE el primer día del mes calendario que contiene
--      "hoy" (local) — diaCorte decide CUÁNDO corre el cron, no qué período
--      factura (ver packages/trpc/src/lib/contrato-devengo.ts).
--
-- Idempotente. Aplicar vía mcp apply_migration en una sola transacción.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ContratoArrendamiento
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."ContratoArrendamiento" (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"          uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "medicoAfiliadoId"        uuid NOT NULL REFERENCES public."MedicoAfiliado"(id) ON DELETE RESTRICT,
  "consultorioId"           uuid NOT NULL REFERENCES public."Consultorio"(id) ON DELETE RESTRICT,
  folio                     varchar(20)  NOT NULL,
  modalidad                 varchar(30)  NOT NULL
    CONSTRAINT chk_contrato_arrendamiento_modalidad CHECK (modalidad IN ('EXCLUSIVO', 'COMPARTIDO_POR_JORNADA')),
  "fechaInicio"             date NOT NULL,
  "fechaFin"                date NULL,
  "plazoMeses"              int NULL,
  "rentaMensual"            numeric(14,2) NOT NULL CHECK ("rentaMensual" > 0),
  "cuotaServicios"          numeric(14,2) NOT NULL DEFAULT 0 CHECK ("cuotaServicios" >= 0),
  "currencyId"              uuid NOT NULL REFERENCES public."Currency"(id) ON DELETE RESTRICT,
  "diaCorte"                int NOT NULL DEFAULT 1 CHECK ("diaCorte" BETWEEN 1 AND 31),
  "plazoPagoDias"           int NOT NULL DEFAULT 5 CHECK ("plazoPagoDias" > 0),
  "ivaAplica"               boolean NOT NULL DEFAULT true,
  "indexacionAnualPct"      numeric(7,4) NULL,
  "depositoGarantia"        numeric(14,2) NOT NULL DEFAULT 0,
  "renovacionAutomatica"    boolean NOT NULL DEFAULT false,
  "mesesPreavisoTermino"    int NOT NULL DEFAULT 2,
  "costCenterId"            uuid NULL REFERENCES public."CostCenter"(id) ON DELETE SET NULL,
  estado                    varchar(20) NOT NULL DEFAULT 'BORRADOR'
    CONSTRAINT chk_contrato_arrendamiento_estado CHECK (estado IN (
      'BORRADOR', 'VIGENTE', 'EN_MORA', 'SUSPENDIDO', 'TERMINADO', 'RENOVADO'
    )),
  notas                     text NULL,
  "createdAt"               timestamptz NOT NULL DEFAULT now(),
  "createdBy"               uuid NULL,
  "updatedAt"               timestamptz NOT NULL DEFAULT now(),
  "updatedBy"               uuid NULL,
  CONSTRAINT "ContratoArrendamiento_organizationId_folio_key" UNIQUE ("organizationId", folio),
  CONSTRAINT chk_contrato_arrendamiento_fechas CHECK ("fechaFin" IS NULL OR "fechaFin" >= "fechaInicio")
);

-- Antitraslape EXCLUSIVO (US.AFIL.1.3 AC2) — solo entre filas cuyo estado
-- satisface el predicado (VIGENTE/EN_MORA); ver nota de diseño en la cabecera.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'excl_contrato_arrendamiento_exclusivo') THEN
    ALTER TABLE public."ContratoArrendamiento"
      ADD CONSTRAINT excl_contrato_arrendamiento_exclusivo
      EXCLUDE USING gist (
        "consultorioId" WITH =,
        daterange("fechaInicio", COALESCE("fechaFin", 'infinity'::date)) WITH &&
      ) WHERE (estado IN ('VIGENTE', 'EN_MORA') AND modalidad = 'EXCLUSIVO');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contrato_arrendamiento_org ON public."ContratoArrendamiento" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_contrato_arrendamiento_medico ON public."ContratoArrendamiento" ("medicoAfiliadoId");
CREATE INDEX IF NOT EXISTS idx_contrato_arrendamiento_consultorio ON public."ContratoArrendamiento" ("consultorioId");
CREATE INDEX IF NOT EXISTS idx_contrato_arrendamiento_estado ON public."ContratoArrendamiento" (estado);
-- Soporte del cron de devengo mensual — filtra directo por VIGENTE + diaCorte.
CREATE INDEX IF NOT EXISTS idx_contrato_arrendamiento_vigente_corte
  ON public."ContratoArrendamiento" (estado, "diaCorte")
  WHERE estado = 'VIGENTE';

COMMENT ON TABLE public."ContratoArrendamiento" IS
  'CC-0036 Ola 2 / US.AFIL.1.3 — contrato de arrendamiento de consultorio entre '
  'Avante y el médico afiliado. Folio fn_next_contrato_arrendamiento(). '
  'Antitraslape EXCLUSIVO por EXCLUDE gist (solo VIGENTE/EN_MORA). '
  'REQ-HIS-AFIL-001 §5.1 Bloque A. Cero integración Odoo esta ola (ver cabecera sql/245).';

-- ---------------------------------------------------------------------------
-- 2. ContratoJornada — solo para modalidad COMPARTIDO_POR_JORNADA.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."ContratoJornada" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contratoId"  uuid NOT NULL REFERENCES public."ContratoArrendamiento"(id) ON DELETE CASCADE,
  "diaSemana"   smallint NOT NULL CHECK ("diaSemana" BETWEEN 0 AND 6),
  "horaInicio"  time NOT NULL,
  "horaFin"     time NOT NULL,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "createdBy"   uuid NULL,
  CONSTRAINT chk_contrato_jornada_rango CHECK ("horaFin" > "horaInicio")
);

CREATE INDEX IF NOT EXISTS idx_contrato_jornada_contrato ON public."ContratoJornada" ("contratoId");
-- Soporte de la validación de no-traslape entre contratos del mismo
-- consultorio (router): se resuelve el consultorioId vía join a
-- ContratoArrendamiento, este índice acelera ese join por diaSemana.
CREATE INDEX IF NOT EXISTS idx_contrato_jornada_dia ON public."ContratoJornada" ("contratoId", "diaSemana");

COMMENT ON TABLE public."ContratoJornada" IS
  'CC-0036 Ola 2 / US.AFIL.1.3 AC3 — jornadas semanales de un contrato '
  'COMPARTIDO_POR_JORNADA. No-traslape entre jornadas de contratos vigentes '
  'del mismo consultorio validado en el router (cruza filas de contratos '
  'distintos, no modelable en un EXCLUDE de esta tabla). REQ-HIS-AFIL-001 §5.1 Bloque A.';

-- ---------------------------------------------------------------------------
-- 3. ContratoCargo — devengo mensual (US.AFIL.1.4).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."ContratoCargo" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"  uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "contratoId"      uuid NOT NULL REFERENCES public."ContratoArrendamiento"(id) ON DELETE RESTRICT,
  periodo           date NOT NULL,
  concepto          varchar(20) NOT NULL
    CONSTRAINT chk_contrato_cargo_concepto CHECK (concepto IN ('RENTA', 'SERVICIOS', 'MORA', 'AJUSTE', 'DEPOSITO')),
  monto             numeric(14,2) NOT NULL,
  "currencyId"      uuid NOT NULL REFERENCES public."Currency"(id) ON DELETE RESTRICT,
  -- Vocabulario completo del REQ declarado por completitud del CHECK; esta
  -- ola solo produce/transiciona DEVENGADO->ANULADO. ENVIADO_ODOO/FACTURADO/
  -- PAGADO son RESERVADOS sin código (ver cabecera).
  estado            varchar(20) NOT NULL DEFAULT 'DEVENGADO'
    CONSTRAINT chk_contrato_cargo_estado CHECK (estado IN ('DEVENGADO', 'ENVIADO_ODOO', 'FACTURADO', 'PAGADO', 'ANULADO')),
  -- RESERVADO — sin escritor en esta ola (cero integración Odoo).
  "odooInvoiceId"   int NULL,
  "odooSyncedAt"    timestamptz NULL,
  "motivoAnulacion" varchar(500) NULL,
  "generadoAt"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ContratoCargo_contratoId_periodo_concepto_key" UNIQUE ("contratoId", periodo, concepto)
);

CREATE INDEX IF NOT EXISTS idx_contrato_cargo_org ON public."ContratoCargo" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_contrato_cargo_contrato ON public."ContratoCargo" ("contratoId", periodo DESC);
CREATE INDEX IF NOT EXISTS idx_contrato_cargo_estado ON public."ContratoCargo" (estado);

COMMENT ON TABLE public."ContratoCargo" IS
  'CC-0036 Ola 2 / US.AFIL.1.4 — devengo mensual de un ContratoArrendamiento '
  '(RENTA/SERVICIOS, prorrateado en activación/término). UNIQUE '
  '(contratoId, periodo, concepto) da idempotencia al cron y a la generación '
  'manual. odooInvoiceId/odooSyncedAt y los estados ENVIADO_ODOO/FACTURADO/'
  'PAGADO son RESERVADOS — sin escritor en esta ola (decisión Edwin '
  '2026-09-15, cero integración Odoo, ver cabecera sql/245). '
  'REQ-HIS-AFIL-001 §5.1 Bloque A.';

-- ---------------------------------------------------------------------------
-- 4. Secuencia de folio + fn_next_contrato_arrendamiento — patrón CC-0020
--    desde el origen (secuencia_* con RLS deny-all + sin grants API, no como
--    hardening posterior; ver sql/196_cc0020_hardening_advisors.sql).
--    Folio: 'ARR-' || correlativo de 6 dígitos por organización (sin bucket
--    de año — el arrendamiento es plurianual, a diferencia de
--    fn_next_solicitud_imagen que sí bucketea por año).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.secuencia_contrato_arrendamiento (
  organization_id uuid PRIMARY KEY,
  last_value      int  NOT NULL DEFAULT 0
);

REVOKE ALL ON public.secuencia_contrato_arrendamiento FROM anon, authenticated;
ALTER TABLE public.secuencia_contrato_arrendamiento ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.secuencia_contrato_arrendamiento IS
  'CC-0036 Ola 2 — contador interno, solo accesible por fn_next_contrato_arrendamiento (SECDEF). RLS deny-all + sin grants API (patrón CC-0020).';

CREATE OR REPLACE FUNCTION public.fn_next_contrato_arrendamiento(p_org uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v int;
BEGIN
  INSERT INTO public.secuencia_contrato_arrendamiento (organization_id, last_value)
    VALUES (p_org, 1)
  ON CONFLICT (organization_id)
    DO UPDATE SET last_value = public.secuencia_contrato_arrendamiento.last_value + 1
  RETURNING last_value INTO v;
  RETURN v;
END;
$$;

COMMENT ON FUNCTION public.fn_next_contrato_arrendamiento(uuid) IS
  'CC-0036 Ola 2 (US.AFIL.1.3 AC1) — correlativo atómico por organización para '
  'el folio ARR-{NNNNNN} de ContratoArrendamiento. El router arma el folio '
  '(prefijo ''ARR-'' + LPAD a 6 dígitos) a partir del entero devuelto.';

-- ---------------------------------------------------------------------------
-- 5. RLS + grants + audit — patrón exacto sql/243 §2 (loop sobre las 3 tablas).
-- ---------------------------------------------------------------------------

ALTER TABLE public."ContratoArrendamiento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ContratoCargo" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."ContratoArrendamiento" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ContratoCargo" TO authenticated;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['ContratoArrendamiento', 'ContratoCargo'];
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

-- ContratoJornada — sin organizationId propio (tabla puente REQ-fiel, mismo
-- patrón que MedicoAfiliadoEspecialidad en sql/244): RLS vía EXISTS contra
-- ContratoArrendamiento.
ALTER TABLE public."ContratoJornada" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."ContratoJornada" TO authenticated;

DROP POLICY IF EXISTS contrato_jornada_isolation ON public."ContratoJornada";
CREATE POLICY contrato_jornada_isolation ON public."ContratoJornada"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."ContratoArrendamiento" ca
    WHERE ca.id = "contratoId"
      AND (ca."organizationId" = public.current_org_id() OR public.is_break_glass())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."ContratoArrendamiento" ca
    WHERE ca.id = "contratoId"
      AND ca."organizationId" = public.current_org_id()
  ));

DROP TRIGGER IF EXISTS trg_audit_ContratoJornada ON public."ContratoJornada";
CREATE TRIGGER trg_audit_ContratoJornada
  AFTER INSERT OR UPDATE OR DELETE ON public."ContratoJornada"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();

-- ---------------------------------------------------------------------------
-- 6. RBAC — recursos `contrato_arrendamiento` y `contrato_cargo` (Permission)
--    + RolePermission para ADMIN/DIR/ADMIN_CONSULTORIOS (ya sembrado sql/244).
--    Difiere de REQ §7.1 en contrato_cargo: sin `publicar_odoo` (cero Odoo
--    esta ola, ver cabecera).
-- ---------------------------------------------------------------------------

INSERT INTO public."Permission" (id, code, resource, action, "createdAt")
SELECT gen_random_uuid(), v.code, v.resource, v.action, now()
FROM (VALUES
  ('contrato_arrendamiento.leer',    'contrato_arrendamiento', 'leer'),
  ('contrato_arrendamiento.crear',   'contrato_arrendamiento', 'crear'),
  ('contrato_arrendamiento.editar',  'contrato_arrendamiento', 'editar'),
  ('contrato_arrendamiento.activar', 'contrato_arrendamiento', 'activar'),
  ('contrato_arrendamiento.terminar','contrato_arrendamiento', 'terminar'),
  ('contrato_cargo.leer',            'contrato_cargo',         'leer'),
  ('contrato_cargo.generar',         'contrato_cargo',         'generar'),
  ('contrato_cargo.anular',          'contrato_cargo',         'anular')
) AS v(code, resource, action)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public."RolePermission" ("roleId", "permissionId", effect)
SELECT r.id, p.id, 'ALLOW'
FROM (VALUES
  ('ADMIN',              'contrato_arrendamiento.leer'),
  ('ADMIN',              'contrato_arrendamiento.crear'),
  ('ADMIN',              'contrato_arrendamiento.editar'),
  ('ADMIN',              'contrato_arrendamiento.activar'),
  ('ADMIN',              'contrato_arrendamiento.terminar'),
  ('ADMIN',              'contrato_cargo.leer'),
  ('ADMIN',              'contrato_cargo.generar'),
  ('ADMIN',              'contrato_cargo.anular'),
  ('DIR',                'contrato_arrendamiento.leer'),
  ('DIR',                'contrato_arrendamiento.crear'),
  ('DIR',                'contrato_arrendamiento.editar'),
  ('DIR',                'contrato_arrendamiento.activar'),
  ('DIR',                'contrato_arrendamiento.terminar'),
  ('DIR',                'contrato_cargo.leer'),
  ('DIR',                'contrato_cargo.generar'),
  ('DIR',                'contrato_cargo.anular'),
  ('ADMIN_CONSULTORIOS', 'contrato_arrendamiento.leer'),
  ('ADMIN_CONSULTORIOS', 'contrato_arrendamiento.crear'),
  ('ADMIN_CONSULTORIOS', 'contrato_arrendamiento.editar'),
  ('ADMIN_CONSULTORIOS', 'contrato_arrendamiento.activar'),
  ('ADMIN_CONSULTORIOS', 'contrato_arrendamiento.terminar'),
  ('ADMIN_CONSULTORIOS', 'contrato_cargo.leer'),
  ('ADMIN_CONSULTORIOS', 'contrato_cargo.generar'),
  ('ADMIN_CONSULTORIOS', 'contrato_cargo.anular')
) AS g(role_code, perm_code)
JOIN public."Role" r ON r.code = g.role_code
JOIN public."Permission" p ON p.code = g.perm_code
ON CONFLICT ("roleId", "permissionId") DO UPDATE SET effect = 'ALLOW';

-- ---------------------------------------------------------------------------
-- 7. Cron — contrato_devengo_mensual (US.AFIL.1.4 AC1/AC2). Diario 08:00 UTC
--    (= 02:00 America/El_Salvador, UTC-6 fijo). Un solo cron soporta
--    cualquier diaCorte: solo actúa sobre contratos cuyo diaCorte coincide
--    con el día del mes LOCAL de hoy (LEAST contra días del mes evita que
--    diaCorte=29/30/31 se salte meses cortos — cae el último día del mes).
--    Idempotente por UNIQUE(contratoId, periodo, concepto): ON CONFLICT DO
--    NOTHING + RETURNING solo trae las filas realmente insertadas, así que el
--    DomainEvent solo se emite para cargos nuevos (no re-emite en reintentos
--    ni si `activar`/`terminar` ya generaron el cargo del período vía prorrateo).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  existing_job INT;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'contrato_devengo_mensual';

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
END $$;

SELECT cron.schedule(
  'contrato_devengo_mensual',
  '0 8 * * *',
  $$
    WITH local_now AS (
      SELECT (NOW() AT TIME ZONE 'America/El_Salvador') AS ts
    ),
    due_contratos AS (
      SELECT ca.id AS "contratoId", ca."organizationId", ca.folio,
             ca."rentaMensual", ca."cuotaServicios", ca."currencyId"
      FROM public."ContratoArrendamiento" ca, local_now
      WHERE ca.estado = 'VIGENTE'
        AND EXTRACT(DAY FROM local_now.ts)::int = LEAST(
              ca."diaCorte",
              EXTRACT(DAY FROM (date_trunc('month', local_now.ts) + INTERVAL '1 month - 1 day'))::int
            )
    ),
    periodo_actual AS (
      SELECT date_trunc('month', (SELECT ts FROM local_now))::date AS periodo
    ),
    cargos_candidatos AS (
      SELECT d."contratoId", d."organizationId", p.periodo, 'RENTA'::varchar AS concepto,
             d."rentaMensual" AS monto, d."currencyId"
      FROM due_contratos d, periodo_actual p
      UNION ALL
      SELECT d."contratoId", d."organizationId", p.periodo, 'SERVICIOS'::varchar, d."cuotaServicios", d."currencyId"
      FROM due_contratos d, periodo_actual p
      WHERE d."cuotaServicios" > 0
    ),
    inserted AS (
      INSERT INTO public."ContratoCargo" (
        "organizationId", "contratoId", periodo, concepto, monto, "currencyId", estado, "generadoAt"
      )
      SELECT "organizationId", "contratoId", periodo, concepto, monto, "currencyId", 'DEVENGADO', now()
      FROM cargos_candidatos
      ON CONFLICT ("contratoId", periodo, concepto) DO NOTHING
      RETURNING id, "organizationId", "contratoId", periodo, concepto, monto
    )
    INSERT INTO public."DomainEvent" (
      "organizationId", "eventType", "aggregateType", "aggregateId",
      "emittedById", payload, "occurredAt"
    )
    SELECT
      i."organizationId",
      'contrato.cargo.devengado',
      'ContratoCargo',
      i.id,
      NULL,
      jsonb_build_object(
        'contratoId', i."contratoId",
        'cargoId', i.id,
        'folio', d.folio,
        'concepto', i.concepto,
        'monto', i.monto,
        'periodo', to_char(i.periodo, 'YYYY-MM-DD')
      ),
      now()
    FROM inserted i
    JOIN due_contratos d ON d."contratoId" = i."contratoId";
  $$
);

COMMIT;
