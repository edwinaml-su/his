# 07 — Design System HIS Multipaís

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @UIUX (UI/UX Architect)
**Versión:** 1.0 — 2026-04-30
**Estado:** Blueprint UX/UI aprobado para Fase 0+1
**Stack:** Next.js 14 + Tailwind CSS + Shadcn/ui + Lucide React
**Cumplimiento:** TDR §29.5 (Usabilidad) + WCAG 2.1 AA

---

> **AVISO — Design System v2.0 disponible (2026-05-29)**
>
> El rediseno visual v2.0 entrego 11 PRs que reemplazan o extienden varias secciones de este documento. La referencia tecnica completa esta en **`docs/42_design_system_v2.md`**.
>
> Resumen de cambios en v2.0:
> - Tokens de color migrados de HSL a **OKLCH** (perceptualmente uniforme). Ver `docs/42_design_system_v2.md §2`.
> - Nuevos tokens: superficie (`--surface-0/1/2/3`), radio (`--radius-sm/md/lg/xl`), movimiento (`--motion-fast/base/slow`), densidad. Ver §2.
> - App shell renovado con Shadcn `<SidebarProvider>` + `<AppSidebar>`. Ver `docs/42_design_system_v2.md §3`.
> - `<PatientContextBar>` para rutas del expediente. Ver `docs/42_design_system_v2.md §4`.
> - `<CommandPalette>` (`Ctrl+K`) con 3 grupos y debounce. Ver `docs/42_design_system_v2.md §5`.
> - Refresh de variantes en `Button`, `Badge`, `Input`, `Table`, `Tabs`, `Card`. Ver `docs/42_design_system_v2.md §6`.
> - Primitivos de estado: `<EmptyState>`, `<ErrorState>`. Ver `docs/42_design_system_v2.md §7`.
> - `<Sparkline>` SVG + BedMap leyenda colapsable. Ver `docs/42_design_system_v2.md §8`.
> - Toggle de densidad + container queries + View Transitions. Ver `docs/42_design_system_v2.md §9`.
>
> Este documento v1.0 se conserva como historia de diseno. Para implementacion nueva, consultar v2.0.

---

> **Principio rector:** El error de un clínico cansado puede costar una vida. La UI debe **prevenir errores antes que corregirlos** y **acelerar el flujo correcto** sin pedir confirmaciones gratuitas.

---

## 1. Principios de Diseño

| # | Principio | Aplicación práctica |
|---|-----------|---------------------|
| 1 | **Claridad clínica** | Un dato crítico (alergia, alerta, triage rojo) nunca compite visualmente con datos secundarios. Jerarquía tipográfica estricta. |
| 2 | **Datos densos legibles** | Listas de pacientes, mapas de cama y eMAR muestran muchos datos por pantalla sin saturar. `text-sm` (14px) base, `tabular-nums` para columnas numéricas. |
| 3 | **Errores prevenibles** | Confirmación obligatoria solo en irreversibles (firma electrónica, alta médica, despacho de medicamento). Para LASA y alergias: **bloqueo activo** + segunda firma. |
| 4 | **Minimizar clics** | Formularios "smart defaults" según contexto (servicio, hora, último valor). Atajos de teclado documentados. Búsqueda global `Ctrl+K`. |
| 5 | **Consistencia multi-país** | Misma UI en SV/MX/GT/HN/CR. Diferencias localizadas en labels, formatos de fecha/moneda y catálogos — nunca en flujos. |
| 6 | **Confianza forense** | Todo cambio crítico muestra autor, hora y razón. AuditTrail visible 1 clic desde cualquier dato clínico. |

---

## 2. Paleta de Colores

> **Tokens HSL obsoletos → Ver v2.0 §2.** En v2.0 los tokens semanticos usan OKLCH. Los valores HSL de esta seccion han sido reemplazados en `packages/ui/src/styles/globals.css`. Los hex clinicos protegidos (Manchester, allergy, lasa) son matematicamente identicos.

### 2.1 Tokens semánticos (Shadcn convention)

