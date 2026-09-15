# Auditoría de Cobertura — Admisión, Emergencia/Triage, Hospitalización/Censo, Bloque Quirúrgico

**Fecha:** 2026-09-15
**Autor:** @AE (Arquitecto Empresarial) — Unidad de Transformación Digital, Inversiones Avante
**Alcance del método:** auditoría estática de código (solo lectura), repo `C:\proyecto\HIS`, rama `feat/cc-0030-entrega-parcial`. NO se ejecutó código, NO se modificó nada, NO se consultó la BD de producción salvo lo ya documentado en memoria del proyecto.
**Regla de evidencia:** toda brecha cita ruta de archivo y línea. Lo no verificable contra la BD real (RLS efectivo en runtime, catálogos sembrados) se marca `[NO VERIFICADO — supuesto]`.

---

## 1. Resumen del alcance

### 1.1 Módulos auditados y superficie de código revisada

| Módulo | Routers / archivos clave revisados (lectura completa) |
|---|---|
| **Admisión** | `packages/trpc/src/routers/patient.router.ts`, `patient-account.router.ts`, `patient-identification.router.ts`, `patient-dedup.router.ts`, `tipo-cuenta.router.ts`, `encounter.router.ts`, `ece/bridge-admision.router.ts` |
| **Emergencia / Triage Manchester** | `packages/trpc/src/routers/triage.router.ts`, `triage-dashboard.router.ts`, `triage-flowchart.router.ts`, `ece/bridge-triage.router.ts`, `ece/triaje-ece.router.ts`, `bedside-stat.router.ts` (descartado del alcance de triage) |
| **Hospitalización y censo** | `packages/trpc/src/routers/bed.router.ts`, `room.router.ts`, `encounter-transfer.router.ts`, `encounter-discharge.router.ts`, `account-receivable.router.ts`, `inpatient.router.ts`, `death-certificate.router.ts`, `packages/trpc/src/lib/egreso-fisico-gate.ts` |
| **Bloque quirúrgico** | `packages/trpc/src/routers/surgery.router.ts`, `ece/bridge-cirugia.router.ts`, `ece/acto-quirurgico.router.ts`, `ece/who-checklist.router.ts`, `ece/registro-anestesico.router.ts`, `ece/preop-checklist.router.ts`, `ece/urpa-recovery.router.ts`, `ece/consentimiento.router.ts` |
| **Transversal (RBAC/roles)** | `packages/trpc/src/trpc.ts`, `packages/trpc/src/rls-context.ts`, `packages/trpc/src/ece/rls-context.ts`, `packages/trpc/src/ece/workflow-context.ts`, `packages/trpc/src/rbac/effective-roles.ts`, `packages/trpc/src/abac/guard.ts`, `packages/database/prisma/schema.prisma` (enum/modelo Role), `packages/database/sql/56_ece_01_catalogos.sql`, `63_ece_08_seed.sql`, `194_cc0017_rbac_parametrizable.sql` |
| **Transversal (notificaciones)** | `packages/trpc/src/routers/notifications.router.ts`, `packages/infrastructure/src/notifications/dispatcher.ts`, `packages/database/src/outbox/emit.ts`, `packages/database/prisma/schema.prisma` (modelo `DomainEvent`/`Notification`/`RoleNotificationDefault`), `packages/contracts/src/events/catalog.ts` |

### 1.2 Hallazgo transversal que condiciona TODO el reporte

Antes de leer las matrices por módulo, dos hallazgos estructurales aplican a los cuatro módulos por igual y son la causa raíz de la mayoría de las brechas de notificación reportadas en §4:

1. **El motor de notificaciones (outbox → dispatcher → inbox) existe, está bien diseñado (idempotencia, retry, audit trail, hash chain), pero está desconectado en ambos extremos.** `dispatchDomainEvent` (`packages/infrastructure/src/notifications/dispatcher.ts:537-728`) solo resuelve destinatarios para 12 tipos de evento (`vital.critical`, `lab.criticalValue`, `drug.interaction`, `allergy.mismatch`, `transfusion.crossmatchFailed`, `transfusion.adverseReaction`, `pathology.reportSigned`, `pathology.criticalFinding`, `accounting.periodClosed`, `accounting.journalPostedHighValue`, `security.breakGlass.activated`, `ece.rectificacion.aprobada/rechazada` — switch en líneas 131-167). **Ningún evento de admisión, triage, censo/alta o quirófano está en ese switch** — todos caen al `default` (línea 154-166) y retornan `[]` sin destinatarios. Además, `Grep` de `dispatchDomainEvent` en todo el repo confirma **cero invocadores** en rutas de API, cron o Edge Function — solo el propio archivo, su barrel y 2 tests.
2. **La mayoría de las mutations críticas de estos cuatro módulos no tiene `requireRole`.** Corren sobre `tenantProcedure` puro (sesión + organización activa, sin verificación de rol clínico/administrativo). Esto se repite en: `patient.create`, `patientAccount.crear`, `encounter.admit`, `bed.assignToEncounter`, `encounterTransfer.transferEncounter`, `encounterDischarge.dischargeEncounter`, `inpatient.discharge`, la totalidad de `triage.router.ts`/`triage-dashboard.router.ts`/`triage-flowchart.router.ts`, y la totalidad de `surgery.router.ts` (vía A). El motor de permisos fino (`requirePermission`, ABAC) SÍ existe (CC-0017) pero está cableado en 6-8 puntos de prueba de concepto en todo el repo, ninguno en estos cuatro módulos.

### 1.3 Limitaciones del método

- No se verificó el comportamiento **real** de RLS en runtime (solo el código que lo activa/omite) — para eso se requeriría `EXPLAIN`/sesión con rol `authenticated` contra Supabase, fuera de alcance de solo-lectura de código.
- No se verificó si los catálogos `ece.tipo_documento` para `CONS_QX`/`PROG_QX` están sembrados en la BD real — se marca `[NO VERIFICADO]`.
- No se auditaron los 152 routers del monorepo exhaustivamente; el conteo agregado de `withTenantContext` (98/159 sí, 61/159 no) es contexto orientativo, no una auditoría RLS completa.

---

## 2. Matriz de Brechas Ocultas (worst paths + excepciones no mitigadas)

