# VAL_INI_ENF — Valoración Inicial de Enfermería

## Metadata
- **codigo**: `VAL_INI_ENF`
- **nombre**: Valoración Inicial de Enfermería al Ingreso
- **modalidad**: `HOSPITALIZACION` (en BD: `tipo_documento.modalidad = 'hospitalario'`)
- **NTEC artículo**: NTEC §4 — Documentación clínica de hospitalización. Acuerdo MINSAL n.° 1616 (2024). Plazo de **primeras 24 horas post-admisión** referenciado en doctrina de enfermería SLV (Marjory Gordon, Braden, Morse) — **NO codificado actualmente en BD ni router** (ver §Drift).
- **modulo_his_target**: `/ece/valoracion-inicial-enfermeria` (UI ya implementada — `apps/web/src/app/(clinical)/ece/valoracion-inicial-enfermeria/{page,nueva/page,[id]/page}.tsx`). **No existe módulo HIS legacy `/nursing` con valoración estructurada**, por lo que esta ruta NTEC no duplica un dominio preexistente (regla "adecuar legacy" no aplica para este documento).
- **tabla_datos**: `ece.valoracion_inicial_enfermeria` (SQL: `packages/database/sql/66_valoracion_inicial_enfermeria.sql`; modelo Prisma: `EceValoracionInicialEnfermeria` en `packages/database/prisma/schema.prisma:5549`).
- **inmutable**: `false` en `ece.tipo_documento` — **divergencia con NTEC Art. 40** (ver §Drift HD-21). Inmutabilidad de facto post-firma por chequeo en JS (`router:326-331, 370-375`), sin trigger DB.
- **tipo_registro**: `maestro` (one-shot, 1:1 por episodio hospitalario — `UNIQUE INDEX uq_valoracion_inicial_episodio_activa` parcial `WHERE estado_registro <> 'anulado'`).

## Propósito normativo

Valoración integral de enfermería al ingreso hospitalario: deja constancia documental del estado basal del paciente (antecedentes, alergias, medicación previa, escalas de riesgo, dispositivos invasivos al ingreso) y del **plan de cuidados inicial** que guía el seguimiento por turno (Registro de Enfermería + Kardex).

Cumple las funciones normativas:

1. **Línea base clínica** — referencia para detectar deterioro intraestancia.
2. **Triage de riesgos** — escalas estandarizadas (Braden / Morse / Dolor 0–10) priorizan intervenciones de seguridad del paciente (UPP, caídas, manejo del dolor).
3. **Plan de cuidados inicial** — vincula con el flujo continuo de Registro/Notas de Enfermería (NTEC §3.7 — análisis_workflows_ece.md líneas 439–445).
4. **Corresponsabilidad asistencial** — firma electrónica simple ENF según matriz de aprobaciones NTEC (analisis_workflows_ece.md línea 216).

## Dependencias

- **`FICHA_ID`** — la fila `ece.tipo_documento` declara `depende_de = ARRAY['FICHA_ID']` (Ficha / Hoja de Identificación del Expediente Clínico, Art. 15 NTEC).
- **`episodio_hospitalario` existente** — la FK `episodio_hospitalario_id` exige un episodio activo (cadena `ece.episodio_hospitalario → ece.episodio_atencion`).
- **HOJA_ING** — recomendado por el flujo (analisis_workflows_ece.md líneas 213, 216) pero **no codificado como bloqueante** en la BD ni en el router. La valoración puede crearse aun si la Hoja de Ingreso no está firmada (ver §Drift).
- **FICHA_IDENT** del paciente — implícita vía `episodio_atencion → paciente`.

## Obligatoriedad

- **SIEMPRE en HOSPITALIZACION** — un episodio hospitalario debe tener exactamente una valoración inicial activa (cardinalidad 1:1 garantizada por `UNIQUE INDEX` parcial sobre `episodio_hospitalario_id WHERE estado_registro <> 'anulado'`).
- **SLA referencial: ≤24 h post-admisión** según doctrina de enfermería SLV — **NO codificado** en BD ni emitido como evento `sla_vencida` (ver §Drift). Beta.15 podría suscribirse a `ece.valoracion_inicial.firmada` y derivar la alerta por diferencia con `episodio_hospitalario.fecha_admision`, pero esa regla no está implementada hoy.

## Roles firmantes

