# Dashboards de gestión médica y análisis de datos

## Contenido

1. Jerarquía de tableros
2. Diseño de un dashboard: de la pregunta al visual
3. Selección de visuales
4. Umbrales, semáforos y alertas
5. Cadencia y rituales de revisión
6. Modelo de datos mínimo
7. Gobernanza y calidad del dato
8. Método de análisis profundo
9. Errores frecuentes

---

## 1. Jerarquía de tableros

Un hospital necesita tres niveles, cada uno con su audiencia, su pregunta y su frecuencia. No los mezcles en una sola pantalla.

| Nivel | Audiencia | Pregunta que responde | Frecuencia | Nº indicadores | Horizonte |
|---|---|---|---|---|---|
| **Estratégico** (cuadro de mando integral) | Junta directiva, dirección general | ¿Vamos hacia donde dijimos? ¿Es sostenible? | Mensual / trimestral | 8–12 en 4 perspectivas | 12–36 meses |
| **Táctico** (gerencia médica, operaciones, finanzas) | Gerentes | ¿Dónde se está rompiendo el proceso y qué decido esta semana? | Semanal | 6–8 por gerencia | Trimestre |
| **Operativo** (servicio, turno) | Jefes de servicio, coordinadores, enfermería | ¿Qué hago hoy / ahora? | Diario / tiempo real | 4–6 | Día / semana |

Perspectivas del cuadro de mando estratégico en salud: **Paciente y calidad** (resultados clínicos, seguridad, experiencia), **Financiera** (margen, flujo, mix), **Procesos internos** (flujo, capacidad, productividad), **Personas y aprendizaje** (retención, competencias, clima). Añade **Cumplimiento** como perspectiva propia cuando la regulación sea un riesgo material.

Regla de drill-down: cada indicador estratégico debe poder descomponerse en los tácticos que lo explican, y cada táctico en los operativos. Si un número de junta no tiene camino hacia un dato de servicio, nadie podrá actuar sobre él.

## 2. Diseño de un dashboard: de la pregunta al visual

Sigue este orden; no empieces por la herramienta ni por los datos disponibles.

1. **Decisión y decisor** — ¿quién mira esto y qué decide con ello? Escribe la decisión en una frase ("el jefe de emergencia reasigna médicos del turno siguiente si el tiempo triage–médico nivel 3 supera 45 min").
2. **Preguntas** — 3 a 6 preguntas que el decisor se hace cada vez que abre el tablero.
3. **Indicadores** — para cada pregunta, el indicador (o par indicador + balance) que la responde, con ficha completa (ver `plantillas.md`).
4. **Dimensiones de corte** — por qué se va a desagregar: servicio, médico, turno, día de semana, aseguradora, diagnóstico/GRD, sede. Elige las que cambian la acción, no todas las posibles.
5. **Comparadores** — meta, periodo anterior, mismo periodo año anterior, benchmark externo, mediana de pares. Un número sin comparador no informa.
6. **Visual** — según la naturaleza del dato (sección 3).
7. **Layout** — lo más importante arriba a la izquierda; una fila de "signos vitales" (5–6 cifras grandes con semáforo y tendencia), debajo los detalles. Una pantalla; si necesita scroll, es un informe.
8. **Acción** — para cada indicador fuera de rango, qué se espera que haga el decisor y a quién escala. Escríbelo en el tablero o en su documento de uso.

## 3. Selección de visuales

| Quieres mostrar | Usa | Evita |
|---|---|---|
| Estado actual vs. meta | Cifra grande + semáforo + flecha de tendencia (KPI card) | Velocímetros (ocupan espacio, poca información) |
| Evolución en el tiempo | Línea con meta y, si aplica, bandas de control | Barras para series largas; gráficos 3D |
| Variabilidad del proceso | Gráfico de control (SPC: XmR, p-chart) | Promedios mensuales que ocultan la variación |
| Comparación entre categorías | Barras horizontales ordenadas | Pastel con más de 3 categorías |
| Distribución (estancia, tiempos de espera) | Histograma o box plot con mediana y percentiles | Solo el promedio |
| Composición que cambia en el tiempo | Área apilada al 100 % | Pasteles múltiples |
| Relación entre dos variables | Dispersión con tamaño por volumen | Dos ejes Y superpuestos |
| Flujo de pacientes | Diagrama Sankey o embudo | Tablas de transiciones |
| Dónde está el problema | Pareto (barras + acumulado) | Lista plana de causas |
| Capacidad y ocupación en tiempo real | Mapa de camas / heatmap por hora y día | Tabla de censo |
| Muchos indicadores de muchos servicios | Tabla con semáforos y sparklines (scorecard) | Decenas de gráficos pequeños |

