-- ============================================================================
-- 167_certificado_defuncion_campos_legales.sql
--
-- Agrega columnas legales faltantes a ece.certificado_defuncion.
--
-- DECISIONES DE DISEÑO:
--   ADD COLUMN — campos genuinamente faltantes para certificado SV (NTEC Art. 21):
--     · lugar_defuncion   — lugar del fallecimiento (formulario obligatorio).
--     · causa_principal_cie10 — causa directa/inmediata (≠ causa_basica_cie10 que
--                             es la causa subyacente/fundamental; son posiciones
--                             distintas en la cadena causal NTEC).
--     · manera            — forma clínica de la muerte (natural/violenta/accidental/
--                           suicidio/homicidio/indeterminada).  DISTINTA de
--                           `clasificacion` (natural/violenta/accidente_transito/
--                           en_investigacion) que es categoría legal RNPN.
--     · autopsia_realizada — campo legal obligatorio en SV.
--     · observaciones     — notas clínicas adicionales.
--     · motivo_anulacion  — auditoría de anulaciones.
--
--   MAP — columna existe, el router usa alias:
--     · causas_intermedias_cie10 (router/UI) ↔ causas_intermedias (BD)
--       → se maneja con alias en SELECT y nombre real en INSERT; sin ALTER.
--
--   DERIVE vía JOIN — no se almacenan en esta tabla:
--     · paciente_id     → episodio_atencion.paciente_id
--     · establecimiento_id → episodio_atencion.establecimiento_id
--       El router filtra por establecimiento usando el episodio JOIN.
--
-- Todos los ADD son IF NOT EXISTS (idempotente).
-- DEFAULT explícito para filas históricas (NOT NULL sería incompatible sin default
-- sobre filas existentes; se usa nullable con default donde corresponde).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. lugar_defuncion — obligatorio en certificados nuevos
-- ----------------------------------------------------------------------------
ALTER TABLE ece.certificado_defuncion
  ADD COLUMN IF NOT EXISTS lugar_defuncion text
    CHECK (lugar_defuncion IN ('intrahospitalaria', 'extrahospitalaria'));

-- ----------------------------------------------------------------------------
-- 2. causa_principal_cie10 — causa directa/inmediata (Parte I, línea a del cert.)
-- ----------------------------------------------------------------------------
ALTER TABLE ece.certificado_defuncion
  ADD COLUMN IF NOT EXISTS causa_principal_cie10 text;

-- ----------------------------------------------------------------------------
-- 3. manera — forma clínica de la muerte (Parte II del certificado SV)
-- ----------------------------------------------------------------------------
ALTER TABLE ece.certificado_defuncion
  ADD COLUMN IF NOT EXISTS manera text
    CHECK (manera IN ('natural', 'violenta', 'accidental', 'suicidio', 'homicidio', 'indeterminada'));

-- ----------------------------------------------------------------------------
-- 4. autopsia_realizada
-- ----------------------------------------------------------------------------
ALTER TABLE ece.certificado_defuncion
  ADD COLUMN IF NOT EXISTS autopsia_realizada boolean DEFAULT false;

-- ----------------------------------------------------------------------------
-- 5. observaciones
-- ----------------------------------------------------------------------------
ALTER TABLE ece.certificado_defuncion
  ADD COLUMN IF NOT EXISTS observaciones text;

-- ----------------------------------------------------------------------------
-- 6. motivo_anulacion
-- ----------------------------------------------------------------------------
ALTER TABLE ece.certificado_defuncion
  ADD COLUMN IF NOT EXISTS motivo_anulacion text;

COMMIT;
