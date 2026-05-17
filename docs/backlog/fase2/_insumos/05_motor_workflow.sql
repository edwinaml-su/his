-- =====================================================================
-- 05_motor_workflow.sql
-- MOTOR DE WORKFLOW DATA-DRIVEN.
-- El flujo de cada documento (estados, transiciones, roles que llenan /
-- son responsables / autorizan / firman) se define como DATOS, no como
-- esquema. Cambiar un workflow = modificar filas, no migrar tablas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipo de documento (catálogo del expediente)
-- ---------------------------------------------------------------------
create table ece.tipo_documento (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique,
  nombre        text not null,
  -- nombre de la tabla física en esquema ece que guarda los datos del formulario
  tabla_datos   text not null,
  tipo_registro text not null check (tipo_registro in ('maestro','transaccional','historico')),
  modalidad     text not null check (modalidad in ('ambulatorio','hospitalario','ambos')),
  -- documento(s) prerequisito (grafo de dependencias, Fase 3 sección 4)
  depende_de    text[],
  inmutable     boolean not null default false,  -- true = no admite UPDATE (solo rectificación)
  activo        boolean not null default true
);
comment on table ece.tipo_documento is
  'Define cada documento del ECE para su digitalización: tipo de registro, modalidad y dependencias.';

-- ---------------------------------------------------------------------
-- Estados del flujo (por tipo de documento)
-- ---------------------------------------------------------------------
create table ece.flujo_estado (
  id                uuid primary key default gen_random_uuid(),
  tipo_documento_id uuid not null references ece.tipo_documento(id),
  codigo            text not null,    -- borrador, en_revision, firmado, validado, certificado, anulado
  nombre            text not null,
  es_inicial        boolean not null default false,
  es_final          boolean not null default false,
  orden             int not null default 0,
  unique (tipo_documento_id, codigo)
);

-- ---------------------------------------------------------------------
-- Transiciones permitidas + rol que AUTORIZA la transición
-- ---------------------------------------------------------------------
create table ece.flujo_transicion (
  id                uuid primary key default gen_random_uuid(),
  tipo_documento_id uuid not null references ece.tipo_documento(id),
  estado_origen_id  uuid not null references ece.flujo_estado(id),
  estado_destino_id uuid not null references ece.flujo_estado(id),
  accion            text not null,                 -- 'enviar_revision', 'firmar', 'validar', 'certificar'
  rol_autoriza_id   uuid not null references ece.rol(id),
  requiere_firma    boolean not null default true, -- exige firma electrónica simple
  unique (tipo_documento_id, estado_origen_id, accion)
);
comment on table ece.flujo_transicion is
  'Quién puede mover el documento al siguiente estado (autorizador) y si requiere firma.';

-- ---------------------------------------------------------------------
-- Roles funcionales por documento: LLENA / RESPONSABLE / AUTORIZA / FIRMA
-- (las cuatro dimensiones solicitadas)
-- ---------------------------------------------------------------------
create table ece.documento_rol (
  id                uuid primary key default gen_random_uuid(),
  tipo_documento_id uuid not null references ece.tipo_documento(id),
  rol_id            uuid not null references ece.rol(id),
  funcion           text not null check (funcion in ('LLENA','RESPONSABLE','AUTORIZA','FIRMA')),
  obligatorio       boolean not null default true,
  unique (tipo_documento_id, rol_id, funcion)
);
comment on table ece.documento_rol is
  'Matriz de la Fase 2: por documento, qué rol lo llena, es responsable, autoriza o firma.';

-- ---------------------------------------------------------------------
-- Instancia de documento (un documento concreto dentro de un episodio)
-- ---------------------------------------------------------------------
create table ece.documento_instancia (
  id                uuid primary key default gen_random_uuid(),
  tipo_documento_id uuid not null references ece.tipo_documento(id),
  episodio_id       uuid references ece.episodio_atencion(id),
  paciente_id       uuid not null references ece.paciente(id),
  -- id de la fila en la tabla física de datos clínicos (ece.<tabla_datos>)
  registro_id       uuid,
  estado_actual_id  uuid not null references ece.flujo_estado(id),
  version           int not null default 1,
  estado_registro   text not null default 'vigente'
                      check (estado_registro in ('vigente','rectificado','suprimido')),
  creado_por        uuid not null references ece.personal_salud(id),
  creado_en         timestamptz not null default now()
);
comment on table ece.documento_instancia is
  'Documento real del expediente. Une el tipo, el episodio y la fila de datos clínicos.';

create index idx_docinst_episodio on ece.documento_instancia(episodio_id);
create index idx_docinst_paciente on ece.documento_instancia(paciente_id);
create index idx_docinst_tipo     on ece.documento_instancia(tipo_documento_id);

-- ---------------------------------------------------------------------
-- Historial de transiciones (quién, cuándo, con qué firma) — Art. 42, 55
-- Inmutable: solo INSERT.
-- ---------------------------------------------------------------------
create table ece.documento_instancia_historial (
  id                uuid primary key default gen_random_uuid(),
  instancia_id      uuid not null references ece.documento_instancia(id),
  estado_anterior_id uuid references ece.flujo_estado(id),
  estado_nuevo_id   uuid not null references ece.flujo_estado(id),
  accion            text not null,
  ejecutado_por     uuid not null references ece.personal_salud(id),
  rol_ejecutor_id   uuid not null references ece.rol(id),
  firma_id          uuid references ece.firma_electronica(id),
  observacion       text,
  -- marca temporal completa a nivel segundo (Art. 55 NTEC)
  ejecutado_en      timestamptz not null default clock_timestamp()
);
comment on table ece.documento_instancia_historial is
  'Bitácora de workflow. Solo INSERT. Marca temporal a nivel segundo (Art. 55).';

create index idx_dih_instancia on ece.documento_instancia_historial(instancia_id);
