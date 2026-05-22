-- =============================================================================
-- 100_seed_workflow_descriptions.sql
--
-- Fase 2 del workflow-designer enhancement (PR Fase 2).
--
-- 1. AGREGA 5 tipos de documento faltantes (PROG_QX, CONS_QX, RES_EST,
--    PARTOGRAMA, NRP) con sus 5 estados + 4 transiciones estándar.
-- 2. SIEMBRA estados+transiciones para 6 tipos huérfanos (ATN_RN, PREOP_CHECK,
--    REG_ANEST, SALA_EXPULSION, VAL_INI_ENF, WHO_CHK).
-- 3. POBLA `descripcion_markdown` en los 31 tipos (26 existentes + 5 nuevos).
-- 4. CORRIGE drift: REG_ANEST.depende_de=['ACTO_QUIR'] → ['ACTO_QX'].
--
-- Las descripciones markdown son la fuente que el workflow-designer renderiza
-- como ayuda contextual. Su contenido proviene de docs/flujos/{CODIGO}.md
-- (PR Fase 1).
--
-- Patrón de workflow estándar (5 estados / 4 transiciones):
--   borrador (inicial) → en_revision → firmado → validado (terminal)
--                              ↘ anulado (DIR)
--
-- Idempotente: usa ON CONFLICT DO NOTHING + UPDATE WHERE descripcion_markdown
-- IS NULL OR LENGTH = 0 para no sobrescribir cambios manuales del workflow
-- designer.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Helper para sembrar el patrón estándar de workflow para un tipo_documento.
-- Crea 5 estados + 4 transiciones si no existen. Idempotente.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ece.fn_seed_workflow_estandar(p_codigo_doc text)
RETURNS void
LANGUAGE plpgsql
AS $func$
DECLARE
  v_doc_id     uuid;
  v_borrador   uuid;
  v_revision   uuid;
  v_firmado    uuid;
  v_validado   uuid;
  v_anulado    uuid;
  v_rol_mc     uuid;
  v_rol_dir    uuid;
BEGIN
  SELECT id INTO v_doc_id FROM ece.tipo_documento WHERE codigo = p_codigo_doc;
  IF v_doc_id IS NULL THEN
    RAISE NOTICE 'tipo_documento % no existe — skipping', p_codigo_doc;
    RETURN;
  END IF;

  SELECT id INTO v_rol_mc  FROM ece.rol WHERE codigo = 'MC';
  SELECT id INTO v_rol_dir FROM ece.rol WHERE codigo = 'DIR';

  -- Estados (idempotente)
  INSERT INTO ece.flujo_estado (tipo_documento_id, codigo, nombre, es_inicial, es_final, orden)
  VALUES
    (v_doc_id, 'borrador',    'Borrador',          true,  false, 1),
    (v_doc_id, 'en_revision', 'En revisión',       false, false, 2),
    (v_doc_id, 'firmado',     'Firmado',           false, false, 3),
    (v_doc_id, 'validado',    'Validado',          false, true,  4),
    (v_doc_id, 'anulado',     'Anulado',           false, false, 9)
  ON CONFLICT (tipo_documento_id, codigo) DO NOTHING;

  SELECT id INTO v_borrador FROM ece.flujo_estado WHERE tipo_documento_id = v_doc_id AND codigo = 'borrador';
  SELECT id INTO v_revision FROM ece.flujo_estado WHERE tipo_documento_id = v_doc_id AND codigo = 'en_revision';
  SELECT id INTO v_firmado  FROM ece.flujo_estado WHERE tipo_documento_id = v_doc_id AND codigo = 'firmado';
  SELECT id INTO v_validado FROM ece.flujo_estado WHERE tipo_documento_id = v_doc_id AND codigo = 'validado';
  SELECT id INTO v_anulado  FROM ece.flujo_estado WHERE tipo_documento_id = v_doc_id AND codigo = 'anulado';

  -- Transiciones (idempotente)
  INSERT INTO ece.flujo_transicion
    (tipo_documento_id, estado_origen_id, estado_destino_id, accion, rol_autoriza_id, requiere_firma)
  VALUES
    (v_doc_id, v_borrador, v_revision, 'enviar_revision', v_rol_mc,  false),
    (v_doc_id, v_revision, v_firmado,  'firmar',          v_rol_mc,  true),
    (v_doc_id, v_firmado,  v_validado, 'validar',         v_rol_mc,  false),
    (v_doc_id, v_borrador, v_anulado,  'anular',          v_rol_dir, true)
  ON CONFLICT (tipo_documento_id, estado_origen_id, accion) DO NOTHING;
END;
$func$;

-- -----------------------------------------------------------------------------
-- BLOQUE A — Crear 5 tipos de documento faltantes
-- Códigos: PROG_QX, CONS_QX, RES_EST, PARTOGRAMA, NRP
-- -----------------------------------------------------------------------------
INSERT INTO ece.tipo_documento
  (codigo, nombre, tabla_datos, tipo_registro, modalidad, depende_de, inmutable, modulo_his_target)
