# REG_ENF — Registros de Enfermería

## Metadata
- **codigo**: REG_ENF
- **nombre**: Registros de Enfermería (notas y cumplimiento)
- **modalidad**: HOSPITALIZACION + EMERGENCIA observación
- **NTEC artículo**: Art. 37 (también referenciado como NTEC §3.7 / Doc 7 "Registro de Enfermería + MAR-Kardex" en `docs/backlog/fase2/_insumos/analisis_workflows_ece.md` y MINSAL Acuerdo n.° 1616 / 2024)
- **modulo_his_target**: `apps/web/src/app/(clinical)/ece/registro-enfermeria` (UI lista + nuevo + `[id]` MAR)
- **tabla_datos**: `ece.registro_enfermeria` (cabecera por turno) + `ece.administracion_medicamento` (kardex / MAR — sub-tabla con `registro_enf_id`)
- **inmutable**: true por turno cerrado (estado `firmado`/`validado` bloquea mutación; rectificación vía documento NTEC RECT separado)
- **tipo_registro**: OBLIGATORIO POR TURNO (transaccional, no parte del expediente clínico inmutable — Art. 37 NTEC: conservación 1 año pos-utilización para documentos clínicos asociados)

## Propósito normativo

Art. 37 NTEC + §3.7 del análisis de workflows ECE: enfermería registra de forma **continua por turno** la ejecución de cuidados, el cumplimiento de indicaciones médicas (MAR — Medication Administration Record / Kardex), la evolución clínica observada (signos, eventos, balance) y los procedimientos realizados al paciente internado o en observación de emergencia. Es el documento operativo que evidencia que el plan de cuidados (VAL_INI_ENF) y las indicaciones (IND_MED) se ejecutaron — con trazabilidad ENF responsable, hora real y, cuando aplica, verificación GS1/BCMA del medicamento administrado.

## Dependencias

- **VAL_INI_ENF** — el primer registro de enfermería del episodio requiere que la Valoración Inicial de Enfermería esté creada (provee el plan de cuidados base y el riesgo NIC/NOC). Workflow ECE encadena `VAL_INI_ENF.firmado` antes de habilitar `REG_ENF.crear` en hospitalización formal.
- **IND_MED** — el cumplimiento (`ece.administracion_medicamento`) referencia obligatoriamente `indicacion_item_id`. Sin indicaciones médicas vigentes y firmadas no hay items que cumplir; el router rechaza administración sobre indicación en estado `anulada` (`packages/trpc/src/routers/ece/registro-enfermeria.router.ts` → `registrarAdministracion`).
- **EpisodioAtención (`ece.episodio_atencion`)** — la cabecera `registro_enfermeria` se ata a `episodio_id`; RLS aplica tenant scoping por `establecimiento_id` del episodio (política `by_parent_episodio` en `65_ece_rls_hardening.sql`).
- **GS1 / Bedside (opcional, recomendado)** — cuando se envían los campos GS1 (gtin, lote, expiry, pacienteId/gsrn) al `registrarAdministracion`, el router invoca `applyGs1Validation` (5 correctos BCMA). UI bedside MAR vive en `apps/web/src/app/(clinical)/ece/registro-enfermeria/[id]/page.tsx`.

## Obligatoriedad

- **HOSPITALIZACION**: registro **obligatorio cada turno** (3 turnos típicos: MATUTINO 06:00–14:00, VESPERTINO 14:00–22:00, NOCTURNO 22:00–06:00). La UI detecta el turno activo automáticamente (`detectCurrentShift()` en `apps/web/src/app/(clinical)/ece/registro-enfermeria/page.tsx`).
- **EMERGENCIA observación**: obligatorio en cada cambio de turno o ante evento relevante (caída, agitación, deterioro súbito, evento centinela). Cubre lo descrito en analisis_workflows_ece §200–219 — "Observación en emergencia: Hoja de Observación + Notas de evolución + Registro de enfermería" con firma de MT + ENF por turno.
- **Cierre**: al finalizar el turno, la enfermera responsable transiciona a `firmado` (firma electrónica simple ENF). La enfermera coordinadora puede ejecutar `validar` (cierre formal supervisorial) — opcional pero recomendado en eventos críticos.

## Roles firmantes

