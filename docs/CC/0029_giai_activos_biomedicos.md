# CC-0029 — GIAI operativo en equipos biomédicos (GS1)

| | |
|---|---|
| Solicitante | Edwin Martínez (Avante) |
| Fecha | 2026-09-14 |
| SQL | `packages/database/sql/236_cc0029_giai_activos_biomedicos.sql` — **APLICADO a prod 2026-09-14 vía MCP (proyecto `ejacvsgbewcerxtjtwto`) — NO re-aplicar.** |
| Estado | Implementado — drift consolidado, parser AI 8004, generación automática, parametrización de equipos en UI. |

## Directiva del solicitante (verbatim funcional)

Dejar la gestión de activos biomédicos vía GS1/GIAI operativa, incluyendo la
**parametrización de los equipos para ingresar la info GIAI** — los
formularios de alta/edición de equipos deben capturar los datos GS1.

## Diagnóstico verificado (@Orq, confirmado por @Dev vía MCP `execute_sql` 2026-09-14)

1. **Drift de columnas duplicadas en prod** — `public."BiomedicalEquipment"`
   tenía DOS pares de columnas para el mismo concepto: `"giaiCode"`
   (camelCase, sin `CHECK` de formato) y `giai_code` (snake_case, `CHECK`
   18 dígitos, `sql/82_equipment_gs1_extension.sql`); `"glnUbicacionActual"`
   (camelCase, FK NOT DEFERRABLE) y `gln_ubicacion_actual` (snake_case, FK
   DEFERRABLE). La columna camelCase no tiene ningún `sql/` en el repo que la
   haya creado — drift de una sesión anterior (`prisma db push`/ALTER directo
   sin archivo numerado, ver `docs/45_registro_drift_schema.md`). Verificado:
   0 filas en `BiomedicalEquipment` en prod — consolidar no requiere
   migración de datos.
2. `parseGs1String` (`packages/contracts/src/validators/gs1.ts`) no
   reconocía el AI 8004 (GIAI) — el bucle de parseo solo detecta AIs de 2 o
   3 dígitos explícitamente; un AI de 4 dígitos como `8004` se leía mal
   (tomaba solo `"80"` como AI).
3. `registrarGiaiInput` exigía `^\d{18}$` — el GIAI real (AI 8004, GS1
   General Specifications) NO tiene longitud ni dígito verificador fijos:
   es prefijo GS1 de empresa + referencia de activo alfanumérica, ≤30
   caracteres totales, **sin checksum** (a diferencia de GTIN/SSCC/GSRN/GRAI).
   El prefijo licenciado de Avante es `7410398`
   (`Organization.gs1CompanyPrefix`, ya en prod, 1 org configurada).
4. `registrarGiai` era `tenantProcedure` — cualquier usuario del tenant
   podía escribir el GIAI de un equipo, sin gate de rol.
5. `ece.gs1_giai` (catálogo GS1, `sql/76_gs1_catalogos.sql`) existía con 0
   filas; 0 equipos en prod — construir sobre una base vacía, sin deuda de
   migración de datos reales.

## Regla de oro del repo: adecuar legacy, no duplicar

`/equipment` (admin) ya existía completo (Wave 8 / Beta.11: lista, alta,
detalle con PM + calibración) y una sesión previa ya le había agregado una
sección "Identificación GS1" (GIAI manual + GLN manual + historial EPCIS) al
detalle — este CC EXTIENDE esa sección y el router existente
(`servicesEquipmentRouter`); no crea ningún `/ece/equipment` paralelo ni un
router nuevo.

## Diseño

### 1. SQL 236 — consolidación de drift

Decisión: **columna canónica = camelCase quoted** (`"giaiCode"`,
`"glnUbicacionActual"`) — es la convención de TODO el resto de columnas de
`BiomedicalEquipment` (`"organizationId"`, `"establishmentId"`, etc.), y ya
tenía los índices/constraints correctos salvo dos huecos:

