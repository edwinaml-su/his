-- =====================================================================
-- 06_documentos_clinicos.sql
-- Tablas de datos de cada formulario del ECE (Fase 3).
-- Convención común:
--   * Toda tabla referencia un episodio.
--   * Trazabilidad: registrado_por, registrado_en, estado_registro.
--   * Tablas 'historico'/inmutables: solo INSERT; correcciones vía rectificación.
--   * Subestructuras muy variables -> jsonb; conjunto mínimo NTEC -> columnas.
-- =====================================================================

-- ---------- 3.2 Historia Clínica (TRANSACCIONAL / histórico) ----------
create table ece.historia_clinica (
  id                uuid primary key default gen_random_uuid(),
  episodio_id       uuid not null references ece.episodio_atencion(id),
  tipo_consulta     text not null check (tipo_consulta in ('primera_vez','subsecuente')),
  motivo_consulta   text,
  enfermedad_actual text,
  antecedentes      jsonb,        -- {personales,familiares,gineco_obstetricos,alergias,habitos}
  examen_fisico     jsonb,        -- hallazgos por sistema
  diagnosticos      jsonb,        -- [{cie10, tipo:presuntivo|definitivo}]
  plan_manejo       text,
  disposicion       text check (disposicion in
                      ('alta_ambulatoria','referencia','observacion','orden_ingreso')),
  registrado_por    uuid not null references ece.personal_salud(id),
  registrado_en     timestamptz not null default now(),
  estado_registro   text not null default 'vigente'
                      check (estado_registro in ('vigente','rectificado'))
);
create index idx_hc_episodio on ece.historia_clinica(episodio_id);

-- ---------- 3.3 Signos Vitales (TRANSACCIONAL, serie temporal) -------
create table ece.signos_vitales (
  id                uuid primary key default gen_random_uuid(),
  episodio_id       uuid not null references ece.episodio_atencion(id),
  fecha_hora_toma   timestamptz not null default now(),
  presion_sistolica int, presion_diastolica int,
  frecuencia_cardiaca int, frecuencia_respiratoria int,
  temperatura       numeric(4,1),
  saturacion_o2     int,
  peso              numeric(6,2), talla numeric(5,2),
  imc               numeric(5,2),
  perimetro_cefalico numeric(5,2),
  escala_dolor      int check (escala_dolor between 0 and 10),
  registrado_por    uuid not null references ece.personal_salud(id),
  registrado_en     timestamptz not null default now(),
  estado_registro   text not null default 'vigente'
);
create index idx_sv_episodio on ece.signos_vitales(episodio_id, fecha_hora_toma);

-- ---------- 3.4 Triaje / Clasificación (TRANSACCIONAL) --------------
create table ece.triaje (
  id                  uuid primary key default gen_random_uuid(),
  episodio_id         uuid not null references ece.episodio_atencion(id),
  fecha_hora_clasificacion timestamptz not null default now(),
  motivo              text,
  nivel_prioridad     text not null,        -- catálogo según protocolo institucional
  destino_asignado    text,
  signos_vitales_id   uuid references ece.signos_vitales(id),
  registrado_por      uuid not null references ece.personal_salud(id),
  registrado_en       timestamptz not null default now(),
  estado_registro     text not null default 'vigente'
);

-- ---------- 3.5 Atención de Emergencia (TRANSACCIONAL) -------------
create table ece.atencion_emergencia (
  id                uuid primary key default gen_random_uuid(),
  episodio_id       uuid not null references ece.episodio_atencion(id),
  circunstancia_llegada text,
  motivo            text,
  examen            text,
  diagnosticos      jsonb,
  manejo            text,
  disposicion       text check (disposicion in
                      ('alta_ambulatoria','observacion','orden_ingreso','referencia')),
  registrado_por    uuid not null references ece.personal_salud(id),
  registrado_en     timestamptz not null default now(),
  estado_registro   text not null default 'vigente'
);

-- ---------- 3.6 Indicaciones Médicas (TRANSACCIONAL, versionado) ----
create table ece.indicaciones_medicas (
  id                uuid primary key default gen_random_uuid(),
  episodio_id       uuid not null references ece.episodio_atencion(id),
  fecha_hora        timestamptz not null default now(),
  vigencia          text not null default 'activa'
                      check (vigencia in ('activa','suspendida','modificada')),
  version           int not null default 1,
  medico_prescriptor uuid not null references ece.personal_salud(id),
  transcripcion_enf uuid references ece.personal_salud(id),
  registrado_en     timestamptz not null default now(),
  estado_registro   text not null default 'vigente'
);
create table ece.indicacion_item (
  id              uuid primary key default gen_random_uuid(),
  indicacion_id   uuid not null references ece.indicaciones_medicas(id),
  tipo            text not null check (tipo in
                    ('medicamento','dieta','cuidado','estudio','reposo')),
  descripcion     text not null,
  dosis text, via text, frecuencia text, duracion text
);

