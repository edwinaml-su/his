# REQ-ECE-LCE-001 — Formulario de reporte de Lesión de Causa Externa (módulo embebido)

| | |
|---|---|
| **Código** | REQ-ECE-LCE-001 |
| **Módulo** | ECE — Expediente Clínico Electrónico · Emergencia |
| **Sistema** | HIS Multipaís |
| **Tipo** | Componente de formulario reutilizable, embebido tras un botón en un formulario contenedor |
| **Insumo de referencia** | `historia-clinica-lesion-causa-externa.html` (mockup validado) |
| **Stack destino** | Next.js (App Router) · TypeScript · tRPC · Prisma · Supabase/PostgreSQL · Vercel |
| **Design System** | Avante DS v2.0 (tokens OKLCH, primarios navy/teal) |

---

## 1. Objetivo

Implementar, en el stack productivo, el **Formulario de reporte de Lesión de Causa Externa** (copia para Unidad de Epidemiología, formato MINSAL) **conservando exactamente los mismos campos, el mismo comportamiento y el mismo look & feel** del mockup HTML de referencia.

El formulario **no es una pantalla independiente**: debe poder **abrirse desde un botón ubicado dentro de otro formulario** (el "formulario contenedor", p. ej. el registro de atención/emergencia) y **formar parte de él** — sus datos viven en el estado del formulario contenedor y se persisten junto con la atención, no como un envío aislado.

El mockup ya contempla este caso con su **Vista "Limpia" (embebida)**: esa es la variante que se monta dentro del contenedor.

---

## 2. Alcance

**Incluye**
- Componente React `LesionCausaExternaForm` con la totalidad de campos y catálogos del mockup.
- Wrapper de integración `LesionCausaExternaModalButton` (botón + modal/drawer + estado de avance) para insertarlo en el formulario contenedor.
- Comportamientos funcionales del mockup (sección 8) replicados 1:1.
- Mapa corporal interactivo (sección 9).
- Autocompletado desde expediente/sesión y campos de solo lectura (sección 10).
- Firma y sello del médico desde su ficha (sección 11).
- Impresión de la vista completa (sección 12).
- Modelo de datos Prisma + API tRPC + persistencia ligada a la atención (secciones 14–15).
- Mapeo del look & feel a tokens de Avante DS v2.0 (sección 13).

**No incluye** (ver sección 18): catálogos CIE-11/CPT en este formulario, autenticación, y la pantalla contenedora en sí (solo el contrato de integración).

---

## 3. Contexto técnico y convenciones

- **Lenguaje/UI:** TypeScript, React (Server/Client Components según App Router). El formulario es **Client Component** (`"use client"`) por su interactividad.
- **Formularios:** usar la librería de formularios vigente del proyecto (React Hook Form + Zod recomendado). El esquema Zod debe reflejar 1:1 el modelo de datos de la sección 6.
- **Estado:** el formulario es **controlado por el contenedor** vía `value` / `onChange` (lifting state up). No mantiene estado global propio ni hace fetch del contenedor.
- **Estilos:** usar **únicamente tokens de Avante DS v2.0** (OKLCH). Prohibido dejar los HEX del mockup hardcodeados; deben sustituirse por tokens preservando el resultado visual (sección 13).
- **i18n:** textos en `es-SV`. Mantener literales exactos del mockup (etiquetas, numeraciones de catálogo, placeholders).
- **Accesibilidad:** preservar roles/`aria-*` del mockup (sección 16).

---

## 4. Patrón de integración (botón dentro del formulario contenedor)

### 4.1 Comportamiento esperado
1. El formulario contenedor renderiza un **botón** (p. ej. *"Registrar lesión de causa externa"*).
2. El botón muestra el **estado de avance** del sub-formulario mediante un badge:
   - `Sin iniciar` (neutro) — aún no se ha capturado nada.
   - `Borrador` (ámbar) — hay datos capturados, sin firmar.
   - `Firmado` (verde) — firmado, con fecha/hora.
3. Al pulsarlo se abre el formulario en **modal o drawer** (decisión del proyecto; preferente modal a pantalla casi completa en desktop, drawer full-height en móvil).
4. Dentro del modal se monta `LesionCausaExternaForm` en **modo embebido** (= Vista "Limpia": **sin** la barra superior HIS, **sin** la franja de expediente, **sin** la barra "Secciones del registro"). El **encabezado del modal** aporta el título *"Formulario de reporte de Lesión de Causa Externa"* y el distintivo *"Copia · Unidad de Epidemiología"*.
5. El usuario captura/edita; al **Guardar** (o **Guardar y firmar**) el modal se cierra y **los datos quedan en el estado del formulario contenedor**.
6. Al **enviar el formulario contenedor**, el sub-formulario se **persiste como parte de la misma transacción/atención** (sección 15).

