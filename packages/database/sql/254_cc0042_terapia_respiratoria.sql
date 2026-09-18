-- =============================================================================
-- 254_cc0042_terapia_respiratoria.sql — CC-0042 / REQ-HIS-TR-001 (S1)
-- Módulo de Terapia Respiratoria v1 sobre el legacy §21 (RespiratoryOrder):
-- adecuar, NO duplicar (regla permanente).
--
-- Entrega S1 del plan del REQ: catálogo de procedimientos TR-*, orden CPOE-TR
-- (3 secciones del mockup MOCK-HIS-TR-001), tareas de supervisión por ítem
-- (CareTask sourceType TR_ORDEN_ITEM), ejecución de sesión con cargo devengado
-- AL EJECUTAR (RN-TR-24: nunca al ordenar), SLA parametrizable y catálogo de
-- medicamentos inhalados con dosis paramétrica (RN-TR-36).
--
--   1. TrProcedimiento       — catálogo §6.1 del REQ (45 códigos TR-*, AER-02
--                              retirado ⇒ activo=false), tarifa base editable
--                              (fallback del price-resolver; las listas por
--                              tipo de cuenta lo overridean por código).
--   2. TrMedicamentoInhalado — §6.3 + constantes MEDS del mockup (dosis
--                              min/max/default por unidad base, bloqueo de
--                              unidad, alto riesgo IPSG.3).
--   3. TrSlaConfig           — SLA por prioridad (espejo LabSlaConfig sql/251;
--                              RN-TR-21: STAT 15'). Fallback en código.
--   4. ALTER RespiratoryOrder — columnas CPOE (cuenta, dx CIE-11, prioridad,
--                              meta de saturación, declaraciones por sección,
--                              firma). encounterId pasa a NULLABLE (cuentas
--                              ambulatorias — patrón SQL 189/192).
--   5. RespiratoryOrderItem  — línea de orden + estado de sesión
--                              (PROGRAMADA→EJECUTADA|NO_EJECUTADA) + snapshot
--                              de medicamento + cargoId del devengo.
--   6. CareTask CHECK sourceType += 'TR_ORDEN_ITEM' (patrón sql/252).
--
-- RLS patrón catálogo global-o-tenant (sql/218) y herencia por join (sql/10).
-- Idempotente. Seeds globales (organizationId NULL).
-- =============================================================================

-- 1. Catálogo de procedimientos ----------------------------------------------
CREATE TABLE IF NOT EXISTS public."TrProcedimiento" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid REFERENCES public."Organization"(id) ON DELETE CASCADE,
  codigo           varchar(20)  NOT NULL,
  nombre           varchar(200) NOT NULL,
  categoria        varchar(40)  NOT NULL,
  -- Sección del CPOE del mockup: 1=Oxigenoterapia · 2=Aerosolterapia ·
  -- 3=Fisioterapia/Vía aérea/Pruebas · 0=no se ofrece en la orden (EMG/VNI/VMI,
  -- flujos de worklist/UCI de fases posteriores).
  "seccionOrden"   smallint     NOT NULL DEFAULT 0,
  "subSeccion"     varchar(60),
  "unidadCobro"    varchar(20)  NOT NULL DEFAULT 'Evento',
  "requiereConsentimiento" boolean NOT NULL DEFAULT false,
  "delegablePorProtocolo"  boolean NOT NULL DEFAULT false,
  -- RN-TR-33 — pareo indivisible (TR-OXI-01→TR-OXI-02, TR-OXI-03→TR-OXI-04).
  "pareoCon"       varchar(20),
  "tiempoEstandarMin" integer,
  -- Tarifa base (fallback del price-resolver cuando ninguna lista de precios
  -- del tipo de cuenta trae el código; se parametriza en el panel del módulo).
  "tarifaBase"     numeric(12,2),
  -- Config de aerosolterapia (RN-TR-36): meds permitidos, unidades, diluyentes
  -- (lista cerrada) y parámetro técnico. Solo TR-AER-01/03/04; NULL = sin
  -- bloque de medicamento (TR-AER-05 y el resto).
  "aerosolConfig"  jsonb,
  "displayOrder"   integer NOT NULL DEFAULT 0,
  activo           boolean NOT NULL DEFAULT true,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrProcedimiento_org_codigo_key"
  ON public."TrProcedimiento" ("organizationId", codigo) WHERE "organizationId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "TrProcedimiento_global_codigo_key"
  ON public."TrProcedimiento" (codigo) WHERE "organizationId" IS NULL;

-- 2. Catálogo de medicamentos inhalados ---------------------------------------
CREATE TABLE IF NOT EXISTS public."TrMedicamentoInhalado" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid REFERENCES public."Organization"(id) ON DELETE CASCADE,
  clave            varchar(40)  NOT NULL,
  nombre           varchar(200) NOT NULL,
  -- Unidad base de dosificación: mg | mL | disparos. La captura en gramos se
  -- RECHAZA siempre (bloqueo duro del REQ §6.3 — incidente «Tropium 0.5 g»).
  "unidadBase"     varchar(12)  NOT NULL,
  "dosisMin"       numeric(10,3) NOT NULL,
  "dosisMax"       numeric(10,3) NOT NULL,
  "dosisDefault"   numeric(10,3) NOT NULL,
  -- IPSG.3 — alto riesgo (adrenalina): doble verificación y monitoreo.
  "altoRiesgo"     boolean NOT NULL DEFAULT false,
  -- Mensaje warn (precaución) en vez de info (mockup tono a-warn).
  precaucion       boolean NOT NULL DEFAULT false,
  mensaje          text NOT NULL,
  "displayOrder"   integer NOT NULL DEFAULT 0,
  activo           boolean NOT NULL DEFAULT true,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrMedicamentoInhalado_org_clave_key"
  ON public."TrMedicamentoInhalado" ("organizationId", clave) WHERE "organizationId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "TrMedicamentoInhalado_global_clave_key"
  ON public."TrMedicamentoInhalado" (clave) WHERE "organizationId" IS NULL;

-- 3. SLA parametrizable (espejo LabSlaConfig/ImagingSlaConfig) -----------------
CREATE TABLE IF NOT EXISTS public."TrSlaConfig" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  priority         varchar(10) NOT NULL CHECK (priority IN ('ROUTINE', 'URGENT', 'STAT')),
  "slaMinutes"     integer NOT NULL CHECK ("slaMinutes" > 0 AND "slaMinutes" <= 10080),
  "warningMinutes" integer NOT NULL DEFAULT 15 CHECK ("warningMinutes" >= 0),
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrSlaConfig_organizationId_priority_key"
  ON public."TrSlaConfig" ("organizationId", priority);

-- 4. RespiratoryOrder — columnas CPOE-TR (adecuar legacy) ----------------------
ALTER TABLE public."RespiratoryOrder"
  ADD COLUMN IF NOT EXISTS "patientAccountId" uuid REFERENCES public."PatientAccount"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "dxCodigo"        varchar(20),
  ADD COLUMN IF NOT EXISTS "dxDescripcion"   varchar(300),
  ADD COLUMN IF NOT EXISTS prioridad         varchar(10) CHECK (prioridad IS NULL OR prioridad IN ('ROUTINE','URGENT','STAT')),
  ADD COLUMN IF NOT EXISTS "metaSaturacion"  varchar(20),
  ADD COLUMN IF NOT EXISTS "metaMin"         smallint,
  ADD COLUMN IF NOT EXISTS "metaMax"         smallint,
  ADD COLUMN IF NOT EXISTS "metaJustificacion" text,
  -- RN-TR-32/35 — declaración por sección: {"oxigenoterapia":"NO_REQUIERE"|
  -- "SELECCIONADA","aerosolterapia":...,"seccion3":...}.
  ADD COLUMN IF NOT EXISTS declaraciones     jsonb,
  ADD COLUMN IF NOT EXISTS "esCpoeTr"        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "vigenciaHoras"   integer,
  ADD COLUMN IF NOT EXISTS "firmadoEn"       timestamptz;

ALTER TABLE public."RespiratoryOrder" ALTER COLUMN "encounterId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS ix_respiratory_order_account
  ON public."RespiratoryOrder" ("patientAccountId") WHERE "patientAccountId" IS NOT NULL;

-- 5. Línea de orden / sesión ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public."RespiratoryOrderItem" (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId"             uuid NOT NULL REFERENCES public."RespiratoryOrder"(id) ON DELETE CASCADE,
  "procedimientoCodigo" varchar(20)  NOT NULL,
  -- Snapshot: protege el historial ante renombres del catálogo (patrón CC-0041).
  "procedimientoNombre" varchar(200) NOT NULL,
  "seccionOrden"        smallint NOT NULL DEFAULT 0,
  -- Snapshot del bloque de medicamento (RN-TR-36): {clave,nombre,dosis,unidad,
  -- diluyente,extraLabel,extraValor,frecuencia}. NULL en ítems sin medicamento.
  medicamento           jsonb,
  -- Estado de la sesión (§7.5, recorte S1: PROGRAMADA→EJECUTADA|NO_EJECUTADA;
  -- CANCELADA por anulación de la orden).
  estado                varchar(20) NOT NULL DEFAULT 'PROGRAMADA'
    CHECK (estado IN ('PROGRAMADA','EJECUTADA','NO_EJECUTADA','CANCELADA')),
  "ejecutadaEn"         timestamptz,
  "ejecutadaPor"        uuid,
  -- Anexo B — causa codificada de no ejecución (RN: sin causa no se cierra).
  "causaNoEjecucion"    varchar(200),
  observaciones         text,
  -- RN-TR-24 — cargo devengado AL EJECUTAR (referencia al PatientAccountService).
  "cargoId"             uuid,
  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "updatedAt"           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_tr_orden_item_order ON public."RespiratoryOrderItem" ("orderId");
CREATE INDEX IF NOT EXISTS ix_tr_orden_item_estado ON public."RespiratoryOrderItem" (estado);

-- 6. CareTask.sourceType += TR_ORDEN_ITEM (patrón sql/252) ----------------------
ALTER TABLE public."CareTask" DROP CONSTRAINT IF EXISTS "CareTask_sourceType_check";
ALTER TABLE public."CareTask" ADD CONSTRAINT "CareTask_sourceType_check"
  CHECK ("sourceType" IN (
    'INDICACION_ITEM',
    'LAB_ORDER',
    'LAB_ORDER_ITEM',
    'IMAGING_ORDER',
    'TR_ORDEN_ITEM',
    'TRANSFER',
    'MANUAL'
  ));

-- 7. RLS + grants ----------------------------------------------------------------
ALTER TABLE public."TrProcedimiento"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrMedicamentoInhalado"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrSlaConfig"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RespiratoryOrderItem"   ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."TrProcedimiento"       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."TrMedicamentoInhalado" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."TrSlaConfig"           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."RespiratoryOrderItem"  TO authenticated;

DROP POLICY IF EXISTS tr_procedimiento_global_or_tenant_select ON public."TrProcedimiento";
CREATE POLICY tr_procedimiento_global_or_tenant_select ON public."TrProcedimiento"
  FOR SELECT USING ("organizationId" IS NULL OR "organizationId" = public.current_org_id());
DROP POLICY IF EXISTS tr_procedimiento_tenant_modify ON public."TrProcedimiento";
CREATE POLICY tr_procedimiento_tenant_modify ON public."TrProcedimiento"
  FOR ALL USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

DROP POLICY IF EXISTS tr_medicamento_global_or_tenant_select ON public."TrMedicamentoInhalado";
CREATE POLICY tr_medicamento_global_or_tenant_select ON public."TrMedicamentoInhalado"
  FOR SELECT USING ("organizationId" IS NULL OR "organizationId" = public.current_org_id());
DROP POLICY IF EXISTS tr_medicamento_tenant_modify ON public."TrMedicamentoInhalado";
CREATE POLICY tr_medicamento_tenant_modify ON public."TrMedicamentoInhalado"
  FOR ALL USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

DROP POLICY IF EXISTS tr_sla_config_tenant ON public."TrSlaConfig";
CREATE POLICY tr_sla_config_tenant ON public."TrSlaConfig"
  FOR ALL USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- Ítems: heredan el tenant de la orden (patrón LabOrderItemParameter sql/218).
DROP POLICY IF EXISTS tr_orden_item_tenant ON public."RespiratoryOrderItem";
CREATE POLICY tr_orden_item_tenant ON public."RespiratoryOrderItem"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."RespiratoryOrder" o
    WHERE o.id = "RespiratoryOrderItem"."orderId"
      AND (o."organizationId" = public.current_org_id() OR public.is_break_glass())))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."RespiratoryOrder" o
    WHERE o.id = "RespiratoryOrderItem"."orderId"
      AND o."organizationId" = public.current_org_id()));

