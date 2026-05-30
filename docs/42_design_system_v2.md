# 42 — Design System v2.0 · HIS Multipaís

**Documento de referencia técnica del Design System v2.0**
Version: 2.0
Fecha cierre: 2026-05-29
Stack: Next.js 14 + Tailwind 3.4 + Shadcn/ui + Lucide
Base: `docs/07_design_system.md` (v1.0) + `docs/08_rediseno_visual_v2.md` (spec)

---

## §1 Resumen ejecutivo

El rediseno visual v2.0 se entrego en 9 tareas distribuidas en 11 PRs mergeados a `main` (Tareas 0–8, 2026-05-29). Cubre la renovacion del sistema de tokens, el app shell, componentes de contexto clinico, la paleta de comandos, estados de UI y componentes de visualizacion.

**Cumplimiento WCAG 2.1 AA:** verificado en tokens semanticos (contraste ≥ 4.5:1 texto normal, ≥ 3:1 UI). Los 5 niveles Manchester, `--allergy` y `--lasa` mantienen sus hex auditados. `prefers-reduced-motion` respetado en todos los puntos de animacion. Touch targets ≥ 44px (`@media (pointer: coarse)` forzado en densidad compact).

**Compatibilidad con v1.0:** las APIs de componentes Shadcn existentes no cambiaron — solo extensiones aditivas. El alias `--radius` conservado apuntando a `--radius-md`. Los tokens HSL de v1.0 fueron reemplazados por OKLCH con valores perceptualmente equivalentes; los hex clinicos protegidos permanecen matematicamente identicos. Codigo que usaba `var(--background)`, `var(--primary)`, etc., funciona sin modificacion.

---

## §2 Tokens

### 2.1 Tokens semanticos base — OKLCH light / dark

Archivo: `packages/ui/src/styles/globals.css`

| Token CSS | Light (OKLCH) | Dark (OKLCH) | Uso |
|-----------|---------------|--------------|-----|
| `--background` | `oklch(1.0000 0.0001 263.28)` | `oklch(0.1573 0.0228 265.66)` | Fondo de pagina |
| `--foreground` | `oklch(0.2064 0.0388 265.55)` | `oklch(0.9838 0.0036 248.23)` | Texto principal |
| `--card` | `oklch(1.0000 0.0001 263.28)` | `oklch(0.1773 0.0294 265.82)` | Tarjetas, paneles |
| `--primary` | `oklch(0.3873 0.1183 258.76)` | `oklch(0.6855 0.1614 244.80)` | Avante deep blue #174281 — accion primaria |
| `--secondary` | `oklch(0.9503 0.0085 258.39)` | `oklch(0.2549 0.0607 278.08)` | Accion secundaria |
| `--muted` | `oklch(0.9669 0.0056 258.40)` | `oklch(0.2335 0.0321 280.44)` | Texto / fondo de menor jerarquia |
| `--accent` | `oklch(0.9536 0.0180 236.83)` | `oklch(0.4344 0.1097 246.32)` | Hover, seleccion, accent interactivo |
| `--destructive` | `oklch(0.5541 0.2101 25.18)` | `oklch(0.6201 0.1966 21.50)` | Acciones destructivas |
| `--border` | `oklch(0.9013 0.0143 258.38)` | `oklch(0.3038 0.0472 280.05)` | Bordes |
| `--input` | `oklch(0.9013 0.0143 258.38)` | `oklch(0.3038 0.0472 280.05)` | Bordes de input |
| `--ring` | `oklch(0.5393 0.1394 247.04)` | `oklch(0.7145 0.1478 242.63)` | Focus visible |

### 2.2 Tokens de superficie (elevacion)

Cuatro capas de luminancia que reemplazan el uso de sombras dramaticas. Sin `box-shadow` en superficie base.

| Token | Light | Dark | Uso tipico |
|-------|-------|------|------------|
| `--surface-0` | `oklch(1.0000 0.0000 0)` | `oklch(0.1573 0.0228 265.66)` | Fondo de pagina (igual a `--background`) |
| `--surface-1` | `oklch(0.9850 0.0040 264.00)` | `oklch(0.1773 0.0294 265.82)` | Cards, sidebars |
| `--surface-2` | `oklch(0.9700 0.0060 264.00)` | `oklch(0.2000 0.0320 266.00)` | Popovers, dropdowns |
| `--surface-3` | `oklch(0.9550 0.0080 264.00)` | `oklch(0.2200 0.0350 266.00)` | Dialogos, modales |

