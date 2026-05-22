# NRP — Reanimación Neonatal (NRP Program AAP/AHA)

## Metadata
- **codigo**: `NRP`
- **nombre**: Hoja de Reanimación Neonatal
- **modalidad**: HOSPITALIZACION (neonatal — sala de partos / sala de expulsivos / quirófano cesárea / URPA neonatal)
- **NTEC artículo**: PENDIENTE — validar con @AE/@PO el artículo exacto del Acuerdo n.° 1616 MINSAL (30/05/2024, D.O. T.444 N°158) que rige la hoja de reanimación neonatal. El TDR §11 (`reanimación neonatal`) la cita como documento obligatorio del sub-flujo neonatal (TDR_HIS_Multipais.md líneas 107, 158, 228, 532). Aplican supletoriamente Arts. 19 (orden cronológico ascendente), 23 lit. a.4 (firma electrónica simple obligatoria), 42 (rectificación trazable post-firma), 55–56 (metadatos obligatorios y bitácora ≥10 años retención).
- **modulo_his_target**: `/ece/neonatologia/nrp` (módulo ECE — sin equivalente legacy HIS por ahora; verificar si `/clinical/neonatology` o subruta existe antes de implementar — regla CLAUDE.md "adecuar, no duplicar"; si NO existe, crear nuevo siguiendo el patrón ECE estándar).
- **tabla_datos**: `ece.reanimacion_neonatal` (Prisma `EceReanimacionNeonatal` — `packages/database/prisma/schema.prisma:5665-5677`). Schema SQL definido en `packages/database/sql/74_reanimacion_neonatal.sql` (gate F2-S1, sprint 98). Enum cierre: **`ece.resultado_nrp`** con valores **uppercase confirmados** vía audit HF-22 — `{estable, cuidados_intermedios, UCIN, defuncion}` (UCIN en uppercase, los otros tres lowercase — drift de naming detectado y corregido en el router, ver §Drift conocido).
- **inmutable**: `true` post-firma — el campo `cerrado_en` actúa como "lock criptográfico" (RLS policy `rn_update` lo prohíbe explícitamente: `USING (cerrado_en IS NULL)`). Una vez cerrado, ninguna UPDATE pasa (defensa en profundidad además del audit-hash-chain).
- **tipo_registro**: CONDICIONAL — solo se instancia cuando un recién nacido (RN) requiere maniobras de reanimación tras el nacimiento. NO obligatorio por cada nacimiento; obligatorio cuando se cumple al menos uno de los criterios de inicio (ver §Obligatoriedad).

## Propósito normativo
La Hoja de Reanimación Neonatal documenta **paso a paso, con marcas temporales (timestamps) precisas**, las maniobras del protocolo **NRP (Neonatal Resuscitation Program)** estandarizado por la **American Academy of Pediatrics (AAP)** y la **American Heart Association (AHA)** — vigente en su 8ª edición (2021). Es el registro único oficial del evento de reanimación de un RN tras el nacimiento.

Cumple cuatro propósitos críticos:

1. **Clínico**: secuencia AAP/AHA (Calor → Vía aérea → Estimulación → VPP → Compresiones → Medicamentos) con registro temporal de cada intervención. La **frecuencia cardíaca (FC)** es el **indicador principal** del NRP (no Apgar) — registros seriados cada 30s durante la reanimación.
2. **Médico-legal**: base probatoria para defensa ante eventos adversos neonatales (morbilidad y mortalidad). Latencia entre evento e intervención es la métrica más auditada (ej. "tiempo desde el nacimiento hasta VPP iniciada").
3. **Epidemiológico**: insumo para indicadores MINSAL/ISSS de morbi-mortalidad neonatal y para el análisis de causa raíz (RCA) en mortinatos / mortalidad neonatal precoz.
4. **Continuidad asistencial**: si `resultado = UCIN` → dispara apertura de expediente UCIN y traslado a Unidad de Cuidados Intensivos Neonatales con la hoja firmada como antecedente inmediato. Si `resultado = defuncion` → dispara `CERT_DEF` neonatal con CIE-10 estructurado (causa básica + causas inmediatas) y modelo perinatal P00–P96.

