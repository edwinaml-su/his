# Criterios de evaluación por proceso asistencial

Este archivo contiene, por cada proceso, (a) el flujo esperado, (b) los escenarios de recorrido recomendados y (c) los criterios que el HIS debe cumplir. Úsalo como banco de criterios: selecciona y adapta al hospital concreto, no lo pegues completo sin criterio.

## Índice

1. Admisión e identificación del paciente (transversal)
2. Emergencia y triage
3. Máxima urgencia (código de emergencia vital)
4. Bloque quirúrgico (cirugía mayor electiva)
5. Cirugía ambulatoria (mayor ambulatoria / CMA)
6. Hospitalización (sala)
7. Servicios de apoyo en lo que tocan estos flujos
8. Indicadores mínimos que el HIS debe poder producir

---

## 1. Admisión e identificación del paciente (transversal)

Flujo: identificación → búsqueda/creación de expediente → apertura de episodio (emergencia, ambulatorio, hospitalización) → vínculo con cuenta de paciente.

Criterios clave:

- Expediente único por paciente (índice maestro): búsqueda por DUI, nombre + fecha de nacimiento, número de expediente; detección de duplicados y función de fusión con trazabilidad.
- Registro de paciente no identificado / NN (inconsciente, sin documentos) con reconciliación posterior de identidad sin perder los registros ya creados.
- Pacientes extranjeros o sin DUI (pasaporte, carné de residente, menor sin documento).
- Datos mínimos: nombre según documento, fecha de nacimiento, sexo, domicilio, contacto, responsable/acompañante, aseguradora o convenio si aplica.
- Todo episodio abierto crea (o vincula) automáticamente la cuenta de paciente correspondiente.
- Brazalete/etiquetas con al menos dos identificadores (nombre + número de expediente o fecha de nacimiento).

## 2. Emergencia y triage

Flujo esperado: llegada → registro rápido (puede ser mínimo) → **triage** (clasificación por prioridad, 5 niveles según lineamientos MINSAL de triage en hospitales de la RIISS) → atención según prioridad → decisión (alta, observación, ingreso, traslado, quirófano, fallecimiento) → cierre del episodio.

Escenario de recorrido: adulto con dolor torácico llega caminando a las 2 a.m.; clasificado nivel II; ECG e indicaciones; se decide ingreso a medicina interna.

Criterios clave:

- El triage es un formulario propio con hora de llegada, hora de triage, clasificador (usuario), nivel asignado, signos vitales y motivo de consulta; el sistema calcula el **tiempo puerta–triage** y **puerta–médico**.
- La atención NUNCA se bloquea por falta de datos administrativos o de pago: debe existir registro mínimo que permita atender e identificar después. (Requisito legal, no preferencia.)
- Reclasificación de triage permitida, conservando historial de niveles.
- Tablero de sala de espera por prioridad y tiempos; alertas por paciente nivel I–II sin atender.
- Nota médica de emergencia estructurada (motivo, examen físico, diagnósticos CIE-10, indicaciones, evolución) con hora real de cada registro.
- Órdenes de laboratorio/imagen/medicamentos desde el episodio de emergencia, con retorno de resultados al mismo episodio.
- Observación en emergencia con límite de horas parametrizable y alerta para decidir ingreso o alta (la observación prolongada sin ingreso es un hallazgo típico que distorsiona censo y cuenta).
- Decisión de destino con flujo específico: ingreso (genera solicitud de cama sin redigitar), traslado (hoja de referencia/retorno según formatos RIISS cuando aplique), alta (indicaciones impresas/entregables), fallecimiento (activación de flujo de defunción).
- Contra-referencia y referencia: si el hospital participa de la RIISS o recibe referencias, el HIS debe registrar el establecimiento de origen/destino y generar la hoja correspondiente.
- Cargos: todo insumo, medicamento y procedimiento de emergencia descarga a la cuenta del episodio automáticamente al registrarse clínicamente.

## 3. Máxima urgencia (emergencia vital)

Escenario de recorrido: politraumatizado inconsciente traído por transeúntes, sin documentos; se activa código; pasa a quirófano de emergencia; requiere hemoderivados.

Criterios clave (adicionales a los de emergencia):

