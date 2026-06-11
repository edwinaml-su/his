# Inventario de drift schema↔SQL en routers ECE (spike 2026-06-10)

> **Propósito:** dimensionar el "Frente C" (dejar funcionales los módulos ECE con SQL crudo) para una propuesta de personalización/remediación. Disparado por el hallazgo de que `bridge-cirugia.router.ts` estaba roto en 12 formas contra el DDL vivo. Este inventario responde: **¿cuántos routers más tienen el mismo drift?**

## Método
1. Enumeración: **62 routers** con `INSERT/UPDATE ece.*` crudo (`$queryRaw`/`$executeRaw`), tocando ~50 tablas.
2. Hoja de respuestas: snapshot del esquema **vivo** de producción (columnas + NOT NULL + CHECK + enums) vía Supabase MCP.
3. Cruce: 6 agentes paralelos compararon cada INSERT/UPDATE contra el snapshot.
4. **Confirmación auditada:** todas las afirmaciones "tabla/columna inexistente" se verificaron con un `to_regclass()` / `information_schema.columns` batcheado contra el catálogo vivo → **100% confirmadas (0 falsos positivos)**. Las afirmaciones "valor vs CHECK" se confirmaron leyendo el literal/enum Zod en el código.

> Un router "ROTO" lanzaría error determinista en runtime (42703 columna/tabla inexistente, 23514 violación de CHECK, 23502 NOT NULL). **No lo atrapan los tests porque mockean `$queryRaw`/`$executeRaw`.** Muchos están latentes (0 datos, como quirófano) — el daño se materializa al primer uso real.

## Número auditado
| | Routers | % |
|---|---|---|
| **ROTO** confirmado | **~26** | ~42% |
| SOSPECHOSO (resta verificar) | 1–2 | ~3% |
| LIMPIO | 34 | ~55% |
| *(+ bridge-cirugia, ya remediado hoy)* | +1 | |

**~26 de 62 routers (42%) con drift confirmado**, agrupados en **~7 módulos funcionales**.

---

## Detalle por módulo (routers ROTO confirmados)

### 1. Admisión / Episodio / Traslado (4 routers — módulo crítico)
| router | desajuste clave (confirmado) | tipo |
|---|---|---|
| `ece/bridge-triage` | escribe/lee **`ece.triaje` (tabla NO existe)** — real `hoja_triaje` | duro |
| `ece/episodio` | `episodio_atencion.tipo/motivo_consulta/encounter_id` no existen; `episodio_hospitalario.id/sala_id/fecha_ingreso` no existen; `asignacion_cama.activa/fecha_asignacion` no existen | duro |
| `ece/episodio-hospitalario` | usa `eh.id` (PK real es `episodio_id`); `asignacion_cama.activa/fecha_liberacion` no existen | duro |
| `ece/bridge-admision` | `hoja_ingreso.paciente_id` no existe; `episodio_hospitalario.servicio_ingreso_id` (real `servicio_id`); lookup por `auth_user_id`; lee nombre de `ece.paciente` (sin columna de nombre) | duro |

### 2. Quirófano / Anestesia / URPA / Obstetricia / Neonatal (4 routers)
| router | desajuste clave | tipo |
|---|---|---|
| `ece/urpa-recovery` | guard `create` filtra `acto_quirurgico.establecimiento_id` (no existe; se resuelve vía episodio) | duro |
| `ece/who-checklist` | `buildEceCtx` busca `personal_salud.usuario_id` (no existe; real `his_user_id`) → rompe todo el router | duro |
| `ece/partograma` | mismo bug `personal_salud.usuario_id` | duro |
| `ece/atencion-rn` | `paciente.his_patient_id` (no existe) ×2; INSERT `paciente` omite NOT NULL `establecimiento_id`/`numero_expediente`; `sexo` recibe `M/F/I` vs CHECK `masculino/femenino/indeterminado` | duro |

*(bridge-cirugia ya remediado hoy: 12 bugs en read+write.)*

