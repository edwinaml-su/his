# WHO_CHECK — Lista de Verificación de Cirugía Segura OMS (3 momentos)

## Metadata

- **codigo**: `WHO_CHK` (catálogo `ece.tipo_documento`; alta en `packages/database/sql/68_who_surgical_checklist.sql` líneas 136–143). **Notar**: el seed inserta con columna `descripcion` y `es_inmutable` — el script asume un schema de `tipo_documento` con esas columnas; si la versión base de la tabla en BD usa nombre distinto (ej. `inmutable`), el INSERT puede fallar silenciosamente o requerir reconciliación. PENDIENTE — verificar paridad columnar entre `68_who_surgical_checklist.sql` y `63_ece_08_seed.sql`.
- **nombre**: WHO Surgical Safety Checklist (Lista de Verificación de Cirugía Segura, OMS 2009) — tres pausas estandarizadas: **Sign-In** (pre-anestesia), **Time-Out** (pre-incisión), **Sign-Out** (post-cierre, pre-salida).
- **modalidad**: `QUIRURGICO`. El seed no establece `modalidad` explícitamente (ver Drift §1) — el INSERT en `68_who_surgical_checklist.sql` línea 136 solo provee `codigo, nombre, descripcion, es_inmutable`.
- **NTEC artículo**: **Norma fuente: WHO Safe Surgery Saves Lives (OMS 2009)** — estándar internacional adoptado por **TDR §13.3** ("Lista de Verificación de Cirugía Segura (OMS) — Implementación obligatoria"). Cumple **Art. 35 NTEC** (trazabilidad y responsables de cada fase) y referencias al Acuerdo n.° 1616 MINSAL. El WHO Surgical Safety Checklist es **exigible por MINSAL** como buena práctica obligatoria en establecimientos hospitalarios de El Salvador.
- **modulo_his_target**: `/ece/cirugia/who` (briefing) ≡ ruta real `apps/web/src/app/(clinical)/ece/quirofano/who-check/` (existe `page.tsx` + `_components/fase-panel.tsx`). URL operativa: `/ece/quirofano/who-check?actoId=<uuid>` (el parámetro `actoId` referencia `ece.acto_quirurgico.id`).
- **tabla_datos**: `ece.who_checklist` (Prisma `EceWhoChecklist` — `packages/database/prisma/schema.prisma` líneas 5596–5607). DDL real en `68_who_surgical_checklist.sql` líneas 16–100. **Modelo**: una sola fila por acto quirúrgico (`UNIQUE (acto_quirurgico_id)`, líneas 102–112) con **tres columnas JSONB** (`fase_sign_in`, `fase_time_out`, `fase_sign_out`) y una columna `estado` de avance.
- **inmutable**: `false` en el seed (`es_inmutable = false`, línea 141 del SQL: *"mutable hasta estado 'completo'; el router aplica lógica de inmutabilidad post-sign-out"*). **Inmutabilidad efectiva**: cuando `estado = 'completo'`, la policy RLS `who_checklist_update` (líneas 198–209) **bloquea UPDATE** mediante `USING (estado <> 'completo' AND ...)`. Es inmutabilidad **a nivel de policy**, no a nivel de trigger — más débil que en `preop_checklist` o `consentimiento_informado` (donde el trigger lanza excepción). Ver Drift §3.
- **tipo_registro**: `OBLIGATORIO` — el TDR §13.3 declara "Implementación obligatoria de la Lista de Cirugía Segura de la OMS en sus tres pausas. Cada ítem registrado, con responsable y firma." Clasificación NTEC: el seed no especifica `tipo_registro` en este INSERT (esquema mínimo) — PENDIENTE alinear con `transaccional` o `historico` según convención.

---

## Propósito normativo

El **WHO Surgical Safety Checklist** es un estándar internacional publicado por la **Organización Mundial de la Salud en 2009** (campaña "Safe Surgery Saves Lives") como mecanismo de seguridad para reducir errores quirúrgicos evitables: cirugía en sitio incorrecto, identificación errónea del paciente, reacciones anestésicas por alergias no comunicadas, infección postoperatoria por antibiótico profiláctico no administrado, retención de cuerpos extraños (gasas, agujas, instrumental), muestras anatomopatológicas mal etiquetadas, y problemas de comunicación intra-equipo. Sus tres pausas son intra-operatorias y se ejecutan dentro de sala con el equipo completo presente.

La adopción del checklist OMS ha demostrado reducciones significativas en mortalidad y complicaciones quirúrgicas. El estudio multicéntrico original de Haynes et al. (NEJM 2009, n=7688) reportó reducción de mortalidad a 30 días del **1.5% al 0.8% (47%)** y de complicaciones mayores del **11.0% al 7.0% (36%)**. El briefing menciona "**reducen mortalidad quirúrgica 36%**" — la cifra exacta del estudio original es **36% para complicaciones mayores** y **47% para mortalidad**, ambas estadísticamente significativas. La cita académica precisa debe usar "36% reducción de complicaciones mayores" o "47% reducción de mortalidad" según contexto.

El **TDR §13.3** establece la implementación como **obligatoria** en todo establecimiento del HIS Multipaís, en las tres pausas:

- **Sign-In** — antes de inducción anestésica (al entrar el paciente a sala, antes de que el anestesiólogo administre anestesia).
- **Time-Out** — antes de la incisión cutánea (con todo el equipo presente: cirujano, anestesiólogo, enfermería circulante e instrumentista).
- **Sign-Out** — antes de que el paciente abandone la sala (post-cierre, con conteo de instrumental y muestras etiquetadas).

Cumple **Art. 35 NTEC** en cuanto a trazabilidad: "Cada ítem registrado, con responsable y firma" (TDR §13.3). El JSONB de cada fase incluye `responsable_id`, `responsable_nombre` y `completado_en` (timestamp ISO8601) — pero hoy el `responsable_id` se hardcodea a UUID-cero en UI, rompiendo el requisito de trazabilidad por fase (HE-17 — ver §Drift).

La **filosofía operativa** del checklist es: **una discrepancia en cualquier ítem detiene el procedimiento**. Si en Sign-In no se confirma identidad del paciente, no se inicia la anestesia. Si en Time-Out no se confirma que el antibiótico profiláctico se administró en los 60 minutos previos, el cirujano espera. Si en Sign-Out el conteo de gasas no cuadra, el paciente no sale de sala — se realiza Rx para descartar cuerpo extraño retenido.

---

## Dependencias (depende_de)

Documentos que DEBEN existir y estar firmados/confirmados antes de iniciar el WHO checklist (al menos Sign-In):

- **`PREOP_CHECK`** (Lista de Verificación Preoperatoria) — **firmada por anestesiólogo** con ASA registrada. El Sign-In del WHO confirma ítems que ya están en la PREOP (identidad, sitio marcado, consentimiento firmado, alergias, vía aérea difícil, riesgo hemorragia) — el WHO Sign-In es la **revalidación dentro de sala** de lo que la PREOP estableció en consulta pre-anestésica. Sin PREOP firmada, técnicamente el acto no se autoriza (Art. 28 NTEC).
- **`CONS_INF`** subtipo **`CONS_QX`** (Consentimiento Informado Quirúrgico) — **firmado con doble firma paciente+cirujano** (Art. 39 NTEC). El ítem WHO Sign-In `consentimiento_firmado` es la verificación dentro de sala — si la PREOP marcó `consentimiento_firmado = true` y el WHO no puede confirmarlo, hay discrepancia documental crítica.
- **`PROG_QX` (programación quirúrgica)** — la `ece.reserva_sala_qx` + `ece.acto_quirurgico` confirmados. El WHO checklist se vincula vía `acto_quirurgico_id` (FK NOT NULL, DDL línea 20–22). Sin acto quirúrgico abierto, el WHO checklist no puede crearse.
- **`HOJA_ING`** — episodio hospitalario abierto (transitiva por el acto quirúrgico → episodio_atencion).

> El briefing menciona como dependencia "PROG_QX confirmada" — formalmente la programación se materializa en `ece.acto_quirurgico` (la fila opera durante el acto). PENDIENTE — validar con @AS si `PROG_QX` es un código de `tipo_documento` formal o si se subsume en `ACTO_QX`.

Recomendados (no bloqueantes):

- `SOL_EST` / `RES_EST` con estudios de imagen relevantes — necesarios para el ítem Sign-In "Estudios de imagen esenciales disponibles en sala".
- `IND_MED` con antibiótico profiláctico indicado — verificación del ítem Time-Out "Antibiótico profiláctico administrado en los 60 min previos".

---

## Obligatoriedad

| Contexto | ¿Obligatorio? | Norma de referencia |
|---|---|---|
| **TODA cirugía mayor electiva** | **SI siempre** (recomendación OMS, exigible MINSAL) | OMS 2009 + TDR §13.3 |
| **Cirugía mayor de urgencia** | **SI siempre** (los 3 momentos se ejecutan; en urgencia vital algunos ítems se documentan abreviados pero la pausa **no se omite**) | OMS 2009 — "no exemptions for urgency" |
| **Cirugía menor con sedación / ambulatoria** | **SI** (aplica WHO checklist adaptado — versión abreviada admisible si la institución lo formaliza, pero no se omite la pausa) | OMS 2009 + buena práctica nacional |
| **Cesárea (electiva o de urgencia)** | **SI** (cesárea es procedimiento quirúrgico — aplican las 3 pausas) | OMS 2009 + TDR §17 Obstetricia |
| **Procedimiento bajo anestesia local sin sedación profunda** | **CASO DE INSTITUCIÓN** (algunos centros aplican checklist abreviado; el TDR no lo exige expresamente) | Política local |
| **Procedimiento en sala de procedimientos (no quirófano)** | **NO** (el WHO checklist es específico de sala de operaciones; procedimientos en sala simple usan checklist de procedimientos menor cuando aplique) | OMS 2009 |
| **Trasplante / procuración de órganos** | **SI** (ASA VI cuando aplique en donante en muerte cerebral; ver `PREOP.md` §Drift §7 sobre ASA VI no soportada) | OMS 2009 |

> El TDR §13.3 es categórico: *"Implementación obligatoria de la Lista de Cirugía Segura de la OMS en sus tres pausas."* No admite exenciones por urgencia o complejidad.

---

## Roles firmantes