Principios: etiqueta directamente, elimina adornos, usa color solo para significado (rojo/ámbar/verde + neutro), mantén la misma escala al comparar, muestra siempre el n y la fecha de corte, y deja claro cuando un dato es parcial o preliminar.

## 4. Umbrales, semáforos y alertas

- Define tres zonas por indicador: **verde** (en rango/en meta), **ámbar** (requiere atención, tendencia preocupante), **rojo** (acción inmediata). Escribe los límites numéricos, no "alto/bajo".
- Deriva los umbrales de: meta estratégica, estándar externo (JCI, OPS, norma nacional), o histórico propio (percentil 25/75, o límites de control estadístico). Documenta de dónde salió cada umbral.
- Usa **control estadístico de procesos** para decidir cuándo reaccionar: una regla simple es reaccionar cuando hay un punto fuera de límites de control, 8 puntos consecutivos del mismo lado de la media, o 6 puntos en tendencia. Reaccionar a cada variación mensual genera ruido y desgasta al equipo.
- Las alertas en tiempo real (ocupación >92 %, boarding >4 h, stock cero de crítico, tiempo nivel 2 >15 min) van al operativo con destinatario y canal definido (sistema, Teams, mensaje), no al tablero mensual.
- Cada semáforo rojo tiene una **acción esperada** y un **escalamiento**: rojo en servicio → jefe de servicio actúa en 24 h; rojo dos semanas seguidas → gerencia; rojo en estratégico → comité de dirección.

## 5. Cadencia y rituales de revisión

Un tablero sin reunión que lo use se muere en tres meses. Diseña el ritual junto con el tablero:

| Ritual | Quién | Cuándo | Duración | Insumo | Salida |
|---|---|---|---|---|---|
| Huddle de flujo (safety huddle) | Jefes de turno, admisión, emergencia, quirófano, enfermería | Diario 8:00 | 15 min de pie | Operativo: censo, altas previstas, boarding, cirugías del día, incidentes de 24 h | Acciones del día con responsable |
| Revisión de servicio | Jefe de servicio + equipo | Semanal | 30 min | Táctico del servicio | 3 acciones, seguimiento de las anteriores |
| Comité de gestión médica | Gerente médico + jefes | Semanal / quincenal | 60 min | Táctico de gerencia + OKR | Decisiones, escalamientos |
| Comité de calidad y seguridad | Multidisciplinario | Mensual | 90 min | Calidad y seguridad; eventos analizados | Planes de mejora |
| Revisión de desempeño ejecutivo | Dirección, gerentes | Mensual | 2 h | Estratégico + financiero | Decisiones de recursos |
| Revisión de OKR | Dirección | Trimestral | Medio día | OKR cerrados | Nuevos OKR |

Formato de la reunión: 1) qué dice el tablero (5 min, sin discutir), 2) qué está en rojo/ámbar y por qué, 3) qué decidimos, 4) seguimiento de compromisos previos. Prohibido presentar diapositivas que repitan el tablero.

## 6. Modelo de datos mínimo

Para calcular la mayoría de indicadores hospitalarios basta un modelo en estrella con estas tablas; úsalo como lista de verificación de lo que el sistema de información debe exponer:

**Hechos (eventos)**
- `episodio` — admisión/egreso: id paciente, fecha-hora ingreso, egreso, tipo de ingreso (emergencia/electivo), servicio de ingreso y egreso, tipo de egreso (alta/traslado/defunción), diagnóstico principal y secundarios (CIE-10), procedimiento principal, médico tratante, aseguradora/pagador, cama.
- `movimiento_cama` — traslados: episodio, cama origen/destino, servicio, fecha-hora. Alimenta censo y ocupación.
- `atencion_emergencia` — llegada, triage (hora, nivel), primer contacto médico, decisión, salida, destino, LWBS.
- `cirugia` — programación, entrada a sala, inducción, incisión, cierre, salida, quirófano, cirujano, anestesiólogo, tipo (ambulatoria/mayor), suspensión y causa.
- `consulta` — cita programada, llegada, inicio, fin, especialidad, médico, primera/subsecuente, no-show, cancelación.
- `orden_apoyo` — solicitud, toma/realización, resultado/informe, tipo, urgencia.
- `cargo` — episodio, ítem, cantidad, precio, fecha, usuario; `factura` y `pago`, `glosa`.
- `incidente` — tipo, severidad, servicio, fecha, estado.
- `turno_personal` — persona, rol, servicio, inicio, fin, horas.