| Rol HIS | Acción | Momento | Mecanismo |
|---|---|---|---|
| `NURSE` (ENF — enfermera/o asignada al paciente) | Crear borrador → completar campos → **firmar** | ≤24 h post-admisión (objetivo asistencial) | Sesión activa, **sin PIN** — ver HD-20 |
| `NURSE` (supervisora / coordinadora / jefe de enfermería) | **Validar** | Diferida (postvalidación supervisora) | Sesión activa |

Ambos firmante y validador comparten el rol tRPC `NURSE` (`requireRole(["NURSE"])` — router líneas 194, 198–437). La distinción entre enfermera asistencial y supervisora **no se aplica por permisos** sino por flujo (la primera firma, la segunda valida; el router permite que el mismo usuario haga ambas operaciones — ver §Drift).

## Campos obligatorios

Esquema Zod (`router:57-71`) + restricciones BD (`sql/66:20-69`):

| Campo | Obligatorio | Restricción |
|---|---|---|
| `episodioHospitalarioId` | **SÍ** | UUID, FK a `ece.episodio_hospitalario(episodio_id)` |
| `fechaHora` | **SÍ** | `timestamptz NOT NULL` — momento clínico de la valoración |
| `antecedentesPersonales` | Opcional | `text`, máx. 4000 caracteres |
| `antecedentesFamiliares` | Opcional | `text`, máx. 4000 caracteres |
| `alergiasConocidas` | Opcional | `text`, máx. 2000 caracteres |
| `medicamentosActuales` | Opcional | `text`, máx. 2000 caracteres |
| `escalaBraden` | Opcional | `smallint`, **6 ≤ x ≤ 23** (riesgo UPP — úlceras por presión) |
| `escalaMorse` | Opcional | `smallint`, **0 ≤ x ≤ 125** (riesgo de caídas) |
| `escalaDolor` | Opcional | `smallint`, **0 ≤ x ≤ 10** (escala numérica simple) |
| `estadoConsciencia` | Opcional | `text`, máx. 500 caracteres (descripción libre — no Glasgow estructurado) |
| `dispositivosInvasivos` | Opcional | `text`, máx. 1000 caracteres |
| `educacionBrindada` | Opcional | `text`, máx. 2000 caracteres |
| `planCuidadosInicial` | Opcional | `text`, máx. 4000 caracteres |
| `registradoPor` | **SÍ** | UUID FK a `ece.personal_salud`, derivado de `ctx.user.id` vía `findPersonalId` |
| `firmadoPor` / `firmadoEn` | Llenado en firma | UUID + `timestamptz` — set automático al firmar |
| `validadoPor` / `validadoEn` | Llenado en validación | UUID + `timestamptz` — set automático al validar |

**Drift vs. template normativo**: los **11 patrones funcionales de Marjory Gordon**, los **diagnósticos NANDA** y las **intervenciones NIC/NOC** **NO están modelados** — todo lo que en la doctrina se captura por categoría queda como texto libre en `antecedentesPersonales`, `estadoConsciencia` y `planCuidadosInicial`. La escala **MNA (nutricional)** **NO existe** como campo dedicado. Ver §Drift más abajo.

## Estados

```
borrador  →  firmado  →  validado
                          (terminal — no hay anulado en flujo normal)
```

Estados permitidos en BD (CHECK constraint, `sql/66:60-63`): `borrador`, `firmado`, `validado`, `anulado`.

- **`borrador`** — estado inicial al crear. Editable vía `update` (router:317-355).
- **`firmado`** — set por `firmar` (NURSE asistencial). Emite outbox `ece.valoracion_inicial.firmada`. **No editable** post-firma (router:326-331 rechaza `update`; router:370-375 rechaza re-firma).
- **`validado`** — set por `validar` (NURSE supervisora). Estado terminal en el flujo previsto.
- **`anulado`** — referenciado en CHECK constraint y `tipo_documento.depende_de`, pero **no expuesto como mutation** en el router actual. La rectificación documental requeriría exponer un endpoint `anular` o usar el módulo `/ece/rectificaciones`.

## Transiciones

