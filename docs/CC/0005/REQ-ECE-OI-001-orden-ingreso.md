# REQ-ECE-OI-001 — Orden de Ingreso: identificación por documento y diagnóstico CIE‑11

**Proyecto:** HIS Multipaís · **Módulo:** ECE — Atención
**Ruta:** `/ece/orden-ingreso/nuevo` (Next.js App Router)
**Stack:** Next.js (App Router) · tRPC · Prisma · Supabase/PostgreSQL · Zod · Tailwind/shadcn
**Tipo:** Refactor de campos + integración de catálogo · **Prioridad:** Alta

---

## 1. Objetivo

Modificar el formulario de Orden de Ingreso para que (a) el paciente se identifique por su **documento de identidad** (DUI, Carnet de residencia, Pasaporte o DUI del Responsable) en lugar del campo **MRN**, y (b) el diagnóstico de ingreso se capture con **CIE‑11** consumiendo el **API ya integrado**, sustituyendo el catálogo **CIE‑10**.

## 2. Estado actual

- Campo **MRN** como identificador del paciente.
- Selector de diagnóstico basado en **CIE‑10**.
- (El resto de campos del formulario se conserva sin cambios.)

## 3. Requerimientos funcionales

| ID | Requerimiento |
|----|---------------|
| **RF-1** | Reemplazar el campo **MRN** por un bloque **"Identificación del paciente"** compuesto por: **tipo de documento** (selector) + **número de documento** (con máscara/validación según el tipo). El documento resuelve al **expediente** existente del paciente (registro interno permanente). |
| **RF-2** | Reemplazar el selector **CIE‑10** por un **buscador de diagnóstico CIE‑11** que consume el **API CIE‑11 ya integrado** (autocompletar por término → devuelve código + título). |

## 4. Detalle RF‑1 — Tipos de documento

Enum alineado con el módulo de **Expediente** (formato/validación ya definidos ahí; **reutilizar**, no redefinir):

| Valor (enum) | Etiqueta UI | Formato / nota |
|---|---|---|
| `DUI` | DUI | `########-#` (8 dígitos + dígito verificador). Nacionales mayores de edad. |
| `CARNET_RESIDENCIA` | Carnet de residencia | Extranjeros residentes (formato DGME). |
| `PASAPORTE` | Pasaporte | Alfanumérico, variable por país. |
| `DUI_RESP` | DUI del responsable | Mismo formato que `DUI`. Menores o pacientes sin documento propio. |

Comportamiento:
- Al ingresar un número válido, **buscar el expediente** correspondiente. Si existe → cargar el contexto del paciente y mostrar el documento como identificador visible. Si no existe → permitir el flujo de paciente nuevo / alta de expediente según el patrón actual.
- La validación del número depende del tipo seleccionado.

## 5. Detalle RF‑2 — Diagnóstico CIE‑11

- **Buscador con autocompletar** (debounce) contra el servicio CIE‑11 ya integrado; resultado = `código` + `título`.
- Persistir por diagnóstico: `codigo`, `titulo`, `uri` (foundation/linearization) y `version` del catálogo.
- **Postcoordinación:** CIE‑11 admite *stem code* + *extension codes*; el modelo debe guardar el **string completo del código** (clúster) para no perder el detalle postcoordinado.
- Soportar **diagnóstico principal (obligatorio)** y **secundarios (opcionales, múltiples)** — *ver supuesto §9*.

## 6. Persistencia / modelo de datos

> Verificar y ajustar contra el schema Prisma existente.

- `OrdenIngreso`:
  - **Quitar** `mrn`.
  - **Agregar** `expedienteId` (FK al expediente inmutable) + denormalizar `documentoTipo` (enum) y `documentoNumero` para visualización/auditoría.
  - **Reemplazar** `cie10*` por diagnósticos CIE‑11 (campos `cie11Codigo`, `cie11Titulo`, `cie11Uri`) o, si hay múltiples, tabla `OrdenIngresoDiagnostico` (`ordenId`, `codigo`, `titulo`, `uri`, `tipo` `PRINCIPAL|SECUNDARIO`, `version`).
- **No** eliminar el identificador interno del expediente: el formulario identifica **por documento que resuelve al expediente** (ver §9).

## 7. Implementación sugerida

- **Componentes:**
  - `PacienteDocumentoSelector` → tipo + número con validación por tipo; **reutilizar** el componente/lógica del módulo Expediente si ya existe. Resuelve vía tRPC `paciente.buscarPorDocumento` / `expediente.resolve`.
  - `DiagnosticoCie11Search` → autocompletar con debounce; tRPC `cie11.search` (envuelve el API integrado); devuelve `{ codigo, titulo, uri }`.
- **Validación:** esquema **Zod** con `documentoTipo` (enum) + `documentoNumero` con `refine` por tipo; `cie11Codigo` obligatorio para el principal.
- **Conservar** los demás campos y comportamientos del formulario (fecha/hora, servicio, tipo de ingreso, médico, episodio, acciones).

## 8. Criterios de aceptación

- **AC-1** El campo MRN ya no existe; en su lugar hay tipo de documento + número.
- **AC-2** El selector de tipo ofrece DUI, Carnet de residencia, Pasaporte y DUI del responsable.
- **AC-3** La validación del número se aplica según el tipo (p. ej. `########-#` para DUI/DUI_RESP).
- **AC-4** Un documento válido resuelve y carga el expediente existente del paciente.
- **AC-5** El diagnóstico se busca y selecciona desde el catálogo **CIE‑11** vía el API integrado; ya no aparece CIE‑10.
- **AC-6** Se persiste código + título (+ URI/versión) del CIE‑11 seleccionado.
- **AC-7** Existe diagnóstico principal obligatorio; se pueden agregar secundarios opcionales.
- **AC-8** El resto de campos del formulario funciona igual que antes.

## 9. Supuestos y decisiones

- **El expediente interno (permanente/inmutable) se conserva.** El formulario identifica al paciente **por documento**, que **resuelve** a ese expediente. Razones: integridad referencial, soporte a menores/extranjeros (documento del responsable), y que un documento puede renovarse/cambiar sin alterar el historial clínico. *(Si la intención es eliminar por completo el identificador interno y usar el documento como clave primaria, ajustar §6.)*
- **Diagnóstico:** principal obligatorio + secundarios opcionales múltiples. *(Si solo se requiere uno, simplificar §5/§6.)*
- **CIE‑11:** la integración con el API ya existe (según el requerimiento); se asume disponible el procedure `cie11.search`. Linearización esperada: MMS.

## 10. Fuera de alcance

- Migración de expedientes/MRN heredados.
- Mapeo CIE‑10 → CIE‑11 de registros históricos (la OMS publica tablas de equivalencia; tratar como tarea separada).
- Cambios en otros módulos que aún referencien MRN o CIE‑10 (relevar por separado).
