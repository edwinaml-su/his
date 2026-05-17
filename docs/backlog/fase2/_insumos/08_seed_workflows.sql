-- =====================================================================
-- 08_seed_workflows.sql
-- Siembra del MOTOR DE WORKFLOW con la matriz de la Fase 2.
-- Define, como DATOS: cada documento, sus estados, sus transiciones
-- (con rol autorizador) y sus roles funcionales (LLENA/RESPONSABLE/
-- AUTORIZA/FIRMA). Cambiar un flujo = editar estas filas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tipos de documento (Fase 3)
-- ---------------------------------------------------------------------
insert into ece.tipo_documento
  (codigo, nombre, tabla_datos, tipo_registro, modalidad, depende_de, inmutable) values
 ('FICHA_ID','Ficha de Identificación','paciente','maestro','ambos', null, false),
 ('HIST_CLIN','Historia Clínica','historia_clinica','transaccional','ambos', array['FICHA_ID'], false),
 ('SIG_VIT','Hoja de Signos Vitales','signos_vitales','transaccional','ambos', array['FICHA_ID'], false),
 ('TRIAJE','Hoja de Triaje','triaje','transaccional','ambulatorio', array['SIG_VIT'], false),
 ('ATN_EMERG','Atención de Emergencia','atencion_emergencia','transaccional','ambulatorio', array['TRIAJE'], false),
 ('IND_MED','Indicaciones Médicas','indicaciones_medicas','transaccional','ambos', array['HIST_CLIN'], false),
 ('REG_ENF','Registro de Enfermería','registro_enfermeria','transaccional','ambos', array['IND_MED'], false),
 ('EVOL_MED','Evolución Médica','evolucion_medica','transaccional','ambos', array['HIST_CLIN'], false),
 ('CONS_INF','Consentimiento Informado','consentimiento_informado','historico','ambos', array['FICHA_ID'], true),
 ('RRI','Referencia/Retorno/Interconsulta','referencia_rri','transaccional','ambos', array['HIST_CLIN'], false),
 ('ORD_ING','Orden de Ingreso','orden_ingreso','transaccional','hospitalario', array['HIST_CLIN'], false),
 ('HOJA_ING','Hoja de Ingreso','hoja_ingreso','transaccional','hospitalario', array['ORD_ING'], false),
 ('ACTO_QX','Acto Quirúrgico','acto_quirurgico','historico','hospitalario', array['CONS_INF'], true),
 ('DOC_OBST','Documentos Obstétricos','documento_obstetrico','historico','hospitalario', array['HOJA_ING'], false),
 ('EPICRISIS','Epicrisis / Hoja de Egreso','epicrisis_egreso','historico','hospitalario', array['EVOL_MED'], true),
 ('CERT_DEF','Certificado de Defunción','certificado_defuncion','historico','hospitalario', array['EPICRISIS'], true),
 ('CERT_INC','Certificado de Incapacidad ISSS','certificado_incapacidad','transaccional','ambos', array['HIST_CLIN'], false),
 ('SOL_EST','Solicitud de Estudio','solicitud_estudio','transaccional','ambos', array['HIST_CLIN'], false);

-- ---------------------------------------------------------------------
-- 2. Estados estándar por documento.
--    Patrón general: borrador -> firmado -> [validado] -> [certificado]
--    + anulado (final). Documentos inmutables omiten 'borrador' editable.
-- ---------------------------------------------------------------------
do $$
declare d record;
begin
  for d in select id, codigo, inmutable from ece.tipo_documento loop
    insert into ece.flujo_estado (tipo_documento_id, codigo, nombre, es_inicial, es_final, orden) values
      (d.id, 'borrador',    'Borrador',     true,  false, 1),
      (d.id, 'firmado',     'Firmado',      false, false, 2),
      (d.id, 'validado',    'Validado',     false, false, 3),
      (d.id, 'anulado',     'Anulado',      false, true,  9);
    -- Documentos que requieren certificación de Dirección (Art. 21 NTEC)
    if d.codigo in ('EPICRISIS','CERT_DEF','FICHA_ID') then
      insert into ece.flujo_estado (tipo_documento_id, codigo, nombre, es_inicial, es_final, orden)
      values (d.id, 'certificado', 'Certificado', false, true, 4);
    else
      update ece.flujo_estado set es_final = true
       where tipo_documento_id = d.id and codigo = 'validado';
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Helper: id de rol por código
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 4. Transiciones: quién AUTORIZA mover el documento de estado.
--    (doc, accion, origen, destino, rol_autoriza, requiere_firma)
-- ---------------------------------------------------------------------
insert into ece.flujo_transicion
  (tipo_documento_id, estado_origen_id, estado_destino_id, accion, rol_autoriza_id, requiere_firma)
select ece._doc(x.doc), ece._estado(x.doc,x.org), ece._estado(x.doc,x.dst),
       x.accion, ece._rol(x.rol), x.firma
