# ESPECIFICACIÓN DEL MOCKUP — Evolución Médica (nota SOAP)
## Definición exacta para reproducir el prototipo con Claude Code
**Producto:** HIS Multipaís · Complejo Avante (El Salvador) · Módulo ECE
**Entregable de referencia:** `evolucion-medica-avante.html` (archivo único autocontenido)
**Idioma de la UI:** español (es-SV)
**Objetivo de este documento:** describir de forma **exacta** la navegabilidad, la funcionalidad, el comportamiento y los **colores** del mockup, para que Claude Code lo reproduzca de forma fidedigna.

> Regla de oro: el archivo `evolucion-medica-avante.html` es la **fuente de verdad** visual y de comportamiento. Este documento lo formaliza; ante cualquier duda, manda el archivo. **No** simplificar ni omitir comportamientos.

---

## 1. Formato de salida

- **Un solo archivo HTML autocontenido** (HTML + CSS + JS en el mismo archivo). Sin dependencias externas salvo la tipografía **Inter** (Google Fonts); si no carga, debe degradar a `system-ui/sans-serif` sin romper el layout.
- **JavaScript vanilla** (sin frameworks). **Estado en memoria** (variables JS); **prohibido** `localStorage`/`sessionStorage`.
- Debe soportar **tema claro (por defecto) y tema oscuro** mediante `[data-theme="dark"]` con los tokens de §2.
- La pantalla se diseña para **embeberse** luego en el shell real del HIS: **sin** sidebar ni topbar propios.

---

## 2. Tokens de color (EXACTOS — copiar verbatim)

Definir en `:root` (claro) y `[data-theme="dark"]` (oscuro). Estos valores son obligatorios.

### 2.1 Tema claro (`:root`)
```css
--avante-green:#00a14b;
--bg-app:#eef2f7; --bg-surface:#ffffff; --bg-subtle:#f8fafc; --bg-rail:#0f172a; --bg-topbar:#ffffff;
--rail-hover:#1c2942; --rail-active:#0d3d3a; --rail-active-bd:#14b8a6;
--text-strong:#0f172a; --text-base:#1e293b; --text-muted:#64748b; --text-faint:#94a3b8;
--on-dark:#cbd5e1; --on-dark-muted:#7c8aa5; --on-dark-head:#64748b;
--border:#e5e9f0; --border-strong:#cbd5e1;
--blue:#3b82f6; --blue-soft:#eff6ff; --blue-bd:#bfdbfe; --blue-sel:#dbeafe;
--indigo:#6366f1; --teal:#0d9488; --rose:#e11d48;
--amber:#f59e0b; --amber-soft:#fffbeb; --amber-bd:#fde68a;
--green:#16a34a; --green-soft:#dcfce7; --green-bd:#bbf7d0;
--purple-soft:#faf5ff; --purple-bd:#e9d5ff; --gray-soft:#f1f5f9; --gray-bd:#cbd5e1;
--red:#dc2626; --red-soft:#fee2e2; --red-bd:#fecaca;
--warn:#b45309; --warn-soft:#fef3c7; --warn-bd:#fde68a;
--slate-btn:#1e293b; --slate-btn-h:#0f172a;
--r:14px; --r-sm:10px;
--sh-card:0 1px 2px rgba(15,23,42,.04),0 2px 8px rgba(15,23,42,.05);
--sh-pop:0 24px 60px -18px rgba(15,23,42,.45);
--rail-w:236px;
--app-header-h:0px; --px-sticky-z:30;
```

### 2.2 Tema oscuro (`[data-theme="dark"]`)
```css
--bg-app:#0a1120; --bg-surface:#0f1a2e; --bg-subtle:#0c1525; --bg-topbar:#0c1424;
--text-strong:#f1f5f9; --text-base:#dbe3ef; --text-muted:#93a3bb; --text-faint:#64748b;
--border:#1d2942; --border-strong:#2a3a57;
--blue-soft:#0f1f3a; --blue-bd:#23406e; --blue-sel:#15294a;
--amber-soft:#241c08; --amber-bd:#4a3a13;
--green-soft:#0e2a1c; --green-bd:#1e4d36;
--purple-soft:#1e1633; --purple-bd:#3b2d63; --gray-soft:#131d31; --gray-bd:#2a3a57;
--red-soft:#2a1314; --red-bd:#5a2326;
--warn-soft:#2a200a; --warn-bd:#4a3a13;
--slate-btn:#1e293b; --slate-btn-h:#334155;
--sh-card:0 1px 2px rgba(0,0,0,.3);
```

### 2.3 Colores fijos usados en lógica (no tokens, hex literales)
Empleados en clasificaciones clínicas (texto coloreado por categoría):
- Verde clínico `#16a34a` · Verde-lima `#65a30d` · Naranja `#ea580c` · Rojo `#dc2626` · Rojo intenso `#b91c1c` · Azul `#2563eb`.
- Lila de nombre de pila: texto `#7e22ce`, fondo `#faf5ff`, borde `#e9d5ff`, foco `#9333ea`.
- Sello "registrado por" / hint de éxito: texto/icono `#15803d` sobre `var(--green-soft)`/`var(--green-bd)`.

---

## 3. Tipografía y primitivas de UI

