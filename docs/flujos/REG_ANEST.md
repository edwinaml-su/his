# REG_ANEST — Registro Anestésico

## Metadata

- **codigo**: `REG_ANEST`
- **nombre**: Registro Anestésico Intraoperatorio (hoja de anestesia / transanestésico)
- **modalidad**: `QUIRURGICO`
- **NTEC artículo**: §3.13 (Documentos del Acto Quirúrgico — Registro Anestésico inmutable post-firma) + §7.3 (sub-flujo "Acto quirúrgico" — registro anestésico obligatorio) + Art. 39 (firma electrónica simple del anestesiólogo) + Art. 19 (rectificación, no edición destructiva) + Art. 34 (conservación 5 años) + Art. 55-56 (metadatos obligatorios). Referencias TDR §13.4 (Intra-operatorio: hoja de anestesia electrónica con registro automático desde monitor + manual de medicamentos y eventos).
- **modulo_his_target**:
  - Cabecera operativa quirúrgica: `/ece/cirugia/registro-anestesico` (vista anestésica vinculada al acto quirúrgico).
  - Programación del acto: `/ece/cirugia/programacion` (bridge `eceBridgeCirugia.programarCirugia` siembra `reserva_sala_qx.anestesiologo_id`).
  - Sub-router de registro inline durante el intra: `eceRegistroAnestesico.create` / `registrarSignoVital` / `firmar` (router `packages/trpc/src/routers/ece/registro-anestesico.router.ts`).
  - URPA (consume el documento al cierre anestésico): `/ece/cirugia/urpa`.
- **tabla_datos**:
  - **ECE NTEC formal**: `ece.registro_anestesico` (SQL `69_registro_anestesico.sql`) + `ece.documento_instancia` (cabecera workflow, `tipo_documento = REG_ANEST`).
  - **Modelo Prisma**: `EceRegistroAnestesico` en `packages/database/prisma/schema.prisma` (mapeado `@@map("registro_anestesico")` `@@schema("ece")`).
  - **Cadena de FK (RLS Cat-E)**: `ece.registro_anestesico.acto_quirurgico_id → ece.acto_quirurgico.episodio_id → ece.episodio_atencion.establecimiento_id`. Política `reg_anest_by_acto_estab` (idem `69_registro_anestesico.sql:134-143`).
  - **HIS legacy de monitoreo continuo**: no existe equivalente (se persiste como JSONB en `ece.registro_anestesico.signos_vitales_intraop`). Las tomas hand-rolled de `/ece/signos-vitales` cubren el resto del episodio, **no** el período intraoperatorio.
  - **Bridge HIS ↔ ECE**: el bridge `eceBridgeCirugia` espeja la programación (orden_ingreso + episodio + preop_checklist + reserva), pero la hoja de anestesia es **propia del ECE**: no hay tabla `Surgery.registroAnestesico` en HIS — el JSON `Surgery.registroAnestesico` del legacy es un placeholder no-canónico que **no debe usarse para escritura clínica**.
- **inmutable**: `true` post-firma del anestesiólogo. Pre-firma: `borrador` admite `update` + `registrarSignoVital` (append-only). Post-firma (`estado_registro = 'firmado'`) cualquier corrección clínica requiere **rectificación NTEC Art. 19** (nuevo documento referencial). `anular` sólo admisible si `estado_registro = 'borrador'` y la cirugía aún no concluyó.
- **tipo_registro**: **OBLIGATORIO** **SIEMPRE** en cirugía con anestesia (general, regional, sedación profunda, MAC). Excluido únicamente cuando no hay administración anestésica (procedimientos sin anestesia tópica/local mínima son raros y se documentan en la nota operatoria del cirujano).

## Propósito normativo

§3.13 NTEC + §7.3 + TDR §13.4: el **Registro Anestésico** (también llamado "hoja de anestesia" o "transanestésico") es el documento clínico-legal del **anestesiólogo responsable** que sustenta la **conducción anestésica continua** desde la inducción hasta la entrega del paciente a recuperación. Es la **única pieza documental** que prueba:

