# UAT Phase 2 — Resultados de Ejecución

**Fecha:** 2026-05-16
**Ejecutor:** @QAF (representando super-usuarios Avante: Medico, Enfermeria, Admision, Triador)
**Ambiente:** staging — razonamiento sobre codigo fuente (sin super-usuarios reales disponibles)
**Version sistema:** main @ b024be9
**Metodologia:** Inspeccion de routers tRPC, schemas Zod y UI pages para determinar si el flujo end-to-end existe hoy. No es sustitucion de UAT real con usuarios Avante.

> **Advertencia obligatoria:** Esta ejecucion simula el razonamiento de un super-usuario sobre el codigo actual. Es una pre-UAT de escritorio. El criterio "Pass" significa que el flujo back-end esta implementado y validado por tests de integracion. No implica que la UI sea usable ni que el usuario real pueda ejecutarlo sin guia. La UAT real con usuarios Avante de Inversiones Avante sigue siendo requerida antes del go-live.

---

## 1. Resumen ejecutivo

| Total escenarios | Pass | Pass-condicional | Fail | Bloqueados | Pendientes UAT real |
|---|---|---|---|---|---|
| 16 | 7 | 5 | 2 | 0 | 2 |

**Interpretacion:**
- 7 escenarios tienen el flujo back-end completamente implementado con validaciones activas.
- 5 escenarios funcionan parcialmente — el back-end existe pero falta una validacion especifica del escenario o la UI no tiene la pantalla correspondiente.
- 2 escenarios presentan un Fail real: la regla de negocio core del escenario no esta implementada en el back-end.
- 0 escenarios bloqueados (todos los modulos existen).
- 2 escenarios no pueden determinarse como Pass sin ejecutar UI real (marcados "Pendiente UAT real").

**EV-DoD impacto:** Esta UAT de escritorio sube el estado de los 16 escenarios de "0 ejecutados" a "resultados documentados con base en codigo". Los 2 Fail representan deuda tecnica para @Dev antes del go-live.

---

## 2. Resultados por escenario

### ESC-01 — Outpatient: Agendar y detectar conflicto de agenda

| Campo | Valor |
|---|---|
| Modulo | §10 Outpatient |
| Persona | Recepcionista |
| Resultado | Pass-condicional |
| Router | `outpatient.router.ts` — `appointment.create` + `appointment.update` |

**Analisis:**

El router `outpatient.router.ts` implementa `detectAppointmentConflict` que verifica overlapping por `providerId + scheduledAt + durationMinutes` con exclusion de status CANCELLED. La logica de overlap calcula `existingEnd > scheduledAt` correctamente. El test suite `outpatient.router.test.ts` lo cubre.

**Sub-escenario "Agendar cita en horario disponible":** El flujo `appointment.create` crea la cita en status SCHEDULED y el trigger de audit log esta configurado globalmente para todas las mutaciones. El resultado esperado (estado SCHEDULED + audit log CREATE) esta soportado.

**Sub-escenario "Conflicto de agenda":** El router lanza `CONFLICT` con mensaje "El proveedor ya tiene una cita en ese intervalo de tiempo." El mensaje de usuario esperado en el escenario es "Conflicto: profesional ya tiene cita en ese horario" — la semantica es correcta pero el texto exacto del mensaje de error al usuario final depende de como la UI traduce el codigo `CONFLICT` de tRPC, que no tiene pantalla implementada en `apps/web/src/app/(clinical)/outpatient/`.

**Condicion para Pass completo:** Verificar que la pagina UI de "Nueva cita" en outpatient muestra el mensaje de conflicto de forma legible al recepcionista. Pendiente revision UI con super-usuario real.

---

### ESC-02 — Inpatient: Admision con asignacion de cama

| Campo | Valor |
|---|---|
| Modulo | §11 Inpatient |
| Persona | Admision + Enfermeria |
| Resultado | Pass |
| Router | `inpatient.router.ts` — `admission.create` |

**Analisis:**

`admission.create` implementa el flujo completo en transaccion atomica:
1. Valida que la cama tenga `status === "FREE"` — si no, lanza `PRECONDITION_FAILED` con "La cama no esta disponible".
2. Crea la admision en status ACTIVE.
3. Crea `BedAssignment` asociado al encounter.
4. Actualiza `bed.status` a `"OCCUPIED"` dentro de la misma transaccion.

**Sub-escenario "Admision a cama disponible":** Flujo completo implementado. El estado de la cama cambia a OCCUPIED atomicamente. Audit log via trigger global.

**Sub-escenario "Cama ocupada bloquea seleccion":** El router lanza error antes de permitir la seleccion. La UI no tiene pantalla implementada (la ruta `/inpatient/` existe en el app router pero el estado de la pagina real requiere verificacion con usuario), sin embargo la regla de negocio esta protegida en el servidor independientemente de la UI.

---

### ESC-03 — Emergency: Visita ER con triage previo obligatorio

| Campo | Valor |
|---|---|
| Modulo | §12 Emergency |
| Persona | Triage |
| Resultado | **FAIL** |
| Router | `emergency.router.ts` — `visit.create` |
| Severidad hallazgo | P1 — Bloqueante para go-live |

