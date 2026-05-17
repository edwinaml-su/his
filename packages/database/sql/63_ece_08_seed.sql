-- =====================================================================
-- 63_ece_08_seed.sql
-- Siembra del MOTOR DE WORKFLOW para el ECE — Fase 2
-- Fuente: analisis_workflows_ece.md §2.1 y §2.2 (19 formularios NTEC)
-- Norma: Acuerdo n.° 1616 (MINSAL, 2024) — Arts. 15, 19, 21, 23, 41, 42
-- Prerrequisito: 55_ece_00_extensions.sql + 01_catalogos.sql + 05_motor_workflow.sql
-- 100% idempotente: ON CONFLICT DO NOTHING / upsert selectivo.
-- =====================================================================

-- =====================================================================
-- 1. ROLES — 9 roles del análisis §2.x
--    Catálogo ya sembrado en 01_catalogos.sql; aquí garantizamos
--    idempotencia por si se ejecuta en BD limpia.
-- =====================================================================
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

-- =====================================================================
-- 2. TIPOS DE DOCUMENTO — 19 formularios NTEC (§3.1 … §3.19)
--    Doc 19 (documentos clínicos asociados) se modela como un tipo
--    referencial separado del expediente (Art. 37 NTEC: conservación 1 año).
-- =====================================================================
insert into ece.tipo_documento
  (codigo, nombre, tabla_datos, tipo_registro, modalidad, depende_de, inmutable)
values
  -- Doc  1: Ficha de Identificación (Art. 15 NTEC — raíz del expediente)
  ('FICHA_ID',  'Ficha de Identificación',
   'paciente', 'maestro', 'ambos', null, false),
  -- Doc  2: Historia Clínica (primera vez / subsecuente)
  ('HIST_CLIN', 'Historia Clínica',
   'historia_clinica', 'transaccional', 'ambos', array['FICHA_ID'], false),
  -- Doc  3: Hoja de Signos Vitales / Constantes Vitales
  ('SIG_VIT',   'Hoja de Signos Vitales',
   'signos_vitales', 'transaccional', 'ambos', array['FICHA_ID'], false),
  -- Doc  4: Hoja de Triaje / Clasificación de Emergencia
  ('TRIAJE',    'Hoja de Triaje',
   'triaje', 'transaccional', 'ambulatorio', array['SIG_VIT'], false),
  -- Doc  5: Hoja de Atención de Emergencia
  ('ATN_EMERG', 'Atención de Emergencia',
   'atencion_emergencia', 'transaccional', 'ambulatorio', array['TRIAJE'], false),
  -- Doc  6: Hoja de Indicaciones Médicas / Receta (prescripción)
  ('IND_MED',   'Indicaciones Médicas',
   'indicaciones_medicas', 'transaccional', 'ambos', array['HIST_CLIN'], false),
  -- Doc  7: Registro de Enfermería + Kardex de medicamentos
  ('REG_ENF',   'Registro de Enfermería',
   'registro_enfermeria', 'transaccional', 'ambos', array['IND_MED'], false),
  -- Doc  8: Hoja de Evolución Médica (diaria / subsecuente)
  ('EVOL_MED',  'Evolución Médica',
   'evolucion_medica', 'transaccional', 'ambos', array['HIST_CLIN'], false),
  -- Doc  9: Consentimiento Informado (hospitalización / quirúrgico / anestésico)
  ('CONS_INF',  'Consentimiento Informado',
   'consentimiento_informado', 'historico', 'ambos', array['FICHA_ID'], true),
  -- Doc 10: Hoja de Referencia, Retorno e Interconsulta (RRI / módulo SIS)
  ('RRI',       'Referencia / Retorno / Interconsulta',
   'referencia_rri', 'transaccional', 'ambos', array['HIST_CLIN'], false),
  -- Doc 11: Orden de Ingreso Hospitalario (Art. 17 lit. b NTEC)
  ('ORD_ING',   'Orden de Ingreso',
   'orden_ingreso', 'transaccional', 'hospitalario', array['HIST_CLIN'], false),
  -- Doc 12: Hoja de Ingreso / Apertura de Episodio Hospitalario
  ('HOJA_ING',  'Hoja de Ingreso',
   'hoja_ingreso', 'transaccional', 'hospitalario', array['ORD_ING'], false),
  -- Doc 13: Documentos del Acto Quirúrgico (checklist + nota operatoria + registro anestésico + URPA)
  ('ACTO_QX',   'Acto Quirúrgico',
   'acto_quirurgico', 'historico', 'hospitalario', array['CONS_INF'], true),
  -- Doc 14: Documentos Obstétricos (partograma, labor de parto, sala de expulsión, atención RN)
  ('DOC_OBST',  'Documentos Obstétricos',
   'documento_obstetrico', 'historico', 'hospitalario', array['HOJA_ING'], false),
  -- Doc 15: Epicrisis / Hoja de Egreso (Art. 41 NTEC — inmutable al cierre)
  ('EPICRISIS', 'Epicrisis / Hoja de Egreso',
   'epicrisis_egreso', 'historico', 'hospitalario', array['EVOL_MED'], true),
  -- Doc 16: Certificado de Defunción (Art. 35 NTEC — 10 años retención)
  ('CERT_DEF',  'Certificado de Defunción',
   'certificado_defuncion', 'historico', 'hospitalario', array['EPICRISIS'], true),
  -- Doc 17: Certificado de Incapacidad Temporal ISSS
  ('CERT_INC',  'Certificado de Incapacidad ISSS',
   'certificado_incapacidad', 'transaccional', 'ambos', array['HIST_CLIN'], false),
  -- Doc 18: Solicitud / Resultado de Estudios (Laboratorio / Gabinete — RELAB)
  ('SOL_EST',   'Solicitud de Estudio',
   'solicitud_estudio', 'transaccional', 'ambos', array['HIST_CLIN'], false),
  -- Doc 19: Documentos Clínicos Asociados (Art. 37 NTEC — 1 año; fuera del expediente formal)
  ('DOC_ASOC',  'Documentos Clínicos Asociados',
   'documento_asociado', 'transaccional', 'ambos', null, false)
