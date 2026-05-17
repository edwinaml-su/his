# Análisis de Workflows de Atención al Paciente y Especificaciones para Expediente Clínico Electrónico (ECE)

> **Documento técnico de arquitectura HIS — El Salvador**
> Elaborado desde la perspectiva de Arquitectura de Sistemas de Información Hospitalaria, con fundamento normativo en MINSAL e ISSS.

---

## 0. Marco Normativo de Referencia

| Instrumento | Referencia | Aplicación al ECE |
|---|---|---|
| **Norma técnica del expediente clínico** | Acuerdo n.° 1616, MINSAL, 30/05/2024 (D.O. T.444, N°158, 22/08/2024). Reforma D.O. n.°55, T.450, 19/03/2026 | Conjunto mínimo de variables, validez legal del soporte electrónico, firma electrónica simple, auditoría de accesos |
| **Ley del Sistema Nacional Integrado de Salud (SNIS)** | Arts. 24, 25, 26 | Crea el Sistema Único de Información en Salud y el **expediente médico único por usuario** disponible en forma digital para todos los prestadores públicos |
| **Ley de Deberes y Derechos de los Pacientes y Prestadores de Servicios de Salud** | Art. 5 lit. a) | Sustento del consentimiento informado y derechos del paciente |
| **Ley de Protección de Datos Personales** | Arts. 9 y 18 | Derechos de acceso, rectificación y supresión sobre el expediente |
| **Procesos ISSS** | Reglamentación interna ISSS (afiliación, derechohabiencia, incapacidades) | Verificación de afiliación, certificado de incapacidad temporal, expediente único institucional |

**Conceptos normativos clave (Art. 4 NTEC) que el ECE debe modelar como estados o catálogos:**

- **Alta ambulatoria:** finalización del tratamiento ambulatorio por el profesional de salud.
- **Alta médica:** certificación del médico tratante que da por finalizados los tratamientos.
- **Egreso hospitalario:** registro de salida de un paciente que ocupó cama de hospitalización, cumplidos los trámites médico-administrativos (incluye dados de alta y fallecidos).
- **Hospital de día:** internamiento por plazo menor a 24 horas.
- **In extremis:** paciente en fase final que se envía a casa para cuidados paliativos.
- **Modalidad:** ambulatoria (presencial / telesalud) u hospitalaria (hospital de día / hospitalización).
- **Expediente activo / pasivo:** activo con registros continuos; pasivo sin registro en los últimos 5 años.
- **Firma electrónica simple:** datos electrónicos para identificar al firmante y aprobar la información del registro (obligatoria por profesional).
- **Módulo RRI (SIS):** Referencia, Retorno e Interconsulta.
- **Identificadores:** CUN (Código Único de Nacimiento), NUI (Número Único de Identidad), DUI, pasaporte.

---

# FASE 1 — Mapeo de Workflows y Áreas Físicas

## A. Proceso Ambulatorio (Consulta Externa / Emergencia sin ingreso)

- **1. Captación / Llegada del usuario**
    - Área: **Recepción / Información**
    - Sub-flujo:
        - Solicitud espontánea, cita previa o referencia (módulo RRI)
        - Verificación de modalidad: presencial o telesalud
- **2. Identificación y creación/recuperación del expediente**
    - Área: **Archivo Clínico / ESDOMED (Estadística y Documentos Médicos)**
    - Sub-flujo:
        - Verificación de identidad (DUI / partida o carnet de minoridad / pasaporte)
        - Búsqueda en sistema por NUI / DUI / parámetros
        - Si no existe: creación de **Ficha de Identificación** y número de expediente único
        - Si existe: actualización de datos demográficos
        - Caso paciente desconocido / situación de calle / inconsciente: registro como "desconocido" con observaciones
- **3. Admisión administrativa**
    - Área: **Admisión / Atención al Cliente** (ISSS: ventanilla de afiliación)
    - Sub-flujo:
        - MINSAL: registro de gratuidad / datos administrativos del establecimiento
        - ISSS: verificación de **derechohabiencia** (afiliado cotizante, beneficiario, pensionado), número patronal
- **4a. Triaje / Clasificación (ruta Emergencia)**
    - Área: **Triaje / Selección**
    - Sub-flujo:
        - Toma de signos vitales y motivo de consulta
        - Clasificación por prioridad (sistema de niveles tipo ESI/Manchester según protocolo institucional)
        - Asignación a consultorio de emergencia / observación
- **4b. Sala de espera (ruta Consulta Externa)**
    - Área: **Sala de espera de consulta externa**
- **5. Toma de signos vitales / preconsulta**
    - Área: **Estación de enfermería / Preconsulta**
    - Sub-flujo:
        - Control de constantes vitales (procedimiento normalizado de enfermería)
        - Antropometría según curso de vida
        - Registro en hoja de signos vitales
- **6. Atención clínica / Consulta**
    - Área: **Consultorio de Consulta Externa** o **Consultorio / Box de Emergencia**
    - Sub-flujo:
        - Anamnesis e historia clínica (primera vez) o nota de evolución (subsecuente)
        - Examen físico
        - Diagnóstico (CIE-10)
        - Plan: manejo clínico, indicaciones, órdenes de laboratorio/gabinete
        - Decisión de disposición: alta ambulatoria / referencia / observación / orden de ingreso
