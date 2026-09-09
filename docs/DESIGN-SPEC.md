# DESIGN-SPEC.md — Tokens de diseño extraídos del mockup

> Ubicación en el proyecto: `docs/DESIGN-SPEC.md`
> Fuente de verdad: `design/mockup/` (HTML/CSS entregado).
> Esta plantilla se llena con los valores REALES del mockup. Los valores de
> ejemplo (`#...`, `--`) son marcadores: reemplázalos, no los dejes.
> Regla: todo token nuevo se agrega aquí Y en `apps/web/tailwind.config.ts`
> (y variable CSS en `packages/ui/src/styles/globals.css` si aplica theming)
> **en el mismo commit**.
> Ver reglas completas en `CLAUDE.md § Fidelidad de diseño (mockup)`.

---

## 1. Paleta de colores

| Token (Tailwind) | Valor exacto | Origen en el mockup | Uso |
|---|---|---|---|
| `brand-primary` | `#______` | `styles.css > .btn-primary` | Botones principales, enlaces |
| `brand-primary-hover` | `#______` | `.btn-primary:hover` | Estado hover |
| `brand-secondary` | `#______` | -- | Acentos secundarios |
| `surface` | `#______` | `body { background }` | Fondo general |
| `surface-card` | `#______` | `.card { background }` | Tarjetas / paneles |
| `text-base` | `#______` | `body { color }` | Texto principal |
| `text-muted` | `#______` | `.subtitle` | Texto secundario |
| `border-base` | `#______` | `.card { border }` | Bordes y divisores |
| `success` / `warning` / `danger` | `#______` | -- | Estados y alertas |

## 2. Tipografía

| Token | Valor exacto | Origen | Uso |
|---|---|---|---|
| `font-sans` | `"______", sans-serif` | `body { font-family }` | Texto general |
| `font-display` | `"______", serif` | `h1, h2` | Titulares (si aplica) |
| `text-h1` | `__px / line-height __ / weight __` | `h1` | Título principal |
| `text-h2` | `__px / __ / __` | `h2` | Secciones |
| `text-body` | `__px / __ / __` | `p` | Párrafos |
| `text-small` | `__px / __ / __` | `.caption` | Notas, labels |

Fuentes cargadas vía: `next/font` (no `<link>` a Google Fonts salvo que el mockup lo exija).

## 3. Espaciado y layout

| Token | Valor | Origen | Uso |
|---|---|---|---|
| `container-max` | `____px` | `.container { max-width }` | Ancho máximo del contenido |
| `section-y` | `____px` | `section { padding }` | Separación vertical entre secciones |
| `card-padding` | `____px` | `.card { padding }` | Interior de tarjetas |
| `grid-gap` | `____px` | `.grid { gap }` | Rejillas |

## 4. Bordes, radios y sombras

| Token | Valor | Origen |
|---|---|---|
| `radius-card` | `____px` | `.card { border-radius }` |
| `radius-button` | `____px` | `.btn { border-radius }` |
| `shadow-card` | `0 _px _px rgba(...)` | `.card { box-shadow }` |

## 5. Breakpoints (de las media queries del mockup)

| Nombre | Valor | Media query original |
|---|---|---|
| `sm` | `___px` | `@media (max-width: ___px)` |
| `md` | `___px` | -- |
| `lg` | `___px` | -- |

Si el mockup NO define una vista para algún breakpoint → preguntar al usuario
antes de improvisar.

## 6. Estados e interacciones

| Elemento | Estado | Valor del mockup |
|---|---|---|
| Botón primario | hover | fondo `#______`, transición `___ms` |
| Botón primario | disabled | -- |
| Enlace | hover | -- |
| Input | focus | borde `#______`, ring/outline `--` |

## 7. Mapeo mockup → componentes React

| Archivo del mockup | Ruta en la app | Componentes | Estado |
|---|---|---|---|
| `design/mockup/index.html` | `apps/web/src/app/______/page.tsx` | -- | ⬜ pendiente |
| `design/mockup/______.html` | `apps/web/src/app/______/page.tsx` | -- | ⬜ pendiente |

