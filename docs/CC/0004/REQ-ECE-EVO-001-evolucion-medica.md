# REQ-ECE-EVO-001 — Reestructuración del formulario de Evolución Médica (SOAP)

**Proyecto:** HIS Multipaís · **Módulo:** ECE — Atención
**Ruta:** `/ece/evolucion/nueva` (Next.js App Router)
**Stack:** Next.js (App Router) · tRPC · Prisma · Supabase/PostgreSQL · Zod · Tailwind/shadcn
**Tipo:** Refactor de UI + ajuste de persistencia · **Prioridad:** Alta

---

## 1. Objetivo

Reorganizar la captura SOAP de la nueva evolución médica desde el actual **grid 2×2** (S/O · A/P) hacia un **flujo vertical (top‑down)** orientado a problemas, donde Subjetivo y Objetivo se capturan dentro de un **modal** lanzado desde un agrupador "Problemas", y el Objetivo incorpora una **toma de signos vitales**.

## 2. Estado actual

- Layout en cuadrícula 2×2: `Subjetivo (S)` y `Objetivo (O)` arriba; `Evaluación (A)` y `Plan (P)` abajo.
- Sin episodio seleccionado; `Ctrl+S` guarda borrador local.
- Acciones: `Cancelar` · `Guardar borrador`.

## 3. Layout objetivo

### Página principal (columna única, orden top‑down)
```
┌────────────────────────────────────────────┐
│ Nueva evolución médica                      │
│ Fecha de creación: 24/06/2026 14:30         │  ← RF-1
│ Episodio: … · Ctrl+S guarda borrador local  │
├────────────────────────────────────────────┤
│ PROBLEMAS                       [ Editar ▸ ] │  ← RF-3 (abre modal)
│ Resumen: S… / O… / signos: TA 120/80, FC 78 │     (preview al cerrar)
├────────────────────────────────────────────┤
│ ANÁLISIS (A)                                │  ← RF-5
│ [ textarea ]                                │
├────────────────────────────────────────────┤
│ PLAN (P)                                    │  ← RF-5
│ [ textarea ]                                │
├────────────────────────────────────────────┤
│               Cancelar   Guardar borrador   │
└────────────────────────────────────────────┘
```

### Modal "Problemas" (contiene S + O)
```
┌── Problemas ─────────────────────────── ✕ ┐
│ SUBJETIVO (S)                              │
│ [ textarea ]                               │
│                                            │
│ OBJETIVO (O)                               │
│ [ textarea ]                               │
│  ┌ Signos vitales ────────────────────────┐│  ← RF-4
│  │ TA  __/__   FC __   FR __   T° __       ││
│  │ SatO2 __    Peso __  Talla __  (IMC)    ││
│  └────────────────────────────────────────┘│
│                         Cancelar   Guardar │
└────────────────────────────────────────────┘
```

## 4. Requerimientos funcionales

| ID | Requerimiento |
|----|---------------|
| **RF-1** | Mostrar **fecha de creación** en el encabezado. Para una nota nueva = timestamp actual (read‑only), formato `es-SV` (`dd/MM/yyyy HH:mm`). Persistir como `createdAt` al guardar. |
| **RF-2** | Reemplazar el grid 2×2 por **una sola columna** con navegación de arriba hacia abajo. Layout responsive en columna única. |
| **RF-3** | Agregar un agrupador **"Problemas"** en la página principal. **No** muestra S/O en línea; al activarlo (botón/click) abre un **modal** que contiene los campos **Subjetivo (S)** y **Objetivo (O)**. Al cerrar, la tarjeta muestra un estado/resumen (completado + preview truncado). |
| **RF-4** | Dentro de **Objetivo** (en el modal) incluir una **toma de signos vitales**, reutilizando el módulo existente *Signos Vitales* (TA sistólica/diastólica, FC, FR, T°, SatO2, Peso, Talla; IMC calculado). Los signos capturados se asocian a la evolución y se registran en el historial de signos vitales del paciente. |
| **RF-5** | Orden final en la página principal (top‑down): **Encabezado/fecha → Problemas (modal) → Análisis (A) → Plan (P)** → acciones. |

