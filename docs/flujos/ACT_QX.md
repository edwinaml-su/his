# ACT_QX — Acta Quirúrgica (Nota Operatoria)

## Metadata

- **codigo**: `ACT_QX` (alias normativo del documento "Acta Quirúrgica / Nota Operatoria del cirujano"). El motor de workflow ECE sembrado en `packages/database/sql/63_ece_08_seed.sql` agrupa el conjunto de documentos del acto quirúrgico bajo el código `ACTO_QX` (Doc 13 — "Documentos del Acto Quirúrgico: checklist + nota operatoria + registro anestésico + URPA"). Este archivo documenta de forma específica la **nota operatoria del cirujano** dentro de ese paquete; los satélites (`WHO_CHECK`, `REG_ANEST`, `URPA`) tienen sus propios artefactos. Pendiente decidir con @AE/@PO si se desagrega `ACT_QX` como tipo de documento independiente del paraguas `ACTO_QX` (drift §1).
- **nombre**: Acta Quirúrgica (Nota Operatoria / Protocolo Operatorio del Cirujano)
- **modalidad**: `QUIRURGICO` (HOSPITALARIO en el catálogo ECE — seed declara `modalidad='hospitalario'` para `ACTO_QX`). Aplica también a cirugía mayor ambulatoria (CMA) y procedimientos quirúrgicos en hospital de día (`AMBULATORIO` con sedación / anestesia general).
- **NTEC artículo**: Acuerdo n.° 1616 MINSAL (D.O. T.444 N°158, 22/08/2024; reforma D.O. n.°55 T.450, 19/03/2026) — `analisis_workflows_ece.md` §3.13 "Documentos del Acto Quirúrgico". Artículos transversales aplicables: **Art. 19** (ordenamiento cronológico ascendente del expediente — la nota operatoria es eslabón inmediatamente posterior a `CONS_INF` y previo a `REG_ANEST` / `URPA`); **Art. 23 lit. a.4** (firma electrónica simple obligatoria del cirujano principal); **Art. 40** (inmutabilidad post-firma — `inmutable=true` en seed `ACTO_QX`); **Art. 42** (rectificación trazable; correcciones solo por adendum / rectificación con bitácora); **Arts. 55–56** (metadatos obligatorios + bitácora ≥ 2 años; política HIS: 10 años en `audit.audit_log`). Norma técnica de referencia operativa: **TDR §13** (Módulo de Salas de Operaciones / Quirófanos) y específicamente **TDR §13.4** (Intra-operatorio) + **TDR §13.6** (Trazabilidad — exige *"Reporte operatorio firmado en máximo 24h"*).
- **modulo_his_target**: `/ece/cirugia/acta-qx` (ruta normativa NTEC, listado + wizard de captura + detalle inmutable). En el HIS legacy el dato intra-operatorio vive como campos `intraopNotes` / `postopNotes` en `public.SurgeryCase` (Prisma `SurgeryCase`, `packages/database/prisma/schema.prisma:2518–2570`). Decisión arquitectónica obligatoria CLAUDE.md §"Adecuar legacy vs duplicar": **extender** el módulo legacy `(clinical)/surgery` / `SurgeryCase` para escribir además en `ece.acto_quirurgico` cuando el episodio esté gobernado por ECE, y exponer un solo item de sidebar para el caso quirúrgico; el wizard `/ece/cirugia/acta-qx` es la vista NTEC formal sobre la misma fila de `SurgeryCase` (vinculada por `encounterId ↔ ece.episodio_atencion.id` a través del bridge `eceBridgeCirugia`). **NO** duplicar el dominio quirúrgico como ruta paralela.
- **tabla_datos**: `ece.acto_quirurgico` (definida en `packages/database/sql/61_ece_06_documentos.sql` líneas 485–528; Prisma `EceActoQuiruurgico` con `@@map("acto_quirurgico")` en `packages/database/prisma/schema.prisma:5249`). Es **una fila por acto quirúrgico** (no por documento de evolución intra-operatoria). Las series temporales — registro anestésico transanestésico, lecturas URPA — se conservan en **tablas satélite** (`ece.registro_anestesico`, `ece.urpa_recovery`) cuando exceden el umbral de explosión OLTP; los campos JSONB `registro_anestesico` y `recuperacion_urpa` dentro de `acto_quirurgico` se mantienen para snapshots resumidos legados de §3.13 y para BIs de baja resolución. En paralelo, el caso quirúrgico HIS vive en `public.SurgeryCase` (legacy TDR §13.2) y se reconcilia vía bridge.
- **inmutable**: `true` **estricto post-firma** del cirujano principal (Art. 40 NTEC). Refuerzo a nivel de motor de base de datos por el trigger condicional `ece.fn_bloquea_mutacion_acto_qx` instalado en `packages/database/sql/99_acto_quirurgico_trigger_condicional.sql` — bloquea `UPDATE`/`DELETE` cuando `estado_codigo IN ('firmado', 'validado', 'anulado')`, permitiendo escritura libre en `borrador` (necesario para captura intra-operatoria iterativa). Este trigger sustituye al genérico `fn_bloquea_mutacion` aplicado en HE-06 (PR remediation Sprint S4 Stream E), siguiendo el patrón ya aplicado en Epicrisis (A-05 / PR #176) y Consentimiento (C-01 / PR #177). Rectificación post-firma: solo por **adendum** (nota operatoria correctora vinculada al original) o **rectificación trazable** Art. 42 con `ece.rectificacion` (usuario + timestamp + diferencia textual + justificación).
- **tipo_registro**: **OBLIGATORIO SIEMPRE** en **TODA** cirugía iniciada (con o sin completar) — categoría `historico` en el seed (`ece.tipo_documento.tipo_registro='historico'`). Aplica a cirugía mayor, menor con sedación, urgente, electiva, CMA y procedimientos quirúrgicos diagnósticos (biopsia abierta, endoscopía operatoria, etc.). No aplica a procedimientos puramente ambulatorios sin tiempo quirúrgico (curaciones, infiltraciones, suturas sin anestesia regional/general) — para esos basta `EVOL_MED` o nota de procedimiento ambulatorio.

---

## Propósito normativo

El **Acta Quirúrgica / Nota Operatoria** es el documento **clínico-legal central** del acto quirúrgico: es el registro en el que el **cirujano principal** describe **qué se hizo, cómo se hizo, qué se encontró, qué pasó y cómo terminó** el paciente. Es el eslabón documental que cierra el bloque quirúrgico iniciado por la valoración preoperatoria (`PREOP`), validado por el consentimiento informado (`CONS_INF` / `CONS_QX`) y la lista de verificación de cirugía segura OMS (`WHO_CHECK`), y que abre el bloque postoperatorio inmediato (`REG_ANEST` cierre + `URPA` + alta a piso/UCI o domicilio en CMA).

Tres funciones legales y operativas inseparables:

1. **Soporte clínico para el manejo postoperatorio inmediato y diferido.** Sin la nota operatoria firmada, el médico de URPA, el médico de turno de hospitalización, el cirujano que reciba al paciente en interconsulta o la persona que codifique CIE-10 / CIE-9-CM / CPT no tienen base documental para sus decisiones. La descripción de la vía de abordaje, los hallazgos, las suturas, las prótesis colocadas, los drenajes dejados y el estado al salir condicionan las indicaciones de URPA, los signos a monitorizar, las restricciones de alimentación/movilización, los antibióticos y la prevención tromboembólica.
2. **Base administrativa-financiera y de codificación.** El procedimiento **realmente realizado** (con código CIE-9-CM Volumen 3 / CPT / CIE-10 PCS según convención institucional) es el insumo primario para la cuenta hospitalaria — cargo de tiempo de sala, anestesiólogo, equipo quirúrgico, instrumental, prótesis (UDI), insumos consumidos — y para la codificación de egreso CIE-10. **El procedimiento realizado puede diferir del programado** (cambio de técnica por hallazgo intraoperatorio, conversión de laparoscopía a laparotomía, ampliación quirúrgica autorizada en consentimiento) y el cargo se hace sobre el realizado, no sobre el programado.
3. **Defensa médico-legal frente a complicaciones, reclamos y juicios.** Toda complicación intraoperatoria, conversión, sangrado mayor, lesión iatrogénica de estructura no programada, conteo final incorrecto de instrumental o gasas, transfusión intraoperatoria y muestra enviada a patología debe quedar **fielmente documentada** en el acta. La inmutabilidad post-firma (Art. 40) protege tanto al paciente — que tiene constancia indeleble del acto — como al equipo quirúrgico — cuya descripción cronometrada y firmada constituye descargo de responsabilidad asistencial.

El TDR §13.6 fija además el plazo límite de **firma en 24h** posterior al fin de cirugía. Tras ese plazo, el módulo debe emitir alerta (`act_qx.firma_atrasada`) y el documento se mantiene en `borrador` con marca temporal de demora — pero **no se elimina** ni se completa por delegación; la firma del cirujano principal es **personal e indelegable** (Art. 23 lit. a.4 NTEC).

---

## Dependencias (depende_de)

Documentos / hechos que **deben** existir y estar firmados / cumplidos antes de la **firma** del acta (no necesariamente antes de su creación en borrador, que se abre en paralelo a la entrada a sala):

- **`PROG_QX`** — Programación quirúrgica confirmada y en estado de ejecución (`reserva_sala_qx.estado IN ('confirmado', 'en_curso')`). El bridge `eceBridgeCirugia.programarCirugia` (PR #pendiente — `packages/trpc/src/routers/ece/bridge-cirugia.router.ts`) crea de forma atómica `orden_ingreso` + `episodio_atencion` + `episodio_hospitalario` + `preop_checklist` + `reserva_sala_qx`, dejando lista la cabecera del caso quirúrgico desde donde se enganchará la nota operatoria. Si la cirugía se ejecuta sin programación previa (urgencia absoluta), se acepta `motivo_ingreso_tipo='cirugia'` con `circunstancia_ingreso='urgente'` y se documenta la justificación en la propia acta.
- **`CONS_INF`** — Consentimiento Informado del paciente (modalidad `quirurgico`) **firmado** — tanto la doble firma paciente+MC del documento principal `ece.consentimiento_informado` como, si aplica, el satélite `ece.consentimiento_quirurgico` (tipo de anestesia autorizada, transfusión autorizada, ampliación quirúrgica autorizada, fotografía/grabación autorizada). El seed declara `ACTO_QX.depende_de := array['CONS_INF']` en `63_ece_08_seed.sql:73`. Sin `CONS_INF` firmado, la firma del acta queda bloqueada por el motor de workflow ECE.
- **`PREOP`** — Valoración preoperatoria (`ece.preop_checklist`) firmada — incluye ASA, exámenes pre-operatorios verificados, ayuno verificado, profilaxis antibiótica y tromboembólica indicadas (TDR §13.2). Es la columna `valoracion_preop` JSONB de `ece.acto_quirurgico` o, cuando se modela por separado, fila vinculada vía `episodio_hospitalario_id`.
- **`WHO_CHECK`** — Lista de Verificación de Cirugía Segura OMS — al menos la fase **sign-in** completada (pre-anestesia, antes de inducción) para abrir el acta. El `time-out` (pre-incisión) y el `sign-out` (post-cierre, antes de salir de quirófano) son **bloqueantes para la firma**: el `sign-out` valida el conteo final de instrumental y gasas, las muestras de patología y los problemas de equipamiento, ítems que el acta también consigna (`conteo_final_instrumental_gasas`, `piezas_anatomicas_enviadas_patologia`). La FK `ece.who_checklist.acto_quirurgico_id → ece.acto_quirurgico.id` la ata 1:1 al acto.

Recomendados (no bloqueantes a nivel motor, pero exigibles por proceso institucional):

- **`SIG_VIT` pre-inducción** — signos vitales de entrada a sala (`ece.signos_vitales` del episodio, dentro de la ventana ±30 min al inicio de cirugía).
- **`SOL_EST` / `RES_EST` de imagen pre-quirúrgica** — RX, TAC, RMN o equivalente disponibles en sala (verificado en `WHO_CHECK.time_out.imagenes_disponibles`).

---

## Obligatoriedad por modalidad / contexto

| Modalidad / contexto | ¿Obligatorio? | Norma de referencia |
|---|---|---|
| Cirugía mayor electiva (hospitalización) | **SI siempre** | NTEC §3.13 + TDR §13.4 + Art. 40 |
| Cirugía mayor de urgencia | **SI siempre** | NTEC §3.13 + TDR §13 (no exime por urgencia, sí permite firma diferida ≤ 24h) |
| Cirugía menor con anestesia general o regional | **SI siempre** | TDR §13.4 — toda intervención en sala con anestesia distinta de local pura |
| Cirugía mayor ambulatoria (CMA, hospital de día) | **SI siempre** | TDR §6.2 — episodios "cirugía mayor ambulatoria" tipificados |
| Procedimientos quirúrgicos diagnósticos en sala (biopsia abierta, endoscopía operatoria) | **SI** | NTEC §3.13 — equivale a acto quirúrgico |
| Procedimiento ambulatorio sin tiempo de sala (sutura, infiltración, drenaje en consultorio) | **NO** | TDR §6.3 — basta nota de procedimiento ambulatorio en `EVOL_MED` |
| Cesárea / parto operatorio | **SI** (`ACT_QX` + `DOC_OBST` parto operatorio en paralelo) | NTEC §3.13 + §3.14 |
| Cirugía iniciada y abortada antes de incisión (cancelación intra-operatoria por ASA inestable, etc.) | **SI** (con descripción detallada del motivo y momento de detención) | TDR §13.6 — trazabilidad obligatoria |

---

## Roles firmantes / actores

| Rol | Acción | Momento | Mecanismo de firma |
|---|---|---|---|
| **CIRUJANO_PRINCIPAL** (rol ECE `ESP` — Especialista; rol HIS `PHYSICIAN`) | LLENA, RESPONSABLE, FIRMA. Dicta o redacta el cuerpo de la nota; firma. Acción **personal e indelegable**. | Post-cirugía inmediato; plazo límite TDR §13.6 = 24h tras fin de cirugía. | **PIN electrónico argon2id** validado contra `ece.firma_electronica` (lockout 5 intentos); registro en `documento_instancia_historial.firma_id`. |
| **AYUDANTE_CIRUJANO** / **PRIMER_AYUDANTE** (rol HIS `PHYSICIAN`, rol ECE `ESP` o `MT`) | Co-firma (cuando la institución la exija — por defecto opcional). Validación adicional ante complicaciones graves. | Inmediatamente post-firma del cirujano principal. | PIN argon2id, registrado en `ayudantes` JSONB con `firma_id` y `firmado_en`. |
| **ANESTESIÓLOGO** | NO firma el acta quirúrgica (firma su propio `REG_ANEST`). Aparece como dato declarado en `anestesiologo_id` del acta. | — | — |
| **INSTRUMENTISTA / CIRCULANTE** (rol `ENF`) | NO firma el acta quirúrgica (su responsabilidad cae en el `WHO_CHECK.sign_out` y en la hoja de circulante / cargo de insumos). Aparece como dato declarado en `ayudantes` JSONB. | — | — |
| **ESP (jefe de servicio quirúrgico)** | Validación post-firma (transición `firmar → validado`). Visto bueno administrativo / de calidad. | Tras firma del cirujano principal, dentro de las primeras 48h post-cirugía. | Sin firma electrónica obligatoria (`requiere_firma=false` en seed `63_ece_08_seed.sql:263`). |
| **DIR** | Anulación universal (`anular`, transición universal a `anulado`) en casos de error administrativo / acta abierta por error / paciente equivocado detectado antes de la firma. | Solo desde `borrador`. | Firma DIR obligatoria (`requiere_firma=true` en bloque 5b universal). |

Fuente: matriz `ece.documento_rol` en `63_ece_08_seed.sql:405–409` — `('ACTO_QX', 'ESP', 'LLENA', true)`, `RESPONSABLE`, `FIRMA`, `AUTORIZA`. Perfil de acceso (Art. 45, 52 NTEC): `ESP` tiene `escritura` y `firma` sobre `acto_quirurgico` (`63_ece_08_seed.sql:493–494`).

---

## Campos obligatorios

Mapeados a columnas de `ece.acto_quirurgico` (Prisma `EceActoQuiruurgico`) y, cuando viven en JSONB, a la sub-estructura documentada en `61_ece_06_documentos.sql`. **`{*}`** indica campo crítico médico-legal cuya ausencia debe bloquear la transición a `firmado`.

### Identificación y cabecera (tipados como columnas)

- `episodio_id` *(uuid NOT NULL FK `ece.episodio_atencion.id`)* — episodio quirúrgico abierto por `eceBridgeCirugia.programarCirugia`.
- `paciente_id` *(uuid)* — derivado del episodio (defensa en profundidad — Prisma lo expone como nullable, pero el bridge lo puebla).
- `instancia_id` *(uuid FK `ece.documento_instancia.id`)* — vínculo al motor de workflow ECE (estado, transiciones, firma).
- `cirujano_id` *(uuid NOT NULL FK `ece.personal_salud.id`)* — cirujano principal, autor del acta.
- `anestesiologo_id` *(uuid FK `ece.personal_salud.id`)* — declarado (firma su propio `REG_ANEST`).

### Tiempos quirúrgicos (TDR §13.4)

- `hora_inicio` *(timestamptz)* — **fecha y hora de inicio real** de la cirugía (incisión cutánea). Distinta de la hora de entrada a sala (que vive en `reserva_sala_qx.fecha_inicio`) y de la hora de inducción anestésica (que vive en `REG_ANEST`). **{*}**
- `hora_fin` *(timestamptz)* — **fecha y hora de fin real** (cierre de piel / fin del acto del cirujano). **{*}**
- `duracion_min_real` *(derivado)* — `EXTRACT(EPOCH FROM hora_fin - hora_inicio)/60`. No persistido como columna física, computado en BI / reportes.

### Diagnósticos

- `diagnostico_pre` *(text)* — diagnóstico preoperatorio (el que motivó la programación). Idealmente con código CIE-10 estructurado (PENDIENTE — validar con @DBA si conviene migrar a JSONB tipado como en `evolucion_medica.diagnostico_cie10`).
- `diagnostico_post` *(text)* — **diagnóstico postoperatorio** (lo que efectivamente se confirmó tras el acto). **PUEDE DIFERIR del preoperatorio** — diferencia típica en oncología (T/N/M intraoperatorio), abdomen agudo (hallazgo distinto al sospechado), etc. La diferencia es información clínica relevante, no error. **{*}**

### Procedimiento realizado y vía de abordaje

- `procedimiento_realizado` *(text)* — **descripción narrativa detallada** del procedimiento ejecutado.
- `procedimiento_cie10_pcs_real` *(text — recomendado mover a JSONB tipado)* — **código del procedimiento REALMENTE realizado** (CIE-9-CM Volumen 3 / CIE-10 PCS / CPT según convención institucional). **Puede diferir del `procedimiento_cie10` programado** en `reserva_sala_qx`. Es la fuente de verdad para cargo y codificación de egreso. **{*}**
- `via_abordaje` *(text — enum candidato)* — `LAPAROTOMIA | LAPAROSCOPIA | TORACOTOMIA | TORACOSCOPIA | MININVASIVA | CRANEOTOMIA | VAGINAL | TRANSURETRAL | ENDOSCOPICA | ARTROSCOPIA | ROBOTICA | OTRA`. Si hay **conversión** (ej. laparoscopía → laparotomía) se registra ambas + motivo en `hallazgos`. **{*}**

### Hallazgos, técnica y eventos intraoperatorios

- `hallazgos` *(text)* — **hallazgos intraoperatorios** descriptivos: anatomía encontrada, patología macroscópica, variantes anatómicas, adherencias, etc. **{*}**
- `tecnica_quirurgica_detallada` *(actualmente subsumido en `procedimiento_realizado` text — candidato a desagregar)* — descripción paso a paso de la técnica usada (incisión, exposición, sección/resección/anastomosis/cierre por planos, drenajes, suturas con tipo de material).
- `sangrado_estimado_ml` *(integer — actualmente vive en `valoracion_preop` o `registro_anestesico` JSONB; candidato a columna física)* — pérdida hemática estimada. **{*}**
- `complicaciones_intraoperatorias` *(text)* — toda complicación, lesión iatrogénica de estructura no programada, evento adverso intraoperatorio. **Si vacío, requiere declaración explícita "sin complicaciones"** para descargo legal. **{*}**

### Equipo real

- `ayudantes` *(JSONB)* — estructura `[{ personal_salud_id, rol: 'primer_ayudante'|'segundo_ayudante'|'instrumentista'|'circulante', nombre_completo, especialidad? }]`. **Equipo realmente presente** (puede diferir del programado por sustituciones). **{*}**

### Transfusiones, piezas y conteos (críticos médico-legales)

- `transfusiones_intraoperatorias` *(JSONB — candidato dentro de `valoracion_preop` o expansión nueva)* — `[{ componente: 'PRBC'|'PFP'|'PLT'|'CRIO', unidades: integer, numero_unidad: string, hora_administracion: timestamptz, banco_sangre_request_id?: uuid }]`. Vínculo al módulo Banco de Sangre HIS (`TransfusionRequest` / `Transfusion`). **{*}**
- `piezas_anatomicas_enviadas_patologia` *(JSONB — candidato a desagregar)* — `{ enviado: bool, items: [{ descripcion_pieza, conservacion: 'fresco'|'formol'|'congelado', sol_est_patologia_id?: uuid }] }`. Dispara orden `SOL_EST` tipo patología automática al firmar (ver eventos). **{*}**
- `conteo_final_instrumental_gasas` *(text / enum candidato)* — `CORRECTO | INCORRECTO | NO_APLICA`. Vinculado al `WHO_CHECK.sign_out.items[*]` — **debe coincidir** con la declaración del circulante. Si `INCORRECTO`, requiere `detalle_conteo_incorrecto` con acción tomada (RX intraoperatoria, re-exploración). **{*}**

### Estado del paciente al salir y destino

- `estado_paciente_al_salir` *(text)* — `ESTABLE | INESTABLE_HEMODINAMICAMENTE | INTUBADO_CONTROLADO | INTUBADO_INESTABLE | FALLECIDO_EN_SALA`. **{*}**
- `destino_postoperatorio` *(text — enum candidato)* — `URPA | UCI | UCI_NEONATAL | HOSPITALIZACION_PISO | EGRESO_DOMICILIO (CMA) | MORGUE`. Condiciona el documento siguiente que el motor solicita (`URPA` recovery vs traslado directo a UCI). **{*}**

### JSONB del paquete `ACTO_QX` (otros sub-documentos)

- `valoracion_preop` *(JSONB)* — `{ asa_clase, ayuno_horas, alergias_relevantes, ... }` — referencia al PREOP firmado.
- `checklist_cirugia_segura` *(JSONB)* — `{ sign_in, time_out, sign_out }` — referencia al `WHO_CHECK` (cuando se conserva snapshot legado además de la tabla satélite).
- `registro_anestesico` *(JSONB)* — serie temporal resumida — la fuente de verdad detallada vive en `ece.registro_anestesico`.
- `recuperacion_urpa` *(JSONB)* — serie temporal resumida URPA — fuente detallada en `ece.urpa_recovery`.

### Metadatos NTEC obligatorios (Arts. 55–56)

`registrado_en` (default `now()`); usuario que registra (heredado del cirujano principal); `estado_registro` ∈ `vigente | rectificado` (default `vigente`); bitácora `documento_instancia_historial` append-only por trigger `trg_historial_inmutable`; hash de payload + cadena `audit.audit_log` (SHA-256, retención 10 años).

### Firma electrónica simple (Art. 23 lit. a.4)

Firma del cirujano principal — única **constitutiva** del acta. Se registra al ejecutar la transición `firmar` (workflow ECE) con PIN argon2id contra `ece.firma_electronica`. El motor expone la firma como `documento_instancia_historial.firma_id` y la BD calcula el `payload_hash` SHA-256 de los campos clínicos relevantes (cirujano_id, hora_inicio, hora_fin, diagnostico_post, procedimiento_realizado, procedimiento_cie10_pcs_real, hallazgos, complicaciones_intraoperatorias, estado_paciente_al_salir, destino_postoperatorio, ayudantes, transfusiones, piezas, conteo_final).

---

## Estados (flujo_estado)

`ACTO_QX` es **inmutable** (`inmutable=true` en seed `tipo_documento`), por lo que el bloque de siembra `63_ece_08_seed.sql:142–148` **omite** el estado `en_revision`. Estados disponibles para `ACT_QX`:

```
borrador (inicial)
   │
   │ (captura intra-operatoria — JSONB editables; trigger condicional
   │  fn_bloquea_mutacion_acto_qx permite UPDATE solo en este estado)
   │
   ▼
firmado  ← (cirujano principal ejecuta 'firmar' con PIN argon2id;
            INMUTABLE post-firma — Art. 40 NTEC; trigger bloquea UPDATE/DELETE)
   │
   │ (ESP jefe de servicio ejecuta 'validar' — sin firma adicional obligatoria)
   ▼
validado (es_final = true)

# Ramas alternativas
borrador → anulado  (DIR ejecuta 'anular' — transición universal, firma obligatoria)
firmado  → rectificado  (vía ece.rectificacion + nuevo documento; NO transición directa)
```

Estados reales sembrados (bloque DO `63_ece_08_seed.sql:122–177`): `borrador`, `firmado`, `validado`, `anulado`. **No** existe `en_revision` (inmutable). **No** existe `rectificado` como estado del motor — la rectificación crea una **nueva instancia** y referencia la original vía `ece.rectificacion.instancia_origen_id`.

---

## Transiciones (flujo_transicion)

Sembradas en `63_ece_08_seed.sql:262–263` + bloque 5b universal:

| origen | destino | acción | rol_autoriza | requiere_firma | condición funcional |
|---|---|---|---|---|---|
| `borrador` | `firmado` | `firmar` | **ESP** (cirujano principal) | **SI** (PIN argon2id) | Pre-requisitos: (a) `CONS_INF` del episodio en estado `firmado`; (b) `WHO_CHECK` fase `sign_out` completada; (c) campos `{*}` no vacíos (validación de schema Zod + chequeo defensivo en router); (d) `hora_inicio` < `hora_fin`; (e) ASA y ayuno presentes en `valoracion_preop`. |
| `firmado` | `validado` | `validar` | **ESP** (jefe de servicio quirúrgico) | NO | Visto bueno administrativo / revisión de calidad. Auto-validación por el mismo cirujano principal es práctica común en centros sin jefatura formal de servicio — políticas institucionales lo decantan en seed o configuración. |
| `borrador` | `anulado` | `anular` | **DIR** | **SI** | Transición universal (bloque 5b — `63_ece_08_seed.sql:300–314`). Solo desde borrador. Causa documentada obligatoria. |
| `firmado` / `validado` | `firmado` / `validado` | — | — | — | **No mutables** (Art. 40 + trigger `fn_bloquea_mutacion_acto_qx`). Correcciones solo vía adendum / rectificación (Art. 42). |

Transiciones **bloqueadas explícitamente** (no sembradas y bloqueadas por trigger):

- `firmado → borrador` (no rollback post-firma).
- `firmado → anulado` directo (anulación post-firma debe documentarse como rectificación administrativa o, en casos graves de error médico, judicializarse).
- `validado → *` excepto vía adendum / rectificación.

---

## Eventos de dominio

Convención: `ece.<codigo_documento>.<accion>` o `act_qx.<accion>` (alias normativo). Payload mínimo: `organization_id`, `establishment_id`, `paciente_id`, `episodio_id`, `instancia_id`, `acto_quirurgico_id`, `actor_id`, `timestamp`. Emisión via `emitDomainEvent(tx, …)` dentro del callback transaccional Prisma (outbox `DomainEvent` — patrón establecido en `bridge-cirugia.router.ts`).

| Evento | Cuándo | Payload (campos clave) | Notas / consumidores |
|---|---|---|---|
| **`act_qx.iniciada`** | Tras `INSERT` en `ece.acto_quirurgico` (estado `borrador` — abierta al entrar a sala / iniciar incisión) | `{ acto_quirurgico_id, episodio_id, paciente_id, sala_qx_id, cirujano_id, anestesiologo_id, hora_inicio_real, procedimiento_cie10_programado }` | Dispara cronómetro intra-operatorio; alimenta tablero de quirófano y BI tiempo-real. |
| **`act_qx.transfusion_registrada`** | Al añadir entrada en `transfusiones_intraoperatorias` JSONB | `{ acto_quirurgico_id, componente, unidades, numero_unidad, transfusion_request_id?, hora_administracion }` | Consumidor: módulo Banco de Sangre (`Transfusion` HIS) — actualiza `BloodUnit.status`, `TransfusionRequest.status`. Si la transfusión es **no autorizada en `CONS_INF/CONS_QX.transfusionAutorizada`** → alerta de seguridad. |
| **`act_qx.complicacion_registrada`** | Al poblar / mutar `complicaciones_intraoperatorias` (solo en `borrador`) | `{ acto_quirurgico_id, descripcion, severidad?: 'leve'|'moderada'|'grave', categoria?: 'hemorragica'|'iatrogenica'|'anestesica'|'cardiovascular'|'otra' }` | Consumidor: módulo de calidad / eventos adversos — abre caso de revisión. |
| **`act_qx.conversion_via_abordaje`** | Cuando `via_abordaje` cambia entre apertura y firma (típico: laparoscopía → laparotomía) | `{ acto_quirurgico_id, via_inicial, via_final, motivo }` | Indicador de calidad quirúrgica. |
| **`act_qx.firmada`** ≡ `workflow.transitionExecuted` | Tras `firmar` (PIN argon2id del cirujano principal) | `{ instanceId, tipoDocumentoCodigo: 'ACTO_QX', fromStateId, toStateId: 'firmado', accion: 'firmar', byUserId (cirujano), firmaId, contenidoHash, acto_quirurgico_id }` | **Dispara cadena post-quirúrgica**: (1) habilita firma de `REG_ANEST` por anestesiólogo; (2) abre instancia `URPA` si `destino_postoperatorio='URPA'`; (3) actualiza `reserva_sala_qx.estado='completado'` y `SurgeryCase.status='COMPLETED'`; (4) emite cargo a cuenta hospitalaria; (5) alimenta codificación CIE-10 de egreso. |
| **`act_qx.pieza_a_patologia`** | Al firmar, por cada item en `piezas_anatomicas_enviadas_patologia.items[]` | `{ acto_quirurgico_id, descripcion_pieza, conservacion, sol_est_patologia_id }` | Crea/vincula orden `SOL_EST` tipo patología (`PathologyOrder` HIS) — patología pendiente bloquea cierre administrativo de la cuenta hasta tener `RES_EST` patología. |
| **`act_qx.conteo_incorrecto`** | Si `conteo_final_instrumental_gasas='INCORRECTO'` | `{ acto_quirurgico_id, detalle, accion_tomada }` | Evento crítico de seguridad. Alerta inmediata a jefe de servicio + comité de seguridad del paciente. |
| **`act_qx.validada`** ≡ `workflow.transitionExecuted` | Tras `validar` (ESP jefe de servicio) | `{ instanceId, accion: 'validar', toStateId: 'validado', byUserId }` | Cierra revisión de calidad. |
| **`act_qx.firma_atrasada`** | Cron Beta.15 detecta `borrador` con `hora_fin` < `now() - 24h` | `{ acto_quirurgico_id, cirujano_id, horas_de_atraso, episodio_id }` | TDR §13.6 — exige firma ≤ 24h. Alerta al cirujano + jefe de servicio + DIR. |
| **`act_qx.anulada`** | Tras `anular` (DIR) | `{ acto_quirurgico_id, motivo, autorizado_por_dir_id, timestamp }` | Solo desde `borrador`. |
| **`act_qx.rectificada`** | Crear nueva instancia con rectificación de una firmada (`ece.rectificacion`) | `{ instancia_nueva_id, instancia_origen_id, version_nueva, motivo, autor_id, timestamp }` | Art. 42 NTEC. Preserva la original firmada inmutable. |

Suscriptores típicos (no exhaustivo): tablero de quirófano (UI tiempo-real); Banco de Sangre (`act_qx.transfusion_registrada`); módulo URPA (`act_qx.firmada` con `destino='URPA'`); módulo Patología (`act_qx.pieza_a_patologia`); módulo Calidad / Eventos Adversos (`act_qx.complicacion_registrada`, `act_qx.conteo_incorrecto`); cuenta hospitalaria (`act_qx.firmada` → cargos); codificación CIE-10 (`act_qx.firmada` → procedimiento real para egreso).

---

## Drift conocido (audit) y riesgos

### 1. `ACT_QX` vs `ACTO_QX` — granularidad del tipo de documento

El seed `63_ece_08_seed.sql:72–73` registra un **único** tipo de documento `ACTO_QX` que el comentario llama *"Documentos del Acto Quirúrgico: checklist + nota operatoria + registro anestésico + URPA"*. En la práctica:

- La nota operatoria del cirujano (este `ACT_QX`) vive en `ece.acto_quirurgico` (una fila por acto).
- El registro anestésico vive en su propia tabla `ece.registro_anestesico` (PR satélite, SQL 69) con tipo `REG_ANEST`.
- El checklist OMS vive en `ece.who_checklist` (SQL 68) con tipo `WHO_CHECK`.
- La recuperación URPA vive en `ece.urpa_recovery` (SQL 70) con tipo `URPA`.

**Drift**: el motor de workflow ECE solo tiene un `tipo_documento` (`ACTO_QX`) para gobernar todo el paquete, pero la **persistencia se desagregó** en cuatro tablas con FKs hijas (`acto_quirurgico_id`). La firma del acta `ACT_QX` cubre solo la fila de `ece.acto_quirurgico`, mientras que la firma del anestesiólogo en `REG_ANEST` y de enfermería en `WHO_CHECK.sign_out` se gobiernan por separado. **PENDIENTE — validar con @AE/@PO/@AS** si conviene:
- (a) desagregar `ACT_QX`, `WHO_CHECK`, `REG_ANEST`, `URPA` como cuatro `tipo_documento` independientes con sus propias instancias de workflow (recomendado por simetría con `CONS_INF/CONS_QX`); o
- (b) mantener un solo `tipo_documento` `ACTO_QX` y modelar la firma por satélite con estados internos por tabla.

### 2. `SurgeryCase` legacy vs `ece.acto_quirurgico` ECE — doble módulo

`public.SurgeryCase` (Prisma `SurgeryCase`, `schema.prisma:2518–2570`) ya contiene un modelo TDR §13.2 del caso quirúrgico con `signInAt/By`, `timeOutAt/By`, `signOutAt/By`, `anesthesiaStartAt/EndAt`, `actualStart/End`, `procedureCode`, `preopNotes/intraopNotes/postopNotes` (texto libre). Este modelo cubre **parcialmente** lo que NTEC §3.13 exige, pero:

- No tiene la estructura JSONB del paquete (`valoracion_preop`, `checklist_cirugia_segura`, `registro_anestesico`, `recuperacion_urpa`).
- No tiene el campo de equipo en JSONB (`ayudantes`).
- No tiene los campos críticos médico-legales (transfusiones, piezas a patología, conteo final, complicaciones estructuradas).
- No tiene workflow ECE ni firma electrónica vinculada (solo `intraopNotes` / `postopNotes` como texto).

**Decisión arquitectónica obligatoria** (CLAUDE.md §"Adecuar legacy vs duplicar"): **extender** el módulo legacy (`apps/web/src/app/(clinical)/surgery/` o equivalente) para escribir el bloque NTEC en `ece.acto_quirurgico` cuando el episodio esté gobernado por ECE, vía bridge `eceBridgeCirugia` ya iniciado (programación) y ampliarlo con `firmarActaQuirurgica`. **No** crear ruta paralela `/ece/cirugia/acta-qx` independiente. La ruta `/ece/cirugia/acta-qx` es la **vista NTEC** sobre el mismo dominio. **PENDIENTE — validar con @AE** si existe ya el módulo HIS legacy de quirófano (probable: `apps/web/src/app/(clinical)/surgery/` o `(clinical)/quirofano/`) y diff funcional contra NTEC §3.13.

### 3. Trigger de inmutabilidad — patrón condicional aplicado

Patrón condicional `fn_bloquea_mutacion_acto_qx` (PR remediation HE-06, `99_acto_quirurgico_trigger_condicional.sql`) ya aplicado — bloquea `UPDATE`/`DELETE` solo cuando el workflow está en `firmado | validado | anulado`. En `borrador` permite la captura intra-operatoria iterativa que la realidad del quirófano exige (los campos JSONB de `registro_anestesico` se van llenando por la enfermera circulante / el residente cada 5 minutos durante toda la cirugía).

Riesgo residual: si la firma se retrasa (TDR §13.6 — 24h), la fila permanece mutable hasta firmar. La cadena de auditoría `audit.audit_log` detecta todo cambio en `borrador`, pero **no lo previene**. Recomendación @SRE: alerta Beta.15 a las 12h y 18h post-fin de cirugía para acelerar la firma.

### 4. Series temporales — JSONB vs tabla satélite

`ece.acto_quirurgico` conserva `registro_anestesico` y `recuperacion_urpa` como JSONB legacy (snapshot resumido) **pero** la fuente de verdad detallada vive en `ece.registro_anestesico` (SQL 69) y `ece.urpa_recovery` (SQL 70) como tablas dedicadas. Inconsistencia: el JSONB del acta puede quedar **desincronizado** con la tabla satélite si la captura ocurre por flujos distintos.

**PENDIENTE — validar con @DBA**: ¿se deprecia el JSONB `registro_anestesico` / `recuperacion_urpa` dentro de `acto_quirurgico` y se obliga a consultar la tabla satélite? Decisión afecta vistas BI y reportes operatorios.

### 5. Campos críticos no tipados como columnas

Sangrado estimado, transfusiones intraoperatorias, piezas a patología, conteo final, complicaciones estructuradas — están todos hoy **subsumidos en JSONB** (`valoracion_preop`, `checklist_cirugia_segura`, etc.) o disponibles solo como texto libre. **Riesgo** para BI clínica (no se puede agregar sin parsear JSONB) y para validación de schema (Zod opcional). **PENDIENTE — validar con @DBA/@AS** la desagregación a columnas físicas + índices para `complicaciones_intraoperatorias_severidad`, `conteo_final_instrumental_gasas`, `via_abordaje`.

### 6. `procedimiento_realizado` vs `procedimiento_cie10_pcs_real`

Hoy solo existe `procedimiento_realizado` como `text`. El código CIE-9-CM / CIE-10 PCS / CPT del procedimiento real **no** está expuesto como columna tipada. Sin código no hay cargo correcto a cuenta hospitalaria ni codificación de egreso automática. **PENDIENTE — validar con @DBA/@PO** estructura tipada (probable JSONB con `[ { codigo, sistema, descripcion, principal: bool } ]`).

### 7. Firma del ayudante / co-firma

El seed declara firma única `ESP` (cirujano principal). En la práctica institucional, hospitales universitarios y de alta complejidad **exigen** co-firma del primer ayudante (sobre todo cuando es residente o cirujano en formación). **PENDIENTE — validar con @AE/@PO**: ¿se modela la co-firma como segunda fila en `documento_instancia_historial` opcional o como dato dentro de `ayudantes` JSONB con `firma_id`?

### 8. Inexistencia del tipo `ACT_QX` separado en seed

El seed actual no expone `ACT_QX` como código distinto de `ACTO_QX`. Si la institución requiere reportes filtrados por "Acta Quirúrgica firmada" vs "Registro Anestésico firmado", la consulta debe filtrar por **tabla** (`ece.acto_quirurgico` vs `ece.registro_anestesico`), no por `tipo_documento.codigo`. **PENDIENTE — validar con @PO/@BIA** si los KPIs operacionales requieren separación a nivel de catálogo.

---

## Descripción markdown rica

El **Acta Quirúrgica / Nota Operatoria (ACT_QX)** es el **documento clínico-legal central** del acto quirúrgico bajo la **NTEC §3.13** (Acuerdo n.° 1616 MINSAL, El Salvador) y los lineamientos operativos del **TDR §13** (Salas de Operaciones). Es **obligatoria siempre** en toda cirugía iniciada — mayor, menor con anestesia distinta de local pura, urgente, electiva, cirugía mayor ambulatoria, procedimientos quirúrgicos diagnósticos y cesárea — y constituye el registro en el que el **cirujano principal** describe **qué se hizo, cómo se hizo, qué se encontró y cómo terminó** el paciente. Encadena documentalmente la valoración preoperatoria (`PREOP`), el consentimiento informado quirúrgico (`CONS_INF` / `CONS_QX`) y la lista de cirugía segura OMS (`WHO_CHECK`) con el bloque postoperatorio inmediato (`REG_ANEST` cierre + `URPA` + alta a piso/UCI o domicilio CMA).

La firma del acta es **única, personal e indelegable** del cirujano principal — rol ECE `ESP`, rol HIS `PHYSICIAN` — y se ejecuta con **PIN electrónico argon2id** validado contra `ece.firma_electronica` (lockout 5 intentos). El **plazo límite TDR §13.6 es 24h** post-fin de cirugía; el sistema emite alerta Beta.15 a las 12h y 18h, y consigna `act_qx.firma_atrasada` cuando se excede. La co-firma del primer ayudante existe como dato declarado en el JSONB `ayudantes` cuando la institución lo exige (pendiente decisión arquitectónica — drift §7). El anestesiólogo, instrumentista y circulante aparecen como datos en el acta, pero **firman sus propios documentos satélite** (`REG_ANEST` y `WHO_CHECK.sign_out` respectivamente).

**Post-firma, el acta es estrictamente inmutable por aplicación del Art. 40 NTEC**. El trigger condicional `ece.fn_bloquea_mutacion_acto_qx` (`packages/database/sql/99_acto_quirurgico_trigger_condicional.sql`) bloquea `UPDATE`/`DELETE` cuando el estado del workflow es `firmado`, `validado` o `anulado`, permitiendo escritura libre solo durante `borrador` — patrón clínicamente necesario porque la captura intra-operatoria es iterativa (la enfermera circulante registra signos cada 5 minutos, el cirujano dicta hallazgos durante todo el acto, las transfusiones se van añadiendo en tiempo real). Las correcciones post-firma admisibles son únicamente: (a) **adendum** — nota operatoria correctora vinculada al original que aclara, amplía o corrige; (b) **rectificación trazable** (Art. 42 NTEC) via `ece.rectificacion` registrando usuario, timestamp y detalle del cambio, sin sobrescribir el contenido original. La cadena `audit.audit_log` SHA-256 (retención 10 años) garantiza la inmutabilidad criptográfica.

**Campos críticos médico-legales obligatorios** (cuya ausencia bloquea la firma): tiempos quirúrgicos reales (`hora_inicio` < `hora_fin`); diagnósticos **pre y post** (el post puede legítimamente diferir del pre — hallazgo clínico, no error); procedimiento **realmente realizado** con su código CIE-9-CM Volumen 3 / CIE-10 PCS / CPT (puede diferir del programado — el cargo se hace sobre el realizado); vía de abordaje y conversiones; hallazgos intraoperatorios narrativos; complicaciones (declaración explícita "sin complicaciones" si vacío, para descargo legal); sangrado estimado; equipo real declarado; **transfusiones intraoperatorias** vinculadas al Banco de Sangre HIS (`TransfusionRequest`/`Transfusion`); **piezas anatómicas enviadas a patología** que disparan orden `SOL_EST` tipo patología automática al firmar; **conteo final de instrumental y gasas** — `CORRECTO | INCORRECTO | NO_APLICA`, debe coincidir con `WHO_CHECK.sign_out`; estado del paciente al salir y destino postoperatorio (`URPA | UCI | HOSPITALIZACION_PISO | EGRESO_DOMICILIO | MORGUE`). La firma del acta **dispara la cadena post-quirúrgica completa**: habilita firma de `REG_ANEST`, abre instancia `URPA` cuando aplica, cierra `reserva_sala_qx`, transita `SurgeryCase.status` a `COMPLETED`, emite cargo a cuenta hospitalaria y alimenta la codificación CIE-10 de egreso.

**Adecuar, no duplicar**: existe ya en HIS legacy el modelo `public.SurgeryCase` (TDR §13.2) con tiempos OMS sign-in/time-out/sign-out, anesthesiaType, y notas `preopNotes/intraopNotes/postopNotes` como texto libre. **Decisión arquitectónica obligatoria** (CLAUDE.md §"Adecuar legacy vs duplicar"): **extender** el módulo legacy de quirófano para escribir el bloque NTEC estructurado en `ece.acto_quirurgico` vía bridge `eceBridgeCirugia` cuando el episodio esté gobernado por ECE, manteniendo una sola entrada de sidebar; **no** crear ruta paralela `/ece/cirugia/acta-qx` independiente. La ruta `/ece/cirugia/acta-qx` es la **vista NTEC** sobre el mismo dominio, y consume la misma fila con su JSONB tipado y firma electrónica. La codificación CIE-9-CM/CIE-10 PCS/CPT del procedimiento real y la desagregación de campos hoy subsumidos en JSONB (transfusiones, piezas, conteo, vía de abordaje, complicaciones estructuradas) son los puntos de mayor riesgo BI/legal y están listados como **drift §2, §5 y §6** para validación con @AE/@DBA/@PO/@BIA.