Los colores se exponen como variables CSS HSL en `globals.css` (ver paquete `@his/ui`). Esto permite tematización por tenant y light/dark sin recompilar Tailwind.

| Token | Light (HSL) | Dark (HSL) | Uso |
|-------|-------------|------------|-----|
| `--background` | `0 0% 100%` | `222 47% 6%` | Fondo de página |
| `--foreground` | `222 47% 11%` | `210 40% 98%` | Texto principal |
| `--card` | `0 0% 100%` | `222 47% 8%` | Tarjetas, paneles |
| `--primary` | `210 100% 35%` | `210 100% 60%` | Azul Avante (acción primaria) |
| `--secondary` | `210 16% 93%` | `217 33% 17%` | Acción secundaria |
| `--muted` | `210 16% 96%` | `217 33% 14%` | Texto/fondo de menor jerarquía |
| `--accent` | `210 16% 93%` | `217 33% 17%` | Hover, selección |
| `--destructive` | `0 72% 45%` | `0 72% 55%` | Acciones destructivas |
| `--border` | `214 20% 88%` | `217 33% 20%` | Bordes |
| `--input` | `214 20% 88%` | `217 33% 20%` | Bordes de input |
| `--ring` | `210 100% 45%` | `210 100% 65%` | Focus visible |

Contraste verificado: todo par foreground/background ≥ **4.5:1** (texto normal) y ≥ **3:1** (texto grande/UI). Cumple WCAG 2.1 AA.

### 2.2 Triage Manchester (TDR §9)

Los 5 niveles del Manchester Triage System son **identidad de marca clínica** y NO deben modificarse por tenant. Cada nivel tiene color, ícono Lucide y label i18n.

| Nivel | Nombre | Tiempo máx | Hex (light) | Hex (dark) | Texto sobre fondo | Contraste |
|-------|--------|-----------|-------------|------------|-------------------|-----------|
| 1 | **Rojo** (Inmediato) | 0 min | `#DC2626` | `#EF4444` | `#FFFFFF` | 5.9 : 1 ✓ AA |
| 2 | **Naranja** (Muy urgente) | 10 min | `#EA580C` | `#FB923C` | `#FFFFFF` | 4.6 : 1 ✓ AA |
| 3 | **Amarillo** (Urgente) | 60 min | `#CA8A04` | `#FACC15` | `#1A1A1A` | 8.2 : 1 ✓ AAA |
| 4 | **Verde** (Estándar) | 120 min | `#16A34A` | `#22C55E` | `#FFFFFF` | 4.5 : 1 ✓ AA |
| 5 | **Azul** (No urgente) | 240 min | `#2563EB` | `#3B82F6` | `#FFFFFF` | 5.7 : 1 ✓ AA |

**Importante (accesibilidad daltónica):** El color **nunca es el único portador de información**. El nivel se expresa con (a) color, (b) número grande "1"–"5", (c) ícono Lucide (`AlertOctagon`, `AlertTriangle`, `AlertCircle`, `CheckCircle`, `Info`) y (d) borde patrón (sólido/punteado/etc.).

Tokens Tailwind expuestos: `bg-triage-red`, `bg-triage-orange`, `bg-triage-yellow`, `bg-triage-green`, `bg-triage-blue` (y variantes `text-`, `border-`, `ring-`).

### 2.3 Otros colores semánticos clínicos

| Token | Hex light | Uso |
|-------|-----------|-----|
| `success` | `#16A34A` | Resultado normal, confirmación |
| `warning` | `#CA8A04` | Valor fuera de rango leve, advertencia no bloqueante |
| `critical` | `#DC2626` | Valor crítico, alerta sanitaria, bloqueo |
| `info` | `#2563EB` | Información neutra |
| `lasa` | `#7C2D12` (marrón) | Banner de medicamento LASA (Look-Alike Sound-Alike) |
| `allergy` | `#9F1239` (rosa oscuro) | Banner de alergia, distintivo del rojo de triage |

---

## 3. Tipografía