### 4.2 Contrato del componente

```tsx
// Wrapper para el formulario contenedor
<LesionCausaExternaModalButton
  expedienteId={string}          // para precargar datos del paciente
  atencionId={string}            // vínculo con la atención (parent)
  value={LesionCausaExterna | null}
  onChange={(v: LesionCausaExterna) => void}   // sube el estado al contenedor
  readOnly={boolean}
/>

// Formulario embebido (lo que se monta dentro del modal)
<LesionCausaExternaForm
  mode="embedded" | "standalone" // embedded = Vista Limpia
  value={LesionCausaExterna | null}
  onChange={(v) => void}
  onSign={(v) => void}           // dispara el sellado de firma + timestamp
  readOnly={boolean}
/>
```

### 4.3 Reglas de integración
- **El sub-formulario es parte del contenedor:** su `value` se almacena como objeto anidado del formulario padre (`atencion.lesionCausaExterna`). No expone su propio botón de submit hacia un endpoint independiente; "Guardar" solo consolida el `value` y cierra el modal.
- **Edición posterior:** reabrir el botón debe rehidratar el formulario con el `value` existente.
- **Validación:** la validación del sub-formulario (sección 8.9) se ejecuta al firmar y, además, debe poder invocarse desde la validación del contenedor antes de enviar.
- **Dos modos de uso del mismo componente:** `standalone` (página propia, con chrome HIS, imprimible) y `embedded` (dentro del modal). El conmutador de vista del mockup equivale a alternar `mode`. En integración se monta directamente en `embedded`.

---

## 5. Vistas (preservar el conmutador del mockup)

| Vista | Uso | Diferencia |
|---|---|---|
| **Completa** (`standalone`) | Página/registro independiente, imprimible | Incluye barra superior HIS, franja de expediente y barra "Secciones del registro". |
| **Limpia** (`embedded`) | Embebida en el formulario contenedor (modal) | Oculta barra HIS, franja de expediente y barra de secciones. El colapso por sección sigue activo. |

> El componente debe soportar ambas y alternar por prop `mode`. En el mockup esto es el switch **Vista: Completa / Limpia** de la barra inferior.

---

## 6. Inventario de campos y modelo de datos

> **Regla general de selección:** salvo donde se indique *(scalar)*, los grupos de catálogo son **multi-selección (checkbox)**, tal como el mockup. Ver **Consideración 6.5** sobre grupos que convendría volver single-select; **por defecto se preserva el comportamiento multi del mockup.**

### 6.1 Identificación — **autocompletado, solo lectura** (sección 10)
| Campo | Tipo | Origen |
|---|---|---|
| `expedienteNumero` | string | Expediente |
| `establecimiento` | string | Expediente/sede |
| `creadoPor` | string | **Usuario autenticado** (sesión) |
| `apellidos` | string | Expediente |
| `nombres` | string | Expediente |
| `ocupacion` | string | Expediente |
| `edadAnios` / `edadMeses` / `edadDias` | int | Expediente (derivable de fecha de nacimiento) |
| `sexo` | enum `M`/`F` *(scalar)* | Expediente |
| `domicilioDireccion` | string | Expediente |
| `domicilioDepartamento` | string | Expediente |
| `domicilioMunicipio` | string | Expediente |

> Todos estos campos se renderizan **bloqueados** (estilo "is-auto": fondo tenue, borde punteado, `readOnly`) con la nota: *"Datos del paciente cargados automáticamente del expediente registrado. Para modificarlos, edite el expediente."*

