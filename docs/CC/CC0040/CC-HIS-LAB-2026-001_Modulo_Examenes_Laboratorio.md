# Control de Cambios — Módulo "Selección de Exámenes de Laboratorio" (HIS)

> Documento de requerimiento para implementación en el HIS (Expediente Electrónico / Historia Clínica).
> Formato: Control de Cambios (Change Request). Redactado para desarrollo asistido con Claude Code.

---

## 1. Ficha del control de cambios

| Campo | Detalle |
|---|---|
| **N.º de control** | CC-HIS-LAB-2026-001 |
| **Título** | Módulo de selección de exámenes de laboratorio con configuración dependiente por tipo/subtipo de muestra y mantenimiento de catálogos |
| **Sistema** | HIS — Expediente Electrónico / Historia Clínica |
| **Módulo / Pantalla** | "Seleccionar Exámenes de Laboratorio" |
| **Tipo de cambio** | Nueva funcionalidad (New feature) |
| **Prioridad** | Alta |
| **Solicitante** | Edwin Martínez (emartinez@complejoavante.com) |
| **Fecha de solicitud** | 2026-09-18 |
| **Versión del documento** | 1.0 |
| **Estado** | Propuesto / En revisión |
| **Referencia de prototipo** | `mockup_examenes_laboratorio.html` (mockup funcional aprobado) |
| **Catálogo base** | `PORTAFOLIO_EX` (157 pruebas, 10 secciones) |

---

## 2. Objetivo

Incorporar al HIS un módulo que permita al personal clínico **seleccionar exámenes de laboratorio** para un paciente mediante una **configuración de búsqueda dependiente** (tipo de muestra → subtipo de muestra → sección → pruebas), armar la **solicitud de laboratorio** con cantidad y parámetros por prueba, y administrar los **catálogos** que alimentan el módulo (pruebas, secciones, tipos y subtipos de muestra), con reglas de dependencia e integridad referencial.

---

## 3. Alcance

**Dentro de alcance:**

- Pantalla de selección de exámenes con filtro en cascada dependiente y selección múltiple de pruebas.
- Solicitud de laboratorio editable (cantidad, parámetros por prueba, procedencia para cultivos que la requieran).
- Consulta de un tablero de solicitudes por cuentas activas y edición de instrucciones/estado por examen.
- Mantenimiento de catálogos dependientes (pruebas, secciones, tipos de muestra, subtipos de muestra) con CRUD e integridad referencial.
- Persistencia de configuración y respaldo/restauración (exportar / importar / restablecer).

**Fuera de alcance (para este control):**

- Interfaz con el equipo/analizador de laboratorio (LIS) y resultados.
- Facturación/cargo automático de las prestaciones a la cuenta del paciente.
- Firma electrónica y flujo de autorización clínica.
- Impresión de etiquetas de muestra y códigos de barras.

---

## 4. Antecedentes / situación actual

Actualmente la selección de exámenes se realiza sobre un listado plano de prestaciones sin agrupación por tipo de muestra ni catálogos administrables por el usuario, lo que dificulta encontrar la prueba correcta, estandarizar la toma de muestra y mantener el portafolio de exámenes. Este cambio introduce una navegación guiada por tipo/subtipo de muestra y un mantenimiento configurable de todos los catálogos.

---

## 5. Descripción del cambio (resumen ejecutivo)

Se implementa un módulo de escogitación de exámenes con:

1. Un **buscador por nombre** y una **configuración dependiente** en tres niveles (tipo de muestra → subtipo → sección) que filtra las pruebas disponibles.
2. Un listado de **pruebas** de selección múltiple, ordenado alfabéticamente en disposición columnar, con un control **"TODOS"** para incluir todas las pruebas filtradas.
3. Una **solicitud de laboratorio** en formato lista con cantidad editable, parámetros configurables por prueba y captura de procedencia para cultivos que lo requieran.
4. Un **tablero de solicitudes** por cuentas activas con edición de estado e instrucciones por examen.
5. Un **mantenimiento de catálogos** con cuatro catálogos dependientes (pruebas, secciones, tipos de muestra, subtipos de muestra), integridad referencial y persistencia con respaldo.

