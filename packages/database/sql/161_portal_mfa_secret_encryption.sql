-- =============================================================================
-- 161_portal_mfa_secret_encryption.sql
-- BD-P0-6 / US-21-A6 — Cifrado PortalAccount.mfaSecret (piloto Vault)
-- =============================================================================
--
-- CONTEXTO (ADR inline)
-- ---------------------
-- El hallazgo BD-P0-6 solicitaba cifrado de PortalAccount.mfaSecret,
-- PortalSession.refreshToken y PortalAccount.recoveryToken en BD.
--
-- DIAGNOSTICO (2026-05-30):
--   1. PortalAccount (0 rows en prod): mfaSecret ya se almacena cifrado.
--      El router portal.router.ts usa AES-256-GCM (app-layer) desde commit
--      inicial: encryptSecret() → JSON {v:1, iv, tag, ct} antes de escribir
--      en BD. El texto en claro NUNCA llego a Postgres.
--   2. PortalSession.token y PortalMagicLink.token son tokens de sesion/
--      magic-link: SHA-256 de un nonce, no secretos TOTP — cifrado en reposo
--      no aplica igual (son efimeros, no recuperables, y su compromiso requiere
--      acceso a BD que ya esta protegido por RLS + TLS).
--   3. NO existe columna recoveryToken en ninguna tabla Portal.
--
-- DECISION (tabla ADR):
--
--   Opcion A — Supabase Vault (vault.create_secret)
--     Pros: cifrado gestionado por pgsodium/libsodium, audit logged,
--           key rotation via vault.update_secret sin tocar aplicacion,
--           cumple "datos sensibles fuera del schema de negocio".
--     Contras: refactor router TS para leer via helper function en vez de
--              campo Prisma directo; no retrocompatible con Prisma select.
--     Recomendado: SI (estrategia Sprint 4).
--
--   Opcion B — pgcrypto pgp_sym_encrypt (disponible v1.3)
--     Pros: universal, sin cambio schema visible para Prisma.
--     Contras: key en GUC (menor seguridad que pgsodium XChaCha20),
--              rotacion manual, GUC legible por SUPERUSER.
--     Recomendado: NO (inferior a Vault disponible).
--
--   Opcion C — App-layer AES-256-GCM (ESTADO ACTUAL)
--     Pros: ya implementado, sin dependencia Postgres para cifrado/descifrado.
--     Contras: key management en env var (PORTAL_SECRET / AUTH_SECRET);
--              si se filtra la env var, todos los secrets quedan expuestos.
--     Estado: ACTIVO como capa base. Se mantiene como fallback.
--
--   ESTRATEGIA ELEGIDA: doble capa A + C.
--     - Sprint 3 (este archivo): agregar columna mfa_secret_vault_id uuid,
--       helper function SECURITY DEFINER que lee via Vault, constraint CHECK
--       que garantiza mutual exclusion (o app-layer o vault, no ninguno
--       cuando mfaEnabled=true).
--     - Sprint 4: migrar router TS a escribir en Vault Y leer via
--       get_portal_mfa_secret(). Deprecar campo mfaSecret original.
--
-- SEGURIDAD:
--   - Helper function con SET search_path = public, vault, pg_temp (fijo).
--   - SECURITY DEFINER con owner = postgres (BYPASSRLS) para leer vault.
--   - REVOKE EXECUTE de PUBLIC; GRANT solo a authenticated + service_role.
--
-- IDEMPOTENCIA: todo bloque usa IF NOT EXISTS o DO $$ ... IF EXISTS checks.
-- REVERSIBLE: ver bloque de rollback al final (comentado).
-- =============================================================================

-- ─── 1. Columna vault reference (idempotente) ─────────────────────────────────
ALTER TABLE "PortalAccount"
  ADD COLUMN IF NOT EXISTS "mfaSecretVaultId" uuid DEFAULT NULL;