- Activación en un paso: registro NN + nivel I + apertura de episodio en segundos; el resto de datos se completa después.
- Órdenes verbales de emergencia: el sistema permite registro retroactivo marcado como tal (hora real del acto vs. hora de registro), sin permitir antedatar de forma oculta.
- Paquetes/sets de máxima urgencia preconfigurados (p. ej., "trauma grave": laboratorios, tipeo y prueba cruzada, imágenes) que se ordenan con un clic.
- Cirugía de emergencia: el HIS permite ocupar quirófano sin la programación electiva completa, con regularización documental posterior obligatoria y alertada (hoja quirúrgica, protocolo operatorio).
- Consentimiento informado en urgencia vital: el sistema documenta la excepción legal de consentimiento (riesgo vital inmediato, paciente incapaz de consentir, sin representante localizable) en vez de bloquear la atención o dejar el vacío documental.
- Banco de sangre: solicitud urgente con trazabilidad de unidad transfundida en el expediente.
- Cadena de custodia médico-legal cuando aplique (lesiones por violencia): el registro debe soportar el aviso a autoridades (obligación del Código de Salud/Código Procesal Penal) y quedar constancia.
- Reconciliación posterior: identidad, cuenta y documentación clínica del episodio NN se completan sin duplicar expediente.

## 4. Bloque quirúrgico (cirugía mayor electiva)

Flujo esperado: indicación quirúrgica → evaluación preanestésica y exámenes preoperatorios → programación (agenda de quirófanos) → confirmación de sala, equipo y materiales → admisión preoperatoria → verificación (lista de cirugía segura) → acto quirúrgico (hoja de anestesia, protocolo operatorio, conteo de material) → recuperación (UCPA) → destino (sala, UCI, alta en CMA) → registro de cargos completos.

Escenario de recorrido: colecistectomía laparoscópica electiva en paciente hipertenso; programada con una semana; requiere insumos especiales; el cirujano modifica la técnica intraoperatoriamente.

Criterios clave:

- **Programación**: agenda por quirófano con duración estimada, tipo de cirugía, cirujano, anestesiólogo, equipo, e insumos/kits solicitados; control de solapamientos; lista de espera quirúrgica con antigüedad; causas de suspensión catalogadas (el índice de suspensión es un indicador obligatorio).
- **Requisitos previos parametrizables**: la programación exige (o alerta según configuración) evaluación preanestésica registrada, exámenes preoperatorios vigentes, consentimiento informado quirúrgico Y anestésico firmados, ayuno. Evalúa si el bloqueo es configurable por tipo de cirugía — un sistema que no distingue urgencia de electiva aquí falla.
- **Consentimientos**: formatos por procedimiento, en español, con riesgos específicos; firmados (manuscrito escaneado o firma electrónica conforme a la Ley de Firma Electrónica); versionados; visibles desde el episodio quirúrgico.
- **Lista de verificación de cirugía segura** (OMS, adoptada por MINSAL): entrada–pausa–salida con responsables y horas; el sistema la exige antes de cerrar el acto quirúrgico.
- **Documentos del acto**: hoja de anestesia (registro de signos, fármacos, eventos, tiempos), protocolo/nota operatoria del cirujano (hallazgos, técnica, diagnóstico pre y postoperatorio CIE-10, procedimiento codificable), conteo de gasas e instrumental, registro de biopsias enviadas a patología (trazabilidad de la muestra hasta el resultado).
- **Tiempos quirúrgicos**: entrada a sala, inicio/fin de anestesia, incisión, cierre, salida — para ocupación real de quirófano.
- **Cambios intraoperatorios**: el procedimiento realizado puede diferir del programado; el sistema registra ambos y la cuenta factura lo realizado.
- **Cargos de quirófano**: derecho de sala por tiempo o tarifa, honorarios (cirujano, ayudante, anestesiólogo) según arancel, insumos consumidos (con devolución de lo no usado del kit), prótesis/implantes con número de serie/lote en expediente Y en cuenta.
- **UCPA/recuperación**: escala de recuperación (Aldrete u otra), criterios de alta de recuperación, hora de salida y destino.

## 5. Cirugía ambulatoria (mayor ambulatoria / CMA)

Escenario de recorrido: hernioplastía ambulatoria; paciente llega 6 a.m., cirugía 8 a.m., alta 4 p.m. el mismo día; llamada de seguimiento a las 24 h.

Criterios clave (adicionales al bloque quirúrgico):

