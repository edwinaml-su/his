# REQ-ECE-HC-001 — Pantalla "Historia Clínica" (Expediente Clínico Electrónico)

| Campo | Valor |
|---|---|
| **ID** | REQ-ECE-HC-001 |
| **Módulo** | ECE — Expediente Clínico Electrónico |
| **Pantalla** | `Historia Clínica` (captura/registro de la HCE) |
| **Versión** | 1.0 (consolida las iteraciones del prototipo HTML) |
| **Autor** | Edwin Martínez — TTD / Inversiones Avante |
| **Estado** | Listo para implementación |
| **Prioridad** | Alta |
| **Stack destino** | Next.js (App Router) · tRPC · Prisma · Supabase/PostgreSQL · Vercel |
| **Design System** | Avante DS v2.0 (navy `#0B3D5C` / teal `#00A8B5`, tokens OKLCH, modo claro + oscuro) |
| **Cumplimiento** | MINSAL Acuerdo 1616 · NTEC · JCI IPSG (alérgenos/identificación del paciente) |

> **Propósito de este documento.** Especificar de forma completa y verificable la pantalla de captura de la Historia Clínica Electrónica para que Claude Code la implemente y la adapte al monorepo de HIS Multipaís. El prototipo HTML autónomo es la **referencia visual y de comportamiento**; este documento es la fuente de verdad funcional. Donde haya conflicto, prevalece este documento.

---

## 1. Objetivo

Permitir al médico registrar una Historia Clínica completa asociada a una **cuenta de atención** del paciente, siguiendo el orden clínico estándar (motivo → enfermedad → antecedentes → exploración → diagnósticos → plan), con captura asistida (plantillas, catálogos CIE-11/CPT, calculadoras de signos vitales), validación de campos obligatorios y firma del médico, dejando un registro inmutable al guardar y firmar.

---

## 2. Contexto y stack

- **Frontend:** Next.js App Router + React + componentes del Design System v2.0. Estado local con React (sin `localStorage`).
- **API:** tRPC (routers por agregado: `historiaClinica`, `catalogos`, `paciente`, `medico`).
- **Persistencia:** Prisma sobre Supabase/PostgreSQL. El motor de workflow clínico data-driven (MINSAL Acuerdo 1616) ya existente debe poder invocarse al firmar.
- **Identidad/seguridad:** el paciente y su cuenta provienen del contexto de la consulta activa (no se capturan en esta pantalla). El médico firmante proviene de la sesión autenticada (Entra/IdP) y su **ficha médica**.

---

## 3. Alcance

### 3.1 Incluido
- Cabecera fija de paciente (solo lectura) + contacto de emergencia (editable).
- Captura de los 11 bloques clínicos descritos en §6.
- Validación de obligatorios y acción **Guardar y firmar**.
- Plantillas reutilizables (Presenta Enfermedad y Examen físico).
- Integración con catálogos CIE-11 y CPT.
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

---

## 5. Modelo de datos (sugerencia de mapeo Prisma)

> Alinear con el esquema ECE existente en Supabase. Los nombres son orientativos; respetar las convenciones del proyecto (expediente inmutable, formato de cuenta `códigoPaís + añoNacimiento + correlativo`, índice único parcial para `DUI_RESP`).

| Entidad | Campos clave | Notas |
|---|---|---|
| `HistoriaClinica` | `id`, `cuentaAtencionId` (FK, **inmutable**), `pacienteId`, `medicoId`, `estado` (`BORRADOR`\|`FIRMADA`), `firmadaEn`, `createdAt` | Cabecera del registro. |
| `MotivoConsulta` / campos narrativos | `motivo`, `presentaEnfermedad`, `examenFisico`, `analisisClinico` (text) | Pueden ir como columnas de `HistoriaClinica`. |
| `Antecedente` | `id`, `hcId`, `tipo` (`ALERGIA`\|`PERSONAL`\|`FAMILIAR`\|`OCUPACION`\|`HABITO`), `estado` (`TIENE`\|`NINGUNO`\|`NO_APLICA`), `descripcion` | Un registro por ítem cuando `estado=TIENE`; un único registro marcador cuando negativo. |
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
- **Tipo de cuenta**: una de `CONVENIO`/`PARTICULAR`/`ASEGURADORA`/`LICITACIONES` (derivada de la cuenta, solo lectura).

