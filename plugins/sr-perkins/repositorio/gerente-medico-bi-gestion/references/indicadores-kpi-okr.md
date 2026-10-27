# Indicadores hospitalarios, KPI y OKR

Catálogo de trabajo del Gerente Médico. Para cada indicador: fórmula, fuente habitual, rango de referencia orientativo y la trampa de medición más común. Los rangos son orientativos para hospitales generales de Latinoamérica; ajústalos al nivel de complejidad y verifica con fuentes vigentes (OPS/OMS, MINSAL, JCI, IHI) cuando una decisión dependa de la cifra.

## Contenido

1. Reglas de definición
2. Hospitalización
3. Emergencia
4. Bloque quirúrgico
5. Consulta externa y ambulatorio
6. Apoyo diagnóstico y farmacia
7. Calidad y seguridad del paciente
8. Recursos humanos y clima
9. Financieros y comerciales
10. Indicadores de balance (pares obligatorios)
11. Cómo fijar OKR en un servicio clínico

---

## 1. Reglas de definición

Antes de calcular, escribe para cada indicador: numerador, denominador, exclusiones, periodo, unidad de análisis (egreso, paciente, cama-día, cirugía, consulta), fuente de datos (sistema y tabla/reporte) y dueño. Los desacuerdos en comités casi siempre son desacuerdos de definición, no de desempeño. Convenciones por defecto que se deben explicitar y, si se cambian, documentar:

- **Camas censables**: camas instaladas para hospitalización con dotación; excluye observación de emergencia, recuperación, cunas de recién nacido sano, sillones de quimioterapia o diálisis. La ocupación usa camas censables; la "capacidad instalada" puede incluir habilitadas.
- **Egreso**: salida del paciente hospitalizado por alta, traslado externo o defunción. Un traslado interno entre servicios no es egreso del hospital pero sí del servicio.
- **Días de estancia**: fecha de egreso menos fecha de ingreso; estancia mínima 1 (el mismo día cuenta como 1). Definir si se usan días calendario o paciente-día censados.
- **Periodo**: mes calendario cerrado salvo que se indique; los indicadores en curso se marcan como "parciales".

## 2. Hospitalización

| Indicador | Fórmula | Fuente | Referencia | Trampa |
|---|---|---|---|---|
| Porcentaje de ocupación | Paciente-día del periodo / (camas censables × días del periodo) × 100 | Censo diario | 75–85 % óptimo; >90 % sostenido = riesgo de colapso y eventos adversos | Mezclar camas habilitadas con censables; contar observación de emergencia |
| Estancia media (EM) | Total días de estancia de egresos / número de egresos | Egresos | Hospital general 4–6 días; varía mucho por casuística | Promedio arrastrado por outliers; usar también mediana y distribución |
| Giro cama (índice de rotación) | Egresos / camas censables (por periodo) | Egresos, censo | 4–6 egresos/cama/mes en hospital general | Camas cerradas no descontadas |
| Intervalo de sustitución | (Camas × días − paciente-día) / egresos | Censo, egresos | 1–2 días | Negativo o cero implica error de censo |
| Tasa de mortalidad hospitalaria bruta | Defunciones / egresos × 100 | Egresos | 2–4 % hospital general | No ajustada por riesgo; separar <48 h y ≥48 h |
| Mortalidad ≥48 h | Defunciones con estancia ≥48 h / egresos ≥48 h × 100 | Egresos | Comparar contra histórico propio | Es el indicador que refleja la atención hospitalaria, no la condición de llegada |
| Reingresos no planificados a 30 días | Reingresos por causa relacionada ≤30 días / egresos × 100 | Egresos, admisión | <8–10 % | Contar reingresos programados (quimio, cirugía por etapas) |
| Altas antes de las 12:00 | Altas efectivas antes de mediodía / altas × 100 | Censo, ADT | Meta ≥40–50 % | Hora de orden de alta vs. hora de salida física: medir ambas |
| Tiempo orden de alta → salida | Mediana en horas | ADT, cuentas | <3 h | Cuellos en facturación y farmacia, no en lo clínico |
| Estancia prolongada | Egresos con EM > percentil 90 del GRD/servicio / egresos | Egresos | Monitorear casos | Requiere agrupador o al menos estratificar por diagnóstico |
| Pacientes día en espera de cama (boarding) | Pacientes con orden de ingreso sin cama >4 h | Emergencia, ADT | Tendencia a cero | Síntoma de fallo en flujo de altas, no de emergencia |

## 3. Emergencia