COMMENT ON COLUMN "PortalAccount"."mfaSecretVaultId" IS
  'UUID del secret en vault.secrets que contiene el TOTP secret en claro '
  '(cifrado por pgsodium/libsodium internamente). '
  'NULL = secret gestionado por app-layer AES-256-GCM en columna mfaSecret. '
  'Cuando Sprint-4 migre a Vault, mfaSecret quedara NULL y este campo populado.';

-- ─── 2. Constraint: coherencia mfaEnabled ↔ al menos un secret ───────────────
-- Regla unica: si mfaEnabled=true, al menos un secret debe existir.
-- Estados validos permitidos:
--   mfaEnabled=false + ambos NULL  → cuenta sin MFA (normal)
--   mfaEnabled=false + mfaSecret   → setup en progreso (antes de verifyMfa)
--   mfaEnabled=false + vaultId     → setup Vault en progreso (Sprint 4)
--   mfaEnabled=true  + mfaSecret   → MFA activo app-layer (estado actual)
--   mfaEnabled=true  + vaultId     → MFA activo via Vault (Sprint 4)
-- Estado invalido bloqueado:
--   mfaEnabled=true + ambos NULL   → inconsistencia de datos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_portal_account_mfa_secret_coherence'
      AND conrelid = '"PortalAccount"'::regclass
  ) THEN
    ALTER TABLE "PortalAccount"
      ADD CONSTRAINT chk_portal_account_mfa_secret_coherence CHECK (
        NOT (
          "mfaEnabled" = true
          AND "mfaSecret" IS NULL
          AND "mfaSecretVaultId" IS NULL
        )
      );
  END IF;
END $$;

