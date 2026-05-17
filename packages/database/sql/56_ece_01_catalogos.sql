-- =====================================================================
-- 56_ece_01_catalogos.sql
-- Catálogos / tablas maestras del schema ECE (Expediente Clínico
-- Electrónico) — alineadas con NTEC Acuerdo 1616 del MINSAL.
--
-- Estrategia de integración: Opción B (docs/backlog/fase2/10_dba_schema_integracion.md)
-- • public.Organization y public.Establishment son los golden records HIS.
-- • ece.institucion y ece.establecimiento actúan como vista normativa NTEC
--   y añaden columnas FK NULLABLE que apuntan al grafo operacional HIS,
--   evitando duplicación de datos (Art. 14 NTEC — expediente único).
-- • NO se crean aquí ece.paciente ni ece.episodio_atencion; esas entidades
--   usan public.Patient / public.Encounter como fuente de verdad.
--
-- Idempotente: usa CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING.
-- Aplicar vía mcp__supabase__apply_migration o Supabase SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------
create schema if not exists ece;

-- ---------------------------------------------------------------------
-- Institución (Art. 6 NTEC — integrantes del SNIS)
-- Representa entes institucionales: MINSAL, ISSS, ISRI, ISBM, privado.
-- FK opcional a public.Organization para establecimientos ya registrados
-- en el HIS multi-tenant; nullable porque algunas instituciones NTEC no
-- tienen organización HIS correspondiente (p. ej. solo reportan).
-- ---------------------------------------------------------------------
create table if not exists ece.institucion (
  id              uuid        primary key default gen_random_uuid(),
  codigo          text        not null unique,
  nombre          text        not null,
  tipo            text        not null
                    check (tipo in ('publica', 'privada', 'autonoma', 'mixta')),
  activo          boolean     not null default true,
  creado_en       timestamptz not null default now(),
  -- Opción B: FK nullable al golden record HIS
  organization_id uuid        references public."Organization"(id) on delete set null
);

comment on table  ece.institucion is
  'Instituciones integrantes del SNIS (Art. 6 NTEC Acuerdo 1616). '
  'Actúa como catálogo normativo; organization_id enlaza opcionalmente '
  'al golden record public.Organization del HIS (Opción B).';

comment on column ece.institucion.organization_id is
  'FK nullable a public.Organization. Permite correlacionar la institución '
  'NTEC con el tenant HIS sin duplicar datos. NULL indica institución NTEC '
  'que no tiene organización operativa en el HIS.';

-- Índice para join frecuente HIS → NTEC
create index if not exists idx_ece_institucion_organization_id
  on ece.institucion (organization_id)
  where organization_id is not null;

-- ---------------------------------------------------------------------
-- Establecimiento de salud (Art. 11 NTEC — numeración de expedientes)
-- Sede física con código MINSAL. Cada establecimiento define su propio
-- patrón de numeración de expediente (Art. 11 NTEC).
-- FK opcional a public.Establishment para establecimientos ya operativos
-- en el HIS; nullable por la misma razón que ece.institucion.
-- ---------------------------------------------------------------------
create table if not exists ece.establecimiento (
  id                      uuid        primary key default gen_random_uuid(),
  institucion_id          uuid        not null references ece.institucion(id),
  codigo                  text        not null unique,
  nombre                  text        not null,
  nivel_atencion          text        not null
                            check (nivel_atencion in ('primer', 'segundo', 'tercer')),
  -- Art. 11 NTEC: estructura del número de expediente definida por
  -- cada establecimiento (p. ej. 'AAAA-NNNNN', 'HH-AAAA-NNNNNN').
  patron_num_expediente   text,
  activo                  boolean     not null default true,
  creado_en               timestamptz not null default now(),
  -- Opción B: FK nullable al golden record HIS
  establishment_id        uuid        references public."Establishment"(id) on delete set null
);

comment on table  ece.establecimiento is
  'Establecimiento prestador de servicios de salud (Art. 11 NTEC Acuerdo 1616). '
  'establishment_id enlaza opcionalmente al golden record public.Establishment del HIS.';

comment on column ece.establecimiento.patron_num_expediente is
  'Patrón de formato del número de expediente definido por el establecimiento '
  'según Art. 11 NTEC. Ejemplo: ''HGR-{YYYY}-{NNNNN}''. NULL = sin patrón definido.';