| # | Módulo | Worst path / excepción | Qué protege hoy el sistema (evidencia) | Clasificación | Severidad |
|---|---|---|---|---|---|
| B1 | Admisión | RLS bypass en `encounter.router.ts` — el router que admite pacientes y asigna cama no usa `withTenantContext` en `admit` (línea 63/128), `list` (368/377), `listOpenByOrg` (405/440) ni `getCensus` (470/490-510); el filtro tenant vive solo en `where: organizationId` de JS, bajo el rol BYPASSRLS de Supabase | Ninguna — filtro JS débil, exactamente el patrón que CLAUDE.md marca como ya bypaseado en el pasado | **Incompleto (existe pero mal implementado)** | **P0** |
| B2 | Transversal (afecta hospitalización) | RLS bypass estructural: `withWorkflowContext` (`packages/trpc/src/ece/workflow-context.ts:1-23`) es un stub literal — `TODO(Stream 11): aplicar SET LOCAL... / return prisma.$transaction(...)` sin `SET LOCAL` ni demote de rol — usado por 6 routers ECE: `episodio-hospitalario.router.ts`, `acto-quirurgico.router.ts`, `episodio.router.ts`, `cama.router.ts`, `workflow-tipoDoc.router.ts`, `workflow-tipoDoc-override.router.ts` | El helper correcto `withEceContext` (`packages/trpc/src/ece/rls-context.ts:61-96`) existe pero no está cableado en estos 6 archivos | **No cableado (existe la solución, nadie la usa)** | **P0** |
| B3 | Hospitalización/censo | El gate de egreso físico CC-0027 (`assertEgresoFisicoAutorizado`, `egreso-fisico-gate.ts:47-63`) es bypaseable: `inpatient.discharge` (`inpatient.router.ts:550-601`) llama `releaseActiveBeds` (línea 597, helper 1032-1052) y libera TODAS las camas activas del encuentro directo a `FREE` **sin invocar el gate** — 0 referencias a `egreso-fisico-gate` en `inpatient.router.ts` | El gate SÍ existe y SÍ se aplica en `bed.router.ts:release` (línea 287-339) — pero es una ruta paralela sin cubrir | **Incompleto (mitigado en una ruta, no en la paralela)** | **P0** |
| B4 | Hospitalización/censo | Alta voluntaria / contra indicación médica y fuga (`ABSCONDED`) no tienen rama especial: siguen el mismo camino administrativo de 2 fases que un alta médica normal (`encounter-discharge.router.ts:113-133`); si el paciente se fue sin firmar nada, la cuenta queda abierta indefinidamente sin mecanismo de resolución forzosa/timeout | Ninguna — `dischargeTypeEnum` contempla el valor pero no hay lógica diferenciada | **Ausente** | **P1** |
| B5 | Hospitalización/censo | Identidad del fiador en CXC (`AccountReceivable.firmanteDocumento`) es texto libre `VARCHAR(40)` sin regex DUI/NIT/NIE, sin `validateDUI`, sin cruce contra registro alguno (`patient-account.router.ts:49`) | Solo `z.string().trim().min(1).max(40)` — validación de identidad enteramente manual/fuera de sistema | **Ausente** | **P1** |
| B6 | Hospitalización/censo | `AccountReceivable.estado` define `INCOBRABLE` en el enum pero **no existe ninguna mutation** que lo asigne — solo `registrarAbono` transiciona `ABIERTA→PAGADA` | Ninguna | **Ausente** | **P2** |
| B7 | Hospitalización/censo | `CoverageLetter` no tiene campo de vigencia/estado; `computeLiquidacion` (`patient-account.router.ts:262-297`) agrega TODAS las cartas de cobertura de la cuenta sin filtrar por vigencia — una carta revocada por la aseguradora sigue contando | Ninguna | **Ausente** | **P1** |
| B8 | Bloque quirúrgico | Cirugía sin consentimiento firmado: `eceActoQuirurgico.firmar` (`acto-quirurgico.router.ts:592-653`) solo valida estado `borrador`, `procedimiento_realizado` no vacío y PIN — no consulta `ece.consentimiento_informado` ni llama `assertDependenciasFirmadas`. En `preop-checklist.router.ts`, `consentimiento_firmado` (línea 39/445) es un booleano marcado a mano por el clínico | Ninguna — riesgo de seguridad clínica y legal (Art. 40 NTEC) | **Ausente** | **P0** |
| B9 | Bloque quirúrgico | Cargo C3-2 de reserva de quirófano solo se dispara si la reserva se crea por la vía legacy `surgery.router.ts case.create` (líneas 242-263, lee `OperatingRoom.chargeCode`). La vía "oficial" NTEC `ece/bridge-cirugia.router.ts programarCirugia` **no escribe en `SurgeryCase`** y no genera cargo — confirmado también en `docs/flujos/PROG_QX.md:168` | Ninguna — fuga de ingreso si el hospital opera por el flujo NTEC | **Incompleto / no cableado entre vías** | **P0** |
| B10 | Bloque quirúrgico | Doble booking de quirófano entre vías: `detectOrConflict` (vía A, sobre `SurgeryCase`) y `detectarConflictoSala` (vía B, sobre `ece.reserva_sala_qx`) son motores independientes sobre tablas distintas — una reserva en una vía es invisible para la otra | Mitigado dentro de cada vía por separado, no cruzado | **Incompleto** | **P0** |
| B11 | Bloque quirúrgico | Race condition TOCTOU documentada en el propio proyecto (`docs/flujos/PROG_QX.md:158`, HE-03): la verificación de solapamiento en `programarCirugia` corre antes de abrir la transacción (`bridge-cirugia.router.ts:232-243`, fuera de `withWorkflowContext` que inicia en línea 251) — sin `pg_advisory_xact_lock` | Ninguna | **Incompleto** | **P1** |
| B12 | Bloque quirúrgico | No existe mutation para asignar `operatingRoomId` a un caso creado sin sala (`surgery.router.ts` no tiene `update` genérico, solo `postpone` que cambia horario) — un caso sin sala nunca dispara cargo ni queda sujeto a detección de conflicto | Ninguna | **Ausente** | **P2** |
| B13 | Emergencia/Triage | Paciente ROJO Manchester sin reevaluar a tiempo: no existe ningún job server-side (cron/pg_cron/Edge Function) que vigile el SLA de espera y dispare alerta — el cálculo `severityFor()` (`triage-dashboard.router.ts:42-49`) solo corre al consultar el dashboard (pull, no push). Contraste directo: SÍ existe el patrón equivalente para Morse (`packages/database/sql/120_morse_sla_watchdog.sql`, pg_cron cada hora) | Ninguna — la única protección es que alguien mire el wallboard manualmente | **Ausente** | **P0** |
| B14 | Emergencia/Triage | Los eventos canónicos de triage (`triaje.iniciado/categorizado/firmado/re_categorizado`) que `docs/flujos/TRIAJE.md:95-98,136-141` describe como ya funcionando, **no se emiten en código** — `triage.router.ts` no importa `emitDomainEvent` en ningún punto | Ninguna — la ficha describe el "target" mezclado con lo implementado sin distinguirlo | **Ausente** | **P0** |
| B15 | Emergencia/Triage | El bridge `ece.hoja_triaje` es una acción manual separada (`eceBridgeTriage.createEceFromTriage`), no automática al cerrar el triage HIS; si falla, el triage legacy no se ve afectado (queda `COMPLETED` sin documento ECE) — el propio job de backfill `syncCompletedTriages` (líneas 479-574) es evidencia de que en producción quedan triages huérfanos de documento ECE | Backfill manual/batch existe, pero no hay bloqueo ni alerta en el momento | **Incompleto** | **P2** |
| B16 | Admisión | Apertura de cuenta de paciente no verifica cobertura/póliza vigente (CC-0028): `patientAccount.crear` (`patient-account.router.ts:481-540`) no invoca `resolverCobertura` — el `tipoCuentaId` (pagador declarado) es independiente de `PatientCoverage` real | El motor de coverage-resolver existe pero se usa solo downstream (liquidación, facturación dual), no como precondición de apertura | **No cableado en el punto de entrada** | **P1** |
| B17 | Admisión | Sin validación de mayoría de edad / responsable obligatorio para menores en `patient.create` — el campo `responsable` (DUI_RESP) se persiste best-effort con `.catch()` silencioso (`patient.router.ts:512-520`), sin chequeo de edad del paciente ni de mayoría de edad del responsable | Ninguna | **Ausente** | **P1** |