Es CONDICIONAL pero **una vez activado, completarlo y firmarlo es OBLIGATORIO** — no se permite reanimación en papel paralela cuando el sistema ECE está disponible (Art. 19 cronológico + Art. 55 metadatos).

## Dependencias (depende_de)
Documentos/entidades que DEBEN existir antes de crear este:

- **Evento de nacimiento** — debe existir un registro de nacimiento en uno de estos contextos:
  - `SALA_EXP` (Hoja de Sala de Expulsivos / Sala de Partos) cuando parto eutócico, o
  - `ACT_QX` (Acto Quirúrgico) cuando cesárea, con sub-evento "nacimiento del RN".
- **`ATN_RN`** (Hoja de Atención del Recién Nacido) — se inicia **en paralelo** con la NRP. En la práctica neonatal, la ATN_RN se abre al nacimiento; si el RN no responde a los pasos iniciales (calor, secado, estimulación) la NRP se activa como documento adicional vinculado por `atencion_rn_id` (FK obligatoria en el schema SQL — `ece.reanimacion_neonatal.atencion_rn_id NOT NULL`).
- **Identidad temporal del RN** — el RN puede no tener aún CUN/NUI definitivo; el sistema debe permitir vincular la NRP por `atencion_rn_id` mientras se completa la inscripción civil (TDR §22 — "creación automática de expediente al nacimiento" en MINSAL).

Recomendados (no bloqueantes):
- `PARTOGRAMA` — provee contexto del trabajo de parto que explica el deterioro fetal (sufrimiento fetal agudo, líquido meconial, prolapso de cordón).
- `SIG_VIT` materno previos al parto y signos del RN al nacimiento (Apgar 1 y 5 min) — referenciados en sección "causa de inicio".

## Obligatoriedad por modalidad / contexto
- **HOSPITALIZACION neonatal**: CONDICIONAL — se activa cuando se cumple al menos uno de los siguientes criterios al evaluar al RN tras el nacimiento (regla AAP 2021):
  - **Apgar a 1 min < 7** (apgar_bajo)
  - **Cianosis central persistente** tras secado y estimulación
  - **Bradicardia neonatal** (FC < 100 lpm sostenida)
  - **Apnea** primaria o secundaria sin respuesta a estimulación táctil
  - **Líquido meconial con RN no vigoroso** (criterio AAP 2021 — la aspiración endotraqueal de rutina ya no se recomienda en RN vigorosos)
  - **Otro criterio clínico documentado** por el neonatólogo / pediatra (campo libre con justificación obligatoria)
- **AMBULATORIO**: NO aplica.
- **EMERGENCIAS adulto/pediátrico**: NO aplica (existe `RCP` adulto/pediátrico separado — fuera del alcance de este documento).

## Roles firmantes / actores
| Rol | Acción | Momento |
|---|---|---|
| `NEONATOLOGO` o `PEDIATRA` (líder de reanimación) | LLENA, LIDERA, FIRMA, RESPONSABLE final del evento | Evento en tiempo real + cierre y firma post-cierre |
| `ENFERMERIA_NEONATAL` (asistencia) | LLENA tiempos / signos / dosis durante el evento; co-registra | Continuo durante el evento |
| `ANESTESIOLOGO` (si presente en cesárea) | LLENA hallazgos relevantes; firma adicional opcional | Solo si participa en el evento |
| `DIR` (Director Técnico) | AUTORIZA anulación con causa documentada | Excepcional |

Roles **NO autorizados** a firmar: enfermería general (no especializada en neonatología), médicos sin certificación NRP vigente. El sistema debe validar la vigencia del certificado NRP del firmante (PENDIENTE — backlog futuro, integración con catálogo de credenciales del personal).

## Campos obligatorios mínimos NTEC
Mapeados a columnas de `ece.reanimacion_neonatal` (Prisma `EceReanimacionNeonatal` + schema SQL real documentado en `74_reanimacion_neonatal.sql`):

**Identificación y apertura:**
- `id` — UUID PK
- `atencion_rn_id` — FK NOT NULL → `ece.documentos_obstetricos(id)` (vincula al evento de nacimiento)
- `apertura_en` — `timestamptz NOT NULL DEFAULT now()` — momento de inicio del evento NRP (registro automático)
- `registrado_por` — FK NOT NULL → `ece.personal_salud(id)` (metadato Art. 55, nivel segundo)