| Rol | Acción | Momento |
|---|---|---|
| ENFERMERIA (ENF) | Crea cabecera + registra cumplimientos + firma | Inicio y cierre de turno |
| ENFERMERIA (ENF, responsable del turno) | Firma electrónica simple (`firmar` → estado `firmado`) | Cierre del turno |
| ENFERMERIA_SUPERVISORA / Coordinadora (ENF rol AUTORIZA) | `validar` (cierre formal, estado `validado`) | Eventos críticos, fin de jornada, auditoría supervisorial |
| MC / MT | Co-firma sólo cuando ocurre evento clínico relevante consignado en el turno (observación de emergencia, caída con lesión, evento centinela) | Evento puntual — referenciado en `nota_evolucion` |

Permisos seed (`63_ece_08_seed.sql`):

```text
ENF → registro_enfermeria : escritura, firma
REG_ENF firmantes: ENF LLENA / RESPONSABLE / FIRMA / AUTORIZA  (todos ENF — flujo cerrado)
```

## Campos obligatorios

Cabecera (`ece.registro_enfermeria` — confirmado en `schema.prisma` lines 5058–5077 y `61_ece_06_documentos.sql` lines 240–263):

- `episodio_id` (UUID, NOT NULL) — episodio de atención
- `instancia_id` (UUID) — vínculo con `ece.documento_instancia` para trazabilidad workflow
- `turno` (TEXT, NOT NULL, CHECK in `matutino|vespertino|nocturno`)
- `nota_evolucion` (TEXT, opcional pero recomendado) — texto libre de evolución observada
- `plan_cuidados` (TEXT, opcional) — plan continuado / ajustes al plan de VAL_INI_ENF
- `valoracion_enf` (JSONB) — escalas variables (NIC/NOC, Braden, Norton, dolor EVA, balance hídrico estructurado, etc.)
- `registrado_por` (UUID, NOT NULL) — enfermera autora del turno
- `registrado_en` (TIMESTAMPTZ, default `now()`)
- `estado_registro` (TEXT, default `vigente`, CHECK in `vigente|rectificado`)

Sub-tabla MAR/Kardex (`ece.administracion_medicamento`):

- `registro_enf_id` (UUID, NOT NULL, FK a `registro_enfermeria` ON DELETE CASCADE)
- `indicacion_item_id` (UUID, NOT NULL, FK a `ece.indicacion_item`) — qué indicación se cumple
- `hora_programada` (TIMESTAMPTZ) — derivada del schedule indicación (`computeScheduledSlot(hora_indicada, frequencia, horaAplicada)` — HD-23)
- `hora_aplicada` (TIMESTAMPTZ) — hora real de administración
- `estado` (TEXT, CHECK in `administrado|omitido|pospuesto`)
- `motivo_omision` (TEXT, NOT NULL si `estado='omitido'`)
- `responsable` (UUID) — enfermera ejecutora

Eventos / observaciones recomendadas (van en `nota_evolucion` o `valoracion_enf` JSONB):

- procedimientos_realizados (curaciones, accesos, sondas, drenajes, aspiraciones)
- ingresos_egresos (líquidos VO/IV, diuresis, drenajes, balance hídrico)
- signos_vitales_observados (referencia cruzada con flujo SIG_VIT, no se duplica aquí)
- eventos_relevantes (caídas, agitación, deterioro, eventos centinela → dispara Beta.15 alerts)
- firma_enfermera_responsable_turno (vía `firmar` workflow)

## Estados

```text
borrador → en_revision → firmado → validado
```

(Workflow ECE oficial — `63_ece_08_seed.sql` lines 231–234.)

- `borrador` — cabecera creada, cumplimientos en captura
- `en_revision` — turno consolidado, pendiente firma
- `firmado` — firma electrónica simple ENF responsable; **inmutabilidad post-firma**
- `validado` — cierre supervisorial opcional (ENF coordinadora)

Estado de fila (`estado_registro` en BD):

- `vigente` — registro activo
- `rectificado` — superado por un documento RECT_NTEC posterior (no se borra; cadena audit inmutable)

## Transiciones

| origen | destino | rol | condición |
|---|---|---|---|
| (nulo) | borrador | ENF | `create` — episodio activo + turno declarado; primer registro requiere `VAL_INI_ENF.firmado` |
| borrador | en_revision | ENF | `enviar_revision` — cabecera completada, todos los cumplimientos críticos registrados |
| borrador | firmado | ENF | `firmar` directo (path corto si no requiere doble revisión) — estado actual debe ser `borrador` o `en_revision` |
| en_revision | firmado | ENF responsable | `firmar` — cierre de turno; transición que activa inmutabilidad |
| firmado | validado | ENF coordinadora / supervisora | `validar` — estado actual debe ser exactamente `firmado` |
| firmado | rectificado (`estado_registro`) | ENF + MC (autorización) | Apertura de documento RECT_NTEC posterior — no muta este registro; lo marca |