## 5. Persistencia / modelo de datos

> Verificar y ajustar contra el schema Prisma existente; **no** duplicar tablas si ya existen.

- `EvolucionMedica`: `id`, `episodioId?`, `pacienteId`, `autorId`, `createdAt`, `subjetivo`, `objetivo`, `analisis`, `plan`, `estado` (`BORRADOR` | `FIRMADA`).
- **Signos vitales:** relación a `SignosVitales` (reutilizar modelo/tRPC del módulo existente). La captura del modal crea/asocia un registro de `SignosVitales` ligado a la evolución → aparece en la línea de tiempo de signos vitales.
- **Problemas (esta iteración):** S/O viven en el registro `EvolucionMedica`; **no** requiere tabla `Problema` separada todavía (ver §8 extensión futura).
- **Borrador local (`Ctrl+S`):** el estado serializado debe incluir el contenido del modal (S, O, signos) + análisis + plan.

## 6. Implementación sugerida

- **Componentes:**
  - `EvolucionForm` (página, columna única, encabezado con fecha, secciones Análisis/Plan, footer).
  - `ProblemasCard` (agrupador + preview + trigger).
  - `ProblemasModal` (Dialog del sistema de diseño) → contiene `SubjetivoField`, `ObjetivoField` y `SignosVitalesCapture`.
  - `SignosVitalesCapture` → **reutilizar** el componente/lógica del módulo *Signos Vitales* existente (no reimplementar).
- **Estado/validación:** un único objeto de formulario con `react-hook-form` + esquema **Zod** (consistente con el patrón del proyecto). El modal escribe en el mismo estado del formulario; al cerrar no se pierde lo capturado.
- **tRPC:** `evolucion.saveDraft` / `evolucion.create`; `signosVitales.create` (o el procedure existente) invocado al persistir.
- **Conservar:** atajo `Ctrl+S` (borrador local), selector de episodio y acciones `Cancelar` / `Guardar borrador`.

## 7. Criterios de aceptación

- **AC-1** La página renderiza una sola columna; no existe el grid 2×2.
- **AC-2** La fecha de creación es visible (formato `es-SV`) y se persiste en `createdAt` al guardar.
- **AC-3** El agrupador "Problemas" aparece en la página principal y **no** muestra S/O en línea.
- **AC-4** Al activar "Problemas" se abre un modal con los campos S y O.
- **AC-5** El Objetivo del modal incluye captura de signos vitales; los valores ingresados se guardan y quedan ligados a la evolución/paciente.
- **AC-6** Al cerrar el modal se conserva lo ingresado (S/O/signos) y la tarjeta muestra estado completado + preview.
- **AC-7** El orden de la página principal es Problemas → Análisis → Plan.
- **AC-8** `Ctrl+S` guarda un borrador local que incluye el contenido del modal + análisis + plan.
- **AC-9** `Cancelar` descarta cambios; `Guardar borrador` persiste.

## 8. Fuera de alcance (esta iteración)

- Flujo de firma/cierre de la nota (si no existe ya).
- Codificación CIE‑10 de problemas.
- Lista de problemas múltiples con SOAP por problema (POMR completo).
- Cambios en la lógica de selección de episodio.

## 9. Supuestos y decisiones

- **"Problemas" = contenedor de S + O en esta iteración** (lectura literal del requerimiento). El nombre se elige pensando en evolucionar hacia un **registro orientado a problemas**: a futuro `Problema[]` con descripción, código CIE‑10 y su propio S/O. *(Si la intención es ya una lista de problemas, ajustar §4 RF‑3 y §5.)*
- "Análisis" mapea al campo **Evaluación (A)** del SOAP actual.
- La captura de signos vitales **reutiliza** el módulo *Signos Vitales* existente (no se crea uno nuevo).
- Modal implementado con el componente Dialog del sistema de diseño actual.
- Formato de fecha y locale: `es-SV`.