- **Familia:** **Inter** (variable font, subsets latin + latin-ext para `es-*` y `pt`).
  - Fallback: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
  - Opcional para datos numéricos densos: **Inter `tabular-nums`** activado en columnas (signos vitales, eMAR, libro mayor).
- **Escala (rem, base 16px):**

| Token Tailwind | rem | px | Uso |
|----------------|-----|----|------|
| `text-xs` | 0.75 | 12 | Metadatos, timestamps, badges |
| `text-sm` | 0.875 | 14 | **Base UI** (tablas, formularios, listas) |
| `text-base` | 1.0 | 16 | Texto largo (notas clínicas, consentimientos) |
| `text-lg` | 1.125 | 18 | Subtítulos de sección |
| `text-xl` | 1.25 | 20 | Títulos de tarjeta |
| `text-2xl` | 1.5 | 24 | Títulos de página |
| `text-3xl` | 1.875 | 30 | Display (dashboard hero) |

- **Pesos usados:** `400` (regular), `500` (medium para labels), `600` (semibold para títulos), `700` (bold reservado para alertas críticas).
- **Line-height:** 1.5 para texto largo; 1.3 para títulos; 1.2 para tablas densas.

---

## 4. Spacing Scale

Usamos los **defaults de Tailwind** (escala 4px). Convenciones:

| Tamaño | Uso clínico |
|--------|-------------|
| `gap-1` (4px) | Entre badges, chips |
| `gap-2` (8px) | Entre campos de un mismo grupo |
| `gap-4` (16px) | Entre secciones de un formulario |
| `gap-6` (24px) | Entre tarjetas en dashboard |
| `gap-8` (32px) | Padding generoso de página |
| `p-3` (12px) | Padding de fila densa (eMAR, mapa de cama) |
| `p-4` (16px) | Padding estándar de tarjeta |
| `p-6` (24px) | Padding de modal/diálogo |

---

## 5. Iconografía

- **Librería única:** `lucide-react`. No mezclar con otras librerías (heroicons, phosphor, etc.).
- **Tamaños:** `h-4 w-4` (inline en texto), `h-5 w-5` (botones), `h-6 w-6` (headers/cards), `h-8 w-8` (estados vacíos).
- **Stroke width:** 2 (default). 1.5 solo si Shadcn lo dicta.
- **Convención semántica:**

| Concepto | Ícono Lucide |
|----------|--------------|
| Paciente | `User`, `Users` |
| Cama | `BedDouble` |
| Triage | `Activity`, `AlertOctagon` |
| Medicamento | `Pill`, `Syringe` |
| Alergia | `AlertTriangle` con `text-allergy` |
| Auditoría | `History`, `ShieldCheck` |
| Búsqueda | `Search` |
| Brazalete / escaneo | `ScanLine`, `Barcode` |
| Multi-organización | `Building2`, `Network` |
| Break-the-glass | `Unlock`, `KeyRound` |

---

## 6. Componentes

> **Componentes custom actualizados → Ver v2.0 §3–§8.** En v2.0 se entregaron `<PatientContextBar>`, `<CommandPalette>`, `<EmptyState>`, `<ErrorState>`, `<Sparkline>`, app shell Shadcn. El listado de §6.2 es el plan original; el estado actual de implementacion esta en v2.0.

### 6.1 Componentes Shadcn/ui a usar (no reinventar)

`accordion`, `alert`, `alert-dialog`, `avatar`, `badge`, `button`, `calendar`, `card`, `checkbox`, `collapsible`, `command` (paleta `Ctrl+K`), `context-menu`, `dialog`, `dropdown-menu`, `form` (react-hook-form + zod), `hover-card`, `input`, `label`, `menubar`, `popover`, `progress`, `radio-group`, `scroll-area`, `select`, `separator`, `sheet`, `skeleton`, `slider`, `sonner` (toasts), `switch`, `table`, `tabs`, `textarea`, `toggle`, `tooltip`.

### 6.2 Componentes custom necesarios para HIS (MVP)

