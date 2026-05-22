# HOJA_ING — Hoja de Ingreso Hospitalario

## Metadata
- **codigo**: HOJA_ING
- **nombre**: Hoja de Ingreso Hospitalario
- **modalidad**: HOSPITALIZACION
- **NTEC artículo**: Art. 34 (conservación 5 años activo) + §3.12 (estructura) + Art. 17 lit. b (apertura del episodio) + Art. 39 (firma electrónica simple) + Art. 55-56 (metadatos obligatorios)
- **modulo_his_target**: `/admission` (legacy, wizard 4 pasos) + extensión ECE vía bridge `eceBridgeAdmision.admitirDesdeOrden`
- **tabla_datos**: `public.Encounter` (admissionType=`EMERGENCY`|`SCHEDULED`|`TRANSFER_IN` con `serviceUnitId`) + `public.BedAssignment` + bridge `ece.hoja_ingreso` (1:1 `episodio_id`) + `ece.episodio_atencion` (modalidad=`hospitalario`) + `ece.episodio_hospitalario` + `ece.asignacion_cama`
- **inmutable**: true post-firma (estado `firmado` → `validado`). Pre-firma admite `update` en `borrador` y `anular` por DIR.
- **tipo_registro**: OBLIGATORIO (transaccional / cabecera de episodio)

## Propósito normativo

Art. 34 NTEC: la **Hoja de Ingreso** es el documento administrativo-clínico que **abre el episodio hospitalario** y formaliza el internamiento del paciente. Vincula:

1. Una **Orden de Ingreso** (`ORD_ING`) previamente firmada por el médico tratante (MT) y validada por el médico de cabecera (MC), con el episodio físico de atención.
2. La **identidad del paciente** (`FICHA_IDENT`) ya registrada en el archivo clínico.
3. El **servicio de destino** (medicina interna, cirugía, gineco-obstetricia, pediatría, UCI, UCIN, etc.) y la **cama asignada** del establecimiento.
4. El **responsable administrativo de la admisión** (rol ADM o AC en ISSS), que firma electrónicamente con PIN argon2id.
5. La **validación posterior del archivista** (rol ARCH), que confirma integridad documental antes de archivar el episodio.

Como **raíz del expediente hospitalario**, su firma dispara la cascada de documentos dependientes obligatorios: valoración inicial de enfermería en primeras 24 h, indicaciones médicas diarias, registro de enfermería continuo, hoja de signos vitales seriada, y eventualmente la epicrisis al egreso. **Ningún acto clínico hospitalario puede registrarse sin una HOJA_ING firmada previamente** — el motor de workflow ECE bloquea la creación de documentos dependientes hasta que la instancia HOJA_ING esté en estado `firmado` o `validado`.

## Dependencias

| Dependencia | Tipo | Estado requerido | Origen |
|---|---|---|---|
| FICHA_IDENT | Hard (bloqueante) | activo (`paciente_id` resuelto) | Art. 15 NTEC. Raíz del expediente. |
| ORD_ING | Hard (bloqueante) | `validado` (firmada MT + validada MC) | Doc 11 NTEC §3.11. Sin orden validada el bridge `admitirDesdeOrden` lanza `PRECONDITION_FAILED`. |
| ATN_EMERG | Soft (informativo) | `firmado` si `procedencia=EMERGENCIA` | Doc 5 NTEC §3.5. Cuando el ingreso viene de emergencia, hereda diagnóstico y signos vitales. |
| CONS_INF (HOSPITALIZACION) | Soft (informativo) | `firmado` por paciente + médico | Si el ingreso es electivo con procedimiento previsto, debe existir consentimiento informado de hospitalización antes de cualquier indicación quirúrgica. Documentación cruzada con `/consents` o `/ece/consentimiento`. |
| `public.Bed` disponible | Hard (operacional) | `estado='disponible'` | Si `camaAsignadaId` se provee, el bridge marca la cama como `ocupada` atómicamente en la misma tx. |

## Obligatoriedad

**SIEMPRE** en modalidad HOSPITALIZACION, tanto si la admisión es:

- **Por urgencia** (`procedencia='EMERGENCIA'`, `modalidad='urgente'`): el médico de emergencia emite ORD_ING tras decidir ingreso (Art. 17b NTEC). El ADM completa la HOJA_ING al recibir al paciente en el servicio.
- **Programada / Electiva** (`procedencia='CONS_EXT'` o `'PROGRAMADO'`, `modalidad='programado'`): admisiones agendadas con anticipación, típicamente para cirugía o procedimiento que requiere internamiento.
- **Por traslado** (`procedencia='TRASLADO'`, `circunstancia_ingreso='traslado'`): paciente referido de otro hospital o desde otro servicio interno (UCI → hospitalización general, p. ej.).
- **Por riesgo social** (`circunstancia_ingreso='riesgo_social'`): ingreso por causa social/psiquiátrica con respaldo de trabajo social y dirección.

**Excluida** explícitamente para:

- Hospital de día (< 24 h sin pernocta): se usa otra plantilla operativa según política institucional; no genera HOJA_ING formal NTEC §3.12.
- Atención ambulatoria (consulta externa, emergencia sin ingreso, observación < 24 h): registra en HIST_CLIN o ATN_EMERG.
- Atención del recién nacido por parto hospitalario: genera expediente automático del RN (con su propia FICHA_IDENT y un episodio neonatal), no HOJA_ING materna duplicada.

## Roles firmantes

| Rol | Acción | Momento | Mecanismo |
|---|---|---|---|
| **MT / MC** | Emite ORD_ING (precondición) | Antes de la admisión | Firma electrónica simple en `ece.orden_ingreso` (Doc 11). |
| **ADM / AC** | Llena HOJA_ING + firma | Recepción del paciente en el establecimiento | PIN electrónico verificado contra `ece.firma_electronica.pin_hash` (argon2id). Lockout tras 5 intentos. |
| **ENF** | Inicia VAL_INI_ENF (documento dependiente) | Primeras 24 h post-firma de HOJA_ING | Recepción de enfermería + plan de cuidados. Disparado por evento `ece.hoja_ingreso.firmada`. |
| **ARCH** | Valida integridad documental | Post-firma del ADM | Verificación de adjuntos, datos administrativos completos. Transición `firmado → validado`. |
| **DIR** | Anula la hoja (excepcional) | Solo pre-validación | Estados permitidos: `borrador`, `en_revision`, `firmado`. No puede anular `validado`. |

> Art. 21 NTEC: solo la **Dirección del establecimiento o su delegado** está autorizada a certificar copias del expediente y a anular documentos pre-archivados. Esto se modela como `requireRole(["DIR"])` en `anular()`.

## Campos obligatorios NTEC

Estructura mínima conforme NTEC §3.12 + Art. 55-56 (metadatos obligatorios):

```
motivo_ingreso                   text            (heredado de ORD_ING.motivo_ingreso)
antecedentes_pat                 object          { HEA, HEP, alergias[], medicacion_habitual[] }
examen_fisico_completo           text            por sistemas + signos vitales de ingreso
diagnostico_principal_ingreso    string          CIE-10 obligatorio (presuntivo o definitivo)
diagnosticos_secundarios         string[]        CIE-10[] opcional
plan_terapeutico                 text            indicaciones iniciales + estudios + interconsultas
via_ingreso                      enum            URGENCIA | ELECTIVO | REFERIDO | TRASLADO
circunstancia_ingreso            enum            demanda_espontanea | programado | riesgo_social | traslado
modalidad                        enum            urgente | programado    (Zod: MODALIDAD_INGRESO)
procedencia                      enum            EMERGENCIA | CONS_EXT | TRASLADO | OTRO  (string libre 1-40 char en bridge)
servicio_destino                 uuid FK         MED_INT | CIRUGIA | GINECO | PEDIATRIA | UCI | UCIN | UCIP | UCO
cama_asignada                    uuid FK         opcional pero requerida para SCHEDULED. EMERGENCY puede asignarla diferida.
responsable_admision             uuid FK         `ece.personal_salud.id` del ADM
fecha_hora_ingreso               timestamptz     resolución a segundo (Art. 56)
firma_medico_tratante            uuid FK         heredado de ORD_ING firmada (no se duplica)
firma_administrativa             uuid FK         `ece.firma_electronica.id` del ADM al firmar
metadatos_obligatorios           object          { usuario_creador, timestamp, establecimiento_id, institucion_id, version, bitácora_modificaciones[] }
```

> **Drift conocido**: varios de estos campos hoy se serializan en `datos_administrativos JSONB` y no como columnas explícitas (ver sección "Drift conocido"). El router `hoja-ingreso.router.ts` actualmente persiste `modalidad`, `procedencia`, `diagnosticoIngreso`, `motivoConsulta`, `notasAdicionales` dentro del JSONB.