on conflict (codigo) do nothing;

-- =====================================================================
-- 3. HELPERS DE SIEMBRA (funciones temporales para lookup por código)
--    Se eliminan al final de este script.
-- =====================================================================
create or replace function ece._rol(p_codigo text)
returns uuid language sql stable as
$$ select id from ece.rol where codigo = p_codigo $$;

create or replace function ece._estado(p_doc text, p_estado text)
returns uuid language sql stable as
$$ select fe.id
   from ece.flujo_estado fe
   join ece.tipo_documento td on td.id = fe.tipo_documento_id
   where td.codigo = p_doc and fe.codigo = p_estado $$;

create or replace function ece._doc(p_codigo text)
returns uuid language sql stable as
$$ select id from ece.tipo_documento where codigo = p_codigo $$;

-- =====================================================================
-- 4. ESTADOS DE FLUJO — patrón por documento
--    Patrón base: borrador → en_revision → firmado → validado → anulado
--    Docs que requieren certificación de Dirección (Art. 21 NTEC):
--      FICHA_ID, EPICRISIS, CERT_DEF
--      → agregan: certificado (estado final adicional; validado deja de ser final)
--    Docs inmutables (CONS_INF, ACTO_QX, EPICRISIS, CERT_DEF, DOC_OBST):
--      omiten el estado 'en_revision' ya que no admiten edición post-firma.
-- =====================================================================
do $$
declare
  d record;
  necesita_certificacion boolean;
  es_inmutable           boolean;