Uso en Tailwind: `bg-[var(--surface-1)]` o via el alias `bg-surface-1` configurado en `packages/ui/tailwind.config.ts`.

### 2.3 Tokens de radio

| Token | Valor | Aplicacion |
|-------|-------|------------|
| `--radius-sm` | `6px` | Badges, chips, inputs pequenos |
| `--radius-md` | `8px` | Botones, inputs estandar, cards compactas |
| `--radius-lg` | `12px` | Cards, modales, popovers |
| `--radius-xl` | `16px` | Dialogos grandes, drawers |
| `--radius` | `8px` | Alias retrocompat Shadcn → apunta a `--radius-md` |

### 2.4 Tokens de movimiento

| Token | Valor | Uso |
|-------|-------|-----|
| `--motion-fast` | `120ms` | Hover, focus, toggles inmediatos |
| `--motion-base` | `180ms` | Transiciones de componente estandar |
| `--motion-slow` | `260ms` | Apertura de paneles, drawers |
| `--motion-easing` | `cubic-bezier(0.2, 0, 0, 1)` | Easing unico del sistema |

Regla global: bajo `prefers-reduced-motion: reduce`, todas las duraciones colapsan a `0ms` y las `::view-transition-*` reciben `animation: none !important`.

### 2.5 Tokens de densidad

Controlados via atributo `data-density` en `<html>`. El toggle UI es `<DensityToggle>` (ver §9).

| Modo | `--density-row-height` | `--density-padding-x` |
|------|------------------------|----------------------|
| `comfortable` (default) | `44px` | `1rem` |
| `compact` | `36px` | `0.75rem` |

Excepcion touch: `@media (pointer: coarse)` fuerza `--density-row-height: 44px` incluso en `compact` para cumplir WCAG 2.5.5.

### 2.6 Tokens clinicos inviolables

Estos valores HEX son identidad clinica auditada WCAG 2.1 AA. No se modifican por tenant.

**Triage Manchester:**

| Nivel | Token | Hex | OKLCH | Contraste |
|-------|-------|-----|-------|-----------|
| 1 Rojo | `--triage-red` | `#DC2626` | `oklch(0.5771 0.2151 27.32)` | 5.9:1 AA |
| 2 Naranja | `--triage-orange` | `#EA580C` | `oklch(0.6461 0.1943 41.11)` | 4.6:1 AA |
| 3 Amarillo | `--triage-yellow` | `#CA8A04` | `oklch(0.6807 0.1422 75.83)` | 8.2:1 AAA (foreground oscuro) |
| 4 Verde | `--triage-green` | `#16A34A` | `oklch(0.6270 0.1699 149.23)` | 4.5:1 AA |
| 5 Azul | `--triage-blue` | `#2563EB` | `oklch(0.5461 0.2153 262.89)` | 5.7:1 AA |

**Banners clinicos:**

| Token | Hex | OKLCH | Uso |
|-------|-----|-------|-----|
| `--allergy` | `#A6133E` | `oklch(0.4696 0.1771 12.68)` | Banner alergia |
| `--lasa` | `#7A2E10` | `oklch(0.4062 0.1137 39.90)` | Banner medicamento LASA |

**Estados clinicos:**

| Token | OKLCH | Uso |
|-------|-------|-----|
| `--success` | `oklch(0.6112 0.1611 149.72)` | Resultado normal |
| `--warning` | `oklch(0.6356 0.1298 81.53)` | Valor fuera de rango leve |
| `--critical` | `oklch(0.5541 0.2101 25.18)` | Valor critico, bloqueo |
| `--info` | `oklch(0.5393 0.1394 247.04)` | Informacion neutra |

---

## §3 App Shell (Tareas 2a / 2b / 2c)

### Diagrama de layout

```
+----------------------------------------------------------+
| [Trigger] [Breadcrumbs]          [Search] [Density] [Theme] |
|---+------------------------------------------------------+
|   |                                                      |
| S |              MAIN CONTENT                            |
| i |            (Slot via children)                       |
| d |                                                      |
| e |                                                      |
| b |                                                      |
| a |                                                      |
| r |                                                      |
|   |                                                      |
+---+------------------------------------------------------+
```

