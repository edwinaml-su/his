-- =============================================================================
-- 220_lab_parametros_iniciales.sql — Parámetros iniciales por prueba del
-- mockup funcional (design/mockup/mockup_examenes_laboratorio.html,
-- BASELINE_DB.parametros, claves "SECCION|||PRUEBA").
--
-- Se cargan los 3 sets que resuelven a pruebas del catálogo v2 (sql/219):
--   URIANALISIS|||GENERAL DE ORINA   → 13 parámetros
--   HEMATOLOGIA|||HEMOGRAMA COMPLETO → 10 parámetros
--   QUIMICA|||GLUCOSA                → 3 parámetros
-- "MICROBIOLOGIA|||CULTIVO DE LCR" del mockup NO se carga: en el catálogo v2
-- esa prueba se dividió en cultivos específicos (BAAR/NO BAAR/HONGOS DE LCR).
--
-- Idempotente y org-genérico (ON CONFLICT en unique labTestId+name).
-- =============================================================================

WITH v(seccion, prueba, param, ord) AS (VALUES
  ('URIANALISIS', 'GENERAL DE ORINA', 'Color', 0),
  ('URIANALISIS', 'GENERAL DE ORINA', 'Aspecto', 1),
  ('URIANALISIS', 'GENERAL DE ORINA', 'Densidad', 2),
  ('URIANALISIS', 'GENERAL DE ORINA', 'pH', 3),
  ('URIANALISIS', 'GENERAL DE ORINA', 'Proteínas', 4),
  ('URIANALISIS', 'GENERAL DE ORINA', 'Glucosa', 5),
  ('URIANALISIS', 'GENERAL DE ORINA', 'Cetonas', 6),
  ('URIANALISIS', 'GENERAL DE ORINA', 'Urobilinógeno', 7),
  ('URIANALISIS', 'GENERAL DE ORINA', 'Bilirrubina', 8),
  ('URIANALISIS', 'GENERAL DE ORINA', 'Sangre', 9),
  ('URIANALISIS', 'GENERAL DE ORINA', 'Nitritos', 10),
  ('URIANALISIS', 'GENERAL DE ORINA', 'Leucocitos', 11),
  ('URIANALISIS', 'GENERAL DE ORINA', 'Sedimento', 12),
  ('HEMATOLOGIA', 'HEMOGRAMA COMPLETO', 'Hemoglobina', 0),
  ('HEMATOLOGIA', 'HEMOGRAMA COMPLETO', 'Hematocrito', 1),
  ('HEMATOLOGIA', 'HEMOGRAMA COMPLETO', 'Leucocitos', 2),
  ('HEMATOLOGIA', 'HEMOGRAMA COMPLETO', 'Plaquetas', 3),
  ('HEMATOLOGIA', 'HEMOGRAMA COMPLETO', 'VCM', 4),
  ('HEMATOLOGIA', 'HEMOGRAMA COMPLETO', 'HCM', 5),
  ('HEMATOLOGIA', 'HEMOGRAMA COMPLETO', 'Neutrófilos', 6),
  ('HEMATOLOGIA', 'HEMOGRAMA COMPLETO', 'Linfocitos', 7),
  ('HEMATOLOGIA', 'HEMOGRAMA COMPLETO', 'Monocitos', 8),
  ('HEMATOLOGIA', 'HEMOGRAMA COMPLETO', 'Eosinófilos', 9),
  ('QUIMICA', 'GLUCOSA', 'Resultado', 0),
  ('QUIMICA', 'GLUCOSA', 'Unidad', 1),
  ('QUIMICA', 'GLUCOSA', 'Rango de referencia', 2)
)
INSERT INTO public."LabTestParameter" ("labTestId", name, "displayOrder")
SELECT t.id, v.param, v.ord
FROM v
JOIN public."LabPanel" p ON p.area = 'LABORATORIO' AND upper(p.name) = upper(v.seccion)
JOIN public."LabTest" t ON t."panelId" = p.id AND t."organizationId" = p."organizationId"
  AND upper(t.name) = upper(v.prueba) AND t.active
ON CONFLICT ("labTestId", name) DO UPDATE SET "displayOrder" = EXCLUDED."displayOrder";