-- ---------- 3.7 Registro de Enfermería + Kardex (TRANSACCIONAL) -----
create table ece.registro_enfermeria (
  id              uuid primary key default gen_random_uuid(),
  episodio_id     uuid not null references ece.episodio_atencion(id),
  turno           text not null check (turno in ('matutino','vespertino','nocturno')),
  nota_evolucion  text,
  plan_cuidados   text,
  registrado_por  uuid not null references ece.personal_salud(id),
  registrado_en   timestamptz not null default now(),
  estado_registro text not null default 'vigente'
);
create table ece.administracion_medicamento (
  id              uuid primary key default gen_random_uuid(),
  registro_enf_id uuid not null references ece.registro_enfermeria(id),
  indicacion_item_id uuid not null references ece.indicacion_item(id),
  hora_programada timestamptz,
  hora_aplicada   timestamptz,
  estado          text not null check (estado in ('administrado','omitido','diferido')),
  responsable     uuid not null references ece.personal_salud(id)
);

-- ---------- 3.8 Evolución Médica (TRANSACCIONAL / histórico) --------
create table ece.evolucion_medica (
  id              uuid primary key default gen_random_uuid(),
  episodio_id     uuid not null references ece.episodio_atencion(id),
  fecha_hora      timestamptz not null default now(),
  subjetivo text, objetivo text, analisis text, plan text,  -- SOAP
  diagnostico_cie10 jsonb,
  registrado_por  uuid not null references ece.personal_salud(id),
  registrado_en   timestamptz not null default now(),
  estado_registro text not null default 'vigente'
);
create index idx_evol_episodio on ece.evolucion_medica(episodio_id, fecha_hora);

-- ---------- 3.9 Consentimiento Informado (HISTÓRICO, inmutable) -----
create table ece.consentimiento_informado (
  id                uuid primary key default gen_random_uuid(),
  paciente_id       uuid not null references ece.paciente(id),
  episodio_id       uuid references ece.episodio_atencion(id),
  tipo              text not null check (tipo in
                      ('hospitalizacion','quirurgico','anestesico','procedimiento','transfusion','otro')),
  procedimiento_descrito text not null,
  riesgos_explicados text,
  alternativas      text,
  medico_que_informa uuid not null references ece.personal_salud(id),
  firmante_rol      text not null check (firmante_rol in ('paciente','representante_legal')),
  firmante_nombre   text not null,
  firmante_documento text not null,
  evidencia_firma   text,                 -- referencia a firma/huella resguardada
  fecha_hora        timestamptz not null default now()
);
comment on table ece.consentimiento_informado is
  'HISTÓRICO. Inmutable tras la firma; no admite rectificación de contenido.';

-- ---------- 3.10 Referencia, Retorno e Interconsulta (RRI) ---------
create table ece.referencia_rri (
  id                  uuid primary key default gen_random_uuid(),
  paciente_id         uuid not null references ece.paciente(id),
  episodio_id         uuid references ece.episodio_atencion(id),
  tipo                text not null check (tipo in
                        ('referencia','retorno','interconsulta','teleinterconsulta')),
  establecimiento_origen uuid references ece.establecimiento(id),
  establecimiento_destino uuid references ece.establecimiento(id),
  especialidad_solicitada text,
  resumen_clinico     text,
  motivo              text,
  respuesta_interconsultante text,
  solicitado_por      uuid not null references ece.personal_salud(id),
  respondido_por      uuid references ece.personal_salud(id),
  registrado_en       timestamptz not null default now(),
  estado_registro     text not null default 'vigente'
);

-- ---------- 3.11 Orden de Ingreso Hospitalario (TRANSACCIONAL) ------
create table ece.orden_ingreso (
  id                  uuid primary key default gen_random_uuid(),
  paciente_id         uuid not null references ece.paciente(id),
  episodio_origen_id  uuid references ece.episodio_atencion(id),
  circunstancia_ingreso text not null,
  fecha_hora_orden    timestamptz not null default now(),
  motivo_ingreso      text not null,
  servicio_ingreso_id uuid references ece.servicio(id),
  procedencia         text not null,
  modalidad           text not null check (modalidad in ('hospitalizacion','hospital_de_dia')),
  medico_ordena       uuid not null references ece.personal_salud(id),
  registrado_en       timestamptz not null default now(),
  estado_registro     text not null default 'vigente'
);

-- ---------- 3.12 Hoja de Ingreso / Apertura de Episodio ------------
create table ece.hoja_ingreso (
  id              uuid primary key default gen_random_uuid(),
  episodio_id     uuid not null unique references ece.episodio_atencion(id),
  orden_ingreso_id uuid not null references ece.orden_ingreso(id),
  servicio_id     uuid references ece.servicio(id),
  cama_id         uuid references ece.cama(id),
  fecha_hora_ingreso timestamptz not null default now(),
  responsable_admision uuid not null references ece.personal_salud(id),
  registrado_en   timestamptz not null default now(),
  estado_registro text not null default 'vigente'
);

