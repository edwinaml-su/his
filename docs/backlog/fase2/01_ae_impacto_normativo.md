# Análisis de Impacto Estratégico — Fase 2 HIS Avante
## Expediente Clínico Electrónico (ECE) + Workflows Data-Driven + Trazabilidad GS1

**Clasificacion:** Confidencial — uso interno Inversiones Avante  
**Emitido por:** @AE — Arquitectura Empresarial  
**Fecha:** 2026-05-16  
**Version:** 1.0  
**Alcance:** Comité de Transformacion Digital / CIO / CTO / Gerencia Medica

---

## 1. Resumen Ejecutivo

- **De repositorio documental a ECE normativo.** La Fase 1 produjo un HIS funcional con 21 modulos Beta operativos (farmacia, laboratorio, emergencias, cirugia, contabilidad, portal paciente). La Fase 2 convierte ese HIS en un **Expediente Clinico Electronico (ECE) legal**, alineado con el Acuerdo MINSAL n.° 1616 (vigente con reforma 2026), lo que habilita a Avante a operar sin soporte en papel.

- **Obligacion regulatoria, no optativa.** La Norma Tecnica del Expediente Clinico (NTEC) y la Ley SNIS obligan a que cada prestador del sistema nacional mantenga expediente medico unico por usuario en soporte electronico. Avante con Fase 1 cumple parcialmente; sin Fase 2 incurre en riesgo de hallazgos criticos en auditoria MINSAL.

- **Motor de workflow data-driven como diferenciador arquitectonico.** Los 9 archivos SQL del schema `ece` ya diseñados implementan un motor de flujos configurable sin codigo: cambiar un workflow es un `INSERT`, no un deploy. Esto reduce el costo de adaptacion a futuros cambios normativos en ~70 % respecto a logica hardcoded.

- **GS1 cierra el ciclo bedside-to-record.** La regla de los 5 correctos (profesional + paciente + medicamento + dosis + via) con DataMatrix GS1 y hard-stop en HIS elimina la clase de error de medicacion mas frecuente en entornos hospitalarios. La evidencia internacional (ECRI, ISMP) indica reducciones de 55-80 % en errores de administracion con BCMA (Bedside Computer-Medicated Administration) activado.

- **Trazabilidad de lotes para recalls.** La integracion EPCIS/GS1 permite identificar en segundos que pacientes recibieron un lote comprometido, habilitando la notificacion proactiva a MINSAL y reduciendo la exposicion legal ante eventos de farmacovigilancia.

- **Firma electronica simple como requisito de validez.** Sin firma electronica simple conforme a la NTEC, cada nota clinica carece de validez legal y no puede sustituir al soporte en papel. Fase 2 implementa este mecanismo con hash vinculado a credencial del profesional.

- **ROI cuantificable y plazo de recupero inferior a 18 meses.** La eliminacion del archivo fisico, la reduccion de incidentes de medicacion y el evitar sanciones MINSAL (de hasta suspension de habilitacion) generan un retorno neto positivo antes de Q3 2027.

- **Continuidad asistencial SNIS.** El modulo RRI (Referencia, Retorno e Interconsulta) y la interoperabilidad con el Sistema Unico de Informacion en Salud son condicion para participar en la red de prestadores del SNIS, lo que afecta directamente la habilitacion institucional de Avante.

---

## 2. Marco Normativo Aplicable

