# Auditoría de Cobertura — Facturación/Cuentas de Paciente y Administración/Seguridad

**Fecha:** 2026-09-15
**Alcance:** `packages/trpc/src/routers/{patient-account,account-receivable,invoice,insurance,conciliacion-cargos,encounter-discharge,rbac,abac,break-glass,user-admin,service-price-list,tipo-cuenta,gs1-*,services-equipment,room,bed,workflow-*}.router.ts`, `packages/trpc/src/lib/{charge-capture,price-resolver,coverage-resolver}.ts`, `packages/database/prisma/schema.prisma`, `packages/database/sql/*`, `packages/infrastructure/src/notifications/*`.
**Método:** solo lectura — grep + read de código fuente y SQL aplicado. Sin ejecución de BD, sin cambios.
**Rama auditada:** `feat/cc-0030-entrega-parcial` (commit `128138f`).
**Autor:** @AE (Arquitecto Empresarial), con verificación cruzada de dos agentes de investigación (Facturación / Admin-Seguridad) y verificación puntual propia de los hallazgos P0.

---

## 1. Resumen del alcance

Esta auditoría cubre dos dominios de negocio que comparten un mismo patrón de riesgo estructural: **motores de reglas y de estado bien construidos en el núcleo (captura de cargos, cierre de cuenta, RBAC/ABAC), rodeados de un perímetro incompleto** — ciclos de vida que terminan a medio camino (CxC sin vencimiento, claims sin respuesta) y procedures de escritura sensibles sin gate de rol allí donde el patrón del propio router ya demuestra que sí se sabe hacerlo bien (`writerProc`, `coverageWriterProc`, `adminProc`).

Se confirmó la existencia de infraestructura real de notificaciones (Beta.15: `DomainEvent` → `dispatcher.ts` → `Notification` INBOX/EMAIL, UI en `/notifications` y `/settings/notifications`), pero su tabla de enrutamiento (`resolveRecipientsAndSeverity` en `packages/infrastructure/src/notifications/dispatcher.ts:131-168`) **no tiene ningún `case` para eventos de facturación o administración** salvo `accounting.periodClosed`, `accounting.journalPostedHighValue` y `security.breakGlass.activated`. Esto significa que el canal existe pero el 90%+ de los eventos de este alcance, aunque se emitieran, caerían en el `default` (`skippedReason: "no-recipient"`) — es una brecha de **cableado**, no de infraestructura ausente, y así se distingue en la Sección 4.

**Submódulos evaluados:**
- Facturación: captura de cargos, resolución de precio, cuenta de paciente y sus 6 causas de bloqueo de cierre, alta en dos fases (CC-0027), facturación dual/coaseguro (CC-0028b), CxC/pagarés, facturas e IVA, seguros/coberturas/autorizaciones (CC-0028), conciliación clínico-financiera (7 reportes, CC-0030).
- Administración/Seguridad: RBAC (roles/permisos/herencia/alias), ABAC, break-glass, administración de usuarios, listas de precios, TipoCuenta, GLN/GS1, equipos biomédicos (GIAI), habitaciones/camas, workflow-designer.

---

## 2. Matriz de Brechas Ocultas

Leyenda de estado: **AUSENTE** (no hay modelo ni lógica) · **INCOMPLETO** (existe modelo/campo/SQL pero sin router/lógica que lo use, o el ciclo queda a medio camino) · **EXISTE** (cableado punta a punta, se cita evidencia).

### 2.1 Facturación y cuentas de paciente