---

## 3. Matriz RACI y Brechas de Rol

### 3.1 Catálogos de rol coexistentes (fuente de fragmentación)

| Catálogo | Contenido confirmado | Evidencia |
|---|---|---|
| `public."Role".code` (RBAC genérico tRPC) | `PHYSICIAN, NURSE, ADMISSION_CLERK, TRIAGE_NURSE, PHARMACIST, ADMIN` (seed base) + `DIR`, `ANEST`, `GO`, roles especializados, `WORKFLOW_DESIGNER` | `packages/database/prisma/seed.ts:356-361`; `packages/database/sql/64_director_role.sql:16-27`; `75_specialized_roles.sql:16-40`; `95_workflow_designer_role.sql:14` |
| `public."RoleCodeAlias"` | `MEDICO→PHYSICIAN, MC→PHYSICIAN, ENF→NURSE, FARM→PHARMACIST, ANES→ANEST, SUPER_ADMIN→super_admin` — **`MT, PHARM, ADM, ADMIN_CLINICO, ADMIN_ORG, DIR_MEDICO` sin alias, documentado como pendiente en el propio SQL** | `packages/database/sql/194_cc0017_rbac_parametrizable.sql:130-143` |
| `ece.rol` (matrices NTEC LLENA/RESPONSABLE/AUTORIZA/FIRMA) | `ADM, AC, ARCH, ENF, MT, MC, ESP, IC, DIR` (9 roles) | `56_ece_01_catalogos.sql:154-159`; seed `63_ece_08_seed.sql:15-25` |
| Códigos usados como literal en `requireRole([...])`, sin alias confirmado hacia los catálogos anteriores | `ADMISION`, `ACCOUNTANT`, `BILLING`, `QX`, `ESP`, `EQUIPOS`, etc. — 250+ ocurrencias en los routers | `Grep requireRole\(\[` sobre `packages/trpc/src/routers/` |

**Hallazgo de gobierno:** para el puesto de "admisionista" coexisten al menos **3 códigos distintos sin alias unificador**: `ADM` (usado en `bridge-admision.router.ts:220,227`), `ADMISION` (usado en `patient-identification.router.ts:161,243`), `ADMISSION_CLERK` (seedeado en `public.Role` pero **no referenciado en ningún `requireRole` del flujo de admisión auditado**). Si el rol operativo real del admisionista en producción es `ADMISSION_CLERK`, ese código no habilita hoy ningún paso protegido del flujo de admisión ni del bridge NTEC.

### 3.2 RACI por módulo — Admisión

| Etapa | Ejecuta (rol permitido en código) | Valida | Autoriza | Informado | Suple en ausencia |
|---|---|---|---|---|---|
| Registrar paciente (`patient.create`) | Cualquiera (`tenantProcedure`, sin `requireRole` — `patient.router.ts:381`) | — | — | Nadie (sin notificación) | No aplica |
| Dedup formal NTEC con doble firma | `ADM/DIR/ADMIN` solicita; `DIR/ADMIN` ejecuta (`patient-dedup.router.ts:398,`) | Segundo firmante de rol ECE distinto (quorum HJ-31) | DIR/ADMIN | Nadie | **NO EXISTE** |
| Emitir/renovar pulsera GSRN | `ADMIN/ADMISION` | — | — | Nadie | **NO EXISTE** |
| Abrir cuenta de paciente (`patientAccount.crear`) | Cualquiera (`tenantProcedure`, sin rol — línea 481) | — | — | Nadie | No aplica |
| Regularizar cuenta pendiente | `ADMIN/ACCOUNTANT` | — | — | Nadie | **NO EXISTE** |
| Admisión formal NTEC (bridge) | Solo `ADM` + PIN (`bridge-admision.router.ts:220,227`) | — | — | Nadie (evento emitido pero huérfano) | **NO EXISTE** |
| Cerrar cuenta / Alta administrativa | `ADMIN/ACCOUNTANT` | — | — | Nadie | **NO EXISTE** |