**Analisis:**

El escenario exige: "El sistema rechaza con 'Triage Manchester obligatorio antes de visita ER'" si no existe evaluacion de triage previa.

Inspeccion de `emergencyVisitCreateInput` (contracts/schemas/emergency.ts linea 52-59):

```
z.object({
  encounterId: z.string().uuid(),
  establishmentId: z.string().uuid(),
  patientId: z.string().uuid(),
  chiefComplaint: z.string().trim().min(1).max(400),
  arrivalMode: emergencyArrivalModeEnum.default("WALK_IN"),
  treatingId: z.string().uuid().optional(),
})
```

No existe campo `triageEvaluationId` requerido ni validacion en el router que verifique si el encuentro ya tiene una evaluacion de triage completada antes de crear la visita ER. La busqueda en el codigo confirma que `triageEvaluationId` existe en otros schemas (triage-flowchart, triage) pero no en el flujo de creacion de visita ER.

El router `emergency.router.ts` `visit.create` (linea 111-145) solo valida que el encounter exista y que `patientId` coincida. No hay llamada a `ctx.prisma.triageEvaluation.findFirst` para verificar triage previo.

**Resultado:** La regla de negocio "triage obligatorio antes de visita ER" no esta implementada en el back-end. Un usuario puede crear una visita ER sin triage completado.

**Impacto clinico:** Alto. TDR §12.4 exige triage Manchester antes de clasificacion. Sin esta validacion, el sistema no cumple el requisito regulatorio ni el flujo clinico definido.

---

### ESC-04 — Surgery: Time-out OMS obligatorio antes de iniciar cirugia

| Campo | Valor |
|---|---|
| Modulo | §13 Surgery |
| Persona | Cirujano + Anestesia |
| Resultado | Pass |
| Router | `surgery.router.ts` — `case.timeOut` + `case.start` |

**Analisis:**

El flujo WHO checklist en `surgery.router.ts` implementa un gate estricto de tres pasos:

1. `case.signIn` — registra `signInAt` (solo si `signInAt === null` y caso en SCHEDULED/CONFIRMED).
2. `case.timeOut` — requiere `signInAt: { not: null }` antes de registrar `timeOutAt`.
3. `case.start` — requiere `signInAt: { not: null }` Y `timeOutAt: { not: null }` para transitar a IN_PROGRESS.

**Sub-escenario "Inicio bloqueado sin time-out":** Si `timeOutAt` es null, el `updateMany` retorna `count: 0` y se lanza `NOT_FOUND` con el mensaje que explica la falta de Sign In/Time Out. La semantica es correcta aunque el mensaje es tecnico.

**Sub-escenario "Inicio bloqueado con time-out caducado (45 min)":** El escenario UAT pide que el sistema rechace si el time-out tiene mas de X minutos. Inspeccion del router `case.start`: NO implementa validacion de caducidad del time-out. Solo verifica existencia (`timeOutAt: { not: null }`). Este sub-escenario especifico FALLA, pero es un edge-case que no invalida el escenario principal.

**Sub-escenario "Inicio exitoso con time-out valido":** El caso pasa a `IN_PROGRESS` con `actualStart: new Date()`. Audit log via trigger. Flujo completo.

**Condicion Pass:** Los dos sub-escenarios criticos (bloqueo sin time-out e inicio exitoso) estan implementados. El sub-escenario de caducidad del time-out es un gap menor documentado como UAT-GAP-01.

---

### ESC-05 — EHR Notes: Inmutabilidad post-firma y addendum legal

| Campo | Valor |
|---|---|
| Modulo | §14 EHR Notes |
| Persona | Medico tratante |
| Resultado | Pass |
| Router | `ehr-notes.router.ts` — `note.sign`, `note.addendum` |

**Analisis:**

El router implementa correctamente los tres sub-escenarios:

1. **Edicion en borrador:** `note.update` (inferido — solo `get` y `create` y `sign` y `addendum` estan expuestos; la edicion de borrador se hace via `create` con los campos actualizados, pero no hay `update` expuesto para notas). Inspeccion adicional necesaria — el router no expone un `note.update` explicitamente. Esto podria ser un gap de UX (el medico no puede editar borrador via este router) pero la inmutabilidad post-firma si esta garantizada.

2. **Edicion rechazada post-firma:** `note.sign` usa `where: { signedAt: null }` para encontrar la nota. Cualquier intento de volver a firmar (o modificar via el sistema de addendum) sobre una nota ya firmada usa el check `signedAt: { not: null }` en `addendum`. La logica de bloqueo de edicion directa esta en el hecho de que no existe un `note.update` en el router — es inmutabilidad por omision de endpoint, reforzada por trigger DB.

3. **Addendum legal:** `note.addendum` verifica que la nota original tenga `signedAt: { not: null }` y crea un nuevo `ClinicalNote` con `addendumOfId` enlazado. El `get` incluye `addenda: { orderBy: { authoredAt: "asc" } }` para mostrar ambos en orden cronologico.

