# Auditoría de Cobertura — Historia Clínica/ECE, Farmacia, Laboratorio, Imágenes

**Fecha:** 2026-09-15
**Autor:** @AE (Arquitecto Empresarial) — Unidad de Transformación Digital, Inversiones Avante
**Alcance del método:** auditoría estática de código (solo lectura), repo `C:\proyecto\HIS`, rama `feat/cc-0030-entrega-parcial` (HEAD `128138f`, CC-0030 R6). NO se ejecutó código, NO se modificó nada, NO se tocó la BD de producción.
**Regla de evidencia:** toda brecha cita ruta de archivo y línea. Se distingue explícitamente **AUSENTE** (no existe en código) / **INCOMPLETO** (existe pero falta una pieza) / **NO CABLEADO** (la lógica existe pero ningún caller real la invoca, verificado con grep de callers en `apps/web/src`). Lo no verificable se marca `[NO VERIFICADO — supuesto]`.
**Continuación de:** `docs/audit/2026-09-15_cobertura/01-admision-emergencia-hosp-quirofano.md` (mismo método; los hallazgos transversales de RLS/rol/notificación de ese informe se dan por conocidos y se referencian, no se repiten salvo cuando este informe agrega evidencia nueva).

---

## 1. Resumen del alcance

### 1.1 Módulos auditados y superficie de código revisada

| Módulo | Archivos clave revisados |
|---|---|
| **Historia Clínica / ECE (motor de workflow)** | `packages/trpc/src/ece/dependencias-enforcement.ts`, `ece/workflow-context.ts`, `workflow/context.ts`, routers `ece/historia-clinica`, `episodio`, `episodio-hospitalario`, `hoja-ingreso`, `critical-result`, `solicitud-estudio`, `resultado-estudio`, `indicaciones-medicas`, `verbal-order`, `consentimiento`, `certificado-defuncion`, `certificacion`, `certificado-incapacidad`, `bitacora`, `comite-ece`, `contingencia`, `epicrisis`, `rri`, `fall-event`, `retencion`, `ece-rectificacion.router.ts`; SQL `44`, `99`, `101`, `113`, `114`; `docs/flujos/*.md` (muestreo) |
| **Farmacia** | `pharmacy.router.ts`, `pharmacy/dispensation.router.ts` (1742 líneas, incluye CC-0030), `conciliacion-cargos.router.ts`, `farmacovigilancia.router.ts`, `bedside.router.ts` (sub-router `administration`), `ece/indicaciones-medicas.router.ts`; SQL `44`, `89`/`89a`; `docs/qa/drhis/RN-HIS-BOT-001-reverificacion-post-remediacion.md` |
| **Laboratorio** | `lis.router.ts` (1872 líneas, legacy), `ece/solicitud-estudio.router.ts`, `ece/resultado-estudio.router.ts`, `ece/critical-result.router.ts`; `schema.prisma` (`LabReferenceRange`, `LabReflexRule`); `apps/web/.../lis/results/page.tsx`; `docs/flujos/RES_EST.md` |
| **Imágenes** | `imaging-request.router.ts` (CC-0016), `imaging.router.ts` (§18 RIS legacy); `schema.prisma` (`ImagingReport`, `ImagingOrder`, `ImagingModality`); `workflow-inbox.router.ts`; SQL `16`, `33`; componentes `apps/web/.../imaging/_components/*` |
| **Transversal (notificaciones)** | `packages/infrastructure/src/notifications/dispatcher.ts`, `supabase/functions/notifications-dispatch/index.ts`, `packages/database/sql/44_notifications_outbox_poller.sql`, `packages/contracts/src/events/catalog.ts` / `payloads.ts` |

### 1.2 Hallazgo transversal que condiciona TODO el reporte — precisión adicional sobre el informe 01

El informe 01 ya estableció que `dispatchDomainEvent` (`packages/infrastructure/src/notifications/dispatcher.ts:537`) no tiene invocadores de producción. Esta auditoría confirma ese hallazgo de forma independiente en los 4 módulos y **agrega un dato que cambia la severidad real del gap**: existen **dos implementaciones distintas del dispatcher**, no una:

1. **`packages/infrastructure/src/notifications/dispatcher.ts`** (Node) — switch de 12 `eventType` (líneas 131-167: `vital.critical`, `lab.criticalValue`, `drug.interaction`, `allergy.mismatch`, `transfusion.crossmatchFailed`, `transfusion.adverseReaction`, `pathology.reportSigned`, `pathology.criticalFinding`, `accounting.periodClosed`, `accounting.journalPostedHighValue`, `security.breakGlass.activated`, `ece.rectificacion.aprobada/rechazada`). **Confirmado: cero callers en todo el repo fuera de sus propios tests** (`packages/infrastructure/src/notifications/index.ts:10` solo re-exporta). Es código muerto en producción.
2. **`supabase/functions/notifications-dispatch/index.ts`** — el dispatcher que **sí corre**: invocado cada minuto por `pg_cron` vía `notifications.process_outbox_batch(50)` → `net.http_post` (`packages/database/sql/44_notifications_outbox_poller.sql:157,184-187`, comentario propio: "Invocada por pg_cron cada minuto"). Su función `resolveRecipient` (`supabase/functions/notifications-dispatch/index.ts:112-149`) implementa **solo 4 de esos 12 casos**: `vital.critical`, `lab.criticalValue`, `drug.interaction`, `allergy.mismatch` — verificado línea por línea, `default: return null`.