1. **Qué anestesia se administró y por qué** (clasificación ASA, tipo y técnica, manejo de la vía aérea).
2. **Qué fármacos se aplicaron** (premedicación, inducción, mantenimiento, rescate, antagonistas, antibióticos, hemoderivados — con nombre, dosis, vía y hora).
3. **Cómo evolucionó el paciente durante el acto** (serie temporal de signos vitales — PA, FC, FR, SpO2, etCO2 — registrada cada ~5 min como mínimo: estándar internacional ASA y exigencia TDR §13.4 "registro automático desde monitor").
4. **Qué complicaciones anestésicas ocurrieron** (alergia, broncoespasmo, despertar intraoperatorio, hipotensión refractaria, arritmias, fallas de vía aérea, eventos centinela).
5. **Balance hídrico intraoperatorio** (fluidoterapia administrada + pérdidas sanguíneas estimadas + diuresis).
6. **Cierre anestésico** (extubación, criterios de salida del quirófano, destino URPA / UCI / UCIN, estado de entrega).
7. **Quién firma** la conducción anestésica bajo responsabilidad médico-legal (anestesiólogo adscrito, rol `ESP`).

Es **dependencia bloqueante** para:

- **Apertura del documento URPA** (`ece.urpa_*`): el ingreso a recuperación no se cierra sin un REG_ANEST firmado que describa el estado anestésico de entrega.
- **Auditoría administrativa ISSS**: justificación del tiempo de anestesiólogo, uso de hemoderivados intraoperatorios, complicaciones que escalen costo.
- **Defensa médico-legal**: el `chain_hash` del payload firmado + `audit.audit_log` (TDR §6.3) cubren impugnaciones de mala práctica anestésica.
- **Indicadores institucionales** (TDR §16): tasa de complicaciones anestésicas, tiempo de inducción, tiempo de despertar, eventos centinela anestésicos.

A diferencia de la **Nota Operatoria** (firma del cirujano, describe el acto quirúrgico), el **REG_ANEST** es un documento **paralelo y autónomo** del anestesiólogo: el cirujano no lo firma, no lo modifica, y su contenido no se duplica en la descripción operatoria. Ambos confluyen en el expediente del episodio quirúrgico.

## Dependencias

| Documento / Recurso | Tipo | Estado requerido | Origen |
|---|---|---|---|
| **PREOP / Valoración Anestésica** | Hard (informativo, no bloquea el INSERT en BD pero el flujo clínico lo exige) | `firmado` con clasificación **ASA** y **plan anestésico** definido | NTEC §3.13 + TDR §13.3 (preoperatorio). El campo `asa` de `ece.registro_anestesico` debe coincidir con el ASA preoperatorio firmado; cualquier discrepancia exige nota explicativa en `complicaciones`. |
| **CONS_QX (consentimiento quirúrgico/anestésico)** | Hard (bloqueante a nivel flujo) | `firmado` por paciente + cirujano + anestesiólogo | NTEC §3.13 indica firma del anestesiólogo en el consentimiento; sin él no se debe iniciar inducción. La validación es del módulo `/ece/consentimiento`. |
| **WHO_CHECK / Lista de Verificación de Cirugía Segura (sign-in)** | Hard (bloqueante operacional) | `sign_in` completado | NTEC §3.13 + TDR §13.3. La inducción anestésica no inicia sin sign-in OMS (verificación de identidad, sitio, alergias, vía aérea prevista, riesgo de sangrado). |
| **`ece.acto_quirurgico`** (FK directa) | Hard | Existir (estado `programado` o superior) | `ece.registro_anestesico.acto_quirurgico_id` es `NOT NULL REFERENCES ece.acto_quirurgico(id) ON DELETE RESTRICT`. Constraint parcial `uq_registro_anestesico_acto_activo` garantiza **un único registro activo por acto** (no-anulados). |
| **`ece.reserva_sala_qx.anestesiologo_id`** | Hard (operacional) | Asignado en `programarCirugia` | El bridge `eceBridgeCirugia.programarCirugia` setea `reserva_sala_qx.anestesiologo_id`; ese personal_salud debe coincidir con `ece.personal_salud.activo = true` y rol `ESP` al momento de firmar (verificado por `requireRole(["ESP"])`). |
| **Personal de salud activo (`ece.personal_salud`)** | Hard | `activo = true` con relación `his_user_id` | El router resuelve `findPersonalId(ctx.prisma, ctx.user.id)`; sin perfil `PRECONDITION_FAILED`. |

