# ADR 0021 — Fuente de verdad del proceso quirúrgico (R05, riesgo Alto — assessment Code Castle)

- **Estado:** Propuesto — requiere sign-off de @Orq + @DBA + @Dev + Edwin antes de ejecutar el plan de
  migración (implica retirar código/UI y tocar 2 routers consumidores fuera del dominio quirúrgico)
- **Fecha:** 2026-08-22
- **Decisores:** @AS (proponente, este documento), pendiente @DBA (schema/billing), @Dev (implementación),
  @QAF (regresión E2E), @Orq (resolución final)
- **Fase:** Evaluación de arquitectura — respuesta al hallazgo R05 del assessment externo de Code Castle
  ("modelos quirúrgicos paralelos")
- **Dependencias:**
  - ADR 0011 — Motor de workflow ECE data-driven (por qué el motor genérico, no bespoke, gobierna los
    31 tipos de documento NTEC — este ADR aplica ese principio al dominio quirúrgico)
  - ADR 0012 — Estrategia RLS ECE (`withWorkflowContext`)
  - ADR 0016 — Auditoría módulos legacy vs ECE (precedente metodológico directo de este documento)
  - `docs/flujos/PROG_QX.md`, `docs/flujos/ACT_QX.md`, `docs/flujos/PREOP.md`, `docs/flujos/URPA.md`,
    `docs/flujos/CONS_QX.md`, `docs/31_flujos_operativos_consolidado.md` — fichas NTEC de la ruta
    quirúrgica (producidas 2026-05-22, ya diagnosticaron esta misma duplicación sin que se resolviera)
  - `docs/audit/2026-05-19_audit_stream_e_quirofano.md` + `docs/audit/2026-05-24_re-audit_stream_e.md`
    (hallazgos HE-01..HE-18, estado de cierre)
  - CLAUDE.md §"Adecuar legacy vs duplicar" — regla que este ADR aplica formalmente
  - `packages/trpc/src/routers/surgery.router.ts`, `packages/trpc/src/routers/ece/bridge-cirugia.router.ts`,
    `.../ece/acto-quirurgico.router.ts`, `.../ece/who-checklist.router.ts`,
    `.../ece/registro-anestesico.router.ts`, `.../ece/urpa-recovery.router.ts`
  - `packages/trpc/src/routers/personal-salud.router.ts`, `packages/trpc/src/routers/workflow-inbox.router.ts`
    (únicos consumidores externos reales de `SurgeryCase` fuera del propio router de cirugía)

---

## Contexto

El assessment externo de Code Castle marcó como riesgo Alto (R05) que el proceso quirúrgico de HIS
tiene **dos representaciones registradas simultáneamente** en `packages/trpc/src/routers/_app.ts`,
sin fuente de verdad declarada:

1. **`surgery` → `surgeryRouter`** (`packages/trpc/src/routers/surgery.router.ts`), sobre el modelo
   Prisma `public.SurgeryCase` / `public.OperatingRoom`. State machine
   `SCHEDULED → IN_PROGRESS → POST_OP → COMPLETED` con gates del WHO Surgical Safety Checklist
   (`signInAt`/`timeOutAt`/`signOutAt` bloquean `start`/`postOp`), detección de conflictos de sala
   (`detectOrConflict`, overlap por rango de tiempo) y vínculo a centro de costo (`costCenterId`).
2. **El conjunto ECE**: `eceBridgeCirugia` (`programarCirugia`/`cancelarPrograma`, transaccional sobre
   `ece.orden_ingreso` + `ece.episodio_atencion` + `ece.episodio_hospitalario` + `ece.preop_checklist`
   + `ece.reserva_sala_qx`), `eceCirugiaPreop`, `eceWhoChecklist`, `eceRegistroAnestesico`, `eceUrpa`
   (`urpa-recovery.router.ts`) y `eceActoQuirurgico` — seis routers sobre seis tablas `ece.*`
   (`preop_checklist`, `who_checklist`, `acto_quirurgico`, `registro_anestesico`, `urpa_recovery`,
   más `reserva_sala_qx`/`sala_qx` del bridge).