Restricciones (codificadas en router `registrarAdministracion` / `firmar` / `validar`):

- No se puede `firmar` desde estados ≠ `borrador|en_revision` → `BAD_REQUEST`.
- No se puede `validar` desde estado ≠ `firmado` → `BAD_REQUEST`.
- No se puede registrar administración contra una `indicacion_item.estado = 'anulada'` → `BAD_REQUEST`.
- Si `motivoOmision` está presente sin `estado='omitido'` (o viceversa) el schema Zod (`packages/contracts/src/schemas/ece-registro-enfermeria.ts`) lo bloquea en frontera.

## Eventos

Eventos de dominio emitidos vía `emitDomainEvent` (outbox) — confirmados en router línea 372–386:

- `reg_enf.turno_iniciado` — emitido al crear cabecera (estado `borrador`). Payload: `{ registroEnfId, episodioId, turno, enfermeraId, ts }`.
- `ece.administracion.registrada` — **emitido hoy** (Stream 30) al insertar fila en `ece.administracion_medicamento`. Payload: `{ administracionId, registroEnfId, indicacionItemId, episodioId, enfermeraId, horaProgramada }`. Vincula MAR ↔ BCMA bedside ↔ alerts Beta.15.
- `reg_enf.cumplimiento_registrado` — alias semántico del anterior cuando `estado='administrado'`; consumido por dashboards de adherencia.
- `reg_enf.omision_registrada` — derivado cuando `estado='omitido'` con `motivo_omision` ≠ NULL; dispara revisión supervisorial.
- `reg_enf.evento_centinela` — emitido cuando `valoracion_enf` JSONB incluye campo `evento_centinela: true` → cascada Beta.15 alerts/notifications.
- `reg_enf.turno_firmado` — emitido en `firmar`. Payload: `{ registroEnfId, episodioId, enfermeraId, ts }`. Habilita transición de turno siguiente.
- `reg_enf.turno_validado` — emitido en `validar`. Payload: `{ registroEnfId, supervisoraId, ts }`.

## Drift conocido

Hallazgos del audit Stream D — Hospitalización (`docs/audit/2026-05-19_audit_stream_d_hospitalizacion.md` §7):

- **HD-22 (P0-BLOQUEANTE) — resuelto en router actual (commit reciente):** El router originalmente generaba INSERT/UPDATE con columnas `fecha`, `observaciones`, `personal_id`, `organization_id`, `firmado_por`, `validado_por` — ninguna existe en BD. La realidad de BD es `turno`, `nota_evolucion`, `plan_cuidados`, `valoracion_enf (jsonb)`, `registrado_por`, `estado_registro`. **Estado:** corregido — el router en `packages/trpc/src/routers/ece/registro-enfermeria.router.ts` ya mapea a las columnas reales (raw SQL con nombres correctos). Pendiente confirmar el merge final en `feat/fase2-s1-gate`.
- **HD-23 (P1-ALTO) — resuelto:** `registrarAdministracion` debe derivar `hora_programada` con `computeScheduledSlot(hora_indicada, frequencia, horaAplicada)` y no copiar `input.horaAplicada` directamente. El router actual ya implementa el cálculo (líneas 332–335) con fallback a `horaAplicada` sólo cuando la indicación no tiene `hora_indicada` o `frequencia`. Sin este slot, la conciliación de omisiones (`MISSED`) es imposible.
- **HD-24 (P1-ALTO) — resuelto:** `list` originalmente usaba `ctx.prisma.$queryRaw` directo y filtraba por `organization_id` (columna inexistente). El router actual envuelve en `withEceContext` (demota a rol `authenticated` → RLS aplica la política `by_episodio_estab`) y filtra opcionalmente por `episodio_id`.
- **MAR-Bedside drift:** UI `[id]/page.tsx` lista los `pendingRows` como array vacío con TODO — "la integración con `indicacion_item` ECE se completa en la siguiente iteración"; hoy el botón "Administrar manual" abre BCMA con `scheduledTime: null`. Resultado: la regla 5R Right Time del backend queda omitida en flujo manual. Carry-over Wave 2 (memoria F2-S7 GS1 Bedside completado).
- **`pacienteId` ingreso manual UUID:** en `nuevo/page.tsx` el paciente se ingresa como UUID texto libre con validación regex en frontera. Pendiente pre-llenado desde agenda (TODO marcado).
- **Sin `personal_id` / `organization_id`:** la BD no tiene `organization_id` en `registro_enfermeria` — el tenant scoping vive 100% en RLS vía `ece.current_establecimiento_id_safe()` cruzado con `episodio_atencion.establecimiento_id`. Cualquier router nuevo que tope esta tabla DEBE usar `withEceContext`.
- **Inmutabilidad post-firma sin trigger DB:** el bloqueo de UPDATE post-`firmado` vive en validación del router. No hay trigger SQL equivalente (a diferencia de `consentimiento_informado` que sí tiene `fn_bloquea_mutacion_consentimiento`). Riesgo: escritura directa con `service_role` puede mutar registros firmados — sólo el audit hash chain detectaría la ruptura.