## Obligatoriedad

**SIEMPRE** que se administre anestesia **general**, **regional** (raquídea, epidural, bloqueo de nervio periférico) o **sedación profunda / MAC** (Monitorized Anesthesia Care).

| Tipo de anestesia | Documento REG_ANEST | Notas |
|---|---|---|
| `general` | **OBLIGATORIO**. Capnografía (`etco2`) **OBLIGATORIA** en la serie de signos vitales. | Toda intubación / LMA registra `via_aerea` correspondiente. |
| `regional` (raquídea / epidural / bloqueos) | **OBLIGATORIO**. Capnografía recomendada en sedación complementaria. | `via_aerea = 'mascarilla'` cuando no hay manejo invasivo. |
| `sedacion` (profunda / MAC) | **OBLIGATORIO** si la sedación profunda compromete respuesta ventilatoria espontánea. | Si la sedación es **consciente** y dura < 15 min se permite registro abreviado por nota operatoria, sin REG_ANEST formal (excepción de bajo riesgo). |
| `local` (infiltración pura sin sedación) | **NO obligatorio**. | Se documenta en la nota operatoria del cirujano. |

**Excepciones operativas** (no eximen del documento, sólo modifican el flujo):

- **Cirugía de emergencia** (Código Rojo / Trauma / Cesárea de urgencia / Aneurisma roto): la inducción precede al registro completo; el REG_ANEST se levanta con **registro retroactivo controlado** respetando hora real de inducción y eventos, sujeto a auditoría reforzada.
- **Activación masiva (incidente de víctimas múltiples)**: cada paciente con anestesia genera su REG_ANEST individual; el documento se completa al estabilizar.
- **Conversión de técnica** (regional → general por falla de bloqueo): se registra como evento clínico en `complicaciones` + cambio de `tipo_anestesia` antes de firmar.

## Roles firmantes

| Rol (código RBAC) | Acción | Momento | Mecanismo |
|---|---|---|---|
| **ANESTESIOLOGO** (`ESP`) | **Registra continuamente** + **firma única** | Desde inducción hasta extubación / salida de quirófano | `requireRole(["ESP"])`. PIN argon2id sobre `ece.firma_electronica`. Verificación contra `personal_salud.his_user_id = ctx.user.id` y `activo = true`. **La firma es individual e intransferible**: no admite "firma por residente" sin adscrito. |
| **RESIDENTE_ANESTESIA** (`ESP` no-acreditado / `PHYSICIAN` con rol futuro `RES_ANEST`) | Acompañamiento supervisado: puede operar el monitor, llamar a `registrarSignoVital`, redactar borrador | Continuo durante el acto | Lectura: `requireRole(["PHYSICIAN", "ESP", "NURSE"])`. **No puede firmar el documento**: la firma siempre la ejecuta el adscrito. Modelo PIN-only individual (no se admite firma delegada). |
| **ENFERMERIA DE QUIRÓFANO** (`NURSE`) | Lectura del documento + apoyo a registro de medicación anestésica administrada (puede aparecer cruzada con `MedicationAdministration` del HIS legacy) | Continuo durante el acto | `clinicalRole = requireRole(["PHYSICIAN", "ESP", "NURSE"])`. No firma. |
| **CIRUJANO** (`PHYSICIAN`) | **NO firma** el REG_ANEST | — | El cirujano firma la descripción operatoria; el REG_ANEST es del anestesiólogo. Documentos paralelos en el mismo episodio. |
| **DIR / ADMIN** | Anulación pre-firma (excepcional, error técnico al iniciar) | Sólo si `estado_registro = 'borrador'` | Roadmap: `eceRegistroAnestesico.anular(motivo)` — implementación pendiente; hoy se gestiona vía soporte/operación con marca manual. **Post-firma no se anula**: se rectifica vía Art. 19. |