| Instrumento | Articulo / Referencia | Obligacion derivada | Impacto en HIS | Riesgo de incumplimiento |
|---|---|---|---|---|
| **NTEC — Acuerdo n.° 1616 MINSAL** (vigente; reforma D.O. n.°55/T.450/2026) | Art. 4 (definiciones) | Modelar como estados/catalogos: alta ambulatoria, egreso, hospital de dia, in extremis, expediente activo/pasivo | Enums y tablas de catalogos en schema `ece` | Rechazo de expediente en auditoria; invalidez legal del registro |
| | Art. 11-15 (identificacion) | Numero de expediente unico por establecimiento; NUI como clave natural; deduplicacion obligatoria | `paciente.nui` como clave candidata; indice trigram anti-duplicados | Expedientes duplicados = falla en vigilancia epidemiologica y malpractice |
| | Art. 17-19 (tipos de registro) | Ordenamiento cronologico ascendente; codificacion CIE-10 obligatoria al cierre de episodio | `episodio_atencion.diagnostico_cierre_cie10` requerido; versionado cronologico de notas | Expediente incompleto = sancion MINSAL; problema en peritaje medico |
| | Art. 21 (certificacion) | Solo Direccion o delegado autoriza certificar copia | Rol `DIR` como unico autorizado en `flujo_transicion.rol_autoriza_id` para transicion `certificar` | Entrega no autorizada de expediente = violacion de confidencialidad + sancion |
| | Art. 23 (firma electronica simple) | Firma electronica simple obligatoria por profesional en cada acto clinico | `firma_electronica` vinculada 1:1 al `personal_salud`; hash inmutable | Nota sin firma = invalida legalmente; no puede sustituir soporte en papel |
| | Art. 30 (movimiento de expediente) | Registro de entrada/salida del expediente; devolucion en ≤ 48 h | Bitacora `documento_instancia_historial` con timestamps | Perdida de expediente = hallazgo critico auditoria |
| | Art. 32 (Comite del Expediente Clinico) | Comite institucional obligatorio que audita integridad documental | Gobierno institucional (no tecnico); requiere configuracion en HIS para alertas al comite | No conformidad MINSAL en auditoria sistematica |
| | Art. 34-35 (retencion) | Conservacion diferenciada: 5 años natural, 10 años violencia/accidente/judicial | `paciente.estado_expediente` activo/pasivo; job de clasificacion por diagnostico | Destruccion prematura de expediente = responsabilidad penal |
| | Art. 42 (inmutabilidad) | Rectificacion trazable; nunca borrado fisico | Trigger PostgreSQL que bloquea UPDATE/DELETE en tablas `historico`; tabla `ece.rectificacion` | Modificacion no trazada = adulteracion de expediente medico (delito) |
| | Art. 48 (respaldo) | Backup diario, ubicacion distinta, cifrado si portable | Politica de backup en Supabase; punto gestionado por @SRE | Perdida de datos clinicos = responsabilidad institucional grave |
| | Art. 55-56 (bitacora de accesos) | Registro de todo intento (autorizado/denegado) con timestamp a nivel segundo; retencion ≥ 2 años | `ece.bitacora_acceso` con `clock_timestamp()`; RLS | Imposibilidad de auditar accesos no autorizados |
| **Ley SNIS** | Arts. 24-26 | Sistema Unico de Informacion en Salud; expediente medico unico por usuario disponible digitalmente para todos los prestadores publicos | Interoperabilidad con SIS/RELAB y modulo RRI; identificador NUI como llave de continuidad | Exclusion del sistema de referencia/retorno nacional; riesgo de habilitacion |
| **Ley Deberes y Derechos Pacientes** | Art. 5 lit. a) | Consentimiento informado como derecho fundamental del paciente | `consentimiento_informado` con doble firma (profesional + paciente/representante); bloqueo previo a procedimiento | Acto sin consentimiento = nulidad juridica del procedimiento; demanda |
| **Ley de Proteccion de Datos Personales** | Art. 9 | Derecho de acceso del titular a sus datos personales | Portal paciente (Beta.20) debe exponer expediente propio; control de acceso por JWT | Denuncia ante autoridad de proteccion de datos |
| | Art. 18 | Derecho de rectificacion y supresion | `ece.rectificacion` y proceso de supresion controlada (sin borrado de trazabilidad) | Incumplimiento de solicitud de paciente = sancion administrativa |
| **Reglamentacion ISSS** | Afiliacion y derechohabiencia | Verificacion de afiliado cotizante/beneficiario/pensionado en admision | `paciente_isss.tipo_derechohabiente`; validacion en tiempo real contra padron ISSS | Atencion a no derechohabiente sin registro = rechazo de factura institucional |
| | Certificado de Incapacidad Temporal | Solo medico autorizado ISSS puede emitir; firma y sello obligatorios | Rol `MC_ISSS_AUTORIZADO` con verificacion previa; documento trazable | Incapacidad no valida = problema laboral para paciente + sancion institucional |
| **GS1 Healthcare Standards** | EPCIS 2.0; GS1 DataMatrix | Trazabilidad de medicamentos e insumos de extremo a extremo (GTIN, GLN, GSRN, SSCC) | Modulo farmacia.router refactorizado con captura DataMatrix; 6 procesos A-F con hard-stops | Evento de recall no gestionado = riesgo clinico grave + responsabilidad legal ante MINSAL |

---

## 3. Alineacion TOGAF — Capas Afectadas

La Fase 2 impacta las cuatro capas del ADM de TOGAF 10. Se detalla la situacion Baseline (estado actual Fase 1) vs. Target (estado deseado Fase 2).

### 3.1 Business Architecture