## Descripción markdown rica

**Continuidad clínica por turno como columna vertebral.** El Registro de Enfermería es el documento operativo que materializa la continuidad de cuidados en hospitalización 24×7. Cada turno (matutino / vespertino / nocturno) genera una cabecera independiente en `ece.registro_enfermeria` con su propia firma — el handoff (entrega de turno) consiste en que el turno saliente cierre (`firmar`) y el entrante cree su nueva cabecera. El sistema no permite turnos solapados sobre el mismo episodio en estado `borrador` simultáneo: workflow ECE serializa.

**Cumplimiento de indicaciones es trazable a nivel medicamento, hora y operador.** La tabla `ece.administracion_medicamento` referencia 1:N a `indicacion_item` (qué se mandó cumplir) y persiste `hora_programada` (derivada de `computeScheduledSlot`) + `hora_aplicada` (real) + `responsable` (enfermera ejecutora). Esto permite reportes de adherencia, ventana terapéutica (±N min), y conciliación de omisiones en tiempo real. La integración GS1/BCMA (opcional pero activable al pasar el bloque `gs1` al `registrarAdministracion`) activa la verificación de los 5 correctos (paciente vía GSRN, medicamento vía GTIN+lote+expiry, dosis, vía, hora) — modelado en `applyGs1Validation`. Bedside MAR (`/ece/registro-enfermeria/[id]`) es el touchpoint físico junto a cama.

**Eventos centinela disparan alertas Beta.15.** Cuando `valoracion_enf` JSONB declara `evento_centinela: true` (caída con lesión, deterioro súbito, RCP, broncoaspiración, evento adverso medicamentoso, etc.), el outbox emite `reg_enf.evento_centinela`. Los consumers Beta.15 (notifications worker) generan notificación al MC responsable + escalamiento si no hay ACK en X minutos. Esto cierra el ciclo enfermería → médico → respuesta sin requerir llamada telefónica.

**Balance hídrico se calcula desde ingresos/egresos estructurados.** El JSONB `valoracion_enf` admite campos tipados (`ingresos: { via_oral, via_iv, via_sng }`, `egresos: { diuresis, drenajes, heces, vomitos }`). El reporte de balance del episodio agrega cross-turno por `episodio_id` y genera la gráfica de tendencia 24h/48h/72h vista desde Kardex (`/ece/kardex/[patientId]`). No se duplica datos en columnas SQL planas — el JSONB permite escalas/atributos que varían por servicio (UCI vs sala común).

**Inmutabilidad relativa, audit total.** Una vez `firmado`, el registro entra en zona inmutable: las mutaciones se bloquean por estado en el router (no por trigger DB — gap pendiente). La corrección legítima ocurre mediante un documento RECT_NTEC nuevo que marca el original como `estado_registro = 'rectificado'` y crea uno nuevo con el cambio justificado. La cadena `audit.audit_log` con hash encadenado (`02_audit_triggers.sql` + `05_audit_hash_chain.sql`) garantiza detección criptográfica de cualquier alteración no autorizada. Retención Art. 37 NTEC: 1 año pos-utilización (documentos clínicos asociados, no parte del expediente clínico de retención larga — los 10 años aplican al expediente principal, no a estos registros operativos).

**Modalidad EMERGENCIA observación: mismo flujo, ritmo distinto.** En observación de emergencia (paciente que excede 6h sin ingreso formal), el registro de enfermería corre con el mismo modelo de datos pero el "turno" puede ser irregular — se cierra al cambio de turno físico o ante evento clínico. La UI en `/triage` no expone hoy esta entrada (gap menor): el flujo se canaliza vía bedside MAR cuando hay indicaciones, y vía nota libre cuando no las hay. Mejora pendiente: surface dedicado `/emergency/observacion/[id]/enfermeria` reusando el mismo router REG_ENF — aplicando la regla "adecuar legacy, no duplicar" del CLAUDE.md (no crear `/ece/observacion-enfermeria` paralelo).
