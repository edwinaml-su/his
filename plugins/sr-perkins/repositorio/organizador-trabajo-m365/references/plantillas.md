# Plantillas de los entregables

Usa la plantilla **exacta** del entregable pedido. Mantén el orden de secciones.
Si una sección no tiene contenido real, escríbelo explícitamente
("— Sin novedades —") en lugar de omitirla o inventar.

---

## 1. Resumen diario de trabajo

```markdown
# Resumen diario — [día, fecha]

## Panorama
[2-3 líneas: carga del día, lo más crítico, algún bloqueo mayor.]

## Prioridades de hoy (máx. 5)
1. [acción] — [por qué importa / fecha] — [origen]
2. ...

## Agenda
- [hora] — [asunto] — [organizador] — [preparar: …]
- ...

## Tickets que requieren acción
- 🔴 Vencidos / escalados: [#ref — asunto — qué falta]
- 🟠 Sin responder: [#ref — asunto — desde cuándo]
- 🟢 Nuevos hoy: [#ref — asunto]
( "— Sin tickets pendientes —" si aplica )

## Proyectos
- [Proyecto] — [hito/pendiente de hoy] — [estado] — [bloqueo si hay]

## Seguridad del departamento
- [TI/Física/Cumplimiento] — [actividad/pendiente de hoy] — [fecha límite si hay]

## Esperando respuesta de terceros
- [a quién] — [sobre qué] — [desde cuándo]

## Notas / no pude revisar
- [fuente no consultada y efecto, si aplica]
```

---

## 2. Reporte de estado semanal

```markdown
# Reporte de estado semanal — [rango de fechas]

## Resumen ejecutivo
[2-4 líneas: lo logrado, lo crítico abierto, lo que requiere decisión.]

## Tickets
- Resumen: [abiertos] · [cerrados en la semana] · [escalados] · [vencidos]
- Atención: [#ref — asunto — situación — siguiente acción]
- Tendencia/observación: [opcional, 1 línea]

## Proyectos
Por cada proyecto activo:
- **[Proyecto]** — Estado: [En curso/En riesgo/Bloqueado/Completado]
  - Avance esta semana: [...]
  - Pendiente / próximo hito: [...] — [fecha]
  - Riesgo / bloqueo: [...] (o "ninguno")

## Seguridad del departamento
- Realizado: [actividades de TI/física/cumplimiento]
- Pendiente / en curso: [... — fecha límite]
- Incidentes / riesgos: [... — estado] (o "sin incidentes")

## Reuniones y acuerdos clave
- [reunión] — [acuerdo o decisión] — [responsable/seguimiento]

## Próxima semana — prioridades
1. [...]
2. [...]

## Riesgos y temas para decisión / escalamiento
- [tema] — [por qué] — [qué se necesita decidir]

## Cobertura
- Fuentes consultadas: [Outlook correo/calendario, Teams, SharePoint]
- No consultado / sin acceso: [... y efecto]
```

---

## 3. Tablero de seguimiento continuo

El tablero **no se redacta a mano**: lo genera `scripts/render_tablero.py` para que el
formato y la fusión sean consistentes entre usos. Tu trabajo es producir
`updates.json` con las tareas nuevas o cambiadas; el script fusiona por `id`,
preserva el estado, archiva lo terminado y renderiza `TABLERO.md`.

### Esquema de una tarea (JSON)

```json
{
  "id": "TKT-12345",
  "dominio": "tickets",
  "titulo": "Responder solicitud de acceso de proveedor",
  "detalle": "Espera aprobación del usuario; SLA vence.",
  "origen": "Odoo (correo Outlook)",
  "referencia": "#12345 / asunto del correo",
  "prioridad": "alta",
  "estado": "esperando",
  "responsable": "Edwin",
  "fecha_limite": "2026-05-21",
  "notas": ""
}
```

- `id` **estable** para que la fusión no duplique. Convención sugerida:
  - tickets: `TKT-<número>`
  - proyectos: `PROY-<slug-proyecto>-<n>` (p. ej. `PROY-followup-sync-01`)
  - seguridad: `SEG-<año>-<n>`
  - programación: `CAL-<fecha>-<slug>`
  Si no hay número natural, crea un slug estable a partir del título + origen y
  **reutilízalo** en futuras corridas para la misma tarea.
- `dominio` ∈ `tickets | proyectos | programacion | seguridad`
- `prioridad` ∈ `alta | media | baja`
- `estado` ∈ `por_hacer | en_progreso | esperando | hecho`
- `fecha_limite` en `YYYY-MM-DD` (u omitir). El script pone `actualizado` solo.

### `updates.json`

Una lista con solo lo nuevo o cambiado en esta corrida:

```json
[
  { "id": "TKT-12345", "dominio": "tickets", "titulo": "...", "estado": "esperando",
    "prioridad": "alta", "origen": "Odoo (correo Outlook)", "fecha_limite": "2026-05-21" },
  { "id": "PROY-followup-sync-01", "dominio": "proyectos", "titulo": "Validar sync final",
    "estado": "en_progreso", "prioridad": "media" }
]
```

Para **marcar algo terminado**, incluye su `id` con `"estado": "hecho"`. No borres
tareas a mano: el script archiva las terminadas con antigüedad.

### Ejecución

```bash
python scripts/render_tablero.py \
  --current board.json   # omitir la primera vez
  --updates updates.json \
  --out-json board.json \
  --out-md TABLERO.md
```

Entrega `TABLERO.md` al usuario y conserva `board.json`. Recuérdale readjuntar
`board.json` la próxima vez para mantener historial y evitar duplicados.