| Indicador | Fórmula | Fuente | Referencia | Trampa |
|---|---|---|---|---|
| Tiempo puerta–triage | Mediana minutos desde llegada hasta clasificación | Triage | <10 min | Registrar llegada real, no hora de apertura de ficha |
| Tiempo triage–médico por nivel | Mediana por nivel ESI/Manchester | Triage, HCE | Nivel 1 inmediato, 2 <10–15 min, 3 <30–60 min | Promediar niveles: siempre estratificar |
| Tiempo puerta–decisión (ingreso/alta) | Mediana minutos | HCE, ADT | <4 h (meta de referencia internacional) | Boarding posterior enmascara el flujo |
| Estancia total en emergencia (LOS) | Mediana llegada→salida física | ADT | <4 h altas; <6 h ingresos | Observación prolongada usada como hospitalización encubierta |
| Pacientes que se van sin ser atendidos (LWBS) | Abandonos tras triage / llegadas × 100 | Triage | <2 % | Puede ser señal de saturación o de mal triage |
| Tasa de ingreso desde emergencia | Ingresos / atenciones × 100 | ADT | 10–25 % según perfil | Alto puede indicar uso de emergencia como vía de ingreso electivo |
| Retorno a emergencia ≤72 h | Reconsultas ≤72 h por misma causa / atenciones × 100 | HCE | <3–5 % | Es indicador de calidad del alta de emergencia |
| Puerta–aguja / puerta–balón / puerta–antibiótico | Mediana minutos en ACV, IAM, sepsis | HCE | ACV <60 min, IAM <90 min, sepsis <60 min | Hora de llegada registrada tarde |
| Productividad médico de emergencia | Atenciones / hora-médico | Turnos, HCE | 2–4 pacientes/h según nivel | No comparar turnos sin ajustar por complejidad |

## 4. Bloque quirúrgico

| Indicador | Fórmula | Fuente | Referencia | Trampa |
|---|---|---|---|---|
| Utilización de quirófano | Minutos de uso (incisión–cierre + preparación) / minutos disponibles programados × 100 | Programación quirúrgica, hoja de anestesia | 70–80 % | Incluir tiempos de limpieza en el numerador infla el dato |
| Puntualidad primer caso (FCOTS) | Casos que inician a hora programada ±5 min / primeros casos × 100 | Hoja de anestesia | >80 % | Definir "inicio": entrada a sala, inducción o incisión |
| Tiempo de cambio (turnover) | Mediana minutos salida paciente→entrada siguiente | Hoja de anestesia | <25–30 min | Mezclar cambios entre cirugías de distinta complejidad |
| Tasa de suspensión | Cirugías suspendidas el día programado / programadas × 100 | Programación | <5 % | Registrar causa (paciente, médico, institución, insumo) |
| Cirugía ambulatoria | Procedimientos ambulatorios / procedimientos elegibles × 100 | Programación | Tendencia creciente | Elegibilidad mal definida |
| Ingresos no previstos tras cirugía ambulatoria | Ingresos / cirugías ambulatorias × 100 | ADT | <2 % | |
| Infección de sitio quirúrgico | ISQ / cirugías vigiladas × 100 | Vigilancia epidemiológica | Por tipo de cirugía (limpia <2 %) | Subregistro por falta de seguimiento post-alta |
| Lista de espera quirúrgica | Pacientes y mediana de días en espera | Programación | Tendencia | Pacientes "congelados" sin estado actualizado |
| Rendimiento por cirujano | Casos, minutos, suspensiones, complicaciones | Programación, hoja de anestesia | Comparar con pares del mismo tipo | Usar solo para conversación de desarrollo, nunca para ranking público |

## 5. Consulta externa y ambulatorio

| Indicador | Fórmula | Fuente | Referencia | Trampa |
|---|---|---|---|---|
| Tasa de ausentismo (no-show) | Citas no asistidas / citas programadas × 100 | Agenda | <10–15 % | No descontar cancelaciones oportunas |
| Tiempo a tercera cita disponible | Días hasta la tercera cita libre por especialidad | Agenda | <7–14 días | Medir "primera cita" lo distorsionan cancelaciones |
| Tiempo de espera en sala | Mediana minutos hora cita→atención | Agenda, HCE | <20–30 min | Pacientes que llegan temprano |
| Rendimiento de agenda | Consultas realizadas / cupos ofertados × 100 | Agenda | >85 % | Cupos bloqueados sin motivo |
| Consultas por hora-médico | Consultas / horas de agenda | Agenda | 3–4 según especialidad | |
| Primera vez vs. subsecuente | Proporción | Agenda | Según especialidad | Alta proporción de subsecuentes puede ser dependencia innecesaria |
| Conversión a procedimientos / hospitalización | Pacientes derivados que concretan / derivados × 100 | HCE, programación | Según servicio | Fuga a otros centros |