**Gaps de rol — Admisión:** (1) los dos pasos más sensibles de creación (`patient.create`, `patientAccount.crear`) no exigen ningún rol, mientras cierre/alta sí — asimetría de control dentro del mismo flujo; (2) fragmentación de nomenclatura de rol admisionista (§3.1); (3) sin mecanismo de suplencia para ningún paso `requireRole`-protegido.

### 3.3 RACI por módulo — Emergencia/Triage Manchester

| Etapa | Ejecuta | Valida/Reclasifica | Autoriza (firma NTEC) | Informado si crítico | Suple en ausencia |
|---|---|---|---|---|---|
| Recepción/quickIntake, vitales, discriminadores, `setAssignedLevel` | Cualquiera (`tenantProcedure`, sin `requireRole` en `triage.router.ts`, `triage-dashboard.router.ts`, `triage-flowchart.router.ts` — **0 resultados de `requireRole` en los tres archivos**) | Cualquiera (mismo procedure, `overrideJustification` sin rol) | — | **Nadie — NO EXISTE resolución de destinatario** | **NO EXISTE** |
| Promoción a documento ECE formal | `NURSE/PHYSICIAN` (`bridge-triage.router.ts`, `nurseProcedure` línea 245) | — | — | Evento emitido, huérfano | **NO EXISTE** |
| Validación médica del documento NTEC | — | `MT` (`triaje-ece.router.ts:43`) | `MT` | — | **NO EXISTE** |
| Re-triage por deterioro (sugerido) | Disparo **client-side**, no server-side (confirmado por comentario en `triage-dashboard.router.ts:12-15`) | — | — | — | No aplica |

**Gaps de rol — Triage:** el control de rol documentado en `docs/flujos/TRIAJE.md:31-38` (ENFERMERIA_TRIAGE/NURSE responsable, PHYSICIAN valida override) **no se hace cumplir en el código operativo** — solo existe en la capa de documento ECE formal, paralela y desacoplada del flujo que efectivamente atiende al paciente. Sin rol → sin trazabilidad de responsabilidad clínica real por categorización.

### 3.4 RACI por módulo — Hospitalización y censo / Alta 2 fases

| Etapa | Ejecuta | Autoriza | Segregación de funciones | Suple en ausencia |
|---|---|---|---|---|
| Admitir con cama (`encounter.admit`) | Cualquiera, sin rol (`encounter.router.ts:63`) | — | — | No aplica |
| Asignar cama manual (`bed.assignToEncounter`) | Cualquiera, sin rol (`bed.router.ts:176`) | — | — | No aplica |
| Admisión hospitalaria paralela (`inpatient.router.ts`) | Cualquiera, sin rol | — | Lógica **duplicada** de `capturarCargo` respecto a `encounter.router.ts`/`bed.router.ts` | No aplica |
| Traslado interno | Cualquiera, sin rol (`encounter-transfer.router.ts:65`) | — | — | No aplica |
| Alta médica (Fase 1) | Cualquiera, sin rol (`encounter-discharge.router.ts:52`) — **contraste directo:** `death-certificate.create` sí exige `PHYSICIAN` (línea 42/50) | — | Alta médica (clínicamente equivalente en criticidad a un certificado de defunción) **no tiene el mismo control** | No aplica |
| Alta administrativa Fase 2 (CANCELACION_TOTAL / CXC) | `ADMIN/ACCOUNTANT` (`patient-account.router.ts:39,871`) | mismo rol | **Mismo rol abre la CXC (`altaAdministrativa`) y la cobra (`registrarAbono`, `account-receivable.router.ts:15,49`)** — sin segundo actor de control | **NO EXISTE** |
| Autorizar egreso físico | `ADMIN/ACCOUNTANT` (mismo mutation) | mismo rol | — | **NO EXISTE** |
| Liberar cama (`bed.release`, con gate) | Cualquiera, sin rol | Gate automático (`assertEgresoFisicoAutorizado`) | — | No aplica |
| Alta vía `inpatient.discharge` (bypasea el gate) | Cualquiera, sin rol | **Ninguna — el gate no se invoca (B3)** | — | No aplica |

**Gaps de rol — Censo/Alta:** (1) los pasos que mueven al paciente físicamente (admitir, asignar cama, trasladar, alta médica) no exigen ningún rol pese a disparar cargos financieros reales (`capturarCargo`); (2) segregación de funciones violada en el ciclo CXC (mismo rol abre y cobra la deuda); (3) sin suplencia — si solo hay un ADMIN/ACCOUNTANT de turno, es el único que puede cerrar cualquier alta con saldo pendiente.

### 3.5 RACI por módulo — Bloque quirúrgico

| Etapa | Ejecuta (vía A legacy) | Ejecuta (vía B/C NTEC) | Autoriza/Valida | Segregación de funciones | Suple en ausencia |
|---|---|---|---|---|---|
| Reservar y cobrar quirófano | Cualquiera, sin rol (`surgery.router.ts`, 0 `requireRole` en todo el archivo) | `PHYSICIAN/ADM` (`bridge-cirugia.router.ts:205`) | — | — | No aplica |
| Cancelar reserva ya cobrada | Mismo `tenantProcedure` que la creó | `PHYSICIAN/ADM` (mismos roles que crean) | — | **Sin doble control — quien reserva/cobra también cancela/reversa** | **NO EXISTE** |
| Sign-In/Time-Out/Sign-Out OMS (vía A) | Cualquiera, sin rol | — | — | Sin control de "quién", solo de "qué" (orden de campos) | No aplica |
| Checklist prequirúrgico (PREOP) | — | `MC/ANES` (`preop-checklist.router.ts:253`) | firma PIN | — | **NO EXISTE** |
| Acta quirúrgica — crear y firmar | — | `ESP/MC/QX` (`surgeonProc`, línea 304) — **mismo rol crea Y firma** | firma PIN | Sin control externo hasta `validar` | **NO EXISTE** |
| Acta quirúrgica — validar/anular | — | `ESP/DIR` (`chiefProc`) | — | Doc reconoce "auto-validación por el mismo cirujano principal es práctica común" (`ACT_QX.md:178`) | **NO EXISTE — punto único si no hay jefe de servicio distinto** |
| Registro anestésico | — | `ESP` | firma PIN | — | **NO EXISTE** |
| URPA — ingreso / alta | — | ingreso: `NURSE`; alta: `ESP/MC` + PIN (`urpa-recovery.router.ts:160,162,421`) | firma PIN en alta | Correcto — rol médico distinto del de ingreso | — |
| Instrumentista/circulante | — | No firman ningún documento — solo aparecen en JSONB `ayudantes` | — | **Sin responsabilidad individualizada** | No aplica |

