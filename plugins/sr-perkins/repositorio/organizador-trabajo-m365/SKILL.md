---
name: organizador-trabajo-m365
description: Organiza el trabajo de oficina reuniendo información de Microsoft 365 (correo Outlook incluyendo avisos de Odoo, calendario, Teams y SharePoint) y produce tres entregables - resumen diario de trabajo, reporte de estado semanal y un tablero de seguimiento continuo sin duplicados. Cubre revisión de tickets, seguimiento de proyectos, programación de actividades y seguimiento de actividades de seguridad del departamento (TI, física y cumplimiento). Usa esta habilidad siempre que el usuario pida organizar su día o semana, preparar su resumen diario o reporte semanal, actualizar su tablero de tareas, revisar tickets pendientes, dar seguimiento a proyectos o a actividades de seguridad, preparar su agenda, o diga cosas como 'organiza mi trabajo', 'qué tengo pendiente', 'prepárame el reporte de la semana', 'cómo van los proyectos', 'qué reuniones tengo', aunque no mencione las fuentes ni la palabra habilidad.
---

# Organizador de trabajo de oficina (Microsoft 365)

## Propósito

El usuario coordina trabajo operativo y técnico: revisa tickets (varios llegan como
avisos de Odoo por correo), da seguimiento a proyectos, programa y sigue actividades
del departamento, y vigila temas de seguridad (informática, física y de
cumplimiento). Esa información vive dispersa en Outlook, Teams y SharePoint. El valor
de esta habilidad es **reunir lo disperso y devolverlo organizado y accionable**, sin
que el usuario tenga que reconstruir su contexto cada vez.

Tres entregables, según lo que pida:

1. **Resumen diario** — qué atender hoy: agenda, tickets que requieren acción,
   pendientes de proyectos, actividades de seguridad del día y las 3-5 prioridades.
2. **Reporte de estado semanal** — visión de la semana: tickets, avance por
   proyecto, seguridad, acuerdos clave y prioridades de la próxima semana.
3. **Tablero de seguimiento continuo** — una lista viva de tareas que se actualiza
   entre usos sin duplicar lo ya registrado y preservando el estado de cada tarea.

