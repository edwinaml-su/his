# Plantillas de entregables

Usa estos formatos tal cual, en el idioma del usuario. Adapta la extensión al tamaño de la organización, no la estructura. Cuando el usuario pida el entregable como archivo, constrúyelo con la herramienta de documento, hoja de cálculo o presentación disponible en la sesión.

## Contenido

1. Escala de prioridad
2. Ficha de indicador
3. Especificación de dashboard
4. Documento de OKR
5. Política / reglamento / procedimiento
6. Algoritmo / pathway / flujo operativo
7. Hoja de configuración para el sistema
8. Informe de análisis de datos
9. Plan de desarrollo individual
10. Guion de conversación difícil
11. Caso de negocio de un servicio de salud

---

## 1. Escala de prioridad

Aplica a hallazgos, acciones y recomendaciones:

| Prioridad | Criterio | Plazo esperado |
|---|---|---|
| **P1 Crítica** | Riesgo actual para la seguridad del paciente, incumplimiento legal o pérdida financiera material en curso | Inmediato (días) |
| **P2 Alta** | Afecta de forma sostenida un indicador clave, la experiencia del paciente o la operación de un servicio | Este mes |
| **P3 Media** | Mejora relevante de eficiencia, calidad o clima sin riesgo inmediato | Este trimestre |
| **P4 Baja / Oportunidad** | Optimización o buena práctica deseable | Backlog |

## 2. Ficha de indicador

```
FICHA DE INDICADOR
Código: [AREA-NN]            Nombre: [nombre corto]
Perspectiva: [Paciente y calidad / Financiera / Procesos / Personas / Cumplimiento]
Nivel de tablero: [Estratégico / Táctico / Operativo]
Pregunta que responde: [una frase]
Definición: [qué mide, en lenguaje claro]
Fórmula: [numerador] / [denominador] × [factor]
Numerador: [definición exacta, inclusiones]
Denominador: [definición exacta]
Exclusiones: [lista]
Unidad de análisis: [egreso / paciente / cama-día / cirugía / consulta / ...]
Unidad de medida: [%, días, minutos, por 1 000 ...]
Periodicidad de cálculo: [diaria / semanal / mensual]   Periodo de reporte: [mes cerrado / rolling 3m / ...]
Fuente de datos: [sistema, tabla o reporte, campos]
Dimensiones de corte: [servicio, médico, turno, pagador, ...]
Dueño del indicador: [rol]   Custodio del dato: [rol]   Capturador: [rol]
Línea base: [valor, periodo]   Meta: [valor, fecha]   Umbrales: verde [..] / ámbar [..] / rojo [..]
Origen del umbral: [estándar externo / histórico / meta estratégica]
Indicador de balance: [código y nombre]
Acción esperada si rojo: [qué hace el dueño y a quién escala]
Reglas de calidad del dato: [completitud, validez, oportunidad]
Limitaciones / trampas: [texto]
Versión: [n]   Vigente desde: [fecha]   Cambios: [resumen]
```

## 3. Especificación de dashboard

```
# [Nombre del tablero] — especificación
## 1. Propósito
Audiencia: [rol(es)]   Nivel: [estratégico/táctico/operativo]   Frecuencia de uso: [..]
Decisiones que habilita: [lista de 2–5 decisiones concretas]
## 2. Preguntas que responde
1. ...
## 3. Indicadores
| # | Indicador (código) | Pregunta | Visual | Comparadores | Dimensiones | Umbrales | Dueño | Acción si rojo |
## 4. Layout
[Descripción por zonas o boceto: fila de signos vitales; bloques; filtros globales]
## 5. Modelo de datos
Tablas/hechos requeridos: [..]   Campos críticos: [..]   Granularidad: [..]   Actualización: [frecuencia, hora de corte]
## 6. Reglas de cálculo y calidad del dato
[Definiciones compartidas, cierres de periodo, validaciones]
## 7. Ritual de revisión
Reunión: [..]   Quién: [..]   Cuándo: [..]   Duración: [..]   Formato: [..]   Salida: [..]
## 8. Seguridad y acceso
[Quién ve qué; seudonimización; datos por médico]
## 9. Plan de implementación
[Fases, responsables, fechas; qué se construye primero]
```