| origen | destino | rol tRPC | condición de aplicación | side-effects |
|---|---|---|---|---|
| (n/a — inexistente) | `borrador` | `NURSE` | `countValoracionesActivas(episodio) == 0` (router:251-261); `findPersonalId(userId)` retorna `personal_salud` activo (router:264-270) | INSERT en `ece.valoracion_inicial_enfermeria`; `registrado_por = personalId`, `registrado_en = now()` |
| `borrador` | `borrador` (update) | `NURSE` | `estado_registro = 'borrador'` (router:326-331) | UPDATE columnas con `COALESCE(:new, :old)` — solo sobreescribe lo enviado |
| `borrador` | `firmado` | `NURSE` | `estado_registro = 'borrador'` (router:370-375) | UPDATE `firmado_por`, `firmado_en`; **emite outbox** `ece.valoracion_inicial.firmada` |
| `firmado` | `validado` | `NURSE` (idealmente supervisora — no enforced por roles) | `estado_registro = 'firmado'` (router:417-422) | UPDATE `validado_por`, `validado_en` |
| `firmado` o `validado` | `anulado` | — (no expuesto) | n/a | n/a — flujo de anulación no implementado en router |

**Inmutabilidad post-firma**: chequeo solo en capa JS. **Falta trigger DB** que bloquee UPDATE directo a `ece.valoracion_inicial_enfermeria` cuando `estado_registro IN ('firmado','validado')` — ver HD-21 en §Drift.

## Eventos

Eventos de dominio emitidos vía `emitDomainEvent` (outbox transaccional):

| Evento | Cuándo | Payload | Estado en código |
|---|---|---|---|
| `ece.valoracion_inicial.firmada` | Transición `borrador → firmado` (router:389-400) | `{ valoracionId, episodioHospitalarioId, enfermeraId }` (más `organizationId` en metadata) | **Implementado** |
| `val_ini_enf.iniciada` (template) | Transición ∅ → `borrador` | (esperado: `{ valoracionId, episodioHospitalarioId, registradoPor }`) | **No implementado** — la creación en estado `borrador` no emite evento |
| `val_ini_enf.validada` | Transición `firmado → validado` | (esperado: `{ valoracionId, validadoPor }`) | **No implementado** — la validación no emite outbox |
| `val_ini_enf.sla_vencida` (>24 h sin firmar) | Reloj posterior a `episodio_hospitalario.fecha_admision + 24h` sin `firmado_en` | (esperado: `{ valoracionId, episodioId, horasTranscurridas }`) | **No implementado** — no hay scheduler/cron ni regla Beta.15 para esta SLA |

**Aggregate**: `aggregateType = "ValoracionInicialEnfermeria"`, `aggregateId = valoracionId` (UUID propio de la valoración, no del episodio — router:393).

## Drift conocido

Hallazgos documentados en el audit Stream D (`docs/audit/2026-05-19_audit_stream_d_hospitalizacion.md` §6, líneas 458–525):

### HD-19 — P1 — `list` sin `withEceContext`: RLS no aplica
- **Severidad**: P1-ALTO (fuga de datos clínicos inter-establecimiento).
- **Detalle**: `router:200-227` ejecuta `$queryRaw` fuera de `withEceContext`, por lo que el rol Supabase mantiene `BYPASSRLS` y la policy `val_ini_enf_by_episodio_estab` no filtra. El procedure `list` ya fue corregido (comentario "HD-19" en el código actual, líneas 201-203) — **verificar en revisión que el envoltorio sí se aplicó**.
- **Remediación esperada**: confirmar que `list` y `get` siempre llaman `withEceContext`.

### HD-20 — P2 — Firma sin PIN — solo sesión activa
- **Severidad**: P2-MEDIO. Inconsistencia con NTEC Art. 39 (firma electrónica con autenticación). Inconsistente con `hoja-ingreso.router.ts` que sí usa argon2id.
- **Detalle**: `firmar` (router:362-404) sólo `UPDATE SET estado_registro='firmado', firmado_por=:userId`. Sin segundo factor.
- **Decisión pendiente**: o se agrega PIN argon2id (patrón `hoja-ingreso.router.ts:232-288`), o se firma un ADR justificando que la firma simple cumple Art. 39 para enfermería.

### HD-21 — P2 — Sin trigger DB que bloquee UPDATE post-firma
- **Severidad**: P2-MEDIO. NTEC Art. 40 exige inmutabilidad técnica.
- **Detalle**: `information_schema.triggers` devuelve 0 filas para `ece.valoracion_inicial_enfermeria`. Bypass a la capa de aplicación deja la fila modificable.
- **Remediación esperada**: trigger `BEFORE UPDATE ... FOR EACH ROW EXECUTE FUNCTION fn_bloquea_mutacion()` cuando `estado_registro IN ('firmado','validado')`, equivalente al patrón usado por `ece.epicrisis_egreso`.