Estados: ⬜ pendiente · 🔶 en progreso · ✅ verificado contra mockup

## 8. Desviaciones aprobadas

Toda diferencia respecto al mockup debe quedar registrada aquí con la
aprobación del usuario. Si no está en esta tabla, es un bug de fidelidad.

| Fecha | Elemento | Mockup decía | Se implementó | Motivo | Aprobado por |
|---|---|---|---|---|---|
| -- | -- | -- | -- | -- | -- |

---

## 9. Laboratorio v2 — `mockup_examenes_laboratorio.html`

Módulo `/lis/orders/new` (escogitación en cascada Tipo→Subtipo→Sección) +
`/lis/orders` (Tablero/Estudios). Origen: `design/mockup/mockup_examenes_laboratorio.html`.

**Deviación de nomenclatura heredada (precedente CC-0013, no nueva):** este
módulo es una herramienta operativa interna, no parte del design system de
paciente — los tokens NO se materializan en `tailwind.config.ts` ni en
`globals.css`. Se centralizan en `apps/web/src/app/(clinical)/lis/_lib/mock-palette.ts`
(objeto `MOCK_LAB_PALETTE`) y se consumen vía `style={{ color: MOCK.xxx }}`,
igual que CC-0013. Ver tabla §9.4.

### 9.1 Paleta de colores (`:root`, línea 2 del mockup)

| Token (`MOCK_LAB_PALETTE`) | Valor exacto | Origen en el mockup | Uso |
|---|---|---|---|
| `teal` | `#2f8a99` | `:root { --teal }` | Botones primarios, checkbox accent, pills activas |
| `tealDark` | `#2a7d8c` | `.cnt` / `.sec-badge` color (líneas 39, 53) | Texto sobre chips claros |
| `tealSub` | `#3f9aa8` | `.rb.sub.active` background (línea 37) | Pill de subtipo activa |
| `orange` | `#e8853d` | `:root { --orange }` | Botón "Cancelar" |
| `blue` | `#2f6fb0` | `:root { --blue }` | Links ("Ver selección", "Quitar filtro") |
| `ink` | `#243642` | `:root { --ink }` | Texto principal, ítem seleccionado |
| `inkSoft` | `#4a5b66` | `:root { --ink-soft }` | Texto secundario |
| `line` | `#d9e0e4` | `:root { --line }` | Bordes y separadores |
| `rbBorder` | `#cdd9db` | `.rb` border (línea 35) | Borde de pills tipo/subtipo/sección |
| `rbHoverBg` | `#f0f6f7` | `.rb:hover` / `.check-item:hover` (líneas 36, 51) | Hover de pills e ítems de la lista |
| `cntBg` | `#eef4f5` | `.rb .cnt` background (línea 39) | Fondo del contador dentro de una pill |
| `panelSoftBg` | `#fafcfc` | `.config-panel` / `.solicitud-panel` background (líneas 28, 61) | Fondo de los paneles de cascada y tablero |
| `selectionBarBg` | `#f7f9fa` | `.selection-bar` background (línea 56) | Barra resumen de selección |
| `hintColor` | `#8b98a0` | `.cfg-hint` color (línea 41) | Texto de ayuda bajo la cascada |
| `zeroBadgeBg` | `#aeb9bf` | `.prest-count.zero` background (línea 47) | Chip "0 seleccionadas" |
| `secBadgeBg` | `#e6eef0` | `.sec-badge` background (línea 53) | Badge de sección junto al nombre de la prueba |
| `removeBg` / `removeColor` | `#fbe4e0` / `#c0392b` | `.rm` (línea 73) | Botón "quitar" de una fila de la solicitud |
| `switchTrackOff` | `#c3ccd1` | `.slider` background apagado (línea 21) | Track del switch "Buscar por N..." en estado off |

### 9.2 Tipografía, espaciado, bordes

