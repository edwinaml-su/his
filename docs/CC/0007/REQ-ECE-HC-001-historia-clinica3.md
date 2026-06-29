# REQ-ECE-HC-001 — Pantalla "Historia Clínica" (Expediente Clínico Electrónico)

| Campo | Valor |
|---|---|
| **ID** | REQ-ECE-HC-001 |
| **Módulo** | ECE — Expediente Clínico Electrónico |
| **Pantalla** | `Historia Clínica` (captura/registro de la HCE) |
| **Versión** | 1.1 (incorpora: "Presente Enfermedad", comillas automáticas del motivo, iconografía de sexo, Signos vitales dentro de Examen físico, confirmación + auditoría en antecedentes negativos, y el formulario de Lesión de Causa Externa como parte de la HC) |
| **Autor** | Edwin Martínez — TTD / Inversiones Avante |
| **Estado** | Listo para implementación |
| **Prioridad** | Alta |
| **Stack destino** | Next.js (App Router) · tRPC · Prisma · Supabase/PostgreSQL · Vercel |
| **Design System** | Avante DS v2.0 (navy `#0B3D5C` / teal `#00A8B5`, tokens OKLCH, modo claro + oscuro) |
| **Cumplimiento** | MINSAL Acuerdo 1616 · NTEC · JCI IPSG (alérgenos/identificación del paciente) |

> **Propósito de este documento.** Especificar de forma completa y verificable la pantalla de captura de la Historia Clínica Electrónica para que Claude Code la implemente y la adapte al monorepo de HIS Multipaís. El prototipo HTML autónomo es la **referencia visual y de comportamiento**; este documento es la fuente de verdad funcional. Donde haya conflicto, prevalece este documento.

---

## 1. Objetivo

Permitir al médico registrar una Historia Clínica completa asociada a una **cuenta de atención** del paciente, siguiendo el orden clínico estándar (motivo → enfermedad → antecedentes → exploración —con signos vitales dentro del examen físico— → diagnósticos → plan), con captura asistida (plantillas, catálogos CIE-11/CPT, calculadoras de signos vitales), validación de campos obligatorios y firma del médico, dejando un registro inmutable al guardar y firmar. La HC integra además el **Formulario de Lesión de Causa Externa** (parte de la misma historia, RF-07).

---

## 2. Contexto y stack

- **Frontend:** Next.js App Router + React + componentes del Design System v2.0. Estado local con React (sin `localStorage`).
- **API:** tRPC (routers por agregado: `historiaClinica`, `catalogos`, `paciente`, `medico`).
- **Persistencia:** Prisma sobre Supabase/PostgreSQL. El motor de workflow clínico data-driven (MINSAL Acuerdo 1616) ya existente debe poder invocarse al firmar.
- **Identidad/seguridad:** el paciente y su cuenta provienen del contexto de la consulta activa (no se capturan en esta pantalla). El médico firmante proviene de la sesión autenticada (Entra/IdP) y su **ficha médica**.

---

## 3. Alcance

### 3.1 Incluido
- Cabecera fija de paciente (solo lectura, con **iconografía de sexo**) + contacto de emergencia (editable, 3 campos).
- Captura de los **10 bloques** clínicos descritos en §6 (Signos vitales va **dentro** de Examen físico).
- Validación de obligatorios y acción **Guardar y firmar**.
- Plantillas reutilizables (**Presente Enfermedad** y Examen físico).
- Integración con catálogos CIE-11 y CPT.
- **Confirmación + auditoría** (usuario y fecha/hora) al marcar un antecedente como Ninguno/No aplica.
- **Botón verde a lo ancho** (entre Examen físico y Diagnóstico) que abre el **Formulario de Lesión de Causa Externa**, parte de la HC (ver RF-07 y REQ-ECE-LCE-001).
- Traída de **grafo y sello** del médico desde su ficha médica.

### 3.2 Excluido (fuera de esta historia)
- Alta/edición del paciente, del expediente o de la cuenta de atención.
- Recetario/indicaciones, órdenes de ingreso, interconsulta, remisión, incapacidad y constancia: esta pantalla solo **invoca** esos módulos (navegación), no los implementa.
- Administración de los catálogos CIE-11/CPT y de las plantillas a nivel de organización (en esta versión las plantillas son por sesión; ver §8).

---

## 4. Convenciones globales (transversales)

| ID | Regla |
|---|---|
| **G-01** | **Mayúsculas:** todo el texto **escrito** por el usuario en el formulario se almacena y muestra en MAYÚSCULAS (inputs de texto, áreas de texto, campos por modal, complementos por fila, instrucciones). No aplica a etiquetas, ayudas ni placeholders. |
| **G-02** | **Idioma:** es-SV. Tono clínico, formal. |
| **G-03** | **Design System v2.0:** usar tokens OKLCH y soportar modo claro/oscuro. No introducir colores fuera de la paleta salvo los semánticos definidos aquí (alérgeno/rojo, éxito/verde, lila para nombre de pila). |
| **G-04** | **Captura por modal:** los campos narrativos largos (motivo, enfermedad, examen, análisis, indicaciones del plan, órdenes de inyección) se editan en un modal reutilizable y se muestran como "campo con botón Editar". |
| **G-05** | **Grids sin duplicados:** todo grid de captura (antecedentes, diagnósticos, procedimientos, exámenes, inyecciones, plan) valida que no se repita el mismo registro. |
| **G-06** | **Persistencia:** sin almacenamiento del navegador. El estado vive en el cliente hasta guardar/firmar vía tRPC. |
| **G-07** | **Accesibilidad:** roles ARIA en banners (`alert`/`status`), foco gestionado en modales, toggles operables por teclado. |
| **G-08** | **Comillas automáticas del motivo:** el Motivo de consulta se **muestra entre comillas angulares** (`«…»`) de forma automática. El valor **se almacena sin comillas** (texto crudo, para edición/backend); las comillas son solo de presentación. |
| **G-09** | **Confirmación + auditoría en estado negativo de antecedentes:** marcar un antecedente como Ninguno/No aplica exige confirmación en modal y **registra usuario + fecha-hora** de la acción (ver RF-05). |
| **G-10** | **Formulario embebido aislado:** el Formulario de Lesión de Causa Externa se abre en contenedor aislado (iframe) y devuelve su estado a la HC vía `postMessage` para vincularse al episodio (RF-07, REQ-ECE-LCE-001 §11). |