**Dimensiones**
- `paciente` (seudonimizado para BI), `medico`, `servicio`, `cama` (con atributo censable sí/no y estado), `quirofano`, `pagador`, `diagnostico`, `procedimiento`, `tiempo` (calendario con día de semana, feriado, turno).

Reglas: cada hecho tiene fecha-hora real del evento (no de registro), usuario que registró, y clave al episodio. Los datos de identificación del paciente se separan del dataset analítico (seudonimización) para cumplir protección de datos.

## 7. Gobernanza y calidad del dato

- **Dueño del indicador** (decide definición y responde por el resultado) ≠ **custodio del dato** (TI/BI, garantiza disponibilidad y cálculo) ≠ **capturador** (quien registra en el punto de atención). Nómbralos en la ficha.
- **Diccionario de indicadores** único, versionado, publicado. Un cambio de definición lleva fecha y nota en el tablero.
- **Reglas de calidad** por campo crítico: completitud (p. ej., hora de triage ≥98 %), validez (fecha egreso ≥ ingreso), consistencia (egreso con cama asignada), oportunidad (censo cerrado antes de las 9:00). Mide y publica la calidad del dato como un indicador más.
- **Cierre de periodo**: fecha a partir de la cual el mes no cambia; las correcciones posteriores se registran como ajustes.
- **Un solo origen de verdad**: el indicador se calcula una vez en la capa de BI; las hojas de cálculo paralelas de cada servicio son un hallazgo a eliminar.
- **Acceso**: datos agregados abiertos a toda la jefatura; datos por médico visibles para el médico y su jefe; datos identificables de paciente solo con necesidad clínica o auditoría justificada.

## 8. Método de análisis profundo

Al analizar un conjunto de datos o un indicador fuera de rango, sigue estas capas y documenta cada una:

1. **Describe** — nivel actual, meta, delta vs. periodo anterior y vs. año anterior, tendencia (últimos 6–12 puntos), variabilidad (¿es variación especial o común?). Usa mediana y percentiles cuando la distribución sea asimétrica (estancias, tiempos de espera, costos).
2. **Descompón** — corta por las dimensiones que podrían explicar: servicio, médico, turno, día de semana/hora, pagador, diagnóstico, sede, tipo de ingreso. Busca concentración (Pareto): normalmente el 20 % de las categorías explica el 80 % del problema.
3. **Correlaciona** — cruza con indicadores relacionados y con eventos de contexto (cambios de personal, cierres de camas, brotes, cambios de tarifa, feriados). Correlación no es causa: formula hipótesis.
4. **Hipótesis de causa raíz** — clasifica en clínica (casuística, práctica médica), operativa (flujo, capacidad, proceso), de personas (dotación, competencias, turnos), de sistema/dato (registro, definición, calidad del dato) y financiera/comercial (mix, tarifa, contrato). Verifica primero la causa de dato: muchos "problemas" son errores de registro.
5. **Impacto** — cuantifica en pacientes, días-cama, dinero o riesgo. Esto decide la prioridad.
6. **Acciones** — concretas, con responsable, plazo e indicador de verificación. Máximo 3–5. Diferencia acciones de contención (hoy) y de mejora estructural (trimestre).
7. **Qué no sabemos** — datos faltantes, supuestos, siguiente análisis necesario.

Entrega el resultado con el formato de informe de análisis de `plantillas.md`. Los gráficos acompañan al hallazgo, no al revés.

## 9. Errores frecuentes

- Tablero construido desde "qué datos tenemos" en lugar de "qué decisión hay que tomar".
- Promedios donde corresponde mediana; indicadores sin n; semáforos sin umbral documentado.
- Comparar médicos o servicios sin ajustar por complejidad y exponerlo públicamente: destruye la confianza y el reporte de incidentes.
- Mezclar camas censables y no censables; contar observación de emergencia como hospitalización.
- Publicar un indicador sin dueño ni ritual: se vuelve decoración.
- Confundir KPI (vigilar) con OKR (cambiar) y llenar los OKR de actividades.
- Reaccionar a cada variación mensual sin control estadístico.
- Hojas de Excel paralelas por servicio con definiciones distintas a las de BI.
- Ignorar la calidad del dato como primera hipótesis cuando un indicador se mueve de golpe.