> **Modelo de firma**: PIN argon2id en `ece.firma_electronica` con lockout a 5 intentos fallidos (alineado con resto del ECE — patrón establecido en HF-29 cerrado por `atencion_emergencia`). En el router actual la firma es **directa** (`estado_registro = 'firmado'` + `firmado_por` + `firmado_en` + `now()`) **sin verificación de PIN inline en este router específico** — el contrato de seguridad lo provee `withWorkflowContext` + el rol `ESP`. Si se detecta gap (similar a HF-29 de ATN_EMERG), abrir HF-XX para alinear con `verifyPin`.

## Campos obligatorios NTEC

Estructura conforme `ece.registro_anestesico` (SQL `69_registro_anestesico.sql`) + Zod `eceRegistroAnestesicoCreateSchema`:

| Campo | Tipo BD | Validación Zod | Obligatoriedad | Nota |
|---|---|---|---|---|
| `acto_quirurgico_id` | `UUID NOT NULL` | `z.string().uuid()` | (\*) | FK a `ece.acto_quirurgico`. Constraint parcial: máx 1 activo. |
| `instancia_id` | `UUID` (FK opcional) | — | Recomendado | Vincula con `ece.documento_instancia` del motor de workflow. |
| `asa` | `SMALLINT NOT NULL CHECK 1..5` | `z.number().int().min(1).max(5)` | (\*) | Clasificación ASA del paciente. Debe coincidir con el ASA del PREOP firmado o justificarse en `complicaciones`. |
| `tipo_anestesia` | `TEXT NOT NULL CHECK IN ('general'\|'regional'\|'local'\|'sedacion')` | `tipoAnestesiaEnum` | (\*) | TDR §13.4: `general, regional (raquídea, epidural, bloqueos), local con sedación, MAC`. **MAC** se mapea a `sedacion`. |
| `via_aerea` | `TEXT NOT NULL CHECK IN ('intubacion'\|'mascarilla'\|'lma')` | `viaAereaEnum` | (\*) | Manejo de vía aérea. Si se cambia durante el acto (mascarilla → intubación de rescate), se documenta en `complicaciones`. |
| `medicamentos_administrados` | `JSONB NOT NULL DEFAULT '[]'` | `z.array(medicamentoAdministradoSchema)` con `{ nombre, dosis, via, hora_administracion }` | (\*) requerido al menos premedicación / inducción | Lista append-only. Cubre premedicación, inducción, mantenimiento, rescate, hemoderivados, antagonistas. |
| `signos_vitales_intraop` | `JSONB NOT NULL DEFAULT '[]'` | `z.array(signoVitalIntraopSchema)` con `{ ts, ta_sistolica, ta_diastolica, fc, fr, spo2, etco2 }` | (\*) **≥ 1 por cada 5 min** del acto | Serie temporal continua. Estándar ASA y TDR §13.4 "registro automático desde monitor". `etco2` **obligatorio** en anestesia general. `mutation registrarSignoVital` aplica append JSONB (`signos_vitales_intraop \|\| ${signoJson}::jsonb`). |
| `complicaciones` | `TEXT` | `z.string().trim().max(4000).optional()` | Si ocurrieron | Texto libre. Eventos centinela (despertar intraoperatorio, anafilaxia, parada cardíaca) **deben** quedar acá + emitir alerta de calidad. |
| `fluidoterapia_ml` | `INTEGER CHECK >= 0` | `z.number().int().min(0).optional()` | Recomendado | Cristaloides + coloides administrados. |
| `perdidas_sanguineas_ml` | `INTEGER CHECK >= 0` | `z.number().int().min(0).optional()` | Recomendado | Pérdida estimada (EBL). Cruza con hemoderivados administrados (que viven en `medicamentos_administrados` o en `Transfusion` del HIS). |
| `registrado_por` | `UUID NOT NULL` | resuelto vía `findPersonalId(ctx.user.id)` | (\*) | FK a `ece.personal_salud`. Es el anestesiólogo responsable. |
| `estado_registro` | `TEXT NOT NULL DEFAULT 'borrador' CHECK IN ('borrador'\|'firmado'\|'anulado')` | `estadoRegistroAnestEnum` | (\*) | Estado del documento. |
| `firmado_por` | `UUID` | — | (\*) al firmar | Setea en `firmar` con `personal_salud.id`. |
| `firmado_en` | `TIMESTAMPTZ` | — | (\*) al firmar | `now()` en `firmar`. |
| `registrado_en` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | — | (\*) | Apertura del registro (inducción típicamente). |

