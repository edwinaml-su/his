# Requerimiento: Módulo de Solicitud de Radiología e Imágenes (HIS)

| | |
|---|---|
| **Documento** | Especificación funcional para implementación con Claude Code |
| **Módulo** | Solicitud de Radiología e Imágenes — Expediente Electrónico / Historia Clínica |
| **Solicitante** | Edwin Martínez (emartinez@complejoavante.com) |
| **Fecha** | 18/09/2026 |
| **Versión** | 1.0 (basada en Mockup v2 — `mockup_modulo_imagenes.html`) |
| **Referencia visual** | Mockup HTML interactivo aprobado + capturas del módulo actual del HIS |

---

## 1. Contexto y objetivo

El HIS cuenta hoy con una pantalla "Agregar Solicitud Radiología e Imágenes" dentro de la Historia Clínica, que permite marcar prestaciones por categoría y guardarlas. Se requiere **reconstruir/incorporar este módulo** con mejoras de usabilidad, reglas clínicas de validación y una capa de **parametrización** administrable sin tocar código, replicando el comportamiento del mockup v2 aprobado.

Objetivos:

1. Que el médico genere solicitudes de imagenología desde el expediente del paciente con validaciones clínicas (contraste, embarazo, prioridad).
2. Que los datos clínicos se **reutilicen desde el expediente** (diagnósticos CIE-11, alergias) en lugar de digitarse de nuevo.
3. Que el catálogo de exámenes, los campos del formulario y las reglas de negocio sean **parametrizables** por un perfil administrador.
4. Estandarizar la búsqueda de prestaciones con el patrón ya existente en el **módulo de Laboratorio** ("Buscar por Nombre").

## 2. Instrucciones para Claude Code

- **Explora primero el codebase existente** del HIS y adapta esta especificación a su stack, convenciones de nombres, ORM/capa de datos, sistema de permisos y componentes UI ya existentes. No introduzcas frameworks nuevos si el proyecto ya define unos.
- El módulo de **Laboratorio Clínico ya implementa** la solicitud de exámenes con búsqueda por nombre: **localízalo y reutiliza/extrae sus componentes** (buscador, listado con checkboxes, guardado) para garantizar que ambos módulos queden idénticos en UX. Si hay lógica duplicable, refactorízala a componentes compartidos en lugar de copiarla.
- El archivo `mockup_modulo_imagenes.html` es la referencia de UI/UX y contiene además, en sus constantes JS (`RAW`, `FIELDS`, `RULES`), el **catálogo semilla completo** y la configuración inicial de campos y reglas. Úsalo como fuente para los seeds (ver Apéndice A).
- Donde esta especificación diga "desde la Historia Clínica / Evolución / Indicaciones", integra contra las tablas o servicios reales del expediente; los nombres de tablas del §7 son sugerencias a adaptar.
- Implementa en español (etiquetas UI) y conserva los nombres de prestaciones EXACTAMENTE como están en el catálogo semilla (son los nombres oficiales del hospital).
- Entrega con pruebas automatizadas de las reglas de negocio del §6 (criterios de aceptación del §10 como casos de prueba).

## 3. Alcance

**Incluye:** pantalla de nueva solicitud, listado de solicitudes del paciente con estados, módulo de parametrización (categorías, catálogo, campos de llenado, reglas), validaciones clínicas, integración de lectura con HC/evolución/indicaciones, auditoría de cambios de parametrización.

**No incluye (fase posterior):** agenda/programación de citas de imagenología, captura del informe radiológico, visor de imágenes, integración DICOM/PACS/HL7 (worklist), facturación de las prestaciones, notificaciones push a Imagenología (solo se deja el evento/hook).

## 4. Estructura del módulo

Tres vistas bajo el contexto de un paciente ya seleccionado en el expediente:

1. **Nueva Solicitud** — creación de la solicitud (médico).
2. **Solicitudes del paciente** — historial con folio, fecha, categorías, prioridad y estado.
3. **Parametrización** — solo perfil administrador; subsecciones: Categorías, Catálogo de exámenes, Opciones de llenado, Reglas generales.

Encabezado permanente con datos del paciente: nombre, número de expediente, edad, **sexo**, servicio, médico solicitante, fecha.

## 5. Requerimientos funcionales

### RF-01 — Selección de prestaciones por categoría
- Categorías iniciales (5): Estudios Especiales, Radiografías, Resonancia Magnética, Tomografías, Ultrasonografías. Se muestran como pestañas/chips con contador de prestaciones activas y contador de seleccionadas.
- El listado de prestaciones de la categoría activa se muestra en columnas con checkbox por prestación, con etiquetas visuales `contraste` y `ayuno` cuando apliquen (activables por regla).
- Panel lateral "Solicitud actual": cada prestación marcada aparece como tarjeta con categoría, código, duración, checkbox "con contraste" (si aplica), indicadores de ayuno/autorización y campo de nota individual. Botón para quitarla.