- **7. Apoyo diagnóstico (si aplica)**
    - Área: **Laboratorio Clínico / Imagenología / Gabinete**
    - Sub-flujo:
        - Toma de muestra / estudio (módulo RELAB para laboratorio en SIS)
        - Resultado adjunto al expediente
- **8. Farmacia / Dispensación**
    - Área: **Farmacia**
    - Sub-flujo:
        - Validación de receta contra indicaciones médicas
        - Dispensación y registro
- **9. Procedimientos menores / Curaciones (si aplica)**
    - Área: **Sala de procedimientos / Inyectables / Curaciones**
- **10. Observación en emergencia (si aplica, < 24 h, sin ingreso)**
    - Área: **Sala de Observación**
    - Sub-flujo:
        - Reevaluaciones médicas y de enfermería
        - Decisión: alta ambulatoria u orden de ingreso (cruza a flujo hospitalario)
- **11. Cierre administrativo / Caja (ISSS u oferta privada)**
    - Área: **Caja / Colecturía** (en MINSAL la atención es gratuita; aplica ISSS para no derechohabientes o servicios particulares)
    - Sub-flujo:
        - ISSS: emisión de **certificado de incapacidad** cuando aplica
- **12. Alta ambulatoria y devolución del expediente**
    - Área: **Archivo Clínico**
    - Sub-flujo:
        - Registro de alta ambulatoria
        - Devolución del expediente físico al archivo (plazo ≤ 48 h) o cierre del registro electrónico

## B. Proceso Hospitalario (desde orden de ingreso hasta alta administrativa)

- **1. Origen del ingreso**
    - Área: **Emergencia**, **Consulta Externa** o **traslado de otro hospital/servicio**
    - Sub-flujo:
        - Circunstancia: demanda espontánea, programado, riesgo social, traslado
        - Emisión de **Orden de Ingreso** por médico tratante
- **2. Admisión hospitalaria**
    - Área: **Admisión / Atención al Cliente**
    - Sub-flujo:
        - Apertura del episodio de hospitalización
        - Asignación de servicio y cama
        - ISSS: verificación de derechohabiencia y registro patronal
        - Identificación del paciente (brazalete) y del responsable
- **3. Consentimiento informado**
    - Área: **Admisión / Servicio de Hospitalización**
    - Sub-flujo:
        - Consentimiento de hospitalización
        - Consentimientos específicos según procedimiento previsto
- **4. Ingreso al servicio de hospitalización**
    - Área: **Sala/Servicio de Hospitalización** (Medicina, Cirugía, Pediatría, Gineco-Obstetricia, etc.)
    - Sub-flujo:
        - Historia clínica de ingreso completa por médico tratante
        - Recepción de enfermería: valoración inicial, signos vitales, plan de cuidados
        - Indicaciones médicas iniciales
- **5. Estancia hospitalaria / Seguimiento**
    - Área: **Servicio de Hospitalización**
    - Sub-flujo:
        - Notas de evolución médica diarias (médico de cabecera / médico de turno)
        - Indicaciones médicas (revisión diaria)
        - Registro de enfermería y hoja de signos vitales por turno
        - Administración de medicamentos (kardex)
        - Solicitud y resultado de exámenes de laboratorio y gabinete
- **6. Interconsulta (si aplica)**
    - Área: **Servicio de Hospitalización (cabecera del paciente)**
    - Sub-flujo:
        - Solicitud de interconsulta a especialista (módulo RRI)
        - Nota de respuesta del especialista en el expediente
- **7. Ruta quirúrgica (si aplica)**
    - **7.1 Valoración preoperatoria**
        - Área: **Consulta preanestésica / Servicio**
        - Sub-flujo: nota preoperatoria, valoración anestésica, riesgo quirúrgico, consentimiento quirúrgico y anestésico
    - **7.2 Preparación**
        - Área: **Hospitalización / Área preoperatoria**
    - **7.3 Acto quirúrgico**
        - Área: **Sala de Operaciones / Pabellón Quirúrgico**
        - Sub-flujo: lista de verificación de cirugía segura, registro anestésico, descripción operatoria
    - **7.4 Recuperación postanestésica**
        - Área: **Sala de Recuperación (URPA)**
        - Sub-flujo: monitoreo postanestésico, criterios de egreso de recuperación
    - **7.5 Cuidados críticos (si aplica)**
        - Área: **UCI / UCIN / Cuidados Intermedios**
- **8. Ruta obstétrica (si aplica)**
    - Área: **Labor y Parto / Sala de Expulsión / Puerperio**
    - Sub-flujo: partograma, hoja de labor de parto, atención del recién nacido (creación automática de expediente al nacimiento en MINSAL)
- **9. Decisión y orden de egreso**
    - Área: **Servicio de Hospitalización**
    - Sub-flujo:
        - Médico tratante certifica alta médica
        - Tipo de egreso: vivo o fallecido
        - Circunstancia: alta hospitalaria, referido a otro hospital, alta voluntaria, fuga, in extremis, alta rehabilitada (ISRI)