- **Fuente:** Inter (pesos 400/600/700/800).
- **Tarjeta** (`.card`): fondo `var(--bg-surface)`, borde `1px var(--border)`, radio `var(--r)` (14px), sombra `var(--sh-card)`. Encabezado `.card__head` (badge + título + subtítulo + acciones) y cuerpo `.card__body` (padding 0; el padding lo aportan los contenidos).
- **Badge de tarjeta** (cuadro con letra/ícono): cuadrado redondeado por sección (ver §6 colores).
- **Botones** (`.btn`): variantes `--primary` (oscuro `var(--slate-btn)`), `--text` (texto plano), `--ghost` (fondo `var(--bg-surface)` + borde `var(--border-strong)`), `--blue`, `--indigo`, `--teal`, `--rose`, `--amber`, `--green`. Tamaño `.btn-sm`. Íconos SVG `stroke="currentColor"`.
- **Píldoras:** `.req-pill` (Obligatorio, rojo) y `.opt-tag` (Opcional, atenuada).
- **Chips de conteo:** `.count-chip` (p. ej. `.count-slate`).
- **Modales:** overlay `#overlay` con clase `.open`; estructura `#mTitle` (título), `#mDesc` (subtítulo), `#mBody` (cuerpo, `max-height:64vh; overflow-y:auto`), `#mFoot` (pie). Sombra `var(--sh-pop)`.
- **Toasts:** `toast(msg, tipo)` con tipos `ok` (defecto), `warn`. Aparecen abajo, transitorios.

---

## 4. Layout general y navegabilidad

Estructura vertical, una sola columna de contenido centrada (max-width **1080px**):

1. **Breadcrumbs:** `🏠 › ECE › Evolución Médica`.
2. **Título de pantalla:** `Evolución médica` + línea meta: `Fecha de creación: {fecha}, {hora} · [Ctrl+S] guarda ahora.` + indicador `● Borrador guardado localmente {HH:MM:SS}`.
3. **Encabezado del paciente STICKY** (`.px-header.px-sticky`): `position:sticky; top:var(--app-header-h,0px); z-index:var(--px-sticky-z,30)`. Aislado (esta pantalla) `--app-header-h:0px`; al integrar en el HIS, fijarlo a la altura del header real para que el sticky quede **debajo** de él. Detalle en §5.
4. **Tarjetas de sección** en este orden exacto:
   1. Especialidad médica
   2. Problemas
   3. Subjetivo
   4. Objetivo (contiene Signos vitales + Registro de objetivo + Antecedentes)
   5. Evaluación / Análisis
   6. Plan (contiene Plan de manejo + Misceláneos de consulta)
   7. Firma del médico
5. **Pie fijo** (`.foot`): ancho completo (`left:0; right:0`), con: botón **Cancelar** · sugerencia de pendientes `Falta: {lista}` · **Guardar borrador** · **Guardar y firmar** (deshabilitado mientras haya pendientes, ver §11).

**Comportamientos transversales (§14):** autoguardado cada 30 s; `Ctrl/Cmd+S` guarda borrador; `Esc` cierra el modal abierto.

---

## 5. Encabezado del paciente (lectura; emergencia editable)

Datos provienen de la cuenta/expediente activos (en el mockup, de los pacientes de muestra §13). **Solo lectura** salvo el contacto de emergencia.

**Estructura y campos**
- **Nombre** `#pxName` — **fuente 34px**, peso 800, **en MAYÚSCULA** (vía `text-transform:uppercase`). En móvil (≤640px) baja a 18px.
- **Badges:** `Expediente {#pxExp}` y `Cuenta Hosp. {#pxCuenta}` (etiqueta atenuada + valor en negrita). Valores en mayúscula.
- **Línea demográfica:** `Edad {#pxAge}` · `DUI {#pxDui}` · `Sexo {#pxSex}` · `F. Nac. {#pxNac}` · `Tipo de cuenta {#pxTipo}` (separadores `·`). 
- **Domicilio:** `{#pxDom}`.
- **En caso de emergencia llamar a:** `{#pxEmerg}` + botón **Editar** (ícono lápiz, `onclick=openEmerg()`).
- **Banner de alergias** `#pxAllergy` (ver §5.1).
- **Nota de nombre de pila** `#pxPref` (ver §5.2), oculta si no aplica.

**Mayúsculas (requisito):** los **valores de datos** se muestran en mayúscula: `#pxName, #pxExp, #pxCuenta, #pxAge, #pxDui, #pxSex, #pxNac, #pxTipo, #pxDom, #pxEmerg`. Las **etiquetas** (“Edad”, “DUI”, “Sexo”, “F. Nac.”, “Tipo de cuenta”, “Domicilio”, “En caso de emergencia llamar a:”) se mantienen en su caso normal. El dato subyacente no se altera; solo su presentación.

**Iconografía de sexo:** ♀ (Venus) en rosa `#ec4899` para F; ♂ (Marte) en navy `#1e3a8a` para M, anteponiendo el símbolo al texto (“FEMENINO”/“MASCULINO”).

### 5.1 Banner de alergias `#pxAllergy`
Renderizado por `renderAllergyBanner()` según las alergias del paciente:
- **Sin alergias** → clase `px-allergy ok`, color `var(--green)`, ícono de **check en círculo**, texto **`NINGUNA ALERGIA CONOCIDA`**.
- **Con alergias** → clase `px-allergy danger`, color `var(--red)` (`#dc2626`) sobre fondo `var(--red-soft)` (`#fee2e2`), **ícono de cacahuate (maní)** como símbolo de alérgeno, texto **`ALERGIAS: {lista}`**.
- El ícono de cacahuate es un SVG de vaina vertical con cintura central y dos crestas (trazo `currentColor`). Tamaño 16px.
- La fuente de la lista de alergias es el antecedente **Alergias** (§9): al editarlo, debe **sincronizar** el banner en vivo (`syncAlergias`).