### 6.2 Datos generales del evento
| Campo | Tipo | Notas |
|---|---|---|
| `historiaRegistradaEn` | DateTime | **Automático** = timestamp de creación del registro. UI: Día/Mes/Año/Hora + AM/PM **solo lectura**. |
| `eventoOcurridoEn` | DateTime | **Manual.** UI: Día/Mes/Año/Hora + AM/PM. |
| `pacienteConDiscapacidad` | bool? | Manual (Sí/No). Ubicado **junto a "Fecha y hora — Evento"**. |
| `tipoEvento` | string[] | Catálogo 7.1. |
| `tipoEventoOtroTexto` | string? | Texto libre (auto-expandible) al marcar "Otro". |
| `mecanismo` | string[] | Catálogo 7.2 (incluye sub-grupos). |
| `mecanismoOtroTexto` | string? | Para opción 16. |
| `mecExplosion` | string[] | a/b (catálogo 7.2). |
| `mecFuego` | string[] | a/b/c. |
| `mecIntoxicacion` | string[] | a/b/c/d. |
| `mecIntoxicacionOtroTexto` | string? | Para 12.d. |
| `mecMordedura` | string[] | a/b. |
| `mecMordeduraAnimalTexto` | string? | Para 13.b (animal). |
| `intencionalidad` | string[] | Catálogo 7.3. |
| `intencionalidadOtroTexto` | string? | Para opción 5. |
| `lugar` | string[] | Catálogo 7.4 (entorno donde ocurrió). |
| `lugarOtroTexto` | string? | Para opción 7. |
| `actividad` | string[] | Catálogo 7.5. |
| `actividadOtroTexto` | string? | Para opción 8. |
| `eventoDepartamento` | string | **Lugar del evento** (geográfico), manual. |
| `eventoMunicipio` | string | Manual. |
| `eventoDireccionExacta` | string | Manual. |

> **"Lugar del evento" (geográfico)** vive **dentro de la Sección II "Datos generales del evento"** (se movió desde Identificación). No confundir con el catálogo `lugar` (entorno: bar/calle/casa…).

### 6.3 Datos específicos del evento
| Campo | Tipo | Catálogo | Otro |
|---|---|---|---|
| `transporteVictima` | string[] | 7.6 | `transporteVictimaOtroTexto` |
| `contraparte` | string[] | 7.7 | `contraparteOtroTexto` |
| `usuario` | string[] | 7.8 | — |
| `tipoAccidente` | string[] | 7.9 | `tipoAccidenteOtroTexto` |
| `violenciaRelacion` | string[] | 7.10 | `violenciaRelacionOtroTexto` |
| `violenciaContexto` | string[] | 7.11 | `violenciaContextoOtroTexto` |
| `violenciaAutoinfligida` | string[] | 7.12 | `violenciaAutoinfligidaOtroTexto` |

### 6.4 Datos clínicos del evento
| Campo | Tipo | Notas |
|---|---|---|
| `severidad` | string[] | Catálogo 7.13 (leve/moderada/severa). |
| `glasgowPuntaje` | int? | 3–15. |
| `glasgowCategoria` | enum? `leve`/`moderado`/`severo` | **Auto-resaltada** según puntaje (8.6). |
| `mapaCorporalSitios` | Json / string[] | Lista de regiones marcadas (sección 9). |
| `diagnosticoNaturaleza` | string? | Texto libre. |
| `diagnosticoSitioAnatomico` | string? | **Autocompletado** desde el mapa, **editable** (8.5). |
| `destino` | string[] | Catálogo 7.14. |
| `medicoNombre` | string | **De la ficha** del médico (solo lectura). |
| `medicoJVPM` | string | **De la ficha** (solo lectura). |
| `firmaEstado` | enum `pending`/`signed` | (11). |
| `firmadoEn` | DateTime? | Sello de tiempo al firmar. |
| `firmaImagenRef` | string? | Referencia a la firma almacenada en la ficha del médico. |
| `selloImagenRef` | string? | Referencia al sello de la ficha del médico. |

### 6.5 Consideración (decisión del propietario del producto)
Los siguientes grupos son **clínicamente single-select** y en el formato MINSAL llevan "marcar una sola": `sexo` (ya scalar), `tipoEvento`, `intencionalidad`, `severidad`, `glasgowCategoria`, `destino`. El mockup los dejó como checkbox por requerimiento previo. **Por defecto se preserva el comportamiento multi**; si se decide migrarlos a single-select (radio), cambiar el tipo a scalar y el control a radio — **no implementar este cambio sin confirmación.**

---

## 7. Catálogos (literales exactos, conservar numeración)

**7.1 Tipo de evento:** `1` Desastre natural · `2` Evento aislado · `3` Guerra o conflicto armado · `4` Terrorismo · `5` No especificado · `6` Otro *(texto libre)*.