---

## 5. Modelo de datos (sugerencia de mapeo Prisma)

> Alinear con el esquema ECE existente en Supabase. Los nombres son orientativos; respetar las convenciones del proyecto (expediente inmutable, formato de cuenta `códigoPaís + añoNacimiento + correlativo`, índice único parcial para `DUI_RESP`).

| Entidad | Campos clave | Notas |
|---|---|---|
| `HistoriaClinica` | `id`, `cuentaAtencionId` (FK, **inmutable**), `pacienteId`, `medicoId`, `estado` (`BORRADOR`\|`FIRMADA`), `firmadaEn`, `createdAt` | Cabecera del registro. |
| `MotivoConsulta` / campos narrativos | `motivo`, `presenteEnfermedad`, `examenFisico`, `analisisClinico` (text) | Pueden ir como columnas de `HistoriaClinica`. `motivo` se almacena **sin** comillas (las `«…»` son solo de presentación, G-08). |
| `Antecedente` | `id`, `hcId`, `tipo` (`ALERGIA`\|`PERSONAL`\|`FAMILIAR`\|`OCUPACION`\|`HABITO`), `estado` (`TIENE`\|`NINGUNO`\|`NO_APLICA`), `descripcion`, `registradoPor`, `registradoEn` | Un registro por ítem cuando `estado=TIENE`; un único registro marcador cuando negativo. `registradoPor`/`registradoEn` sellan la **auditoría** del estado negativo (G-09, RF-05). |
| `Diagnostico` | `id`, `hcId`, `codigoCie11`, `descripcion`, `tipo` (`PRESUNTIVO`\|`DEFINITIVO`\|`COMPLEMENTARIO`), `complemento` | `complemento` **por diagnóstico**. |
| `Procedimiento` | `id`, `hcId`, `codigoCpt`, `descripcion`, `complemento` | `complemento` **por procedimiento**. Opcional. |
| `OrdenExamen` | `id`, `hcId`, `seccion`, `examen`, `cantidad` | Laboratorio / gabinete. |
| `TerapiaRespiratoria` | `gasometria` (`BASAL`\|`O2_SUPLEMENTARIO`), `fio2Pct`, `flujoLpm`, `nebulizacionesInstr`, `vibroterapiaInstr`, `palmoPercusionInstr` | Campos condicionales (FiO₂/Flujo solo con O₂). |
| `OrdenInyeccion` | `id`, `hcId`, `texto` | Grid. |
| `SignosVitales` | ver §6.6 | Bloque medible. |
| `PlanItem` | `id`, `hcId`, `texto` | Grid (varias indicaciones). |
| `HistoriaClinica.destino` | enum (ver §6.12) | Único valor. |
| `Firma` | `medicoId`, `grafoUrl`, `selloUrl`, `jvpm`, `nombre` | **Traídos de la ficha médica**; no se editan aquí. |
| `ContactoEmergencia` | `nombre`, `parentesco`, `telefono` | 3 campos individuales; editable por el médico. |
| `ReporteLesionCausaExterna` | `id`, `historiaClinicaId` (FK), … | Reporte epidemiológico **adjunto a la HC** (mismo episodio). Modelo completo en **REQ-ECE-LCE-001 §9**. Se abre desde el botón verde (RF-07). |

**Enumeraciones**

- `TipoCuenta`: `CONVENIO` · `PARTICULAR` · `ASEGURADORA` · `LICITACIONES`.
- `TipoDocumento`: `DUI` · `DNI` · `PASAPORTE` · `DUI_RESP`.
- `Destino`: `ALTA_MEDICA` · `ALTA_VOLUNTARIA` · `INGRESO_HOSPITALARIO` · `OBSERVACION` · `SEGUIMIENTO` · `REMISION_OTRO_CENTRO` · `FALLECIDO`.
- `TipoDiagnostico`: `PRESUNTIVO` · `DEFINITIVO` · `COMPLEMENTARIO`.

---

## 6. Requerimientos funcionales (RF)

### RF-01 — Cabecera fija de paciente (solo lectura)
**Descripción.** Barra superior fija (sticky) siempre visible mientras se navega la pantalla. Sus datos provienen del expediente/cuenta consultada; el médico **no** los edita (excepto el contacto de emergencia).

**Contenido y disposición:**
- **Nombre del paciente** prominente, tamaño de fuente **34 px**.
- A la par del nombre: **número de expediente** y **número de cuenta hospitalaria** como insignias destacadas.
- Fila de datos en *chips* resaltados, en este orden: **Edad → Documento (tipo + número, p. ej. DUI) → Sexo → Fecha de nacimiento → Tipo de cuenta**.
- **Domicilio** en chip resaltado.
- **Iconografía de sexo**: junto al valor de Sexo, una figura iconográfica **rosa** para Femenino (símbolo de Venus) y **azul marino** para Masculino (símbolo de Marte). Es **data-driven** (se asigna según el valor de sexo del paciente) y se adapta a modo oscuro.
- **Tipo de cuenta**: una de `CONVENIO`/`PARTICULAR`/`ASEGURADORA`/`LICITACIONES` (derivada de la cuenta, solo lectura).

