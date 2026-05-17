-- =====================================================================
-- 57_ece_02_seguridad.sql
-- Fase 2 ECE — Seguridad del Personal de Salud
-- Norma técnica: Arts. 4.17, 23, 44, 45, 52 — Acuerdo n.° 1616 (MINSAL, 2024).
--
-- Tablas creadas (schema ece):
--   ece.personal_salud    — directorio del personal, FK dual a public."User" y auth.users
--   ece.firma_electronica — credencial de firma (hash argon2id, lockout automático)
--   ece.asignacion_rol    — personal × establecimiento × rol + validity dates
--   ece.perfil_acceso     — matriz RBAC (rol × recurso × permiso)
--
-- Precondición: ejecutar antes
--   55_ece_00_extensions.sql  (schema ece + extensiones)
--   56_ece_01_catalogos.sql   (ece.institucion, ece.establecimiento, ece.servicio, ece.rol)
--
-- Decisión de hashing:
--   La columna pin_hash almacena el resultado PHC producido por la capa de aplicación
--   (Node.js argon2 lib, formato $argon2id$v=19$...).  El salt está embebido en el
--   propio hash PHC; la columna salt_extra es un campo de auditoría explícito para
--   política de rotación y NO se usa en la verificación — la app extrae el salt del hash.
--   PostgreSQL no tiene argon2 nativo: pgcrypto solo provee bcrypt.  Delegar el crypto
--   a la app es correcto y evita transmitir el PIN en claro a la BD.
--
-- Idempotente: todos los DDL usan IF NOT EXISTS / OR REPLACE.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. ece.personal_salud
--    Directorio del personal clínico/administrativo.
--    FK opcional a public."User" (Prisma) y a auth.users (Supabase Auth).
--    Un profesional externo puede existir sin cuenta en la plataforma.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ece.personal_salud (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Vínculo con la sesión HIS (Prisma User). Opcional: un médico ext. puede no tener cuenta.
  his_user_id         uuid        UNIQUE
                                  REFERENCES public."User"(id) ON DELETE RESTRICT,
  -- Vínculo con Supabase Auth para operaciones de autenticación nativa.
  auth_user_id        uuid        UNIQUE
                                  REFERENCES auth.users(id) ON DELETE RESTRICT,
  institucion_id      uuid        NOT NULL REFERENCES ece.institucion(id),
  establecimiento_id  uuid        NOT NULL REFERENCES ece.establecimiento(id),
  -- Documento de identidad nacional (DUI/pasaporte).
  documento_identidad text        NOT NULL,
  nombre_completo     text        NOT NULL,
  -- Registro en la Junta de Vigilancia de la Profesión Médica/Odontológica.
  jvpm_codigo         text,
  profesion           text,
  activo              boolean     NOT NULL DEFAULT true,
  -- Fecha de baja laboral. Activa depuración inmediata de accesos (Art. 23 lit. f).
  fecha_baja          timestamptz,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  ece.personal_salud IS
  'Personal de salud autorizado. Vinculado dualmente a la sesión HIS (public."User") '
  'y a Supabase Auth (auth.users). Art. 23 NTEC.';
COMMENT ON COLUMN ece.personal_salud.fecha_baja IS
  'Cese laboral. El administrador debe depurar accesos al notificarse el cese (Art. 23 lit. f).';
COMMENT ON COLUMN ece.personal_salud.his_user_id IS
  'FK opcional a public."User" (Prisma). NULL para personal externo sin cuenta HIS.';
COMMENT ON COLUMN ece.personal_salud.auth_user_id IS
  'FK opcional a auth.users (Supabase). NULL hasta que el personal active su cuenta.';

-- Índice parcial: búsquedas frecuentes solo sobre personal activo.
CREATE INDEX IF NOT EXISTS idx_personal_estab_activo
  ON ece.personal_salud(establecimiento_id)
  WHERE activo;

CREATE INDEX IF NOT EXISTS idx_personal_institucion
  ON ece.personal_salud(institucion_id);

-- ─────────────────────────────────────────────────────────────────────
-- 2. ece.firma_electronica
--    Credencial de firma electrónica simple (Art. 4.17, 23 lit. a.4 NTEC).
--    NUNCA almacenar PIN en claro.  La app produce el hash argon2id.
--    Lockout automático: 5 intentos fallidos → bloqueo 10 minutos.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ece.firma_electronica (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_id      uuid        NOT NULL UNIQUE
                               REFERENCES ece.personal_salud(id) ON DELETE CASCADE,
  -- Hash PHC completo ($argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>).
  -- Nunca almacenar PIN plano ni bcrypt — solo argon2id vía capa aplicación.
  pin_hash         text        NOT NULL,
  -- Salt explícito para auditoría de rotación (también embebido en pin_hash PHC).
  salt_extra       text        NOT NULL,
  -- Marca de tiempo de la última rotación de PIN.
  last_rotated_at  timestamptz NOT NULL DEFAULT now(),
  -- Contador de intentos fallidos consecutivos.
  failed_attempts  int         NOT NULL DEFAULT 0
                               CHECK (failed_attempts >= 0),
  -- Si != NULL, firma bloqueada hasta este instante.
  locked_until     timestamptz,
  -- Auditoría de vida del registro.
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Revocación explícita de la firma (cese, compromiso de seguridad).
  -- La app valida revoked_at IS NULL antes de aceptar firma. No se mezcla
  -- con locked_until: una firma revocada nunca se desbloquea automáticamente.
  revoked_at       timestamptz
);

COMMENT ON TABLE  ece.firma_electronica IS
  'Firma electrónica simple por profesional. Hash argon2id producido por la app. '
  'Sin posibilidad de descifrado desde la BD (Art. 4.1 NTEC).';
COMMENT ON COLUMN ece.firma_electronica.pin_hash IS
  'Hash PHC argon2id ($argon2id$...). La verificación la realiza la capa de aplicación.';
COMMENT ON COLUMN ece.firma_electronica.salt_extra IS
  'Salt explícito para registros de auditoría de rotación. Embebido también en pin_hash.';
COMMENT ON COLUMN ece.firma_electronica.failed_attempts IS
  'Intentos fallidos consecutivos. Trigger bloquea tras 5 intentos (Art. 23 lit. a.4).';
COMMENT ON COLUMN ece.firma_electronica.locked_until IS
  'NULL = sin bloqueo. Cuando != NULL la firma no puede usarse hasta ese instante.';

-- ─────────────────────────────────────────────────────────────────────
-- 2a. Trigger: bloqueo automático tras 5 intentos fallidos (10 minutos)
--     Se activa en UPDATE de failed_attempts.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ece.fn_lockout_firma()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Solo procesa si failed_attempts aumentó
  IF NEW.failed_attempts > OLD.failed_attempts THEN
    IF NEW.failed_attempts >= 5 THEN
      NEW.locked_until := now() + INTERVAL '10 minutes';
      -- Reset contador para que el siguiente ciclo comience desde cero tras el desbloqueo
      NEW.failed_attempts := 0;
    END IF;
  END IF;

  -- Si la app resetea failed_attempts a 0 (login exitoso), liberar lockout
  IF NEW.failed_attempts = 0 AND OLD.failed_attempts > 0 THEN
    NEW.locked_until := NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ece.fn_lockout_firma() IS
  'Bloquea la firma electrónica 10 min tras 5 intentos fallidos (Art. 23 lit. a.4 NTEC). '
  'La app incrementa failed_attempts en cada intento fallido; este trigger gestiona locked_until.';

DROP TRIGGER IF EXISTS trg_lockout_firma ON ece.firma_electronica;
CREATE TRIGGER trg_lockout_firma
  BEFORE UPDATE OF failed_attempts
  ON ece.firma_electronica
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_lockout_firma();

-- ─────────────────────────────────────────────────────────────────────
-- 3. ece.asignacion_rol
--    Un profesional puede tener múltiples roles en distintos
--    establecimientos/servicios.  Incluye validity dates para auditoría.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ece.asignacion_rol (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_id         uuid        NOT NULL REFERENCES ece.personal_salud(id) ON DELETE CASCADE,
  rol_id              uuid        NOT NULL REFERENCES ece.rol(id),
  -- Restricción opcional a un establecimiento específico (NULL = aplica al personal global).
  establecimiento_id  uuid        REFERENCES ece.establecimiento(id),
  -- Restricción opcional a un servicio dentro del establecimiento.
  servicio_id         uuid        REFERENCES ece.servicio(id),
  -- Período de validez del rol (NULL = sin caducidad).
  vigente_desde       timestamptz NOT NULL DEFAULT now(),
  vigente_hasta       timestamptz,
  -- Quién asignó el rol y cuándo.
  asignado_por        uuid        REFERENCES ece.personal_salud(id),
  asignado_en         timestamptz NOT NULL DEFAULT now(),
  activo              boolean     NOT NULL DEFAULT true,
  CONSTRAINT ck_vigencia_rol
    CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde),
  -- Un personal no puede tener el mismo rol en el mismo establecimiento+servicio dos veces activo.
  CONSTRAINT uq_asignacion_activa
    UNIQUE NULLS NOT DISTINCT (personal_id, rol_id, establecimiento_id, servicio_id)
);