**Campos derivables por JOIN — no duplicados en la tabla** (regla "adecuar, no duplicar"):

- **Identidad del paciente**: vía `acto_quirurgico_id → ece.acto_quirurgico → episodio_id → ece.episodio_atencion → paciente_id`. No se redundas en `registro_anestesico`.
- **Sala QX / hora_programada / cirujano / anestesiólogo programado**: vía `acto_quirurgico_id → reserva_sala_qx`. La hora real de inicio/fin del acto vive en `ece.acto_quirurgico.hora_inicio` / `hora_fin`.
- **Hora de extubación / hora de salida de quirófano**: corresponde a `ece.acto_quirurgico.hora_fin` (cierre del acto) y al **ingreso a URPA** (`ece.urpa_*.fecha_hora_ingreso`). El REG_ANEST no duplica ese campo; el cierre anestésico se infiere por **JOIN con URPA**.
- **Destino post-anestésico** (`URPA | UCI | UCIN`): vive en `ece.urpa_*` o en el siguiente `episodio_*` (transferencia interna). No se duplica.

## Estados (flujo_estado)

```
borrador → firmado
   ↓
anulado (sólo si NO firmado; reservado a operación con motivo)
```

| codigo | descripción |
|---|---|
| `borrador` | Documento abierto; admite `update` + `registrarSignoVital` (append signos vitales JSONB). Visible para el equipo quirúrgico. |
| `firmado` | Anestesiólogo ejecutó `firmar`. **Inmutable**. Libera URPA para cierre administrativo. Emite outbox `ece.anestesia.firmada`. |
| `anulado` | Borrador anulado por error técnico de apertura. **No aplica post-firma** — post-firma se rectifica vía Art. 19. |

> A diferencia de otros documentos NTEC (ATN_EMERG, HOJA_ING), el REG_ANEST **no incluye estado `en_revision` ni `validado` administrativo** en el modelo actual: el documento se firma y queda inmutable. El roadmap puede añadir `validado` (auditoría administrativa) si el establecimiento lo configura.

## Transiciones

| origen | destino | rol | acción tRPC | condición |
|---|---|---|---|---|
| (nada) | `borrador` | `ESP` | `eceRegistroAnestesico.create` | Personal_salud activo + `acto_quirurgico_id` válido + `countActivos == 0` (CONFLICT si ya existe). |
| `borrador` | `borrador` | `ESP` | `eceRegistroAnestesico.registrarSignoVital` | Append JSONB. **Rechaza** si `estado = 'firmado'` (CONFLICT) o `'anulado'` (CONFLICT). |
| `borrador` | `firmado` | `ESP` | `eceRegistroAnestesico.firmar` | `estado_registro = 'borrador'` (CONFLICT si firmado/anulado). Setea `firmado_por`, `firmado_en = now()`. Emite outbox. |
| `borrador` | `anulado` | operación / `ADMIN` (roadmap) | (no implementado en router actual) | Sólo motivos administrativos. Post-firma **no aplica**. |
| `firmado` | (no se permite UPDATE) | — | rectificación Art. 19 | Nuevo REG_ANEST referencial; el original permanece como histórico. |