| Rol | Acción | Momento | Mecanismo |
|---|---|---|---|
| **ENFERMERIA_CIRCULANTE** (rol `ENF`) | **Llena cada pausa** — checklist es responsabilidad del rol circulante, que verbaliza cada ítem y registra la verificación | Sign-In, Time-Out, Sign-Out | Llenado en UI `FasePanel` (ítems verificado/observación); registra `responsable_id` del circulante |
| **CIRUJANO** (rol `ESP` — cirujano responsable del acto) | **Confirma cada pausa** verbalmente con el equipo presente; en Time-Out verifica paciente/sitio/procedimiento; en Sign-Out confirma procedimiento realizado y nombre | Cada uno de los 3 momentos | Verificación verbal con confirmación del enfermería circulante; **no firma electrónica formal** en el modelo actual (sin PIN argon2id por fase, ver Drift §3) |
| **ANESTESIOLOGO** (rol `MC` o `ESP`) | **Confirma Sign-In** (equipo de anestesia completo, pulsioxímetro funcional, vía aérea evaluada, plan anestésico) y **Time-Out** (eventos críticos discutidos desde la perspectiva anestésica); **Sign-Out** confirma plan de recuperación y manejo del dolor postoperatorio | Sign-In, Time-Out, Sign-Out | Idem — confirmación verbal registrada por circulante; sin firma electrónica por fase |
| **INSTRUMENTISTA** (rol `ENF`) | Confirma esterilización del instrumental (Time-Out) y conteo de instrumental/gasas/agujas (Sign-Out) | Time-Out, Sign-Out | Idem |
| **DIR** (Dirección del establecimiento) | Validación administrativa del checklist completado (opcional) | Post Sign-Out | Sin firma |

> El modelo actual **no usa el motor de workflow ECE con firma electrónica PIN por fase**. Las tres pausas se completan por **upsert idempotente** desde el router (`marcarSignIn`, `marcarTimeOut`, `marcarSignOut`) — el avance del `estado` (`iniciado → sign_in_completo → time_out_completo → completo`) es lineal y no requiere PIN. La trazabilidad de quién verificó cada fase depende del `responsable_id` del JSONB — **hoy hardcodeado a UUID-cero** (HE-17, ver §Drift). Esto es **divergencia frente al patrón del proyecto** (PREOP_CHECK, CONS_INF, ACTO_QX usan PIN argon2id por firma).

---

## Campos obligatorios

Mapeados a columnas y JSONB de `ece.who_checklist` (DDL `68_who_surgical_checklist.sql` líneas 16–100):

### Estructura general

- `id` — uuid PK (gen_random_uuid).
- `acto_quirurgico_id` — uuid NOT NULL FK a `ece.acto_quirurgico(id)` con `ON DELETE RESTRICT` (línea 22). **UNIQUE** vía constraint `uq_who_checklist_acto` (líneas 102–112) — un solo checklist por acto.
- `estado` — `TEXT NOT NULL DEFAULT 'iniciado' CHECK IN ('iniciado','sign_in_completo','time_out_completo','completo')` (líneas 25–31). Avance secuencial unidireccional.
- `fase_sign_in`, `fase_time_out`, `fase_sign_out` — `JSONB` (nullable hasta que la fase se complete). Estructura documentada inline en SQL líneas 38–93 y replicada en `who-check/page.tsx`.
- `registrado_por` — uuid NOT NULL FK `ece.personal_salud(id)`. Quién creó la fila (típicamente el primero que abre el panel — circulante).
- `registrado_en` — timestamptz NOT NULL DEFAULT now().
- `actualizado_en` — timestamptz NOT NULL DEFAULT now(); trigger `fn_who_checklist_updated_en` (líneas 149–155) actualiza automáticamente en cada UPDATE.

### Fase Sign-In (pre-anestesia, antes de inducción)

**Estructura JSONB esperada** (SQL líneas 38–53 + UI líneas 22–31):
```jsonc
{
  "completado_en": "2026-05-22T15:30:00-06:00",   // ISO8601
  "responsable_id": "uuid",                        // hoy hardcoded a "000...000" — ver HE-17
  "responsable_nombre": "string",
  "items": [
    { "clave": "identidad_confirmada",       "label": "Identidad del paciente confirmada",                "verificado": bool, "observacion": "string|null" },
    { "clave": "sitio_marcado",              "label": "Sitio quirúrgico marcado",                          "verificado": bool },
    { "clave": "consentimiento_firmado",     "label": "Consentimiento informado firmado",                  "verificado": bool },
    { "clave": "equipo_anestesia_completo",  "label": "Equipo de anestesia completo y verificado",         "verificado": bool },
    { "clave": "pulsioximetro_funcional",    "label": "Pulsioxímetro funcional colocado",                  "verificado": bool },
    { "clave": "alergias_conocidas",         "label": "Alergias conocidas evaluadas",                      "verificado": bool, "detalle": "string|null" },
    { "clave": "via_aerea_dificil",          "label": "Riesgo de vía aérea difícil evaluado",              "verificado": bool },
    { "clave": "riesgo_hemorragia",          "label": "Riesgo de hemorragia mayor evaluado (≥500 ml)",     "verificado": bool }
  ]
}
```