## 4. Documento de OKR

```
# OKR [Gerencia/Servicio] — [Trimestre, año]
Alineado a: [OKR/objetivo estratégico superior]
## Objetivo 1: [enunciado cualitativo e inspirador]
| KR | Métrica (código) | Línea base | Meta | Dueño | Indicador de balance (piso) | Estado |
| 1.1 | ... | ... | ... | ... | ... | ... |
Iniciativas: [lista con responsable y fecha]
Cadencia de revisión: [semanal, 15 min, día/hora]
Calificación al cierre: [0.0–1.0 por KR, comentario]
```

## 5. Política / reglamento / procedimiento

```
[LOGO/ORGANIZACIÓN]
Código: [POL-XX-NNN]   Tipo: [Política/Reglamento/Procedimiento]   Versión: [n]
Vigente desde: [fecha]   Próxima revisión: [fecha]
Elaboró: [rol]   Revisó: [roles]   Aprobó: [órgano]   Sustituye a: [código/versión o "ninguno"]
Documentos relacionados: [códigos]

# [Título]
## 1. Objetivo
## 2. Alcance
## 3. Marco normativo
## 4. Definiciones
## 5. Principios / lineamientos
## 6. Reglas
6.1 [Rol] [verbo en presente] [acción] [condición/tiempo].
6.2 ...
## 7. Roles y responsabilidades
| Rol | Responsabilidad |
## 8. Excepciones
## 9. Indicadores de cumplimiento
| Indicador | Fórmula | Meta | Frecuencia | Responsable |
## 10. Incumplimiento
## 11. Capacitación y comunicación
## 12. Vigencia, revisión y control de cambios
| Versión | Fecha | Cambio | Autor |
## Anexos
```

Para **procedimiento/protocolo**, sustituye la sección 6 por la tabla de pasos del algoritmo (plantilla 6) e incluye el diagrama de flujo como anexo.

## 6. Algoritmo / pathway / flujo operativo

```
# [Nombre del flujo]
Tipo: [algoritmo operativo / pathway asistencial / flujo administrativo]
Población o ámbito: [criterios de inclusión/exclusión o proceso]
Disparador: [evento]   Entradas: [datos/insumos; qué pasa si faltan]
Salidas / estados finales: [lista]
Dueño del flujo: [rol]   Aprobó: [comité]   Versión: [n]   Vigencia: [fecha]

## Tabla de pasos
| # | Paso (verbo + objeto) | Rol | Tiempo objetivo | Decisión / criterio (si aplica) | Registro que deja | Soporte en sistema | Automatizable |
| 1 | ... | ... | ... | ... | ... | ... | Sí/No |

## Decisiones
| Rombo | Pregunta cerrada | Criterios explícitos | Si SÍ → paso | Si NO → paso |

## Excepciones y escalamiento
| Situación | Acción | Escala a | Tiempo |

## Puntos de control e indicadores del flujo
| Punto de control | Qué se mide | Fórmula | Meta | Fuente |

## Diagrama
[Flujo en Mermaid o descripción; para pathways: matriz fase × dimensión]

## Soporte en tres capas
Sistema: [estados, alertas, campos]   Servicio: [poster/checklist/tarjeta]   Capacitación: [qué, a quién, cuándo]

## Fundamento (pathways clínicos)
[Guías y evidencia citadas]
```

Matriz de pathway asistencial:

| Fase → | Preingreso | Día 0 | Día 1 | Día n | Alta | Seguimiento |
|---|---|---|---|---|---|---|
| Valoración | | | | | | |
| Exámenes | | | | | | |
| Tratamiento | | | | | | |
| Cuidados de enfermería | | | | | | |
| Nutrición / actividad | | | | | | |
| Educación al paciente | | | | | | |
| Criterio para avanzar | | | | | | |
| Planificación del alta | | | | | | |

## 7. Hoja de configuración para el sistema