### 5.2 Nota de nombre de pila `#pxPref`
Cuando el paciente tiene nombre de pila / pertenece a la comunidad LGBTIQ+: barra **lila** (texto/acento `#9333ea` sobre fondo `#faf5ff`), con ícono y texto: `Nombre de pila: {pila} — {nota}` (p. ej. “…— Persona de la comunidad LGBTIQ+ — diríjase al paciente por su nombre de pila.”). Permanente mientras aplique.

### 5.3 Modal “Editar contacto de emergencia” (`openEmerg`)
Tres campos editables: **Nombre**, **Parentesco**, **Teléfono**. Al guardar (`saveEmerg`), reconstruye el texto del contacto (`buildEmerg` → formato `NOMBRE (PARENTESCO) — TELÉFONO`) y actualiza `#pxEmerg`.

---

## 6. Tarjetas de sección — colores de encabezado y badges

Cada tarjeta tiene un **badge** de color y un **encabezado** que puede ir **tintado** (modificador de tarjeta):

| Sección | Badge (cuadro) | Encabezado tintado (`.card__head`) | Borde tarjeta |
|---|---|---|---|
| Especialidad médica | verde `--avante-green` (`#00a14b`) | — (blanco) | normal |
| Problemas | azul (`P`) | `--blue-soft` (`#eff6ff`) | `--blue-bd` |
| **Subjetivo** | índigo (`S`) | **`--purple-soft` (`#faf5ff`)** | **`--purple-bd`** |
| **Objetivo** | teal (`O`) | **`--green-soft` (`#dcfce7`)** | **`--green-bd`** |
| **Evaluación / Análisis** | ámbar (`A`) | `--amber-soft` (`#fffbeb`) | `--amber-bd` |
| **Plan** | slate/oscuro (`P`) | **`--gray-soft` (`#f1f5f9`)** | **`--gray-bd`** |
| Firma del médico | azul | — | normal |

**Títulos de sub-área** (sub-bloques: Signos vitales, Registro de objetivo, Antecedentes, Plan de manejo, Misceláneos de consulta): **texto e ícono en teal** (`var(--teal)` `#0d9488`), 12.5px, peso 800, mayúsculas.

---

## 7. Sección: Especialidad médica

- Subtítulo: “Especialidad responsable de esta evolución.”
- **Autocompletado** `#espInput` (placeholder “Escriba para buscar (p. ej. Medicina Interna)…”) sobre el catálogo **ESPECIALIDADES** (§13.2, 34 opciones). Al elegir, queda fijada. Obligatoria (entra al gating §11).

---

## 8. Sección: Problemas

- Subtítulo: “Lista de problemas. Marca dos o más para agruparlos bajo un **Diagnóstico Sindrómico** (opcional).”
- Botón **Agregar problema** (abre modal con textarea “Describa el problema…”). Cada problema es `{id, text, parentId}`.
- **Lista de problemas:** cada fila (`.prob-row`) con **checkbox** de selección, número, texto y acciones (editar `openProb(id)` / eliminar `delProb(id)`).
- **Fondo de las filas: BLANCO** (`var(--bg-surface)`), incluso seleccionadas. La selección se indica con el **checkbox** (azul al marcar), no con relleno de fila. Los **padres (Diagnóstico Sindrómico)** llevan un **acento azul a la izquierda** (`box-shadow:inset 3px 0 0 var(--blue-bd)`) además del ícono de carpeta.
- **Barra de selección** (`.sel-bar`, visible con ≥1 seleccionado): `{N} seleccionados` · botón **Agrupar como Diagnóstico Sindrómico** · **Limpiar**.
- **Agrupar:** al pulsar “Agrupar como Diagnóstico Sindrómico”, abre modal **“Nuevo Diagnóstico Sindrómico”** (label “Nombre del Diagnóstico Sindrómico”); crea un nodo **padre** (`tipo` sindrómico) y reasigna los seleccionados como hijos (`parentId`). En la lista, el padre muestra un chip **“Diagnóstico Sindrómico · {n}”** y sus hijos se indentan con conectores.
- **Desagrupar / eliminar** padre: confirma (“¿Desagrupar este Diagnóstico Sindrómico?” / “¿Eliminar el Diagnóstico Sindrómico …?”). 
- **Terminología obligatoria:** en TODA la UI debe decir **“Diagnóstico Sindrómico”** (nunca “problema sindrómico”).
- Obligatorio: ≥1 problema (gating §11).

---

## 9. Campos de texto SOAP: estado vacío como cuadro clickeable

Aplica a **Subjetivo**, **Registro de objetivo** (sub-bloque de Objetivo) y **Evaluación / Análisis**.

- **Estado vacío:** en lugar de un label, un **cuadro de texto** (`.sec-emptybox`) de **7 líneas de alto** (`min-height:168px`), borde **punteado** `1px dashed var(--border-strong)`, fondo `var(--bg-surface)`, radio 10px. Contiene:
  - Placeholder **“Sin registrar”** (color `var(--text-faint)`) arriba a la izquierda.
  - Cue **“+ Registrar {subjetivo|objetivo|análisis}”** abajo a la derecha, en el **color de la sección** (Subjetivo índigo, Objetivo teal, Análisis ámbar).
  - Todo el cuadro es clickeable y **abre el modal** de registro correspondiente (`openSubjetivo` / `openObjetivo` / `openAnalisis`). Hover: borde teal + fondo `var(--bg-subtle)`.
