# CERT_DIR — Certificación del Director Médico (Art. 21 NTEC)

> **Nota de modelado importante.** `CERT_DIR` **NO es un `tipo_documento` independiente** en la implementación actual (no aparece en `ece.tipo_documento`). Es la **acción transversal `certificar`** ejecutada por el rol `DIR` sobre **tres** tipos de documento del expediente: `FICHA_ID`, `EPICRISIS` y `CERT_DEF` (Art. 21 NTEC del Acuerdo n.° 1616 / MINSAL 2024). Este archivo documenta dicho flujo de cierre administrativo / certificación oficial del expediente y su gobernanza, no un formulario único. Cualquier referencia a `ece.certificacion_director` como tabla independiente es **drift documental** (ver §Drift conocido).

## Metadata

- **codigo**: `CERT_DIR` (alias funcional — **NO es código de `ece.tipo_documento`**; es la acción `certificar` aplicada por DIR)
- **nombre**: Certificación del Director Médico (cierre formal y autorización de copias del expediente)
- **modalidad**: AMBULATORIO + EMERGENCIA + HOSPITALIZACION — aplica a:
  - `FICHA_ID` (maestro, raíz del expediente; modalidad sembrada `ambos` con CONS_EXT y HOSP)
  - `EPICRISIS` (hospitalario / cierre de episodio con ingreso)
  - `CERT_DEF` (hospitalario / fallecimiento intra-hospitalario)
- **NTEC artículo**: **Art. 21** del Acuerdo n.° 1616 (D.O. T.444 N°158, MINSAL 2024) — "Solo Dirección o su delegado puede certificar copia del expediente". Concordancias: Art. 32 (Comité del Expediente Clínico — verificación de integridad documental), Art. 19–21 (foliado y archivo permanente), Art. 55–56 (metadatos obligatorios + bitácora ≥ 2 años para todo acto de certificación). El TDR §15 ("Tableros gerenciales — director médico") referencia la responsabilidad institucional.
- **modulo_his_target**: `/(admin)/ece/certificacion` (legacy nuevo, ruta actual implementada en `apps/web/src/app/(admin)/ece/certificacion/page.tsx`). **NO crear** ruta `/admin/medical-director` ni `/ece/certificacion-director` adicional — la cola unificada `eceCertificacion.listCola` ya cubre los tres tipos certificables. Acceso restringido al rol `DIR`.
- **tabla_datos**: La certificación **NO tiene tabla propia**. Vive en:
  - `ece.documento_instancia.estado_actual_id` → estado `certificado` (es_final=true)
  - `ece.documento_instancia_historial` con `accion = 'certificar'` (append-only, append-immutable por trigger `trg_historial_inmutable`)
  - `ece.firma_electronica` (referenciada vía `firma_id` del historial)
  - `audit.audit_log` (eventos dominio `ece.documento.certificado` con hash chain prev/payload/chain)
  - **Drift documental**: el prompt original menciona `ece.certificacion_director` — esta tabla **no existe**. PENDIENTE — validar con @DBA si debe crearse como vista materializada para auditoría consolidada (caso de uso: reporte SNIS por evento centinela).
- **inmutable**: **TRUE post-certificación**. El estado `certificado` es terminal (`es_final = true` en `ece.flujo_estado.orden = 5`). No existe transición de salida en `ece.flujo_transicion` distinta de `anular` (transición universal, requiere firma del propio DIR + causa documentada). El historial es append-only físico (trigger). El `payload_hash` SHA-256 del documento certificado se conserva en el evento outbox.
- **tipo_registro**: CONDICIONAL — el universo de documentos sujetos a certificación está acotado por norma (no se certifica TODO documento, solo los 3 listados). La obligación se gatilla por evento:

  | Evento | Documento que requiere certificación DIR | Obligación |
  |---|---|---|
  | Fallecimiento intra-hospitalario | `CERT_DEF` | **SI** (Art. 35 NTEC — 10 años retención + certificación copias) |
  | Egreso hospitalario con eventos centinela | `EPICRISIS` | **SI** (Art. 21 + Comité ECE Art. 32) |
  | Apertura de expediente | `FICHA_ID` | **SI** (al alcanzar `validado`, antes de certificar copias para entrega) |
  | Queja / reclamo formal con autoridad competente | `EPICRISIS` + documentos asociados | **SI** (autoriza entrega — Art. 21) |
  | Egreso electivo sin eventos | `EPICRISIS` | **NO directamente** — auditoría aleatoria por Comité ECE (Art. 32) |
  | Requerimiento judicial / autoridad competente | Copia certificada del expediente | **SI** — DIR autoriza extracción y certifica |