## Eventos (outbox `ece.*`)

| evento | momento | payload | consumidores |
|---|---|---|---|
| `ece.anestesia.firmada` | Post-`firmar` exitoso | `{ registroId, actoQuirurgicoId, firmadoPor }` + `organizationId` (vía `emitDomainEvent`) | URPA (habilita ingreso a recuperación), facturación ISSS (computa tiempo anestésico), BI (alimenta KPIs §16 TDR), motor workflow (avanza `documento_instancia.estado`). |
| `ece.anestesia.creada` | (no emitido en router actual — gap menor) | — | Roadmap: emitir en `create` para inicializar workflow del documento. |
| `ece.anestesia.complicacion_registrada` | (no emitido — gap a documentar) | — | Roadmap: emitir cuando `complicaciones` se modifica en `update` para disparar alerta de calidad (eventos centinela anestésicos). |
| `ece.anestesia.anulada` | (no emitido) | — | Roadmap junto con la mutation de anulación. |

Todos los eventos viajan por outbox de dominio (`emitDomainEvent`) y quedan inmutables en `audit.audit_log` con hash chain (TDR §6.3).

## Drift conocido

- **HF-DRIFT-REG-ANEST-01 (P2)**: el campo `registroAnestesico` JSON en el modelo Prisma `Surgery` del HIS legacy (referenciado en `packages/database/prisma/schema.prisma:5263`) es un **placeholder no-canónico** que coexiste con la tabla canónica `ece.registro_anestesico`. Recomendación: deprecar `Surgery.registroAnestesico` y enrutar lecturas a `ece.registro_anestesico` vía bridge de sólo-lectura. Mientras tanto, **no escribir** en `Surgery.registroAnestesico` desde código clínico.
- **HF-REG-ANEST-02 (P1)**: el `firmar` actual no verifica PIN argon2id (`verifyPin`) como sí lo hace `atencion_emergencia.firmar` (post-HF-29 cerrado). Hoy la defensa es el `requireRole(["ESP"])` + sesión Supabase, **sin segundo factor de PIN**. Alinear con el patrón ATN_EMERG (PIN argon2id + lockout 5 intentos). Bloqueante para auditoría médico-legal estricta.
- **HF-REG-ANEST-03 (P2)**: no se emite evento `ece.anestesia.creada` al `create`, lo que impide al motor de workflow tracking del documento desde apertura. Mitigación: el `firmar` emite `ece.anestesia.firmada` — suficiente para cierre, insuficiente para tracking continuo.
- **HF-REG-ANEST-04 (P2)**: no existe mutation `anular` ni evento asociado. Para errores técnicos pre-firma se requiere intervención de operación.
- **HF-REG-ANEST-05 (P3)**: validación de **capnografía obligatoria en anestesia general** es responsabilidad del **front** (`/ece/cirugia/registro-anestesico`). La BD no impone que `etco2` esté presente en al menos un signo vital cuando `tipo_anestesia = 'general'`. Recomendación: añadir CHECK o trigger en `firmar` (defensa en profundidad).
- **HF-REG-ANEST-06 (P2)**: el documento depende lógicamente de PREOP firmado con ASA, pero la BD **no enforza** equivalencia `registro_anestesico.asa == preop.asa`. Mismo motivo: regla de front + auditoría ISSS posterior.
- **Constraint parcial `uq_registro_anestesico_acto_activo`**: garantiza un único REG_ANEST no-anulado por acto. **Funciona correctamente** — un segundo `create` para el mismo `acto_quirurgico_id` retorna CONFLICT por `countActivos > 0` (verificado en router); el constraint BD actúa como defensa en profundidad.
- **Drift de `seed-demo-quirurgico.mjs`**: el seeder de demo puebla `signos_vitales_intraop` con una serie sintética cada 5 min. Validar que la serie respete `signoVitalIntraopSchema` para evitar drift entre fixtures y producción.

