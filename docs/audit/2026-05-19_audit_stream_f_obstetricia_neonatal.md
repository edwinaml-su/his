# Auditoría Stream F — Obstetricia + Neonatal (6 módulos NTEC)

**Fecha:** 2026-05-19  
**Auditor:** @AS — Arquitecto de Software, Unidad de Transformación Digital, Inversiones Avante  
**Rama auditada:** `feat/fase2-s1-gate` (commit `6532a92`)  
**Método:** Lectura estática UI + routers tRPC + contratos Zod + consultas directas a Supabase (`information_schema.columns`, `pg_policies`, triggers). Solo lectura — sin modificaciones.  
**Scope:** 6 módulos — Obstetricia dashboard, Partograma OMS, Expulsión (lista + detalle), Atención RN, Reanimación Neonatal NRP, Atención Emergencia (lista + nueva + detalle).

---

## Índice

1. [Módulo 1 — Obstetricia Dashboard](#módulo-1)
2. [Módulo 2 — Partograma OMS](#módulo-2)
3. [Módulo 3 — Sala de Expulsión (lista + detalle)](#módulo-3)
4. [Módulo 4 — Atención Recién Nacido](#módulo-4)
5. [Módulo 5 — Reanimación Neonatal NRP](#módulo-5)
6. [Módulo 6 — Atención de Emergencia](#módulo-6)
7. [Resumen Consolidado Stream F](#resumen-consolidado)

---

## Metodología

| Cat | Nombre |
|-----|--------|
| C1  | Trazabilidad UI → ORM → DB (matriz por campo) |
| C2  | Contratos tRPC (input/output Zod schemas) |
| C3  | Seguridad: RLS + tenant isolation + withTenantContext |
| C4  | Inmutabilidad post-firma (NTEC Art. 40) |
| C5  | CIE-10 obligatorio (NTEC Art. 17) |
| C6  | Firma electrónica — single/doble firma (NTEC Art. 39) |
| C7  | Schema drift (Prisma vs SQL DDL vs router types) |
| C8  | Audit hash chain (writes registradas en audit.audit_log) |
| C9  | Eventos de dominio (emitDomainEvent) |
| C10 | Manejo de errores y rollback transaccional |
| C11 | Tests y cobertura |
| C12 | Accesibilidad / UX compliance (WCAG 2.2 AA) |

**Severidades:**
- `P0-BLOQUEANTE`: Falla en producción garantizada o violación regulatoria irremediable
- `P1-ALTO`: Riesgo alto, falla probable, vulnerabilidad de seguridad o cumplimiento
- `P2-MEDIO`: Degradación funcional, cobertura incompleta, deuda técnica significativa
- `P3-BAJO`: Mejora recomendable, no bloquea go-live

---

## Módulo 1 — Obstetricia Dashboard {#módulo-1}

### 1.1 Resumen ejecutivo

El dashboard de maternidad (`/ece/obstetricia`) implementa una vista operacional para el jefe de servicio. El módulo es completamente declarativo en `"use client"` con datos mock hardcodeados. No existe ningún router tRPC cableado: la página no emite ninguna petición de red real en producción. El módulo cumple bien con los requisitos de accesibilidad (WCAG 2.2 AA) y estructura semántica, pero presenta un gap funcional crítico: los KPIs, el mosaico de salas y las alertas clínicas mostradas no provienen de la base de datos.

El hallazgo más relevante es que el auto-refresh a 30 segundos fuerza un re-render mediante un contador (`tick`) pero nunca recarga datos reales, dado que no hay queries tRPC. El panel de alertas obstétricas (partograma lento, alumbramiento tardío, hemorragia post-parto) opera en modo totalmente simulado — ninguna alerta real del outbox de dominio (`ece.partograma.alerta`, `ece.expulsion.hemorragia_post_parto_alerta`) se muestra aquí.

### 1.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — dashboard | `apps/web/src/app/(clinical)/ece/obstetricia/page.tsx` |
| Router tRPC | No existe (`eceObstetricia.*` referenciado en TODO, no en router index) |
| Schema DB | N/A (sin capa ORM) |

### 1.3 Matriz de trazabilidad — Dashboard Obstetricia

| # | Campo UI | Payload tRPC | Prop Zod | Columna Router SQL | Columna DB Real | Tipo Zod | Tipo DB | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|---|
| 1 | KPIs (trabajoParto, salas, nacimientos, UCIN) | `useMockKpis()` | — | — | — | mock | — | NO | **C1/C2 P0**: todos los KPIs son mock hardcodeado sin tRPC |
| 2 | Mosaico de salas (estado, paciente, dilatación) | `SALAS_MOCK` | — | — | — | mock | — | NO | **C1 P0**: sin fuente de datos real |
| 3 | Alertas clínicas (partograma-lento, alumbramiento) | `ALERTAS_MOCK` | — | — | — | mock | — | NO | **C1 P0**: sin consulta a outbox de alertas |
| 4 | Cola de próximas pacientes | `COLA_MOCK` | — | — | — | mock | — | NO | **C1 P1**: cola de espera no persiste |
| 5 | Protocolo HPP (inline, texto fijo) | static | — | — | — | static | — | NO | **C1 P1**: no detecta casos reales de HPP |
| 6 | Auto-refresh 30s | `setInterval tick` | — | — | — | — | — | PARCIAL | **C2 P2**: fuerza re-render pero no re-fetcha datos |

### 1.4 Hallazgos

---

#### HF-01 — P0-BLOQUEANTE — Dashboard obstetricia opera 100% con datos mock en producción

**Categoría:** C1 (Trazabilidad UI→ORM→DB), C2 (Contratos tRPC)  
**Archivo:** `apps/web/src/app/(clinical)/ece/obstetricia/page.tsx` líneas 87-167  
**Evidencia:** Las funciones `useMockKpis()`, `SALAS_MOCK`, `ALERTAS_MOCK`, `COLA_MOCK` son constantes hardcodeadas. El TODO en línea 85 reconoce explícitamente que el router no está disponible. No existe `eceObstetricia` en ningún router registrado.  
**Impacto:** El jefe de servicio de maternidad opera con datos ficticios. Ninguna alerta real de distocia, alumbramiento tardío ni HPP se muestra. Riesgo clínico directo (Art. 25 NTEC).  
**Corrección requerida:** Implementar `eceObstetriciaRouter` con procedures `kpis`, `salas`, `alertas` y `cola` que consuman `ece.episodio_atencion` + tabla de salas + outbox. Sustituir mocks por `trpc.eceObstetricia.*.useQuery({ refetchInterval: 30_000 })`.

---

#### HF-02 — P1-ALTO — Auto-refresh simula actualización pero no recarga datos

**Categoría:** C1, C10  
**Archivo:** `apps/web/src/app/(clinical)/ece/obstetricia/page.tsx` líneas 363-373  
**Evidencia:** `setInterval(() => setTick(...), 30_000)` incrementa un contador que no tiene efecto observable porque los datos son estáticos. El comentario dice "fuerza re-render intencionalmente" pero el re-render de datos mock no produce actualización clínica.  
**Impacto:** Operador cree que los datos se actualizan cuando no es así.  
**Corrección:** Eliminar el mock de tick cuando se conecte tRPC con `refetchInterval`.

---

#### HF-03 — P1-ALTO — Alertas HPP y partograma no consumen eventos de dominio

**Categoría:** C9 (Eventos de dominio)  
**Evidencia:** El router `periodoExpulsivo.registrarEvento` emite `ece.expulsion.hemorragia_post_parto_alerta` y `ecePartogramaRouter.registrar` emite `ece.partograma.alerta`. Ninguno de estos eventos se consume en el dashboard.  
**Impacto:** Las alertas clínicas obstétricas (HPP, distocia) no llegan al jefe de servicio en tiempo real.  
**Corrección:** Implementar query de alertas activas desde `public.domain_events` o tabla de alertas dedicada.

---

#### HF-04 — P3-BAJO — Sección "Protocolo HPP" usa texto fijo sin lógica reactiva

**Categoría:** C12  
**Archivo:** `apps/web/src/app/(clinical)/ece/obstetricia/page.tsx` líneas 541-552  
**Evidencia:** Texto "Sin casos activos reportados" es hardcodeado.  
**Corrección:** Conectar con query de alertas HPP activas cuando se implemente el router.

**Estado Módulo 1:** P0×1, P1×2, P3×1 — Total 4 hallazgos

---

## Módulo 2 — Partograma OMS {#módulo-2}

### 2.1 Resumen ejecutivo

El partograma (`/ece/obstetricia/partograma/[episodioId]`) tiene la mejor implementación técnica del stream. El router `ecePartogramaRouter` usa raw SQL con validación de tenant por `establecimientoId`, calcula la alerta OMS correctamente, emite eventos de dominio y expone una función `calcularAlertaOms` bien cubierta por tests unitarios.

El hallazgo principal es una debilidad en la resolución del `docObstetricoId`: la UI lo obtiene de `window.location.search` (`?docId=<uuid>`) sin ningún fallback ni navegación tipada. Si el parámetro falta, el partograma queda inoperativo sin error visible al usuario. Adicionalmente, la RLS sobre `partograma_registro` usa `app.current_org_id` como establecimiento, cuando debería ser `app.current_establecimiento_id` — discrepancia de naming que puede producir filtrado incorrecto si los GUC se setean bajo distintos nombres en producción.

### 2.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — partograma | `apps/web/src/app/(clinical)/ece/obstetricia/partograma/[episodioId]/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/partograma.router.ts` |
| Schema DB (via MCP) | `ece.partograma_registro` (16 columnas confirmadas) |
| Tests | `packages/trpc/src/routers/ece/__tests__/partograma.router.test.ts` |

### 2.3 Matriz de trazabilidad — Partograma

| # | Campo UI | Payload tRPC | Prop Zod | Columna Router SQL | Columna DB Real | Tipo Zod | Tipo DB | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `?docId` (query param) | `docObstetricoId` | `z.string().uuid()` | `doc_obstetrico_id` | `doc_obstetrico_id` | uuid | uuid | OK | C1: resolución via URL param sin validación de existencia |
| 2 | `dilatacionCm` | `dilatacionCm` | `z.number().min(0).max(10)` | `dilatacion_cm` | `dilatacion_cm` | number | numeric | OK | Alineado |
| 3 | `borramientoPct` | `borramientoPct` | `z.number().int().min(0).max(100)` | `borramiento_pct` | `borramiento_pct` | int | smallint | OK | Alineado |
| 4 | `fcf` | `frecuenciaCardiacaFetal` | `z.number().int().min(60).max(200)` | `frecuencia_cardiaca_fetal` | `frecuencia_cardiaca_fetal` | int | smallint | OK | Alineado |
| 5 | `contracciones` | `contracciones10min` | `z.number().int().min(0).max(10)` | `contracciones_10min` | `contracciones_10min` | int | smallint | OK | Alineado |
| 6 | `dolor` | `dolorPaciente` | `z.number().int().min(0).max(10)` | `dolor_paciente` | `dolor_paciente` | int | smallint | OK | Alineado |
| 7 | `observaciones` | `observaciones` | `z.string().max(2_000)` | `observaciones` | `observaciones` | text | text | OK | Alineado |
| 8 | `alerta_oms` (display) | calculado en router | — | `alerta_oms` | `alerta_oms` | computed | text (nullable) | PARCIAL | **C7 P2**: DB permite NULL pero el tipo TS lo asume never-null |
| 9 | `posicionFetal` | `posicionFetal` | `z.enum(POSICION_FETAL)` | `posicion_fetal` | `posicion_fetal` | enum | text | OK | Alineado |
| 10 | `registradoEn` | `registradoEn` | `z.string().datetime({ offset: true })` | `registrado_en` | `registrado_en` | ISO string | timestamptz | OK | Alineado |

### 2.4 Hallazgos

---

#### HF-05 — P1-ALTO — docObstetricoId obtenido de URL sin validación de existencia ni tipado tRPC

**Categoría:** C1, C2  
**Archivo:** `apps/web/src/app/(clinical)/ece/obstetricia/partograma/[episodioId]/page.tsx` líneas 426-432  
**Evidencia:**
```tsx
const params = new URLSearchParams(window.location.search);
const id = params.get("docId");
if (id) setDocObstetricoId(id);
```
La resolución es manual, fuera del sistema de routing de Next.js 14 (debería ser `searchParams` prop o `useSearchParams()`). Si `?docId` falta, el componente queda en estado `null` mostrando solo el mensaje "Agregue `?docId=...` a la URL" sin guiar al usuario a la navegación correcta. Adicionalmente no hay un `trpc.ecePartograma.get({ id })` previo para confirmar que el documento existe y pertenece al establecimiento.  
**Impacto:** Un médico que llegue al partograma sin el parámetro de query no tiene forma de recuperar el documento.  
**Corrección:** Usar `useSearchParams()` de Next.js. Agregar un `trpc.eceDocumentosObstetricos.getByEpisodio` para resolver el `docObstetricoId` desde el `episodioId` de la ruta.

---

#### HF-06 — P1-ALTO — RLS de partograma_registro usa app.current_org_id pero router filtra por establecimientoId

**Categoría:** C3 (RLS / tenant isolation)  
**Evidencia (MCP):** La policy `prt_read_personal` y `prt_write_personal` filtran:
```sql
ep.establecimiento_id = (current_setting('app.current_org_id', true))::uuid
```
El router en cambio llama a `resolveEceCtx(ctx)` que devuelve `ctx.tenant.establishmentId` (distinto de `organizationId`). La función `withWorkflowContext` setea `app.current_establecimiento_id` como GUC. Existe un mismatch: la RLS lee `app.current_org_id` pero el router no se ejecuta dentro de `withWorkflowContext` — usa raw SQL directamente sin demotar a `authenticated`. El rol Prisma (`postgres.<ref>`) tiene `BYPASSRLS`, por lo que la RLS **no aplica en absoluto** en las queries de lista/get/registrar del partograma.  
**Impacto:** Fuga de tenant cross-org. Un usuario de Org A puede leer registros de Org B si la BD no aplica RLS porque el rol tiene BYPASSRLS. El filtro en `WHERE ep.establecimiento_id = ...` en el raw SQL es la única defensa, y esta es "defensa débil" per CLAUDE.md §RLS.  
**Corrección:** Envolver las queries del router `ecePartogramaRouter` dentro de `withWorkflowContext` (al igual que hacen `sala-expulsion.router.ts` y `atencion-rn.router.ts`) para demotar el rol a `authenticated` y activar RLS. Unificar el GUC a `app.current_establecimiento_id`.

---

#### HF-07 — P2-MEDIO — alerta_oms es nullable en DB pero el tipo TS lo trata como never-null

**Categoría:** C7 (Schema drift)  
**Evidencia (MCP):** `information_schema.columns` muestra `alerta_oms` con `is_nullable = YES`.  
El tipo `PartogramaRegistroRow.alerta_oms` en el router está declarado como `"normal" | "zona_alerta" | "zona_accion"` sin `| null`. La UI en `[episodioId]/page.tsx` línea 441 accede a `registros[last].alerta_oms` sin null check.  
**Impacto:** Si un registro antiguo tiene `alerta_oms = NULL`, la UI lanza error de runtime en la interpolación del badge.  
**Corrección:** Añadir `| null` al tipo. Añadir `?? "normal"` como fallback en el router antes de retornar la fila.

---

#### HF-08 — P2-MEDIO — cerrarPartograma actualiza estado_registro a 'vigente' sin validar transición

**Categoría:** C4 (Inmutabilidad post-firma), C10  
**Archivo:** `packages/trpc/src/routers/ece/partograma.router.ts` líneas 307-337  
**Evidencia:** El procedure `cerrarPartograma` actualiza `labor_parto` JSONB y setea `estado_registro = 'vigente'` directamente, sin verificar el estado previo del documento ni si ya fue firmado. Un partograma ya firmado podría ser cerrado (y su JSONB modificado) sin restricción.  
**Impacto:** Violación de inmutabilidad post-firma (NTEC Art. 40).  
**Corrección:** Agregar guarda: `WHERE estado_registro NOT IN ('firmado', 'anulado')` en el UPDATE. Lanzar `CONFLICT` si la condición falla.

---

#### HF-09 — P3-BAJO — Tests del partograma no cubren cerrarPartograma

**Categoría:** C11  
**Evidencia:** `partograma.router.test.ts` cubre `calcularAlertaOms` (4 casos), Zod schemas (3) y `detectarAlertasOMS` (1). El procedure `cerrarPartograma` no tiene ningún test.  
**Corrección:** Agregar tests para `cerrarPartograma`: happy path, estado ya firmado (debe rechazar), documento no encontrado.

**Estado Módulo 2:** P1×2, P2×2, P3×1 — Total 5 hallazgos

---

## Módulo 3 — Sala de Expulsión (lista + detalle) {#módulo-3}

### 3.1 Resumen ejecutivo

El módulo de expulsión tiene dos capas que operan sobre la misma tabla `ece.sala_expulsion` pero con dos routers diferentes. La página de lista (`expulsion/page.tsx`) usa `eceSalaExpulsionRouter`, mientras que la página de detalle (`expulsion/[id]/page.tsx`) usa `periodoExpulsivoRouter`. Esto produce un conflicto arquitectónico: el router de lista tiene el cronómetro de fases y el registro de nacimiento, mientras que el router de detalle gestiona eventos JSONB sobre la misma fila.

El hallazgo más crítico es la **columna `eventos` JSONB ausente en la BD**. El router `periodoExpulsivo.registrarEvento` hace `UPDATE ece.sala_expulsion SET eventos = eventos || [...]::jsonb` pero la columna `eventos` no existe en la tabla confirmado por MCP (`SELECT COUNT(*) = 0`). Toda operación de registro de eventos del período expulsivo falla con `42703: column "eventos" does not exist`.

### 3.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — lista | `apps/web/src/app/(clinical)/ece/obstetricia/expulsion/page.tsx` |
| UI — detalle | `apps/web/src/app/(clinical)/ece/obstetricia/expulsion/[id]/page.tsx` |
| tRPC router lista | `packages/trpc/src/routers/ece/sala-expulsion.router.ts` |
| tRPC router detalle | `packages/trpc/src/routers/ece/periodo-expulsivo.router.ts` |
| Schema DB (via MCP) | `ece.sala_expulsion` (18 columnas confirmadas, sin `eventos`) |
| Tests | `packages/trpc/src/routers/ece/__tests__/sala-expulsion.router.test.ts` |

### 3.3 Matriz de trazabilidad — Sala de Expulsión

| # | Campo UI | Payload tRPC | Prop Zod | Columna Router SQL | Columna DB Real | Tipo Zod | Tipo DB | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `episodioId` (input manual) | `episodioHospitalarioId` | `z.string().uuid()` | `episodio_hospitalario_id` | `episodio_hospitalario_id` | uuid | uuid | OK | Alineado |
| 2 | `tipoParto` (select) | `tipoParto` | `z.enum(["eutocico","distocico","cesarea_emergencia"])` | `tipo_parto::ece.tipo_parto` | `tipo_parto` (USER-DEFINED) | enum | enum ece.tipo_parto | OK | Alineado |
| 3 | Cronómetro `inicioExpulsivoTs` | `inicioExpulsivoTs` | `z.coerce.date().optional()` | `inicio_expulsivo_ts` | `inicio_expulsivo_ts` | Date opt | timestamptz | OK | Alineado |
| 4 | Cronómetro `nacimientoTs` | `nacimientoTs` | `z.coerce.date()` | `nacimiento_ts` | `nacimiento_ts` | Date | timestamptz | OK | Alineado |
| 5 | `presentacion` (select) | `presentacionFetal` | `z.enum([...])` | `presentacion_fetal` | `presentacion_fetal` | enum | text | OK | Alineado |
| 6 | `mecanismo` (select) | `mecanismoParto` | `z.enum([...])` | `mecanismo_parto` | `mecanismo_parto` | enum | text | OK | Alineado |
| 7 | `episiotomia` (checkbox) | `episiotomia` | `z.boolean()` | `episiotomia` | `episiotomia` | bool | boolean | OK | Alineado |
| 8 | `desgarro` | `desgarroPeriNealGrado` | `z.number().int().min(0).max(4)` | `desgarro_perineal_grado` | `desgarro_perineal_grado` | int | smallint | OK | Alineado |
| 9 | `sangrado` | `sangradoEstimadoMl` | `z.number().int().min(0)` | `sangrado_estimado_ml` | `sangrado_estimado_ml` | int | integer | OK | Alineado |
| 10 | `alumbramiento_ts` | `alumbramiento_ts` | `z.coerce.date().optional()` | `alumbramiento_ts` | `alumbramiento_ts` | Date opt | timestamptz | OK | Alineado |
| 11 | Eventos del timeline (detalle) | `tipo`, `nota` | `z.enum([...])` | `eventos` (JSONB append) | **AUSENTE** | enum+text | — | **NO** | **HF-10 P0**: columna no existe |
| 12 | Firma (botón "Firmar") | `id` | `z.string().uuid()` | `estado_registro = 'firmado'` | `estado_registro` | — | text | OK | Sin PIN — solo auth rol |

### 3.4 Hallazgos

---

#### HF-10 — P0-BLOQUEANTE — Columna eventos JSONB ausente en ece.sala_expulsion

**Categoría:** C7 (Schema drift)  
**Archivos:** `packages/trpc/src/routers/ece/periodo-expulsivo.router.ts` líneas 232-234; `apps/web/src/app/(clinical)/ece/obstetricia/expulsion/[id]/page.tsx` línea 168  
**Evidencia (MCP):**
```sql
SELECT COUNT(*) FROM information_schema.columns
WHERE table_schema='ece' AND table_name='sala_expulsion' AND column_name='eventos';
-- Resultado: 0
```
El router referencia `SQL 72b` en su docstring como fuente de la columna `eventos`, pero dicha migración no se aplicó a Supabase. El UPDATE `SET eventos = eventos || ...:jsonb` fallará con `42703`.  
**Impacto:** `periodoExpulsivo.registrarEvento`, `listEventos` y `get` (que selecciona `eventos`) fallan en producción. El timeline de la sala de expulsión es inutilizable.  
**Corrección:** Aplicar la migración pendiente: `ALTER TABLE ece.sala_expulsion ADD COLUMN eventos jsonb NOT NULL DEFAULT '[]'::jsonb;`

---

#### HF-11 — P0-BLOQUEANTE — Firma en sala_expulsion no verifica PIN electrónico (NTEC Art. 39)

**Categoría:** C6 (Firma electrónica)  
**Archivo:** `packages/trpc/src/routers/ece/sala-expulsion.router.ts` líneas 289-316  
**Evidencia:** El procedure `firmar` solo verifica que `estado_registro === 'borrador'` y hace el UPDATE a `'firmado'`. No hay verificación de PIN ni argon2id. El input schema es solo `{ id: z.string().uuid() }` sin campo `pin` o `firmaId`.  
La UI (`expulsion/page.tsx` línea 514) usa un botón simple sin `PinConfirmModal`.  
**Contraste:** `atencion-rn.router.ts` implementa `verifyPin()` completo con argon2id + lockout + `firma_electronica` lookup. `atencion-emergencia.router.ts` exige `firmaId: z.string().uuid()` y lo registra en `firma_mt_id`.  
**Impacto:** El registro de nacimiento puede ser "firmado" sin autenticación electrónica del ginecólogo. Violación directa de NTEC Art. 39 (firma electrónica de médico responsable del parto).  
**Corrección:** Añadir `pin: z.string().min(6).max(32)` al schema de `firmar`. Implementar `verifyPin()` equivalente al de `atencion-rn.router.ts`. Añadir `PinConfirmModal` en la UI.

---

#### HF-12 — P1-ALTO — periodoExpulsivo.list sin filtro de establecimiento en RLS

**Categoría:** C3 (RLS / tenant isolation)  
**Archivo:** `packages/trpc/src/routers/ece/periodo-expulsivo.router.ts` líneas 140-166  
**Evidencia:** `withEceContext(ctx)` valida que exista `establishmentId` pero el helper en este router **no invoca** `withWorkflowContext` — simplemente retorna el contexto sin ejecutar la query dentro de una transacción con rol demotado. El `ctx.prisma.$queryRaw` se ejecuta con `BYPASSRLS`. La policy `sala_exp_by_estab` no aplica.  
La query sí tiene JOIN a `episodio_hospitalario` + `episodio_atencion` para filtrar por `ea.establecimiento_id`, pero esto es defensa débil (solo en WHERE, no en RLS activo).  
**Impacto:** Si el JOIN es omitido o simplificado en una refactorización futura, la fuga de datos cross-org es inmediata.  
**Corrección:** Envolver las queries en `withWorkflowContext(ctx.prisma, buildEceCtx(...), fn)` como hace `sala-expulsion.router.ts`.

---

#### HF-13 — P1-ALTO — Cronómetro de fases es solo client-side state (no persiste)

**Categoría:** C1, C10  
**Archivo:** `apps/web/src/app/(clinical)/ece/obstetricia/expulsion/page.tsx` líneas 81-119  
**Evidencia:** El hook `useCronometro()` mantiene `timestamps` y `fase` en `React.useState`. Si el usuario recarga la página, pierde el cronómetro. El `nacimientoTs` se obtiene de `timestamps.expulsiva` (state) y se envía a `registrarNacimiento`.  
**Impacto:** Si la red falla o el tab se cierra entre fases, los timestamps de inicio de labor activa y expulsiva se pierden. El registro de nacimiento quedaría sin `inicioExpulsivoTs`.  
**Corrección:** Persistir los timestamps en `sessionStorage` o en una entidad ECE borrador en BD tan pronto como se inician, no solo al registrar el nacimiento.

---

#### HF-14 — P2-MEDIO — findPersonalId usa his_user_id pero partograma.router usa usuario_id

**Categoría:** C7 (Schema drift — naming inconsistente entre routers)  
**Evidencia:** `sala-expulsion.router.ts` línea 107 usa `WHERE his_user_id = ...`. `partograma.router.ts` línea 198-206 usa `WHERE usuario_id = ...`. La BD (MCP) confirma que la columna se llama `his_user_id`.  
**Impacto:** `partograma.registrar` fallará con `42703: column "usuario_id" does not exist` en producción.  
**Corrección:** Corregir en `partograma.router.ts` línea 205: `WHERE usuario_id` → `WHERE his_user_id`.

---

#### HF-15 — P2-MEDIO — Sin audit hash chain en registros obstétricos

**Categoría:** C8 (Audit hash chain)  
**Evidencia:** Ningún trigger de auditoría registrado en `information_schema.triggers` para `sala_expulsion` ni `partograma_registro`. Solo `reanimacion_neonatal` tiene `trg_rnr_updated_en`. No hay `INSERT INTO audit.audit_log` en ninguno de los routers de este módulo.  
**Impacto:** Los registros de nacimiento y partograma no tienen inmutabilidad criptográfica per TDR §6.3.  
**Corrección:** Añadir triggers de auditoría equivalentes a los de las tablas auditadas en `02_audit_triggers.sql`.

---

#### HF-16 — P3-BAJO — Tests de sala-expulsion.router.test.ts no cubren firmar con PIN

**Categoría:** C11  
**Evidencia:** El test file cubre `registrarNacimiento` y Zod validation. El procedure `firmar` carece de tests (ni del happy path ni del rechazo por estado incorrecto).  
**Corrección:** Agregar tests para `firmar` una vez implementado el PIN.

**Estado Módulo 3:** P0×2, P1×2, P2×2, P3×1 — Total 7 hallazgos

---

## Módulo 4 — Atención Recién Nacido {#módulo-4}

### 4.1 Resumen ejecutivo

El módulo ATN_RN (`/ece/atencion-rn`) tiene la implementación más completa y correcta del stream. El router `eceAtencionRnRouter` implementa creación atómica del paciente RN (Patient público + `ece.paciente` + `ece.atencion_recien_nacido`), firma electrónica con argon2id, eventos de dominio y actualización del motor de workflow (`documento_instancia`). Las columnas del router están correctamente alineadas con el schema DB real.

El hallazgo principal es que el `hora_nacimiento` (campo NOT NULL en la tabla con default `now()`) no es enviado explícitamente por el router — se confía en el default de la BD. Esto es correcto funcionalmente pero el valor será siempre `now()` (momento del INSERT), no el timestamp real del nacimiento que ya fue registrado en `ece.sala_expulsion.nacimiento_ts`. Esto produce inconsistencia temporal entre los dos registros.

Un segundo hallazgo relevante es que la RLS de `atencion_recien_nacido` tiene tres políticas solapadas de distintos niveles de madurez, una de ellas con acceso muy permisivo (`atencion_rn_select: current_setting IS NOT NULL`).

### 4.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI | `apps/web/src/app/(clinical)/ece/atencion-rn/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/atencion-rn.router.ts` |
| Schema DB (via MCP) | `ece.atencion_recien_nacido` (26 columnas confirmadas) |
| Tests | `packages/trpc/src/routers/ece/__tests__/atencion-rn.router.test.ts` |

### 4.3 Matriz de trazabilidad — Atención RN

| # | Campo UI | Payload tRPC | Prop Zod | Columna Router SQL | Columna DB Real | Tipo Zod | Tipo DB | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `episodio-obs-id` | `episodioObsId` | `z.string().uuid()` | `episodio_obs_id` | `episodio_obs_id` | uuid | uuid | OK | Alineado |
| 2 | `madre-id` | `pacienteMadreId` | `z.string().uuid()` | `paciente_madre_id` | `paciente_madre_id` | uuid | uuid | OK | Alineado |
| 3 | `peso` | `pesoG` | `z.number().int().min(200).max(8000)` | `peso_g` | `peso_g` | int | smallint | PARCIAL | **C7 P2**: DB smallint max 32767 pero validator max 8000 — OK en rango pero tipo distinto |
| 4 | `talla` | `tallaCm` | `z.number().min(20).max(70)` | `talla_cm` | `talla_cm` | decimal | numeric | OK | Alineado |
| 5 | `apgar1` | `apgar1min` | `z.number().int().min(0).max(10)` | `apgar_1min` | `apgar_1min` | int | smallint | OK | Alineado |
| 6 | `apgar5` | `apgar5min` | `z.number().int().min(0).max(10)` | `apgar_5min` | `apgar_5min` | int opt | smallint | OK | Alineado |
| 7 | `apgar10` | `apgar10min` | `z.number().int().min(0).max(10).optional()` | `apgar_10min` | `apgar_10min` | int opt | smallint | OK | Alineado |
| 8 | `reanimacion` (checkbox) | `reanimacionRequerida` | `z.boolean()` | `reanimacion_requerida` | `reanimacion_requerida` | bool | boolean | OK | Alineado |
| 9 | `nrp` (checkbox) | `reanimacionProtocoloNrp` | `z.boolean()` | `reanimacion_protocolo_nrp_aplicado` (JSONB) | `reanimacion_protocolo_nrp_aplicado` | bool→JSONB | jsonb | PARCIAL | **C7 P2**: coerción a JSONB en router |
| 10 | `alimentacion` | `alimentacionInicial` | `z.enum(["lactancia_inmediata","formula","sng"])` | `alimentacion_inicial` | `alimentacion_inicial` | enum | text | OK | Alineado |
| 11 | `hora_nacimiento` | — (no enviado) | — | — | `hora_nacimiento` NOT NULL default now() | — | timestamptz | PARCIAL | **HF-17 P1**: timestamp de nacimiento real no se propaga |
| 12 | Firma PIN | `pin: z.string().min(6).max(32)` | argon2id verifyPin | `firmado_por`, `firmado_en` | `firmado_por`, `firmado_en` | — | uuid, timestamptz | OK | Completo |
| 13 | `rn-birth-date` | `rnBirthDate` | `z.coerce.date()` | `birthDate` (public.Patient) | `birthDate` | Date | timestamptz | OK | Alineado |

### 4.4 Hallazgos

---

#### HF-17 — P1-ALTO — hora_nacimiento en atencion_recien_nacido usa now() en lugar del timestamp real del parto

**Categoría:** C1, C7  
**Archivo:** `packages/trpc/src/routers/ece/atencion-rn.router.ts` líneas 376-408  
**Evidencia:** El INSERT en `ece.atencion_recien_nacido` no incluye `hora_nacimiento` explícitamente — la BD usa `DEFAULT now()`. El timestamp del nacimiento real está disponible como `ece.sala_expulsion.nacimiento_ts` (registrado cuando el cronómetro de expulsión llega a fase expulsiva).  
**Impacto:** El registro ATN_RN muestra hora de creación del documento, no hora real del nacimiento. En caso de registros tardíos (ej. el pediatra crea ATN_RN 2 horas después), el certificado de nacimiento refleja la hora incorrecta. Impacto legal y clínico.  
**Corrección:** Añadir `rnBirthTs: z.coerce.date()` al schema de `create`. Pasar explícitamente `hora_nacimiento = ${input.rnBirthTs}` en el INSERT.

---

#### HF-18 — P1-ALTO — RLS atencion_rn_select es insuficientemente restrictiva

**Categoría:** C3 (RLS / tenant isolation)  
**Evidencia (MCP):** La policy `atencion_rn_select` tiene como `qual`:
```sql
current_setting('app.current_org_id', true) IS NOT NULL
```
Esto significa que cualquier usuario autenticado que tenga el GUC seteado (sea del org que sea) puede leer todos los registros ATN_RN. La policy correcta es `atn_rn_by_episodio_estab` que filtra por `episodio_atencion.establecimiento_id`. Al tener dos políticas permisivas en coexistencia, PostgreSQL aplica lógica OR — la más permisiva gana.  
**Impacto:** Fuga de datos neonatales cross-org mientras `atencion_rn_select` esté activa.  
**Corrección:** Eliminar la política `atencion_rn_select` redundante (ya cubierta por `atn_rn_by_episodio_estab`).

---

#### HF-19 — P2-MEDIO — pesoG declarado como int en Zod pero la BD es smallint

**Categoría:** C7  
**Evidencia:** `z.number().int().min(200).max(8000)` — el máximo 8000 es dentro del rango de smallint (32767), pero sin `z.number().int().max(32767)` un futuro cambio del validador podría superar el tipo de columna.  
**Corrección:** Añadir el constraint explícito `z.number().int().min(200).max(8000).pipe(z.coerce.number().int())` o cambiar la columna DB a `integer`.

---

#### HF-20 — P2-MEDIO — reanimacionProtocoloNrp serializado como JSONB `{aplicado: bool}` — sin schema formal

**Categoría:** C2, C7  
**Archivo:** `packages/trpc/src/routers/ece/atencion-rn.router.ts` línea 399  
**Evidencia:** `${JSON.stringify({ aplicado: input.reanimacionProtocoloNrp })}::jsonb` — la columna `reanimacion_protocolo_nrp_aplicado` es JSONB pero no hay schema definido. Si el router de reanimación neonatal necesita leer este JSONB, la falta de tipado produce runtime errors.  
**Corrección:** Definir un schema Zod para el JSONB o cambiar a columna `boolean` dado que actualmente solo almacena un booleano.

---

#### HF-21 — P3-BAJO — UI usa refs DOM nativos en lugar de React Hook Form o controlled inputs

**Categoría:** C12, C10  
**Archivo:** `apps/web/src/app/(clinical)/ece/atencion-rn/page.tsx` líneas 131-143  
**Evidencia:** 11 `useRef` para campos del formulario en lugar de state controlado. El validador `handleSubmit` lee `ref.current?.value` directamente. Esto hace el formulario difícil de probar y propenso a bugs de sincronización.  
**Corrección:** Migrar a `useState` o React Hook Form para consistencia con los otros módulos ECE.

**Estado Módulo 4:** P1×2, P2×2, P3×1 — Total 5 hallazgos

---

## Módulo 5 — Reanimación Neonatal NRP {#módulo-5}

### 5.1 Resumen ejecutivo

El módulo NRP (`/ece/reanimacion-neonatal`) tiene la mejor alineación schema-router-UI del stream. El router `eceReanimacionNeonatalRouter` está perfectamente mapeado con las 33 columnas confirmadas en `ece.reanimacion_neonatal`. El componente `NrpTimeline` usa `inferRouterOutputs<AppRouter>` — tipos end-to-end correctos.

El hallazgo crítico es que la RLS tiene tres policies solapadas: `rn_read`, `rn_write`, `rn_update` aplican sobre `{public}` (no sobre `{authenticated}`), lo que significa que cualquier conexión sin autenticación puede leer y modificar registros NRP. Adicionalmente, el enum `ece.resultado_reanimacion` no existe en la BD (query MCP devolvió vacío), lo que hará fallar el `cerrar` procedure con `42804: invalid input syntax for type ece.resultado_reanimacion`.

No existen tests para este módulo (`reanimacion*.test.ts` no encontrado).

### 5.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI | `apps/web/src/app/(clinical)/ece/reanimacion-neonatal/page.tsx` |
| UI — componente | `apps/web/src/app/(clinical)/ece/reanimacion-neonatal/_components/nrp-timeline.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/reanimacion-neonatal.router.ts` |
| Schema DB (via MCP) | `ece.reanimacion_neonatal` (33 columnas confirmadas) |
| Tests | **No existen** |

### 5.3 Matriz de trazabilidad — Reanimación Neonatal

| # | Campo UI | Payload tRPC | Prop Zod | Columna Router SQL | Columna DB Real | Tipo Zod | Tipo DB | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `atencionRnId` (filtro) | `atencionRnId` | `z.string().uuid().optional()` | `atencion_rn_id` | `atencion_rn_id` | uuid | uuid | OK | Alineado |
| 2 | `estimulacionTactilNota` | `estimulacionTactilNota` | `z.string().max(500)` | `estimulacion_tactil_nota` | `estimulacion_tactil_nota` | text | text | OK | Alineado |
| 3 | `vppPresionCmh2o` | `vppPresionCmh2o` | `z.number().int().min(0).max(80)` | `vpp_presion_cmh2o` | `vpp_presion_cmh2o` | int | smallint | OK | Alineado |
| 4 | `fcInicial` | `fcInicial` | `z.number().int().min(0).max(400)` | `fc_inicial` | `fc_inicial` | int | smallint | OK | Alineado |
| 5 | `tuboSizeMm` | `tuboSizeMm` | `z.number().min(0).max(5)` | `tubo_size_mm` | `tubo_size_mm` | decimal | numeric | OK | Alineado |
| 6 | `resultado` (cerrar) | `resultado` | `z.enum(["estable","cuidados_intermedios","ucin","defuncion"])` | `resultado::ece.resultado_reanimacion` | `resultado` (USER-DEFINED) | enum | **enum ausente** | **NO** | **HF-22 P0**: enum no existe en BD |
| 7 | `apertura_en` (display) | — | — | `apertura_en` | `apertura_en` | — | timestamptz | OK | Alineado |
| 8 | `cerrado_en` (display) | — | — | `cerrado_en` | `cerrado_en` | — | timestamptz | OK | Alineado |

### 5.4 Hallazgos

---

#### HF-22 — P0-BLOQUEANTE — Enum ece.resultado_reanimacion no existe en la BD

**Categoría:** C7 (Schema drift)  
**Archivo:** `packages/trpc/src/routers/ece/reanimacion-neonatal.router.ts` línea 381  
**Evidencia (MCP):**
```sql
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE n.nspname = 'ece' AND t.typname = 'resultado_reanimacion';
-- Resultado: 0 filas
```
El procedure `cerrar` hace `SET resultado = ${input.resultado}::ece.resultado_reanimacion` — el cast a un tipo inexistente lanza `42804` en producción.  
**Impacto:** El cierre de cualquier protocolo NRP falla. Si un neonato requirió reanimación y el pediatra intenta cerrar el registro, la operación es imposible.  
**Corrección:** `CREATE TYPE ece.resultado_reanimacion AS ENUM ('estable', 'cuidados_intermedios', 'ucin', 'defuncion');` y `ALTER TABLE ece.reanimacion_neonatal ALTER COLUMN resultado TYPE ece.resultado_reanimacion USING resultado::ece.resultado_reanimacion;`

---

#### HF-23 — P0-BLOQUEANTE — RLS de reanimacion_neonatal aplica a rol {public} — acceso sin autenticación

**Categoría:** C3 (RLS / tenant isolation)  
**Evidencia (MCP):** Las tres policies `rn_read`, `rn_write`, `rn_update` tienen `roles = {public}`. En PostgreSQL, `public` es la seudo-rol que representa a todos, **incluyendo conexiones no autenticadas**. La única policy restrictiva por establecimiento es `rnr_by_establecimiento` que aplica sobre `{authenticated}`.  
Con PERMISSIVE policies y lógica OR, `rn_read` (public, SELECT con `IS NOT NULL`) permite lectura a cualquier conexión que tenga el GUC seteado, incluso sin token de sesión válido.  
**Impacto:** Registros NRP (datos extremadamente sensibles: protocolo de reanimación de recién nacido) son accesibles sin autenticación si el GUC está presente. Violación HIPAA/LOPD.  
**Corrección:** Cambiar las tres policies defectuosas de `{public}` a `{authenticated}`. Revisar que `rnr_by_establecimiento` sea suficientemente restrictiva.

---

#### HF-24 — P1-ALTO — Sin tests unitarios para eceReanimacionNeonatalRouter

**Categoría:** C11  
**Evidencia:** `Glob packages/trpc/src/routers/ece/__tests__/reanimacion*.test.ts` devuelve vacío.  
**Impacto:** Ningún test cubre `crear`, `registrarPaso`, `cerrar`. Con el P0 anterior (enum ausente), los tests hubieran detectado el error antes de producción.  
**Corrección:** Crear `reanimacion-neonatal.router.test.ts` cubriendo al menos: Zod schemas, `cerrar` con resultado inválido, `registrarPaso` en registro cerrado (CONFLICT).

---

#### HF-25 — P2-MEDIO — registrarPaso hace múltiples UPDATEs separados fuera de transacción

**Categoría:** C10 (Manejo de errores, transacciones)  
**Archivo:** `packages/trpc/src/routers/ece/reanimacion-neonatal.router.ts` líneas 257-347  
**Evidencia:** El procedure `registrarPaso` puede ejecutar hasta 6 `ctx.prisma.$executeRaw` consecutivos (uno por cada paso NRP: estimulacion, VPP, intubación, MCE, adrenalina, volumen expansor) sin envolver en `$transaction`. Si falla el UPDATE de adrenalina después de completar el de VPP, el registro queda en estado parcialmente actualizado.  
**Corrección:** Envolver todos los `$executeRaw` del `registrarPaso` en un único `ctx.prisma.$transaction`.

---

#### HF-26 — P3-BAJO — NrpTimeline duplica constantes RESULTADO_LABEL/RESULTADO_VARIANT con la página padre

**Categoría:** C12 (UX / calidad de código)  
**Archivos:** `page.tsx` líneas 21-33 y `nrp-timeline.tsx` líneas 103-114  
**Evidencia:** Las constantes `RESULTADO_LABEL` y `RESULTADO_VARIANT` están duplicadas exactamente en ambos archivos.  
**Corrección:** Extraer a un módulo compartido `_lib/nrp-constants.ts`.

**Estado Módulo 5:** P0×2, P1×1, P2×1, P3×1 — Total 5 hallazgos

---

## Módulo 6 — Atención de Emergencia {#módulo-6}

### 6.1 Resumen ejecutivo

El módulo de atención de emergencia (`/ece/atencion-emergencia`) presenta el **schema drift más crítico del stream**. El router `atencionEmergenciaRouter` y la UI asumen una tabla `ece.atencion_emergencia` con columnas `medico_turno_id`, `firma_mt_id`, `estado_workflow`, `exploracion`, `diagnostico`, `plan_terapeutico`, `validado_en`, `anulado_en` y `motivo_anulacion`. La BD real confirma que ninguna de estas columnas existe — la tabla tiene una estructura completamente diferente con columnas `instancia_id`, `examen_fisico`, `diagnosticos` (JSONB), `manejo_realizado` (JSONB), `circunstancia_llegada`, `disposicion` y `estado_registro`.

Esta es la divergencia más severa del stream F (superando incluso al HF-01 del dashboard): todas las operaciones del router — `create`, `update`, `firmar`, `validar`, `anular` — producen errores `42703` en producción. La UI de detalle (`[id]/page.tsx`) implementa correctamente el `PinConfirmModal`, pero el procedure `firmar` que lo consume no puede ejecutarse.

### 6.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — lista | `apps/web/src/app/(clinical)/ece/atencion-emergencia/page.tsx` |
| UI — nueva | `apps/web/src/app/(clinical)/ece/atencion-emergencia/nueva/page.tsx` |
| UI — detalle | `apps/web/src/app/(clinical)/ece/atencion-emergencia/[id]/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/atencion-emergencia.router.ts` |
| Schema DB (via MCP) | `ece.atencion_emergencia` (12 columnas confirmadas — completamente distintas) |
| Tests | `packages/trpc/src/routers/ece/__tests__/atencion-emergencia.router.test.ts` |

### 6.3 Matriz de trazabilidad — Atención Emergencia

| # | Campo UI / router | Columna Router SQL | Columna DB Real | Alineado | Observación |
|---|---|---|---|---|---|
| 1 | `episodioId` | `episodio_id` | `episodio_id` | OK | Columna existe |
| 2 | `motivoConsulta` | `motivo_consulta` | `motivo_consulta` | OK | Columna existe (nullable) |
| 3 | `exploracion` | `exploracion` | **AUSENTE** | **NO** | BD tiene `examen_fisico` |
| 4 | `diagnostico` | `diagnostico` | **AUSENTE** | **NO** | BD tiene `diagnosticos` JSONB |
| 5 | `planTerapeutico` | `plan_terapeutico` | **AUSENTE** | **NO** | BD tiene `manejo_realizado` JSONB |
| 6 | `medico_turno_id` | `medico_turno_id` | **AUSENTE** | **NO** | BD tiene `registrado_por` |
| 7 | `estado_workflow` | `estado_workflow` | **AUSENTE** | **NO** | BD tiene `estado_registro` |
| 8 | `firma_mt_id` | `firma_mt_id` (UPDATE) | **AUSENTE** | **NO** | BD no tiene columna de firma |
| 9 | `firmado_en` | `firmado_en` | **AUSENTE** | **NO** | No existe en BD |
| 10 | `validado_en` | `validado_en` | **AUSENTE** | **NO** | No existe en BD |
| 11 | `anulado_en` | `anulado_en` | **AUSENTE** | **NO** | No existe en BD |
| 12 | `motivo_anulacion` | `motivo_anulacion` | **AUSENTE** | **NO** | No existe en BD |
| 13 | `instancia_id` | — | `instancia_id` (NOT NULL) | NO | Router no gestiona instancia de workflow |
| 14 | `circunstancia_llegada` | — | `circunstancia_llegada` | NO | Campo NTEC no modelado en UI/router |
| 15 | `disposicion` | — | `disposicion` | NO | Campo NTEC no modelado en UI/router |
| 16 | `diagnosticos` JSONB | — | `diagnosticos` | NO | BD tiene array JSONB, router envía texto |
| 17 | `manejo_realizado` JSONB | — | `manejo_realizado` | NO | BD tiene array JSONB, router envía texto |

### 6.4 Hallazgos

---

#### HF-27 — P0-BLOQUEANTE — Schema drift total: todas las writes de atencion-emergencia fallan en producción

**Categoría:** C7 (Schema drift masivo), C1, C2  
**Archivos:** `packages/trpc/src/routers/ece/atencion-emergencia.router.ts` (todo el archivo); `apps/web/src/app/(clinical)/ece/atencion-emergencia/nueva/page.tsx`  
**Evidencia (MCP):** La tabla `ece.atencion_emergencia` en Supabase tiene exactamente 12 columnas. El router asume al menos 17 columnas diferentes:
- `medico_turno_id` → no existe (BD tiene `registrado_por`)
- `exploracion` → no existe (BD tiene `examen_fisico`)
- `diagnostico` (texto) → no existe (BD tiene `diagnosticos` JSONB)
- `plan_terapeutico` (texto) → no existe (BD tiene `manejo_realizado` JSONB)
- `estado_workflow` → no existe (BD tiene `estado_registro`)
- `firma_mt_id`, `firmado_en`, `validado_en`, `anulado_en`, `motivo_anulacion` → ninguna existe

Todo `INSERT`, `UPDATE` y `SELECT ae.*` retornará error `42703`.  
**Impacto:** El módulo de atención de emergencia es completamente no funcional. NTEC Art. 22 (registro de atención urgente) no puede cumplirse.  
**Corrección (opción A):** Alinear el router con el schema DB real: renombrar columnas, cambiar `diagnostico` text → `diagnosticos` JSONB array, `exploracion` → `examen_fisico`, etc. Requiere rediseño del router y la UI.  
**Corrección (opción B):** Migrar la BD para añadir las columnas que el router espera. Requiere migración SQL.  
**Recomendación:** Opción A (adaptar router a BD) respeta la estructura NTEC ya aplicada en BD.

---

#### HF-28 — P0-BLOQUEANTE — instancia_id NOT NULL en BD pero router no gestiona documento_instancia para ATN_EMERG

**Categoría:** C7, C1  
**Evidencia (MCP):** `instancia_id` es `NOT NULL` en `ece.atencion_emergencia`. El router `atencionEmergenciaRouter.create` no crea ningún registro en `ece.documento_instancia` — el INSERT omite `instancia_id`. Esto hará fallar el INSERT con `null value in column "instancia_id" violates not-null constraint`.  
**Impacto:** Incluso si se corrigen los nombres de columnas (HF-27), el INSERT seguiría fallando por la restricción NOT NULL.  
**Corrección:** Añadir al procedure `create` los pasos de resolución de `tipo_documento` + `flujo_estado` inicial + inserción en `documento_instancia` (patrón ya implementado en `atencion-rn.router.ts` pasos 2-7).

---

#### HF-29 — P1-ALTO — firmar en atencion-emergencia recibe firmaId pero no lo verifica contra ece.firma_electronica

**Categoría:** C6 (Firma electrónica)  
**Archivo:** `packages/trpc/src/routers/ece/atencion-emergencia.router.ts` líneas 336-383  
**Evidencia:** El schema `eceAtencionEmergenciaFirmarSchema` incluye `firmaId: z.string().uuid()`. El procedure simplemente lo usa en el UPDATE `firma_mt_id = ${input.firmaId}::uuid` sin verificar que ese `firmaId` corresponde a una firma activa del usuario actual en `ece.firma_electronica`. Cualquier UUID válido es aceptado.  
**Contraste:** `atencion-rn.router.ts` verifica `verifyPin()` que lookup a `ece.firma_electronica` y valida argon2id + lockout.  
**Impacto:** La "firma electrónica" de la atención de emergencia puede ser falsificada con cualquier UUID.  
**Corrección:** Añadir verificación contra `ece.firma_electronica` (lookup + argon2id) igual que en `atencion-rn.router.ts`.

---

#### HF-30 — P1-ALTO — CIE-10 en diagnostico es campo de texto libre sin validación

**Categoría:** C5 (CIE-10 obligatorio)  
**Archivo:** `apps/web/src/app/(clinical)/ece/atencion-emergencia/nueva/page.tsx` líneas 151-165  
**Evidencia:** El campo `diagnostico` es un `<textarea>` con placeholder "Síndrome coronario agudo sin elevación del ST. I20.0". No hay selector de CIE-10, no hay validación del código, no hay lookup a tabla `cie10`. El comentario del placeholder sugiere que el médico debe escribir el código manualmente.  
**Impacto:** NTEC Art. 17 requiere código CIE-10 estructurado para el diagnóstico de emergencias. Un campo libre no cumple el requisito.  
**Corrección:** Implementar selector de CIE-10 (patrón ya existente en otros módulos ECE) y almacenar en el campo `diagnosticos` JSONB de la BD.

---

#### HF-31 — P2-MEDIO — Tests de atencion-emergencia validan schema incorrecto (contra DB drift)

**Categoría:** C11  
**Archivo:** `packages/trpc/src/routers/ece/__tests__/atencion-emergencia.router.test.ts`  
**Evidencia:** Los tests prueban el schema `create` con `episodioId`, `motivoConsulta`, `exploracion`, `diagnostico`, `planTerapeutico` — exactamente los campos del router, no los de la BD. Los tests pasarán en CI (mocks) pero no detectan el drift de producción.  
**Impacto:** Cobertura false-positive — green tests, módulo roto en producción.  
**Corrección:** Una vez resuelto HF-27, actualizar los tests para reflejar el schema correcto.

---

#### HF-32 — P2-MEDIO — validar en atencion-emergencia actualiza estado_workflow sin emitir evento de dominio

**Categoría:** C9 (Eventos de dominio)  
**Archivo:** `packages/trpc/src/routers/ece/atencion-emergencia.router.ts` líneas 388-417  
**Evidencia:** El procedure `validar` hace UPDATE a `estado_workflow = 'validado'` y `validado_en = now()`, pero no llama a `emitDomainEvent`. Solo `firmar` emite evento. La validación clínica no queda registrada en el outbox.  
**Corrección:** Añadir `emitDomainEvent` en `validar` con tipo `ece.atencion_emergencia.validada`.

---

#### HF-33 — P3-BAJO — anular permite DIR/ADMIN anular estado en_revision sin registrar la firma

**Categoría:** C4 (Inmutabilidad post-firma)  
**Archivo:** `packages/trpc/src/routers/ece/atencion-emergencia.router.ts` líneas 424-453  
**Evidencia:** El procedure `anular` permite anular desde cualquier estado excepto `validado` y `anulado`. Esto incluye `firmado`, lo que significa que un documento firmado puede ser anulado sin dejar huella de la firma previa en el outbox. La anulación no emite evento de dominio.  
**Corrección:** Emitir `ece.atencion_emergencia.anulada` en `anular`. Considerar si `firmado` debería requerir doble confirmación para anular.

**Estado Módulo 6:** P0×2, P1×2, P2×2, P3×1 — Total 7 hallazgos

---

## Resumen Consolidado Stream F {#resumen-consolidado}

### Conteo de hallazgos por módulo y severidad

| Módulo | P0 | P1 | P2 | P3 | Total |
|--------|----|----|----|----|-------|
| M1 — Obstetricia Dashboard | 1 | 2 | 0 | 1 | 4 |
| M2 — Partograma OMS | 0 | 2 | 2 | 1 | 5 |
| M3 — Sala de Expulsión | 2 | 2 | 2 | 1 | 7 |
| M4 — Atención RN | 0 | 2 | 2 | 1 | 5 |
| M5 — Reanimación Neonatal | 2 | 1 | 1 | 1 | 5 |
| M6 — Atención Emergencia | 2 | 2 | 2 | 1 | 7 |
| **TOTAL** | **7** | **11** | **9** | **6** | **33** |

### Hallazgos P0 (7 bloqueantes)

| Hallazgo | Módulo | Título abreviado |
|----------|--------|------------------|
| HF-01 | Dashboard | Dashboard 100% mock — sin tRPC |
| HF-10 | Expulsión | Columna `eventos` JSONB ausente en `sala_expulsion` |
| HF-11 | Expulsión | Firma sin PIN electrónico (violación NTEC Art. 39) |
| HF-22 | NRP | Enum `ece.resultado_reanimacion` no existe |
| HF-23 | NRP | RLS aplica a rol `{public}` — acceso sin autenticación |
| HF-27 | Emergencia | Schema drift total — todas las writes fallan |
| HF-28 | Emergencia | `instancia_id` NOT NULL no gestionado en create |

### Hallazgos P1 (11 altos)

HF-02, HF-03, HF-05, HF-06, HF-12, HF-13, HF-14, HF-17, HF-18, HF-24, HF-29, HF-30

### Categorías con más hallazgos

| Categoría | Count |
|-----------|-------|
| C7 Schema drift | 10 |
| C3 RLS / tenant isolation | 5 |
| C1 Trazabilidad UI→DB | 5 |
| C6 Firma electrónica | 3 |
| C11 Tests / cobertura | 4 |
| C9 Eventos de dominio | 2 |
| C4 Inmutabilidad post-firma | 2 |
| C5 CIE-10 | 1 |
| C10 Errores / transacciones | 1 |

### ADRs derivados

**ADR-F-01 — Migración obligatoria previa al go-live Obstetricia**  
Contexto: `sala_expulsion` carece de columna `eventos` JSONB. `ece.resultado_reanimacion` enum no existe. `atencion_emergencia` tiene schema divergente.  
Decisión: Bloquear go-live del módulo obstetricia hasta aplicar: (a) `ALTER TABLE ece.sala_expulsion ADD COLUMN eventos jsonb NOT NULL DEFAULT '[]'`; (b) `CREATE TYPE ece.resultado_reanimacion`; (c) migración de `atencion_emergencia` alineando router con BD o viceversa.  
Consecuencias: Sprint de remediación estimado 3-5 días para desarrollador sénior con revisión @DBA.

**ADR-F-02 — Unificar patrón de firma electrónica en todos los routers obstétricos**  
Contexto: `atencion-rn.router.ts` implementa `verifyPin()` correcto. `sala-expulsion.router.ts` omite PIN. `atencion-emergencia.router.ts` acepta `firmaId` sin verificar.  
Decisión: Extraer `verifyPin()` a `packages/trpc/src/workflow/verify-pin.ts` y reutilizar en todos los routers ECE que requieran firma NTEC Art. 39.  
Consecuencias: +2 días de refactoring. Elimina duplicación y garantiza uniformidad de seguridad.

**ADR-F-03 — Homologar withWorkflowContext en routers sin demote de rol**  
Contexto: `partograma.router.ts`, `periodo-expulsivo.router.ts` y `reanimacion-neonatal.router.ts` no envuelven queries en `withWorkflowContext` → BYPASSRLS activo → RLS no aplica.  
Decisión: Todos los routers ECE de escritura deben usar `withWorkflowContext`. Crear lint rule o checklist de PR para verificación.  
Consecuencias: Requiere refactoring de 3 routers + tests de integración.

### Comparación con Streams anteriores

| Stream | Módulos | Hallazgos | P0 |
|--------|---------|-----------|-----|
| A — Paciente/Admisión/Triage | 4 | 22 | 6 |
| B — Clínico activo | 5 | 31 | 8 |
| C — Cierre/Cumplimiento | 5 | 28 | 7 |
| D — Hospitalización | 9 | 48 | 10 |
| **F — Obstetricia+Neonatal** | **6** | **33** | **7** |

Stream F tiene la mayor densidad de hallazgos P0 por módulo (1.17 P0/módulo vs 1.11 en D). El patrón dominante es schema drift masivo — 3 de 7 P0 son divergencias tabla-router. Esto indica que las migraciones SQL de la Fase 2 Sprint 1 se aplicaron con nombres de columnas que después fueron refactorizados en los routers sin sincronización con la BD.