COMMENT ON TABLE  ece.asignacion_rol IS
  'Asignación de roles funcionales al personal por establecimiento y servicio. '
  'Soporta multirol y roles temporales (Art. 44 NTEC).';
COMMENT ON COLUMN ece.asignacion_rol.vigente_hasta IS
  'Caducidad del rol. NULL = indefinido. Habilita auditoría de accesos por período.';

CREATE INDEX IF NOT EXISTS idx_asignacion_personal
  ON ece.asignacion_rol(personal_id)
  WHERE activo;

CREATE INDEX IF NOT EXISTS idx_asignacion_rol_estab
  ON ece.asignacion_rol(rol_id, establecimiento_id)
  WHERE activo;

-- ─────────────────────────────────────────────────────────────────────
-- 4. ece.perfil_acceso
--    Matriz RBAC: rol × recurso × permiso.
--    Desacoplada de asignacion_rol para permitir cambios de permisos
--    sin tocar las asignaciones individuales (Art. 45, 52 NTEC).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ece.perfil_acceso (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rol_id   uuid NOT NULL REFERENCES ece.rol(id) ON DELETE CASCADE,
  -- Identificador del recurso (p. ej. 'historia_clinica', 'epicrisis_egreso', 'orden_medica').
  recurso  text NOT NULL,
  -- Nivel de permiso sobre el recurso.
  permiso  text NOT NULL
           CHECK (permiso IN ('lectura', 'escritura', 'firma', 'autoriza', 'certifica')),
  CONSTRAINT uq_perfil_acceso UNIQUE (rol_id, recurso, permiso)
);

COMMENT ON TABLE  ece.perfil_acceso IS
  'Matriz RBAC: qué puede hacer cada rol sobre cada recurso del ECE. '
  'Mecanismo para evitar acceso con derechos no autorizados (Art. 52 NTEC).';
COMMENT ON COLUMN ece.perfil_acceso.recurso IS
  'Identificador del recurso funcional (historia_clinica, epicrisis_egreso, orden_medica, '
  'consentimiento_informado, anestesia_pre, etc.).';
COMMENT ON COLUMN ece.perfil_acceso.permiso IS
  'lectura | escritura | firma | autoriza | certifica.';

CREATE INDEX IF NOT EXISTS idx_perfil_acceso_rol
  ON ece.perfil_acceso(rol_id);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Trigger: updated_at automático en personal_salud
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ece.fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_personal_updated_at ON ece.personal_salud;
CREATE TRIGGER trg_personal_updated_at
  BEFORE UPDATE ON ece.personal_salud
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_set_updated_at();