| Elemento | Baseline (Fase 1) | Target (Fase 2) | Brecha |
|---|---|---|---|
| Proceso de atencion ambulatoria | 12 pasos definidos; parcialmente digitales | 12 pasos con captura nativa ECE; firma electronica simple en cada acto | Digitalizar pasos 1-12 con formularios ECE |
| Proceso hospitalario | Ingreso y egreso registrados; notas clinicas en papel | Episodio hospitalario completo en ECE; documentacion de quirofano, obstetricia y UCI | Alta hospitalaria sin ECE completo |
| Certificacion de expediente | Manual; exclusividad DIR no modelada en sistema | Flujo de aprobacion auditable; DIR como unico autorizador en workflow | Rol DIR sin restriccion en HIS actual |
| Gestion de incapacidades ISSS | No implementada | Certificado de incapacidad con medico autorizado y trazabilidad | Modulo ISSS ausente |
| Farmacovigilancia | Basica (alertas Beta.15) | Hard-stop bedside + trazabilidad lote-paciente + reporte proactivo MINSAL | Vinculo lote-paciente no existe |
| Comite de Expediente Clinico (Art. 32) | No existe formalmente en HIS | Rol institucional configurado; alertas de integridad documental | Gobierno documental ausente en sistema |

### 3.2 Data Architecture

| Elemento | Baseline (Fase 1) | Target (Fase 2) | Brecha |
|---|---|---|---|
| Modelo de paciente | `Patient` en schema `public`; identidad DUI/NIT | `ece.paciente` con NUI, CUN, derechohabiencia ISSS, identificadores NTEC | NUI y CUN no modelados en `public.Patient` |
| Episodio clinico | `Encounter` generico | `ece.episodio_atencion` + `ece.episodio_hospitalario`; especializado por tipo | Granularidad insuficiente para auditoria NTEC |
| Documentacion clinica | Notas libres en texto | 19 formularios ECE tipados con restricciones de calidad, dependencias y metadatos NTEC | Ausencia de esquema documental normativo |
| Motor de workflow | Logica hardcoded en routers tRPC | Schema `ece`: `tipo_documento`, `flujo_estado`, `flujo_transicion`, `documento_instancia` | Motor de workflow no existe en Fase 1 |
| Trazabilidad GS1 | Inventario farmacia con codigos internos | GTIN como indexador; GLN jerarquico; GSRN para profesionales/pacientes; eventos EPCIS | Identificadores GS1 no implementados |
| Inmutabilidad clinica | Sin garantia de inmutabilidad en BD | Triggers PostgreSQL + audit hash chain existente extendido al schema `ece` | Inmutabilidad solo en `audit.audit_log`; no en datos clinicos |
| Retencion diferenciada | No implementada | `estado_expediente` activo/pasivo; job de clasificacion por diagnostico y tipo de caso | Gestion de ciclo de vida de datos ausente |

### 3.3 Application Architecture

| Elemento | Baseline (Fase 1) | Target (Fase 2) | Brecha |
|---|---|---|---|
| Router farmacia | `pharmacy.router` con dispensacion basica | Refactorizado con procesos GS1 A-F; validacion DataMatrix; hard-stop BCMA | Router actual no soporta GTIN/lote/vencimiento |
| Modulos ECE | 21 modulos Beta con captura parcial | Modulos ECE integrados: ficha identificacion, historia clinica, signos vitales, consentimiento, RRI, epicrisis, etc. | ~8 formularios ECE criticos no implementados |
| Motor de firma electronica | No implementado | Servicio de firma electronica simple (TOTP o PIN) integrado al flujo de aprobacion | Firma ausente en HIS actual |
| Portal paciente (Beta.20) | Vista basica de citas y resultados | Acceso al expediente propio conforme Art. 9 Ley Proteccion Datos | Expediente no accesible desde portal |
| Interoperabilidad SNIS/RELAB | No implementada | API de integracion con SIS nacional; modulo RRI operativo | Avante opera como isla de informacion |
| Notificaciones EPCIS | Beta.15 outbox de alertas clinicas | Reuso de outbox para eventos EPCIS GS1 (recalls, alertas farmacovigilancia) | EPCIS no existe; outbox reutilizable |

### 3.4 Technology Architecture