**7.2 Mecanismo de la lesión:** `1` Accidente de transporte · `2` Agresión sexual · `3` Asfixia o ahogamiento por inmersión · `4` Caída · `5` Contacto con cuerpo extraño · `6` Contacto con electricidad · `7` Disparo con arma de fuego · `8` Estrangulación / ahorcamiento · `9` Explosión {`a` Minas, `b` Otro artefacto explosivo} · `10` Fuego/calor {`a` Fuego/humo/llama, `b` Líquidos calientes, `c` Pirotecnia} · `11` Golpe / fuerza contundente · `12` Intoxicación {`a` Fármaco, `b` Plaguicidas, `c` Hidrocarburos, `d` Otro *(texto)*} · `13` Mordedura {`a` Persona, `b` Animal *(texto)*} · `14` Puñalada, cortadura · `15` No especificado · `16` Otro *(texto)*.

**7.3 Intencionalidad:** `1` No intencional (accidental) · `2` Autoinfligida (suicidio/intento) · `3` Intencional (agresión) · `4` No especificada · `5` Otros *(texto)*.

**7.4 Lugar (¿dónde ocurrió?):** `1` Bar, cantina o similares · `2` Calle · `3` Casa/hogar · `4` Escuela/lugar de estudio · `5` Trabajo · `6` No especificada · `7` Otro *(texto)*.

**7.5 Actividad:** `1` Estudiando · `2` Practicando deporte · `3` Recreación/descanso/juego · `4` Tomando licor · `5` Trabajando · `6` Viajando (a un lugar o al trabajo) · `7` No especificada · `8` Otra *(texto)*.

**7.6 Transporte de la víctima:** `1` Automóvil · `2` Bicicleta · `3` Bus · `4` Camión/rastra · `5` Carreta/animal · `6` Microbús · `7` Motocicleta · `8` Peatón · `9` Pick up · `10` Taxi · `11` No especificado · `12` Otro *(texto)*.

**7.7 Contraparte:** `1` Automóvil · `2` Bicicleta · `3` Bus · `4` Camión/rastra · `5` Carreta/animal · `6` Microbús · `7` Motocicleta · `8` Objeto fijo · `9` Peatón · `10` Pick up · `11` Taxi · `12` No especificado · `13` Otro *(texto)*.

**7.8 Usuario:** `1` Conductor · `2` Pasajero · `3` Peatón · `4` No especificado.

**7.9 Tipo de accidente:** `1` Atropello · `2` Colisión · `3` Choque · `4` Volcadura · `5` No especificado · `6` Otro *(texto)*.

**7.10 Violencia interpersonal — relación del agresor:** `1` Pareja o ex pareja · `2` Padres/padrastros · `3` Otro familiar · `4` Amigos/conocidos · `5` Desconocido · `6` No especificado · `7` Otro *(texto)*.

**7.11 Contexto:** `1` Violencia intrafamiliar · `2` Robo u otros crímenes · `3` Otras riñas/peleas (no familiares) · `4` Maras/pandillas · `5` Bala perdida · `6` No especificado · `7` Otro *(texto)*.

**7.12 Violencia autoinfligida — factores precipitantes:** `1` Víctima de abuso sexual o físico · `2` Conflicto con la pareja o la familia · `3` Enfermedad física · `4` Desempleo · `5` Dificultades escolares · `6` Embarazo no deseado · `7` Conducta adictiva · `8` Conflicto con las amistades · `9` Problemas con la justicia · `10` Problemas financieros · `11` No especificado · `12` Otros *(texto)*.

**7.13 Severidad de la lesión (según tiempo de tratamiento):**
- `1` **Leve o superficial** — < 1 h de tratamiento. Heridas menores, erosiones.
- `2` **Moderada** — 1–6 h. Requiere tratamiento (lavado gástrico, observación, fractura cerrada, suturas, etc.).
- `3` **Severa** — > 6 h. Manejo avanzado (cirugía mayor, hemorragia severa, perforación de órganos, cuidados intensivos). Incluye muerte.

**Escala de Glasgow (trauma craneoencefálico):** Leve `13–15` · Moderado `9–12` · Severo `≤ 8`.

**7.14 Destino del paciente:** `1` Abandono voluntario · `2` Alta (manejo ambulatorio) · `3` Fallecido en emergencia · `4` Fuga · `5` Hospitalizado · `6` Referido a otro establecimiento · `7` No especificado.

> Recomendado: extraer estos catálogos a un módulo `catalogos/lesionCausaExterna.ts` (code + label) para reutilizar en UI y validación, y facilitar futura migración a tablas de catálogo en BD.