Ítems del briefing vs ítems UI/DDL:
- **paciente_identificado** ≡ `identidad_confirmada` (OK).
- **procedimiento_correcto** — **AUSENTE en Sign-In del modelo actual**. Se verifica en Time-Out como parte de `paciente_confirmado`. Discrepancia con el briefing.
- **sitio_marcado_si_aplica** ≡ `sitio_marcado` (OK; el "si aplica" — caso de procedimientos no lateralizados — se modela como observación, no como ítem independiente).
- **consentimiento_firmado** ≡ idem (OK).
- **alergias_revisadas** ≡ `alergias_conocidas` (OK).
- **via_aerea_dificil_evaluada** ≡ `via_aerea_dificil` (OK).
- **riesgo_sangrado_evaluado** ≡ `riesgo_hemorragia` (OK).

### Fase Time-Out (pre-incisión, todo el equipo presente)

**Estructura JSONB** (SQL líneas 60–74 + UI líneas 33–41):
```jsonc
{
  "completado_en": "ISO8601",
  "responsable_id": "uuid",
  "responsable_nombre": "string",
  "items": [
    { "clave": "equipo_presentado",           "label": "Todos los miembros del equipo se han presentado",                 "verificado": bool },
    { "clave": "paciente_confirmado",         "label": "Paciente, sitio quirúrgico y procedimiento confirmados",          "verificado": bool },
    { "clave": "antibiotico_profilactico",    "label": "Antibiótico profiláctico administrado en los 60 min previos",     "verificado": bool },
    { "clave": "imagenes_disponibles",        "label": "Estudios de imagen esenciales disponibles en sala",               "verificado": bool },
    { "clave": "eventos_criticos_discutidos", "label": "Pasos críticos, duración estimada y pérdida de sangre discutidos", "verificado": bool },
    { "clave": "duracion_estimada",           "label": "Duración estimada de la cirugía discutida",                       "verificado": bool, "detalle": "string|null" },
    { "clave": "esterilizacion_instrumental", "label": "Esterilización del instrumental confirmada (indicador incluido)", "verificado": bool }
  ]
}
```

Ítems del briefing vs ítems UI/DDL:
- **equipo_se_presenta** ≡ `equipo_presentado` (OK).
- **paciente_procedimiento_sitio_confirmado** ≡ `paciente_confirmado` (OK).
- **antibiotico_profilactico_30min** — discrepancia: el modelo OMS canónico es **60 minutos previos a la incisión** (no 30). El UI declara explícitamente "en los 60 min previos" (línea 36 UI). PENDIENTE — corregir el briefing o validar política institucional (algunos centros usan 30–60 min como ventana intermedia).
- **imagenes_disponibles** ≡ idem (OK).
- **preocupaciones_anticipadas** ≡ `eventos_criticos_discutidos` (OK; cubre las tres perspectivas — cirujano "pasos críticos", anestesia "consideraciones", enfermería "esterilización/instrumental").

### Fase Sign-Out (antes de salir, post-cierre)

**Estructura JSONB** (SQL líneas 82–93 + UI líneas 43–49):
```jsonc
{
  "completado_en": "ISO8601",
  "responsable_id": "uuid",
  "responsable_nombre": "string",
  "items": [
    { "clave": "procedimiento_confirmado",  "label": "Nombre del procedimiento realizado confirmado",        "verificado": bool },
    { "clave": "conteo_instrumental",       "label": "Conteo de instrumental, gasas y agujas correcto",      "verificado": bool },
    { "clave": "etiquetado_muestras",       "label": "Muestras de anatomía patológica etiquetadas correctamente", "verificado": bool },
    { "clave": "problemas_equipo",          "label": "Problemas del equipo reportados",                      "verificado": bool, "observacion": "string|null" },
    { "clave": "plan_postoperatorio",       "label": "Plan postoperatorio comunicado a enfermería y anestesia", "verificado": bool }
  ]
}
```

Ítems del briefing vs ítems UI/DDL:
- **procedimiento_realizado_registrado** ≡ `procedimiento_confirmado` (OK).
- **conteo_instrumental_gasas_completo** ≡ `conteo_instrumental` (OK; incluye agujas).
- **muestras_etiquetadas** ≡ `etiquetado_muestras` (OK).
- **problemas_equipo** ≡ idem (OK; con campo libre `observacion`).
- **consideraciones_recuperacion** ≡ `plan_postoperatorio` (OK).

> Total ítems canónicos: **8 Sign-In + 7 Time-Out + 5 Sign-Out = 20 ítems**. La UI declara la versión canónica OMS 2009 — el briefing menciona variantes ligeramente distintas (ej. "consentimiento_firmado" vs verificación dual). La fuente de verdad es la estructura JSONB de la BD + UI canónica del proyecto.

---

## Estados

`who_checklist.estado` (columna nativa, no del motor de workflow ECE):

```
iniciado
   │
   │ (router.marcarSignIn)
   ▼
sign_in_completo
   │
   │ (router.marcarTimeOut — solo si estado='sign_in_completo')
   ▼
time_out_completo
   │
   │ (router.marcarSignOut — solo si estado='time_out_completo')
   ▼
completo  ← INMUTABILIDAD efectiva (policy who_checklist_update bloquea UPDATE)
```