VALUES
  ('PROG_QX', 'Programación Quirúrgica',
   'ece.reserva_sala_qx', 'transaccional', 'hospitalario',
   ARRAY['FICHA_ID', 'CONS_QX']::text[],
   true, '/surgery/schedule'),

  ('CONS_QX', 'Consentimiento Informado Quirúrgico',
   'ece.consentimiento_quirurgico', 'historico', 'hospitalario',
   ARRAY['FICHA_ID']::text[],
   true, '/ece/consentimiento'),

  ('RES_EST', 'Resultado de Estudio',
   'ece.resultado_estudio', 'historico', 'ambos',
   ARRAY['SOL_EST']::text[],
   true, '/ece/resultados'),

  ('PARTOGRAMA', 'Partograma OMS',
   'ece.partograma_registro', 'maestro', 'hospitalario',
   ARRAY['HOJA_ING']::text[],
   true, '/ece/obstetricia/partograma'),

  ('NRP', 'Reanimación Neonatal',
   'ece.reanimacion_neonatal', 'historico', 'hospitalario',
   ARRAY['ATN_RN']::text[],
   true, '/ece/neonatologia/nrp')
ON CONFLICT (codigo) DO NOTHING;

-- Sembrar workflow estándar a los 5 nuevos + 6 huérfanos
-- URPA queda fuera: ya tiene su modelo propio (activo → alta_otorgada / anulado)
-- que se mantiene; solo se agregan sus transiciones faltantes abajo.
SELECT ece.fn_seed_workflow_estandar(c) FROM unnest(ARRAY[
  -- Nuevos
  'PROG_QX', 'CONS_QX', 'RES_EST', 'PARTOGRAMA', 'NRP',
  -- Huérfanos preexistentes con 0 estados
  'ATN_RN', 'PREOP_CHECK', 'REG_ANEST', 'SALA_EXPULSION', 'VAL_INI_ENF', 'WHO_CHK'
]::text[]) AS c;

-- Transiciones para URPA (preserva su modelo de estados activo → alta_otorgada / anulado)
DO $urpa$
DECLARE
  v_doc_id     uuid;
  v_activo     uuid;
  v_alta       uuid;
  v_anulado    uuid;
  v_rol_esp    uuid;
  v_rol_dir    uuid;
BEGIN
  SELECT id INTO v_doc_id FROM ece.tipo_documento WHERE codigo = 'URPA';
  IF v_doc_id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_activo  FROM ece.flujo_estado WHERE tipo_documento_id = v_doc_id AND codigo = 'activo';
  SELECT id INTO v_alta    FROM ece.flujo_estado WHERE tipo_documento_id = v_doc_id AND codigo = 'alta_otorgada';
  SELECT id INTO v_anulado FROM ece.flujo_estado WHERE tipo_documento_id = v_doc_id AND codigo = 'anulado';

  SELECT id INTO v_rol_esp FROM ece.rol WHERE codigo = 'ESP';
  SELECT id INTO v_rol_dir FROM ece.rol WHERE codigo = 'DIR';

  IF v_activo IS NOT NULL AND v_alta IS NOT NULL THEN
    INSERT INTO ece.flujo_transicion
      (tipo_documento_id, estado_origen_id, estado_destino_id, accion, rol_autoriza_id, requiere_firma)
    VALUES
      (v_doc_id, v_activo, v_alta, 'dar_alta', v_rol_esp, true)
    ON CONFLICT (tipo_documento_id, estado_origen_id, accion) DO NOTHING;
  END IF;

  IF v_activo IS NOT NULL AND v_anulado IS NOT NULL THEN
    INSERT INTO ece.flujo_transicion
      (tipo_documento_id, estado_origen_id, estado_destino_id, accion, rol_autoriza_id, requiere_firma)
    VALUES
      (v_doc_id, v_activo, v_anulado, 'anular', v_rol_dir, true)
    ON CONFLICT (tipo_documento_id, estado_origen_id, accion) DO NOTHING;
  END IF;
END;
$urpa$;

-- -----------------------------------------------------------------------------
-- BLOQUE B — Fix drift detectado en audit:
-- REG_ANEST.depende_de = ['ACTO_QUIR'] → ['ACTO_QX']
-- -----------------------------------------------------------------------------
UPDATE ece.tipo_documento
   SET depende_de = ARRAY['ACTO_QX']::text[]
 WHERE codigo = 'REG_ANEST' AND 'ACTO_QUIR' = ANY(depende_de);

-- -----------------------------------------------------------------------------
-- BLOQUE C — Poblar descripcion_markdown
-- Solo actualiza si está NULL o vacío (no sobrescribe cambios manuales).
-- -----------------------------------------------------------------------------

