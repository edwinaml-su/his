# Plantillas de entregables (formato exacto)

## Status semanal (una página)

```
# Status · <PRJ-AAAA-NNN Nombre> · Semana <N> · <fecha>
**Estado general: 🟢 / 🟡 / 🔴** — <una frase: por qué>
SPI <x.xx> · CPI <x.xx> · EAC <USD> (BAC <USD>) · Fin previsto <fecha> (línea base <fecha>)

## Hitos
| Hito | Línea base | Previsto | Estado | Comentario |

## Logrado esta semana
- …
## Próxima semana
- …
## Riesgos top 3
| ID | Riesgo | Puntaje | Respuesta | Dueño | Tendencia ↑→↓ |

## Decisiones requeridas
| Decisión | De quién | Para cuándo | Si no se decide… |

## Cambios
SC abiertas: <n> · aprobadas en la semana: <n> · impacto acumulado: <días / USD>
```

Criterio RAG (SKILL.md): verde SPI y CPI ≥ 0.95 y sin riesgo alto abierto; ámbar 0.85–0.95 o riesgo alto con respuesta; rojo < 0.85, hito crítico vencido o riesgo alto sin respuesta. Un proyecto no "mejora" de rojo a verde sin una acción registrada que lo explique.

## Charter (acta de constitución)

```
# Charter · <nombre> · v<0.x>
Patrocinador: · PM: · Fecha:
1. Propósito y caso de negocio (problema, beneficio medible, alternativa de no hacer)
2. Objetivos SMART (≤ 5)
3. Alcance: incluye / no incluye
4. Entregables principales e hitos con fechas objetivo
5. Presupuesto estimado (± rango) y reservas
6. Interesados clave y gerencias afectadas
7. Supuestos · Restricciones · Dependencias
8. Riesgos iniciales (top 5)
9. Enfoque de gestión (del flujograma) y gobernanza (comité, cadencia, tolerancias)
10. Criterios de éxito y de cierre
Firmas: patrocinador · PM
```

## Caso de negocio (una página)

Problema u oportunidad · Opciones (mín. 3, incluida no hacer) · Beneficios cuantificados por opción (ingreso, ahorro, riesgo evitado, cumplimiento, experiencia del paciente) · Costos (inversión + operación 3 años, TCO) · Indicador financiero (VAN/TIR/payback cuando aplique) · Riesgos por opción · Recomendación · Decisión solicitada.

## One-pager de proyecto (para comité o junta)

Media página de contexto y media de números: objetivo en una frase · estado RAG · hitos (3–5) · presupuesto consumido vs. planificado · riesgos top 3 · decisión que se pide hoy. Formato Design o PowerPoint de una lámina cuando se presenta.

## Gate review

```
# Gate <n> · <fase que cierra> → <fase que abre> · <PRJ> · <fecha>
Criterios de salida de la fase
| Criterio | Evidencia | Cumple (Sí/Parcial/No) |
Entregables aceptados (con fecha y quién aceptó)
Estado de línea base: tiempo · costo · alcance (cambios aprobados)
Riesgos abiertos ≥ 15 y su respuesta
Lecciones de la fase
Preparación de la siguiente fase: plan, recursos confirmados, dependencias cerradas
**Recomendación del PM: Aprobar / Aprobar con condiciones (listarlas, con fecha de verificación) / Rechazar / Posponer**
Decisión de la TTD: · Fecha:
```

## Acta de reunión

```
# Acta · <reunión> · <fecha> · <duración>
Asistentes: · Ausentes: · Preside: · Redacta:
Objetivo:
## Temas tratados (breve, por tema: contexto → discusión → conclusión)
## Acuerdos y compromisos
| # | Acuerdo / acción | Responsable | Fecha límite | Estado |
## Decisiones tomadas
## Riesgos o temas escalados
Próxima reunión:
```
Regla: toda acción tiene un nombre y una fecha; "el equipo" no es un responsable.

## Roadmap de portafolio

Tabla trimestral (filas = proyectos, columnas = trimestres) con fase por celda (inicio, planificación, ejecución, cierre, hypercare), marcas de hitos regulatorios o de apertura, y línea de capacidad (horas o personas disponibles vs. demandadas). En Mermaid `gantt` para chat; en Whiteboard o Slides para comité.

## Tablero de seguimiento (sin duplicados)

Columnas: ID · proyecto · acción · origen (acta/status/correo + fecha) · responsable · fecha límite · estado · última actualización. Clave de deduplicación: misma acción + mismo responsable → una fila; se actualiza, no se repite. Vive en Sheets o Excel; el PM lo reconcilia con actas y correos antes de cada status.

## RACI

| Actividad / entregable | Patrocinador | PM | Líder frente | Usuario clave | Proveedor | Legal | Calidad |
Una **A** por fila; al menos una **R**; C e I solo si se van a cumplir de verdad.

## Comunicado de cambio (a personal operativo)

Qué cambia · cuándo (fecha y hora) · a quién afecta · qué debe hacer cada uno antes y después · a quién acudir (nombre, canal, horario) · qué pasa si falla (plan de retorno). Media página, lenguaje llano, revisado con Operaciones y RRHH; lo emite la gerencia dueña del proceso, no TI.