## Propósito normativo

La Certificación del Director Médico (Art. 21 NTEC) es el **acto formal de cierre administrativo** por el cual el Director del establecimiento (o su delegado expresamente autorizado, en cuyo caso el delegado actúa con rol `DIR` en el ECE) declara que el documento clínico cumple los requisitos normativos del Acuerdo n.° 1616 y autoriza su uso para:

1. **Archivo permanente** del expediente clínico (Arts. 19–21 — foliado y conservación).
2. **Emisión de copias certificadas** a paciente, representante legal o autoridad competente.
3. **Entrega a autoridad judicial** o sanitaria con vínculo legal verificable.
4. **Reporte a SNIS** para eventos centinela, fallecimientos y vigilancia epidemiológica.
5. **Cierre formal del episodio** como soporte para indicadores institucionales (TDR §15 — tableros gerenciales DIR).

La certificación **no sustituye ni rehace la valoración clínica** (esa responsabilidad fue del médico tratante en `validar`); es un **control de gobernanza institucional** sobre la integridad documental: que el documento esté completo, firmado, validado y con la cadena de custodia intacta. Por eso opera únicamente sobre documentos en estado `validado` y el rol que la ejecuta es exclusivamente `DIR` (no `MC` ni `ESP`).

La acción concreta del DIR en el ECE consiste en **avanzar el estado de la instancia documental de `validado` a `certificado`**, dejando rastro inmutable en `documento_instancia_historial` con su PIN argon2id y emitiendo evento de dominio `ece.documento.certificado` vía outbox transaccional (Beta.15 notifications).

## Dependencias (depende_de)

La acción `certificar` por DIR exige precondiciones estrictas (las tres se validan en `certificarOneInTx`, `packages/trpc/src/routers/ece/certificacion.router.ts:179-228`):

1. **Estado precedente = `validado`**: el documento debe haber recorrido `borrador → en_revision → firmado → validado` (o `borrador → firmado → validado` si es inmutable como EPICRISIS y CERT_DEF). Cualquier otro estado lanza `PRECONDITION_FAILED`.
2. **Tipo documental certificable**: el `tipo_documento.codigo` debe estar en `{FICHA_ID, EPICRISIS, CERT_DEF}` (set duro `TIPOS_CERTIFICABLES` en router). Cualquier otro tipo lanza `FORBIDDEN`.
3. **Firma electrónica DIR configurada**: el usuario DIR debe tener `ece.firma_electronica` con `pin_hash` argon2id válido, no revocada (`revoked_at IS NULL`) y no bloqueada (`locked_until IS NULL OR locked_until <= now()`).
4. **Episodio cerrado** (implícito, no enforzado en router pero sí en flujo): para EPICRISIS, requiere `EceEpisodioAtencion.estado IN ('egresado','fallecido')`. Para CERT_DEF, requiere certificación de defunción firmada por MC.
5. **Permiso ECE granular**: `requireEcePermission("ece.documento.certificar")` (middleware en `packages/trpc/src/middleware/ece-permission.ts`).

Documentos asociados al cierre administrativo (no son dependencias técnicas pero **deben coexistir** según Art. 32 — Comité ECE):

- Codificación CIE-10 final del episodio (Arts. 16, 17 NTEC).
- Indicaciones de alta firmadas (`IND_MED`).
- Receta de egreso (cuando aplique).
- Foliado y registro de archivo (`DOC_ASOC` operativo, Art. 37).

## Obligatoriedad por modalidad / contexto