-- updatedAt triggers (helper set_updated_at si existe — patrón sql/218).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_tr_procedimiento_updated_at') THEN
      CREATE TRIGGER trg_tr_procedimiento_updated_at BEFORE UPDATE ON public."TrProcedimiento"
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_tr_medicamento_updated_at') THEN
      CREATE TRIGGER trg_tr_medicamento_updated_at BEFORE UPDATE ON public."TrMedicamentoInhalado"
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_tr_sla_config_updated_at') THEN
      CREATE TRIGGER trg_tr_sla_config_updated_at BEFORE UPDATE ON public."TrSlaConfig"
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_tr_orden_item_updated_at') THEN
      CREATE TRIGGER trg_tr_orden_item_updated_at BEFORE UPDATE ON public."RespiratoryOrderItem"
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
  END IF;
END $$;

-- 8. Seed global — procedimientos §6.1 (45 códigos, AER-02 retirado) -----------
INSERT INTO public."TrProcedimiento"
  (codigo, nombre, categoria, "seccionOrden", "subSeccion", "unidadCobro",
   "requiereConsentimiento", "delegablePorProtocolo", "pareoCon", "displayOrder", activo)
SELECT v.*
FROM (VALUES
  ('TR-EMG-01','Atención de paro cardiorrespiratorio','Emergencia',0,NULL,'Evento',false,true,NULL,1,true),
  ('TR-EMG-02','Ventilación manual a presión positiva (bolsa-válvula-mascarilla)','Emergencia',0,NULL,'Evento',false,true,NULL,2,true),
  ('TR-EMG-03','Asistencia a intubación orotraqueal','Vía aérea',0,NULL,'Evento',true,true,NULL,3,true),
  ('TR-EMG-04','Asistencia a procedimientos respiratorios','Apoyo',0,NULL,'Evento',false,true,NULL,4,true),
  ('TR-OXI-01','Inicio de oxigenoterapia de bajo flujo','Oxigenoterapia',1,NULL,'Evento',false,true,'TR-OXI-02',10,true),
  ('TR-OXI-02','Supervisión y cuidado de oxigenoterapia de bajo flujo','Oxigenoterapia',1,NULL,'Turno',false,false,NULL,11,true),
  ('TR-OXI-03','Inicio de oxigenoterapia de alto flujo','Oxigenoterapia',1,NULL,'Evento',false,false,'TR-OXI-04',12,true),
  ('TR-OXI-04','Supervisión y cuidado de oxigenoterapia de alto flujo','Oxigenoterapia',1,NULL,'Turno',false,false,NULL,13,true),
  ('TR-OXI-05','Traslado de paciente con oxígeno','Oxigenoterapia',1,NULL,'Evento',false,false,NULL,14,true),
  ('TR-OXI-06','Titulación protocolizada de oxígeno a meta de SpO₂','Oxigenoterapia',1,NULL,'Evento',false,true,NULL,15,true),
  ('TR-OXI-07','Destete y retiro de oxigenoterapia','Oxigenoterapia',1,NULL,'Evento',false,true,NULL,16,true),
  ('TR-VNI-01','Inicio de ventilación no invasiva (CPAP/BiPAP)','Soporte no invasivo',0,NULL,'Evento',true,false,NULL,20,true),
  ('TR-VNI-02','Supervisión y cuidados de ventilación no invasiva','Soporte no invasivo',0,NULL,'Turno',false,false,NULL,21,true),
  ('TR-VNI-03','Inicio de cánula nasal de alto flujo (CAF)','Soporte no invasivo',0,NULL,'Evento',false,false,NULL,22,true),
  ('TR-VNI-04','Supervisión de CAF con cálculo de índice ROX','Soporte no invasivo',0,NULL,'Turno',false,false,NULL,23,true),
  ('TR-VMI-01','Inicio de ventilación mecánica invasiva','Ventilación invasiva',0,NULL,'Evento',true,false,NULL,30,true),
  ('TR-VMI-02','Supervisión y cuidados de VMI','Ventilación invasiva',0,NULL,'Turno',false,false,NULL,31,true),
  ('TR-VMI-03','Verificación de sistema paciente-ventilador (system check)','Ventilación invasiva',0,NULL,'Evento',false,false,NULL,32,true),
  ('TR-VMI-04','Atención y uso de ventilador de transporte (VMIT)','Ventilación invasiva',0,NULL,'Hora',false,false,NULL,33,true),
  ('TR-VMI-05','Prueba de ventilación espontánea (SBT)','Destete',0,NULL,'Evento',false,true,NULL,34,true),
  ('TR-VMI-06','Extubación programada','Destete',0,NULL,'Evento',true,false,NULL,35,true),
  ('TR-VIA-01','Aspiración faringotraqueal','Vía aérea',3,'3.2 · Vía aérea artificial','Evento',false,false,NULL,50,true),
  ('TR-VIA-02','Aspiración por sistema cerrado en paciente ventilado','Vía aérea',3,'3.2 · Vía aérea artificial','Evento',false,false,NULL,51,true),
  ('TR-VIA-03','Lavado bronquial','Vía aérea',3,'3.2 · Vía aérea artificial','Evento',true,false,NULL,52,true),
  ('TR-VIA-04','Cuidado de traqueostomía','Vía aérea',3,'3.2 · Vía aérea artificial','Evento',false,false,NULL,53,true),
  ('TR-VIA-05','Cambio de cánula de traqueostomía','Vía aérea',3,'3.2 · Vía aérea artificial','Evento',true,false,NULL,54,true),
  ('TR-VIA-06','Medición y ajuste de presión del cuff','Vía aérea',3,'3.2 · Vía aérea artificial','Evento',false,false,NULL,55,true),
  ('TR-VIA-07','Toma de muestra de aspirado traqueal o esputo inducido','Diagnóstico',3,'3.2 · Vía aérea artificial','Evento',false,false,NULL,56,true),
  ('TR-AER-01','Nebulización convencional (jet)','Aerosolterapia',2,NULL,'Evento',false,true,NULL,40,true),
  ('TR-AER-02','Nebulización ultrasónica','Aerosolterapia',0,NULL,'Evento',false,false,NULL,41,false),
  ('TR-AER-03','Nebulización de malla vibratoria en circuito de VM','Aerosolterapia',2,NULL,'Evento',false,false,NULL,42,true),
  ('TR-AER-04','Administración con inhalador de dosis medida y expansor de volumen','Aerosolterapia',2,NULL,'Evento',false,false,NULL,43,true),
  ('TR-AER-05','Educación y verificación de técnica inhalatoria al egreso','Educación',2,NULL,'Evento',false,false,NULL,44,true),
  ('TR-FIS-01','Vibropercusión y palmopercusión','Fisioterapia',3,'3.1 · Fisioterapia respiratoria','Evento',false,false,NULL,60,true),
  ('TR-FIS-02','Drenaje postural','Fisioterapia',3,'3.1 · Fisioterapia respiratoria','Evento',false,false,NULL,61,true),
  ('TR-FIS-03','Ejercicios de rehabilitación con espirómetro incentivo','Fisioterapia',3,'3.1 · Fisioterapia respiratoria','Evento',false,false,NULL,62,true),
  ('TR-FIS-04','Terapia de presión espiratoria positiva (PEP / oscilación)','Fisioterapia',3,'3.1 · Fisioterapia respiratoria','Evento',false,false,NULL,63,true),
  ('TR-FIS-05','Asistencia mecánica de la tos (insuflación-exsuflación)','Fisioterapia',3,'3.1 · Fisioterapia respiratoria','Evento',false,false,NULL,64,true),
  ('TR-FIS-06','Entrenamiento de músculos inspiratorios','Fisioterapia',3,'3.1 · Fisioterapia respiratoria','Sesión',false,false,NULL,65,true),
  ('TR-PFR-01','Espirometría simple','Prueba funcional',3,'3.3 · Pruebas funcionales respiratorias','Estudio',false,false,NULL,70,true),
  ('TR-PFR-02','Espirometría pre y post broncodilatador','Prueba funcional',3,'3.3 · Pruebas funcionales respiratorias','Estudio',false,false,NULL,71,true),
  ('TR-PFR-03','Gasometría arterial (toma y procesamiento)','Prueba funcional',3,'3.3 · Pruebas funcionales respiratorias','Estudio',true,false,NULL,72,true),
  ('TR-PFR-04','Capnografía / capnometría','Prueba funcional',3,'3.3 · Pruebas funcionales respiratorias','Estudio',false,false,NULL,73,true),
  ('TR-PFR-05','Oximetría de pulso nocturna','Prueba funcional',3,'3.3 · Pruebas funcionales respiratorias','Estudio',false,false,NULL,74,true),
  ('TR-PFR-06','Prueba de caminata de 6 minutos','Prueba funcional',3,'3.3 · Pruebas funcionales respiratorias','Estudio',true,false,NULL,75,true),
  ('TR-PFR-07','Presiones inspiratoria y espiratoria máximas (PIM/PEM)','Prueba funcional',3,'3.3 · Pruebas funcionales respiratorias','Estudio',false,false,NULL,76,true)
) AS v(codigo, nombre, categoria, seccion_orden, sub_seccion, unidad_cobro,
       req_consent, delegable, pareo_con, display_order, activo)