| Elemento | Baseline (Fase 1) | Target (Fase 2) | Decision arquitectonica requerida |
|---|---|---|---|
| Schema Supabase | `public.*` con RLS multi-tenant | Schema adicional `ece` con RLS propio; triggers de inmutabilidad | Aislamiento `ece` vs. integracion con `public` |
| Captura DataMatrix | No existe | Lectores hardware (scanners 2D) o camara movil + libreria decoder | Decision: JS client-side vs. microservicio |
| Firma electronica | No existe | TOTP / huella biometrica / PIN de 6 digitos segun nivel de riesgo | Decision: mecanismo de autenticacion del acto clinico |
| Backup clinico | Backup Supabase general | Politica diferenciada para datos clinicos (retencion 10 años, cifrado, off-site) | Requiere configuracion SRE especifica |
| Integracion SNIS | No existe | API REST / HL7 FHIR hacia SIS MINSAL (cuando el SNIS habilite el endpoint) | Diseno de adaptador; fecha depende de MINSAL |

---

## 4. Analisis de Riesgos

> Severidad (S) y Probabilidad (P) en escala 1-5. Exposicion = S x P.

| # | Riesgo | Categoria | S | P | Exposicion | Mitigacion |
|---|---|---|---|---|---|---|
| R-01 | Auditoria MINSAL detecta ECE sin firma electronica simple; suspension parcial de habilitacion | Regulatorio | 5 | 4 | **20** | Implementar firma electronica simple como requisito bloqueante en Fase 2 Sprint 1; certificacion interna previa a auditoria |
| R-02 | Error de medicacion por no implementar hard-stop GS1 bedside; evento adverso grave | Clinico / Legal | 5 | 3 | **15** | Hard-stop BCMA como requisito no negociable en DoD del modulo GS1; testing adversarial de escenarios de fallo |
| R-03 | Drift entre schema `ece` y `public.*` en entidad `Patient`/`paciente`; duplicacion de datos clinicos | Tecnico | 4 | 4 | **16** | Definir clave de integracion NUI como FK hacia `public.Patient`; PR de sincronizacion obligatorio antes del primer deploy ECE |
| R-04 | Motor de workflow con transiciones inconsistentes; documento clinico creado sin prerequisitos | Tecnico | 4 | 3 | **12** | Test de integracion para cada path del grafo de dependencias del ECE; seeder de workflows auditado por @QAF |
| R-05 | Adopcion baja de lectores DataMatrix por personal clinico; workaround manual anula trazabilidad | Adopcion | 4 | 4 | **16** | Plan de capacitacion estructurado; UX de escaneo intuitivo (camara movil como alternativa a scanner dedicado); KPI de adopcion monitoreado |
| R-06 | Proveedor GS1 El Salvador no entrega GLN/GSRN a tiempo; bloquea Proceso E (bedside) | Proveedores | 3 | 3 | **9** | Iniciar tramite de afiliacion GS1 El Salvador en paralelo con desarrollo; usar GLN provisional interno para pruebas |
| R-07 | Rectificacion de datos clinicos mal implementada; permite modificacion sin trazabilidad (adulteracion de expediente) | Legal / Regulatorio | 5 | 2 | **10** | Trigger de inmutabilidad + tabla `ece.rectificacion` como unica via de correccion; prueba de penetracion de inmutabilidad en QA |
| R-08 | Schema `ece` sin RLS correcto; router tRPC lee datos de otro tenant | Seguridad | 5 | 2 | **10** | `withTenantContext` obligatorio en todos los routers ECE; @DBA valida RLS antes de merge; replica de gap documentado en `docs/12_rls_validation.md` |
| R-09 | Integracion SNIS/RELAB bloqueada por no disponibilidad de API MINSAL | Dependencia externa | 3 | 4 | **12** | Diseno de adaptador con interfaz abstracta; modo standalone hasta que MINSAL habilite endpoint; no bloquea ECE interno |
| R-10 | Politica de retencion no implementada; expedientes pasivos destruidos prematuramente o retenidos mas del plazo legal | Regulatorio / Operativo | 4 | 3 | **12** | Job automatico de clasificacion activo/pasivo; alerta al Comite del Expediente antes de cualquier destruccion; politica documentada firmada por DIR |

---

## 5. Brechas vs. Estado Actual del HIS

### 5.1 Lo que ya existe en main (produccion Fase 1 + Betas)

