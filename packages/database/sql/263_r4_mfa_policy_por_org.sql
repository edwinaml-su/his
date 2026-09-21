-- =============================================================================
-- 263 — R4.5: switch de MFA staff parametrizable por organización
-- ⚠ APLICADO a prod (ejacvsgbewcerxtjtwto) el 2026-09-21 vía MCP — NO re-aplicar.
-- Verificado post-apply: 23 organizaciones, TODAS con mfaStaffRequired=false.
-- =============================================================================
-- Contexto: el segundo factor de staff (TOTP) está cableado en los layouts
-- admin/clinical (`apps/web/src/lib/auth/mfa-guard.ts`) pero la política vive
-- SOLO en variables de entorno (`MFA_REQUIRED_ROLE_CODES` + `MFA_SESSION_SECRET`),
-- apagada globalmente desde OWASP 2025 porque encenderla ahí afecta a TODAS las
-- organizaciones del tenant a la vez y exige un redeploy.
--
-- Este SQL agrega un switch de runtime POR ORGANIZACIÓN, default OFF. Un
-- ADMIN de la organización lo prende desde /organizations (mutation
-- `organization.setMfaStaffRequired`) sin tocar env vars ni redeployar.
-- Encenderlo en prod es decisión de Edwin — NO de este PR.
--
-- Con el flag en `false` (default), `readMfaPolicy()` se comporta EXACTAMENTE
-- igual que hoy: el switch se evalúa con OR sobre la política legada de env
-- vars, así que una org en false no cambia nada del comportamiento actual.
--
-- Columna simple en `Organization`: no se modela tabla aparte porque es un
-- solo booleano sin historial/auditoría propia (a diferencia de, p.ej.,
-- `tipo_documento_establecimiento` que sí necesita overrides granulares).
--
-- Idempotente: `ADD COLUMN IF NOT EXISTS`.
-- =============================================================================

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "mfaStaffRequired" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "Organization"."mfaStaffRequired" IS
  'R4.5 — exige segundo factor (TOTP) a todo el staff de esta organización. Default false (comportamiento actual). Runtime toggle vía /organizations, no requiere redeploy.';