**Criterios de aceptación:**
- [ ] El nombre se renderiza a 34 px y la cabecera permanece fija al hacer scroll.
- [ ] Expediente y cuenta hospitalaria aparecen junto al nombre.
- [ ] El documento se muestra entre edad y sexo, con su tipo (`DUI`/`DNI`/`PASAPORTE`/`DUI_RESP`).
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

**Criterios de aceptación:** [ ] No se puede firmar si está vacío.

### RF-04 — (2) Presenta Enfermedad · **obligatorio** · con **plantillas**
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
- Cuando el estado es **negativo**: se oculta el grid y la subsección cuenta como **válida**.
- **Alergias**: captura **solo la sustancia/agente** (se eliminan severidad y reacción) y **sincroniza el banner** (RF-01.2).
- Bajo "Ver más": **Nombre de pila** + switch **LGBTIQ+** (RF-01.3).

**Criterios de aceptación:**
- [ ] Las 5 subsecciones permiten agregar múltiples registros en grid.
- [ ] El toggle negativo oculta el grid y valida la subsección.
- [ ] Alergias no pide severidad ni reacción y actualiza el banner.
- [ ] La sección Antecedentes es válida solo si **las 5** subsecciones lo son.

### RF-06 — (4) Signos vitales · BP + cardiorrespiratorios **obligatorios**, resto opcional
Captura por modal con alertas por umbrales críticos. Bloques:
- **Presión arterial** (sistólica/diastólica) y **cardiorrespiratorios**: FC, FR, Temperatura, SpO₂, FiO₂ — *obligatorios*.
- **Neurológico/metabólico:** Escala de **Glasgow** (apertura/verbal/motora con **suma automática**), glucometría capilar.
- **Antropometría:** Peso (kg ↔ lb sincronizados), Talla (m ↔ ft sincronizados), **IMC** (calculado + clasificación), **Índice cintura-talla (ICT)** (calculado **junto al IMC**, con clasificación de riesgo), perímetro de cintura.
- **Balance hídrico:** balance, diuresis horaria.
- **Gineco-obstétrico** (solo si paciente femenina en edad fértil): FUR → **FPP por Naegele**, fórmula obstétrica.
- **Dolor:** escala EVA 0–10.

**Criterios de aceptación:**
- [ ] PA y cardiorrespiratorios son obligatorios para registrar signos.
- [ ] IMC e ICT se calculan automáticamente y se muestran lado a lado.
- [ ] Conversión bidireccional kg/lb y m/ft.
- [ ] Resumen (chips) muestra los valores capturados, incluyendo IMC e ICT.

### RF-07 — (5) Examen físico · **obligatorio** · con **plantillas**
- Campo narrativo (modal, multilínea).
- Barra de **plantillas** (seleccionar/Aplicar/Guardar como plantilla/Eliminar; ver §8).

**Criterios de aceptación:** [ ] Igual que RF-04 (plantillas) + obligatorio.

### RF-08 — (6) Diagnósticos (CIE-11) · **obligatorio**
- Búsqueda **autocompletada** por código o descripción → agrega al **grid**.
- Columnas del grid: **Código**, **Descripción**, **Tipo** (`Presuntivo`/`Definitivo`/`Complementario`) y **Complemento** (campo editable **por cada diagnóstico**), más eliminar.

**Criterios de aceptación:**
- [ ] Se pueden agregar varios diagnósticos sin duplicar.
- [ ] Cada fila tiene su propio complemento editable.
- [ ] No se puede firmar con cero diagnósticos.

### RF-09 — (7) Procedimientos (CPT) · **opcional**
- Búsqueda **autocompletada** por código/nombre → **grid** con **Código**, **Procedimiento** y **Complemento por procedimiento**.

**Criterios de aceptación:**
- [ ] Marcado como **Opcional** en la UI (no bloquea la firma).
- [ ] Complemento editable por fila.

### RF-10 — (8) Misceláneos de consulta · **opcional**
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

### RF-11 — (9) Análisis clínico · **obligatorio**
- Campo narrativo (modal, multilínea) — razonamiento/correlación clínica.

**Criterios de aceptación:** [ ] No se puede firmar si está vacío.

### RF-12 — (10) Plan + Destino · **obligatorio**
- **Plan de manejo:** **grid** que permite agregar **varias** indicaciones (cada una vía modal) con eliminar.
- **Destino** (obligatorio, selección única): `Alta médica`, `Alta voluntaria`, `Ingreso hospitalario`, `Observación`, `Seguimiento`, `Remisión a otro centro`, `Fallecido`.

