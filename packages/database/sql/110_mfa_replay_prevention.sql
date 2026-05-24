-- =============================================================================
-- 110_mfa_replay_prevention.sql
-- Prevención de replay de códigos TOTP (HJ-20).
--
-- Estrategia: columnas en UserCredential para registrar el último step TOTP
-- consumido exitosamente. Un "step" es floor(unix_epoch / 30) — identifica
-- de forma unívoca el slot de 30 s. El router compara el step actual contra
-- lastUsedTotpStep; si coinciden, rechaza (replay).
--
-- Alternativas descartadas:
--   - Tabla mfa_used_code: overhead innecesario para 1 step activo por usuario.
--   - In-memory Set: no funciona con múltiples instancias de servidor.
-- =============================================================================

ALTER TABLE "UserCredential"
  ADD COLUMN IF NOT EXISTS "lastUsedTotpStep" BIGINT,
  ADD COLUMN IF NOT EXISTS "lastUsedTotpAt"   TIMESTAMPTZ;

COMMENT ON COLUMN "UserCredential"."lastUsedTotpStep" IS
  'Último step TOTP (floor(epoch_s/30)) verificado exitosamente. '
  'Previene replay dentro de la misma ventana ±1 step (~90s).';

COMMENT ON COLUMN "UserCredential"."lastUsedTotpAt" IS
  'Timestamp UTC del último verify TOTP exitoso. Sólo informativo / auditoría.';

-- Índice parcial: sólo rows TOTP tienen estos campos relevantes.
CREATE INDEX IF NOT EXISTS "idx_user_credential_totp_step"
  ON "UserCredential" ("userId", "lastUsedTotpStep")
  WHERE method = 'TOTP';
