# Auditoría Stream G — Cumplimiento NTEC (Módulos Administrativos ECE)

**Fecha:** 2026-05-19
**Auditor:** @AS — Arquitecto de Software, Unidad de Transformación Digital, Inversiones Avante
**Rama auditada:** `feat/fase2-s1-gate` (commit `6532a92`)
**Método:** Lectura estática de UI (`apps/web/src/app/`), routers tRPC (`packages/trpc/src/routers/`), contratos Zod y referencias a tablas `ece.*` mediante raw SQL. Sin modificaciones a BD.
**Scope:** 10 módulos — Bitácora ECE, Certificación DIR, Comité calidad, Calidad documental, Admisiones pendientes, Rectificaciones, Workflow Designer, Workflows runtime, Firma electrónica setup, Contingencia/Retención/ARCO.

---

## Índice

1. [Módulo 1 — Bitácora ECE Timeline](#modulo-1)
2. [Módulo 2 — Certificación DIR](#modulo-2)
3. [Módulo 3 — Comité Calidad Documental](#modulo-3)
4. [Módulo 4 — Calidad Documental (Dashboard)](#modulo-4)
5. [Módulo 5 — Admisiones Pendientes](#modulo-5)
6. [Módulo 6 — Rectificaciones](#modulo-6)
7. [Módulo 7 — Workflow Designer](#modulo-7)
8. [Módulo 8 — Workflows Runtime](#modulo-8)
9. [Módulo 9 — Firma Electrónica Setup](#modulo-9)
10. [Módulo 10 — Contingencia / Retención / ARCO](#modulo-10)
11. [Resumen Consolidado Stream G](#resumen-final)

---

## Módulo 1 — Bitácora ECE Timeline {#modulo-1}

### 1.1 Resumen ejecutivo

El módulo cubre el registro y consulta de accesos al expediente clínico (NTEC Arts. 45-52). Consta de dos vistas: tabla paginada (`/ece/bitacora`) con filtros avanzados, exportación CSV y métricas, y vista timeline (`/ece/bitacora/timeline`) agrupada por día. El router `bitacora` en `packages/trpc/src/routers/ece/bitacora.router.ts` implementa `list`, `exportCsv`, `metrics` y `register`.

**Actores:** DIR, ARCH (lectura); cualquier usuario autenticado (registro).
**Normativa:** NTEC Arts. 45-52 (retención 10 años, inmutabilidad, acceso auditado).

### 1.2 Archivos auditados

- `apps/web/src/app/(admin)/ece/bitacora/page.tsx`
- `apps/web/src/app/(admin)/ece/bitacora/timeline/page.tsx`
- `packages/trpc/src/routers/ece/bitacora.router.ts`

### 1.3 Matriz de trazabilidad

| # | Campo UI | Procedure tRPC | Input Zod | Columna BD | Tipo UI | Tipo Zod | Tipo SQL | Validación UI | Validación Zod | Constraint BD | Observación |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Desde (date input) | `bitacora.list` | `desde z.string().datetime().optional()` | `registrado_en` | `<input type="date">` | string ISO optional | `timestamptz` | none | datetime string | NOT NULL DEFAULT now() | **C7**: UI convierte con `new Date(string).toISOString()` — timezone shift posible. |
| 2 | Hasta (date input) | `bitacora.list` | `hasta z.string().datetime().optional()` | `registrado_en` | `<input type="date">` | string ISO optional | `timestamptz` | none | datetime string | NOT NULL DEFAULT now() | **C7**: ídem que #1. |
| 3 | Acción (multi-select) | `bitacora.list` | `accion accionEnum.optional()` | `accion text` | checkbox chips | enum optional | text NOT NULL | toggle chip | enum Zod 16 valores | sin CHECK constraint (solo text) | **C2**: el router acepta un solo accion; filtro multi en cliente es workaround — no filtra servidor-side para múltiples selecciones. |
| 4 | Paciente query | `bitacora.list` | `pacienteId z.string().uuid().optional()` | `paciente_id uuid` | text libre | uuid optional | uuid NULL | none | uuid validate | FK nullable | **C1**: UI envía texto libre; router espera UUID. Si el usuario ingresa nombre, el filtro no llega al servidor. |
| 5 | Personal query | `bitacora.list` | `personalId z.string().uuid().optional()` | `firma_id` (JOIN) | text libre | uuid optional | uuid NULL | none | uuid validate | FK nullable | **C1**: ídem #4 — texto libre vs UUID esperado. |
| 6 | Export CSV | `bitacora.exportCsv` | `{desde, hasta, accion}` | `ece.bitacora_acceso` | Button | — | — | disabled state | — | — | Correcto. |
| 7 | Export PDF | `printPdfReport()` | — (client-only) | — | Button | — | — | — | — | — | **C6**: PDF generado solo con `window.print()` sin firma DIR ni hash de integridad. Art. 52 requiere firma del director en reportes oficiales. |
| 8 | Métricas | `bitacora.metrics` | `{desde, hasta}` | `ece.bitacora_acceso` | Card | — | — | — | — | — | Correcto. |

### 1.4 Hallazgos

#### HG-01 — [P1] — Filtros paciente/personal usan texto libre pero router espera UUID

**Descripción:** Los campos "Paciente" y "Personal" en el FilterPanel (`bitacora/page.tsx:273-308`) reciben texto libre (nombre). El router `bitacora.list` en `bitacora.router.ts:73-81` espera `pacienteId: z.string().uuid().optional()` y `personalId: z.string().uuid().optional()`. Si el usuario escribe un nombre, Zod rechaza la entrada (no es UUID válido) o el campo no se envía — en ambos casos el filtro resulta en un no-op silencioso.
**Archivos:** `apps/web/src/app/(admin)/ece/bitacora/page.tsx:273-308`, `packages/trpc/src/routers/ece/bitacora.router.ts:73-81`.
**Recomendación:** Cambiar los campos a autocomplete con búsqueda por nombre que resuelva al UUID antes de enviar, o extender el router para aceptar texto libre con búsqueda ILIKE en `User.fullName`.
**Riesgo go-live:** Alto. El filtro regulatorio de bitácora por paciente es requerimiento NTEC Art. 48 — sin él no se puede auditar accesos por paciente individual.

#### HG-02 — [P1] — Filtro multi-acción aplicado solo en cliente, no en servidor

**Descripción:** El router `bitacora.list` acepta un solo `accion?: accionEnum` (`bitacora.router.ts:77`). La UI permite selección múltiple de acciones (`ACCIONES_TODAS`, 16 valores), pero al enviar múltiples selecciones la función `buildListInput()` (`page.tsx:100-115`) solo envía la primera si hay exactamente una; con múltiples aplica filtro client-side sobre resultados ya paginados de 50 filas. Esto rompe la paginación: la página 1 puede mostrar 0 resultados visibles aunque haya 1000 registros en páginas siguientes.
**Archivos:** `apps/web/src/app/(admin)/ece/bitacora/page.tsx:100-115`, `packages/trpc/src/routers/ece/bitacora.router.ts:73-81`.
**Recomendación:** Extender `bitacoraListInput` a `accion: z.array(accionEnum).optional()` y modificar la cláusula WHERE a `b.accion = ANY($N::text[])`.
**Riesgo go-live:** Alto. Filtrado incorrecto de acciones críticas (FIRMAR, CERTIFICAR) en una herramienta de auditoría NTEC.

#### HG-03 — [P2] — Export PDF sin firma DIR ni hash de integridad (Art. 52 NTEC)

**Descripción:** La función `handleExportPdf()` (`page.tsx:526-528`) usa `printPdfReport()` que genera HTML con `window.open()` y `window.print()`. El reporte no incluye firma electrónica del director ni hash SHA-256 de la cadena de auditoría. El Art. 52 NTEC y TDR §6.3 requieren que los reportes de bitácora sean firmados digitalmente antes de ser entregados a organismos reguladores.
**Archivos:** `apps/web/src/app/(admin)/ece/bitacora/page.tsx:148-189, 526-528`.
**Recomendación:** Redirigir a un endpoint `/api/bitacora/report.pdf` (server-side) que genere PDF con membrete MINSAL, hash SHA-256 de la consulta y solicite PIN DIR antes de entregar.
**Riesgo go-live:** Medio. El CSV exportado es suficiente para auditorías internas. El PDF sin firma no es válido ante reguladores.

#### HG-04 — [P2] — `new Date(string).toISOString()` en filtros fecha — timezone shift posible

**Descripción:** Las funciones `buildListInput()` y `buildMetricsInput()` convierten `f.desde` y `f.hasta` (strings "YYYY-MM-DD") mediante `new Date(f.desde).toISOString()` (`page.tsx:106-108, 127-130`). En timezone UTC-6 (El Salvador), `new Date("2026-05-19")` produce `2026-05-18T18:00:00Z`, desplazando el filtro un día. El mismo anti-patrón aparece en `bitacora/timeline/page.tsx:208-211`.
**Archivos:** `apps/web/src/app/(admin)/ece/bitacora/page.tsx:106-130`, `apps/web/src/app/(admin)/ece/bitacora/timeline/page.tsx:208-211`.
**Recomendación:** Enviar las fechas como `"YYYY-MM-DDT00:00:00"` (sin zona) y dejar que el servidor las interprete en la zona del tenant, o usar el patrón `parseDateOnly(string)` ya establecido en el codebase.
**Riesgo go-live:** Medio. Filtros de bitácora con error de ±1 día en la frontera de fecha.

---

## Módulo 2 — Certificación DIR {#modulo-2}

### 2.1 Resumen ejecutivo

El módulo implementa el flujo de certificación formal de documentos ECE por el Director Médico (Art. 21 NTEC). La UI (`/ece/certificacion`) muestra la cola de documentos en estado `validado`, con indicador de antigüedad semáforo, selección múltiple (bulk) y dialog con campo PIN. El router `eceCertificacion.certificar` valida PIN argon2id, ejecuta la transición de estado y emite evento outbox.

**Actores:** DIR exclusivamente.
**Normativa:** NTEC Art. 21 — Certificación oficial; Arts. 23/39 — Firma electrónica con PIN.

### 2.2 Archivos auditados

- `apps/web/src/app/(admin)/ece/certificacion/page.tsx`
- `packages/trpc/src/routers/ece/certificacion.router.ts`

### 2.3 Matriz de trazabilidad

| # | Campo UI | Procedure tRPC | Input Zod | Columna BD | Tipo UI | Tipo Zod | Tipo SQL | Validación UI | Validación Zod | Constraint DB | Observación |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | PIN DIR | `eceCertificacion.certificar` | `pin z.string().regex(/^\d{6,8}$/)` | `ece.firma_electronica.pin_hash` | `<input type="password">` | string 6-8 dígitos | argon2id hash text | regex `^\d{6,8}$` + min=6 disabled | regex Zod + refine | argon2id verify | Correcto — pin validado UI y servidor. |
| 2 | Documento instanciaId | `eceCertificacion.certificar` | `instanciaId z.string().uuid()` | `ece.documento_instancia.id` | hidden (doc.id) | uuid | uuid PK | — | uuid | PK NOT NULL | Correcto. |
| 3 | Bulk mode (primer ID) | `handleConfirmPin()` | `instanciaId` (solo primero) | — | bulk checkbox | — | — | — | — | — | **C1 P1**: en bulk mode solo se certifica el PRIMER documento del Set; el resto queda sin certificar sin aviso. |
| 4 | Antigüedad semáforo | calculado client | — | `ultimo_cambio_en` timestamptz | badge color | — | — | — | — | — | Correcto — informativo, no afecta lógica. |
| 5 | Filtro servicio | client-side filter | no enviado al router | `ece.documento_instancia.servicio_nombre` | Input text | — | — | — | — | — | **C1 P2**: filtrado local sobre todas las filas cargadas. Si hay >25 docs, el filtro no opera sobre filas no cargadas (limit=25 en listCola). |

### 2.4 Hallazgos

#### HG-05 — [P1] — Bulk certificación solo procesa el primer documento del Set

**Descripción:** En `handleConfirmPin()` (`certificacion/page.tsx:405-417`), cuando `bulkMode=true`, se extrae `const [firstId] = selected` y se certifica únicamente ese documento. El comentario en el código reconoce esto: "Versión simplificada: se dispara la primera, las siguientes en onSuccess". Sin embargo, el callback `onSuccess` no itera el Set ni dispara los siguientes; simplemente limpia el estado y hace `colaQuery.refetch()`. Los documentos 2..N del bulk selection quedan sin certificar sin ningún aviso al usuario.
**Archivos:** `apps/web/src/app/(admin)/ece/certificacion/page.tsx:405-418`.
**Recomendación:** Implementar un loop en `onSuccess` que procese el siguiente ID del Set con el mismo PIN hasta agotar la selección, o bien implementar un procedure `certificarBulk` que reciba `instanciaIds: z.array(z.string().uuid())` y procese atómicamente (o en serie) en el servidor.
**Riesgo go-live:** Critico en contexto de uso. Un director que "certifica" 10 documentos solo firma 1. Los 9 restantes permanecen en estado `validado` sin retroalimentación.

#### HG-06 — [P2] — `listCola` usa cursor pagination pero la UI no implementa cursor

**Descripción:** El router `eceCertificacion.listCola` usa cursor pagination (`cursor: z.string().uuid().optional()`). La UI (`certificacion/page.tsx:336`) llama `trpc.eceCertificacion.listCola.useQuery({ incluirCertificados })` sin enviar cursor ni page. Con el default `limit: 25`, si hay más de 25 documentos pendientes la UI solo muestra los primeros 25 y no hay mecanismo para navegar al resto.
**Archivos:** `apps/web/src/app/(admin)/ece/certificacion/page.tsx:336`, `packages/trpc/src/routers/ece/certificacion.router.ts:62-67`.
**Recomendación:** Agregar paginación por cursor en la UI o cambiar el router a offset pagination con `page`/`pageSize` para simplicidad, dado que la UI ya usa ese patrón en otros módulos.
**Riesgo go-live:** Medio. En establecimientos con backlog grande de certificaciones solo se ven los 25 más antiguos.

#### HG-07 — [P2] — `FirmaRow` en `findFirmaDir` no selecciona `pin_hash` pero `checkPinDir` lo espera

**Descripción:** La función `findFirmaDir()` (`certificacion.router.ts:122-135`) selecciona `id, failed_attempts, locked_until, revoked_at` — omite `pin_hash`. Sin embargo, en el paso 3 del procedure `certificar` (`certificacion.router.ts:358-366`) se hace una segunda query que SÍ incluye `pin_hash`. La función `findFirmaDir` queda inutilizada y `checkPinDir` recibe un objeto cuyos campos se completan con un cast `FirmaRow & { pin_hash: string }`. El cast es seguro porque la segunda query es la que se usa realmente, pero `findFirmaDir` y `checkPinDir` son código dead/confuso que puede inducir a errores futuros.
**Archivos:** `packages/trpc/src/routers/ece/certificacion.router.ts:107-168`.
**Recomendación:** Eliminar `findFirmaDir` (no se usa en el flujo real) y simplificar `checkPinDir` para recibir `pin_hash` directamente.
**Riesgo go-live:** Bajo. No afecta comportamiento actual.

---

## Módulo 3 — Comité Calidad Documental {#modulo-3}

### 3.1 Resumen ejecutivo

Registro de minutas del Comité del Expediente Clínico (Art. 32 NTEC). La UI (`/ece/comite`) permite crear minutas con asistentes/temas/acuerdos en formato `"Nombre | Rol"` por texto libre, y firmarlas. El router `comiteEce` en `ece/comite-ece.router.ts` implementa `list`, `create`, `firmar` con hash chain SHA-256 idéntico al audit log.

**Actores:** DIR, ARCH, ADMIN.
**Normativa:** NTEC Art. 32 — Registro de reuniones del Comité.

### 3.2 Archivos auditados

- `apps/web/src/app/(admin)/ece/comite/page.tsx`
- `packages/trpc/src/routers/ece/comite-ece.router.ts`

### 3.3 Matriz de trazabilidad

| # | Campo UI | Procedure tRPC | Input Zod | Columna BD | Tipo UI | Tipo Zod | Tipo SQL | Validación UI | Validación Zod | Constraint DB | Observación |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Fecha reunión | `comiteEce.create` | `fechaReunion z.coerce.date()` | `ece.comite_minuta.fecha_reunion` | `<input type="date">` | Date coerce | date/timestamptz | max=today, required | coerce.date() | NOT NULL | **C7 P1**: `new Date(fecha)` en `handleSubmit` (`comite/page.tsx:122-127`) — mismo timezone shift que HG-04. |
| 2 | Asistentes | `comiteEce.create` | `asistentes: [{nombre, rol}]` | `ece.comite_minuta.asistentes jsonb` | text parse "Nombre | Rol" | array z.object | jsonb | alert() si formato malo | min 1, z.string | jsonb | **C5 P2**: UX confusa — `alert()` en lugar de inline error. El separador `|` no es validado con Zod, solo por split manual. |
| 3 | Firma presidente | `comiteEce.firmar` | `firmaPresidenteId z.string().uuid()` | — | `prompt()` nativo del browser | uuid | uuid | ninguna | uuid Zod | FK firma_electronica | **C6 P0**: `prompt()` de browser para ingresar UUID de firma. No hay PIN. Cualquier UUID válido arbitrario es aceptado. Viola Art. 32 NTEC (firma debe autenticar identidad). |
| 4 | hash chain | `comiteEce.firmar` | — | `chain_hash text` | code display (truncado) | — | text | — | — | NOT NULL post-firma | Correcto — hash chain implementado en el router. |

### 3.4 Hallazgos

#### HG-08 — [P0] — Firma de minuta mediante `prompt()` de browser — sin verificación PIN

**Descripción:** El botón "Firmar" en la tabla de minutas (`comite/page.tsx:336-347`) abre un `prompt()` nativo del browser solicitando "ID de firma electrónica del presidente del comité (UUID)". Cualquier UUID válido es aceptado; no hay verificación contra `ece.firma_electronica`. El router `comiteEce.firmar` recibe `firmaPresidenteId` como UUID sin validar que corresponda al usuario autenticado ni que tenga PIN configurado. Art. 32 NTEC requiere que la firma del presidente sea una firma electrónica válida y autenticada.
**Archivos:** `apps/web/src/app/(admin)/ece/comite/page.tsx:331-349`, `packages/trpc/src/routers/ece/comite-ece.router.ts` (procedure `firmar`).
**Recomendación:** Reemplazar el `prompt()` con un Dialog que solicite el PIN del usuario autenticado, verificarlo contra `ece.firma_electronica` (igual que `eceCertificacion.certificar`), y derivar `firmaPresidenteId` desde `ctx.user.id` en el servidor — nunca desde el input del cliente.
**Riesgo go-live:** Critico. La firma de minutas del Comité ECE es un acto jurídico formal bajo Art. 32 NTEC. Permitir que cualquier UUID se use como "firma" hace el sistema repudiable y no cumple la norma.

#### HG-09 — [P1] — `new Date(fecha)` en create minuta — timezone shift

**Descripción:** En `handleSubmit()` (`comite/page.tsx:122`) se envía `fechaReunion: new Date(fecha)` donde `fecha` es un string "YYYY-MM-DD. El anti-patrón de timezone shift (HG-04) aplica: en UTC-6, `new Date("2026-05-19")` es `2026-05-18T18:00:00Z`, guardando la minuta con la fecha de reunión un día antes.
**Archivos:** `apps/web/src/app/(admin)/ece/comite/page.tsx:122`.
**Recomendación:** Enviar la fecha como string ISO sin conversión `new Date()`, o añadir `T12:00:00` antes de construir el Date.
**Riesgo go-live:** Medio. Minutas con fecha incorrecta en el registro formal del Comité ECE.

#### HG-10 — [P2] — `alert()` y `prompt()` del browser — UX no accesible WCAG 2.2

**Descripción:** El formulario de asistentes usa `alert('Formato: "Nombre | Rol"')` para errores de validación (`comite/page.tsx:93`). El botón "Firmar" usa `prompt()`. Estos elementos nativos del browser no cumplen WCAG 2.2 AA: no son responsive, no tienen roles ARIA, interrumpen el flujo sin posibilidad de personalización de estilo, y en algunos entornos corporativos están bloqueados por política del navegador.
**Archivos:** `apps/web/src/app/(admin)/ece/comite/page.tsx:93, 336-340`.
**Recomendación:** Reemplazar `alert()` con inline error (patrón del resto de formularios HIS). Reemplazar `prompt()` con Dialog (ver HG-08).
**Riesgo go-live:** Bajo (UX). Alto en combinación con HG-08.

---

## Módulo 4 — Calidad Documental (Dashboard KPIs) {#modulo-4}

### 4.1 Resumen ejecutivo

Dashboard de KPIs del Comité ECE (`/ece/calidad-documental`). Muestra indicadores de los últimos 90 días (episodios cerrados, cobertura CIE-10, tiempo promedio hasta egreso, rectificaciones del mes). Incluye un panel de exportación de reporte institucional tipo MINSAL/ISSS/INTERNO con rango de fechas configurables.

**Actores:** DIR, ARCH, ADMIN.
**Normativa:** NTEC Art. 32 — KPIs calidad documental.

### 4.2 Archivos auditados

- `apps/web/src/app/(admin)/ece/calidad-documental/page.tsx`

### 4.3 Hallazgos

#### HG-11 — [P1] — `new Date(periodoInicio/periodoFin)` en ExportPanel — timezone shift

**Descripción:** En `ExportPanel` (`calidad-documental/page.tsx:103-110`), los valores de los `<input type="date">` se convierten con `new Date(periodoInicio)` y `new Date(periodoFin)` antes de enviar a `comiteEce.exportReport`. El anti-patrón de timezone shift aplica (ver HG-04).
**Archivos:** `apps/web/src/app/(admin)/ece/calidad-documental/page.tsx:103-110`.
**Recomendación:** Usar strings ISO directamente sin conversión a Date en el cliente.
**Riesgo go-live:** Medio. Periodos de reporte desplazados por 1 día afectan métricas de calidad documental reportadas al MINSAL.

#### HG-12 — [P2] — `<input>` y `<select>` nativos mezclados con componentes Shadcn — inconsistencia de accesibilidad

**Descripción:** El `ExportPanel` usa `<input type="date">` y `<select>` HTML nativos (`calidad-documental/page.tsx:128-161`) sin los atributos `aria-*` que el design system Shadcn provee automáticamente. El resto del formulario usa `Input` y componentes Shadcn. Esta inconsistencia puede derivar en diferencias de comportamiento en lectores de pantalla y falla de pruebas axe.
**Archivos:** `apps/web/src/app/(admin)/ece/calidad-documental/page.tsx:128-161`.
**Recomendación:** Reemplazar los elementos nativos con `Input` y `Select` de `@his/ui` para consistencia y cobertura WCAG.
**Riesgo go-live:** Bajo. No afecta funcionalidad pero puede fallar gate de axe.

---

## Módulo 5 — Admisiones Pendientes {#modulo-5}

### 5.1 Resumen ejecutivo

Cola de órdenes de ingreso validadas sin episodio creado (`/ece/admisiones-pendientes`). Consume `eceBridgeAdmision.listOrdenesPendientesAdmision` con polling de 30s. El botón "Admitir" navega a `/ece/hoja-ingreso/nueva?ordenId=...`.

**Actores:** Personal de admisiones (ADM).
**Normativa:** Art. 31 NTEC — gestión de ingresos hospitalarios.

### 5.2 Archivos auditados

- `apps/web/src/app/(admin)/ece/admisiones-pendientes/page.tsx`

### 5.3 Hallazgos

#### HG-13 — [P2] — Sin control de autorización en la UI

**Descripción:** La página `AdmisionesPendientesPage` (`admisiones-pendientes/page.tsx`) no verifica rol del usuario antes de renderizar ni muestra un estado de "acceso denegado". La protección de rol existe en el router (`eceBridgeAdmision.listOrdenesPendientesAdmision` — a verificar), pero si el router devuelve error, la UI solo muestra la tarjeta vacía sin mensaje de rol insuficiente. Conforme al principio de defense in depth, la UI debería verificar el rol e informar al usuario.
**Archivos:** `apps/web/src/app/(admin)/ece/admisiones-pendientes/page.tsx`.
**Recomendación:** Agregar comprobación de rol desde el contexto de sesión y mostrar un `Alert` de "Acceso restringido a rol ADM" si el usuario no tiene el rol apropiado.
**Riesgo go-live:** Bajo. El router protege el dato; la UX simplemente no informa el motivo del error.

#### HG-14 — [P1] — Ruta destino `/ece/hoja-ingreso/nueva` puede no existir

**Descripción:** El botón "Admitir" navega a `/ece/hoja-ingreso/nueva?ordenId=${orden.id}` (`admisiones-pendientes/page.tsx:107-109`). No se verificó la existencia de esta ruta en el scope del stream G. Si la ruta no existe, el botón principal de la cola de admisiones lleva a un 404, bloqueando el flujo crítico de admisión hospitalaria.
**Archivos:** `apps/web/src/app/(admin)/ece/admisiones-pendientes/page.tsx:107-109`.
**Recomendación:** Verificar existencia de `apps/web/src/app/(clinical)/ece/hoja-ingreso/nueva/page.tsx` o equivalente, y actualizar el href si la ruta real difiere.
**Riesgo go-live:** Alto si la ruta no existe. Critico para el flujo de admisión.

---

## Módulo 6 — Rectificaciones {#modulo-6}

### 6.1 Resumen ejecutivo

Módulo dual: panel clínico (`/ece/rectificaciones`) para PHYSICIAN/NURSE crea y consulta solicitudes; panel admin (`/ece/rectificaciones/cola`) para DIR aprueba o rechaza. El router `eceRectificacion` implementa los 4 procedures con raw SQL sobre `ece.rectificacion`.

**Actores:** PHYSICIAN, NURSE (crear), DIR (aprobar/rechazar).
**Normativa:** NTEC Art. 42 (rectificación documental). Art. 41 según el comentario del router (hay discrepancia de artículo).

### 6.2 Archivos auditados

- `apps/web/src/app/(admin)/ece/rectificaciones/cola/page.tsx`
- `apps/web/src/app/(clinical)/ece/rectificaciones/page.tsx`
- `apps/web/src/app/(clinical)/ece/rectificaciones/nueva/page.tsx`
- `packages/trpc/src/routers/ece-rectificacion.router.ts`

### 6.3 Hallazgos

#### HG-15 — [P1] — `aprobar` usa `requireEcePermission` pero `rechazar` usa `requireRole(["DIR"])` — inconsistencia de autorización

**Descripción:** El procedure `aprobar` (`ece-rectificacion.router.ts:254`) usa `requireEcePermission("ece.rectificacion.aprobar")`, que puede ser un permiso granular de la tabla `ece.permiso_rol`. El procedure `rechazar` (`ece-rectificacion.router.ts:298`) usa `requireRole(["DIR"])`, que verifica el rol HIS del tenant. Estas dos rutas de verificación pueden no estar sincronizadas: un usuario con permiso ECE `ece.rectificacion.aprobar` puede aprobar pero no rechazar, y un DIR puede rechazar pero quizás no aprobar si su rol ECE no tiene ese permiso.
**Archivos:** `packages/trpc/src/routers/ece-rectificacion.router.ts:254, 298`.
**Recomendación:** Unificar ambos bajo `requireEcePermission` o ambos bajo `requireRole(["DIR"])`. La forma más segura es `requireEcePermission("ece.rectificacion.revisar")` para ambos, con el permiso asignado al rol ECE de Director.
**Riesgo go-live:** Medio. Puede resultar en que DIR apruebe pero no pueda rechazar o viceversa.

#### HG-16 — [P2] — Rectificación sin PIN de firma — solo rol es suficiente

**Descripción:** El procedure `aprobar` (y `rechazar`) no solicita PIN de firma. A diferencia de `eceCertificacion.certificar` que verifica argon2id, aquí cualquier usuario con rol DIR/permiso `ece.rectificacion.aprobar` puede aprobar rectificaciones de documentos clínicos firmados sin autenticar su identidad criptográficamente. Art. 42 NTEC — la aprobación de rectificaciones es un acto formal que debería requerir firma electrónica.
**Archivos:** `packages/trpc/src/routers/ece-rectificacion.router.ts:254-293`.
**Recomendación:** Agregar campo `pin: pinSchema` al `aprobarInput` y verificar contra `ece.firma_electronica`, igual que en certificación.
**Riesgo go-live:** Medio regulatorio. Incumple el espíritu del Art. 42 NTEC sobre autenticación de la aprobación.

#### HG-17 — [P2] — `searchParams` usados como props en Server Component sin Suspense

**Descripción:** `EceRectificacionesPage` (`(clinical)/ece/rectificaciones/page.tsx:40-48`) recibe `searchParams` como prop en un Server Component (patrón antiguo pre-Next.js 14.2). En Next.js 14+ App Router, el acceso a `searchParams` en Server Components debe hacerse dentro de `Suspense`. Si no hay wrapper de Suspense, el streaming se bloquea.
**Archivos:** `apps/web/src/app/(clinical)/ece/rectificaciones/page.tsx:40-48`.
**Recomendación:** Marcar el componente como `"use client"` (ya que usa hooks de tRPC) o envolver en `React.Suspense`. La ruta `nueva/page.tsx` ya es `"use client"` correctamente usando `useSearchParams()`.
**Riesgo go-live:** Bajo. Puede causar degradación de streaming en SSR.

---

## Módulo 7 — Workflow Designer {#modulo-7}

### 7.1 Resumen ejecutivo

El Workflow Designer (`/workflow-designer`) permite configurar tipos de documento ECE con sus estados, transiciones y roles funcionales sin redeploy. Consta de 5 páginas: listado, detalle/grafo, editor, historial y templates. El router `workflowTipoDoc` usa `withWorkflowContext` (no `withEceContext`), lo cual es correcto para este dominio.

**Actores:** WORKFLOW_DESIGNER, DIR.
**Normativa:** Configuración del motor de workflow ECE data-driven.

### 7.2 Archivos auditados

- `apps/web/src/app/(admin)/workflow-designer/page.tsx`
- `apps/web/src/app/(admin)/workflow-designer/[codigo]/page.tsx`
- `packages/trpc/src/routers/workflow-tipoDoc.router.ts`

### 7.3 Hallazgos

#### HG-18 — [P1] — Router `workflow.*` invocado con `trpc as any` — pérdida de tipado y sin registro en `_app.ts`

**Descripción:** La página `WorkflowDetailPage` (`workflows/[id]/page.tsx:122`) declara `const wf = trpc as any` y usa ese cast para todos los procedures del router `workflow.*` (tipoDoc, estado, transicion, rol, instancia). El router `workflow.tipoDoc.get`, `workflow.estado.list`, etc. no están registrados en `_app.ts` (`_app.ts` registra `workflowTipoDoc` como key raíz, no `workflow.tipoDoc`). Esto significa que en runtime todas las llamadas a `wf.workflow.tipoDoc.*` fallan con "no existe el procedure" y las tabs Estado, Transiciones, Roles e Instancias del detalle de workflow retornan error.
**Archivos:** `apps/web/src/app/(admin)/workflows/[id]/page.tsx:122`, `packages/trpc/src/routers/_app.ts:197-200`.
**Recomendación:** Verificar el mapeo en `_app.ts`: el router exportado como `workflowTipoDoc` debería ser accesible como `trpc.workflowTipoDoc.list`, no `trpc.workflow.tipoDoc.list`. Actualizar los nombres en `WorkflowDetailPage` eliminando el cast `as any` y ajustando las llamadas al namespace correcto (`trpc.workflowTipoDoc`).
**Riesgo go-live:** Critico. Toda la funcionalidad de edición del Workflow Designer (tabs Estado/Transiciones/Roles/Instancias) falla en runtime.

#### HG-19 — [P1] — `WorkflowGrafoPage` también usa `trpc as any` para `workflowEstado`, `workflowTransicion`, etc.

**Descripción:** `WorkflowGrafoPage` (`workflow-designer/[codigo]/page.tsx:329-357`) usa `(trpc as any).workflowEstado.estado.list`, `(trpc as any).workflowEstado.transicion.list`, etc. En `_app.ts` el router está registrado como `workflowEstado: workflowEstadoRouter`. Dado que el router interno tiene `estado.list` y `transicion.list` como sub-procedures, el namespace correcto es `trpc.workflowEstado.estado.list` (usando `trpc as any` para bypassear los tipos). El cast `as any` oculta cualquier error de tipado pero el namespace podría ser correcto en runtime — requiere verificación en Supabase o ejecución para confirmarlo.
**Archivos:** `apps/web/src/app/(admin)/workflow-designer/[codigo]/page.tsx:329-357`.
**Recomendación:** Eliminar los casts `as any` y registrar los routers correctamente en AppRouter con tipos explícitos, o crear un tipo de inferencia `type AppRouter` y usarlo en los componentes.
**Riesgo go-live:** Alto. Si los namespaces son incorrectos el grafo no carga estados ni transiciones.

#### HG-20 — [P2] — `WorkflowDesignerPage` usa `(trpc as any).workflowTipoDoc.list` — namespace potencialmente incorrecto

**Descripción:** `WorkflowDesignerPage` (`workflow-designer/page.tsx:37`) usa `(trpc as any).workflowTipoDoc.list.useQuery({soloActivos: false})`. Dado que en `_app.ts` el router sí está registrado como `workflowTipoDoc`, el acceso debería ser `trpc.workflowTipoDoc.list` sin cast. El cast `as any` es innecesario y sugiere que la inferencia de tipos no funciona correctamente, posiblemente porque `workflowTipoDoc` no está en el tipo `AppRouter` generado.
**Archivos:** `apps/web/src/app/(admin)/workflow-designer/page.tsx:37`.
**Recomendación:** Si el router está en `_app.ts`, debe aparecer en el tipo `AppRouter`. Eliminar el cast y usar `trpc.workflowTipoDoc.list` directamente.
**Riesgo go-live:** Bajo. La funcionalidad puede funcionar pero la falta de tipos es un riesgo de mantenimiento.

---

## Módulo 8 — Workflows Runtime {#modulo-8}

### 8.1 Resumen ejecutivo

El runtime de workflows consta de: listado de instancias activas (`/workflows`), detalle (`/workflows/[id]`), y diagrama (`/workflows/[id]/diagram`). La página de diagrama es un stub que redirige al Workflow Designer. El detalle (`/workflows/[id]`) también usa `trpc as any` con el mismo problema de namespace identificado en Módulo 7.

### 8.2 Archivos auditados

- `apps/web/src/app/(admin)/workflows/[id]/diagram/page.tsx`
- `apps/web/src/app/(admin)/workflows/[id]/page.tsx`

### 8.3 Hallazgos

Los hallazgos HG-18 e HG-19 cubren los problemas de este módulo. Se añade uno adicional:

#### HG-21 — [P2] — `WorkflowDiagramRedirect` navega a `/workflow-designer/${id}` usando el ID de instancia

**Descripción:** `WorkflowDiagramRedirect` (`workflows/[id]/diagram/page.tsx:30`) genera el href `href={"/workflow-designer/"+id}` donde `id` es el UUID de la instancia de workflow. El Workflow Designer espera el `codigo` del `TipoDocumento` (string alfanumérico), no el UUID. La navegación lleva a una página "Tipo de documento no encontrado".
**Archivos:** `apps/web/src/app/(admin)/workflows/[id]/diagram/page.tsx:30`.
**Recomendación:** Recuperar el `codigo` del tipo de documento desde el UUID de instancia antes de construir el href, o modificar el mensaje de redirección para que apunte a `/workflow-designer` (listado) si no se conoce el código.
**Riesgo go-live:** Medio. La página de diagrama es un stub, pero el enlace incorrecto degrada la experiencia del usuario.

---

## Módulo 9 — Firma Electrónica Setup {#modulo-9}

### 9.1 Resumen ejecutivo

Wizard de configuración de firma electrónica personal (`/firma-electronica/setup`). 3 pasos: marco legal, creación de PIN (6-12 dígitos), confirmación. El wizard verifica si el usuario ya tiene firma activa (`firma.status`), incluye barra de fortaleza del PIN y live-region ARIA. El router `firma.setup` en `firma-electronica.router.ts` usa argon2id correctamente.

**Actores:** Cualquier usuario autenticado (personal de salud).
**Normativa:** NTEC Art. 23, Art. 39.

### 9.2 Archivos auditados

- `apps/web/src/app/(admin)/firma-electronica/setup/page.tsx`
- `packages/trpc/src/routers/firma-electronica.router.ts`

### 9.3 Hallazgos

#### HG-22 — [P1] — `trpc.firma.status` invocado con `@ts-expect-error` — router no registrado en `_app.ts`

**Descripción:** El paso 1 del wizard consulta el estado de firma actual (`setup/page.tsx:519-524`) con `trpc.firma.status.useQuery()` precedido por `// @ts-expect-error — trpc.firma aún no registrado en _app.ts (Stream 18 pendiente)`. En `_app.ts` se registra `firmaElectronicaRouter` como `firma` (`_app.ts:49, 248`). Sin embargo, el router `firmaElectronicaRouter` no tiene un procedure `status` — tiene `setup`, `verify`, `confirm`, `requestRecovery`, `completeRecovery` e `history`. El procedure `firma.status` no existe, por lo que la query siempre fallará con "not found" y `hasActiveFirma` será siempre `false`.
**Archivos:** `apps/web/src/app/(admin)/firma-electronica/setup/page.tsx:519-524`, `packages/trpc/src/routers/firma-electronica.router.ts`.
**Recomendación:** Implementar `firma.status` como `protectedProcedure` que consulte `ece.firma_electronica` y retorne `{ hasPin: boolean }`, o adaptar el wizard para derivar el estado desde `firma.history` (si hay entradas, hay firma activa).
**Riesgo go-live:** Alto. El banner "Firma electrónica activa" nunca se muestra; el wizard siempre arranca desde el paso 1 aunque el usuario ya tenga PIN.

#### HG-23 — [P2] — PIN 6-12 dígitos en UI pero 6-8 en el router (`firma.setup`)

**Descripción:** El wizard UI define `PIN_MAX = 12` (`setup/page.tsx:40`) y valida PINs de hasta 12 dígitos. El router `firma.setup` valida `PIN_REGEX = /^\d{6,8}$/` (`firma-electronica.router.ts:55`). Si el usuario elige un PIN de 9-12 dígitos, pasa la validación client-side pero el servidor lo rechaza con "El PIN debe tener entre 6 y 8 dígitos numéricos." — error confuso.
**Archivos:** `apps/web/src/app/(admin)/firma-electronica/setup/page.tsx:40-47`, `packages/trpc/src/routers/firma-electronica.router.ts:55`.
**Recomendación:** Sincronizar `PIN_MAX` a 8 en la UI para que coincida con el servidor.
**Riesgo go-live:** Medio. UX confusa al rechazar PINs de 9-12 dígitos aparentemente válidos.

#### HG-24 — [P1] — `completeRecovery` no valida TOTP — hace `timingSafeEqual` contra buffer aleatorio

**Descripción:** En `firma.completeRecovery` (`firma-electronica.router.ts:635-636`), la verificación MFA es `timingSafeEqual(mfaCodeBuf, dummyBuf)` donde `dummyBuf = randomBytes(mfaCodeLen)`. Esta comparación es siempre `false` pero el resultado no se verifica — el flujo continúa independientemente. El comentario admite: "La verificación real del TOTP se realiza en el middleware de sesión. Esta procedure asume que el cliente ya pasó por mfa.verify". Esta asunción no tiene enforcement técnico; el procedure puede ser llamado directamente sin pasar por `mfa.verify`.
**Archivos:** `packages/trpc/src/routers/firma-electronica.router.ts:623-637`.
**Recomendación:** Implementar la verificación TOTP real dentro del procedure o requerir un `mfaSessionToken` generado por `mfa.verify` que expire en 5 minutos, verificándolo contra la sesión del usuario antes de proceder al reset del PIN.
**Riesgo go-live:** Alto. La recuperación de PIN de firma electrónica puede ser completada sin verificar MFA, exponiendo cuentas a cambio de PIN no autorizado.

---

## Módulo 10 — Contingencia / Retención / ARCO {#modulo-10}

### 10.1 Resumen ejecutivo

Tres módulos administrativos relacionados con LOPD/NTEC: Contingencia Operativa (`/contingencia`), Conservación y Retención (`/retencion`) con 3 tabs, y Cola ARCO (`/arco`). Los routers correspondientes (`contingenciaRouter`, `retencionRouter`, `portalArcoRouter`) están implementados con RLS y `withTenantContext`.

**Actores:** ADM, DIR (Contingencia/Retención), DIR/ADM/ADMIN + paciente (ARCO).
**Normativa:** NTEC Art. 44 (Contingencia), NTEC Art. 6 (Retención), LOPD Arts. 9/18 (ARCO).

### 10.2 Archivos auditados

- `apps/web/src/app/(admin)/contingencia/page.tsx`
- `apps/web/src/app/(admin)/retencion/page.tsx`
- `apps/web/src/app/(admin)/arco/page.tsx`
- `packages/trpc/src/routers/portal-arco.router.ts`

### 10.3 Hallazgos

#### HG-25 — [P1] — `contingencia/page.tsx` usa inline `TrpcContingencia` — router real no verificado como registrado

**Descripción:** La página de contingencia define su propia interfaz `TrpcContingencia` y hace `(trpc as unknown as TrpcContingencia).eceContingencia.*` (`contingencia/page.tsx:57-63`). El router `contingenciaRouter` importado en `_app.ts` como `eceContingencia` (`_app.ts:153`). Este anti-patrón `trpc as unknown as TrpcInterface` pierde toda la inferencia de tipos y puede ocultar divergencias entre la interfaz declarada y el router real. Si el router tiene procedures con nombres o tipos distintos, no habrá error en compile-time.
**Archivos:** `apps/web/src/app/(admin)/contingencia/page.tsx:57-71`.
**Recomendación:** Eliminar la interfaz inline `TrpcContingencia` y usar `trpc.eceContingencia.*` directamente con los tipos inferidos del AppRouter.
**Riesgo go-live:** Medio. Si hay divergencia entre la interfaz declarada y el router real, los errores solo aparecerán en runtime.

#### HG-26 — [P1] — `retencion/page.tsx` usa el mismo anti-patrón `TrpcRetencion` inline

**Descripción:** Ídem HG-25 pero para retención (`retencion/page.tsx:75-123`). El router `retencionRouter` debería estar accesible como `trpc.eceRetencion.*`.
**Archivos:** `apps/web/src/app/(admin)/retencion/page.tsx:75-123`.
**Recomendación:** Eliminar la interfaz inline y usar `trpc.eceRetencion.*` directamente.
**Riesgo go-live:** Medio.

#### HG-27 — [P2] — Export CSV en Retención usa `window.open` a `/api/retencion/report.csv` — endpoint puede no existir

**Descripción:** `ExpedientesTab` (`retencion/page.tsx:163-168`) abre `window.open("/api/retencion/report.csv?diasProximos=...", "_blank")`. No existe evidencia en el scope auditado de que este endpoint API route (`apps/web/src/app/api/retencion/`) exista. Si no existe, el botón "Exportar CSV" lleva a un 404.
**Archivos:** `apps/web/src/app/(admin)/retencion/page.tsx:163-168`.
**Recomendación:** Implementar el endpoint o reemplazar por un tRPC query con exportación base64 igual que `bitacora.exportCsv`.
**Riesgo go-live:** Medio. La exportación de expedientes por vencer es un reporte regulatorio requerido.

#### HG-28 — [P1] — `portalArco.listParaRevisar` sin `withTenantContext` — posible gap RLS

**Descripción:** El procedure `portalArco.listParaRevisar` (`portal-arco.router.ts:127-147`) usa `ctx.prisma.solicitudArco.findMany()` directamente sin envolver en `withTenantContext`. Filtra por `organizacionId: ctx.tenant.organizationId` en el where, pero como se documenta en CLAUDE.md §RLS: el filtro `where: { organizationId }` en JS es defensa débil. Si el rol Postgres tiene `BYPASSRLS`, la política RLS de `SolicitudArco` no se aplica. El procedure `responder` SÍ usa `withTenantContext`, creando inconsistencia.
**Archivos:** `packages/trpc/src/routers/portal-arco.router.ts:127-147`.
**Recomendación:** Envolver `listParaRevisar` en `withTenantContext(ctx.prisma, ctx.tenant, async (tx) => ...)` para garantizar que RLS aplique.
**Riesgo go-live:** Alto — dato multi-tenant sensible (solicitudes ARCO de pacientes de otras organizaciones podrían filtrarse si RLS no aplica).

#### HG-29 — [P2] — `contingencia.activar` acepta `esperadoHasta` como `string.datetime({ offset: true })` pero UI envía `datetime-local` sin zona

**Descripción:** El router `contingenciaRouter.activar` valida `esperadoHasta: z.string().datetime({ offset: true })` (requiere zona horaria en el string). La UI en `contingencia/page.tsx:198-200` usa `<input type="datetime-local">` que genera strings tipo `"2026-05-19T15:30"` sin zona. Estos strings fallan la validación Zod `{ offset: true }`.
**Archivos:** `apps/web/src/app/(admin)/contingencia/page.tsx:198-200`, `packages/trpc/src/routers/ece/contingencia.router.ts:36-38`.
**Recomendación:** Anexar zona horaria del tenant al string antes de enviar: `esperadoHasta + ":00-06:00"`, o cambiar a `z.string().datetime()` sin `{ offset: true }` y manejar la zona en el servidor.
**Riesgo go-live:** Medio. La desactivación programada del modo contingencia puede fallar al crear el evento.

---

## Resumen Consolidado Stream G {#resumen-final}

### Tabla global de hallazgos

| ID | Módulo | Severidad | Categoría | Descripción resumida |
|---|---|---|---|---|
| HG-01 | Bitácora | P1 ALTA | C1/C5 | Filtros paciente/personal esperan UUID pero UI envía texto libre — filtros silenciosos |
| HG-02 | Bitácora | P1 ALTA | C1/C3 | Filtro multi-acción solo en cliente rompe paginación server-side |
| HG-03 | Bitácora | P2 MEDIA | C6 | Export PDF sin firma DIR ni hash de integridad (Art. 52 NTEC) |
| HG-04 | Bitácora | P2 MEDIA | C7/C5 | `new Date(date-string)` timezone shift en filtros fecha |
| HG-05 | Certificación | P1 ALTA | C1 | Bulk certificación solo procesa el primer documento del Set |
| HG-06 | Certificación | P2 MEDIA | C1 | Cursor pagination no implementado en UI — solo se ven 25 docs |
| HG-07 | Certificación | P2 MEDIA | C3 | `findFirmaDir` dead code — `pin_hash` no seleccionado en la función |
| HG-08 | Comité ECE | P0 CRITICO | C6 | Firma de minuta con `prompt()` browser — sin verificación PIN argon2id |
| HG-09 | Comité ECE | P1 ALTA | C7/C5 | `new Date(fecha)` timezone shift en creación de minutas |
| HG-10 | Comité ECE | P2 MEDIA | C8 | `alert()` y `prompt()` no accesibles WCAG 2.2 |
| HG-11 | Calidad Doc. | P1 ALTA | C7/C5 | `new Date()` timezone shift en panel de exportación de reportes |
| HG-12 | Calidad Doc. | P2 MEDIA | C8 | `<input>` nativos en ExportPanel — inconsistencia design system |
| HG-13 | Admisiones | P2 MEDIA | C3 | Sin verificación de rol en UI — UX no informa acceso denegado |
| HG-14 | Admisiones | P1 ALTA | C7 | Ruta destino `/ece/hoja-ingreso/nueva` no verificada — posible 404 |
| HG-15 | Rectificaciones | P1 ALTA | C3 | `aprobar` usa `requireEcePermission` vs `rechazar` usa `requireRole` — inconsistencia |
| HG-16 | Rectificaciones | P2 MEDIA | C6 | Aprobación de rectificaciones sin PIN de firma — solo rol basta |
| HG-17 | Rectificaciones | P2 MEDIA | C1 | `searchParams` como props sin Suspense en Server Component |
| HG-18 | Workflow Designer | P1 ALTA | C7 | Router `workflow.*` inexistente — `trpc as any` con namespace incorrecto |
| HG-19 | Workflow Designer | P1 ALTA | C7 | `workflowEstado`, `workflowTransicion` con `trpc as any` — namespace no verificado |
| HG-20 | Workflow Designer | P2 MEDIA | C3 | `workflowTipoDoc` con cast innecesario — tipos no inferidos en AppRouter |
| HG-21 | Workflows Runtime | P2 MEDIA | C7 | Redirect a `/workflow-designer/${id}` usa UUID en lugar de `codigo` |
| HG-22 | Firma Setup | P1 ALTA | C7 | `firma.status` no existe en el router — banner activo nunca se muestra |
| HG-23 | Firma Setup | P2 MEDIA | C5/C2 | PIN 6-12 dígitos en UI vs 6-8 en servidor — desalineado |
| HG-24 | Firma Setup | P1 ALTA | C6 | `completeRecovery` no verifica TOTP — bypass de MFA en reset PIN |
| HG-25 | Contingencia | P1 ALTA | C3 | Interfaz `TrpcContingencia` inline — pérdida de tipado, divergencia silenciosa |
| HG-26 | Retención | P1 ALTA | C3 | Interfaz `TrpcRetencion` inline — ídem HG-25 |
| HG-27 | Retención | P2 MEDIA | C7 | Export CSV llama a `/api/retencion/report.csv` — endpoint no verificado |
| HG-28 | ARCO | P1 ALTA | C3 | `listParaRevisar` sin `withTenantContext` — gap RLS en datos ARCO |
| HG-29 | Contingencia | P2 MEDIA | C5/C2 | `datetime-local` sin zona vs Zod `{ offset: true }` — falla validación |

### Conteo por severidad

| Severidad | Cantidad | Hallazgos |
|---|---|---|
| **P0 CRITICO** | 1 | HG-08 |
| **P1 ALTA** | 15 | HG-01, HG-02, HG-05, HG-09, HG-11, HG-14, HG-15, HG-18, HG-19, HG-22, HG-24, HG-25, HG-26, HG-28, HG-24 |
| **P2 MEDIA** | 13 | HG-03, HG-04, HG-06, HG-07, HG-10, HG-12, HG-13, HG-16, HG-17, HG-20, HG-21, HG-23, HG-27, HG-29 |
| **Total** | **29** | — |

> Nota: HG-24 aparece listado dos veces en la tabla P1 por error de conteo — el total correcto de P1 es **14**, para un total de **28 hallazgos únicos**.

### Hallazgos de bloqueo go-live (P0 + P1 críticos para NTEC)

1. **HG-08 (P0)** — Firma de minuta del Comité ECE sin verificación de PIN. Incumple Art. 32 NTEC.
2. **HG-24 (P1)** — Recuperación de PIN de firma sin verificar MFA real. Riesgo de seguridad crítico.
3. **HG-28 (P1)** — Gap RLS en `listParaRevisar` del portal ARCO. Datos de pacientes entre organizaciones.
4. **HG-18 (P1)** — Workflow Designer falla en runtime por namespace incorrecto en `trpc as any`.
5. **HG-05 (P1)** — Bulk certificación solo certifica 1 de N documentos sin aviso al usuario.
6. **HG-22 (P1)** — `firma.status` inexistente — wizard de configuración de firma no detecta firma activa.

### ADR corto — Patrón `trpc as any` con interfaces locales

**Contexto:** Múltiples módulos del Stream G declaran interfaces TypeScript locales (`TrpcContingencia`, `TrpcRetencion`) y usan `trpc as unknown as TInterface` para acceder a procedures. Esto surge de routers aún no registrados en `_app.ts` o con keys de nombre distintas.
**Decisión:** Prohibir el patrón `trpc as any/unknown` en componentes de producción. Para procedures pendientes de registro, usar `// TODO: registrar router` con un stub que retorne `null` tipado. Para routers ya registrados, usar `trpc.<key>.<procedure>` directamente.
**Consecuencias:** Reducción de divergencias silenciosas entre interfaz y router. Mayor esfuerzo inicial de registro correcto en `_app.ts`. Eliminación de 5 hallazgos P1/P2 (HG-18, HG-19, HG-20, HG-25, HG-26).

### Patrones anti-patrón confirmados para este Stream

| Anti-patrón (brief) | Ocurrencias Stream G | Hallazgos |
|---|---|---|
| `new Date(date-string)` timezone shift | 5 módulos | HG-04, HG-09, HG-11, HG-29 |
| `trpc as any/unknown` con interfaz local | 4 módulos | HG-18, HG-19, HG-20, HG-25, HG-26 |
| Acto de firma sin PIN (solo rol) | 2 módulos | HG-08, HG-16 |
| Filtro client-side sobre datos paginados | 2 módulos | HG-02, HG-06 |
| Endpoint externo (`/api/...`) no verificado | 2 módulos | HG-03, HG-27 |
| `@ts-expect-error` procedure inexistente | 1 módulo | HG-22 |
| MFA check dummy (`timingSafeEqual(buf, random)`) | 1 módulo | HG-24 |

---

*Auditoría realizada por @AS — Arquitecto de Software. Inversiones Avante, Unidad de Transformación Digital. 2026-05-19.*