comment on column ece.establecimiento.establishment_id is
  'FK nullable a public.Establishment. Permite correlacionar la sede NTEC '
  'con el registro operativo HIS sin duplicar datos (Opción B).';

-- Índice para join frecuente HIS → NTEC
create index if not exists idx_ece_establecimiento_establishment_id
  on ece.establecimiento (establishment_id)
  where establishment_id is not null;

-- ---------------------------------------------------------------------
-- Servicio (Medicina, Cirugía, Pediatría, Gineco-Obstetricia, UCI…)
-- Unidad funcional dentro de un establecimiento. Las categorías cubren
-- los servicios habilitados por MINSAL (Art. 6 NTEC).
-- ---------------------------------------------------------------------
create table if not exists ece.servicio (
  id                  uuid    primary key default gen_random_uuid(),
  establecimiento_id  uuid    not null references ece.establecimiento(id),
  codigo              text    not null,
  nombre              text    not null,
  categoria           text    not null
                        check (categoria in (
                          'consulta_externa', 'emergencia', 'observacion',
                          'hospitalizacion', 'quirofano', 'recuperacion',
                          'uci', 'labor_parto', 'apoyo_diagnostico'
                        )),
  activo              boolean not null default true,
  unique (establecimiento_id, codigo)
);

comment on table ece.servicio is
  'Unidad funcional del establecimiento (Art. 6 NTEC Acuerdo 1616). '
  'El par (establecimiento_id, codigo) es el identificador operativo.';

-- ---------------------------------------------------------------------
-- Cama
-- Recurso físico de hospitalización. Estado sigue el ciclo operativo
-- del establecimiento; las transiciones las gestiona el módulo de
-- asignación de camas.
-- ---------------------------------------------------------------------
create table if not exists ece.cama (
  id           uuid primary key default gen_random_uuid(),
  servicio_id  uuid not null references ece.servicio(id),
  codigo       text not null,
  estado       text not null default 'disponible'
                 check (estado in (
                   'disponible', 'ocupada', 'bloqueada', 'mantenimiento'
                 )),
  unique (servicio_id, codigo)
);

comment on table  ece.cama is
  'Recurso físico cama de hospitalización. Estado: disponible/ocupada/'
  'bloqueada/mantenimiento. Ciclo administrado por el módulo ECE de '
  'asignación de camas.';

comment on column ece.cama.estado is
  'Estado operativo de la cama. ''bloqueada'' = reservada para caso '
  'específico. ''mantenimiento'' = fuera de servicio temporal.';

-- ---------------------------------------------------------------------
-- Catálogo de roles funcionales ECE (NTEC — perfiles de usuario)
-- Roles clínicos definidos por la NTEC: ADM, AC, ARCH, ENF, MT, MC,
-- ESP, IC, DIR. Coexisten con public.Role (RBAC genérico del HIS);
-- este catálogo es específico de las matrices de responsabilidad del
-- expediente clínico (Tabla 1 NTEC Acuerdo 1616).
-- ---------------------------------------------------------------------
create table if not exists ece.rol (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,
  nombre      text not null,
  descripcion text
);

comment on table ece.rol is
  'Roles funcionales del ECE definidos en Tabla 1, NTEC Acuerdo 1616: '
  'ADM, AC, ARCH, ENF, MT, MC, ESP, IC, DIR. Coexisten con public.Role '
  '(RBAC genérico HIS); este catálogo rige las matrices LLENA/RESPONSABLE/'
  'AUTORIZA/FIRMA del motor de documentos.';