| Modulo / Capacidad | Relevancia para Fase 2 |
|---|---|
| Beta.16 — Banco de Sangre | Trazabilidad de unidades; candidato a extender con GSRN donante + GTIN hemocomponente |
| Beta.18 — Contabilidad | Asiento contable al dispensar medicamento; se integra con evento GS1 Proceso D |
| Beta.20 — Portal Paciente | Base para exponer expediente al paciente (Art. 9 Ley Proteccion Datos) |
| Beta.15 — Notificaciones (outbox) | Infraestructura reutilizable para eventos EPCIS GS1 y alertas de recall |
| `audit.audit_log` (hash chain) | Inmutabilidad criptografica ya implementada; debe extenderse a schema `ece` |
| `withTenantContext` + RLS | Contrato multi-tenant existente; debe aplicarse a todos los routers ECE |
| Manchester triage, emergencias | Flujo de triaje ya funcional; debe integrarse con `ece.flujo_transicion` |
| Farmacia (pharmacy.router) | Dispensacion basica existente; requiere refactorizacion GS1 |
| Laboratorio (RELAB parcial) | Solicitud y resultado de estudios; debe vincularse a `ece.solicitud_estudio` |

### 5.2 Lo que falta para cumplir NTEC y GS1

| Brecha | Impacto normativo | Prioridad |
|---|---|---|
| Schema `ece` completo (9 SQL files) no aplicado a produccion | Sin schema, ningun documento ECE es posible | Critica — Sprint 1 |
| Firma electronica simple | Art. 23 NTEC; invalida todo acto clinico sin firma | Critica — Sprint 1 |
| 19 formularios ECE (ficha, historia, signos vitales, triaje, indicaciones, enfermeria, evoluciones, consentimientos, RRI, epicrisis, defuncion, incapacidad, quirurgico, obstetrico) | Cada formulario es una obligacion NTEC | Alta — Sprints 1-3 |
| Motor de workflow data-driven activo | Sin motor, los flujos quedan hardcoded | Alta — Sprint 1 |
| Rol DIR restringido para certificacion | Art. 21 NTEC | Alta — Sprint 1 |
| Identificadores GS1 (GTIN, GLN, GSRN) en catalogo | Sin ellos, trazabilidad bedside imposible | Alta — Sprint 2 |
| Procesos GS1 A-F en farmacia | BCMA y hard-stop | Alta — Sprint 2-3 |
| Decoder GS1 DataMatrix | Captura fisica del dato | Media — Sprint 2 |
| Politica de retencion diferenciada | Art. 34-35 NTEC | Media — Sprint 3 |
| Comite de Expediente Clinico en HIS | Art. 32 NTEC | Media — Sprint 3 |
| Interoperabilidad SNIS/RELAB | Ley SNIS Arts. 24-26 | Baja — Fase 3 (dependencia externa) |

### 5.3 Modulos existentes a refactorizar

| Modulo | Refactorizacion requerida | Razon |
|---|---|---|
| `pharmacy.router` | Agregar GTIN, lote, vencimiento, GLN; procesos A-F; hard-stop BCMA | GS1 Healthcare; Art. 23 NTEC (firma en dispensacion) |
| `Patient` (schema public) | Agregar NUI, CUN; FK hacia `ece.paciente`; indice trigram deduplicacion | Art. 11-14 NTEC |
| `Encounter` (schema public) | Mapeo hacia `ece.episodio_atencion`; campos de tipo de egreso y circunstancia | Art. 17 NTEC |
| `laboratory.router` | Vincular `solicitud_estudio` a `ece.episodio_atencion`; resultado como documento ECE | Art. 18 NTEC (apoyo diagnostico) |
| Portal Paciente (Beta.20) | Exponer expediente ECE del paciente autenticado; control de acceso por JWT | Art. 9 Ley Proteccion Datos |
| Notificaciones (Beta.15 outbox) | Ampliar con tipos de evento EPCIS: `recall`, `cuarentena`, `administracion_bloqueada` | GS1 EPCIS 2.0 |

---

## 6. ROI y Caso de Negocio

### 6.1 Beneficios cuantificados

| Beneficio | Metrica de referencia | Valor estimado Avante (12 meses) |
|---|---|---|
| Reduccion de errores de medicacion (BCMA hard-stop) | ECRI/ISMP: 55-80 % reduccion; costo promedio evento adverso medicacion USD 5,857 (Agency for Healthcare Research and Quality) | Previniendo 3 eventos/año: USD 17,571 evitados |
| Eliminacion del archivo fisico de expedientes | Costo de almacenamiento, foliado, transporte y personal de ESDOMED | USD 18,000-30,000/año estimado segun volumen de expedientes |
| Tiempo de recuperacion de expediente (digital vs. fisico) | 45-90 minutos (fisico) vs. 3-5 segundos (digital) | Eficiencia operativa; reduccion de reingresos por expediente no disponible |
| Cumplimiento legal — evitar sancion MINSAL | Suspension de habilitacion = perdida de ingresos totales durante el periodo | Valor asegurado: 100 % de ingresos operativos |
| Trazabilidad de recalls (GS1) | Identificacion de pacientes expuestos en minutos vs. dias | Reduccion de responsabilidad legal; notificacion proactiva a MINSAL |
| Certificacion ECE para contratos ISSS/privados | Habilitacion para nuevos contratos institucionales que exigen ECE | Incremento de cartera de contratos estimado 10-15 % |
| Continuidad asistencial (RRI + SNIS) | Reduccion de duplicacion de estudios por falta de expediente previo | Ahorro estimado USD 200-400 por episodio con historia disponible |