---

## 6. Requerimientos funcionales

### 6.1 Selección de exámenes

- **RF-01 — Buscar por nombre.** El módulo debe permitir alternar a un modo de búsqueda por nombre que filtre las pruebas por texto (nombre, sección, tipo o subtipo de muestra).
- **RF-02 — Configuración dependiente (cascada).** Debe existir una configuración de búsqueda con tres pasos dependientes y de **selección única (radio)**:
  1. **Tipo de muestra** (con opción "Todos").
  2. **Subtipo de muestra** (con opción "Todos"), habilitado solo cuando hay un tipo seleccionado; muestra únicamente los subtipos del tipo elegido.
  3. **Sección** (selección única), mostrando solo las secciones que contengan pruebas conforme al filtro de muestra.
- **RF-03 — Filtrado.** Al cambiar tipo o subtipo, la lista de secciones y de pruebas debe recalcularse. Debe existir la acción "Quitar filtro de muestra".
- **RF-04 — Contadores.** Cada tipo/subtipo debe mostrar la cantidad de pruebas asociadas; los tipos sin pruebas se muestran deshabilitados.
- **RF-05 — Pruebas (selección múltiple).** La sección "Pruebas" permite seleccionar varias pruebas mediante casillas.
- **RF-06 — Orden columnar alfabético.** Las pruebas filtradas se muestran en **orden alfabético columnar**: descendente por la columna 1, luego columna 2 y subsecuentes.
- **RF-07 — Control "TODOS".** Debe existir un control con etiqueta **"TODOS"** que, al activarse, seleccione todas las pruebas actualmente filtradas y, al desactivarse, las quite. Estado reflejado (marcado/indeterminado). *Tooltip requerido:* **"Incluir todas las pruebas de esta sección."**

### 6.2 Solicitud de laboratorio

- **RF-08 — Panel de solicitud.** Las pruebas seleccionadas se listan en el panel "Tablero específico de solicitudes de laboratorio clínico" con columnas: N.º, Prueba, Sección, Tipo/Subtipo, Parámetros, Cantidad y acción de quitar.
- **RF-09 — Cantidad.** Columna **Cantidad** editable, entero ≥ 1. Valor por defecto **1**; para **hemocultivo** el valor por defecto es **2**.
- **RF-10 — Parámetros por prueba.** Cada prueba puede tener parámetros propios (definidos en el catálogo). En la solicitud, por examen, debe poder seleccionarse cuáles parámetros se procesan (multiselección); por defecto se incluyen todos los parámetros de la prueba. Los cambios del catálogo se reflejan (mapean) en la selección.
- **RF-11 — Procedencia de cultivo (condicional).** Si se selecciona una prueba cuyo nombre indique especificar procedencia (p. ej. **"CULTIVO ESPECIFICAR PROCEDENCIA"**), debe **habilitarse un campo de texto obligatorio** para capturar la procedencia de donde se toma el cultivo. El sistema no debe permitir guardar mientras la procedencia esté vacía.
- **RF-12 — Quitar / vaciar.** El usuario puede quitar una prueba individual o vaciar toda la solicitud; al quitar se descartan su cantidad, parámetros y procedencia.
- **RF-13 — Guardar / resumen.** La acción **"Guardar Exámenes"** debe presentar un resumen con total de pruebas y estudios, y por cada prueba: sección, tipo/subtipo, cantidad, parámetros seleccionados y procedencia (cuando aplique). Debe validar la procedencia obligatoria antes de confirmar.

### 6.3 Tablero de solicitudes