**Gaps de rol — Quirófano:** (1) la vía legacy que efectivamente cobra (A) no tiene ningún control de rol; (2) mismo rol crea y firma el acta quirúrgica sin control externo obligatorio hasta la validación (que además puede ser el mismo cirujano); (3) instrumentista/circulante sin firma individualizada — brecha de responsabilidad NTEC Art. 39-40; (4) banco de sangre/esterilización sin rol ni endpoint — el evento de transfusión intraoperatoria descrito en `ACT_QX.md:197` es aspiracional, no implementado.

### 3.6 Mecanismo de suplencia — hallazgo transversal

**Confirmado: NO existe mecanismo dinámico de suplencia/delegación de rol en ningún módulo auditado.** Búsqueda exhaustiva (`Grep` case-insensitive de "supervisor", "delegad*", "backup role", "guardia", "suplenc*", "on-call") sobre `packages/trpc/src`, `schema.prisma` y `packages/database/sql/` no arrojó ningún modelo `RoleDelegation`/`UserDelegate`/`OnCallAssignment`. El único indicio es una fila estática en el seed del motor de documentos NTEC: `('HIST_CLIN', 'MT', 'LLENA', false)` con comentario *"MT puede en ausencia de MC"* (`63_ece_08_seed.sql:333`) — es una regla fija de la matriz de permisos, no una delegación dinámica con vigencia/aprobación/auditoría. El propio dispatcher documenta la ausencia: *"No existe rol 'jefe de servicio' seedeado... fallback: notifica a TODOS los usuarios con membresía vigente en alguno de los roles de gobierno"* (`dispatcher.ts:408-415`).

---

## 4. Matriz de Notificaciones

Formato solicitado. Todo evento marcado **FALTANTE** confirma ausencia de resolución de destinatario en `dispatcher.ts:131-167` (cae a `default` → `[]`) y/o ausencia de `emitDomainEvent` en el router de origen.

| Módulo | Etapa | Evento disparador | Destinatario (rol) | Tipo | Canal propuesto | Momento | SLA | Escalamiento | Contenido mínimo | Trazabilidad |
|---|---|---|---|---|---|---|---|---|---|---|
| Admisión | Admisión formal NTEC completada | `ece.admision.completada` (emitido, `bridge-admision.router.ts:546-562`) | Piso destino / Enfermería jefe | Informativa | In-app | Al admitir | N/A | N/A | Paciente, cama, episodio | **FALTANTE** — emitido pero sin case en dispatcher |
| Admisión | Cuenta abierta sin cobertura verificada | *(no existe evento)* | Facturación/Cobros | Alerta | In-app | Al abrir cuenta | 24h | Jefe de Admisión | Paciente, tipo cuenta, pagador declarado | **FALTANTE — sin evento, sin destinatario** |
| Emergencia/Triage | Paciente clasificado (cualquier color) | `triaje.categorizado` *(no emitido en código)* | Médico de turno del área | Acción requerida (rojo/naranja) | In-app + sonido | Al categorizar | N/A | N/A | Paciente, color, hora | **FALTANTE — evento inexistente en código, solo descrito en doc** |
| Emergencia/Triage | SLA de espera excedido (color rojo/naranja) | `triaje.sla_excedido` *(no existe)* | Jefe de turno / médico asignado | **Alerta crítica** | In-app prioritario + escalamiento | Al vencer % del SLA | 80% aviso / 100% escalamiento (según `TRIAJE.md:136-141`, no implementado) | Jefe de turno / Dirección médica | Paciente, color, minutos de espera | **FALTANTE — ni watchdog, ni evento, ni dispatcher** |
| Emergencia/Triage | Vinculación a documento ECE formal | `ece.triaje.linkedToHisTriage` (emitido) | Enfermería/Archivo clínico | Informativa | In-app | Al vincular | N/A | N/A | Episodio, documento | **FALTANTE — emitido, sin case en dispatcher** |
| Hospitalización | Alta médica registrada (Fase 1) | *(no existe evento)* | Admisión / Facturación (para iniciar Fase 2) | Acción requerida | In-app | Al dar alta médica | 4h | Jefe de Admisión | Paciente, encuentro, médico | **FALTANTE — sin `emitDomainEvent` en `encounter-discharge.router.ts`** |
| Hospitalización | CXC creada (ruta CXC en alta administrativa) | *(no existe evento)* | Cobros/Cartera | Acción requerida | In-app | Al crear `AccountReceivable` | 24h | Gerencia financiera | Cuenta, monto, documento, firmante | **FALTANTE — 0 llamadas a `emitDomainEvent` en `patient-account.router.ts`** |
| Hospitalización | CXC vencida (`plazoDias` cumplido) | *(no existe evento ni watchdog)* | Cobros/Cartera | Alerta | In-app | Al vencer plazo | N/A | Gerencia financiera | Cuenta, monto vencido | **FALTANTE — campo persistido, sin job que lo evalúe** |
| Hospitalización | Traslado enviado/recibido | `patient.transfer.sent` / `.confirmed` (emitido) | Servicio origen/destino | Acción requerida | In-app | Al enviar/recibir | N/A | N/A | Paciente, cama origen/destino | **Cableado a nivel outbox** — despacho real depende de Edge Function externa `notifications-dispatch` (`044_notifications_outbox_poller.sql:72-154`), no auditada en este alcance |
| Hospitalización | Defunción con cuenta abierta | *(no existe evento)* | Cobros/Cartera | Alerta | In-app | Al certificar defunción | Inmediato | Dirección administrativa | Paciente, saldo pendiente | **FALTANTE — `death-certificate.router.ts` no toca `PatientAccount`/`AccountReceivable`** |
| Quirófano | Cirugía programada (vía B) | `ece.cirugia.programada` (emitido) | Equipo quirúrgico / tablero de sala | Informativa | In-app | Al programar | N/A | N/A | Paciente, sala, hora | **FALTANTE — emitido, sin case en dispatcher** |
| Quirófano | WHO checklist completado | `ece.who_checklist.completado` (emitido) | Cirugía / Enfermería / Anestesia | Informativa | In-app | Al completar Sign-Out | N/A | N/A | Caso, checklist | **FALTANTE — emitido, sin case en dispatcher** |
| Quirófano | Acta quirúrgica firmada | `ece.acto_quirurgico.firmado` (emitido) | URPA (si destino=URPA), Cuenta hospitalaria (cargo), Codificación CIE-10 | Acción requerida | In-app | Al firmar | 1h | Jefe de servicio | Caso, cirujano, procedimiento | **FALTANTE — emitido, sin case en dispatcher; y la cadena downstream descrita en `ACT_QX.md:200-208` no tiene ningún consumidor implementado** |
| Quirófano | Alta de URPA otorgada | `ece.urpa.alta_otorgada` (emitido) | Piso destino (para indicaciones post-Qx) | Acción requerida | In-app | Al dar alta URPA | N/A | N/A | Paciente, destino, condición | **FALTANTE — emitido, sin case en dispatcher; sin campo estructurado de destino** |
| Quirófano | Reserva cancelada sin reverso de cargo (vía B) | *(no existe evento diferenciador)* | Facturación | Alerta | In-app | Al cancelar | N/A | N/A | Reserva, motivo | **FALTANTE — no aplica reverso porque nunca hubo cargo en esta vía; sin alerta que lo señale** |