**Desviación documentada respecto al registro previo**:
`docs/45_registro_drift_schema.md` §5.4 (censo R09 Code Castle,
2026-08-22, @DBA) había clasificado esta misma dupla al revés — snake_case
como "(a) deliberada, en uso" (vía los `as any` del router) y camelCase
como "(c) accidental — candidata a `DROP COLUMN`". Se decidió lo opuesto
porque, con 0 filas en ambos pares (sin costo de migración), lo que hace
que una columna sea "la buena" no es cuál estaba conectada por un
workaround (`as any`) sino cuál sigue la convención real del resto del
esquema — y esa es camelCase, sin excepción, en las otras ~15 columnas de
esta misma tabla (`organizationId`, `establishmentId`, `serialNumber`,
`installDate`, `certificationExpiresAt`, `maintenanceReason`, `createdAt`,
`createdBy`, `updatedAt`, todas multi-palabra camelCase, cero snake_case).
Mantener snake_case habría dejado una tabla con columnas fuera de
convención por el resto de su vida. El registro (§5.4) se
actualizó en este mismo commit para reflejar la resolución — dejarlo
contradiciendo el estado real habría sido peor que no tener el registro.

- Se **dropean** `giai_code`/`gln_ubicacion_actual` (0 filas — cascada
  automática de sus constraints/índices, sin `DROP CONSTRAINT` explícito
  necesario).
- `"giaiCode"` no tenía ningún `CHECK` de formato — se agrega
  `chk_biomedequip_giai_format`, espejo exacto del regex de
  `validateGIAI` (paridad TS↔SQL, ver abajo): prefijo GS1 numérico
  (7-12 dígitos) + referencia alfanumérica, longitud total ≤30. El
  `UNIQUE` (`BiomedicalEquipment_giaiCode_key`) ya existía y ya cumple
  "un GIAI = un activo" (NULLs no colisionan en Postgres) — no se toca.
- `"glnUbicacionActual"` tenía su FK a `ece.gs1_gln(codigo)` pero **NOT
  DEFERRABLE** — se recrea `DEFERRABLE INITIALLY DEFERRED` (patrón
  `sql/82`/`sql/199`), para poder dar de alta equipo + ubicación en la
  misma transacción sin ordenar inserts. El índice parcial
  `idx_biomedical_equipment_gln` ya era correcto — no se toca.

`schema.prisma` (`model BiomedicalEquipment`) gana los dos campos
(`giaiCode String? @unique`, `glnUbicacionActual String?`) — sin relación
Prisma hacia `ece.gs1_gln`/`ece.gs1_giai` (esos modelos Prisma de `ece.*`
tienen drift propio no relacionado con este CC — ver
`docs/45_registro_drift_schema.md` — y el resto del repo ya los trata
siempre vía SQL crudo, nunca vía relación tipada).

### 2. Parser GS1 — AI 8004 (GIAI)

`packages/contracts/src/validators/gs1.ts`:

- `parseGs1String`: el AI 8004 es de 4 dígitos y de longitud variable — el
  bucle de detección de AI (que solo distinguía 2/3 dígitos) gana un caso
  explícito para `"8004"` antes de caer a la heurística genérica. Igual que
  los AIs 10/21 ya existentes, requiere FNC1 (`\x1D`) como separador si no
  es el último elemento del string.
- `validateGIAI(value)` — nueva, sección propia (NO se suma a
  `GS1_MOD10_AI_LENGTHS`/`validateGS1Checksum`, que son específicas de AIs
  con dígito verificador Módulo-10 — GIAI no lo tiene). Regex:
  `^\d{7,12}[A-Za-z0-9]{1,23}$` + longitud total ≤30.
- `buildGIAI(companyPrefix, assetReference)` — nueva, generador
  determinista (ver §3).

