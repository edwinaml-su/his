# Interoperabilidad en salud — HL7 v2, FHIR, CDA, DICOM, IHE, terminologías, GS1

## 1. Qué estándar para qué

| Necesidad | Estándar | Nota |
|---|---|---|
| Mensajería entre sistemas hospitalarios (HIS ↔ LIS/RIS/farmacia/caja), eventos en tiempo real | **HL7 v2.x** (2.5.1 – 2.9) sobre **MLLP/TCP** | Sigue siendo el estándar de facto en hospitales y equipos de laboratorio |
| APIs modernas, apps, portal de pacientes, intercambio entre instituciones, nube | **HL7 FHIR R4** (R4B/R5 según soporte del par) sobre HTTPS/JSON | Lo que exige cualquier proveedor nuevo; base de SMART on FHIR y Bulk Data |
| Documentos clínicos firmados (resumen de alta, referencia, epicrisis) | **CDA R2 / C-CDA**; FHIR Documents como alternativa | XML estructurado + narrativa legible |
| Imágenes | **DICOM** (almacenamiento, worklist MWL, DICOMweb WADO/QIDO/STOW) | PACS/RIS; integrar con HL7 ORM/ORU para órdenes y resultados |
| Perfiles de integración (cómo combinar estándares) | **IHE** (PIX/PDQ identificación, XDS documentos, PAM admisión, LAB, RAD, ATNA auditoría) | Útil para TDR: "cumplir perfil IHE X" |
| Códigos de diagnóstico | **CIE-10** (MINSAL/ISSS en El Salvador), CIE-11 en transición | Catálogo oficial MINSAL donde aplique |
| Códigos de laboratorio | **LOINC** | Cada prueba de laboratorio con LOINC para comparabilidad |
| Terminología clínica amplia | **SNOMED CT** | Licencia por país (El Salvador no es miembro de SNOMED International: verificar licencia afiliada antes de usar en producción) |
| Medicamentos | **ATC/DDD** (OMS), RxNorm (EE.UU.), catálogo DNM/SRS local | GS1 GTIN para el producto físico |
| Identificación de productos, ubicaciones y envíos | **GS1** (GTIN, GLN, SSCC, GS1-128/DataMatrix) | Base de la ruta MDM de catálogos maestros |
| Facturación electrónica | **DTE** (Ministerio de Hacienda, El Salvador) JSON firmado | Integración caja/Odoo → Hacienda |
| Intercambio de datos de procedimientos | CPT/HCPCS (EE.UU.) o catálogo propio de servicios | Mapear a tarifario |

## 2. HL7 v2 — lo esencial operativo