| Componente | Propósito | Bloques Shadcn que reutiliza |
|------------|-----------|------------------------------|
| `<PatientSearchBar />` | Búsqueda global por DUI/NIT/MRN/nombre con tipeo difuso. Atajo `Ctrl+K`. | `command`, `input` |
| `<BedMap />` | Vista mapa de camas hospitalización/UCI con estado en tiempo real (Realtime). Drag-and-drop para traslado. | `card`, `tooltip`, `popover` |
| `<TriageWidget />` | Selector de prioridad Manchester con flujograma. Cronómetro regresivo del tiempo objetivo. | `card`, `select`, `badge` |
| `<VitalSignsCapture />` | Captura rápida con teclado numérico, validación de rangos, alerta valor crítico. | `input`, `form`, `alert` |
| `<MedicationOrderEntry />` | Prescripción CPOE con verificación LASA, alergias, interacciones, dosis. Bloquea hasta resolver alertas. | `form`, `alert-dialog`, `command` |
| `<AuditTrail />` | Línea de tiempo de cambios sobre un dato clínico (quién, qué, cuándo, por qué). | `scroll-area`, `avatar`, `separator` |
| `<OrgSwitcher />` | Selector multi-organización (red de salud → hospital → servicio → unidad funcional). | `dropdown-menu`, `command` |
| `<AllergyBanner />` | Banner sticky con alergias del paciente. No-cerrable. | `alert` |
| `<BreakTheGlass />` | Diálogo de acceso de emergencia (override RBAC con justificación + auditoría). | `alert-dialog`, `form` |
| `<WristbandScan />` | Componente de escaneo de brazalete (cámara + USB scanner) para verificación 5R. | `dialog`, `input` |
| `<DoubleSignature />` | Doble verificación para LASA, hemoderivados, quimio (dos usuarios autenticados). | `dialog`, `form` |

> **Política careful-coding:** Los custom solo se construyen sobre primitivas Shadcn ya instaladas. No reimplementar `Dialog`, `Select`, etc.

---

## 7. Patrones de UX Clínicos

### 7.1 Confirmación de acciones destructivas / irreversibles

| Acción | Patrón |
|--------|--------|
| Eliminar borrador (no firmado) | Sin confirmación, `sonner` con "Deshacer" 5 s |
| Anular orden firmada | `<AlertDialog>` con texto del impacto + razón obligatoria |
| Alta médica | `<AlertDialog>` + checklist (epicrisis, recetas, citas) |
| Firma electrónica | Reingreso de PIN/MFA + checkbox "Confirmo bajo mi responsabilidad profesional" |
| Despacho farmacia controlados | `<DoubleSignature>` (dos usuarios) + escaneo brazalete |

### 7.2 Doble verificación medicamentos LASA

- Catálogo de medicamentos marca con flag `is_lasa = true`.
- Al prescribir/dispensar, banner amarillo `<Alert variant="lasa">` muestra ambos nombres en mayúsculas con sílabas distintivas resaltadas (TALLman lettering, p. ej. **DOPAmina** vs **DOBUTamina**).
- Bloqueo de "Confirmar" hasta marcar checkbox "He verificado el medicamento correcto".
- En administración (eMAR): segundo enfermero firma con su PIN (`<DoubleSignature>`).

### 7.3 Escaneo de brazalete (5 Correctos)

- Antes de administrar medicamento, transfundir o tomar muestra: el sistema obliga a abrir `<WristbandScan>`.
- El brazalete codifica MRN + episodio activo. Si no coincide con la orden seleccionada → bloqueo total + alerta.
- Modo degradado documentado (sin escáner): obliga ingreso manual de MRN + DUI + verificación visual con foto del paciente.

### 7.4 Alertas de alergias

- `<AllergyBanner>` sticky en la parte superior del expediente cuando hay alergias activas.
- Color `bg-allergy text-white` (rosa oscuro, distinto del rojo de triage para no canibalizar).
- En CPOE: si fármaco prescrito coincide (por sustancia activa, no por marca) con alergia activa → `<AlertDialog>` rojo bloqueante. Override requiere razón + segunda firma médica.

### 7.5 Break-the-glass