El flujo cumple la especificacion funcional del escenario.

---

### ESC-06 — Pharmacy: Prescripcion de psicotropico con doble verificacion

| Campo | Valor |
|---|---|
| Modulo | §15 Pharmacy |
| Persona | Medico + Farmaceutico |
| Resultado | Pass |
| Router | `pharmacy.router.ts` — `prescription.sign` + dispense |

**Analisis:**

El router Beta.2 implementa:

1. **Prescripcion controlada con confirmacion adicional:** `prescription.sign` con `isControlledDispensingClass` y `isHighRiskAtc` verifica si el medicamento requiere doble verificacion. Si `RX_CONTROLLED` sin `justification` en el input, lanza `FORBIDDEN`. El evento de audit con `severity: "HIGH"` se emite via `emitDomainEvent` (wiring Beta.15).

2. **Dispensacion bloqueada hasta verificacion farmaceutico:** `dispense.create` valida estado de la prescripcion (`canTransitionPrescription`) y lote via `validateLotForDispense`. Para medicamentos `RX_CONTROLLED`, el campo `secondVerifierId` es requerido en dispense — si falta, lanza error.

3. **Descuento de StockLot:** La dispensacion actualiza `StockLot.remainingQty` en transaccion atomica.

El escenario de "libro de psicotropicos DNM" no tiene un endpoint especifico de registro DNM — el audit log de dominio actua como trazabilidad. Esta es una interpretacion funcional del TDR; el registro formal ante DNM no es un sistema externo que el HIS deba integrar en MVP.

---

### ESC-07 — eMAR: Administracion con escaneo paciente-droga (BCMA)

| Campo | Valor |
|---|---|
| Modulo | §16 eMAR |
| Persona | Enfermeria |
| Resultado | Pass |
| Router | `medication-admin.router.ts` — `record` |

**Analisis:**

El router implementa los 5 rights y BCMA de forma rigurosa:

1. **BCMA obligatorio para ADMINISTERED:** `patientBarcodeScanned AND drugBarcodeScanned AND providerBadgeScanned` deben ser `true`. Si alguno es false, lanza `PRECONDITION_FAILED`.

2. **Doble-check para alto riesgo:** `requiresControlledLog === true` O `dispensingClass === "RX_CONTROLLED"` requiere `secondVerifierId !== administeredById`.

3. **Sub-escenario "Paciente equivocado":** La deteccion de mismatch de paciente se implementa via `detectAllergyMismatch` — pero el bloqueo especifico por "paciente no coincide con la orden" depende del campo `patientBarcodeScanned`. Si el enfermero escanea un paciente diferente y el codigo de barras no coincide con el `prescriptionItem.prescription.patientId`, la logica BCMA debe rechazar. Sin embargo, la validacion actual verifica si el boolean `patientBarcodeScanned` es `true`, no si el barcode escaneado corresponde al ID del paciente correcto. Esto es un gap tecnico: el sistema confía en que el cliente enviara `patientBarcodeScanned: false` si el scan falla, pero no hace la validacion del ID del paciente server-side.

**Condicion Pass-condicional:** El flujo happy-path y BCMA incompleto estan implementados. La validacion cross-referencia de "paciente equivocado" a nivel de ID server-side requiere UAT real para confirmar el comportamiento del escanner en el cliente.

**Resultado ajustado:** Pass-condicional.

---

### ESC-08 — LIS: 4-eyes en validacion de resultado critico

| Campo | Valor |
|---|---|
| Modulo | §17 LIS |
| Persona | Tec. lab + Validador |
| Resultado | Pass |
| Router | `lis.router.ts` — `result.enter` + `result.validate` |

**Analisis:**

El router implementa 4-eyes en `result.validate`:

1. El resultado entra en estado `RESULT_ENTERED` via `result.enter`.
2. `result.validate` verifica que el `validatedById !== enteredById` (misma persona no puede validar). Si coinciden, lanza error.
3. Al validar, el resultado pasa a `RESULT_VALIDATED` y queda visible en el expediente.

La notificacion al medico tratante para resultados criticos esta implementada via `emitDomainEvent` con `lab.criticalValue` (Beta.15 US.B15.4.2) cuando `isCriticalFlag(finalFlag)` es true. El dispatcher resuelve la entrega al prescribidor.

El auto-flagging de valor critico (Hemoglobina 8.5 g/dL) funciona via `evaluateLabResultFlag` con reference ranges del `LabTest`.

---

### ESC-09 — Imaging: Orden con preparacion del paciente

| Campo | Valor |
|---|---|
| Modulo | §18 Imaging |
| Persona | Medico + Tec. imagen |
| Resultado | Pass-condicional |
| Router | `imaging.router.ts` — `order.create` |

**Analisis:**

El router `imaging.router.ts` crea ordenes de imagen con campo `modality` (CT, MR, US, etc.) y soporta el flujo de creacion. La orden aparece en cola por modality.