### Drift estructural — escalas y diagnósticos no estandarizados
- **`patrones_funcionales` (Gordon, 11 patrones)**, **`diagnosticos_enfermeria` (NANDA)**, **`plan_cuidados` (NIC/NOC)**, **`riesgo_nutricional` (MNA)** — **no existen como campos dedicados**. La doctrina queda capturada como texto libre en `antecedentesPersonales`, `estadoConsciencia` y `planCuidadosInicial`. Impacto: no es posible explotar BI ni alertas Beta.15 sobre patrones específicos (p. ej. detectar pacientes con riesgo de aspiración por categoría Gordon).
- Si Compliance exige estructurado en futuro: migración aditiva a `ece.valoracion_inicial_enfermeria` con columnas `jsonb` (`gordon_patterns`, `nanda_diagnoses`, `nic_interventions`).

### Drift de flujo — SLA 24 h no monitoreada
- **Beta.15 no se suscribe a `ece.valoracion_inicial.firmada`** para validar el cumplimiento del plazo de 24 h. No hay alerta automática a supervisión cuando un episodio lleva >24 h sin valoración firmada.
- Tampoco hay scheduler que materialice el evento `val_ini_enf.sla_vencida`.

### Drift de eventos — solo `firmada` emite outbox
- `val_ini_enf.iniciada` (creación) y `val_ini_enf.validada` (supervisión) **no emiten outbox** — BI no puede contabilizar valoraciones en proceso ni cierre por validación.

### Drift de dependencias — HOJA_ING no es bloqueante
- El flujo NTEC ubica la valoración después de Historia Clínica de Ingreso (analisis_workflows_ece.md líneas 213–216), pero el router no exige que `HOJA_ING` esté firmada antes de permitir creación. La cardinalidad 1:1 con `episodio_hospitalario` es la única protección estructural.

### Drift de cardinalidad — separación de roles enfermera/supervisora
- Tanto `firmar` como `validar` aceptan rol `NURSE`. **Ningún check impide que la misma enfermera firme y valide**, anulando la garantía de doble revisión. Si Compliance lo exige, agregar `requireRole(["NURSE_SUPERVISOR"])` para `validar` (rol que no existe hoy) o validar `validadoPor != firmadoPor` en el endpoint.

---

## Descripción markdown rica — operación clínica esperada

### Por qué este documento existe — perspectiva normativa y asistencial

La **Valoración Inicial de Enfermería al Ingreso** es uno de los tres documentos maestros que NTEC §4 exige al abrir un episodio hospitalario, junto con la **Hoja de Ingreso** (médica) y la **Ficha de Identificación**. Cubre la dimensión **asistencial-enfermera** del paciente: estado basal, riesgos prevenibles y plan de cuidados que servirá de hilo conductor para las **notas de enfermería por turno** (NTEC §3.7) y la **administración de medicamentos vía kardex**.

Sin esta valoración, la cadena de corresponsabilidad asistencial queda rota: la enfermera de turno 2 no puede demostrar que partió de un plan validado, y la institución pierde la trazabilidad documental que exige Art. 19 NTEC.

### Escalas estandarizadas como instrumentos de tamizaje

El módulo codifica tres escalas numéricas con rangos validados en BD:

- **Escala de Braden (6–23)** — predicción de riesgo de **úlceras por presión (UPP)**. ≤12 = alto riesgo; 13–14 = moderado; 15–18 = leve; ≥19 = bajo. Dispara intervenciones de cambio de posición y soporte de superficies.
- **Escala de Morse (0–125)** — predicción de **riesgo de caídas**. ≥45 = alto riesgo. Dispara protocolo de prevención (barandas, calzado antideslizante, acompañante).
- **Escala de Dolor (0–10)** — **EVA/NRS numérica simple**. ≥4 = dolor moderado-severo que requiere intervención farmacológica o no farmacológica documentada.

Estas escalas son los **únicos campos estructurados** del documento. Todo lo demás (antecedentes, dispositivos, plan de cuidados) es texto libre, lo que limita el aprovechamiento por BI. Ver §Drift estructural.

### Cardinalidad estricta 1:1 — una valoración por episodio