**Criterios de aceptación:**
- [ ] El nombre se renderiza a 34 px y la cabecera permanece fija al hacer scroll.
- [ ] Expediente y cuenta hospitalaria aparecen junto al nombre.
- [ ] El documento se muestra entre edad y sexo, con su tipo (`DUI`/`DNI`/`PASAPORTE`/`DUI_RESP`).
- [ ] Junto al sexo aparece la figura iconográfica (Venus rosa para Femenino, Marte azul marino para Masculino).
- [ ] Ningún dato de paciente/cuenta es editable desde esta pantalla.

### RF-01.1 — Contacto de emergencia (editable por el médico)
- En la cabecera: "En caso de emergencia llamar a: …" con acción **Editar**.
- Se almacena en **tres campos individuales**: **Nombre**, **Parentesco**, **Teléfono** (modal dedicado).
- Visualización combinada: `NOMBRE (PARENTESCO) — TELÉFONO`.

**Criterios de aceptación:**
- [ ] El modal expone los 3 campos por separado y persiste cada uno.
- [ ] El valor mostrado se actualiza tras guardar.

### RF-01.2 — Banner de alergias (sticky, dinámico)
Refleja en tiempo real el grid de **Alergias** (RF-05).
- **Con alergias:** banner **rojo**, **icono de cacahuate (alérgeno)**, título `Alergias del paciente (N)` y lista de sustancias.
- **Sin alergias:** banner **verde**, icono de verificación, texto **`Ninguna alergia conocida`**.

**Criterios de aceptación:**
- [ ] El banner siempre es visible (rojo/verde según corresponda).
- [ ] El icono es un cacahuate cuando hay alergias.
- [ ] Sin alergias → verde con el texto exacto "Ninguna alergia conocida".

### RF-01.3 — Banner de nombre de pila (LGBTIQ+)
- Color **lila/morado**.
- Se muestra solo cuando el switch "Paciente de la comunidad LGBTIQ+" está activo **y** existe nombre de pila.
- **Nombre de pila obligatorio** cuando el switch está activo: mostrar asterisco, marcar error si está vacío y no mostrar el banner hasta completarlo.

**Criterios de aceptación:**
- [ ] Banner en tono lila.
- [ ] Activar el switch con nombre vacío marca el campo como requerido (error + aviso).
- [ ] El banner aparece al completar el nombre.

### RF-02 — Cuenta de atención
- La Historia Clínica pertenece a la **cuenta consultada** del paciente. El identificador de cuenta es **solo lectura** (no editable) y proviene del contexto.
- **No** se incluye una tarjeta independiente de "Cuenta de atención": el dato ya se muestra en la cabecera (RF-01).

**Criterios de aceptación:**
- [ ] La HC queda asociada a `cuentaAtencionId` sin permitir edición manual.

### RF-03 — (1) Motivo de consulta · **obligatorio**
- Campo narrativo (modal, multilínea).
- **Comillas automáticas:** el texto se **muestra entre comillas angulares** `«…»` automáticamente. Al editar, el modal carga el texto **sin** comillas (no se acumulan). El valor se almacena sin comillas (G-08).

**Criterios de aceptación:**
- [ ] No se puede firmar si está vacío.
- [ ] El motivo se visualiza entre `«…»`; el editor muestra el texto crudo sin comillas.

### RF-04 — (2) Presente Enfermedad · **obligatorio** · con **plantillas**
- Campo narrativo (modal, multilínea).
- Barra de **plantillas** (igual que Examen físico): seleccionar, **Aplicar**, **Guardar como plantilla**, **Eliminar** (ver §8).

**Criterios de aceptación:**
- [ ] Aplicar una plantilla vuelca su texto al campo.
- [ ] Guardar como plantilla solicita nombre y la agrega al selector.
- [ ] No se puede firmar si está vacío.

### RF-05 — (3) Antecedentes · **obligatorio**
Dos agrupadores: **Patológicos** (Alergias, Personales, Familiares) y **No Patológicos** (Ocupación, Hábitos). Cada subsección es un **componente reutilizable** con:
- **Toggle de estado** "Tiene" / negativo, donde el negativo es: Alergias→**Ninguna**, Personales→**Ninguno**, Familiares→**Ninguno**, Ocupación→**No aplica**, Hábitos→**No aplica**.
- Cuando el estado es **Tiene**: input + botón **Agregar** → **grid** de ítems (varios) con eliminar.
- Cuando el estado es **negativo** (Ninguno/Ninguna/No aplica): **se abre un modal de confirmación**; al confirmar, se **registra la auditoría** (usuario que ejecutó la acción + fecha/hora), se oculta el grid y la subsección cuenta como **válida**, mostrando una nota de auditoría (p. ej. *"NINGUNO · registrado por [usuario] el [fecha-hora]"*). Si había ítems capturados, el modal advierte que quedarán sin efecto. **Cancelar** revierte el switch a "Tiene".
- **Alergias**: captura **solo la sustancia/agente** (se eliminan severidad y reacción) y **sincroniza el banner** (RF-01.2). Confirmar "Ninguna" limpia los registros y pone el banner en verde.
- Bajo "Ver más": **Nombre de pila** + switch **LGBTIQ+** (RF-01.3).

**Criterios de aceptación:**
- [ ] Las 5 subsecciones permiten agregar múltiples registros en grid.
- [ ] Cambiar a Ninguno/No aplica abre modal de confirmación; al confirmar se guarda **usuario + timestamp** y se muestra la nota de auditoría; Cancelar revierte a "Tiene".
- [ ] El toggle negativo (confirmado) oculta el grid y valida la subsección.
- [ ] Alergias no pide severidad ni reacción y actualiza el banner.
- [ ] La sección Antecedentes es válida solo si **las 5** subsecciones lo son.