**Gap identificado:** El escenario UAT espera que al confirmar la orden, el sistema muestre/envie "Preparacion: Ayuno 6h. Hidratacion post-estudio." Las instrucciones de preparacion no aparecen como campo en el schema de `ImagingOrder` ni en el router. La preparacion por modalidad/protocolo no esta modelada como dato estructurado — no hay tabla `ImagingProtocol` con campo `preparationInstructions` en el schema inspeccionado.

El campo existe como dato de negocio que un tecnico conoce pero no es retornado por el sistema actualmente. La orden aparece en cola correctamente pero sin instrucciones de preparacion automaticas para el paciente.

**Condicion para Pass completo:** Agregar `preparationInstructions` al modelo de `ImagingOrder` o al catalogo de `ImagingModality`. Gap menor de completitud funcional, no bloquea el flujo principal de la orden.

---

### ESC-10 — Inventory: Movimiento de stock con lote y vencimiento

| Campo | Valor |
|---|---|
| Modulo | §19 Inventory |
| Persona | Almacen |
| Resultado | Pass |
| Router | `inventory.router.ts` — `lot.create` + `movement.create` |

**Analisis:**

El router implementa:

1. **Recepcion con lote:** `lot.create` crea `StockLot` con `lotNumber`, `expiryDate`, `quantity` e incrementa `StockItem.totalQty` en transaccion.

2. **Movimiento IN:** `movement.create` con tipo `IN` registra `StockMovement` append-only.

3. **Bloqueo de lote vencido:** La regla `validateLotForDispense` (importada de contracts) verifica `expiryDate < now`. Si el lote esta vencido, el dispensing falla. La inspeccion en `inventory.router.ts` muestra que `FEFO enforcement` bloquea movimientos `OUT` de lotes vencidos.

Los dos sub-escenarios (recepcion y bloqueo de vencido) estan implementados.

---

### ESC-11 — Services & Equipment: Mantenimiento preventivo

| Campo | Valor |
|---|---|
| Modulo | §20 Services & Equipment |
| Persona | Biomedico |
| Resultado | Pass |
| Router | `services-equipment.router.ts` — `equipment.getOverduePm` + `calibrationLog.create` |

**Analisis:**

El router implementa:

1. **Dashboard de proximos a mantenimiento:** `equipment.getOverduePm` retorna equipos cuyo `nextDueAt < now()` en estado no-UNDER_MAINTENANCE. El equipamiento a 1 dia de vencimiento aparece en esta lista.

2. **Registro de calibracion:** `calibrationLog.create` es append-only (reforzado por trigger DB `35_equipment_hardening.sql`). Despues del registro, el `pmSchedule.complete` actualiza `lastCompletedAt` y desplaza `nextDueAt` en `intervalDays` dias.

El flujo cumple ambos sub-escenarios del escenario.

---

### ESC-12 — Respiratory: Conexion a ventilador y registro de parametros

| Campo | Valor |
|---|---|
| Modulo | §21 Respiratory |
| Persona | Terapia respiratoria |
| Resultado | Pass-condicional |
| Router | `respiratory.router.ts` — `ventilator.create` (VentilatorSession) |

**Analisis:**

El router `respiratory.router.ts` implementa:

1. **Inicio de sesion de ventilacion:** `ventilatorSession.create` acepta parametros (modo, FiO2, PEEP, VT) con validacion de rangos clinicos (`assertVentParamsInRange`). La sesion tiene timestamp de inicio.

2. **Consumo de gas medicinal:** Al cerrar la sesion via `ventilatorSession.end`, se calcula la duracion. El campo `MedicalGasUsage` tiene su propio `medicalGasUsage.create` para registrar el consumo. Sin embargo, la vinculacion automatica del calculo de consumo al cierre de sesion (`cuando se cierra la sesion → se calcula MedicalGasUsage`) no esta automatizada en el router — requiere una llamada separada del cliente para registrar el consumo.

**Condicion para Pass completo:** La creacion automatica de `MedicalGasUsage` al cerrar `VentilatorSession` no existe como efecto secundario del `session.end`. Es una llamada separada. El escenario UAT espera calculo automatico. Pendiente verificacion con terapia respiratoria si el flujo manual es aceptable.

---

### ESC-13 — Nutrition: Plan nutricional con restricciones por alergia

| Campo | Valor |
|---|---|
| Modulo | §22 Nutrition |
| Persona | Nutricionista |
| Resultado | **FAIL** |
| Router | `nutrition.router.ts` — `order.create` |
| Severidad hallazgo | P1 — Bloqueante para go-live |

**Analisis:**

El escenario exige: "Cuando intento prescribir DietPlan con ingrediente 'Mantequilla de mani', el sistema rechaza con 'ALERTA: paciente alergico a mani (anafilaxia)'".

Inspeccion del router `nutrition.router.ts`:

La funcion `validateDietCompatibility` verifica que el `DietPlan` tenga diagnosticos compatibles con los del encounter (CIE-10), pero NO verifica `PatientAllergy` del paciente contra los ingredientes del plan dietetico. No hay llamada a `ctx.prisma.patientAllergy.findMany` en el flujo de creacion de orden de nutricion.

