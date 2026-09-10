-- 229 — Maestro de ubicaciones GS1 (GLN-13) del Complejo Avante
-- APLICADO a prod 2026-09-10 vía MCP — NO re-aplicar.
--
-- Fuente: 'Maestro ubicaciones Avante - 20260907 2.xlsx' (Edwin, licencia GS1
-- El Salvador prefijo 7410398, vigencia 2026-07-01→2027-07-01).
-- Normalización GLN-13 aprobada por Edwin: prefijo(7) + referencia a 5 dígitos
-- (zero-pad de la ref de 4 del maestro) + dígito verificador GS1 mod-10.
--
-- Carga: 165 GLNs jerárquicos (entidad→establecimiento→funcional→secundaria),
-- 4 establecimientos nuevos (CL/FCM/FSC + COLMED inactivo), GLN a 6 unidades
-- seed existentes + 27 unidades nuevas, 66 camas seed ficticias desactivadas
-- y 72 camas reales (habitación = nombre del maestro: Sydney, Tokio, Van Gogh…).
-- Tipos ece.gs1_gln: entidad|establecimiento|servicio|farmacia|deposito|cama.

BEGIN;
-- 1) Prefijo GS1 licenciado (GS1 El Salvador, vigencia 2026-07-01 a 2027-07-01)
UPDATE "Organization" SET "gs1CompanyPrefix"='7410398', "updatedAt"=now() WHERE id='c7eabf29-a484-4a69-9426-9ee8b06d054a';

-- 2) Establecimientos nuevos (el bridge ADR 0022 crea el espejo ece.establecimiento)
CREATE TEMP TABLE _est (code text, name text, addr text, act bool) ON COMMIT DROP;
INSERT INTO _est VALUES
('CL','AVANTE CLINICAS MEDICAS ESPECIALIZADAS','1ª Calle Poniente #3843, Colonia Escalón, San Salvador',true),
('FCM','FARMACIAS AVANTE CASA MATRIZ','1ª Calle Poniente #3843, Colonia Escalón, San Salvador',true),
('FSC','FARMACIAS AVANTE SURF CITY','Centro Comercial The Point, Local 12, San Blas, La Libertad',true),
('COLMED','AVANTE HOSPITAL ESPECIALIZADO COL. MEDICA','San Salvador',false);
INSERT INTO "Establishment" (id,"organizationId",code,name,"addressLine",phone,active,"createdAt","updatedAt")
SELECT gen_random_uuid(),'c7eabf29-a484-4a69-9426-9ee8b06d054a',m.code,m.name,m.addr,'2238-2300',m.act,now(),now()
FROM _est m WHERE NOT EXISTS (SELECT 1 FROM "Establishment" e WHERE e."organizationId"='c7eabf29-a484-4a69-9426-9ee8b06d054a' AND e.code=m.code);