| # | Módulo | Brecha | Estado | Evidencia |
|---|---|---|---|---|
| F1 | CxC (CC-0027) | Vencimiento de pagarés/documentos de deuda | **AUSENTE** | `AccountReceivable` (`schema.prisma:8487-8513`) no tiene columna `fechaVencimiento`/`dueAt`; solo `plazoDias: Int?` que nunca se usa para derivar una fecha (`patient-account.router.ts:50,954` lo persiste, ningún lugar lo lee). `CxcEstado` (`schema.prisma:162-168`) incluye `INCOBRABLE` pero ninguna mutation lo asigna (`grep -rn "INCOBRABLE"` solo aparece en el `z.enum` de filtro de `account-receivable.router.ts:24` y como badge de UI). |
| F2 | Facturas / Claims (CC-0028) | Seguimiento de factura enviada a aseguradora | **INCOMPLETO** | `InsuranceClaim` tiene `ClaimStatus` completo (`SUBMITTED,IN_REVIEW,APPROVED,REJECTED,PARTIALLY_APPROVED,PAID`, `schema.prisma:276-285`) y campos `respondedAt`/`rejectionReason`, pero `invoice.router.ts` solo expone `createClaim` (líneas 567-604, inserta en `SUBMITTED`) — no existe `updateClaim`/`respondClaim`. El claim queda huérfano salvo intervención SQL directa. `finance-overview.router.ts:114-120` cuenta `claimsPendingCount` confirmando que el producto espera avance que no puede producirse desde la UI. |
| F3 | Seguros (CC-0028) | Vencimiento de póliza (`PatientCoverage.validTo`) | **INCOMPLETO** | El campo existe y se usa correctamente para *resolver* cobertura (`coverage-resolver.ts:128,175`), y la UI calcula un badge visual por fila (`apps/web/src/app/(admin)/insurance/polizas/page.tsx:69-76`). Pero, a diferencia de `authorization.getExpiring` (`insurance.router.ts:636-667`, que sí existe para `AuthorizationRequest.validTo`), **no hay `coverage.getExpiring`** — no hay consulta backend de "pólizas por vencer" reutilizable fuera de esa página. |
| F4 | Caja | Arqueo / cierre de turno de cajero | **AUSENTE** | Sin modelo Prisma, sin tabla SQL, sin router. `grep -rniE "arqueo|cashregister|caja_turno"` sin resultados en el dominio financiero. |
| F5 | Facturas | Notas de crédito / débito, anulación con reverso fiscal | **AUSENTE** | `voidInvoice` (`invoice.router.ts:535-562`) solo cambia `status='VOIDED'`; no genera documento de reverso, no ajusta pagos ya cobrados, no bloquea anular una factura con pagos aplicados. No existe modelo `CreditNote`/`DebitNote`. |
| F6 | Cuenta de paciente | Reversión/reapertura de cierre | **AUSENTE — decisión documentada** | Comentario explícito en código: `patient-account.router.ts:20-21` ("no hay procedure de reapertura post-cierre: decisión administrativa futura, fuera de alcance"). |
| F7 | Pagos | Conciliación bancaria de pagos electrónicos | **AUSENTE** | `InvoicePayment.method` admite `TRANSFER`/`CARD` con solo `referenceNumber` de texto libre (`invoice.router.ts:115-120`); sin tabla ni router de conciliación contra extracto bancario. |
| F8 | Cuenta de paciente | Cargo directo sin motor de precios | **INCOMPLETO** | `agregarServicio` (`patient-account.router.ts:545-566`) crea `PatientAccountService` **sin** pasar por `capturarCargo`/`resolverPrecio` — no fija `code`/`unitPrice`/`origen`/estado de forma consistente con el resto del motor de cargos (contraste directo con `charge-capture.ts:138-248`, que sí congela precio y nunca factura a 0). Riesgo de línea de cargo sin precio que no dispara `PENDIENTE_TARIFA`. |
| F9 | Facturas | Vencimiento de factura (`Invoice.dueAt`) | **INCOMPLETO — riesgo de drift** | `finance-overview.router.ts:131-147` envuelve el cálculo de `invoicesOverdueCount` en try/catch con comentario de que la columna "puede no existir" — señal de que el campo base de vencimiento de facturas no está garantizado igual en todos los entornos/tenants. Requiere verificación directa contra Supabase antes de confiar en el KPI. |

### 2.2 Administración y Seguridad