### 3. Documentos clínicos (6 routers)
| router | desajuste clave | tipo |
|---|---|---|
| `ece/historia-clinica` | `tipo_consulta` app=`ingreso/control/...` vs CHECK `primera_vez/subsecuente`; `disposicion` app=`ALTA/INTERNAMIENTO/...` vs CHECK `alta_ambulatoria/...` | duro |
| `ece/indicaciones-medicas` | `firmar()` lee `indicacion_item.notas` (no existe) | duro |
| `ece/registro-enfermeria` | JOIN a `ece.indicacion` (tabla no existe) + `indicacion_item.estado/hora_indicada` (no existen); `administracion_medicamento.estado='pospuesto'` fuera de CHECK | duro |
| `ece/resultado-estudio` | INSERT literal `estado_registro='pendiente_validacion'` vs CHECK `vigente/rectificado` | duro |
| `ece/solicitud-estudio` | Zod `tipo` permite `'otro'` vs CHECK `laboratorio/imagenologia/gabinete` | condicional |
| `ece/atencion-emergencia` | `disposicion` es texto libre (`z.string()`) vs CHECK de 4 valores | condicional |

### 4. Certificados / Egreso / Defunción / Rectificación (4 routers)
| router | desajuste clave | tipo |
|---|---|---|
| `ece/certificado-defuncion` | INSERT con ≥8 columnas inexistentes (`paciente_id`, `establecimiento_id`, `manera`, `causa_principal_cie10`…); omite NOT NULL `instancia_id`/`clasificacion`; lee `Patient."firstLastName"/"nationalId"` (no existen) | duro |
| `ece/epicrisis` | INSERT `create` omite NOT NULL `instancia_id` | duro (confianza media) |
| `ece/retencion` | filtra `episodio_atencion.organization_id` (no existe) | duro |
| `ece-rectificacion` | tabla `rectificacion` con esquema completamente distinto (`documento_instancia_id`, `valor_propuesto`, `estado`… no existen); escribe a `public.outbox` (no existe); JOIN `User.full_name` (real `fullName`) | duro |

### 5. Auditoría / Bitácora (3 routers)
| router | desajuste clave | tipo |
|---|---|---|
| `ece/bitacora` | escribe/lee `bitacora_acceso.user_id/paciente_id/exito/contexto/ip/registrado_en` — **ninguna existe** (real `personal_id/autorizado/ip_origen/ocurrido_en`) | duro |
| `firma-electronica` | mismo cluster: `insertBitacora` + `history` contra columnas inexistentes de `bitacora_acceso` | duro |
| `ece/certificacion` | `UPDATE documento_instancia SET actualizado_en` (no existe); filtro `estado_registro='activo'` vs CHECK `vigente/rectificado/suprimido` | duro |

### 6. Bedside / GS1 (6 routers)
| router | desajuste clave | tipo |
|---|---|---|
| `bedside` | escribe `ece.epcis_events` (no existe; reales `epcis_event`/`gs1_epcis_event`) | duro |
| `bedside-ronda` | `ece.gs1_gln_beds` (no existe); `indicaciones_medicas.patient_id/proxima_administracion/gtin_medicamento` (no existen) | duro |
| `bedside-hardstops` | 3 tablas inexistentes: `indicacion_bedside`, `gs1_gtin_lote`, `bedside_hard_stop_log` | duro |
| `gs1-catalogos` | `glnRouter` usa `gs1_gln.id/establecimiento_id/actualizado_en` (no existen; tabla mínima de 5 cols, PK=`codigo`) | duro |
| `gs1-gln-hierarchy` | router completo asume `gs1_gln.id` + `parent_id` (no existen) | duro |
| `gs1-medication` | `gs1_gtin.recall_fecha` (real `recall_iniciado_en`) en `list/get` + `markRecall` | duro (1 columna) |

---

## SOSPECHOSO — RESUELTO → ROTO
- `ece/valoracion-inicial-enfermeria` — **CONFIRMADO ROTO.** `firmar`/`validar` (líneas 384/431) escriben `firmado_por`/`validado_por = ctx.user.id` (id de User HIS) en columnas con **FK a `personal_salud(id)`** (verificado: `valoracion_inicial_enfermeria_firmado_por_fkey`) → 23503 al firmar/validar. El `create` sí resuelve `personalId`. Sube el total a **~28**.

---

## Triaje: ACTIVO (cableado) vs LATENTE
Cada router roto cruzado con su key tRPC (`_app.ts`) → uso en `apps/web` → sidebar (`nav-sections.ts`).