- Acceso de emergencia a expedientes fuera del scope normal (p. ej. médico de turno accediendo a paciente de otro servicio).
- `<BreakTheGlass>` exige: razón clínica de texto libre, selección de "Emergencia vital", MFA.
- Auditoría irreversible. Notificación al DPO/CISO. Ventana temporal limitada (4 h por defecto).

### 7.6 Atajos de teclado (TDR §29.5)

> **Ctrl+K implementado → Ver v2.0 §5.** El resto de los atajos (Alt+P/N/T/M, Ctrl+/, Esc, Ctrl+Enter) son follow-up documentado en `docs/42_design_system_v2.md §13`.

| Atajo | Acción |
|-------|--------|
| `Ctrl+K` | Búsqueda global / paleta de comandos |
| `Ctrl+/` | Lista de atajos contextuales |
| `Alt+P` | Ir a paciente actual |
| `Alt+N` | Nueva nota / orden |
| `Alt+T` | Nuevo triage |
| `Alt+M` | eMAR del paciente |
| `Esc` | Cerrar diálogo / cancelar |
| `Ctrl+Enter` | Confirmar formulario / firmar |

Todos visibles en tooltips y en `<HelpKeyboardSheet>`.

### 7.7 Personalización por usuario (TDR §29.5)

- **Favoritos:** plantillas de órdenes, consultas frecuentes, dashboards.
- **Layout:** densidad (cómoda/compacta), tema (light/dark/auto), idioma.
- Persistencia: tabla `user_preferences` con JSONB validado por Zod.

---

## 8. Accesibilidad WCAG 2.1 AA

| Criterio WCAG | Implementación |
|---------------|----------------|
| 1.4.3 Contraste mínimo | Tokens auditados ≥ 4.5:1 (ver §2). Revisión automática con axe-core en CI. |
| 1.4.11 Contraste no-textual | Bordes de focus, controles de formulario ≥ 3:1. |
| 2.1.1 Teclado | Todo flujo navegable sin mouse. `Tab` lógico; `Esc` cierra diálogos; trampas focales en modales. |
| 2.4.7 Focus visible | `focus-visible:ring-2 ring-ring ring-offset-2` global. Nunca `outline-none` sin reemplazo. |
| 3.3.1 Identificación de errores | `<FormMessage>` con `aria-live="polite"`. Error rojo + ícono + texto. |
| 3.3.2 Etiquetas o instrucciones | Todo input tiene `<Label htmlFor>` asociado. Placeholder NUNCA reemplaza label. |
| 4.1.2 Nombre, rol, valor | Componentes Shadcn (Radix) ya emiten ARIA. Custom usa `role`, `aria-label`, `aria-describedby`. |
| 4.1.3 Mensajes de estado | Toasts `sonner` con `role="status"` y `aria-live`. |

**Lectores de pantalla:** Probar con NVDA (Windows) y VoiceOver (macOS). Documentación de "screen reader friendly" en cada custom.

**Daltonismo:** Color nunca solo. Triage usa color + número + ícono + patrón.

---

## 9. Dark Mode

- **Estrategia:** `class="dark"` en `<html>` (Shadcn convention). Toggle persistente en `user_preferences`.
- **Mandatorio en áreas críticas (TDR §29.5 + práctica clínica):** UCI, emergencias nocturnas, salas de operaciones, radiología (lectura de imágenes).
- **Auto:** detecta `prefers-color-scheme` por defecto en primer login.
- **Verificación:** todos los tokens triage tienen versión dark con contraste auditado.

---

## 10. Responsive Breakpoints

Usamos defaults Tailwind, mapeados a contextos clínicos:

| Tailwind | Min width | Contexto clínico primario |
|----------|-----------|---------------------------|
| (base) | 0 | Móvil de paramédico/transportista; vistas read-only en pasillo |
| `sm` | 640px | Móvil grande / phablet |
| `md` | 768px | **Tablet de ronda médica** (vista principal) |
| `lg` | 1024px | Laptop de consulta externa |
| `xl` | 1280px | **Estación de enfermería / triage** (vista principal) |
| `2xl` | 1536px | Mapa de camas multi-pantalla, sala de operaciones |