| # | Módulo | Brecha | Estado | Evidencia |
|---|---|---|---|---|
| A1 | RBAC | Vencimiento de licencia de prefijo GS1 7410398 (2027-07-01) | **AUSENTE** | `Organization.gs1CompanyPrefix` (`schema.prisma:463`) es `VARCHAR(9)` sin campo de expiración; `EceGs1Gln/Giai/Gsrn` (`schema.prisma:7029-7096`) tampoco lo tienen. La fecha 2027-07-01 solo vive como comentario en `packages/database/sql/229_maestro_ubicaciones_gln.sql:5` — sin backing en BD ni alerta programática. |
| A2 | Seguridad | Rotación/expiración de `mfaSecret` de portal | **INCOMPLETO** | Migrado a Vault (`portal.router.ts:272-294`) pero sin TTL — válido indefinidamente hasta regeneración manual. |
| A3 | Seguridad | Sesión break-glass | **EXISTE** | `BREAK_GLASS_TTL_SECONDS=3600` (`break-glass.router.ts:35`), autoexpira por ventana de tiempo (`current`, línea 164); emite `security.breakGlass.activated` (líneas 120-136), único evento de este alcance con dispatcher cableado punta a punta (ver §4). |
| A4 | RBAC | Auditoría de cambios de rol/permiso en hash chain | **AUSENTE** | Sin `CREATE TRIGGER` sobre `Role`/`RolePermission`/`UserOrganizationRole`/`User` en ningún SQL numerado (solo hay políticas RLS, `06_rls_auth_audit.sql:25,106-115`). `createRole/updateRole/setRolePermissions/setRoleInheritance/setRoleAlias/assignRole/revokeRole` no dejan rastro inmutable — contraste directo con el resto del sistema (dispensación, cierre de cuenta) que sí está bajo hash chain (CLAUDE.md §Audit hash chain). |
| A5 | Mantenimientos | Listas de precios sin versión histórica ni doble aprobación | **AUSENTE** | `service-price-list.router.ts` usa mutación in-place (`setListActive`/`setItemActive`); mismo rol (`ADMIN`/`ACCOUNTANT`) crea y activa, sin historial de versiones ni segundo aprobador. |
| A6 | Mantenimientos | "Fuera de servicio" de cama/equipo sin segunda aprobación | **INCOMPLETO** | `bed.router.ts:100` (`updateStatus`) y `services-equipment.router.ts:180` (`setStatus`) son `tenantProcedure` sin `requireRole`; `setStatus` solo exige texto de `maintenanceReason` si el equipo es `CRITICAL` (líneas 203-211) — sin segunda persona que apruebe. Contraste: `room.router.ts` sí usa `adminProc` consistentemente. |
| A7 | RBAC / Workflow | Rol `LOGISTIC` referenciado pero inexistente | **AUSENTE (drift confirmado)** | 6 sitios de escritura en `gs1-catalogos.router.ts` (154,173,283,369,385), `gs1-gln-hierarchy.router.ts` (235,306,369), `gs1-medication.router.ts:168`, `inventory.router.ts` (319,402) usan `requireRole([..., "LOGISTIC"])`. El seed `194_cc0017_rbac_parametrizable.sql:823-859` solo referencia `LOGISTIC` como texto en `RolePermission` join — si no existe fila `Role.code='LOGISTIC'`, ese brazo del OR es código muerto (consistente con memoria del proyecto CC-0029: "roles ADMIN/EQUIPOS, no LOGISTIC"). Efecto: esas mutations quedan restringidas de facto solo a `ADMIN`/`PHARM`/`EQUIPOS`, sin que se documente como decisión. |
| A8 | RBAC | Rol `ADM` sin alias, posible ruta inalcanzable | **INCOMPLETO** | `rbac.router.ts:561` (`reactivateUser: requireRole(["ADM","super_admin"])`) usa `ADM`, explícitamente listado en `194_cc0017_rbac_parametrizable.sql:5-10,131` como código "sin alias, pendiente, NO inventado". Si no hay fila `Role.code='ADM'`, la procedure es alcanzable solo por `super_admin`. |
| A9 | Onboarding/offboarding | Desactivación de usuario al salir | **INCOMPLETO** | Existe `rbac.purgeInactiveUsers` (`rbac.router.ts:512`, correctamente gateado con `requirePermission("rbac.manage")`) que marca `INACTIVE` tras 365 días sin login — es purga por inactividad, no un flujo de offboarding disparado por evento de RRHH/salida de personal. Combinado con A-Rol-1/A-Rol-2 (abajo), la desactivación manual tampoco está protegida. |

---

## 3. Matriz RACI y Brechas de Rol

### 3.1 Catálogo real de roles usados en el alcance

Los roles **no son un enum de Postgres fijo** — son filas de la tabla `Role` (`schema.prisma:794-820`) con alias (`RoleCodeAlias`, líneas 828-838) y herencia. El propio SQL 194 documenta la causa raíz: *"376 call sites / 99 routers / 45 códigos de rol literales, muchos sin fila Role real"* (`194_cc0017_rbac_parametrizable.sql:5-10`).

Roles distintos que aparecen en `requireRole()` dentro del alcance auditado: `ADMIN, ADM, ADMIN_CLINICO, ADMIN_ORG, ACCOUNTANT, ACCOUNTANT_SENIOR, BILLING, DIR, DIR_MEDICO, ARCH, WORKFLOW_DESIGNER, LOGISTIC (muerto, ver A7), EQUIPOS, PHARM, BIOMEDICAL, INVENTORY_MANAGER, super_admin`.