**Causa de inicio** (PENDIENTE — campo `causa_inicio` no existe en schema SQL actual; el TDR exige justificar inicio. Validar con @AS/@AE si se modela como columna `causa_inicio enum` o como JSONB `datos.causa_inicio`):
- `causa_inicio` (esperado): `apgar_bajo | cianosis | bradicardia | apnea | meconio_no_vigoroso | otro`
- `causa_inicio_otro_detalle` — text obligatorio cuando `causa_inicio = otro`

**Pasos NRP ejecutados (checklist con timestamps — registro de latencia):**
- `estimulacion_tactil_en` — `timestamptz` — hora de calor / secado / estimulación táctil (pasos iniciales)
- `vpp_iniciada_en` — `timestamptz` — hora de inicio de Ventilación con Presión Positiva
  - `vpp_presion_cmh2o` — presión usada (típico 20–30 cmH2O en RN término)
  - `vpp_frecuencia_rpm` — frecuencia respiratoria asistida (típico 40–60 rpm)
  - `vpp_fi_o2_pct` — FiO2 inicial (21% en RN ≥35 sem; 21–30% en pretérmino — guía AAP 2021)
- `intubacion_en` — `timestamptz` — hora de intubación orotraqueal (si aplica)
  - `tubo_size_mm` — número del tubo endotraqueal (2.5 / 3.0 / 3.5 / 4.0 según peso/edad gestacional)
  - `intubacion_nota` — notas técnicas (intentos, dificultad, confirmación de posición)
- `mce_iniciado_en` — `timestamptz` — hora de inicio de Masaje Cardíaco Externo / compresiones torácicas
  - `mce_ratio` — relación compresión/ventilación (estándar AAP: 3:1 = 90 compresiones + 30 ventilaciones/min)
- **Medicamentos**:
  - `adrenalina_dosis_ml` — `numeric` (volumen administrado)
  - `adrenalina_concentracion` — concentración (típico 1:10,000 = 0.1 mg/mL)
  - `adrenalina_via` — vía (`UMBILICAL_IV | ENDOTRAQUEAL | PERIFERICA_IV`)
  - `adrenalina_en` — `timestamptz` (hora de administración)
  - `volumen_expansor_ml` — `numeric` (volumen de expansor)
  - `volumen_expansor_tipo` — tipo (`SS_FISIOLOGICA | LACTATO_RINGER | SANGRE_O_NEG`)
  - `volumen_expansor_en` — `timestamptz`

**Cateterismo umbilical** (PENDIENTE — no aparece como columna en el schema actual; modelar como JSONB `datos.cateterismo_umbilical { realizado, hora, profundidad_cm, complicaciones }`).

**Monitoreo seriado** (PENDIENTE — modelado actualmente como JSONB `datos` en `EceReanimacionNeonatal.datos`; idealmente debería ser tabla hija `ece.reanimacion_neonatal_evento` con `(reanimacion_id, instante_seg, fc_lpm, spo2_pct, fio2_pct, intervencion)` para curvas de FC y curva de Dawson SpO2):
- `fc_post_intervencion` — `smallint` (FC tras la intervención principal — único snapshot en schema actual)
- `fc_post_en` — `timestamptz`
- **FC seriada** (en JSONB `datos.fc_serie`): array `[{ t_seg, fc_lpm }]` cada 30s
- **SpO2 seriada** vs curva Dawson (en JSONB `datos.spo2_serie`): array `[{ t_min, spo2_obj_pct, spo2_real_pct }]`

**Cierre del evento:**
- `cerrado_en` — `timestamptz` — NULL = en curso, NOT NULL = cerrado (lock por RLS)
- `cerrado_por` — FK → `ece.personal_salud(id)`
- `notas_cierre` — text — resumen del evento, condición del RN al cierre, justificación del resultado
- `resultado` — `ece.resultado_nrp` ENUM — **valores confirmados HF-22**: `estable | cuidados_intermedios | UCIN | defuncion`
- **Duración total** (calculada): `cerrado_en - apertura_en` (no almacenado, derivado)