from (values
  -- Ambulatorios
  ('HIST_CLIN','firmar','borrador','firmado','MC', true),
  ('HIST_CLIN','validar','firmado','validado','MC', false),
  ('SIG_VIT','firmar','borrador','firmado','ENF', true),
  ('SIG_VIT','validar','firmado','validado','ENF', false),
  ('TRIAJE','firmar','borrador','firmado','ENF', true),
  ('TRIAJE','validar','firmado','validado','MT', false),
  ('ATN_EMERG','firmar','borrador','firmado','MT', true),
  ('ATN_EMERG','validar','firmado','validado','MT', false),
  ('IND_MED','firmar','borrador','firmado','MC', true),
  ('IND_MED','validar','firmado','validado','ENF', false),     -- transcripción/verificación enfermería
  ('REG_ENF','firmar','borrador','firmado','ENF', true),
  ('REG_ENF','validar','firmado','validado','ENF', false),
  ('EVOL_MED','firmar','borrador','firmado','MC', true),
  ('EVOL_MED','validar','firmado','validado','MC', false),
  ('CONS_INF','firmar','borrador','firmado','MC', true),       -- médico que informa
  ('CONS_INF','validar','firmado','validado','DIR', false),
  ('RRI','firmar','borrador','firmado','MC', true),
  ('RRI','validar','firmado','validado','IC', false),          -- interconsultante responde
  ('SOL_EST','firmar','borrador','firmado','MC', true),
  ('SOL_EST','validar','firmado','validado','MC', false),
  ('CERT_INC','firmar','borrador','firmado','MC', true),
  ('CERT_INC','validar','firmado','validado','MC', false),
  -- Hospitalarios
  ('ORD_ING','firmar','borrador','firmado','MT', true),
  ('ORD_ING','validar','firmado','validado','MC', false),
  ('HOJA_ING','firmar','borrador','firmado','ADM', true),
  ('HOJA_ING','validar','firmado','validado','ARCH', false),
  ('ACTO_QX','firmar','borrador','firmado','ESP', true),       -- cirujano
  ('ACTO_QX','validar','firmado','validado','ESP', false),
  ('DOC_OBST','firmar','borrador','firmado','MC', true),
  ('DOC_OBST','validar','firmado','validado','ESP', false),
  ('EPICRISIS','firmar','borrador','firmado','MC', true),      -- médico tratante
  ('EPICRISIS','validar','firmado','validado','ESP', false),   -- visto jefe de servicio
  ('EPICRISIS','certificar','validado','certificado','DIR', true),
  ('CERT_DEF','firmar','borrador','firmado','MC', true),
  ('CERT_DEF','validar','firmado','validado','MC', false),
  ('CERT_DEF','certificar','validado','certificado','DIR', true),
  ('FICHA_ID','firmar','borrador','firmado','ARCH', true),
  ('FICHA_ID','validar','firmado','validado','ARCH', false),
  ('FICHA_ID','certificar','validado','certificado','DIR', true)
) as x(doc, accion, org, dst, rol, firma);

-- Transición universal de anulación (autorizada por Dirección)
insert into ece.flujo_transicion
  (tipo_documento_id, estado_origen_id, estado_destino_id, accion, rol_autoriza_id, requiere_firma)
select td.id, fe_b.id, fe_a.id, 'anular', ece._rol('DIR'), true
from ece.tipo_documento td
join ece.flujo_estado fe_b on fe_b.tipo_documento_id = td.id and fe_b.codigo = 'borrador'
join ece.flujo_estado fe_a on fe_a.tipo_documento_id = td.id and fe_a.codigo = 'anulado';

