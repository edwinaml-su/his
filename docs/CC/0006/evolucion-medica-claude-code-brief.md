# Brief de implementación — Pantalla "Nueva Evolución Médica" (SOAP)
**Proyecto:** HIS Multipaís · Complejo Avante
**Ruta lógica:** ECE › Evolución Médica › Nueva
**Fuente de verdad visual e interactiva:** `evolucion-medica-avante.html` (mockup autocontenido ya aprobado)
**Destino:** Claude Code

> Este documento es la especificación funcional y técnica para construir la pantalla en el repo real. El mockup HTML define el aspecto, el diseño y el comportamiento exacto; este brief define la arquitectura, el modelo de datos, los flujos y los criterios de aceptación. Ante cualquier diferencia de estilo, **prevalece el mockup y el HIS Design System v2.0**.

---

## 1. Objetivo

Construir la pantalla de captura de una **evolución médica** con estructura **SOAP** ampliada:

- **Problemas** — lista editable con **agrupación opcional** (problema padre → sub-problemas).
- **Subjetivo (S)**, **Objetivo (O)**, **Evaluación/Análisis (A)** — texto libre.
- **Signos vitales** — parte del objetivo, con **alertas críticas automáticas**.
- **Plan (P)** — grid de indicaciones que se agregan una a una.

**Todo ingreso de texto se realiza en modal.** Las secciones de la página son **tarjetas-resumen** (muestran lo capturado o un estado vacío con botón para abrir su modal).

La evolución se liga al **expediente permanente** del paciente (identidad por DUI/DNI/PASAPORTE/DUI_RESP). Al **firmar**, la evolución es **inmutable**.

---

## 2. Supuestos de stack (ajusta si difiere del repo)

- Next.js (App Router) + React + TypeScript.
- Tailwind CSS + HIS Design System v2.0 (tokens, colores de marca, componentes existentes).
- Estado de UI con un store ligero (Zustand) **o** `useReducer` + Context. **Requisito:** una única fuente de verdad para el borrador, porque varios modales mutan estado compartido.
- Persistencia: Supabase (Postgres + RLS).
- **No usar `localStorage`** para el dato clínico: el borrador se autoguarda en Supabase (el mockup usa memoria solo por ser demo).

Si el repo ya define convenciones (estructura de carpetas, wrappers de modal, cliente Supabase, design tokens), **respétalas por encima de las sugerencias de este brief**.

---

## 3. Modelo de datos

```ts
// lib/evolucion/types.ts
type DocId = string; // uuid

export interface Problema {
  id: DocId;
  texto: string;
  parentId: DocId | null; // null = raíz; si apunta a otro Problema => es sub-problema (hijo)
  orden: number;
}

export interface IndicacionPlan {
  id: DocId;
  texto: string;
  orden: number;
}

export interface SignosVitales {
  taSistolica?: number;          // mmHg
  taDiastolica?: number;         // mmHg
  frecuenciaCardiaca?: number;   // lpm
  frecuenciaRespiratoria?: number; // rpm
  temperatura?: number;          // °C
  spo2?: number;                 // %
  dolorEva: number;              // 0–10 (default 0)
}

export type EstadoEvolucion = 'BORRADOR' | 'FIRMADA';

export interface EvolucionMedica {
  id: DocId;
  expedienteId: DocId;     // FK al expediente permanente
  episodioId?: DocId;
  problemas: Problema[];
  subjetivo: string;       // S
  objetivo: string;        // O
  signosVitales: SignosVitales; // forma parte del objetivo
  analisis: string;        // A (evaluación)
  plan: IndicacionPlan[];  // P
  estado: EstadoEvolucion;
  creadoPor: DocId;
  creadoEn: string;        // ISO
  firmadoPor?: DocId;
  firmadoEn?: string;
}
```

**Restricción de jerarquía de problemas:** un solo nivel. Un sub-problema (con `parentId` no nulo) **no puede** tener hijos. El "problema padre" es a su vez un `Problema` con `parentId === null` que tiene al menos un hijo apuntándolo.

**Numeración (solo presentación):** raíces 1, 2, 3…; hijos `n.1`, `n.2`… El contador del encabezado cuenta **todos** los problemas (padres + hijos + sueltos).

