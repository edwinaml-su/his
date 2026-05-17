-- =====================================================================
-- 03_paciente_maestro.sql
-- Paciente (Ficha de Identificación, Art. 15 NTEC) — registro MAESTRO,
-- raíz del expediente médico único por usuario (Ley SNIS, arts. 24-26).
-- =====================================================================

create table ece.paciente (
  id                  uuid primary key default gen_random_uuid(),
  establecimiento_id  uuid not null references ece.establecimiento(id),
  -- Número de expediente único por establecimiento (Art. 11, 12 NTEC)
  numero_expediente   text not null,
  -- Identificadores nacionales
  nui                 text,                         -- Número Único de Identidad
  cun                 text,                         -- Código Único de Nacimiento
  dui                 text,
  carnet_minoridad    text,
  pasaporte           text,
  documento_no_presentado boolean not null default false,
  origen_identidad    text not null default 'verificado'
                        check (origen_identidad in
                          ('verificado','version_paciente','version_responsable','desconocido')),
  -- Datos demográficos
  primer_nombre       text,
  segundo_nombre      text,
  primer_apellido     text,
  segundo_apellido    text,
  fecha_nacimiento    date,
  sexo                text check (sexo in ('M','F','I')),
  estado_familiar     text,
  nacionalidad        text,
  direccion           text,
  telefono            text,
  ocupacion           text,
  observaciones       text,
  -- Estado del expediente (Art. 4.15/4.16, 34 NTEC)
  estado_expediente   text not null default 'activo'
                        check (estado_expediente in ('activo','pasivo')),
  fallecido           boolean not null default false,
  -- Trazabilidad
  responsable_toma_datos uuid references ece.personal_salud(id),
  creado_en           timestamptz not null default now(),
  estado_registro     text not null default 'vigente'
                        check (estado_registro in ('vigente','rectificado','unificado')),
  expediente_maestro_id uuid references ece.paciente(id), -- apunta al sobreviviente si se unificó
  constraint uq_num_expediente unique (establecimiento_id, numero_expediente)
);
comment on table ece.paciente is
  'Ficha de Identificación (Art. 15). Tipo de registro: MAESTRO. Prohibido duplicar; unificar si ocurre (Art. 14 lit. g).';

-- Búsqueda y deduplicación
create index idx_paciente_nui   on ece.paciente(nui);
create index idx_paciente_dui   on ece.paciente(dui);
create index idx_paciente_nom   on ece.paciente using gin (primer_apellido gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Identificadores adicionales / históricos del paciente
-- ---------------------------------------------------------------------
create table ece.identificador_paciente (
  id          uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references ece.paciente(id),
  tipo        text not null check (tipo in ('nui','cun','dui','carnet_minoridad','pasaporte','otro')),
  valor       text not null,
  vigente     boolean not null default true,
  registrado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Responsable / familiar (Art. 15 lit. c)
-- ---------------------------------------------------------------------
create table ece.responsable_paciente (
  id          uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references ece.paciente(id),
  nombre      text not null,
  parentesco  text,
  documento   text,
  telefono    text,
  vigente     boolean not null default true
);

-- ---------------------------------------------------------------------
-- Afiliación ISSS (derechohabiencia)
-- ---------------------------------------------------------------------
create table ece.afiliacion_isss (
  id                uuid primary key default gen_random_uuid(),
  paciente_id       uuid not null unique references ece.paciente(id),
  numero_afiliado   text not null,
  tipo_derechohabiente text not null
                      check (tipo_derechohabiente in ('cotizante','beneficiario','pensionado')),
  numero_patronal   text,
  vigente           boolean not null default true,
  verificado_en     timestamptz
);
comment on table ece.afiliacion_isss is 'Verificación de derechohabiencia para procesos ISSS.';