**Criterios de aceptación:**
- [ ] Plan permite múltiples indicaciones (mínimo una para firmar).
- [ ] Destino con exactamente las 7 opciones indicadas.

### RF-13 — (11) Firma del médico · **obligatorio**
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
| Motivo de consulta | ✅ | Texto no vacío |
| Presenta Enfermedad | ✅ | Texto no vacío |
| Antecedentes (Alergias, Personales, Familiares, Ocupación, Hábitos) | ✅ | Cada subsección: estado negativo **o** ≥1 ítem |
| Examen físico | ✅ | Texto no vacío |
| Diagnóstico (CIE-11) | ✅ | ≥1 diagnóstico |
| Análisis clínico | ✅ | Texto no vacío |
| Plan de manejo | ✅ | ≥1 indicación |
| Destino | ✅ | Valor seleccionado |
| Firma del médico | ✅ | Grafo + sello presentes (de ficha médica) |
| Signos vitales | Parcial | PA + cardiorrespiratorios obligatorios para registrar el bloque |
| **Procedimientos (CPT)** | ❌ Opcional | — |
| **Misceláneos de consulta** | ❌ Opcional | — |

---

## 8. Plantillas (Presenta Enfermedad y Examen físico)

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

- Tokens OKLCH; **modo claro y oscuro**. Colores semánticos: alérgeno (rojo), éxito (verde, para "sin alergias"), **lila** (banner de nombre de pila), primario navy / acento teal.
- Cabecera fija; bloques en tarjetas numeradas (1…11) con indicador de paso.
- Campos resaltados (chips) en la cabecera; insignias monoespaciadas para expediente/cuenta.
- Iconografía: **cacahuate** para alergias; verificación para estados positivos/sin alergias.
- Formato mínimo y consistente; respetar la tipografía del sistema.

---

## 11. Accesibilidad

- Banners con `role="alert"` (alergias) y `role="status"` (nombre de pila).
- Modales: foco inicial, cierre con `Esc` y clic fuera, etiquetas asociadas.
- Toggles de antecedentes operables con teclado.
- Contraste suficiente en ambos temas.

---

## 12. Criterios de aceptación globales (Definition of Done)

- [ ] Los 11 bloques se renderizan y persisten conforme a §6.
- [ ] La cabecera es de solo lectura (salvo contacto de emergencia, 3 campos).
- [ ] Banner de alergias rojo+cacahuate / verde+"Ninguna alergia conocida".
- [ ] Banner de nombre de pila lila + obligatoriedad al activar LGBTIQ+.
- [ ] Antecedentes con grids y toggle Tiene/Ninguno|No aplica (5 subsecciones).
- [ ] Diagnósticos y procedimientos con complemento **por fila**.
- [ ] Terapia respiratoria con FiO₂(%)/Flujo(L/min) condicionados a O₂ y campos de instrucciones libres.
- [ ] Plan en grid y Destino con las 7 opciones; CPT y Misceláneos marcados opcionales.
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

---

## 14. Mapeo sugerido a la arquitectura

- **Rutas tRPC:** `historiaClinica.crearBorrador`, `historiaClinica.guardar`, `historiaClinica.firmar`, `catalogos.cie11.buscar`, `catalogos.cpt.buscar`, `catalogos.examenes.listar`, `medico.fichaMedica.obtenerFirma`, `paciente.contextoCuenta`.
- **Componentes React sugeridos:** `PacienteHeader`, `BannerAlergias`, `BannerNombrePila`, `CampoModal`, `AntecedenteGrid` (reutilizable ×5), `SignosVitalesModal`, `PlantillasBar` (reutilizable ×2), `BuscadorCatalogo` (CIE-11/CPT), `OrdenExamenes` (reutilizable), `TerapiaRespiratoria`, `PlanGrid`, `FirmaMedico`, `FooterValidacion`.
- **Validación:** esquema Zod por bloque + validador agregado para la firma (refleja §7).
- **Estado:** formulario controlado (React Hook Form o equivalente del proyecto); sin `localStorage`.

---

> **Referencia visual:** prototipo `historia-clinica-avante.html` (versión consolidada). Este documento prevalece ante cualquier discrepancia con el prototipo.