**Traslado / destino post-NRP** (PENDIENTE — modelar como columna `destino_post_nrp` o derivar de `resultado`):
- `UCIN` (Unidad de Cuidados Intensivos Neonatales) — si `resultado = UCIN`
- `UCIP` (Unidad de Cuidados Intermedios Pediátricos / Neonatal)
- `ALOJAMIENTO_CONJUNTO` (con la madre) — si `resultado = estable`
- `MORGUE` — si `resultado = defuncion`

**Firma electrónica simple** — registrada en `ece.firma_electronica`, referenciada desde `documento_instancia_historial.firma_id` en la transición `firmar`/`cerrar`. **Obligatoria** del neonatólogo/pediatra líder (Art. 23 lit. a.4 NTEC). Firma de enfermería opcional adicional.

**Campos de contingencia** (F2-S15 Stream A — registro retroactivo en papel):
- `digitado_retroactivamente` (boolean, default false)
- `timestamp_real_papel` (timestamptz nullable) — momento real del evento si se digita post-hoc
- `contingencia_evento_id` (uuid nullable) — FK al evento de contingencia justificativo

PENDIENTE — confirmar con @AS si estos campos de contingencia están presentes en `ece.reanimacion_neonatal` o si se inyectan vía la instancia genérica de documento (`ece.documento_instancia`).

## Estados (flujo_estado)
Estados aplicables del catálogo `ece.flujo_estado` (sembrado por bloque DO de `63_ece_08_seed.sql`):

- `borrador` (inicial) → `en_curso` → `cerrado` (≡ firmado) → `validado` (final) → `anulado` (final alternativo)

Estado terminal por defecto: **`validado`** (post-firma del neonatólogo + visto del jefe de servicio neonatal si aplica).

Notas específicas NRP:
- `borrador` es transitorio (segundos): al activarse la apertura se pasa inmediatamente a `en_curso`.
- `en_curso` corresponde a `cerrado_en IS NULL` en la tabla — durante este estado el RLS policy `rn_update` permite UPDATE.
- `cerrado` corresponde a `cerrado_en IS NOT NULL` — UPDATE bloqueado por RLS (defensa adicional al audit-hash-chain).
- **Inmutabilidad real** post-cierre: la bitácora `documento_instancia_historial` es append-only (trigger `trg_historial_inmutable`) + RLS update lock por `cerrado_en NOT NULL`.

## Transiciones (flujo_transicion)
| origen | destino | acción | rol que autoriza | requiere firma | condición funcional |
|---|---|---|---|---|---|
| borrador | en_curso | `abrir_evento` | NEONATOLOGO / PEDIATRA | NO | Causa de inicio documentada |
| en_curso | en_curso | `registrar_intervencion` | NEONATOLOGO / PEDIATRA / ENFERMERIA_NEONATAL | NO | Cualquier paso NRP (VPP / intubación / MCE / medicamento) con timestamp |
| en_curso | cerrado | `cerrar_evento` (firmar) | NEONATOLOGO / PEDIATRA | **SI** | `resultado` capturado + `notas_cierre` + FC post-intervención registrada |
| cerrado | validado | `validar` | Jefe de servicio neonatal (ESP) | NO | Revisión post-evento (puede ser auto-validación si configuración del establecimiento lo permite) |
| borrador | anulado | `anular` | DIR | **SI** | Anulación con causa documentada (evento abierto por error, paciente no requería realmente reanimación) |
| en_curso | anulado | `anular` | DIR | **SI** | Solo en caso excepcional con justificación robusta (ej. evento creado a paciente equivocado, RN sano) |

Transiciones **bloqueadas** (no sembradas, prohibidas):
- `cerrado → en_curso` (no rollback post-firma; abrir un evento NUEVO si hay re-reanimación)
- `validado → *` salvo `anulado` (excepcional con DIR)
- Cualquier UPDATE a campos clínicos cuando `cerrado_en IS NOT NULL` (bloqueado por RLS policy `rn_update`).

Caso especial: **re-reanimación** dentro del mismo episodio neonatal (ej. RN extubado que requiere segunda VPP a las 6 horas). Se abre **una nueva instancia NRP** vinculada al mismo `atencion_rn_id`; no se reutiliza la primera instancia.