## 6. Apoyo diagnóstico y farmacia

| Indicador | Fórmula | Fuente | Referencia | Trampa |
|---|---|---|---|---|
| Tiempo de respuesta laboratorio (TAT) | Mediana solicitud→resultado validado, por urgencia | LIS | Urgente <60 min; rutina <4 h | Medir desde recepción de muestra oculta la demora en toma |
| Tiempo de respuesta imágenes | Mediana solicitud→informe | RIS | Urgente <1 h; rutina <24 h | Imagen realizada sin informe |
| Tasa de rechazo de muestras | Rechazadas / recibidas × 100 | LIS | <1–2 % | |
| Repetición de estudios | Estudios repetidos sin justificación / total | LIS/RIS | Tendencia a cero | |
| Errores de medicación reportados | Por 1 000 dosis dispensadas | Farmacia, reporte de incidentes | Más reportes ≠ peor; cultura justa | Subregistro |
| Consumo de antimicrobianos (DDD/100 camas-día) | Dosis diarias definidas / paciente-día × 100 | Farmacia | Programa PROA | |
| Rotación de inventario de farmacia | Costo de consumo / inventario promedio | ERP | 8–12 vueltas/año | Caducados no depurados |
| Quiebre de stock de medicamentos críticos | Días con stock cero en listado crítico | ERP | Cero | |

## 7. Calidad y seguridad del paciente

| Indicador | Fórmula | Fuente | Referencia | Trampa |
|---|---|---|---|---|
| Eventos adversos por 1 000 paciente-día | Eventos / paciente-día × 1 000 | Reporte de incidentes | Tendencia; cultura justa | Castigar el reporte lo elimina |
| Caídas con daño por 1 000 paciente-día | | Reporte de incidentes | <0.5 | |
| Úlceras por presión adquiridas | Casos nuevos / egresos o paciente-día | Enfermería | <2 % | Distinguir presentes al ingreso |
| Infecciones asociadas a la atención (IAAS) | Por 1 000 días-dispositivo (CLABSI, CAUTI, NAV) | Epidemiología | Comparar con NHSN/OPS | Denominador de días-dispositivo mal registrado |
| Cumplimiento de higiene de manos | Oportunidades cumplidas / observadas × 100 | Observación directa | >80 % | Efecto observador |
| Cumplimiento de lista de verificación quirúrgica | Cirugías con checklist completo / cirugías × 100 | Hoja quirúrgica | ~100 % | "Completo" marcado sin ejecutar |
| Identificación correcta del paciente | Auditoría de brazalete | Auditoría | 100 % | |
| Satisfacción / NPS de paciente | Encuesta | Encuestas | NPS >50 | Sesgo de respuesta; tasa de respuesta |
| Quejas y reclamos por 1 000 atenciones | | Atención al usuario | Tendencia | |
| Autopsias / revisión de mortalidad | Casos revisados en comité / defunciones | Comité | 100 % revisión de ≥48 h | |

## 8. Recursos humanos y clima

| Indicador | Fórmula | Fuente | Referencia | Trampa |
|---|---|---|---|---|
| Rotación de personal | Salidas / plantilla promedio × 100 (anualizado) | RRHH | <10–15 % enfermería; médicos según modelo | Separar voluntaria/involuntaria |
| Ausentismo | Horas ausentes / horas contratadas × 100 | RRHH | <4–5 % | Vacaciones no cuentan |
| Horas extra | Horas extra / horas contratadas | Nómina | <5 % | Dependencia estructural de horas extra |
| Ratio enfermera:paciente por servicio | Pacientes / enfermera por turno | Turnos | UCI 1:1–2; sala 1:6–8 | Turnos cubiertos "en papel" |
| Vacantes abiertas >30 días | Conteo | RRHH | Cero en críticos | |
| Cumplimiento de capacitación obligatoria | Personal al día / personal × 100 | RRHH | 100 % en seguridad del paciente y BLS/ACLS | |
| Clima / compromiso (eNPS) | Encuesta | RRHH | eNPS >20 | Anonimato real |
| Tiempo de cobertura de vacante | Mediana días | RRHH | <45 días | |

## 9. Financieros y comerciales