---

## 4. Arquitectura de componentes (sugerida)

```text
app/(ece)/evolucion-medica/nueva/page.tsx        -> carga datos + monta el formulario
components/evolucion/
  EvolucionMedicaForm.tsx        // orquestador: estado global + footer (Cancelar/Borrador/Firmar)
  ProblemasSection.tsx           // árbol + selección múltiple + agrupación
  ProblemaTree.tsx               // render padres/hijos/sueltos con numeración y conectores
  SeccionTextoResumen.tsx        // genérica para S y A: resumen o estado vacío
  ObjetivoSection.tsx            // resumen del objetivo (gatilla flujo con vitales)
  SignosVitalesSection.tsx       // resumen: chips + alertas
  PlanSection.tsx                // grid de indicaciones
components/evolucion/modals/
  Modal.tsx                      // shell genérico accesible (overlay, head, body, foot)
  ProblemaModal.tsx
  GrupoModal.tsx                 // nombrar el problema padre
  SubjetivoModal.tsx
  ObjetivoModal.tsx
  SignosVitalesModal.tsx
  AnalisisModal.tsx
  IndicacionPlanModal.tsx
hooks/
  useEvolucionStore.ts           // Zustand (estado del borrador + acciones)
  useModalController.ts          // qué modal está abierto + encadenamiento
lib/evolucion/
  types.ts
  signos-vitales.ts              // umbrales, validación, escala EVA, alertas
  api.ts                         // persistencia Supabase (cargar/autoguardar/firmar)
```

**Controlador de modales:** modelar el modal abierto como un estado discreto, p. ej.:

```ts
type ModalActivo =
  | { tipo: 'none' }
  | { tipo: 'problema'; problemaId?: DocId }
  | { tipo: 'grupo' }
  | { tipo: 'subjetivo' }
  | { tipo: 'objetivo' }
  | { tipo: 'vitales'; alGuardar?: () => void } // callback para encadenar al objetivo
  | { tipo: 'analisis' }
  | { tipo: 'plan'; indicacionId?: DocId };
```

---

## 5. Flujos de interacción (detallados)

### 5.1 Problemas
- **Agregar:** botón "Agregar problema" (encabezado) → `ProblemaModal` (textarea) → al guardar, push como raíz (`parentId: null`).
- **Editar:** ícono lápiz en cualquier fila (padre, hijo o suelto) → `ProblemaModal` con el texto cargado.
- **Eliminar:** ícono basurero → confirmación. Si es **padre**, sus hijos pasan a raíz (`parentId = null`), no se borran.
- **Agrupar (opcional):**
  1. Cada problema raíz/hijo tiene **checkbox**. Al marcar **2 o más** aparece la barra de selección.
  2. Botón "Agrupar como problema padre" → `GrupoModal` (input para el nombre del padre).
  3. Al confirmar: crear un `Problema` padre (raíz) e insertarlo en la posición del primer seleccionado; asignar `parentId = padre.id` a los seleccionados.
  4. Los hijos conservan checkbox (se pueden re-agrupar en otro padre).
- **Desagrupar:** ícono en el padre → los hijos vuelven a raíz; el padre queda como problema suelto.
- `Esc` limpia la selección si no hay modal abierto.

### 5.2 Subjetivo y Análisis
- Tarjeta-resumen: muestra el texto guardado (con botón "Editar") o "Sin registrar" + botón "Llenar".
- Modal con `textarea`; al guardar, persiste el texto y actualiza el resumen.

### 5.3 Objetivo ⇄ Signos vitales (flujo clave)

Los signos vitales son parte del objetivo. **"Signos vitales registrados"** = existe al menos un campo numérico **o** `dolorEva > 0`.

Al pulsar "Llenar/Editar objetivo":

```text
¿Signos vitales registrados?
  NO  → abrir SignosVitalesModal en modo "flujo objetivo"
          • al Guardar signos  → encadenar y abrir ObjetivoModal (continuar)
          • al Cancelar         → cerrar (no abrir objetivo)
  SÍ  → abrir ObjetivoModal directamente
          ObjetivoModal contiene:
            • franja superior con chips de los signos vitales
            • botón "Modificar signos vitales"
                → guarda el borrador del textarea de objetivo
                → abre SignosVitalesModal
                → al Guardar/Cancelar regresa a ObjetivoModal con el borrador restaurado
            • textarea Objetivo
            • botón primario "Guardar objetivo" (continuar)
```