**Resultado: ~23 ACTIVOS (cableados a página + alcanzables en sidebar) / ~5 LATENTES (sin página cliente).**

> **Implicación clave:** la hipótesis "casi todos están latentes como quirófano" es **FALSA**. La mayoría son features construidas, cableadas y alcanzables desde el menú — "minas armadas" que revientan al primer uso real (igual que quirófano: cableado vía `/ece/quirofano/programacion` + sidebar, pero 0 datos → nadie lo tocó hasta el E2E). Son latentes solo por falta de datos/UAT, no por falta de UI. **Hay que arreglarlas para que las features funcionen.**

| Router roto | key tRPC | página(s) | sidebar | clase |
|---|---|---|---|---|
| certificado-defuncion | eceCertDef | /deaths, /ece/defuncion | ✓ Defunciones | ACTIVO |
| epicrisis | eceEpicrisis | /ece/epicrisis, /ece/…/alta | ✓ Epicrisis | ACTIVO |
| historia-clinica | eceHistoriaClinica | /ece/historia-clinica | ✓ Historia Clínica | ACTIVO |
| atencion-emergencia | eceAtencionEmergencia | /ece/atencion-emergencia | ✓ Atención Emergencia | ACTIVO |
| indicaciones-medicas | eceIndicaciones | /ece/indicaciones | ✓ Indicaciones Médicas | ACTIVO |
| registro-enfermeria | eceRegistroEnfermeria | /ece/registro-enfermeria | ✓ Registro Enfermería | ACTIVO |
| valoracion-inicial-enf | eceValoracionInicial | /ece/valoracion-inicial-enfermeria | ✓ Valoración Inicial ENF | ACTIVO |
| solicitud-estudio | eceSolicitudEstudio | /ece/estudios | ✓ Estudios ECE | ACTIVO |
| resultado-estudio | eceResultadoEstudio | /ece/estudios/[id]/registrar-resultado | (vía Estudios) | ACTIVO |
| episodio-hospitalario | eceEpisodioHospitalario | /ece/episodio-hospitalario, /ece/admision/[id], /patients/[id] | ✓ Episodio Hospitalario | ACTIVO |
| bridge-admision | eceBridgeAdmision | /ece/admisiones-pendientes, /ece/hoja-ingreso/nueva | ✓ Hoja de Ingreso | ACTIVO |
| urpa-recovery | eceUrpa | /ece/urpa | ✓ URPA | ACTIVO |
| who-checklist | eceWhoChecklist | /ece/quirofano/who-check | ✓ WHO Checklist | ACTIVO |
| partograma | ecePartograma | /ece/obstetricia/partograma | ✓ Partograma | ACTIVO |
| atencion-rn | eceAtencionRn | /ece/atencion-rn | ✓ Atención RN | ACTIVO |
| ece-rectificacion | eceRectificacion | /ece/rectificaciones(+cola+nueva), /ece/rectificacion | ✓ Rectificaciones / Cola DIR | ACTIVO |
| bitacora | bitacora | /ece/bitacora(+timeline) | ✓ Bitácora ECE | ACTIVO |
| certificacion | eceCertificacion | /ece/certificacion | ✓ Certificación DIR | ACTIVO |
| firma-electronica | firma | /firma-electronica/setup + pin-confirm-modal (global) | (transversal) | ACTIVO ⚠ |
| bedside | bedside | /bedside | ✓ Cola Bedside | ACTIVO |
| bedside-ronda | bedsideRonda | /bedside/ronda | ✓ (vía Bedside) | ACTIVO |
| gs1-gln-hierarchy | gs1GlnHierarchy | /gs1/gln | ✓ GLN Jerarquía | ACTIVO |
| gs1-medication | gs1Medication | /gs1/medicamentos | ✓ Medicamentos GS1 | ACTIVO |
| **bridge-triage** | eceBridgeTriage | — (sin uso cliente) | — | **LATENTE** |
| **episodio** | eceEpisodio | — (superseded por episodio-hospitalario) | — | **LATENTE** |
| **retencion** | eceRetencion | — (sin uso cliente) | — | **LATENTE** |
| **gs1-catalogos (GLN)** | gs1 | — (GLN superseded por gs1GlnHierarchy) | — | **LATENTE** |
| **bedside-hardstops** | (no registrado en _app.ts) | — (no es endpoint) | — | **LATENTE** |