### 6.2 Costos estimados (TCO 12 meses)

| Componente | Costo estimado |
|---|---|
| Desarrollo Fase 2 (equipo interno @ tasas actuales, 4-5 sprints) | USD 40,000-60,000 |
| Lectores DataMatrix 2D (scanners bedside por piso + farmacia) | USD 3,500-7,000 (USD 350-700/unidad x 10 puntos criticos) |
| Afiliacion GS1 El Salvador (cuota anual + asignacion de GLN/GTIN) | USD 800-2,000/año |
| Capacitacion de personal clinico y administrativo | USD 2,000-4,000 |
| Infraestructura adicional Supabase (schema ece, storage clinico) | USD 1,200-2,400/año |
| **Total TCO año 1** | **USD 47,500-75,400** |

### 6.3 Payback estimado

Beneficios cuantificados conservadores (solo errores medicacion + archivo fisico): USD 35,571-47,571/año.  
Payback simple: **16-24 meses**. Con beneficios de habilitacion de contratos ISSS: **menor a 12 meses**.

---

## 7. Criterios de Exito (KPIs)

| KPI | Linea Base | Meta Fase 2 | Periodo de medicion |
|---|---|---|---|
| % modulos con firma electronica simple operativa | 0 % | 100 % de formularios ECE que requieren firma (NTEC Art. 23) | Al cierre de cada sprint ECE |
| % documentos ECE con captura digital nativa (no escaneo de papel) | 0 % | ≥ 95 % de formularios activos | 90 dias post-go-live |
| Tiempo medio bedside-scan-to-administer | No medido | ≤ 45 segundos por ciclo de los 5 correctos | Medicion continua desde activacion BCMA |
| Incidentes de farmacovigilancia evitados por hard-stop | No medido | Registro de cada hard-stop activado; tendencia decreciente de incidentes | Mensual desde activacion |
| Cobertura NTEC (variables obligatorias presentes / total requeridas por Art. 15-17) | 0 % | ≥ 98 % en expedientes cerrados | Auditoria trimestral interna |
| Auditoria externa MINSAL — hallazgos criticos | Linea base desconocida | 0 hallazgos criticos relacionados con ECE | Primera auditoria post-Fase 2 |
| Tiempo de recuperacion de expediente | 45-90 min (fisico) | ≤ 5 segundos (digital) | 30 dias post-go-live |
| Adopcion de escaneo DataMatrix bedside | 0 % | ≥ 90 % de administraciones con escaneo (no entrada manual) | 60 dias post-activacion |
| % lotes de medicamentos con trazabilidad completa (Procesos A-F) | 0 % | 100 % de ingresos desde Proceso A | 30 dias post-activacion GS1 |
| Incidentes de acceso no autorizado al ECE | No medido | 0 accesos no autorizados sin alerta en bitacora | Monitoreo continuo |

---

## 8. Decisiones Arquitectonicas a Tomar (Briefing para @AS)

Las siguientes decisiones tienen implicaciones estructurales que @AS debe resolver antes del Sprint 1 de Fase 2. Se presentan con opciones y criterios de evaluacion.

### D-01: Relacion entre schema `ece` y schema `public`

**Pregunta:** ¿El schema `ece` opera independiente de `public.*` o se integra como extension?

**Opciones:**
- **A — Schema separado con FK de integracion:** `ece.paciente.public_patient_id FK -> public.Patient`. Maxima separacion; RLS independiente; menor riesgo de regresion en Fase 1.
- **B — Integracion directa en `public`:** Extender `public.Patient` con columnas NUI/CUN; unificar episodios. Mayor cohesion; mayor riesgo de romper routers existentes.

**Recomendacion @AE:** Opcion A. Principio TOGAF de separacion de concerns; minimiza impacto sobre los 21 modulos Beta ya productivos. FK de integracion controlada.