### RF-06 — (4) Examen físico · **obligatorio** · incluye **Signos vitales** y **plantillas**
La tarjeta de Examen físico es el paso (4) y se compone, **en este orden**:

**Subsección A — Signos vitales** (rendida **antes** de las plantillas; con badge "Obligatorio"). Captura por modal con alertas por umbrales críticos:
- **Presión arterial** (sistólica/diastólica) y **cardiorrespiratorios**: FC, FR, Temperatura, SpO₂, FiO₂ — *obligatorios*.
- **Neurológico/metabólico:** Escala de **Glasgow** (apertura/verbal/motora con **suma automática**), glucometría capilar.
- **Antropometría:** Peso (kg ↔ lb sincronizados), Talla (m ↔ ft sincronizados), **IMC** (calculado + clasificación), **Índice cintura-talla (ICT)** (calculado **junto al IMC**, con clasificación de riesgo), perímetro de cintura.
- **Balance hídrico:** balance, diuresis horaria.
- **Gineco-obstétrico** (solo si paciente femenina en edad fértil): FUR → **FPP por Naegele**, fórmula obstétrica.
- **Dolor:** escala EVA 0–10.

**Subsección B — Plantillas + campo Examen físico:** barra de **plantillas** (seleccionar/Aplicar/Guardar como plantilla/Eliminar; ver §8) seguida del **campo narrativo** Examen físico (modal, multilínea).

**Criterios de aceptación:**
- [ ] Signos vitales se renderiza **dentro** de Examen físico, **antes** de las plantillas, con badge "Obligatorio".
- [ ] PA y cardiorrespiratorios son obligatorios para registrar signos.
- [ ] IMC e ICT se calculan automáticamente y se muestran lado a lado; conversión bidireccional kg/lb y m/ft.
- [ ] Resumen (chips) muestra los valores capturados, incluyendo IMC e ICT.
- [ ] El campo Examen físico es obligatorio y tiene plantillas (Aplicar/Guardar/Eliminar).

### RF-07 — Formulario de Lesión de Causa Externa (botón verde, **parte de la HC**)
Entre **Examen físico** y **Diagnóstico** se muestra un **botón a lo ancho de la página, de color verde**, que abre el **Formulario de reporte de Lesión de Causa Externa** (MINSAL). El formulario es **parte de la Historia Clínica**: se abre en un modal a pantalla casi completa, encabezado por una barra que indica "Forma parte de la Historia Clínica", con acción **"Volver a la historia clínica"** (cierra también con `Esc`/clic afuera).

- El formulario se embebe **aislado** (iframe) para preservar el **100%** de su comportamiento sin colisiones de CSS/JS (G-10). En producción devuelve su estado a la HC vía `postMessage` para quedar **adjunto al mismo episodio/cuenta**.
- **Especificación completa del formulario: REQ-ECE-LCE-001.**

**Criterios de aceptación:**
- [ ] El botón verde aparece **a lo ancho**, entre Examen físico y Diagnóstico.
- [ ] Abre el formulario de Lesión de Causa Externa conservando toda su funcionalidad (mapa corporal, Glasgow, vistas Completa/Limpia, campos "Otro", etc.).
- [ ] El formulario se presenta como **parte de la HC** y permite volver a ella.
- [ ] El reporte queda **vinculado** al mismo episodio/cuenta (vía `postMessage` en producción).

### RF-08 — (5) Diagnósticos (CIE-11) · **obligatorio**
- Búsqueda **autocompletada** por código o descripción → agrega al **grid**.
- Columnas del grid: **Código**, **Descripción**, **Tipo** (`Presuntivo`/`Definitivo`/`Complementario`) y **Complemento** (campo editable **por cada diagnóstico**), más eliminar.

**Criterios de aceptación:**
- [ ] Se pueden agregar varios diagnósticos sin duplicar.
- [ ] Cada fila tiene su propio complemento editable.
- [ ] No se puede firmar con cero diagnósticos.

### RF-09 — (6) Procedimientos (CPT) · **opcional**
- Búsqueda **autocompletada** por código/nombre → **grid** con **Código**, **Procedimiento** y **Complemento por procedimiento**.

**Criterios de aceptación:**
- [ ] Marcado como **Opcional** en la UI (no bloquea la firma).
- [ ] Complemento editable por fila.

### RF-10 — (7) Misceláneos de consulta · **opcional**
Solicitudes y órdenes asociadas. Orden y contenido:
1. **Prescripción médica** (acción): se ubica **antes** de Laboratorio clínico. Invoca el módulo de recetario/indicaciones.
2. **Laboratorio clínico:** selector de sección (radios) → lista de exámenes con checkbox + cantidad → botón **"Agregar a la Solicitud"** → grid (sin duplicados, editar cantidad, eliminar).
3. **Exámenes de gabinete:** Radiología e imágenes; Estudios de cardiología. **Ecocardiograma** debe incluir: transtorácico, **transesofágico**, con Doppler, eco-estrés.
4. **Terapia Respiratoria** (componente propio, no genérico):
   - **Gasometría arterial:** opción **Basal** / **Con O₂ suplementario**. Al elegir O₂ suplementario, mostrar **FiO₂** (campo editable con unidad **%** a la par) y **Flujo** (campo editable con unidad **L/min** a la par).
   - **Nebulizaciones:** campo de **instrucciones** libre (sin checkboxes).
   - **Vibroterapia:** campo de **instrucciones** libre.
   - **Palmo percusión:** campo de **instrucciones** libre.