```
# Configuración HIS/ERP — [nombre del flujo]
## Estados y transiciones
| Estado | Descripción | Transición permitida a | Rol que la ejecuta | Condición |
## Campos obligatorios por paso
| Paso | Campo | Tipo | Validación | Catálogo |
## Reglas y validaciones
| Regla | Tipo (bloqueo/advertencia) | Condición | Mensaje |
## Alertas y notificaciones
| Disparador | Destinatario (rol) | Canal | Texto | Escalamiento si no se atiende en [tiempo] |
## Plantillas de documentos asociadas
## Reportes / indicadores a generar
| Indicador (código) | Tabla de hechos | Campos | Frecuencia |
## Datos que deben quedar en el modelo analítico
[hechos, dimensiones, fecha-hora real del evento, usuario]
## Roles y permisos
```

## 8. Informe de análisis de datos

```
# [Título del análisis] — [periodo]
## Resumen ejecutivo
[3–5 frases: qué pasa, por qué, qué se decide; cifras clave]
## Hallazgos (priorizados)
### H1 [P1–P4] [Título del hallazgo]
Qué muestran los datos: [cifras, tendencia, comparadores, n]
Descomposición: [dónde se concentra]
Causa raíz probable: [clínica / operativa / personas / dato / financiera] — [evidencia]
Impacto: [pacientes, días-cama, dinero, riesgo]
### H2 ...
## Acciones recomendadas
| # | Acción | Tipo (contención/estructural) | Responsable | Plazo | Indicador de verificación | Prioridad |
## Qué no sabemos / siguientes análisis
## Anexo: definiciones, fuentes y calidad del dato
[Fórmulas usadas, fecha de corte, exclusiones, problemas de dato detectados]
```

## 9. Plan de desarrollo individual

```
# Plan de desarrollo — [rol/persona] — [periodo]
Objetivo del plan: [una frase ligada a resultados del servicio]
Diagnóstico: [fortalezas; 2–3 competencias a desarrollar, con comportamientos observables]
| Competencia | Comportamiento esperado | Actividad de desarrollo | Apoyo de la organización | Fecha | Evidencia de logro |
Tiempo protegido: [horas/semana]
Seguimiento: [cadencia, con quién]
Revisión: [fecha]   Firmas: [persona, jefe]
```

## 10. Guion de conversación difícil

```
Situación: [una frase]   Resultado deseado: [una frase]
Hechos (observables, con fecha/cifra): 1. ... 2. ... 3. ...
Impacto: [paciente / equipo / organización]
Parte del problema que es del sistema: [..]
Apertura (30 s): "..."
Hechos e impacto (2 min): "..."
Pregunta de escucha: "..."
Posibles respuestas y cómo reaccionar: [2–3 escenarios]
Acuerdo mínimo que quiero cerrar: [1–2 compromisos, fecha, cómo se mide]
Lo que la organización pone: [..]
Cierre y fecha de seguimiento: "..."
Lo que NO voy a hacer: [p. ej., discutir casos clínicos puntuales, prometer lo que no controlo]
```

## 11. Caso de negocio de un servicio de salud

```
# Caso de negocio — [servicio/iniciativa]
## Resumen ejecutivo
## Problema / oportunidad (con datos)
## Opciones evaluadas (incl. no hacer nada)
## Opción recomendada: descripción, alcance, modelo operativo
## Mercado y demanda: [población, competencia, pagadores, volumen esperado con supuestos]
## Modelo clínico y de calidad: [pathways, indicadores, riesgos para el paciente]
## Personas: [dotación, perfiles, reclutamiento, capacitación]
## Tecnología y datos: [sistema, integración, indicadores]
## Cumplimiento: [habilitaciones, normativa, protección de datos]
## Finanzas: inversión, costos fijos y variables, ingresos por escenario (base/conservador/optimista), punto de equilibrio, payback, VAN/TIR si aplica
## Riesgos y mitigación
## Plan de implementación e hitos
## Indicadores de éxito a 6/12/24 meses
## Decisión solicitada
```