-- FICHA_ID -----------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Ficha de Identificación de Paciente** (NTEC Art. 15 — documento raíz del expediente).

Es el ancla legal del expediente clínico: identifica al paciente como persona única en el HIS y el ECE. No se "firma" como acto único — es un expediente vivo donde cada actualización queda historizada en la cadena de auditoría SHA-256.

Campos obligatorios mínimos: nombre completo, DUI/NIE/pasaporte (con validación de check digit SV), fecha de nacimiento, sexo biológico, nacionalidad, domicilio, contacto de emergencia (con parentesco), grupo sanguíneo (Art. 15), alergias conocidas. Foto y huella opcionales.

**Cuándo se usa**: una sola vez por paciente al registro inicial. Cualquier cambio posterior (cambio de domicilio, descubrimiento de nueva alergia) actualiza este expediente y deja traza en `audit.audit_log`.

**Error común**: crear un nuevo paciente cuando ya existe — usar siempre búsqueda por DUI antes de capturar.
$md$
WHERE codigo = 'FICHA_ID' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- HIST_CLIN ----------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Historia Clínica Ambulatoria** (NTEC Arts. 15/19/23 — primer contacto clínico documentado).

Documento OBLIGATORIO en la primera consulta ambulatoria. Captura anamnesis completa: motivo de consulta, antecedentes (familiares, personales patológicos y no patológicos, gineco-obstétricos si aplica), revisión por sistemas, examen físico segmentado, diagnóstico inicial CIE-10, plan terapéutico.

**Cuándo se usa**: primera vez del paciente con un médico/especialidad. En consultas subsecuentes con el mismo motivo se usa `EVOL_MED` (nota de evolución), NO una HC nueva. Si el motivo cambia sustancialmente, o el paciente reactiva tras >5 años pasivo, o cambia de especialidad → nueva HC.

**Inmutabilidad**: post-firma queda bloqueada por trigger BD (Art. 40). Correcciones vía documento `RECT`.

**Drift conocido (HC-001/002 P0)**: actualmente no tiene UI ni router tRPC propio — bloqueante Go-Live.
$md$
WHERE codigo = 'HIST_CLIN' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- EVOL_MED -----------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Nota de Evolución** (NTEC Art. 19 — registro cronológico de cada consulta subsecuente).

Una consulta = una nota firmada. Captura la evolución del cuadro clínico desde la consulta anterior: cambios en síntomas, hallazgos del examen físico actual, ajustes diagnósticos, modificación del plan.

**Cuándo se usa**: cada consulta subsecuente con el mismo motivo que la HC inicial. No reemplaza una HC nueva si el motivo cambia.

**Addendum**: si se necesita ampliar una nota ya firmada, se crea una nota nueva tipo "Addendum de #XXX" — la nota original NUNCA se modifica (Art. 40 inmutabilidad).

**Roles**: MC firma con PIN argon2id. Si paciente pasa a otro médico (interconsulta o relevo), el nuevo MC firma sus propias notas.
$md$
WHERE codigo = 'EVOL_MED' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- SOL_EST ------------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Solicitud de Estudios** (NTEC Art. 42 — orden formal de lab/imagen/gabinete).

Documento que solicita al laboratorio (LIS), imagenología (RIS) o gabinete (endoscopía, anatomía patológica, etc.) la ejecución de uno o varios estudios sobre el paciente.

**Campos**: paciente, médico solicitante, examenes (JSONB con LOINC ideal), indicación clínica, urgencia (rutina/urgente/STAT), establecimiento ejecutor.

**Flujo**: tras firmar, el documento dispara la orden hacia LIS/RIS legacy (`LabOrder`, `ImagingOrder`). El módulo ejecutor genera el `RES_EST` al validar resultado.

**Drift conocido (HH-01/HH-06/HH-08 P0)**: schema drift entre router y BD (5 columnas asumidas no existen), RLS bypass en LIS/Imaging legacy.
$md$
WHERE codigo = 'SOL_EST' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- RES_EST ------------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Resultado de Estudio** (NTEC Art. 42 — resultado validado por LAB/RAD/PAT).

Documento inmutable que captura el resultado de un estudio solicitado vía `SOL_EST`. Su contenido (campo `valores` JSONB) es polimorfo según el tipo: numéricos con rangos de referencia para lab, hallazgos textuales + imágenes DICOM para radiología, descripción macro/microscópica para patología.

**Estados**: borrador (técnico captura) → firmado (técnico responsable) → validado (médico LAB/RAD/PAT — 4-eyes).

**Inmutabilidad**: post-validación queda bloqueado por trigger BD. Rectificación de resultado vía documento `RECT` referenciando este.

**Auto-flagging**: el LIS marca valores fuera de rango automáticamente (HH-09 P1 sin edad/sexo aún).
$md$
WHERE codigo = 'RES_EST' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- CONS_INF -----------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Consentimiento Informado Médico** (NTEC Arts. 39/40 — doble firma paciente + médico, inmutable post-firma).