5. **Orden de Inyecciones:** agregar (modal) → grid.
6. **Tarjetas de acción** (navegan a otros módulos): **Orden de Ingreso hospitalario**, **Orden de interconsulta médica**, **Hoja de Remisión**, **Incapacidad médica**, **Constancia médica**.

**Criterios de aceptación:**
- [ ] Sección marcada como **Opcional**.
- [ ] Botón dice "Agregar a la Solicitud".
- [ ] Prescripción médica aparece antes de Laboratorio clínico.
- [ ] FiO₂ (%) y Flujo (L/min) aparecen solo con O₂ suplementario, con sus unidades visibles.
- [ ] Nebulizaciones, vibroterapia y palmo percusión tienen campo de instrucciones libre.
- [ ] Ecocardiograma incluye la opción transesofágico.
- [ ] Existe la tarjeta de Constancia médica.

### RF-11 — (8) Análisis clínico · **obligatorio**
- Campo narrativo (modal, multilínea) — razonamiento/correlación clínica.

**Criterios de aceptación:** [ ] No se puede firmar si está vacío.

### RF-12 — (9) Plan + Destino · **obligatorio**
- **Plan de manejo:** **grid** que permite agregar **varias** indicaciones (cada una vía modal) con eliminar.
- **Destino** (obligatorio, selección única): `Alta médica`, `Alta voluntaria`, `Ingreso hospitalario`, `Observación`, `Seguimiento`, `Remisión a otro centro`, `Fallecido`.

**Criterios de aceptación:**
- [ ] Plan permite múltiples indicaciones (mínimo una para firmar).
- [ ] Destino con exactamente las 7 opciones indicadas.

### RF-13 — (10) Firma del médico · **obligatorio**
- Mostrar la firma del médico tratante con su **grafo (firma registrada)** y **sello**, **traídos automáticamente de la ficha médica** del médico (incluye nombre y **JVPM**). No se editan en esta pantalla.

**Criterios de aceptación:**
- [ ] El grafo y el sello se cargan desde la ficha médica del médico autenticado.
- [ ] Se muestra nombre y registro (JVPM).

### RF-14 — Validación y guardado
Acciones del pie de página: **Cancelar**, **Guardar borrador**, **Guardar y firmar**.
- **Guardar borrador:** persiste sin validar obligatorios (estado `BORRADOR`).
- **Guardar y firmar:** ejecuta la validación de obligatorios (§7). Si faltan campos: resaltar cada uno (rojo), listar los faltantes y hacer scroll al primero. Si todo está completo: confirmar "Historia clínica validada y firmada correctamente", aplicar firma y dejar el registro **inmutable** (estado `FIRMADA`).

**Criterios de aceptación:**
- [ ] Con campos faltantes, se marcan y listan; no se firma.
- [ ] Con todo completo, se firma y se invoca el flujo de cierre (motor MINSAL 1616).

---

## 7. Reglas de validación (obligatorios vs. opcionales)

| Bloque | Obligatorio | Regla de "completo" |
|---|---|---|
| Motivo de consulta | ✅ | Texto no vacío (se muestra entre `«…»`) |
| Presente Enfermedad | ✅ | Texto no vacío |
| Antecedentes (Alergias, Personales, Familiares, Ocupación, Hábitos) | ✅ | Cada subsección: estado negativo **confirmado** (con auditoría) **o** ≥1 ítem |
| Examen físico (incluye Signos vitales) | ✅ | Texto de examen no vacío |
| Diagnóstico (CIE-11) | ✅ | ≥1 diagnóstico |
| Análisis clínico | ✅ | Texto no vacío |
| Plan de manejo | ✅ | ≥1 indicación |
| Destino | ✅ | Valor seleccionado |
| Firma del médico | ✅ | Grafo + sello presentes (de ficha médica) |
| Signos vitales | Parcial | PA + cardiorrespiratorios obligatorios para registrar el bloque (subsección de Examen físico) |
| **Procedimientos (CPT)** | ❌ Opcional | — |
| **Misceláneos de consulta** | ❌ Opcional | — |
| **Formulario Lesión de Causa Externa** | ❌ Opcional (se firma aparte) | Tiene su propia validación (REQ-ECE-LCE-001 §12) |

---

## 8. Plantillas (Presente Enfermedad y Examen físico)

- Componente reutilizable: **selector** de plantillas + acciones **Aplicar**, **Guardar como plantilla** (pide nombre), **Eliminar**.
- "Aplicar" sobrescribe el contenido del campo asociado; el contenido se normaliza a mayúsculas (G-01).
- **Versión actual:** plantillas **en sesión** (semilla de ejemplos). **Adaptación HIS:** persistir plantillas por médico/organización (tabla `PlantillaTexto { id, ambito:'EXAMEN'|'ENFERMEDAD', alcance:'MEDICO'|'ORG', nombre, texto, ownerId }`) y exponerlas vía tRPC; mantener las acciones de la UI.

---

## 9. Integraciones

| Integración | Detalle |
|---|---|
| **Catálogo CIE-11** | Búsqueda autocompletada por código/descripción. En el prototipo es un catálogo demostrativo; conectar al catálogo CIE-11 real del proyecto. |
| **Catálogo CPT** | Ídem, autocompletado por código/nombre. |
| **Catálogos de exámenes** | Laboratorio, radiología y cardiología (estructura sección → exámenes). |
| **Ficha médica** | Origen del grafo, sello, nombre y JVPM del médico firmante. |
| **Cuenta de atención / Expediente** | Origen (solo lectura) de paciente, documento, tipo de cuenta, domicilio, expediente y cuenta hospitalaria. |
| **Motor de workflow (MINSAL 1616)** | Invocar al firmar para el cierre/estado del episodio. |

---

## 10. Diseño / UI (Design System v2.0)