begin
  for d in
    select id, codigo, inmutable
    from ece.tipo_documento
  loop
    necesita_certificacion := d.codigo in ('FICHA_ID', 'EPICRISIS', 'CERT_DEF');
    es_inmutable           := d.inmutable;

    -- Estado 1: borrador (inicial siempre)
    insert into ece.flujo_estado
      (tipo_documento_id, codigo, nombre, es_inicial, es_final, orden)
    values (d.id, 'borrador', 'Borrador', true, false, 1)
    on conflict (tipo_documento_id, codigo) do nothing;

    -- Estado 2: en_revision (omitido para inmutables — no hay edición post-firma)
    if not es_inmutable then
      insert into ece.flujo_estado
        (tipo_documento_id, codigo, nombre, es_inicial, es_final, orden)
      values (d.id, 'en_revision', 'En revisión', false, false, 2)
      on conflict (tipo_documento_id, codigo) do nothing;
    end if;

    -- Estado 3: firmado
    insert into ece.flujo_estado
      (tipo_documento_id, codigo, nombre, es_inicial, es_final, orden)
    values (d.id, 'firmado', 'Firmado', false, false, 3)
    on conflict (tipo_documento_id, codigo) do nothing;

    -- Estado 4: validado
    --   es_final = true si NO requiere certificación
    insert into ece.flujo_estado
      (tipo_documento_id, codigo, nombre, es_inicial, es_final, orden)
    values (d.id, 'validado', 'Validado', false, not necesita_certificacion, 4)
    on conflict (tipo_documento_id, codigo) do nothing;

    -- Estado 5: certificado — solo docs con certificación de Dirección
    if necesita_certificacion then
      insert into ece.flujo_estado
        (tipo_documento_id, codigo, nombre, es_inicial, es_final, orden)
      values (d.id, 'certificado', 'Certificado', false, true, 5)
      on conflict (tipo_documento_id, codigo) do nothing;
    end if;

    -- Estado 9: anulado (final universal)
    insert into ece.flujo_estado
      (tipo_documento_id, codigo, nombre, es_inicial, es_final, orden)
    values (d.id, 'anulado', 'Anulado', false, true, 9)
    on conflict (tipo_documento_id, codigo) do nothing;

  end loop;
end $$;

-- =====================================================================
-- 5. TRANSICIONES DE FLUJO
--    (doc, accion, estado_origen, estado_destino, rol_autoriza, requiere_firma)
--    Fuente: §2.1 Proceso Ambulatorio y §2.2 Proceso Hospitalario.
--    Nota: en_revision aparece como paso intermedio para docs mutables
--    antes de la firma; inmutables van directo borrador → firmado.
-- =====================================================================

-- -----------------------------------------------------------------------
-- 5a. Transiciones nominales (por documento)
-- -----------------------------------------------------------------------
insert into ece.flujo_transicion
  (tipo_documento_id, estado_origen_id, estado_destino_id, accion, rol_autoriza_id, requiere_firma)
select
  ece._doc(x.doc),
  ece._estado(x.doc, x.origen),
  ece._estado(x.doc, x.destino),
  x.accion,
  ece._rol(x.rol),
  x.firma