- **10. Elaboración de epicrisis / resumen de egreso**
    - Área: **Servicio de Hospitalización**
    - Sub-flujo: hoja de egreso/epicrisis, indicaciones de alta, citas de seguimiento, receta de egreso
- **11. Egreso administrativo**
    - Área: **Caja / Colecturía (ISSS o particular)** y **Admisión**
    - Sub-flujo:
        - Liberación de cama (censo de movimiento diario)
        - ISSS: certificado de incapacidad / trámites de derechohabiente
        - Caso fallecido: certificado de defunción, entrega de cuerpo, morgue
- **12. Cierre clínico-documental y archivo**
    - Área: **ESDOMED / Archivo Clínico**
    - Sub-flujo:
        - Verificación de integridad documental del episodio
        - Codificación CIE-10 de egreso
        - Foliado (si requerido) y archivo / cierre del episodio electrónico

---

# FASE 2 — Matriz de Documentación, Roles y Aprobaciones

> **Roles normalizados:** ADM (Administrativo) · AC (Atención al Cliente) · ARCH (Archivo/ESDOMED) · ENF (Enfermería) · MT (Médico de Turno) · MC (Médico de Cabecera/Tratante) · ESP (Especialista) · IC (Interconsultante) · DIR (Dirección del establecimiento)

## 2.1 Proceso Ambulatorio

| Paso del Workflow | Documento / Formulario Requerido | Rol que lo Llena | Aprobaciones / Firmas Requeridas |
|---|---|---|---|
| Identificación y creación de expediente | Ficha / Hoja de Identificación del Expediente Clínico (Art. 15 NTEC) | ARCH | Firma del responsable de toma de datos (ARCH) |
| Admisión administrativa | Registro administrativo del establecimiento / Verificación de afiliación (ISSS) | ADM / AC | Sello/usuario de admisión |
| Triaje (Emergencia) | Hoja de Triaje / Clasificación de Emergencia | ENF (o MT según protocolo) | Firma electrónica simple de enfermería |
| Preconsulta / signos vitales | Hoja de Signos Vitales / Control de Constantes Vitales | ENF | Firma electrónica simple ENF |
| Consulta de primera vez | Historia Clínica (anamnesis + examen físico) | MC / MT | Firma electrónica simple del médico que atiende |
| Consulta subsecuente | Hoja / Nota de Evolución Médica | MC / MT | Firma electrónica simple del médico |
| Consulta de Emergencia | Hoja de Atención de Emergencia | MT | Firma electrónica simple MT |
| Plan terapéutico | Hoja de Indicaciones Médicas / Receta | MC / MT | Firma del médico prescriptor |
| Orden de estudios | Solicitud de Laboratorio y Gabinete (RELAB en SIS) | MC / MT | Firma del médico solicitante |
| Resultado de estudios | Informe de Laboratorio / Gabinete | Profesional de apoyo diagnóstico | Firma/validación del responsable de laboratorio o imagenología |
| Procedimiento menor | Nota de Procedimiento + Consentimiento Informado (cuando aplique) | MC / MT / ENF | Firma del profesional + firma del paciente/responsable en consentimiento |
| Referencia a otro nivel | Hoja de Referencia, Retorno e Interconsulta (RRI) | MC / MT | Firma del médico que refiere; sello del establecimiento |
| Observación en emergencia | Hoja de Observación + Notas de evolución + Registro de enfermería | MT + ENF | Firma de médico y enfermería por turno |
| Certificado de incapacidad (ISSS) | Certificado de Incapacidad Temporal para el Trabajo | MC / MT autorizado | Firma y sello del médico autorizado por ISSS |
| Alta ambulatoria | Registro de Alta Ambulatoria en el expediente | MC / MT | Firma del médico tratante |
| Devolución del expediente | Registro de movimiento del expediente clínico (Art. 30 NTEC) | ARCH | Firma de quien traslada y de archivo |

## 2.2 Proceso Hospitalario

