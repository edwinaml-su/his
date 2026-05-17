-- =====================================================================
-- 01_catalogos.sql
-- Catálogos / tablas maestras de referencia.
-- Los catálogos son configurables por institución (Art. 6 y 11 NTEC).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Institución (MINSAL, ISSS, ISRI, ISBM, privado, etc.)
-- ---------------------------------------------------------------------
create table ece.institucion (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique,
  nombre        text not null,
  tipo          text not null check (tipo in ('publica','privada','autonoma','mixta')),
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);
comment on table ece.institucion is 'Instituciones integrantes del SNIS.';

-- ---------------------------------------------------------------------
-- Establecimiento de salud
-- ---------------------------------------------------------------------
create table ece.establecimiento (
  id              uuid primary key default gen_random_uuid(),
  institucion_id  uuid not null references ece.institucion(id),
  codigo          text not null unique,
  nombre          text not null,
  nivel_atencion  text not null check (nivel_atencion in ('primer','segundo','tercer')),
  -- Estructura del número de expediente: definida por cada establecimiento (Art. 11 NTEC)
  patron_num_expediente text,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);
comment on table ece.establecimiento is 'Establecimiento prestador de servicios de salud.';

-- ---------------------------------------------------------------------
-- Servicio (Medicina, Cirugía, Pediatría, Gineco-Obstetricia, UCI...)
-- ---------------------------------------------------------------------
create table ece.servicio (
  id                  uuid primary key default gen_random_uuid(),
  establecimiento_id  uuid not null references ece.establecimiento(id),
  codigo              text not null,
  nombre              text not null,
  categoria           text not null check (categoria in
                        ('consulta_externa','emergencia','observacion','hospitalizacion',
                         'quirofano','recuperacion','uci','labor_parto','apoyo_diagnostico')),
  activo              boolean not null default true,
  unique (establecimiento_id, codigo)
);

-- ---------------------------------------------------------------------
-- Cama
-- ---------------------------------------------------------------------
create table ece.cama (
  id                  uuid primary key default gen_random_uuid(),
  servicio_id         uuid not null references ece.servicio(id),
  codigo              text not null,
  estado              text not null default 'disponible'
                        check (estado in ('disponible','ocupada','bloqueada','mantenimiento')),
  unique (servicio_id, codigo)
);

-- ---------------------------------------------------------------------
-- Catálogo de roles funcionales (Fase 2)
-- ---------------------------------------------------------------------
create table ece.rol (
  id        uuid primary key default gen_random_uuid(),
  codigo    text not null unique,
  nombre    text not null,
  descripcion text
);
comment on table ece.rol is
  'Roles funcionales: ADM, AC, ARCH, ENF, MT, MC, ESP, IC, DIR.';

insert into ece.rol (codigo, nombre, descripcion) values
  ('ADM',  'Administrativo',          'Personal administrativo / admisión'),
  ('AC',   'Atención al Cliente',     'Ventanilla, afiliación ISSS'),
  ('ARCH', 'Archivo / ESDOMED',       'Estadística y Documentos Médicos'),
  ('ENF',  'Enfermería',              'Personal de enfermería'),
  ('MT',   'Médico de Turno',         'Médico de turno (emergencia/observación)'),
  ('MC',   'Médico de Cabecera',      'Médico tratante'),
  ('ESP',  'Especialista',            'Médico especialista'),
  ('IC',   'Interconsultante',        'Especialista que responde interconsulta'),
  ('DIR',  'Dirección',               'Dirección del establecimiento o su delegado');

-- ---------------------------------------------------------------------
-- Catálogos clínico-administrativos (enum-as-table, configurables)
-- ---------------------------------------------------------------------
create table ece.catalogo_valor (
  id        uuid primary key default gen_random_uuid(),
  dominio   text not null,   -- p.ej. 'circunstancia_ingreso', 'tipo_egreso'
  codigo    text not null,
  etiqueta  text not null,
  activo    boolean not null default true,
  unique (dominio, codigo)
);

insert into ece.catalogo_valor (dominio, codigo, etiqueta) values
  ('circunstancia_ingreso','demanda_espontanea','Demanda espontánea'),
  ('circunstancia_ingreso','programado','Programado'),
  ('circunstancia_ingreso','riesgo_social','Riesgo social'),
  ('circunstancia_ingreso','traslado','Traslado de otro hospital'),
  ('procedencia_ingreso','emergencia','Emergencia'),
  ('procedencia_ingreso','consulta_externa','Consulta externa'),
  ('procedencia_ingreso','traslado_servicio','Traslado de otro servicio'),
  ('modalidad_atencion','presencial','Presencial'),
  ('modalidad_atencion','telesalud','Telesalud'),
  ('modalidad_hospitalaria','hospitalizacion','Hospitalización'),
  ('modalidad_hospitalaria','hospital_de_dia','Hospital de día'),
  ('tipo_egreso','vivo','Vivo'),
  ('tipo_egreso','fallecido','Fallecido'),
  ('circunstancia_alta','alta_hospitalaria','Alta hospitalaria'),
  ('circunstancia_alta','referido_otro_hospital','Referido a otro hospital'),
  ('circunstancia_alta','alta_voluntaria','Alta voluntaria'),
  ('circunstancia_alta','fuga','Fuga'),
  ('circunstancia_alta','in_extremis','In extremis'),
  ('circunstancia_alta','alta_rehabilitada','Alta rehabilitada (ISRI)'),
  ('tipo_consulta','primera_vez','Primera vez'),
  ('tipo_consulta','subsecuente','Subsecuente'),
  ('tipo_atencion','preventiva','Preventiva'),
  ('tipo_atencion','curativa','Curativa'),
  ('tipo_atencion','cuidados_paliativos','Cuidados paliativos'),
  ('tipo_atencion','rehabilitacion','Rehabilitación');