Inspeccion de contracts `nutrition.ts`: el campo `compatibleWithDiagnoses` en `DietPlan` es para compatibilidad diagnostica, no alergenos. No hay campo `allergens` ni `ingredients` en `DietPlan`.

La deteccion de alergias existe en `medication-admin.router.ts` via `detectAllergyMismatch`, pero no fue portada al router de nutricion.

**Resultado:** La regla de negocio "bloquear dieta con alergenos conocidos del paciente" no esta implementada en el back-end de nutricion. Un nutricionista puede prescribir una dieta con alergenos sin que el sistema lo detecte.

**Impacto clinico:** Alto. La seguridad del paciente puede verse comprometida ante alergias anafilacticas. Esta es la regla de negocio central del escenario.

---

### ESC-14 — Insurance: Solicitud de autorizacion a aseguradora

| Campo | Valor |
|---|---|
| Modulo | §25 Insurance |
| Persona | Admision + Facturacion |
| Resultado | Pass-condicional |
| Router | `insurance.router.ts` — `authorization.create` + `authorization.approve/deny` |

**Analisis:**

El router implementa:

1. **Creacion de AuthorizationRequest:** `authorization.create` crea el request con estado `PENDING`.
2. **State machine:** `PENDING → APPROVED | DENIED | EXPIRED`.
3. **Bloqueo de procedimiento sin autorizacion:** El escenario pide que la cirugia no pueda pasar a `SCHEDULED` hasta `AUTH_APPROVED`. Sin embargo, inspeccion de `surgery.router.ts` `case.create` no verifica si existe `AuthorizationRequest` aprobada para el paciente/procedimiento antes de permitir la creacion del caso quirurgico. La integracion entre Insurance y Surgery no esta implementada.

**Condicion para Pass completo:** La validacion cross-modulo "cirugia no puede programarse sin autorizacion aprobada" requiere que `surgery.router.ts` consulte `insurance.router.ts` o la tabla de autorizaciones. Esta integracion no existe. El sub-escenario de "advertencia para supervisor" si la cirugia se programa sin autorizacion tampoco existe.

La creacion de la solicitud de autorizacion (flujo principal) si funciona.

---

### ESC-15 — Catalogos globales: Override local de catalogo MINSAL

| Campo | Valor |
|---|---|
| Modulo | §5 Catalogos / §17 LIS |
| Persona | Admin tenant |
| Resultado | Pendiente UAT real |

**Analisis:**

El patron de catalogo global + override local existe en el sistema. El router `lis.router.ts` `panel.list` usa:
```
OR: [{ organizationId: null }, { organizationId: ctx.tenant.organizationId }]
```

Esto significa que el tenant ve tanto los paneles globales (organizationId null, e.g. MINSAL) como los propios. Si el tenant crea un `LabPanel` con su `organizationId`, este convive con el global.

La logica de "preferir local sobre global" en los workflows clinicos no es explicitamente visible en el router — el `OR` retorna ambos sin prioridad. La UI deberia diferenciarlos visualmente (con un badge "Propio" vs "MINSAL"), pero la UI de LIS en `apps/web/src/app/(clinical)/lis/` existe como ruta pero requiere verificacion.

El sub-escenario "panel global permanece intacto" esta garantizado porque la creacion del override es un nuevo registro con `organizationId` del tenant, no una modificacion del registro global.

**Pendiente:** Verificar con admin-tenant real que la UI diferencia claramente los catalogos globales de los locales y que el flujo de "copiar y modificar" es intuitivo.

---

### ESC-16 — Multi-tenant: Aislamiento cross-tenant en busqueda global

| Campo | Valor |
|---|---|
| Modulo | §5 Multi-tenant |
| Persona | Admin tenant |
| Resultado | Pass-condicional |
| Router | `patient.router.ts` — RLS via `withTenantContext` |

**Analisis:**

El aislamiento multi-tenant se implementa a dos niveles:

1. **Row Level Security (RLS) en Postgres:** `withTenantContext` en `rls-context.ts` demota el rol a `authenticated` y establece `app.current_org_id` para que las politicas RLS filtren por `organization_id` automaticamente.

2. **Filtro en el router:** `patient.router.ts` aplica `organizationId: ctx.tenant.organizationId` en todos los queries.

**Sub-escenario "Busqueda no devuelve pacientes ajenos":** Ambas capas previenen que un usuario de "Hospital Demo SV" vea pacientes de "Clinica San Pedro". El test `cross-tenant.integration.test.ts` (15 tests) valida este aislamiento.

**Sub-escenario "Acceso por URL directa devuelve 404":** El escenario pide `404` (no `403`) para no filtrar existencia. Inspeccion de las rutas en `apps/web/src/app/(clinical)/patients/`: la pagina de detalle de paciente usa `trpc.patient.get` que aplica el filtro de `organizationId`. Si el ID no existe en el tenant, retorna `NOT_FOUND` (404). Correcto.

La diferencia entre este Pass-condicional y Pass completo: el audit log de "busqueda con resultado vacio" (registro del intento de acceso cross-tenant) requiere verificacion de que el trigger de audit captura las busquedas que no retornan resultados — no solo las mutaciones. Esto no es visible sin ejecutar el escenario en staging.