**Patrón repetido en las 4 áreas:** el diseño de "outbox + dispatcher" es correcto arquitectónicamente (auditable, con hash chain, con reintentos), pero el **catálogo de tipos de evento que el dispatcher sabe resolver** (`dispatcher.ts:131-167`) nunca se extendió más allá del set original de Beta.21/22 (signos vitales, labs, farmacia, transfusión, patología, contabilidad, break-glass). Ningún evento de Admisión/Triage/Censo-Alta/Quirófano fue añadido a ese switch — es un gap de mantenimiento del catálogo, no un problema de diseño del motor.

---

## 5. Causa Raíz Preventivo (críticas)

| Hallazgo crítico | Causa raíz | Por qué se repite en 4 módulos | Acción preventiva estructural |
|---|---|---|---|
| Notificaciones ausentes en los 4 módulos (§4) | El catálogo de `eventType` del dispatcher (`dispatcher.ts:131-167`) se mantiene manualmente como lista fija; nadie agregó un ítem de Definition-of-Done que exija "todo `emitDomainEvent` nuevo debe tener case en dispatcher o ticket explícito de por qué no" | Cada módulo se construyó en su propio sprint/PR sin checklist cruzado contra el dispatcher | Agregar regla a CLAUDE.md/skill `careful-coding`: ningún PR que agregue un `eventType` nuevo a `packages/contracts/src/events/catalog.ts` puede mergear sin (a) case en `dispatcher.ts` o (b) entrada explícita en una tabla de "eventos informativos sin destinatario, a propósito", revisada por @QA |
| Mutations críticas sin `requireRole` (B1, admisión/censo/quirófano completos) | El patrón `tenantProcedure` (solo sesión+tenant) se usó como default seguro suficiente durante el MVP, y nunca se hizo un barrido de "elevar a `requireRole` los write-paths que disparan efectos financieros/clínicos irreversibles" al madurar el producto | Se repite porque no hay un lint/regla automatizada que distinga mutations de alto impacto (crean cargo, mueven paciente, firman documento) de las de bajo impacto | Crear una convención de nombre o metadata (`.meta({ impact: "critical" })`) en tRPC + un check de CI que falle si una mutation con `capturarCargo`/`emitDomainEvent` de tipo crítico no tiene `requireRole` o `requirePermission` |
| RLS bypass (B1, B2) | Dos mecanismos de tenant-context (`withTenantContext` para `public.*`, `withEceContext`/`withWorkflowContext` para `ece.*`) evolucionaron en paralelo (ADR 0020) y uno de ellos (`withWorkflowContext`) quedó como stub de "Stream 11" sin que un gate de CI verificara que ya no quedan stubs de ese tipo | Cualquier router nuevo bajo `ece/` puede importar el stub sin que nada lo señale — no es específico de un módulo | Eliminar `withWorkflowContext` del código (o hacerlo lanzar error en vez de no-op) para forzar el fallo visible en cualquier router que aún lo use; añadir test de integración que verifique RLS real (rol `authenticated`, no bypass) en cada router `ece/*` |
| Doble vía no sincronizada en quirófano (B9, B10) | La regla "adecuar legacy, NO duplicar" (CLAUDE.md §Adecuar legacy) no se aplicó al migrar la programación quirúrgica a NTEC — se construyó un bridge nuevo (`bridge-cirugia.router.ts`) en vez de extender `surgery.router.ts` con los campos NTEC faltantes | Es el mismo patrón de riesgo que ya causó la eliminación de `/ece/triaje` en PR #101 — no se aplicó la lección a quirófano | Aplicar la consolidación ya documentada como pendiente en `docs/flujos/ACT_QX.md:227-236`/`PROG_QX.md:163-168`: fusionar el bridge dentro de `surgery.router.ts` (single source of truth para reserva+cargo+conflicto), o al menos hacer que `programarCirugia` escriba también en `SurgeryCase` |
| Consentimiento no verificado antes de firmar acto quirúrgico (B8) | `assertDependenciasFirmadas` (el helper de enforcement de dependencias del motor de workflow NTEC, ya construido y usado en 3 routers) no se extendió a los routers quirúrgicos al crearlos | Gap de cobertura de un mecanismo ya existente, no de diseño | Cablear `assertDependenciasFirmadas` en `eceActoQuirurgico.firmar` exigiendo `CONS_QX`/`CONS_INF` en estado firmado antes de permitir la firma del acta |
| Sin SLA watchdog para Manchester (B13) | Existe el patrón exacto y probado para Morse (`120_morse_sla_watchdog.sql`, pg_cron) pero no se replicó para triage al construir el dashboard — el dashboard resolvió la necesidad visual (pull) y se dio por cerrada la funcionalidad sin cubrir el caso push/alerta | Riesgo de que se repita en cualquier escala clínica futura si no se generaliza el patrón | Generalizar `120_morse_sla_watchdog.sql` a un watchdog parametrizable por tipo de escala (Morse, Manchester, PREVENT, etc.) en vez de un SQL dedicado por escala |