Sin cambios respecto al precedente CC-0013: `font-size: 13.5px`/`12.5px` en
pills y filas de tabla (Tailwind `text-xs`/`text-sm` — el mockup no define
una escala tipográfica nueva), `border-radius: 20px` en pills (`rounded-full`),
`border-radius: 6-10px` en paneles/botones (`rounded-md`/`rounded-lg`).
Sin tokens dedicados — son valores puntuales de Tailwind ya usados en el
resto del módulo, no literales repetidos.

### 9.3 Componentes de la cascada (comportamiento, mockup líneas 269–356)

| Paso | Regla | Fuente |
|---|---|---|
| 1. Tipo de muestra | Selección única · "Todos" primero, sin contador · pill deshabilitada si `testCount=0` | `renderTipos()` |
| 2. Subtipo de muestra | Solo tras elegir Tipo · "Todos" · solo subtipos con `testCount>0` del tipo elegido · variante `.sub` (pill `tealSub` activa) | `renderSubtipos()` / `subtiposDeTipo()` |
| 3. Sección | Solo secciones con ≥1 prueba que pase el filtro tipo/subtipo · sin contador · oculto en modo búsqueda | `renderSecciones()` / `seccionesPermitidas()` |
| Hint inferior | "Filtrando · N sección(es) · M examen(es)." o "Sin filtro de muestra: N secciones · M exámenes." + link "Quitar filtro de muestra" si hay filtro activo | `actualizarHint()` |

### 9.4 Mapeo mockup → componentes React

| Archivo del mockup | Ruta en la app | Componentes | Estado |
|---|---|---|---|
| `design/mockup/mockup_examenes_laboratorio.html` (pantalla principal) | `apps/web/src/app/(clinical)/lis/orders/new/page.tsx` | `page.tsx` (Server, roleCodes) → `_components/seleccion-examenes-shell.tsx` → `_components/seleccion-examenes.tsx` + `_components/parametros-modal.tsx` | ✅ verificado contra mockup |
| Modal "Solicitud" + tabla `.sol-list` (columna Cantidad, línea 71) | `apps/web/src/app/(clinical)/lis/orders/_components/estudios.tsx` y `solicitud-modal.tsx` | columna "Cant." agregada, sin rediseño adicional (ya alineados a CC-0013) | ✅ verificado contra mockup |
| "Mantenimiento de catálogos" (líneas 162–229) | `apps/web/src/app/(admin)/catalogs/laboratorio/` | fuera de alcance de este cambio (otro agente en paralelo) | ⬜ pendiente (otro workstream) |

### 9.5 Desviaciones aprobadas (adicionales a §8)

| Fecha | Elemento | Mockup decía | Se implementó | Motivo | Aprobado por |
|---|---|---|---|---|---|
| 2026-09-08 | Toolbar de prioridad (ROUTINE/URGENT) | No existe en el mockup | `Select` de prioridad conservado en la toolbar, junto a "Guardar Exámenes" | El flujo actual de `lis.order.create` requiere `priority`; es funcionalidad preexistente de CC-0013, no un elemento nuevo del mockup | Edwin (brief de la tarea) |
| 2026-09-08 | Chrome de ventana falsa (`.window`/`.titlebar`/`.modal-head`) | Presente en el HTML del mockup | Omitido — la pantalla vive dentro del shell real del HIS | Precedente CC-0013 (mismo motivo documentado en `mock-palette.ts`) | Edwin (CC-0013, reafirmado en este cambio) |
| 2026-09-08 | Switch "Buscar por N..." | `.slider` CSS custom (línea 19-23) | Componente `Switch` de `@his/ui` con `style` override de color (`checked ? MOCK.teal : MOCK.switchTrackOff`) para track pixel-exacto sin introducir CSS custom | No se agregan estilos CSS crudos fuera de Tailwind/tokens; el componente ya existe en el design system | Edwin (brief de la tarea — "Shadcn/@his/ui son la base") |