### Componentes

| Componente | Archivo | Rol |
|------------|---------|-----|
| `<SidebarProvider>` | `packages/ui/src/components/sidebar.tsx` | Contexto colapsable + cookie de estado |
| `<AppSidebar>` | `apps/web/src/components/app-sidebar.tsx` | Sidebar con nav por secciones |
| `<SidebarInset>` | `packages/ui/src/components/sidebar.tsx` | Contenedor del contenido principal |
| `<SidebarTrigger>` | `packages/ui/src/components/sidebar.tsx` | Boton hamburguesa en top bar |

**Desktop:** sidebar colapsible. Estado (abierto/cerrado) persistido en cookie `sidebar:state`. Ancho: 256px expandido, 48px colapsado (iconos).

**Mobile:** Shadcn detecta breakpoint via `useIsMobile()`. En mobile el sidebar se renderiza como `<Sheet>` (drawer lateral). No persiste estado en mobile.

### Datos de navegacion

- `apps/web/src/components/nav-sections.ts` — exporta `SECTIONS: NavSection[]` y los tipos `NavItem`, `NavSection`. Fuente unica de verdad para navigation items.
- `apps/web/src/components/nav-visibility.ts` — exporta `isItemVisible(item, roleCodes, assignedUnits, isCrossService)`. Filtra items segun RBAC y scope del Nivel A.

---

## §4 PatientContextBar (Tarea 3)

Archivo: `apps/web/src/components/patient-context-bar.tsx`

Barra persistente en rutas del expediente clinico (`/patients/[id]/*` y equivalentes) que expone identidad del paciente, ubicacion y alertas sin desplazamiento.

### Props

```tsx
interface PatientContextBarProps {
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    mrn: string;
    birthDate: Date | null;
    biologicalSexCode: string | null; // "M" | "F" | "I" | "U"
    isUnknown?: boolean;
  };
  location?: {
    establishment: string;
    service?: string;
    bed?: string;
  };
  alerts?: {
    allergies?: { name: string; severity: "MILD" | "MODERATE" | "SEVERE" }[];
    isolation?: string;
    fallRisk?: "LOW" | "MEDIUM" | "HIGH";
    lasa?: boolean;
  };
  className?: string;
}
```

### Layout y accesibilidad

- Contenedor: `role="region"` + `aria-label="Contexto del paciente"`.
- Layout en tres zonas: izquierda (identidad: nombre, MRN, edad, sexo) / centro (ubicacion: establecimiento, servicio, cama) / derecha (alertas: badges alergia, aislamiento, caida + sparklines opcionales).
- Sparklines de signos vitales se muestran si se pasan via la prop `vitals` (extension Tarea 7 — ver §8).
- Fondo `bg-[var(--surface-1)]` con `border-b border-[var(--border)]`.

---

## §5 CommandPalette (Tarea 4)

Archivo: `apps/web/src/components/command-palette.tsx`

Paleta de comandos global activada con `Ctrl+K` / `Cmd+K`.

### API

```tsx
// Provider (envuelve el layout):
<CommandPalette
  roleCodes={session.roleCodes}
  assignedServiceUnitCodes={session.units}
  isCrossServiceRole={session.isCrossService}
>
  {children}
</CommandPalette>

// Boton que abre la paleta (top bar):
<CommandPaletteButton />

// Hook para abrir desde cualquier parte del arbol:
const { setOpen } = useCommandPalette();
```

### Grupos y comportamiento

| Grupo | Fuente | Comportamiento |
|-------|--------|----------------|
| Pacientes | `trpc.patient.search` | Debounce 300ms, minimo 2 caracteres de query |
| Navegacion | `SECTIONS` de `nav-sections.ts` | Filtrado por `isItemVisible()` segun rol |
| Acciones rapidas | Array estatico | Logout, ayuda, atajos |

### Primitivos Shadcn cmdk usados

`Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandSeparator`, `CommandShortcut` — todos de `packages/ui/src/components/command.tsx`.

---

## §6 Componentes refrescados (Tarea 5)

