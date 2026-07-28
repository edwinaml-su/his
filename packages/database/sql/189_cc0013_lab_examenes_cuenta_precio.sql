-- =============================================================================
-- HIS Multi-país | CC-0013 — Módulo de laboratorio: asignación de exámenes
-- por cuenta + tablero + catálogo CRUD con precio estándar
--
-- Fuente de verdad: docs/CC/0013/mockup_examenes_laboratorio.html
--   (pantalla de escogitación por secciones/búsqueda + tablero de cuentas
--   activas + modal de solicitud por cuenta). Catálogo PORTAFOLIO_EX: 157
--   prestaciones en 10 secciones (const SECTIONS/ITEMS, líneas 216-394),
--   contenido LITERAL incluyendo tildes y erratas del mockup
--   (ej. 'FOSFATASA ALCATINA', 'PANEL RESPIRATOIRO', "TEST 'OSULLIVAN").
--
-- Cambios:
--   1. ALTER TABLE "LabOrder" — patientAccountId (ancla transversal a la
--      cuenta, análogo a CC-0012 en ece.signos_vitales) + índice.
--      encounterId pasa a NULLABLE: una cuenta ambulatoria (CC-0002 §7)
--      puede no tener encounter asociado (PatientAccount.encounterId ya es
--      opcional) — una orden de lab anclada solo a cuentaId debe poder
--      persistir sin encounter. schema.prisma: LabOrder.encounterId String?
--      + relación Encounter? (antes NOT NULL / Encounter no-opcional).
--   2. ALTER TABLE "LabTest" — standardPrice numeric(12,2) (precio estándar
--      parametrizable por admin vía CRUD /catalogs/laboratorio). El
--      tarifario ServicePriceListItem (SQL 133, code=override) sigue siendo
--      la fuente de verdad de facturación cuando existe fila por code; este
--      campo es el default cuando no hay override.
--   3. Desactiva (active=false) el catálogo LABORATORIO global CC-0011
--      (AVT-LAB-%, SQL 185) — CC-0013 lo reemplaza con PORTAFOLIO_EX
--      sembrado por tenant (paso 4). Reversible (active=true). NO toca
--      AVT-RAD-*/AVT-CAR-* (radiología/cardiología siguen con su catálogo
--      global CC-0011 — fuera de alcance de este CC).
--   4. Seed PORTAFOLIO_EX — 10 LabPanel + 157 LabTest POR CADA organización
--      real (excluye fixtures 'RLS-Test%' de packages/trpc/src/__tests__/
--      rls-isolation.test.ts). organizationId = tenant (NO global) porque
--      el mockup es el catálogo operativo de Avante, parametrizable después
--      por cada organización vía el CRUD admin (precio, alta/baja, etc.).
--
-- Unicidad de "code": LabPanel/LabTest NO tienen UNIQUE constraint sobre
-- code a nivel BD (solo @@index([code]) — verificado en 10_lis_rls.sql /
-- 27_lis_hardening_v2.sql, ningún UNIQUE). La idempotencia del seed se
-- garantiza en la propia sentencia (WHERE NOT EXISTS por organizationId+code),
-- así que los códigos "PORT-{SEC}-{NN}" se reutilizan intencionalmente entre
-- organizaciones (mismo catálogo, una fila por org).
--
-- "updatedAt" es NOT NULL sin default en BD (Prisma @updatedAt) — se setea
-- explícito en todos los INSERT (gotcha conocido, ver CLAUDE.md).
--
-- Idempotente. Aplicar vía Supabase SQL Editor / MCP (no prisma migrate).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. LabOrder — patientAccountId + encounterId nullable
-- -----------------------------------------------------------------------------

ALTER TABLE public."LabOrder" ADD COLUMN IF NOT EXISTS "patientAccountId" uuid
  REFERENCES public."PatientAccount"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_lab_order_patient_account ON public."LabOrder" ("patientAccountId");

ALTER TABLE public."LabOrder" ALTER COLUMN "encounterId" DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. LabTest — precio estándar
-- -----------------------------------------------------------------------------

ALTER TABLE public."LabTest" ADD COLUMN IF NOT EXISTS "standardPrice" numeric(12,2);

COMMENT ON COLUMN public."LabTest"."standardPrice" IS
  'CC-0013 — precio estándar del catálogo, parametrizable por admin. El '
  'tarifario ServicePriceListItem (SQL 133, match por code) es el override '
  'de facturación cuando existe fila; este campo es el default.';

-- -----------------------------------------------------------------------------
-- 3. Desactivar catálogo LABORATORIO global CC-0011 (reemplazado por PORTAFOLIO_EX)
-- -----------------------------------------------------------------------------