- Tokens OKLCH; **modo claro y oscuro**. Colores semánticos: alérgeno (rojo), éxito (verde, para "sin alergias" y para el **botón del formulario de Lesión de Causa Externa**), **lila** (banner de nombre de pila), primario navy / acento teal.
- Cabecera fija; bloques en tarjetas numeradas (**1…10**) con indicador de paso (Signos vitales va dentro del paso 4, Examen físico).
- Campos resaltados (chips) en la cabecera; insignias monoespaciadas para expediente/cuenta; **iconografía de sexo** (Venus rosa / Marte azul marino).
- Iconografía: **cacahuate** para alergias; verificación para estados positivos/sin alergias.
- **Botón verde a lo ancho** entre Examen físico y Diagnóstico (abre el formulario LCE).
- Formato mínimo y consistente; respetar la tipografía del sistema.

---

## 11. Accesibilidad

- Banners con `role="alert"` (alergias) y `role="status"` (nombre de pila).
- Modales: foco inicial, cierre con `Esc` y clic fuera, etiquetas asociadas.
- Toggles de antecedentes operables con teclado.
- Contraste suficiente en ambos temas.

---

## 12. Criterios de aceptación globales (Definition of Done)

- [ ] Los **10 bloques** se renderizan y persisten conforme a §6 (Signos vitales dentro de Examen físico).
- [ ] La cabecera es de solo lectura (salvo contacto de emergencia, 3 campos) e incluye **iconografía de sexo** (Venus rosa / Marte azul marino).
- [ ] Banner de alergias rojo+cacahuate / verde+"Ninguna alergia conocida".
- [ ] Banner de nombre de pila lila + obligatoriedad al activar LGBTIQ+.
- [ ] **Motivo de consulta** se visualiza entre `«…»` (valor almacenado sin comillas).
- [ ] Antecedentes con grids y toggle Tiene/Ninguno|No aplica (5 subsecciones); el estado negativo abre **modal de confirmación** y guarda **usuario + fecha/hora** (auditoría).
- [ ] Diagnósticos y procedimientos con complemento **por fila**.
- [ ] Terapia respiratoria con FiO₂(%)/Flujo(L/min) condicionados a O₂ y campos de instrucciones libres.
- [ ] Plan en grid y Destino con las 7 opciones; CPT y Misceláneos marcados opcionales.
- [ ] **Botón verde** entre Examen físico y Diagnóstico abre el **Formulario de Lesión de Causa Externa** (parte de la HC) conservando toda su funcionalidad.
- [ ] Firma con grafo + sello desde la ficha médica.
- [ ] Validación de obligatorios en "Guardar y firmar" (resalta, lista y enfoca faltantes).
- [ ] Todo el texto escrito se almacena/muestra en mayúsculas.
- [ ] Funciona en modo claro y oscuro; sin uso de almacenamiento del navegador.

---

## 13. Supuestos y pendientes

- **Demostrativo en el prototipo (a conectar a backend):** catálogos CIE-11/CPT y de exámenes, plantillas, grafo/sello, y datos del paciente/cuenta.
- **Inmutabilidad:** definir si "Guardar y firmar" bloquea toda edición posterior (se asume sí; addendos como nuevo registro).
- **Tipo de documento:** la cabecera debe soportar `DUI`/`DNI`/`PASAPORTE`/`DUI_RESP` según el paciente (multipaís).
- **Permisos:** solo el médico autenticado con ficha médica válida puede firmar.
- **Formulario de Lesión de Causa Externa:** es parte de la HC (RF-07); en el prototipo se embebe aislado (iframe). En producción debe devolver su estado vía `postMessage` y quedar adjunto al episodio (REQ-ECE-LCE-001 §11).
- **Auditoría de antecedentes negativos:** `registradoPor` proviene del usuario autenticado y `registradoEn` se sella en **servidor (UTC)** (en el prototipo se usa la hora del navegador).
- **Comillas del motivo:** son de presentación; el valor se persiste sin comillas (G-08).

---

## 14. Mapeo sugerido a la arquitectura

- **Rutas tRPC:** `historiaClinica.crearBorrador`, `historiaClinica.guardar`, `historiaClinica.firmar`, `catalogos.cie11.buscar`, `catalogos.cpt.buscar`, `catalogos.examenes.listar`, `medico.fichaMedica.obtenerFirma`, `paciente.contextoCuenta`, `lce.*` (formulario de Lesión de Causa Externa, REQ-ECE-LCE-001 §11).
- **Componentes React sugeridos:** `PacienteHeader` (con `IconoSexo`), `BannerAlergias`, `BannerNombrePila`, `CampoModal` (con comillas opcionales para Motivo), `AntecedenteGrid` (reutilizable ×5, con `ModalConfirmacion` + auditoría), `ModalConfirmacion` (genérico), `ExamenFisico` (contiene `SignosVitalesModal` + `PlantillasBar` + campo), `PlantillasBar` (reutilizable ×2), `BuscadorCatalogo` (CIE-11/CPT), `OrdenExamenes` (reutilizable), `TerapiaRespiratoria`, `BotonFormularioLCE` + `ModalLCE` (iframe + `postMessage`), `PlanGrid`, `FirmaMedico`, `FooterValidacion`.
- **Validación:** esquema Zod por bloque + validador agregado para la firma (refleja §7).
- **Estado:** formulario controlado (React Hook Form o equivalente del proyecto); sin `localStorage`.

---

## 15. Relación con el Formulario de Lesión de Causa Externa