| Modalidad | Documento | Obligatoriedad CERT_DIR | Justificación |
|---|---|---|---|
| HOSPITALIZACION (defunción) | `CERT_DEF` | **SI obligatorio** | Art. 35 NTEC — retención 10 años + certificación de copias |
| HOSPITALIZACION (egreso vivo con evento centinela) | `EPICRISIS` | **SI obligatorio** | Art. 32 — Comité ECE revisa y DIR certifica |
| HOSPITALIZACION (egreso electivo sin eventos) | `EPICRISIS` | **NO automático** — selección por auditoría aleatoria | Sólo si Comité ECE marca para revisión |
| AMBULATORIO (cierre de expediente) | `FICHA_ID` | **SI obligatorio** al alcanzar `validado` | Raíz del expediente — Art. 15 NTEC |
| EMERGENCIA (sin ingreso) | `FICHA_ID` (si primera apertura) | **SI obligatorio** | Mismo régimen que ambulatorio |
| Requerimiento legal / judicial | Cualquiera de los 3 + documentos asociados | **SI obligatorio** | Art. 21 — autoridad judicial via DIR |
| Reclamo / queja formal | `EPICRISIS` + documentos del episodio | **SI obligatorio** | Soporta entrega documental auditable |

**Plazo recomendado de certificación** (no normado por NTEC pero parametrizable en el HIS — semáforo en UI):

- < 3 días: verde, "en plazo".
- 3-7 días: ámbar, "próximo a vencer".
- > 7 días: rojo, "urgente".

Fuente del semáforo: `calcularSemaforo()` en `apps/web/src/app/(admin)/ece/certificacion/page.tsx:84-89`. PENDIENTE — validar SLA institucional con @PO/@AE.

## Roles firmantes / actores

| Rol | Acción | Momento | Observación |
|---|---|---|---|
| `DIR` (Director Médico) | Ejecuta transición `certificar` con firma electrónica simple (PIN argon2id 6-8 dígitos) | Post-`validado`, al recibir cola de pendientes | Único rol con permiso `ece.documento.certificar` en seed `63_ece_08_seed.sql:329` (FICHA_ID), :521 (CERT_DEF); EPICRISIS hereda Art. 21 |
| Delegado de DIR | Mismo `DIR` (sin rol separado) | Cuando el titular delega expresamente | El delegado debe ser cargado con rol `DIR` en `MembershipRole` del HIS; la delegación es nominal y se audita por `ejecutado_por` en historial |
| Coordinador de Calidad / Comité ECE | Pre-revisión (opcional) → genera **minuta** del Comité (`comiteEce.create` + `comiteEce.firmar`, Art. 32) | Pre-certificación cuando el documento entra a revisión por evento centinela | Ver `apps/web/src/app/(admin)/ece/comite/page.tsx`. La minuta no es prerrequisito técnico de CERT_DIR pero es práctica institucional sembrada |
| `MC` (Médico tratante) | Firmó y validó previamente (`firmar` + `validar`) | Pre-`validado` | Sin firma MC válida no hay `validado`, por tanto no hay CERT_DIR posible |
| `ARCH` (Archivo Clínico) | Verifica integridad documental, foliado | Pre y post certificación | Soporte logístico — no firma CERT_DIR |
| `ADMIN` | Acceso lectura al historial certificatorio | Auditoría | Sin permiso de ejecutar |

## Campos obligatorios mínimos NTEC

Como la certificación se modela como **acción de workflow** y no como tabla nueva, los "campos" se materializan en el registro de `ece.documento_instancia_historial` (Prisma `EceDocumentoInstanciaHistorial`, `schema.prisma:4868`):

| Campo (historial) | Fuente | Obligación NTEC |
|---|---|---|
| `instancia_id` | `documento_instancia.id` certificado | Art. 15 (raíz expediente) |
| `estado_anterior_id` | Estado `validado` del `tipo_documento` | Art. 55 (trazabilidad de cambios) |
| `estado_nuevo_id` | Estado `certificado` (es_final=true) del `tipo_documento` | Art. 55 |
| `accion` | Literal `'certificar'` | Art. 55 |
| `ejecutado_por` | `User.id` del DIR (FK a `ece.personal_salud` via `his_user_id`) | Art. 23 lit. a.4 (vínculo único usuario↔acto) |
| `rol_ejecutor_id` | FK al rol `DIR` en `ece.rol` | Art. 21 (restricción por rol) |
| `firma_id` | FK a `ece.firma_electronica` del DIR | Art. 23 lit. a.4 (firma electrónica simple) |
| `observacion` | Texto generado: `"Certificación DIR Art. 21 NTEC — hash: <16 chars>…"` | Art. 56 (bitácora con detalle) |
| `ejecutado_en` | `now()` con precisión a segundo (timestamptz) | Art. 55 (timestamp nivel segundo) |

