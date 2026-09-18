-- =============================================================================
-- 250_cc0040_lab_procedencia_cultivo.sql — CC-HIS-LAB-2026-001 (CC-0040)
--
-- RF-11 / RN-04: pruebas cuyo nombre indica "ESPECIFICAR PROCEDENCIA"
-- (p. ej. "CULTIVO ESPECIFICAR PROCEDENCIA") exigen capturar la procedencia
-- de donde se toma el cultivo al armar la solicitud. Se persiste por ítem
-- de orden (SolicitudDetalle.procedencia del modelo lógico del CC §8).
--
-- La validación de obligatoriedad es server-side en lis.router `order.create`
-- (el nombre de la prueba vive en el catálogo, editable por tenant — un CHECK
-- estático aquí no puede resolver el nombre sin trigger; decisión: capa app,
-- igual que el resto de validaciones de create). Idempotente.
-- =============================================================================

ALTER TABLE public."LabOrderItem"
  ADD COLUMN IF NOT EXISTS procedencia varchar(300);

COMMENT ON COLUMN public."LabOrderItem".procedencia IS
  'CC-0040 RF-11 — procedencia del cultivo (obligatoria si la prueba indica ESPECIFICAR PROCEDENCIA; null para el resto).';