El **Formulario de reporte de Lesión de Causa Externa** (MINSAL) **es parte de la Historia Clínica**: se invoca desde el botón verde entre Examen físico y Diagnóstico (RF-07), se presenta como parte de la HC y debe quedar **adjunto al mismo episodio/cuenta**. Su captura, campos, catálogos, mapa corporal, vistas y persistencia se especifican por separado en **REQ-ECE-LCE-001** (que reutiliza del expediente los datos del paciente/médico y persiste lo epidemiológico no almacenado). Ambos documentos son complementarios y deben implementarse de forma coherente: el reporte LCE referencia `historiaClinicaId`.

---

## 16. Migración de base de datos y ORM (Prisma → Supabase/PostgreSQL)

> Objetivo: llevar los cambios de estructura de §5 (y de REQ-ECE-LCE-001 §9–§10) a la base de datos y al ORM de forma **aditiva, no disruptiva, reversible y preservando datos**. La base ya tiene datos en dev/producción; ninguna migración debe borrar columnas con información ni romper el motor de workflow (MINSAL 1616), triggers o RLS existentes.

### 16.1 Principios de migración
1. **Aditivo primero:** nuevas tablas, nuevos `enum`, nuevas columnas **nullable** o con `default`. Nunca `DROP` de columnas con datos en la misma fase.
2. **Renombrar, no recrear:** los cambios de nombre de campo se hacen con `ALTER TABLE … RENAME COLUMN` (migración de *rename* en Prisma), **preservando los datos**. Prohibido drop+create para renombrar.
3. **Backfill antes de endurecer:** poblar/defaultear datos existentes y, en una **segunda** migración, recién entonces aplicar `NOT NULL`/`UNIQUE`.
4. **Reversibilidad:** cada migración con su rollback; probar `migrate` en local → staging → producción.
5. **Sin acoplar el cliente:** desplegar **DB antes que la UI**; mantener compatibilidad hacia atrás durante la ventana de despliegue.

### 16.2 Cambios concretos a aplicar

**Enums nuevos** (crear si no existen): `AntecedenteTipo(ALERGIA,PERSONAL,FAMILIAR,OCUPACION,HABITO)`, `AntecedenteEstado(TIENE,NINGUNO,NO_APLICA)`, `TipoCuenta(CONVENIO,PARTICULAR,ASEGURADORA,LICITACIONES)`, `TipoDocumento(DUI,DNI,PASAPORTE,DUI_RESP)`, `Destino(ALTA_MEDICA,ALTA_VOLUNTARIA,INGRESO_HOSPITALARIO,OBSERVACION,SEGUIMIENTO,REMISION_OTRO_CENTRO,FALLECIDO)`, `TipoDiagnostico(PRESUNTIVO,DEFINITIVO,COMPLEMENTARIO)`, `GasometriaModo(BASAL,O2_SUPLEMENTARIO)`, `EstadoHistoria(BORRADOR,FIRMADA)`. Para el formulario LCE: los enums de REQ-ECE-LCE-001 §9.

**Cambios en tablas existentes / nuevas columnas:**

| Tabla | Cambio | Tipo | Backfill |
|---|---|---|---|
| `HistoriaClinica` | asegurar `estado` (EstadoHistoria), `firmadaEn`, `destino` (Destino) | columnas | `estado`=`FIRMADA` si `firmadaEn` no nulo, si no `BORRADOR` |
| Campos narrativos | **rename** `presentaEnfermedad` → `presenteEnfermedad` | rename | preserva datos (no drop) |
| `motivo` | sin cambio de esquema; **limpiar comillas** `«…»` almacenadas si existieran | data fix | `UPDATE` quitando `«»` (G-08: comillas son de presentación) |
| `Antecedente` | add `estado` (AntecedenteEstado), `registradoPor`, `registradoEn` | columnas | `estado`=`TIENE` por defecto; auditoría null hasta nuevo marcaje |
| `Diagnostico` | add `complemento` (text, **por fila**) | columna | null |
| `Procedimiento` | add `complemento` (text, **por fila**) | columna | null |
| `SignosVitales` | asegurar antropometría (`pesoKg`,`tallaM`,`imc`,`ict`,`perimetroCintura`), `glasgow*`, `evaDolor`, gineco (`fur`,`fpp`) | columnas | null (IMC/ICT recalculables) |
| `TerapiaRespiratoria` | add `gasometria` (GasometriaModo), `fio2Pct`, `flujoLpm`, `nebulizacionesInstr`, `vibroterapiaInstr`, `palmoPercusionInstr` | columnas | null |
| `ContactoEmergencia` | **3 campos**: `nombre`, `parentesco`, `telefono` | columnas/rename | si existía como texto único, parsear a 3 campos; `parentesco` puede quedar null |

**Tablas nuevas:** `OrdenExamen`, `OrdenInyeccion`, `PlanItem`, `PlantillaTexto` (ver §8), y las del formulario LCE: `ReporteLesionCausaExterna`, `ReporteLceSeleccion`, `ReporteLceSitio` y catálogos LCE (**REQ-ECE-LCE-001 §9–§10**). Todas con FK a `HistoriaClinica`/`cuentaAtencion` según corresponda.

**Índices y restricciones:**
- FK + índice en toda tabla hija por `historiaClinicaId` (consulta por historia).
- Índice en `Antecedente(historiaClinicaId, tipo)`.
- Mantener el **índice único parcial de `DUI_RESP`** ya existente (no alterar).
- `ReporteLesionCausaExterna.historiaClinicaId` único o 1‑N según política (un reporte por evento).