## Estados

```
borrador  ──┐ (ADM llena los datos)
            │
            ├─enviar_revision──► en_revision  (ADM completó, antes de firma)
            │
            ├─firmar──────────► firmado       (ADM verifica PIN argon2id) ◄── disparador outbox
            │                       │
            │                       └─validar─► validado  (ARCH OK integridad)
            │
            └─anular──────────► anulado       (DIR — desde borrador, en_revision o firmado; NO desde validado)
```

## Transiciones

| origen | destino | rol | condición | acción tRPC |
|---|---|---|---|---|
| `borrador` | `en_revision` | ADM | datos administrativos completos | `enviar_revision` (interna en seed; el router actual permite firmar directo desde borrador) |
| `borrador` | `firmado` | ADM | PIN correcto + ORD_ING `validado` + no existe HOJA_ING activa para esa orden | `eceHojaIngreso.firmar({ id, pin })` |
| `en_revision` | `firmado` | ADM | PIN correcto | `eceHojaIngreso.firmar({ id, pin })` |
| `firmado` | `validado` | ARCH | integridad documental verificada | `eceHojaIngreso.validar({ id, observacion? })` |
| `borrador` \| `en_revision` \| `firmado` | `anulado` | DIR | motivo de anulación ≥ 5 char | `eceHojaIngreso.anular({ id, motivoAnulacion })` |
| `validado` | — | — | inmutable | — |
| `anulado` | — | — | terminal | — |

> El bridge `eceBridgeAdmision.admitirDesdeOrden` ejecuta la admisión **completa en una sola transacción atómica de 9 pasos** (crea episodio_atencion + episodio_hospitalario + hoja_ingreso + asignacion_cama + documento_instancia + historial + outbox + UPDATE orden + UPDATE cama). Esta operación produce HOJA_ING directamente en estado `firmado` (no pasa por `borrador`), porque el ADM proporciona el PIN al inicio del flujo. Es el flujo **principal de admisión** en producción; los procedures `create/update/firmar` separados existen para casos excepcionales (correcciones, importaciones, contingencia).

## Eventos

Emitidos al outbox de dominio dentro de la misma transacción para garantizar entrega exactly-once (patrón outbox + hash chain auditable):

| Evento | Disparador | Aggregate | Payload (campos clave) |
|---|---|---|---|
| `ece.hoja_ingreso.firmada` | `firmar()` finaliza con éxito | `HojaIngreso` | `{ hojaIngresoId, instanciaId, tipoDocumentoCodigo: "HOJA_ING", accion: "firmar", byUserId, firmaId, payloadHash }` |
| `ece.hoja_ingreso.validada` | `validar()` finaliza con éxito | `HojaIngreso` | `{ hojaIngresoId, instanciaId, tipoDocumentoCodigo: "HOJA_ING", accion: "validar", byUserId, observacion, payloadHash }` |
| `ece.admision.completada` | `eceBridgeAdmision.admitirDesdeOrden()` finaliza | `EceEpisodioHospitalario` | `{ episodioId, episodioHospitalarioId, hojaIngresoId, ordenIngresoId, ecePacienteId, camaAsignadaId?, admisionPorId, organizationId }` |
| (sub-evento sintético sugerido) `hoja_ing.servicio_asignado` | derivable del payload `ece.admision.completada` | — | `{ servicioId, camaId, episodioId }` |

Suscriptores observados en el catálogo:

- **Motor workflow ECE** — habilita los documentos dependientes (cambia `estado_actual_id` de instancias hijas de `bloqueado` a `disponible`).
- **Módulo de camas** — confirma asignación oficial; libera reserva temporal si la admisión se cancela.
- **Módulo de enfermería** — abre la tarea de valoración inicial (VAL_INI_ENF) con SLA de 24 h.
- **Módulo de indicaciones (IND_MED)** — desbloquea para el médico tratante.
- **Módulo de admisión administrativa** — actualiza censo de movimiento diario.
- **Audit hash chain** — `payloadHash` se enlaza a `chain_hash` previo del módulo (NTEC Art. 55-56, retención 10 años).

## Documentos dependientes (que esto habilita)

Una vez `ece.hoja_ingreso.firmada` se emite, el motor de workflow desbloquea la creación de:

| Doc dependiente | Frecuencia | SLA | Bloqueado por |
|---|---|---|---|
| **VAL_INI_ENF** (Valoración Inicial de Enfermería) | una vez por episodio | primeras 24 h | rol ENF; no requiere PIN actualmente (drift HD-23 audit Stream D) |
| **IND_MED** (Indicaciones Médicas) | diaria + ad-hoc | revisión cada turno | rol MC/MT; firma electrónica simple obligatoria |
| **REG_ENF** (Registro de Enfermería + MAR/Kardex) | continuo por turno | cada administración + nota de turno | rol ENF; vínculo con IND_MED |
| **SV** (Hoja de Signos Vitales) | según frecuencia indicada | conforme IND_MED | rol ENF; series temporales |
| **NOTA_EVOL** (Notas de Evolución Médica) | diaria mínimo | una nota/día/médico tratante | rol MC/MT/ESP; ordenamiento cronológico Art. 19 |
| **INTERCONSULTA** (RRI hospitalaria) | a demanda | respuesta ≤ 72 h | rol ESP/IC |
| **ACTO_QX** (Documentos quirúrgicos) | si aplica | bloqueado hasta CONS_INF quirúrgico firmado | rol cirujano + anestesiólogo |
| **EPICRISIS / Hoja de Egreso** | al alta | día de egreso | rol MC (médico tratante) + visto jefe servicio |
| **CERT_DEFUN** | si fallecido | inmediato post-defunción | rol MC certificante |

## Drift conocido

Auditoría **Stream D — Hospitalización (2026-05-19)** identificó P0 bloqueantes en este módulo. Ver `docs/audit/2026-05-19_audit_stream_d_hospitalizacion.md` para detalle completo.

| ID | Severidad | Descripción | Ruta afectada |
|---|---|---|---|
| **HD-01** | P0-BLOQUEANTE | Schema drift masivo: 6 columnas del router (`servicio_ingreso_id`, `modalidad`, `procedencia`, `diagnostico_ingreso`, `motivo_consulta`, `notas_adicionales`, `admisionista_id`) **no existen** en `ece.hoja_ingreso` DB. La columna real es `servicio_id`, y los campos textuales se serializan en `datos_administrativos JSONB`. El router ya fue parcialmente corregido (usa JSONB) pero el bridge `bridge-admision.router.ts` sigue intentando insertar como columnas explícitas en algunos paths. | `packages/trpc/src/routers/ece/hoja-ingreso.router.ts:533-558`, `bridge-admision.router.ts:347-373` |
| **HD-02** | P0-BLOQUEANTE | `ece.hoja_ingreso` carece de columna `paciente_id` propia (se deriva via `episodio_id → episodio_atencion.paciente_id`). Algunos SELECT en `findHojaIngreso` referencian `paciente_id` directamente y fallarán con `ERROR 42703`. RLS `by_episodio_estab` opera vía join — funciona pero solo cuando la query no toca la columna inexistente. | `hoja-ingreso.router.ts:138-166` |
| **HD-03** | P1-ALTO | UI `nueva/page.tsx` usa `<Input>` libre para `modalidad` con placeholder "internamiento, hospital_dia…" pero el enum Zod aceptado es `["urgente", "programado"]`. UX permite ingresar texto inválido. | `apps/web/src/app/(clinical)/ece/hoja-ingreso/nueva/page.tsx:278-295` |
| **HD-04** | P2-MEDIO | Botón "Admitir paciente" se habilita con `pin.length >= 4` pero Zod exige `/^\d{6,8}$/`. Falla en servidor sin feedback temprano. | `nueva/page.tsx:446` |
| **HD-05** | P2-MEDIO | `computePayloadHash` hashea campos (`servicio_ingreso_id`, `modalidad`) que no existen como columnas en la fila persistida. Rompe trazabilidad criptográfica NTEC §6.3. | `hoja-ingreso.router.ts:359-371` |
| **HD-06** | P2-MEDIO | Tests `hoja-ingreso.router.test.ts` validan contra un schema desincronizado de la BD real (falsos positivos verdes mientras la BD falla). | `__tests__/hoja-ingreso.router.test.ts` |

### Duplicación de rutas detectada

Existen **dos UIs distintas** que abordan la admisión hospitalaria, y conviene unificar conforme la regla "adecuar legacy, no duplicar":