from (values
  -- ---- FICHA_ID (maestro, con certificación) ----
  ('FICHA_ID', 'enviar_revision', 'borrador',    'en_revision', 'ARCH', false),
  ('FICHA_ID', 'firmar',          'en_revision',  'firmado',    'ARCH', true),
  ('FICHA_ID', 'validar',         'firmado',      'validado',   'ARCH', false),
  ('FICHA_ID', 'certificar',      'validado',     'certificado','DIR',  true),

  -- ---- HIST_CLIN (MC/MT llena; MC firma y valida) ----
  ('HIST_CLIN', 'enviar_revision', 'borrador',   'en_revision', 'MC',  false),
  ('HIST_CLIN', 'firmar',          'en_revision', 'firmado',    'MC',  true),
  ('HIST_CLIN', 'validar',         'firmado',     'validado',   'MC',  false),

  -- ---- SIG_VIT (ENF llena, firma y valida) ----
  ('SIG_VIT', 'enviar_revision', 'borrador',    'en_revision', 'ENF', false),
  ('SIG_VIT', 'firmar',          'en_revision',  'firmado',    'ENF', true),
  ('SIG_VIT', 'validar',         'firmado',      'validado',   'ENF', false),

  -- ---- TRIAJE (ENF llena/firma; MT valida) ----
  ('TRIAJE', 'enviar_revision', 'borrador',    'en_revision', 'ENF', false),
  ('TRIAJE', 'firmar',          'en_revision',  'firmado',    'ENF', true),
  ('TRIAJE', 'validar',         'firmado',      'validado',   'MT',  false),

  -- ---- ATN_EMERG (MT llena, firma y valida) ----
  ('ATN_EMERG', 'enviar_revision', 'borrador',   'en_revision', 'MT', false),
  ('ATN_EMERG', 'firmar',          'en_revision', 'firmado',    'MT', true),
  ('ATN_EMERG', 'validar',         'firmado',     'validado',   'MT', false),

  -- ---- IND_MED (MC firma prescripción; ENF verifica transcripción = validar) ----
  ('IND_MED', 'enviar_revision', 'borrador',   'en_revision', 'MC',  false),
  ('IND_MED', 'firmar',          'en_revision', 'firmado',    'MC',  true),
  ('IND_MED', 'validar',         'firmado',     'validado',   'ENF', false),

  -- ---- REG_ENF (ENF llena, firma y valida) ----
  ('REG_ENF', 'enviar_revision', 'borrador',   'en_revision', 'ENF', false),
  ('REG_ENF', 'firmar',          'en_revision', 'firmado',    'ENF', true),
  ('REG_ENF', 'validar',         'firmado',     'validado',   'ENF', false),

  -- ---- EVOL_MED (MC/MT llena; MC firma y valida) ----
  ('EVOL_MED', 'enviar_revision', 'borrador',   'en_revision', 'MC', false),
  ('EVOL_MED', 'firmar',          'en_revision', 'firmado',    'MC', true),
  ('EVOL_MED', 'validar',         'firmado',     'validado',   'MC', false),

  -- ---- CONS_INF (inmutable — borrador → firmado directo; doble firma: MC + paciente)
  --      El sistema registra firma del MC al mover; firma del paciente en dato clínico.
  ('CONS_INF', 'firmar',    'borrador', 'firmado',  'MC',  true),
  ('CONS_INF', 'validar',   'firmado',  'validado', 'DIR', false),

  -- ---- RRI (MC firma solicitud; IC firma respuesta = validar) ----
  ('RRI', 'enviar_revision', 'borrador',   'en_revision', 'MC', false),
  ('RRI', 'firmar',          'en_revision', 'firmado',    'MC', true),
  ('RRI', 'validar',         'firmado',     'validado',   'IC', false),  -- interconsultante responde

  -- ---- ORD_ING (MT emite orden; MC autoriza = validar) ----
  ('ORD_ING', 'enviar_revision', 'borrador',   'en_revision', 'MT', false),
  ('ORD_ING', 'firmar',          'en_revision', 'firmado',    'MT', true),
  ('ORD_ING', 'validar',         'firmado',     'validado',   'MC', false),

  -- ---- HOJA_ING (ADM/AC llena; ARCH verifica integridad = validar) ----
  ('HOJA_ING', 'enviar_revision', 'borrador',   'en_revision', 'ADM',  false),
  ('HOJA_ING', 'firmar',          'en_revision', 'firmado',    'ADM',  true),
  ('HOJA_ING', 'validar',         'firmado',     'validado',   'ARCH', false),

  -- ---- ACTO_QX (inmutable — cirujano/anestesiólogo firma; ESP valida) ----
  ('ACTO_QX', 'firmar',  'borrador', 'firmado',  'ESP', true),
  ('ACTO_QX', 'validar', 'firmado',  'validado', 'ESP', false),

  -- ---- DOC_OBST (inmutable — MC firma; ESP obstétrico valida) ----
  ('DOC_OBST', 'firmar',  'borrador', 'firmado',  'MC',  true),
  ('DOC_OBST', 'validar', 'firmado',  'validado', 'ESP', false),

  -- ---- EPICRISIS (inmutable + certificación) ----
  ('EPICRISIS', 'firmar',    'borrador', 'firmado',      'MC',  true),
  ('EPICRISIS', 'validar',   'firmado',  'validado',     'ESP', false),  -- visto jefe de servicio
  ('EPICRISIS', 'certificar','validado', 'certificado',  'DIR', true),   -- Art. 21 NTEC

  -- ---- CERT_DEF (inmutable + certificación — médico certifica; DIR autoriza copias) ----
  ('CERT_DEF', 'firmar',     'borrador', 'firmado',     'MC',  true),
  ('CERT_DEF', 'validar',    'firmado',  'validado',    'MC',  false),
  ('CERT_DEF', 'certificar', 'validado', 'certificado', 'DIR', true),

  -- ---- CERT_INC (MC firma y valida — médico autorizado ISSS) ----
  ('CERT_INC', 'enviar_revision', 'borrador',   'en_revision', 'MC', false),
  ('CERT_INC', 'firmar',          'en_revision', 'firmado',    'MC', true),
  ('CERT_INC', 'validar',         'firmado',     'validado',   'MC', false),

  -- ---- SOL_EST (MC firma solicitud; validación por profesional diagnóstico = MC) ----
  ('SOL_EST', 'enviar_revision', 'borrador',   'en_revision', 'MC', false),
  ('SOL_EST', 'firmar',          'en_revision', 'firmado',    'MC', true),
  ('SOL_EST', 'validar',         'firmado',     'validado',   'MC', false),

  -- ---- DOC_ASOC (Art. 37 NTEC — documentos operativos, 1 año) ----
  ('DOC_ASOC', 'enviar_revision', 'borrador',   'en_revision', 'ADM',  false),
  ('DOC_ASOC', 'firmar',          'en_revision', 'firmado',    'ARCH', true),
  ('DOC_ASOC', 'validar',         'firmado',     'validado',   'ARCH', false)

) as x(doc, accion, origen, destino, rol, firma)
on conflict (tipo_documento_id, estado_origen_id, accion) do nothing;