- **Estado lleno:** muestra el texto registrado y un botón **Editar** en el área de acciones del encabezado.
- **Modal de registro:** título según campo (p. ej. “Subjetivo (S)”), textarea, sugerencias contextuales (med-bar). Guardar/cerrar con los helpers de §12.
- Los tres campos de texto son **obligatorios** (gating §11). (Nota: **Signos vitales** conserva su botón propio “Registrar signos vitales”, no el cuadro punteado.)

---

## 10. Sección: Objetivo (sub-bloques)

Encabezado verde (§6). Contiene tres sub-bloques:

### 10.1 Signos vitales
Sub-bloque con título teal “SIGNOS VITALES” + píldora **Obligatorio**. Estado vacío “Sin registrar.” + botón **Registrar signos vitales** (rojo/rose) que abre el **modal de signos vitales** (§10.4). Estado lleno: chips-resumen (vitales + derivados + FPP si aplica) + Editar.

### 10.2 Registro de objetivo
Sub-bloque con título teal + píldora **Obligatorio**. Estado vacío = **cuadro clickeable de 7 líneas** (§9) que abre `openObjetivo`.

### 10.3 Antecedentes (colapsable en dos niveles, **Opcional**)
Sub-bloque con título teal “ANTECEDENTES” + píldora **Opcional**. **No** entra al gating de firma.

Controles en el encabezado del sub-bloque:
- Botón **“Modificar Antecedentes”** (ghost, ícono lápiz).
- Botón **chevron** de expandir/contraer (ícono chevron que **rota 180°** al abrir).

**Tres estados:**
1. **Colapsado total (por defecto):** solo el título + píldora Opcional + botón “Modificar Antecedentes” + chevron. **No** se muestra el resumen ni los campos.
2. **Resumen (chevron):** al pulsar el chevron, se despliega un **resumen de solo lectura** (`.ant-summary`) con tres grupos:
   - **Patológicos:** Alergias, Personales, Familiares.
   - **No Patológicos:** Ocupación, Hábitos.
   - **Identidad:** Nombre de pila (en lila), Comunidad LGBTIQ+ (Sí/No).
   - Cada antecedente muestra sus ítems como chips en mayúscula, o su texto de “ninguno” en verde si no tiene.
3. **Edición:** al pulsar **“Modificar Antecedentes”** aparece un **modal de confirmación** (§10.3.1); al confirmar, se despliega el editor completo (campos editables, §9 de antecedentes). El chevron se oculta y el botón pasa a **“Contraer antecedentes”**. Al contraer, vuelve al estado colapsado total y el resumen refleja los cambios.

#### 10.3.1 Modal de confirmación “Modificar antecedentes”
- Título: **“Modificar antecedentes”**; subtítulo: “Confirme que desea modificar los antecedentes del paciente.”
- Cuerpo: “Se habilitará la edición de cada antecedente:” + **lista de cada antecedente** (Alergias, Personales, Familiares, Ocupación, Hábitos) con check teal, y una **advertencia ámbar**: “Los cambios actualizan la historia clínica del paciente.”
- Pie: **Cancelar** / **Sí, modificar** (teal). Al confirmar → modo edición.

#### 10.3.2 Editor de antecedentes (cada uno)
Cinco antecedentes (`crearAntecedente`), agrupados Patológicos / No Patológicos, más Identidad:

| key | Título | Texto “ninguno” | Placeholder |
|---|---|---|---|
| alergias | Alergias | **Ninguna** | Medicamento, alimento, látex… |
| personales | Personales | **Ninguno** | Enfermedades previas, cirugías… |
| familiares | Familiares | **Ninguno** | Diabetes, HTA, cáncer familiar… |
| ocupacion | Ocupación | **No aplica** | Ocupación / oficio… |
| habitos | Hábitos | **No aplica** | Tabaquismo, alcohol, actividad física… |

- Cada antecedente tiene un toggle **Tiene / {Ninguno|No aplica}**:
  - **Tiene:** input + botón **Agregar** que apila ítems (en MAYÚSCULA) en una grilla de chips eliminables.
  - **{Ninguno/No aplica}:** muestra un **sello verde**: `✓ {NINGUNO} · registrado por DR. EDWIN ALEXANDER MARTÍNEZ (JVPM 12345) el {dd/mm/yyyy HH:MM:SS}` (fecha-hora de registro).
- **Alergias** sincroniza el banner del encabezado (§5.1) en cada cambio.
- **Identidad:** campo **Nombre de pila** `#npPila` en **lila** (texto `#7e22ce`, fondo `#faf5ff`, borde `#e9d5ff`; foco `#9333ea`, texto en MAYÚSCULA), con texto de ayuda “Si el paciente pertenece a la comunidad LGBTIQ+, este nombre es obligatorio y se mostrará como banner permanente.”, y un **switch LGBTIQ+** (`#swLgbt`, teal al activar): “Paciente de comunidad LGBTIQ+ — Activa el banner inamovible de nombre de pila durante la navegación del paciente.”

### 10.4 Modal de signos vitales (detalle exacto)

Título “Signos vitales”; subtítulo “Presión arterial y signos cardiorrespiratorios son obligatorios. El resto es opcional.” Estructura:

**Fila de alertas** (arriba, `#alertRow`): se recalcula en vivo (`validateVitals`). Muestra `Sin alertas críticas` (verde) cuando hay datos sin alertas; badges rojos por cada alerta; o `Ingrese signos para evaluar alertas críticas automáticamente.` si vacío.

