# ESP-MOCKUP-HC-001 — Especificación de réplica del mockup "Historia Clínica" (ECE)

| Campo | Valor |
|---|---|
| **ID** | ESP-MOCKUP-HC-001 |
| **Tipo** | Especificación de **réplica fiel del mockup** (UI + comportamiento) |
| **Artefacto de referencia** | `historia-clinica-avante.html` (prototipo autónomo, estado actual) |
| **Objetivo** | Que Claude Code **reproduzca el mockup de forma fidedigna**: misma estructura, campos, textos, estilos y micro-interacciones. |
| **Documentos relacionados** | REQ-ECE-HC-001 (requerimiento de producción + datos/ORM) · REQ-ECE-LCE-001 (formulario de Lesión de Causa Externa) |

> **Cómo usar este documento.** Es la fuente de verdad de la **apariencia y el comportamiento** del prototipo. No describe persistencia/backend (eso está en REQ-ECE-HC-001). Toda etiqueta, opción de catálogo, color y comportamiento aquí listado debe quedar **idéntico** al replicar. Donde diga "demostrativo", el dato/control existe en la UI pero su origen real se conecta después.

---

## 1. Forma del artefacto y principios

- **Documento único autocontenido** (HTML + CSS + JS en un archivo) o componente equivalente que renderice lo mismo. **Sin librerías externas** obligatorias.
- **Sin almacenamiento del navegador** (`localStorage`/`sessionStorage` prohibidos); el estado vive en memoria durante la sesión.
- **Tipografía del sistema** (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Inter, …`).
- **Modo claro y oscuro** (clase `.dark` en `:root`/`body`).
- **Mayúsculas** en todo texto **escrito** por el usuario (ver §7, G-01).
- Todos los controles "demostrativos" muestran toasts/feedback, sin romper.

---

## 2. Sistema de diseño — paleta exacta (tokens CSS)

Definir como variables en `:root` (claro) y `.dark` (oscuro). **Mismos nombres de token**; el resto del CSS los referencia.

### 2.1 Claro (`:root`)
```
--background:#eef2f7;  --foreground:#0f172a;
--card:#ffffff;        --card-foreground:#0f172a;
--muted:#f1f5f9;       --muted-foreground:#64748b;
--primary:#1e293b;     --primary-foreground:#ffffff;     /* botón primario = slate */
--secondary:#f1f5f9;   --secondary-foreground:#1e293b;
--accent:#eff6ff;      --accent-foreground:#1d4ed8;      /* azul suave */
--destructive:#dc2626; --destructive-foreground:#ffffff;
--border:#e5e9f0;      --input:#e5e9f0;                  --ring:#3b82f6;
--surface-0:#ffffff;   --surface-1:#f8fafc;  --surface-2:#f1f5f9;  --surface-3:#e9eef5;
--success:#16a34a;     --success-foreground:#ffffff;
--warning:#d97706;     --info:#3b82f6;  --info-foreground:#ffffff;
--lila:#6366f1;        --lila-fg:#4f46e5;                /* banner nombre de pila */
--allergy:#e11d48;     --allergy-foreground:#ffffff;     /* alérgeno */
--sidebar-bg:#0f172a;  --sidebar-fg:#cbd5e1;  --sidebar-border:#1c2942;  --sidebar-accent:#14b8a6;
--radius-sm:6px; --radius-md:8px; --radius-lg:12px; --radius-xl:16px;
--motion-base:180ms; --motion-easing:cubic-bezier(0.2,0,0,1);
--sidebar-w:248px; --topbar-h:52px;
```

### 2.2 Oscuro (`.dark`)
```
--background:#0a1120;  --foreground:#f1f5f9;
--card:#0f1a2e;        --card-foreground:#f1f5f9;
--muted:#0c1525;       --muted-foreground:#93a3bb;
--primary:#3b82f6;     --primary-foreground:#0a1120;
--secondary:#16233c;   --secondary-foreground:#f1f5f9;
--accent:#15294a;      --accent-foreground:#bfdbfe;
--destructive:#f87171;
--border:#1d2942;      --input:#1d2942;                  --ring:#60a5fa;
--surface-0:#0a1120;   --surface-1:#0f1a2e;  --surface-2:#14233c;  --surface-3:#1a2c49;
--success:#22c55e;     --warning:#f59e0b;  --info:#60a5fa;
--allergy:#fb7185;     --lila:#818cf8;  --lila-fg:#a5b4fc;
--sidebar-bg:#0c1424;  --sidebar-border:#1d2942;
```

### 2.3 Colores semánticos fijos (no por token)
- **Avatar**: hombre azul `linear-gradient(135deg,#3b82f6,#1d4ed8)`; mujer rosa `linear-gradient(135deg,#ec4899,#db2777)` (variantes dark `#60a5fa/#3b82f6` y `#f472b6/#ec4899`).
- **Icono de sexo**: femenino `#ec4899` (rosa, dark `#f472b6`); masculino `#1e3a8a` (azul marino, dark `#60a5fa`).
- **Botón del formulario LCE**: verde, usa `--success`.

---

## 3. Estructura general de la pantalla

De arriba a abajo: **Topbar** (barra superior) · **Sidebar** (riel lateral oscuro) · **Contenido** con: **Cabecera de paciente** (fija) → **Banner de alergias** (fijo) → **Banner de nombre de pila** (condicional) → **10 secciones numeradas** → **Footer de acciones**. Más **5 modales** (campo genérico, signos vitales, contacto de emergencia, confirmación, formulario LCE).

- **Topbar**: buscador (Ctrl+K, demostrativo), selector de organización ("Avante Holding"), selector de roles ("Todos los roles (12)"), toggle de tema (claro/oscuro funcional), notificaciones, avatar de usuario ("EM · Edwin Martínez").
- **Sidebar**: riel oscuro (`--sidebar-bg`) con acento teal en activo; ancho 248px (demostrativo).
- Las secciones son **tarjetas** (`.card`) con encabezado (badge numerado `.step` + título) y cuerpo.

---

## 4. Cabecera de paciente (`#patient-bar`, fija) — solo lectura salvo emergencia

`display:flex; align-items:flex-start; gap:18px`, fondo `--surface-1`, borde inferior. Orden de izquierda a derecha:

1. **Avatar** (`#pb-avatar`, primer elemento, **a la izquierda de toda la info**): círculo 64px, silueta de persona blanca, **azul** para hombre / **rosa** para mujer, **data-driven** por el sexo del paciente.
2. **Bloque de info** (`.pb-main`):
   - **Nombre** (`#pb-name`) — fuente **34px**, peso 800.
   - A la par: insignias **Expediente** (`AVT-SV-2025-000482`) y **Cuenta hosp.** (`CTA-AVT-2025-004821`) — código monoespaciado, color `--primary`.
   - **Fila de chips** (`.pchip`), en este orden exacto: **Edad** (`47 años`) · **Documento** (`DUI: 01234567-8`) · **Sexo** (icono + `Femenino`) · **F. Nac.** (`14/03/1978`) · **Tipo de cuenta** (pill `CONVENIO`).
   - Chip **Domicilio** (`Col. Escalón, Av. Masferrer Nte. #123, San Salvador`).
   - **Contacto de emergencia** (`En caso de emergencia llamar a:` + valor + botón **Editar**) — **editable** (modal, §9.3).
- **Icono de sexo** (`#sex-ico`/`#sex-val`): Venus rosa (femenino) / Marte azul marino (masculino), data-driven.
- **Tipo de cuenta** (enum): `CONVENIO` · `PARTICULAR` · `ASEGURADORA` · `LICITACIONES`.

---

## 5. Banners (fijos/condicionales)

### 5.1 Banner de alergias (`#banner-alergias`) — **siempre visible**
Refleja en vivo el grid de Alergias (§8.3):
- **Con alergias:** fondo rojo (`--allergy`), **icono de cacahuate** (alérgeno), título `Alergias del paciente (N)` y lista de sustancias en mayúsculas.
- **Sin alergias:** clase `.none`, fondo **verde** (`--success`), icono de verificación, texto exacto **`Ninguna alergia conocida`**.

### 5.2 Banner de nombre de pila (`#banner-nombrepila`) — condicional, **lila**
- Color lila (`--lila`/`--lila-fg`). Visible **solo** si el switch LGBTIQ+ está activo **y** hay nombre de pila.
- Si el switch está activo y el nombre está vacío → el campo nombre de pila es **obligatorio** (asterisco + error), y el banner no aparece hasta completarlo.

---

## 6. Secciones numeradas — orden y numeración (1…10)

`1` Motivo de consulta · `2` Presente Enfermedad · `3` Antecedentes · `4` Examen físico (**incluye Signos vitales**) · **[botón verde → formulario LCE]** · `5` Diagnósticos (CIE-11) · `6` Procedimientos (CPT) · `7` Misceláneos de consulta · `8` Análisis clínico · `9` Plan · `10` Firma del médico.

---

## 7. Convenciones globales (transversales)

| ID | Regla |
|---|---|
| **G-01** | **Mayúsculas:** todo texto **escrito** por el usuario se almacena/muestra en MAYÚSCULAS (inputs, textareas, campos por modal, complementos por fila, instrucciones). No aplica a etiquetas/ayudas/placeholders. |
| **G-02** | **Captura por modal:** campos narrativos largos se editan en un **modal reutilizable** y se muestran como "campo con botón Editar" (`.mfield` + `.medit`). |
| **G-03** | **Comillas del motivo:** el Motivo de consulta se **muestra entre `«…»`** automáticamente; el valor se **guarda sin comillas** (al reabrir el modal se ve el texto crudo). |
| **G-04** | **Grids sin duplicados:** todo grid de captura valida que no se repita el mismo registro; cada fila tiene botón eliminar. |
| **G-05** | **Confirmación + auditoría** al marcar un antecedente como negativo (§8.3, modal §9.4). |
| **G-06** | **Sin almacenamiento del navegador.** |
| **G-07** | **Accesibilidad:** banners con `role` adecuado; foco/Esc/clic-fuera en modales; toggles operables por teclado. |
| **G-08** | **Toasts** para acciones demostrativas y confirmaciones. |

---

## 8. Especificación por sección (campos y comportamiento exactos)

### 8.1 (1) Motivo de consulta · **obligatorio**
- Un campo `.mfield` (modal multilínea). Placeholder "Motivo principal de la consulta".
- Al guardar: se muestra entre `«…»` y en mayúsculas; valor crudo sin comillas (G-03).

### 8.2 (2) Presente Enfermedad · **obligatorio** · con **plantillas**
- Barra de **Plantillas**: `select` + **Aplicar** + **Guardar como plantilla** (pide nombre por modal) + **Eliminar**. Plantillas demostrativas sembradas (p. ej. "Cuadro respiratorio agudo", "Síndrome diarreico agudo", "Dolor abdominal").
- Campo `.mfield` (modal multilínea).

### 8.3 (3) Antecedentes · **obligatorio**
Dos grupos: **Patológicos** (Alergias, Personales, Familiares) y **No Patológicos** (Ocupación, Hábitos). Cada subsección es un **componente reutilizable** (factory `crearAntecedente`) con:
- **Toggle** "Tiene" / negativo. Negativo por subsección: Alergias→**Ninguna**, Personales→**Ninguno**, Familiares→**Ninguno**, Ocupación→**No aplica**, Hábitos→**No aplica**.
- **Estado "Tiene":** input + botón **Agregar** → **grid** de ítems (varios), sin duplicados, con eliminar.
- **Estado negativo:** al seleccionarlo se **abre modal de confirmación** (§9.4); al confirmar, se **registra auditoría** (usuario + fecha/hora), se ocultan input+grid, la subsección queda **válida** y se muestra una **nota de auditoría** verde: *"NINGUNO · registrado por [USUARIO] el [DD/MM/AAAA HH:MM:SS]"*. Si había ítems, el modal advierte que quedarán sin efecto y se limpian. **Cancelar** revierte a "Tiene".
- **Alergias:** captura **solo sustancia/agente** (sin severidad ni reacción) y **sincroniza el banner** (§5.1). Sembrado demostrativo: `PENICILINA`, `SULFAS`.
- **"Ver más"** (en No Patológicos): revela **Nombre de pila** (input) + switch **"Paciente de la comunidad LGBTIQ+"** (controla el banner §5.2 y la obligatoriedad del nombre de pila).
- Usuario actual demostrativo para la auditoría: `DR. EDWIN ALEXANDER MARTÍNEZ (JVPM 12345)`.

### 8.4 (4) Examen físico · **obligatorio** · contiene **Signos vitales** y **plantillas**
Tarjeta compuesta, **en este orden**:
- **Subsección A — Signos vitales** (antes de las plantillas), con badge **"Obligatorio"** y nota "La presión arterial y los signos cardiorrespiratorios son obligatorios; el resto es opcional." Botón **"Registrar signos vitales"** (`#btn-vitals`) abre el **modal de signos vitales** (§9.2). Resumen: "Signos vitales sin registrar." → chips con los valores tras registrar.
- **Subsección B — Plantillas + campo:** barra de plantillas (igual que §8.2, plantillas demostrativas: "Examen físico normal", "Respiratorio", "Abdomen agudo") + campo `.mfield` (modal multilínea, placeholder "Descripción del examen físico…").

### 8.5 Botón verde — Formulario de Lesión de Causa Externa (entre Examen físico y Diagnóstico)
- **Botón a lo ancho de la página, verde** (`--success`), texto "Formulario de Lesión de Causa Externa (MINSAL)" + icono de portapapeles + flecha.
- Abre un **modal a pantalla casi completa** (§9.5) con el formulario embebido en **iframe aislado**, encabezado "Forma parte de la Historia Clínica · MINSAL" y botón **"Volver a la historia clínica"** (cierra también con Esc/clic fuera). Comportamiento y campos del formulario: **REQ-ECE-LCE-001**.

### 8.6 (5) Diagnósticos (CIE-11) · **obligatorio**
- **Búsqueda autocompletada** (código/descripción, catálogo demostrativo) → agrega al **grid**.
- Columnas: **Código** · **Descripción** · **Tipo** (`Presuntivo`/`Definitivo`/`Complementario`, select por fila) · **Complemento** (input **por fila**) · eliminar.

### 8.7 (6) Procedimientos (CPT) · **opcional**
- Marcado **Opcional**. Búsqueda autocompletada (código/nombre) → **grid** con **Código** · **Procedimiento** · **Complemento por fila** · eliminar.

### 8.8 (7) Misceláneos de consulta · **opcional**
Marcado **Opcional**. Contenido y orden:
1. **Prescripción médica** (acción; **antes** de Laboratorio).
2. **Laboratorio clínico** (factory `crearOrdenExamenes`): selector de sección (radios) → lista con checkbox + cantidad → botón **"Agregar a la Solicitud"** → grid (sin duplicados, editar cantidad, eliminar).
3. **Exámenes de gabinete:** Radiología/imágenes; Cardiología. **Ecocardiograma** incluye: **transtorácico**, **transesofágico**, **Doppler**, **eco-estrés**.
4. **Terapia Respiratoria** (componente propio): **Gasometría arterial** **Basal** / **Con O₂ suplementario** (al elegir O₂ muestra **FiO₂** con unidad `%` y **Flujo** con unidad `L/min`); **Nebulizaciones**, **Vibroterapia**, **Palmo percusión** con **instrucciones** de texto libre.
5. **Orden de Inyecciones** (modal → grid).
6. **Tarjetas de acción** (navegan a otros módulos, demostrativas): **Orden de Ingreso** · **Orden de interconsulta médica** · **Hoja de Remisión** · **Incapacidad médica** · **Constancia médica**.

### 8.9 (8) Análisis clínico · **obligatorio**
- Campo `.mfield` (modal multilínea).

### 8.10 (9) Plan · **obligatorio**
- **Plan de manejo:** **grid** con agregar (modal) varias indicaciones + eliminar.
- **Destino** (select, **obligatorio**), opciones exactas: `Alta médica` · `Alta voluntaria` · `Ingreso hospitalario` · `Observación` · `Seguimiento` · `Remisión a otro centro` · `Fallecido`.

### 8.11 (10) Firma del médico · **obligatorio**
- Tarjeta con **grafo (firma)** + **sello** del médico (demostrativos, "traídos de la ficha médica") y nombre + **JVPM 12345**.

---

## 9. Modales (exactos)

### 9.1 Modal de campo genérico (`openFieldModal`/`saveModal`/`closeModal`)
- Título/descr/placeholder vienen del `.mfield` (atributos `data-*`). Soporta `data-multiline` (textarea vs input).
- `saveModal`: mayúsculas; si `data-wrap-quotes="1"` (motivo) muestra `«…»` pero guarda crudo. Patrón `saveOverride` para reutilizar el modal (p. ej. nombrar plantillas).
- Cierra con botón, Esc o clic fuera.

### 9.2 Modal de Signos vitales (`#vitals-overlay`, `window.VIT`)
Campos exactos:
- **Presión arterial** (sistólica/diastólica) + **Signos cardiorrespiratorios**: FC, FR, Temperatura, SpO₂, FiO₂. *(PA + cardiorrespiratorios obligatorios.)*
- **Escala de Glasgow** (apertura ocular, respuesta verbal, respuesta motora) con **suma automática**; glucometría.
- **Antropometría:** Peso (**kg ↔ lb** sincronizados), Talla (**m ↔ ft** sincronizados), **IMC** (`#imcBox`, calculado + clasificación) y **Índice cintura-talla** (`ictBox`, calculado + clasificación) **lado a lado**, perímetro de cintura.
- **Balance hídrico:** balance, diuresis.
- **Gineco-obstétrico** (si aplica): FUR → **FPP por Naegele**.
- **Dolor:** escala **EVA 0–10**.
- Resumen en **chips** al guardar (incluye IMC e ICT).

### 9.3 Modal de Contacto de emergencia (`#emerg-overlay`)
- **Tres campos**: **Nombre** (`#emerg-nombre`), **Parentesco** (`#emerg-parentesco`), **Teléfono** (`#emerg-tel`).
- Visualización: `NOMBRE (PARENTESCO) — TELÉFONO`. Valores demostrativos `CARLOS RODRÍGUEZ / HIJO / 7777-8888`.

### 9.4 Modal de confirmación genérico (`#confirm-overlay`, `confirmAction`)
- Título + descripción dinámicos + **Confirmar**/**Cancelar**. Usado por el estado negativo de antecedentes (§8.3). Cierra con botón, Esc o clic fuera (= cancelar).

### 9.5 Modal del Formulario LCE (`#lesion-overlay`)
- Modal grande con **iframe** (`#lesion-frame`). El formulario se carga **lazy** en la primera apertura desde una constante **base64** decodificada (UTF-8) a `srcdoc` (aislamiento total). Encabezado + "Volver a la historia clínica".

---

## 10. Componentes reutilizables (factories)

- **`crearAntecedente(mount, cfg)`** — toggle Tiene/negativo + input + grid + auditoría (§8.3). Registro global `ANT[key]` con `mode`, `items`, `audit`, `isValid()`, `markInvalid()`. cfg: `{key, label, ninguno, placeholder, onChange?}`.
- **`crearPlantillas(cfg)`** — barra de plantillas (Aplicar/Guardar/Eliminar), usada en Presente Enfermedad y Examen físico. cfg: `{selectId, applyId, saveId, delId, fieldId, templates[]}`.
- **`crearOrdenExamenes(cfg)`** — solicitud de exámenes (sección→items→grid), usada en Laboratorio/gabinete.
- Helpers globales: `el()`, `esc()`, `toast()`, `ahoraTS()`, `USUARIO_ACTUAL`.

---

## 11. Validación y footer

- **Footer**: **Cancelar** · **Guardar borrador** (sin validar) · **Guardar y firmar** (`#btn-firmar`, valida).
- **"Guardar y firmar"** valida los obligatorios; por cada faltante: lo **resalta** (clase `invalid` en el campo/sección), arma la **lista de faltantes** (toast) y hace **scroll al primero**. Si todo está, muestra toast de éxito.
- **Obligatorios:** Motivo · Presente Enfermedad · Antecedentes (las 5 subsecciones, cada una negativo-confirmado **o** ≥1 ítem) · Examen físico · Diagnóstico (≥1) · Análisis clínico · Plan (≥1) · Destino. **Opcionales:** CPT, Misceláneos. Signos vitales: PA + cardiorrespiratorios obligatorios para registrar el bloque.

---

## 12. Formulario de Lesión de Causa Externa (embebido)

- Se incrusta el HTML completo del formulario (su propio estilo teal `#0e5f66`, secciones colapsables, mapa corporal, Glasgow, vistas Completa/Limpia, etc.) **dentro de un iframe** para preservar el 100% de su comportamiento sin colisiones. Especificación completa del formulario: **REQ-ECE-LCE-001**.

---

## 13. Micro-interacciones y detalles a respetar

- Cabecera, banners y topbar **fijos** (sticky) al hacer scroll.
- Toggle de **tema** claro/oscuro funcional.
- **Conversión bidireccional** kg/lb y m/ft en signos vitales; **suma automática** de Glasgow; **IMC/ICT** calculados con clasificación.
- **Autocompletado** en CIE-11 y CPT; **complemento por fila** que no re-renderiza el grid al escribir.
- **Campos "Otro"/condicionales** (p. ej. FiO₂/Flujo solo con O₂ suplementario).
- **Avatar e icono de sexo** se asignan por el valor de sexo (rosa/azul).
- Banners de alergias y nombre de pila reaccionan en vivo a sus controles.

---

## 14. Checklist de fidelidad (Definition of Done de la réplica)

- [ ] Paleta exacta (§2) en claro y oscuro; toggle de tema funcional.
- [ ] Cabecera con **avatar** (azul/rosa por sexo) a la izquierda de toda la info; nombre 34px; insignias expediente/cuenta; chips en el orden exacto; **icono de sexo**; tipo de cuenta; domicilio; contacto de emergencia editable (3 campos).
- [ ] Banner de alergias (cacahuate/rojo ↔ verde "Ninguna alergia conocida"); banner de nombre de pila lila + obligatoriedad.
- [ ] **10 secciones** en orden, con Signos vitales **dentro** de Examen físico (antes de plantillas).
- [ ] Motivo entre `«…»` (valor sin comillas); plantillas en Presente Enfermedad y Examen físico.
- [ ] Antecedentes: 5 grids con toggle, **confirmación + auditoría** (usuario + fecha/hora) al negativo; alergias sin severidad/reacción y sincroniza banner; "Ver más" con nombre de pila + LGBTIQ+.
- [ ] Signos vitales completos (PA, cardiorrespiratorios, Glasgow auto-suma, antropometría con kg/lb y m/ft, **IMC + ICT lado a lado**, balance, gineco FUR/FPP, EVA) con resumen en chips.
- [ ] Diagnósticos CIE-11 (tipo + **complemento por fila**); CPT opcional (complemento por fila).
- [ ] Misceláneos opcional: prescripción (primero), laboratorio/gabinete (con Ecocardiograma transtorácico/transesofágico/Doppler/eco-estrés), Terapia Respiratoria (FiO₂%/Flujo L/min condicionados + instrucciones libres), inyecciones, y tarjetas (Ingreso, Interconsulta, Remisión, Incapacidad, Constancia).
- [ ] Análisis clínico (modal); Plan (grid) + Destino con las 7 opciones exactas; Firma con grafo + sello + JVPM.
- [ ] **Botón verde a lo ancho** entre Examen físico y Diagnóstico que abre el **formulario LCE** en iframe aislado, como parte de la HC, con "Volver a la historia clínica".
- [ ] Validación "Guardar y firmar" (resalta, lista y enfoca faltantes); footer Cancelar/Guardar borrador/Guardar y firmar.
- [ ] **Mayúsculas** en todo texto escrito; **sin** `localStorage`.
- [ ] 5 modales (campo, signos vitales, emergencia, confirmación, LCE) con foco/Esc/clic-fuera.

---

> **Referencia:** prototipo `historia-clinica-avante.html` (estado actual). Para persistencia/datos/ORM ver **REQ-ECE-HC-001**; para el formulario de Lesión de Causa Externa ver **REQ-ECE-LCE-001**. Este documento prevalece para la **réplica visual y de comportamiento** del mockup.
