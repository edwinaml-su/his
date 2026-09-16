-- ============================================================================
-- 248_cc0036_honorarios.sql
-- CC-0036 Ola 5 — Honorarios médicos: convenios, atribución de producción,
-- cargo en cuenta y liquidación (REQ-HIS-AFIL-001 §5.1 Bloque B, Sprint S6,
-- US.AFIL.1.5 / US.AFIL.1.6 / US.AFIL.1.7).
--
-- ⚠️ DECISIÓN DE EDWIN MARTINEZ 2026-09-15 #1 (hub de eventos, misma que
-- sql/245): CERO integración con Odoo en esta ola. `Liquidacion` llega hasta
-- `APROBADA` y emite `liquidacion.aprobada` al outbox `DomainEvent`. Los
-- estados `ENVIADA_ODOO`/`PAGADA` y la columna `odooBillId`/`odooSyncedAt`
-- quedan RESERVADOS (vocabulario del CHECK) sin escritor en esta ola.
--
-- ⚠️ DECISIÓN DE EDWIN MARTINEZ 2026-09-15 #2 (verbatim resumido): "en la
-- cuenta hospitalaria SÍ van los honorarios médicos, además de
-- interconsultas, exámenes, medicamentos e insumos. El monto total por RUBRO
-- (por CENTRO DE COSTO y CUENTA CONTABLE) es lo que se le pasará al ERP para
-- la facturación". Implicaciones que ESTA migración materializa:
--   (a) `ReglaHonorario` gana `costCenterId` + `cuentaContableCodigo` — el
--       "rubro" se resuelve a nivel de REGLA (no de convenio) porque la
--       granularidad de negocio es por ámbito/rol (CIRUGIA-CIRUJANO puede
--       cobrar contra un centro de costo distinto de CONSULTA-TRATANTE del
--       mismo afiliado). `cuentaContableCodigo` es una FK LÓGICA (varchar) a
--       `Account.code` (catálogo contable multi-libro, Beta.18 #526/#527) —
--       sin `@relation`/FK dura porque `Account.code` es único por LEDGER
--       (`@@unique([ledgerId, code])`), no global; el mismo patrón que
--       `TipoCuenta.priceListId` (FK lógica documentada, sin relación Prisma).
--   (b) `ProduccionMedica.cargoHonorarioId` (FK a `PatientAccountService`,
--       nullable) — el REQ define `patientAccountServiceId` como el cargo
--       ORIGEN que generó el honorario (la cirugía, la consulta...);
--       `cargoHonorarioId` es el cargo NUEVO `origen='HONORARIO_MEDICO'` que
--       la atribución crea en la misma cuenta (packages/trpc/src/lib/
--       produccion-atribucion.ts). Son dos cargos distintos en la misma
--       cuenta — el vínculo permite trazar producción -> ambos.
--   (c) El agregado `calcularResumenRubros` (packages/trpc/src/lib/
--       resumen-rubros.ts, expuesto como query en honorario.router.ts) y el
--       evento `cuenta.resumen_rubros` (emitido tras `patientAccount.cerrar`
--       en patient-account.router.ts, no-bloqueante) NO requieren columnas
--       nuevas: agregan sobre `PatientAccountService` existente +
--       `ReglaHonorario` para las líneas `HONORARIO_MEDICO`. Los demás
--       orígenes (farmacia/lab/imágenes) quedan con cuenta contable
--       pendiente de mapeo general — GAP documentado, no de esta ola.
--
-- Numeración: el REQ sugiere sql/242/243 para este bloque; la numeración real
-- del repo manda (igual que sql/243-247) — 248 es la siguiente libre tras
-- sql/247 (Ola 4, agenda-operación). btree_gist ya está instalada (sql/243).
--
-- Secciones:
--   1. ConvenioHonorario — EXCLUDE gist antitraslape VIGENTE, bounds '[]'
--      (lección sql/245: fechas de negocio inclusivas).
--   2. ReglaHonorario — sin organizationId propio (RLS vía join, patrón
--      ContratoJornada/sql/245). CHECK de coherencia tipoCalculo/monto.
--   3. ProduccionMedica — UNIQUE (patientAccountServiceId, medicoAfiliadoId,
--      rolMedico) da idempotencia (US.AFIL.1.6 AC3).
--   4. Liquidacion + LiquidacionCompensacion — folio fn_next_liquidacion
--      (patrón CC-0020, idéntico a fn_next_contrato_arrendamiento de sql/245
--      §4). LiquidacionCompensacion sin organizationId propio (RLS vía join).
--   5. RLS + audit — patrón exacto sql/245 §5 (loop DO $$).
--   6. RBAC — recursos `convenio_honorario` (leer,crear,editar,activar),
--      `produccion_medica` (leer,excluir,reprocesar), `liquidacion`
--      (leer,generar,aprobar,anular) — sin `publicar_odoo` (cero Odoo, ver
--      decisión #1). Roles ANALISTA_HONORARIOS/GERENTE_FINANCIERO nuevos por
--      organización activa (patrón sql/244 §5). Segregación generador≠
--      aprobador de liquidación es un GUARD DE ROUTER (honorario.router.ts),
--      no expresable como CHECK de fila sin acceso al usuario actual.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ConvenioHonorario
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."ConvenioHonorario" (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"      uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "medicoAfiliadoId"    uuid NOT NULL REFERENCES public."MedicoAfiliado"(id) ON DELETE RESTRICT,
  "vigenciaDesde"       date NOT NULL,
  "vigenciaHasta"       date NULL,
  "retencionRentaPct"   numeric(7,4) NOT NULL DEFAULT 0.10 CHECK ("retencionRentaPct" >= 0 AND "retencionRentaPct" <= 1),
  "aplicaIvaRetenido"   boolean NOT NULL DEFAULT false,
  "periodicidadLiquidacion" varchar(20) NOT NULL DEFAULT 'MENSUAL'
    CONSTRAINT chk_convenio_honorario_periodicidad CHECK ("periodicidadLiquidacion" IN ('QUINCENAL', 'MENSUAL')),
  estado                varchar(20) NOT NULL DEFAULT 'BORRADOR'
    CONSTRAINT chk_convenio_honorario_estado CHECK (estado IN ('BORRADOR', 'VIGENTE', 'TERMINADO')),
  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "createdBy"           uuid NULL,
  "updatedAt"           timestamptz NOT NULL DEFAULT now(),
  "updatedBy"           uuid NULL,
  CONSTRAINT chk_convenio_honorario_fechas CHECK ("vigenciaHasta" IS NULL OR "vigenciaHasta" >= "vigenciaDesde")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'excl_convenio_honorario_vigente') THEN
    ALTER TABLE public."ConvenioHonorario"
      ADD CONSTRAINT excl_convenio_honorario_vigente
      EXCLUDE USING gist (
        "medicoAfiliadoId" WITH =,
        -- Bounds '[]' explícitos — misma lección que sql/245 (fechaFin inclusiva).
        daterange("vigenciaDesde", COALESCE("vigenciaHasta", 'infinity'::date), '[]') WITH &&
      ) WHERE (estado = 'VIGENTE');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_convenio_honorario_org ON public."ConvenioHonorario" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_convenio_honorario_medico ON public."ConvenioHonorario" ("medicoAfiliadoId");
CREATE INDEX IF NOT EXISTS idx_convenio_honorario_estado ON public."ConvenioHonorario" (estado);

COMMENT ON TABLE public."ConvenioHonorario" IS
  'CC-0036 Ola 5 / US.AFIL.1.5 — convenio de honorarios de un médico afiliado. '
  'Antitraslape VIGENTE por EXCLUDE gist. retencionRentaPct/aplicaIvaRetenido/'
  'periodicidadLiquidacion son parametrizables por convenio (§15 preguntas '
  'abiertas del REQ) — NUNCA hardcodear. REQ-HIS-AFIL-001 §5.1 Bloque B.';

-- ---------------------------------------------------------------------------
-- 2. ReglaHonorario — sin organizationId propio (RLS vía join a ConvenioHonorario).
--    + costCenterId/cuentaContableCodigo (Decisión Edwin #2a — "rubro").
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."ReglaHonorario" (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "convenioId"       uuid NOT NULL REFERENCES public."ConvenioHonorario"(id) ON DELETE CASCADE,
  ambito             varchar(30) NOT NULL
    CONSTRAINT chk_regla_honorario_ambito CHECK (ambito IN (
      'CIRUGIA', 'CONSULTA', 'PROCEDIMIENTO', 'INTERPRETACION', 'VISITA_HOSPITALARIA', 'INSUMO'
    )),
  "rolMedico"        varchar(20) NULL
    CONSTRAINT chk_regla_honorario_rol CHECK ("rolMedico" IS NULL OR "rolMedico" IN (
      'TRATANTE', 'CIRUJANO', 'AYUDANTE', 'ANESTESISTA', 'INTERPRETE', 'REFERENTE'
    )),
  "serviceCategoryId" uuid NULL, -- FK lógica -> ServiceCategory (tabla fuera de schema.prisma, sql/133).
  "codigoServicio"    varchar(40) NULL, -- FK lógica -> ServicePriceListItem.code.
  "tipoCalculo"       varchar(20) NOT NULL
    CONSTRAINT chk_regla_honorario_tipo_calculo CHECK ("tipoCalculo" IN ('PORCENTAJE', 'MONTO_FIJO')),
  porcentaje         numeric(7,4) NULL CHECK (porcentaje IS NULL OR (porcentaje >= 0 AND porcentaje <= 1)),
  "montoFijo"        numeric(14,2) NULL CHECK ("montoFijo" IS NULL OR "montoFijo" >= 0),
  "montoMinimo"      numeric(14,2) NULL CHECK ("montoMinimo" IS NULL OR "montoMinimo" >= 0),
  "montoMaximo"      numeric(14,2) NULL CHECK ("montoMaximo" IS NULL OR "montoMaximo" >= 0),
  prioridad          int NOT NULL DEFAULT 0,
  -- Decisión Edwin #2b — "rubro" = centro de costo + cuenta contable del honorario.
  "costCenterId"       uuid NULL REFERENCES public."CostCenter"(id) ON DELETE SET NULL,
  "cuentaContableCodigo" varchar(40) NULL, -- FK lógica -> Account.code (único por ledgerId, no global).
  active             boolean NOT NULL DEFAULT true,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "createdBy"        uuid NULL,
  "updatedAt"        timestamptz NOT NULL DEFAULT now(),
  "updatedBy"        uuid NULL,
  CONSTRAINT chk_regla_honorario_calculo CHECK (
    ("tipoCalculo" = 'PORCENTAJE' AND porcentaje IS NOT NULL)
    OR ("tipoCalculo" = 'MONTO_FIJO' AND "montoFijo" IS NOT NULL)
  ),
  CONSTRAINT chk_regla_honorario_min_max CHECK (
    "montoMinimo" IS NULL OR "montoMaximo" IS NULL OR "montoMaximo" >= "montoMinimo"
  )
);

CREATE INDEX IF NOT EXISTS idx_regla_honorario_convenio ON public."ReglaHonorario" ("convenioId");
CREATE INDEX IF NOT EXISTS idx_regla_honorario_ambito ON public."ReglaHonorario" ("convenioId", ambito, active);
CREATE INDEX IF NOT EXISTS idx_regla_honorario_codigo ON public."ReglaHonorario" ("codigoServicio") WHERE "codigoServicio" IS NOT NULL;

COMMENT ON TABLE public."ReglaHonorario" IS
  'CC-0036 Ola 5 / US.AFIL.1.5 — regla de cálculo de honorario por ámbito/rol/'
  'categoría/código dentro de un ConvenioHonorario. Resolución por '
  'especificidad (codigoServicio > serviceCategoryId > ambito) -> prioridad '
  'desc -> createdAt desc, patrón ServicePriceRule (CC-0021) — ver '
  'packages/trpc/src/lib/honorario-resolver.ts. costCenterId/'
  'cuentaContableCodigo = "rubro" del honorario (Decisión Edwin 2026-09-16 '
  '#2b) para el agregado resumenPorRubro rumbo al ERP. REQ-HIS-AFIL-001 §5.1 Bloque B.';

-- ---------------------------------------------------------------------------
-- 3. ProduccionMedica
--    + cargoHonorarioId (Decisión Edwin #2a): el cargo HONORARIO_MEDICO nuevo,
--      distinto de patientAccountServiceId (el cargo ORIGEN, definición REQ).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."ProduccionMedica" (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"         uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "establishmentId"        uuid NOT NULL REFERENCES public."Establishment"(id) ON DELETE RESTRICT,
  "medicoAfiliadoId"       uuid NOT NULL REFERENCES public."MedicoAfiliado"(id) ON DELETE RESTRICT,
  "rolMedico"              varchar(20) NOT NULL
    CONSTRAINT chk_produccion_medica_rol CHECK ("rolMedico" IN (
      'TRATANTE', 'CIRUJANO', 'AYUDANTE', 'ANESTESISTA', 'INTERPRETE', 'REFERENTE'
    )),
  "patientAccountServiceId" uuid NOT NULL REFERENCES public."PatientAccountService"(id) ON DELETE RESTRICT,
  "encounterId"            uuid NULL REFERENCES public."Encounter"(id) ON DELETE SET NULL,
  fecha                    date NOT NULL,
  "montoFacturado"         numeric(14,2) NOT NULL,
  "honorarioCalculado"     numeric(14,2) NOT NULL,
  "reglaHonorarioId"       uuid NULL REFERENCES public."ReglaHonorario"(id) ON DELETE SET NULL,
  estado                   varchar(20) NOT NULL DEFAULT 'PENDIENTE'
    CONSTRAINT chk_produccion_medica_estado CHECK (estado IN ('PENDIENTE', 'LIQUIDADO', 'EXCLUIDO', 'REVERSADO')),
  "liquidacionId"          uuid NULL, -- FK a Liquidacion agregada más abajo (orden de creación de tablas).
  -- MANUAL = exclusión hecha por un analista vía produccion.excluir (US.AFIL.1.5/1.6);
  -- el texto libre que la sustenta va en motivoDetalle (revisión pre-PR, hallazgo #1).
  "motivoExclusion"        varchar(40) NULL
    CONSTRAINT chk_produccion_medica_motivo CHECK ("motivoExclusion" IS NULL OR "motivoExclusion" IN (
      'SIN_REGLA', 'PERSONAL_DE_PLANTA', 'MANUAL'
    )),
  "motivoDetalle"          varchar(200) NULL,
  -- Decisión Edwin #2a — cargo HONORARIO_MEDICO creado por la atribución (NULL si honorarioCalculado=0/EXCLUIDO).
  "cargoHonorarioId"       uuid NULL REFERENCES public."PatientAccountService"(id) ON DELETE SET NULL,
  "createdAt"              timestamptz NOT NULL DEFAULT now(),
  "createdBy"              uuid NULL,
  "updatedAt"              timestamptz NOT NULL DEFAULT now(),
  "updatedBy"              uuid NULL,
  CONSTRAINT "ProduccionMedica_pas_medico_rol_key" UNIQUE ("patientAccountServiceId", "medicoAfiliadoId", "rolMedico")
);

CREATE INDEX IF NOT EXISTS idx_produccion_medica_org ON public."ProduccionMedica" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_produccion_medica_medico ON public."ProduccionMedica" ("medicoAfiliadoId", estado);
CREATE INDEX IF NOT EXISTS idx_produccion_medica_liquidacion ON public."ProduccionMedica" ("liquidacionId");
CREATE INDEX IF NOT EXISTS idx_produccion_medica_estado ON public."ProduccionMedica" (estado);
CREATE INDEX IF NOT EXISTS idx_produccion_medica_pendiente_periodo
  ON public."ProduccionMedica" ("medicoAfiliadoId", fecha) WHERE estado = 'PENDIENTE';

COMMENT ON TABLE public."ProduccionMedica" IS
  'CC-0036 Ola 5 / US.AFIL.1.6 — atribución de producción a un médico afiliado '
  'por rol sobre un cargo (patientAccountServiceId = cargo ORIGEN). UNIQUE '
  '(patientAccountServiceId, medicoAfiliadoId, rolMedico) da idempotencia '
  '(AC3). cargoHonorarioId = cargo HONORARIO_MEDICO nuevo creado en la misma '
  'cuenta (Decisión Edwin 2026-09-16 #2a) — distinto del cargo origen. '
  'motivoExclusion=MANUAL + motivoDetalle = exclusión manual de un analista '
  '(produccion.excluir), distinta de SIN_REGLA/PERSONAL_DE_PLANTA (automáticas). '
  'REQ-HIS-AFIL-001 §5.1 Bloque B.';

-- ---------------------------------------------------------------------------
-- 4. Liquidacion + LiquidacionCompensacion
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."Liquidacion" (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"       uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "medicoAfiliadoId"     uuid NOT NULL REFERENCES public."MedicoAfiliado"(id) ON DELETE RESTRICT,
  folio                  varchar(20) NOT NULL,
  "periodoDesde"         date NOT NULL,
  "periodoHasta"         date NOT NULL,
  "totalBruto"           numeric(14,2) NOT NULL DEFAULT 0,
  "totalRetenciones"     numeric(14,2) NOT NULL DEFAULT 0,
  "totalCompensaciones"  numeric(14,2) NOT NULL DEFAULT 0,
  "totalNeto"            numeric(14,2) NOT NULL DEFAULT 0,
  "currencyId"           uuid NOT NULL REFERENCES public."Currency"(id) ON DELETE RESTRICT,
  -- Vocabulario completo del REQ; esta ola solo produce BORRADOR/APROBADA/ANULADA
  -- (cero integración Odoo, decisión #1 — ENVIADA_ODOO/PAGADA reservados).
  estado                 varchar(20) NOT NULL DEFAULT 'BORRADOR'
    CONSTRAINT chk_liquidacion_estado CHECK (estado IN ('BORRADOR', 'APROBADA', 'ENVIADA_ODOO', 'PAGADA', 'ANULADA')),
  "aprobadaBy"           uuid NULL,
  "aprobadaAt"           timestamptz NULL,
  "motivoAnulacion"      varchar(500) NULL,
  -- RESERVADO — sin escritor en esta ola.
  "odooBillId"           int NULL,
  "odooSyncedAt"         timestamptz NULL,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "createdBy"            uuid NULL,
  "updatedAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedBy"            uuid NULL,
  CONSTRAINT "Liquidacion_organizationId_folio_key" UNIQUE ("organizationId", folio),
  CONSTRAINT chk_liquidacion_periodo CHECK ("periodoHasta" >= "periodoDesde")
);

ALTER TABLE public."ProduccionMedica"
  ADD CONSTRAINT "ProduccionMedica_liquidacionId_fkey"
  FOREIGN KEY ("liquidacionId") REFERENCES public."Liquidacion"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_liquidacion_org ON public."Liquidacion" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_liquidacion_medico ON public."Liquidacion" ("medicoAfiliadoId", "periodoDesde");
CREATE INDEX IF NOT EXISTS idx_liquidacion_estado ON public."Liquidacion" (estado);
-- Idempotencia de "generar-reemplaza-BORRADOR" (US.AFIL.1.7 AC3): a lo sumo
-- una liquidación no-ANULADA por afiliado+período exacto.
CREATE UNIQUE INDEX IF NOT EXISTS uq_liquidacion_periodo_vigente
  ON public."Liquidacion" ("medicoAfiliadoId", "periodoDesde", "periodoHasta")
  WHERE estado <> 'ANULADA';

COMMENT ON TABLE public."Liquidacion" IS
  'CC-0036 Ola 5 / US.AFIL.1.7 — liquidación de honorarios por afiliado y '
  'período. Folio fn_next_liquidacion() formato LIQ-{NNNNNN}. Llega hasta '
  'APROBADA y emite liquidacion.aprobada al outbox (Decisión Edwin #1, cero '
  'Odoo esta ola) — ENVIADA_ODOO/PAGADA/odooBillId RESERVADOS sin escritor. '
  'uq_liquidacion_periodo_vigente da la semántica "generar reemplaza BORRADOR" '
  '(AC3) a nivel de BD. REQ-HIS-AFIL-001 §5.1 Bloque B.';

CREATE TABLE IF NOT EXISTS public."LiquidacionCompensacion" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "liquidacionId"  uuid NOT NULL REFERENCES public."Liquidacion"(id) ON DELETE CASCADE,
  "contratoCargoId" uuid NOT NULL REFERENCES public."ContratoCargo"(id) ON DELETE RESTRICT,
  monto            numeric(14,2) NOT NULL CHECK (monto > 0),
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "LiquidacionCompensacion_liquidacionId_contratoCargoId_key" UNIQUE ("liquidacionId", "contratoCargoId")
);

CREATE INDEX IF NOT EXISTS idx_liquidacion_compensacion_liquidacion ON public."LiquidacionCompensacion" ("liquidacionId");
CREATE INDEX IF NOT EXISTS idx_liquidacion_compensacion_cargo ON public."LiquidacionCompensacion" ("contratoCargoId");

COMMENT ON TABLE public."LiquidacionCompensacion" IS
  'CC-0036 Ola 5 / US.AFIL.1.7 AC2 — cruce de renta de arrendamiento en mora '
  'contra la liquidación de honorarios (permiteCompensacion), sin dejar '
  'totalNeto negativo. REQ-HIS-AFIL-001 §5.1 Bloque B.';

-- ---------------------------------------------------------------------------
-- 5. Secuencia de folio + fn_next_liquidacion — patrón idéntico
--    fn_next_contrato_arrendamiento (sql/245 §4).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.secuencia_liquidacion (
  organization_id uuid PRIMARY KEY,
  last_value      int  NOT NULL DEFAULT 0
);

REVOKE ALL ON public.secuencia_liquidacion FROM anon, authenticated;
ALTER TABLE public.secuencia_liquidacion ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.secuencia_liquidacion IS
  'CC-0036 Ola 5 — contador interno, solo accesible por fn_next_liquidacion (SECDEF). RLS deny-all + sin grants API (patrón CC-0020).';

CREATE OR REPLACE FUNCTION public.fn_next_liquidacion(p_org uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v int;
BEGIN
  INSERT INTO public.secuencia_liquidacion (organization_id, last_value)
    VALUES (p_org, 1)
  ON CONFLICT (organization_id)
    DO UPDATE SET last_value = public.secuencia_liquidacion.last_value + 1
  RETURNING last_value INTO v;
  RETURN v;
END;
$$;

COMMENT ON FUNCTION public.fn_next_liquidacion(uuid) IS
  'CC-0036 Ola 5 (US.AFIL.1.7 AC1) — correlativo atómico por organización para '
  'el folio LIQ-{NNNNNN} de Liquidacion. El router arma el folio (prefijo '
  '''LIQ-'' + LPAD a 6 dígitos) a partir del entero devuelto.';

-- ---------------------------------------------------------------------------
-- 6. RLS + grants + audit — patrón exacto sql/245 §5.
-- ---------------------------------------------------------------------------

ALTER TABLE public."ConvenioHonorario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProduccionMedica" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Liquidacion" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."ConvenioHonorario" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ProduccionMedica" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."Liquidacion" TO authenticated;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['ConvenioHonorario', 'ProduccionMedica', 'Liquidacion'];
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

-- ReglaHonorario / LiquidacionCompensacion — sin organizationId propio (tablas
-- puente REQ-fiel, mismo patrón que ContratoJornada en sql/245): RLS vía
-- EXISTS contra su tabla padre.
ALTER TABLE public."ReglaHonorario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LiquidacionCompensacion" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."ReglaHonorario" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."LiquidacionCompensacion" TO authenticated;

DROP POLICY IF EXISTS regla_honorario_isolation ON public."ReglaHonorario";
CREATE POLICY regla_honorario_isolation ON public."ReglaHonorario"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."ConvenioHonorario" ch
    WHERE ch.id = "convenioId"
      AND (ch."organizationId" = public.current_org_id() OR public.is_break_glass())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."ConvenioHonorario" ch
    WHERE ch.id = "convenioId"
      AND ch."organizationId" = public.current_org_id()
  ));

DROP TRIGGER IF EXISTS trg_audit_ReglaHonorario ON public."ReglaHonorario";
CREATE TRIGGER trg_audit_ReglaHonorario
  AFTER INSERT OR UPDATE OR DELETE ON public."ReglaHonorario"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();

DROP POLICY IF EXISTS liquidacion_compensacion_isolation ON public."LiquidacionCompensacion";
CREATE POLICY liquidacion_compensacion_isolation ON public."LiquidacionCompensacion"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."Liquidacion" l
    WHERE l.id = "liquidacionId"
      AND (l."organizationId" = public.current_org_id() OR public.is_break_glass())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."Liquidacion" l
    WHERE l.id = "liquidacionId"
      AND l."organizationId" = public.current_org_id()
  ));

DROP TRIGGER IF EXISTS trg_audit_LiquidacionCompensacion ON public."LiquidacionCompensacion";
CREATE TRIGGER trg_audit_LiquidacionCompensacion
  AFTER INSERT OR UPDATE OR DELETE ON public."LiquidacionCompensacion"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();

-- ---------------------------------------------------------------------------
-- 7. RBAC — recursos convenio_honorario/produccion_medica/liquidacion (REQ
--    §7.1, sin publicar_odoo — decisión #1) + roles ANALISTA_HONORARIOS/
--    GERENTE_FINANCIERO nuevos por organización activa (patrón sql/244 §5).
-- ---------------------------------------------------------------------------

INSERT INTO public."Permission" (id, code, resource, action, "createdAt")
SELECT gen_random_uuid(), v.code, v.resource, v.action, now()
FROM (VALUES
  ('convenio_honorario.leer',    'convenio_honorario', 'leer'),
  ('convenio_honorario.crear',   'convenio_honorario', 'crear'),
  ('convenio_honorario.editar',  'convenio_honorario', 'editar'),
  ('convenio_honorario.activar', 'convenio_honorario', 'activar'),
  ('produccion_medica.leer',       'produccion_medica', 'leer'),
  ('produccion_medica.excluir',    'produccion_medica', 'excluir'),
  ('produccion_medica.reprocesar', 'produccion_medica', 'reprocesar'),
  ('liquidacion.leer',     'liquidacion', 'leer'),
  ('liquidacion.generar',  'liquidacion', 'generar'),
  ('liquidacion.aprobar',  'liquidacion', 'aprobar'),
  ('liquidacion.anular',   'liquidacion', 'anular')
) AS v(code, resource, action)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public."Role" (id, "organizationId", code, name, description, active, "createdAt", "updatedAt")
SELECT gen_random_uuid(), o.id, v.code, v.name, v.description, true, now(), now()
FROM public."Organization" o
CROSS JOIN (VALUES
  ('ANALISTA_HONORARIOS', 'Analista de Honorarios', 'CC-0036 — configura convenios/reglas y genera liquidaciones de honorarios (REQ-HIS-AFIL-001 §7.2)'),
  ('GERENTE_FINANCIERO',  'Gerente Financiero',     'CC-0036 — aprueba/anula liquidaciones de honorarios (segregación generador≠aprobador, REQ-HIS-AFIL-001 §7.2)')
) AS v(code, name, description)
WHERE o.active = true
ON CONFLICT ("organizationId", code) DO NOTHING;

-- ADMIN/DIR: control total. ANALISTA_HONORARIOS: configura + genera (NO
-- aprueba/anula — segregación de funciones). GERENTE_FINANCIERO: aprueba/
-- anula + lee (NO genera lo que va a aprobar).
INSERT INTO public."RolePermission" ("roleId", "permissionId", effect)
SELECT r.id, p.id, 'ALLOW'
FROM (VALUES
  ('ADMIN', 'convenio_honorario.leer'),
  ('ADMIN', 'convenio_honorario.crear'),
  ('ADMIN', 'convenio_honorario.editar'),
  ('ADMIN', 'convenio_honorario.activar'),
  ('ADMIN', 'produccion_medica.leer'),
  ('ADMIN', 'produccion_medica.excluir'),
  ('ADMIN', 'produccion_medica.reprocesar'),
  ('ADMIN', 'liquidacion.leer'),
  ('ADMIN', 'liquidacion.generar'),
  ('ADMIN', 'liquidacion.aprobar'),
  ('ADMIN', 'liquidacion.anular'),
  ('DIR', 'convenio_honorario.leer'),
  ('DIR', 'convenio_honorario.crear'),
  ('DIR', 'convenio_honorario.editar'),
  ('DIR', 'convenio_honorario.activar'),
  ('DIR', 'produccion_medica.leer'),
  ('DIR', 'produccion_medica.excluir'),
  ('DIR', 'produccion_medica.reprocesar'),
  ('DIR', 'liquidacion.leer'),
  ('DIR', 'liquidacion.generar'),
  ('DIR', 'liquidacion.aprobar'),
  ('DIR', 'liquidacion.anular'),
  ('ANALISTA_HONORARIOS', 'convenio_honorario.leer'),
  ('ANALISTA_HONORARIOS', 'convenio_honorario.crear'),
  ('ANALISTA_HONORARIOS', 'convenio_honorario.editar'),
  ('ANALISTA_HONORARIOS', 'convenio_honorario.activar'),
  ('ANALISTA_HONORARIOS', 'produccion_medica.leer'),
  ('ANALISTA_HONORARIOS', 'produccion_medica.excluir'),
  ('ANALISTA_HONORARIOS', 'produccion_medica.reprocesar'),
  ('ANALISTA_HONORARIOS', 'liquidacion.leer'),
  ('ANALISTA_HONORARIOS', 'liquidacion.generar'),
  ('GERENTE_FINANCIERO', 'liquidacion.leer'),
  ('GERENTE_FINANCIERO', 'liquidacion.aprobar'),
  ('GERENTE_FINANCIERO', 'liquidacion.anular'),
  ('MEDICO_AFILIADO', 'liquidacion.leer')
) AS g(role_code, perm_code)
JOIN public."Role" r ON r.code = g.role_code
JOIN public."Permission" p ON p.code = g.perm_code
ON CONFLICT ("roleId", "permissionId") DO UPDATE SET effect = 'ALLOW';

COMMIT;