Sin transiciones de rollback. El `CHECK (estado IN ('iniciado','sign_in_completo','time_out_completo','completo'))` (DDL líneas 26–31) bloquea valores fuera del enum.

> **El motor de workflow ECE no gobierna este checklist**. No hay `documento_instancia` ni `flujo_estado` formal — el avance vive en la columna `estado` y el router `eceWhoChecklistRouter` controla las transiciones imperativamente. Esto es **divergencia** frente al patrón del proyecto (PREOP_CHECK, CONS_INF, ACTO_QX usan el motor ECE). Ver Drift §2.

---

## Transiciones

El router `eceWhoChecklistRouter` expone:

| Procedure tRPC | Acción operativa | Validación previa | Resultado |
|---|---|---|---|
| `eceWhoChecklist.get({ actoQuirurgicoId })` | Lee el checklist (devuelve `null` si no existe) | RLS Cat-E (debería; ver HE-15) | Devuelve fila + JSONBs de las fases |
| `eceWhoChecklist.marcarSignIn({ actoQuirurgicoId, responsableId, responsableNombre, items: [...] })` | **Upsert idempotente**: si no existe la fila, la crea con `estado='sign_in_completo'`; si existe en `estado='iniciado'`, actualiza `fase_sign_in` y avanza a `sign_in_completo` | El acto quirúrgico existe; el usuario pertenece al establecimiento | `estado='sign_in_completo'`, `fase_sign_in` JSONB poblado |
| `eceWhoChecklist.marcarTimeOut({ actoQuirurgicoId, responsableId, responsableNombre, items: [...] })` | Avanza a `time_out_completo` | `estado='sign_in_completo'` | `estado='time_out_completo'`, `fase_time_out` poblado |
| `eceWhoChecklist.marcarSignOut({ actoQuirurgicoId, responsableId, responsableNombre, items: [...] })` | Avanza a `completo`; **emite outbox** `ece.who_checklist.completado` | `estado='time_out_completo'` | `estado='completo'`, `fase_sign_out` poblado; emite evento |

> El briefing pide "PROG_QX confirmada" como prerequisito; el router actual no valida explícitamente el estado del acto quirúrgico (asume que si existe `acto_quirurgico_id` la programación está confirmada). PENDIENTE — añadir validación adicional si el flujo requiere que el acto esté en `estado='en_ejecucion'` antes de Sign-In.

---

## Eventos de dominio

- **`ece.who_checklist.sign_in_completado`** — emitido tras `marcarSignIn`. PENDIENTE — verificar si se emite hoy; el audit HE-16 reporta que solo `marcarSignOut` emite outbox (con función local `emitOutbox`). El briefing pide emisión por las tres fases.
- **`ece.who_checklist.time_out_completado`** — equivalente.
- **`ece.who_checklist.sign_out_completado`** ≡ `ece.who_checklist.completado` — **emitido hoy** vía función local `emitOutbox` (audit HE-16) — payload incluye `actoQuirurgicoId`, `whoChecklistId`, `completadoEn`. **Rompe el patrón canónico `emitDomainEvent`**. Ver Drift §4.
- **`ece.who_checklist.discrepancia_detectada`** — alerta crítica cuando algún ítem de una pausa quedó `verificado=false` y se forzó el avance. **No implementado hoy** — el router no valida que todos los ítems estén `verificado=true` antes de aceptar el marcarX. Una pausa puede registrarse con ítems no verificados, lo que va en contra de la filosofía OMS "una discrepancia detiene el procedimiento". PENDIENTE — añadir validación dura o blando (warning) y emitir evento `discrepancia_detectada` con array de claves no verificadas.

---

## Drift conocido (audit)

### 1. HE-15 — P1 ALTO — Router WHO opera sin `withWorkflowContext` (RLS bypassed)

**Origen**: `docs/audit/2026-05-19_audit_stream_e_quirofano.md` líneas 330–335.

El router `eceWhoChecklistRouter` **no usa `withWorkflowContext`** en ninguna de sus operaciones. Lee y escribe directamente sobre `ctx.prisma` (rol `postgres.<ref>` con BYPASSRLS). Las policies `who_checklist_select/update/insert` existen en BD pero son **ignoradas en runtime** porque el rol activo bypasses RLS.

**Consecuencia**: un usuario autenticado de establecimiento A puede leer / modificar / completar checklists WHO de actos quirúrgicos de establecimiento B, si conoce el `actoQuirurgicoId`. El filtro en JS dentro del `list` (`ea.establecimiento_id = ${ctx.tenant!.organizationId}`) es **defensa débil** y se ha bypaseado en el pasado.

**Pendiente**: envolver TODAS las operaciones del router en `withWorkflowContext(ctx.prisma, buildEceCtx(ctx), async (tx) => {...})` para demotar al rol `authenticated` y activar las policies.

**Riesgo go-live**: ALTO. Violación de tenant isolation en módulo clínico de seguridad quirúrgica.

### 2. Motor de workflow ECE no gobierna el checklist WHO