**No existen en el catálogo** (ni en `requireRole` ni con evidencia de fila `Role` seedeada dentro del alcance): `CAJERO`, `AUDITOR`, `JEFE_FARMACIA`, `COBRANZAS`, `JEFE_FACTURACION`, `SEGUROS`. Esto es relevante porque son precisamente los destinatarios naturales de varias de las brechas de notificación de la Sección 4 — **no hay a quién asignarles la alerta hoy sin antes crear el rol**.

### 3.2 RACI por etapa crítica

| Etapa | Ejecuta (R) | Valida/Autoriza (A) | Consultado (C) | Informado (I) | Brecha de rol |
|---|---|---|---|---|---|
| Captura de cargo (`capturarCargo`) | Sistema (cualquier caller autorizado del router de origen) | — (motor de precio server-side, sin gate humano) | — | — | Sin brecha — es correcto que sea automático |
| `agregarServicio` directo (bypass del motor) | Cualquier usuario `tenantProcedure` | Nadie | — | — | **Brecha F8**: sin rol mínimo, sin pasar por `resolverPrecio` |
| Cierre de cuenta (`cerrar`) | Cualquier usuario `tenantProcedure` | Nadie | — | — | **Brecha de rol** — inconsistente con `regularizar`/`altaAdministrativa`/`facturacionDual`, todas con `requireRole` |
| Alta administrativa / CxC (`altaAdministrativa`) | `ADMIN, ACCOUNTANT` | Mismo rol que ejecuta | — | — | Sin segundo aprobador para la ruta CXC (paciente/fiador queda "autorizado" por el mismo agente que registra) — riesgo medio, no crítico dado que hay firma física (`firmanteNombre/Documento`) como control compensatorio |
| Facturación dual / coaseguro (`facturacionDual`) | `ADMIN, ACCOUNTANT, BILLING` | Mismo rol | — | — | Aceptable — 3 roles alternativos, no un solo punto humano |
| Override de precio en factura | Rol con `ADMIN`/`DIR` (chequeo manual, no `requireRole`) | Mismo llamador | — | — | Correcto en intención (2do rol exigido) pero implementado como chequeo manual (`invoice.router.ts:33,361-363`), no vía el wrapper estándar — mayor riesgo de que un refactor lo pierda sin que lint/tests lo detecten |
| Aprobar/negar autorización de cobertura (`authorization.approve/deny`) | Cualquier usuario `tenantProcedure` | Nadie | — | — | **Brecha de rol** — inconsistente con `coverage.create/update` (sí exige `coverageWriterProc`); aprobar/negar un monto de cobertura es una decisión financiera equivalente sin gate |
| Crear rol / asignar permisos (`rbac.createRole`, `setRolePermissions`, `setRoleInheritance`, `deactivateRole`) | **Cualquier usuario `tenantProcedure` de la org** | Nadie (solo chequeo `isSuperAdmin` para el caso de rol *global*, `organizationId===null`) | — | — | **VIOLACIÓN CRÍTICA DE SoD (P0)** — verificado: `createRole` (`rbac.router.ts:246`), `setRolePermissions` (:355), `setRoleInheritance` (:601), `updateRole` (:277), `deactivateRole` (:306) son `tenantProcedure` sin `requireRole`/`requirePermission` |
| Asignar/revocar rol a un usuario (`userAdmin.assignRole/revokeRole`) | **Cualquier usuario `tenantProcedure` de la org** | Nadie | — | — | **VIOLACIÓN CRÍTICA DE SoD (P0)** — verificado: `assignRole` (`user-admin.router.ts:644`), `revokeRole` (:700), `update` (:406), `deactivate` (:558), todas sin gate. Escenario de explotación: un usuario `NURSE` llama `userAdmin.assignRole({userId:self, roleId:<ADMIN>})` y obtiene `ADMIN` sin aprobación de nadie |
| Publicar workflow NTEC (`workflow-publicacion.saveDraft`/`publish`) | `WORKFLOW_DESIGNER, DIR` | Mismo gate para ambos pasos | — | — | **Brecha de rol** — el propio código lo documenta: *"WORKFLOW_DESIGNER puede guardar borrador y publicar"* (`workflow-publicacion.router.ts:12`); sin segundo aprobador obligatorio distinto al autor |
| Cambiar estado cama/equipo a "fuera de servicio" | Cualquier usuario `tenantProcedure` | Nadie | — | — | Ver A6 |

### 3.3 Procedures de escritura sin `requireRole` (candidatas a brecha, consolidado)

