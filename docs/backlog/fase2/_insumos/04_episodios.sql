-- =====================================================================
-- 04_episodios.sql
-- Episodio de atención. Agrupa todos los documentos clínicos de un
-- contacto asistencial (Art. 16, 17 NTEC).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Episodio de atención (ambulatorio u hospitalario)
-- ---------------------------------------------------------------------
create table ece.episodio_atencion (
  id                  uuid primary key default gen_random_uuid(),
  paciente_id         uuid not null references ece.paciente(id),
  establecimiento_id  uuid not null references ece.establecimiento(id),
  -- Clasificación (Art. 17)
  modalidad           text not null check (modalidad in ('ambulatorio','hospitalario')),
  servicio_categoria  text not null check (servicio_categoria in
                        ('consulta_externa','emergencia','hospitalizacion','hospital_de_dia')),
  servicio_id         uuid references ece.servicio(id),
  origen_consulta     text check (origen_consulta in ('espontanea','cita_previa','referencia')),
  modalidad_atencion  text check (modalidad_atencion in ('presencial','telesalud','extramural')),
  motivo              text,
  -- Ciclo de vida del episodio
  fecha_hora_inicio   timestamptz not null default now(),
  fecha_hora_cierre   timestamptz,
  estado              text not null default 'abierto'
                        check (estado in ('abierto','en_curso','cerrado','anulado')),
  -- Disposición ambulatoria (Art. 17 lit. a)
  disposicion         text check (disposicion in
                        ('alta_ambulatoria','referencia','observacion','orden_ingreso')),
  creado_por          uuid references ece.personal_salud(id),
  creado_en           timestamptz not null default now()
);
comment on table ece.episodio_atencion is
  'Contacto asistencial. Tipo de registro: TRANSACCIONAL. Raíz de los documentos del episodio.';

create index idx_episodio_paciente on ece.episodio_atencion(paciente_id);
create index idx_episodio_estado   on ece.episodio_atencion(estado) where estado <> 'cerrado';

-- ---------------------------------------------------------------------
-- Especialización hospitalaria del episodio
-- ---------------------------------------------------------------------
create table ece.episodio_hospitalario (
  episodio_id           uuid primary key references ece.episodio_atencion(id),
  circunstancia_ingreso text not null,        -- catalogo_valor:circunstancia_ingreso
  procedencia_ingreso   text not null,        -- catalogo_valor:procedencia_ingreso
  modalidad_hospitalaria text not null,       -- catalogo_valor:modalidad_hospitalaria
  fecha_hora_orden_ingreso timestamptz not null,
  fecha_hora_egreso     timestamptz,
  tipo_egreso           text,                 -- catalogo_valor:tipo_egreso
  circunstancia_alta    text,                 -- catalogo_valor:circunstancia_alta
  servicio_ingreso_id   uuid references ece.servicio(id)
);
comment on table ece.episodio_hospitalario is
  'Datos hospitalarios del episodio (Art. 17 lit. b).';

-- ---------------------------------------------------------------------
-- Asignación de cama (histórico de ocupación)
-- ---------------------------------------------------------------------
create table ece.asignacion_cama (
  id            uuid primary key default gen_random_uuid(),
  episodio_id   uuid not null references ece.episodio_hospitalario(episodio_id),
  cama_id       uuid not null references ece.cama(id),
  desde         timestamptz not null default now(),
  hasta         timestamptz,
  motivo_cambio text
);
create index idx_asigcama_episodio on ece.asignacion_cama(episodio_id);