UPDATE public."LabTest" lt
SET active = false
FROM public."LabPanel" lp
WHERE lt."panelId" = lp.id
  AND lp.code LIKE 'AVT-LAB-%'
  AND lp."organizationId" IS NULL;

UPDATE public."LabPanel"
SET active = false
WHERE code LIKE 'AVT-LAB-%' AND "organizationId" IS NULL;

-- -----------------------------------------------------------------------------
-- 4a. Seed — 10 LabPanel PORTAFOLIO_EX por organización real
-- -----------------------------------------------------------------------------

INSERT INTO public."LabPanel" (id, "organizationId", code, name, area, "displayOrder", active, "updatedAt")
SELECT gen_random_uuid(), o.id, v.code, v.name, 'LABORATORIO', v.display_order, true, now()
FROM public."Organization" o
CROSS JOIN (VALUES
  ('PORT-QUI', 'QUIMICA', 1),
  ('PORT-URI', 'URIANALISIS', 2),
  ('PORT-HEM', 'HEMATOLOGIA', 3),
  ('PORT-ESP', 'PRUEBAS ESPECIALES', 4),
  ('PORT-COA', 'COAGULACION', 5),
  ('PORT-COP', 'COPROLOGIA', 6),
  ('PORT-INS', 'INMUNOLOGIA/SEROLOGIA', 7),
  ('PORT-BAC', 'BACTERIOLOGIA', 8),
  ('PORT-IHE', 'INMUNO-HEMATOLOGIA', 9),
  ('PORT-MOL', 'BIOLOGIA MOLECULAR', 10)
) AS v(code, name, display_order)
WHERE o."legalName" NOT LIKE 'RLS-Test%'
  AND NOT EXISTS (
    SELECT 1 FROM public."LabPanel" lp
    WHERE lp."organizationId" = o.id AND lp.code = v.code
  );

-- -----------------------------------------------------------------------------
-- 4b. Seed — 157 LabTest PORTAFOLIO_EX por organización real
--     specimen = 'OTHER' (catálogo de solicitud de HC, no alimenta la toma
--     de muestra física del flujo LIS existente — mismo criterio que SQL 185).
-- -----------------------------------------------------------------------------