## Descripción markdown rica

### Flujo operativo end-to-end

```
                            ┌────────────────────────────────────┐
                            │ Programación quirúrgica            │
                            │ eceBridgeCirugia.programarCirugia  │
                            │ → reserva_sala_qx.anestesiologo_id │
                            └─────────────────┬──────────────────┘
                                              │
                            ┌─────────────────▼──────────────────┐
                            │ PREOP / Valoración Anestésica      │
                            │ (ASA, plan anestésico) — firmado   │
                            └─────────────────┬──────────────────┘
                                              │
                            ┌─────────────────▼──────────────────┐
                            │ CONS_QX (incluye consent anestesia)│
                            │ firmado paciente + cirujano + ESP  │
                            └─────────────────┬──────────────────┘
                                              │
                            ┌─────────────────▼──────────────────┐
                            │ WHO_CHECK sign-in (OMS)            │
                            │ — habilita inducción anestésica    │
                            └─────────────────┬──────────────────┘
                                              │
                            ┌─────────────────▼──────────────────┐
                            │ Inducción anestésica               │
                            │ eceRegistroAnestesico.create       │
                            │ → estado 'borrador'                │
                            │ (ASA, tipo, via_aerea,             │
                            │  medicamentos[premedicación])      │
                            └─────────────────┬──────────────────┘
                                              │
                ┌─────────────────────────────┼─────────────────────────────┐
                │                             │                             │
   registrarSignoVital              registrarSignoVital              registrarSignoVital
   ts0, PA, FC, SpO2, etCO2          ts5, PA, FC, SpO2, etCO2          ts10, ...
   (append JSONB)                    (append JSONB)                    cada ~5 min
                │                             │                             │
                └─────────────────────────────┼─────────────────────────────┘
                                              │
                            ┌─────────────────▼──────────────────┐
                            │ Eventos críticos durante el acto:  │
                            │ - medicamentos rescate             │
                            │ - complicaciones (despertar,       │
                            │   broncoespasmo, anafilaxia, etc.) │
                            │ - cambio de técnica                │
                            │   → update 'borrador'              │
                            └─────────────────┬──────────────────┘
                                              │
                            ┌─────────────────▼──────────────────┐
                            │ Extubación / salida de quirófano   │
                            │ (cierre de acto_quirurgico)        │
                            └─────────────────┬──────────────────┘
                                              │
                            ┌─────────────────▼──────────────────┐
                            │ eceRegistroAnestesico.firmar       │
                            │ → estado 'firmado' (INMUTABLE)     │
                            │ → outbox ece.anestesia.firmada     │
                            └─────────────────┬──────────────────┘
                                              │
                            ┌─────────────────▼──────────────────┐
                            │ Ingreso a URPA / UCI / UCIN        │
                            │ (consume REG_ANEST firmado)        │
                            │ Indicadores BI §16                 │
                            └────────────────────────────────────┘
```

### Énfasis clave

- **Registro CONTINUO durante toda la cirugía** — el documento **no es un snapshot único**: es una **serie temporal viva**. La mutation `registrarSignoVital` es el corazón del documento: el front llama una vez cada ~5 min (o más frecuente en eventos críticos) y se hace append JSONB en `signos_vitales_intraop`. Pre-firma se admiten múltiples llamadas; post-firma cualquier punto adicional **es rechazado con CONFLICT**. El estándar ASA y TDR §13.4 exigen tomas cada 5 min como mínimo en anestesia general; en regional puede aliviarse a cada 10 min si el paciente está consciente y comunicativo.

- **Capnografía (`etco2`) OBLIGATORIA en anestesia general** — la presencia de `etco2` en al menos un punto de la serie es **obligación clínica universal** desde estándares ASA 2010+. La BD no la enforza hoy (HF-REG-ANEST-05) pero el front del módulo `/ece/cirugia/registro-anestesico` debe bloquear la firma si `tipo_anestesia = 'general'` y ningún `signoVitalIntraop` tiene `etco2 != null`. En anestesia regional sin sedación profunda no es obligatoria; en sedación profunda / MAC es altamente recomendable (capnografía nasal).