| Paso del Workflow | Documento / Formulario Requerido | Rol que lo Llena | Aprobaciones / Firmas Requeridas |
|---|---|---|---|
| Orden de ingreso | Orden de Ingreso Hospitalario | MT / MC | Firma electrónica simple del médico que ordena el ingreso |
| Admisión hospitalaria | Hoja de Ingreso / Apertura de Episodio + Identificación (Art. 15) | ADM / AC + ARCH | Firma de admisión; verificación de identidad |
| Consentimiento de hospitalización | Consentimiento Informado de Hospitalización | MC / MT explica; paciente/responsable firma | Firma del paciente o representante legal + firma del médico que informa |
| Historia clínica de ingreso | Historia Clínica de Ingreso (anamnesis, examen físico, impresión diagnóstica) | MC (médico tratante) | Firma electrónica simple del médico tratante |
| Valoración de enfermería al ingreso | Hoja de Valoración / Recepción de Enfermería + Plan de Cuidados | ENF | Firma electrónica simple ENF |
| Indicaciones iniciales | Hoja de Indicaciones Médicas | MC / MT | Firma del médico; verificación de transcripción por ENF |
| Seguimiento médico | Hoja de Evolución Médica (diaria) | MC / MT | Firma electrónica simple por nota |
| Seguimiento de enfermería | Registro de Enfermería + Hoja de Signos Vitales + Kardex de medicamentos | ENF | Firma electrónica simple por turno |
| Interconsulta | Hoja / Boleta de Interconsulta (solicitud y respuesta) – módulo RRI | MC solicita / IC responde | Firma del solicitante y firma del interconsultante |
| Solicitud y resultado de estudios | Solicitud de Laboratorio/Gabinete + Informe de resultados | MC / MT solicita; apoyo diagnóstico informa | Firma del solicitante y del responsable del informe |
| Valoración preoperatoria | Nota Preoperatoria + Valoración Anestésica + Riesgo Quirúrgico | MC/ESP + Anestesiólogo | Firma del cirujano y del anestesiólogo |
| Consentimiento quirúrgico/anestésico | Consentimiento Informado Quirúrgico y Anestésico | ESP/Anestesiólogo informa; paciente firma | Firma del paciente/representante + firma de los médicos |
| Acto quirúrgico | Lista de Verificación de Cirugía Segura + Nota / Descripción Operatoria | Equipo quirúrgico / Cirujano | Firma del cirujano responsable; verificación de checklist por equipo |
| Anestesia | Registro Anestésico (transanestésico) | Anestesiólogo | Firma del anestesiólogo |
| Recuperación postanestésica | Hoja de Recuperación (URPA) | ENF + Anestesiólogo | Firma de egreso de recuperación (criterios) |
| Atención obstétrica | Partograma + Hoja de Labor de Parto + Hoja de Sala de Expulsión | MC/ESP + ENF/Obstetra | Firma del médico/obstetra que atiende el parto |
| Atención del recién nacido | Hoja de Atención del Recién Nacido + creación automática de expediente | MC/Neonatólogo + ENF | Firma del responsable de la atención neonatal |
| Orden de egreso | Orden de Egreso / Certificación de Alta Médica | MC (médico tratante) | Firma electrónica simple del médico tratante |
| Resumen de egreso | Epicrisis / Hoja de Egreso + Indicaciones de Alta + Receta de egreso | MC | Firma del médico tratante; visto del jefe de servicio si aplica |
| Egreso de paciente fallecido | Certificado de Defunción + Acta de entrega de cuerpo | MC certifica defunción | Firma del médico que certifica; registro de morgue |
| Egreso administrativo | Censo de movimiento diario + liberación de cama + (ISSS) incapacidad | ADM / AC | Sello administrativo de egreso |
| Codificación y cierre | Codificación CIE-10 de egreso + verificación de integridad documental | ARCH / ESDOMED | Visto del Comité del Expediente Clínico/SIS para auditoría |
| Archivo / certificación | Foliado y archivo (Art. 19–21 NTEC); Certificación administrativa (Anexo 1) | ARCH | Solo DIR o su delegado autoriza certificar copia del expediente |

> **Nota de gobierno documental (Art. 21 y 32 NTEC):** la **dirección del establecimiento o su delegado** son los **únicos autorizados** para certificar copias del expediente y para autorizar la entrega a autoridad judicial o competente. El ECE debe modelar este rol como nivel de aprobación restringido y auditable.

---

# FASE 3 — Diccionario de Datos del ECE

> **Convenciones de modelado:**
> - **Tipo de Registro:** `Maestro` (entidad de referencia estable), `Transaccional` (evento de atención), `Histórico` (inmutable / versionado para auditoría).
> - **Dependencia:** documento(s) que deben existir antes de poder crear el registro.
> - Todo formulario transaccional debe portar **metadatos obligatorios (Art. 55–56 NTEC):** `usuario_creador`, `firma_electronica_simple`, `timestamp` (fecha, hora, minuto, segundo), `establecimiento_id`, `institucion_id`, y bitácora de modificaciones inmutable conservada **mínimo 2 años**.

---

### 3.1 Ficha / Hoja de Identificación del Expediente Clínico

- **Objetivo Legal/Médico:** Estandariza el conjunto mínimo de variables de identificación (Art. 15 NTEC); constituye la raíz del expediente médico único por usuario (Ley SNIS).
- **Tipo de Registro:** **Maestro**
- **Dependencia:** Ninguna (es el documento raíz). En MINSAL se habilita automáticamente para recién nacidos de parto hospitalario.
- **Estructura de Datos Sugerida:**

```json
{
  "formulario": "ficha_identificacion",
  "tipo_registro": "maestro",
  "campos": {
    "numero_expediente": "string (único por establecimiento)",
    "identificadores": {
      "NUI": "string",
      "CUN": "string|null",
      "DUI": "string|null",
      "carnet_minoridad": "string|null",
      "pasaporte": "string|null",
      "documento_no_presentado": "boolean",
      "tipo_registro_identidad": "enum[verificado, version_paciente, version_responsable, desconocido]"
    },
    "datos_paciente": {
      "primer_nombre": "string", "segundo_nombre": "string|null",
      "primer_apellido": "string", "segundo_apellido": "string|null",
      "fecha_nacimiento": "date", "sexo": "enum",
      "estado_familiar": "enum", "nacionalidad": "string",
      "direccion": "string", "telefono": "string",
      "ocupacion": "string|null"
    },
    "datos_responsable": {
      "nombre": "string", "parentesco": "string",
      "documento": "string", "telefono": "string"
    },
    "datos_afiliacion_ISSS": {
      "numero_afiliado": "string|null",
      "tipo_derechohabiente": "enum[cotizante, beneficiario, pensionado]|null",
      "numero_patronal": "string|null"
    },
    "informante": "string",
    "observaciones": "text",
    "responsable_toma_datos": "string (usuario ARCH)",
    "fecha_hora_creacion": "datetime"
  },
  "restricciones_calidad": [
    "numero_expediente único e inmutable; prohibido duplicar (Art.14g unifica si ocurre)",
    "NUI obligatorio; no se modifica al corregir CUN",
    "menores requieren partida de nacimiento o carnet de minoridad",
    "mayores de 18: DUI; extranjeros: pasaporte u otro documento legal",
    "paciente desconocido => marcar y justificar en observaciones"
  ]
}
```