Documento legal que captura el consentimiento informado del paciente para procedimientos, decisiones clínicas sensibles o tratamientos de alto riesgo. Requiere DOBLE firma: paciente (manuscrita o digital biométrica) y médico tratante (PIN argon2id).

**No confundir con `/consents` (admin)**: ese es consentimiento de tratamiento de datos LOPD/GDPR (1 firma paciente, revocable). Este `CONS_INF` es consentimiento médico NTEC (2 firmas, inmutable post-firma — Art. 40).

**Revocación**: solo pre-procedimiento. Si paciente revoca pre-cirugía → dispara cancelación de `PROG_QX`.

**Testigo**: si paciente no puede firmar (analfabeto, impedido), un testigo firma con su parentesco/relación documentado.
$md$
WHERE codigo = 'CONS_INF' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- CONS_QX ------------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Consentimiento Quirúrgico** (NTEC Arts. 39/40 — específico para procedimiento quirúrgico).

Variante específica de `CONS_INF` para cirugía. Adicional a la doble firma paciente+cirujano, requiere firma anexa del anestesiólogo cubriendo los riesgos anestésicos.

**Campos diferenciales vs CONS_INF**: procedimiento detallado (no abreviado), riesgos quirúrgicos específicos, alternativas (incluye NO_OPERAR), complicaciones frecuentes y severas, tipo de anestesia + sus riesgos, transfusión planeada o eventual, preguntas del paciente con respuestas.

**Bloqueante de `PROG_QX`**: la programación quirúrgica no puede confirmarse sin CONS_QX firmado pre-fecha.

**Revocación pre-procedimiento**: cancela `PROG_QX` automáticamente.
$md$
WHERE codigo = 'CONS_QX' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- TRIAJE -------------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Hoja de Triaje Manchester** (TDR §9 — 5 niveles MTS, SLA configurable por nivel).

Categorización al ingreso a emergencia según Manchester Triage System: ROJO (inmediato), NARANJA (≤10 min), AMARILLO (≤60 min), VERDE (≤120 min), AZUL (≤240 min). Discriminador específico documentado (eg. "dolor torácico irradiado", "Glasgow ≤14").

**Roles**: enfermería de triaje categoriza; médico opcional re-categoriza si discrepancia tras evaluación inicial.

**SLA dispara alertas Beta.15** si el tiempo de espera excede el límite del nivel.