**Paridad TS↔SQL**: el único espejo SQL que existe para GS1 es
`ece.gs1_check_digit_valid` (`sql/76`), una función Módulo-10 — no aplica a
GIAI (sin checksum). El único espejo real de `validateGIAI` es el `CHECK`
`chk_biomedequip_giai_format` agregado en SQL 236 (mismo regex). No se
inventó ningún validador SQL adicional que no exista ya.

### 3. Contracts + router

- `registrarGiaiInput` (manual): regex nuevo + `.transform()` que
  normaliza una entrada de escaneo cruda con el AI explícito
  (`"8004<giai>"` → `"<giai>"`) antes de validar — el operador puede pegar
  el valor tal cual lo entrega un lector GS1 lineal.
- `generarGiaiInput` (nuevo) — solo `{ equipmentId }`.
- **`generarGiai`** (nuevo procedure) — genera GIAI = `gs1CompanyPrefix` de
  la org (`7410398`) + referencia derivada de `assetTag` (saneado a
  alfanumérico, truncado a lo que quepa en 30 caracteres totales — **sin
  dígito verificador**, GS1 no lo exige para este AI). Esquema determinista:
  mismo `assetTag` → mismo GIAI siempre (mismo criterio que
  `serialFromMrn`/`buildGSRN` de `gsrn-pulsera.router.ts`, US.F2.6.1). La
  unicidad la da la combinación assetTag-único-por-org (`@@unique([organizationId,
  assetTag])` ya existente) + prefijo-propio-por-org — no hace falta un
  contador/secuencia. Hard Stop (`CONFLICT`) si el equipo ya tiene GIAI —
  para reasignar, usar `registrarGiai` manual (mismo patrón
  `gsrnPulsera.assign`).
- `registrarGiai` y `generarGiai` upsertean `ece.gs1_giai` (catálogo:
  `codigo=giaiCode`, `descripcion=equipment.name`,
  `fabricante`/`modelo`/`serial` del equipo, `"N/D"` si son `null`) vía
  `INSERT … ON CONFLICT (codigo) DO UPDATE`. **Espacio de GUC**: igual que
  `gs1CatalogosRouter.giai` (`gs1-catalogos.router.ts`) — corre sobre
  `ctx.prisma` DIRECTO (rol BYPASSRLS), fuera de `withTenantContext`. No es
  un descuido: `ece.gs1_giai` es Cat-E (RLS: SELECT abierto a
  `authenticated`, INSERT/UPDATE **solo `service_role`**, `sql/76`) — si el
  upsert corriera dentro de `withTenantContext` (que demota a
  `authenticated`), el INSERT fallaría por RLS. La actualización de
  `BiomedicalEquipment.giaiCode` sí corre dentro de `withTenantContext`
  (tabla `public.*` tenant-scoped con RLS real).