### RF-02 — Búsqueda por Nombre (estándar Laboratorio)
- Interruptor **"Buscar por Nombre"** idéntico en comportamiento, ubicación y estilo al del módulo de Laboratorio Clínico.
- Activado: el campo de texto busca **en todas las categorías activas** por coincidencia parcial del nombre, **insensible a mayúsculas y tildes** ("torax" encuentra "TÓRAX"). Cada resultado muestra un distintivo con su categoría de origen.
- Desactivado: el mismo campo filtra solo dentro de la categoría activa.

### RF-03 — Diagnóstico presuntivo (CIE-11) desde el expediente
- El campo es un **selector** poblado con los diagnósticos ya registrados del paciente, agrupados por fuente y en este orden: **Historia Clínica (antecedentes/problemas activos), Evolución Clínica (últimas notas), Indicaciones Médicas**. Cada opción muestra `código CIE-11 — descripción` y la fuente/fecha.
- Codificación **CIE-11** (no CIE-10). Si el expediente aún almacena CIE-10, exponer el diagnóstico con su código original e indicar la fuente, dejando la estructura lista para CIE-11 (campo `sistema_codificacion`).
- Opción final "Otro diagnóstico (digitar manualmente)" que habilita un campo de texto libre con búsqueda/validación contra el catálogo CIE-11 si el HIS ya lo tiene.
- El diagnóstico seleccionado se guarda **copiado** en la solicitud (código, descripción, fuente, id de origen) para trazabilidad.

### RF-04 — Prioridad con patrón de colores
- Selector segmentado de tres opciones con codificación de color obligatoria en todo el módulo (formulario, listados, impresiones):
  - **STAT → Rojo** (`#dc2626`)
  - **Urgente → Amarillo** (`#f59e0b`)
  - **Rutina → Verde** (`#059669`)
- Campo obligatorio. Al seleccionar STAT, disparar evento/hook `solicitud.stat.creada` para futura notificación inmediata a Imagenología (implementar solo el hook).

### RF-05 — Fecha de la solicitud condicionada a prioridad
- El campo "Fecha de la solicitud (programación)" permanece **oculto/deshabilitado** y **solo se abre cuando la prioridad seleccionada es Rutina**.
- Al cambiar de Rutina a Urgente/STAT, el campo se oculta y su valor se limpia. Urgente y STAT no llevan fecha propuesta (se atienden de inmediato).
- Validación también en backend: rechazar solicitudes Urgente/STAT que traigan fecha de programación.

### RF-06 — Posibilidad de embarazo
- Campo **obligatorio** para toda solicitud.
- Opciones: `No aplica`, `No`, `Sí`, `Se desconoce`.
- Si el sexo del paciente es **masculino**: el sistema asigna automáticamente **"No aplica"**, muestra el campo bloqueado (solo lectura) con la leyenda "automático por sexo". La validación de obligatoriedad queda satisfecha.
- Si el sexo es femenino: el campo inicia vacío y el médico debe responderlo. (Recomendado, no bloqueante: advertencia si responde "Sí" o "Se desconoce" y la solicitud incluye estudios con radiación ionizante o contraste.)

### RF-07 — Alergias conocidas desde la Historia Clínica
- El campo se **llena automáticamente** con el registro de alergias de la Historia Clínica del paciente y se muestra **solo lectura** con distintivo de fuente "Historia Clínica".
- No es editable desde la solicitud; si el registro de HC está vacío, mostrar "Sin alergias registradas en Historia Clínica". El valor se copia a la solicitud al guardar (snapshot para trazabilidad).

### RF-08 — Creatinina sérica obligatoria con contraste
- El campo "Creatinina sérica (mg/dL)" es opcional por defecto, pero se vuelve **obligatorio automáticamente cuando al menos una prestación seleccionada requiere medio de contraste** (flag del catálogo o checkbox "con contraste" de la tarjeta).
- Al activarse la condición, el formulario muestra junto a la etiqueta el rótulo rojo "obligatoria — hay estudio(s) con contraste"; el guardado se bloquea con mensaje claro si está vacía. Validar también en backend.
- Mejora recomendada (si el módulo de Laboratorio lo permite): botón para traer el último resultado de creatinina del paciente con su fecha.