-- 3) Catalogo ece.gs1_gln - GLN-13 normalizados (ref a 5 digitos + digito verificador)
CREATE TEMP TABLE _gln (codigo text, descripcion text, tipo text, activo bool, padre text, est text) ON COMMIT DROP;
INSERT INTO _gln VALUES
('7410398000019','INVERSIONES AVANTE, S.A. DE C.V.','entidad',true,NULL,NULL),
('7410398000026','Avante Hospital Especializado','establecimiento',true,'7410398000019','HE'),
('7410398000033','Avante Centro Médico Especializado','establecimiento',true,'7410398000019','CM'),
('7410398000040','Avante Unidad Médica Satelital','establecimiento',true,'7410398000019','US'),
('7410398000057','Avante Clinicas Médicas Especializadas','establecimiento',true,'7410398000019','CL'),
('7410398000064','Farmacias Avante Casa Matriz','establecimiento',true,'7410398000019','FCM'),
('7410398000071','Farmacias Avante Surf City','establecimiento',true,'7410398000019','FSC'),
('7410398000088','Avante Hospital Especializado Col. Médica.','establecimiento',false,'7410398000019','COLMED'),
('7410398000095','Máxima Urgencia','servicio',true,'7410398000026','HE'),
('7410398000101','Septico-Bio-Infeccioso','servicio',true,'7410398000026','HE'),
('7410398000118','Observación','servicio',true,'7410398000026','HE'),
('7410398000125','UCI','servicio',true,'7410398000026','HE'),
('7410398000132','Transferencia','servicio',true,'7410398000026','HE'),
('7410398000149','Bloque Quirúrgico','servicio',true,'7410398000026','HE'),
('7410398000156','Diagnóstico','servicio',true,'7410398000026','HE'),
('7410398000163','Cuidados Especiales','servicio',true,'7410398000026','HE'),
('7410398000170','Botiquín','farmacia',true,'7410398000026','HE'),
('7410398000187','Tercero Poniente','servicio',true,'7410398000026','HE'),
('7410398000194','Pediatría','servicio',true,'7410398000026','HE'),
('7410398000200','Cuarto Poniente','servicio',true,'7410398000026','HE'),
('7410398000217','Septico-Bio-Infeccioso','servicio',true,'7410398000026','HE'),
('7410398000231','Laboratorio Clinico','servicio',true,'7410398000026','HE'),
('7410398000743','Bloque Nº1','servicio',true,'7410398000033','CM'),
('7410398000750','Bloque Nº2','servicio',true,'7410398000033','CM'),
('7410398000767','Grecia/Observacion','servicio',true,'7410398000033','CM'),
('7410398000774','Bloque Nº3','servicio',true,'7410398000033','CM'),
('7410398000781','Bloque Nº4','servicio',true,'7410398000033','CM'),
('7410398000798','Ambulatorio1','servicio',true,'7410398000033','CM'),
('7410398000804','Bloque Quirúrgico','servicio',true,'7410398000033','CM'),
('7410398000811','Botiquin','farmacia',true,'7410398000033','CM'),
('7410398000828','Almacenes / Bodega','deposito',true,'7410398000033','CM'),
('7410398000835','Laboratorio Clinico','servicio',true,'7410398000033','CM'),
('7410398000842','Diagnostico','servicio',true,'7410398000033','CM'),
('7410398001177','Observación Surf','servicio',true,'7410398000040','US'),
('7410398001184','Botiquín Surf','farmacia',true,'7410398000040','US'),
('7410398001238','CLINICAS','servicio',true,'7410398000057','CL'),
('7410398001245','ADMINISTRATIVO','servicio',true,'7410398000057','CL'),
('7410398001481','Mostrador','servicio',true,'7410398000064','FCM'),
('7410398001498','Bodega General','deposito',true,'7410398000064','FCM'),
('7410398001504','Mostrador','servicio',true,'7410398000071','FSC'),
('7410398001511','Bodega General','deposito',true,'7410398000071','FSC'),
('7410398000224','Cubículo 1','cama',true,'7410398000095',NULL),
('7410398000248','Cubículo 2','cama',true,'7410398000095',NULL),
('7410398000255','Cubículo 3','cama',true,'7410398000095',NULL),
('7410398000262','Sydney','cama',true,'7410398000118',NULL),
('7410398000279','Tarawa','cama',true,'7410398000118',NULL),
('7410398000286','Melbourne','cama',true,'7410398000118',NULL),
('7410398000293','Wellington','cama',true,'7410398000118',NULL),
('7410398000309','Yaren','cama',true,'7410398000118',NULL),
('7410398000316','Van Gogh','cama',true,'7410398000125',NULL),
('7410398000323','Picasso','cama',true,'7410398000125',NULL),
('7410398000330','Miguel Ángel','cama',true,'7410398000125',NULL),
('7410398000347','Monet','cama',true,'7410398000125',NULL),
('7410398000354','Davinci','cama',true,'7410398000125',NULL),
('7410398000361','Dalí','cama',true,'7410398000125',NULL),
('7410398000378','Puerto Moresby','cama',true,'7410398000132',NULL),
('7410398000385','Suva','cama',true,'7410398000132',NULL),
('7410398000392','Serenity','servicio',true,'7410398000149',NULL),
('7410398000408','Sunshine','servicio',true,'7410398000149',NULL),
('7410398000415','Sky Hybrid / Agiografo-Hemodinami','servicio',true,'7410398000149',NULL),
('7410398000422','Aurora','servicio',true,'7410398000149',NULL),
('7410398000439','Recuperación Postquirúrgica','servicio',true,'7410398000149',NULL),
('7410398000446','Botiquín de Sala','farmacia',true,'7410398000149',NULL),
('7410398000453','Resonancia Magnética','servicio',true,'7410398000156',NULL),
('7410398000460','Ultrasonografía','servicio',true,'7410398000156',NULL),
('7410398000477','Rayos X','servicio',true,'7410398000156',NULL),
('7410398000484','Tomógrafo','servicio',true,'7410398000156',NULL),
('7410398000491','Beijing','cama',true,'7410398000163',NULL),
('7410398000507','Kioto','cama',true,'7410398000163',NULL),
('7410398000514','Seúl','cama',true,'7410398000163',NULL),
('7410398000521','Hainan','cama',true,'7410398000163',NULL),
('7410398000538','Ereván','cama',true,'7410398000187',NULL),
('7410398000545','Tokio','cama',true,'7410398000187',NULL),
('7410398000552','Bangkok','cama',true,'7410398000187',NULL),
('7410398000569','Yakarta','cama',true,'7410398000187',NULL),
('7410398000576','Himalaya','cama',true,'7410398000187',NULL),
('7410398000583','Manila','cama',true,'7410398000187',NULL),
('7410398000590','Singapur','cama',true,'7410398000187',NULL),
('7410398000606','Arusha','cama',true,'7410398000194',NULL),
('7410398000613','Luanda','cama',true,'7410398000194',NULL),
('7410398000620','Constantina','cama',true,'7410398000194',NULL),
('7410398000637','Rabat','cama',true,'7410398000194',NULL),
('7410398000644','Lagos','cama',true,'7410398000194',NULL),
('7410398000651','Nairobi','cama',true,'7410398000194',NULL),
('7410398000668','Nakuru','cama',true,'7410398000200',NULL),
('7410398000675','Oshicoto','cama',true,'7410398000200',NULL),
('7410398000682','Antalaha','cama',true,'7410398000200',NULL),
('7410398000699','Maseru','cama',true,'7410398000200',NULL),
('7410398000705','Dakar','cama',true,'7410398000200',NULL),
('7410398000712','El Cairo','cama',true,'7410398000200',NULL),
('7410398000729','Harare','cama',true,'7410398000200',NULL),
('7410398000736','Centurion','cama',true,'7410398000200',NULL),
('7410398000859','San Salvador','cama',true,'7410398000743',NULL),
('7410398000866','Suchitoto','cama',true,'7410398000743',NULL),
('7410398000873','Apaneca','cama',true,'7410398000743',NULL),
('7410398000880','Milan','cama',true,'7410398000743',NULL),
('7410398000897','Berlin','cama',true,'7410398000743',NULL),
('7410398000903','Juayua','cama',true,'7410398000743',NULL),
('7410398000910','Paris','cama',true,'7410398000743',NULL),
('7410398000927','La Union','cama',true,'7410398000743',NULL),
('7410398000934','Morazan','cama',true,'7410398000743',NULL),
('7410398000941','Cabañas','cama',true,'7410398000750',NULL),
('7410398000958','Santorini','cama',true,'7410398000750',NULL),
('7410398000965','Barcelona','cama',true,'7410398000750',NULL),
('7410398000972','Isla de Capri','cama',true,'7410398000750',NULL),
('7410398000989','Bruselas','cama',true,'7410398000750',NULL),
('7410398000996','Apolo','cama',true,'7410398000767',NULL),
('7410398001009','Hera','cama',true,'7410398000767',NULL),
('7410398001016','Atenas','cama',true,'7410398000767',NULL),
('7410398001023','Hermes','cama',true,'7410398000767',NULL),
('7410398001030','Lisboa','cama',true,'7410398000774',NULL),
('7410398001047','Londres','cama',true,'7410398000774',NULL),
('7410398001054','Madrid','cama',true,'7410398000774',NULL),
('7410398001061','Zurich','cama',true,'7410398000774',NULL),
('7410398001078','Praga','cama',true,'7410398000774',NULL),
('7410398001085','Bogota','cama',true,'7410398000774',NULL),
('7410398001092','Rio de Janeiro','cama',true,'7410398000781',NULL),
('7410398001108','Buenos Aires','cama',true,'7410398000781',NULL),
('7410398001115','Guadalajara','cama',true,'7410398000781',NULL),
('7410398001122','Lima','cama',true,'7410398000781',NULL),
('7410398001139','Dr. SV','servicio',true,'7410398000798',NULL),
('7410398001146','Azul','servicio',true,'7410398000804',NULL),
('7410398001153','Verde','servicio',true,'7410398000804',NULL),
('7410398001160','Lila','servicio',true,'7410398000804',NULL),
('7410398001191','Camilla 1','cama',true,'7410398001177',NULL),
('7410398001207','Camilla 2','cama',true,'7410398001177',NULL),
('7410398001214','Camilla 3','cama',true,'7410398001177',NULL),
('7410398001221','Consultorio 1','servicio',true,'7410398001177',NULL),
('7410398001252','CONSULTORIO 1','servicio',true,'7410398001238',NULL),
('7410398001269','CONSULTORIO 2','servicio',true,'7410398001238',NULL),
('7410398001276','CONSULTORIO 3','servicio',true,'7410398001238',NULL),
('7410398001283','CONSULTORIO 4','servicio',true,'7410398001238',NULL),
('7410398001290','CONSULTORIO 5','servicio',true,'7410398001238',NULL),
('7410398001306','CONSULTORIO 6','servicio',true,'7410398001238',NULL),
('7410398001313','CONSULTORIO 7','servicio',true,'7410398001238',NULL),
('7410398001320','CONSULTORIO 8','servicio',true,'7410398001238',NULL),
('7410398001337','CONSULTORIO 9','servicio',true,'7410398001238',NULL),
('7410398001344','CONSULTORIO 10','servicio',true,'7410398001238',NULL),
('7410398001351','CONSULTORIO 11','servicio',true,'7410398001238',NULL),
('7410398001368','CONSULTORIO 12','servicio',true,'7410398001238',NULL),
('7410398001375','CONSULTORIO 13','servicio',true,'7410398001238',NULL),
('7410398001382','CONSULTORIO 14','servicio',true,'7410398001238',NULL),
('7410398001399','CONSULTORIO 15','servicio',true,'7410398001238',NULL),
('7410398001405','CONSULTORIO 16','servicio',true,'7410398001238',NULL),
('7410398001412','CONSULTORIO 17','servicio',true,'7410398001238',NULL),
('7410398001429','CONSULTORIO 18','servicio',true,'7410398001238',NULL),
('7410398001436','RECURSOS HUMANOS','servicio',true,'7410398001245',NULL),
('7410398001443','ISBM','servicio',true,'7410398001245',NULL),
('7410398001450','SEGURIDAD','servicio',true,'7410398001245',NULL),
('7410398001467','COMPRAS','servicio',true,'7410398001245',NULL),
('7410398001474','CUENTAS','servicio',true,'7410398001245',NULL),
('7410398001528','ESTACION DE ENFERMERIA 1','servicio',true,'7410398000095',NULL),
('7410398001535','ESTACION DE ENFERMERIA 2','servicio',true,'7410398000118',NULL),
('7410398001542','ESTACION DE ENFERMERIA 3','servicio',true,'7410398000125',NULL),
('7410398001559','ESTACION ENFERMERIA 1','servicio',true,'7410398000132',NULL),
('7410398001566','ESTACION ENFERMERIA 1','servicio',true,'7410398000163',NULL),
('7410398001573','ESTACION ENFERMERIA 2','servicio',true,'7410398000187',NULL),
('7410398001580','ESTACION ENFERMERIA 1','servicio',true,'7410398000194',NULL),
('7410398001597','ESTACION ENFERMERIA 2','servicio',true,'7410398000200',NULL),
('7410398001603','ESTACION 1','servicio',true,'7410398000743',NULL),
('7410398001610','ESTACION 2','servicio',true,'7410398000750',NULL),
('7410398001627','ESTACION 3','servicio',true,'7410398000767',NULL),
('7410398001634','ESTACION 4','servicio',true,'7410398000774',NULL),
('7410398001641','ESTACION 5','servicio',true,'7410398000781',NULL),
('7410398001658','ESTACION 5','servicio',true,'7410398000798',NULL);
INSERT INTO ece.gs1_gln (id,codigo,descripcion,tipo,activo,creado_en)
SELECT gen_random_uuid(), m.codigo, m.descripcion, m.tipo, m.activo, now() FROM _gln m
ON CONFLICT (codigo) DO NOTHING;
UPDATE ece.gs1_gln g SET parent_id = p.id
FROM _gln m JOIN ece.gs1_gln p ON p.codigo = m.padre
WHERE g.codigo = m.codigo AND m.padre IS NOT NULL AND g.parent_id IS NULL;
UPDATE ece.gs1_gln g SET establecimiento_id = ee.id
FROM _gln m, ece.establecimiento ee JOIN "Establishment" pe ON pe.id = ee.establishment_id
WHERE g.codigo = m.codigo AND m.est IS NOT NULL AND pe.code = m.est
  AND pe."organizationId"='c7eabf29-a484-4a69-9426-9ee8b06d054a' AND g.establecimiento_id IS NULL;