Este ADR verifica contra código y base de producción real (no se asume nada de memoria) qué vive en
cada representación hoy, qué exige la norma, y responde con una recomendación accionable.

### 1. Qué hay hoy en producción — verificado por SELECT de solo lectura (2026-08-22)

Conteo de filas contra el proyecto Supabase real (`ejacvsgbewcerxtjtwto`, vía `psql` con `DIRECT_URL`
de `.env.local` de la raíz — la de `apps/web/.env.local` ya no es válida, confirmado en sesión):

| Tabla | Modelo | Filas en prod |
|---|---|---|
| `public."SurgeryCase"` | HIS legacy | **0** |
| `public."OperatingRoom"` | HIS legacy | **0** |
| `ece.sala_qx` | ECE | **0** |
| `ece.reserva_sala_qx` | ECE | **0** |
| `ece.preop_checklist` | ECE | **0** |
| `ece.who_checklist` | ECE | **0** |
| `ece.acto_quirurgico` | ECE | **0** |
| `ece.registro_anestesico` | ECE | **0** |
| `ece.urpa_recovery` | ECE | **0** |
| `ece.orden_ingreso` (`motivo_ingreso_tipo='cirugia'`) | ECE | **0** |

**Hallazgo que cambia el marco del problema:** ninguna de las dos representaciones tiene datos
reales en producción. Esto **no es una migración de datos en vivo** — es una decisión de arquitectura
sobre código y rutas antes de que el módulo quirúrgico entre en operación real. El costo/riesgo de
cualquiera de las tres opciones de abajo es exclusivamente de ingeniería (routers, UI, consumidores),
no de reconciliación de historial clínico. Esto simplifica la decisión frente a, por ejemplo, ADR 0019
(GS1 paciente), donde sí había datos vivos en juego.

### 2. Qué expone la UI de cada representación

Búsqueda en `apps/web/src/app` por consumo de `trpc.surgery.*` vs. los routers ECE:

**`/surgery` (HIS legacy — `trpc.surgery.*`):**
- `apps/web/src/app/(clinical)/surgery/page.tsx` — listado de casos
- `apps/web/src/app/(clinical)/surgery/new/page.tsx` — alta de caso
- `apps/web/src/app/(clinical)/surgery/[caseId]/page.tsx` — detalle + transiciones WHO

**ECE — Quirófano (`trpc.ece*`):**
- `apps/web/src/app/(clinical)/ece/quirofano/page.tsx` — dashboard
- `.../ece/quirofano/programacion/page.tsx` + `programacion/nueva/page.tsx` (`eceBridgeCirugia`)
- `.../ece/quirofano/preop/page.tsx` + `preop/nueva/page.tsx` + `preop/[id]/page.tsx` (`eceCirugiaPreop`)
- `.../ece/quirofano/who-check/page.tsx` (`eceWhoChecklist`)
- `.../ece/quirofano/acto-quirurgico/page.tsx` + `acto-quirurgico/nueva/page.tsx` + `acto-quirurgico/[id]/page.tsx` (`eceActoQuirurgico`)
- `.../ece/quirofano/consentimiento-qx/page.tsx` + `consentimiento-qx/nuevo/page.tsx` (consentimiento, no auditado en este ADR)
- `.../ece/registro-anestesico/page.tsx` + `nuevo/page.tsx` + `[id]/page.tsx` (`eceRegistroAnestesico`)
- `.../ece/urpa/page.tsx` + `urpa/nuevo/page.tsx` (`eceUrpa`)

**Conclusión de cobertura:** el lado ECE tiene **12 páginas** contra **3** del lado legacy. El legacy
cubre solo "listar/crear/gestionar un caso"; ECE cubre las 6 piezas documentales separadas que exige
la norma (programación, preop, WHO, acto, anestesia, URPA), cada una con su propio wizard.