---

### 3.2 Historia Clínica

- **Objetivo Legal/Médico:** Documento base de la atención clínica; respaldo legal y fuente primaria de vigilancia epidemiológica, investigación y docencia (Art. 4.14 NTEC).
- **Tipo de Registro:** **Transaccional** (instancia por episodio) con tratamiento **Histórico** (no se borra; se rectifica con trazabilidad — Art. 42 NTEC).
- **Dependencia:** Requiere Ficha de Identificación creada.
- **Estructura de Datos Sugerida:**

```json
{
  "formulario": "historia_clinica",
  "tipo_registro": "transaccional",
  "campos": {
    "expediente_id": "FK ficha_identificacion (obligatorio)",
    "episodio_id": "FK episodio_atencion",
    "tipo_consulta": "enum[primera_vez, subsecuente]",
    "motivo_consulta": "text",
    "enfermedad_actual": "text",
    "antecedentes": {
      "personales_patologicos": "text",
      "familiares": "text",
      "gineco_obstetricos": "text|null",
      "alergias": "array",
      "habitos": "text"
    },
    "examen_fisico": {
      "signos_vitales_ref": "FK hoja_signos_vitales",
      "hallazgos_por_sistema": "text"
    },
    "diagnostico": [{ "cie10": "string", "tipo": "enum[presuntivo, definitivo]" }],
    "plan": {
      "manejo_clinico": "text",
      "indicaciones_ref": "FK indicaciones_medicas|null",
      "ordenes_estudios": "array<FK solicitud_estudio>|null",
      "disposicion": "enum[alta_ambulatoria, referencia, observacion, orden_ingreso]"
    },
    "metadatos": "ver bloque metadatos obligatorios"
  },
  "restricciones_calidad": [
    "diagnóstico codificado en CIE-10 obligatorio al cierre",
    "modificación solo vía rectificación con registro de usuario+timestamp+detalle (Art.42)",
    "firma electrónica simple del médico obligatoria para validar"
  ]
}
```

---

### 3.3 Hoja de Signos Vitales / Control de Constantes Vitales

- **Objetivo Legal/Médico:** Registro objetivo y seriado del estado fisiológico; soporte de decisiones de triaje y seguimiento.
- **Tipo de Registro:** **Transaccional** (alta frecuencia, series temporales).
- **Dependencia:** Requiere expediente/episodio; en hospitalización depende del Ingreso.
- **Estructura de Datos Sugerida:**

```json
{
  "formulario": "signos_vitales",
  "tipo_registro": "transaccional",
  "campos": {
    "episodio_id": "FK (obligatorio)",
    "fecha_hora_toma": "datetime",
    "presion_arterial": "string (sistólica/diastólica)",
    "frecuencia_cardiaca": "int",
    "frecuencia_respiratoria": "int",
    "temperatura": "decimal",
    "saturacion_o2": "int",
    "antropometria": { "peso": "decimal", "talla": "decimal", "imc": "decimal|calculado", "perimetro_cefalico": "decimal|null" },
    "escala_dolor": "int|null",
    "responsable": "FK usuario (ENF)",
    "metadatos": "ver bloque metadatos obligatorios"
  },
  "restricciones_calidad": [
    "valores con rango fisiológico validado por curso de vida",
    "registro inmutable; corrección por rectificación trazable",
    "timestamp obligatorio a nivel segundo"
  ]
}
```

---

### 3.4 Hoja de Triaje / Clasificación de Emergencia

- **Objetivo Legal/Médico:** Prioriza la atención por gravedad; evidencia médico-legal del tiempo de espera y nivel asignado.
- **Tipo de Registro:** **Transaccional**.
- **Dependencia:** Episodio de Emergencia abierto + Signos Vitales.
- **Campos clave:** `episodio_id`, `fecha_hora_clasificacion`, `motivo`, `nivel_prioridad` (catálogo según protocolo institucional), `destino_asignado` (consultorio/observación), `responsable` (ENF/MT), metadatos.

---

### 3.5 Hoja de Atención de Emergencia

- **Objetivo Legal/Médico:** Documenta la atención no programada; soporta decisión de alta, observación o ingreso.
- **Tipo de Registro:** **Transaccional**.
- **Dependencia:** Triaje (recomendado) + Identificación.
- **Campos clave:** `episodio_id`, `circunstancia_llegada`, `motivo`, `examen`, `diagnostico_cie10`, `manejo`, `disposicion` (alta_ambulatoria | observacion | orden_ingreso | referencia), firma MT.