-- 4) GLN a las unidades seed existentes que corresponden al maestro
UPDATE "ServiceUnit" SET "glnCodigo"='7410398000095', "updatedAt"=now() WHERE code='MAX_URG' AND "organizationId"='c7eabf29-a484-4a69-9426-9ee8b06d054a';
UPDATE "ServiceUnit" SET "glnCodigo"='7410398000125', "updatedAt"=now() WHERE code='UCI' AND "organizationId"='c7eabf29-a484-4a69-9426-9ee8b06d054a';
UPDATE "ServiceUnit" SET "glnCodigo"='7410398000149', "updatedAt"=now() WHERE code='QX' AND "organizationId"='c7eabf29-a484-4a69-9426-9ee8b06d054a';
UPDATE "ServiceUnit" SET "glnCodigo"='7410398000231', "updatedAt"=now() WHERE code='LAB' AND "organizationId"='c7eabf29-a484-4a69-9426-9ee8b06d054a';
UPDATE "ServiceUnit" SET "glnCodigo"='7410398000156', "updatedAt"=now() WHERE code='RX' AND "organizationId"='c7eabf29-a484-4a69-9426-9ee8b06d054a';
UPDATE "ServiceUnit" SET "glnCodigo"='7410398000170', "updatedAt"=now() WHERE code='FAR' AND "organizationId"='c7eabf29-a484-4a69-9426-9ee8b06d054a';