- **RF-14 — Consultar tablero.** La acción **"Consultar Tablero"** abre una vista con las **cuentas activas** y sus exámenes por realizar, con indicadores (cuentas activas, exámenes totales, pendientes, urgentes) y búsqueda por cuenta/paciente/médico.
- **RF-15 — Detalle de solicitud.** Al abrir una cuenta, debe mostrarse un modal con los exámenes de esa cuenta; por examen se puede fijar **estado** (Pendiente / En proceso / Realizado) e **instrucción**, más una instrucción general. Guardable.

### 6.4 Mantenimiento de catálogos

- **RF-16 — Acceso.** Acción **"Mantenimiento de catálogos"** con cuatro pestañas: **Pruebas, Secciones, Tipos de muestra, Subtipos de muestra**.
- **RF-17 — CRUD Pruebas.** Alta/edición/eliminación de pruebas con: nombre, sección, tipo de muestra, subtipo de muestra (dependiente del tipo), cantidad por defecto y **configuración de parámetros por prueba**. Filtro por sección; una prueba nueva hereda la sección filtrada (gestión dependiente de la sección).
- **RF-18 — CRUD Secciones.** Alta/edición/eliminación de secciones con conteo de pruebas asociadas.
- **RF-19 — CRUD Tipos de muestra.** Alta/edición/eliminación de tipos, con conteo de subtipos y pruebas.
- **RF-20 — CRUD Subtipos de muestra.** Alta/edición/eliminación de subtipos; cada subtipo **pertenece a un tipo** (dependiente).
- **RF-21 — Integridad referencial.** No se debe permitir eliminar una sección, tipo o subtipo que esté en uso por pruebas/subtipos; el sistema informa cuántos elementos dependen. Al **renombrar** una sección, tipo o subtipo, el cambio se **propaga** a las pruebas y parámetros relacionados.
- **RF-22 — Persistencia y respaldo.** El catálogo debe conservarse entre sesiones (autoguardado) y ofrecer **Exportar**, **Importar** y **Restablecer** para trasladar correcciones sin perderlas. *(En el HIS productivo, la persistencia es en base de datos; ver §11.)*

---

## 7. Requerimientos no funcionales

- **RNF-01 — Usabilidad.** Navegación guiada, etiquetas y tooltips en español; disposición responsiva (3/2/1 columnas según ancho).
- **RNF-02 — Rendimiento.** Filtrado y ordenamiento en tiempo interactivo para catálogos de cientos de pruebas.
- **RNF-03 — Consistencia de datos.** Un único origen de datos (catálogo) alimenta selección, tablero y solicitud; los cambios se reflejan de inmediato.
- **RNF-04 — Trazabilidad.** Cada solicitud guardada debe registrar usuario, fecha/hora, cuenta del paciente y detalle de prestaciones (cantidad, parámetros, procedencia).
- **RNF-05 — Seguridad y auditoría.** Acciones de mantenimiento de catálogos restringidas por rol; registro de auditoría de altas/ediciones/eliminaciones.
- **RNF-06 — Normativa (El Salvador).** Cumplimiento con protección de datos del paciente y lineamientos MINSAL aplicables al expediente electrónico.

---

## 8. Modelo de datos / catálogos

Entidades y relaciones (jerarquía de dependencia):

- **Tipo de muestra** (1) → **Subtipo de muestra** (N). Un subtipo pertenece a un tipo.
- **Sección** (1) → **Prueba** (N).
- **Prueba** referencia: Sección, Tipo de muestra, Subtipo de muestra, Cantidad por defecto.
- **Prueba** (1) → **Parámetro** (N). Los parámetros son propios de cada prueba.

Estructura lógica sugerida:

```
Seccion(id, nombre)
TipoMuestra(id, nombre)
SubtipoMuestra(id, nombre, tipo_id)         -- dependiente de TipoMuestra
Prueba(id, nombre, seccion_id, tipo_id, subtipo_id, cantidad_defecto)
Parametro(id, prueba_id, nombre)            -- dependiente de Prueba
Solicitud(id, cuenta_id, usuario, fecha)
SolicitudDetalle(id, solicitud_id, prueba_id, cantidad, procedencia, instruccion, estado)
SolicitudDetalleParametro(detalle_id, parametro_id)
```

