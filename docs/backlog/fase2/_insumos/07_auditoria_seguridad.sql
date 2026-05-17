-- =====================================================================
-- 07_auditoria_seguridad.sql
-- Bitácoras, rectificación/supresión, inmutabilidad y RLS.
-- Art. 33, 42, 43, 53, 54, 55, 56 NTEC.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Bitácora de acceso (Art. 55): TODO intento, autorizado o denegado.
-- ---------------------------------------------------------------------
create table ece.bitacora_acceso (
  id              bigserial primary key,
  auth_user_id    uuid,
  personal_id     uuid references ece.personal_salud(id),
  componente      text not null,        -- sistema/módulo accedido
  tipo_acceso     text not null,        -- lectura / escritura / login / export
  autorizado      boolean not null,
  recurso_id      uuid,                 -- documento_instancia / paciente afectado
  ip_origen       inet,
  -- marca temporal completa a nivel segundo (Art. 55 lit. a)
  ocurrido_en     timestamptz not null default clock_timestamp()
);
create index idx_bacc_personal on ece.bitacora_acceso(personal_id, ocurrido_en);
comment on table ece.bitacora_acceso is
  'Conservación mínima 2 años (Art. 56). Solo INSERT; nunca alterar ni desactivar (Art. 53).';

-- ---------------------------------------------------------------------
-- Bitácora de auditoría de cambios (Art. 42 lit. b)
-- ---------------------------------------------------------------------
create table ece.bitacora_auditoria (
  id              bigserial primary key,
  instancia_id    uuid references ece.documento_instancia(id),
  tabla           text not null,
  registro_id     uuid not null,
  operacion       text not null check (operacion in ('INSERT','RECTIFICA','SUPRIME')),
  datos_antes     jsonb,
  datos_despues   jsonb,
  ejecutado_por   uuid references ece.personal_salud(id),
  auth_user_id    uuid,
  ocurrido_en     timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------
-- Rectificación (Art. 42): corregir datos inexactos SIN borrar el original
-- ---------------------------------------------------------------------
create table ece.rectificacion (
  id              uuid primary key default gen_random_uuid(),
  instancia_id    uuid not null references ece.documento_instancia(id),
  tabla           text not null,
  registro_id     uuid not null,
  campo           text not null,
  valor_anterior  text,
  valor_nuevo     text,
  justificacion   text not null,
  solicitada_por  text,                 -- titular / representante / oficio
  ejecutada_por   uuid not null references ece.personal_salud(id),
  ejecutada_en    timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------
-- Supresión (Art. 43): inhabilitar datos inadecuados/excesivos, autorizada
-- ---------------------------------------------------------------------
create table ece.supresion (
  id              uuid primary key default gen_random_uuid(),
  instancia_id    uuid not null references ece.documento_instancia(id),
  motivo          text not null,
  autorizada_por  uuid not null references ece.personal_salud(id),  -- Dirección
  ejecutada_en    timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------
-- Trigger genérico de auditoría INSERT para documentos clínicos
-- ---------------------------------------------------------------------
create or replace function ece.fn_audita_insert()
returns trigger language plpgsql security definer as $$
begin
  insert into ece.bitacora_auditoria(tabla, registro_id, operacion, datos_despues, auth_user_id)
  values (tg_table_name, new.id, 'INSERT', to_jsonb(new), auth.uid());
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Trigger de inmutabilidad: bloquea UPDATE/DELETE en tablas históricas.
-- Las correcciones DEBEN pasar por ece.rectificacion (Art. 42).
-- ---------------------------------------------------------------------
create or replace function ece.fn_bloquea_mutacion()
returns trigger language plpgsql as $$
begin
  raise exception
    'Documento inmutable (Art. 42 NTEC). Use el flujo de rectificación, no UPDATE/DELETE.';
end $$;

-- Aplicar inmutabilidad a documentos históricos/legales
do $$
declare t text;
begin
  foreach t in array array[
    'consentimiento_informado','epicrisis_egreso','certificado_defuncion',
    'acto_quirurgico','documento_instancia_historial','bitacora_acceso',
    'bitacora_auditoria','rectificacion','supresion'
  ] loop
    execute format(
      'create trigger trg_inmutable_%1$s before update or delete on ece.%1$s
       for each row execute function ece.fn_bloquea_mutacion();', t);
  end loop;
end $$;

-- Auditoría de inserción en las principales tablas clínicas
do $$
declare t text;
begin
  foreach t in array array[
    'historia_clinica','signos_vitales','triaje','atencion_emergencia',
    'indicaciones_medicas','registro_enfermeria','evolucion_medica',
    'consentimiento_informado','referencia_rri','orden_ingreso','hoja_ingreso',
    'acto_quirurgico','documento_obstetrico','epicrisis_egreso',
    'certificado_defuncion','certificado_incapacidad'
  ] loop
    execute format(
      'create trigger trg_audita_%1$s after insert on ece.%1$s
       for each row execute function ece.fn_audita_insert();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security (RBAC, Art. 45/52). Andamiaje base.
-- Ajustar las policies a la estructura de auth/JWT del proyecto.
-- ---------------------------------------------------------------------
alter table ece.paciente              enable row level security;
alter table ece.episodio_atencion     enable row level security;
alter table ece.historia_clinica      enable row level security;
alter table ece.evolucion_medica      enable row level security;
alter table ece.documento_instancia   enable row level security;

-- Solo personal activo del establecimiento puede LEER expedientes de ese
-- establecimiento (confidencialidad, Art. 33). Ejemplo para 'paciente':
create policy p_paciente_lectura on ece.paciente
  for select using (
    exists (
      select 1 from ece.personal_salud ps
      where ps.auth_user_id = auth.uid()
        and ps.activo
        and ps.establecimiento_id = ece.paciente.establecimiento_id
    )
  );

-- Escritura: solo roles con permiso 'escritura' sobre el recurso.
create policy p_paciente_escritura on ece.paciente
  for insert with check (
    exists (
      select 1
      from ece.personal_salud ps
      join ece.asignacion_rol ar on ar.personal_id = ps.id and ar.vigente
      join ece.perfil_acceso  pa on pa.rol_id = ar.rol_id
      where ps.auth_user_id = auth.uid()
        and ps.activo
        and pa.recurso = 'paciente'
        and pa.permiso = 'escritura'
    )
  );

comment on policy p_paciente_lectura on ece.paciente is
  'Confidencialidad (Art. 33): acceso restringido a personal autorizado del establecimiento.';