-- ─── 3. Helper function SECURITY DEFINER — leer secret desde Vault ────────────
CREATE OR REPLACE FUNCTION public.get_portal_mfa_secret(p_account_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_vault_id  uuid;
  v_secret    text;
BEGIN
  -- Obtener referencia vault del account
  SELECT "mfaSecretVaultId"
    INTO v_vault_id
    FROM "PortalAccount"
   WHERE id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PortalAccount not found: %', p_account_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_vault_id IS NULL THEN
    -- Secret gestionado por app-layer; el router debe usar decryptSecret() TS.
    -- Retornar NULL senaliza al caller que use la ruta app-layer.
    RETURN NULL;
  END IF;

  -- Leer secret descifrado desde Vault (pgsodium XChaCha20-Poly1305)
  SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
   WHERE id = v_vault_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vault secret not found for account %: vault_id=%',
      p_account_id, v_vault_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_secret;
END;
$$;

COMMENT ON FUNCTION public.get_portal_mfa_secret(uuid) IS
  'Retorna el TOTP secret en claro para un PortalAccount leyendo desde '
  'vault.decrypted_secrets. SECURITY DEFINER — solo ejecutable por '
  'authenticated y service_role. Retorna NULL si el account usa app-layer '
  '(mfaSecretVaultId IS NULL); en ese caso el router debe usar decryptSecret().';

-- Permisos: restringir a roles de aplicacion
REVOKE ALL ON FUNCTION public.get_portal_mfa_secret(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_portal_mfa_secret(uuid)
  TO authenticated, service_role;

-- ─── 4. Helper function SECURITY DEFINER — escribir secret a Vault ────────────
-- Usada por el router TS en Sprint 4 para vault.create_secret sin exponer
-- el secret en el log de queries.
CREATE OR REPLACE FUNCTION public.set_portal_mfa_secret_vault(
  p_account_id uuid,
  p_secret_plain text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_vault_id     uuid;
  v_existing_id  uuid;
BEGIN
  -- Verificar account existe
  IF NOT EXISTS (SELECT 1 FROM "PortalAccount" WHERE id = p_account_id) THEN
    RAISE EXCEPTION 'PortalAccount not found: %', p_account_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Obtener vault_id existente (si ya tiene secret en Vault)
  SELECT "mfaSecretVaultId"
    INTO v_existing_id
    FROM "PortalAccount"
   WHERE id = p_account_id;

  IF v_existing_id IS NOT NULL THEN
    -- Rotar secret existente (no crear duplicado)
    PERFORM vault.update_secret(
      v_existing_id,
      p_secret_plain,
      'portal-mfa-' || p_account_id::text,
      'TOTP secret para PortalAccount ' || p_account_id::text
    );
  ELSE
    -- Crear nuevo secret en Vault
    v_vault_id := vault.create_secret(
      p_secret_plain,
      'portal-mfa-' || p_account_id::text,
      'TOTP secret para PortalAccount ' || p_account_id::text
    );

    -- Actualizar referencia en PortalAccount y limpiar app-layer secret
    UPDATE "PortalAccount"
       SET "mfaSecretVaultId" = v_vault_id,
           "mfaSecret"        = NULL,
           "updatedAt"        = now()
     WHERE id = p_account_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.set_portal_mfa_secret_vault(uuid, text) IS
  'Escribe el TOTP secret a vault.secrets y actualiza mfaSecretVaultId '
  'en PortalAccount limpiando mfaSecret (app-layer). Si ya existe un vault '
  'secret, lo rota via vault.update_secret. SECURITY DEFINER.';

REVOKE ALL ON FUNCTION public.set_portal_mfa_secret_vault(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_portal_mfa_secret_vault(uuid, text)
  TO authenticated, service_role;

-- ─── 5. Indice para lookup rapido por vault_id ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_portal_account_mfa_vault_id
  ON "PortalAccount" ("mfaSecretVaultId")
  WHERE "mfaSecretVaultId" IS NOT NULL;

-- ─── 6. No hay rows existentes con mfaSecret populado ─────────────────────────
-- (verificado: total=0 en diagnostico 2026-05-30)
-- Si hubiera rows, aqui iria la migracion batch a Vault.
-- El script esta preparado para cuando Sprint 4 genere rows reales:
--   SELECT set_portal_mfa_secret_vault(id, decryptSecret(mfaSecret))
--   FROM "PortalAccount" WHERE "mfaSecret" IS NOT NULL;
-- (decryptSecret es funcion TS — la migracion batch se haria via script Node)

-- =============================================================================
-- SMOKE TEST (ejecutar manualmente post-apply):
--
--   -- 1. Insertar account de prueba
--   INSERT INTO "PortalAccount" (id, "patientId", email, status, "mfaEnabled",
--     "failedLoginAttempts", "createdAt", "updatedAt")
--   VALUES (
--     'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
--     gen_random_uuid(),
--     'smoke@test.local',
--     'ACTIVE',
--     false,
--     0,
--     now(), now()
--   );
--
--   -- 2. Escribir secret via Vault
--   SELECT set_portal_mfa_secret_vault(
--     'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
--     'test-secret-12345'
--   );
--
--   -- 3. Verificar mfaSecret es NULL (no texto en claro)
--   SELECT "mfaSecret", "mfaSecretVaultId"
--   FROM "PortalAccount"
--   WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
--   -- Esperado: mfaSecret=NULL, mfaSecretVaultId=<uuid>
--
--   -- 4. Recuperar via helper (debe retornar texto en claro)
--   SELECT get_portal_mfa_secret('aaaaaaaa-0000-0000-0000-000000000001'::uuid);
--   -- Esperado: 'test-secret-12345'
--
--   -- 5. Limpieza
--   DELETE FROM vault.secrets
--   WHERE id = (
--     SELECT "mfaSecretVaultId" FROM "PortalAccount"
--     WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'
--   );
--   DELETE FROM "PortalAccount"
--   WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
--
-- =============================================================================
-- ROLLBACK (si necesario revertir):
--
--   DROP FUNCTION IF EXISTS public.get_portal_mfa_secret(uuid);
--   DROP FUNCTION IF EXISTS public.set_portal_mfa_secret_vault(uuid, text);
--   ALTER TABLE "PortalAccount"
--     DROP CONSTRAINT IF EXISTS chk_portal_account_mfa_secret_coherence,
--     DROP COLUMN IF EXISTS "mfaSecretVaultId";
--   DROP INDEX IF EXISTS idx_portal_account_mfa_vault_id;
--
-- =============================================================================