---

## 8. Comportamientos funcionales a preservar (1:1 con el mockup)

**8.1 Secciones colapsables.** Las cuatro secciones (I Identificación, II Datos generales, III Datos específicos, IV Datos clínicos) se expanden/colapsan desde su encabezado (clic o teclado Enter/Espacio), con chevron que rota e `aria-expanded`. Animación suave por **altura real medida** (no `max-height` fija).

**8.2 Barra "Expandir todo / Contraer todo".** En vista Completa. En vista Limpia se omite la barra, pero el colapso por sección permanece.

**8.3 Conmutador de vista.** Completa ↔ Limpia (sección 5). En integración se entra en Limpia.

**8.4 Campos "Otro" como texto libre auto-expandible.** Para **todas** las opciones "Otro/Otros/¿cuál?" (13 en total): el campo es un `textarea` que **aparece solo al marcar** el checkbox correspondiente y **crece automáticamente** con el contenido (sin scroll interno). Al desmarcar, se oculta y limpia. Aplica a: Tipo de evento (6), Mecanismo (16), Intoxicación (d), Mordedura (b/animal), Intencionalidad (5), Lugar (7), Actividad (8), Transporte víctima (12), Contraparte (13), Tipo de accidente (6), Violencia interpersonal (7), Contexto (7), Violencia autoinfligida (12).

**8.5 Mapa corporal → sitio anatómico.** Las regiones marcadas en el mapa **autocompletan** `diagnosticoSitioAnatomico` (texto editable). `diagnosticoNaturaleza` es un campo de texto independiente.

**8.6 Ayuda de Glasgow.** Al escribir `glasgowPuntaje` (3–15), **resaltar** la categoría correspondiente (leve/moderado/severo) y fijar `glasgowCategoria`.

**8.7 Autocompletado de Identificación y "Fecha y hora — Historia".** Ver sección 10.

**8.8 Guardar y firmar.** Ver sección 11. Al firmar: sella la firma del médico, registra `firmadoEn`, cambia `firmaEstado` a `signed` y muestra confirmación.

**8.9 Validación mínima al firmar.** Requeridos: paciente identificado (viene del expediente), **médico** (viene de la ficha) y **al menos una opción de Mecanismo de la lesión**. Si falta, mostrar mensaje y no firmar. (Como Identificación y médico se autocompletan, en la práctica el requisito accionable es Mecanismo.)

**8.10 Guardar borrador.** Consolida `value` sin firmar; estado del botón pasa a `Borrador`.

**8.11 Multi-selección.** Mantener checkbox en los grupos de catálogo (salvo decisión 6.5).

---

## 9. Mapa corporal de lesiones (especificación)

- **Render:** dos figuras SVG (anterior + posterior) construidas a partir de un **único set de 22 regiones poligonales segmentadas**, `viewBox="0 0 240 680"`. La geometría es la misma para ambas vistas; **solo cambian las etiquetas** (anterior/posterior) y la lateralidad.
- **Interacción:** cada región es **togglable** (clic o teclado), `role="checkbox"` + `aria-checked`. **Selección múltiple**. Región seleccionada → relleno de alerta (rojo); hover → tinte primario.
- **Lateralidad corregida al lado anatómico del paciente:** en vista **anterior** el lado derecho del paciente aparece a la izquierda de la imagen; en **posterior**, a la derecha. **Las etiquetas ya entregan el lado correcto** (no invertir en consumo).
- **Salida:** panel lateral con chips (con botón "quitar"), contador, botón "Limpiar marcas", y `mapaCorporalSitios` poblado. Cada elemento: `{ vista: 'anterior'|'posterior', regionId, etiqueta }`.

**Regiones (id → etiqueta anterior / etiqueta posterior):**