INSERT INTO public."LabTest" (id, "organizationId", "panelId", code, name, specimen, "displayOrder", active, "updatedAt")
SELECT gen_random_uuid(), o.id, lp.id, v.code, v.name, 'OTHER'::"SpecimenType", v.display_order, true, now()
FROM public."Organization" o
CROSS JOIN (VALUES
  -- QUIMICA (34)
  ('PORT-QUI-01','PORT-QUI','GLUCOSA',1),
  ('PORT-QUI-02','PORT-QUI','COLESTEROL',2),
  ('PORT-QUI-03','PORT-QUI','TRIGLICERIDO',3),
  ('PORT-QUI-04','PORT-QUI','ACIDO URICO',4),
  ('PORT-QUI-05','PORT-QUI','COLESTEROL HDL',5),
  ('PORT-QUI-06','PORT-QUI','COLESTEROL LDL',6),
  ('PORT-QUI-07','PORT-QUI','CREATININA',7),
  ('PORT-QUI-08','PORT-QUI','NITROGENO UREICO',8),
  ('PORT-QUI-09','PORT-QUI','CLORO',9),
  ('PORT-QUI-10','PORT-QUI','SODIO',10),
  ('PORT-QUI-11','PORT-QUI','POTASIO',11),
  ('PORT-QUI-12','PORT-QUI','FOSFORO',12),
  ('PORT-QUI-13','PORT-QUI','MAGNESIO',13),
  ('PORT-QUI-14','PORT-QUI','CALCIO',14),
  ('PORT-QUI-15','PORT-QUI','TGO',15),
  ('PORT-QUI-16','PORT-QUI','TGP',16),
  ('PORT-QUI-17','PORT-QUI','FOSFATASA ALCATINA',17),
  ('PORT-QUI-18','PORT-QUI','GAMMA-GT',18),
  ('PORT-QUI-19','PORT-QUI','LIPASA',19),
  ('PORT-QUI-20','PORT-QUI','AMILASA',20),
  ('PORT-QUI-21','PORT-QUI','BILIRRUBINA TOTAL',21),
  ('PORT-QUI-22','PORT-QUI','BILIRRUBINA DIRECTA',22),
  ('PORT-QUI-23','PORT-QUI','BILIRRUBINA INDIRECTA',23),
  ('PORT-QUI-24','PORT-QUI','PROTEINAS TOTALES',24),
  ('PORT-QUI-25','PORT-QUI','ALBUMINA',25),
  ('PORT-QUI-26','PORT-QUI','GLOBULINA',26),
  ('PORT-QUI-27','PORT-QUI','RELACION ALBUMINA/GLOBULINA',27),
  ('PORT-QUI-28','PORT-QUI','HIERRO',28),
  ('PORT-QUI-29','PORT-QUI','AMONIO',29),
  ('PORT-QUI-30','PORT-QUI','PROTEINA C REACTIVA',30),
  ('PORT-QUI-31','PORT-QUI','CK-TOTAL',31),
  ('PORT-QUI-32','PORT-QUI','LACTATO DESHIDROGENASA',32),
  ('PORT-QUI-33','PORT-QUI','TEST ''OSULLIVAN',33),
  ('PORT-QUI-34','PORT-QUI','CURVA TOLERANCIA GLUCOSA',34),
  -- URIANALISIS (18)
  ('PORT-URI-01','PORT-URI','GENERAL DE ORINA',1),
  ('PORT-URI-02','PORT-URI','PANEL RAPIDO DE DROGAS',2),
  ('PORT-URI-03','PORT-URI','DIMORFISMO ERITROCITARIO',3),
  ('PORT-URI-04','PORT-URI','PRUEBA DE EMBARAZO',4),
  ('PORT-URI-05','PORT-URI','GLUCOSA',5),
  ('PORT-URI-06','PORT-URI','ACIDO URICO',6),
  ('PORT-URI-07','PORT-URI','NITROGENO UREICO',7),
  ('PORT-URI-08','PORT-URI','FOSFORO',8),
  ('PORT-URI-09','PORT-URI','MAGNESIO',9),
  ('PORT-URI-10','PORT-URI','CALCIO',10),
  ('PORT-URI-11','PORT-URI','CREATININA',11),
  ('PORT-URI-12','PORT-URI','PROTEINAS TOTALES',12),
  ('PORT-URI-13','PORT-URI','AMILASA',13),
  ('PORT-URI-14','PORT-URI','CLORO',14),
  ('PORT-URI-15','PORT-URI','SODIO',15),
  ('PORT-URI-16','PORT-URI','POTASIO',16),
  ('PORT-URI-17','PORT-URI','DEPURACION DE CREATININA',17),
  ('PORT-URI-18','PORT-URI','DEPURACION DE PROTEINAS',18),
  -- HEMATOLOGIA (10)
  ('PORT-HEM-01','PORT-HEM','HEMOGRAMA COMPLETO',1),
  ('PORT-HEM-02','PORT-HEM','FROTIS DE SANGRE PERIFERICA',2),
  ('PORT-HEM-03','PORT-HEM','RETICULOCITOS',3),
  ('PORT-HEM-04','PORT-HEM','ERITROSEDIMENTACIÓN',4),
  ('PORT-HEM-05','PORT-HEM','GOTA GRUESA',5),
  ('PORT-HEM-06','PORT-HEM','CONCENTRADO DE STROUT',6),
  ('PORT-HEM-07','PORT-HEM','CONTEO DE EOSINOFILOS',7),
  ('PORT-HEM-08','PORT-HEM','INDUCCIÓN DE DREPANOCITOS',8),
  ('PORT-HEM-09','PORT-HEM','COLORACION DE WRIGHT',9),
  ('PORT-HEM-10','PORT-HEM','ANTICUERPOS ANTINUCLEARES',10),
  -- PRUEBAS ESPECIALES (29)
  ('PORT-ESP-01','PORT-ESP','PROCALCITONINA',1),
  ('PORT-ESP-02','PORT-ESP','INSULINA',2),
  ('PORT-ESP-03','PORT-ESP','CK-MB',3),
  ('PORT-ESP-04','PORT-ESP','VITAMINA B12',4),
  ('PORT-ESP-05','PORT-ESP','VITAMINA D',5),
  ('PORT-ESP-06','PORT-ESP','TSH',6),
  ('PORT-ESP-07','PORT-ESP','T3 TOTAL',7),
  ('PORT-ESP-08','PORT-ESP','T4 TOTAL',8),
  ('PORT-ESP-09','PORT-ESP','T3 LIBRE',9),
  ('PORT-ESP-10','PORT-ESP','T4 LIBRE',10),
  ('PORT-ESP-11','PORT-ESP','HIV CUARTA GENERACIÓN',11),
  ('PORT-ESP-12','PORT-ESP','SIFILIS CUARTA GENERACIÓN',12),
  ('PORT-ESP-13','PORT-ESP','CHAGAS',13),
  ('PORT-ESP-14','PORT-ESP','AG AUSTRALIANO HEP B',14),
  ('PORT-ESP-15','PORT-ESP','AC HEPATITIS C',15),
  ('PORT-ESP-16','PORT-ESP','PSA TOTAL',16),
  ('PORT-ESP-17','PORT-ESP','PSA LIBRE',17),
  ('PORT-ESP-18','PORT-ESP','HEMOGLOBINA GLICOSILADA',18),
  ('PORT-ESP-19','PORT-ESP','TROPONINA I',19),
  ('PORT-ESP-20','PORT-ESP','TROPONINA T',20),
  ('PORT-ESP-21','PORT-ESP','PRO-BNP',21),
  ('PORT-ESP-22','PORT-ESP','FERRITINA',22),
  ('PORT-ESP-23','PORT-ESP','CEA',23),
  ('PORT-ESP-24','PORT-ESP','CA 19-9',24),
  ('PORT-ESP-25','PORT-ESP','PCR-CARDIACA',25),
  ('PORT-ESP-26','PORT-ESP','ALFAFETO-PROTEINA',26),
  ('PORT-ESP-27','PORT-ESP','FACTOR REUMATOIDEO',27),
  ('PORT-ESP-28','PORT-ESP','CORTISOL',28),
  ('PORT-ESP-29','PORT-ESP','MIOGLOBINA',29),
  -- COAGULACION (8)
  ('PORT-COA-01','PORT-COA','TIEMPO DE PROTROMBINA',1),
  ('PORT-COA-02','PORT-COA','TIEMPO DE TROMBOPLASTINA PARCIAL',2),
  ('PORT-COA-03','PORT-COA','TIEMPO DE TROMBINA',3),
  ('PORT-COA-04','PORT-COA','FIBRINOGENO',4),
  ('PORT-COA-05','PORT-COA','TIEMPO DE COAGULACIÓN',5),
  ('PORT-COA-06','PORT-COA','TIEMPO DE SANGRAMIENTO',6),
  ('PORT-COA-07','PORT-COA','DIMERO D',7),
  ('PORT-COA-08','PORT-COA','ANTICOAGULANTE LUPICO',8),
  -- COPROLOGIA (13)
  ('PORT-COP-01','PORT-COP','GENERAL DE HECES',1),
  ('PORT-COP-02','PORT-COP','CONCENTRADO DE HECES',2),
  ('PORT-COP-03','PORT-COP','AZUL DE METILENO',3),
  ('PORT-COP-04','PORT-COP','SANGRE OCULTA',4),
  ('PORT-COP-05','PORT-COP','ANTIGENO PARA SALMONELLA',5),
  ('PORT-COP-06','PORT-COP','AG HELICOBACTER PYLORI',6),
  ('PORT-COP-07','PORT-COP','SUSTANCIAS REDUCTORAS',7),
  ('PORT-COP-08','PORT-COP','COLORACION DE COCCIDIOS',8),
  ('PORT-COP-09','PORT-COP','SUDAN III',9),
  ('PORT-COP-10','PORT-COP','ROTAVIRUS',10),
  ('PORT-COP-11','PORT-COP','PANEL GASTRICO VIRAL',11),
  ('PORT-COP-12','PORT-COP','PH EN HECES',12),
  ('PORT-COP-13','PORT-COP','CLOSTRIDIUM-PRUEBA RAPIDA',13),
  -- INMUNOLOGIA/SEROLOGIA (17)
  ('PORT-INS-01','PORT-INS','HIV-RAPIDO',1),
  ('PORT-INS-02','PORT-INS','RPR-CARBON',2),
  ('PORT-INS-03','PORT-INS','SIFILIS-RAPIDO',3),
  ('PORT-INS-04','PORT-INS','COMBO IgG/IgM HEPATITIS A',4),
  ('PORT-INS-05','PORT-INS','COMBO DENGUE NS1/IgG/IgM',5),
  ('PORT-INS-06','PORT-INS','PANEL ITS RAPIDO',6),
  ('PORT-INS-07','PORT-INS','COMBO SARAMPION IgG/IgM',7),
  ('PORT-INS-08','PORT-INS','LATEX-FACTOR REUMATOIDEO',8),
  ('PORT-INS-09','PORT-INS','ANTIGENOS FEBRILES',9),
  ('PORT-INS-10','PORT-INS','PANEL RAPIDO ARBOVIRUS',10),
  ('PORT-INS-11','PORT-INS','MONOTEST',11),
  ('PORT-INS-12','PORT-INS','PRUEBA DE EMBARAZO',12),
  ('PORT-INS-13','PORT-INS','INFLUENZA Ag A/B/H1N1',13),
  ('PORT-INS-14','PORT-INS','ANTIGENO COVID 19',14),
  ('PORT-INS-15','PORT-INS','ANTICUERPOS HELICOBACTER PYLORI',15),
  ('PORT-INS-16','PORT-INS','PRUEBA ASTO-LATEX',16),
  ('PORT-INS-17','PORT-INS','PANEL RESPIRATORIO RAPIDO',17),
  -- BACTERIOLOGIA (16)
  ('PORT-BAC-01','PORT-BAC','BACILOSCOPIA',1),
  ('PORT-BAC-02','PORT-BAC','COLORACION GRAM',2),
  ('PORT-BAC-03','PORT-BAC','COLORACION ZIEHL-NEELSEN',3),
  ('PORT-BAC-04','PORT-BAC','DIRECTO KOH',4),
  ('PORT-BAC-05','PORT-BAC','DIRECTO TINTA CHINA',5),
  ('PORT-BAC-06','PORT-BAC','CITOQUIMICO DE LIQUIDO DE DERRAME',6),
  ('PORT-BAC-07','PORT-BAC','HEMOCULTIVOS',7),
  ('PORT-BAC-08','PORT-BAC','CULTIVOS FARINGEO',8),
  ('PORT-BAC-09','PORT-BAC','CULTIVO DE ESPUTO',9),
  ('PORT-BAC-10','PORT-BAC','UROCULTIVO',10),
  ('PORT-BAC-11','PORT-BAC','COPROCULTIVO',11),
  ('PORT-BAC-12','PORT-BAC','CULTIVO VAGINAL',12),
  ('PORT-BAC-13','PORT-BAC','CULTIVO DE ULCERA',13),
  ('PORT-BAC-14','PORT-BAC','CULTIVO DE HERIDA OPERATORIA',14),
  ('PORT-BAC-15','PORT-BAC','CULTIVO DE LCR',15),
  ('PORT-BAC-16','PORT-BAC','CULTIVO ESPECIFICAR PROCEDENCIA',16),
  -- INMUNO-HEMATOLOGIA (6)
  ('PORT-IHE-01','PORT-IHE','TIPEO SANGUINEO',1),
  ('PORT-IHE-02','PORT-IHE','PRUEBA DU',2),
  ('PORT-IHE-03','PORT-IHE','ANTICUERPOS IRREGULARES',3),
  ('PORT-IHE-04','PORT-IHE','COOMBS DIRECTO',4),
  ('PORT-IHE-05','PORT-IHE','PRUEBA CRUZADA',5),
  ('PORT-IHE-06','PORT-IHE','AGLUTININAS',6),
  -- BIOLOGIA MOLECULAR (6)
  ('PORT-MOL-01','PORT-MOL','PANEL GASTROINTESTINAL',1),
  ('PORT-MOL-02','PORT-MOL','PANEL MENINGITIS/ENCEFALITIS',2),
  ('PORT-MOL-03','PORT-MOL','PANEL RESPIRATOIRO',3),
  ('PORT-MOL-04','PORT-MOL','PANELPNEUMONIA',4),
  ('PORT-MOL-05','PORT-MOL','PANEL DE INFECCION',5),
  ('PORT-MOL-06','PORT-MOL','PANEL DE SEPSIS',6)
) AS v(code, panel_code, name, display_order)
JOIN public."LabPanel" lp ON lp."organizationId" = o.id AND lp.code = v.panel_code
WHERE o."legalName" NOT LIKE 'RLS-Test%'
  AND NOT EXISTS (
    SELECT 1 FROM public."LabTest" lt
    WHERE lt."organizationId" = o.id AND lt.code = v.code
  );

-- -----------------------------------------------------------------------------
-- Verificación post-aplicación
-- -----------------------------------------------------------------------------
-- SELECT count(DISTINCT "organizationId") FROM public."LabPanel" WHERE code LIKE 'PORT-%';
-- SELECT "organizationId", COUNT(*) FROM public."LabPanel" WHERE code LIKE 'PORT-%' GROUP BY 1;
--   -- 10 por organización
-- SELECT "organizationId", COUNT(*) FROM public."LabTest" WHERE code LIKE 'PORT-%' GROUP BY 1;
--   -- 157 por organización
-- SELECT COUNT(*) FROM public."LabPanel" WHERE code LIKE 'AVT-LAB-%' AND active = true;
--   -- 0 (desactivado)
