# 4DX — Las 4 Disciplinas de la Ejecución en Operaciones

Marco de Covey, McChesney y Huling adaptado a un hospital multisede. Premisa: el enemigo de la ejecución es el **torbellino** (la operación diaria, urgente y legítima). 4DX no sustituye al torbellino; protege un espacio pequeño para lo que cambia el resultado.

## Disciplina 1 — Enfocarse en lo crucialmente importante (MCI)

- Una **Meta Crucialmente Importante** por equipo (sede, servicio, cadena de suministro). Nunca más de dos. Si todo es importante, nada lo es.
- Fórmula obligatoria: **"De X a Y para cuándo"**. Ejemplos:
  - Cadena: "Fill rate de insumos críticos de 91 % a 98 % al 31 de marzo."
  - Emergencia: "Tiempo puerta-médico (triage III) de 48 a 25 minutos al 30 de junio."
  - Quirófano: "Inicio puntual de primera cirugía de 55 % a 85 % al cierre del trimestre."
- Las MCI de sede derivan de la MCI de Operaciones, que deriva de la meta de la empresa. Se elige donde el equipo tiene más control y mayor impacto.
- Las MCI candidatas de la cadena las propone Operaciones cada trimestre a partir de los KPI (`kpi-operativos.md`); el gerente elige una.

## Disciplina 2 — Actuar sobre las medidas de predicción

| | Medida de resultado (lag) | Medida de predicción (lead) |
|---|---|---|
| Qué es | El marcador final; se conoce tarde; no se controla directamente | Lo que el equipo hace esta semana; predice el lag; se controla |
| Ejemplo cadena | Fill rate de críticos | % de órdenes emitidas antes de tocar el ROP; conteos cíclicos de K completados / programados |
| Ejemplo emergencia | Tiempo puerta-médico | % de turnos con médico de triage asignado antes de las 7:00; pacientes re-evaluados en sala de espera cada 30 min |
| Ejemplo quirófano | Inicio puntual | % de pacientes en preoperatorio 45 min antes; % de bandejas verificadas la noche anterior |
| Ejemplo inventario | Exactitud ≥ 98 % | Conteos cíclicos ejecutados / programados; discrepancias cerradas en ≤ 48 h |

Dos o tres medidas lead por MCI. Prueba: si el equipo las mueve, ¿se mueve la lag? Si no, cambiar la lead.

## Disciplina 3 — Llevar un tablero de resultados convincente

- Simple: en cinco segundos cualquier persona del equipo sabe si va ganando.
- Muestra la MCI (lag) y las lead, con meta y real, por semana.
- Lo construye y actualiza el equipo, no el gerente; visible en el servicio (pared o pantalla) y en el HIS/Power BI.
- Formato mínimo: título "De X a Y para cuándo"; gráfica de la lag contra la línea objetivo; una barra por lead con meta semanal; nombre del equipo.

## Disciplina 4 — Crear una cadencia de rendición de cuentas

**Reunión MCI**: semanal, mismo día y hora, 20–30 minutos, en pie o breve, sin torbellino.

Agenda fija:
1. **Rendir cuentas**: cada quien informa el compromiso de la semana pasada (hecho / no hecho, en una línea).
2. **Revisar el tablero**: ¿se movieron las lead? ¿se mueve la lag? Qué aprendimos.
3. **Comprometer**: cada quien declara 1–2 acciones de alto impacto para la próxima semana que muevan una lead. Específicas, propias, para esta semana.

Registro de compromisos: fecha, persona, compromiso, lead que mueve, estado. `scripts/ops_toolkit.py 4dx --csv compromisos.csv` imprime el tablero y el cumplimiento.

## Instalación en un equipo (6 semanas)

| Semana | Paso |
|---|---|
| 1 | Taller de 2 h: elegir MCI con el equipo (lluvia de candidatas → impacto × control → una) |
| 2 | Definir 2–3 lead; diseñar el tablero en papel |
| 3 | Tablero publicado; primera reunión MCI |
| 4–6 | Cadencia; ajustar lead si no predicen; celebrar avances |
| Trimestral | Revisar MCI: cerrar, renovar o sustituir |

## Errores que el gerente evita

- Convertir el tablero en un reporte de 40 indicadores (eso es el tablero operativo, no el de MCI).
- Usar solo lag ("vamos a mejorar el fill rate") sin lead que el equipo controle.
- Dejar que el torbellino tome la reunión MCI; las urgencias tienen su propio huddle diario.
- Que el gerente actualice el tablero: la propiedad es del equipo.
- Fijar una MCI que dependa de otra gerencia sin acordarla con ella.

## Huddle diario (el torbellino sí tiene su espacio)

Distinto de la reunión MCI: 10 minutos al inicio del turno, por sede: censo y altas previstas, camas, quirófanos del día, personal faltante, insumos críticos bajo mínimo, incidentes de las últimas 24 h, prioridades P1/P2. Lo dirige el jefe de sede; Operaciones consolida en el tablero operativo diario.