**Núcleo siempre visible:**
- Fieldset **“Presión arterial”**: TA Sistólica, TA Diastólica.
- Fieldset **“Oxigenación y signos cardiorrespiratorios”**: Frecuencia cardíaca, Frecuencia respiratoria, Temperatura, SpO₂, FiO₂.
- Fieldset **“Gineco-obstétrico”** (solo `sexo==='F'`, ubicado **después** de Oxigenación y **antes** de “Ver más”), con píldora **Obligatorio**:
  - **FUR** (fecha).
  - **Fecha probable de parto (Naegele)** con **switch** (`#fppSwitch`): apagado → “Active el interruptor para calcular la FPP.”; encendido sin FUR → “Registre la FUR para calcular (Naegele).”; con FUR → muestra **fecha FPP + edad gestacional** (“{dd/mm/yyyy} · {N} sem {M} d”). El bloque FPP solo se muestra si `puedeEmbarazo()` (F y edad 10–55).
  - **Fórmula obstétrica (G · P · P · A · V)** con asterisco: Gestas, Partos a término, Partos pretérmino, Abortos, Vivos. **Obligatoria** para pacientes femeninas.

**Colapsable “Ver más / Ver menos”** (`toggleVMore`):
- **Estado neurológico/metabólico:** Glasgow (3 selects: ocular 1–4, verbal 1–5, motor 1–6 → total `#gcsTotal`); Glucometría.
- **Antropometría:** Peso (kg ↔ lb), Talla (m ↔ ft), **IMC** `#imcVal`, Perímetro de cintura, **Índice cintura-talla** `#ictVal`.
- **Balance:** Balance hídrico (mL), Diuresis (mL/h).
- **Dolor:** escala **EVA 0–10** (slider `#fDolor` → `#painVal`).

**Guardar (`saveVitals`):** valida que los **7 del núcleo** estén completos (sis, dia, fc, fr, temp, spo2, fio2) y dentro de rango; si `sexo==='F'`, también exige los **5 de la fórmula obstétrica** (goG, goPt, goPp, goA, goV). Marca en rojo y hace foco al primer faltante, con toasts específicos (ver §10.5). Cualquier valor fuera de rango bloquea con “Revise los valores fuera de rango”.

#### 10.5 Rangos de validación (data-min / data-max — EXACTOS)
| Campo | Mín | Máx | Unidad | Oblig. |
|---|---|---|---|---|
| TA sistólica | 60 | 260 | mmHg | **Sí** |
| TA diastólica | 40 | 160 | mmHg | **Sí** |
| Frecuencia cardíaca | 30 | 220 | lpm | **Sí** |
| Frecuencia respiratoria | 4 | 60 | rpm | **Sí** |
| Temperatura | 30 | 43 | °C | **Sí** |
| SpO₂ | 50 | 100 | % | **Sí** |
| FiO₂ | 21 | 100 | % | **Sí** (def. 21) |
| Glucometría | 10 | 900 | mg/dL | Opcional |
| Peso (kg) | 0.5 | 400 | kg | Opcional |
| Peso (lb) | 1 | 880 | lb | (conversión) |
| Talla (m) | 0.3 | 2.5 | m | Opcional |
| Talla (ft) | 1 | 8.2 | ft | (conversión) |
| Perímetro de cintura | 30 | 250 | cm | Opcional |
| Diuresis | 0 | 2000 | mL/h | Opcional |
| Glasgow ocular / verbal / motor | 1 | 4 / 5 / 6 | — | Opcional |
| Dolor (EVA) | 0 | 10 | — | Opcional |

> Peso/Talla canónicos = kg y m; lb/ft son solo conversión de UI. Balance hídrico: entero en mL.

#### 10.6 Conversiones (EXACTAS)
- `kg → lb`: × **2.20462**; `lb → kg`: ÷ 2.20462 (1 decimal).
- `m → ft`: × **3.28084**; `ft → m`: ÷ 3.28084 (2 decimales).

#### 10.7 Clasificaciones derivadas (EXACTAS)
- **IMC** = `peso_kg / (talla_m²)`. Categorías: `<18.5` **Bajo peso** (`#2563eb`) · `<25` **Normal** (`#16a34a`) · `<30` **Sobrepeso** (`#ea580c`) · `≥30` **Obesidad** (`#dc2626`). Formato “{IMC} kg/m² · {categoría}”.
- **Índice cintura-talla (ICT)** = `cintura_cm / (talla_m × 100)`. Categorías: `<0.5` **Saludable** (`#16a34a`) · `<0.6` **Riesgo aumentado** (`#ea580c`) · `≥0.6` **Riesgo alto** (`#dc2626`).
- **Glasgow total** = ocular+verbal+motor (sobre 15). `≥13` **Leve** (`#16a34a`) · `≥9` **Moderado** (`#ea580c`) · resto **Grave** (`#dc2626`).
- **FPP (Naegele)** = FUR **+ 1 año − 3 meses + 7 días**. Edad gestacional desde FUR a hoy: “{N} sem {M} d”.
- **Dolor (EVA)**: `0` Sin dolor (`#16a34a`) · `≤3` Dolor leve (`#65a30d`) · `≤6` Dolor moderado (`#ea580c`) · `≤9` Dolor intenso (`#dc2626`) · `10` Dolor máximo (`#b91c1c`).