**Consecuencia (verificada, no supuesta):** los 8 `eventType` restantes que el informe 01 reportó como "resueltos por el dispatcher" (`transfusion.*`, `pathology.*`, `accounting.*`, `security.breakGlass.activated`, `ece.rectificacion.*`) **tampoco entregan notificación real hoy**, porque solo están implementados en el archivo Node huérfano (#1), no en el Edge Function que efectivamente ejecuta pg_cron (#2). El alcance real de notificaciones funcionando end-to-end en **todo el HIS**, no solo en los módulos de este informe, es de **4 `eventType`** — todos ellos verificados aquí porque 3 de los 4 (`lab.criticalValue`, `drug.interaction`, `allergy.mismatch`) pertenecen a Farmacia/Laboratorio. Esto eleva la severidad de P0-9 del informe 01: no es "extender el switch", es "el switch que importa (el del Edge Function) nunca se sincronizó con el catálogo de eventos ni con el dispatcher Node que sí lo intenta cubrir".

### 1.3 Limitaciones del método

- No se verificó el comportamiento RLS en runtime (rol `authenticated` real) — solo ausencia/presencia de `withTenantContext`/`withEceContext`/`withWorkflowContext` en código.
- No se verificó si SQL `114_critical_result_notification.sql`/`120_morse_sla_watchdog.sql` están aplicados en Supabase producción — inferido de nombre de archivo y comentarios en `critical-result.router.ts`, no confirmado con `mcp__supabase__list_migrations`.
- No se auditó exhaustivamente `packages/contracts/src/events/payloads.ts` completo (grep dirigido, no lectura línea por línea).
- Cuántos usuarios reales tienen cada rol asignado (DIR, PHARM, LAB, RAD) es `[NO VERIFICADO — supuesto]` en todos los casos — depende de datos de producción, no de código.

---

## 2. Matriz de Brechas Ocultas

| # | Módulo | Worst path / excepción | Qué protege hoy el sistema (evidencia) | Clasificación | Severidad |
|---|---|---|---|---|---|
| B18 | HC/ECE | `withWorkflowContext` (`packages/trpc/src/ece/workflow-context.ts:16-23`) es el **stub** ya reportado como P0-2 en el informe 01 — se confirma aquí que **también lo importa `episodio.router.ts:48`** (no solo `episodio-hospitalario`), es decir HC/ECE tiene el mismo RLS bypass que Hospitalización/Censo, por ser el mismo documento clínico visto desde otro módulo | Ninguna — mismo hallazgo, misma causa raíz que P0-2 del informe 01, aún no remediado a la fecha de este informe | **Confirmación cruzada de P0-2 (informe 01)** | **P0** |
| B19 | HC/ECE | Enforcement de dependencias firmadas (Art. 40 / motor NTEC) es reactivo, no proactivo: el helper `assertDependenciasFirmadas` (`packages/trpc/src/ece/dependencias-enforcement.ts:164-175`) solo tiene 3 callers en 30 routers (`certificado-incapacidad.router.ts:312`, `orden-ingreso.router.ts:443`, `workflow-instance.router.ts:191`) — los ~27 restantes dependen exclusivamente del trigger SQL `ece.fn_assert_dependencias_firmadas`, que bloquea pero **no traduce a `PRECONDITION_FAILED` con `cause.dependenciasFaltantes`** (excepción Postgres cruda → `INTERNAL_SERVER_ERROR` en el cliente) | Bloqueo real a nivel BD (dato no se pierde), pero UX de error rota y sin aviso proactivo al firmante pendiente | **Incompleto** | **P1** |
| B20 | HC/ECE | `critical-result.router.ts` — el sistema completo de valor crítico con SLA 60 min + read-back PIN + escalación (`emit`/`confirmReadback`, `requireRole` correctos) **nunca se invoca desde el flujo real de resultados**: el propio archivo documenta "*El wiring LIS→emit se completa en sprint posterior*" (`critical-result.router.ts:10-12`) y el PIN de `confirmReadback` es "*verificación dummy segura*", no argon2id real (`:26-30`) | Nada — construido y sin conectar; ver también B24 (Laboratorio) que confirma el mismo gap desde el lado LIS | **No cableado** | **P0** |
| B21 | HC/ECE | Orden verbal (`verbal-order.router.ts`) sin ventana de tiempo/deadline para co-firma (JCI IPSG.2 típicamente exige confirmación en plazo acotado) — grep de `expira\|window\|deadline\|24h\|plazo\|vencid\|SLA` sin resultados en el router ni en SQL `113_verbal_order.sql` | Ninguna | **Ausente** | **P1** |
| B22 | HC/ECE | Ningún evento del motor de workflow ECE (`ece.*.firmado/validado/certificado/anulado`, ~15 eventTypes emitidos por routers como `certificacion.router.ts:297-298`, `resultado-estudio.router.ts:327-328`, `fall-event.router.ts:252-253`, `verbal-order.router.ts:383-384`) está entre los 4 casos reales del dispatcher (§1.2) — se emiten, se guardan en el outbox, y se descartan silenciosamente cada minuto | Ninguna — auditoría/trazabilidad del `DomainEvent` sí queda (hash chain), pero cero notificación | **Ausente (aplicando §1.2)** | **P0** |
| B23 | Farmacia | Caducidad de reserva de botiquín (4h): `expire_pharmacy_reservations()` (pg_cron cada 5 min, `packages/database/sql/89_pharmacy_reservation_expire_cron.sql:132-177`) solo cambia `status→EXPIRED` — **no repone `StockLot.quantityOnHand` ni reversa el cargo `VIGENTE`**, a diferencia de `cancelReservation`/`returnItem` que sí hacen ambas cosas | Ninguna — inventario queda descontado y cargo activo sin que nadie lo vea, porque la vista de conciliación excluye `status IN ('CANCELLED','EXPIRED')` (`conciliacion-cargos.router.ts:19-23,154,423`) | **Incompleto** | **P0** |
| B24 | Farmacia | El cron de expiración inserta en `public."NotificationOutbox"` (tabla Beta.15, **superada** por `DomainEvent`/`Notification`, `sql/89:150-170`) — grep exhaustivo confirma **cero consumidores** de esa tabla en todo el repo | Ninguna — fila muerta, nadie la lee nunca | **Ausente (vía muerta)** | **P1** |
| B25 | Farmacia | `pharmacy.router.ts prescription.create`/`prescription.sign` (líneas 252-385) corren en `tenantProcedure` sin `requireRole` — cualquier usuario tenant puede crear y firmar una receta, mientras el equivalente NTEC (`ece/indicaciones-medicas.router.ts:546-549`) sí exige `requireRole(["PHYSICIAN","MC"])`. La UI real de farmacia (`apps/web/.../pharmacy/new/page.tsx`) llama al router sin rol, no al ECE | Ninguna a nivel servidor — solo lo que oculte el front-end | **Ausente** | **P0** |
| B26 | Farmacia | `bedside.router.ts administrationRouter.record` (BCMA, acto clínico de administración real, líneas 347-403) corre en `tenantProcedure` sin `requireRole` (debería exigir NURSE como mínimo) | Solo el hard stop de conciliación (`:385-403`, exige vínculo con dispensación conciliada) — no protege el "quién" | **Ausente** | **P0** |
| B27 | Laboratorio | Dos sistemas paralelos de laboratorio: `lis.router.ts` (legacy, cableado a `/lis/orders`/`/lis/results`) vs. motor ECE (`solicitud-estudio`, `resultado-estudio`, `critical-result`) montado en `_app.ts:330-331,432` pero con **cero callers en `apps/web/src`** confirmado por grep exhaustivo | Ninguna — el diseño correcto (roles, SLA, read-back) vive en el sistema que nadie usa | **No cableado** | **P0** |
| B28 | Laboratorio | `lis.router.ts order.create/:941`, `specimen.collect/:1355`, `specimen.reject/:1464`, `result.enter/:1490` — todos `tenantProcedure` sin `requireRole`; `result.validate/:1615` solo exige `resultedById !== ctx.user.id` (segregación por **identidad**, no por **rol clínico**) — dos cuentas cualesquiera (no necesariamente técnico+bioquímico) bastan para capturar y validar | Ninguna a nivel rol — solo el único `requireRole(["ADMIN","DIR"])` del router protege el catálogo (`:71`), no el flujo clínico | **Ausente** | **P0** |
| B29 | Laboratorio | Flag automático de resultado crítico en `result.enter` (`lis.router.ts:1534-1544,1794-1831`) **no consulta `LabReferenceRange`** (modelo existente, `schema.prisma:2770-2790`, usado solo en `portal.router.ts:834` para display al paciente): construye rango sintético desde campos planos `LabTest.refRangeLow/High` y aplica **heurística ±50%** para el límite crítico, documentada en el propio código como "Wave 1... Wave 2 lab define" y nunca cerrada | Ninguna estratificación real por edad/sexo influye en el flag clínico | **Incompleto** | **P1** |
| B30 | Laboratorio | `LabReflexRule` (modelo `schema.prisma`, creado por SQL `27_lis_hardening_v2.sql`) **sin ninguna lógica de negocio** — grep en todo `packages/trpc/src` no encuentra uso fuera del schema/SQL. Reglas reflex modeladas en BD pero el motor que las ejecutaría no existe | Ninguna | **Ausente** | **P2** |
| B31 | Laboratorio | Documento NTEC `RES_EST` (resultado de estudio) **no está sembrado en `ece.tipo_documento`** — confirmado por el propio `docs/flujos/RES_EST.md:50,75`. El motor de workflow genérico (dependencias, `flujo_estado`) no gobierna resultados de laboratorio aunque el router `resultado-estudio.router.ts` exista | Ninguna | **Ausente** | **P1** |
| B32 | Imágenes | `imaging.router.ts` — el ciclo completo posterior a la solicitud (`order.updateStatus` programar/realizar, `report.create` dictar, `report.sign` firmar, `report.validate` validar) **existe en backend con tests, pero cero callers en `apps/web/src`** salvo lectura (`order.get`) y un dropdown admin (`modality.list`). El propio `imaging-request.router.ts:1-15` documenta que `imaging.router.ts` "sigue siendo la fuente de verdad" para esos pasos — deuda reconocida, no descubrimiento nuevo, pero bloqueante para el ciclo clínico completo | Trigger de inmutabilidad SÍ existe en BD (`sql/33_imaging_hardening.sql:211-249`) pero nunca se dispara en uso real porque nadie llama `report.validate` | **No cableado** | **P0** |
| B33 | Imágenes | El informe SÍ viaja al frontend (`imaging-request.router.ts:395-414` `detalle` incluye `report`) pero la UI **no lo renderiza**: `solicitudes-listado.tsx:146-165` `DetalleSolicitudDialog` solo pinta `studyDescription/modalityType/status`, nunca `report.findings/impression/recommendation` | Ninguna — dato disponible, invisible para el médico tratante | **No cableado (brecha de UI, no de backend)** | **P0** |
| B34 | Imágenes | No existe el concepto de "hallazgo crítico" en absoluto: `ImagingReport` (`schema.prisma:3515-3534`) y `imagingReportCreateInput` (`packages/contracts/src/schemas/imaging.ts:136-141`) no tienen campo de criticidad — contraste directo con laboratorio, que sí lo modela (`lis.router.ts:1553,1569-1584`) | Ninguna | **Ausente** | **P0** |
| B35 | Imágenes | `imaging.report.create/sign/validate` (líneas 270-396) todos `tenantProcedure` sin `requireRole` — `radiologistId: ctx.user.id` se asigna a cualquier usuario tenant sin verificar rol RADIOLOGO; sin segregación entre quien firma y quien valida (mismo usuario puede hacer ambas). El seed base de `Role` (`packages/database/prisma/seed.ts:355-362`) ni siquiera incluye un rol de radiólogo/técnico de imágenes — `[NO VERIFICADO — supuesto]` si existe en RBAC de producción (CC-0017) fuera de ese archivo | Ninguna a nivel rol; RLS de BD (`sql/16_imaging_rls.sql:18-49`) solo distingue tenant/establecimiento, no rol | **Ausente** | **P0** |

---

## 3. Matriz RACI y Brechas de Rol

### 3.1 Historia Clínica / ECE

| Etapa | Ejecuta (rol real) | Valida | Autoriza/Certifica | Observación de segregación |
|---|---|---|---|---|
| Historia clínica — crear/firmar (`historia-clinica.router.ts:534-537,756`) | PHYSICIAN/MC/MT/DIR crea; PHYSICIAN/MC firma | DIR (`:969,1100`) | — | Crear y firmar comparten pool — normal para nota de autor único |
| Hoja de ingreso (`hoja-ingreso.router.ts:48-52`) | ADM crea | ADM firma (mismo rol) | ARCH valida, DIR anula | **Mismo rol crea Y firma** — sin verificación de un tercero |
| Solicitud de estudio (`solicitud-estudio.router.ts:48-52`) | MC/ESP crea/firma/valida (`validar`), MC/ESP/DIR anula | Mismo pool MC/ESP | — | Sin segregación entre quien solicita y quien valida |
| Resultado de estudio (`resultado-estudio.router.ts:44-46`) | TEC/PROF_DX/MC/ESP registra | **MC/ESP valida** (`validarResultado`) | — | **Correcto** — segregación real entre captura y validación |
| Valor crítico (`critical-result.router.ts:44-47`) | LAB/RAD/ADMIN emite | MC/ESP/PHYSICIAN confirma read-back | — | Diseño de rol correcto, pero ver B20 (no cableado) |
| Orden verbal (`verbal-order.router.ts:19-21`) | NURSE/ENF registra | MC/ESP confirma read-back | — | Correcto |
| Consentimiento (`consentimiento.router.ts:51-55`) | MC/PHYSICIAN crea/firma; `firmarPaciente` vía `eceReaderProc` (MC,ESP,ENF,DIR,ARCH) | DIR valida | — | Rango amplio para tomar firma del paciente — razonable operativamente |
| Certificado de defunción (`certificado-defuncion.router.ts:60-65,280,760`) | MC/PHYSICIAN crea/firma/valida | Mismo pool | **DIR certifica/anula** | Certificar tiene buen punto de control (DIR), pero crear/firmar/validar sin segregación entre sí |
| Certificación NTEC genérica (`certificacion.router.ts:45-47`) | — | — | **Solo DIR** (`listCola`, `certificar`, `certificarBulk`) | **Punto único humano** — todo el catálogo de certificación final depende de 1 rol; `[NO VERIFICADO]` cuántos usuarios DIR activos hay por turno |
| Bitácora (`bitacora.router.ts:46-49`) | Cualquier `protectedProcedure` registra (sin rol) | DIR/ARCH consulta/exporta | — | Correcto por diseño (log de auditoría debe aceptar cualquier actor) |
| Comité ECE (`comite-ece.router.ts:29-35`) | DIR/ADMIN crea/actualiza | — | DIR firma | Firma bien segregada |
| Contingencia (`contingencia.router.ts:9-13`) | **Un solo ADM o DIR activa/desactiva unilateralmente** | — | — | Sin doble aprobación para activar modo contingencia (impacta continuidad de todo el hospital) |
| Epicrisis (`epicrisis.router.ts:26-31`) | MC/PHYSICIAN crea/firma | **ESP valida** (especialista distinto) | DIR anula/certifica | **Correcto** — buena segregación |
| RRI/interconsulta (`rri.router.ts:67-71`) | MC/PHYSICIAN solicita/firma | **IC/PHYSICIAN responde** (interconsultante) | DIR | **Correcto** |
| Indicaciones médicas (`indicaciones-medicas.router.ts`) | PHYSICIAN/MC indica | **NURSE/ENF administra** | — | **Correcto** |

**Gaps de rol — HC/ECE:** (1) hoja de ingreso y solicitud de estudio sin segregación crear≠firmar/validar; (2) certificación NTEC es punto único humano (solo DIR); (3) contingencia activable unilateralmente sin doble aprobación pese a su impacto institucional; (4) el diseño correcto de segregación captura≠validación (resultado-estudio, epicrisis, RRI, indicaciones) demuestra que el patrón se conoce — su ausencia en otros routers es inconsistencia, no desconocimiento.

### 3.2 Farmacia

| Etapa | Procedure | Rol exigido | Observación |
|---|---|---|---|
| Prescribir (`prescription.create`) | `pharmacy.router.ts:252-277` | **Ninguno** (`tenantProcedure`) | Contraste directo con `ece/indicaciones-medicas.router.ts:546-549` (`PHYSICIAN,MC`) |
| Firmar receta (`prescription.sign`) | `pharmacy.router.ts:286-385` | **Ninguno** | Igual que arriba |
| Dispensar/reservar (`scanItem`/`reserveItem`) | `dispensation.router.ts` | `requireRole(["PHARM","ADMIN"])` + `abacGuard("dispensation","dispense")` | **Correcto** — cerrado en remediación Ola 4b |
| Segregación prescriptor≠dispensador | `dispensation.router.ts:755-760,1088-1093` | Chequeo por identidad (`prescriberId===actorId→FORBIDDEN`) | **Correcto**, sin bypass STAT (confirmado: grep de "STAT" en `pharmacy/` sin resultados, a diferencia de `bedside-stat.router.ts`) |
| Administrar — BCMA (`administrationRouter.record`) | `bedside.router.ts:347-403` | **Ninguno** (`tenantProcedure`) | Debería exigir NURSE como mínimo — el acto clínico real de administración no tiene control de rol servidor |
| Testigo de controlados | `enforceControlledWitness` | Cualquier usuario con `ece.firma_electronica`/PIN, distinto de dispensador y prescriptor | No restringido a rol clínico específico (p. ej. otro farmacéutico) — no necesariamente defecto, pero no documentado como decisión |
| Recibir devolución (`returnItem`) | `requireRole(["PHARM","ADMIN"])` (mismo pool que dispensa) | Sin segregación entre quien dispensó y quien recibe devolución | Mismo actor puede hacer ambas |

**Punto único humano / gap de rol — Farmacia:** con prescripción y BCMA sin `requireRole`, el único control real del ciclo clínico completo es el front-end (qué botón se muestra). Dispensación/devolución sí están correctamente cerradas a nivel servidor — la brecha está en los extremos del ciclo (inicio y fin clínico), no en el centro (farmacéutico).

### 3.3 Laboratorio

| Acción | Procedure real | Rol exigido |
|---|---|---|
| `order.create`, `specimen.collect`, `specimen.reject`, `result.enter` (legacy, en uso) | `lis.router.ts:941,1355,1464,1490` | **Ninguno** |
| `result.validate` (legacy, en uso) | `lis.router.ts:1615` | **Ninguno** — solo `resultedById !== ctx.user.id` (identidad, no rol) |
| CRUD catálogo | `lis.router.ts:71 catalogAdminProc` | `requireRole(["ADMIN","DIR"])` — único punto protegido del router legacy |
| `solicitud-estudio.create/firmar/validar` (ECE, sin UI) | `:49-50` | `requireRole(["MC","ESP"])` |
| `resultado-estudio.registrar` (ECE, sin UI) | `:192` | `requireRole(["TEC","PROF_DX","MC","ESP"])` |
| `resultado-estudio.validarResultado` (ECE, sin UI) | `:193` | `requireRole(["MC","ESP"])` |
| `critical-result.emit`/`confirmReadback` (ECE, sin UI) | `:222-223` | `requireRole(["LAB","RAD","ADMIN"])` / `requireRole(["MC","ESP","PHYSICIAN"])` |

**Gap de rol — Laboratorio:** el patrón correcto (técnico captura / médico certificador valida, con roles reales) **fue construido en el lugar equivocado** — vive en el sistema ECE sin UI, mientras el flujo real (`lis.router.ts`) que sí usan los usuarios no aplica ningún `requireRole` clínico. Punto único de riesgo: `result.validate` solo requiere dos cuentas distintas, no dos roles distintos — la segregación es cosmética.

### 3.4 Imágenes

| Procedure | Definición | Rol exigido |
|---|---|---|
| `imagingRequest.crear` | `imaging-request.router.ts:156` | **Ninguno** |
| `imaging.order.updateStatus`/`cancel` | `imaging.router.ts:147-190` | **Ninguno** |
| `imaging.report.create` (dictar) | `:270-272` | **Ninguno** — `radiologistId=ctx.user.id` sin verificación de rol |
| `imaging.report.sign` | `:330-332` | **Ninguno** — no valida que el firmante sea el mismo `radiologistId` |
| `imaging.report.validate` | `:361-363` | **Ninguno** — sin segregación firma≠validación, mismo usuario puede ambas |
| Parametrización de catálogo | `imaging-request.router.ts:45 catalogAdminProc` | `requireRole(["ADMIN","DIR"])` — único punto protegido |

**Gap de rol — Imágenes:** ningún paso del ciclo clínico (solicitar, realizar, dictar, firmar, validar) tiene control de rol servidor. RLS de BD (`sql/16_imaging_rls.sql:18-49`) tampoco distingue por rol. Mismo patrón estructural que Laboratorio (§3.3): solo el catálogo administrativo está protegido, el flujo clínico no. `[NO VERIFICADO — supuesto]` si existe rol RADIOLOGO/TECNICO_RX sembrado en RBAC de producción fuera del seed base revisado.

### 3.5 Catálogos de rol — nota de consistencia con informe 01

Se confirma en los 4 módulos el mismo hallazgo de gobierno ya documentado en el informe 01 §3.1: coexisten `public."Role".code`, `public."RoleCodeAlias"` y `ece.rol` sin mapeo completo. No se repite el detalle aquí; aplica igual a los roles `PHARM`, `LAB`, `RAD`, `TEC` usados en este informe.

---

## 4. Matriz de Notificaciones

Formato solicitado. Todo evento marcado **FALTANTE** se debe a una de tres causas, indicada explícitamente: **(a)** el router nunca emite el evento; **(b)** se emite pero el `eventType` no tiene `case` en `resolveRecipient` del Edge Function real (§1.2); **(c)** se emite hacia una tabla sin consumidor (`NotificationOutbox`).

| Módulo | Etapa | Evento disparador | Destinatario (rol) | Tipo | Canal propuesto | Momento | SLA | Escalamiento | Contenido mínimo | Trazabilidad |
|---|---|---|---|---|---|---|---|---|---|---|
| HC/ECE | Documento ECE firmado (cualquiera de ~15 tipos) | `ece.*.firmado` (emitido, ej. `hoja-ingreso.router.ts:627-628`, `solicitud-estudio.router.ts:495-496`) | Siguiente rol responsable en la cadena de dependencias | Informativa/Acción requerida | In-app | Al firmar | N/A | N/A | Documento, episodio, firmante | **FALTANTE — causa (b)** |
| HC/ECE | Documento pendiente de firma (dependencia bloqueada) | *(no existe evento — solo excepción síncrona)* | Firmante pendiente | Acción requerida | In-app | Al detectarse la dependencia faltante | 4h | Jefe de servicio | Documento origen, documento faltante, paciente | **FALTANTE — causa (a)** |
| HC/ECE | Resultado de estudio crítico (vía ECE, `critical-result.emit`) | `critical_result.emitted`/`sla_warning`/`sla_exceeded` (emitido, `critical-result.router.ts:287-288,375-376,525-526`) | MC/ESP/PHYSICIAN tratante | **Alerta crítica** | In-app prioritario | Al emitir | 60 min (diseñado) | Escalación diseñada en el router | Paciente, valor, unidad | **FALTANTE — causas (a, nunca se invoca desde LIS) y (b)** |
| HC/ECE | Caída de paciente (IPSG.6) | `ipsg6.fall_event_recorded` (emitido, `fall-event.router.ts:252-253`) | Enfermería jefe / médico tratante | Alerta | In-app | Al registrar | N/A | N/A | Paciente, hora, ubicación | **FALTANTE — causa (b)** |
| HC/ECE | Orden verbal — read-back confirmado | `jci.ipsg2.readback_recorded` (emitido, `verbal-order.router.ts:383-384`) | Médico que dictó | Informativa | In-app | Al confirmar | N/A | N/A | Orden, confirmante | **FALTANTE — causa (b)** |
| HC/ECE | Contingencia activada/desactivada | *(no existe evento)* | Todo el personal clínico del establecimiento | **Alerta crítica** | In-app + banner global | Al activar | Inmediato | Dirección médica | Establecimiento, motivo | **FALTANTE — causa (a)** |
| HC/ECE | Rectificación NTEC aprobada/rechazada (Art. 42) | `ece.rectificacion.*` (emitido, `ece-rectificacion.router.ts:464-466,524-526`) | Solicitante de la rectificación | Informativa | In-app | Al resolver | N/A | N/A | Documento, resolución | **FALTANTE en producción real — causa (b)**: único caso con `case` en el dispatcher Node huérfano, pero ese dispatcher no corre (§1.2) |
| Farmacia | Interacción medicamentosa mayor → prescriptor | `drug.interaction` (`pharmacy.router.ts:361-383`) | Médico prescriptor | **Alerta crítica** | In-app | Al firmar receta con alerta | N/A | N/A | Fármacos, severidad | **FUNCIONA end-to-end** — único caso verificado completo de todo este informe |
| Farmacia | Receta firmada → farmacia | *(no existe evento — solo `drug.interaction` si hay alerta)* | Farmacia (cola de dispensación) | Acción requerida | In-app | Al firmar | N/A | N/A | Receta, paciente, ítems | **FALTANTE — causa (a)** |
| Farmacia | Reserva creada/cancelada/devuelta | `pharmacy.reservation.*` (emitido, `dispensation.router.ts:1238,1371,1612`; schema en `payloads.ts:1567-1580`) | Enfermería / Farmacia | Informativa | In-app | Al crear/cancelar/devolver | N/A | N/A | Reserva, ítems, cantidad | **FALTANTE — causa (b)** |
| Farmacia | Reserva por expirar / expirada (4h) | Inserta en `NotificationOutbox` (`sql/89:150-170`) | Enfermería (para administrar a tiempo) / Farmacia (para liberar) | **Alerta** | In-app | Antes de expirar / al expirar | N/A | N/A | Reserva, paciente, ítems | **FALTANTE — causa (c)** |
| Farmacia | Vencimiento detectado en scan | `pharmacy.expired-attempt` (emitido, `dispensation.router.ts:791-802`) | Farmacia / Calidad | Alerta | In-app | Al intentar escanear vencido | N/A | N/A | Lote, fecha vencimiento | **FALTANTE — causa (a, ni está en el discriminated union de `payloads.ts`) y (b)** |
| Farmacia | Entrega parcial / pendiente (CC-0030) | *(solo campo calculado `pendiente` en query pull, `dispensation.router.ts:1003-1016`)* | Médico / Enfermería que espera el ítem completo | Acción requerida | In-app | Al cerrar con `dispensedQty < solicitado` | 4h | Farmacia jefe | Prescripción, ítem, cantidad pendiente | **FALTANTE — causa (a)** |
| Farmacia | Controlado dispensado → Comité de Farmacovigilancia | *(no existe — `farmacovigilancia.router.ts` es CRUD manual, no consumidor automático pese a su comentario "Consumer del outbox")* | Comité de Farmacovigilancia | Informativa | In-app | Al dispensar controlado | N/A | N/A | Fármaco, paciente, dispensador, testigo | **FALTANTE — causa (a)** |
| Laboratorio | Resultado crítico (vía legacy, en uso real) | `lab.criticalValue` (`lis.router.ts:1582-1589`) | Médico prescriptor (`prescriberId`) | **Alerta crítica** | In-app | Al capturar resultado | N/A (sin SLA — ver B29) | N/A (sin escalación) | Paciente, valor, unidad | **FUNCIONA end-to-end, sin SLA/read-back/escalación** (ver B20) |
| Laboratorio | Resultado validado/liberado → médico/enfermería | *(no existe evento — `result.validate` no llama `emitDomainEvent`)* | Médico tratante / Enfermería | Informativa | In-app | Al validar | N/A | N/A | Paciente, examen, resultado | **FALTANTE — causa (a)** |
| Laboratorio | Muestra rechazada → quien ordenó | *(no existe evento — `specimen.reject` solo hace `updateMany`)* | Médico que ordenó | Acción requerida | In-app | Al rechazar | 2h | Jefe de laboratorio | Paciente, examen, motivo rechazo | **FALTANTE — causa (a)** |
| Laboratorio | Reflex activado → laboratorio | *(no existe evento ni motor — ver B30)* | Laboratorio (cola de trabajo) | Informativa | In-app | Al activarse regla | N/A | N/A | Examen origen, examen reflex | **FALTANTE — causa (a), motor inexistente** |
| Imágenes | Estudio solicitado → técnico/radiología | *(no existe evento — 0 `dispatchDomainEvent` en routers de imaging)* | Técnico de radiología | Acción requerida | In-app | Al solicitar | N/A | N/A | Paciente, tipo de estudio, prioridad | **FALTANTE — causa (a)** |
| Imágenes | Informe listo → médico tratante | *(no existe evento; solo tarea pull en `workflow-inbox.router.ts:230-245`)* | Médico tratante | Acción requerida | In-app | Al completar informe | N/A | N/A | Paciente, estudio, hallazgos | **FALTANTE — causa (a)**; existe inbox de pull (`IMAGING_TO_REPORT`/`IMAGING_TO_VALIDATE`), no push |
| Imágenes | SLA de sobre-tiempo (STAT 60min/URGENT 240min/ROUTINE 1440min) | Calculado por `getOverdueOrders` (`imaging.router.ts:221-266`, `SLA_MINUTES` en `packages/contracts/src/schemas/imaging.ts:53-58`) | Radiología / Jefe de servicio | **Alerta** | In-app | Al vencer SLA | Ver umbrales | Jefe de radiología | Paciente, estudio, minutos de retraso | **FALTANTE — causa (a), la query existe pero nadie la invoca ni dispara evento** |
| Imágenes | Hallazgo crítico → médico | *(imposible — campo no existe, ver B34)* | Médico tratante | **Alerta crítica** | In-app | Al detectar | Por definir | Por definir | Paciente, hallazgo | **FALTANTE — causa (a), estructuralmente ausente** |

---

## 5. Causa Raíz Preventivo

| Hallazgo crítico | Causa raíz | Por qué se repite en los 4 módulos | Acción preventiva estructural |
|---|---|---|---|
| Notificaciones ausentes salvo 4 `eventType` en todo el HIS (§1.2, §4) | Dos implementaciones de dispatcher evolucionaron en paralelo (Node vs. Edge Function) y solo una corre en producción; nadie mantiene sincronizado el switch del Edge Function con el catálogo de `packages/contracts/src/events/catalog.ts`, que sí crece con cada módulo nuevo | Cada módulo (HC/ECE, Farmacia, Laboratorio, Imágenes) emite sus propios `DomainEvent` de buena fe asumiendo que "el dispatcher" los resuelve — nadie prueba end-to-end contra el Edge Function real | Eliminar el dispatcher Node huérfano (o marcarlo explícitamente como código muerto/legacy) para que solo exista una fuente de verdad; agregar test de integración que recorra TODO `catalog.ts` y falle si algún `eventType` no tiene `case` en `supabase/functions/notifications-dispatch/index.ts` |
| Sistemas duplicados sin UI (motor ECE de Laboratorio §3.3/B27, `imaging.router.ts` legacy §B32, `critical-result.router.ts` §B20) construidos y nunca cableados | El patrón "adecuar legacy, NO duplicar" de CLAUDE.md se documenta para evitar crear rutas `/ece/X` paralelas en frontend, pero no hay guardrail equivalente para backend: se construyeron routers ECE completos (con mejor diseño de rol que el legacy) sin verificar que alguien los fuera a consumir desde `apps/web` | Se repite porque el criterio de "hecho" en el Definition of Done (CLAUDE.md §DoD) exige tests/coverage/lint, pero no exige "tiene al menos un caller real en `apps/web/src`" | Agregar a la Definition of Done: todo router/procedure tRPC nuevo con lógica clínica debe declarar explícitamente en el PR si tiene caller de UI o si es infraestructura intencionalmente diferida (con ticket) — @QA verifica con el mismo grep usado en esta auditoría antes de aprobar el gate |
| Mutations clínicas de inicio/fin de ciclo sin `requireRole` (prescripción B25, BCMA B26, captura/validación de laboratorio B28, todo el ciclo de imágenes B35) mientras el paso intermedio (dispensación) sí está bien protegido | El endurecimiento de rol se aplicó reactivamente donde hubo un incidente de seguridad conocido (dispensación de controlados, remediado en Ola 4b) pero no se generalizó al resto del ciclo por falta de barrido sistemático | Mismo patrón que P0-8 del informe 01 (admisión/censo/quirófano) — confirma que es un gap de disciplina transversal, no específico de un módulo | Adoptar la misma recomendación del informe 01: metadata `.meta({ impact: "critical" })` en tRPC + check de CI que falle si una mutation que persiste un acto clínico (prescripción, administración, informe, resultado) no tiene `requireRole` |
| Modelos de datos construidos sin motor de negocio (`LabReflexRule` B30, campo "hallazgo crítico" ausente en imágenes B34) | El schema de Prisma/SQL se diseñó anticipando funcionalidad (buena práctica de modelado a futuro) pero el ticket de la lógica de negocio correspondiente nunca se creó o se perdió en el backlog | Riesgo de que se lea el schema como evidencia de que la funcionalidad "ya existe" cuando solo existe el dato | Auditoría periódica (trimestral) de modelos Prisma sin ningún router que los lea/escriba fuera de seeds/migraciones — candidatos a "dato sin motor" |
| Caducidad de reserva de botiquín deja inventario/cargo huérfanos (B23) | El job de expiración se escribió replicando el patrón de "marcar estado" sin replicar la lógica completa de reversa que sí tienen `cancelReservation`/`returnItem` — probablemente porque el cron se escribió en un sprint distinto al de esas dos mutations | Es el mismo patrón de "función nueva no reutiliza la lógica de reversa ya probada" que otros módulos (no aplica a HC/Lab/Imágenes directamente, pero es la misma clase de riesgo que B23 en el conjunto) | El job de expiración debe llamar la misma función interna que usa `cancelReservation` (reversa de stock + cargo) en vez de solo actualizar `status`; agregar test que verifique `StockLot.quantityOnHand` y estado del cargo después de una expiración simulada |

---

## 6. Backlog P0/P1/P2 con criterio de aceptación verificable

### P0 — Bloquean Go-Live / riesgo financiero o clínico directo

| ID | Título | Módulo | Criterio de aceptación (verificable) |
|---|---|---|---|
| P0-10 | Unificar el catálogo de notificaciones: sincronizar `resolveRecipient` del Edge Function real con `packages/contracts/src/events/catalog.ts` y eliminar/marcar legacy el dispatcher Node huérfano | Transversal (los 4 módulos) | `supabase/functions/notifications-dispatch/index.ts` resuelve destinatario para al menos los eventos P0 de este informe (`critical_result.emitted`, `lab.criticalValue` ya funciona, `ece.*.firmado` de documentos con dependencia crítica); test de integración recorre `catalog.ts` completo y falla si un `eventType` de severidad CRITICAL/WARNING no tiene `case` |
| P0-11 | Cablear `critical-result.router.ts` (emit) desde `lis.router.ts result.enter` y desde `resultado-estudio.router.ts` cuando el valor excede el umbral crítico | HC/ECE, Laboratorio | Al capturar un resultado fuera de rango crítico, se invoca `criticalResult.emit` automáticamente (no requiere acción manual adicional); test confirma fila `CriticalResultEvent`/equivalente creada con SLA activo |
| P0-12 | Reemplazar la verificación PIN "dummy" de `critical-result.confirmReadback` por verificación argon2id real contra `ece.firma_electronica` | HC/ECE | `confirmReadback` usa el mismo mecanismo de verificación de PIN que `consentimiento.firmar`/`acto-quirurgico.firmar`; test con PIN incorrecto retorna `FORBIDDEN` |
| P0-13 | `requireRole` en prescripción y firma de receta (`pharmacy.router.ts prescription.create/sign`) | Farmacia | `prescription.create`/`sign` exigen `requireRole(["PHYSICIAN","MC"])` igual que el equivalente ECE; test confirma `FORBIDDEN` para rol no clínico |
| P0-14 | `requireRole` en administración BCMA (`bedside.router.ts administrationRouter.record`) | Farmacia | Exige `requireRole(["NURSE","ENF"])` como mínimo; test confirma `FORBIDDEN` para rol no autorizado |
| P0-15 | Corregir el job de expiración de reservas de botiquín para reversar stock y cargo, no solo cambiar `status` | Farmacia | `expire_pharmacy_reservations()` invoca la misma lógica de reversa que `cancelReservation`; test simula reserva expirada y confirma `StockLot.quantityOnHand` restaurado y cargo revertido/anulado |
| P0-16 | `requireRole` en el ciclo clínico de laboratorio (`lis.router.ts order.create/specimen.collect/result.enter/result.validate`) con segregación real captura≠validación por rol, no solo por usuario | Laboratorio | `result.enter` exige rol técnico/profesional; `result.validate` exige rol distinto (MC/ESP/bioquímico) explícitamente, no solo `resultedById !== ctx.user.id`; test confirma `FORBIDDEN` si el mismo rol intenta ambos pasos con reglas de negocio que lo prohíban |
| P0-17 | Cablear el ciclo completo de imágenes a UI (programar, realizar, dictar, firmar, validar) o consolidar `imaging.router.ts` dentro de `imaging-request.router.ts` si se decide una sola vía | Imágenes | Existe al menos una pantalla por cada paso (`order.updateStatus`, `report.create`, `report.sign`, `report.validate`) con caller real verificable por grep en `apps/web/src`; o, alternativamente, decisión arquitectónica documentada de deprecar uno de los dos routers |
| P0-18 | Renderizar el informe de imagen (`findings/impression/recommendation`) en `DetalleSolicitudDialog` | Imágenes | El componente muestra el contenido del informe cuando `report` no es null; verificación visual/Playwright confirma que el texto del hallazgo es visible al médico tratante |
| P0-19 | `requireRole` en dictado/firma/validación de informe de imagen, con segregación firma≠validación | Imágenes | `report.create`/`sign` exigen rol radiólogo; `report.validate` exige un usuario distinto al que firmó (o rol jefe de servicio); test confirma `FORBIDDEN` en ambos casos |
| P0-20 | Modelar y cablear "hallazgo crítico" en imágenes (campo + evento + notificación) | Imágenes | `ImagingReport` tiene campo de criticidad; al marcarlo, se emite un evento con `case` en el dispatcher real hacia el médico tratante, con SLA equivalente al de laboratorio |

### P1 — Riesgo de gobierno/cumplimiento, no bloquea Go-Live pero requiere plan

| ID | Título | Módulo | Criterio de aceptación |
|---|---|---|---|
| P1-10 | Traducir la excepción del trigger SQL de dependencias faltantes a `PRECONDITION_FAILED` con `cause.dependenciasFaltantes` para los ~27 routers que no usan `assertDependenciasFirmadas` | HC/ECE | Cualquier intento de crear un documento con dependencia faltante retorna el mismo shape de error en los 30 routers, no una excepción Postgres cruda |
| P1-11 | Definir y cablear ventana de tiempo para co-firma de orden verbal | HC/ECE | `verbal-order.router.ts` rechaza o marca vencida una orden verbal sin confirmar dentro del plazo definido (ej. 24h); alerta al médico prescriptor antes de vencer |
| P1-12 | Requerir doble aprobación para activar/desactivar modo contingencia | HC/ECE | `contingencia.activar/desactivar` exige confirmación de un segundo usuario con rol DIR o superior, o al menos notificación inmediata a Dirección Médica al activarse |
| P1-13 | Estratificar el umbral de valor crítico de laboratorio por `LabReferenceRange` (edad/sexo) en vez de la heurística ±50% | Laboratorio | `result.enter` consulta `LabReferenceRange` por edad/sexo del paciente para determinar el flag crítico; test con paciente pediátrico vs. adulto confirma umbrales distintos |
| P1-14 | Sembrar `RES_EST` en `ece.tipo_documento` o documentar explícitamente por qué el motor de dependencias no aplica a resultados de laboratorio | Laboratorio | Decisión documentada en `docs/flujos/RES_EST.md` con justificación, o el tipo queda sembrado y sujeto al mismo enforcement que el resto del catálogo |
| P1-15 | Notificar entrega parcial/pendiente (CC-0030) al médico/enfermería que espera el ítem completo | Farmacia | Al cerrar una orden con `pendiente > 0`, se emite evento con `case` en el dispatcher hacia el prescriptor; SLA de seguimiento definido (ej. 4h) |
| P1-16 | Consumo automático del outbox por Farmacovigilancia para controlados dispensados | Farmacia | `farmacovigilancia.router.ts` (o un nuevo consumidor) reacciona a `pharmacy.dispensation.controlled` (nuevo evento) sin requerir registro manual de incidente |
| P1-17 | Retirar o migrar `NotificationOutbox` (Beta.15) — vía muerta desde la migración a `DomainEvent`/`Notification` | Farmacia (y transversal) | El cron de expiración de reservas escribe al mecanismo real (`DomainEvent`) o se elimina la tabla `NotificationOutbox` si no tiene otros escritores |

### P2 — Deuda técnica / mejora, sin riesgo inmediato

| ID | Título | Módulo | Criterio de aceptación |
|---|---|---|---|
| P2-7 | Implementar el motor de reglas reflex (`LabReflexRule`) o documentar explícitamente que queda diferido | Laboratorio | Ticket de backlog con decisión explícita; si se implementa, `result.enter` evalúa reglas reflex activas y crea la orden derivada automáticamente |
| P2-8 | Consolidar `imaging.router.ts` legacy dentro de `imaging-request.router.ts` una vez cableada la UI (evitar mantener dos fuentes de verdad permanentemente) | Imágenes | Un solo router gobierna el ciclo completo de imágenes; el otro se elimina o queda como capa interna no expuesta directamente |
| P2-9 | Exponer `getOverdueOrders` (SLA de imágenes) en un dashboard de radiología | Imágenes | Pantalla `/imaging` muestra órdenes vencidas por prioridad, consistente con el wallboard ya existente para triage |

---

## 7. Supuestos

- `[NO VERIFICADO — supuesto]` No se confirmó contra Supabase producción si `packages/database/sql/114_critical_result_notification.sql`/`120_morse_sla_watchdog.sql` están aplicados — se infiere su existencia/intención del nombre de archivo y de los comentarios en `critical-result.router.ts`, no de `mcp__supabase__list_migrations`.
- `[NO VERIFICADO — supuesto]` Cuántos usuarios reales tienen roles DIR, PHARM, LAB, RAD asignados en el tenant de producción — relevante para los "puntos únicos humanos" señalados en §3.
- `[NO VERIFICADO — supuesto]` Si existe un rol RADIOLOGO/TECNICO_RX sembrado en el RBAC parametrizable de producción (CC-0017) fuera del seed base revisado (`packages/database/prisma/seed.ts:355-362`).
- `[NO VERIFICADO — supuesto]` Comparación línea por línea de las 30 fichas `docs/flujos/*.md` contra el código real — se usó muestreo dirigido (RES_EST, TRIAJE del informe 01), no cobertura completa de las 30 fichas.
- `[NO VERIFICADO — supuesto]` Contenido completo de `packages/contracts/src/events/payloads.ts` — se usó grep dirigido por `eventType`, no lectura íntegra del archivo.
- Se asume vigente la decisión de negocio ya documentada en memoria del proyecto de que DICOM/PACS/HL7-FHIR (§28 del TDR) es un diferido aceptado, no una brecha — el código es consistente con esa lectura (solo campos de referencia, sin cliente DICOM ni visor), pero esta auditoría no reabre esa decisión.
- Se asume que el estado de RN-HIS-BOT-001 (cargos de botiquín, cerrado según esta auditoría y el informe @DrHIS del 2026-09-09/15) sigue cerrado a la fecha de este informe (commit `128138f`, HEAD de la rama auditada) — no se verificó contra un ambiente desplegado.

---

## Resumen ejecutivo (para @Orq / CIO-CTO)

Los cuatro módulos comparten la misma falla estructural que el informe 01: **el motor de notificaciones existe pero, en la práctica, solo 4 de los más de 20 `eventType` del catálogo llegan a un destinatario real** — se confirmó que hay dos implementaciones de dispatcher (una huérfana, otra real vía Edge Function/pg_cron) y que la real solo resuelve `vital.critical`, `lab.criticalValue`, `drug.interaction` y `allergy.mismatch`; todo lo demás (documentos ECE firmados, caídas, contingencia, reservas de farmacia, resultados de laboratorio, informes de imagen, hallazgos críticos de imagen) se emite, se audita, y se descarta silenciosamente. A esto se suman tres patrones de "sistema construido y no cableado a UI": el motor de valor crítico con SLA y read-back (`critical-result.router.ts`), el motor completo de laboratorio NTEC (`solicitud-estudio`/`resultado-estudio`) y todo el ciclo clínico de imágenes posterior a la solicitud (`imaging.router.ts`) — en los tres casos el diseño de rol es correcto pero nadie lo usa, mientras el flujo legacy que sí opera (`lis.router.ts`, farmacia en sus extremos) carece de `requireRole` en pasos clínicos críticos. Hallazgo positivo y ya cerrado: RN-HIS-BOT-001 (cargos de botiquín) y el control de 2 ojos para medicamentos controlados están remediados y cableados en el camino real (`dispensation.router.ts`). Hallazgo nuevo de mayor severidad: el job de expiración de reservas de farmacia (4h) deja inventario descontado y cargos vigentes huérfanos porque no reversa lo que sí reversan `cancelReservation`/`returnItem`, y esa anomalía es invisible en el reporte de conciliación porque excluye reservas `EXPIRED`. El detalle completo, con evidencia archivo:línea, está en `docs/audit/2026-09-15_cobertura/02-hc-farmacia-lab-imagen.md`.