## Eventos de dominio
Convención: `ece.<codigo_documento>.<accion>`. Payload obligatorio: `organization_id`, `establishment_id`, `paciente_rn_id`, `atencion_rn_id`, `instancia_id`, `actor_id`, `timestamp`.

- `nrp.iniciado` — payload: `{ instancia_id, atencion_rn_id, causa_inicio, apertura_en, lider_id }`
- `nrp.estimulacion_tactil` — payload: `{ instancia_id, timestamp }`
- `nrp.vpp_iniciada` — payload: `{ instancia_id, presion_cmh2o, frecuencia_rpm, fi_o2_pct, timestamp }`
- `nrp.intubacion` — payload: `{ instancia_id, tubo_size_mm, intentos, timestamp }`
- `nrp.compresiones` — payload: `{ instancia_id, mce_ratio, timestamp_inicio }`
- `nrp.medicamento_administrado` — payload: `{ instancia_id, medicamento: 'adrenalina'|'expansor', dosis, concentracion, via, timestamp }`
- `nrp.fc_registrada` — payload: `{ instancia_id, instante_seg, fc_lpm, spo2_pct }` (alta frecuencia — considerar batch / outbox)
- `nrp.cerrado` — payload: `{ instancia_id, resultado, duracion_min, fc_post, cerrado_por, cerrado_en }`
- `nrp.firmado` — payload: `{ instancia_id, firma_id, hash_documento, firmante_id, firmado_en }` (Art. 23 + Art. 55 NTEC)
- `nrp.validado` — payload: `{ instancia_id, validador_id, timestamp }`
- `nrp.anulado` — payload: `{ instancia_id, autorizado_por_dir_id, motivo, timestamp }`
- `nrp.derivacion_ucin` — payload: `{ instancia_id, paciente_rn_id, expediente_ucin_id, timestamp }` (efecto colateral cuando `resultado = UCIN`)
- `nrp.derivacion_defuncion` — payload: `{ instancia_id, paciente_rn_id, cert_def_neonatal_id, timestamp }` (efecto colateral cuando `resultado = defuncion`)

PENDIENTE — validar con @AS si los eventos se emiten vía `audit.AuditLog` (hash-chain Art. 55) o vía outbox de notificaciones (`packages/database/sql/42_notifications_outbox.sql`). Por la alta frecuencia de `nrp.fc_registrada` durante el evento, recomendable outbox + batch.

## Drift conocido (audit) y riesgos
Hallazgos relevantes detectados durante el audit masivo 2026-05-19 y trabajo subsecuente:

- **HF-22 [P0 — resuelto]** — Enum SQL real `ece.resultado_nrp` no coincidía con el contrato del router tRPC inicial. **Confirmado vía MCP Supabase** (`mcp__supabase__list_extensions` + introspección): el enum se llama `ece.resultado_nrp` (no `resultado_reanimacion`) y los valores son **mixed-case** — `{estable, cuidados_intermedios, UCIN, defuncion}` con **UCIN en uppercase** (acrónimo Unidad de Cuidados Intensivos Neonatales) y los otros tres en lowercase. Router corregido (opción B aprobada por @AS): el contrato Zod usa exactamente esos strings (`z.enum(["estable", "cuidados_intermedios", "UCIN", "defuncion"])` — ver `packages/trpc/src/routers/ece/reanimacion-neonatal.router.ts:62`). El cast SQL `::ece.resultado_nrp` (línea 380 del router) preserva el case-sensitivity.
- **NRP-001 [P1]** — Campo `causa_inicio` no existe como columna explícita en el schema SQL. Vive en `datos JSONB` sin validación de estructura en BD. Recomendación: modelar como columna con CHECK constraint o enum nuevo. PENDIENTE — backlog F3.
- **NRP-002 [P1]** — Monitoreo seriado (FC / SpO2 cada 30s) modelado como JSONB en `datos` en lugar de tabla hija. Compromete consultas analíticas (latencia VPP→FC>100, curva Dawson SpO2). Recomendación: tabla `ece.reanimacion_neonatal_evento` con `(reanimacion_id, instante_seg, fc_lpm, spo2_pct, fio2_pct, intervencion_codigo)`. PENDIENTE — backlog F3.
- **NRP-003 [P1]** — No existe validación de **certificación NRP vigente** del firmante. Cualquier `NEONATOLOGO` o `PEDIATRA` puede firmar aunque su certificado AAP haya expirado. Recomendación: integrar con catálogo de credenciales del personal y validar `personal_salud.certificacion_nrp_vence_en >= now()` en el procedure `cerrar`. PENDIENTE.
- **NRP-004 [P2]** — `estado_registro` en la tabla es `VarChar(20)` default `borrador` sin CHECK constraint (mismo patrón heredado de HC). Permite valores fuera de catálogo NTEC. Mismo riesgo descrito en NEV / HIST_CLIN.
- **NRP-005 [P2]** — No hay trigger explícito de inmutabilidad físico en `ece.reanimacion_neonatal` post-firma para campos no-`cerrado_en` (la RLS bloquea UPDATE cuando `cerrado_en IS NOT NULL`, pero un `service_role` con BYPASSRLS podría mutar). El audit-hash-chain detecta el cambio pero no lo previene. Defensa actual = RLS + hash-chain.
- **NRP-006 [P2]** — `atencion_rn_id` FK a `ece.documentos_obstetricos(id)` puede dejar NRP huérfanas si el RN no se inscribió civilmente aún (CUN/NUI pendientes). El sistema permite el vínculo temprano y el `paciente_id` se resuelve por la cadena ATN_RN → episodio → paciente; verificar que las consultas siempre usen el path completo y no `paciente_id` directo. PENDIENTE — verificar router.
- **NRP-007 [P2]** — Eventos `nrp.fc_registrada` pueden generar **cientos de filas en audit log** por evento de reanimación (FC cada 30s × 20 min = 40 eventos). Si se emiten a `audit.AuditLog` con hash-chain individual, puede generar contención de lock. Recomendación: batching o cambio a outbox dedicado. PENDIENTE.

Drift adicional detectado al 2026-05-22:
- **Sin equivalente legacy HIS** — No existe módulo `/clinical/neonatology` o `/neonatal-resuscitation` actualmente. La ruta `/ece/neonatologia/nrp` es nueva y no aplica regla "adecuar, no duplicar" del CLAUDE.md (no hay nada que adecuar). Sin embargo, **antes de implementar** el siguiente desarrollador DEBE verificar (regla CLAUDE.md): `Glob "apps/web/src/app/(clinical)/neonatology/**"` y `Glob "apps/web/src/app/(clinical)/neonatal*/**"` — si aparece algún módulo legacy, extenderlo en lugar de crear `/ece/neonatologia/nrp` desde cero.
- **Sidebar** — agregar un solo item `Reanimación Neonatal NRP` bajo sección Neonatología; no duplicar.

## Descripción markdown rica (para BD `descripcion_markdown`)