### Amplificadores de impacto (blast radius)
- **`firma`** (transversal): se usa en TODO flujo de firma electrónica (`pin-confirm-modal`). Su `insertBitacora`/`history` roto afecta el registro de auditoría de cada firma.
- **`bitacora`**: visor de auditoría — roto en list/metrics/export/timeline.
- **Workspace de hospitalización** (`/ece/admision/[id]`, `/ece/episodio-hospitalario/[id]`): consume 4 routers rotos a la vez (episodio-hospitalario, indicaciones, registro-enfermeria, solicitud-estudio).

### Los 5 LATENTES = candidatos a consolidar/eliminar
No cableados a UI; varios superseded por un router canónico que SÍ funciona (`episodio`→`episodio-hospitalario`, `gs1`(GLN)→`gs1GlnHierarchy`, `bridge-triage`→`/triage` legacy + `triaje-ece`). **Acción recomendada: consolidar/borrar en vez de reescribir** → baja el conteo a remediar de ~28 a ~23.

## LIMPIO (34 routers — referencia del patrón correcto)
Destacan los canónicos bien escritos (verificados "COLUMNAS REALES 2026-05-24"): `ece/orden-ingreso`, `ece/hoja-ingreso`, `ece/triaje-ece`, `ece/bridge-encounter`, `ece/consentimiento`, `ece/sala-expulsion`, `ece/acto-quirurgico`, `ece/registro-anestesico`, `ece/preop-checklist`, `ece/reanimacion-neonatal`, `ece/rri`, `ece/verbal-order`, `ece/evolucion-medica`, `ece/fall-event`, `ece/critical-result`, `ece/documento-asociado`, `ece/comite-ece`, `ece/contingencia`, `ece/certificado-incapacidad`, `gs1-proceso-a/b/c/f`, `gs1-lote-trace`, `inventory`, `farmacovigilancia`, `cold-chain`, `bedside-stat`, `audit-outlier`, `ece/icd10`, `workflow/transitions`, `ece-bridge-patient`, `ece-hooks`, etc.

---

## Causa raíz común
El estado de *workflow* (borrador/firmado/anulado) vive en `documento_instancia` (motor); el *vocabulario* de columnas y CHECK (estado_registro = `vigente/rectificado`, enums de episodio, nombres de tabla) se endureció DESPUÉS de que estos routers se escribieran. Los routers tempranos/bridge quedaron contra un esquema anterior. Como **todos los tests mockean el SQL crudo**, el drift nunca se detecta en CI ni en typecheck (el SQL en template strings no se tipa).

## Implicación de esfuerzo (Frente C)
- **~26 routers a reescribir** (rango: 1 columna como `gs1-medication`, hasta reescritura completa como el cluster admisión/episodio, `certificado-defuncion`, `ece-rectificacion`, el cluster bitácora).
- Calibrando con quirófano (1 router de 12 bugs ≈ 1 sesión profunda): **~2.5–4 dev-meses solo en reescrituras**, antes de datos maestros y E2E.
- **Acción recomendada antes de dimensionar:** (1) construir un **harness de tests de integración contra BD efímera** que ejecute el SQL real (atrapa esta clase entera automáticamente y evita regresión); (2) **triar latente vs ruta-activa** por módulo (muchos ECE conviven con módulos legacy que sí funcionan — ver regla "adecuar legacy vs duplicar"); (3) priorizar módulos por valor clínico/regulatorio.

## Apéndice — confirmación auditada
- Tablas verificadas inexistentes (8/8): `ece.triaje`, `ece.indicacion`, `public.outbox`, `ece.epcis_events`, `ece.gs1_gln_beds`, `ece.indicacion_bedside`, `ece.gs1_gtin_lote`, `ece.bedside_hard_stop_log`.
- Columnas verificadas inexistentes (41/41) — todas las señaladas devolvieron `false` contra `information_schema.columns`.
- Literales valor-vs-CHECK verificados en código: `pendiente_validacion` (resultado-estudio:282), `pospuesto` (registro-enfermeria:79), `otro` (solicitud-estudio:65), `DISPOSICION_OPTIONS`/`TIPO_CONSULTA` (historia-clinica:46-49), `disposicion` libre (atencion-emergencia:60).