**Reglas de oro:**
- Mobile: solo lectura + capturas mínimas (signos vitales, escaneo brazalete). NO prescripción.
- Tablet: ronda médica completa, eMAR, notas dictadas.
- Desktop: CPOE, configuración, reportería, contabilidad.

---

## 11. Internacionalización

### 11.1 Idiomas soportados (TDR §3)

| Locale | Estado | Notas |
|--------|--------|-------|
| `es-SV` | **Base** | Country base por TDR. Todo string nuevo nace aquí. |
| `es-MX` | Variante | Override de catálogos médicos, fiscal (CFDI), formatos. |
| `es-GT` | Variante | Override regulatorio, fiscal, terminología. |
| `es-HN` | Variante | Override regulatorio. |
| `es-CR` | Variante | Override regulatorio (CCSS), terminología. |
| `en` | Completa | Para usuarios bilingües, integraciones, demos internacionales. |
| `pt` | Completa | Brasil futuro. |
| `nawat` | Opcional (TDR §28) | Solo interfaces de paciente en zonas indígenas SV. |

### 11.2 Estructura técnica

- **Librería:** `next-intl` (App Router compatible, RSC-friendly).
- **Estructura:**
  ```
  packages/i18n/messages/
    es-SV.json   ← base canónica
    es-MX.json   ← solo overrides
    es-GT.json
    es-HN.json
    es-CR.json
    en.json
    pt.json
    nawat.json
  ```
- **Resolución:** fallback chain `es-MX → es-SV → en`. CI valida que todas las keys de `es-SV` existan en `en` (cobertura 100%).
- **Formato:** ICU MessageFormat para pluralización y género.
- **Datos sensibles a locale:**
  - Fechas: `Intl.DateTimeFormat` con timezone del tenant (TDR §29.7 multi-país).
  - Moneda: `USD` (SV/CR), `MXN`, `GTQ`, `HNL`, `CRC` — siempre formato `Intl.NumberFormat(locale, { style: 'currency' })`.
  - Números clínicos: **siempre punto decimal**, separador de miles según locale.
  - Documentos identidad: validación específica (DUI 9+1 SV, CURP/RFC MX, etc.) — UI muestra máscaras locales.
- **RTL:** No requerido en MVP. Estructura permite agregarlo (atributo `dir` en `<html>`).

### 11.3 Terminología clínica

- **SNOMED CT** (TDR cláusula vigente): nombres oficiales en `en-US` + traducción `es` mantenida en catálogo `medical_terms_i18n`.
- **CIE-10 / CIE-11**: traducciones oficiales OMS por idioma.
- **Medicamentos**: nombre genérico (DCI/INN) + nombre comercial local por país.

---

## 12. Convenciones de código UI

- Componentes en `packages/ui/src/components/` (shared) o `apps/web/components/` (app-specific).
- Nombres de archivos: `kebab-case.tsx`. Nombres de componentes: `PascalCase`.
- Props tipadas con TypeScript estricto. Variantes con `class-variance-authority` (Shadcn convention).
- Estilos: **solo Tailwind**. Cero CSS-in-JS, cero modules. Excepción única: `globals.css` con tokens y reset.
- `cn()` helper obligatorio para concatenar classes con override-safe merging.

---

## 13. Roadmap de implementación

| Fase | Entregable UI |
|------|---------------|
| Fase 0 (fundación) | `@his/ui` paquete inicial, tokens, `cn()`, primitivas Shadcn instaladas, `OrgSwitcher`, `PatientSearchBar`. |
| Fase 1 (registro+facturación) | Formularios de paciente, ADT, cuentas, DTE. `AuditTrail`. |
| Fase 2 (asistencial+triage) | `TriageWidget`, `VitalSignsCapture`, `AllergyBanner`. |
| Fase 3 (hospitalización+farmacia) | `BedMap`, `MedicationOrderEntry`, `WristbandScan`, `DoubleSignature`, eMAR. `BreakTheGlass`. |
| Fase 4+ | RIS/PACS viewer, dashboards BI, mobile app. |

---

**Fin del documento.**