Campos lógicos derivados (no persisten como columna pero forman parte del payload del evento `ece.documento.certificado`):

- `payloadHash`: SHA-256 de `{instanciaId, tipoCodigo, version, dirUserId, firmaId}`. Inmutabilidad criptográfica para verificación posterior.
- `tipoDocumentoCodigo`: uno de `FICHA_ID | EPICRISIS | CERT_DEF` (gate `TIPOS_CERTIFICABLES`).
- `evento_relevante` (lógico, derivado del tipo): `APERTURA_EXPEDIENTE` (FICHA_ID), `EGRESO_HOSPITALARIO` (EPICRISIS), `DEFUNCION_INTRA_HOSPITALARIA` (CERT_DEF), `EVENTO_CENTINELA` (EPICRISIS con marca Comité), `QUEJA_FORMAL` (set por proceso lateral), `REQUERIMIENTO_LEGAL` (set por mesa de entrada).
- `expediente_completo`: implícito — al estar el documento `validado` y haber pasado por Comité ECE cuando aplique, el checklist se considera satisfecho. PENDIENTE — validar con @QAF si conviene materializar el checklist como JSONB en `ece.bitacora_auditoria` para evidencia explícita.
- `hallazgos_observacion` / `acciones_correctivas_indicadas`: no se capturan en el historial actual. Si el documento se devuelve, la acción es `anular` con `observacion` documentada (transición universal de anulación, seed `63_ece_08_seed.sql:300-314`). PENDIENTE — proponer transición `devolver_a_validar: certificado → validado` con motivos parametrizados como nuevo trabajo de @AS/@AE (no existe hoy).
- `conformidad_ntec`: implícito booleano — el simple hecho de avanzar a `certificado` es la declaración de conformidad. La no conformidad se expresa con `anular` (no con un nuevo estado).

## Estados (flujo_estado)

Sembrados por bloque DO de `63_ece_08_seed.sql:122-177` **solo para** `tipo_documento.codigo IN ('FICHA_ID','EPICRISIS','CERT_DEF')` (variable `necesita_certificacion`):

- `borrador` (inicial, orden 1)
- `en_revision` (orden 2, **omitido para inmutables EPICRISIS/CERT_DEF**)
- `firmado` (orden 3)
- `validado` (orden 4) — **deja de ser final** porque hay `certificado`
- `certificado` (orden 5, **es_final=true**) — terminal de la cadena de certificación
- `anulado` (orden 9, es_final=true) — final universal alternativo

Diagrama lineal:

```
[borrador] → [en_revision*] → [firmado] → [validado] → [certificado]
                                                 ↘
                                                  [anulado]
```

\* Omitido en documentos inmutables: EPICRISIS y CERT_DEF van de `borrador` directo a `firmado`.

## Transiciones (flujo_transicion)

Sembradas en `63_ece_08_seed.sql:200-278`:

### FICHA_ID

| origen | destino | acción | rol que autoriza | requiere firma | condición |
|---|---|---|---|---|---|
| borrador | en_revision | `enviar_revision` | ARCH | NO | Captura completa Art. 15 |
| en_revision | firmado | `firmar` | ARCH | **SI** | PIN ARCH |
| firmado | validado | `validar` | ARCH | NO | Verificación cruzada |
| validado | **certificado** | **`certificar`** | **DIR** | **SI** | **Art. 21 NTEC — PIN DIR** |
| borrador | anulado | `anular` | DIR | SI | Causa documentada (transición universal) |

### EPICRISIS (inmutable)

| origen | destino | acción | rol que autoriza | requiere firma | condición |
|---|---|---|---|---|---|
| borrador | firmado | `firmar` | MC | **SI** | Médico tratante |
| firmado | validado | `validar` | ESP | NO | Visto del jefe de servicio |
| validado | **certificado** | **`certificar`** | **DIR** | **SI** | **Art. 21 NTEC** |
| borrador | anulado | `anular` | DIR | SI | Universal |