| id | Anterior | Posterior |
|---|---|---|
| `cranio` | Cráneo (frontal) | Cráneo (posterior) |
| `cara` | Cara | Nuca |
| `neck` | Cuello (anterior) | Cuello (posterior) |
| `shoulderA` | Hombro derecho | Hombro izquierdo |
| `shoulderB` | Hombro izquierdo | Hombro derecho |
| `torax` | Tórax | Región dorsal (espalda alta) |
| `abdomen` | Abdomen | Región lumbar (espalda baja) |
| `pelvis` | Pelvis / genitales | Glúteos / región sacra |
| `brazoA` | Brazo derecho | Brazo izquierdo |
| `antebrazoA` | Antebrazo derecho | Antebrazo izquierdo |
| `manoA` | Mano derecha | Mano izquierda (dorso) |
| `brazoB` | Brazo izquierdo | Brazo derecho |
| `antebrazoB` | Antebrazo izquierdo | Antebrazo derecho |
| `manoB` | Mano izquierda | Mano derecha (dorso) |
| `musloA` | Muslo derecho | Muslo izquierdo (posterior) |
| `rodillaA` | Rodilla derecha | Hueco poplíteo izquierdo |
| `piernaA` | Pierna derecha | Pantorrilla izquierda |
| `pieA` | Pie derecho | Talón izquierdo |
| `musloB` | Muslo izquierdo | Muslo derecho (posterior) |
| `rodillaB` | Rodilla izquierda | Hueco poplíteo derecho |
| `piernaB` | Pierna izquierda | Pantorrilla derecha |
| `pieB` | Pie izquierdo | Talón derecho |

> Reutilizar la geometría `d`/`points` del mockup (no rediseñar). Extraer las regiones a un módulo `bodyMap.ts` (id + path + etiquetas).

---

## 10. Autocompletado y solo lectura

- **Identificación (6.1)** y **médico (6.4)** se **precargan** desde el expediente y la ficha del médico autenticado; se renderizan **bloqueados** (`readOnly`, estilo "is-auto"). No editables aquí.
- **`historiaRegistradaEn`** se **autocompleta** con la fecha/hora de creación; UI en solo lectura (Día/Mes/Año/Hora + AM/PM).
- `sexo` y las pastillas AM/PM de Historia quedan **bloqueadas** pero con el valor correcto marcado.
- **`eventoOcurridoEn`** y **"Lugar del evento" (geográfico)** quedan **editables** (datos propios del hecho).
- En `mode="standalone"` para demo, está permitido sembrar datos de ejemplo; en producción se enlaza al expediente/ficha reales por `expedienteId` / usuario de sesión.

---

## 11. Firma y sello del médico

- El bloque **"Médico que registra el formulario"** muestra **nombre y JVPM** (solo lectura, de la ficha), más **firma manuscrita** y **sello circular** tomados de la **ficha del médico**.
- **Origen de firma/sello:** la ficha del médico almacena su imagen de firma y su sello; el formulario los **referencia** (`firmaImagenRef`, `selloImagenRef`). En `standalone`/demo puede renderizarse una firma tipográfica (cursiva) y un sello compuesto (establecimiento · médico · JVPM) como en el mockup.
- **Estados:** `pending` → distintivo "Pendiente de firma" y sello atenuado. **Guardar y firmar** → `signed`, sello a opacidad plena, distintivo "Firmado · {fecha y hora}" y `firmadoEn` registrado.
- La firma debe asociarse al **médico autenticado** que registra; no permitir firmar a nombre de otro usuario.

---

## 12. Impresión (solo vista Completa)

- Botón **Imprimir** (`window.print()`), y media query de impresión que produzca un documento limpio:
  - Oculta barra HIS, conmutador de vista, barra de secciones, chevrons y barra de acciones.
  - **Expande todas las secciones** (ignorar estado colapsado) para que nada se corte.
  - Conserva la franja de expediente y todo el contenido del formulario.
- En `mode="embedded"` la impresión la decide el contenedor (no obligatoria).

---

## 13. Look & feel a preservar (mapeo a Avante DS v2.0)

**Mantener idéntico el resultado visual del mockup**, sustituyendo los HEX por **tokens OKLCH** del DS. Tabla de equivalencias a respetar:

| Rol en el mockup | HEX mockup | Token Avante DS v2.0 (a usar) |
|---|---|---|
| Primario (teal) | `#0e5f66` | `--ds-color-primary` (teal navy) |
| Primario hover | `#0a4a50` | `--ds-color-primary-hover` |
| Primario tenue (fondos) | `#e9f3f4` / `#d4e8ea` | `--ds-color-primary-50/100` |
| Tinta de texto | `#1c2733` | `--ds-color-ink` |
| Texto atenuado | `#5b6b78` / `#8898a5` | `--ds-color-muted` / `--ds-color-faint` |
| Líneas/bordes | `#dde5ea` / `#c5d2da` | `--ds-color-border` / `--ds-color-border-strong` |
| Superficie | `#f4f7f8` | `--ds-color-surface` |
| Alerta / sitio marcado | `#c8323a` | `--ds-color-danger` |
| Aviso / pendiente | `#b7791f` / `#fdf3e0` | `--ds-color-warning` / `--ds-color-warning-50` |
| Éxito / firmado | `#1f6b3a` / `#e7f5ec` | `--ds-color-success` / `--ds-color-success-50` |
| Firma manuscrita (tinta) | `#16365a` | `--ds-color-navy` |

