# Automatización de procesos y Business Intelligence

## 1. Automatizar: método

1. **Mapear el proceso como es** (quién, qué, con qué sistema, cuánto tarda, dónde se atora, cuántas veces al mes). Un proceso que nadie puede describir no se automatiza: primero se documenta (SIPOC o flujo simple).
2. **Clasificar la tarea**:
   - Regla fija + datos estructurados → script/integración/flujo.
   - Interfaz sin API (sistema legado, portal de aseguradora) → RPA (último recurso: frágil).
   - Juicio sobre texto, documentos o correos → IA (LLM) con revisión humana donde haya riesgo.
   - Aprobaciones y seguimiento → flujo de trabajo (Power Automate/n8n) con formulario y tablero.
3. **Elegir la herramienta mínima** (§2). Si existe API, nunca RPA. Si existe integración nativa (Odoo↔M365), nunca script.
4. **Diseñar con fallos en mente**: idempotencia (correr dos veces no duplica), reintentos, cola de errores, notificación al dueño, registro de cada ejecución, modo "simulación" antes de "real".
5. **Humano en el bucle** para todo lo irreversible o con dinero/pacientes: aprobar antes de ejecutar.
6. **Medir**: horas ahorradas, errores evitados, tiempo de ciclo; revisar a 30/90 días.
7. **Documentar y versionar**: cada automatización con dueño, propósito, disparador, pasos, dependencias, qué hacer si falla (runbook) y repositorio Git.

## 2. Herramientas por tipo

| Tipo | Herramienta recomendada | Cuándo |
|---|---|---|
| Flujos en el ecosistema Microsoft (correo, Teams, SharePoint, Forms, aprobaciones) | **Power Automate** (nube) | Procesos administrativos, aprobaciones, notificaciones; ya licenciado en M365 |
| Orquestación de integraciones con APIs, webhooks, IA, bases de datos | **n8n** (self-host, abierto) | Cuando toca Odoo, HIS, APIs externas, LLMs; control total; bajo costo |
| Pipelines de datos programados (ETL/ELT) | **Apache Airflow** / **Dagster** / **dbt** | Cargas diarias al DWH, transformaciones versionadas |
| Scripts puntuales | Python / PowerShell programados (cron, Programador de tareas, Azure Automation) | Reportes, limpiezas, sincronizaciones simples |
| RPA (clic y teclado) | Power Automate Desktop / UiPath | Sólo sin API; aislar en VM dedicada; alerta cuando cambia la interfaz |
| Agentes de IA | Copilot Studio (M365), n8n + modelo, SDKs (Anthropic/OpenAI) con **MCP** | Clasificar, extraer, redactar borradores, responder con herramientas; siempre con límites y registro |
| Eventos en tiempo real | Colas (RabbitMQ/Kafka/Service Bus) + consumidores | Integraciones clínicas y financieras críticas (no flujos low-code) |
| Formularios y datos de entrada | Microsoft Forms/Lists, Odoo, app propia | Capturar sin Excel suelto |

**Patrones frecuentes en Avante**
- Odoo → DTE Hacienda → acuse → correo al cliente → asiento: integración nativa/módulo, no RPA.
- Resultado de laboratorio listo → notificación al médico y al paciente (portal/WhatsApp Business API) → HL7 ORU como disparador vía motor de integración → n8n.
- Solicitud de acceso de proveedor → Forms → aprobación (sponsor, TI) → script Graph crea invitado con fecha fin → registro en bitácora `accesos.md` → recordatorio 15 días antes de vencer.
- Tickets de TI (Odoo Helpdesk / correo) → clasificación por LLM → asignación → métricas.
- Censo diario, ocupación y altas → extracción del HIS → DWH → tablero 7:00 a.m. a gerencias.
- Conciliación de pagos (bancos, aseguradoras) → archivos SFTP/Excel → Python → excepciones a Finanzas.

## 3. BI: construir (modelo de datos)

**Arquitectura de referencia**
```
Fuentes (HIS, LIS, Odoo, M365, Excel controlados, APIs)
  → Ingesta (CDC/Bulk FHIR/consultas incrementales; Airflow/ADF/Fabric Pipelines)
  → Zona cruda (lake: Parquet / tablas staging)
  → Transformación (dbt / SQL) con pruebas de calidad
  → Almacén dimensional (PostgreSQL / SQL Server / Fabric Lakehouse / Synapse)
  → Semántica (modelo Power BI compartido, medidas DAX, RLS)
  → Consumo (Power BI, Excel, API, alertas, IA en lenguaje natural sobre agregados)
```
Nunca Power BI directo sobre la base de producción del HIS: réplica de lectura o DWH.

