-- =============================================================================
-- HIS Multi-país | CC-0011 — Catálogo de exámenes parametrizable (§17 LIS)
--
-- Contexto: la HC Avante (mockup docs/CC/0007/historia-clinica-avante2.html,
-- líneas 1573-1600, const EXAM_CATALOGS) traía el catálogo de solicitud de
-- exámenes hardcodeado en JS del mockup. Este SQL lo materializa como
-- catálogo BD parametrizable sobre las tablas LIS existentes
-- (public."LabPanel" / public."LabTest" — 10_lis_rls.sql, 27_lis_hardening_v2.sql).
--
-- Cambios:
--   1. ALTER TABLE — 3 columnas nuevas: LabPanel.area, LabPanel.displayOrder,
--      LabTest.displayOrder. Naming: sigue la convención física real del
--      bloque LIS (columnas camelCase quoted, palabras simples sin quote —
--      ver 27_lis_hardening_v2.sql). Prisma NO usa @map en estos campos
--      (schema.prisma bloque LabPanel/LabTest), así que el nombre físico es
--      igual al nombre del campo Prisma.
--   2. CHECK area IN ('LABORATORIO','RADIOLOGIA','CARDIOLOGIA').
--   3. Índice (area, active) para el query de listByArea.
--   4. Seed idempotente (INSERT...SELECT...WHERE NOT EXISTS) del catálogo
--      GLOBAL (organization_id = NULL): 20 paneles + 93 exámenes, contenido
--      LITERAL del mockup (incluye tildes y símbolos ₂/₃/⁻).
--
-- RLS: 10_lis_rls.sql ya define `lab_panel_tenant_modify` / `lab_test_tenant_modify`
-- como `FOR ALL` (cubre INSERT/UPDATE/DELETE de filas del propio tenant) y
-- `*_global_or_tenant_select` para SELECT (global OR tenant). No se requiere
-- policy nueva — el catálogo global de este seed lo escribe una sesión con
-- privilegios de servicio (bypassa RLS), igual que los seeds LIS anteriores.
--
-- Idempotente. Aplicar vía Supabase SQL Editor / MCP (no prisma migrate).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas nuevas
-- -----------------------------------------------------------------------------

ALTER TABLE public."LabPanel" ADD COLUMN IF NOT EXISTS area VARCHAR(20) NOT NULL DEFAULT 'LABORATORIO';
ALTER TABLE public."LabPanel" ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public."LabTest"  ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- 2. CHECK constraint — área cerrada a los 3 valores del mockup
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_panel_area_chk') THEN
    ALTER TABLE public."LabPanel"
      ADD CONSTRAINT lab_panel_area_chk
      CHECK (area IN ('LABORATORIO', 'RADIOLOGIA', 'CARDIOLOGIA'));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Índice — listByArea filtra por area + active, ordena por displayOrder
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_lab_panel_area_active ON public."LabPanel" (area, active);

-- -----------------------------------------------------------------------------
-- 4. Seed — 20 paneles globales (organization_id NULL)
--    Contenido literal de EXAM_CATALOGS (mockup avante2, L1573-1600).
-- -----------------------------------------------------------------------------