**Elementos visuales a conservar:** encabezados de sección con **badge numerado I–IV**; tiles de checkbox con estado marcado (borde + relleno primario); chips de sitios; el **sello circular** (doble borde, rotación ~-7°); campos "is-auto" (fondo tenue + borde punteado); textareas "Otro" con borde primario; radios de borde y espaciados. Tipografía y escalas equivalentes a las del DS (no introducir fuentes nuevas salvo la cursiva de firma).

---

## 14. Esquema de datos (Prisma) y persistencia

Modelo sugerido (ajustar a convenciones del esquema vigente). Multi-selecciones como `String[]` (arreglos Postgres) con los **códigos** del catálogo; `*OtroTexto` para textos libres; mapa corporal como `Json`.

```prisma
model LesionCausaExterna {
  id          String   @id @default(cuid())
  atencionId  String   @unique
  atencion    Atencion @relation(fields: [atencionId], references: [id])

  // — Identificación (snapshot del expediente al momento del registro) —
  expedienteNumero      String
  establecimiento       String
  creadoPor             String     // usuario de sesión
  apellidos             String
  nombres               String
  ocupacion             String?
  edadAnios             Int?
  edadMeses             Int?
  edadDias              Int?
  sexo                  Sexo?
  domicilioDireccion    String?
  domicilioDepartamento String?
  domicilioMunicipio    String?

  // — Datos generales del evento —
  historiaRegistradaEn  DateTime   @default(now())
  eventoOcurridoEn      DateTime?
  pacienteConDiscapacidad Boolean?
  tipoEvento            String[]
  tipoEventoOtroTexto   String?
  mecanismo             String[]
  mecanismoOtroTexto    String?
  mecExplosion          String[]
  mecFuego              String[]
  mecIntoxicacion       String[]
  mecIntoxicacionOtroTexto String?
  mecMordedura          String[]
  mecMordeduraAnimalTexto  String?
  intencionalidad       String[]
  intencionalidadOtroTexto String?
  lugar                 String[]
  lugarOtroTexto        String?
  actividad             String[]
  actividadOtroTexto    String?
  eventoDepartamento    String?
  eventoMunicipio       String?
  eventoDireccionExacta String?

  // — Datos específicos —
  transporteVictima           String[]
  transporteVictimaOtroTexto  String?
  contraparte                 String[]
  contraparteOtroTexto        String?
  usuario                     String[]
  tipoAccidente               String[]
  tipoAccidenteOtroTexto      String?
  violenciaRelacion           String[]
  violenciaRelacionOtroTexto  String?
  violenciaContexto           String[]
  violenciaContextoOtroTexto  String?
  violenciaAutoinfligida          String[]
  violenciaAutoinfligidaOtroTexto String?

  // — Datos clínicos —
  severidad                 String[]
  glasgowPuntaje            Int?
  glasgowCategoria          GlasgowCategoria?
  mapaCorporalSitios        Json?      // [{ vista, regionId, etiqueta }]
  diagnosticoNaturaleza     String?
  diagnosticoSitioAnatomico String?
  destino                   String[]

  // — Firma —
  medicoId        String?
  medicoNombre    String
  medicoJVPM      String
  firmaEstado     FirmaEstado @default(pending)
  firmadoEn       DateTime?
  firmaImagenRef  String?
  selloImagenRef  String?

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

enum Sexo { M F }
enum GlasgowCategoria { leve moderado severo }
enum FirmaEstado { pending signed }
```

**Notas de persistencia**
- Relación **1:1 con `Atencion`** (`atencionId @unique`). El sub-formulario se crea/actualiza con la atención (transacción del contenedor).
- Guardar **snapshot** de los datos demográficos al momento del registro (no solo FK), por trazabilidad epidemiológica.
- Considerar índice por `eventoOcurridoEn`, `eventoMunicipio`, `mecanismo` y `intencionalidad` para reportería epidemiológica.
- Si más adelante se requieren catálogos normalizados en BD, migrar `String[]` a tablas de unión sin cambiar la UI.

