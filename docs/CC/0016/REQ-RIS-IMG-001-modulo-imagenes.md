# REQ-RIS-IMG-001 — Módulo de Radiología e Imágenes (solicitud, parametrización y seguimiento)

| Campo | Valor |
|---|---|
| Control de cambios | **CC-0016** |
| Fecha | 2026-08-08 |
| Solicitante | Edwin Martínez (Inversiones Avante) |
| Mockup (fuente de verdad) | `docs/CC/0016/mockup_modulo_imagenes.html` (MOCKUP v1) |
| Pantalla | `/imaging` (rework total; `/imaging/new` redirige) |
| Rama | `feat/cc-0016-modulo-imagenes` |
| SQL | `packages/database/sql/192_cc0016_modulo_imagenes.sql` — **APLICADO a prod 2026-08-08 (no re-aplicar)** |
| Seed | `packages/database/scripts/seed-imagenes-catalogo.mjs` — catálogo 292 prestaciones × org (idempotente) |

## 1. Requerimiento
Módulo de radiología e imágenes según mockup: **Nueva Solicitud** (categorías, búsqueda global, chips con contraste/nota, campos según parametrización), **Solicitudes del paciente** (folio, estado), y **Parametrización** completa (categorías, catálogo de prestaciones con contraste/ayuno/duración/sala/autorización/preparación, campos del formulario obligatorio/opcional/oculto, reglas generales).

## 2. Diseño (adecuar RIS legacy, no duplicar)
- **Catálogo** = LabPanel/LabTest área RADIOLOGIA **por tenant** (5 categorías IMG-\*: Estudios Especiales, Radiografías, Resonancia Magnética, Tomografías, Ultrasonografías; 292 prestaciones literales con códigos EE/RX/RM/TC/US+NNN) + satélite **`ImagingTestAttrs`** 1:1 (contraste, ayuno, autorización, duración, sala/equipo→ImagingModality, preparación, alias tarifario). Derivaciones automáticas del mockup replicadas y verificadas: 40 contraste, 24 ayuno, 36 autorización. El catálogo demo global AVT-RAD-\* (CC-0011) quedó desactivado (reversible). HC misceláneos consume el nuevo automáticamente.
- **Solicitud** = cabecera nueva `ImagingRequest` (folio `SOL-{YYYY}-{NNNN}` por secuencia atómica org/año; cuenta del paciente patrón CC-0015; dx/justificación/prioridad/fecha deseada/embarazo/alergias/creatinina/observaciones) con N `ImagingOrder` hijas del RIS existente (`requestId`, `conContraste`, `notaEstudio`; `patientAccountId`; `encounterId` nullable — patrón CC-0013). **Estado derivado** del agregado de las hijas: Pendiente→Programado→Realizado→Informado (+Anulado).
- **Parametrización** = `ImagingFormFieldConfig` (8 campos, estados obligatorio/opcional/oculto) y `ImagingModuleRule` (multi, global, codigo, flags, dupWarn 30 días REAL, firma PIN, maxN configurable) por organización, con seed de defaults del mockup. **Validaciones server-side** (el mockup las tenía solo en JS): campos obligatorios según config, contraste⇒creatinina, tope maxN, advertencia de duplicados contra solicitudes reales, firma PIN (patrón firma electrónica) cuando la regla está activa.
- Router nuevo `imagingRequest` (el `imaging.router` RIS/DICOM existente queda intacto — 31/31 tests). Deep-links de la bandeja (`/imaging?id=`) resueltos vía `resolverDeepLink` (solicitud u orden legada).
- `price-resolver` (CC-0015) extendido con alias `codigoTarifario` — cero regresión en laboratorio.

## 3. Desviaciones documentadas
- Estado «Anulado» agregado (no está en el mockup; necesario por el enum real del RIS).
- «Sala/Equipo» del modal SÍ se persiste (`modalityId`) — el mockup lo mostraba pero no lo guardaba (hueco corregido).
- `alergias` con estudios de contraste: el mockup lo menciona pero no lo valida — se mantiene informativo (la validación dura es creatinina).
- Categoría→modalidad DICOM: esp→XA, rx→CR, rm→MR, tac→CT, usg→US.

## 4. Fuera de alcance / seguimiento
- Precios de las 292 prestaciones (standardPrice/alias tarifario NULL — se parametrizan por admin o CC de mapeo Odoo↔HIS).
- Agenda/programación de salas (scheduledAt existe en RIS; UI de agenda es otro CC).
- E2E Playwright del flujo completo.
