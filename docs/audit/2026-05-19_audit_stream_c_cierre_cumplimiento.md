# Auditoría Stream C — Cierre Clínico + Cumplimiento NTEC
**Fecha:** 2026-05-19
**Auditor:** @AS — Arquitecto de Software, Unidad Transformación Digital, Inversiones Avante
**Branch auditado:** `feat/fase2-s1-gate`
**Worktree:** `agent-a873ce971992d640f`
**Alcance:** Módulos Epicrisis, Defunción (ECE + legacy), Consentimiento (NTEC + GDPR)
**Tipo:** Auditoría de trazabilidad UI ↔ ORM ↔ DB — solo lectura, sin cambios

---

## Tabla de Contenido

1. [Módulo A — Epicrisis](#módulo-a--epicrisis)
2. [Módulo B — Defunción](#módulo-b--defunción)
3. [Módulo C — Consentimiento](#módulo-c--consentimiento)
4. [Resumen Consolidado Stream C](#resumen-consolidado-stream-c)

---

## Metodología

Cada módulo se audita en 12 categorías:

| Cat | Nombre |
|-----|--------|
| C1  | Traceabilidad de datos UI → DB |
| C2  | Contratos tRPC (input/output schemas) |
| C3  | Seguridad: RLS + tenant isolation |
| C4  | Inmutabilidad post-firma (NTEC Art. 40) |
| C5  | CIE-10 obligatorio (NTEC Art. 17) |
| C6  | Firma electrónica — doble firma (NTEC Art. 39) |
| C7  | Schema drift (Prisma vs SQL DDL vs router types) |
| C8  | Audit hash chain |
| C9  | Eventos de dominio |
| C10 | Manejo de errores y rollback |
| C11 | Tests y cobertura |
| C12 | Accesibilidad / UX compliance |

**Severidades:**
- `P0-BLOQUEANTE`: Falla en producción garantizada o violación regulatoria irremediable
- `P1-ALTO`: Riesgo alto, falla probable, vulnerabilidad de seguridad o cumplimiento
- `P2-MEDIO`: Degradación funcional, cobertura incompleta, deuda técnica significativa
- `P3-BAJO`: Mejora recomendable, no bloquea go-live

---

## Módulo A — Epicrisis

### Artículos NTEC aplicables
- **Art. 17**: CIE-10 obligatorio al cierre del episodio (diagnóstico principal de egreso)
- **Art. 40**: Inmutabilidad post-firma electrónica

### Archivos auditados
| Capa | Archivo |
|------|---------|
| UI página | `apps/web/src/app/(clinical)/ece/epicrisis/[id]/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/epicrisis.router.ts` |
| Prisma model | `packages/database/prisma/schema.prisma` → `EceEpicrisisEgreso` (líneas 5283–5311) |
| SQL DDL | `packages/database/sql/61_ece_06_documentos.sql` → tabla `ece.epicrisis_egreso` |
| RLS / triggers | `packages/database/sql/62_ece_07_rls.sql` → `fn_bloquea_mutacion()` |
| Workflow context | `packages/trpc/src/workflow/context.ts` |

### Hallazgos

#### A-01 — CIE-10 hard-stop referencia columna inexistente `P0-BLOQUEANTE`
**Categoría:** C5 — CIE-10 obligatorio (NTEC Art. 17)
**Archivo:línea:** `packages/trpc/src/routers/ece/epicrisis.router.ts:356`

**Descripción:**
El procedimiento `firmar()` ejecuta:
```sql
SELECT "cie10_principal" FROM ece.epicrisis_egreso WHERE id = $1
```
y aborta la firma si el campo es NULL (hard-stop Art. 17). Sin embargo, la columna `cie10_principal` **no existe** en el DDL de `ece.epicrisis_egreso` (`61_ece_06_documentos.sql`). La tabla solo tiene `diagnosticos_egreso JSONB NOT NULL`. El procedimiento `setCie10()` (línea 481) también actualiza columnas `cie10_principal` y `cie10_secundarios` que no existen.

**Evidencia DDL:**
```sql
-- 61_ece_06_documentos.sql — ece.epicrisis_egreso
diagnosticos_egreso   JSONB NOT NULL DEFAULT '[]',
estado_registro       TEXT  NOT NULL DEFAULT 'vigente'
    CHECK (estado_registro IN ('vigente','rectificado'))
-- NO existe: cie10_principal, cie10_secundarios
```

**Impacto:** Toda llamada a `firmar()` o `setCie10()` fallará con `ERROR: column "cie10_principal" does not exist`. El Art. 17 no puede cumplirse en producción. La epicrisis no puede cerrarse.

**Remediación:**
```sql
ALTER TABLE ece.epicrisis_egreso
  ADD COLUMN cie10_principal   TEXT,
  ADD COLUMN cie10_secundarios TEXT[];
```
Más extracción indexada del JSONB `diagnosticos_egreso` como alternativa consistente con el modelo existente.

---

#### A-02 — Tipo `EpicrisisRow` referencia ~8 columnas inexistentes `P0-BLOQUEANTE`
**Categoría:** C7 — Schema drift
**Archivo:línea:** `packages/trpc/src/routers/ece/epicrisis.router.ts` — tipo local `EpicrisisRow`

**Descripción:**
El type local `EpicrisisRow` (y las queries `$queryRaw`) referencian las siguientes columnas que no existen ni en el DDL (`61_ece_06_documentos.sql`) ni en el modelo Prisma (`EceEpicrisisEgreso`):

| Campo en router | Existe en DDL | Existe en Prisma |
|-----------------|--------------|-----------------|
| `estado_workflow` | NO | NO |
| `firma_mc_id` | NO | NO |
| `firma_esp_id` | NO | NO |
| `firma_dir_id` | NO | NO |
| `resumen_ingreso` | NO | NO |
| `evolucion_hospitalaria` | NO | NO |
| `tratamiento_egreso` | NO | NO |
| `indicaciones_egreso` | NO | NO |

**Impacto:** Las queries de lista/detalle devolverán NULL para todos estos campos. La lógica de estado de workflow (sidebar de firmas) es completamente inoperativa.

**Remediación:** Añadir columnas al DDL Y sincronizar `schema.prisma` → `EceEpicrisisEgreso`. Migración numerada siguiente al `61_ece_06_documentos.sql`.

---

#### A-03 — Acción "Certificar" en UI nunca ejecuta la mutación `P0-BLOQUEANTE`
**Categoría:** C1 — Trazabilidad UI → DB
**Archivo:línea:** `apps/web/src/app/(clinical)/ece/epicrisis/[id]/page.tsx:254`

**Descripción:**
El handler `onCertificarConfirm()` contiene:
```ts
void pin; // TODO: integrar con trpc.firma.confirm
setShowCertificarModal(false);
```
El modal de PIN se cierra, pero `certificar.mutate()` **nunca se llama**. El flujo de certificación (estado `firmado → certificado`) es un stub no funcional.

**Impacto:** Ningún episodio puede ser certificado desde la UI. El estado final del ciclo de vida de la epicrisis es inalcanzable.

**Remediación:** Invocar `certificar.mutate({ id, pin })` dentro del callback `onCertificarConfirm` con el PIN retornado del modal.

---

#### A-04 — RLS no aplica en epicrisis router `P1-ALTO`
**Categoría:** C3 — RLS + tenant isolation
**Archivo:línea:** `packages/trpc/src/routers/ece/epicrisis.router.ts` — helper local `withEceContext()`

**Descripción:**
El router usa una función local `withEceContext()` que solo valida la existencia de `establishmentId` en el contexto, pero **no** ejecuta `SET LOCAL ROLE authenticated` ni los GUCs requeridos. Compárese con `withWorkflowContext()` (en `packages/trpc/src/workflow/context.ts`) que sí demota el rol y habilita las políticas RLS de `ece.*`.

**Evidencia:**
```ts
// withEceContext — solo valida presencia, NO demota rol
async function withEceContext<T>(ctx: TRPCContext, fn: () => Promise<T>): Promise<T> {
  if (!ctx.establishmentId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return fn();
}
// vs withWorkflowContext — SÍ demota
return prisma.$transaction(async (tx) => {
  await applyWorkflowContext(tx, ...); // SET LOCAL ROLE authenticated
  return fn(tx);
});
```

Las queries de lista/detalle no tienen filtro `WHERE establecimiento_id = ?`, lo que significa que en ausencia de RLS, un médico de establecimiento A puede ver epicrisis del establecimiento B.

**Impacto:** Brecha de aislamiento multi-tenant. Cumplimiento LOPD/datos de salud comprometido.

**Remediación:** Reemplazar `withEceContext` por `withWorkflowContext` en todas las mutaciones y añadir `WHERE establecimiento_id = $ctx.establishmentId` en queries de lectura como defensa redundante.

---

#### A-05 — `fn_bloquea_mutacion()` aplica a `epicrisis_egreso` — mutaciones de workflow bloqueadas `P1-ALTO`
**Categoría:** C4 — Inmutabilidad post-firma (NTEC Art. 40)
**Archivo:línea:** `packages/database/sql/62_ece_07_rls.sql:~160`

**Descripción:**
El trigger `fn_bloquea_mutacion()` está aplicado a `ece.epicrisis_egreso`. Esto es correcto post-firma. Sin embargo, las transiciones de workflow previas a la firma (ej. guardar borrador, asignar CIE-10) también ejecutan `UPDATE` sobre esta tabla y serán bloqueadas si el trigger no distingue estado.

Revisando el DDL, el trigger no evalúa ninguna condición de estado — bloquea TODOS los UPDATE/DELETE incondicionalmente. Esto significa que `update()` (guardar borrador) también fallará una vez que el trigger esté activo.

**Impacto:** El router intenta UPDATE para guardar contenido clínico en estado borrador; estas operaciones fallarán con la misma excepción que las post-firma. El trigger está sobredimensionado.

**Remediación:** Añadir condición al trigger:
```sql
IF OLD.estado_registro != 'vigente' OR OLD.estado_workflow IN ('firmado','certificado') THEN
  RAISE EXCEPTION 'documento_inmutable';
END IF;
```

---

#### A-06 — Queries de lista sin filtro de establecimiento `P1-ALTO`
**Categoría:** C3 — RLS + tenant isolation
**Archivo:línea:** `packages/trpc/src/routers/ece/epicrisis.router.ts` — procedimiento `list()`

**Descripción:**
Las queries `SELECT ... FROM ece.epicrisis_egreso` en `list()` y `get()` no incluyen `WHERE establecimiento_id = ?`. Sin RLS activo (ver A-04), devuelven datos de todos los establecimientos.

**Remediación:** Añadir filtro explícito + migrar a `withWorkflowContext`.

---

#### A-07 — Modal PIN retorna `firmaId` de origen desconocido `P2-MEDIO`
**Categoría:** C6 — Firma electrónica
**Archivo:línea:** `apps/web/src/app/(clinical)/ece/epicrisis/[id]/page.tsx:~200`

**Descripción:**
El `PinConfirmModal` retorna en su callback un `firmaId` (UUID). No está claro si este ID es generado localmente (UUID aleatorio) o proviene de un llamado previo a `trpc.firma.create`. Si es generado en cliente, la relación firma → procedimiento no está garantizada en servidor.

**Remediación:** Auditar `PinConfirmModal` — el ID debe ser retornado por el servidor en el momento del llamado de verificación de PIN.

---

#### A-08 — Sin test de integración para flujo de firma `P2-MEDIO`
**Categoría:** C11 — Tests y cobertura
**Archivo:** `packages/trpc/src/routers/ece/__tests__/`

**Descripción:**
No se encontraron tests para `epicrisis.router.ts` en el path estándar de tests ECE. La lógica crítica del Art. 17 (hard-stop CIE-10) y el workflow de firmas no tiene cobertura automatizada.

**Remediación:** Crear `epicrisis.router.test.ts` con casos: firma sin CIE-10 (debe rechazar), firma con CIE-10 (debe aprobar), transición de estados completa.

---

### Matriz de trazabilidad — Epicrisis

| Flujo | UI | tRPC | Prisma/SQL | DB | Estado |
|-------|----|----|----|----|--------|
| Crear borrador | `nuevo/page.tsx` | `create()` | `$executeRaw INSERT` | `ece.epicrisis_egreso` | Parcial — columnas workflow faltan |
| Guardar contenido | `[id]/page.tsx` | `update()` | `$executeRaw UPDATE` | `ece.epicrisis_egreso` | ROTO — trigger bloquea |
| Asignar CIE-10 | `[id]/page.tsx` | `setCie10()` | `$executeRaw UPDATE cie10_principal` | columna inexistente | ROTO — A-01 |
| Firmar (MC) | `[id]/page.tsx` → PIN modal | `firmar()` | SELECT `cie10_principal` + UPDATE estado | columna inexistente | ROTO — A-01 |
| Certificar | `[id]/page.tsx` → modal | `certificar()` | `$executeRaw UPDATE` | `ece.epicrisis_egreso` | ROTO — A-03 (never called) |
| Listar | `index/page.tsx` | `list()` | `$queryRaw SELECT` | sin filtro establecimiento | VULNERABLE — A-04, A-06 |

### Riesgo Go-Live — Epicrisis: BLOQUEANTE
El módulo de epicrisis no puede cerrar ningún episodio en producción. Los hallazgos A-01, A-02, A-03 garantizan falla. No apto para go-live.

---

## Módulo B — Defunción

### Artículos NTEC aplicables
- **Art. 21**: Certificado defunción con cadena causal CIE-10 obligatoria (causa directa, intermedia, básica)
- **Art. 40**: Inmutabilidad post-firma

### Archivos auditados
| Capa | Archivo |
|------|---------|
| UI — ECE | `apps/web/src/app/(clinical)/ece/defuncion/nueva/page.tsx` |
| UI — legacy | `apps/web/src/app/(clinical)/deaths/` (inferido de router) |
| tRPC — ECE | `packages/trpc/src/routers/ece/certificado-defuncion.router.ts` |
| tRPC — legacy | `packages/trpc/src/routers/death-certificate.router.ts` |
| Prisma — ECE | `EceCertificadoDefuncion` (schema.prisma líneas 5313–5334) |
| Prisma — legacy | `DeathCertificate` (schema.prisma líneas 992–1020) |
| SQL DDL | `packages/database/sql/61_ece_06_documentos.sql` → `ece.certificado_defuncion` |
| RLS | `packages/database/sql/62_ece_07_rls.sql` → `fn_bloquea_mutacion()` |

### Hallazgos

#### B-01 — Schema drift masivo en `CertDefRow` — todo el workflow fallará `P0-BLOQUEANTE`
**Categoría:** C7 — Schema drift
**Archivo:línea:** `packages/trpc/src/routers/ece/certificado-defuncion.router.ts` — tipo `CertDefRow`

**Descripción:**
El tipo local `CertDefRow` y todas las queries `$queryRaw`/`$executeRaw` del router referencian columnas que no existen en el DDL (`61_ece_06_documentos.sql`):

| Campo en router | Existe en DDL | Existe en Prisma model |
|-----------------|--------------|----------------------|
| `estado_workflow` | NO | NO |
| `firmado_en` | NO | NO (`registrado_en` sí existe) |
| `validado_en` | NO | NO |
| `certificado_en` | NO | NO |
| `anulado_en` | NO | NO |
| `payload_hash` | NO | NO |
| `medico_firmante_id` | NO | NO |

**Evidencia DDL:**
```sql
-- 61_ece_06_documentos.sql — ece.certificado_defuncion
id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
episodio_id           UUID NOT NULL REFERENCES ece.episodio_hospitalario(id),
epicrisis_id          UUID NOT NULL REFERENCES ece.epicrisis_egreso(id),
causa_directa_cie10   TEXT,
causa_intermedia_cie10 TEXT,
causa_basica_cie10    TEXT NOT NULL,
... (campos demográficos)
registrado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
registrado_por        UUID NOT NULL
-- NO existe: estado_workflow, firmado_en, validado_en, certificado_en, payload_hash, medico_firmante_id
```

**Impacto:** Toda mutación de workflow (firmar, validar, certificar, anular) referencia columnas inexistentes. El certificado no puede avanzar ningún estado. Falla garantizada en producción.

**Remediación:**
```sql
ALTER TABLE ece.certificado_defuncion
  ADD COLUMN estado_workflow    TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado_workflow IN ('borrador','firmado','validado','certificado','anulado')),
  ADD COLUMN firmado_en         TIMESTAMPTZ,
  ADD COLUMN validado_en        TIMESTAMPTZ,
  ADD COLUMN certificado_en     TIMESTAMPTZ,
  ADD COLUMN anulado_en         TIMESTAMPTZ,
  ADD COLUMN payload_hash       TEXT,
  ADD COLUMN medico_firmante_id UUID REFERENCES auth.users(id);
```
Más sincronización del modelo Prisma.

---

#### B-02 — RLS no aplica en `certificado-defuncion` router `P1-ALTO`
**Categoría:** C3 — RLS + tenant isolation
**Archivo:línea:** `packages/trpc/src/routers/ece/certificado-defuncion.router.ts`

**Descripción:**
Igual que en epicrisis (A-04), el router usa `withEceContext()` local que no demota el rol. Las queries sí filtran por `establecimiento_id` (defensa parcial), pero sin `SET LOCAL ROLE authenticated`, las políticas RLS de `ece.*` no se activan.

**Impacto:** Si las políticas RLS añaden controles adicionales (ej. restricción por `personal_id`), estos no aplican. El filtro JS es la única barrera.

**Remediación:** Migrar a `withWorkflowContext`.

---

#### B-03 — `validar()` no requiere PIN — brecha de no-repudio `P1-ALTO`
**Categoría:** C6 — Firma electrónica
**Archivo:línea:** `packages/trpc/src/routers/ece/certificado-defuncion.router.ts:512`

**Descripción:**
La transición `firmado → validado` (ejecutada por el Director Médico) no requiere verificación de PIN. Solo valida el estado actual y hace la transición. La transición `firmar()` sí requiere argon2id PIN. La asimetría deja la validación sin registro criptográfico de identidad del validador.

Para un documento con consecuencias legales (certificado de defunción), la validación del Director Médico debe tener la misma trazabilidad de identidad que la firma del médico tratante.

**Remediación:** Añadir `firmaPin: z.string()` al input de `validar()` y verificar con argon2id contra el hash del Director Médico.

---

#### B-04 — No se valida que la epicrisis tenga `tipo_egreso = 'fallecido'` `P1-ALTO`
**Categoría:** C2 — Contratos tRPC
**Archivo:línea:** `packages/trpc/src/routers/ece/certificado-defuncion.router.ts` — `create()`

**Descripción:**
El procedimiento `create()` requiere `epicrisis_id` como FK pero no verifica a nivel de aplicación que la epicrisis referenciada tenga `tipo_egreso = 'fallecido'`. Si bien la FK garantiza existencia del registro, no garantiza la coherencia clínica. Un médico podría crear un certificado de defunción vinculado a una epicrisis de alta ordinaria.

**Remediación:**
```ts
const epicrisis = await tx.$queryRaw<[{tipo_egreso: string}]>`
  SELECT tipo_egreso FROM ece.epicrisis_egreso WHERE id = ${epicrisisId}
`;
if (epicrisis[0]?.tipo_egreso !== 'fallecido') {
  throw new TRPCError({ code: 'BAD_REQUEST', message: 'epicrisis_no_es_fallecido' });
}
```

---

#### B-05 — Sistema legacy `DeathCertificate` sin inmutabilidad ni cadena de auditoría `P1-ALTO`
**Categoría:** C4 — Inmutabilidad + C8 — Audit hash chain
**Archivo:línea:** `packages/trpc/src/routers/death-certificate.router.ts`

**Descripción:**
El router legacy (`public.DeathCertificate`) no tiene:
- Trigger `fn_bloquea_mutacion()` — el registro puede ser modificado post-creación
- Cadena de hash auditada (no inserta en `audit.audit_log` con `chain_hash`)
- Eventos de dominio emitidos post-firma
- Verificación de role via `requireRole()` — usa comprobación JS `hasPhysicianRole` manual

**Evidencia schema.prisma:**
```
DeathCertificate {
  manner  String?    // texto libre, no enum
  // NO basicCauseMandatory constraint
  // NO immutability guard
}
```

NTEC Art. 21 requiere cadena causal CIE-10 obligatoria; el campo `basicCauseCode` es `String?` (nullable) en el schema Prisma — no hay hard-stop DB.

**Impacto:** Los certificados legacy pueden ser alterados sin trazabilidad. Art. 21 no se cumple completamente (campo causa básica nullable en schema, aunque el router lo valida en Zod).

**Remediación:**
1. Añadir constraint `NOT NULL` a `basicCauseCode` en `DeathCertificate`.
2. Añadir trigger de inmutabilidad o mover `UPDATE` a tabla de rectificación.
3. Reemplazar comprobación JS de rol por `requireRole(["PHYSICIAN"])`.

---

#### B-06 — Coexistencia de dos sistemas paralelos sin coordinación `P2-MEDIO`
**Categoría:** C1 — Trazabilidad
**Descripción:**
Existen dos sistemas de certificado de defunción:
- Legacy: `public.DeathCertificate` + `/deaths` router + UI legacy
- ECE: `ece.certificado_defuncion` + `/ece/defuncion` router + UI ECE

No hay sincronización entre ambos. Si un médico crea un certificado en el sistema ECE, el legacy no lo sabe (y viceversa). Para reportería integrada y cumplimiento NTEC, debe existir un mecanismo de reconciliación o el legacy debe deprecarse con redirección 301 a ECE.

**Remediación:** Definir política de convivencia con fecha de sunset del legacy. Añadir `bridge-death` a la familia de bridges (similar a `eceBridgeTriage`).

---

#### B-07 — CIE-10 local hardcodeado en UI (10 entradas) `P2-MEDIO`
**Categoría:** C5 — CIE-10 obligatorio
**Archivo:línea:** `apps/web/src/app/(clinical)/ece/defuncion/nueva/page.tsx` — array local

**Descripción:**
La UI de nueva defunción tiene una lista local de 10 causas CIE-10 hardcodeadas en vez de consumir el catálogo completo de `trpc.icd10.search`. El catálogo ICD-10 tiene ~14,000 entradas; 10 entradas cubren menos del 0.1%.

**Remediación:** Reemplazar lista local por `trpc.icd10.search` con debounce, igual al patrón usado en otros formularios CIE-10 del sistema.

---

#### B-08 — Parseo frágil de CIE-10 por split de espacio `P2-MEDIO`
**Categoría:** C2 — Contratos tRPC
**Archivo:línea:** `apps/web/src/app/(clinical)/ece/defuncion/nueva/page.tsx` — submit handler

**Descripción:**
```ts
causaPrincipalCie10: causaPrincipal.split(" ")[0]!
```
Extrae el código CIE-10 separando por espacio y tomando el primer token. Frágil ante variaciones de formato. Debería usarse un campo estructurado separado para código vs descripción en el estado del formulario.

---

### Matriz de trazabilidad — Defunción ECE

| Flujo | UI | tRPC | Prisma/SQL | DB | Estado |
|-------|----|----|----|----|--------|
| Crear certificado | `nueva/page.tsx` | `create()` | `$executeRaw INSERT` | `ece.certificado_defuncion` | Parcial — columnas workflow faltan |
| Firmar (médico) | `[id]/page.tsx` → PIN | `firmar()` | `$executeRaw UPDATE estado_workflow` | columna inexistente | ROTO — B-01 |
| Validar (director) | `[id]/page.tsx` | `validar()` | `$executeRaw UPDATE estado_workflow` | columna inexistente | ROTO — B-01 |
| Certificar (DM) | `[id]/page.tsx` | `certificar()` | `$executeRaw UPDATE` | columna inexistente | ROTO — B-01 |
| Listar | index | `list()` | `$queryRaw` con `establecimiento_id` | `ece.certificado_defuncion` | Parcial (sin RLS) |

### Riesgo Go-Live — Defunción: BLOQUEANTE
El módulo ECE no puede emitir ningún certificado válido. B-01 garantiza falla en todas las transiciones de estado. El sistema legacy tampoco cumple Art. 21 completamente. No apto para go-live.

---

## Módulo C — Consentimiento

### Artículos NTEC aplicables
- **Art. 39**: Consentimiento quirúrgico requiere doble firma (paciente/representante + médico cirujano)
- **Art. 40**: Inmutabilidad post-firma

### Archivos auditados
| Capa | Archivo |
|------|---------|
| UI — NTEC wizard | `apps/web/src/app/(clinical)/ece/consentimiento/nuevo/page.tsx` |
| UI — GDPR admin | `apps/web/src/app/(admin)/consents/` (inferido) |
| tRPC — NTEC | `packages/trpc/src/routers/ece/consentimiento.router.ts` |
| tRPC — GDPR | `packages/trpc/src/routers/consent.router.ts` |
| Prisma — NTEC | `EceConsentimientoInformado` (schema.prisma líneas 5122–5144) |
| Prisma — GDPR | `PatientConsent` (schema.prisma líneas 1172–1189) |
| SQL DDL | `packages/database/sql/61_ece_06_documentos.sql` → `ece.consentimiento_informado` |
| Trigger inmutabilidad | `packages/database/sql/62_ece_07_rls.sql` → `fn_bloquea_mutacion()` |

### Hallazgos

#### C-01 — `firmarPaciente()` siempre falla — trigger inmutabilidad bloquea UPDATE `P0-BLOQUEANTE`
**Categoría:** C4 — Inmutabilidad (NTEC Art. 40) + C6 — Firma electrónica
**Archivo:línea:** `packages/trpc/src/routers/ece/consentimiento.router.ts:608`

**Descripción:**
El procedimiento `firmarPaciente()` ejecuta:
```sql
UPDATE ece.consentimiento_informado
  SET firmante_rol = $1, evidencia_firma_ref = $2
WHERE id = $3
```
El trigger `fn_bloquea_mutacion()` está aplicado a `ece.consentimiento_informado` y bloquea **todos** los UPDATE incondicionalmente. Esta mutación fallará con:
```
ERROR: mutacion_no_permitida: documento firmado es inmutable
```
desde el momento en que el trigger está instalado, incluso para el primer intento de firma (el documento nunca puede ser firmado por primera vez).

**Evidencia trigger (`62_ece_07_rls.sql`):**
```sql
CREATE TRIGGER trg_bloquea_consentimiento
  BEFORE UPDATE OR DELETE ON ece.consentimiento_informado
  FOR EACH ROW EXECUTE FUNCTION fn_bloquea_mutacion();
```
La función no evalúa estado previo — bloquea todo.

**Impacto:** La firma del paciente es imposible. Todo consentimiento permanece en estado borrador indefinidamente. NTEC Art. 39 no puede cumplirse.

**Remediación — dos opciones:**
1. **Condicionar el trigger** a estado post-firma (solo bloquear si `firmado = true`):
   ```sql
   CREATE OR REPLACE FUNCTION fn_bloquea_mutacion() RETURNS trigger AS $$
   BEGIN
     IF OLD.firmado = true THEN
       RAISE EXCEPTION 'mutacion_no_permitida';
     END IF;
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;
   ```
2. **Modelo append-only**: Insertar nuevo registro de firma en tabla `ece.firma_consentimiento` en vez de modificar el consentimiento base.

---

#### C-02 — UI wizard envía a endpoint incorrecto — contenido clínico nunca persiste `P0-BLOQUEANTE`
**Categoría:** C1 — Trazabilidad UI → DB
**Archivo:línea:** `apps/web/src/app/(clinical)/ece/consentimiento/nuevo/page.tsx:249`

**Descripción:**
El handler `onSubmit()` llama:
```ts
trpc.workflowInstance.create.mutate({
  tipoDocumentoId: s1.tipo,   // "HOSPITALIZACION" — string, no UUID
  pacienteId: s1.pacienteId,
  episodioId: s1.episodioId,
})
```
Dos problemas críticos:

1. **Endpoint incorrecto**: Llama a `workflowInstance.create`, no a `consentimiento.create`. Los datos del formulario (paso 2: procedimiento, riesgos, alternativas, anestesia, paso 3: firma paciente + firma MC) **nunca se envían al servidor**.

2. **Tipo incorrecto para UUID**: `tipoDocumentoId` recibe `s1.tipo` que es `"HOSPITALIZACION" | "QUIRURGICO" | "ANESTESICO"` (una constante de tipo, no un UUID). La base de datos espera UUID en `tipo_documento_id`. El cast fallará con error de BD.

**Impacto:** Ningún consentimiento puede ser creado desde la UI. Los datos del formulario (contenido médico, firmas) se pierden. El módulo es completamente no funcional desde la UI.

**Remediación:**
1. Cambiar `trpc.workflowInstance.create` por `trpc.eceConsentimiento.create`.
2. Resolver `tipoDocumentoId` desde el catálogo: `trpc.workflowInstance.getTipoId({ codigo: s1.tipo })` antes del submit.
3. Incluir todos los campos del paso 2 en el payload.

---

#### C-03 — Doble firma Art. 39 — solo hay una columna `firmante_*` en schema `P1-ALTO`
**Categoría:** C6 — Firma electrónica doble (NTEC Art. 39)
**Archivo:línea:** `packages/database/sql/61_ece_06_documentos.sql` — `ece.consentimiento_informado`

**Descripción:**
NTEC Art. 39 requiere para consentimiento quirúrgico: firma del paciente/representante legal + firma del médico cirujano. La tabla solo tiene:
```sql
firmante_rol       TEXT CHECK (firmante_rol IN ('paciente','representante_legal')),
firmante_nombre    TEXT,
firmante_documento TEXT,
evidencia_firma_ref TEXT
```
No existe columna para la firma del médico cirujano (MC). La firma del MC solo se registra como una transición de workflow en `documento_instancia_historial`, no como un campo explícito con evidencia criptográfica en el consentimiento mismo.

**Impacto:** Para consentimientos quirúrgicos, no hay columna donde persistir la evidencia de firma del MC en el documento. Art. 39 no puede cumplirse estructuralmente en el schema actual.

**Remediación:**
```sql
ALTER TABLE ece.consentimiento_informado
  ADD COLUMN firma_mc_id            UUID REFERENCES auth.users(id),
  ADD COLUMN firma_mc_en            TIMESTAMPTZ,
  ADD COLUMN evidencia_firma_mc_ref TEXT;
```

---

#### C-04 — `firmado` booleano no existe en DDL — condición de inmutabilidad indefinida `P1-ALTO`
**Categoría:** C7 — Schema drift + C4 — Inmutabilidad
**Archivo:línea:** `packages/database/sql/61_ece_06_documentos.sql`

**Descripción:**
El router referencia un campo booleano `firmado` para verificar si el documento ya fue firmado antes de aplicar inmutabilidad. Este campo no existe en el DDL; la tabla no tiene un indicador de estado explícito (solo `firmante_rol IS NOT NULL` podría inferirse como "firmado").

Sin un campo `firmado` explícito (o `estado_workflow`), la lógica de inmutabilidad del trigger no puede distinguir entre un documento en borrador y uno firmado.

**Remediación:** Añadir `estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','firmado','revocado'))` o `firmado BOOLEAN NOT NULL DEFAULT false` con el timestamp correspondiente.

---

#### C-05 — `firmarMc()` existe en router pero faltará columna destino `P1-ALTO`
**Categoría:** C6 — Firma electrónica doble
**Archivo:línea:** `packages/trpc/src/routers/ece/consentimiento.router.ts` — procedimiento `firmarMc()`

**Descripción:**
El procedimiento `firmarMc()` intenta escribir la firma del médico cirujano, pero dado que no existe columna `firma_mc_id` en la tabla (ver C-03), la query fallará con error de columna inexistente. Además, `fn_bloquea_mutacion` bloquea el UPDATE igualmente (ver C-01).

**Remediación:** Dependiente de C-01 y C-03.

---

#### C-06 — Router GDPR `consent.router.ts` sin RLS demote `P1-ALTO`
**Categoría:** C3 — RLS + tenant isolation
**Archivo:línea:** `packages/trpc/src/routers/consent.router.ts`

**Descripción:**
El router usa `tenantProcedure` pero no `withTenantContext()`. El aislamiento multi-tenant se logra via:
```ts
if (patient.organizationId !== ctx.tenant.organizationId) {
  throw new TRPCError({ code: "FORBIDDEN" });
}
```
Esta es defensa-en-profundidad a nivel JS, pero sin RLS demote en `authenticated`, las políticas de BD no aplican. Si se añaden políticas RLS a `PatientConsent` en el futuro, no aplicarán a este router.

**Remediación:** Envolver mutaciones en `withTenantContext(prisma, ctx.tenant, ...)`.

---

#### C-07 — `revoke()` acepta `reason` pero no la persiste `P2-MEDIO`
**Categoría:** C1 — Trazabilidad
**Archivo:línea:** `packages/trpc/src/routers/consent.router.ts` — procedimiento `revoke()`

**Descripción:**
El schema Zod de `revoke()` acepta `reason: z.string()` pero el modelo `PatientConsent` no tiene columna `revocationReason`. El campo se ignora silenciosamente. Para auditoría LOPD, la razón de revocación debe persistirse.

**Remediación:** Añadir `revocationReason String?` al modelo Prisma + migración.

---

#### C-08 — `create()` GDPR acepta `ipAddress` pero no la persiste `P2-MEDIO`
**Categoría:** C1 — Trazabilidad
**Archivo:línea:** `packages/trpc/src/routers/consent.router.ts` — procedimiento `create()`

**Descripción:**
Similar a C-07: el input Zod acepta `ipAddress` para registro de IP en el momento del consentimiento (requerimiento LOPD), pero `PatientConsent` no tiene columna para ello.

**Remediación:** Añadir `ipAddress String?` al modelo Prisma + migración.

---

#### C-09 — Sin tests para flujo de firma doble `P2-MEDIO`
**Categoría:** C11 — Tests y cobertura
**Archivo:** `packages/trpc/src/routers/ece/__tests__/`

**Descripción:**
No se encontraron tests que cubran el flujo completo de doble firma NTEC Art. 39 ni el rechazo del consentimiento en caso de trigger activo.

**Remediación:** Casos de test: crear consentimiento, firmar paciente (debe funcionar pre-firma), rechazar segunda firma si médico es el mismo que paciente, rechazo post-firma por trigger.

---

#### C-10 — Distinción GDPR vs NTEC documentada pero labels UI poco claros `P3-BAJO`
**Categoría:** C12 — UX compliance
**Descripción:**
Los dos sistemas de consentimiento (GDPR `/consents` y NTEC `/ece/consentimiento`) son funcionalmente distintos y deben coexistir (validado en CLAUDE.md). Sin embargo, en el sidebar aparecen con nombres similares. Se recomienda etiquetas más claras: "Consentimiento Datos (LOPD)" vs "Consentimiento Médico (NTEC)".

---

### Matriz de trazabilidad — Consentimiento NTEC

| Flujo | UI | tRPC | Prisma/SQL | DB | Estado |
|-------|----|----|----|----|--------|
| Crear consentimiento | wizard paso 1-3 | `create()` | `$executeRaw INSERT` | `ece.consentimiento_informado` | ROTO — C-02 (endpoint incorrecto) |
| Firmar paciente | wizard paso 3 | `firmarPaciente()` | `UPDATE firmante_rol` | trigger bloquea | ROTO — C-01 |
| Firmar MC | paso 3 | `firmarMc()` | `UPDATE firma_mc_id` | columna inexistente | ROTO — C-03, C-05 |
| Revocar | — | `revoke()` | Prisma UPDATE | `PatientConsent` sin `revocationReason` | Parcial — C-07 |
| Listar NTEC | lista page | `list()` | `$queryRaw` | `ece.consentimiento_informado` | Con RLS (withWorkflowContext correcto) |

### Riesgo Go-Live — Consentimiento: BLOQUEANTE
El módulo NTEC no puede crear ni firmar ningún consentimiento. C-01 y C-02 garantizan falla total. El módulo GDPR tiene gaps de trazabilidad pero es funcional a nivel básico. No apto para go-live (NTEC).

---

## Resumen Consolidado Stream C

### Tabla de hallazgos × categoría × módulo × severidad

| ID | Módulo | Categoría | Severidad | Resumen |
|----|--------|-----------|-----------|---------|
| A-01 | Epicrisis | C5 CIE-10 + C7 Schema | P0-BLOQUEANTE | `cie10_principal` inexistente — firma/setCie10 siempre fallan |
| A-02 | Epicrisis | C7 Schema drift | P0-BLOQUEANTE | 8 columnas de workflow inexistentes en `EpicrisisRow` |
| A-03 | Epicrisis | C1 Trazabilidad | P0-BLOQUEANTE | Certify en UI: `certificar.mutate()` nunca llamado |
| B-01 | Defunción ECE | C7 Schema drift | P0-BLOQUEANTE | 7 columnas de workflow inexistentes en `CertDefRow` |
| C-01 | Consentimiento | C4 Inmutabilidad + C6 Firma | P0-BLOQUEANTE | `fn_bloquea_mutacion` bloquea primera firma (trigger incondicional) |
| C-02 | Consentimiento | C1 Trazabilidad | P0-BLOQUEANTE | UI wizard llama endpoint incorrecto — contenido nunca persiste |
| A-04 | Epicrisis | C3 RLS | P1-ALTO | `withEceContext` no demota rol — RLS no aplica |
| A-05 | Epicrisis | C4 Inmutabilidad | P1-ALTO | Trigger sobredimensionado bloquea mutaciones pre-firma |
| A-06 | Epicrisis | C3 RLS | P1-ALTO | Queries list/get sin filtro de establecimiento |
| B-02 | Defunción ECE | C3 RLS | P1-ALTO | `withEceContext` no demota rol — RLS no aplica |
| B-03 | Defunción ECE | C6 Firma | P1-ALTO | `validar()` sin PIN — no-repudio del director médico ausente |
| B-04 | Defunción ECE | C2 Contratos | P1-ALTO | No valida `tipo_egreso = 'fallecido'` en epicrisis vinculada |
| B-05 | Defunción legacy | C4+C8 Audit | P1-ALTO | Sin inmutabilidad ni hash chain en `DeathCertificate` |
| C-03 | Consentimiento | C6 Firma doble | P1-ALTO | Schema no tiene columna para firma MC — Art. 39 imposible |
| C-04 | Consentimiento | C7+C4 Schema | P1-ALTO | Campo `firmado` inexistente — inmutabilidad no condicionable |
| C-05 | Consentimiento | C6 Firma doble | P1-ALTO | `firmarMc()` falla por columna + trigger |
| C-06 | Consentimiento GDPR | C3 RLS | P1-ALTO | `consent.router` sin `withTenantContext` |
| A-07 | Epicrisis | C6 Firma | P2-MEDIO | `firmaId` de origen desconocido en modal PIN |
| A-08 | Epicrisis | C11 Tests | P2-MEDIO | Sin tests de integración para flujo firma |
| B-06 | Defunción | C1 Trazabilidad | P2-MEDIO | Dos sistemas paralelos sin reconciliación |
| B-07 | Defunción ECE | C5 CIE-10 | P2-MEDIO | CIE-10 hardcoded 10 entradas en UI |
| B-08 | Defunción ECE | C2 Contratos | P2-MEDIO | Parseo frágil CIE-10 por split de espacio |
| C-07 | Consentimiento GDPR | C1 Trazabilidad | P2-MEDIO | `revoke()` no persiste `reason` |
| C-08 | Consentimiento GDPR | C1 Trazabilidad | P2-MEDIO | `create()` no persiste `ipAddress` |
| C-09 | Consentimiento | C11 Tests | P2-MEDIO | Sin tests doble firma Art. 39 |
| C-10 | Consentimiento | C12 UX | P3-BAJO | Labels sidebar GDPR vs NTEC poco claros |

### Conteo de hallazgos

| Severidad | Epicrisis | Defunción ECE | Defunción Legacy | Consentimiento NTEC | Consentimiento GDPR | Total |
|-----------|-----------|--------------|-----------------|---------------------|---------------------|-------|
| P0-BLOQUEANTE | 3 | 1 | 0 | 2 | 0 | **6** |
| P1-ALTO | 3 | 4 | 1 | 3 | 1 | **12** |
| P2-MEDIO | 2 | 3 | 0 | 1 | 2 | **8** |
| P3-BAJO | 0 | 0 | 0 | 1 | 0 | **1** |
| **Total** | **8** | **8** | **1** | **7** | **3** | **27** |

---

### Top-5 Riesgos Go-Live Stream C

| Rank | Riesgo | Hallazgos asociados | Impacto regulatorio |
|------|--------|--------------------|--------------------|
| 1 | **Schema drift masivo** — columnas de workflow referenciadas en routers no existen en DB → todo el stack ECE de Stream C falla en producción | A-01, A-02, B-01, C-03, C-04 | NTEC Arts. 17, 21, 39, 40 |
| 2 | **Trigger `fn_bloquea_mutacion` incondicional** — bloquea primera firma en `consentimiento_informado` y mutaciones pre-firma en `epicrisis_egreso` → módulos inoperables | A-05, C-01 | NTEC Art. 40 |
| 3 | **RLS no aplica en epicrisis y certDef** — `withEceContext` no demota rol → aislamiento multi-tenant inexistente para documentos clínicos críticos | A-04, A-06, B-02 | LOPD / Art. 6 datos sensibles salud |
| 4 | **UI wizard consentimiento llama endpoint incorrecto** — contenido clínico (procedimiento, riesgos, alternativas, firmas) nunca persiste en servidor | C-02 | NTEC Art. 39 |
| 5 | **Certificar epicrisis: stub TODO en producción** — la acción de certificación nunca invoca la mutación → ningún episodio hospitalario puede cerrarse oficialmente | A-03 | NTEC Art. 17 (cierre obligatorio) |

---

### Recomendaciones priorizadas

#### Prioridad 1 — Prerequisito absoluto antes de go-live (P0)

1. **Migración de schema DDL** (1 archivo SQL nuevo):
   - `ece.epicrisis_egreso`: añadir `cie10_principal TEXT`, `cie10_secundarios TEXT[]`, `estado_workflow TEXT`, `firma_mc_id UUID`, `firma_esp_id UUID`, `firma_dir_id UUID`, `resumen_ingreso TEXT`, `evolucion_hospitalaria JSONB`, `tratamiento_egreso TEXT`, `indicaciones_egreso TEXT`
   - `ece.certificado_defuncion`: añadir `estado_workflow TEXT`, `firmado_en TIMESTAMPTZ`, `validado_en TIMESTAMPTZ`, `certificado_en TIMESTAMPTZ`, `anulado_en TIMESTAMPTZ`, `payload_hash TEXT`, `medico_firmante_id UUID`
   - `ece.consentimiento_informado`: añadir `firmado BOOLEAN DEFAULT false`, `firma_mc_id UUID`, `firma_mc_en TIMESTAMPTZ`, `evidencia_firma_mc_ref TEXT`, `estado TEXT DEFAULT 'borrador'`
   - Sincronizar `schema.prisma` con todos los cambios

2. **Condicionar `fn_bloquea_mutacion()`**: evaluar estado antes de bloquear — solo bloquear post-firma confirmada, no en borrador

3. **Fix UI wizard consentimiento** (`nuevo/page.tsx`): cambiar a `trpc.eceConsentimiento.create`, resolver `tipoDocumentoId` desde catálogo, incluir payload completo del paso 2

4. **Fix `onCertificarConfirm`** (`epicrisis/[id]/page.tsx`): invocar `certificar.mutate({ id, pin })` en lugar del stub TODO

#### Prioridad 2 — Cumplimiento regulatorio alto (P1)

5. **Migrar epicrisis y certDef a `withWorkflowContext`**: reemplazar `withEceContext` local en ambos routers para activar RLS
6. **Añadir filtros `WHERE establecimiento_id`** en queries de lista/detalle como defensa redundante
7. **Añadir PIN a `validar()`** en certDef router para no-repudio del Director Médico
8. **Validar `tipo_egreso = 'fallecido'`** en `certDef.create()` antes de aceptar la FK a epicrisis
9. **Añadir inmutabilidad a `DeathCertificate` legacy** o deprecar con sunset + redirect 301

#### Prioridad 3 — Trazabilidad y calidad (P2)

10. **Persistir `revocationReason` e `ipAddress`** en `PatientConsent` (migración Prisma)
11. **Reemplazar CIE-10 hardcoded** en UI defunción por `trpc.icd10.search` con debounce
12. **Definir política bridge-death** o sunset del sistema legacy defunción
13. **Añadir tests de integración** para flujos críticos: firma epicrisis (Art. 17 hard-stop), doble firma consentimiento (Art. 39), certificación defunción (Art. 21)

---

### Decisiones Arquitectónicas Derivadas (ADRs cortos)

#### ADR-C01: Condicionar trigger de inmutabilidad por estado
**Contexto:** `fn_bloquea_mutacion()` bloquea incondicionalmente todos los UPDATE/DELETE en tablas ECE, incluyendo transiciones pre-firma.
**Decisión:** Modificar la función para evaluar estado del documento antes de lanzar excepción. Solo documentos en estado final (firmado/certificado) son inmutables.
**Consecuencias:** (positivo) Los flujos de borrador y primera firma funcionan. (negativo) La protección es más granular y depende de la correcta gestión del campo `estado`/`firmado`; requiere que ese campo exista (prerequisito de migración).

#### ADR-C02: Adoptar `withWorkflowContext` como estándar único para routers ECE
**Contexto:** `withEceContext` local duplica parcialmente la funcionalidad de `withWorkflowContext` sin el componente crítico de RLS demote. Dos helpers con responsabilidades superpuestas.
**Decisión:** Eliminar `withEceContext` local de los routers epicrisis y certDef. Todos los routers `ece/*` usan `withWorkflowContext` para mutaciones y añaden filtros explícitos de `establecimiento_id` en queries de lectura.
**Consecuencias:** (positivo) RLS unificado, menos superficie de error, consistencia con consentimiento.router. (negativo) Requiere refactor de los dos routers y ajuste de queries de lectura.

#### ADR-C03: Bridge-death para reconciliación sistemas paralelos
**Contexto:** Existen dos sistemas de certificado de defunción (legacy `public.DeathCertificate` + ECE `ece.certificado_defuncion`) sin coordinación.
**Decisión:** Crear `bridge-death` (patrón similar a `eceBridgeTriage`) que sincroniza la creación en ECE hacia el modelo legacy para preservar reportería existente, con fecha de sunset del legacy a 90 días post go-live ECE validado.
**Consecuencias:** (positivo) Reportería existente no se rompe. (negativo) Periodo de doble escritura añade complejidad transaccional temporaria.

---

*Auditoría realizada por @AS — Arquitecto de Software.*
*Fuentes normativas: NTEC Arts. 17, 21, 39, 40; Implementing Domain-Driven Design (Vernon, 2013) §CH6 Aggregates; Building Microservices (Newman, 2021) §CH9 Testing.*
*Referencias de implementación: TDR_HIS_Multipais.md, CLAUDE.md §Contrato RLS, docs/30_runbook_firma_workflow_ece.md.*