-- "updatedAt" es NOT NULL sin default en BD (Prisma @updatedAt) — se setea explícito.
INSERT INTO public."LabPanel" (id, "organizationId", code, name, area, "displayOrder", active, "updatedAt")
SELECT gen_random_uuid(), NULL, v.code, v.name, v.area, v.display_order, true, now()
FROM (VALUES
  -- LABORATORIO (10 paneles)
  ('AVT-LAB-HEM', 'Hematología y coagulación',        'LABORATORIO', 1),
  ('AVT-LAB-QUI', 'Química sanguínea',                 'LABORATORIO', 2),
  ('AVT-LAB-HOR', 'Hormonas y pruebas especiales',     'LABORATORIO', 3),
  ('AVT-LAB-MIC', 'Microbiología',                     'LABORATORIO', 4),
  ('AVT-LAB-URI', 'Urianálisis',                       'LABORATORIO', 5),
  ('AVT-LAB-COP', 'Coprología',                        'LABORATORIO', 6),
  ('AVT-LAB-BAN', 'Banco de sangre',                   'LABORATORIO', 7),
  ('AVT-LAB-MOL', 'Pruebas moleculares',                'LABORATORIO', 8),
  ('AVT-LAB-INM', 'Inmunología',                        'LABORATORIO', 9),
  ('AVT-LAB-GAS', 'Gasometría venosa',                  'LABORATORIO', 10),
  -- RADIOLOGIA (5 paneles)
  ('AVT-RAD-RXS', 'Rayos X',                            'RADIOLOGIA', 1),
  ('AVT-RAD-USG', 'Ultrasonografía',                    'RADIOLOGIA', 2),
  ('AVT-RAD-TAC', 'Tomografía',                         'RADIOLOGIA', 3),
  ('AVT-RAD-RMN', 'Resonancia Magnética',               'RADIOLOGIA', 4),
  ('AVT-RAD-ESP', 'Estudios Especiales',                'RADIOLOGIA', 5),
  -- CARDIOLOGIA (5 paneles)
  ('AVT-CAR-ECG', 'Electrocardiograma',                 'CARDIOLOGIA', 1),
  ('AVT-CAR-ECO', 'Ecocardiograma',                     'CARDIOLOGIA', 2),
  ('AVT-CAR-HOL', 'Monitoreo Holter',                   'CARDIOLOGIA', 3),
  ('AVT-CAR-ESF', 'Prueba de esfuerzo',                 'CARDIOLOGIA', 4),
  ('AVT-CAR-ESP', 'Estudios Especiales',                'CARDIOLOGIA', 5)
) AS v(code, name, area, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public."LabPanel" lp WHERE lp.code = v.code
);

-- -----------------------------------------------------------------------------
-- 5. Seed — 93 exámenes globales (organization_id NULL), specimen = 'OTHER'
--    (no aplica un tipo de espécimen físico único para todo el catálogo;
--    estas filas no alimentan el flujo de toma de muestra LIS existente,
--    solo el catálogo de solicitud de HC — Wave 2 puede afinar por examen).
-- -----------------------------------------------------------------------------