**Estructura**: mensaje → segmentos (líneas) → campos (`|`) → componentes (`^`) → subcomponentes (`&`), repeticiones (`~`), escape (`\`). Encabezado `MSH`. Codificación por defecto `|^~\&`.

**Tipos de mensaje más usados**
| Mensaje | Evento | Uso |
|---|---|---|
| ADT^A01/A04/A08/A03 | Ingreso / registro ambulatorio / actualización / alta | Censo, identificación del paciente a todos los sistemas |
| ADT^A02/A11/A13 | Traslado / cancelaciones | Camas |
| ADT^A40 | Fusión de pacientes | Resolver duplicados (con cuidado) |
| ORM^O01 / OML^O21 | Orden de laboratorio/imagen/farmacia | HIS → LIS/RIS/farmacia |
| ORU^R01 | Resultado | LIS/RIS → HIS; también de analizadores |
| SIU^S12…S26 | Citas | Agenda ↔ RIS/consulta externa |
| DFT^P03 | Cargos financieros | HIS → facturación/Odoo |
| MDM^T02 | Documento clínico | Notas, informes |
| ACK | Acuse | Siempre; MSA-1 AA/AE/AR |
| MFN^M.. | Maestros (catálogos) | Sincronizar catálogos |

**Segmentos clave**: MSH (encabezado), EVN (evento), PID (paciente: PID-3 identificadores, PID-5 nombre, PID-7 nacimiento, PID-8 sexo), PV1 (visita: PV1-2 clase, PV1-3 ubicación cama, PV1-19 número de visita), ORC/OBR (orden), OBX (observación: OBX-3 código LOINC, OBX-5 valor, OBX-6 unidad, OBX-7 rango, OBX-8 anormal), NTE (notas), AL1 (alergias), DG1 (diagnósticos CIE), IN1 (seguro), FT1 (transacción financiera).

**Ejemplo ORU^R01 mínimo**
```
MSH|^~\&|LIS|LAB-AVANTE|HIS|AVANTE|20261023102500||ORU^R01^ORU_R01|MSG000123|P|2.5.1
PID|1||0101-123456-101-2^^^AVANTE^MR||PEREZ^JUAN^ANTONIO||19800512|M
PV1|1|I|HOSP^301^A||||1234^RAMIREZ^ANA
OBR|1|ORD-9001|LAB-5501|2345-7^Glucosa en suero^LN|||20261023093000
OBX|1|NM|2345-7^Glucosa^LN||182|mg/dL|70-100|H|||F|||20261023101500
```

**Reglas de integración**
- MLLP: `<VT>` (0x0B) mensaje `<FS>` (0x1C) `<CR>` (0x0D). Un socket por interfaz; reconexión automática; ACK obligatorio; reintentos con cola persistente.
- Identificador de paciente maestro (MPI) único por tenant/país (PID-3 con autoridad asignadora); nunca el DUI como único ID (menores, extranjeros, cambios).
- Motor de integración en medio (Mirth/NextGen Connect, Rhapsody, Azure Health Data Services, Iguana, o propio en Node/Java con HAPI). Nunca punto a punto cuando hay más de dos sistemas.
- Transformaciones versionadas; mapeo de catálogos (pruebas, unidades, ubicaciones, médicos) en tablas, no en código.
- Monitoreo: colas, errores AE/AR, latencia por interfaz, alertas; retención de mensajes para auditoría (meses según política).
- Pruebas: mensajes de muestra por evento, entorno de pruebas del par, validación con HL7 Inspector/HAPI TestPanel.

## 3. FHIR — lo esencial operativo

- **Recursos** base: Patient, Practitioner, PractitionerRole, Organization, Location, Encounter, Appointment, Condition, Observation, DiagnosticReport, ServiceRequest, MedicationRequest/Dispense/Administration, AllergyIntolerance, Procedure, DocumentReference, Coverage, Claim/Invoice, Bundle, AuditEvent, Consent.
- **REST**: `GET /Patient/{id}`, búsquedas `GET /Observation?patient=123&code=http://loinc.org|2345-7&_sort=-date`, `POST` para crear, `PUT` actualizar, `Bundle` tipo `transaction` para atómico, `_include`/`_revinclude`, paginación, `_history`, versiones (ETag).
- **Perfiles e IG**: definir perfiles propios (StructureDefinition) para extensiones salvadoreñas (DUI, NIT, ISSS); publicar guía de implementación (IG) con FHIR Shorthand/SUSHI. Verificar IG regional/MINSAL si existe.
- **Seguridad**: **SMART on FHIR** (OAuth2/OIDC, scopes `patient/*.read`, `user/Observation.read`, launch context), TLS 1.3, AuditEvent por acceso, Consent.
- **Bulk Data** (`$export` NDJSON) para BI y migraciones; **Subscriptions** (R4B/R5) para eventos.
- **Servidores**: HAPI FHIR (Java, abierto), Microsoft Azure Health Data Services / FHIR Server OSS, Google Cloud Healthcare API, Firely, Aidbox, Medplum (TypeScript, abierto, buena base para HIS moderno).
- **Mapeo v2 → FHIR**: usar el IG oficial "HL7 v2-to-FHIR"; PID→Patient, PV1→Encounter, OBX→Observation, OBR→DiagnosticReport/ServiceRequest, DG1→Condition, FT1→ChargeItem.

**Ejemplo Observation**
```json
{"resourceType":"Observation","status":"final",
 "code":{"coding":[{"system":"http://loinc.org","code":"2345-7","display":"Glucose [Mass/volume] in Serum or Plasma"}]},
 "subject":{"reference":"Patient/0101-123456-101-2"},
 "effectiveDateTime":"2026-10-23T10:15:00-06:00",
 "valueQuantity":{"value":182,"unit":"mg/dL","system":"http://unitsofmeasure.org","code":"mg/dL"},
 "interpretation":[{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation","code":"H"}]}],
 "referenceRange":[{"low":{"value":70},"high":{"value":100}}]}
```

## 4. Arquitectura de integración recomendada (hospital multi-sede)

```
Equipos de laboratorio ─(ASTM/HL7 v2)─┐
LIS / RIS-PACS / Farmacia ─(HL7 v2 MLLP)┤
Odoo (ERP/caja) ─(REST/JSON-RPC)───────┤──▶ Motor de integración ──▶ HIS (API FHIR + v2 listener)
Hacienda (DTE) ─(REST JSON firmado)────┤        │ colas, mapeo, MPI, auditoría
Aseguradoras / terceros ─(FHIR/SFTP)───┘        ▼
                                          Plataforma de datos (CDC / Bulk FHIR → DWH)
```
- MPI y catálogos maestros (GS1/MDM) como servicios compartidos.
- Un entorno de integración por ambiente (dev/QA/prod), con datos sintéticos en no-prod.
- Contratos de interfaz documentados: especificación por interfaz (eventos, segmentos/recursos, catálogos, errores, SLA).

## 5. Normativa salvadoreña a tener presente

- Código de Salud; Ley de Deberes y Derechos de los Pacientes (expediente, confidencialidad, acceso del paciente).
- Decretos 143 y 144 (protección de datos personales / ciberseguridad): datos de salud como categoría especial, consentimiento, transferencias, incidentes, oficial de protección de datos.
- DTE (Ministerio de Hacienda): facturación electrónica obligatoria; integración firmada.
- Ley de Firma Electrónica: firma de documentos clínicos y consentimientos.
- MINSAL/ISSS: catálogos y reportes obligatorios (vigilancia epidemiológica, notificación); verificar formatos vigentes.
- Para dictámenes legales detallados, derivar a la skill de abogado (sr-perkins) cuando exista.

## 6. Entregables de este dominio

- **Especificación de interfaz** (por integración): propósito, sistemas, transporte, mensajes/recursos, segmentos/campos obligatorios, catálogos y mapeos, manejo de errores y ACK, SLA, pruebas de aceptación, responsables.
- **Mapa de integración** (diagrama de §4 adaptado) con inventario de interfaces: origen, destino, estándar, estado, dueño.
- **Checklist de evaluación de proveedor**: versión HL7/FHIR soportada, perfiles IHE, terminologías, SMART, Bulk, auditoría, ambiente de pruebas, documentación, costos por interfaz.
- **Mensajes/recursos de ejemplo** listos para probar.
- **Plan de pruebas de integración**: casos por evento, datos sintéticos, criterios de aceptación.