### 16.3 Procedimiento (ORM)
1. Editar `schema.prisma` con enums, modelos y el **rename** (`@@map`/`@map` solo si aplica; el rename de columna se materializa en la migración).
2. `prisma migrate dev --name ece_hc_v1_1_estructuras` en local; revisar el SQL generado para confirmar que el rename es `RENAME COLUMN` (no `DROP`/`ADD`).
3. Migración de **backfill** separada (`--name ece_hc_v1_1_backfill`) con los `UPDATE` de la tabla anterior.
4. Migración de **endurecimiento** (`NOT NULL`/`UNIQUE`) tras validar backfill.
5. `prisma generate`; correr **typecheck** en todo el monorepo (ver §17).
6. Aplicar en orden **local → staging → producción** con `prisma migrate deploy` (CI/Vercel). Desplegar la DB **antes** que la UI.
7. **Supabase:** crear/ajustar **RLS policies** de las tablas nuevas (lectura/escritura por establecimiento y rol); verificar que triggers y el motor de workflow sigan operando.

### 16.4 Criterios de aceptación (migración)
- [ ] El SQL del rename `presentaEnfermedad`→`presenteEnfermedad` **preserva los datos** (no hay drop+create).
- [ ] Todas las columnas nuevas son nullable o con default; ninguna migración borra datos.
- [ ] Backfill aplicado (estados de antecedente, limpieza de comillas del motivo, split de contacto de emergencia).
- [ ] FKs e índices creados; índice único parcial de `DUI_RESP` intacto.
- [ ] Tablas y catálogos del formulario LCE creados (REQ-ECE-LCE-001).
- [ ] RLS configurado para las tablas nuevas; workflow/triggers sin regresión.
- [ ] `prisma generate` ejecutado y el cliente tipa correctamente en todo el monorepo.
- [ ] Migraciones aplicadas y verificadas en local, staging y producción.

---

## 17. Impacto en otras pantallas y validación de regresión

> Estas estructuras de datos **se comparten** con otras pantallas/módulos del HIS. Todo cambio de esquema o de contrato debe **validarse en cada consumidor** para evitar regresiones. Antes de dar por cerrada la implementación, revisar y probar las pantallas siguientes.

### 17.1 Pantallas/módulos que consumen estos datos

| Pantalla / módulo | Datos compartidos | Qué validar |
|---|---|---|
| **Evolución Médica (nota SOAP)** | Signos vitales, Antecedentes (visualización), **Contacto de emergencia (editable)**, Diagnóstico | Que use el **mismo** modelo de signos vitales y el contacto de **3 campos**; que muestre el `estado` y la auditoría de antecedentes; complemento por diagnóstico. |
| **Expediente / Pre‑registro del paciente** | Paciente (documento, sexo, domicilio, F. Nac.), cuenta y **tipo de cuenta** | `TipoDocumento` (`DUI/DNI/PASAPORTE/DUI_RESP`) y `TipoCuenta` consistentes; el sexo alimenta la **iconografía** de la cabecera; edad derivada de F. Nac. |
| **Historia Clínica — listado / detalle / impresión** | Todos los campos de la HC | Render de `motivo` entre `«…»`; campo renombrado `presenteEnfermedad`; complemento por dx/cpt; antecedentes con estado + auditoría; numeración de bloques 1–10. |
| **Reportes / Epidemiología** | `ReporteLesionCausaExterna` + hijas; selecciones y mapa corporal | Que los nuevos datos epidemiológicos se expongan a tableros/exportaciones; la copia para la **Unidad de Epidemiología**; compatibilidad con la plataforma de reportes (Airflow) leyendo desde Supabase. |
| **Motor de workflow (MINSAL 1616)** | `HistoriaClinica.estado`, `firmadaEn`, cierre del episodio | Que el cierre al firmar siga disparando el flujo con los campos de estado correctos. |
| **Ficha médica** | `grafo`, `sello`, `nombre`, `JVPM` | Contrato estable: HC y formulario LCE consumen la firma desde la ficha; sin duplicar. |
| **Catálogos** (CIE‑11, CPT, exámenes, catálogos LCE) | Códigos/etiquetas | Versionado y resultado visual idéntico; sin romper búsquedas existentes. |
| **Plantillas de texto** | `PlantillaTexto` | Si otras pantallas comparten plantillas, respetar `ambito`/`alcance`. |

### 17.2 Checklist de validación transversal
- [ ] Actualizar **tipos compartidos** (cliente Prisma + DTOs/Zod) y correr **typecheck** en todo el monorepo.
- [ ] **Buscar en el código** todas las referencias al campo renombrado `presentaEnfermedad` y migrarlas a `presenteEnfermedad`.
- [ ] Revisar **read models / `select` explícitos** que enumeren columnas (que no omitan ni rompan por las nuevas).
- [ ] Revisar **exportaciones/reportes** que listen columnas o que dependan del formato del `motivo` (comillas) o del contacto de emergencia (1 vs 3 campos).
- [ ] Validar componentes **reutilizados** (signos vitales, contacto de emergencia, buscador de catálogos) en cada pantalla que los monte.
- [ ] Ejecutar **pruebas de regresión/e2e** en cada pantalla de §17.1.
- [ ] Confirmar que la **migración está aplicada en todos los ambientes** antes de desplegar la UI que usa los nuevos campos.
- [ ] Verificar **RLS y permisos** en las pantallas que leen/escriben las tablas nuevas.

### 17.3 Definición de "listo" (impacto)
- [ ] Ninguna pantalla existente se rompe por el rename, las nuevas columnas o las nuevas tablas.
- [ ] Evolución Médica y Pre‑registro comparten exactamente los mismos modelos/contratos (sin divergencias).
- [ ] El reporte LCE queda disponible para Epidemiología y vinculado a la HC.
- [ ] Typecheck y pruebas de regresión en verde en el monorepo.


---

> **Referencia visual:** prototipo `historia-clinica-avante.html` (versión consolidada **v1.1**, incluye el formulario de Lesión de Causa Externa embebido). Documentos complementarios: **REQ-ECE-LCE-001** (formulario LCE). Este documento prevalece ante cualquier discrepancia con el prototipo.