El patrón del proyecto para documentos NTEC es: tabla de datos + `ece.documento_instancia` + `ece.flujo_estado` + `ece.flujo_transicion`. El WHO checklist **no participa** en este motor — no se crea `documento_instancia`, no hay `flujo_estado` por fase, no hay firma electrónica con PIN argon2id, no hay `historial` append-only.

**Consecuencia**:
- Sin trazabilidad criptográfica por fase (no hay hash de contenido firmado).
- Sin lockout por intentos fallidos de firma (no aplica — no hay PIN).
- Sin integración con el grafo de dependencias del expediente (no hay `depende_de` enforcement).

**Pendiente**: PENDIENTE — decidir con @AE / @AS si:
- (a) Se mantiene el modelo simplificado actual (3 upserts, sin motor), aceptando trazabilidad solo via outbox y audit triggers.
- (b) Se eleva al motor ECE estándar con `WHO_CHK` como tipo_documento, 3 firmas independientes (Sign-In firmada / Time-Out firmada / Sign-Out firmada), e instancias separadas por pausa o una instancia con 3 transiciones.

### 3. Inmutabilidad post-`completo` solo a nivel de policy, no trigger

La inmutabilidad efectiva del checklist WHO post-`estado='completo'` depende **únicamente** de la policy RLS `who_checklist_update` (líneas 198–209) que tiene `USING (estado <> 'completo' AND ...)`. **No hay trigger** equivalente a `trg_preop_immutable` que lance excepción en BD.

**Consecuencias**:
- Si la policy se desactiva por error operativo (ej. `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`), la inmutabilidad se pierde silenciosamente.
- Operaciones con rol `service_role` (BYPASSRLS) pueden mutar el checklist completado sin error.
- La defensa es más débil que la de `preop_checklist` (trigger + policy) o `consentimiento_informado` (trigger + policy + columna `estado` con CHECK).

**Pendiente**: añadir trigger PL/pgSQL análogo a `ece.preop_checklist_immutable` que bloquee UPDATE sobre filas con `estado='completo'`.

### 4. HE-16 — P1 ALTO — `emitOutbox` local en lugar de `emitDomainEvent`

**Origen**: `docs/audit/2026-05-19_audit_stream_e_quirofano.md` líneas 337–352.

El procedure `marcarSignOut` usa una función helper local `emitOutbox` (`who-checklist.router.ts:112–122`) que ejecuta INSERT directo a `public.outbox` con un schema reducido (`event_type`, `payload`, `created_at`). El patrón canónico del proyecto (`emitDomainEvent`) requiere `organization_id`, `aggregate_type`, `aggregate_id`, `emitted_by_id` — columnas que pueden ser NOT NULL en el schema real de outbox y romper la inserción silenciosamente o en runtime.

**Pendiente**: reemplazar `emitOutbox` por `emitDomainEvent` del patrón canónico:
```ts
await emitDomainEvent(tx, {
  organizationId: ctx.tenant.organizationId,
  eventType: "ece.who_checklist.completado",
  aggregateType: "WhoChecklist",
  aggregateId: rows[0].id,
  emittedById: ctx.user.id,
  payload: { actoQuirurgicoId, completadoEn, items_no_verificados: [...] }
});
```

**Riesgo go-live**: ALTO. El evento de completado puede no persistirse, rompiendo integraciones downstream (notificación a UCI, alta médica, facturación quirúrgica).

### 5. HE-17 — P1 ALTO — `responsableId` hardcodeado como UUID-cero en UI

**Origen**: `docs/audit/2026-05-19_audit_stream_e_quirofano.md` líneas 354–359.

En `who-check/page.tsx:175`, `:193` y `:212`, el campo `responsableId` se envía con valor fijo `"00000000-0000-0000-0000-000000000000"` para las tres fases. El router acepta y persiste este UUID-cero en el JSONB de cada fase. **No es posible identificar quién verificó cada fase** — viola el requisito OMS 2009 de "responsable y firma" (TDR §13.3) y Art. 35 NTEC.

**Pendiente**: ignorar `responsableId` del cliente y derivarlo de `ctx.user.id` en el router, o añadir un selector de personal en el `FasePanel` con rol-aware (Sign-In → anestesiólogo + enfermería circulante; Time-Out → cirujano + anestesiólogo + enfermería; Sign-Out → cirujano + enfermería + instrumentista).

**Riesgo go-live**: ALTO. Trazabilidad rota en el módulo de seguridad quirúrgica más visible del HIS.

### 6. HE-18 — P2 MEDIO — Policy INSERT sin `WITH CHECK`

**Origen**: `docs/audit/2026-05-19_audit_stream_e_quirofano.md` líneas 361–373.

La policy `who_checklist_insert` tiene `qual=null` (sin `WITH CHECK`), equivalente a HE-12 para PREOP. Permite crear checklists WHO para actos quirúrgicos de cualquier establecimiento.

**Pendiente**: añadir `WITH CHECK` equivalente a la policy SELECT/UPDATE.

**Combinado con HE-15** (RLS bypassed por rol con BYPASSRLS) — el riesgo escala a ALTO de facto.

### 7. HE-19 — P3 BAJO — Tests del router validan solo schemas y lógica local

**Origen**: `docs/audit/2026-05-19_audit_stream_e_quirofano.md` líneas 375–379.