- Episodio de tipo ambulatorio-quirúrgico distinto de hospitalización: sin cama censable, pero con estación/cupo de CMA; si el paciente se complica y se ingresa, el episodio se **convierte** en hospitalización sin perder registros ni cargos (criterio crítico — es donde más HIS fallan).
- Criterios de selección de paciente CMA documentables (ASA, soporte en casa, distancia).
- Alta el mismo día con criterios de egreso (escala tipo PADSS o equivalente), indicaciones postoperatorias impresas, signos de alarma y contacto.
- Seguimiento postoperatorio: tarea/llamada a las 24–48 h registrable en el mismo episodio.
- Indicadores propios: tasa de conversión a ingreso, cancelación el mismo día, reconsulta a emergencia < 72 h post CMA.
- Cuenta de paciente: paquete/tarifa quirúrgica ambulatoria si el hospital trabaja por paquetes, con manejo de excedentes cuando el caso se complica.

## 6. Hospitalización (sala)

Flujo esperado: orden de ingreso → asignación de cama → atención diaria (evolución médica, indicaciones, notas de enfermería, administración de medicamentos, interconsultas) → traslados internos → alta (médica y administrativa) → epicrisis → cierre de cuenta.

Escenario de recorrido: diabético descompensado ingresa desde emergencia a medicina interna; interconsulta a nefrología; traslado a UCI 48 h; regresa a sala; alta al día 7.

Criterios clave:

- **Censo en tiempo real**: mapa de camas por servicio con estados (ocupada, libre, en limpieza, bloqueada); el censo diario (ingresos, egresos, traslados, camas disponibles) sale del sistema sin conteo manual; días-cama y porcentaje de ocupación calculados.
- **Ingreso**: diagnóstico de ingreso CIE-10, médico tratante, servicio; la orden de ingreso desde emergencia o consulta arrastra los datos (sin redigitación).
- **Indicaciones médicas** estructuradas: dieta, medicamentos (fármaco, dosis, vía, frecuencia — que alimentan el kárdex de enfermería y la solicitud a farmacia), soluciones, cuidados, exámenes. Cambios de indicación con vigencia (suspender/modificar) y trazabilidad.
- **Notas**: evolución médica al menos diaria (alerta si falta), notas de enfermería por turno conforme a los lineamientos MINSAL de registros clínicos de enfermería, hoja de signos vitales graficable.
- **Administración de medicamentos**: registro de cada dosis administrada (quién, cuándo), omisiones con causa; ideal verificación paciente-medicamento; alertas de alergia registrada.
- **Interconsultas**: solicitud, asignación, respuesta del interconsultante dentro del expediente, con tiempos medibles.
- **Traslados**: entre camas/servicios actualizan censo y tarifa de cama (sala ≠ UCI) desde la hora efectiva.
- **Alta**: alta médica (epicrisis obligatoria: diagnósticos finales CIE-10, procedimientos, tratamiento, indicaciones, control) separada del egreso administrativo (cierre de cuenta); el sistema mide el tiempo entre ambas (indicador de demora de egreso). Tipos de egreso: alta, alta exigida (contra indicación médica, con constancia firmada), fuga, traslado a otro establecimiento (con hoja de referencia), fallecimiento (constancia de defunción, flujo de morgue).
- **Reingreso** identificable (< 30 días, mismo diagnóstico) para indicadores.

## 7. Servicios de apoyo (en lo que tocan estos flujos)

- **Farmacia**: recetas/indicaciones electrónicas llegan a farmacia sin transcripción; dispensación por dosis unitaria o por stock de sala, con descargo automático a la cuenta; control de estupefacientes y psicotrópicos según Ley de Medicamentos (libros/registros controlados, receta retenida); devoluciones acreditan la cuenta.
- **Laboratorio e imágenes**: orden electrónica con datos clínicos, resultados de vuelta al episodio correcto, valores críticos con alerta y constancia de comunicación.
- **Banco de sangre**: solicitud, compatibilidad, trazabilidad de unidad a paciente.
- **Patología**: toda pieza quirúrgica enviada tiene orden y resultado rastreable (criterio de seguridad clásico).

## 8. Indicadores mínimos que el HIS debe poder producir

Si el HIS no puede producir estos números sin exportar a Excel y armarlos a mano, es un hallazgo (severidad según el caso): porcentaje de ocupación, promedio de días estancia, censo diario, producción por servicio y por médico, tiempos puerta-triage y puerta-médico por nivel, índice de suspensión quirúrgica y sus causas, ocupación real de quirófano por sala, tasa de conversión de CMA, reconsulta a emergencia < 72 h, reingresos < 30 días, mortalidad hospitalaria (< 48 h / > 48 h), y los reportes obligatorios al MINSAL (estadísticas del SIS/SIMMOW o los formularios que el nivel rector pida al tipo de establecimiento — verificar los vigentes).