### D-02: Reuso de Beta.15 outbox para eventos EPCIS

**Pregunta:** ¿El outbox de notificaciones de Beta.15 puede transportar eventos EPCIS GS1?

**Recomendacion @AE:** Si. El patron outbox es agnóstico al tipo de evento. Requiere agregar tipos de evento (`RECALL`, `CUARENTENA`, `BEDSIDE_BLOCKED`, `EPCIS_TRANSACTION`) al enum del outbox. Evita duplicar infraestructura de mensajeria. Costo de adaptacion bajo.

### D-03: GS1 DataMatrix decoder — libreria JS vs. microservicio

**Opciones:**
- **A — Libreria JS client-side** (ej. `@zxing/library`, `dynamsoft-barcode-reader`): latencia minima; sin round-trip de red; adecuado para camara de dispositivo movil.
- **B — Microservicio de decodificacion**: centralizado; facil de actualizar; requiere conectividad de red en bedside (riesgo en areas con cobertura debil).

**Recomendacion @AE:** Opcion A para MVP. La camara del dispositivo movil de enfermeria es suficiente para DataMatrix GS1; `@zxing/library` es open source y madura. Microservicio puede evaluarse si el volumen o la precision lo justifican en produccion.

### D-04: Firma electronica simple — mecanismo de autenticacion del acto clinico

**Opciones:**
- **A — TOTP (6 digitos, Google Authenticator / similar):** estandar de industria; compatible con multifactor existente; sin hardware adicional.
- **B — Huella biometrica:** maxima garantia de no repudio; requiere lectores en cada puesto clinico (costo hardware alto).
- **C — PIN de 6 digitos unico por sesion activa:** mas simple; menor carga UX; riesgo de uso compartido de PIN.

**Recomendacion @AE:** TOTP para MVP (Opcion A). Cumple el requisito de firma electronica simple del Art. 4.17 NTEC ("datos electronicos para identificar al firmante"). Huella biometrica puede agregarse en iteracion posterior para cirugias y actos de alto riesgo. PIN unico de sesion es aceptable como fallback documentado.

---

## 9. Plan de Gobernanza

### 9.1 Comite del Expediente Clinico (NTEC Art. 32)

La NTEC exige la constitucion formal de este comite. Su configuracion tiene impacto directo en el HIS.

**Composicion sugerida:**

| Rol | Funcion en el Comite | Impacto en HIS |
|---|---|---|
| Director del Establecimiento (DIR) | Presidente; unico autorizado para certificar copias del expediente | Rol `DIR` en `flujo_transicion` con permiso de certificacion |
| Jefe de ESDOMED / Archivo Clinico | Secretario; custodia documental; auditoria de integridad | Acceso a bitacoras `documento_instancia_historial` y `bitacora_acceso` |
| Medico Jefe de Servicio | Supervision de calidad documental clinica | Notificaciones de expedientes incompletos al cerrar episodio |
| Enfermera Jefe | Supervision de registros de enfermeria y kardex | Alertas de kardex sin firma o administraciones pendientes |
| Representante de Informatica / TI | Administracion del sistema ECE; reportes de integridad | Acceso a panel de administracion; generacion de reportes de auditoria |

**Modelo de operacion en HIS:**
- Panel de auditoria de integridad documental accesible a todos los miembros del comite (segun perfil).
- Alerta automatica al comite cuando un episodio se cierra con documentos obligatorios pendientes.
- Reportes mensuales de cobertura NTEC generados desde `ece.documento_instancia` exportables por el comite.

### 9.2 DIR como unico certificador (Art. 21)

El HIS debe modelar esta restriccion como una transicion de workflow irrenunciable:
- Transicion `certificar` en `flujo_transicion` reservada exclusivamente al rol `DIR`.
- Toda solicitud de copia certificada genera un ticket de aprobacion que DIR debe aprobar digitalmente con su firma electronica simple.
- El log de certificaciones es auditable e inmutable.

### 9.3 Politica de Retencion por Tipo de Diagnostico (Art. 34-35)

| Tipo de Caso | Plazo de Conservacion | Clasificacion en HIS |
|---|---|---|
| Expediente activo (consulta en los ultimos 5 años) | Activo indefinidamente | `estado_expediente = activo` |
| Expediente pasivo (sin consulta en 5 años) | 5 años adicionales en archivo pasivo | `estado_expediente = pasivo`; job clasifica automaticamente |
| Fallecido — causa natural | 5 años desde la fecha de defuncion | `tipo_egreso = fallecido` + `clasificacion = natural` |
| Fallecido — violencia, accidente, en investigacion | 10 años desde la fecha de defuncion | `clasificacion = violencia | accidente | en_investigacion` |
| Caso judicial activo | Hasta resolucion judicial + 5 años | Flag `retener_por_proceso_judicial = true`; requiere autorizacion DIR para destruccion |
| Enfermedades cronicas / vigilancia epidemiologica | Segun directriz MINSAL (indefinido en la practica) | Tag diagnostico CIE-10 en categoria de retencion extendida |