`who-checklist.test.ts` cubre schemas Zod y una función `validateTransition` local definida en el propio test (no es la lógica del router real). No prueba: el UPSERT de Sign-In, la secuencia ordenada `iniciado → sign_in_completo → time_out_completo → completo`, ni el `emitOutbox`/`emitDomainEvent` en Sign-Out.

**Pendiente**: tests de integración con mock de Prisma para los 3 procedures, incluyendo casos de error (acto no existe, secuencia rota — intento de Time-Out sin Sign-In, ítem no verificado).

### 8. Discrepancia con el briefing — el ítem "procedimiento_correcto" no está en Sign-In

El briefing menciona en Sign-In: paciente_identificado / **procedimiento_correcto** / sitio_marcado_si_aplica / consentimiento_firmado / alergias_revisadas / via_aerea_dificil_evaluada / riesgo_sangrado_evaluado.

El UI canónica (UI line 22–31) tiene en Sign-In: identidad / sitio_marcado / consentimiento_firmado / equipo_anestesia_completo / pulsioximetro_funcional / alergias_conocidas / via_aerea_dificil / riesgo_hemorragia. **No incluye "procedimiento_correcto"** — se verifica en Time-Out (`paciente_confirmado` que cubre paciente+sitio+procedimiento).

La estructura del UI sigue **fielmente** el WHO Safe Surgery Checklist OMS 2009 (el "procedimiento" se confirma en el Time-Out con el equipo completo presente, no en el Sign-In donde solo está la enfermería + anestesiólogo). El briefing tiene una variante.

**Pendiente**: alinear el briefing con la versión canónica OMS (la UI actual es correcta) o documentar la variante institucional.

### 9. Discrepancia "antibiotico_profilactico_30min" vs "60min"

El briefing dice `antibiotico_profilactico_30min`; el UI dice "**60 min previos**" (línea 36). El modelo canónico OMS 2009 y los protocolos SCIP / IDSA usan **60 minutos** (cefalosporinas, ampicilina) o **120 minutos** (vancomicina, fluoroquinolonas). PENDIENTE — corregir el briefing a "60 min" o documentar política institucional.

### 10. Path UI `/ece/cirugia/who` vs `/ece/quirofano/who-check`

El briefing menciona `/ece/cirugia/who`. El árbol real es `apps/web/src/app/(clinical)/ece/quirofano/who-check/`. Idem que en PREOP. PENDIENTE — nomenclatura unificada (cirugía vs quirófano; who vs who-check).

### 11. Seed sin `modalidad` ni `tipo_registro` explícitos

El INSERT en `68_who_surgical_checklist.sql` líneas 136–143 solo provee `codigo, nombre, descripcion, es_inmutable`. El `tipo_documento` canónico (sembrado en `63_ece_08_seed.sql`) tiene columnas `tabla_datos, tipo_registro, modalidad, depende_de` que **no se setean** para `WHO_CHK`. Si la tabla tiene NOT NULL en estas columnas, el INSERT falla; si admite NULL, queda inconsistente con el resto.

**Pendiente**: alinear el INSERT a `WHO_CHK` con la firma completa: `('WHO_CHK', 'WHO Surgical Safety Checklist', 'who_checklist', 'transaccional', 'hospitalario', array['PREOP_CHECK','CONS_INF'], false)`.

---

## Descripción markdown rica

El **WHO Surgical Safety Checklist** es el estándar internacional de seguridad quirúrgica publicado por la **Organización Mundial de la Salud en 2009** y adoptado por el **TDR §13.3** del HIS Multipaís como **implementación obligatoria** en todo establecimiento que opere salas de cirugía. Su uso reduce la mortalidad y complicaciones quirúrgicas: el estudio multicéntrico original (Haynes et al., NEJM 2009, n=7688 pacientes en 8 hospitales de 4 continentes) reportó **reducción del 47% en mortalidad a 30 días** (de 1.5% a 0.8%) y **reducción del 36% en complicaciones mayores** (de 11.0% a 7.0%) — ambas estadísticamente significativas. La eficacia depende de la implementación rigurosa, no del simple registro: si el equipo "tilda casillas" sin pausar y verbalizar cada ítem, el beneficio se evapora.

Las **tres pausas** son intra-operatorias y se ejecutan **dentro de sala de operaciones** con el equipo presente:

- **Sign-In** — antes de la inducción anestésica. Confirma identidad del paciente, sitio marcado, consentimiento firmado, equipo de anestesia completo y verificado, pulsioxímetro funcional, alergias conocidas y evaluadas, vía aérea difícil evaluada (Mallampati, tiromentoniana), riesgo de hemorragia mayor (≥500 ml en adultos; ≥7 ml/kg en pediatría). La enfermería circulante verbaliza cada ítem; el anestesiólogo lo confirma. Si algún ítem no se verifica (consentimiento ausente, equipo de anestesia incompleto), **no se induce la anestesia**.
- **Time-Out** — antes de la incisión cutánea, **con todo el equipo quirúrgico presente** (cirujano, anestesiólogo, enfermería circulante, instrumentista). Confirma presentación del equipo (cada miembro dice su nombre y rol), paciente/sitio/procedimiento confirmados verbalmente, antibiótico profiláctico administrado en los 60 minutos previos (no 30 — corrección del briefing; 120 min para vancomicina y fluoroquinolonas), estudios de imagen esenciales disponibles en sala, eventos críticos discutidos por las tres perspectivas (cirujano verbaliza pasos críticos, duración estimada y pérdida de sangre anticipada; anestesia verbaliza preocupaciones específicas del paciente; enfermería verbaliza esterilización confirmada del instrumental e issues de equipamiento). Si algún ítem no se verifica (sin antibiótico, sin imágenes, instrumental no esterilizado correctamente), **no se inicia la incisión**.
- **Sign-Out** — antes de que el paciente salga de la sala, post-cierre. Confirma el nombre del procedimiento realizado (importante porque puede haber cambiado durante la cirugía respecto a lo planeado), conteo correcto de instrumental + gasas + agujas (si no cuadra → **Rx pre-traslado** para descartar cuerpo extraño retenido), muestras de anatomía patológica etiquetadas correctamente (paciente correcto + número de muestra + sitio anatómico), problemas de equipamiento reportados (registro de fallas para mantenimiento posterior), plan postoperatorio comunicado a la enfermería de URPA y al anestesiólogo de recuperación (manejo del dolor, drenajes, restricciones).

La **filosofía operativa** del checklist es: **una discrepancia en cualquier momento detiene el procedimiento**. Esto es un cambio cultural más que tecnológico — el checklist no funciona como mero formulario; funciona como **mecanismo de seguridad psicológica** que da permiso explícito a cualquier miembro del equipo (incluido el más junior) a detener la cirugía cuando detecta una incongruencia. La enfermería circulante es la dueña del proceso, y el cirujano +/- anestesiólogo confirman. El registro en el HIS es la evidencia documental de que la pausa ocurrió — pero la pausa **debe ocurrir verbalmente en sala**, no como tilde a posteriori.

**Implementación actual en el HIS**: el módulo `/ece/quirofano/who-check?actoId=<uuid>` (briefing menciona `/ece/cirugia/who` — divergencia de nomenclatura) muestra los tres paneles secuenciales (Sign-In disponible siempre; Time-Out tras Sign-In completo; Sign-Out tras Time-Out completo). El modelo de datos es una sola fila en `ece.who_checklist` por acto quirúrgico (`UNIQUE` constraint), con tres JSONB (`fase_sign_in`, `fase_time_out`, `fase_sign_out`) y una columna `estado` que avanza `iniciado → sign_in_completo → time_out_completo → completo` unidireccionalmente. **Divergencia con el patrón del proyecto**: a diferencia de `PREOP_CHECK`, `CONS_INF`, `ACTO_QX` y `EPICRISIS`, el checklist WHO **no usa el motor de workflow ECE** (`documento_instancia`, `flujo_estado`, firma electrónica PIN argon2id) — el router controla las transiciones imperativamente vía upsert. Esto simplifica el modelo pero pierde trazabilidad criptográfica por fase y firmas por responsable.

**Drift crítico para Go-Live**: el router opera con rol BYPASSRLS (sin `withWorkflowContext` — HE-15), lo que rompe el aislamiento tenant; el `responsableId` se hardcodea a UUID-cero en UI (HE-17), rompiendo trazabilidad de quién verificó cada fase; la emisión del evento de completado usa una función `emitOutbox` local en lugar del patrón canónico `emitDomainEvent` (HE-16), arriesgando pérdida silenciosa del evento. Los tres son P1 ALTO y deben cerrarse antes de Go-Live. Adicionalmente: la inmutabilidad post-`completo` depende solo de la policy RLS (sin trigger), más débil que en otros documentos (ver Drift §3); el ítem `discrepancia_detectada` no se evalúa ni emite (un checklist puede registrarse con ítems verificado=false sin alerta).

**Errores comunes a evitar**:
- Tildar el checklist sin haber hecho la pausa verbalmente con el equipo — el registro queda pero el beneficio clínico no.
- Aceptar avance a Time-Out con Sign-In incompleto (algún ítem `verificado=false` sin justificación) — el router actual lo permite; PENDIENTE validación dura.
- Confiar en el `responsable_id` del JSONB para auditar quién verificó la fase — hoy todos quedan registrados como UUID-cero (HE-17).
- Asumir que el evento `ece.who_checklist.completado` activó downstream (notificación a URPA, alta administrativa, facturación) — el outbox actual usa función local que puede fallar silenciosamente (HE-16).
- Crear segundo checklist para el mismo acto quirúrgico — la constraint `uq_who_checklist_acto` lo bloquea (correcto), pero usuarios pueden intentarlo confundidos por el flujo de re-entrada.
- Omitir el Sign-Out por falta de tiempo en cirugía larga — viola la implementación obligatoria del TDR §13.3 y el conteo de gasas/agujas queda sin documentar (riesgo médico-legal alto).
- Capturar `antibiotico_profilactico` como verificado cuando se administró fuera de la ventana de 60 min — el ítem requiere **administración en los 60 min previos a la incisión**, no antes.
- Confundir el path UI `/ece/quirofano/who-check` con el referenciado en el briefing como `/ece/cirugia/who` — verificar nomenclatura del proyecto antes de crear rutas paralelas (regla CLAUDE.md "adecuar, no duplicar").