### RF-09 — Guardado, folio y estados
- Al guardar: validar §6, generar folio correlativo (`SOL-AAAA-NNNN`), registrar médico, servicio, fecha/hora, y las prestaciones con sus atributos (contraste, nota).
- Estados del ciclo de vida: `Pendiente → Programado → Realizado → Informado` (+ `Anulado`). Esta fase solo crea en `Pendiente` y muestra el estado en el listado; las transiciones las harán módulos posteriores.
- Listado "Solicitudes del paciente": folio, fecha, categorías, nº de prestaciones, prioridad (con color RF-04), estado (badge) y acceso a detalle.

### RF-10 — Parametrización (perfil administrador)
1. **Categorías**: activar/desactivar y reordenar. Una categoría inactiva desaparece de Nueva Solicitud sin afectar solicitudes históricas.
2. **Catálogo de exámenes**: CRUD de prestaciones con: código, nombre, categoría, requiere contraste, requiere ayuno, requiere autorización previa, duración estimada (min), sala/equipo, indicaciones de preparación para el paciente, activo/inactivo. Desactivar en lugar de borrar cuando la prestación tenga historial.
3. **Opciones de llenado**: por cada campo del formulario (§Apéndice B) el administrador define `Obligatorio / Opcional / Oculto`. El formulario de Nueva Solicitud se renderiza según esta configuración. Restricciones: "Posibilidad de embarazo" no puede configurarse por debajo de Obligatorio (RF-06); si hay contraste, creatinina se exige aunque esté configurada como Opcional (RF-08); ocultar creatinina con estudios de contraste debe generar advertencia bloqueante.
4. **Reglas generales** (toggles): permitir varias categorías por solicitud; habilitar "Buscar por Nombre"; mostrar código de prestación; mostrar etiquetas contraste/ayuno; alerta de prestación duplicada en los últimos 30 días; requerir firma electrónica al guardar; límite máximo de prestaciones por solicitud.
- Todo cambio de parametrización queda **auditado** (usuario, fecha/hora, valor anterior → nuevo).

## 6. Reglas de negocio (resumen normativo)

| # | Regla | Momento de validación |
|---|-------|----------------------|
| RN-1 | Solicitud requiere ≥ 1 prestación | UI + backend |
| RN-2 | Diagnóstico CIE-11 obligatorio (del expediente o manual) | UI + backend |
| RN-3 | Prioridad obligatoria; colores STAT=rojo, Urgente=amarillo, Rutina=verde | UI |
| RN-4 | Fecha de programación solo existe si prioridad = Rutina | UI + backend |
| RN-5 | Posibilidad de embarazo obligatoria; "No aplica" automático y bloqueado si sexo = M | UI + backend |
| RN-6 | Alergias: solo lectura, snapshot desde HC | Backend |
| RN-7 | Creatinina obligatoria si ∃ prestación con contraste | UI + backend |
| RN-8 | Prestación duplicada en 30 días → advertencia (no bloquea), si la regla está activa | UI |
| RN-9 | Categoría/prestación inactiva no aparece en Nueva Solicitud, pero se conserva en historial | Backend |
| RN-10 | Cambios de parametrización auditados | Backend |

## 7. Modelo de datos sugerido (adaptar al esquema real del HIS)

```
img_categoria        (id, nombre, orden, activo)
img_prestacion       (id, codigo UNIQUE, nombre, categoria_id FK, requiere_contraste,
                      requiere_ayuno, requiere_autorizacion, duracion_min, sala,
                      preparacion TEXT, activo)
img_solicitud        (id, folio UNIQUE, paciente_id FK, medico_id FK, servicio,
                      fecha_solicitud, prioridad ENUM(RUTINA,URGENTE,STAT),
                      fecha_programada NULL, dx_codigo, dx_descripcion,
                      dx_sistema ENUM(CIE10,CIE11), dx_fuente, dx_origen_id NULL,
                      justificacion TEXT, embarazo ENUM(NO_APLICA,NO,SI,DESCONOCE),
                      alergias_snapshot TEXT, creatinina DECIMAL NULL,
                      observaciones TEXT NULL, estado ENUM(PENDIENTE,PROGRAMADO,
                      REALIZADO,INFORMADO,ANULADO), created_at, created_by)
img_solicitud_det    (id, solicitud_id FK, prestacion_id FK, con_contraste, nota,
                      snapshot_nombre, snapshot_codigo)
img_param_campo      (id, clave, etiqueta, estado ENUM(OBLIGATORIO,OPCIONAL,OCULTO))
img_param_regla      (id, clave, activo, valor NULL)
img_param_auditoria  (id, tabla, registro_id, usuario_id, fecha, antes JSON, despues JSON)
```

