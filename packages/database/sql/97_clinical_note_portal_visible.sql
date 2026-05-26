-- ============================================================================
-- 97_clinical_note_portal_visible.sql
--
-- K-05 (audit Stream K — Portal Paciente, PR #276): agrega `isPortalVisible`
-- a `ClinicalNote` para gate explícita de visibilidad al portal del paciente.
--
-- Antes de este cambio, `getMisDocumentosFirmados` solo filtraba por
-- `signedAt IS NOT NULL`, exponiendo al paciente cualquier nota firmada
-- (incluyendo psiquiátricas, trabajo social, sospechas de abuso, addenda
-- internos). El docstring del router prometía excluir notas internas pero
-- el campo no existía en schema.
--
-- Default false: para activar visibilidad portal, el clínico debe marcarlo
-- explícitamente al firmar la nota. Esto es backward-compatible con datos
-- existentes — todas las notas previas quedan ocultas del portal hasta
-- revisión clínica.
--
-- Cumple LGPDP Art. 9 (datos de salud sensibles) y TDR §5.2.
-- ============================================================================

ALTER TABLE "ClinicalNote"
  ADD COLUMN IF NOT EXISTS "isPortalVisible" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "ClinicalNote"."isPortalVisible" IS
  'K-05 audit Stream K. Gate explícita de visibilidad al Portal Paciente. '
  'Default false — el clínico debe marcar la nota como publicable al firmar. '
  'Filtra notas psiquiátricas, trabajo social, sospecha de abuso, addenda '
  'internos del feed del portal (getMisDocumentosFirmados).';

-- Índice parcial: solo cubre las notas visibles al portal. Optimiza la query
-- frecuente del feed sin agregar overhead a los UPDATE/INSERT de notas
-- internas (la mayoría según política conservadora).
CREATE INDEX IF NOT EXISTS idx_clinical_note_portal_visible
  ON "ClinicalNote" ("encounterId", "signedAt" DESC)
  WHERE "isPortalVisible" = true AND "signedAt" IS NOT NULL;