---

### 3.6 Hoja de Indicaciones Médicas

- **Objetivo Legal/Médico:** Órdenes terapéuticas y de cuidado; base de la administración de medicamentos y de la responsabilidad prescriptiva.
- **Tipo de Registro:** **Transaccional** (versionado por revisión diaria en hospitalización).
- **Dependencia:** Historia Clínica / Ingreso.
- **Estructura de Datos Sugerida:**

```json
{
  "formulario": "indicaciones_medicas",
  "tipo_registro": "transaccional",
  "campos": {
    "episodio_id": "FK (obligatorio)",
    "fecha_hora": "datetime",
    "vigencia": "enum[activa, suspendida, modificada]",
    "items": [{
      "tipo": "enum[medicamento, dieta, cuidado, estudio, reposo]",
      "descripcion": "string",
      "dosis": "string|null", "via": "string|null",
      "frecuencia": "string|null", "duracion": "string|null"
    }],
    "medico_prescriptor": "FK usuario (firma obligatoria)",
    "transcripcion_enfermeria": "FK usuario ENF|null",
    "metadatos": "ver bloque metadatos obligatorios"
  },
  "restricciones_calidad": [
    "toda indicación requiere firma electrónica simple del prescriptor",
    "cambios generan nueva versión; versión previa conservada (Histórico)",
    "vínculo obligatorio prescripción->administración (kardex)"
  ]
}
```

---

### 3.7 Registro / Notas de Enfermería + Kardex

- **Objetivo Legal/Médico:** Evidencia del cuidado brindado y de la administración de tratamiento; corresponsabilidad asistencial.
- **Tipo de Registro:** **Transaccional / Histórico**.
- **Dependencia:** Ingreso (hospitalario) o episodio; Indicaciones Médicas para el kardex.
- **Campos clave:** `episodio_id`, `turno`, `nota_evolucion_enfermeria`, `plan_cuidados`, `administracion_medicamentos[{indicacion_ref, hora, estado:[administrado,omitido,diferido], responsable}]`, firma ENF, metadatos.

---

### 3.8 Hoja de Evolución Médica

- **Objetivo Legal/Médico:** Seguimiento clínico cronológico durante la estancia o consultas subsecuentes.
- **Tipo de Registro:** **Transaccional / Histórico** (ordenamiento cronológico ascendente — Art. 19 NTEC).
- **Dependencia:** Historia Clínica / Ingreso.
- **Campos clave:** `episodio_id`, `fecha_hora`, `subjetivo`, `objetivo`, `analisis`, `plan` (SOAP), `diagnostico_actualizado_cie10`, firma del médico, metadatos.

---

### 3.9 Consentimiento Informado

- **Objetivo Legal/Médico:** Garantía del derecho del paciente a decidir informadamente (Ley de Deberes y Derechos de los Pacientes); requisito previo a procedimientos de riesgo y a la hospitalización.
- **Tipo de Registro:** **Histórico** (inmutable una vez firmado).
- **Dependencia:** Identificación + indicación del procedimiento que lo motiva.
- **Estructura de Datos Sugerida:**

```json
{
  "formulario": "consentimiento_informado",
  "tipo_registro": "historico",
  "campos": {
    "expediente_id": "FK (obligatorio)",
    "episodio_id": "FK",
    "tipo": "enum[hospitalizacion, quirurgico, anestesico, procedimiento, transfusion, otro]",
    "procedimiento_descrito": "text",
    "riesgos_explicados": "text",
    "alternativas": "text",
    "medico_que_informa": "FK usuario (firma obligatoria)",
    "firmante": { "rol": "enum[paciente, representante_legal]", "nombre": "string", "documento": "string" },
    "firma_paciente": "evidencia firma/huella",
    "fecha_hora": "datetime"
  },
  "restricciones_calidad": [
    "inmutable tras la firma; no admite rectificación de contenido",
    "requiere doble firma: profesional informante + paciente/representante",
    "obligatorio antes del procedimiento (dependencia bloqueante en el flujo quirúrgico)"
  ]
}
```

---

### 3.10 Hoja de Referencia, Retorno e Interconsulta (RRI)

- **Objetivo Legal/Médico:** Continuidad asistencial entre niveles/establecimientos del SNIS (módulo RRI del SIS); también soporta la teleinterconsulta (Art. 40 NTEC), que debe quedar registrada en ambos expedientes.
- **Tipo de Registro:** **Transaccional**.
- **Dependencia:** Historia Clínica / Evolución con diagnóstico.
- **Campos clave:** `expediente_id`, `tipo:[referencia, retorno, interconsulta, teleinterconsulta]`, `establecimiento_origen`, `establecimiento_destino`, `especialidad_solicitada`, `resumen_clinico`, `motivo`, `respuesta_interconsultante`, firma del solicitante y del interconsultante, metadatos.

---

### 3.11 Orden de Ingreso Hospitalario

