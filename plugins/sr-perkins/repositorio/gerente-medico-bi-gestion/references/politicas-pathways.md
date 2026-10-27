# Políticas empresariales, algoritmos y pathways

## Contenido

1. Taxonomía documental
2. Anatomía de una política de salud
3. Estilo de redacción normativa
4. Ciclo de vida y control documental
5. Marco legal mínimo (El Salvador y referencia general)
6. De proceso a algoritmo: método
7. Pathways asistenciales
8. Flujos operativos y administrativos
9. Operativización en el sistema de información
10. Catálogo de políticas típicas de un hospital o empresa de salud

---

## 1. Taxonomía documental

Usa cuatro niveles y no los mezcles; la confusión entre política y procedimiento es la causa más común de documentos inaplicables.

| Nivel | Qué es | Responde a | Aprueba | Ejemplo |
|---|---|---|---|---|
| **Política** | Declaración de intención y reglas de alto nivel de la organización | ¿Qué queremos y qué no toleramos? | Junta / dirección general | Política de seguridad del paciente |
| **Reglamento / norma** | Reglas obligatorias detalladas que desarrollan una política | ¿Qué está permitido y prohibido, y qué pasa si no? | Dirección / gerencia | Reglamento de funcionamiento del bloque quirúrgico |
| **Procedimiento / protocolo** | Secuencia de pasos para ejecutar una actividad | ¿Cómo, quién, cuándo? | Gerencia / jefatura | Procedimiento de alta hospitalaria; protocolo de sepsis |
| **Instructivo / guía rápida** | Instrucción puntual de una tarea | ¿Cómo hago esto ahora? | Jefatura | Instructivo de registro de triage en el sistema |

Los **pathways** y **algoritmos** son procedimientos/protocolos expresados como flujo de decisión; se gobiernan como tales.

## 2. Anatomía de una política de salud

Estructura obligatoria (ver formato exacto en `plantillas.md`):

1. **Encabezado de control**: código, título, versión, fecha de vigencia, próxima revisión, elaboró / revisó / aprobó, documentos relacionados y que sustituye.
2. **Objetivo**: una o dos frases; qué resultado busca proteger o lograr.
3. **Alcance**: a qué sedes, servicios, procesos, roles y terceros aplica; qué queda explícitamente fuera.
4. **Marco normativo**: leyes, reglamentos y estándares externos que la política cumple o desarrolla, con artículo cuando sea posible.
5. **Definiciones**: términos que puedan interpretarse de forma distinta (p. ej., "alta", "evento adverso", "urgencia", "paciente particular").
6. **Principios o lineamientos**: 3–7 declaraciones que orientan toda interpretación.
7. **Reglas**: numeradas, en imperativo, cada una verificable. Agrupa por tema.
8. **Roles y responsabilidades**: por cargo, qué hace cada uno respecto a la política (matriz RACI si hay más de 4 roles).
9. **Excepciones**: cuáles se admiten, quién las autoriza, cómo se documentan.
10. **Indicadores de cumplimiento**: 2–4 métricas con meta, con qué se vigila que la política se aplica.
11. **Incumplimiento**: consecuencias graduadas y remisión al reglamento interno de trabajo o al código de ética; siempre con debido proceso.
12. **Capacitación y comunicación**: cómo y cuándo se difunde; quién debe acreditar conocimiento.
13. **Vigencia, revisión y control de cambios**: periodicidad de revisión (máximo 2 años, 1 año en seguridad del paciente y datos), historial de versiones.
14. **Anexos**: formatos, flujos, listas de verificación.

## 3. Estilo de redacción normativa

- Imperativo y verificable: "El médico tratante registra la orden de alta en el sistema antes de las 10:00" y no "Se recomienda que las altas se registren temprano".
- Un sujeto por regla (un rol), un verbo, una condición si aplica. Si la regla tiene "y/o", probablemente son dos reglas.
- Sin adjetivos no medibles ("oportuno", "adecuado", "razonable") salvo que se definan.
- Rol, no persona: "jefe de servicio", nunca "la Dra. X".
- Lo que no está prohibido está permitido, así que prohíbe explícitamente lo que importa.
- Cada regla que exige algo al personal debe tener los medios para cumplirla (sistema, insumo, tiempo); si no, la política genera incumplimiento sistemático y pierde autoridad.
- Lenguaje claro para el personal operativo; el marco legal va en su sección, no diluido en cada regla.
- Longitud: política 2–5 páginas; reglamento 5–15; procedimiento 2–8 con el flujo como figura.