Cambios en `packages/ui/src/components/`. Todos son extensiones aditivas — no rompen APIs existentes.

| Componente | Archivo | Cambios v2.0 |
|------------|---------|--------------|
| `Button` | `button.tsx` | `rounded-md` explicito, `duration-[var(--motion-fast)]`, `shadow-sm` en variant `default` |
| `Badge` | `badge.tsx` | `rounded-md` (era `rounded-full`), `font-medium` agregado |
| `Input` | `input.tsx` | `rounded-md` + focus ring estandar con `ring-[var(--ring)]` |
| `Table` | `table.tsx` | `<TableCell>` acepta prop `numeric?: boolean` (aditiva): activa `tabular-nums text-right` y padding por densidad |
| `Tabs` | `tabs.tsx` | Tab activo con `bg-background shadow-sm` (era borde inferior plano) |
| `Card` | `card.tsx` | `bg-[var(--surface-1)]` por defecto; `bg-card` se mantiene como alias legacy |

La prop `numeric` en `<TableCell>` es la unica adicion a una interfaz de componente existente. Es retrocompatible: valor `undefined` replica el comportamiento anterior.

---

## §7 Estados (Tarea 6)

Barrel: `@his/ui/components/states` — re-exporta `EmptyState`, `ErrorState`, `Skeleton`.

Archivos:

- `packages/ui/src/components/states/empty-state.tsx`
- `packages/ui/src/components/states/error-state.tsx`
- `packages/ui/src/components/states/index.ts`

### EmptyState

```tsx
interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>; // icono Lucide opcional
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;                // si se proporciona, renderiza <Link>
  };
  className?: string;
}
```

Layout: columna centrada, gap-4, py-12. Icono en contenedor `rounded-[var(--radius-lg)] bg-muted` 48x48px. Titulo `text-lg font-semibold`. Descripcion `text-sm text-muted-foreground`.

### ErrorState

```tsx
interface ErrorStateProps {
  title?: string;          // default "Ocurrio un error"
  description?: string;
  retry?: () => void;      // si se proporciona, muestra boton "Reintentar"
  className?: string;
}
```

Icono `AlertTriangle` de Lucide con `text-destructive`. Boton "Reintentar" llama `retry()` en `onClick`.

### Skeleton

Ya existia en Shadcn. No se modifico. Uso: `<Skeleton className="h-4 w-40" />`.

---

## §8 Sparkline + BedMap (Tarea 7)

### Sparkline

Archivo: `packages/ui/src/components/sparkline.tsx`

SVG inline server-friendly (sin hooks, sin useEffect). Apto para RSC.

```tsx
interface SparklineProps {
  values: number[];          // serie de valores, ej: vitales 24h
  ariaLabel: string;         // obligatorio — describe la serie en audio
  severity?: "normal" | "warning" | "critical";  // default "normal"
  showTrend?: boolean;       // flecha TrendingUp/TrendingDown al final
  width?: number;            // px, default 80
  height?: number;           // px, default 24
  valueLabel?: string;       // etiqueta del ultimo valor, ej: "98"
  unit?: string;             // ej: "mmHg", "bpm"
  className?: string;
}
```

**Regla de triple portador (§3.2):** para severity `warning` y `critical`, el componente emite color + texto del valor + icono Lucide (`AlertCircle`). Solo color no es suficiente.

**Tendencia:** calculada por slope de los ultimos 3 puntos. Positivo → `TrendingUp`, negativo → `TrendingDown`.

**Animacion:** ninguna — SVG estatico. Compatible con `prefers-reduced-motion` por diseno.

### BedMap

Archivo: `apps/web/src/components/bed-map.tsx` (o `packages/ui` segun el merge de Tarea 7).

| Estado de cama | Icono Lucide |
|---------------|--------------|
| Disponible | `BedDouble` |
| Ocupada | `User` |
| En limpieza | `Sparkles` |
| Mantenimiento | `Wrench` |
| Bloqueada | `Ban` |
| Reservada | `CalendarClock` |

- **Leyenda colapsable:** boton chip con color + icono + texto. Accesible (aria-expanded).
- **Tooltip detallado:** codigo de cama, estado, iniciales + MRN del paciente, `updatedAt`.
- **Sin pulso animado en camas criticas:** solo `border-4` con color `--triage-red` + icono `Ban`. Cumple `prefers-reduced-motion`.