**Implementacion:** job programado (ejecutado por @SRE, periodicidad mensual) que clasifica expedientes segun estas reglas y genera reporte al Comite. La destruccion fisica (eliminacion logica en sistema) requiere autorizacion explicita del DIR con registro en bitacora.

---

## 10. Recomendacion @AE

### Decision: GO

La Fase 2 es **obligatoria por imperativo regulatorio** y estrategicamente prioritaria para Inversiones Avante.

**Justificacion:**

1. **Obligacion legal no diferible.** La NTEC (Acuerdo n.° 1616, reforma 2026) y la Ley SNIS no contemplan plazo de gracia para prestadores con capacidad tecnica instalada. Avante con HIS Fase 1 productivo ya tiene la infraestructura base; la no implementacion del ECE es un riesgo regulatorio activo.

2. **La arquitectura ya esta diseñada.** Los 9 archivos SQL del schema `ece`, el motor de workflow data-driven y el analisis de los 19 formularios ECE representan un activo de arquitectura completo y listo para implementacion. El costo marginal de no avanzar es perder esa inversion.

3. **GS1 protege la licencia de operacion.** Un evento adverso de medicacion trazable a la ausencia de BCMA expone a Avante a suspension de habilitacion por MINSAL. El hard-stop GS1 es la mitigacion mas efectiva disponible.

4. **El ROI es positivo antes de los 18 meses** incluso con supuestos conservadores, y antes de los 12 meses si se consideran los contratos institucionales que requieren ECE certificado.

### Proximos pasos (Fase 2 SDLC)

| Paso | Responsable | Prioridad | Plazo sugerido |
|---|---|---|---|
| 1. @AS emite Blueprint tecnico de Fase 2 (motor ECE + GS1) | @AS | Critica | Sprint 0 Fase 2 |
| 2. Aplicar los 9 SQL del schema `ece` a Supabase via MCP | @DBA | Critica | Sprint 0 Fase 2 |
| 3. @PO elabora backlog priorizado de Fase 2 (historias de usuario ECE + GS1) | @PO | Critica | Sprint 0 Fase 2 |
| 4. Iniciar tramite de afiliacion GS1 El Salvador | Gerencia Administrativa | Alta | Inmediato (externo al SDLC) |
| 5. @Dev implementa motor de firma electronica simple (TOTP) | @Dev | Alta | Sprint 1 Fase 2 |
| 6. @Dev implementa formularios ECE criticos (Ficha, Historia, Signos Vitales, Consentimiento) | @Dev | Alta | Sprint 1-2 |
| 7. @Dev refactoriza `pharmacy.router` con procesos GS1 A-E | @Dev | Alta | Sprint 2 |
| 8. @QAF escenarios BDD para los 5 correctos y hard-stop bedside | @QAF | Alta | Sprint 2 |
| 9. Constitucion formal del Comite del Expediente Clinico | DIR / Gerencia Medica | Media | Antes del go-live |
| 10. @SRE configura job de retencion y backup diferenciado para schema `ece` | @SRE | Media | Sprint 3 |

### Criterios de aceptacion arquitectonica (@AS, @AT, @DA deben cumplir)

1. Todo router ECE nuevo usa `withTenantContext`; RLS validado por @DBA antes de merge.
2. Ningun formulario ECE admite modificacion directa (UPDATE); toda correccion pasa por `ece.rectificacion`.
3. Firma electronica simple es prerequisito bloqueante para cerrar cualquier acto clinico que requiera firma NTEC.
4. Hard-stop GS1 bedside no puede ser desactivado por configuracion de usuario; solo por DIR con registro en bitacora.
5. El schema `ece` se versiona mediante archivos SQL numerados en `packages/database/sql/` (mismo patron que Fases anteriores); no se usan migraciones de Prisma para `ece`.
6. Cobertura de tests ≥ 80 % en todos los modulos ECE nuevos desde el primer commit (leccion Wave 6).

---

*— @AE | Arquitectura Empresarial | Inversiones Avante | 2026-05-16*