-- -----------------------------------------------------------------------
-- 5b. Transición universal de anulación (Dirección autoriza — todos los docs)
-- -----------------------------------------------------------------------
insert into ece.flujo_transicion
  (tipo_documento_id, estado_origen_id, estado_destino_id, accion, rol_autoriza_id, requiere_firma)
select
  td.id,
  fe_origen.id,
  fe_anulado.id,
  'anular',
  ece._rol('DIR'),
  true
from ece.tipo_documento td
join ece.flujo_estado fe_origen  on fe_origen.tipo_documento_id  = td.id
                                 and fe_origen.codigo             = 'borrador'
join ece.flujo_estado fe_anulado on fe_anulado.tipo_documento_id = td.id
                                 and fe_anulado.codigo            = 'anulado'
on conflict (tipo_documento_id, estado_origen_id, accion) do nothing;

-- =====================================================================
-- 6. MATRIZ documento_rol — §2.1 y §2.2
--    Dimensiones: LLENA / RESPONSABLE / AUTORIZA / FIRMA
--    obligatorio = false indica rol alternativo (ej. MT puede llenar HC si MC ausente)
-- =====================================================================
insert into ece.documento_rol
  (tipo_documento_id, rol_id, funcion, obligatorio)
select ece._doc(x.doc), ece._rol(x.rol), x.funcion, x.oblig
from (values
  -- ---- FICHA_ID ----
  ('FICHA_ID', 'ARCH', 'LLENA',        true),
  ('FICHA_ID', 'ARCH', 'RESPONSABLE',  true),
  ('FICHA_ID', 'ARCH', 'FIRMA',        true),
  ('FICHA_ID', 'DIR',  'AUTORIZA',     true),    -- Art. 21: solo DIR certifica copia

  -- ---- HIST_CLIN ----
  ('HIST_CLIN', 'MC',  'LLENA',        true),
  ('HIST_CLIN', 'MT',  'LLENA',        false),   -- MT puede en ausencia de MC
  ('HIST_CLIN', 'MC',  'RESPONSABLE',  true),
  ('HIST_CLIN', 'MC',  'FIRMA',        true),
  ('HIST_CLIN', 'MC',  'AUTORIZA',     true),

  -- ---- SIG_VIT ----
  ('SIG_VIT', 'ENF', 'LLENA',          true),
  ('SIG_VIT', 'ENF', 'RESPONSABLE',    true),
  ('SIG_VIT', 'ENF', 'FIRMA',          true),
  ('SIG_VIT', 'ENF', 'AUTORIZA',       true),

  -- ---- TRIAJE ----
  ('TRIAJE', 'ENF', 'LLENA',           true),
  ('TRIAJE', 'MT',  'LLENA',           false),   -- MT según protocolo institucional
  ('TRIAJE', 'ENF', 'RESPONSABLE',     true),
  ('TRIAJE', 'ENF', 'FIRMA',           true),
  ('TRIAJE', 'MT',  'AUTORIZA',        true),

  -- ---- ATN_EMERG ----
  ('ATN_EMERG', 'MT', 'LLENA',         true),
  ('ATN_EMERG', 'MT', 'RESPONSABLE',   true),
  ('ATN_EMERG', 'MT', 'FIRMA',         true),
  ('ATN_EMERG', 'MT', 'AUTORIZA',      true),

  -- ---- IND_MED ----
  ('IND_MED', 'MC',  'LLENA',          true),
  ('IND_MED', 'MT',  'LLENA',          false),   -- MT puede prescribir en turno
  ('IND_MED', 'MC',  'RESPONSABLE',    true),
  ('IND_MED', 'MC',  'FIRMA',          true),
  ('IND_MED', 'ENF', 'AUTORIZA',       true),    -- verifica transcripción

  -- ---- REG_ENF ----
  ('REG_ENF', 'ENF', 'LLENA',          true),
  ('REG_ENF', 'ENF', 'RESPONSABLE',    true),
  ('REG_ENF', 'ENF', 'FIRMA',          true),
  ('REG_ENF', 'ENF', 'AUTORIZA',       true),

  -- ---- EVOL_MED ----
  ('EVOL_MED', 'MC', 'LLENA',          true),
  ('EVOL_MED', 'MT', 'LLENA',          false),   -- médico de turno en hospitalización
  ('EVOL_MED', 'MC', 'RESPONSABLE',    true),
  ('EVOL_MED', 'MC', 'FIRMA',          true),
  ('EVOL_MED', 'MC', 'AUTORIZA',       true),

  -- ---- CONS_INF ----
  ('CONS_INF', 'MC',  'LLENA',         true),
  ('CONS_INF', 'ESP', 'LLENA',         false),   -- especialista en consentimiento quirúrgico
  ('CONS_INF', 'MC',  'RESPONSABLE',   true),
  ('CONS_INF', 'MC',  'FIRMA',         true),
  ('CONS_INF', 'DIR', 'AUTORIZA',      true),

  -- ---- RRI ----
  ('RRI', 'MC',  'LLENA',              true),
  ('RRI', 'MT',  'LLENA',              false),
  ('RRI', 'MC',  'RESPONSABLE',        true),
  ('RRI', 'MC',  'FIRMA',              true),
  ('RRI', 'IC',  'AUTORIZA',           true),    -- interconsultante firma la respuesta

  -- ---- ORD_ING ----
  ('ORD_ING', 'MT', 'LLENA',           true),
  ('ORD_ING', 'MC', 'LLENA',           false),
  ('ORD_ING', 'MT', 'RESPONSABLE',     true),
  ('ORD_ING', 'MT', 'FIRMA',           true),
  ('ORD_ING', 'MC', 'AUTORIZA',        true),

  -- ---- HOJA_ING ----
  ('HOJA_ING', 'ADM',  'LLENA',        true),
  ('HOJA_ING', 'AC',   'LLENA',        false),   -- ventanilla ISSS
  ('HOJA_ING', 'ADM',  'RESPONSABLE',  true),
  ('HOJA_ING', 'ADM',  'FIRMA',        true),
  ('HOJA_ING', 'ARCH', 'AUTORIZA',     true),

  -- ---- ACTO_QX ----
  ('ACTO_QX', 'ESP', 'LLENA',          true),    -- cirujano responsable
  ('ACTO_QX', 'ESP', 'RESPONSABLE',    true),
  ('ACTO_QX', 'ESP', 'FIRMA',          true),
  ('ACTO_QX', 'ESP', 'AUTORIZA',       true),

  -- ---- DOC_OBST ----
  ('DOC_OBST', 'MC',  'LLENA',         true),
  ('DOC_OBST', 'ENF', 'LLENA',         false),   -- obstetra / enfermería partera
  ('DOC_OBST', 'MC',  'RESPONSABLE',   true),
  ('DOC_OBST', 'MC',  'FIRMA',         true),
  ('DOC_OBST', 'ESP', 'AUTORIZA',      true),    -- especialista obstetra

  -- ---- EPICRISIS ----
  ('EPICRISIS', 'MC',  'LLENA',        true),
  ('EPICRISIS', 'MC',  'RESPONSABLE',  true),
  ('EPICRISIS', 'MC',  'FIRMA',        true),
  ('EPICRISIS', 'DIR', 'AUTORIZA',     true),    -- Art. 21 NTEC — certifica copia

  -- ---- CERT_DEF ----
  ('CERT_DEF', 'MC',  'LLENA',         true),
  ('CERT_DEF', 'MC',  'RESPONSABLE',   true),
  ('CERT_DEF', 'MC',  'FIRMA',         true),
  ('CERT_DEF', 'DIR', 'AUTORIZA',      true),

  -- ---- CERT_INC ----
  ('CERT_INC', 'MC',  'LLENA',         true),
  ('CERT_INC', 'MC',  'RESPONSABLE',   true),
  ('CERT_INC', 'MC',  'FIRMA',         true),
  ('CERT_INC', 'MC',  'AUTORIZA',      true),    -- médico autorizado ISSS

  -- ---- SOL_EST ----
  ('SOL_EST', 'MC',  'LLENA',          true),
  ('SOL_EST', 'MT',  'LLENA',          false),
  ('SOL_EST', 'MC',  'RESPONSABLE',    true),
  ('SOL_EST', 'MC',  'FIRMA',          true),
  ('SOL_EST', 'MC',  'AUTORIZA',       true),

  -- ---- DOC_ASOC ----
  ('DOC_ASOC', 'ADM',  'LLENA',        true),
  ('DOC_ASOC', 'ARCH', 'RESPONSABLE',  true),
  ('DOC_ASOC', 'ARCH', 'FIRMA',        true),
  ('DOC_ASOC', 'ARCH', 'AUTORIZA',     true)

) as x(doc, rol, funcion, oblig)
on conflict (tipo_documento_id, rol_id, funcion) do nothing;