**Importante:** preservar el borrador del objetivo durante el viaje de ida/vuelta a signos vitales (no perder lo ya escrito). En el mockup se hace con una variable temporal (`objTmp`); en el repo, mantenerlo en el store del borrador o en estado local del modal.

### 5.4 Signos vitales (modal)
- Campos: TA sistólica, TA diastólica, FC, FR, Temperatura, SpO₂, y **dolor EVA** (slider 0–10 con etiqueta dinámica).
- Fila superior de **alertas críticas** que se recalcula en vivo al teclear.
- Validación de rango por campo (resalta en rojo fuera de rango).

### 5.5 Plan (grid uno a uno)
- Botón "Agregar al plan" → `IndicacionPlanModal` (textarea) → push de `IndicacionPlan` numerada.
- Cada fila del grid: número + texto + editar/eliminar.
- Sin agrupación (a diferencia de Problemas).

---

## 6. Reglas de signos vitales (reproducir exactamente)

### 6.1 Rangos de entrada válidos y alertas críticas

| Signo            | Rango válido (input) | Condición de alerta crítica         | Etiqueta              |
|------------------|----------------------|-------------------------------------|-----------------------|
| TA sistólica     | 60–260 mmHg          | ≥ 180 (o diastólica ≥ 110)          | Crisis hipertensiva   |
| TA sistólica     | —                    | < 90                                | Hipotensión           |
| TA diastólica    | 40–160 mmHg          | ≥ 110 (junto con sistólica)         | Crisis hipertensiva   |
| Frecuencia card. | 30–220 lpm           | > 120 / < 50                        | Taquicardia / Bradicardia |
| Frecuencia resp. | 4–60 rpm             | > 24 / < 10                         | Taquipnea / Bradipnea |
| Temperatura      | 30–43 °C             | ≥ 39.5 / ≤ 35                       | Fiebre alta / Hipotermia |
| SpO₂             | 50–100 %             | < 90                                | SpO₂ baja             |
| Dolor (EVA)      | 0–10                 | ≥ 7                                 | Dolor intenso         |

> Los umbrales son **límites de disparo de alerta**, no consejo clínico. Centralizarlos en `lib/evolucion/signos-vitales.ts` para poder ajustarlos/tropicalizarlos sin tocar la UI.

### 6.2 Escala EVA (etiqueta del slider)

| Valor | Etiqueta        |
|-------|-----------------|
| 0     | Sin dolor       |
| 1–3   | Dolor leve      |
| 4–6   | Dolor moderado  |
| 7–9   | Dolor intenso   |
| 10    | Dolor máximo    |

---

## 7. Reglas de habilitación y footer

- **Guardar borrador:** siempre disponible. Autoguardado con *debounce* (~1.5 s) tras cada cambio, además del botón explícito y `Ctrl+S`.
- **Firmar:** habilitado solo cuando hay **≥ 1 problema**, **análisis no vacío** y **≥ 1 indicación de plan**. (S y O quedan opcionales para firmar; confirmar si la política clínica exige también O.)
- **Cancelar:** confirma descarte de cambios no guardados.

---

## 8. Comportamiento UI / accesibilidad

- Modal genérico accesible: `role="dialog"`, `aria-modal`, foco inicial en el primer campo, **trap de foco**, cerrar con `Esc` y con click en el backdrop, devolver el foco al disparador al cerrar.
- Validación: cada modal impide guardar vacío (resalta el campo y muestra *toast* de advertencia).
- *Toasts* de confirmación por acción.
- Atajos: `Ctrl/Cmd+S` (guardar borrador), `Ctrl/Cmd+K` (buscar). `Esc` cierra modal o limpia selección.
- Responsive (sidebar colapsable < 1080px; grid de vitales a 1 columna < 640px).
- Soporte de tema claro/oscuro vía tokens.
- Color por sección: Problemas azul · S índigo · O teal · Vitales rosa · A ámbar · Plan slate.