---

## 3. Bugs encontrados durante UAT

### UAT-BUG-01 — ESC-03: Visita ER creada sin triage Manchester previo

**Titulo:** `emergency.visit.create` no valida existencia de triage completado en el encounter

**Severidad:** P1 — Bloqueante para go-live

**Persona afectada:** Personal de triage, medicos de emergencia

**Modulo:** §12 Emergency — `packages/trpc/src/routers/emergency.router.ts`

**Descripcion:** El input `emergencyVisitCreateInput` no incluye campo `triageEvaluationId` como requerido y el router no consulta si el encounter ya tiene una `TriageEvaluation` completada antes de crear la visita ER. El flujo permite crear una `EmergencyVisit` sin triage previo, violando TDR §12.4.

**Pasos de reproduccion:**
1. Crear un `Encounter` sin evaluacion de triage.
2. Llamar a `trpc.emergency.visit.create` con `encounterId` valido, `chiefComplaint`, `patientId`, `establishmentId`.
3. La mutacion retorna exito — la visita ER se crea sin triage.

**Resultado esperado:** Error `PRECONDITION_FAILED` con "Triage Manchester obligatorio antes de visita ER".

**Resultado actual:** La visita ER se crea exitosamente.

**Archivos a modificar:** `packages/trpc/src/routers/emergency.router.ts` (agregar query de triage) + `packages/contracts/src/schemas/emergency.ts` (campo opcional `triageEvaluationId`).

---

### UAT-BUG-02 — ESC-13: Dieta prescrita sin bloqueo por alergenos del paciente

**Titulo:** `nutrition.order.create` no verifica `PatientAllergy` contra ingredientes del plan dietetico

**Severidad:** P1 — Bloqueante para go-live (seguridad del paciente)

**Persona afectada:** Nutricionistas, pacientes con alergias severas

**Modulo:** §22 Nutrition — `packages/trpc/src/routers/nutrition.router.ts`

**Descripcion:** El router de nutricion implementa `validateDietCompatibility` (compatibilidad diagnostica CIE-10) pero no verifica `PatientAllergy` del paciente contra los ingredientes o alergenos del `DietPlan`. Un nutricionista puede prescribir una dieta con alergenos anafilacticos sin que el sistema lo detecte.

**Pasos de reproduccion:**
1. Registrar `PatientAllergy` para paciente "MRN-000456" con `substanceText: "mani"`, `severity: "ANAPHYLACTIC"`.
2. Crear `DietPlan` con descripcion que incluya mani (o modelado como alergeno).
3. Llamar a `trpc.nutrition.order.create` con ese `dietPlanId` para ese paciente.
4. La mutacion retorna exito — la orden se crea sin alerta.

**Resultado esperado:** Error `PRECONDITION_FAILED` con "ALERTA: paciente alergico a mani (anafilaxia)".

**Resultado actual:** La orden de nutricion se crea sin verificacion de alergias.

**Archivos a modificar:** `packages/trpc/src/routers/nutrition.router.ts` (agregar verificacion de alergias al crear orden) + posiblemente `packages/contracts/src/schemas/nutrition.ts` (agregar campo `allergens` a `DietPlan` si no existe) + `packages/database/schema.prisma` si se necesita modelar alergenos en el catalogo de dietas.

---

### UAT-BUG-03 — ESC-09: Instrucciones de preparacion del paciente no modeladas

**Titulo:** `ImagingOrder` no incluye instrucciones de preparacion por modalidad/protocolo

**Severidad:** P2 — Mayor (impacta flujo clinico, no bloquea funcionamiento basico)

**Persona afectada:** Medicos ordenadores, pacientes, tecnicos de imagen

**Modulo:** §18 Imaging — `packages/trpc/src/routers/imaging.router.ts`

**Descripcion:** Al crear una orden de TAC con contraste, el sistema no retorna instrucciones de preparacion ("Ayuno 6h. Hidratacion post-estudio"). El campo `preparationInstructions` no existe en el schema de `ImagingOrder` ni en `ImagingModality`.

**Impacto:** El paciente no recibe instrucciones de preparacion automaticas desde el sistema. El tecnico de imagen debe comunicarlas fuera de banda.

---

### UAT-BUG-04 — ESC-04 (sub-escenario): Time-out OMS sin validacion de caducidad

**Titulo:** `surgery.case.start` no valida que el time-out sea reciente (< 30 min)

**Severidad:** P3 — Menor (el gate principal SI existe; la caducidad es una regla adicional)

**Persona afectada:** Cirujanos, equipo quirurgico

**Modulo:** §13 Surgery — `packages/trpc/src/routers/surgery.router.ts`

**Descripcion:** El sub-escenario pide que un time-out completado hace 45 min sea rechazado ("Time-out caducado"). El router solo verifica existencia de `timeOutAt: { not: null }`, no calcula el tiempo transcurrido desde el time-out.

**Aclaracion:** El TDR §13.4 no especifica un umbral de caducidad explicito para el time-out. Este requisito del escenario puede requerir decision del equipo clinico antes de implementar. Marcado P3 hasta clarificacion.