WHERE NOT EXISTS (
  SELECT 1 FROM public."TrProcedimiento" t
  WHERE t.codigo = v.codigo AND t."organizationId" IS NULL
);

-- aerosolConfig de los 3 procedimientos con bloque de medicamento (mockup AER).
UPDATE public."TrProcedimiento" SET "aerosolConfig" = '{
  "hint": "Parámetros estándar de nebulización con generador tipo jet",
  "meds": ["salbutamol","ipratropio","budesonida","adrenalina","hipertonica","nac"],
  "unidades": ["mg","µg","g","mL"],
  "diluyentes": ["Solución salina normal 0.9 % · 3 mL","Solución salina normal 0.9 % · 4 mL","Solución salina normal 0.9 % · 5 mL","Agua estéril · 4 mL","Sin diluyente"],
  "diluyenteDefault": 1,
  "extra": {"label": "Flujo impulsor de oxígeno", "opciones": ["6 L/min","7 L/min","8 L/min"], "default": 0}
}'::jsonb WHERE codigo = 'TR-AER-01' AND "organizationId" IS NULL AND "aerosolConfig" IS NULL;

UPDATE public."TrProcedimiento" SET "aerosolConfig" = '{
  "hint": "Parámetros estándar de nebulización en paciente ventilado",
  "meds": ["salbutamol","ipratropio","budesonida","nac"],
  "unidades": ["mg","µg","g"],
  "diluyentes": ["Sin diluyente (malla vibratoria)","Solución salina normal 0.9 % · 2 mL"],
  "diluyenteDefault": 0,
  "extra": {"label": "Posición en el circuito", "opciones": ["Rama inspiratoria, 15 cm antes de la pieza en Y","Entre la pieza en Y y el tubo endotraqueal","Antes del humidificador activo"], "default": 0}
}'::jsonb WHERE codigo = 'TR-AER-03' AND "organizationId" IS NULL AND "aerosolConfig" IS NULL;