### CERT_DEF (inmutable)

| origen | destino | acción | rol que autoriza | requiere firma | condición |
|---|---|---|---|---|---|
| borrador | firmado | `firmar` | MC | **SI** | Médico que certifica defunción |
| firmado | validado | `validar` | MC | NO | Auto-validación del certificante |
| validado | **certificado** | **`certificar`** | **DIR** | **SI** | **Art. 21 NTEC — autoriza copias** |
| borrador | anulado | `anular` | DIR | SI | Universal |

Transiciones bloqueadas (no sembradas):

- `certificado → cualquier estado distinto de anulado` — terminal.
- `validado → certificado` ejecutada por rol distinto de `DIR` — `FORBIDDEN`.
- `validado → certificado` sobre `tipo_documento.codigo` no en `{FICHA_ID, EPICRISIS, CERT_DEF}` — `FORBIDDEN` (gate de set duro en router).

## Eventos de dominio

Convención: `ece.documento.<accion>`. Payload publicado vía `emitDomainEvent` (outbox transaccional, Beta.15 notifications).

### `ece.documento.certificado`

Emitido por `certificarOneInTx` al concluir transición `validado → certificado`:

```json
{
  "instanciaId": "<uuid>",
  "tipoDocumentoCodigo": "FICHA_ID | EPICRISIS | CERT_DEF",
  "fromEstadoCodigo": "validado",
  "firmaId": "<uuid de ece.firma_electronica>",
  "payloadHash": "<sha256(instanciaId+tipo+version+dirUserId+firmaId)>",
  "dirUserId": "<uuid del User DIR>",
  "pacienteId": "<uuid>"
}
```

Suscriptores esperados (vía routing por `eventType`):

- **Notificaciones Beta.15** — alerta al paciente / representante de disponibilidad de copias certificadas (cuando se solicite).
- **SNIS / vigilancia** — para CERT_DEF y EPICRISIS con evento centinela, reporte a vigilancia epidemiológica (PENDIENTE — verificar handler concreto en `packages/infrastructure`).
- **Tableros gerenciales TDR §15** — actualización de KPIs DIR (tasa de certificación, plazo medio, eventos centinela pendientes).
- **Audit hash chain** (`audit.audit_log`) — toda escritura a `ece.documento_instancia` y `ece.documento_instancia_historial` dispara trigger que genera `prev_hash || payload_hash → chain_hash` (TDR §6.3, SQL `02_audit_triggers.sql` + `05_audit_hash_chain.sql`).

### Otros eventos del ciclo

- `ece.documento.certificacion_requerida` — **NO IMPLEMENTADO** hoy. PENDIENTE — proponer como evento derivado al alcanzar `validado` sobre los 3 tipos certificables, para alimentar la cola en tiempo real sin polling. Hoy la cola se calcula on-demand vía `listCola`.
- `ece.documento.certificacion_devuelta` — **NO IMPLEMENTADO** (no hay transición de retroceso, solo `anular`).
- `ece.documento.anulado` — sí existe vía transición universal de anulación; payload incluye `observacion` con motivo.

## Bulk certificación

El router expone `certificarBulk` (verifica PIN UNA VEZ, certifica hasta 100 documentos en serie en transacciones independientes; reporta `{exitosos, fallidos}`). Es funcionalidad operativa para el DIR cuando hay backlog. UI: botón "Certificar seleccionados" en `apps/web/src/app/(admin)/ece/certificacion/page.tsx`.

Cada documento del bulk emite su propio evento `ece.documento.certificado` y su propia entrada en historial. No hay batch ID compartido — cada certificación es atómica e independiente.

## Drift conocido (audit) y riesgos

Hallazgos detectados al 2026-05-22 (consolidar con auditoría Stream B / Stream J si aplica):