> **Hoja de Reanimación Neonatal (NRP)** — Registro oficial del evento de reanimación de un recién nacido (RN) según el protocolo **NRP** estandarizado por la **American Academy of Pediatrics (AAP)** y la **American Heart Association (AHA)** — 8ª edición (2021).
>
> **Estándar AAP/AHA** — La secuencia NRP es internacional y obligatoria: **Calor → Vía aérea → Estimulación → VPP → Compresiones → Medicamentos**. No es opcional ni configurable; los pasos son secuenciales y el siguiente solo se activa si el anterior falló en alcanzar la meta (FC > 100 lpm con respiración espontánea efectiva). La hoja documenta cuál paso se ejecutó y cuándo.
>
> **La frecuencia cardíaca (FC) es el indicador principal** — no el Apgar. El Apgar se calcula al final (1, 5 y 10 min) pero las decisiones durante el evento se toman por FC: <100 lpm → VPP; <60 lpm a pesar de VPP efectiva → compresiones torácicas; <60 lpm a pesar de compresiones → adrenalina. Por eso el registro de FC seriada (cada 30 seg) es **crítico** y diferencia legalmente una reanimación bien conducida de una mal conducida.
>
> **Cuándo se usa:** SOLO cuando el RN no responde a los pasos iniciales (calor, secado, estimulación táctil) y se cumple al menos uno de los criterios de inicio (Apgar 1 min < 7, cianosis central persistente, bradicardia FC < 100 lpm, apnea, líquido meconial con RN no vigoroso). NO se usa en RN vigorosos que solo requieren cuidados de rutina post-parto.
>
> **Qué NO es:** no es la Hoja de Atención del Recién Nacido (`ATN_RN`) — esa es OBLIGATORIA en todo nacimiento; la NRP es CONDICIONAL. No es RCP de adulto/pediátrico (otros protocolos). No es nota de evolución pediátrica (`EVOL_MED`). No es defunción neonatal (`CERT_DEF`) — pero **la dispara** cuando `resultado = defuncion`.
>
> **Efectos colaterales del resultado**:
> - `resultado = estable` → traslado a alojamiento conjunto con la madre, NRP cerrada como antecedente del expediente neonatal.
> - `resultado = cuidados_intermedios` → traslado a UCIP / Cuidados Intermedios Neonatales.
> - `resultado = UCIN` → dispara apertura automática del expediente UCIN (Unidad de Cuidados Intensivos Neonatales) con la hoja firmada como antecedente clínico inmediato.
> - `resultado = defuncion` → dispara `CERT_DEF` neonatal con CIE-10 estructurado del **modelo perinatal P00–P96** (causa básica de muerte + causas inmediatas) y notificación a registro civil / MINSAL.
>
> **Médico-legal — registro de tiempos crítico** — La defensa legal ante eventos adversos neonatales depende casi enteramente de las **latencias** documentadas: "tiempo desde nacimiento hasta VPP iniciada" debe ser < 60 seg para cumplir estándar AAP. Una NRP bien firmada con timestamps automáticos (no manuales) por intervención es **la evidencia procesal más robusta** disponible. Por eso los timestamps de pasos NRP se capturan por reloj del sistema, no se editan retroactivamente excepto en flujo de contingencia documentado.
>
> **Ejemplos típicos:**
> - RN término con Apgar 4-6 al minuto, respuesta a VPP 60 seg, Apgar 8 al minuto 5, traslado a alojamiento conjunto. Resultado: `estable`.
> - RN pretérmino 32 sem, apnea primaria, intubación al minuto 2, traslado a UCIN sin compresiones. Resultado: `UCIN`.
> - RN con sufrimiento fetal agudo, Apgar 1/3/5, compresiones + adrenalina endotraqueal + cateterismo umbilical + adrenalina IV; recuperación parcial pero hipoxia severa → UCIN con ventilación mecánica. Resultado: `UCIN`.
> - RN extremo prematuro (<24 sem) sin viabilidad, decisión consensuada con familia de no escalar maniobras; cuidados de confort. Resultado: `defuncion` con apertura de `CERT_DEF` neonatal.
>
> **Errores comunes:**
> - Confundir NRP con ATN_RN — la ATN_RN se llena SIEMPRE; la NRP solo cuando hay maniobras.
> - **Editar manualmente los timestamps** post-cierre para "mejorar" las latencias — esto es **fraude documental** y la bitácora append-only + audit-hash-chain lo detectan. Si hubo discrepancia con el reloj, dejarlo registrado en `notas_cierre`, no editar timestamps.
> - **Cerrar el evento sin FC post-intervención** registrada — el sistema debería bloquearlo (la FC es el indicador final del NRP), pero verificar enforcement en el procedure `cerrar`.
> - Olvidar disparar `CERT_DEF` cuando `resultado = defuncion` — debe ser automático (efecto colateral del evento `nrp.derivacion_defuncion`), no manual.
> - Reabrir la NRP para "completar campos" después del cierre — la RLS lo bloquea (`USING (cerrado_en IS NULL)`). Si faltó información, emitir **rectificación trazable** (Art. 42 NTEC) con justificación.
> - Capturar la NRP en `datos` JSONB sin tipar (causa_inicio, FC seriada, SpO2 seriada) — viola la estructura de datos del NTEC y compromete análisis epidemiológicos. Cuando los campos se normalicen (NRP-001, NRP-002), migrar JSONB legacy.