Si el usuario no especifica cuál quiere, infiérelo de su frase ("organiza mi día" →
diario; "reporte de la semana" → semanal; "qué tengo pendiente" / "actualiza mi
tablero" → tablero). Si pide "organiza mi trabajo" en general, entrega el resumen
diario y ofrece actualizar el tablero a continuación.

## Cómo funciona, en una frase

Cargar las herramientas de Microsoft 365 → recolectar de las fuentes relevantes →
clasificar en cuatro dominios (tickets, proyectos, programación, seguridad) →
producir el entregable con su plantilla exacta.

## Paso 0 — Cargar las herramientas de Microsoft 365

Las herramientas de Microsoft 365 son diferidas: **no se conocen sus parámetros sin
cargarlas primero**. Antes de cualquier otra cosa, llama a `tool_search` con consultas
como `"outlook email"`, `"outlook calendar"`, `"teams messages"`, `"sharepoint"` para
cargar:

- búsqueda de correo de Outlook
- búsqueda de calendario de Outlook
- búsqueda de mensajes de Teams
- búsqueda de documentos/carpetas de SharePoint
- lectura de un recurso por URI (para abrir el contenido completo de un correo,
  evento o documento encontrado)
- disponibilidad para reuniones (solo si el usuario pide proponer horarios)

Usa los nombres de parámetros **tal como los devuelve `tool_search`**; no los
adivines. Si una llamada vuelve vacía o con error, vuelve a `tool_search` para
verificar el esquema antes de reintentar.

Importante para fijar expectativas: este conector **lee y busca**; no crea eventos ni
envía correos. Si el usuario pide "agéndame" o "envía", aclara que puedes preparar el
texto/propuesta listos para que él los ejecute, no ejecutarlos por él.

## Paso 1 — Personalización (primera vez o si falta contexto)

La calidad depende de reconocer bien lo que es del usuario. Si no tienes estos datos
del contexto o de la conversación, pídelos de forma breve y agrupada (una sola vez):

- **Avisos de Odoo**: remitente o patrón de asunto de los correos de tickets de Odoo
  (p. ej. dominio del remitente, o asuntos con `#NNNNN` / "Helpdesk" / "Ticket").
- **Proyectos en curso**: nombres con los que buscar (el usuario ha trabajado en
  iniciativas tipo "followup sync" y "followup gantt"; confirma cuáles siguen vivos).
- **SharePoint**: sitio(s) o carpeta(s) donde están los documentos de proyectos y de
  seguridad.
- **Tablero previo**: si ya existe un tablero (`board.json` / `TABLERO.md`), pídele
  que lo adjunte para continuar sin duplicar; si no, se arranca uno nuevo.

Sugiere al usuario que, si quiere, te diga "recuerda esto" para no volver a
preguntártelo en el futuro. No guardes nada en memoria por tu cuenta.

## Paso 2 — Recolectar de las fuentes

Lee `references/fuentes-m365.md`. Indica, para cada fuente y cada dominio, qué buscar,
cómo redactar las consultas, las ventanas de fecha según el entregable, cómo
reconocer los avisos de Odoo y qué palabras clave usan los temas de seguridad.

Ajusta la ventana temporal al entregable: **diario** mira hoy y lo vencido/sin
responder; **semanal** cubre los últimos 7 días y la semana siguiente; **tablero**
revisa desde la última actualización registrada (o 7 días si es nuevo).

Recolecta en paralelo cuando sea posible. Cuando un resultado parezca importante pero
el extracto sea insuficiente (un correo de ticket, un acta, un documento), usa la
herramienta de lectura por URI para abrir el contenido completo antes de concluir.

## Paso 3 — Clasificar en los cuatro dominios

Ordena todo lo encontrado en:

- **Tickets** — incidencias/solicitudes; típicamente avisos de Odoo o correos de
  soporte. Marca: nuevos, sin responder, vencidos, escalados.
- **Proyectos** — hitos, bloqueos, decisiones pendientes, documentos actualizados.
- **Programación** — reuniones, compromisos y fechas del calendario.
- **Seguridad** — actividades de seguridad informática, física y de cumplimiento
  (parches, accesos, respaldos, auditorías, incidentes, normativas).

Una misma fuente alimenta varios dominios (un correo puede ser un ticket de seguridad
con fecha límite). Clasifícalo por lo que requiere de acción, sin duplicar.

## Paso 4 — Producir el entregable

Lee `references/plantillas.md` y usa la plantilla **exacta** del entregable pedido.
Reglas transversales:

- Prioriza lo accionable. Cada bloque debe responder "¿qué hago con esto?".
- Sé concreto: incluye referencia (n° de ticket, asunto, proyecto) para poder ubicar
  el origen, pero no pegues correos completos.
- Si una sección no tiene contenido real, dilo ("Sin pendientes de seguridad hoy") en
  lugar de inventar o rellenar.
- Marca claramente lo que está **bloqueado o esperando respuesta de terceros**: suele
  ser lo que más se le pierde a quien coordina.

Para el **tablero de seguimiento continuo**, no lo redactes a mano: usa el script que
hace la fusión y el formato de forma consistente entre usos.

1. Construye un JSON `updates.json` con las tareas nuevas o cambiadas que detectaste
   (esquema documentado en `scripts/render_tablero.py` y en `references/plantillas.md`).
2. Ejecuta:

   ```bash
   python scripts/render_tablero.py \
     --current ruta/al/board.json   # omitir si es nuevo
     --updates updates.json \
     --out-json board.json \
     --out-md TABLERO.md
   ```

3. Entrega `TABLERO.md` (legible) y conserva `board.json` (continuidad). Recuérdale al
   usuario guardar/readjuntar `board.json` la próxima vez para no perder el historial.

Guarda los entregables como archivos y preséntalos al usuario. Para diario y semanal,
Markdown es suficiente; ofrece convertir a Word/PDF solo si lo pide.

## Principios de calidad

- **Exactitud sobre exhaustividad.** Es mejor un resumen corto y fiable que uno largo
  con suposiciones. Si la búsqueda no devolvió algo, no lo inventes.
- **Accionable, no narrativo.** El usuario coordina; necesita decidir rápido, no leer
  prosa. Listas tensas, verbos al frente, prioridad y fecha visibles.
- **Continuidad real.** El tablero solo sirve si no duplica ni pierde estado; por eso
  la fusión es por `id` y la hace el script, no el criterio del momento.
- **Transparencia de fuente y de huecos.** Di de dónde sale cada cosa y qué no
  pudiste revisar (p. ej. "Teams no consultado: sin acceso esta vez").

## Casos límite

- **Conector sin acceso o sin resultados**: continúa con las fuentes que sí
  respondan, declara explícitamente cuál faltó y qué implica para el entregable.
- **Demasiados resultados**: acota por fecha y por los patrones de Personalización
  (remitente de Odoo, nombres de proyecto, palabras de seguridad) antes de ampliar.
- **Sin tablero previo**: arranca uno; el primer `TABLERO.md` será la línea base.
- **Petición ambigua** ("ayúdame a organizarme"): entrega el resumen diario y ofrece
  el semanal y la actualización del tablero como siguientes pasos.

## Archivos de la habilidad

- `references/fuentes-m365.md` — qué y cómo buscar en cada fuente, por dominio.
- `references/plantillas.md` — las tres plantillas exactas y el esquema del tablero.
- `scripts/render_tablero.py` — fusiona y renderiza el tablero de forma consistente.
