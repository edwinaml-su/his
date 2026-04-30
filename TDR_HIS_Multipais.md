# TÉRMINOS DE REFERENCIA (TDR)
# SISTEMA DE INFORMACIÓN HOSPITALARIA (HIS)
## Plataforma Multi-país, Multi-organización, Multi-moneda y Multi-libro Contable
### Tropicalizado para El Salvador

---

**Versión:** 1.0
**Fecha:** Abril 2026
**País de implementación inicial:** República de El Salvador
**Idioma base:** Español (es-SV) con soporte multi-idioma

---

## ÍNDICE GENERAL

1. [Información General del Proyecto](#1-información-general-del-proyecto)
2. [Objetivos](#2-objetivos)
3. [Alcance Funcional General](#3-alcance-funcional-general)
4. [Arquitectura del Sistema](#4-arquitectura-del-sistema)
5. [Módulo Multi-Entidad: País, Organización, Moneda y Libro Contable](#5-módulo-multi-entidad)
6. [Módulo de Seguridad, Auditoría y Control de Acceso](#6-módulo-de-seguridad-auditoría-y-control-de-acceso)
7. [Módulo de Catálogos Maestros y Parametrización](#7-módulo-de-catálogos-maestros-y-parametrización)
8. [Módulo de Admisión, Altas y Traslados (ADT)](#8-módulo-de-admisión-altas-y-traslados-adt)
9. [Módulo de Triage de Manchester](#9-módulo-de-triage-de-manchester)
10. [Módulo de Atención Ambulatoria](#10-módulo-de-atención-ambulatoria)
11. [Módulo de Atención No Ambulatoria (Hospitalización)](#11-módulo-de-atención-no-ambulatoria-hospitalización)
12. [Módulo de Emergencias](#12-módulo-de-emergencias)
13. [Módulo de Salas de Operaciones (Quirófanos)](#13-módulo-de-salas-de-operaciones-quirófanos)
14. [Módulo de Historia Clínica Electrónica (HCE)](#14-módulo-de-historia-clínica-electrónica-hce)
15. [Módulo de Farmacia y Gestión de Medicamentos](#15-módulo-de-farmacia-y-gestión-de-medicamentos)
16. [Módulo de Administración de Medicamentos (eMAR)](#16-módulo-de-administración-de-medicamentos-emar)
17. [Módulo de Laboratorio Clínico (LIS)](#17-módulo-de-laboratorio-clínico-lis)
18. [Módulo de Imágenes Diagnósticas (RIS/PACS)](#18-módulo-de-imágenes-diagnósticas-rispacs)
19. [Módulo de Insumos y Almacén Hospitalario](#19-módulo-de-insumos-y-almacén-hospitalario)
20. [Módulo de Servicios Hospitalarios, Usos y Equipos](#20-módulo-de-servicios-hospitalarios-usos-y-equipos)
21. [Módulo de Terapia Respiratoria](#21-módulo-de-terapia-respiratoria)
22. [Módulo de Nutrición y Alimentación](#22-módulo-de-nutrición-y-alimentación)
23. [Módulo de Cuentas Hospitalarias y Facturación](#23-módulo-de-cuentas-hospitalarias-y-facturación)
24. [Módulo de Contabilidad y Finanzas Multi-Libro](#24-módulo-de-contabilidad-y-finanzas-multi-libro)
25. [Módulo de Convenios y Aseguradoras](#25-módulo-de-convenios-y-aseguradoras)
26. [Módulo de Reportería e Inteligencia de Negocios](#26-módulo-de-reportería-e-inteligencia-de-negocios)
27. [Tropicalización para El Salvador](#27-tropicalización-para-el-salvador)
28. [Integraciones e Interoperabilidad](#28-integraciones-e-interoperabilidad)
29. [Requisitos No Funcionales](#29-requisitos-no-funcionales)
30. [Entregables, Cronograma y Aceptación](#30-entregables-cronograma-y-aceptación)

---

## 1. INFORMACIÓN GENERAL DEL PROYECTO

### 1.1 Descripción del Proyecto

Se requiere el diseño, desarrollo, implementación y puesta en producción de un **Sistema de Información Hospitalaria (HIS)** integral, modular y escalable, que cubra de forma transversal los procesos clínicos, administrativos, financieros y logísticos de una institución hospitalaria. El sistema debe estar **tropicalizado para El Salvador** (cumplimiento normativo, fiscal, sanitario y cultural local) pero diseñado nativamente como una **plataforma multi-país, multi-organización, multi-moneda y multi-libro contable**, permitiendo escalar a operaciones regionales (Centroamérica, Latinoamérica) sin reescribir el núcleo del sistema.

### 1.2 Contexto

Las instituciones de salud en El Salvador (ISSS, FOSALUD, MINSAL, ISBM, ISRI, hospitales privados y redes integradas) requieren herramientas tecnológicas que:

- Cumplan con el marco regulatorio nacional (Código de Salud, Ley del Sistema Nacional Integrado de Salud, normativas del CSSP, normativas del MINSAL, Ley de Protección de Datos Personales, Ley de Firma Electrónica).
- Sean compatibles con los procesos del **Triage de Manchester** como estándar de clasificación.
- Permitan operar en redes hospitalarias multinacionales y regionales.
- Integren la operación clínica con la gestión financiera y contable de manera trazable.

### 1.3 Beneficiarios

- **Pacientes y sus familias:** mejor atención, trazabilidad clínica y reducción de errores médicos.
- **Personal asistencial:** médicos, enfermería, técnicos, terapistas, nutricionistas, farmacéuticos.
- **Personal administrativo:** admisión, facturación, contabilidad, recursos humanos, almacén.
- **Dirección hospitalaria:** información gerencial, indicadores y toma de decisiones.
- **Entes reguladores:** información estadística y de calidad estandarizada.

---

## 2. OBJETIVOS

### 2.1 Objetivo General

Implementar un Sistema de Información Hospitalaria (HIS) integral que automatice, integre y optimice los procesos clínicos y administrativos de la institución, con capacidades nativas multi-país, multi-organización, multi-moneda y multi-libro contable, tropicalizado a la realidad regulatoria, fiscal y sanitaria de El Salvador.

### 2.2 Objetivos Específicos

1. Centralizar la **historia clínica electrónica (HCE)** longitudinal del paciente.
2. Implementar el **Triage de Manchester** con sus cinco niveles de prioridad como modelo de clasificación de urgencias parametrizable.
3. Soportar de forma integrada los procesos **ambulatorios** (consulta externa, urgencias menores, procedimientos ambulatorios, hospitales de día) y **no ambulatorios** (hospitalización, UCI, cirugía mayor, partos).
4. Permitir la **gestión paramétrica** desde la propia interfaz del sistema (sin desarrollo) de: tipos, categorías y clasificaciones de pacientes, medicamentos, esquemas de administración, salas de operaciones, cuentas hospitalarias, procesos, exámenes, imágenes, insumos, servicios hospitalarios, usos, equipos, dietas y terapias.
5. Gestionar el **ciclo del medicamento** completo (prescripción, validación farmacéutica, dispensación, administración - eMAR, devolución, conciliación).
6. Gestionar **salas de operaciones** (programación quirúrgica, lista de cirugía segura OMS, registro intraoperatorio, recuperación post-anestésica).
7. Administrar **cuentas hospitalarias** con trazabilidad por servicio, médico, convenio y centro de costo.
8. Soportar **multi-país** con localización fiscal, regulatoria y de idioma.
9. Soportar **multi-organización**, permitiendo redes hospitalarias y consolidación.
10. Soportar **multi-moneda** con tasas de cambio históricas y revaluación contable.
11. Soportar **multi-libro contable** (libro fiscal local, libro IFRS, libro USGAAP, libro gerencial).
12. Garantizar **interoperabilidad** mediante estándares HL7 v2, HL7 FHIR R4, DICOM, IHE y CIE-10/CIE-11.
13. Cumplir con la **legislación salvadoreña** vigente y con la facturación electrónica del Ministerio de Hacienda (DTE).

---

## 3. ALCANCE FUNCIONAL GENERAL

### 3.1 Alcance Asistencial (Clínico)

- Admisión, altas y traslados (ADT).
- Triage de Manchester (Emergencias).
- Consulta externa y atención ambulatoria.
- Hospitalización (incluye unidades especiales: UCI, UCIN, UCIP, UCO, intermedios).
- Sala de partos, neonatología, pediatría, gineco-obstetricia.
- Quirófanos y sala de recuperación post-anestésica (URPA).
- Emergencias / Urgencias.
- Hospital de día, quimioterapia, hemodiálisis.
- Historia Clínica Electrónica (notas SOAP, evolución, órdenes médicas, prescripciones).
- Laboratorio clínico, banco de sangre, anatomía patológica.
- Imágenes diagnósticas (radiología, ecografía, TAC, RM, mamografía, medicina nuclear).
- Farmacia hospitalaria y administración de medicamentos (eMAR).
- Terapia respiratoria.
- Nutrición clínica y servicio de alimentación.
- Rehabilitación y fisioterapia.
- Esterilización (CEYE).

### 3.2 Alcance Administrativo y Financiero

- Catálogos maestros y parametrización.
- Cuentas hospitalarias y facturación.
- Convenios con aseguradoras y terceros pagadores.
- Caja, cobranzas y tesorería.
- Cuentas por cobrar y cuentas por pagar.
- Inventarios (almacén general, sub-almacenes, farmacia).
- Compras y proveedores.
- Activos fijos y mantenimiento de equipos médicos.
- Contabilidad general multi-libro.
- Presupuesto y costos hospitalarios.
- Recursos humanos asistenciales (turnos, planillas básicas, agenda).

### 3.3 Alcance Transversal

- Seguridad, autenticación y autorización (RBAC + ABAC).
- Auditoría completa (quién, qué, cuándo, desde dónde).
- Multi-idioma (español, inglés, portugués extensible).
- Multi-país, multi-organización, multi-moneda, multi-libro.
- Reportería operativa, gerencial, regulatoria.
- Tablero de indicadores (BI).
- Notificaciones (correo, SMS, WhatsApp Business, push).
- API REST/GraphQL para integraciones.

### 3.4 Fuera del Alcance (Exclusiones)

- Sistema ERP completo de manufactura.
- Telemedicina avanzada con video integrado nativo (se contempla integración con plataformas externas).
- Aplicaciones móviles para pacientes (portal del paciente se ofrece como módulo opcional).

---

## 4. ARQUITECTURA DEL SISTEMA

### 4.1 Principios Arquitectónicos

- **Arquitectura modular** orientada a microservicios o monolito modular evolutivo.
- **API-first:** todas las funcionalidades expuestas vía API documentada (OpenAPI 3.x).
- **Cloud-ready:** desplegable en nube pública (AWS, Azure, GCP), nube privada u on-premise.
- **Stateless en capa de aplicación**, escalable horizontalmente.
- **Base de datos transaccional** relacional (PostgreSQL recomendado) más motor de búsqueda (OpenSearch/Elasticsearch) y caché (Redis).
- **Almacenamiento documental/imágenes** en object storage compatible S3 (MinIO on-premise).
- **Bus de eventos** para integraciones asíncronas (Kafka, RabbitMQ).
- **Observabilidad nativa:** logs estructurados, métricas (Prometheus), trazas (OpenTelemetry).
- **Seguridad by design:** TLS 1.3, cifrado en reposo, gestión de secretos.

### 4.2 Capas Lógicas

1. **Capa de presentación:** aplicación web responsive (SPA), aplicaciones móviles para personal asistencial, terminales clínicas, kioscos de auto-registro.
2. **Capa de API / orquestación:** API Gateway, autenticación, throttling, versionado.
3. **Capa de servicios de negocio:** módulos funcionales del HIS.
4. **Capa de integración:** adaptadores HL7, FHIR, DICOM, conectores fiscales, conectores bancarios.
5. **Capa de datos:** RDBMS, almacén documental, PACS, data warehouse.
6. **Capa de analítica:** ETL, modelos dimensionales, BI.

### 4.3 Modelo de Despliegue

- **Tenant model:** multi-tenant lógico con aislamiento por `tenant_id` (organización) y `country_id`. Posibilidad de despliegue dedicado por cliente cuando se requiera.
- **Alta disponibilidad:** activo-activo en aplicación, activo-pasivo en BD con réplica síncrona/asíncrona.
- **DRP:** RPO ≤ 15 min, RTO ≤ 4 horas (configurable según contrato).

---

## 5. MÓDULO MULTI-ENTIDAD

### 5.1 Multi-país

El sistema debe permitir registrar y operar en múltiples países dentro de la misma instancia. Cada país tiene su propio conjunto de:

- **Identificación de país:** código ISO 3166-1 (ej. SLV/222 para El Salvador).
- **Idioma(s) oficial(es)** y zona horaria.
- **Moneda funcional** (definida a nivel país pero puede coexistir con moneda local).
- **Documentos de identidad válidos:** DUI, NIT, NIE, pasaporte, partida de nacimiento (para menores), carné de minoridad.
- **Catálogo fiscal:** tipos de impuesto (IVA 13% en El Salvador), retenciones, percepciones, regímenes.
- **Catálogo regulatorio sanitario:** entidad rectora (MINSAL en SV), códigos de establecimientos, formularios de notificación obligatoria (vigilancia epidemiológica), enfermedades de declaración obligatoria locales (dengue, chikungunya, zika, malaria, leptospirosis).
- **Formato de fechas, números, direcciones** localizado.
- **División política:** departamento → municipio → distrito (parametrizable; en El Salvador 14 departamentos).
- **Calendario de feriados nacionales** que afecta agendamiento.
- **Plan de cuentas contable** local + plan(es) alternos.
- **Tipos de comprobantes fiscales** (en El Salvador: DTE — Factura, CCF, Nota de Remisión, Nota de Crédito, Nota de Débito, Comprobante de Liquidación, Comprobante de Retención, Factura Sujeto Excluido, Factura de Exportación).
- **Formatos de numeración fiscal** y rangos autorizados.
- **Convenios sanitarios bilaterales** (cuando aplique).

### 5.2 Multi-organización

Una organización es una entidad jurídica o un conjunto de establecimientos bajo una misma administración. El sistema debe soportar:

- **Jerarquía de organizaciones:** Holding → Empresa/NIT → Establecimiento → Sede/Centro → Servicio → Unidad funcional.
- **Configuración independiente por organización:** logo, marca, plantillas de impresión, agendas, parámetros clínicos, listas de medicamentos preferidos (formulario terapéutico), tarifarios, convenios.
- **Compartición controlada de datos:** posibilidad de compartir HCE entre organizaciones del mismo grupo bajo consentimiento del paciente y reglas configurables.
- **Consolidación financiera:** cierre individual por organización + consolidado por holding.
- **Centros de costo y unidades de negocio** propios por organización.
- **Roles y permisos** segmentados por organización; usuarios pueden tener roles distintos en distintas organizaciones.

### 5.3 Multi-moneda

- **Moneda funcional** por organización (en El Salvador típicamente USD, ya que es la moneda de curso legal).
- **Moneda de transacción:** una transacción puede registrarse en cualquier moneda activa.
- **Moneda de reporte:** moneda en la que se consolidan estados financieros (configurable por libro contable).
- **Tabla de tipos de cambio:** carga manual y automática (conexión a fuentes oficiales: Banco Central de Reserva de El Salvador, fuentes regionales). Tasas históricas (para revaluar) y tasas spot (para transaccionar).
- **Tipos de tasa:** compra, venta, promedio, oficial, fiscal.
- **Revaluación de cuentas en moneda extranjera** al cierre periódico (con asiento de ajuste de diferencia cambiaria realizada y no realizada).
- **Triangulación monetaria** cuando se requiera (ej. paciente paga en colones costarricenses una atención que se factura en USD y se reporta en quetzales en el holding).
- **Redondeo configurable** por moneda (decimales, criterio de redondeo).

### 5.4 Multi-libro Contable

El sistema debe permitir definir múltiples libros contables paralelos sobre los mismos hechos económicos:

- **Libro fiscal local:** cumple normativa tributaria del país (en El Salvador: NIIF para PYMES o NIIF plenas según corresponda; obligaciones del Código Tributario y Ley del Impuesto Sobre la Renta).
- **Libro IFRS / NIIF Plenas:** para reportes a casa matriz internacional o auditoría externa.
- **Libro US GAAP:** para holdings con presencia en EE.UU.
- **Libro gerencial / management:** con ajustes internos, asignación de costos por servicio hospitalario, eliminaciones intercompañía.
- **Libro presupuestal:** ejecución contra presupuesto.
- **Libro estadístico/no monetario:** para indicadores clínicos (egresos, días-cama, etc.).

Cada libro tiene:

- Su propio plan de cuentas (o mapeo desde el plan único maestro).
- Sus propias reglas de reconocimiento (ej. depreciación lineal en uno, acelerada en otro).
- Su propio calendario contable y períodos de cierre.
- Su propia moneda funcional.

Al registrar un hecho económico (ej. dispensación de un medicamento en hospitalización), el sistema **genera asientos paralelos** en cada libro activo, según las reglas configuradas.

### 5.5 Modelo de Datos Conceptual Multi-Entidad

Toda tabla transaccional incluye, como mínimo:

- `country_id` (país)
- `organization_id` (organización)
- `establishment_id` (sede/establecimiento)
- `currency_id` (moneda de transacción)
- `exchange_rate_to_functional` (tasa al momento de la transacción)
- `created_at`, `created_by`, `updated_at`, `updated_by` (auditoría)
- `tenant_id` (cuando aplique aislamiento multi-tenant)

---

## 6. MÓDULO DE SEGURIDAD, AUDITORÍA Y CONTROL DE ACCESO

### 6.1 Autenticación

- Inicio de sesión con usuario y contraseña con políticas de complejidad configurables.
- Soporte de **MFA** (TOTP, SMS, correo, push).
- **SSO** vía SAML 2.0 y OpenID Connect / OAuth 2.0.
- Integración con **Active Directory / LDAP**.
- Inicio de sesión con **firma electrónica** (cumplimiento Ley de Firma Electrónica de El Salvador) para suscripción de documentos clínicos.
- Token-based para APIs (JWT con refresh).
- Bloqueo por intentos fallidos, expiración configurable de contraseñas, historial de contraseñas.

### 6.2 Autorización

- **RBAC:** roles parametrizables (médico general, especialista, residente, enfermería A, enfermería B, jefe de servicio, farmacéutico clínico, dispensador, técnico de laboratorio, etc.).
- **ABAC:** atributos como servicio, sede, especialidad, turno, paciente asignado.
- **Permisos granulares:** lectura, escritura, anular, firmar, validar, cobrar, descargar, imprimir, exportar.
- **Segregación de funciones:** no puede prescribir y dispensar el mismo usuario; no puede facturar y cobrar el mismo usuario (configurable).
- **Consentimiento del paciente** para acceso a su HCE entre organizaciones.
- **Break-the-glass:** acceso de emergencia con justificación obligatoria y auditoría reforzada.

### 6.3 Auditoría

- Registro inmutable de **todas** las acciones sensibles (creación, modificación, lectura sensible, eliminación lógica, impresión, exportación).
- Atributos: usuario, rol, organización, sede, IP, dispositivo, fecha-hora, acción, entidad, ID, estado anterior, estado nuevo, justificación.
- **Auditoría de acceso a HCE** del paciente: el paciente o su representante puede solicitar el log de quién accedió a su expediente.
- Conservación de logs por mínimo 10 años (configurable).
- Exportación a SIEM externo.

### 6.4 Protección de Datos Personales

Cumplimiento con la **Ley de Protección de Datos Personales** vigente en El Salvador y normativas equivalentes en otros países (LFPDPPP México, LGPD Brasil, GDPR para holdings europeos).

- Clasificación de datos sensibles (datos de salud, biométricos, menores).
- Cifrado AES-256 en reposo y TLS 1.3 en tránsito.
- Anonimización y seudonimización para fines estadísticos.
- Derechos ARCO (acceso, rectificación, cancelación, oposición) implementados como flujos dentro del sistema.
- Consentimiento informado parametrizable por finalidad.

---

## 7. MÓDULO DE CATÁLOGOS MAESTROS Y PARAMETRIZACIÓN

Este módulo es **transversal** y constituye el corazón de la flexibilidad del sistema. Todos los catálogos deben ser **mantenibles desde la interfaz del sistema** por usuarios autorizados, con versionado, vigencia (fecha desde / fecha hasta), y trazabilidad de cambios.

### 7.1 Catálogos Geográficos y Generales

- País, departamento, municipio, distrito, cantón, colonia, código postal.
- Zonas horarias.
- Idiomas y traducciones de etiquetas (i18n).
- Feriados (nacional, local, religioso, institucional).

### 7.2 Catálogos de Personas

- **Tipos de documento de identidad:** DUI, NIT, NIE, pasaporte, partida de nacimiento, carné de minoridad, carné de residente, otros.
- **Géneros y sexo biológico** (con campos separados para identidad de género y sexo biológico al nacer; cumple guías sanitarias internacionales).
- **Estado civil.**
- **Grupos étnicos** (parametrizable por país; en El Salvador: mestizo, lenca, nahua-pipil, kakawira, otros).
- **Niveles educativos.**
- **Ocupaciones** (CIUO).
- **Religión / culto** (relevante para consentimientos como transfusiones).
- **Idiomas hablados por el paciente** (relevante para consentimiento informado).

### 7.3 Catálogos Clínicos

#### 7.3.1 Tipos, Categorías y Clasificaciones de Pacientes

Todos parametrizables desde la interfaz:

- **Tipo de paciente:** ambulatorio, hospitalizado, emergencia, observación, cirugía mayor ambulatoria, hospital de día, domicilio, telemedicina.
- **Categoría de paciente:** privado, asegurado (ISSS, otros), beneficiario MINSAL, FOSALUD, convenio empresa, autoseguro, gratuito/social, paciente VIP, paciente protocolo de investigación.
- **Clasificación etaria:** neonato (0-28 días), lactante (29 días - 24 meses), preescolar, escolar, adolescente (definición OMS 10-19 ó configurable), adulto joven, adulto, adulto mayor (≥60), anciano (≥80).
- **Clasificación de riesgo:** bajo, medio, alto, crítico.
- **Tipo de cobertura:** total, parcial con copago, parcial con coaseguro, deducible, sin cobertura.
- **Origen del paciente:** referido, contrarreferido, espontáneo, citado, traslado interhospitalario.
- **Condiciones especiales:** embarazada, puérpera, donante, receptor, aislado, paciente con discapacidad (visual, auditiva, motora, cognitiva, múltiple).

#### 7.3.2 Catálogos de Diagnósticos y Procedimientos

- **CIE-10** y **CIE-11** completas, multilingües, con búsqueda por código y por término.
- **CIE-O** (oncología).
- **CIAP-2** (atención primaria).
- **CIE-9-MC procedimientos** y **CUPS** (Colombia) según país.
- **SNOMED CT** (recomendado, licenciable).
- **LOINC** para órdenes y resultados de laboratorio/observaciones clínicas.
- Mapeos cruzados entre clasificaciones.

#### 7.3.3 Triage

- Niveles de triage (ver módulo 9).
- Discriminadores Manchester por presentación (parametrizables).
- Tiempos máximos de atención por nivel.

#### 7.3.4 Especialidades y Servicios Médicos

- Especialidades médicas (medicina interna, pediatría, gineco-obstetricia, cirugía general, cardiología, neurología, psiquiatría, traumatología, oftalmología, otorrino, etc.).
- Sub-especialidades.
- Servicios hospitalarios (consulta externa, emergencia, hospitalización por servicio, UCI adultos, UCIN, UCIP, UCO, sala de partos, quirófanos, hemodiálisis, quimioterapia, etc.).

### 7.4 Catálogos de Medicamentos

- **Principio activo (DCI / INN).**
- **Forma farmacéutica.**
- **Concentración.**
- **Vía de administración** (oral, IV, IM, SC, IT, tópica, oftálmica, ótica, rectal, vaginal, inhalatoria, nebulización, transdérmica, intracardíaca, intraarticular, etc.).
- **Presentación comercial / marca.**
- **Laboratorio fabricante.**
- **Registro sanitario** (en El Salvador: registro de la DNM — Dirección Nacional de Medicamentos).
- **Código de barras / DataMatrix / GTIN.**
- **Clasificación ATC (Anatomical Therapeutic Chemical).**
- **Clasificación VEN (Vital, Esencial, No esencial).**
- **Listado nacional de medicamentos esenciales** (LEMS) con flag.
- **Tipo:** ético, OTC, controlado.
- **Sustancias controladas:** clasificación según JIFE (psicotrópicos, estupefacientes), receta retenida (en El Salvador: receta especial para psicotrópicos y estupefacientes según Ley Reguladora de las Actividades Relativas a las Drogas).
- **Almacenamiento:** temperatura, fotosensibilidad, humedad, cadena de frío, alta peligrosidad (LASA — look-alike sound-alike, alto riesgo).
- **Indicaciones, contraindicaciones, efectos adversos, advertencias** (vinculable a base externa tipo Vademécum, Lexicomp, Micromedex).
- **Interacciones medicamento-medicamento, medicamento-alimento, medicamento-enfermedad.**
- **Dosis pediátrica por peso/superficie corporal.**
- **Dosis en insuficiencia renal y hepática.**
- **Categoría de embarazo (FDA A/B/C/D/X) y lactancia.**
- **Equivalencia genérica y bioequivalencia.**
- **Estabilidad post-reconstitución.**

### 7.5 Catálogos de Laboratorio

- Pruebas (con código LOINC).
- Métodos.
- Especímenes / tubos / contenedores.
- Valores de referencia por edad, sexo, condición.
- Unidades de medida.
- Paneles / perfiles (hemograma, perfil lipídico, perfil hepático, perfil tiroideo, perfil prenatal, etc.).
- Tiempos de respuesta esperados (TAT).

### 7.6 Catálogos de Imágenes

- Estudios (RX tórax PA/lateral, USG abdominal, TAC craneal con/sin contraste, RM rodilla, etc.).
- Modalidades DICOM (CR, DR, CT, MR, US, MG, NM, PT, XA, etc.).
- Protocolos por estudio.
- Indicaciones.
- Preparación previa del paciente.
- Contrastes (medicamento + dosis).

### 7.7 Catálogos de Insumos, Equipos y Servicios

- Insumos médicos (jeringas, gasas, suturas, sondas, catéteres, etc.) con código local y código GTIN/UDI.
- Equipos médicos (con número de inventario, marca, modelo, serie).
- Servicios hospitalarios facturables (cama por día, oxígeno por hora, monitor por día, ventilador mecánico por día, atención de enfermería por turno, etc.).
- Procedimientos médicos y quirúrgicos.
- Honorarios médicos.
- Salas (quirófanos, salas de partos, salas de procedimientos).

### 7.8 Catálogos Financieros

- Plan de cuentas por libro contable.
- Centros de costo.
- Centros de ingreso.
- Tipos de comprobante fiscal (DTE en El Salvador).
- Formas de pago.
- Bancos y cuentas bancarias.
- Tarjetas de crédito y comisiones.
- Aseguradoras y convenios.
- Tarifarios por convenio.

### 7.9 Reglas de Negocio Parametrizables

- Reglas de cobro (aplicación de tarifa, descuento por convenio, copago).
- Reglas clínicas (alertas de dosis, alergias, interacciones).
- Reglas de agendamiento (duración por tipo de cita, sobreagendamiento permitido o no).
- Reglas de cuenta hospitalaria (qué se carga automáticamente: cama, materno-infantil, asistencia general).

---

## 8. MÓDULO DE ADMISIÓN, ALTAS Y TRASLADOS (ADT)

### 8.1 Identificación Única del Paciente (MPI)

- **Master Patient Index (MPI)** institucional con identificador único interno (`patient_id`).
- Algoritmos deterministas y probabilísticos de **deduplicación**.
- Validación contra documentos de identidad oficiales del país.
- En El Salvador: validación de **DUI** (formato 9 dígitos + 1 dígito verificador con algoritmo módulo) y **NIT** cuando aplique.
- Para extranjeros: pasaporte + país emisor.
- Para menores: partida de nacimiento o carné de minoridad; vinculación con expediente de la madre durante el período neonatal.
- **Pacientes desconocidos (NN):** registro temporal con identificador NN-AAAAMMDD-NNN, fusionable cuando se identifique.
- Datos: nombres, apellidos, fecha de nacimiento, sexo biológico, identidad de género, dirección, teléfonos, correo, contacto de emergencia, parentesco, idioma preferido, etnia, religión, ocupación, nivel educativo, alergias conocidas (con severidad), grupo sanguíneo y Rh.

### 8.2 Pre-Admisión

- Programación de hospitalización electiva o cirugía programada con días de anticipación.
- Solicitud de autorización a aseguradora (con respuesta mediante integración o registro manual).
- Lista de exámenes pre-operatorios pendientes.
- Verificación de cobertura.

### 8.3 Admisión

- Tipos de admisión: emergencia, programada, traslado, parto, recién nacido.
- Asignación de cuenta hospitalaria.
- Asignación de cama (si hospitalización).
- Captura de pertenencias y valores (con resguardo).
- Consentimiento informado de admisión y de tratamiento de datos.
- Identificación con brazalete (impresión de pulsera con código de barras / QR / RFID).
- Captura biométrica opcional (huella, foto).

### 8.4 Traslados Internos

- Cambio de servicio, cambio de cama, cambio de nivel de cuidado (ej. piso → UCI).
- Notificación automática al servicio receptor.
- Actualización de censo en tiempo real.
- Validación de disponibilidad de cama y aislamientos.

### 8.5 Altas

- Tipos de alta: médica, voluntaria (firma de retiro voluntario), traslado a otra institución, fuga, fallecimiento, contra opinión médica.
- Resumen de alta (epicrisis) firmado electrónicamente.
- Receta de alta (medicamentos para casa).
- Indicaciones de cuidados en casa.
- Citas de control programadas automáticamente.
- Liquidación de cuenta hospitalaria.
- Devolución de pertenencias y valores con firma.

### 8.6 Censo y Ocupación

- Tablero en tiempo real con mapa de camas (libre, ocupada, sucia/en limpieza, bloqueada, en mantenimiento, reservada).
- Indicadores: % ocupación, giro cama, estancia promedio, egresos del día.
- Listas: ingresos del día, egresos del día, traslados, programados.

### 8.7 Defunción

- Certificado médico de defunción digital (con código CIE-10/CIE-11 de causa básica, intermedia y directa).
- Notificación a registro civil (cuando exista interoperabilidad).
- Manejo de cadáver (registro de morgue, entrega a funeraria, autopsia).
- Cierre de cuenta hospitalaria.

---

## 9. MÓDULO DE TRIAGE DE MANCHESTER

### 9.1 Modelo Conceptual

El sistema implementa el **Manchester Triage System (MTS)** como modelo principal de clasificación en emergencias, con sus 5 niveles:

| Color | Nivel | Descripción | Tiempo máximo |
|-------|-------|-------------|---------------|
| Rojo | 1 | Emergencia / Inmediato | 0 minutos |
| Naranja | 2 | Muy urgente | 10 minutos |
| Amarillo | 3 | Urgente | 60 minutos |
| Verde | 4 | Estándar / poco urgente | 120 minutos |
| Azul | 5 | No urgente | 240 minutos |

Los tiempos máximos son **parametrizables** por organización para adecuarse a normativas locales (ej. MINSAL puede tener tiempos diferentes en su normativa de emergencias).

### 9.2 Flujo Funcional de Triage

1. **Recepción:** registro rápido con datos mínimos (nombre, sexo, edad estimada si no se conoce). Para pacientes ya en MPI, recuperación inmediata.
2. **Toma de signos vitales** (puede ser previo o paralelo): TA, FC, FR, SpO₂, temperatura, glicemia capilar, escala de dolor, escala de Glasgow.
3. **Selección del flujograma de presentación** (presenting complaint): dolor torácico, disnea, dolor abdominal, trauma craneal, paciente con quemadura, paciente embarazada con sangrado, niño que llora inconsolablemente, etc. El sistema cuenta con los **52 flujogramas estándar de Manchester** parametrizados, con posibilidad de añadir flujogramas locales.
4. **Aplicación de discriminadores** por orden de prioridad (vía aérea comprometida, shock, hemorragia exanguinante, alteración de conciencia, dolor severo, etc.) hasta encontrar uno positivo.
5. **Asignación automática del nivel** según el primer discriminador positivo.
6. **Sobreescritura por el triador** con justificación obligatoria si difiere.
7. **Inicio de cronómetro** según el tiempo máximo del nivel asignado.
8. **Asignación a sala/box** según nivel.
9. **Re-triage** si el paciente espera más de un umbral configurado o si su condición cambia.

### 9.3 Parametrización del Triage en el Sistema

Todo el contenido es editable desde la interfaz por administradores clínicos:

- **Niveles** (color, código, prioridad numérica, tiempo máximo de espera, color en pantalla).
- **Flujogramas de presentación.**
- **Discriminadores** asociados a cada flujograma con su nivel resultante.
- **Signos vitales obligatorios** por flujograma (ej. en dolor torácico: ECG; en disnea: SpO₂).
- **Reglas de re-triage automático** (cambios en signos vitales, tiempo de espera).
- **Edad pediátrica** y flujogramas pediátricos específicos.
- **Mensajes de alerta** al equipo asistencial cuando se incumplen tiempos.

### 9.4 Indicadores de Triage

- Tiempo puerta-triage.
- Tiempo triage-evaluación médica por nivel.
- Distribución porcentual por nivel.
- Pacientes que se retiran sin ser atendidos (LWBS).
- Reingresos en 72 horas.

### 9.5 Triage Pediátrico

- Variantes pediátricas de los flujogramas Manchester.
- Cálculos automáticos de signos vitales normales por edad.
- Triángulo de Evaluación Pediátrica (TEP).
- Escalas pediátricas de dolor (FLACC, Wong-Baker).

---

## 10. MÓDULO DE ATENCIÓN AMBULATORIA

### 10.1 Agenda y Citas

- **Agendas múltiples** por médico, por consultorio, por equipo.
- Tipos de cita parametrizables: primera vez, control, post-quirúrgico, telemedicina, procedimiento, junta médica.
- Duración por tipo de cita.
- **Bloqueos** de agenda (vacaciones, congresos, guardia, mantenimiento).
- **Sobreagendamiento** controlado con autorización.
- Lista de espera con priorización.
- **Confirmación automatizada** vía SMS/WhatsApp/correo en intervalos configurables (72h, 24h, 2h).
- Cancelación y reagendamiento por el paciente (portal) o por agendador.
- Indicador de no-show.
- Citas grupales (educación diabetes, control prenatal grupal, vacunación).

### 10.2 Recepción y Llamada

- Llegada del paciente, validación de identidad, verificación de cobertura.
- Cobro de copago si aplica.
- Pase a sala de espera con turno digital.
- Llamado en pantallas de la sala de espera (con anonimización por número o iniciales según ley local).

### 10.3 Consulta

- Apertura del expediente del paciente con vista 360° (antecedentes, alergias, medicación crónica, problemas activos, últimos resultados, vacunas, alertas).
- **Notas SOAP** (subjetivo, objetivo, análisis, plan) o estructura configurable.
- Captura de motivo de consulta (con CIAP-2 opcional).
- Examen físico por sistemas con plantillas reutilizables.
- Diagnósticos CIE-10/CIE-11 con principal y secundarios.
- **Plan terapéutico:**
  - Prescripción de medicamentos (ver módulo 15).
  - Solicitud de laboratorio (ver módulo 17).
  - Solicitud de imágenes (ver módulo 18).
  - Solicitud de procedimientos.
  - Solicitud de interconsulta.
  - Indicaciones higiénico-dietéticas.
  - Educación al paciente.
  - Reposo / incapacidad médica (formato oficial El Salvador para ISSS).
  - Próximo control.
- Firma electrónica de la nota.

### 10.4 Procedimientos Ambulatorios

Procedimientos que se realizan sin ingreso (curaciones, suturas, infiltraciones, biopsias, endoscopías, colonoscopías ambulatorias, cirugía ambulatoria menor):

- Lista de chequeo pre-procedimiento.
- Consentimiento informado específico.
- Registro intra-procedimiento (operador, asistente, equipos, insumos, anestesia local/sedación).
- Recuperación post-procedimiento con criterios de alta.
- Indicaciones post-procedimiento.

### 10.5 Hospital de Día

- Pacientes que reciben tratamiento programado durante el día y vuelven a casa: quimioterapia, hemodiálisis, transfusiones, infusiones de biológicos, terapia del dolor.
- Reservas de sillón/cama por horario.
- Cuenta hospitalaria de día con cargos por servicio.

### 10.6 Telemedicina (Atención Virtual)

- Generación de enlace seguro de videoconsulta (integración con plataforma externa).
- Consentimiento específico de telemedicina.
- Documentación equivalente a consulta presencial.
- Limitaciones de prescripción de controlados según normativa local.

---

## 11. MÓDULO DE ATENCIÓN NO AMBULATORIA (HOSPITALIZACIÓN)

### 11.1 Tipos de Hospitalización

- Hospitalización general por servicio (medicina interna, cirugía, gineco-obstetricia, pediatría).
- Cuidados intermedios.
- **UCI adultos, UCIN (neonatal), UCIP (pediátrica), UCO (coronaria).**
- Sala de partos / labor.
- Post-parto / puerperio inmediato y mediato.
- Aislamiento (respiratorio, contacto, gotitas, protector).
- Quemados.
- Salud mental (con normas específicas de seguridad).

### 11.2 Ingreso

- Notificación de ingreso desde emergencia, consulta externa, programado o traslado.
- Asignación de cama según servicio, sexo (cuando aplique), aislamiento, preferencia (cuarto privado, semi-privado, sala común) y cobertura.
- Ingreso en HCE con nota de ingreso (anamnesis completa, examen físico completo, plan).
- Apertura de cuenta hospitalaria.
- Indicaciones médicas iniciales (medicamentos, dieta, actividad, signos vitales por turno, oxígeno, líquidos endovenosos, etc.).

### 11.3 Indicaciones Médicas y Plan de Cuidados

**Indicaciones Médicas (Order Entry / CPOE):**

- Medicamentos: principio activo, dosis, vía, frecuencia, duración, indicación clínica, condición ("PRN" si dolor, fiebre).
- Dieta: tipo (general, blanda, líquida, hipocalórica, diabética, hipoproteica, sin sal, kosher, halal, papilla por edad, fórmula infantil, NPO), restricciones, suplementos.
- Líquidos endovenosos: solución, volumen, velocidad, aditivos.
- Oxígeno: dispositivo, FiO₂ o L/min, objetivo de saturación.
- Monitorización: signos vitales con frecuencia, peso, balance hídrico, glicemia capilar.
- Actividad: reposo absoluto, reposo relativo, deambulación asistida, libre.
- Posición: semi-fowler, decúbito, Trendelenburg.
- Profilaxis: tromboembólica (HBPM dosis), gastroprotección, antibiótica.
- Curaciones, drenajes, sondajes.
- Procedimientos: terapia respiratoria, fisioterapia, etc.
- Consultas / interconsultas.
- Laboratorios e imágenes.

**Cuidados de enfermería** vinculados a las indicaciones, generan automáticamente el **plan de cuidados** y el **eMAR** (módulo 16).

### 11.4 Evolución Diaria

- Nota de evolución por médico tratante con frecuencia mínima diaria (configurable).
- Pase de visita estructurado con check-list de revisión.
- Evolución de enfermería por turno con escalas (Braden para úlceras por presión, Morse para caídas, dolor, sedación RASS, delirium CAM-ICU).
- Vigilancia de catéteres y dispositivos invasivos (días, signos de infección).

### 11.5 Cuidados Críticos (UCI)

- Hojas de monitorización avanzada minuto a minuto (interface con monitores, ventiladores, bombas).
- Escalas: APACHE II, SOFA, NEWS, qSOFA, Glasgow.
- Balance hídrico horario.
- Programación y registro de medicamentos en infusión continua (norepinefrina, propofol, fentanilo, midazolam, insulina) con cálculos automáticos de concentración y velocidad.
- Lista de chequeo diaria FAST HUG (Feeding, Analgesia, Sedation, Thromboprophylaxis, Head, Ulcer, Glucose).
- Protocolos: VAP bundle, CLABSI bundle, CAUTI bundle, sepsis hour-1.

### 11.6 Sala de Partos / Materno-infantil

- Partograma electrónico con curva de Friedman.
- Monitorización fetal (CTG/NST) con integración al monitor.
- Registro de parto: tipo (eutócico, instrumentado, cesárea), duración por períodos, episiotomía, desgarros, alumbramiento, sangrado.
- Atención inmediata del recién nacido: APGAR 1', 5', 10', Capurro, Ballard, Silverman-Andersen, Downes, peso, talla, perímetro cefálico, vacunas inmediatas (BCG, Hep B), profilaxis ocular y vitamina K.
- **Apertura automática de expediente del recién nacido** vinculado al de la madre.
- Notificación al registro civil (cuando exista interoperabilidad).

### 11.7 Egreso Hospitalario

- Orden médica de alta.
- Epicrisis estructurada (motivo de ingreso, evolución resumida, diagnósticos finales, procedimientos realizados, complicaciones, condición al egreso).
- Receta de alta.
- Indicaciones para la casa.
- Citas de seguimiento.
- Educación al paciente y su cuidador.
- Encuesta de satisfacción.
- Cierre y liquidación de cuenta.

---

## 12. MÓDULO DE EMERGENCIAS

### 12.1 Flujo Integral

1. Llegada (peatonal, ambulancia, traslado).
2. Recepción y registro inicial (rápido si código rojo).
3. Triage de Manchester (módulo 9).
4. Asignación a área (sala de shock/reanimación, observación adultos, observación pediátrica, área de procedimientos menores, sala de espera con re-triage).
5. Evaluación médica inicial.
6. Órdenes médicas, exámenes, tratamientos.
7. Reevaluación.
8. Decisión: alta a casa, alta con cita, observación prolongada, ingreso, traslado, fallecimiento.

### 12.2 Códigos de Activación Hospitalaria

Soportar flujos especiales con activación de equipos:

- **Código Rojo / Código Azul** (paro cardiorrespiratorio).
- **Código Trauma** (politraumatizado).
- **Código Ictus / Stroke / ACV.**
- **Código Infarto / IAM con elevación del ST** (tiempo puerta-aguja, puerta-balón).
- **Código Sepsis** (sepsis bundle hour-1).
- **Código Materno** (hemorragia obstétrica, eclampsia).
- **Código de Activación Masiva** (desastres, emergencias colectivas).

Cada código:

- Define el equipo a notificar (médico, enfermería, laboratorio, banco de sangre, radiología, quirófano, UCI).
- Cronómetros automáticos de cumplimiento.
- Lista de chequeo de protocolo.
- Registro de tiempos (puerta-X) para indicadores.

### 12.3 Observación

- Pacientes que requieren reevaluación en horas (típicamente 6-24h).
- Plan de observación con re-evaluación periódica.
- Decisión documentada al cierre.

### 12.4 Medicina Forense (cuando aplique)

- Atención de víctimas de violencia (intrafamiliar, sexual, agresión).
- Cadena de custodia de evidencias.
- Notificación a autoridad competente conforme a normativa (en El Salvador: PNC, Fiscalía General, Junta de Protección de la Niñez y Adolescencia para menores).

---

## 13. MÓDULO DE SALAS DE OPERACIONES (QUIRÓFANOS)

### 13.1 Programación Quirúrgica

- **Tablero de programación** semanal/mensual por sala, por cirujano, por especialidad.
- Tiempos estándar por procedimiento parametrizables (con histórico real de duración).
- Verificación de:
  - Disponibilidad del cirujano y equipo (anestesiólogo, instrumentista, circulante).
  - Disponibilidad de sala.
  - Disponibilidad de cama de UCI/recuperación si lo requiere.
  - Disponibilidad de materiales especiales (prótesis, mallas, dispositivos).
  - Hemoderivados reservados.
  - Riesgo anestésico (ASA) y autorización quirúrgica.
- Lista de espera quirúrgica con priorización clínica.

### 13.2 Pre-operatorio

- Evaluación pre-anestésica con clasificación ASA.
- Lista de exámenes pre-operatorios completos.
- Consentimiento informado quirúrgico y anestésico.
- Marcaje del sitio quirúrgico.
- Profilaxis antibiótica (en la 1ª hora previa a la incisión).
- Profilaxis tromboembólica.
- Ayuno verificado.

### 13.3 Lista de Verificación de Cirugía Segura (OMS)

Implementación obligatoria de la **Lista de Cirugía Segura de la OMS** en sus tres pausas:

- **Sign In** (antes de inducción anestésica).
- **Time Out** (antes de la incisión).
- **Sign Out** (antes de salir del quirófano).

Cada ítem registrado, con responsable y firma.

### 13.4 Intra-operatorio

- Hoja de anestesia electrónica con registro automático desde monitor (signos vitales, gases, BIS, parámetros ventilatorios) y manual (medicamentos administrados, eventos).
- Hoja de circulante / instrumentista (recuento de gasas y agujas, instrumental, cargo de insumos).
- Tiempos quirúrgicos: entrada, inducción, incisión, fin de cirugía, salida.
- Tipo de anestesia: general, regional (raquídea, epidural, bloqueos), local con sedación, MAC.
- Hallazgos quirúrgicos.
- Procedimientos realizados (con códigos).
- Diagnóstico pre y post-operatorio.
- Muestras enviadas a patología.

### 13.5 Recuperación Post-Anestésica (URPA)

- Score de Aldrete o equivalente.
- Monitorización hasta criterios de alta.
- Manejo del dolor post-operatorio.
- Pase a piso, UCI o alta domiciliaria (cirugía ambulatoria).

### 13.6 Trazabilidad

- Cada cirugía genera registros en cuenta hospitalaria por: tiempo de sala, equipo, anestesiólogo, instrumental especial, prótesis, insumos consumidos.
- Reporte operatorio firmado en máximo 24h.
- Inventario de prótesis/implantes con número de lote y serie (trazabilidad UDI).

### 13.7 Esterilización (CEYE)

- Recepción de instrumental sucio.
- Lavado, empaquetado, esterilización (autoclave, óxido de etileno, plasma).
- Indicadores físicos, químicos y biológicos.
- Trazabilidad lote → set → cirugía → paciente.

---

## 14. MÓDULO DE HISTORIA CLÍNICA ELECTRÓNICA (HCE)

### 14.1 Estructura del Expediente

- **Datos demográficos** (del MPI).
- **Antecedentes:** familiares, personales patológicos, no patológicos, ginecoobstétricos, vacunación, hábitos.
- **Alergias** (con severidad, manifestación, fuente, vigente desde/hasta).
- **Lista de problemas activos / inactivos.**
- **Medicación crónica.**
- **Vacunas** (esquema PAI El Salvador con calendario por edad y coberturas).
- **Notas de evolución** (consulta, hospitalización, emergencia, procedimiento).
- **Resultados de laboratorio, imágenes, anatomía patológica.**
- **Procedimientos realizados.**
- **Cirugías realizadas.**
- **Hospitalizaciones previas.**
- **Documentos adjuntos** (consentimientos firmados, documentos externos escaneados).

### 14.2 Plantillas Clínicas

- Plantillas por especialidad y por motivo de consulta.
- Editor de plantillas para administradores clínicos (sin desarrollo).
- Campos estructurados (selectores, escalas validadas) y campos de texto libre.
- Macros y atajos por usuario.
- Reutilización (copy-forward) controlada para evitar copia automática insegura.

### 14.3 Firma Electrónica

- Firma simple y firma electrónica avanzada/cualificada (cumplimiento Ley de Firma Electrónica de El Salvador y equivalentes).
- Sello de tiempo confiable.
- Una vez firmado, el documento es inmutable; correcciones se realizan mediante adendum con justificación.

### 14.4 Versionamiento

- Toda modificación post-firma queda como versión nueva.
- Visualización lado-a-lado de versiones.

### 14.5 Vacunación

- Calendario nacional (PAI El Salvador) y calendarios alternos por país.
- Registro con lote, fabricante, vía, sitio anatómico.
- Vacunación obligatoria en menores y notificación a sistema nacional cuando aplique.
- COVID-19 y otras vacunas estacionales.

### 14.6 Antecedentes Gineco-obstétricos

- Menarca, ciclos, FUM, fórmula obstétrica (G_P_A_C_), método anticonceptivo.
- Embarazo actual: edad gestacional por FUM y por ecografía, controles prenatales, riesgo gestacional.
- Antecedentes: prematurez previa, cesáreas, abortos, mortinatos.

### 14.7 Antecedentes Pediátricos

- Antecedentes prenatales, perinatales, postnatales.
- Crecimiento y desarrollo: percentiles peso, talla, perímetro cefálico (tablas OMS y locales).
- Hitos del desarrollo psicomotor.
- Lactancia materna.
- Vacunas conforme PAI.

---

## 15. MÓDULO DE FARMACIA Y GESTIÓN DE MEDICAMENTOS

### 15.1 Catálogo Maestro (ver 7.4)

Mantenimiento parametrizable desde la interfaz por farmacéuticos administradores.

### 15.2 Ciclo del Medicamento

```
Prescripción → Validación farmacéutica → Dispensación → Administración (eMAR) → Devolución → Conciliación
```

### 15.3 Prescripción Electrónica (CPOE)

- Búsqueda por principio activo o marca.
- Selección de presentación (forma farmacéutica + concentración).
- Dosis: cantidad, unidad, vía, frecuencia, duración, indicación clínica, condición PRN.
- Cálculo automático para pediatría (dosis/kg, dosis/m²) y validación de rangos.
- **Validación clínica en tiempo real:**
  - Alergias del paciente.
  - Interacciones medicamento-medicamento (con base de conocimiento integrada).
  - Duplicidad terapéutica.
  - Dosis máximas y mínimas.
  - Ajuste por función renal (TFG) y hepática.
  - Interacciones con embarazo/lactancia.
  - Edad pediátrica/geriátrica.
- Soporte para protocolos preestablecidos (paquetes de prescripción: sepsis, IAM, asma, etc.).
- Receta de medicamentos controlados con flujo especial (receta verde/retenida) y firma reforzada.

### 15.4 Validación Farmacéutica

- Cola de validación por farmacéutico clínico antes de dispensar (parametrizable: para qué áreas).
- Alertas resaltadas.
- Comunicación con prescriptor para resolver discrepancias.
- Aprobación, rechazo, sugerencia de cambio.

### 15.5 Dispensación

Modos:

- **Dispensación por unidosis** (paciente individual, dosis individual).
- **Dispensación por dosis única diaria** (un día por paciente).
- **Stock de servicio** (stock periférico controlado en piso).
- **Carro de paro** y **kits** preestablecidos.
- Dispensación de receta ambulatoria (consulta externa, alta hospitalaria).

Funcionalidades:

- Picking guiado por ubicación.
- Validación por código de barras (medicamento + paciente + dosis).
- Lectores RFID para gabinetes automatizados (Pyxis, Omnicell) si aplica integración.
- Trazabilidad por lote y fecha de vencimiento (FEFO — First Expired First Out).
- Reposición automática de stocks periféricos según puntos de reorden.
- Devolución con motivo (dosis no administrada, alta del paciente, cambio de orden).

### 15.6 Preparación de Medicamentos Estériles

- **Mezclas IV** (TPN, quimioterapia, antibióticos reconstituidos).
- Hoja de preparación con cálculos.
- Cabina de flujo laminar / cabina de bioseguridad.
- Etiquetado con paciente, fecha-hora preparación, fecha-hora caducidad post-reconstitución, condiciones de almacenamiento.
- Doble verificación.

### 15.7 Sustancias Controladas

Cumplimiento de la **Ley Reguladora de las Actividades Relativas a las Drogas** y normativa de la DNM en El Salvador:

- Inventario reforzado.
- Doble custodia.
- Libro de control con consecutivo.
- Reportes regulatorios.
- Receta especial (recetario verde / retenida).

### 15.8 Gestión de Inventario Farmacéutico

- Múltiples almacenes (farmacia central, sub-farmacias por servicio, quirófano, emergencia, UCI).
- Control de lotes y fechas de vencimiento.
- Cuarentena (medicamentos en proceso de revisión, retiros del mercado).
- Conteo cíclico y físico.
- Rotación FEFO.
- Cadena de frío con monitoreo de temperatura (vacunas, biológicos, insulinas).
- Alertas de bajo stock, vencimiento próximo, sobre-stock.
- Compras y recepción con validación contra orden de compra.

### 15.9 Conciliación Medicamentosa

En transiciones de cuidado (ingreso, traslado entre servicios, egreso):

- Lista de medicación previa (en casa o de otra institución).
- Comparación con prescripción actual.
- Decisiones documentadas (continuar, suspender, modificar, agregar).
- Reducción de errores de medicación.

### 15.10 Farmacovigilancia

- Notificación de reacciones adversas a medicamentos (RAM).
- Reporte a la autoridad regulatoria (en El Salvador: Centro Nacional de Farmacovigilancia / DNM).

---

## 16. MÓDULO DE ADMINISTRACIÓN DE MEDICAMENTOS (eMAR)

### 16.1 Concepto

El **electronic Medication Administration Record (eMAR)** es la hoja electrónica donde enfermería registra la administración real de cada dosis prescrita.

### 16.2 Vista del eMAR

- Vista por paciente: matriz medicamento × hora del día.
- Vista por enfermero(a): pendientes en su turno con priorización.
- Vista por servicio.
- Indicadores de cumplimiento: a tiempo, con retraso, omitido, rechazado.

### 16.3 Validación 5+ Correctos (5 Rights)

Antes de administrar, el sistema valida mediante código de barras o RFID:

1. **Paciente correcto** (escaneo del brazalete).
2. **Medicamento correcto.**
3. **Dosis correcta.**
4. **Vía correcta.**
5. **Hora correcta** (con ventana de tolerancia configurable, típicamente ±30 min).

Variantes opcionales (7+ Rights): documentación correcta, razón correcta, respuesta correcta.

### 16.4 Registro de Administración

- Hora real de administración.
- Sitio anatómico (para parenterales).
- Lote y fecha de vencimiento (capturados por barras).
- Profesional que administra (firma electrónica).
- Profesional verificador (cuando aplica doble verificación: insulinas, anticoagulantes, opioides, quimioterapia, vasoactivos pediátricos).
- Observaciones.

### 16.5 Manejo de No-Administración

Motivos parametrizables: paciente NPO para procedimiento, paciente en estudio, vómito previo, paciente fallecido, paciente trasladado, paciente egresado, rechazo del paciente, no disponible en servicio.

### 16.6 Infusiones Continuas

- Registro de inicio, cambios de velocidad, cambios de bolsa.
- Cálculo automático de cantidad infundida y residuo.
- Integración con bombas de infusión inteligentes (bidireccional cuando es factible) con biblioteca de fármacos (DERS).

### 16.7 Medicamentos PRN

- Registro de evaluación pre-administración (ej. escala de dolor).
- Registro de respuesta post-administración.
- Control de frecuencia mínima entre dosis.

### 16.8 Indicadores

- Tasa de administración a tiempo.
- Tasa de errores de medicación detectados (cerca del paciente vs. con daño).
- Tiempo prescripción-administración de la primera dosis.

---

## 17. MÓDULO DE LABORATORIO CLÍNICO (LIS)

### 17.1 Solicitud (Order Entry)

- Solicitud por médico desde HCE (paneles, pruebas individuales, urgencia).
- Indicación clínica obligatoria.
- Reglas de aprobación (algunas pruebas requieren autorización).
- Detección de duplicidades (misma prueba en últimas X horas).
- Coordinación con financiero para coberturas.

### 17.2 Toma de Muestra

- Etiquetas con código de barras (paciente + orden + tipo de tubo).
- Identificación positiva del paciente.
- Recolección por flebotomista o auto-toma según prueba.
- Captura de hora de toma.
- Cadena de frío cuando aplique.
- Trazabilidad en transporte.

### 17.3 Recepción en Laboratorio

- Validación de muestra (volumen, contenedor, hemólisis, lipemia, ictericia, coagulación).
- Rechazo con motivo.
- Distribución a áreas (hematología, química, microbiología, inmunología, parasitología, banco de sangre, biología molecular).

### 17.4 Procesamiento e Interfase con Equipos

- Interfase bidireccional con analizadores (hematología, química seca, gases, inmunoensayos, PCR) vía HL7 v2 / ASTM.
- Cargue automático de resultados.
- Repeticiones automáticas según reglas (delta check, valores críticos).

### 17.5 Validación Técnica y Médica

- Validación técnica por técnico de laboratorio.
- Validación médica por patólogo clínico para resultados sensibles.
- Reglas de auto-validación.
- Manejo de **valores críticos** con notificación inmediata al médico tratante (y registro de a quién y a qué hora se notificó).

### 17.6 Resultados y Reporte

- Resultados con valores de referencia por edad/sexo.
- Tendencias gráficas históricas.
- Comentarios interpretativos.
- Reporte firmado electrónicamente.
- Disponibilidad inmediata en HCE.
- Resultados al portal del paciente (cuando esté habilitado).

### 17.7 Áreas Especiales

- **Microbiología:** cultivos con identificación y antibiograma, MIC, perfiles de resistencia, alertas epidemiológicas.
- **Banco de sangre:** tipificación ABO/Rh, escrutinio de anticuerpos, pruebas cruzadas, despacho de hemocomponentes con trazabilidad de bolsa, registro de transfusión y reacción transfusional.
- **Anatomía patológica:** macroscopía, microscopía, inmunohistoquímica, reportes estructurados (Bethesda, TNM).
- **Biología molecular:** PCR (incluido SARS-CoV-2, dengue PCR, HIV carga viral), secuenciación.
- **Citogenética.**

### 17.8 Control de Calidad

- Controles internos (Levey-Jennings, reglas Westgard).
- Controles externos / esquemas de evaluación de desempeño.
- Calibraciones.

### 17.9 Indicadores

- Tiempo de respuesta (TAT) por prueba.
- Tasa de rechazo de muestras.
- Tasa de valores críticos notificados < 30 min.
- Productividad por área.

---

## 18. MÓDULO DE IMÁGENES DIAGNÓSTICAS (RIS/PACS)

### 18.1 Solicitud

- Solicitud médica con indicación clínica (justificación obligatoria por radioprotección).
- Selección del estudio de catálogo.
- Modalidad y protocolo.
- Preparación al paciente (si aplica: ayuno, hidratación, retiro de objetos metálicos, contraste oral, micción).
- Verificación de embarazo en mujeres en edad fértil para estudios con radiación.
- Contraindicaciones para contraste (alergias, función renal).

### 18.2 Programación

- Agenda por sala/equipo (RX, USG, TAC, RM, mamografía, fluoroscopía, medicina nuclear, densitometría).
- Asignación según urgencia.

### 18.3 Realización del Estudio

- Worklist DICOM (DMWL) automática al modality.
- Realización del estudio con tecnólogo.
- Captura de dosis (en TAC: CTDIvol, DLP; en fluoroscopía: tiempo de scopia, kerma; en mamografía: dosis glandular).
- Almacenamiento DICOM en PACS.

### 18.4 Lectura e Informe

- Visor diagnóstico DICOM (zoom, ventana, MPR, MIP, mediciones).
- Lectura por radiólogo con plantillas estructuradas (RSNA, BI-RADS, LI-RADS, PI-RADS, TI-RADS, Lung-RADS).
- Informe firmado electrónicamente.
- Hallazgos críticos con notificación urgente al médico solicitante.
- Doble lectura (para mamografía de tamizaje, por ejemplo).
- Tele-radiología (lectura remota por radiólogo en otra sede o país en redes multi-organización).

### 18.5 Disponibilidad de Imágenes e Informes

- En HCE inmediatamente al firmar el informe.
- Visor ligero embebido en HCE.
- Compartición con paciente vía portal (cuando aplique) con marca de agua y consentimiento.

### 18.6 Indicadores

- TAT por modalidad.
- Tasa de re-estudios.
- Discrepancia entre lecturas.
- Cumplimiento de notificación de hallazgos críticos.

### 18.7 Radioprotección y Cumplimiento

- Registro acumulado de dosis por paciente (especialmente pediatría y oncología).
- Justificación de cada estudio con radiación.
- ALARA (As Low As Reasonably Achievable).

---

## 19. MÓDULO DE INSUMOS Y ALMACÉN HOSPITALARIO

### 19.1 Estructura de Almacenes

- Almacén general (institucional).
- Sub-almacenes por área: farmacia, quirófano, emergencia, UCI, hospitalización por servicio, laboratorio, imágenes, lavandería, alimentación.
- Almacén de cuarentena, devoluciones, vencidos.
- Cada almacén con responsable, ubicación física, condiciones (temperatura, humedad).

### 19.2 Catálogo de Insumos

- Código interno + código GTIN/UDI.
- Descripción técnica.
- Unidad base, unidades de empaque, factor de conversión.
- Marca, fabricante.
- Registro sanitario.
- Crítico/no crítico.
- Reusable/desechable.
- Estéril/no estéril.
- Punto de reorden, stock mínimo, stock máximo.

### 19.3 Movimientos

- Recepción desde compras (con verificación contra orden de compra).
- Transferencias entre almacenes.
- Consumos (cargados a paciente o a centro de costo).
- Devoluciones.
- Mermas y bajas (vencimiento, deterioro, pérdida) con autorización.
- Ajustes de inventario (físico vs sistema).

### 19.4 Trazabilidad

- Por lote y fecha de vencimiento.
- UDI para dispositivos médicos cuando aplique.
- Vínculo del consumo con paciente y procedimiento (para retiros del mercado).

### 19.5 Recetas e Imputación

- Cargos automáticos a la cuenta del paciente al consumir desde su orden.
- Cargos a centro de costo cuando es consumo del servicio (gel antiséptico, papel higiénico institucional, etc.).

### 19.6 Compras

- Solicitudes de compra desde almacenes.
- Cotizaciones a proveedores.
- Órdenes de compra.
- Recepción.
- Cumplimiento de la Ley LACAP (Ley de Adquisiciones y Contrataciones de la Administración Pública) cuando se trate de instituciones públicas en El Salvador.

---

## 20. MÓDULO DE SERVICIOS HOSPITALARIOS, USOS Y EQUIPOS

### 20.1 Catálogo de Servicios Facturables

Parametrizable desde el sistema. Ejemplos:

- Cama hospitalaria por día (por categoría: privada, semi-privada, sala común, UCI, UCIN, UCIP, UCO, intermedios, aislamiento).
- Atención de enfermería por turno.
- Honorarios médicos (visita, evolución, junta médica).
- Tiempo de quirófano (por minuto / por bloque).
- Tiempo de sala de partos.
- Salas de procedimientos.
- Tiempo de equipo: ventilador mecánico (por hora/día), monitor de signos vitales, bomba de infusión, máquina de hemodiálisis, lámpara de fototerapia, incubadora, cuna de calor radiante, etc.
- Oxígeno medicinal (por hora o consumo medido).
- Dispositivos: catéteres, sondas, drenajes (por unidad).
- Material descartable.

### 20.2 Reglas de Facturación de Servicios

- Reglas de prorrateo cuando un paciente cambia de cama/servicio durante el día.
- Día de ingreso vs día de egreso (regla "se cobra el día de ingreso, no el de egreso" o equivalente, configurable).
- Servicios incluidos en paquetes (paquete de parto, paquete de cesárea).
- Tarifas diferenciadas por convenio/aseguradora.

### 20.3 Gestión de Equipos Médicos

- Inventario completo con número de activo, marca, modelo, serie, ubicación, estado (operativo, en mantenimiento, fuera de servicio, dado de baja).
- **Mantenimiento preventivo** programado con calendarios y alertas.
- **Mantenimiento correctivo** con bitácora de fallas, tiempos de respuesta, repuestos.
- Calibraciones y verificaciones.
- Pruebas de seguridad eléctrica.
- Vida útil y reemplazo planificado.
- Vinculación de equipo a paciente durante uso (ej. ventilador #5 conectado al paciente X durante el período Y, para trazabilidad y facturación).
- Costos de operación por equipo para análisis de costo por servicio.

### 20.4 Servicios de Apoyo

- Lavandería: ropa hospitalaria, bata, sábanas, control de circuito limpio/sucio.
- Limpieza y desinfección por área con frecuencias.
- Mantenimiento de planta física.
- Seguridad y vigilancia.
- Transporte de pacientes interno (camillería).

---

## 21. MÓDULO DE TERAPIA RESPIRATORIA

### 21.1 Procesos Cubiertos

- Oxigenoterapia (cánula nasal, mascarilla simple, mascarilla con reservorio, Venturi, alto flujo).
- Nebulizaciones (broncodilatadores, corticoides, mucolíticos, suero salino hipertónico).
- Inhaloterapia con dispositivos (MDI con espaciador, DPI).
- Aspiración de secreciones (orofaríngea, traqueal, por TET/cánula de traqueostomía).
- Drenaje postural y fisioterapia respiratoria.
- Espirometría / pruebas funcionales respiratorias.
- Ventilación mecánica no invasiva (CPAP, BiPAP).
- Ventilación mecánica invasiva (en UCI; ver módulo 11).
- Manejo de vía aérea avanzada.
- Cuidados de traqueostomía.

### 21.2 Funcionalidades

- Indicación médica desde HCE con dispositivo, dosis, frecuencia, FiO₂ objetivo, parámetros ventilatorios.
- Hoja de terapia respiratoria con registro de cada sesión.
- Pre y post-evaluación: SpO₂, FR, auscultación, escala de disnea (Borg, mMRC), pico flujo.
- Uso de equipos (carga al paciente).
- Insumos consumidos (filtros, kits, máscaras).
- Indicadores: cumplimiento de terapias, mejoría clínica.

### 21.3 Catálogo Parametrizable

- Tipos de terapia respiratoria.
- Dispositivos.
- Mezclas para nebulización.
- Protocolos por patología (asma, EPOC, bronquiolitis, fibrosis quística).

---

## 22. MÓDULO DE NUTRICIÓN Y ALIMENTACIÓN

### 22.1 Valoración Nutricional

- Antropometría (peso, talla, IMC, perímetro braquial, pliegues).
- Tamizaje nutricional al ingreso (NRS-2002, MUST, MNA en adultos mayores, STRONGkids en pediatría).
- Diagnóstico nutricional (CIE-10 / códigos de nutrición ADIME).
- Plan nutricional.
- Necesidades energéticas y de macronutrientes calculadas (Harris-Benedict, Mifflin-St Jeor, Schofield, ecuaciones pediátricas).

### 22.2 Tipos de Alimentación

- **Vía oral:** dieta general, blanda mecánica, blanda química, líquidos claros, líquidos completos, dieta especiales (diabética, hipocalórica, hipoproteica, hiperproteica, hiposódica, baja en grasa, sin gluten, sin lactosa, kosher, halal, vegetariana, vegana, etc.).
- **Pediátrica/lactante:** lactancia materna exclusiva, fórmula infantil (con marca y dilución), papilla por edad.
- **Enteral por sonda:** nasogástrica, nasoyeyunal, gastrostomía, yeyunostomía. Fórmula, volumen, velocidad, modo (continua, intermitente, bolos).
- **Parenteral:** central, periférica. Fórmula con macronutrientes (glucosa, aminoácidos, lípidos), micronutrientes (electrolitos, vitaminas, oligoelementos).

### 22.3 Servicio de Alimentación

- Generación automática de minutas por paciente según indicación dietética.
- Programación de raciones (desayuno, media mañana, almuerzo, merienda, cena, refrigerio nocturno).
- Hoja de cocina consolidada por servicio.
- Control de bandejas servidas y devueltas.
- Adherencia a la dieta.
- Restricciones por procedimientos (NPO desde X hora).
- Preferencias y aversiones del paciente.

### 22.4 Alimentos y Recetas

- Catálogo de alimentos con composición nutricional (kcal, macros, micros).
- Recetario con composición.
- Costo por preparación y por ración para análisis financiero.

### 22.5 Educación y Seguimiento

- Material educativo nutricional.
- Citas de seguimiento ambulatorio con nutricionista.
- Adherencia post-alta.

---

## 23. MÓDULO DE CUENTAS HOSPITALARIAS Y FACTURACIÓN

### 23.1 Cuenta Hospitalaria

Concepto central que agrupa todos los cargos generados durante un episodio asistencial:

- Identificador único de cuenta.
- Vinculación con paciente, episodio, tipo de paciente, convenio.
- Estado: abierta, suspendida, cerrada, facturada, anulada.
- Fecha de apertura y cierre.
- Responsable de pago: paciente, asegurador, empresa, tercero, mixto (con porcentajes).

### 23.2 Cargos Automáticos

El sistema genera cargos automáticamente desde:

- Admisión y estancia (cama por día).
- Honorarios médicos (visita registrada).
- Medicamentos administrados (eMAR + dispensación).
- Insumos consumidos.
- Procedimientos realizados.
- Laboratorios solicitados/realizados.
- Imágenes solicitadas/realizadas.
- Tiempo de quirófano.
- Uso de equipos (ventilador, monitores, bombas).
- Servicios de apoyo (terapia respiratoria, fisioterapia, nutrición).
- Alimentación.

### 23.3 Tarificación

- Multi-tarifario:
  - Tarifa privada institucional (por defecto).
  - Tarifa por convenio/aseguradora.
  - Tarifa especial por contrato corporativo.
  - Tarifa social/gratuita (para casos sociales aprobados).
- Reglas:
  - Descuentos por convenio.
  - Recargos (atención fuera de horario, festividad, urgencia).
  - Copagos y deducibles.
  - Coaseguro.
  - Tope por cobertura.
- Multi-moneda: cuentas en USD por defecto en El Salvador, otras monedas según contexto.

### 23.4 Pre-facturación y Conciliación

- Vista detallada de la cuenta antes de facturar.
- Validación de cargos contra orden médica.
- Detección de cargos duplicados.
- Validación de coberturas.
- Solicitud de aprobación al asegurador para procedimientos no incluidos.
- Conciliación con auditor médico de la aseguradora.

### 23.5 Facturación Electrónica (DTE - El Salvador)

Cumplimiento integral con el régimen de **Documentos Tributarios Electrónicos** del Ministerio de Hacienda de El Salvador:

- Tipos de DTE soportados:
  - **Factura de Consumidor Final** (paciente directo).
  - **Comprobante de Crédito Fiscal (CCF)** (paciente que es contribuyente).
  - **Nota de Remisión.**
  - **Nota de Crédito** (anulaciones, devoluciones, descuentos posteriores).
  - **Nota de Débito** (cargos adicionales).
  - **Comprobante de Liquidación.**
  - **Comprobante de Retención.**
  - **Factura Sujeto Excluido.**
  - **Factura de Exportación** (cuando aplique a pacientes extranjeros con servicios exportados).
- Generación del JSON DTE conforme al esquema oficial.
- **Firma electrónica** con certificado del contribuyente.
- **Transmisión** al Ministerio de Hacienda y obtención del **sello de recepción**.
- **Contingencia** en caso de no respuesta del sistema MH (modo offline) y posterior transmisión.
- Generación de **PDF/A** del DTE con QR de validación.
- Envío automático al correo del receptor.
- Almacenamiento por mínimo **10 años** conforme al Código Tributario.
- Rangos y series controlados.
- Anulaciones conforme normativa.

### 23.6 Otros Países (Multi-país Fiscal)

El módulo debe ser extensible a otros regímenes:

- **Guatemala:** FEL (Factura Electrónica en Línea) SAT.
- **Honduras:** Factura electrónica SAR.
- **Costa Rica:** Factura electrónica DGT.
- **México:** CFDI 4.0 SAT.
- **Panamá:** Factura electrónica DGI.
- **Colombia:** Factura electrónica DIAN.

Arquitectura por **adaptadores fiscales** activables por país.

### 23.7 Cobros y Cartera

- Caja: pago en efectivo (USD y monedas extranjeras), tarjetas, transferencias, cheques, ACH, monederos electrónicos, criptomonedas (cuando se autorice).
- Recibos de caja.
- Aplicación de pagos a cuentas y facturas (FIFO, manual).
- Cuentas por cobrar con antigüedad.
- Cartera por convenio, por paciente.
- Gestión de cobranza (etapas, contactos, acuerdos de pago, refinanciamientos).
- Castigo de cartera con autorización.

### 23.8 Cuentas por Pagar

- Recepción de facturas de proveedores.
- Aprobación.
- Programación de pagos.
- Retenciones fiscales (en El Salvador: retención de IVA cuando aplica, retención de ISR a personas naturales).
- Generación de comprobantes de retención.
- Pagos por transferencia, cheque.

---

## 24. MÓDULO DE CONTABILIDAD Y FINANZAS MULTI-LIBRO

### 24.1 Plan de Cuentas

- Plan de cuentas por libro contable.
- Estructura jerárquica con niveles configurables.
- Cuentas de naturaleza (activo, pasivo, patrimonio, ingreso, costo, gasto, orden).
- Cuentas operativas y de cierre.
- Validaciones (cuentas que requieren centro de costo, tercero, moneda, proyecto).

### 24.2 Asientos Contables

- Asientos manuales y automáticos.
- **Asientos automáticos** generados por:
  - Ventas y facturación.
  - Recibos de caja.
  - Compras y pagos a proveedores.
  - Nómina (cuando se integre).
  - Inventarios (entradas, salidas, ajustes).
  - Activos fijos (depreciación, baja).
  - Diferencia cambiaria.
  - Provisiones.
- Numeración por tipo de asiento.
- Validación de partida doble.
- Aprobación / mayorización (cierre del asiento).

### 24.3 Multi-Libro Paralelo

Cada hecho económico genera asientos en cada libro activo:

- Libro fiscal local (El Salvador: NIIF para PYMES o NIIF plenas).
- Libro IFRS (NIIF plenas para holding).
- Libro USGAAP (cuando aplica).
- Libro gerencial (con eliminaciones y ajustes internos).
- Libro presupuestal.

Reglas:

- Mapeo de cuenta única a cuenta de cada libro.
- Diferencias permanentes (ej. conceptos no deducibles fiscalmente que sí lo son contablemente).
- Diferencias temporales (ej. depreciaciones distintas).
- Eliminaciones intercompañía en consolidado.

### 24.4 Centros de Costo / Centros de Ingreso

- Estructura jerárquica.
- Asignación a cada movimiento.
- Reportes por centro.
- Distribución de costos comunes (cocina, lavandería, mantenimiento) a centros productivos por drivers (kg de ropa, raciones, m² atendidos).

### 24.5 Costos Hospitalarios

- Costo por servicio hospitalario.
- Costo por cama-día por servicio.
- Costo por procedimiento.
- Costo por paciente / por episodio.
- Costo por DRG (Grupo Relacionado por Diagnóstico) cuando se implemente.

### 24.6 Activos Fijos

- Registro con cuenta contable, centro de costo, ubicación, responsable.
- Métodos de depreciación: línea recta, suma de dígitos, unidades producidas, acelerada (configurable por libro).
- Revaluación.
- Bajas y disposiciones.

### 24.7 Cierre Contable

- Cierre mensual y anual.
- Generación de estados financieros: balance general, estado de resultados, estado de cambios en el patrimonio, estado de flujo de efectivo, notas.
- Por libro, por organización, consolidado.
- Re-apertura controlada con justificación y auditoría.

### 24.8 Cumplimiento Fiscal El Salvador

- **IVA mensual** (declaración F-07).
- **Pago a cuenta y retenciones de ISR** (declaración mensual).
- **Renta anual** (declaración F-11).
- **Informe anual de retenciones (F-910).**
- **Informe de operaciones con sujetos relacionados.**
- Libros de IVA: ventas a consumidor final, ventas a contribuyentes, compras.
- Libro Diario, Libro Mayor, Libro de Estados Financieros (con folios autorizados por el CVPCPA).

### 24.9 Presupuesto

- Carga del presupuesto anual por cuenta y centro.
- Revisiones y modificaciones presupuestales.
- Ejecución vs presupuesto.
- Compromisos y reservas.
- Disponibilidad presupuestal previa a compras.

### 24.10 Tesorería

- Bancos y cuentas.
- Conciliación bancaria automática (con archivos del banco).
- Flujo de caja proyectado.
- Inversiones y pasivos financieros.

---

## 25. MÓDULO DE CONVENIOS Y ASEGURADORAS

### 25.1 Convenios

- Catálogo de convenios con cada aseguradora / empresa / institución.
- Vigencia, condiciones, anexos.
- **Tarifario propio del convenio** (precios negociados).
- **Cuadro de cobertura:** servicios cubiertos, no cubiertos, copagos, coaseguros, deducibles, topes.
- Pre-autorizaciones requeridas por procedimiento.
- Tiempos de respuesta de autorización.

### 25.2 Validación en Tiempo Real

- Verificación de elegibilidad del afiliado.
- Verificación de cobertura del servicio.
- Solicitud de pre-autorización.
- Comunicación con la aseguradora vía:
  - Portal de la aseguradora (manual).
  - Webservice / API (cuando exista).
  - Mensajería HL7 / X12 270/271, 278.

### 25.3 Convenios Especiales en El Salvador

Soporte específico para los convenios más comunes:

- **ISSS** (Instituto Salvadoreño del Seguro Social): atención a derechohabientes, generación de reportes según formato del ISSS, conciliación de servicios prestados.
- **ISBM** (Instituto Salvadoreño de Bienestar Magisterial).
- **Sanidad Militar.**
- **Bienestar Magisterial.**
- **MINSAL** (cuando hospitales privados atienden referidos del sistema público).
- **FOSALUD.**
- **Alcaldías** y otros entes públicos.
- Aseguradoras privadas locales (SISA, ASESUISA, SEGUROS DEL PACÍFICO, etc.).
- Aseguradoras internacionales (BUPA, ALLIANZ, etc.).

### 25.4 Liquidación al Convenio

- Generación periódica (semanal, quincenal, mensual) de liquidación.
- Detalle de pacientes atendidos, servicios, montos.
- Aplicación de cobertura, copagos.
- Envío al asegurador en el formato requerido.
- Conciliación de respuestas del asegurador (aprobado, glosado, en revisión).
- Gestión de glosas con respuesta y reproceso.

---

## 26. MÓDULO DE REPORTERÍA E INTELIGENCIA DE NEGOCIOS

### 26.1 Reportes Operativos

Por módulo, con filtros y exportación a Excel, PDF, CSV:

- Censo y movimientos diarios.
- Pacientes atendidos por servicio, médico, especialidad.
- Producción quirúrgica.
- Producción de laboratorio e imágenes.
- Consumo de medicamentos e insumos.
- Cuentas pendientes de cierre.
- Glosas pendientes.

### 26.2 Reportes Regulatorios

Cumplimiento con reportes obligatorios:

- **Vigilancia epidemiológica** (MINSAL): notificación obligatoria semanal y diaria de enfermedades como dengue, chikungunya, zika, malaria, COVID-19, tuberculosis, VIH, IRA, EDA, sospechas, brotes.
- **SUIS / SIMMOW** (sistemas del MINSAL).
- **Estadísticas hospitalarias**: egresos, mortalidad, morbilidad, intervenciones quirúrgicas, partos, recién nacidos.
- **Indicadores de calidad** (NICE, JCI, JCIA cuando aplica acreditación).
- **Notificaciones a CVPCPA** y entes de auditoría.
- Reportes al **ISSS** sobre pacientes derechohabientes atendidos.
- **Reportes fiscales** al Ministerio de Hacienda.
- **Reportes al BCR** y a otras autoridades.

### 26.3 Indicadores Hospitalarios (KPIs)

- **Asistenciales:** % ocupación, giro cama, estancia promedio, tasa de mortalidad bruta y neta, tasa de infección nosocomial, tasa de cesáreas, tasa de reingreso 30 días, tiempo puerta-aguja, tiempo puerta-balón, sepsis bundle compliance.
- **Calidad y seguridad del paciente:** errores de medicación, eventos adversos, caídas, úlceras por presión adquiridas en el hospital, cirugía en sitio incorrecto, identificación errónea.
- **Operativos:** TAT laboratorio, TAT imágenes, tiempo de espera en consulta, tiempo de espera en emergencia por nivel de triage.
- **Financieros:** ingresos, egresos, margen, días de cartera, costo por servicio.
- **Recursos humanos:** rotación, ausentismo, horas extra.

### 26.4 Tableros y BI

- Tableros gerenciales por rol (director médico, director financiero, jefe de servicio).
- Visualización en tiempo real (con SLA de actualización).
- Drill-down hasta el detalle.
- Alertas configurables por umbrales.
- Integración con herramientas BI externas (Power BI, Tableau, Metabase, Superset) vía data warehouse y modelos dimensionales.

### 26.5 Constructor de Reportes

- Reportes ad-hoc por usuarios autorizados con vistas seguras (sin acceso directo a base transaccional).
- Programación de reportes (envío automático por correo).
- Compartición y permisos.

---

## 27. TROPICALIZACIÓN PARA EL SALVADOR

### 27.1 Marco Normativo

Cumplimiento integral con:

- **Constitución de la República.**
- **Código de Salud** y su reglamento.
- **Ley del Sistema Nacional Integrado de Salud (SNIS).**
- **Ley de Medicamentos** (DNM).
- **Ley Reguladora de las Actividades Relativas a las Drogas** (psicotrópicos y estupefacientes).
- **Ley de Protección de Datos Personales.**
- **Ley de Firma Electrónica** y su reglamento.
- **Código Tributario** y leyes fiscales (IVA, ISR, Renta).
- **Ley Especial para Sancionar Infracciones Aduaneras.**
- **Ley LACAP** (para instituciones públicas en compras).
- **Ley contra la Violencia Intrafamiliar / LEIV** (notificación y atención).
- **LEPINA** (atención a niños, niñas y adolescentes).
- **Normativas del MINSAL** (atención por niveles, referencia y contrarreferencia, programas verticales: PAI, materno-infantil, tuberculosis, VIH, ITS, salud mental, salud bucal).
- **Normativas del CSSP** (Consejo Superior de Salud Pública) sobre ejercicio profesional.
- **Normativa de habilitación y acreditación** de establecimientos.

### 27.2 Catálogos Locales

- Departamentos de El Salvador (14): Ahuachapán, Santa Ana, Sonsonate, Chalatenango, La Libertad, San Salvador, Cuscatlán, La Paz, Cabañas, San Vicente, Usulután, San Miguel, Morazán, La Unión.
- Municipios (262 antes / 44 después de la reforma de 2024 — configurable según vigencia).
- Distritos.
- Códigos de establecimientos del MINSAL.
- Catálogo de profesionales registrados en JVPM (Junta de Vigilancia de la Profesión Médica) y en otras juntas (enfermería, farmacia, psicología, etc.).

### 27.3 Documentos de Identidad El Salvador

- **DUI** con validación del dígito verificador.
- **NIT** con validación.
- **NIE** (Número de Identificación de Extranjero).
- **Carné de minoridad / partida de nacimiento** para menores.
- **NUP** (Número Único Previsional) en contextos previsionales.

### 27.4 Calendario y Localización

- Feriados nacionales: 1 enero, Jueves/Viernes/Sábado Santo, 1 mayo, 10 mayo (Día de la Madre), 17 junio (Día del Padre), 1 agosto (vacaciones agostinas), 6 agosto (San Salvador del Mundo), 15 septiembre (Independencia), 2 noviembre (Día de los Difuntos), 25 diciembre.
- Feriados locales por municipio (fiestas patronales).
- Zona horaria: America/El_Salvador (UTC-6, sin horario de verano).
- Formato fecha: DD/MM/AAAA.
- Separador decimal: punto (.) para moneda en USD; configurable para coma cuando se opere otra moneda.
- Separador de miles: coma.

### 27.5 Moneda y Sistema Monetario

- Moneda oficial: **USD (Dólar de los Estados Unidos)** desde 2001 (Ley de Integración Monetaria).
- Soporte secundario para colón salvadoreño (SVC) histórico (cuando se manejen registros antiguos).
- Soporte para **Bitcoin (BTC)** como moneda de curso legal (Ley Bitcoin desde 2021), con conversión a USD para registros contables y fiscales según el tipo de cambio del momento de la transacción (mientras la ley esté vigente; configurable).

### 27.6 Facturación Electrónica DTE

Implementación completa según lo especificado en la sección 23.5 y la normativa actualizada del Ministerio de Hacienda.

### 27.7 Reportes Sanitarios Locales

- **Notificación obligatoria al MINSAL** de enfermedades de declaración obligatoria.
- **Reporte semanal epidemiológico** (formato MINSAL).
- **Reporte de defunciones** con codificación CIE-10 al MINSAL y registro civil.
- **Reporte de nacimientos** con datos para registro civil y carné de salud infantil.
- **Reporte de mortalidad materna y perinatal.**
- **Reporte al PAI** (Programa Ampliado de Inmunizaciones).
- **Reporte de tuberculosis (PCT).**
- **Reporte de VIH (Programa Nacional ITS/VIH/Sida).**

### 27.8 Particularidades Culturales y Lingüísticas

- Interfaz en **español de El Salvador** con terminología local (ej. "consulta externa" antes que "outpatient", "incapacidad" antes que "permiso médico").
- Soporte opcional para idiomas indígenas (nawat) en interfaces para pacientes en zonas con población hablante.
- Atención a poblaciones específicas: comunidades indígenas, migrantes retornados, deportados (registros con condiciones específicas).

### 27.9 Conectividad

- Soporte para zonas con conectividad limitada (modo offline parcial con sincronización posterior).
- Compresión de datos para enlaces de baja velocidad.
- App móvil ligera para personal de campo.

---

## 28. INTEGRACIONES E INTEROPERABILIDAD

### 28.1 Estándares Soportados

- **HL7 v2.x** (mensajería ADT, ORM, ORU, MDM, SIU, DFT, BAR).
- **HL7 FHIR R4** (Patient, Encounter, Observation, MedicationRequest, MedicationAdministration, ImagingStudy, DiagnosticReport, etc.).
- **DICOM 3.0** (almacenamiento, query/retrieve, worklist, MPPS, structured reporting).
- **IHE** (perfiles XDS, PIX/PDQ, ATNA, XCPD, XCA).
- **CIE-10 / CIE-11.**
- **SNOMED CT.**
- **LOINC.**
- **CDA (Clinical Document Architecture).**
- **CCDA / CCD** (Continuity of Care Document).
- **NCPDP** (para integraciones farmacéuticas).
- **X12** (270/271 elegibilidad, 278 autorizaciones, 837 reclamos).

### 28.2 Integraciones con Sistemas Externos

- **Equipos médicos:** monitores de signos vitales, ventiladores, bombas de infusión, analizadores de laboratorio, equipos de imagen.
- **PACS** y visores DICOM.
- **Sistemas regulatorios nacionales:** MINSAL (SUIS, SIMMOW), Ministerio de Hacienda (DTE), Registro Civil, ISSS.
- **Aseguradoras:** webservices, portales.
- **Bancos:** archivos de conciliación, pasarelas de pago.
- **Mensajería:** SMTP, SMS gateways, WhatsApp Business API, push notifications.
- **Identidad:** AD/LDAP, IdPs SAML/OIDC.
- **Sistemas de telemedicina** externos.
- **Wearables y dispositivos del paciente** (cuando aplique al portal del paciente).

### 28.3 Bus de Integración

- Motor de orquestación (Mirth Connect, Apache Camel, similar).
- Cola de mensajes con reintentos y dead-letter queue.
- Monitoreo de integraciones (mensajes enviados, fallidos, en cola).
- Mapeos parametrizables.

### 28.4 API Pública

- API REST y GraphQL versionada y documentada (OpenAPI/Swagger).
- Autenticación OAuth 2.0 / OpenID Connect.
- Rate limiting.
- Sandbox para integradores.
- SDKs para lenguajes principales (Java, .NET, Python, Node.js).

---

## 29. REQUISITOS NO FUNCIONALES

### 29.1 Rendimiento

- Tiempo de respuesta promedio en transacciones interactivas: **≤ 1.5 s** para el 95% de operaciones.
- Soporte concurrente de **mínimo 2,000 usuarios activos** en la instancia base, escalable horizontalmente a 20,000+.
- Throughput mínimo: 500 transacciones/segundo en horas pico.

### 29.2 Disponibilidad

- **Disponibilidad 99.9%** en horario 7x24 (downtime ≤ 8.76 horas/año).
- Mantenimientos programados con notificación mínima de 7 días.
- Plan de continuidad (BCP) y de recuperación ante desastres (DRP) documentado y probado anualmente.
- RPO ≤ 15 minutos. RTO ≤ 4 horas.

### 29.3 Escalabilidad

- Arquitectura horizontalmente escalable.
- Particionamiento por organización / país.
- Crecimiento de datos esperado: 5 TB/año en producción mediana.

### 29.4 Seguridad

- TLS 1.3 en todos los canales.
- AES-256 en reposo.
- Gestión de secretos (Vault, KMS).
- Pruebas de seguridad periódicas (pentest mínimo anual).
- Cumplimiento ISO 27001 / SOC 2 deseable.
- Cumplimiento HIPAA-equivalente para datos de salud.

### 29.5 Usabilidad

- Diseño centrado en el usuario clínico (minimizar clics, captura por voz cuando sea posible).
- WCAG 2.1 AA para accesibilidad.
- Responsive en escritorio, tablet y móvil.
- Modo claro y modo oscuro.
- Atajos de teclado.
- Personalización por usuario (favoritos, plantillas, dashboards).

### 29.6 Mantenibilidad

- Código documentado y con cobertura de pruebas automatizadas ≥ 80%.
- Pipeline CI/CD con despliegues controlados.
- Ambientes: desarrollo, calidad, capacitación, pre-producción, producción.
- Herramientas de monitoreo y alerting.
- SLA de soporte por niveles.

### 29.7 Portabilidad

- Independencia razonable de proveedor de nube (cloud-agnostic con servicios open-source equivalentes).
- Posibilidad de despliegue on-premise.

### 29.8 Cumplimiento y Auditoría

- Cumplimiento con normas ya descritas.
- Auditoría externa anual de TI.
- Pruebas de penetración anuales.
- Revisión de privilegios de acceso semestral.

### 29.9 Soporte Técnico

- Niveles de servicio:
  - **Crítico:** sistema fuera de servicio o riesgo a paciente — respuesta < 15 min, resolución < 2 h.
  - **Alto:** módulo principal afectado — respuesta < 1 h, resolución < 8 h.
  - **Medio:** funcionalidad limitada — respuesta < 4 h, resolución < 2 días.
  - **Bajo:** consultas y mejoras — respuesta < 1 día, resolución según planificación.
- Mesa de ayuda 7x24 multicanal.
- Base de conocimiento.

---

## 30. ENTREGABLES, CRONOGRAMA Y ACEPTACIÓN

### 30.1 Entregables

1. **Documentación**
   - Documento de arquitectura.
   - Diccionario de datos.
   - Manual de instalación y configuración.
   - Manuales de usuario por rol.
   - Manual del administrador del sistema.
   - Manual del administrador clínico (catálogos, plantillas, reglas).
   - Documentación de API (OpenAPI/Swagger).
   - Plan de seguridad.
   - Plan de continuidad y DRP.

2. **Software**
   - Código fuente en repositorio (con licencia y derechos de uso pactados).
   - Imágenes de despliegue (contenedores).
   - Scripts de instalación e inicialización.
   - Datos maestros pre-cargados (catálogos CIE-10, LOINC, ATC, etc.).

3. **Servicios**
   - Implementación en ambientes.
   - Migración de datos desde sistema(s) legado(s).
   - Pruebas (unitarias, integración, sistema, aceptación, carga, seguridad).
   - Capacitación a usuarios y administradores.
   - Acompañamiento en go-live (hipercuidado).
   - Soporte post-implementación.

### 30.2 Fases del Proyecto Sugeridas

**Fase 0 — Iniciación (1 mes)**
Levantamiento, plan detallado, infraestructura.

**Fase 1 — Núcleo y Multi-Entidad (3-4 meses)**
Multi-país/org/moneda/libro, seguridad, catálogos maestros, MPI, ADT.

**Fase 2 — Asistencial Ambulatorio + Triage (3 meses)**
Agenda, consulta externa, triage Manchester, emergencias, HCE básica.

**Fase 3 — Asistencial Hospitalario y Quirúrgico (4 meses)**
Hospitalización, UCI, quirófanos, sala de partos, neonato.

**Fase 4 — Servicios Diagnósticos y Terapéuticos (3 meses)**
Laboratorio, imágenes, farmacia, eMAR, terapia respiratoria, nutrición.

**Fase 5 — Financiero y Cuentas (3 meses)**
Cuentas hospitalarias, facturación DTE, contabilidad multi-libro, convenios.

**Fase 6 — BI, Reportería y Optimización (2 meses)**
Tableros, reportes regulatorios, indicadores.

**Fase 7 — Estabilización y Cierre (1-2 meses)**
Hipercuidado, ajustes, cierre formal.

**Total estimado: 20-22 meses** (ajustable según alcance real).

### 30.3 Criterios de Aceptación

- **Funcional:** ejecución exitosa del 100% de los casos de prueba críticos y ≥ 95% de los no críticos por hito.
- **No funcional:** cumplimiento verificado de tiempos de respuesta, disponibilidad, seguridad y carga.
- **Documentación:** entregada, revisada y aprobada.
- **Capacitación:** usuarios certificados (≥ 90% del personal objetivo).
- **Operación:** sistema en producción con métricas de operación dentro de umbrales acordados durante mínimo 60 días.

### 30.4 Riesgos Principales

| Riesgo | Mitigación |
|--------|-----------|
| Resistencia al cambio del personal asistencial | Gestión de cambio temprana, super-usuarios por servicio, capacitación práctica |
| Calidad de datos legados | Plan de saneamiento previo, reglas de migración, conciliaciones |
| Cambios regulatorios (ej. nuevas versiones DTE) | Adaptadores fiscales modulares, contrato de mantenimiento normativo |
| Integraciones con sistemas externos heterogéneos | Bus de integración robusto, motor de mensajería, mapeos parametrizables |
| Disponibilidad de infraestructura | Diseño cloud-ready, DRP probado, redundancia |
| Privacidad de datos de salud | Cifrado, RBAC/ABAC, auditoría, formación |

### 30.5 Garantía y Mantenimiento

- **Garantía:** 12 meses post go-live, con corrección sin costo de defectos atribuibles al proveedor.
- **Mantenimiento correctivo, evolutivo y normativo** anual con SLA descrito en 29.9.
- Política de versiones: liberaciones mayores anuales, menores trimestrales, parches según necesidad.

---

## ANEXOS RECOMENDADOS

- **Anexo A:** Matriz de roles y permisos detallada.
- **Anexo B:** Diccionario de datos completo.
- **Anexo C:** Catálogos pre-cargados (extractos CIE-10, LOINC, ATC, plan de cuentas modelo SV).
- **Anexo D:** Flujos BPMN de procesos clave (admisión, triage, hospitalización, cirugía, alta).
- **Anexo E:** Esquemas de mensajería HL7/FHIR.
- **Anexo F:** Lista de chequeo de cumplimiento DTE El Salvador.
- **Anexo G:** Plan de pruebas y casos de prueba por módulo.
- **Anexo H:** Plan de capacitación y matriz de roles capacitables.
- **Anexo I:** Plan de migración desde sistemas legados.

---

**FIN DEL DOCUMENTO**

*Este TDR constituye una guía integral para el diseño, contratación e implementación de un Sistema de Información Hospitalaria de alcance regional, con tropicalización específica para la República de El Salvador. Debe complementarse con los anexos referenciados, las especificaciones técnicas del oferente, y los requerimientos particulares de cada organización contratante.*