| Indicador | Fórmula | Fuente | Referencia | Trampa |
|---|---|---|---|---|
| Ingreso por egreso / por paciente-día | Ingresos / egresos; ingresos / paciente-día | Facturación, censo | Por línea de servicio | Mezclar aseguradoras y pacientes particulares |
| Costo por egreso / por paciente-día | Costo total asignado / egresos | Contabilidad de costos | Comparar con ingreso correspondiente | Sin costeo por centro de costo no es confiable |
| Margen por línea de servicio | (Ingreso − costo directo) / ingreso × 100 | Costos | Positivo en todas; identificar subsidios cruzados | |
| Días de cuentas por cobrar (DSO) | CxC / ingreso diario promedio | Finanzas | <45–60 días con aseguradoras | Glosas no provisionadas |
| Tasa de glosa / objeción | Monto glosado / facturado × 100 | Facturación | <3–5 % | Medir también tasa de recuperación de glosa |
| Cuentas abiertas sin facturar >48 h post-alta | Conteo y monto | Cuentas de paciente | Cero | Cargos tardíos |
| Fuga de cargos | Cargos esperados − cargos capturados (auditoría de muestra) | Auditoría | <2 % | Requiere auditoría clínica-administrativa |
| Mix de pagadores | % ingreso por aseguradora, particular, convenio | Facturación | Diversificación | Dependencia >40 % de un pagador = riesgo |
| Ocupación de consultorios arrendados / ingreso por m² | Horas usadas / horas disponibles; ingreso / m² | Contratos, agenda | Según modelo de negocio | Modelo de arrendamiento a especialistas: el médico es cliente y proveedor a la vez |
| Punto de equilibrio por servicio | Costos fijos / margen de contribución unitario | Finanzas | Volumen mínimo | |
| EBITDA y margen EBITDA | | Finanzas | Hospitales privados 10–20 % | |
| Valor de vida del especialista (modelo arrendamiento) | Ingreso neto generado por especialista × permanencia esperada | Comercial | | Para decidir inversión comercial en reclutar especialistas |

## 10. Indicadores de balance (pares obligatorios)

Todo KPI con incentivo tiene un comportamiento perverso posible. Publícalo siempre con su par de balance:

| Si mides | Acompáñalo con |
|---|---|
| Estancia media ↓ | Reingresos a 30 días; mortalidad ≥48 h |
| Altas antes de mediodía ↑ | Retorno a emergencia ≤72 h |
| Puerta–decisión ↓ | LWBS; retorno ≤72 h; eventos adversos |
| Utilización de quirófano ↑ | Suspensiones; sobretiempo; ISQ |
| Consultas por hora ↑ | Satisfacción; tiempo de consulta; reconsultas |
| Costo por egreso ↓ | Mortalidad ajustada; IAAS; satisfacción |
| Tasa de ingreso desde emergencia ↓ | Mortalidad en emergencia; retorno ≤72 h |
| Horas extra ↓ | Ratio enfermera:paciente; eventos adversos |
| Fuga de cargos ↓ | Glosas; quejas por cobro |

## 11. Cómo fijar OKR en un servicio clínico

Los OKR sirven para lo que debe **cambiar**; los KPI, para lo que debe **mantenerse**. No conviertas todos los KPI en OKR.

- **Objetivo**: cualitativo, inspirador, de 1 ciclo (trimestre). Máximo 3 por gerencia, 1–2 por servicio. Ejemplo: "Que ningún paciente espere una cama en emergencia".
- **Resultados clave (KR)**: 2–4 por objetivo, medibles, con línea base y meta, siempre de resultado y no de actividad. Ejemplo: "Boarding >4 h de 18 % a <5 %", "Altas antes de 12:00 de 22 % a 45 %", "Tiempo orden de alta→salida de 5.2 h a 2.5 h".
- **Iniciativas**: lo que se hará para mover los KR (ronda de altas a las 8:00, prefacturación la tarde anterior, farmacia de alta anticipada). Se listan aparte y se les da seguimiento, pero no se confunden con los KR.
- **Dueño** por KR, **cadencia** semanal de revisión de 15 minutos, **calificación** al cierre (0.0–1.0; 0.7 es buen resultado para metas ambiciosas).
- **Alineación**: cada OKR de servicio debe poderse trazar a un OKR de gerencia y este a la estrategia; si no se puede, o sobra el OKR o falta estrategia.
- **Regla de seguridad**: ningún KR puede alcanzarse empeorando su indicador de balance; se incluye el balance como KR de "piso" ("manteniendo reingresos <8 %").