- Ambos con `requireRole(["ADMIN", "LOGISTIC"])` — mismo gate que el árbol
  GLN (`gs1-gln-hierarchy.router.ts`). `registrarGiai` no lo tenía antes de
  este CC (hallazgo #4 del diagnóstico).
- `CONFLICT` si el código Postgres es `23505` (violación del `UNIQUE` de
  `giaiCode`) en ambos procedures — cubre tanto el hard-stop explícito de
  `generarGiai` como una carrera entre dos operadores.

### 4. Parametrización de equipos (pedido explícito de Edwin)

- `apps/web/src/app/(admin)/equipment/[id]/page.tsx` — ya tenía la sección
  "Identificación GS1" (sesión previa); este CC la actualiza:
  - Elimina el cast `equipmentRaw as Record<string, unknown>` — con
    `schema.prisma` sincronizado, `equipment.giaiCode`/
    `equipment.glnUbicacionActual` ya son campos tipados.
  - Botón **"Generar automático"** → `generarGiai`, deshabilitado si el
    equipo ya tiene GIAI (con nota explicando que la reasignación es por
    el campo manual).
  - Campo manual de GIAI actualizado (placeholder/label ya no dice "18
    dígitos").
  - El campo de texto libre de GLN se reemplaza por un `<Select>` con
    `gs1GlnHierarchy.glnsDisponibles({ tipos: ["servicio", "deposito"] })`
    — un equipo vive en una sala de servicio o una bodega, no en una cama
    (a diferencia de `Bed`/`Room`, que usan `tipos: ["cama"]`). Mismo
    componente/patrón que `bed-dialog.tsx`/`room-dialog.tsx`.
  - Historial de ubicaciones EPCIS: sin cambios (ya funcionaba).
- `apps/web/src/app/(admin)/equipment/page.tsx` (lista) — columna nueva
  "GIAI": badge verde con el código si está etiquetado, badge outline "Sin
  etiquetar" si no.
- `apps/web/src/app/(admin)/equipment/new/page.tsx` (alta) — **sin
  cambios, a propósito**: `registrarGiai`/`generarGiai` requieren un
  `equipmentId` existente (no se puede generar/registrar un GIAI antes de
  que el equipo exista). La parametrización GS1 vive en el detalle
  (`[id]/page.tsx`), como ya la había estructurado la sesión previa — no
  se agregó un campo GIAI no-funcional al formulario de alta.

## Tests

- `packages/contracts/src/validators/__tests__/gs1-giai.test.ts` (nuevo,
  21 tests): `validateGIAI` (válidos/inválidos: prefijo corto, sin
  referencia, no-numérico, caracteres fuera de alfanumérico, longitud >30,
  null/undefined/vacío, trim), `buildGIAI` (determinismo, saneo, truncado,
  errores de prefijo/referencia vacía), `parseGs1String` con AI 8004 (solo,
  seguido de otro AI vía FNC1, string vacío).
- `packages/contracts/src/schemas/__tests__/services-equipment.test.ts`
  (actualizado): `registrarGiaiInput` reescrito para el nuevo formato +
  normalización de escaneo crudo; `generarGiaiInput` nuevo.
- `packages/trpc/src/routers/__tests__/services-equipment.router.test.ts`
  (actualizado, +14 tests): gate de rol (`FORBIDDEN` sin ADMIN/LOGISTIC) en
  ambos procedures, `NOT_FOUND`, upsert del catálogo (incluye fallback
  `"N/D"`), normalización de escaneo crudo, `CONFLICT` por `23505` y por
  reasignación, determinismo de `generarGiai`, fallback de prefijo GS1.

**@QA debe automatizar a nivel E2E**: alta de equipo → "Generar
automático" → verificar badge "GIAI" en la lista; registrar GIAI manual
con entrada escaneada cruda (`8004…`); seleccionar GLN de ubicación y
verificar que aparece en el historial EPCIS.

## Pre-pr-review

Ver hallazgos y resolución en el resumen de la sesión (skill
`pre-pr-review` corrida antes del commit).

## Fuera de alcance

- No se resembró `ece.gs1_gln` ni se corrigió el drift de los modelos
  Prisma `Ece*` de `packages/database/prisma/schema.prisma` (p.ej.
  `EceGs1Giai.giai` no existe en la tabla real — drift preexistente,
  documentado en `docs/45_registro_drift_schema.md`, fuera del scope de
  este CC).
- No se tocó `gs1CatalogosRouter.giai` (`gs1-catalogos.router.ts`) — sigue
  con su propio gate `["ADMIN","EQUIPOS"]` preexistente; es un router de
  mantenimiento directo del catálogo, distinto del flujo operativo de
  `servicesEquipmentRouter.equipment.registrarGiai`/`generarGiai` que este
  CC gatea con `["ADMIN","LOGISTIC"]` (mismo par que el árbol GLN). Ambos
  escriben a la misma tabla `ece.gs1_giai` con el mismo patrón de upsert;
  unificar los gates de rol de ambos routers queda para una iteración
  futura si Edwin lo pide explícitamente.
- No se implementó el lector de código de barras real (`Gs1Scanner`) en el
  campo manual de GIAI — sigue siendo el mismo stub "Escanear" ya
  documentado en el componente `ManualGs1CodeField`.