- **CERT-DIR-001 [P1 — ALTO]** El prompt del backlog (`docs/backlog/fase2/_insumos/analisis_workflows_ece.md`) y el template original menciona `ece.certificacion_director` como tabla independiente. **No existe**. La certificación vive en `documento_instancia_historial`. Si se requiere reporte consolidado (caso de uso SNIS), crear **vista** `ece.v_certificacion_director` (SELECT JOIN sobre historial + tipo_documento + firma) en vez de tabla nueva, para no duplicar fuente de verdad. PENDIENTE — proponer migración SQL a @DBA.
- **CERT-DIR-002 [P1 — ALTO]** Sin evento `ece.documento.certificacion_requerida`. La cola se calcula on-demand. Para SLA estricto (semáforo rojo > 7 días) conviene emitir evento al pasar a `validado`, persistir en outbox y consumir por proceso de notificaciones (correo / push) al DIR.
- **CERT-DIR-003 [P2 — MEDIO]** No hay transición `devolver_a_validar` (`certificado → validado` o `validado → en_revision`). El único camino de "rechazo" es `anular`, que es drástico. Si DIR detecta faltantes (ej. falta CIE-10 en EPICRISIS), debe `anular` + crear nueva instancia. PENDIENTE — proponer a @AS transición intermedia parametrizada con `motivo_devolucion` JSONB.
- **CERT-DIR-004 [P2 — MEDIO]** No se materializa el "checklist de documentos obligatorios firmados" como evidencia explícita. El supuesto es: si EPICRISIS llegó a `validado`, todos los documentos dependientes están presentes. **Eso no es verdad** automáticamente — la dependencia se valida en la creación, no en el cierre del episodio. PENDIENTE — @QAF propone validación cross-documental al avanzar a `validado` en EPICRISIS.
- **CERT-DIR-005 [P2 — MEDIO]** Campo `evento_relevante` propuesto en el template (`DEFUNCION|CENTINELA|QUEJA|REVISION_RUTINA`) **no se persiste** hoy. Está implícito en el `tipo_documento.codigo` y en datos colaterales del episodio. Si se requiere para reportería (separar centinela vs rutina), proponer columna `evento_relevante` en `ece.bitacora_auditoria` o en vista materializada CERT-DIR-001.
- **CERT-DIR-006 [P3 — BAJO]** Sin ruta `/admin/medical-director` distinta de `/(admin)/ece/certificacion`. Sidebar muestra **una** entrada "Certificación DIR". La regla de no duplicar (CLAUDE.md "Adecuar legacy vs duplicar") se respeta. No hay acción requerida.
- **CERT-DIR-007 [P2 — MEDIO]** Lockout argon2id tras 3 intentos fallidos (`failed_attempts` + `locked_until`) está implementado en `checkPinDir`, pero los intentos fallidos del flow bulk **no se acumulan** correctamente (el PIN se valida una sola vez al inicio, no por documento). Bajo riesgo — si el PIN inicial es válido, los documentos individuales no piden PIN. Pero si el PIN inicial es incorrecto, sólo cuenta como 1 intento aunque sean 100 documentos. Es **correcto** desde UX, pero revisar política de seguridad si se requiere endurecimiento.
- **CERT-DIR-008 [Drift documental]** El TDR menciona "director médico" sólo en §15 (tableros gerenciales). No expone explícitamente Art. 21 NTEC. La fuente normativa primaria es el Acuerdo n.° 1616. PENDIENTE — alinear referencia en TDR (commit menor).

## Descripción markdown rica (para BD `descripcion_markdown` si se materializa vista CERT-DIR-001)