**Modelo dimensional (Kimball)**
- Hechos (grano claro, uno por evento): `fact_encuentro` (ingreso/alta, por paciente-visita), `fact_cargo` (línea de cargo), `fact_resultado_lab`, `fact_cita`, `fact_cirugia`, `fact_dispensacion`, `fact_pago`, `fact_ticket_ti`.
- Dimensiones conformadas: `dim_fecha`, `dim_paciente` (seudonimizada en BI: sin nombre/DUI; edad en rango cuando sea agregado), `dim_medico`, `dim_servicio`, `dim_sede`, `dim_cama`, `dim_diagnostico` (CIE-10), `dim_procedimiento`, `dim_producto` (GS1), `dim_aseguradora`, `dim_pais`, `dim_moneda`.
- SCD tipo 2 en médico, servicio y producto (cambian con el tiempo); claves sustitutas; tabla de fecha completa (festivos de cada país).
- Catálogos maestros (MDM/GS1) como fuente de las dimensiones: un código, un nombre, un dueño.
- Calidad de datos (DAMA): reglas por columna (completitud, unicidad, rango, referencial, puntualidad), puntaje por fuente, tablero de calidad, dueño de dato por gerencia.

**Power BI — prácticas**
- Modelo estrella, relaciones 1:*, sin ambigüedad; columnas calculadas al mínimo; medidas en DAX con `CALCULATE`, `DIVIDE`, variables; tablas de medidas; formato y descripciones.
- Modelo semántico compartido (un modelo, muchos informes); modo Import con actualización programada; DirectQuery/Direct Lake sólo si el volumen lo exige.
- **RLS** por sede/servicio/gerencia desde Entra (grupos); roles probados.
- Rendimiento: Performance Analyzer, DAX Studio, agregaciones, particiones.
- Gobierno: áreas de trabajo por gerencia, endosos (certificado), linaje, etiquetas de sensibilidad, licencias Pro/PPU/Fabric según uso.

## 4. BI: analizar (de dato a decisión)

**Fichas de indicador** (una por KPI, guardar en bitácora/anexo): nombre, definición, fórmula exacta, fuente y tabla, grano, filtros, frecuencia, meta, umbrales (verde/amarillo/rojo), dueño, caveats.

**Catálogo base (hospital)**
| Área | Indicadores |
|---|---|
| Hospitalización | Ocupación %, estancia media, giro cama, altas, reingresos ≤30 días, mortalidad bruta/ajustada, intervalo de sustitución |
| Emergencia | Tiempo puerta-médico, por nivel de triage, tiempo total, abandono, ingreso desde emergencia %, retornos 72 h |
| Quirófano | Utilización, inicio puntual, cancelaciones, tiempo de rotación, cirugías/sala/día, complicaciones |
| Consulta externa | Citas, no-show, tiempo de espera, productividad por médico, nuevos vs. subsecuentes |
| Laboratorio/Imagen | TAT por prueba, repeticiones, pruebas por paciente, pendientes >24 h |
| Farmacia | Rotación, quiebres, vencidos, consumo por servicio, adherencia al cuadro básico |
| Finanzas | Ingreso por servicio/médico/aseguradora, margen, cuentas por cobrar y días, glosas, costo por egreso, punto de equilibrio por sede |
| Comercial/Mercadeo | Pacientes nuevos, origen (canal), conversión, NPS, retención, ingreso por médico referente |
| TI | Disponibilidad por sistema, incidentes por severidad, MTTR, tickets abiertos/cerrados, cumplimiento de parches, respaldos exitosos, uso de licencias |

**Método de análisis**: pregunta de negocio → hipótesis → datos (calidad verificada) → descriptivo (qué pasó) → diagnóstico (por qué: segmentar por sede/servicio/médico/tiempo) → predictivo cuando hay datos suficientes (series temporales para demanda; clasificación para no-show/reingreso) → recomendación con impacto estimado → seguimiento. Mostrar siempre tendencia, no solo la foto; comparar contra meta y contra periodo anterior; señalar la variabilidad y el tamaño de muestra.

## 5. Entregables de este dominio

- **Diseño de automatización**: proceso actual vs. propuesto (flujo), disparadores, herramienta, pasos, excepciones, controles, costo/ahorro, runbook de fallo.
- **Flujo implementado**: exportación n8n (JSON) / Power Automate (solución), script Python/PowerShell con README, programación.
- **Diseño de BI**: arquitectura, modelo dimensional (diagrama y diccionario), mapeos fuente→destino, reglas de calidad, plan de cargas.
- **Fichas de indicador** y **especificación de tablero** (páginas, visuales, filtros, RLS, audiencia).
- **Análisis**: hallazgos (3–5), evidencia (tablas/gráficos), causas, recomendaciones con impacto y siguiente paso.
- **Tablero** (Power BI .pbix, o artefacto/HTML interactivo cuando se pide prototipo rápido).