#### 10.8 Umbrales de alertas críticas (`computeAlerts` — EXACTOS)
Se evalúan en vivo y producen badges:
- SpO₂ `< 90` → **SpO₂ baja**
- Sistólica `≥ 180` **o** Diastólica `≥ 110` → **Crisis hipertensiva**
- Sistólica `< 90` → **Hipotensión**
- Temp `≥ 39.5` → **Fiebre alta** · Temp `≤ 35` → **Hipotermia**
- FC `> 120` → **Taquicardia** · FC `< 50` → **Bradicardia**
- FR `> 24` → **Taquipnea** · FR `< 10` → **Bradipnea**
- Gluco `< 70` → **Hipoglucemia** · Gluco `≥ 250` → **Hiperglucemia**
- Glasgow (O+V+M) `≤ 8` → **Glasgow ≤8**
- Diuresis `< 0.5 × peso_kg` → **Oliguria**
- Dolor `≥ 7` → **Dolor intenso**

---

## 11. Sección: Plan (sub-bloques)

Encabezado gris (§6). Dos sub-bloques:

### 11.1 Plan de manejo (Obligatorio)
- Título teal “PLAN DE MANEJO” + chip de conteo `#planCount` + píldora **Obligatorio** + botón **Agregar al plan** (primario, `openPlan()`).
- Estado vacío: “Aún no hay indicaciones. Use ‘Agregar al plan’.”
- Lista de indicaciones (`#planBody`): filas numeradas con texto + Editar (`openPlan(id)`) / Eliminar (`delPlan(id)`).
- Obligatorio: ≥1 indicación (gating §12).

#### 11.1.1 Modal “Agregar al plan” (con **alta múltiple**)
- Título “Agregar al plan”; subtítulo “Conducta terapéutica, indicación, seguimiento o interconsulta.”
- Cuerpo: label “Indicación / acción” + textarea (placeholder “Describa la indicación...”) + barra de sugerencias + **hint de sesión** `#planAddedHint` (oculto al inicio).
- **Pie en modo agregar (tres botones):** **Cancelar** · **Agregar otra indicación** (ghost, `savePlan(true)`) · **Agregar al plan** (primario, `savePlan()`).
  - **“Agregar otra indicación”**: valida y registra la indicación, **limpia el textarea**, devuelve el foco y **mantiene el modal abierto** para seguir agregando. Muestra el hint verde **“✓ {N} indicaciones agregadas en esta sesión.”** (singular/plural correcto: “indicación agregada” / “indicaciones agregadas”).
  - **“Agregar al plan”**: registra la última indicación y **cierra** el modal.
- **Pie en modo edición** (al editar una indicación existente): solo **Cancelar** · **Guardar cambios** (sin “Agregar otra”).
- Validación: textarea vacío → marca error + toast “Escriba la indicación”.

### 11.2 Misceláneos de consulta (Opcional)
Título teal “MISCELÁNEOS DE CONSULTA” + píldora **Opcional**. Contiene:

- **Prescripción médica** (action-card): “Abre el recetario / indicaciones”.
- **Laboratorio clínico** (`<details open>`): selector de **categoría** (radios) + **lista de exámenes** con cantidad y botón de solicitud. Catálogo `lab` (§13.3).
- **Exámenes de gabinete** (`<details>`): **Radiología e imágenes** (catálogo `radiologia`) y **Cardiología** (catálogo `cardiologia`), cada uno con su selector de categoría + lista.
- **Terapia Respiratoria** (`<details>`):
  - **Gasometría**: radios **Basal** / **Con O₂ suplementario**; los campos **FiO₂** y **Flujo (L/min)** solo se muestran con “Con O₂ suplementario”.
  - **Nebulizaciones**, **Vibroterapia**, **Palmo percusión**: áreas de texto.
- **Orden de Inyecciones** (`<details>`, `openIny()`): grilla de inyecciones (descripción).
- **Action-cards** que invocan otros módulos: **Orden de Ingreso** (hospitalario), **Interconsulta**, **Hoja de Remisión**, **Incapacidad médica**, **Constancia médica**.

---

## 12. Firma del médico y gating

- **Firma del médico** (última tarjeta): grafo SVG de firma + sello circular con **“DR. EDWIN ALEXANDER MARTÍNEZ · JVPM 12345”**, traídos automáticamente de la ficha del médico (no se digitan).
- **Pendientes (`pendientes()`)** — la firma se habilita solo cuando NO falta ninguno de:
  1. **Especialidad** (campo no vacío)
  2. **≥1 problema**
  3. **Signos vitales** (los 7 del núcleo completos)
  4. **Subjetivo**
  5. **Objetivo** (registro)
  6. **Análisis**
  7. **≥1 indicación** en Plan
  - **Antecedentes NO es obligatorio** (no entra al gating).
- El pie muestra `Falta: {lista}` con los pendientes y **deshabilita “Guardar y firmar”** mientras existan.

---

## 13. Datos de muestra y catálogos (EXACTOS)

### 13.1 Pacientes de muestra (`SAMPLE_PATIENTS`)
1. **María Elena Rodríguez García** — F, 47, DUI 01234567-8, F.Nac 14/03/1978, **CONVENIO**, Exp `AVT-SV-2025-000482`, Cuenta `CTA-AVT-2025-004821`, domicilio “Col. Escalón, Av. Masferrer Nte. #123, San Salvador”, emergencia “CARLOS RODRÍGUEZ (HIJO) — 7777-8888”, **alergias: (ninguna)**, **pila: Mario**, nota “Persona de la comunidad LGBTIQ+ — diríjase al paciente por su nombre de pila.” *(paciente activo por defecto)*.
2. **Juan Pérez Martínez** — M, 45, DUI 02345678-9, F.Nac 02/06/1980, **PRIVADO**, Exp `AVT-SV-2025-000341`, Cuenta `CTA-AVT-2025-003190`, domicilio “Res. Las Cumbres, Calle 4 #56, Antiguo Cuscatlán”, emergencia “ANA PÉREZ (ESPOSA) — 7666-5555”, **alergias: Penicilina, AINEs**.
3. **Rosa Amaya de López** — F, 62, DUI 03456789-0, F.Nac 19/11/1963, **CONVENIO**, Exp `AVT-SV-2025-000507`, Cuenta `CTA-AVT-2025-005012`, domicilio “Col. Médica, Pasaje 2 #10, San Salvador”, emergencia “LUIS LÓPEZ (HIJO) — 7555-4444”, alergias (ninguna).