insert into ece.rol (codigo, nombre, descripcion) values
  ('ADM',  'Administrativo',      'Personal administrativo / admisión'),
  ('AC',   'Atención al Cliente', 'Ventanilla, afiliación ISSS'),
  ('ARCH', 'Archivo / ESDOMED',   'Estadística y Documentos Médicos'),
  ('ENF',  'Enfermería',          'Personal de enfermería'),
  ('MT',   'Médico de Turno',     'Médico de turno (emergencia / observación)'),
  ('MC',   'Médico de Cabecera',  'Médico tratante'),
  ('ESP',  'Especialista',        'Médico especialista'),
  ('IC',   'Interconsultante',    'Especialista que responde interconsulta'),
  ('DIR',  'Dirección',           'Dirección del establecimiento o su delegado')
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------
-- Catálogos clínico-administrativos (enum-as-table, configurables)
-- Enumeraciones que la NTEC define pero que cada institución puede
-- extender (Art. 6 NTEC). Se modelan como tabla para permitir
-- configuración sin migraciones de schema.
--
-- Dominios sembrables:
--   circunstancia_ingreso  — Art. 15 NTEC
--   procedencia_ingreso    — Art. 15 NTEC
--   modalidad_atencion     — Art. 3 NTEC (presencial/telesalud)
--   modalidad_hospitalaria — hospitalización / hospital de día
--   tipo_egreso            — Art. 21 NTEC
--   circunstancia_alta     — Art. 21 NTEC
--   tipo_consulta          — Art. 14 NTEC (primera vez / subsecuente)
--   tipo_atencion          — Art. 3 NTEC
-- ---------------------------------------------------------------------
create table if not exists ece.catalogo_valor (
  id       uuid    primary key default gen_random_uuid(),
  dominio  text    not null,   -- p. ej. 'circunstancia_ingreso', 'tipo_egreso'
  codigo   text    not null,
  etiqueta text    not null,
  activo   boolean not null default true,
  unique (dominio, codigo)
);

comment on table  ece.catalogo_valor is
  'Enumeraciones clínico-administrativas configurables por institución '
  '(Art. 6 NTEC Acuerdo 1616). Permite extender dominios sin migraciones.';

comment on column ece.catalogo_valor.dominio is
  'Nombre del dominio enumerable. Ejemplos: circunstancia_ingreso, '
  'tipo_egreso, circunstancia_alta, tipo_consulta.';

insert into ece.catalogo_valor (dominio, codigo, etiqueta) values
  -- Circunstancia de ingreso (Art. 15 NTEC)
  ('circunstancia_ingreso', 'demanda_espontanea', 'Demanda espontánea'),
  ('circunstancia_ingreso', 'programado',         'Programado'),
  ('circunstancia_ingreso', 'riesgo_social',       'Riesgo social'),
  ('circunstancia_ingreso', 'traslado',            'Traslado de otro hospital'),
  -- Procedencia de ingreso (Art. 15 NTEC)
  ('procedencia_ingreso',   'emergencia',          'Emergencia'),
  ('procedencia_ingreso',   'consulta_externa',    'Consulta externa'),
  ('procedencia_ingreso',   'traslado_servicio',   'Traslado de otro servicio'),
  -- Modalidad de atención (Art. 3 NTEC)
  ('modalidad_atencion',    'presencial',          'Presencial'),
  ('modalidad_atencion',    'telesalud',           'Telesalud'),
  -- Modalidad hospitalaria
  ('modalidad_hospitalaria', 'hospitalizacion',    'Hospitalización'),
  ('modalidad_hospitalaria', 'hospital_de_dia',    'Hospital de día'),
  -- Tipo de egreso (Art. 21 NTEC)
  ('tipo_egreso',            'vivo',               'Vivo'),
  ('tipo_egreso',            'fallecido',          'Fallecido'),
  -- Circunstancia de alta (Art. 21 NTEC)
  ('circunstancia_alta',     'alta_hospitalaria',      'Alta hospitalaria'),
  ('circunstancia_alta',     'referido_otro_hospital', 'Referido a otro hospital'),
  ('circunstancia_alta',     'alta_voluntaria',        'Alta voluntaria'),
  ('circunstancia_alta',     'fuga',                   'Fuga'),
  ('circunstancia_alta',     'in_extremis',            'In extremis'),
  ('circunstancia_alta',     'alta_rehabilitada',      'Alta rehabilitada (ISRI)'),
  -- Tipo de consulta (Art. 14 NTEC)
  ('tipo_consulta',          'primera_vez',        'Primera vez'),
  ('tipo_consulta',          'subsecuente',        'Subsecuente'),
  -- Tipo de atención (Art. 3 NTEC)
  ('tipo_atencion',          'preventiva',         'Preventiva'),
  ('tipo_atencion',          'curativa',           'Curativa'),
  ('tipo_atencion',          'cuidados_paliativos','Cuidados paliativos'),
  ('tipo_atencion',          'rehabilitacion',     'Rehabilitación')
on conflict (dominio, codigo) do nothing;