Índices por `paciente_id`, `folio`, `estado`. `snapshot_nombre/codigo` protegen el historial ante renombres del catálogo.

## 8. Integraciones internas (solo lectura en esta fase)

- **Historia Clínica**: alergias del paciente; diagnósticos de antecedentes/problemas activos.
- **Evolución Clínica**: diagnósticos de las notas recientes (definir ventana, sugerido últimos 90 días o último episodio).
- **Indicaciones Médicas**: diagnósticos asociados a indicaciones vigentes.
- **Datos demográficos**: sexo y edad para RF-06.
- **Laboratorio** (opcional recomendado): último resultado de creatinina para RF-08.
- Hook/evento `solicitud.stat.creada` para notificación futura a Imagenología.

## 9. Roles y permisos

- **Médico**: crear solicitudes, ver solicitudes de sus pacientes. No accede a Parametrización.
- **Administrador del módulo / Jefatura de Imagenología**: todo lo anterior + Parametrización.
- Registrar en cada solicitud el usuario creador; la anulación (fase posterior) exigirá motivo.

## 10. Criterios de aceptación

1. Dado un paciente masculino, al abrir Nueva Solicitud, "¿Posibilidad de embarazo?" muestra "No aplica", está bloqueado y la solicitud puede guardarse sin tocarlo.
2. Dado un paciente femenino, la solicitud no se guarda mientras el campo embarazo esté vacío.
3. Al seleccionar prioridad Urgente o STAT, el campo fecha no es visible y cualquier intento de enviar fecha por API es rechazado; con Rutina el campo aparece y acepta fecha ≥ hoy.
4. Los tres botones de prioridad muestran verde/amarillo/rojo según Rutina/Urgente/STAT, y el mismo color aparece en el listado de solicitudes.
5. El selector de diagnóstico lista los diagnósticos del expediente agrupados por Historia Clínica, Evolución e Indicaciones, con código CIE-11; elegir uno lo copia a la solicitud con su fuente.
6. Alergias aparece prellenado desde HC y no es editable; si HC no tiene registro, muestra la leyenda correspondiente.
7. Al marcar "TOMOGRAFIA ANGIO CEREBRAL" (contraste), la etiqueta de creatinina muestra el rótulo de obligatoriedad y el guardado se bloquea hasta ingresar un valor; al desmarcar el estudio, vuelve a ser opcional.
8. Con "Buscar por Nombre" activo, escribir "torax" (sin tilde) devuelve prestaciones de Radiografías, Tomografías y Ultrasonografías, cada una con su distintivo de categoría; el componente es el mismo que usa Laboratorio.
9. Desactivar la categoría "Tomografías" en Parametrización la elimina de Nueva Solicitud de inmediato sin afectar solicitudes históricas.
10. Cambiar "Fecha deseada" a Oculto en Opciones de llenado hace desaparecer el campo del formulario; el cambio queda auditado.
11. Guardar una solicitud válida genera folio `SOL-AAAA-NNNN`, estado Pendiente, y aparece en el listado del paciente.
12. Intentar configurar "Posibilidad de embarazo" como Opcional u Oculto es rechazado por el sistema.

## Apéndice A — Catálogo semilla

Cargar como datos semilla las prestaciones definidas en la constante `RAW` de `mockup_modulo_imagenes.html` (nombres oficiales, no modificar): Estudios Especiales (36), Radiografías (70), Resonancia Magnética (53), Tomografías (71), Ultrasonografías (62). Derivar los flags iniciales `requiere_contraste` y `requiere_ayuno` de las expresiones `RE_CONTRASTE` y `RE_AYUNO` del mismo archivo, dejando su ajuste fino al administrador vía Parametrización. Prefijos de código: EE, RX, RM, TC, US + correlativo de 3 dígitos.

## Apéndice B — Campos del formulario (configuración inicial)

| Campo | Tipo | Estado inicial | Notas |
|---|---|---|---|
| Diagnóstico presuntivo (CIE-11) | selector desde expediente + otro | Obligatorio | RF-03 |
| Justificación clínica | texto largo | Obligatorio | |
| Prioridad de la solicitud | segmentado con colores | Obligatorio | RF-04, no ocultable |
| Fecha de la solicitud | fecha | Opcional | visible solo con Rutina (RF-05) |
| ¿Posibilidad de embarazo? | selector | Obligatorio | no configurable por debajo (RF-06) |
| Alergias conocidas | solo lectura desde HC | Opcional | RF-07 |
| Creatinina sérica (mg/dL) | numérico | Opcional | obligatoria con contraste (RF-08) |
| Observaciones para el técnico | texto largo | Oculto | |