- **Objetivo Legal/Médico:** Acto médico que autoriza el internamiento; punto de inicio del episodio hospitalario y de los plazos médico-administrativos (Art. 17 lit. b NTEC).
- **Tipo de Registro:** **Transaccional**.
- **Dependencia:** Atención de Emergencia o Consulta Externa con decisión de ingreso.
- **Campos clave:** `expediente_id`, `circunstancia_ingreso:[demanda_espontanea, programado, riesgo_social, traslado]`, `fecha_hora_orden`, `motivo_ingreso`, `servicio_ingreso`, `procedencia:[emergencia, consulta_externa, traslado_otro_servicio, traslado_otro_hospital]`, `modalidad:[hospitalizacion, hospital_de_dia]`, médico que ordena (firma), metadatos.

---

### 3.12 Hoja de Ingreso / Apertura de Episodio Hospitalario

- **Objetivo Legal/Médico:** Formaliza el registro de hospitalización; vincula identidad, servicio y cama.
- **Tipo de Registro:** **Transaccional** (cabecera del episodio).
- **Dependencia:** Orden de Ingreso + Ficha de Identificación.
- **Campos clave:** `expediente_id`, `orden_ingreso_id`, `servicio`, `cama`, `fecha_hora_ingreso`, `responsable_admision`, datos de afiliación ISSS (si aplica), metadatos.

---

### 3.13 Documentos del Acto Quirúrgico

- **Objetivo Legal/Médico:** Evidencia del procedimiento y de la seguridad quirúrgica.
- **Tipo de Registro:** **Histórico** (descripción operatoria y registro anestésico inmutables).
- **Dependencia:** Consentimiento quirúrgico y anestésico + valoración preoperatoria.
- **Sub-formularios y campos clave:**
    - **Lista de Verificación de Cirugía Segura:** fases (entrada/pausa/salida), verificadores, equipo presente.
    - **Nota / Descripción Operatoria:** `diagnostico_pre`, `diagnostico_post`, `procedimiento_realizado`, `hallazgos`, `cirujano`, `ayudantes`, `hora_inicio`, `hora_fin`, firma del cirujano.
    - **Registro Anestésico:** tipo de anestesia, fármacos, monitoreo transanestésico (series temporales), incidentes, firma del anestesiólogo.
    - **Hoja de Recuperación (URPA):** monitoreo postanestésico, criterios y hora de egreso de recuperación.

---

### 3.14 Documentos Obstétricos

- **Objetivo Legal/Médico:** Registro del trabajo de parto y del nacimiento; base del expediente del recién nacido (creación automática en MINSAL).
- **Tipo de Registro:** **Transaccional / Histórico**.
- **Dependencia:** Ingreso obstétrico.
- **Sub-formularios:** Partograma (series temporales de dilatación/descenso/FCF), Hoja de Labor de Parto, Hoja de Sala de Expulsión, Hoja de Atención del Recién Nacido (genera CUN/NUI).

---

### 3.15 Epicrisis / Hoja de Egreso

- **Objetivo Legal/Médico:** Resumen del episodio hospitalario; cierra la responsabilidad asistencial y soporta la continuidad post-alta. El **resumen del expediente** debe contener identificación, diagnósticos, manejo terapéutico, resultados de estudios complementarios y firma de responsables y dirección (Art. 41 lit. c NTEC).
- **Tipo de Registro:** **Histórico**.
- **Dependencia:** Orden de Egreso + episodio con evolución completa.
- **Estructura de Datos Sugerida:**

```json
{
  "formulario": "epicrisis_egreso",
  "tipo_registro": "historico",
  "campos": {
    "episodio_id": "FK (obligatorio)",
    "fecha_hora_egreso": "datetime",
    "tipo_egreso": "enum[vivo, fallecido]",
    "circunstancia_alta": "enum[alta_hospitalaria, referido_otro_hospital, alta_voluntaria, fuga, in_extremis, alta_rehabilitada_ISRI]",
    "diagnosticos_egreso_cie10": "array",
    "resumen_evolucion": "text",
    "procedimientos_realizados": "array",
    "resultados_complementarios": "text",
    "manejo_terapeutico": "text",
    "indicaciones_alta": "text",
    "receta_egreso_ref": "FK|null",
    "citas_seguimiento": "array",
    "medico_tratante": "FK usuario (firma obligatoria)",
    "visto_jefe_servicio": "FK usuario|null",
    "metadatos": "ver bloque metadatos obligatorios"
  },
  "restricciones_calidad": [
    "tipo_egreso y circunstancia_alta obligatorios y catalogados (Art.17b)",
    "diagnósticos de egreso codificados CIE-10",
    "inmutable tras cierre; correcciones por rectificación trazable",
    "fallecido => exige Certificado de Defunción vinculado"
  ]
}
```

---

### 3.16 Certificado de Defunción (caso fallecido)

- **Objetivo Legal/Médico:** Documento médico-legal de la causa de muerte; condiciona conservación extendida del expediente (Art. 35 NTEC: 5 años natural / 10 años violencia, accidente o investigación).
- **Tipo de Registro:** **Histórico**.
- **Dependencia:** Epicrisis con `tipo_egreso = fallecido`.
- **Campos clave:** `episodio_id`, `fecha_hora_defuncion`, `causa_basica_cie10`, `causas_intermedias`, `medico_certificante` (firma), `clasificacion:[natural, violencia, accidente_transito, en_investigacion]`.

