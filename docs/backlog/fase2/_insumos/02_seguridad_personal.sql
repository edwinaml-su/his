-- =====================================================================
-- 02_seguridad_personal.sql
-- Personal de salud, asignación de roles, firma electrónica simple
-- y perfiles de acceso (Art. 23, 44, 45, 52 NTEC).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Personal de salud (vinculado a Supabase Auth: auth.users)
-- ---------------------------------------------------------------------
create table ece.personal_salud (
  id                  uuid primary key default gen_random_uuid(),
  auth_user_id        uuid unique references auth.users(id) on delete restrict,
  institucion_id      uuid not null references ece.institucion(id),
  establecimiento_id  uuid not null references ece.establecimiento(id),
  documento_identidad text not null,
  nombre_completo     text not null,
  jvpm_o_jvp          text,                       -- registro de la junta de vigilancia profesional
  profesion           text,
  activo              boolean not null default true,
  fecha_baja          timestamptz,                -- depuración anual de inactivos (Art. 23 lit. f)
  creado_en           timestamptz not null default now()
);
comment on column ece.personal_salud.fecha_baja is
  'Cese laboral. El administrador debe depurar accesos al notificarse el cese (Art. 23 lit. f).';

create index idx_personal_estab on ece.personal_salud(establecimiento_id) where activo;

-- ---------------------------------------------------------------------
-- Asignación de rol (un profesional puede tener varios roles)
-- ---------------------------------------------------------------------
create table ece.asignacion_rol (
  id                uuid primary key default gen_random_uuid(),
  personal_id       uuid not null references ece.personal_salud(id),
  rol_id            uuid not null references ece.rol(id),
  servicio_id       uuid references ece.servicio(id),  -- rol acotado a un servicio (opcional)
  vigente           boolean not null default true,
  asignado_en       timestamptz not null default now(),
  unique (personal_id, rol_id, servicio_id)
);

-- ---------------------------------------------------------------------
-- Firma electrónica simple (Art. 4.17, 23 lit. a.4 NTEC)
-- Vínculo único e innegable persona física <-> firma.
-- ---------------------------------------------------------------------
create table ece.firma_electronica (
  id            uuid primary key default gen_random_uuid(),
  personal_id   uuid not null unique references ece.personal_salud(id),
  -- huella criptográfica de la credencial (NUNCA almacenar la credencial en claro)
  hash_credencial text not null,
  algoritmo     text not null default 'argon2id',
  vigente       boolean not null default true,
  emitida_en    timestamptz not null default now(),
  revocada_en   timestamptz
);
comment on table ece.firma_electronica is
  'Firma electrónica simple. Almacenamiento sin posibilidad de descifrado (Art. 4.1 NTEC).';

-- ---------------------------------------------------------------------
-- Perfil de acceso por rol (RBAC) — Art. 45, 52 NTEC
-- ---------------------------------------------------------------------
create table ece.perfil_acceso (
  id            uuid primary key default gen_random_uuid(),
  rol_id        uuid not null references ece.rol(id),
  recurso       text not null,    -- p.ej. 'historia_clinica', 'epicrisis_egreso'
  permiso       text not null check (permiso in ('lectura','escritura','firma','autoriza','certifica')),
  unique (rol_id, recurso, permiso)
);
comment on table ece.perfil_acceso is
  'Mecanismos para evitar que un usuario acceda a recursos con derechos distintos a los autorizados (Art. 52).';