> **Certificación del Director Médico — Art. 21 NTEC** — Acción de cierre administrativo del expediente clínico ejecutada por el **Director Médico** (o su delegado expreso con rol DIR) que **autoriza el archivo permanente** y **habilita la emisión de copias certificadas** a paciente, representante legal o autoridad competente (judicial, sanitaria, ISSS, SNIS).
>
> **Cuándo se ejecuta:** el documento debe estar en estado `validado` (post firma del médico tratante y visto bueno cuando aplique — EPICRISIS requiere ESP). Solo aplica a **tres** tipos documentales: `FICHA_ID` (raíz del expediente, al abrir), `EPICRISIS` (cierre de hospitalización, especialmente con evento centinela), `CERT_DEF` (fallecimiento intra-hospitalario, autorización de entrega de cuerpo y copias). Para egresos electivos sin eventos, la certificación se ejecuta por **auditoría aleatoria** del Comité del Expediente Clínico (Art. 32) y no automáticamente sobre cada egreso.
>
> **Qué NO es:** **no es valoración clínica** (eso es `validar` por MC/ESP), **no es firma del documento clínico** (eso es `firmar` por MC), **no es revisión de calidad** (eso es el **Comité ECE**, módulo aparte `/(admin)/ece/comite` con minutas firmadas Art. 32). Es **control institucional** sobre la integridad y conformidad del documento previo a su entrega/archivo permanente.
>
> **Quién la ejecuta:** únicamente el rol `DIR` (Director Médico) con permiso ECE granular `ece.documento.certificar`. La delegación se hace nominalmente cargando al delegado con `MembershipRole = DIR`; la delegación queda auditada por `ejecutado_por` en el historial. **Está prohibido** que MC, ESP, ARCH u otro rol ejecute esta acción (gate duro en router tRPC y en `flujo_transicion`).
>
> **Cómo se ejecuta:** el DIR ingresa a `/(admin)/ece/certificacion`, recibe la **cola de documentos validados pendientes de certificar** (FIFO por antigüedad, con semáforo verde/ámbar/rojo a 3/7 días), filtra por servicio, selecciona uno o múltiples documentos (bulk hasta 100), e ingresa su **PIN de firma electrónica simple** (6-8 dígitos, hash argon2id en `ece.firma_electronica`). El sistema verifica el PIN una sola vez, avanza el estado `validado → certificado` en cada documento dentro de una transacción independiente, registra entrada inmutable en `ece.documento_instancia_historial` con SHA-256 del payload, emite evento `ece.documento.certificado` en outbox y actualiza la `audit_log` con hash chain. Tras 3 PINs fallidos, la firma se bloquea temporalmente.
>
> **Inmutabilidad:** el estado `certificado` es terminal. Sólo se puede salir vía `anular` (causa documentada, firma DIR). Toda escritura al historial es append-only por trigger físico (`trg_historial_inmutable`). El `payload_hash` SHA-256 permite verificación posterior de integridad — cualquier tampering en `documento_instancia` se detecta al recomputar el hash y compararlo con el evento outbox + audit chain.
>
> **Errores comunes:**
> - **Confundir certificación con validación.** La validación es del médico (MC/ESP); la certificación es del director. Son actos distintos con responsabilidades legales distintas.
> - **Solicitar certificación de tipos no certificables** (ej. HIST_CLIN, IND_MED, EVOL_MED). El router rechaza con `FORBIDDEN`. Solo `FICHA_ID`, `EPICRISIS`, `CERT_DEF` son certificables por DIR (Art. 21 NTEC).
> - **Querer "devolver" un documento certificado para corregir.** Hoy no existe `devolver_a_validar`. La única salida es `anular` y crear nueva instancia. PENDIENTE — propuesta de transición intermedia (CERT-DIR-003).
> - **Asumir que un documento `validado` con dependencias incompletas no se puede certificar.** Hoy no hay chequeo cross-documental al certificar. Es responsabilidad del flujo upstream (Comité ECE, validador MC/ESP) que el episodio esté íntegro. CERT-DIR-004 lo flaggea como riesgo.
> - **Ejecutar bulk sin filtrar por servicio.** El DIR puede certificar masivamente, pero pierde trazabilidad operativa. Se recomienda filtrar por servicio y procesar por lotes pequeños (< 20) para conservar contexto.
> - **Olvidar que el DIR delegado debe estar cargado como `DIR` en `MembershipRole`.** Si se le da permiso ad-hoc sin actualizar el rol, el middleware rechaza la acción.
>
> **Outputs aguas abajo:**
> - **Archivo permanente** físico/digital con foliado completo (ARCH).
> - **Copias certificadas** emitibles a paciente o autoridad bajo cadena de custodia.
> - **Reportes a SNIS** (vigilancia epidemiológica para CERT_DEF, eventos centinela).
> - **Tableros DIR** (TDR §15) — KPIs de plazo de certificación, tasa de anulación, eventos centinela.
> - **Insumos para Comité ECE** Art. 32 — para revisión de calidad documental periódica.