---

## 6. Backlog P0/P1/P2 con criterio de aceptación verificable

### P0 — Bloquean Go-Live / riesgo financiero o clínico directo

| ID | Título | Módulo | Criterio de aceptación (verificable) |
|---|---|---|---|
| P0-1 | Cablear `withTenantContext` real en `encounter.router.ts` (`admit`, `list`, `listOpenByOrg`, `getCensus`) | Admisión/Censo | Las 4 procedures ejecutan dentro de `withTenantContext(...)`; test de integración con rol `authenticated` (no BYPASSRLS) confirma que un usuario de la organización B no puede leer/admitir encuentros de la organización A |
| P0-2 | Eliminar el stub `withWorkflowContext` y migrar los 6 routers ECE a `withEceContext` | Transversal/Hospitalización | `packages/trpc/src/ece/workflow-context.ts` ya no existe o lanza error si se importa; los 6 routers (`episodio-hospitalario`, `acto-quirurgico`, `episodio`, `cama`, `workflow-tipoDoc`, `workflow-tipoDoc-override`) usan `withEceContext`; test RLS confirma aislamiento tenant real |
| P0-3 | Cubrir el gate de egreso físico en `inpatient.discharge` | Hospitalización | `inpatient.router.ts:discharge` invoca `assertEgresoFisicoAutorizado` antes de `releaseActiveBeds`; test: alta con `PatientAccount` activa sin `egresoAutorizadoAt` lanza `PRECONDITION_FAILED` por esta ruta igual que por `bed.release` |
| P0-4 | Unificar cargo C3-2 entre vía legacy y vía NTEC de quirófano | Quirófano | `programarCirugia` (bridge NTEC) crea/actualiza el `SurgeryCase` correspondiente y dispara `capturarCargo` igual que `case.create`; test: reservar por la vía NTEC genera un cargo `USO_INSTALACIONES` verificable en la cuenta del paciente |
| P0-5 | Unificar/cruzar detección de conflicto de quirófano entre vías | Quirófano | Existe un único origen de verdad de disponibilidad de sala (o ambas vías consultan la misma tabla); test: reservar la misma sala/horario por vía A y luego por vía B (o viceversa) retorna `CONFLICT` |
| P0-6 | Exigir consentimiento firmado antes de permitir firma de acta quirúrgica | Quirófano | `eceActoQuirurgico.firmar` invoca `assertDependenciasFirmadas` (o equivalente) validando `CONS_QX`/`CONS_INF` en estado `firmado`; test: intentar firmar sin consentimiento retorna `PRECONDITION_FAILED` con `cause.dependenciasFaltantes` |
| P0-7 | Implementar watchdog de SLA de espera Manchester | Emergencia/Triage | Job (pg_cron o equivalente) que evalúa `TriageEvaluation` abiertas contra `TriageLevel.maxWaitMinutes`; al 80% emite `emitDomainEvent('triaje.sla_warning')`, al 100% `emitDomainEvent('triaje.sla_excedido')`; ambos con `case` en `dispatcher.ts` resolviendo destinatario (médico de turno / jefe de turno) |
| P0-8 | `requireRole` en mutations financieras/clínicas críticas sin protección (`patient.create`, `patientAccount.crear`, `bed.assignToEncounter`, `encounter.admit`, `encounterDischarge.dischargeEncounter`, `surgery.router.ts` completo) | Admisión/Censo/Quirófano | Cada mutation listada exige un rol explícito acorde al RACI definido en §3 (ej. admisión → `ADM`/`ADMISSION_CLERK` unificado; alta médica → `PHYSICIAN`; reserva de quirófano → `PHYSICIAN`/`ADM`); test por mutation confirma `FORBIDDEN` para un rol no autorizado |
| P0-9 | Extender el switch de `dispatcher.ts` con los eventos de los 4 módulos auditados | Transversal | `dispatcher.ts` resuelve destinatario para al menos: `ece.admision.completada`, `triaje.sla_excedido`, `ece.acto_quirurgico.firmado`, alta médica Fase 1 (nuevo evento a crear), CXC creada (nuevo evento a crear); test de integración confirma fila `Notification` creada para cada uno |

### P1 — Riesgo de gobierno/cumplimiento, no bloquea Go-Live pero requiere plan