A diferencia del **Registro de Enfermería por turno** (transaccional, múltiples filas por episodio), la valoración inicial es **maestro one-shot**: exactamente una activa por episodio hospitalario. La unicidad se garantiza mediante:

1. **Validación en router** (`countValoracionesActivas`, router:251-261) — rechaza creación si ya existe una no-anulada.
2. **`UNIQUE INDEX` parcial** (`uq_valoracion_inicial_episodio_activa`, `sql/66:75-84`) — defensa en profundidad a nivel BD.

Para **rectificar** la valoración después de firmada, el flujo previsto es **anular + nueva** — pero el endpoint `anular` **no está expuesto** hoy. En la práctica esto significa que un error de transcripción en el plan de cuidados firmado **requiere intervención manual de DBA o uso del módulo `/ece/rectificaciones`** (que aplica el patrón general de rectificación documental ECE).

### Plazo de 24 horas — objetivo asistencial no codificado

La doctrina de enfermería SLV y la operación hospitalaria estándar fijan **24 horas post-admisión** como plazo objetivo para completar y firmar esta valoración. **Esa SLA no está implementada hoy en código**:

- No hay regla Beta.15 que monitoree `episodio_hospitalario.fecha_admision` vs. `valoracion_inicial.firmado_en`.
- No hay evento `val_ini_enf.sla_vencida` materializado por scheduler.
- No hay banner UI que alerte al usuario al abrir el episodio si supera las 24 h sin valoración.

Si el cumplimiento de este plazo es un KPI de hipercuidado post-Go-Live, agregar:
1. Suscripción Beta.15 a `episodio_hospitalario.creado` con timer de 24 h.
2. Materialización de `val_ini_enf.sla_vencida` al expirar el timer sin `firmada`.
3. Banner en `/ece/episodio-hospitalario/[id]` y notificación a jefatura de enfermería.

### Vínculo con el plan de cuidados continuo (REG_ENF)

El campo `planCuidadosInicial` es el **anchor** del flujo de cuidados continuo. Las notas de enfermería por turno (documento NTEC §3.7, módulo Registro de Enfermería / Kardex) deben **referenciar este plan** y documentar:

- Intervenciones ejecutadas según plan inicial.
- Desviaciones del plan (con justificación).
- Reevaluaciones de las escalas Braden/Morse/Dolor por turno (campos en `ece.registro_enfermeria`, no en este maestro).

La vinculación **no está enforced** por FK desde `registro_enfermeria` hacia `valoracion_inicial_enfermeria`; se resuelve transitivamente vía `episodio_hospitalario_id` compartido.

### Firma electrónica simple — gap regulatorio

NTEC Art. 39 exige **firma electrónica con autenticación**. Hoy la firma del documento sólo requiere **sesión activa** (sin segundo factor / PIN). Esto es **consistente con `registro-enfermeria.router.ts`** (igualmente sin PIN) pero **inconsistente con `hoja-ingreso.router.ts`** (PIN argon2id). Antes de Go-Live, definir política unificada vía ADR — o aplicar PIN a todos los documentos de hospitalización, o documentar formalmente que la firma simple de enfermería cumple Art. 39 dada la criticidad relativa del documento.

---

## Referencias cruzadas

- **Router tRPC**: `packages/trpc/src/routers/ece/valoracion-inicial-enfermeria.router.ts`
- **SQL DDL**: `packages/database/sql/66_valoracion_inicial_enfermeria.sql`
- **Schema Prisma**: `packages/database/prisma/schema.prisma:5549` (modelo `EceValoracionInicialEnfermeria`)
- **UI**: `apps/web/src/app/(clinical)/ece/valoracion-inicial-enfermeria/{page,nueva/page,[id]/page}.tsx`
- **Audit**: `docs/audit/2026-05-19_audit_stream_d_hospitalizacion.md` §6 (líneas 458–525) — hallazgos HD-19, HD-20, HD-21
- **Norma matriz**: `docs/backlog/fase2/_insumos/analisis_workflows_ece.md` líneas 216 (matriz de aprobaciones), 127 (sub-flujo de recepción de enfermería), 439-445 (REG_ENF dependiente)
- **Documento relacionado**: `REG_ENF` (Registro/Notas de Enfermería + Kardex, NTEC §3.7) — flujo continuo que se apoya en el plan de cuidados inicial firmado aquí.