- **Complicaciones anestésicas son evento centinela** — todo lo registrado en `complicaciones` (despertar intraoperatorio, anafilaxia, parada cardíaca, fallo de vía aérea, hipertermia maligna, aspiración) **debe** disparar un flujo de calidad asistencial paralelo: notificación al comité de calidad, revisión obligatoria, eventualmente RCA (Root Cause Analysis). Hoy se documenta solamente en el campo `complicaciones` (texto libre 4000 chars); roadmap: emitir `ece.anestesia.complicacion_registrada` para alimentar el módulo de calidad/incidentes (HF-REG-ANEST-03).

- **Hora de extubación marca fin de cuidado anestésico activo** — el documento no tiene un campo explícito `hora_extubacion`; ese hito vive en `ece.acto_quirurgico.hora_fin` y la entrega a URPA queda evidenciada por el ingreso al documento `URPA` siguiente. La regla de oro: **el REG_ANEST se firma cuando el anestesiólogo entrega físicamente al paciente en recuperación** — no antes (porque puede haber complicaciones en el transporte) ni mucho después (porque la memoria de eventos se degrada y la firma debe ser próxima al acto, exigencia médico-legal).

- **Entrega a URPA con firma de recepción** — la firma de recepción en URPA es del **personal de enfermería de URPA** (rol `NURSE`) sobre el documento `URPA`, no sobre el REG_ANEST. El REG_ANEST queda firmado por el anestesiólogo, **no requiere contra-firma** del enfermero de URPA. El traspaso de responsabilidad es lateral: anestesiólogo entrega + enfermería URPA recibe en su propio documento. Esta separación es deliberada y respeta NTEC §3.13 (registro anestésico) vs §3.13 (Hoja de Recuperación URPA): dos documentos, dos firmas, dos responsabilidades.

- **Inmutabilidad y rectificación NTEC Art. 19** — una vez firmado, el REG_ANEST no admite UPDATE/DELETE. Para corregir un error material (p. ej. dosis mal transcrita, signo vital fuera de rango imposible) se crea un **nuevo REG_ANEST referencial** que apunta al original y declara la corrección. El original permanece como evidencia histórica; ambos viajan juntos en el expediente. El `chain_hash` del original queda como referencia inalterable y `audit.audit_log` detecta cualquier intento de UPDATE directo a BD.

- **Custodia 5 años / 10 años** — Art. 34 NTEC. El expediente que contiene el REG_ANEST se conserva 5 años en cirugía electiva sin complicaciones; **10 años** si la cirugía estuvo asociada a evento centinela, complicación grave o sujeta a investigación. La cadena de hash + `audit.audit_log` garantiza integridad. El módulo de archivo y purga programada (beyond MVP) honra estas reglas a partir del cierre del episodio quirúrgico.

- **Auditoría ISSS** — cuando el paciente es afiliado ISSS, el REG_ANEST alimenta la auditoría: tiempo de anestesiólogo (computado de `registrado_en → firmado_en`), uso de hemoderivados intraoperatorios (cruzado con `Transfusion` HIS legacy), antibióticos profilácticos (cruzado con `MedicationAdministration`), complicaciones que escalen el nivel de cuidado post-operatorio (justifican estancia en UCI vs URPA). Toda esa trazabilidad se construye por JOIN, sin duplicar campos en `ece.registro_anestesico`.

- **Indicadores BI** (TDR §16 — fase posterior, contratos disponibles): tasa de complicaciones anestésicas por servicio quirúrgico, tiempo medio de inducción, tiempo medio de despertar, eventos centinela anestésicos, tasa de conversión regional → general, balance hídrico promedio por tipo de cirugía. Estos KPIs se exponen vía outbox `ece.anestesia.firmada` consumido por el pipeline BI (DA / DE / BIA).