-- 5) Unidades nuevas del maestro (sin equivalente seed)
CREATE TEMP TABLE _unit (gln text, code text, name text, est text, act bool) ON COMMIT DROP;
INSERT INTO _unit VALUES
('7410398000101','SEPTICO_BIO_INFECCIOSO','Septico-Bio-Infeccioso','HE',true),
('7410398000118','OBSERVACION','Observación','HE',true),
('7410398000132','TRANSFERENCIA','Transferencia','HE',true),
('7410398000163','CUIDADOS_ESPECIALES','Cuidados Especiales','HE',true),
('7410398000187','TERCERO_PONIENTE','Tercero Poniente','HE',true),
('7410398000194','PEDIATRIA','Pediatría','HE',true),
('7410398000200','CUARTO_PONIENTE','Cuarto Poniente','HE',true),
('7410398000217','SEPTICO_BIO_INFECCIOSO_2','Septico-Bio-Infeccioso','HE',true),
('7410398000743','BLOQUE_N_1','Bloque Nº1','CM',true),
('7410398000750','BLOQUE_N_2','Bloque Nº2','CM',true),
('7410398000767','GRECIA_OBSERVACION','Grecia/Observacion','CM',true),
('7410398000774','BLOQUE_N_3','Bloque Nº3','CM',true),
('7410398000781','BLOQUE_N_4','Bloque Nº4','CM',true),
('7410398000798','AMBULATORIO1','Ambulatorio1','CM',true),
('7410398000804','BLOQUE_QUIRURGICO','Bloque Quirúrgico','CM',true),
('7410398000811','BOTIQUIN','Botiquin','CM',true),
('7410398000828','ALMACENES_BODEGA','Almacenes / Bodega','CM',true),
('7410398000835','LABORATORIO_CLINICO','Laboratorio Clinico','CM',true),
('7410398000842','DIAGNOSTICO','Diagnostico','CM',true),
('7410398001177','OBSERVACION_SURF','Observación Surf','US',true),
('7410398001184','BOTIQUIN_SURF','Botiquín Surf','US',true),
('7410398001238','CLINICAS','CLINICAS','CL',true),
('7410398001245','ADMINISTRATIVO','ADMINISTRATIVO','CL',true),
('7410398001481','MOSTRADOR','Mostrador','FCM',true),
('7410398001498','BODEGA_GENERAL','Bodega General','FCM',true),
('7410398001504','MOSTRADOR_2','Mostrador','FSC',true),
('7410398001511','BODEGA_GENERAL_2','Bodega General','FSC',true);
INSERT INTO "ServiceUnit" (id,"organizationId","establishmentId",code,name,active,"createdAt","updatedAt","glnCodigo")
SELECT gen_random_uuid(),'c7eabf29-a484-4a69-9426-9ee8b06d054a',e.id,m.code,m.name,m.act,now(),now(),m.gln
FROM _unit m JOIN "Establishment" e ON e.code=m.est AND e."organizationId"='c7eabf29-a484-4a69-9426-9ee8b06d054a'
WHERE NOT EXISTS (SELECT 1 FROM "ServiceUnit" su WHERE su."organizationId"='c7eabf29-a484-4a69-9426-9ee8b06d054a' AND su.code=m.code);