| Router | Procedures | Severidad |
|---|---|---|
| `rbac.router.ts` | `createRole, updateRole, deactivateRole, setRolePermissions, setRoleInheritance, setRoleAlias, deleteRoleAlias` | **P0** |
| `user-admin.router.ts` | `update, deactivate, assignRole, revokeRole` | **P0** |
| `patient-account.router.ts` | `crear` (baja), `agregarServicio` (alta — bypass motor precio), `cerrar` (alta — irreversible) | P1 |
| `insurance.router.ts` | `insurer.create`, `authorization.create/approve/deny` | P1 |
| `encounter-discharge.router.ts` | `dischargeEncounter` (gatilla Fase 2 financiera) | P2 |
| `bed.router.ts` | `updateStatus, findAvailable, assignToEncounter, release` | P2 |
| `services-equipment.router.ts` | `create, setStatus, actualizarUbicacion`, altas de mantenimiento | P2 |

**Contraejemplo positivo** (para no sobre-generalizar): `abac.router.ts`, `room.router.ts`, `service-price-list.router.ts`, `tipo-cuenta.router.ts`, `workflow-instance.router.ts`, `workflow-tipoDoc-override.router.ts`, `workflow-rol.router.ts` sí aplican consistentemente un procedure-alias gateado (`writerProc`/`adminProc`/`dirOnly`) a todas sus mutations. Los 7 reportes de `conciliacion-cargos.router.ts` son de solo lectura y correctamente abiertos a `tenantProcedure` sin `requireRole` (no es brecha).

---

## 4. Matriz de Notificaciones

**Infraestructura confirmada** (`packages/infrastructure/src/notifications/dispatcher.ts` + `packages/database/prisma/schema.prisma:4437-4520`): `DomainEvent` (outbox) → `dispatchDomainEvent()` resuelve destinatarios vía un `switch(parsed.eventType)` cerrado (líneas 131-167) → crea filas `Notification` (canal INBOX y/o EMAIL según `RoleSeverityMatrix` de `routing.ts`) → UI en `apps/web/src/app/(clinical)/notifications` y `(admin)/settings/notifications` + `notifications-badge.tsx`. **El switch NO tiene case para ningún evento de facturación** y solo tiene 3 relacionados a administración: `accounting.periodClosed`, `accounting.journalPostedHighValue`, `security.breakGlass.activated`. Cualquier otro `eventType` cae al `default` → `skippedReason: "no-recipient"` — el `DomainEvent` queda persistido (trazable) pero **nunca genera una `Notification`**.

