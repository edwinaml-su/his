# Planificación y control: WBS, cronograma, ruta crítica, EVM

## WBS

- Orientada a entregables, no a actividades: nivel 1 = fases o productos, nivel 2 = entregables, nivel 3 = paquetes de trabajo (8–80 horas de esfuerzo, un responsable, un criterio de aceptación).
- Regla del 100 %: la suma de los hijos es exactamente el padre; nada fuera de la WBS se ejecuta sin solicitud de cambio.
- Incluir siempre el paquete "Gestión del proyecto" (status, gates, riesgos) y "Transición" (capacitación, hypercare, cierre).

Formato de entrega:
| Código | Entregable / paquete | Responsable | Criterio de aceptación | Esfuerzo (h) | Dependencias |

## Cronograma y ruta crítica (CPM)

Entradas mínimas: lista de actividades con duración (días) y predecesoras (FS por defecto; SS/FF/SF con lag si aplica). Pasos: paso adelante (ES, EF), paso atrás (LS, LF), holgura total = LS − ES; ruta crítica = holgura 0. `scripts/pm_toolkit.py cpm --csv actividades.csv` calcula todo y emite Gantt Mermaid y, con `--xlsx`, un Excel con la tabla y el diagrama de barras.

CSV de entrada:
```csv
id,actividad,duracion,predecesoras,responsable
A,Levantamiento de requisitos,10,,PM
B,Diseño de integración,8,A,Jefe de TI
C,Cableado y red sede,15,A,Proveedor red
D,Instalación HIS,12,"B,C",Proveedor HIS
E,Pruebas de aceptación,6,D,Jefes de servicio
```

Lectura para el usuario: duración del proyecto, actividades críticas (cualquier día perdido ahí es un día en la fecha final), actividades con holgura (dónde se puede mover gente), y las **dos o tres actividades críticas con mayor incertidumbre** (donde conviene reserva o paralelizar).

Técnicas de compresión, en este orden de preferencia:
1. **Fast-tracking** — solapar actividades críticas que se hacían en serie; costo cero, riesgo de retrabajo.
2. **Crashing** — añadir recursos a la crítica con menor costo por día ganado; calcular costo/día antes de proponer.
3. **Recorte de alcance** — solo vía solicitud de cambio.
Nunca: acortar duraciones "porque sí" en la hoja.

PERT cuando hay incertidumbre: duración esperada = (O + 4M + P) / 6; desviación = (P − O) / 6. Con `--montecarlo N` el script simula N corridas con distribución triangular y entrega P50/P80/P90 de la fecha de fin; se recomienda comprometer P80 externamente y gestionar a P50 internamente.

## Presupuesto y EVM

Línea base de costo por paquete y período (curva S). Al corte:
- **PV** valor planificado a la fecha; **EV** valor ganado = % completado físico × presupuesto del paquete (% por hitos 0/50/100 o por entregables aceptados, nunca por horas gastadas); **AC** costo real.
- **CPI** = EV/AC; **SPI** = EV/PV; **CV** = EV − AC; **SV** = EV − PV.
- **EAC** = BAC/CPI (si la desviación es sistémica) o AC + (BAC − EV) (si fue puntual) o AC + (BAC − EV)/(CPI×SPI) (si tiempo y costo se arrastran); **ETC** = EAC − AC; **VAC** = BAC − EAC; **TCPI** = (BAC − EV)/(BAC − AC).
- Earned Schedule (ES) para proyectos largos: SPI(t) = ES/AT, más fiable que SPI al final del proyecto.

`scripts/pm_toolkit.py evm --bac 250000 --pv 120000 --ev 100000 --ac 115000` devuelve indicadores e interpretación. Interpretación estándar en una línea: "Vamos al 83 % del ritmo planificado y cada dólar rinde 0.87; de seguir así, el proyecto cerrará en ~287 k, 37 k sobre presupuesto".

## Métricas ágiles (cuando el enfoque es ágil o híbrido)

- Velocidad (puntos/sprint, media móvil de 3), burn-up contra alcance total (muestra crecimiento de alcance, que el burn-down oculta).
- Kanban: lead time, cycle time, throughput, WIP; Little's Law (lead time ≈ WIP/throughput) para predecir fechas; CFD para ver colas.
- Pronóstico: sprints restantes = puntos restantes / velocidad media; o Monte Carlo de throughput.

## Reservas

- **Contingencia** (riesgos conocidos): suma de EMV o % por fase derivado del registro de riesgos; la administra el PM dentro de tolerancia y se reporta su consumo.
- **Gerencial** (desconocidos): la administra el patrocinador; típicamente 5–10 %.
Ambas visibles en el presupuesto. Un plan sin reservas declaradas es un plan sin margen; decirlo.

## Repositorio de proyecto (SharePoint)

```
Proyectos/<CÓDIGO-NOMBRE>/
  01-Inicio/        charter, caso de negocio, acta de kick-off
  02-Planificacion/ WBS, cronograma, presupuesto, RACI, plan de comunicaciones, registro de riesgos
  03-Ejecucion/     actas, entregables, evidencias de aceptación, correspondencia con proveedor
  04-Control/       status semanales, solicitudes de cambio, EVM, gate reviews
  05-Cierre/        acta de cierre, lecciones aprendidas, transferencia a operación
```
Código de proyecto: `PRJ-AAAA-NNN` (año y correlativo). Versionado de documentos: `v0.x` borrador, `v1.0` aprobado.