UPDATE public."TrProcedimiento" SET "aerosolConfig" = '{
  "hint": "Dosificación en disparos; no requiere diluyente",
  "meds": ["salbutamolIDM","ipratropioIDM","budesonidaIDM","fluticasonaIDM"],
  "unidades": ["disparos"],
  "diluyentes": ["No aplica"],
  "diluyenteDefault": 0,
  "extra": {"label": "Interfaz del expansor", "opciones": ["Con boquilla","Con mascarilla facial","Acoplado al circuito de ventilación"], "default": 0}
}'::jsonb WHERE codigo = 'TR-AER-04' AND "organizationId" IS NULL AND "aerosolConfig" IS NULL;

-- 9. Seed global — medicamentos inhalados (constantes MEDS del mockup) ---------
INSERT INTO public."TrMedicamentoInhalado"
  (clave, nombre, "unidadBase", "dosisMin", "dosisMax", "dosisDefault",
   "altoRiesgo", precaucion, mensaje, "displayOrder")
SELECT v.*
FROM (VALUES
  ('salbutamol','Salbutamol — solución para nebulizar 5 mg/mL','mg',2.5,5,2.5,false,false,
   'Salbutamol 2.5 a 5 mg por nebulización en el adulto; en pediatría 0.15 mg/kg con un mínimo de 2.5 mg. Vigilar taquicardia, temblor e hipopotasemia.',1),
  ('ipratropio','Bromuro de ipratropio («Tropium») — solución 0.25 mg/mL','mg',0.25,0.5,0.5,false,false,
   'Bromuro de ipratropio 0.5 mg (500 µg) por nebulización en el adulto; 0.25 mg en menores de 12 años. La unidad válida es miligramo o microgramo, nunca gramo.',2),
  ('budesonida','Budesonida — suspensión 0.5 mg/mL','mg',0.25,1,0.5,false,false,
   'Budesonida 0.5 a 1 mg cada 12 horas en el adulto; 0.25 a 0.5 mg en pediatría. Enjuague bucal obligatorio al terminar la nebulización.',3),
  ('adrenalina','Adrenalina — solución 1 mg/mL','mg',0.5,5,5,true,true,
   'Adrenalina 5 mg nebulizados en el adulto; en pediatría 0.5 mg/kg hasta un máximo de 5 mg. Medicamento de alto riesgo: exige doble verificación por un segundo profesional y monitoreo continuo.',4),
  ('hipertonica','Solución salina hipertónica 3 %','mL',3,5,4,false,true,
   'Solución salina hipertónica 3 % · 4 mL por nebulización. Premedicar con broncodilatador y vigilar broncoespasmo durante los primeros minutos.',5),
  ('nac','N-acetilcisteína — solución 100 mg/mL','mg',100,600,300,false,true,
   'N-acetilcisteína 300 mg (3 mL al 10 %) por nebulización. Puede provocar broncoespasmo: administrar después de un broncodilatador.',6),
  ('salbutamolIDM','Salbutamol — inhalador de dosis medida 100 µg por disparo','disparos',2,4,2,false,false,
   'Salbutamol 2 a 4 disparos de 100 µg con expansor de volumen, un disparo a la vez y cinco respiraciones entre disparos. En crisis puede repetirse cada 20 minutos durante la primera hora.',7),
  ('ipratropioIDM','Bromuro de ipratropio — inhalador de dosis medida 20 µg por disparo','disparos',2,4,2,false,false,
   'Bromuro de ipratropio 2 a 4 disparos de 20 µg con expansor de volumen. Evitar el contacto del aerosol con los ojos, sobre todo en glaucoma.',8),
  ('budesonidaIDM','Budesonida — inhalador de dosis medida 200 µg por disparo','disparos',1,2,2,false,false,
   'Budesonida 1 a 2 disparos de 200 µg cada 12 horas con expansor de volumen. Enjuague bucal obligatorio después de cada administración.',9),
  ('fluticasonaIDM','Fluticasona — inhalador de dosis medida 125 µg por disparo','disparos',1,2,2,false,false,
   'Fluticasona 1 a 2 disparos de 125 µg cada 12 horas con expansor de volumen. Enjuague bucal obligatorio después de cada administración.',10)
) AS v(clave, nombre, unidad_base, dosis_min, dosis_max, dosis_default,
       alto_riesgo, precaucion, mensaje, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public."TrMedicamentoInhalado" m
  WHERE m.clave = v.clave AND m."organizationId" IS NULL
);