-- 6) Camas seed ficticias fuera de servicio (BedAssignments de prueba conservan FK)
UPDATE "Bed" SET active=false, "updatedAt"=now() WHERE "organizationId"='c7eabf29-a484-4a69-9426-9ee8b06d054a' AND "glnCodigo" IS NULL;

-- 7) Camas reales del maestro (habitacion = nombre de la ubicacion secundaria)
CREATE TEMP TABLE _bed (gln text, code text, room text, unitcode text, est text, act bool) ON COMMIT DROP;
INSERT INTO _bed VALUES
('7410398000224','CUBICULO_1','Cubículo 1','MAX_URG','HE',true),
('7410398000248','CUBICULO_2','Cubículo 2','MAX_URG','HE',true),
('7410398000255','CUBICULO_3','Cubículo 3','MAX_URG','HE',true),
('7410398000262','SYDNEY','Sydney','OBSERVACION','HE',true),
('7410398000279','TARAWA','Tarawa','OBSERVACION','HE',true),
('7410398000286','MELBOURNE','Melbourne','OBSERVACION','HE',true),
('7410398000293','WELLINGTON','Wellington','OBSERVACION','HE',true),
('7410398000309','YAREN','Yaren','OBSERVACION','HE',true),
('7410398000316','VAN_GOGH','Van Gogh','UCI','HE',true),
('7410398000323','PICASSO','Picasso','UCI','HE',true),
('7410398000330','MIGUEL_ANGEL','Miguel Ángel','UCI','HE',true),
('7410398000347','MONET','Monet','UCI','HE',true),
('7410398000354','DAVINCI','Davinci','UCI','HE',true),
('7410398000361','DALI','Dalí','UCI','HE',true),
('7410398000378','PUERTO_MORESBY','Puerto Moresby','TRANSFERENCIA','HE',true),
('7410398000385','SUVA','Suva','TRANSFERENCIA','HE',true),
('7410398000491','BEIJING','Beijing','CUIDADOS_ESPECIALES','HE',true),
('7410398000507','KIOTO','Kioto','CUIDADOS_ESPECIALES','HE',true),
('7410398000514','SEUL','Seúl','CUIDADOS_ESPECIALES','HE',true),
('7410398000521','HAINAN','Hainan','CUIDADOS_ESPECIALES','HE',true),
('7410398000538','EREVAN','Ereván','TERCERO_PONIENTE','HE',true),
('7410398000545','TOKIO','Tokio','TERCERO_PONIENTE','HE',true),
('7410398000552','BANGKOK','Bangkok','TERCERO_PONIENTE','HE',true),
('7410398000569','YAKARTA','Yakarta','TERCERO_PONIENTE','HE',true),
('7410398000576','HIMALAYA','Himalaya','TERCERO_PONIENTE','HE',true),
('7410398000583','MANILA','Manila','TERCERO_PONIENTE','HE',true),
('7410398000590','SINGAPUR','Singapur','TERCERO_PONIENTE','HE',true),
('7410398000606','ARUSHA','Arusha','PEDIATRIA','HE',true),
('7410398000613','LUANDA','Luanda','PEDIATRIA','HE',true),
('7410398000620','CONSTANTINA','Constantina','PEDIATRIA','HE',true),
('7410398000637','RABAT','Rabat','PEDIATRIA','HE',true),
('7410398000644','LAGOS','Lagos','PEDIATRIA','HE',true),
('7410398000651','NAIROBI','Nairobi','PEDIATRIA','HE',true),
('7410398000668','NAKURU','Nakuru','CUARTO_PONIENTE','HE',true),
('7410398000675','OSHICOTO','Oshicoto','CUARTO_PONIENTE','HE',true),
('7410398000682','ANTALAHA','Antalaha','CUARTO_PONIENTE','HE',true),
('7410398000699','MASERU','Maseru','CUARTO_PONIENTE','HE',true),
('7410398000705','DAKAR','Dakar','CUARTO_PONIENTE','HE',true),
('7410398000712','EL_CAIRO','El Cairo','CUARTO_PONIENTE','HE',true),
('7410398000729','HARARE','Harare','CUARTO_PONIENTE','HE',true),
('7410398000736','CENTURION','Centurion','CUARTO_PONIENTE','HE',true),
('7410398000859','SAN_SALVADOR','San Salvador','BLOQUE_N_1','CM',true),
('7410398000866','SUCHITOTO','Suchitoto','BLOQUE_N_1','CM',true),
('7410398000873','APANECA','Apaneca','BLOQUE_N_1','CM',true),
('7410398000880','MILAN','Milan','BLOQUE_N_1','CM',true),
('7410398000897','BERLIN','Berlin','BLOQUE_N_1','CM',true),
('7410398000903','JUAYUA','Juayua','BLOQUE_N_1','CM',true),
('7410398000910','PARIS','Paris','BLOQUE_N_1','CM',true),
('7410398000927','LA_UNION','La Union','BLOQUE_N_1','CM',true),
('7410398000934','MORAZAN','Morazan','BLOQUE_N_1','CM',true),
('7410398000941','CABANAS','Cabañas','BLOQUE_N_2','CM',true),
('7410398000958','SANTORINI','Santorini','BLOQUE_N_2','CM',true),
('7410398000965','BARCELONA','Barcelona','BLOQUE_N_2','CM',true),
('7410398000972','ISLA_DE_CAPRI','Isla de Capri','BLOQUE_N_2','CM',true),
('7410398000989','BRUSELAS','Bruselas','BLOQUE_N_2','CM',true),
('7410398000996','APOLO','Apolo','GRECIA_OBSERVACION','CM',true),
('7410398001009','HERA','Hera','GRECIA_OBSERVACION','CM',true),
('7410398001016','ATENAS','Atenas','GRECIA_OBSERVACION','CM',true),
('7410398001023','HERMES','Hermes','GRECIA_OBSERVACION','CM',true),
('7410398001030','LISBOA','Lisboa','BLOQUE_N_3','CM',true),
('7410398001047','LONDRES','Londres','BLOQUE_N_3','CM',true),
('7410398001054','MADRID','Madrid','BLOQUE_N_3','CM',true),
('7410398001061','ZURICH','Zurich','BLOQUE_N_3','CM',true),
('7410398001078','PRAGA','Praga','BLOQUE_N_3','CM',true),
('7410398001085','BOGOTA','Bogota','BLOQUE_N_3','CM',true),
('7410398001092','RIO_DE_JANEIRO','Rio de Janeiro','BLOQUE_N_4','CM',true),
('7410398001108','BUENOS_AIRES','Buenos Aires','BLOQUE_N_4','CM',true),
('7410398001115','GUADALAJARA','Guadalajara','BLOQUE_N_4','CM',true),
('7410398001122','LIMA','Lima','BLOQUE_N_4','CM',true),
('7410398001191','CAMILLA_1','Camilla 1','OBSERVACION_SURF','US',true),
('7410398001207','CAMILLA_2','Camilla 2','OBSERVACION_SURF','US',true),
('7410398001214','CAMILLA_3','Camilla 3','OBSERVACION_SURF','US',true);
INSERT INTO "Bed" (id,"organizationId","establishmentId","serviceUnitId",code,room,status,active,"createdAt","updatedAt","glnCodigo")
SELECT gen_random_uuid(),'c7eabf29-a484-4a69-9426-9ee8b06d054a',e.id,su.id,m.code,m.room,'FREE',m.act,now(),now(),m.gln
FROM _bed m
JOIN "Establishment" e ON e.code=m.est AND e."organizationId"='c7eabf29-a484-4a69-9426-9ee8b06d054a'
JOIN "ServiceUnit" su ON su."establishmentId"=e.id AND su.code=m.unitcode
WHERE NOT EXISTS (SELECT 1 FROM "Bed" b WHERE b."establishmentId"=e.id AND b.code=m.code);

COMMIT;