Volumen base del portafolio actual: **10 secciones**, **9 tipos de muestra**, subtipos según taxonomía (Anexo A), **157 pruebas**.

---

## 9. Reglas de negocio y dependencias

- **RN-01.** El Subtipo depende del Tipo; solo se listan subtipos del tipo seleccionado.
- **RN-02.** La lista de secciones y pruebas se restringe al filtro de muestra activo.
- **RN-03.** Cantidad por defecto = 1, excepto hemocultivo = 2 (parametrizable por prueba).
- **RN-04.** Prueba con leyenda "especificar procedencia" ⇒ procedencia obligatoria.
- **RN-05.** No eliminar catálogos en uso; renombrados se propagan a dependientes.
- **RN-06.** La sección antes llamada **"Bacteriología"** se denomina **"Microbiología"** (incluye migración de datos existentes).
- **RN-07.** Orden de pruebas: alfabético, disposición columnar.

---

## 10. Criterios de aceptación

- [ ] **CA-01.** Al elegir Tipo y luego Subtipo, la Sección y las Pruebas se filtran acordemente; con "Todos" no se filtra.
- [ ] **CA-02.** El paso Subtipo solo muestra subtipos del Tipo elegido (dependencia).
- [ ] **CA-03.** Las pruebas filtradas se muestran en orden alfabético columnar (columna 1, luego 2, luego 3).
- [ ] **CA-04.** El control "TODOS" selecciona/deselecciona todas las pruebas filtradas y su tooltip dice exactamente "Incluir todas las pruebas de esta sección.".
- [ ] **CA-05.** La cantidad por defecto es 1 y 2 para hemocultivo, y es editable (mínimo 1).
- [ ] **CA-06.** Los parámetros configurados por prueba aparecen en la selección del examen y reflejan altas/bajas/renombrados del catálogo.
- [ ] **CA-07.** Al seleccionar "CULTIVO ESPECIFICAR PROCEDENCIA" se habilita el campo de procedencia; no se puede guardar si está vacío; la procedencia aparece en el resumen.
- [ ] **CA-08.** El mantenimiento tiene 4 pestañas (Pruebas, Secciones, Tipos, Subtipos) con CRUD funcional.
- [ ] **CA-09.** No se puede eliminar una sección/tipo/subtipo en uso; el renombrado se propaga a pruebas y parámetros.
- [ ] **CA-10.** Crear una nueva sección/tipo/subtipo/prueba no genera errores; la nueva prueba hereda la sección del filtro.
- [ ] **CA-11.** La sección "Bacteriología" aparece como "Microbiología" y los datos previos se migran.
- [ ] **CA-12.** Exportar/Importar/Restablecer conservan y restauran los catálogos sin pérdida de correcciones.

---

## 11. Impacto

| Área | Impacto |
|---|---|
| **Base de datos** | Nuevas tablas/campos (§8). En productivo, sustituir la persistencia local del prototipo por almacenamiento en BD del HIS. |
| **Backend/API** | Endpoints CRUD de catálogos y de solicitud; validaciones de integridad y de procedencia. |
| **UI** | Nueva pantalla de selección, tablero y mantenimiento de catálogos. |
| **Integraciones** | Preparar (fuera de este control) enlace a facturación de cuentas y a LIS. |
| **Datos existentes** | Migración "Bacteriología" → "Microbiología". |
| **Roles/Seguridad** | Nuevo permiso para "Mantenimiento de catálogos de laboratorio". |

---

## 12. Plan de implementación y despliegue