-- =====================================================================
-- 7. PERFIL DE ACCESO (RBAC) — ece.perfil_acceso
--    Art. 45, 52 NTEC: control de acceso por perfil; depuración anual.
--    MC firma HC/evolución/epicrisis.
--    ENF firma signos vitales y registro de enfermería.
--    DIR certifica expediente/epicrisis/defunción (Art. 21 NTEC).
-- =====================================================================
insert into ece.perfil_acceso (rol_id, recurso, permiso)
select ece._rol(x.rol), x.recurso, x.permiso
from (values
  -- Médico de Cabecera: lectura + escritura + firma en documentos clínicos principales
  ('MC', 'historia_clinica',         'lectura'),
  ('MC', 'historia_clinica',         'escritura'),
  ('MC', 'historia_clinica',         'firma'),
  ('MC', 'evolucion_medica',         'lectura'),
  ('MC', 'evolucion_medica',         'escritura'),
  ('MC', 'evolucion_medica',         'firma'),
  ('MC', 'epicrisis_egreso',         'lectura'),
  ('MC', 'epicrisis_egreso',         'escritura'),
  ('MC', 'epicrisis_egreso',         'firma'),
  ('MC', 'indicaciones_medicas',     'escritura'),
  ('MC', 'indicaciones_medicas',     'firma'),
  ('MC', 'solicitud_estudio',        'escritura'),
  ('MC', 'solicitud_estudio',        'firma'),
  ('MC', 'certificado_incapacidad',  'escritura'),
  ('MC', 'certificado_incapacidad',  'firma'),
  ('MC', 'certificado_defuncion',    'escritura'),
  ('MC', 'certificado_defuncion',    'firma'),
  ('MC', 'consentimiento_informado', 'escritura'),
  ('MC', 'consentimiento_informado', 'firma'),
  -- Médico de Turno: mismos recursos que MC; permisos de escritura/firma
  ('MT', 'historia_clinica',         'lectura'),
  ('MT', 'historia_clinica',         'escritura'),
  ('MT', 'historia_clinica',         'firma'),
  ('MT', 'evolucion_medica',         'escritura'),
  ('MT', 'evolucion_medica',         'firma'),
  ('MT', 'indicaciones_medicas',     'escritura'),
  ('MT', 'indicaciones_medicas',     'firma'),
  ('MT', 'atencion_emergencia',      'escritura'),
  ('MT', 'atencion_emergencia',      'firma'),
  -- Especialista: acto quirúrgico + consentimientos + evolución
  ('ESP', 'acto_quirurgico',         'escritura'),
  ('ESP', 'acto_quirurgico',         'firma'),
  ('ESP', 'documento_obstetrico',    'escritura'),
  ('ESP', 'documento_obstetrico',    'firma'),
  ('ESP', 'consentimiento_informado','escritura'),
  ('ESP', 'consentimiento_informado','firma'),
  -- Interconsultante: lectura + autoriza respuesta RRI
  ('IC', 'referencia_rri',           'lectura'),
  ('IC', 'referencia_rri',           'autoriza'),
  -- Enfermería: firma signos vitales y registro de enfermería
  ('ENF', 'signos_vitales',          'lectura'),
  ('ENF', 'signos_vitales',          'escritura'),
  ('ENF', 'signos_vitales',          'firma'),
  ('ENF', 'registro_enfermeria',     'escritura'),
  ('ENF', 'registro_enfermeria',     'firma'),
  ('ENF', 'triaje',                  'escritura'),
  ('ENF', 'triaje',                  'firma'),
  -- Archivo / ESDOMED: escritura ficha + codificación CIE-10
  ('ARCH', 'paciente',               'escritura'),
  ('ARCH', 'paciente',               'firma'),
  ('ARCH', 'paciente',               'autoriza'),
  -- ADM / AC: apertura de episodio / admisión
  ('ADM', 'hoja_ingreso',            'escritura'),
  ('ADM', 'hoja_ingreso',            'firma'),
  ('AC',  'hoja_ingreso',            'escritura'),
  -- Dirección: certificación de expedientes (Art. 21 NTEC)
  ('DIR', 'paciente',                'certifica'),
  ('DIR', 'epicrisis_egreso',        'certifica'),
  ('DIR', 'certificado_defuncion',   'certifica'),
  ('DIR', 'consentimiento_informado','autoriza')
) as x(rol, recurso, permiso)
on conflict (rol_id, recurso, permiso) do nothing;

-- =====================================================================
-- 8. LIMPIEZA — elimina helpers temporales de siembra
-- =====================================================================
drop function if exists ece._rol(text);
drop function if exists ece._estado(text, text);
drop function if exists ece._doc(text);