**Drift conocido**: `/ece/triaje` fue eliminado (PR #101) — usar `/triage` legacy con bridge `eceBridgeTriage` hacia `ece.hoja_triaje`. Regla "Adecuar legacy, NO duplicar".
$md$
WHERE codigo = 'TRIAJE' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- ATN_EMERG ----------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Atención de Emergencia** (NTEC Art. 35 — documento clínico de la atención inicial en urgencias).

Captura la atención completa en urgencia: motivo de consulta, anamnesis dirigida, examen físico segmentado, signos vitales (link a SIG_VIT), triaje (link a TRIAJE), diagnóstico principal CIE-10 + secundarios, plan de manejo, disposición final.

**Disposiciones disparan cascada**:
- ALTA → fin del episodio
- HOSPITALIZACIÓN → dispara `HOJA_ING`
- OBSERVACIÓN → mantiene episodio abierto con SIG_VIT seriado
- REFERENCIA → dispara `RRI`
- DEFUNCIÓN → cambia el flujo a `CERT_DEF`

**Custodia**: 5 años Art. 35 NTEC.
$md$
WHERE codigo = 'ATN_EMERG' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- SIG_VIT ------------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Hoja de Signos Vitales** (registros inmutables seriados con alertas EWS).

Cada toma de signos vitales es un registro inmutable en la cadena temporal del expediente. Frecuencia obligatoria según `IND_MED` (q4h, q1h, q15min o continua).

**Campos por toma**: PA, FC, FR, T, SpO2, Glasgow (si aplica), dolor EVA 0-10, peso (si aplica), talla (primera vez), observaciones breves.

**Alertas EWS** (Early Warning Score) disparan Beta.15: PA <90/60 o >180/110, FC <40 o >130, SpO2 <88%, etc.

**Pediatría**: rangos por edad distintos; FLACC/Wong-Baker para dolor en niños no comunicativos.

**Hoja consolidada diaria**: el médico firma una "hoja consolidada" al cierre del día (esa sí es firmable como documento), distinta de las tomas individuales que son automáticamente inmutables.
$md$
WHERE codigo = 'SIG_VIT' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- HOJA_ING -----------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Hoja de Ingreso Hospitalario** (NTEC Art. 34 — apertura formal del episodio hospitalario).

Documento raíz del expediente hospitalario. Su firma habilita la cascada de documentos hospitalarios obligatorios: VAL_INI_ENF (≤24h), IND_MED (diarias), REG_ENF (por turno), SIG_VIT (según frecuencia).

**Campos**: motivo de ingreso, antecedentes patológicos, examen físico completo, diagnóstico principal CIE-10 y secundarios, plan terapéutico, vía de ingreso (URGENCIA/ELECTIVO/REFERIDO), servicio destino, cama asignada.

**Bloquea**: no se puede generar `IND_MED` sin HOJA_ING firmada.

**Drift conocido (HD-01..HD-06)**: schema drift masivo entre router y `ece.hoja_ingreso` real; columnas servicio_ingreso_id/modalidad/procedencia solo en JSONB.
$md$
WHERE codigo = 'HOJA_ING' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- VAL_INI_ENF --------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Valoración Inicial de Enfermería** (NTEC — SLA ≤24h post-admisión hospitalaria).

Valoración integral de enfermería al ingreso: patrones funcionales Gordon (11 patrones), riesgo de caídas (escala Morse 0-125), riesgo de UPP (escala Braden 6-23), riesgo nutricional (MNA), necesidades básicas alteradas, diagnósticos de enfermería (NANDA), plan inicial de cuidados (NIC/NOC).

**SLA 24h dispara alerta Beta.15** si no se firma a tiempo.

**Dependencia bloqueante**: requiere `HOJA_ING` firmado.

**Inmutable post-firma**.

**Drift conocido (HD-19..21)**: RLS faltante en `list`, firma sin PIN, falta trigger de inmutabilidad físico.
$md$
WHERE codigo = 'VAL_INI_ENF' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- IND_MED ------------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Indicaciones Médicas** (NTEC Art. 36 — cierre diario obligatorio en hospitalización).

Documento de prescripción médica diaria en hospitalización (también subset = prescripción ambulatoria). Captura dieta, líquidos IV, medicamentos (con principio activo + presentación + GTIN + dosis + vía + frecuencia + duración), no medicamentosas (curaciones, fisioterapia), exámenes solicitados, vigilancia especial.

**Cierre diario OBLIGATORIO** (Art. 36): las indicaciones del día NO se pueden modificar después del cierre. Cambios requieren NUEVA firma como indicaciones nuevas.

**BCMA 5R**: cada administración dispara `MedicationAdministration` con verificación de los 5 correctos (paciente correcto vía GSRN, medicamento correcto vía GTIN, dosis, vía, hora). Excipientes alergénicos se validan contra alergias del paciente.

**Drift conocido (IND-002/003/004)**: P1/P2 sobre dual workflow/vigencia, MAR outbox dependency, ausencia de bridge inverso ambulatorio→ECE.
$md$
WHERE codigo = 'IND_MED' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- REG_ENF ------------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Registros de Enfermería** (NTEC Art. 37 — continuo por turno: M/T/N).

Documentación del trabajo de enfermería por turno (3 turnos típicos). Captura: nota de evolución, cumplimiento de indicaciones (link a IND_MED items con hora y ejecutor), procedimientos realizados (curaciones, accesos, sondas), ingresos/egresos (balance hídrico), eventos relevantes.

**MAR/Kardex**: las administraciones de medicamentos (BCMA 5R) se registran como sub-tabla `ece.administracion_medicamento` referenciando `indicacion_item_id`.

**Eventos centinela** (caídas, agitación, etc.) disparan alertas Beta.15 a calidad.

**Cierre por turno**: cada turno cerrado se firma; queda inmutable. Los turnos consecutivos NO pueden iniciarse sin el anterior firmado.
$md$
WHERE codigo = 'REG_ENF' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- RRI ----------------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Referencia / Retorno / Interconsulta** (NTEC Art. 38 — documento bisagra entre establecimientos o servicios).

Tres tipos en un solo documento:
- **REFERENCIA** inter-establecimiento: traslado formal con resumen clínico
- **INTERCONSULTA** intra-hospitalaria: solicitud de evaluación de especialista
- **RESUMEN DE TRASLADO**: egreso por transferencia (alternativa a EPICRISIS)

**Campos clave**: establecimiento origen/destino, motivo, resumen clínico actual, exámenes relevantes, medicación actual, estado del paciente al traslado, urgencia, transporte (si referencia).

**Estado del paciente al traslado** es importante para responsabilidad legal — documenta si salió estable, inestable, crítico.

**Eventos**: `rri.firmada`, `rri.en_transito`, `rri.recibida` (establecimiento destino confirma), `rri.respondida` (interconsulta cerrada).
$md$
WHERE codigo = 'RRI' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- EPICRISIS ----------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Epicrisis de Egreso** (NTEC Arts. 21/41/42 — cierre formal del episodio hospitalario).

Documento resumen del episodio hospitalario, base para continuidad ambulatoria y reporte ISSS/SNIS. Captura: fechas ingreso/egreso, estancia, diagnóstico principal/secundarios CIE-10 al egreso, procedimientos realizados CIE-9/10 PCS, resumen de evolución, exámenes relevantes, complicaciones, condición de egreso, recomendaciones, medicación al alta, control indicado.

**Condición de egreso determina cascada**:
- MEJORADO / SIN_CAMBIOS / EMPEORADO / ALTA_VOLUNTARIA → cierre normal
- TRASLADO → dispara `RRI` asociado
- DEFUNCIÓN → flujo cambia a `CERT_DEF` (esta epicrisis NO se usa)

**Inmutable post-firma**. Rectificación vía `RECT`.

**Entrega física**: paciente o familiar firma "recibido" con copia impresa.
$md$
WHERE codigo = 'EPICRISIS' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- PROG_QX ------------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Programación Quirúrgica** (planeación previa quirófano + equipo + anestesia).

Asigna sala, equipo quirúrgico (cirujano principal + ayudantes + instrumentista + circulante), anestesiólogo, fecha/hora, duración estimada, tipo de anestesia planeada, insumos especiales, riesgo ASA, complejidad.

**Bloqueante**: requiere `CONS_QX` firmado pre-fecha.

**Estados específicos** (variante del estándar): SOLICITADA → ASIGNADA → CONFIRMADA → EJECUTADA / REPROGRAMADA / CANCELADA.

**Drift conocido**: la tabla `ece.programacion_quirurgica` NO existe — la BD usa `ece.reserva_sala_qx` (DDL en `99_sala_qx_reserva_sala_qx.sql`, aún no aplicado a prod según HE-01 P0). El flujo opera como bridge atómico sobre `orden_ingreso + episodio + preop_checklist + reserva_sala_qx`.
$md$
WHERE codigo = 'PROG_QX' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- PREOP_CHECK --------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Valoración Preoperatoria** (NTEC Art. 28 — lista de verificación + pre-anestésica).

Valoración integral pre-quirúrgica del anestesiólogo: riesgo ASA (I-V/VI), ayuno (8h sólidos / 2h líquidos claros), alergias medicamentosas, premedicación indicada, evaluación de vía aérea (Mallampati I-IV, tiromentoniana), exámenes solicitados (hemograma, química, EKG si ≥40 años), patologías previas relevantes.

**Bloqueante de cirugía electiva**: sin PREOP firmado, no se puede iniciar `WHO_CHECK`.

**En urgencia**: documentación abreviada permitida con justificación.

**Inmutable post-firma del anestesiólogo** (trigger `trg_preop_immutable`).
$md$
WHERE codigo = 'PREOP_CHECK' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- WHO_CHK ------------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**WHO Surgical Safety Checklist** (TDR §13.3 — estándar OMS 2009, 3 pausas obligatorias).

Las 3 pausas reducen mortalidad quirúrgica 36% (Haynes et al., NEJM 2009):
1. **SIGN-IN** (antes de inducción): paciente identificado, procedimiento correcto, sitio marcado, consentimiento firmado, alergias revisadas, vía aérea difícil evaluada, riesgo sangrado evaluado.
2. **TIME-OUT** (antes de incisión): equipo se presenta, paciente/procedimiento/sitio confirmado, antibiótico profiláctico ≤60 min, imágenes disponibles, preocupaciones anticipadas.
3. **SIGN-OUT** (antes de salir): procedimiento realizado registrado, conteo de instrumental/gasas completo, muestras etiquetadas, problemas de equipo, consideraciones de recuperación.

**Discrepancia en cualquier pausa DETIENE el procedimiento**.

**Avance lineal**: estados `iniciado → sign_in_completo → time_out_completo → completo` — no se puede saltar.
$md$
WHERE codigo = 'WHO_CHK' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- ACTO_QX ------------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Acta Quirúrgica** (NTEC Arts. 19/23/40/42 — nota operatoria del cirujano).

Documento clínico-legal crítico que el cirujano principal firma post-cirugía. Diagnóstico postoperatorio puede diferir del preoperatorio (típico). Procedimiento CIE-9/10 PCS real puede diferir del programado.

**Campos**: fecha/hora inicio/fin reales, duración, equipo real, vía de abordaje, hallazgos intraoperatorios, técnica detallada, piezas anatómicas enviadas a patología, transfusiones intraoperatorias, complicaciones, sangrado estimado, conteo final de instrumental, estado del paciente al salir, destino postoperatorio (URPA/UCI/PISO).

**Eventos disparados al firmar**: `act_qx.firmada`, `act_qx.transfusion_registrada` (banco sangre), `act_qx.pieza_a_patologia` (orden RES_EST automática), `act_qx.complicacion_registrada` (calidad).

**Inmutable post-firma** (trigger `fn_bloquea_mutacion_acto_qx`).
$md$
WHERE codigo = 'ACTO_QX' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- REG_ANEST ----------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Registro Anestésico** (TDR §13.4 — monitoreo intraoperatorio cada 5 min).

Documento del anestesiólogo: tipo de anestesia real (GENERAL/REGIONAL_EPI/REGIONAL_RAQ/BLOQUEO/SEDACION), agentes anestésicos (nombre + dosis + vía + horas), premedicación, vía aérea manejada (MASCARILLA/TOT/MASCARA_LARINGEA/TRAQUEOSTOMIA), monitoreo estándar (EKG continuo + SpO2 + capnografía + PANI + temperatura + BIS si aplica).

**Registros periódicos cada 5 min mínimo**: PA, FC, SpO2, etCO2, temperatura — append-only en JSONB.

**Capnografía OBLIGATORIA en anestesia general**.

**Complicaciones anestésicas son evento centinela** (alerta crítica calidad).

**Hora de extubación** marca fin de cuidado anestésico activo; paciente entregado a `URPA` con firma de recepción.
$md$
WHERE codigo = 'REG_ANEST' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- URPA ---------------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Recuperación Post-Anestésica (URPA/PACU)** (TDR §13.5 — vigilancia postoperatoria inmediata).

Documento de enfermería de URPA + validación de alta por anestesiólogo. SV cada 15 min mínimo, escala Aldrete modificada (0-10: actividad + respiración + circulación + conciencia + SpO2), dolor EVA, analgesia administrada, antieméticos, PONV (náuseas/vómitos postoperatorios), sangrado en drenajes, temperatura (vigilar hipotermia post-anestésica).

**Criterios de alta Aldrete ≥9 + validación del anestesiólogo** (no solo enfermería) → destino post-URPA: HOSPITALIZACIÓN_PISO / UCI / ALTA_DOMICILIO_AMB.

**Drift conocido (HF-URPA-01 P0)**: actualmente `darAlta` permite NURSE sin firma del anestesiólogo — viola Art. 39 NTEC. Pendiente fix.
$md$
WHERE codigo = 'URPA' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- PARTOGRAMA ---------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Partograma OMS** (vigilancia gráfica del trabajo de parto).

Registro continuo de la evolución del trabajo de parto siguiendo el partograma estándar OMS 1994: dilatación cervical (0-10cm), descenso de la cabeza (planos de Hodge 0-IV), frecuencia cardíaca fetal (basal + cambios), contracciones uterinas (frecuencia + duración + intensidad), ruptura de membranas, medicación uterotónica (oxitocina dosis), analgesia obstétrica, SV maternos.

**Líneas de alerta y acción OMS**: si la curva de dilatación cruza la línea de alerta (1cm/h en fase activa ≥4cm) → reevaluación urgente. Cruzar la línea de acción (4h a la derecha) → intervención inmediata (cesárea, instrumentación).

**Frecuencia de registro**: cada 30 min mínimo en fase activa.

**Registros son inmutables** (cadena temporal append-only).
$md$
WHERE codigo = 'PARTOGRAMA' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- SALA_EXPULSION -----------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Sala de Expulsión (Parto)** (NTEC obstetricia — documento del evento del parto vaginal).

Captura el evento del parto: hora exacta de nacimiento (BASE LEGAL para acta de nacimiento), tipo de parto (EUTOCICO/DISTOCICO/INSTRUMENTAL_FORCEPS/VENTOSA), posición, episiotomía (SI/NO + tipo), desgarro perineal (grado 0-IV), duración de los períodos del parto, placenta (íntegra/retenida + manejo), sangrado estimado, complicaciones maternas.

**Cesárea NO va aquí** — va a `ACTO_QX`.

**Dispara cascada**: `sala_exp.rn_nacido_vivo` → `ATN_RN` (siempre); `sala_exp.nrp_requerido` → `NRP` (solo si reanimación).

**Eventos JSONB en columna `eventos`** (HF-10 ALTER pendiente prod): amniorrexis, tactos vaginales, analgesia obstétrica, complicaciones — todos con timestamp.
$md$
WHERE codigo = 'SALA_EXPULSION' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- ATN_RN -------------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Atención del Recién Nacido** (NTEC obstetricia/neonatal — todo nacido vivo).

Documento del recién nacido vivo. Apgar (estándar internacional) al 1' y 5' (y 10' si <7 a 5'), peso/talla/perímetros cefálico y torácico, edad gestacional (Capurro o Ballard), clasificación somatométrica (AEG/PEG/GEG), examen físico segmentario, malformaciones aparentes.

**Procedimientos obligatorios documentados**: screening neonatal (TSH, fenilcetonuria), vitamina K administrada, profilaxis ocular, vacunas BCG + HepB dosis 0 según calendario SV, contacto piel a piel iniciado, lactancia inmediata.

**Abre expediente del RN** como paciente distinto (creación atómica de `Patient` + `ece.paciente` + `documento_instancia` + outbox en una sola transacción).

**Apgar <7 a 5' dispara `NRP` requerido**.
$md$
WHERE codigo = 'ATN_RN' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- NRP ----------------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Reanimación Neonatal (NRP)** (AAP/AHA NRP Program, 8ª ed. 2021 — condicional).

Documento del evento de reanimación neonatal. Pasos NRP secuenciales obligatorios: calor/secado/estimulación → vía aérea aspirada → VPP (presión positiva ventilación) → corrección MR_SOPA → intubación orotraqueal → compresiones torácicas → medicamentos (adrenalina, solución salina expansor).

**Frecuencia cardíaca es el indicador principal** (registros seriados durante reanimación).

**Resultado** (enum `ece.resultado_nrp` — mixed-case `{estable, cuidados_intermedios, UCIN, defuncion}` — HF-22 confirmado): RECUPERADO/UCIN/FALLECIDO. UCIN dispara apertura de expediente UCIN. FALLECIDO dispara `CERT_DEF` neonatal.

**Registro de tiempos crítico para defensa legal**.
$md$
WHERE codigo = 'NRP' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- CERT_DEF -----------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Certificado de Defunción** (documento legal con CIE-10 estructurado).

Documento legal de la defunción, base para registro civil RNPN, mortalidad SNIS, reporte forense si aplica. Estructura OMS-CIE-10: causa directa + causas intermedias (orden cronológico inverso) + **causa básica única** (ancla de mortalidad SNIS) + causas concomitantes.

**Tipo de defunción**: NATURAL / VIOLENTA / SOSPECHOSA. Las dos últimas requieren forense + cadena de custodia + notificación a Fiscalía.

**Campos especiales OMS**: mujer en edad fértil → embarazo presente/reciente?; menor de 1 año → causas perinatales específicas.

**Dispara cascada al firmar**: notificación a registro civil, reporte SNIS automático, `CERT_DIR` (revisión administrativa del director).

**Inmutable post-firma**. Corrección vía `RECT` (no modifica el original).
$md$
WHERE codigo = 'CERT_DEF' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- ORD_ING ------------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Orden de Ingreso** (orden médica formal de hospitalización antes de la admisión).

Documento previo a `HOJA_ING`. El médico tratante emite la orden con: diagnóstico que justifica el ingreso, servicio destino, cama solicitada, urgencia, vía (electivo/urgencia/referido). Admisión recibe esta orden y procesa el ingreso administrativo + clínico.

**Estados típicos**: borrador → en_revision → firmado (médico) → validado (admisión confirma cama disponible) → anulado (si paciente no se presenta).

**Dispara `HOJA_ING`** una vez admitido formalmente.
$md$
WHERE codigo = 'ORD_ING' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- CERT_INC -----------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Certificado de Incapacidad ISSS** (incapacidad temporal por enfermedad común / accidente).

Documento que emite el médico para justificar la incapacidad laboral del paciente ante el ISSS (Instituto Salvadoreño del Seguro Social). Tipos: enfermedad común, accidente de trabajo, enfermedad profesional, maternidad (pre/post parto).

**Campos**: NIT/ISSS del paciente, empleador, diagnóstico CIE-10, fecha inicio incapacidad, días de incapacidad, fecha probable de reincorporación.

**Integración ISSS**: el documento se reporta al portal ISSS (cuando esté integrado en Fase 3+).

**Inmutable post-firma**. Renovación = nuevo certificado, no modificación.
$md$
WHERE codigo = 'CERT_INC' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- DOC_ASOC -----------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Documentos Clínicos Asociados** (catch-all para documentos no estructurados).

Tipo genérico para adjuntar documentos al expediente que no encajan en los tipos formales (eg. carta de remisión externa escaneada, fotografía clínica, video de procedimiento, PDF de estudio externo).

**Uso responsable**: no usar como reemplazo de los tipos formales. Si el documento corresponde a un tipo NTEC formal, usar ese tipo.

**Campos mínimos**: descripción, archivo (storage), fecha del documento, autor (si conocido), tipo (foto/video/PDF/escaneo).
$md$
WHERE codigo = 'DOC_ASOC' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

-- DOC_OBST -----------------------------------------------------------
UPDATE ece.tipo_documento SET descripcion_markdown = $md$
**Documentos Obstétricos** (tipo genérico ginecología/obstetricia legacy).

**Nota de drift**: este tipo genérico precedía a los tipos específicos `PARTOGRAMA`, `SALA_EXPULSION`, `ATN_RN`, `NRP`. Para nuevos documentos obstétricos, usar los tipos específicos correspondientes.

Permanece para compatibilidad histórica con documentos obstétricos ya capturados antes de la migración a tipos específicos.
$md$
WHERE codigo = 'DOC_OBST' AND (descripcion_markdown IS NULL OR length(descripcion_markdown) = 0);

COMMIT;