-- ---------------------------------------------------------------------
-- 5. Roles funcionales por documento (matriz Fase 2):
--    LLENA / RESPONSABLE / AUTORIZA / FIRMA
-- ---------------------------------------------------------------------
insert into ece.documento_rol (tipo_documento_id, rol_id, funcion, obligatorio)
select ece._doc(x.doc), ece._rol(x.rol), x.funcion, x.oblig
from (values
  -- doc, rol, funcion, obligatorio
  ('FICHA_ID','ARCH','LLENA',true),  ('FICHA_ID','ARCH','RESPONSABLE',true),
  ('FICHA_ID','ARCH','FIRMA',true),  ('FICHA_ID','DIR','AUTORIZA',true),

  ('HIST_CLIN','MC','LLENA',true),   ('HIST_CLIN','MT','LLENA',false),
  ('HIST_CLIN','MC','RESPONSABLE',true), ('HIST_CLIN','MC','FIRMA',true),
  ('HIST_CLIN','MC','AUTORIZA',true),

  ('SIG_VIT','ENF','LLENA',true),    ('SIG_VIT','ENF','RESPONSABLE',true),
  ('SIG_VIT','ENF','FIRMA',true),    ('SIG_VIT','ENF','AUTORIZA',true),

  ('TRIAJE','ENF','LLENA',true),     ('TRIAJE','ENF','RESPONSABLE',true),
  ('TRIAJE','ENF','FIRMA',true),     ('TRIAJE','MT','AUTORIZA',true),

  ('ATN_EMERG','MT','LLENA',true),   ('ATN_EMERG','MT','RESPONSABLE',true),
  ('ATN_EMERG','MT','FIRMA',true),   ('ATN_EMERG','MT','AUTORIZA',true),

  ('IND_MED','MC','LLENA',true),     ('IND_MED','MC','RESPONSABLE',true),
  ('IND_MED','MC','FIRMA',true),     ('IND_MED','ENF','AUTORIZA',true),

  ('REG_ENF','ENF','LLENA',true),    ('REG_ENF','ENF','RESPONSABLE',true),
  ('REG_ENF','ENF','FIRMA',true),    ('REG_ENF','ENF','AUTORIZA',true),

  ('EVOL_MED','MC','LLENA',true),    ('EVOL_MED','MT','LLENA',false),
  ('EVOL_MED','MC','RESPONSABLE',true), ('EVOL_MED','MC','FIRMA',true),
  ('EVOL_MED','MC','AUTORIZA',true),

  ('CONS_INF','MC','LLENA',true),    ('CONS_INF','MC','RESPONSABLE',true),
  ('CONS_INF','MC','FIRMA',true),    ('CONS_INF','DIR','AUTORIZA',true),

  ('RRI','MC','LLENA',true),         ('RRI','MC','RESPONSABLE',true),
  ('RRI','MC','FIRMA',true),         ('RRI','IC','AUTORIZA',true),

  ('ORD_ING','MT','LLENA',true),     ('ORD_ING','MC','LLENA',false),
  ('ORD_ING','MT','RESPONSABLE',true), ('ORD_ING','MT','FIRMA',true),
  ('ORD_ING','MC','AUTORIZA',true),

  ('HOJA_ING','ADM','LLENA',true),   ('HOJA_ING','AC','LLENA',false),
  ('HOJA_ING','ADM','RESPONSABLE',true), ('HOJA_ING','ADM','FIRMA',true),
  ('HOJA_ING','ARCH','AUTORIZA',true),

  ('ACTO_QX','ESP','LLENA',true),    ('ACTO_QX','ESP','RESPONSABLE',true),
  ('ACTO_QX','ESP','FIRMA',true),    ('ACTO_QX','ESP','AUTORIZA',true),

  ('DOC_OBST','MC','LLENA',true),    ('DOC_OBST','ENF','LLENA',false),
  ('DOC_OBST','MC','RESPONSABLE',true), ('DOC_OBST','MC','FIRMA',true),
  ('DOC_OBST','ESP','AUTORIZA',true),

  ('EPICRISIS','MC','LLENA',true),   ('EPICRISIS','MC','RESPONSABLE',true),
  ('EPICRISIS','MC','FIRMA',true),   ('EPICRISIS','DIR','AUTORIZA',true),

  ('CERT_DEF','MC','LLENA',true),    ('CERT_DEF','MC','RESPONSABLE',true),
  ('CERT_DEF','MC','FIRMA',true),    ('CERT_DEF','DIR','AUTORIZA',true),

  ('CERT_INC','MC','LLENA',true),    ('CERT_INC','MC','RESPONSABLE',true),
  ('CERT_INC','MC','FIRMA',true),    ('CERT_INC','MC','AUTORIZA',true),

  ('SOL_EST','MC','LLENA',true),     ('SOL_EST','MC','RESPONSABLE',true),
  ('SOL_EST','MC','FIRMA',true),     ('SOL_EST','MC','AUTORIZA',true)
) as x(doc, rol, funcion, oblig);

-- ---------------------------------------------------------------------
-- 6. Perfiles de acceso base (RBAC). Médicos escriben/firman clínico;
--    enfermería su registro; archivo certifica vía Dirección.
-- ---------------------------------------------------------------------
insert into ece.perfil_acceso (rol_id, recurso, permiso)
select ece._rol(x.rol), x.recurso, x.permiso
from (values
  ('MC','historia_clinica','escritura'), ('MC','historia_clinica','firma'),
  ('MC','evolucion_medica','escritura'), ('MC','evolucion_medica','firma'),
  ('MC','epicrisis_egreso','escritura'), ('MC','epicrisis_egreso','firma'),
  ('ENF','signos_vitales','escritura'),  ('ENF','signos_vitales','firma'),
  ('ENF','registro_enfermeria','escritura'),
  ('ARCH','paciente','escritura'),
  ('DIR','epicrisis_egreso','certifica'),('DIR','paciente','certifica'),
  ('DIR','certificado_defuncion','certifica')
) as x(rol, recurso, permiso);

-- ---------------------------------------------------------------------
-- 7. Limpieza de helpers de siembra
-- ---------------------------------------------------------------------
drop function ece._rol(text);
drop function ece._estado(text,text);
drop function ece._doc(text);