**Hallazgo de duplicación visible al usuario, hoy, en producción:** `apps/web/src/components/nav-sections.ts`
(sección `"ECE — Quirófano"`, línea ~184) lista **ambas** rutas como ítems de sidebar separados:

```
{ href: "/ece/quirofano", label: "Dashboard Quirófano", ... }
{ href: "/surgery",       label: "Quirófano", ... }          // ← ítem duplicado
{ href: "/ece/quirofano/preop", label: "Preoperatorio", ... }
...
```

Esto viola directamente la regla del propio CLAUDE.md ("Sidebar: un solo item por dominio") — no es
un riesgo teórico, es un defecto ya mergeado y visible a cualquier usuario con acceso a Quirófano.

### 3. Qué exige la norma (NTEC, Acuerdo n.° 1616 MINSAL)

`docs/31_flujos_operativos_consolidado.md` (categoría `QUIRURGICO`) y las fichas individuales en
`docs/flujos/` establecen que el proceso quirúrgico NTEC **no es un documento — son siete**, cada uno
con su propio artículo NTEC, sus propios firmantes y su propio ciclo de vida:

`PROG_QX → CONS_QX → PREOP → WHO_CHECK → ACT_QX → REG_ANEST → URPA`

Puntos normativos que ninguna de las dos representaciones satisface por completo hoy, pero que **solo
el motor ECE puede satisfacer sin reconstruir infraestructura desde cero**:

- **Art. 40 (inmutabilidad post-firma)** — `ACT_QX` (`ece.acto_quirurgico`) tiene un trigger condicional
  real (`ece.fn_bloquea_mutacion_acto_qx`, `packages/database/sql/99_acto_quirurgico_trigger_condicional.sql`,
  cerrado como HE-06 en el re-audit) que bloquea `UPDATE`/`DELETE` solo cuando el documento está
  `firmado|validado|anulado`. `public.SurgeryCase` **no tiene ningún mecanismo de inmutabilidad** —
  cualquier fila es mutable con un `UPDATE` de Prisma en cualquier momento, protegida solo por el
  `AuditLog` genérico (registra el cambio, no lo previene).
- **Art. 23 lit. a.4 (firma electrónica simple, PIN argon2id)** — cada documento ECE se firma contra
  `ece.firma_electronica` con lockout de 5 intentos, y la firma queda en
  `documento_instancia_historial.firma_id`. `SurgeryCase` no tiene ningún concepto de firma — sus
  campos `signInAt/signInById` son timestamps + FK de usuario, no una firma criptográfica verificada.
- **Cadena de dependencias entre documentos** (`ece.fn_assert_dependencias_firmadas`, helper TS
  `assertDependenciasFirmadas`) — el motor bloquea la creación de `ACT_QX` si `CONS_QX`/`PREOP` no
  están firmados. `SurgeryCase.start()` solo verifica sus propios campos internos
  (`signInAt`/`timeOutAt`), no la existencia de un consentimiento informado firmado ni de una
  valoración preoperatoria — el gate WHO de `surgery.router.ts` es más estricto en su propio dominio
  pero ciego a los documentos hermanos.
- **Bitácora inmutable ≥ 10 años por documento** (`documento_instancia_historial`, append-only por
  trigger) — existe para el lado ECE por diseño del motor (ADR 0011); no existe un equivalente para
  `SurgeryCase` más allá del `AuditLog` genérico de la tabla.

Contrapartida real (lo que ECE **no** tiene y `SurgeryCase` sí): `ece.reserva_sala_qx` y
`ece.acto_quirurgico` **no tienen columna de centro de costo** (`costCenterId`) — verificado contra
`information_schema.columns` en producción. `SurgeryCase.costCenterId` es el único vínculo existente
hoy entre un caso quirúrgico y la cuenta hospitalaria / dashboard financiero (CLAUDE.md documenta 41
centros de costo NTEC + `Invoice`/`Item` en el módulo de finanzas). Esta es una brecha real del lado
ECE, no una ventaja cosmética del legacy.