---

## 15. API (tRPC)

Procedimientos sugeridos en `lesionCausaExterna` router:

```ts
lesionCausaExterna.getByAtencion({ atencionId })      // -> LesionCausaExterna | null
lesionCausaExterna.upsert({ atencionId, data })       // crea/actualiza (borrador o firmado)
lesionCausaExterna.sign({ atencionId, medicoId })     // sella firma + firmadoEn (server-side)
```

- `upsert` valida con el **mismo esquema Zod** del cliente.
- `sign` debe ejecutarse del lado servidor verificando que `medicoId` == usuario autenticado; setea `firmaEstado=signed`, `firmadoEn=now()` y referencia firma/sello de la ficha.
- El **contenedor** puede llamar `upsert` dentro de su propia mutación de guardado (misma transacción) o el sub-formulario delega su `value` y el contenedor persiste todo junto.

---

## 16. Accesibilidad

- Encabezados de sección: `role="button"`, `tabindex="0"`, `aria-expanded`, `aria-controls`; operables con Enter/Espacio.
- Regiones del mapa: `role="checkbox"`, `aria-checked`, foco visible, operables por teclado.
- Conmutador de vista: `role="group"` + `aria-pressed`.
- Labels asociados (`for`/`id`) en todos los campos; textareas "Otro" con label visible al revelarse.
- Contrastes según DS; foco visible en todos los interactivos.

---

## 17. Criterios de aceptación

- [ ] El componente se abre **desde un botón dentro del formulario contenedor**, en modal/drawer, montado en **Vista Limpia**.
- [ ] El botón refleja estado **Sin iniciar / Borrador / Firmado**.
- [ ] Al guardar, los datos quedan **en el estado del contenedor**; al enviar el contenedor, **se persisten ligados a la atención** (1:1).
- [ ] **Todos los campos y catálogos** de la sección 6–7 están presentes, con literales y numeración idénticos.
- [ ] **Multi-selección** preservada en los grupos (salvo decisión 6.5 confirmada).
- [ ] **Identificación** (hasta municipio del domicilio) y **médico** se **autocompletan y quedan en solo lectura**.
- [ ] **"Fecha y hora — Historia"** se autocompleta (solo lectura); **"Evento"** y **"Lugar del evento"** quedan editables. "Lugar del evento" está **en la Sección II**.
- [ ] **"Paciente con discapacidad"** está **junto a "Fecha y hora — Evento"**.
- [ ] **Campos "Otro"**: textarea revelado al marcar, **auto-expandible**, en las 13 opciones listadas.
- [ ] **Mapa corporal**: 22 regiones, anterior+posterior, multi-selección, lateralidad del paciente correcta, chips + contador + limpiar, y **autocompleta el sitio anatómico**.
- [ ] **Glasgow**: el puntaje resalta la categoría.
- [ ] **Firma y sello** del médico desde su ficha; **Guardar y firmar** sella con fecha/hora y bloquea estado `signed`.
- [ ] **Secciones colapsables** + (en Completa) **Expandir/Contraer todo**, con animación por altura real.
- [ ] **Vista Completa imprimible**: expande secciones y oculta chrome en impresión.
- [ ] **Look & feel idéntico** al mockup usando **tokens OKLCH de Avante DS v2.0** (sección 13), sin HEX hardcodeados.
- [ ] Validación al firmar (sección 8.9) operativa e invocable desde el contenedor.
- [ ] Accesibilidad de la sección 16 verificada (teclado + `aria`).

---

## 18. Fuera de alcance / notas

- **CIE-11 / CPT** no se capturan en este formulario (el diagnóstico es texto libre: naturaleza + sitio anatómico). Si se requiere codificar la lesión, enlazar `diagnosticoNaturaleza` a un selector CIE-11 en una iteración posterior (consistente con el resto del ECE).
- La **pantalla contenedora** no es parte de este REQ; solo se define el **contrato de integración** (sección 4).
- Autenticación, autorización y la **ficha del médico** (almacenamiento de firma/sello) se asumen provistos por la plataforma.
- Datos de ejemplo del mockup son **solo demostrativos**; en producción provienen del expediente y de la ficha del médico autenticado.

---

*Insumo de referencia adjunto:* `historia-clinica-lesion-causa-externa.html` — el comportamiento y los literales de ese archivo son la fuente de verdad ante cualquier ambigüedad de este documento.