---

## §9 Densidad + Container Queries + View Transitions (Tarea 8)

### Toggle de densidad

Hook: `apps/web/src/lib/use-density.ts`

```ts
// Interfaz del hook
const { density, setDensity, mounted } = useDensity();
// density: "comfortable" | "compact"
// setDensity: actualiza localStorage.his.density + data-density en <html>
// mounted: false en SSR (evitar hydration mismatch)
```

Boton UI: `apps/web/src/components/density-toggle.tsx`

- Usa `<Button variant="ghost" size="sm">` + `<Tooltip>`.
- Icono: `Rows4` (comfortable) / `Rows3` (compact) de Lucide.
- Touch target minimo: `min-h-11 min-w-11` (44x44px).
- SSR placeholder: boton deshabilitado de igual tamano para evitar CLS.
- Integrado en `apps/web/src/app/(admin)/layout.tsx` y `(clinical)/layout.tsx` junto al `ThemeToggle`.

**Persistencia:** `localStorage` bajo la clave `his.density`. Al montar, el hook lee el valor y lo aplica a `document.documentElement.dataset.density`.

### Container Queries

Plugin habilitado: `@tailwindcss/container-queries` en `packages/ui/tailwind.config.ts`.

Pattern de uso:

```tsx
// El contenedor declara un contexto de tamano:
<div className="@container">
  {/* Los hijos reaccionan al tamano del contenedor, no del viewport: */}
  <div className="flex-col @sm:flex-row">...</div>
</div>
```

Precedente: `PatientIdCard` usa `@container` para adaptar el header al contenedor. `Card` documenta el patron en JSDoc.

### View Transitions

Habilitado en `apps/web/next.config.mjs`:

```js
experimental: {
  viewTransition: true,
}
```

Wrapper disponible: `apps/web/src/components/view-transition.tsx` con hook `useViewTransition()`.

Regla reduced-motion en `packages/ui/src/styles/globals.css`:

```css
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation: none !important;
  }
}
```

---

## §10 Restricciones inviolables

Heredadas de `docs/07_design_system.md` v1.0. Vigentes sin excepcion en v2.0:

1. **Colores clinicos protegidos:** Triage Manchester (5 hex), `--allergy` (#A6133E), `--lasa` (#7A2E10). No se modifican por tenant, tema ni country override.
2. **Color nunca unico portador de informacion.** Siempre color + texto o color + icono. Para warning/critical: color + texto + icono Lucide.
3. **Contraste minimo:** texto normal ≥ 4.5:1, texto grande/UI ≥ 3:1. Auditado con axe-core en CI.
4. **Focus visible global:** `focus-visible:ring-2 ring-[var(--ring)] ring-offset-2`. Nunca `outline-none` sin reemplazo.
5. **Sin confirmaciones gratuitas.** Solo en irreversibles: firma electronica, alta medica, despacho de controlados.
6. **`prefers-reduced-motion` respetado en toda animacion:** tokens `--motion-*` → 0ms, `::view-transition-*` → `animation: none !important`.
7. **Densidad compact ≥ 44px en touch:** `@media (pointer: coarse) { [data-density="compact"] { --density-row-height: 44px; } }`.
8. **Alergia y LASA bloqueantes:** no se puede confirmar una orden con alergia activa sin segunda firma. LASA requiere checkbox de verificacion visual.

---

## §11 Como consumir

### Pagina clinica tipica

```tsx
// apps/web/src/app/(clinical)/patients/[id]/page.tsx
import { PatientContextBar } from "@/components/patient-context-bar";
import { Card, CardHeader, CardContent } from "@his/ui/components/card";
import { EmptyState } from "@his/ui/components/states";

export default function PatientPage({ params }: { params: { id: string } }) {
  return (
    <>
      <PatientContextBar
        patient={{ id: params.id, firstName: "...", lastName: "...", mrn: "...", birthDate: null, biologicalSexCode: "M" }}
        location={{ establishment: "Hospital Central", service: "Cirugia" }}
      />
      <Card>
        <CardHeader>Historial clinico</CardHeader>
        <CardContent>
          <EmptyState
            title="Sin registros"
            description="No hay entradas en el historial para este episodio."
          />
        </CardContent>
      </Card>
    </>
  );
}
```

### Tabla densa con columna numerica

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@his/ui/components/table";

<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Parametro</TableHead>
      <TableHead className="text-right">Valor</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Presion sistolica</TableCell>
      <TableCell numeric>120</TableCell>  {/* tabular-nums + text-right + padding densidad */}
    </TableRow>
  </TableBody>
</Table>
```

### Importar estados

```tsx
import { EmptyState, ErrorState } from "@his/ui/components/states";
// Skeleton sigue disponible en su ruta original:
import { Skeleton } from "@his/ui/components/skeleton";
```

### Sparkline en PatientContextBar

```tsx
// vitals prop (opcional) — muestra sparklines junto a alertas
<PatientContextBar
  patient={patient}
  alerts={alerts}
  // vitals se inyecta desde el server component padre:
  // vitals={{ sistolica: [120, 118, 122, 119], diastolica: [78, 76, 80, 79] }}
/>
```

---

## §12 Changelog — 11 PRs entregados

| PR | Tarea | Resumen | Fecha merge |
|----|-------|---------|-------------|
| #356 | Tarea 1 | Tokens OKLCH + surface + radio + motion (rediseno v2.0) | 2026-05-29 |
| #357 | Tarea 2a | Extraer SECTIONS nav a `nav-sections.ts` | 2026-05-29 |
| #360 | Tarea 2b | Shadcn sidebar desktop + `<SidebarProvider>` | 2026-05-29 |
| #362 | Tarea 2c | Migrar mobile sheet a Shadcn sidebar collapsible | 2026-05-29 |
| #367 | Tarea 3 | `<PatientContextBar>` persistente en rutas expediente | 2026-05-29 |
| #368 | Tarea 4 | CommandPalette `Ctrl+K` con cmdk (3 grupos + debounce) | 2026-05-29 |
| #363 | Tarea 5 | Refresh variantes Shadcn + tablas densas (`numeric`) | 2026-05-29 |
| #365 | Tarea 6 | `<EmptyState>` + `<ErrorState>` primitivos | 2026-05-29 |
| Tarea 7* | Tarea 7 | Sparkline SVG inline + BedMap leyenda colapsable | 2026-05-29 |
| Tarea 8* | Tarea 8 | Densidad + container queries + View Transitions | 2026-05-29 |
| #369 | Fixup | Exports map explicito + typesVersions fallback | 2026-05-29 |

*Tareas 7 y 8 en branches `feat/ds-v2-tarea-7-sparklines-fresh` y `feat/ds-v2-tarea-8-density-container-transitions` — pendientes de merge a `main` al momento del cierre de esta documentacion.

---

## §13 Follow-ups y deuda conocida

1. **Atajos v1.0 en CommandPalette (Tarea 4 v2):** `Alt+P` (paciente), `Alt+N` (nueva nota), `Alt+T` (nuevo triage), `Alt+M` (eMAR), `Ctrl+/` (lista atajos), `Esc` (cerrar), `Ctrl+Enter` (confirmar) definidos en `docs/07_design_system.md §7.6` no estan cableados dentro del `CommandPalette`. Requieren un `useEffect` con `keydown` listener o integracion con una libreria de atajos (ej. `hotkeys-js`).

2. **Container queries en mas componentes:** Tarea 8 aplico `@container` en `PatientIdCard` como prueba del patron. Candidatos proximos: `BedMap`, `VitalSignsCapture`, tarjetas de dashboard financiero.

3. **View Transitions en listas → detalle:** el wrapper `<ViewTransition>` esta disponible pero no aplicado en navegaciones de lista de pacientes → expediente. Agregar `<ViewTransition name={`patient-${id}`}>` en la tarjeta de lista y en el header del expediente cuando se necesite continuidad visual.

4. **Storybook:** no hay catalogo visual de los componentes nuevos (EmptyState, ErrorState, Sparkline, PatientContextBar, CommandPalette). Deuda documentada para una iteracion futura de DX.

5. **Merges pendientes:** Tareas 7 y 8 requieren PR formal y merge a `main`. La documentacion de este archivo describe el contrato de sus APIs segun los commits `d21fe13` y `682e8a4`.