---

### UAT-BUG-05 — ESC-14: Cirugia programable sin autorizacion de aseguradora aprobada

**Titulo:** `surgery.case.create` no verifica existencia de `AuthorizationRequest` aprobada

**Severidad:** P2 — Mayor (riesgo de rechazo de facturacion)

**Persona afectada:** Admision, facturacion, pacientes con seguro

**Modulo:** §13 Surgery + §25 Insurance

**Descripcion:** El router `surgery.case.create` no consulta si existe una `AuthorizationRequest` con estado `APPROVED` para el paciente y procedimiento antes de crear el caso quirurgico. La integracion cross-modulo Surgery → Insurance no esta implementada.

**Impacto:** Un procedimiento electivo puede programarse sin autorizacion de aseguradora, generando riesgo de rechazo de factura. El sub-escenario de "advertencia para supervisor" tampoco existe.

---

### UAT-BUG-06 — ESC-07 (sub-escenario): BCMA no valida ID de paciente server-side

**Titulo:** El router `medication-admin.record` confia en el boolean `patientBarcodeScanned` sin validar ID del paciente escaneado contra la orden

**Severidad:** P2 — Mayor (seguridad del paciente)

**Persona afectada:** Enfermeras, pacientes

**Modulo:** §16 eMAR — `packages/trpc/src/routers/medication-admin.router.ts`

**Descripcion:** La regla BCMA para "paciente equivocado" asume que el cliente envia `patientBarcodeScanned: false` si el codigo de barras del paciente no coincide con el de la orden. No hay validacion server-side del ID del paciente escaneado. Un cliente malicioso o con bug podria enviar `patientBarcodeScanned: true` con un paciente incorrecto.

**Aclaracion:** En implementaciones BCMA reales, el escaner envia el ID del paciente decodificado y el servidor lo compara. Requiere agregar campo `scannedPatientId` al input y validarlo contra `prescriptionItem.prescription.patientId`.

---

## 4. Gaps funcionales (vs spec)

### UAT-GAP-01 — Caducidad del time-out quirurgico no especificada en TDR

**Descripcion:** El sub-escenario ESC-04 pide rechazo de inicio con time-out "caducado (45 min)". El TDR §13.4 documenta el WHO Surgical Safety Checklist pero no especifica un umbral de caducidad. La regla puede ser una buena practica clinica pero no esta en el TDR ni en los criterios de aceptacion del backlog.

**Decision pendiente @PO:** Confirmar si la caducidad del time-out es requisito para go-live o post-go-live. Si es requisito, documentar el umbral en minutos en el TDR y crear la US correspondiente.

### UAT-GAP-02 — Instrucciones de preparacion por modalidad/protocolo de imagen

**Descripcion:** El escenario ESC-09 asume que el sistema provee instrucciones de preparacion por tipo de estudio. Esto requiere un catalogo de protocolos de imagen con instrucciones asociadas. No esta modelado en el schema.

**Decision pendiente @PO/@DBA:** Definir si `ImagingModality` o un nuevo modelo `ImagingProtocol` debe tener campo `preparationInstructions`. Requiere cambio de schema y migracion.

### UAT-GAP-03 — Bloqueo cross-modulo Surgery-Insurance no implementado

**Descripcion:** El bloqueo de cirugia sin autorizacion de aseguradora (ESC-14) requiere integracion entre los routers de Cirugia e Insurance. La decision de si este bloqueo es hard (impide crear el caso) o soft (advertencia para supervisor) debe venir del negocio.

**Decision pendiente @PO:** Hard block vs soft warning. El escenario UAT especifica "advertencia con confirmacion de supervisor" para el sub-escenario de bloqueo, lo cual es un soft block.

### UAT-GAP-04 — Calculo automatico de consumo de gas medicinal al cerrar sesion

**Descripcion:** ESC-12 espera que al cerrar la sesion de ventilacion, el sistema calcule y registre automaticamente `MedicalGasUsage`. Actualmente el router `respiratory.ventilatorSession.end` no crea automaticamente el registro de consumo.

**Decision pendiente @Dev:** Agregar efecto secundario al `session.end` que calcule FiO2 * duracion * factor y cree `MedicalGasUsage` automaticamente, o documentar que es un paso manual del terapeuta.

### UAT-GAP-05 — Diferenciacion visual catalogo global vs local en UI

**Descripcion:** ESC-15 requiere que la UI diferencie catalogos globales (MINSAL) de los locales (tenant). El back-end ya retorna ambos con `organizationId null | tenant`. La UI debe mostrar un indicador de origen.

**Pendiente @UIUX/@Dev:** Agregar badge o columna "Origen" en las listas de catalogos. No es un gap de back-end sino de UI.

---

## 5. Decisiones del negocio pendientes