### 13.2 Especialidades (`ESPECIALIDADES`, 34)
Medicina General, Medicina Interna, Medicina Familiar, Medicina de Emergencias, Medicina Crítica / Cuidados Intensivos, Cardiología, Neurología, Neumología, Gastroenterología, Endocrinología, Nefrología, Hematología, Infectología, Reumatología, Dermatología, Pediatría, Neonatología, Ginecología y Obstetricia, Cirugía General, Cirugía Cardiovascular, Cirugía Plástica y Reconstructiva, Neurocirugía, Ortopedia y Traumatología, Urología, Otorrinolaringología, Oftalmología, Anestesiología, Psiquiatría, Oncología Médica, Radiología e Imágenes, Patología, Geriatría, Nutrición Clínica, Fisiatría y Rehabilitación.

### 13.3 Catálogos de exámenes (`EXAM_CATALOGS`)
**Laboratorio (`lab`):**
- *Hematología y coagulación:* Hemograma completo, Velocidad de sedimentación, Tiempo de protrombina (TP), Tiempo de tromboplastina (TTP), INR, Recuento de plaquetas, Fibrinógeno.
- *Química sanguínea:* Glucosa, Creatinina, Nitrógeno ureico (BUN), Ácido úrico, Colesterol total, Triglicéridos, HDL, LDL, AST (TGO), ALT (TGP), Bilirrubinas, Electrolitos (Na/K/Cl).
- *Hormonas y pruebas especiales:* TSH, T4 libre, T3, Cortisol, Insulina, PSA, Beta-hCG cuantitativa, Vitamina D.
- *Microbiología:* Hemocultivo, Urocultivo, Coprocultivo, Cultivo de secreción, Tinción de Gram, Baciloscopía (BAAR).
- *Urianálisis:* Examen general de orina, Microalbuminuria, Relación albúmina/creatinina.
- *Coprología:* Examen general de heces, Sangre oculta en heces, Coproparasitológico seriado.
- *Banco de sangre:* Tipeo ABO/Rh, Prueba cruzada, Coombs directo, Coombs indirecto.
- *Pruebas moleculares:* PCR SARS-CoV-2, Carga viral VIH, Genotipo VHC, PCR Influenza A/B.
- *Inmunología:* Proteína C reactiva (PCR), Factor reumatoide, Anticuerpos antinucleares (ANA), VIH (ELISA), VDRL/RPR, Antígeno de superficie VHB.
- *Gasometría venosa:* pH venoso, pCO₂ venoso, HCO₃⁻, Exceso de base, Lactato venoso.

**Radiología (`radiologia`):**
- *Rayos X:* Tórax PA y lateral, Abdomen simple de pie, Columna lumbar, Extremidad (especificar), Senos paranasales.
- *Ultrasonografía:* Abdominal completo, Pélvico, Obstétrico, Renal y vías urinarias, Tiroideo, Doppler de miembros.
- *Tomografía:* TAC de cráneo simple, TAC de tórax, TAC de abdomen y pelvis con contraste, Angio-TAC.
- *Resonancia Magnética:* RM de cráneo, RM de columna lumbar, RM de rodilla, RM con contraste.
- *Estudios Especiales:* Mamografía bilateral, Densitometría ósea, Fluoroscopía.

**Cardiología (`cardiologia`):**
- *Electrocardiograma:* ECG de 12 derivaciones, ECG con tira de ritmo.
- *Ecocardiograma:* Ecocardiograma transtorácico, Ecocardiograma transesofágico, Ecocardiograma con Doppler, Eco-estrés.
- *Monitoreo Holter:* Holter de 24 horas, Holter de 48 horas, MAPA (presión 24 h).
- *Prueba de esfuerzo:* Prueba de esfuerzo en banda, Prueba de esfuerzo con consumo de O₂.
- *Estudios Especiales:* Tilt test, Estudio electrofisiológico.

---

## 14. Comportamientos transversales

- **Autoguardado de borrador** cada **30 s**; el indicador “● Borrador guardado localmente {HH:MM:SS}” se actualiza.
- **`Ctrl/Cmd+S`** guarda borrador inmediatamente.
- **`Esc`** cierra el modal abierto.
- **Helpers de modal:** `openModal/closeModal`, `setModal(title,desc,body,foot)`, `footHTML(color,texto,fn)` (Cancelar + espaciador + botón de acción), `focusEl(id)`, `M(id)`, `esc(str)`, `toast(msg,tipo)`. El overlay es compartido por todos los modales.
- **Validación visual:** campos inválidos/faltantes con clase `err` (borde rojo); foco automático al primer faltante; toasts explicativos.
- **Estado en memoria** (sin persistencia): `problems`, `planItems`, `data{subjetivo,objetivo,analisis}`, `vitals{…, fppOn}`, registro de antecedentes (`ANT`), `patient`, banderas `antEditing/antSumOpen/fppOn/lgbtOn/vMoreOpen`, `planSessionAdded`.

