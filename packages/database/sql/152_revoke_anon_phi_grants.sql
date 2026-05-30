-- =============================================================================
-- 150_revoke_anon_phi_grants.sql
-- Cierra: BD-P0-1 / US-21-A1
-- Revoca grants DML (INSERT, UPDATE, DELETE, TRUNCATE) del rol `anon` en tablas
-- PHI y de credenciales. RLS ya bloquea el acceso efectivo, pero defensa en
-- profundidad exige mínimo privilegio: si una policy falla, `anon` no debe
-- poder mutar datos clínicos ni credenciales.
--
-- Idempotente: REVOKE es no-op si el grant no existe.
-- Mantiene SELECT donde una policy RLS lo requiera (portal magic-link lookup).
-- =============================================================================

-- Tablas clínicas PHI
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public."Patient"
  FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public."PatientIdentifier"
  FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public."Encounter"
  FROM anon;

-- Tablas de credenciales de staff
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public."User"
  FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public."UserCredential"
  FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public."Session"
  FROM anon;

-- Tablas de portal paciente (tokens + MFA)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public."PortalAccount"
  FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public."PortalSession"
  FROM anon;

-- PortalMagicLink: conserva INSERT para el flujo de magic-link anónimo
-- (un usuario sin sesión solicita el link; la inserción la hace la capa de servicio
-- via service_role, no anon directamente — pero se revoca por seguridad y se
-- documenta que el flujo usa service_role).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public."PortalMagicLink"
  FROM anon;

-- Verificación post-apply esperada:
-- SELECT grantee, table_name, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE grantee = 'anon'
--   AND table_name IN ('Patient','User','UserCredential','PortalAccount','PortalSession')
--   AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');
-- → 0 filas