| Módulo | Etapa | Evento disparador | Destinatario (rol) | Tipo | Canal propuesto | Momento | SLA | Escalamiento | Contenido mínimo | Trazabilidad |
|---|---|---|---|---|---|---|---|---|---|---|
| Facturación | Cargo sin tarifa | `cargo.pendiente_tarifa` (**ya se emite**, `charge-capture.ts:29,203`) | `ACCOUNTANT` / rol nuevo `JEFE_FACTURACION` (no existe hoy) | WARNING | INBOX (canal ya existe) | Al capturar el cargo | 4h hábiles | Sin respuesta 24h → `ADMIN` | Cuenta, paciente, código de servicio, origen | `DomainEvent` ya persiste el evento; **FALTANTE**: case en `dispatcher.ts` — hoy cae a `default`/`no-recipient` (verificado: no está en el switch de líneas 131-167) |
| Facturación | Pagaré/CxC creado | `cxc.creada` | `ACCOUNTANT` | INFO | INBOX | Al registrar `AccountReceivable` (ruta CXC de `altaAdministrativa`) | — | — | Monto, plazo, firmante | **FALTANTE** — `altaAdministrativa` (`patient-account.router.ts:942-959`) no emite `emitDomainEvent` |
| Facturación | Pagaré/CxC vencido | (no puede existir sin fecha, ver F1) | rol nuevo `COBRANZAS` (no existe) | WARNING | INBOX + EMAIL | Job diario | — | Escalar a `ADMIN` si >30 días vencido | Monto, deudor, días vencido | **FALTANTE — bloqueado por F1**: no hay `fechaVencimiento` que un job pueda evaluar |
| Facturación | Póliza próxima a vencer | (no existe evento) | rol nuevo `SEGUROS` (no existe) o `ACCOUNTANT` | WARNING | INBOX | Job diario, 30/15/7 días antes de `PatientCoverage.validTo` | — | — | Aseguradora, plan, paciente, fecha | **FALTANTE** — sin job ni evento; el campo `validTo` sí existe (F3) |
| Facturación | Factura a aseguradora sin respuesta | (no existe evento) | `BILLING`/`ACCOUNTANT` | WARNING | INBOX | Job periódico sobre `InsuranceClaim.status=SUBMITTED` con `submittedAt` antiguo | 15 días | Escalar a `ADMIN` a 30 días | Claim, aseguradora, monto, días en espera | **FALTANTE** — consistente con F2 (sin ciclo de respuesta de claim) |
| Facturación | Anulación de factura con pagos aplicados | (no existe evento ni control) | `ACCOUNTANT` | CRITICAL | INBOX + EMAIL | Al anular (`voidInvoice`) | Inmediato | — | Factura, monto pagado afectado | **FALTANTE** — ligado a F5; hoy `voidInvoice` ni siquiera bloquea la operación, mucho menos notifica |
| Admin/Seguridad | Cambio de rol o permisos de un usuario | (no existe evento) | `ADMIN`/auditoría | WARNING | INBOX + audit log | Al ejecutar `setRolePermissions`/`assignRole` | Inmediato | — | Quién, a quién, qué rol/permiso, cuándo | **FALTANTE** — ligado a A4/P0 de rol; ni siquiera hay auditoría de hash chain, mucho menos notificación |
| Admin/Seguridad | Break-glass activado | `security.breakGlass.activated` | `DIR, DIRECTOR, MEDICAL_DIRECTOR, ADMIN` (fallback documentado por ausencia de rol "jefe de servicio", `dispatcher.ts:408-415`) | CRITICAL | INBOX + EMAIL | Inmediato | — | — | Usuario, justificación, recurso accedido | **EXISTE — único evento del alcance cableado punta a punta** (emisión + resolución + template + envío) |
| Admin/Seguridad | Cierre de período contable | `accounting.periodClosed` | resuelto por `closedById` | WARNING | INBOX + EMAIL | Al cerrar | — | — | Período, org | **EXISTE** (`dispatcher.ts:376-388`) — fuera del alcance de este documento (contabilidad general) pero confirma que el patrón de cableado ya existe y es replicable |
| Admin/Seguridad | Cama/equipo marcado fuera de servicio | (no existe evento) | Mantenimiento / `ADMIN` | INFO/WARNING según criticidad del equipo | INBOX | Al ejecutar `setStatus`/`updateStatus` | — | — | Activo, motivo, quién lo marcó | **FALTANTE** — ligado a A6 |
| Admin/Seguridad | Licencia de prefijo GS1 (7410398) próxima a vencer (2027-07-01) | (no existe evento ni campo) | `ADMIN` | WARNING | INBOX + EMAIL | 180/90/30 días antes | — | — | Prefijo, fecha de vencimiento, impacto (GLN/GIAI activos) | **FALTANTE — bloqueado por A1**: no hay campo de vencimiento en BD; hoy solo vive como comentario SQL/memoria de proyecto |
| Admin/Seguridad | Publicación de workflow NTEC a producción | (no existe evento) | `DIR` (segundo revisor) | INFO | INBOX | Al publicar | — | — | Tipo de documento, versión, autor | **FALTANTE** — ligado a la brecha de SoD de §3.2 |

---

## 5. Causa Raíz Preventivo