---

### 3.17 Certificado de Incapacidad Temporal (ISSS)

- **Objetivo Legal/Médico:** Justifica la suspensión laboral del derechohabiente ante el ISSS; documento administrativo-clínico institucional.
- **Tipo de Registro:** **Transaccional**.
- **Dependencia:** Atención clínica con diagnóstico (consulta u hospitalización).
- **Campos clave:** `expediente_id`, `numero_afiliado`, `numero_patronal`, `diagnostico_cie10`, `dias_incapacidad`, `fecha_inicio`, `fecha_fin`, `medico_autorizado` (firma y sello), metadatos.

---

### 3.18 Registros de Apoyo Diagnóstico (Laboratorio / Gabinete)

- **Objetivo Legal/Médico:** Sustento objetivo del diagnóstico y tratamiento (módulo RELAB del SIS para laboratorio).
- **Tipo de Registro:** **Transaccional** (solicitud) + **Histórico** (resultado validado).
- **Dependencia:** Solicitud médica firmada vinculada a episodio.
- **Campos clave:** `solicitud{episodio_id, examenes[], medico_solicitante, fecha_hora}`, `resultado{valores, unidades, rangos_referencia, responsable_validacion, fecha_hora_informe}`, metadatos.

---

### 3.19 Documentos clínicos asociados (no forman parte del expediente — Art. 37 NTEC)

> Conservación de **1 año** posterior a su utilización; modelar como registros operativos separados del expediente, no inmutables al mismo nivel:

- Registro Diario de Consultas y Atenciones Preventivas (RDC)
- Tabuladores diarios de actividades
- Registro de cirugías programadas y realizadas
- Agenda de citas médicas / listados de citas para procedimientos
- Censo de movimiento diario de pacientes
- Registro de entrada y salida de expedientes clínicos (Art. 30 NTEC)

---

## 4. Reglas de Dependencia (Grafo de creación de documentos)

```
Ficha de Identificación (Maestro, raíz)
  └─> Historia Clínica  ──► Signos Vitales (paralelo)
        ├─> Indicaciones Médicas ──► Registro Enfermería/Kardex
        ├─> Solicitud Estudios ──► Resultado Laboratorio/Gabinete
        ├─> Hoja RRI (Referencia/Interconsulta)
        ├─> [Emergencia] Triaje ──► Hoja de Atención de Emergencia
        └─> Orden de Ingreso (decisión: ingreso)
              └─> Hoja de Ingreso / Apertura de Episodio
                    ├─> Consentimiento Informado (bloqueante para cirugía)
                    ├─> Evolución Médica (cronológica)
                    ├─> [Quirúrgico] Valoración Preop ─► Consentimiento Qx/Anest ─► Checklist Qx ─► Nota Operatoria + Registro Anestésico ─► URPA
                    ├─> [Obstétrico] Partograma ─► Hoja de Parto ─► Atención RN (genera CUN/NUI)
                    └─> Orden de Egreso ──► Epicrisis / Hoja de Egreso
                          ├─> Certificado de Defunción (si fallecido)
                          └─> Cierre administrativo + Codificación CIE-10 + Archivo/Foliado
```

---

## 5. Restricciones Transversales de Calidad para el ECE

| Restricción | Fundamento | Implementación sugerida |
|---|---|---|
| Identificación única por paciente | Art. 11, 12, 14 NTEC | NUI como clave natural; deduplicación obligatoria; unificación de duplicados |
| Firma electrónica simple por profesional | Art. 4.17, 23 lit. a.4 NTEC | Asignación individual; vínculo único e innegable usuario↔acto |
| Inmutabilidad y rectificación trazable | Art. 42 NTEC | Versionado; log con usuario, fecha-hora-minuto-segundo y detalle del cambio; nunca borrado físico |
| Bitácora de accesos | Art. 55, 56 NTEC | Registrar todo intento (autorizado/denegado) con timestamp completo; conservar ≥ 2 años |
| Respaldo de información | Art. 48 NTEC | Backup **diario**, en ubicación distinta, cifrado si es portable |
| Confidencialidad y control de acceso por perfil | Art. 33, 45, 52 NTEC | RBAC; perfiles por rol; depuración anual de usuarios inactivos |
| Certificación restringida | Art. 21 NTEC | Solo Dirección o delegado puede certificar copia; flujo de aprobación auditable |
| Plan de contingencia | Art. 6 lit. c, 23 lit. c | Modo de captura en papel con digitación posterior vinculada al mismo número de expediente |
| Conservación diferenciada | Art. 34, 35 NTEC | Estado activo/pasivo; reglas de retención por diagnóstico (crónicos, violencia, accidentes, judicial) |
| Codificación clínica | Art. 16, 17 NTEC | CIE-10 obligatorio en diagnósticos de cierre de cada episodio |

---

*Elaborado como instrumento de arquitectura para el diseño del ECE. La Norma técnica del expediente clínico (Acuerdo n.° 1616) faculta a cada institución del SNIS a definir su estructura de numeración y lineamientos internos; este modelo cumple el conjunto mínimo de variables y los controles obligatorios de la norma, dejando los catálogos y la estructura de número de expediente como parámetros configurables por institución (MINSAL / ISSS).*