---

## 9. Persistencia (Supabase) — sugerido, alinear con el esquema del expediente

Dos opciones; elegir según convenciones del repo:

**A) Normalizada (recomendada para reporting):**
- `evoluciones_medicas` (id, expediente_id, episodio_id, subjetivo, objetivo, analisis, signos_vitales JSONB, estado, creado_por, creado_en, firmado_por, firmado_en)
- `evolucion_problemas` (id, evolucion_id, texto, parent_id, orden)
- `evolucion_plan` (id, evolucion_id, texto, orden)

**B) Documental:** `evoluciones_medicas` con `problemas` y `plan` como `JSONB`. Más simple; menos consultable.

**Inmutabilidad al firmar:**
- RLS + trigger que **bloquee UPDATE/DELETE** cuando `estado = 'FIRMADA'`.
- `firmado_por` y `firmado_en` se setean en la transición a FIRMADA.
- La evolución queda permanentemente ligada al `expediente_id`.

---

## 10. Criterios de aceptación (checklist)

- [ ] Todo ingreso de texto (problema, S, O, A, indicación, nombre de grupo) ocurre **en modal**; no hay inputs inline de captura en la página.
- [ ] Problemas: agregar/editar/eliminar; eliminar un padre **no** borra a sus hijos (pasan a raíz).
- [ ] Agrupación: seleccionar 2+ → nombrar padre → quedan anidados con numeración `n.m`; desagrupar funciona.
- [ ] Objetivo con vitales vacíos → abre **primero** el modal de signos vitales y, al guardar, **continúa** al objetivo.
- [ ] Objetivo con vitales llenos → modal con botón **"Modificar signos vitales"** + textarea + **"Guardar/Continuar objetivo"**; el borrador del objetivo se conserva al ir y volver de vitales.
- [ ] Signos vitales: alertas críticas en vivo según la tabla §6.1 y validación de rangos; EVA con etiquetas §6.2.
- [ ] Plan: grid que agrega indicaciones **una a una**, con editar/eliminar y numeración.
- [ ] Firmar habilitado solo con problema(s) + análisis + plan; firmar deja la evolución **inmutable**.
- [ ] Autoguardado de borrador en Supabase (sin `localStorage`).
- [ ] Accesibilidad de modales (foco, `Esc`, backdrop, `aria`).
- [ ] Coincide con el HIS Design System v2.0 y con el mockup.

---

## 11. Prompt de arranque para Claude Code

> Pega esto en Claude Code teniendo este `.md` y el archivo `evolucion-medica-avante.html` en el contexto/repo:

```
Implementa la pantalla "Nueva Evolución Médica" siguiendo el brief en
docs/evolucion-medica-claude-code-brief.md y usando evolucion-medica-avante.html
como fuente de verdad visual e interactiva.

Reglas:
- Respeta las convenciones del repo y el HIS Design System v2.0 por encima de las
  sugerencias del brief.
- Todo ingreso de texto va en modal; las secciones son tarjetas-resumen.
- Implementa el flujo Objetivo⇄Signos vitales (§5.3) y la agrupación de problemas (§5.1)
  exactamente como se describen.
- Centraliza umbrales y validación de signos vitales en lib/evolucion/signos-vitales.ts (§6).
- Persiste en Supabase con autoguardado de borrador e inmutabilidad al firmar (§9). No uses localStorage.

Plan de trabajo:
1) Tipos y store del borrador (única fuente de verdad).
2) Modal genérico accesible + controlador de modales.
3) Secciones-resumen + sus modales.
4) Lógica de signos vitales (alertas/validación/EVA) con pruebas unitarias de los umbrales.
5) Persistencia (cargar/autoguardar/firmar) + RLS de inmutabilidad.
6) Verifica contra los criterios de aceptación (§10).

Antes de programar, propón el árbol de archivos y los tipos, y espera mi confirmación.
```

---

### Notas
- Si usas la integración de **Claude Design**, puedes sincronizar el mockup como base; si no, este brief + el HTML son suficientes.
- Mantén los umbrales clínicos parametrizables para la tropicalización por país (SV/otros) sin tocar componentes.