## 4. Ciclo de vida y control documental

Borrador (responsable del proceso) → revisión técnica (jurídico, calidad, el servicio afectado, TI si impacta sistemas) → aprobación (nivel según taxonomía) → publicación en repositorio único con código y versión → capacitación con registro de asistencia/evaluación → vigencia → auditoría de cumplimiento → revisión programada o por evento (cambio legal, incidente, cambio de sistema) → nueva versión o derogación.

Reglas: una sola versión vigente accesible a todos; las copias impresas son "no controladas"; cada versión guarda qué cambió y por qué.

## 5. Marco legal mínimo (El Salvador y referencia general)

Cita y verifica la versión vigente antes de afirmar cumplimiento; la normativa salvadoreña ha cambiado con frecuencia desde 2023. Puntos de anclaje habituales:

- **Código de Salud** y reglamentos de establecimientos de salud; normativa técnica MINSAL (expediente clínico, funcionamiento de hospitales, vigilancia epidemiológica).
- **Ley de Deberes y Derechos de los Pacientes y Prestadores de Servicios de Salud**: consentimiento informado, información, atención de emergencia sin condicionamiento, confidencialidad, quejas.
- **Ley para la Protección de Datos Personales** (y Agencia de Ciberseguridad del Estado): datos de salud como datos sensibles, bases de tratamiento, derechos ARCO, medidas de seguridad, transferencias.
- **Código de Trabajo**, Ley General de Prevención de Riesgos en los Lugares de Trabajo, reglamento interno de trabajo: para toda política que afecte jornada, turnos, sanciones o salud ocupacional.
- **Normativa fiscal**: documentos tributarios electrónicos (DTE), facturación de servicios de salud, retenciones.
- **Junta de Vigilancia de la Profesión Médica** (CSSP): ejercicio profesional, ética.
- **Estándares voluntarios de referencia**: JCI, ISO 9001, ISO 27001, OMS/OPS (seguridad del paciente, IAAS, listas de verificación).

Para otros países, reemplaza por el equivalente nacional (ley de salud, ley de datos, código laboral, normativa fiscal, colegio profesional) y señala que debe verificarse.

## 6. De proceso a algoritmo: método

Un algoritmo operativo es un proceso con las decisiones explicitadas. Construcción:

1. **Disparador**: qué evento lo inicia (llegada del paciente, orden médica, resultado crítico, solicitud de cita, cuenta cerrada).
2. **Entradas**: datos e insumos necesarios al inicio; qué pasa si faltan.
3. **Pasos**: verbo + rol + tiempo objetivo + registro que deja. Numerados. Máximo 12–15 pasos por algoritmo; si hay más, divide en subprocesos.
4. **Decisiones**: cada rombo tiene una pregunta cerrada y criterios explícitos y verificables ("¿PAS <90 o lactato >2?", "¿la cuenta tiene cargos pendientes de validar?"). "Según criterio médico" solo es admisible si se acompaña de los criterios mínimos que el médico debe considerar y documentar.
5. **Salidas**: estados finales posibles y qué registro los acredita.
6. **Excepciones y escalamiento**: qué hacer cuando no se cumple el tiempo objetivo o no hay recurso; a quién se escala y en cuánto tiempo.
7. **Puntos de control**: 2–4 momentos del flujo donde se mide (tiempo entre pasos, cumplimiento de un paso crítico). Cada punto de control se convierte en un indicador del pathway.
8. **Soporte en tres capas**: cómo se refleja en el sistema (estados, alertas, campos obligatorios), en el servicio (poster, checklist, tarjeta de bolsillo) y en la capacitación.
9. **Automatizable / juicio humano**: marca qué pasos puede ejecutar el sistema solo (alertas, asignación, cálculo de scores) y cuáles exigen decisión profesional.

Representación: tabla de pasos (para el sistema y la auditoría) + diagrama de flujo (para el personal). Si la sesión permite dibujar, genera el diagrama (BPMN simplificado o flujo clásico); si no, entrega el flujo en texto estructurado o Mermaid.

## 7. Pathways asistenciales

Un pathway (vía clínica) organiza la atención de un grupo de pacientes homogéneo (diagnóstico o procedimiento) a lo largo del tiempo, con las intervenciones esperadas por fase y los resultados a vigilar. Se usa para reducir variabilidad injustificada, acortar estancia y asegurar cumplimiento de estándares.

Estructura:

- **Población**: criterios de inclusión y exclusión claros.
- **Fases**: preingreso/urgencia → ingreso/día 0 → días 1…n → alta → seguimiento. Para cirugía: preoperatorio, día quirúrgico, postoperatorio por día, alta, control.
- **Matriz fase × dimensión**: valoración, exámenes, tratamiento, cuidados de enfermería, nutrición, actividad, educación al paciente, criterios para avanzar a la siguiente fase, planificación del alta.
- **Criterios de alta** explícitos y medibles.
- **Variaciones**: cómo se registra cuando el paciente se desvía del pathway (causa: paciente, profesional, institución) — el registro de variaciones es la fuente de mejora.
- **Indicadores**: adherencia al pathway, estancia, complicaciones, reingresos, costo por caso, satisfacción.
- **Gobierno**: el comité médico aprueba; el jefe de servicio responde; revisión anual o ante nueva evidencia.

Base los contenidos clínicos en guías reconocidas (OMS, sociedades científicas, NICE, guías MINSAL) y cita; el pathway es herramienta organizacional, no sustituye el juicio clínico individual.

## 8. Flujos operativos y administrativos

Flujos que todo gerente médico termina operativizando y que se construyen con el método de la sección 6:

- Admisión electiva y de emergencia; asignación de cama; traslado interno.
- Alta hospitalaria (desde ronda de altas hasta salida física y cierre de cuenta).
- Gestión de cama y boarding (escalamiento por ocupación: verde/ámbar/rojo con acciones).
- Programación quirúrgica y lista de verificación; suspensión y reprogramación.
- Interconsulta y respuesta en tiempo objetivo.
- Resultado crítico de laboratorio/imagen: comunicación y cierre.
- Reporte y análisis de incidentes (cultura justa).
- Gestión de quejas y reclamos.
- Autorización de aseguradora, prefacturación y cierre de cuenta; glosas.
- Compra y abastecimiento de insumos críticos; quiebre de stock.
- Contratación, inducción y acreditación de personal médico (privilegios).
- Para el modelo de arrendamiento de consultorios a especialistas: onboarding del especialista, agenda compartida, cobro y liquidación, cumplimiento de reglas de la casa.

## 9. Operativización en el sistema de información

Al entregar un algoritmo o pathway, incluye la **hoja de configuración** para TI/HIS: estados del episodio u orden, transiciones permitidas y rol que las ejecuta, campos obligatorios por paso, validaciones y reglas (bloqueos, advertencias), alertas y destinatarios, plantillas de documentos clínicos asociadas, reportes/indicadores a generar, y datos que el flujo debe dejar en la tabla de hechos (ver modelo en `dashboards-bi.md`). Esto permite que el flujo se configure sin reinterpretación y que el indicador del pathway salga del sistema sin doble digitación.

## 10. Catálogo de políticas típicas de un hospital o empresa de salud

Gobierno y ética: código de ética y conducta; conflicto de intereses; relación con la industria farmacéutica; comunicación institucional y redes sociales.

Paciente: seguridad del paciente; derechos y deberes del paciente; consentimiento informado; identificación del paciente; atención de emergencia sin condicionamiento; expediente clínico (contenido, acceso, custodia, firma); confidencialidad y protección de datos de salud; manejo de quejas; alta voluntaria y alta en contra de indicación; cuidados al final de la vida; restricción física; visitas y acompañantes.

Clínica y calidad: comité médico y acreditación de privilegios; reporte y análisis de incidentes; prevención de IAAS; uso racional de antimicrobianos; medicamentos de alto riesgo; transfusión; manejo de resultados críticos; interconsulta; pathways aprobados.

Operación: gestión de camas y capacidad; programación quirúrgica; horarios y agenda; abastecimiento e inventario; mantenimiento y equipos médicos; gestión de residuos bioinfecciosos; continuidad operativa y contingencia (caída de sistema, desastre).

Personas: reclutamiento y selección; inducción; capacitación obligatoria; evaluación de desempeño; jornada, turnos y descansos; prevención de acoso y violencia laboral; salud ocupacional y bioseguridad; reconocimiento y disciplina.

Finanzas y comercial: tarifas y descuentos; crédito y cobro; convenios con aseguradoras; prefacturación y cierre de cuentas; gestión de glosas; arrendamiento y relación con especialistas (modelo consultorio-cliente); compras y proveedores; anticorrupción.

Tecnología y datos: uso aceptable de sistemas; gestión de accesos y roles; seguridad de la información; gobernanza de datos e indicadores; telemedicina; uso de IA en apoyo clínico y administrativo.