-- ---------- 3.13 Acto Quirúrgico (HISTÓRICO) -----------------------
create table ece.acto_quirurgico (
  id                  uuid primary key default gen_random_uuid(),
  episodio_id         uuid not null references ece.episodio_atencion(id),
  valoracion_preop    jsonb,
  checklist_cirugia_segura jsonb,    -- fases entrada/pausa/salida
  diagnostico_pre     text,
  diagnostico_post    text,
  procedimiento_realizado text,
  hallazgos           text,
  cirujano            uuid not null references ece.personal_salud(id),
  ayudantes           jsonb,
  anestesiologo       uuid references ece.personal_salud(id),
  registro_anestesico jsonb,         -- tipo, fármacos, monitoreo transanestésico
  hora_inicio         timestamptz,
  hora_fin            timestamptz,
  recuperacion_urpa   jsonb,         -- monitoreo postanestésico, criterios de egreso
  registrado_en       timestamptz not null default now(),
  estado_registro     text not null default 'vigente'
);

-- ---------- 3.14 Documentos Obstétricos (TRANSACCIONAL/histórico) --
create table ece.documento_obstetrico (
  id              uuid primary key default gen_random_uuid(),
  episodio_id     uuid not null references ece.episodio_atencion(id),
  partograma      jsonb,             -- series temporales dilatación/descenso/FCF
  labor_parto     jsonb,
  sala_expulsion  jsonb,
  atencion_rn     jsonb,             -- genera CUN/NUI del recién nacido
  recien_nacido_paciente_id uuid references ece.paciente(id),
  registrado_por  uuid not null references ece.personal_salud(id),
  registrado_en   timestamptz not null default now(),
  estado_registro text not null default 'vigente'
);

-- ---------- 3.15 Epicrisis / Hoja de Egreso (HISTÓRICO) ------------
create table ece.epicrisis_egreso (
  id                  uuid primary key default gen_random_uuid(),
  episodio_id         uuid not null unique references ece.episodio_atencion(id),
  fecha_hora_egreso   timestamptz not null,
  tipo_egreso         text not null check (tipo_egreso in ('vivo','fallecido')),
  circunstancia_alta  text not null,
  diagnosticos_egreso jsonb not null,   -- [{cie10}]
  resumen_evolucion   text,
  procedimientos_realizados jsonb,
  resultados_complementarios text,
  manejo_terapeutico  text,
  indicaciones_alta   text,
  citas_seguimiento   jsonb,
  medico_tratante     uuid not null references ece.personal_salud(id),
  visto_jefe_servicio uuid references ece.personal_salud(id),
  registrado_en       timestamptz not null default now(),
  estado_registro     text not null default 'vigente'
);

-- ---------- 3.16 Certificado de Defunción (HISTÓRICO) --------------
create table ece.certificado_defuncion (
  id                  uuid primary key default gen_random_uuid(),
  episodio_id         uuid not null references ece.episodio_atencion(id),
  epicrisis_id        uuid not null references ece.epicrisis_egreso(id),
  fecha_hora_defuncion timestamptz not null,
  causa_basica_cie10  text not null,
  causas_intermedias  jsonb,
  clasificacion       text not null check (clasificacion in
                        ('natural','violencia','accidente_transito','en_investigacion')),
  medico_certificante uuid not null references ece.personal_salud(id),
  registrado_en       timestamptz not null default now()
);

-- ---------- 3.17 Certificado de Incapacidad ISSS (TRANSACCIONAL) ---
create table ece.certificado_incapacidad (
  id                uuid primary key default gen_random_uuid(),
  paciente_id       uuid not null references ece.paciente(id),
  episodio_id       uuid references ece.episodio_atencion(id),
  numero_afiliado   text not null,
  numero_patronal   text,
  diagnostico_cie10 text not null,
  dias_incapacidad  int not null check (dias_incapacidad > 0),
  fecha_inicio      date not null,
  fecha_fin         date not null,
  medico_autorizado uuid not null references ece.personal_salud(id),
  registrado_en     timestamptz not null default now(),
  estado_registro   text not null default 'vigente'
);

-- ---------- 3.18 Solicitud / Resultado de Estudios -----------------
create table ece.solicitud_estudio (
  id              uuid primary key default gen_random_uuid(),
  episodio_id     uuid not null references ece.episodio_atencion(id),
  tipo            text not null check (tipo in ('laboratorio','imagenologia','gabinete')),
  examenes        jsonb not null,    -- lista de exámenes solicitados
  medico_solicitante uuid not null references ece.personal_salud(id),
  fecha_hora      timestamptz not null default now(),
  estado          text not null default 'solicitado'
                    check (estado in ('solicitado','en_proceso','resultado_listo','anulado'))
);
create table ece.resultado_estudio (
  id              uuid primary key default gen_random_uuid(),
  solicitud_id    uuid not null references ece.solicitud_estudio(id),
  valores         jsonb not null,    -- [{analito, valor, unidad, rango_referencia}]
  responsable_validacion uuid not null references ece.personal_salud(id),
  fecha_hora_informe timestamptz not null default now(),
  estado_registro text not null default 'vigente'
);
