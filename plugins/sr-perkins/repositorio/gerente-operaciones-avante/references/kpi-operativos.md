# KPI operativos — fichas y tablero

Formato de ficha: **Nombre · Fórmula · Fuente · Frecuencia · Meta de referencia · Dueño · Lectura**. Las metas son referencias de partida; cada sede fija la suya en la bitácora con línea base.

## Cadena de suministro (los define y lidera Operaciones)

| KPI | Fórmula | Fuente | Frec. | Meta ref. | Lectura |
|---|---|---|---|---|---|
| Fill rate | Líneas entregadas completas a tiempo / líneas pedidas | Odoo compras | Semanal | ≥ 95 % (≥ 98 % críticos) | Capacidad del proveedor y del proceso de compra |
| Quiebres de críticos | N.º de ítems K con stock 0 en el periodo (y horas en 0) | HIS/Odoo inventario | Diario | 0 | Riesgo directo al paciente |
| Exactitud de inventario | Ítem-lote con conteo = sistema / ítem-lote contados | Conteo cíclico | Semanal | ≥ 98 % | Base de todo lo demás |
| Rotación | Costo de consumo anual / inventario promedio | Odoo | Mensual | A: 12–24; B: 8–12; C: 4–8 | Capital inmovilizado |
| Días de inventario (DOI) | Inventario / consumo diario | Odoo | Mensual | Por clase (ver cadena) | Cobertura |
| Vencimientos y mermas | Valor vencido + mermas / valor consumido | Odoo bajas | Mensual | ≤ 0,5 % | FEFO y sobrecompra |
| Lead time de proveedor | Promedio días orden→recepción por proveedor | Odoo | Mensual | Según contrato | Para dimensionar SS |
| Cumplimiento de SLA | Entregas dentro de SLA / entregas | Odoo + registro | Mensual | ≥ 95 % | Base del scorecard |
| Costo logístico / ingresos | Costo de compras+almacén+transporte / ingresos | Financiera + Odoo | Mensual | Línea base y tendencia | Eficiencia de la cadena |
| Costo de insumos por egreso | Costo de insumos consumidos / egresos | HIS + Odoo | Mensual | Por sede y GRD cuando exista | Eficiencia clínica-operativa |
| Costo de insumos por procedimiento | Costo de insumos / procedimientos (quirófano, laboratorio) | HIS + Odoo | Mensual | Por procedimiento trazador | Estandarización de kits |

MCI candidatas típicas de la cadena: fill rate de críticos, exactitud de inventario, vencimientos, DOI de clase A.

## Operación diaria y capacidad

| KPI | Fórmula | Meta ref. |
|---|---|---|
| Ocupación | Camas ocupadas / camas disponibles | 80–85 % |
| Estancia media | Días-paciente / egresos | Por servicio |
| Giro cama | Egresos / camas | Por servicio |
| Intervalo de sustitución | (Camas·días − días-paciente) / egresos | < 1 día |
| Tiempo cama libre → asignada | Minutos desde alta registrada hasta nueva asignación | ≤ 60 min |
| Tiempo puerta-médico (emergencia) | Llegada → primer contacto médico, por nivel de triage | I–II: ≤ 10 min; III: ≤ 30 |
| Abandonos sin ser vistos | Pacientes que se van sin atención / llegadas | ≤ 2 % |
| Estancia en emergencia | Llegada → alta/ingreso | ≤ 4 h |
| Inicio puntual de primera cirugía | Inicios ≤ 5 min de la hora / primeras cirugías | ≥ 85 % |
| Utilización de quirófano | Horas de cirugía / horas disponibles | 70–80 % |
| Tiempo de cambio (turnover) | Salida de paciente → entrada del siguiente | ≤ 30 min |
| Cancelación el mismo día | Cirugías canceladas / programadas | ≤ 3 % |
| TAT laboratorio urgencias | Recepción de muestra → resultado validado | ≤ 60 min |
| Cobertura de turno | Turnos cubiertos con dotación mínima / turnos | 100 % |
| Ausentismo | Horas ausentes / horas programadas | ≤ 3 % |

## Calidad y seguridad del paciente (coordinado con Médica)

Eventos adversos por 1 000 días-paciente; caídas; úlceras por presión; infecciones asociadas (ISQ, ITU-CUP, NAV, bacteriemia-CVC); errores de medicación detectados antes de administrar (escaneo); cumplimiento de checklist quirúrgico; quejas por 1 000 atenciones; NPS de paciente y de médico especialista; hallazgos abiertos de auditoría MINSAL/CSSP/SRS.

## Mantenimiento e infraestructura

| KPI | Fórmula | Meta ref. |
|---|---|---|
| Cumplimiento del plan preventivo | OT preventivas cerradas / programadas | ≥ 95 % |
| Disponibilidad de equipo crítico | (Horas totales − paradas) / horas totales | ≥ 98 % |
| MTBF / MTTR | Horas entre fallas; horas para reparar | Por equipo |
| Correctivo vs preventivo | OT correctivas / total | ≤ 30 % |
| OEE adaptado (quirófano, equipo) | Disponibilidad × rendimiento × calidad | ≥ 65 % |

OEE adaptado: disponibilidad = horas usadas / horas programadas; rendimiento = casos reales / casos planificados en ese tiempo; calidad = casos sin reproceso, cancelación ni evento / casos. `scripts/ops_toolkit.py oee`.

## Tablero operativo (estructura)

- **Diario (huddle)**: censo y ocupación por sede, camas libres, espera en triage, quirófanos del día, críticos bajo mínimo, personal faltante, incidentes 24 h, P1 abiertos.
- **Semanal (gerencia)**: tendencia de los KPI de operación y cadena, scorecard de proveedores en alerta, MCI y lead por equipo, riesgos operativos activos.
- **Mensual (comité de gerencias / dirección)**: una página por sede y consolidado: semáforo, variación vs mes anterior y vs meta, costo operativo por servicio, tres decisiones que se piden.

Semáforo: verde ≥ meta; ámbar entre meta y meta−10 %; rojo bajo eso o cualquier quiebre de crítico, evento centinela o incumplimiento normativo.

## Reglas y alertas operativas para el HIS (especificación)

| Regla | Condición | Umbral | Destinatario | Acción |
|---|---|---|---|---|
| Stock bajo mínimo | stock(ítem, sede) ≤ ROP | ROP por ítem/sede; K al 120 % | Almacén, jefe de sede | Generar solicitud de reposición |
| Quiebre crítico | stock(K) = 0 | — | Operaciones, farmacia, jefe médico de turno | Alerta inmediata, transferencia entre sedes |
| Lote por vencer | vencimiento − hoy ≤ umbral | 30/60/90 días por tipo | Farmacia | Priorizar FEFO, devolución |
| Recall activo | lote marcado recall | — | Todos los GLN con el lote | Bloqueo de dispensación/administración |
| Cama libre sin asignar | alta registrada y cama no asignada | > 60 min | Admisión, jefe de sede | Escalar |
| Espera en triage | llegada sin contacto médico | > meta por nivel | Jefe de emergencia | Reasignar médico |
| Primera cirugía tardía | inicio real − programado | > 5 min | Coordinador de quirófano | Registrar causa |
| Dotación bajo mínimo | personal en turno < mínimo | Por servicio | Supervisor, RRHH | Cubrir |
| Preventivo vencido | OT preventiva sin cerrar | > fecha | Mantenimiento | Reprogramar |