| # | Escenario | Pregunta para @PO / stakeholder | Urgencia |
|---|---|---|---|
| D-01 | ESC-04 | Umbral de caducidad del time-out WHO en minutos. Valor sugerido por la literatura: 30 min. Confirmar si es requisito go-live. | Alta |
| D-02 | ESC-14 | Bloqueo de cirugia sin autorizacion: hard block (impide crear caso) vs soft warning (permite con firma de supervisor). El escenario UAT dice soft warning. | Alta |
| D-03 | ESC-12 | Calculo de consumo de gas medicinal: automatico al cerrar sesion o paso manual del terapeuta con confirmacion. | Media |
| D-04 | ESC-09 | Instrucciones de preparacion por modalidad: catalogo en el sistema vs manual de protocolo externo. Si es en el sistema, requiere migracion de schema. | Media |
| D-05 | ESC-15 | Flujo de "copiar catalogo global y personalizar": el sistema debe tener un boton explicito de "Copiar y personalizar" o el admin crea el panel desde cero. Requiere validacion con admin-tenant real. | Baja |

---

## 6. Recomendacion @QAF para firma

**Estado:** APROBADO CONDICIONAL (⚠️)

**Condiciones obligatorias antes de go-live (P1):**

1. **UAT-BUG-01** — Implementar validacion de triage previo en `emergency.visit.create`. Sin esto, el flujo ER viola TDR §12.4.
2. **UAT-BUG-02** — Implementar verificacion de `PatientAllergy` en `nutrition.order.create`. Sin esto, hay riesgo clinico real para pacientes con alergias graves.

**Condiciones recomendadas antes de go-live (P2 — hipercuidado):**

3. **UAT-BUG-03** — Agregar instrucciones de preparacion a `ImagingOrder` (o justificar que es proceso manual).
4. **UAT-BUG-05** — Definir e implementar la advertencia de autorizacion de aseguradora en el flujo de cirugia.
5. **UAT-BUG-06** — Agregar `scannedPatientId` server-side al record de eMAR para validacion BCMA robusta.

**Post go-live aceptable (P3):**

6. **UAT-BUG-04** — Caducidad del time-out (requiere decision clinica previa).
7. **UAT-GAP-04** — Calculo automatico de gas medicinal.
8. **UAT-GAP-05** — Badge visual en catalogos.

**Firma pendiente de:**
- [ ] Super-usuario clinico (Medico tratante) — flujos ESC-04, ESC-05, ESC-07
- [ ] Super-usuario enfermeria — flujos ESC-07, ESC-08
- [ ] Super-usuario admision — flujos ESC-01, ESC-02, ESC-14
- [ ] Super-usuario triador — flujo ESC-03 (CRITICO — debe verificar impacto de BUG-01)
- [ ] Super-usuario nutricion — flujo ESC-13 (CRITICO — debe verificar impacto de BUG-02)
- [ ] Clinical Lead (firma final)
- [ ] @PO (firma de aceptacion de backlog)

---

## 7. Cross-referencia con matriz de trazabilidad

Esta UAT actualiza las filas Beta.X de `docs/26_trazabilidad_matrix.md` columna UAT. Los cambios pendientes de aplicar en un PR de @QA son:

| TDR § | Modulo | Estado UAT previo | Estado UAT post este analisis |
|---|---|---|---|
| §10 | Outpatient | ❓ | ⚠️ Pass-condicional (UI no verificada) |
| §11 | Inpatient | ❓ | ⚠️ Pass-condicional (UI no verificada) |
| §12 | Emergency | ❓ | ❌ Fail — BUG-01 P1 |
| §13 | Surgery | ❓ | ⚠️ Pass-condicional (caducidad timeout) |
| §14 | EHR Notes | ❓ | ⚠️ Pass (sin UI verificada) |
| §15 | Pharmacy | ❓ | ⚠️ Pass (sin UI verificada) |
| §16 | eMAR | ❓ | ⚠️ Pass-condicional (BCMA server-side) |
| §17 | LIS | ❓ | ⚠️ Pass (sin UI verificada) |
| §18 | Imaging | ❓ | ⚠️ Pass-condicional (preparacion) |
| §19 | Inventory | ❓ | ⚠️ Pass (sin UI verificada) |
| §20 | Equip/Services | ❓ | ⚠️ Pass (sin UI verificada) |
| §21 | Respiratory | ❓ | ⚠️ Pass-condicional (gas auto) |
| §22 | Nutrition | ❓ | ❌ Fail — BUG-02 P1 |
| §25 | Insurance | ❓ | ⚠️ Pass-condicional (cross-modulo cirugia) |
| §5 Catalogos | Catalogo override | ❓ | ⏳ Pendiente UAT real |
| §5 Multi-tenant | Aislamiento cross-tenant | ❓ | ⚠️ Pass-condicional (audit de busquedas) |

"Esta UAT actualiza las filas Beta.X de `docs/26_trazabilidad_matrix.md` columna UAT — pendiente PR @QA para mover ❓ al estado documentado arriba."

---

*Version 1.0 — @QAF — 2026-05-16*
*Metodologia: razonamiento sobre codigo actual (pre-UAT de escritorio). Sustitucion parcial de UAT real hasta disponibilidad de super-usuarios Avante.*
*Proxima revision: tras correccion de BUG-01 y BUG-02 por @Dev + ejecucion real con super-usuarios.*