`docs/flujos/PROG_QX.md` documenta además que `PROG_QX` **no está sembrado como `tipo_documento`** —
la programación opera solo como bridge atómico (`eceBridgeCirugia`), sin workflow propio,
sin firma electrónica obligatoria y sin bitácora `documento_instancia_historial`. Es la única pieza de
la cadena de 7 documentos que hoy no está al nivel de madurez del resto.

### 4. Diff funcional real (aplicando CLAUDE.md §"Adecuar legacy vs duplicar")

La regla exige extender el legacy cuando una norma introduce algo que ya existe parcial en él — pero
también exige diff funcional real antes de declarar duplicación, porque "palabras compartidas no
implican duplicación" (precedente: `/consents` vs `/ece/consentimiento` coexisten porque son dominios
distintos con operador/propósito/lifecycle distintos).

Este caso **no** es el de `/consents` vs `/ece/consentimiento`. Aquí:
- **Mismo operador**: cirujano + coordinador de quirófano + anestesiólogo + enfermería circulante.
- **Mismo evento físico**: una única cirugía, un único paciente, una única sala, un único intervalo de
  tiempo.
- **Mismo propósito operativo de base**: programar sala/equipo, verificar seguridad OMS, registrar qué
  pasó.
- **Las dos fichas NTEC que auditaron esto en 2026-05-22 (`PROG_QX.md` §"Duplicación con módulo legacy
  `/surgery`", `ACT_QX.md` §"drift #2") ya llegaron a la misma conclusión**: hay diff de granularidad
  (documento único vs. siete documentos con firma independiente) pero **no** diff de dominio — es el
  mismo caso quirúrgico modelado dos veces a dos niveles de detalle, sin sincronización entre ambos
  niveles hoy (`bridge-cirugia.router.ts` no escribe en `SurgeryCase`, y `surgery.router.ts` no escribe
  en `ece.*`).

Veredicto: **aplica la regla de extender/consolidar, no la excepción de coexistencia.** Las dos fichas
NTEC ya recomendaron esto explícitamente en mayo y no se ejecutó — es exactamente la brecha que motivó
el hallazgo R05 de Code Castle tres meses después.

---

## Opciones consideradas

### Opción A — Consolidar en HIS (extender `SurgeryCase` a nivel NTEC)

Construir sobre `public.SurgeryCase` los 7 sub-documentos (columnas o tablas satélite), firma
electrónica PIN argon2id propia, trigger de inmutabilidad Art. 40 propio, bitácora de cambios propia y
verificación de dependencias entre documentos propia.

**Costo:** Alto. Reimplementa desde cero, de forma bespoke para un solo dominio, exactamente lo que
ADR 0011 ya generalizó para los 31 tipos de documento NTEC (`documento_instancia`, `flujo_estado`,
`flujo_transicion`, `firma_electronica`, `documento_instancia_historial`,
`fn_assert_dependencias_firmadas`). Duplica infraestructura, no solo UI.

**Riesgo:** Alto. Introduce una segunda implementación de firma electrónica / inmutabilidad / bitácora
que debe auditarse de forma independiente (Beta.21/22 ya cerraron pentest + JCI sobre el motor
genérico; un motor bespoke nuevo empieza de cero en madurez de seguridad). Contradice el patrón
arquitectónico ya establecido y aceptado del proyecto.

**Qué se rompe:** nada en producción (0 filas), pero descarta ~12 páginas UI y 6 routers ECE ya
construidos y funcionalmente más completos que el legacy.

**No recomendada.**

### Opción B — Consolidar en ECE (ECE como fuente única; retirar `SurgeryCase`/`surgery.router.ts`/`/surgery`)

`ece.*` pasa a ser la única fuente de verdad del proceso quirúrgico. Se retira el router `surgery`,
las 3 páginas `/surgery/*` y, tras portar sus 2 consumidores reales, los modelos Prisma
`SurgeryCase`/`OperatingRoom`.

**Costo:** Medio. Trabajo identificado y acotado:
1. Cerrar la brecha de facturación: agregar `costCenterId` (o campo equivalente) a
   `ece.reserva_sala_qx` y/o `ece.acto_quirurgico` — hoy inexistente en ambas.
2. Portar los **2 consumidores reales** de `SurgeryCase` fuera del propio dominio quirúrgico
   (verificado por grep, no asumido — son los únicos con lógica real, aparte de referencias de
   comentario):
   - `packages/trpc/src/routers/personal-salud.router.ts` (líneas ~509, 718, 754, 789) — construye la
     agenda unificada de un profesional (`inpatient` + `surgery` + `outpatient`) vía `UNION ALL` sobre
     `SurgeryCase.scheduledStart`/`primarySurgeonId`. Debe repuntar a
     `ece.reserva_sala_qx.fecha_inicio`/`cirujano_id`.
   - `packages/trpc/src/routers/workflow-inbox.router.ts` (líneas ~462, 561, 584, 620) — alerta
     `WHO_CHECKLIST_INCOMPLETE` (cirugía `IN_PROGRESS` sin `signIn`/`timeOut`/`signOut`). Debe repuntar
     a `ece.who_checklist` (estado `pendiente`/incompleto) unido a `ece.acto_quirurgico`.
3. Promover `PROG_QX` a `tipo_documento` de pleno derecho (ya recomendado por `PROG_QX.md` mismo, opción
   1 de su propia sección de decisión pendiente) — cierra la única pieza de la cadena de 7 documentos
   que hoy no tiene firma/workflow propio.
4. Cerrar los pendientes del re-audit que tocan el mismo código (`HE-15`: `who-checklist.router.ts` sin
   `withWorkflowContext`; `HE-17`: `responsableId` hardcodeado en `/who-check/page.tsx`; `HE-18`: policy
   RLS `INSERT` sin `WITH CHECK`) — mismo PR, mismo área de código, evita reabrir el módulo dos veces.
5. Retirar `surgeryRouter` de `_app.ts`, las 3 páginas `/surgery/*`, y el ítem de sidebar duplicado.
6. Con 0 filas en prod, los modelos Prisma `SurgeryCase`/`OperatingRoom` pueden eliminarse de
   `schema.prisma` sin migración de datos — dejarlos solo si algún reporte BI ya los referencia (no
   encontrado en esta verificación, pero @BID/@DA deben confirmarlo antes de un `DROP TABLE`).

**Riesgo:** Medio-bajo. Cero filas que perder. El riesgo real es de regresión funcional en los 2
consumidores portados (agenda del profesional, inbox de tareas) — mitigable con tests E2E dirigidos
antes de retirar `SurgeryCase`.

**Qué se rompe:** cualquier código no descubierto en esta auditoría que dependa de `SurgeryCase` — el
grep cubrió `packages/` completo, pero @Dev debe repetirlo contra `apps/web/src` antes de ejecutar
(esta auditoría se concentró en routers/UI de nivel de página, no en cada componente).

**Recomendada como opción principal — ver razonamiento abajo.**

### Opción C — Bridge explícito con fuente única declarada por sub-dominio (ECE fuente legal, `SurgeryCase` modelo derivado sincronizado)

`ece.*` sigue siendo la fuente legal (firma, inmutabilidad, bitácora). `eceBridgeCirugia.programarCirugia`
se extiende para además crear/actualizar una fila espejo en `SurgeryCase` (mismo patrón que
`bridge-admision.router.ts` usa para sincronizar HIS↔ECE en admisión). `SurgeryCase` queda como
**modelo de lectura operativo/financiero** (agenda, facturación, dashboards), nunca como destino de
escritura clínica directa; se retira `surgery.router.ts` de mutaciones (`signIn`/`timeOut`/etc.) pero
se conserva para lectura y para el vínculo de centro de costo.

**Costo:** Medio-alto. Es el mayor esfuerzo de los tres tras la Opción A: mantiene dos tablas
sincronizadas de por vida, con la clase de complejidad de doble escritura que ADR 0014
(atomicidad del bridge de admisión) ya documentó como fuente de deuda operativa. No hay datos hoy que
justifiquen preservar `SurgeryCase` como modelo de lectura independiente — los 2 consumidores reales
(Opción B, punto 2) se pueden repuntar directamente a `ece.*` con el mismo esfuerzo que mantener un
bridge de sincronización a perpetuidad.

**Riesgo:** Medio. Bridge de sincronización = superficie nueva de bugs de drift (exactamente el patrón
que ya generó incidentes documentados en el proyecto — JSONB vs. tabla satélite en `ACT_QX.md` drift
#4, o el propio HE-02 de `bridge-cirugia.router.ts` antes de su fix).

**Qué se rompe:** nada de forma directa, pero perpetúa la ambigüedad de "¿cuál es la fuente de verdad
hoy?" que es precisamente el hallazgo R05 — un bridge no resuelve "fuente de verdad no declarada", solo
la pospone detrás de una sincronización.

**No recomendada, salvo que @DBA/@PO identifiquen un consumidor de `SurgeryCase` no cubierto por esta
auditoría cuyo costo de migración a `ece.*` sea desproporcionadamente alto** — en ese caso C es el
plan de contingencia, no la opción primaria.

---

## Recomendación

**Opción B — Consolidar en ECE.** `ece.*` (más específicamente `ece.reserva_sala_qx` para
programación/sala, `ece.preop_checklist`, `ece.who_checklist`, `ece.acto_quirurgico`,
`ece.registro_anestesico`, `ece.urpa_recovery` para cada documento NTEC) pasa a ser la única fuente de
verdad del proceso quirúrgico. `public.SurgeryCase`/`OperatingRoom`/`surgeryRouter`/`/surgery` se
retiran.

**Por qué no A:** duplicaría, solo para cirugía, la infraestructura de workflow/firma/inmutabilidad
que ADR 0011 ya generalizó para 31 tipos de documento — es la definición de sobre-ingeniería que el
propio proyecto ya rechazó en otras decisiones (ver ADR 0019 D4, rechazo de over-engineering por
paralelismo con ADR 0017).

**Por qué no C:** con 0 filas en producción no hay ningún consumidor cuyo costo de migración directa a
`ece.*` supere el costo de mantener un bridge de sincronización a perpetuidad. C solo se justifica
cuando hay datos vivos o consumidores externos (otro sistema, un contrato de integración) que no se
pueden repuntar — no es el caso aquí (verificado: 2 routers internos, no consumidores externos).

**Por qué B es seguro ahora y no lo era en mayo:** las fichas NTEC de `docs/flujos/` ya recomendaban
esto en 2026-05-22 pero no se ejecutó, probablemente porque en ese momento `ece.sala_qx`/
`ece.reserva_sala_qx` ni siquiera existían en producción (HE-01, cerrado después por PR #181). Hoy esas
tablas existen, el motor de dependencias/firma está maduro (ADR 0011/0012/0013 cerrados), y la
verificación de esta auditoría confirma 0 filas en ambos lados — la ventana para consolidar sin costo
de migración de datos sigue abierta pero se cierra en cuanto el módulo entre en operación real.

### Plan de migración

1. **@DBA** — agregar `costCenterId` (nullable, FK a `CostCenter`) a `ece.reserva_sala_qx` (o a
   `ece.acto_quirurgico` si el cargo real se ata al acto y no a la reserva — decisión de @DBA/@PO
   sobre dónde vive el vínculo de facturación). Sin esto, Opción B deja un vacío funcional real
   respecto al legacy.
2. **@AS/@Dev** — promover `PROG_QX` a `tipo_documento` de pleno derecho: sembrar en `ece.tipo_documento`
   + `ece.flujo_estado` + `ece.flujo_transicion` (estados `SOLICITADA/ASIGNADA/CONFIRMADA/REPROGRAMADA/
   EJECUTADA/CANCELADA/ANULADA` ya modelados en `PROG_QX.md`), sembrar rol `COORD_QX`, y migrar
   `bridge-cirugia.router.ts` para crear `documento_instancia` de `PROG_QX` en vez de solo
   `orden_ingreso`+`reserva_sala_qx` sueltos.
3. **@Dev** — portar los 2 consumidores reales de `SurgeryCase`:
   - `personal-salud.router.ts` (agenda unificada del profesional) → `ece.reserva_sala_qx`.
   - `workflow-inbox.router.ts` (alerta `WHO_CHECKLIST_INCOMPLETE`) → `ece.who_checklist` +
     `ece.acto_quirurgico`.
   Repetir el grep de `SurgeryCase`/`surgeryCase` contra `apps/web/src` completo antes de continuar
   (esta auditoría verificó `packages/` completo pero no cada componente de `apps/web`).
4. **@Dev** — cerrar HE-15/HE-17/HE-18 del re-audit Stream E en el mismo PR (mismo código, mismo
   módulo — evita una segunda vuelta).
5. **@Dev** — retirar `surgeryRouter` de `packages/trpc/src/routers/_app.ts`, eliminar
   `apps/web/src/app/(clinical)/surgery/**`, quitar el ítem `{ href: "/surgery", ... }` de
   `nav-sections.ts`.
6. **@DBA** — tras confirmar con @BID/@DA que ningún reporte BI referencia `SurgeryCase`/`OperatingRoom`,
   eliminar los modelos de `schema.prisma` (0 filas — sin migración de datos que preservar).
7. **@QAF/@QA** — regresión E2E dirigida sobre: agenda del profesional (`personal-salud`), inbox de
   tareas (`workflow-inbox`), y el flujo completo `PROG_QX → ... → ACT_QX → URPA` antes de cerrar el
   gate.

### Qué se retira

`packages/trpc/src/routers/surgery.router.ts`, su entrada en `_app.ts`, `apps/web/src/app/(clinical)/surgery/**`
(3 páginas), el ítem de sidebar `/surgery`, y — tras el paso 6 — los modelos Prisma `SurgeryCase` y
`OperatingRoom`.

---

## Riesgos y fuera de alcance

- **Consumidores no descubiertos.** El grep de esta auditoría cubrió `packages/` completo pero no cada
  componente de `apps/web/src`. @Dev debe repetir la búsqueda antes de ejecutar el paso 5 del plan.
- **Vínculo de facturación (paso 1) es un gap real, no cosmético.** Si el módulo de facturación
  quirúrgica ya está en diseño activo (fuera del alcance verificado por este ADR), su cronograma puede
  condicionar el orden de los pasos 1 y 5 — @PO debe confirmar.
- **No se audita en este ADR** el consentimiento quirúrgico (`CONS_QX`, `eceCirugiaConsentimiento` /
  `consentimiento-qx`) ni el módulo de banco de sangre vinculado a `ACT_QX.transfusiones_intraoperatorias`
  — quedan fuera del alcance de "modelos paralelos" porque no tienen equivalente legacy que dupliquen.
- **Drift interno ya documentado en ECE** (JSONB vs. tabla satélite en `acto_quirurgico`, 5 campos
  clínicos sin columna física — `ACT_QX.md` drift §4/§5) no se resuelve en este ADR — es deuda
  preexistente del lado ECE, independiente de la decisión de fuente única.
- **Verificación de 0 filas es válida al 2026-08-22.** Si este ADR se ejecuta con retraso significativo
  y el módulo entra en operación piloto antes, repetir el conteo de filas antes de ejecutar el plan —
  la premisa central (cero costo de migración de datos) depende de que siga siendo cierto.

---

## Qué se verificó vs. qué se asumió

**Verificado (código + base de producción real, esta sesión):**
- Registro de ambos routers en `_app.ts` (`surgery`, `eceCirugiaPreop`, `eceWhoChecklist`,
  `eceRegistroAnestesico`, `eceUrpa`, `eceBridgeCirugia`, `eceActoQuirurgico`).
- Conteo de filas en las 10 tablas relevantes vía `psql` contra `DIRECT_URL` — todas en 0.
- Ausencia de columna `costCenterId`/equivalente en `ece.reserva_sala_qx` y `ece.acto_quirurgico`
  (`information_schema.columns`).
- Las 15 páginas UI (3 legacy + 12 ECE) y su router de origen, por grep directo sobre `apps/web/src/app`.
- El ítem de sidebar duplicado en `nav-sections.ts`.
- Los 2 consumidores reales de `SurgeryCase`/`surgeryCase` fuera del propio dominio quirúrgico, con
  lectura del código que los usa (no solo el nombre del archivo).
- Contenido de `docs/flujos/PROG_QX.md` y `docs/flujos/ACT_QX.md` — ambos ya diagnosticaron esta
  duplicación en 2026-05-22 y ya recomendaban consolidar hacia ECE.
- Estado de cierre de HE-01/HE-02/HE-06/HE-11/HE-15/HE-16/HE-17/HE-18 contra el re-audit del
  2026-05-24 (algunos, como HE-02, se confirmaron cerrados en el código leído hoy — más recientes que
  el re-audit).

**Asumido / no verificado en esta sesión (declarado explícitamente):**
- Que ningún reporte BI (`packages/bi`) referencia `SurgeryCase`/`OperatingRoom` — no se auditó ese
  workspace en esta sesión; el plan de migración lo deja como verificación explícita de @BID/@DA antes
  del `DROP` de los modelos Prisma (paso 6).
- El estado de diseño del módulo de facturación quirúrgica (si existe cronograma activo que dependa de
  `SurgeryCase.costCenterId`) — @PO debe confirmarlo.
- Que el grep de `apps/web/src` completo (no solo páginas) no encuentre más consumidores de
  `SurgeryCase` — señalado como paso explícito de verificación previa en el plan, no ejecutado aquí
  por estar fuera del alcance de "análisis, no código" de este encargo.

---

## Referencias

- `packages/trpc/src/routers/_app.ts`
- `packages/trpc/src/routers/surgery.router.ts`
- `packages/trpc/src/routers/ece/bridge-cirugia.router.ts`
- `packages/trpc/src/routers/ece/acto-quirurgico.router.ts`
- `packages/trpc/src/routers/ece/who-checklist.router.ts`
- `packages/trpc/src/routers/ece/registro-anestesico.router.ts`
- `packages/trpc/src/routers/ece/urpa-recovery.router.ts`
- `packages/trpc/src/routers/personal-salud.router.ts`
- `packages/trpc/src/routers/workflow-inbox.router.ts`
- `apps/web/src/components/nav-sections.ts`
- `docs/flujos/PROG_QX.md`, `docs/flujos/ACT_QX.md`, `docs/flujos/PREOP.md`, `docs/flujos/URPA.md`,
  `docs/flujos/CONS_QX.md`
- `docs/31_flujos_operativos_consolidado.md`
- `docs/audit/2026-05-19_audit_stream_e_quirofano.md`
- `docs/audit/2026-05-24_re-audit_stream_e.md`
- ADR 0011 — Motor de workflow ECE data-driven
- ADR 0012 — Estrategia RLS ECE
- ADR 0014 — Bridge admisión, atomicidad (precedente de riesgo de doble escritura, usado para descartar
  Opción C)
- ADR 0016 — Auditoría módulos legacy vs ECE
- ADR 0019 — GS1 trazabilidad paciente (precedente de rechazo de over-engineering, usado contra Opción A)
- CLAUDE.md §"Adecuar legacy vs duplicar"