---

## 15. Criterios de aceptación (checklist)

**Colores y diseño**
- [ ] Tokens de §2 idénticos (claro y oscuro); tipografía Inter.
- [ ] Encabezados tintados: Problemas azul, **Subjetivo morado**, **Objetivo verde**, Evaluación ámbar, **Plan gris**; títulos de sub-área en **teal**.
- [ ] Nombre del paciente a **34px** y **datos en mayúscula**; etiquetas en caso normal.
- [ ] Banner de alergias **verde** sin alergias / **rojo con ícono de cacahuate** con alergias.
- [ ] Filas de problemas en **blanco** (selección por checkbox); padres con acento azul.
- [ ] Cuadros vacíos de Subjetivo/Registro de objetivo/Análisis a **7 líneas**, punteados, con placeholder “Sin registrar” y cue “+ Registrar …”, que abren modal.

**Navegabilidad / funcionalidad / comportamiento**
- [ ] Orden de tarjetas (§4) y encabezado de paciente sticky con `--app-header-h`.
- [ ] Problemas con agrupación **“Diagnóstico Sindrómico”** (terminología en toda la UI).
- [ ] Signos vitales: rangos (§10.5), conversiones (§10.6), clasificaciones (§10.7), alertas (§10.8); **gineco obligatorio para F**, **FPP por switch**, ubicado tras Oxigenación y antes de “Ver más”.
- [ ] Antecedentes **Opcional**, colapsable en **dos niveles** (colapsado total → resumen → edición), con **modal de confirmación** que lista cada antecedente, sello verde “registrado por …”, nombre de pila **lila** y switch LGBTIQ+; sincroniza el banner de alergias.
- [ ] Plan: modal con **“Agregar otra indicación”** (alta múltiple, mantiene abierto, contador de sesión) y modo edición sin ese botón.
- [ ] Misceláneos completos (prescripción, laboratorio, gabinete radiología/cardiología, terapia respiratoria con gasometría condicionada, inyecciones, action-cards).
- [ ] Gating de firma según §12 (antecedentes **no** obligatorio); pie con “Falta: …” y “Guardar y firmar” deshabilitado con pendientes.
- [ ] Autoguardado 30 s, `Ctrl/Cmd+S`, `Esc`; estado en memoria sin `localStorage`.
- [ ] Datos de muestra y catálogos (§13) idénticos.

---

## 16. Prompt de arranque para Claude Code

```
Reproduce de forma fidedigna el mockup "Evolución Médica" (nota SOAP) como UN SOLO archivo HTML
autocontenido (HTML+CSS+JS vanilla, estado en memoria, SIN localStorage), con tema claro y oscuro.

Usa EXACTAMENTE los tokens de color de la sección 2 (claro y oscuro) y la tipografía Inter. Respeta el
orden de tarjetas, el encabezado de paciente sticky (variable --app-header-h), y todos los comportamientos:

- Encabezado del paciente: nombre a 34px y datos en MAYÚSCULA; banner de alergias verde sin alergias y
  ROJO con ícono de cacahuate cuando hay; nota de nombre de pila en lila; editar contacto de emergencia.
- Problemas con agrupación "Diagnóstico Sindrómico" (en toda la UI) y filas en blanco (selección por checkbox).
- Subjetivo (morado), Objetivo (verde), Evaluación/Análisis (ámbar), Plan (gris) con encabezados tintados;
  títulos de sub-área en teal.
- Estados vacíos de Subjetivo/Registro de objetivo/Análisis como cuadro de texto punteado de 7 líneas
  ("Sin registrar" + cue "+ Registrar …") que abre el modal de registro.
- Modal de signos vitales con los rangos, conversiones, clasificaciones (IMC, ICT, Glasgow, FPP) y alertas
  exactas de las secciones 10.5–10.8; gineco-obstétrico OBLIGATORIO para pacientes femeninas, FPP por switch,
  ubicado tras "Oxigenación y signos cardiorrespiratorios" y antes de "Ver más".
- Antecedentes OPCIONAL y colapsable en dos niveles (colapsado total → resumen de solo lectura → edición),
  con botón "Modificar Antecedentes" que abre un modal de confirmación listando cada antecedente, sello verde
  "registrado por DR. EDWIN ALEXANDER MARTÍNEZ (JVPM 12345) el {fecha}", nombre de pila en lila y switch LGBTIQ+.
- Plan con modal "Agregar al plan" que incluye "Agregar otra indicación" (alta múltiple: registra, limpia el
  textarea y mantiene el modal abierto, con contador de sesión); en edición, solo "Guardar cambios".
- Misceláneos: prescripción, laboratorio, gabinete (radiología/cardiología), terapia respiratoria (gasometría
  Basal/Con O₂ con FiO₂/Flujo condicionados, nebulizaciones, vibroterapia, palmo percusión), inyecciones y
  action-cards (ingreso, interconsulta, remisión, incapacidad, constancia).
- Firma traída de la ficha ("DR. EDWIN ALEXANDER MARTÍNEZ · JVPM 12345"); gating de firma según la sección 12
  (antecedentes NO obligatorio); pie con "Falta: …" y "Guardar y firmar" deshabilitado con pendientes.
- Autoguardado cada 30 s, Ctrl/Cmd+S guarda borrador, Esc cierra modal.

Usa los datos de muestra y catálogos EXACTOS de la sección 13. Verifica contra el checklist de la sección 15.
```
