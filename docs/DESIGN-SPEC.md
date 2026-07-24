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