| ID | Título | Módulo | Criterio de aceptación |
|---|---|---|---|
| P1-1 | Unificar nomenclatura de rol admisionista (`ADM`/`ADMISION`/`ADMISSION_CLERK`) con alias explícito | Admisión/Transversal | `RoleCodeAlias` incluye el mapeo completo; auditoría de `requireRole` en los 3 módulos confirma que un usuario con `ADMISSION_CLERK` puede ejecutar todos los pasos operativos de admisión |
| P1-2 | Validar identidad del fiador en CXC contra documento oficial (DUI/NIT/NIE) | Hospitalización | `firmanteDocumento` pasa por `validateDUI`/`validateNIT`/`validateNIE` según `firmanteTipo`; rechaza formato inválido con mensaje claro |
| P1-3 | Filtrar `CoverageLetter` por vigencia en `computeLiquidacion` | Hospitalización | Se agrega campo de vigencia/estado a `CoverageLetter`; `computeLiquidacion` excluye cartas vencidas/revocadas; test con carta vencida confirma que no se computa |
| P1-4 | Rama especial para alta voluntaria/AMA/fuga (`ABSCONDED`) con resolución forzosa o timeout | Hospitalización | Cuentas con `dischargeType IN (VOLUNTARY, AGAINST_MEDICAL_ADVICE, ABSCONDED)` generan alerta a Cobros a las N horas si no se completó Fase 2; documento de política de recuperación de cartera define el tratamiento |
| P1-5 | Precondición de cobertura vigente (o excepción explícita) al abrir cuenta de paciente | Admisión | `patientAccount.crear` invoca `resolverCobertura` y persiste el resultado (aunque sea informativo); si no hay cobertura y no es autopago declarado, requiere confirmación explícita de "sin cobertura" en el payload |
| P1-6 | Validación de responsable/mayoría de edad en registro de paciente | Admisión | `patient.create` valida edad vs. presencia de campo `responsable`; si el paciente es menor y no hay responsable, retorna error de validación (no un catch silencioso) |
| P1-7 | Cerrar la race condition TOCTOU en `programarCirugia` | Quirófano | Verificación de solapamiento se mueve dentro de la transacción o usa `pg_advisory_xact_lock`; test de concurrencia (2 reservas simultáneas a la misma sala/horario) confirma que solo una tiene éxito |
| P1-8 | Diseñar mecanismo de suplencia/delegación de rol | Transversal (los 4 módulos) | Modelo `RoleDelegation`/equivalente con vigencia, aprobación y auditoría; al menos los pasos P0-8 tienen ruta de suplencia documentada y probada (ej. ADMIN ausente → DIR puede actuar con auditoría explícita, no vía "cualquiera con el rol") |
| P1-9 | Segregar funciones en el ciclo CXC (crear vs. cobrar) | Hospitalización | `registrarAbono` exige un rol o segunda aprobación distinta de quien ejecutó `altaAdministrativa` para la misma cuenta, o al menos queda auditado con alerta si coincide el mismo usuario |

### P2 — Deuda técnica / mejora, sin riesgo inmediato

| ID | Título | Módulo | Criterio de aceptación |
|---|---|---|---|
| P2-1 | Flujo para marcar `AccountReceivable.estado = INCOBRABLE` | Hospitalización | Nueva mutation `accountReceivable.marcarIncobrable` con `requireRole(["ADMIN"])` + justificación obligatoria |
| P2-2 | Mutation para asignar `operatingRoomId` a un caso quirúrgico creado sin sala | Quirófano | `surgery.router.ts` expone `case.assignRoom`; dispara `capturarCargo`/`detectOrConflict` igual que en creación |
| P2-3 | Alertar automáticamente al vencer `plazoDias` de una CXC | Hospitalización | Job diario evalúa `AccountReceivable.plazoDias` vencidos; emite evento con case en dispatcher hacia Cobros |
| P2-4 | Corregir comentario desactualizado de `Room.chargeCode` en schema.prisma | Hospitalización (documental) | Comentario del modelo refleja que SÍ está cableado a charge-capture (4 routers lo consumen) |
| P2-5 | Bloqueo/alerta cuando un triage `COMPLETED` no tiene documento ECE vinculado tras N horas | Emergencia/Triage | Extensión del watchdog P0-7 (o job separado) que detecta triages sin `ece.hoja_triaje` vinculada y alerta a Archivo Clínico |
| P2-6 | Firma/registro individualizado de instrumentista y circulante en acta quirúrgica | Quirófano | Campo estructurado (no JSONB libre) con referencia a usuario/rol por cada asistente, consistente con Art. 39-40 NTEC |

---

## 7. Supuestos

- `[NO VERIFICADO — supuesto]` No se confirmó contra la BD real de Supabase si los catálogos `ece.tipo_documento` para `CONS_QX` y `PROG_QX` están sembrados en producción — depende de `mcp__supabase__list_tables`/`execute_sql`, fuera del alcance de solo-lectura de código de esta auditoría.
- `[NO VERIFICADO — supuesto]` No se confirmó el comportamiento RLS **en runtime** (con rol `authenticated` real) para los routers marcados como bypass — el hallazgo se basa en ausencia de `withTenantContext`/`withEceContext` en el código, no en una prueba de penetración contra la BD.
- `[NO VERIFICADO — supuesto]` El conteo agregado "98/159 routers usan `withTenantContext`, 61/159 no" es orientativo (grep de superficie), no una auditoría exhaustiva línea por línea de los 152 routers — se reporta como contexto, no como hallazgo cerrado.
- `[NO VERIFICADO — supuesto]` La entrega real de notificaciones vía la Edge Function externa `notifications-dispatch` (referenciada en `044_notifications_outbox_poller.sql`) no fue auditada — está fuera del repo de código fuente revisado.
- Se asume que las decisiones de negocio ya cerradas y documentadas en memoria del proyecto (C3-2 estancia=asignación/quirófano=reserva; CC-0027 alta en 2 fases) siguen vigentes tal como se implementaron — esta auditoría no las cuestiona, solo verifica su cobertura de excepción, rol y notificación.
- Los routers `operating-cost.router.ts` (costos operativos del HIS, no quirúrgicos) y `bedside-stat.router.ts` (STAT de medicación, no de triage) se descartaron del alcance tras verificar su dominio real — se documenta para que no se reintroduzcan por error en futuras iteraciones de este reporte.

---

## Resumen ejecutivo (para @Orq / CIO-CTO)

Los cuatro módulos comparten dos fallas estructurales: (1) el motor de notificaciones existe pero está desconectado en ambos extremos — ningún evento de Admisión, Triage, Censo/Alta o Quirófano llega hoy a un destinatario real; (2) la mayoría de las mutations que mueven al paciente o disparan un cargo financiero no exige ningún rol. A esto se suman brechas específicas de alto impacto: RLS bypass confirmado en el router que admite pacientes y en 6 routers ECE (incluye el episodio hospitalario); el gate de egreso físico de CC-0027 es evitable por una ruta paralela de alta (`inpatient.discharge`); el bloque quirúrgico opera con dos vías no sincronizadas donde la vía "oficial" NTEC no genera el cargo de reserva de quirófano (C3-2) ni comparte la detección de doble-booking con la vía legacy; y la firma del acta quirúrgica no verifica que exista consentimiento informado firmado. Triage Manchester no tiene ningún mecanismo de alerta activa por SLA de espera excedido, pese a existir ya el patrón equivalente para la escala Morse. El detalle completo, con evidencia archivo:línea, está en `docs/audit/2026-09-15_cobertura/01-admision-emergencia-hosp-quirofano.md`.