INSERT INTO public."LabTest" (id, "organizationId", "panelId", code, name, specimen, "displayOrder", active, "updatedAt")
SELECT gen_random_uuid(), NULL, lp.id, v.code, v.name, 'OTHER'::"SpecimenType", v.display_order, true, now()
FROM (VALUES
  -- Hematología y coagulación (AVT-LAB-HEM)
  ('AVT-LAB-HEM-01', 'AVT-LAB-HEM', 'Hemograma completo', 1),
  ('AVT-LAB-HEM-02', 'AVT-LAB-HEM', 'Velocidad de sedimentación', 2),
  ('AVT-LAB-HEM-03', 'AVT-LAB-HEM', 'Tiempo de protrombina (TP)', 3),
  ('AVT-LAB-HEM-04', 'AVT-LAB-HEM', 'Tiempo de tromboplastina (TTP)', 4),
  ('AVT-LAB-HEM-05', 'AVT-LAB-HEM', 'INR', 5),
  ('AVT-LAB-HEM-06', 'AVT-LAB-HEM', 'Recuento de plaquetas', 6),
  ('AVT-LAB-HEM-07', 'AVT-LAB-HEM', 'Fibrinógeno', 7),
  -- Química sanguínea (AVT-LAB-QUI)
  ('AVT-LAB-QUI-01', 'AVT-LAB-QUI', 'Glucosa', 1),
  ('AVT-LAB-QUI-02', 'AVT-LAB-QUI', 'Creatinina', 2),
  ('AVT-LAB-QUI-03', 'AVT-LAB-QUI', 'Nitrógeno ureico (BUN)', 3),
  ('AVT-LAB-QUI-04', 'AVT-LAB-QUI', 'Ácido úrico', 4),
  ('AVT-LAB-QUI-05', 'AVT-LAB-QUI', 'Colesterol total', 5),
  ('AVT-LAB-QUI-06', 'AVT-LAB-QUI', 'Triglicéridos', 6),
  ('AVT-LAB-QUI-07', 'AVT-LAB-QUI', 'HDL', 7),
  ('AVT-LAB-QUI-08', 'AVT-LAB-QUI', 'LDL', 8),
  ('AVT-LAB-QUI-09', 'AVT-LAB-QUI', 'AST (TGO)', 9),
  ('AVT-LAB-QUI-10', 'AVT-LAB-QUI', 'ALT (TGP)', 10),
  ('AVT-LAB-QUI-11', 'AVT-LAB-QUI', 'Bilirrubinas', 11),
  ('AVT-LAB-QUI-12', 'AVT-LAB-QUI', 'Electrolitos (Na/K/Cl)', 12),
  -- Hormonas y pruebas especiales (AVT-LAB-HOR)
  ('AVT-LAB-HOR-01', 'AVT-LAB-HOR', 'TSH', 1),
  ('AVT-LAB-HOR-02', 'AVT-LAB-HOR', 'T4 libre', 2),
  ('AVT-LAB-HOR-03', 'AVT-LAB-HOR', 'T3', 3),
  ('AVT-LAB-HOR-04', 'AVT-LAB-HOR', 'Cortisol', 4),
  ('AVT-LAB-HOR-05', 'AVT-LAB-HOR', 'Insulina', 5),
  ('AVT-LAB-HOR-06', 'AVT-LAB-HOR', 'PSA', 6),
  ('AVT-LAB-HOR-07', 'AVT-LAB-HOR', 'Beta-hCG cuantitativa', 7),
  ('AVT-LAB-HOR-08', 'AVT-LAB-HOR', 'Vitamina D', 8),
  -- Microbiología (AVT-LAB-MIC)
  ('AVT-LAB-MIC-01', 'AVT-LAB-MIC', 'Hemocultivo', 1),
  ('AVT-LAB-MIC-02', 'AVT-LAB-MIC', 'Urocultivo', 2),
  ('AVT-LAB-MIC-03', 'AVT-LAB-MIC', 'Coprocultivo', 3),
  ('AVT-LAB-MIC-04', 'AVT-LAB-MIC', 'Cultivo de secreción', 4),
  ('AVT-LAB-MIC-05', 'AVT-LAB-MIC', 'Tinción de Gram', 5),
  ('AVT-LAB-MIC-06', 'AVT-LAB-MIC', 'Baciloscopía (BAAR)', 6),
  -- Urianálisis (AVT-LAB-URI)
  ('AVT-LAB-URI-01', 'AVT-LAB-URI', 'Examen general de orina', 1),
  ('AVT-LAB-URI-02', 'AVT-LAB-URI', 'Microalbuminuria', 2),
  ('AVT-LAB-URI-03', 'AVT-LAB-URI', 'Relación albúmina/creatinina', 3),
  -- Coprología (AVT-LAB-COP)
  ('AVT-LAB-COP-01', 'AVT-LAB-COP', 'Examen general de heces', 1),
  ('AVT-LAB-COP-02', 'AVT-LAB-COP', 'Sangre oculta en heces', 2),
  ('AVT-LAB-COP-03', 'AVT-LAB-COP', 'Coproparasitológico seriado', 3),
  -- Banco de sangre (AVT-LAB-BAN)
  ('AVT-LAB-BAN-01', 'AVT-LAB-BAN', 'Tipeo ABO/Rh', 1),
  ('AVT-LAB-BAN-02', 'AVT-LAB-BAN', 'Prueba cruzada', 2),
  ('AVT-LAB-BAN-03', 'AVT-LAB-BAN', 'Coombs directo', 3),
  ('AVT-LAB-BAN-04', 'AVT-LAB-BAN', 'Coombs indirecto', 4),
  -- Pruebas moleculares (AVT-LAB-MOL)
  ('AVT-LAB-MOL-01', 'AVT-LAB-MOL', 'PCR SARS-CoV-2', 1),
  ('AVT-LAB-MOL-02', 'AVT-LAB-MOL', 'Carga viral VIH', 2),
  ('AVT-LAB-MOL-03', 'AVT-LAB-MOL', 'Genotipo VHC', 3),
  ('AVT-LAB-MOL-04', 'AVT-LAB-MOL', 'PCR Influenza A/B', 4),
  -- Inmunología (AVT-LAB-INM)
  ('AVT-LAB-INM-01', 'AVT-LAB-INM', 'Proteína C reactiva (PCR)', 1),
  ('AVT-LAB-INM-02', 'AVT-LAB-INM', 'Factor reumatoide', 2),
  ('AVT-LAB-INM-03', 'AVT-LAB-INM', 'Anticuerpos antinucleares (ANA)', 3),
  ('AVT-LAB-INM-04', 'AVT-LAB-INM', 'VIH (ELISA)', 4),
  ('AVT-LAB-INM-05', 'AVT-LAB-INM', 'VDRL/RPR', 5),
  ('AVT-LAB-INM-06', 'AVT-LAB-INM', 'Antígeno de superficie VHB', 6),
  -- Gasometría venosa (AVT-LAB-GAS)
  ('AVT-LAB-GAS-01', 'AVT-LAB-GAS', 'pH venoso', 1),
  ('AVT-LAB-GAS-02', 'AVT-LAB-GAS', 'pCO₂ venoso', 2),
  ('AVT-LAB-GAS-03', 'AVT-LAB-GAS', 'HCO₃⁻', 3),
  ('AVT-LAB-GAS-04', 'AVT-LAB-GAS', 'Exceso de base', 4),
  ('AVT-LAB-GAS-05', 'AVT-LAB-GAS', 'Lactato venoso', 5),
  -- Rayos X (AVT-RAD-RXS)
  ('AVT-RAD-RXS-01', 'AVT-RAD-RXS', 'Tórax PA y lateral', 1),
  ('AVT-RAD-RXS-02', 'AVT-RAD-RXS', 'Abdomen simple de pie', 2),
  ('AVT-RAD-RXS-03', 'AVT-RAD-RXS', 'Columna lumbar', 3),
  ('AVT-RAD-RXS-04', 'AVT-RAD-RXS', 'Extremidad (especificar)', 4),
  ('AVT-RAD-RXS-05', 'AVT-RAD-RXS', 'Senos paranasales', 5),
  -- Ultrasonografía (AVT-RAD-USG)
  ('AVT-RAD-USG-01', 'AVT-RAD-USG', 'Abdominal completo', 1),
  ('AVT-RAD-USG-02', 'AVT-RAD-USG', 'Pélvico', 2),
  ('AVT-RAD-USG-03', 'AVT-RAD-USG', 'Obstétrico', 3),
  ('AVT-RAD-USG-04', 'AVT-RAD-USG', 'Renal y vías urinarias', 4),
  ('AVT-RAD-USG-05', 'AVT-RAD-USG', 'Tiroideo', 5),
  ('AVT-RAD-USG-06', 'AVT-RAD-USG', 'Doppler de miembros', 6),
  -- Tomografía (AVT-RAD-TAC)
  ('AVT-RAD-TAC-01', 'AVT-RAD-TAC', 'TAC de cráneo simple', 1),
  ('AVT-RAD-TAC-02', 'AVT-RAD-TAC', 'TAC de tórax', 2),
  ('AVT-RAD-TAC-03', 'AVT-RAD-TAC', 'TAC de abdomen y pelvis con contraste', 3),
  ('AVT-RAD-TAC-04', 'AVT-RAD-TAC', 'Angio-TAC', 4),
  -- Resonancia Magnética (AVT-RAD-RMN)
  ('AVT-RAD-RMN-01', 'AVT-RAD-RMN', 'RM de cráneo', 1),
  ('AVT-RAD-RMN-02', 'AVT-RAD-RMN', 'RM de columna lumbar', 2),
  ('AVT-RAD-RMN-03', 'AVT-RAD-RMN', 'RM de rodilla', 3),
  ('AVT-RAD-RMN-04', 'AVT-RAD-RMN', 'RM con contraste', 4),
  -- Estudios Especiales — Radiología (AVT-RAD-ESP)
  ('AVT-RAD-ESP-01', 'AVT-RAD-ESP', 'Mamografía bilateral', 1),
  ('AVT-RAD-ESP-02', 'AVT-RAD-ESP', 'Densitometría ósea', 2),
  ('AVT-RAD-ESP-03', 'AVT-RAD-ESP', 'Fluoroscopía', 3),
  -- Electrocardiograma (AVT-CAR-ECG)
  ('AVT-CAR-ECG-01', 'AVT-CAR-ECG', 'ECG de 12 derivaciones', 1),
  ('AVT-CAR-ECG-02', 'AVT-CAR-ECG', 'ECG con tira de ritmo', 2),
  -- Ecocardiograma (AVT-CAR-ECO)
  ('AVT-CAR-ECO-01', 'AVT-CAR-ECO', 'Ecocardiograma transtorácico', 1),
  ('AVT-CAR-ECO-02', 'AVT-CAR-ECO', 'Ecocardiograma transesofágico', 2),
  ('AVT-CAR-ECO-03', 'AVT-CAR-ECO', 'Ecocardiograma con Doppler', 3),
  ('AVT-CAR-ECO-04', 'AVT-CAR-ECO', 'Eco-estrés', 4),
  -- Monitoreo Holter (AVT-CAR-HOL)
  ('AVT-CAR-HOL-01', 'AVT-CAR-HOL', 'Holter de 24 horas', 1),
  ('AVT-CAR-HOL-02', 'AVT-CAR-HOL', 'Holter de 48 horas', 2),
  ('AVT-CAR-HOL-03', 'AVT-CAR-HOL', 'MAPA (presión 24 h)', 3),
  -- Prueba de esfuerzo (AVT-CAR-ESF)
  ('AVT-CAR-ESF-01', 'AVT-CAR-ESF', 'Prueba de esfuerzo en banda', 1),
  ('AVT-CAR-ESF-02', 'AVT-CAR-ESF', 'Prueba de esfuerzo con consumo de O₂', 2),
  -- Estudios Especiales — Cardiología (AVT-CAR-ESP)
  ('AVT-CAR-ESP-01', 'AVT-CAR-ESP', 'Tilt test', 1),
  ('AVT-CAR-ESP-02', 'AVT-CAR-ESP', 'Estudio electrofisiológico', 2)
) AS v(code, panel_code, name, display_order)
JOIN public."LabPanel" lp ON lp.code = v.panel_code
WHERE NOT EXISTS (
  SELECT 1 FROM public."LabTest" lt WHERE lt.code = v.code
);

-- -----------------------------------------------------------------------------
-- Verificación post-aplicación
-- -----------------------------------------------------------------------------
-- SELECT area, COUNT(*) FROM public."LabPanel" WHERE code LIKE 'AVT-%' GROUP BY area;
--   -- LABORATORIO=10, RADIOLOGIA=5, CARDIOLOGIA=5
-- SELECT COUNT(*) FROM public."LabTest" WHERE code LIKE 'AVT-%';
--   -- 93