1. **Legacy:** `apps/web/src/app/(clinical)/admission/` — wizard 4 pasos (paciente → datos → cama → confirmar) que invoca `trpc.encounter.admit` y persiste en `public.Encounter` + `public.BedAssignment`. **Sin firma electrónica NTEC**, sin bridge a `ece.hoja_ingreso`.
2. **ECE:** `apps/web/src/app/(clinical)/ece/hoja-ingreso/` — formulario nuevo con PIN argon2id que invoca `eceHojaIngreso.create + firmar` o `eceBridgeAdmision.admitirDesdeOrden`. Genera HOJA_ING formal NTEC con firma electrónica y motor workflow.

**Recomendación**: extender `/admission` legacy para que su paso final de confirmación dispare `eceBridgeAdmision.admitirDesdeOrden` y genere automáticamente la HOJA_ING ECE, eliminando la página duplicada `/ece/hoja-ingreso/nueva`. Ya existe precedente (PR #101) con triaje: eliminamos `/ece/triaje` y conservamos `/triage` legacy con bridge a `ece.hoja_triaje`. La sidebar debe quedar con un solo item "Admisión" en clinical.

## Descripción markdown rica

### Por qué HOJA_ING es la "raíz" del expediente hospitalario

La Hoja de Ingreso no es un documento más en el episodio: **es la cabecera transaccional que el resto del expediente referencia**. Sin una HOJA_ING firmada y vinculada a `ece.episodio_atencion`, ningún otro documento clínico hospitalario tiene un episodio válido contra el cual escribirse. En términos del schema:

- `ece.episodio_atencion` (modalidad=`hospitalario`) tiene relación **1:1** con `ece.hoja_ingreso` vía `UNIQUE(episodio_id)`. Un episodio hospitalario sin hoja de ingreso es un error de consistencia que las restricciones DDL deberían bloquear.
- Todos los documentos dependientes (`VAL_INI_ENF`, `IND_MED`, `REG_ENF`, `SV`, `NOTA_EVOL`, `EPICRISIS`) usan `episodio_id` como FK. El motor de workflow ECE consulta `documento_instancia.estado_actual_id` de HOJA_ING antes de permitir crear hijos: si está en `borrador` o `anulado`, las creaciones hijas son rechazadas con `PRECONDITION_FAILED`.
- La auditoría de **hash chain** (NTEC Art. 55-56 + §6.3 TDR) inicia la cadena del episodio en `ece.documento_instancia_historial` con el `payload_hash` de la firma de HOJA_ING. Toda mutación posterior se enlaza a esta raíz; romper la HOJA_ING (anulación post-validación, modificación ilegal) rompe la cadena y el verificador `auditIntegrityRouter` detecta la inconsistencia.

### Cascada de documentos obligatorios

La firma de HOJA_ING dispara, vía el outbox `ece.hoja_ingreso.firmada`, la apertura de **tareas pendientes** para los equipos:

```
HOJA_ING.firmada
  │
  ├─► VAL_INI_ENF (ENF, SLA 24h)         ─── bloqueante para alta
  ├─► IND_MED inicial (MC/MT, ad-hoc)    ─── bloqueante para administración de medicamentos
  ├─► SV ingreso (ENF, inmediato)        ─── recomendado, no bloqueante
  └─► (preparación cirugía, si aplica)
        └─► ACTO_QX requiere CONS_INF quirúrgico previo
```

Cada uno de estos documentos a su vez tiene SLAs configurados en `ece.tipo_documento` y son monitoreados por el dashboard de cumplimiento NTEC (`/ece/cumplimiento`). El módulo de notificaciones (Beta.15) envía recordatorios a los roles responsables si los SLAs se acercan a vencimiento.

### Integración con motor workflow ECE

El motor de workflow vive en `packages/trpc/src/workflow/` y opera sobre las tablas:

- `ece.tipo_documento` — catálogo de tipos (incluye HOJA_ING).
- `ece.flujo_estado` — estados configurables por tipo (`borrador`, `en_revision`, `firmado`, `validado`, `anulado`).
- `ece.flujo_transicion` — transiciones permitidas con rol autorizante y flag de "exige firma" (`firmar` requiere `true`).
- `ece.documento_instancia` — fila por documento concreto, con `estado_actual_id` y `version` incremental.
- `ece.documento_instancia_historial` — log inmutable de cada transición con `firma_id`, `payload_hash`, `ejecutado_por`, `rol_ejecutor_id`.

El helper `withWorkflowContext(prisma, ctx, fn)` (en `packages/trpc/src/workflow/context.ts`) configura el contexto ECE (personal_id, establecimiento_id, roles) dentro de una transacción Postgres con `SET LOCAL`, permitiendo que las políticas RLS de `ece.*` operen contra el usuario correcto. **No bypass este wrapper**: el contrato RLS del proyecto exige que toda operación ECE ocurra dentro de `withWorkflowContext` o `withTenantContext`, no via `prisma.eceXxx.findMany()` directo.

### Relación con `public.Encounter` legacy

Persiste una dualidad arquitectónica:

- `public.Encounter` es el agregado **operativo HIS** (admisiones, traslados, altas, costos, encounters de emergencia). Es lo que usa el wizard `/admission` legacy.
- `ece.hoja_ingreso` + `ece.episodio_atencion` es el agregado **regulatorio NTEC** (cumplimiento normativo, firma electrónica, hash chain, cascada de documentos formales).

El **bridge `eceBridgeAdmision`** sincroniza ambos: cuando se admite un paciente, debería crear simultáneamente el `Encounter` (HIS) y el `episodio_atencion + hoja_ingreso` (ECE) en una sola transacción, vinculados por `Encounter.id ↔ episodio_atencion.encounter_id` (campo a confirmar en schema — posible drift adicional). En la práctica actual, los flujos están parcialmente cableados: el wizard legacy crea solo Encounter; el wizard ECE crea solo la cabecera ECE. La consolidación pendiente es **integrar el bridge al final del wizard `/admission`** para que cada admisión genere ambos lados atómicamente.

### Importancia del PIN argon2id en la firma

Art. 39 NTEC exige **firma electrónica simple** que identifique inequívocamente al firmante. La implementación usa:

- Hash **argon2id** del PIN del personal (parámetros conservadores: m=64MB, t=3, p=4).
- Verificación dentro de `verifyPinOrThrow` con conteo de intentos fallidos (`failed_attempts`) y lockout temporal (`locked_until`) tras 5 fallos.
- `firma_id` registrado en cada transición del historial, vinculando el acto al personal específico que firmó.

**Inconsistencia detectada** (audit HD-23): `VAL_INI_ENF` y `REG_ENF` actualmente NO exigen PIN para firmar, mientras HOJA_ING y CONS_INF sí. Esto es un drift normativo a resolver: o se documenta como ADR (firma simple ENF justificada por menor riesgo legal) o se uniformiza exigiendo PIN en todos los documentos NTEC firmables.

### Inmutabilidad y rectificación trazable (Art. 42)

Una vez `validado`, la HOJA_ING **no admite UPDATE**. Si se descubre un error post-validación:

1. Se crea una **nota de rectificación** (NOTA_EVOL con tipo `rectificacion`) que referencia el documento original.
2. El campo `bitacora_modificaciones[]` en metadatos registra: `{ usuario, timestamp, campo_modificado, valor_anterior, valor_nuevo, motivo }`.
3. El payload_hash original se conserva; el nuevo hash de la rectificación se enlaza a la cadena.
4. **Jamás** se hace UPDATE directo a la fila — la BD podría hacerlo (service_role bypass), pero el verificador de cadena lo detectaría y marcaría inconsistencia.

### Retención (Art. 34-35)

- **Expediente activo** (paciente con registros recientes < 5 años): on-line, indexado, búsquedas operativas.
- **Expediente pasivo** (sin registro 5+ años): archivado en almacenamiento frío, indexado por NUI/expediente, recuperable a demanda.
- **Casos especiales con retención extendida** (Art. 35):
  - Defunción por causa violenta, accidente o en investigación: **10 años**.
  - Diagnóstico crónico, paciente menor de edad, casos judiciales: retención según política institucional.
- Backups diarios cifrados en ubicación distinta del sitio principal (Art. 48).

---

**Referencias cruzadas**:

- ADR: `docs/adr/0014-ece-bridge-admision-atomicidad.md` — justificación de la transacción atómica de 9 pasos.
- Audit: `docs/audit/2026-05-19_audit_stream_d_hospitalizacion.md` — drift detallado HD-01..HD-06.
- Backlog: `docs/backlog/fase2/06_epic_ece_hospitalario.md` — historias de usuario de la épica.
- Insumo: `docs/backlog/fase2/_insumos/analisis_workflows_ece.md` §3.12 — estructura canónica del campo.
- TDR: §8.3 (ADT), §11 (Hospitalización), Anexo D (flujos BPMN).
- Norma: MINSAL Acuerdo n.° 1616 (2024), Arts. 17b, 19, 34, 35, 39, 41c, 42, 48, 55-56; Art. 21 (certificación restringida DIR).