1. Aprobación del control de cambios.
2. Modelo de datos y migraciones (incluye renombrado de sección).
3. API de catálogos y de solicitud con validaciones.
4. UI del módulo (selección, solicitud, tablero, mantenimiento).
5. Carga inicial del portafolio (Anexo B / archivo `PORTAFOLIO_EX`).
6. Pruebas (unitarias, integración y aceptación con §10).
7. Despliegue en ambiente de pruebas → validación de usuario → producción.

---

## 13. Plan de reversión (rollback)

- Desactivar el acceso al nuevo módulo por configuración/feature flag.
- Revertir migraciones de esquema (script de rollback), restaurando el nombre "Bacteriología" si fuese necesario.
- Restaurar respaldo de catálogos previo (Exportar/Importar o backup de BD).

---

## 14. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Clasificación de tipo/subtipo por prueba imprecisa | Media | Medio | Revisión clínica del catálogo; edición en mantenimiento. |
| Eliminación de catálogos con dependencias | Baja | Alto | Integridad referencial (RF-21) bloquea el borrado. |
| Pérdida de correcciones al actualizar | Media | Medio | Exportar/Importar y respaldo en BD (RF-22). |
| Migración de nombre de sección | Baja | Medio | Script idempotente con rollback (§13). |

---

## 15. Dependencias y supuestos

- El HIS provee identidad de usuario, cuenta del paciente y control de roles.
- El portafolio de pruebas se carga desde `PORTAFOLIO_EX`.
- La facturación y el envío al LIS se abordan en controles de cambio posteriores.

---

## 16. Notas para implementación (Claude Code)

- Mantener **un único origen de datos** (catálogo) del que derivan selección, tablero y solicitud.
- Respetar la **jerarquía dependiente**: Tipo → Subtipo → (Sección/Prueba) → Parámetro.
- Reglas críticas a cubrir con pruebas automatizadas: RN-01, RN-03, RN-04, RN-05, RN-06 y RF-07 (tooltip textual), RF-11 (procedencia obligatoria) y RF-21 (integridad/propagación).
- Referencia visual y de comportamiento: prototipo `mockup_examenes_laboratorio.html`.

---

## 17. Historial de versiones del documento

| Versión | Fecha | Autor | Descripción |
|---|---|---|---|
| 1.0 | 2026-09-18 | E. Martínez / Claude (Cowork) | Emisión inicial del control de cambios con requerimientos del módulo. |

---

## Anexo A — Catálogo de tipos y subtipos de muestra

- **Sangre y derivados:** Sangre total (EDTA), Suero, Plasma (citratado), Sangre capilar, Sangre arterial, Hemocultivo, Gota gruesa / frotis.
- **Orina:** Orina al azar, Primera orina de la mañana, Orina de 24 horas, Chorro medio (urocultivo), Cateterizada / suprapúbica.
- **Heces:** Heces frescas / preservante, Muestra seriada (parásitos), Hisopado / raspado anal.
- **Secreciones y exudados:** Faríngeo / nasofaríngeo, Uretral / vaginal / endocervical, Conjuntival / ótico, Heridas, úlceras, abscesos.
- **Líquidos corporales:** LCR, Pleural / peritoneal / pericárdico, Sinovial (articular), Amniótico.
- **Tracto respiratorio:** Esputo, Aspirado / lavado bronquial, Aspirado traqueal.
- **Aparato reproductor:** Semen / líquido seminal, Secreción prostática.
- **Tejidos y médula:** Médula ósea, Tejidos y biopsias, Raspados piel/uñas/pelo (micológico).
- **Otros:** Saliva, Cálculos (litos), Sudor, Uñas/cabello (toxicología), Ambientales / puntas de catéter.

## Anexo B — Secciones del portafolio

Química, Urianálisis, Hematología, Pruebas Especiales, Coagulación, Coprología, Inmunología/Serología, **Microbiología** (antes Bacteriología), Inmuno-Hematología, Biología Molecular.

---

*Fin del documento — CC-HIS-LAB-2026-001 v1.0*