1. **El patrón de gate correcto existe en el mismo repo, pero no se generalizó.** `writerProc`/`coverageWriterProc`/`adminProc`/`designerProc` demuestran que el equipo sabe construir un alias de procedure gateado — pero `rbac.router.ts` y `user-admin.router.ts` (los routers que administran el propio sistema de permisos) nunca recibieron ese tratamiento. Es la brecha más grave porque compromete la premisa de todo el resto del RBAC: si cualquiera puede auto-asignarse `ADMIN`, ningún otro gate del sistema es confiable.
2. **El "cableado" del motor de eventos (Beta.15) se construyó caso por caso, sin checklist de "todo router financiero/admin nuevo debe registrar su `case` en el dispatcher".** El propio `charge-capture.ts` ya emite `cargo.pendiente_tarifa` desde hace tiempo (CC anterior a CC-0030) sin que nadie haya notado que el dispatcher no lo resuelve — exactamente el mismo patrón de "verde falso" documentado en CLAUDE.md para A11y bajo CSP (#440): el emisor cree que notifica, el sistema no lo hace, y nada en CI lo detecta porque no hay test de integración `DomainEvent→Notification` para estos eventos.
3. **Los ciclos financieros de "cola" (CxC, claims, facturas anuladas) se diseñaron como creación de registro, no como máquina de estados completa.** CC-0027 y CC-0028 resolvieron el lado de "generar el documento" pero no el lado de "qué pasa después" — vencimiento, respuesta, cobranza. Es consistente con el patrón ya documentado en memoria del proyecto para RN-HIS-BOT-001 (dispensación sin cargo) y CC-0026 (indicación→tareas): el HIS tiende a resolver primero la generación del artefacto de negocio y dejar su ciclo de vida completo para una siguiente iteración que a veces no llega.
4. **Drift de nomenclatura de roles no resuelto (`LOGISTIC`, `ADM`) se repite** porque no hay una prueba automatizada que compare los literales usados en `requireRole()` contra las filas reales de `Role`/`RoleCodeAlias` — el propio SQL 194 diagnosticó el problema en 2026 pero no cerró la brecha de forma estructural (agregó alias puntuales, no una validación de tipo o test de consistencia).

---

## 6. Backlog P0/P1/P2 con criterio de aceptación verificable

### P0 — bloqueantes de seguridad/integridad, requieren acción inmediata

| ID | Título | Criterio de aceptación |
|---|---|---|
| P0-1 | Gate de rol en `rbac.router.ts` (createRole/updateRole/deactivateRole/setRolePermissions/setRoleInheritance/setRoleAlias/deleteRoleAlias) | Las 7 procedures usan `requireRole(["ADMIN"])` o `requirePermission("rbac.manage")` (consistente con `purgeInactiveUsers`/`reactivateUser`, que ya lo hacen bien). Test: un usuario `NURSE` que llama `setRolePermissions` recibe `FORBIDDEN`. Test de regresión agregado a `rbac.router.test.ts`. |
| P0-2 | Gate de rol en `user-admin.router.ts` (update/deactivate/assignRole/revokeRole) | Las 4 procedures exigen `requirePermission("user.manage")` (igual que `create`/`resetPassword`, que ya está correcto). Test: un usuario sin `user.manage` que llama `assignRole({roleId:<ADMIN>})` recibe `FORBIDDEN`. |
| P0-3 | Auditoría inmutable de cambios RBAC | Trigger SQL (nuevo número, siguiendo convención `sql/`) sobre `Role`, `RolePermission`, `UserOrganizationRole` que inserte en `audit.audit_log` con la misma cadena de hash que el resto del sistema. Verificable con `auditIntegrityRouter` mostrando entradas para un cambio de rol de prueba. |

### P1 — brechas operativas/de rol con impacto financiero o de continuidad

| ID | Título | Criterio de aceptación |
|---|---|---|
| P1-1 | Columna `fechaVencimiento` en `AccountReceivable` + cálculo desde `plazoDias` al crear | Migración SQL agrega la columna; `altaAdministrativa` (ruta CXC) la calcula (`createdAt + plazoDias`); query `list` de `account-receivable.router.ts` filtra `vencidas` reales, no solo por `estado`. |
| P1-2 | Ciclo de respuesta de `InsuranceClaim` (`respondClaim`) | Nueva mutation en `invoice.router.ts` que mueva `SUBMITTED/IN_REVIEW` → `APPROVED/REJECTED/PARTIALLY_APPROVED/PAID`, gateada con `requireRole(["ADMIN","ACCOUNTANT","BILLING"])`, actualizando `respondedAt`/`rejectionReason`. `claimsPendingCount` de `finance-overview` baja al usarla en un test de integración. |
| P1-3 | Case `cargo.pendiente_tarifa` en `dispatcher.ts` | `resolveRecipientsAndSeverity` agrega `case "cargo.pendiente_tarifa"` resolviendo destinatario por rol `ACCOUNTANT`/`BILLING` de la organización del cargo. Test: emitir el evento en un fixture produce ≥1 fila `Notification` con `channel=INBOX`. |
| P1-4 | Gate de rol en `patient-account.router.ts` (`agregarServicio`, `cerrar`) y `insurance.router.ts` (`authorization.approve/deny`) | `agregarServicio` pasa a usar `capturarCargo`/`resolverPrecio` o queda explícitamente gateado con el mismo `writerProc` que `regularizar`; `cerrar` exige `requireRole(["ADMIN","ACCOUNTANT"])`; `authorization.approve/deny` exige `coverageWriterProc`. Tests de regresión por procedure. |
| P1-5 | Resolver drift de rol `LOGISTIC` | Decisión explícita: crear fila `Role.code='LOGISTIC'` seedeada O reemplazar las 10 referencias por el rol real (`INVENTORY_MANAGER`/`PHARM`/`EQUIPOS` según corresponda). Test: `grep -rn "LOGISTIC" packages/trpc/src/routers` solo aparece si la fila existe en el seed de `Role`. |
| P1-6 | Segundo aprobador en publicación de workflow-designer | `publish` exige un usuario distinto al que hizo `saveDraft` (o exige explícitamente `DIR` y no `WORKFLOW_DESIGNER` como alternativa). Test: el mismo `userId` no puede hacer draft+publish del mismo documento. |

### P2 — mejoras de cobertura, no bloqueantes

| ID | Título | Criterio de aceptación |
|---|---|---|
| P2-1 | `coverage.getExpiring` (pólizas por vencer) | Nueva query en `insurance.router.ts`, espejo de `authorization.getExpiring`, filtrando `PatientCoverage.validTo` en ventana configurable. Cableada a notificación (job/cron). |
| P2-2 | Notas de crédito/débito + bloqueo de `voidInvoice` con pagos aplicados | Nuevo modelo `CreditNote`/`DebitNote`; `voidInvoice` rechaza si `paidAmount > 0` sin una nota de crédito asociada. |
| P2-3 | Campo de vencimiento de licencia GS1 en `Organization` o tabla de licencias | Columna `gs1PrefixExpiresAt` (o tabla `GS1License`); job/notificación 180/90/30 días antes de 2027-07-01. |
| P2-4 | Gate de rol en `bed.router.ts`/`services-equipment.router.ts` para cambios de estado a mantenimiento/fuera de servicio | `requireRole(["ADMIN","BIOMEDICAL"])` o equivalente; notificación INBOX al marcar `UNDER_MAINTENANCE`. |
| P2-5 | Arqueo de caja / cierre de turno de cajero | Nuevo modelo + router, fuera del alcance actual del ciclo de facturación — requiere definición de producto (@PO) antes de diseño técnico (@AS/@DBA). |
| P2-6 | Rol `ADM` — resolver alias o retirar referencia | Igual patrón que P1-5, aplicado a `rbac.router.ts:561`. |

---

## 7. Supuestos

- `[NO VERIFICADO — supuesto]` Se asume que `packages/trpc/src/__tests__/stubs/database.ts:53` (stub de `emitDomainEvent` en tests) refleja fielmente el comportamiento del `emitDomainEvent` real de `@his/database` en producción — no se inspeccionó la implementación productiva de esa función, solo su uso y su stub de test.
- `[NO VERIFICADO — supuesto]` No se ejecutó `get_advisors`/`list_tables` contra el proyecto Supabase real para confirmar que los 237 SQL numerados relevantes (191, 204, 228, 229, 232, 234, 235, 236, 237) están efectivamente aplicados en producción tal como indica la memoria del proyecto — esta auditoría se basa en el código fuente del repo y en la memoria de sesiones previas, no en una verificación en vivo de la BD.
- `[NO VERIFICADO — supuesto]` No se determinó si existe algún mecanismo fuera de `packages/trpc`/`packages/infrastructure` (p. ej. un cron en `infra/` o una Edge Function no revisada) que ya cubra parcialmente el vencimiento de CxC/pólizas/claims sin pasar por los routers auditados. Se buscó con grep en el árbol de código disponible sin encontrar evidencia, pero no se inventarió exhaustivamente `infra/` ni Supabase Edge Functions desplegadas.
- `[NO VERIFICADO — supuesto]` La ausencia de rol `LOGISTIC`/`ADM` como fila real de `Role` se infiere del comentario del propio SQL 194 y de la falta de un `INSERT INTO "Role"` con esos códigos en los archivos grep-eados; no se consultó `SELECT * FROM "Role"` contra la BD real para confirmarlo con certeza absoluta.
- El apartado de RACI usa nombres de rol candidatos (`CAJERO`, `AUDITOR`, `JEFE_FARMACIA`, `COBRANZAS`, `JEFE_FACTURACION`, `SEGUROS`) como propuesta de gobierno, no como hallazgo de código — se marcan explícitamente como "no existe hoy" en cada fila donde aparecen.
- Esta auditoría no evaluó el módulo de contabilidad general (`accounting.*`) ni farmacia/dispensación más allá de su intersección directa con cierre de cuenta (causas 3-6) — quedan fuera del alcance solicitado.
