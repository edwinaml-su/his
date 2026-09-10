# RN-HIS-BOT-001 — Re-verificación post-remediación (docs/48 Olas 1-4)

**Evaluador:** @DrHIS · **Fecha:** 2026-09-09 · **Ambiente:** código en `main` (worktree `C:\proyecto\HIS\.claude\worktrees\agent-a5863a0d726735431`, HEAD `1b25ed0`) + Supabase producción `ejacvsgbewcerxtjtwto` (MCP en modo **solo lectura**, únicamente `SELECT`, cero escrituras).
**Insumos:** `docs/47_rn_his_bot_001_botiquin_cargos.md` (RN) · `docs/qa/drhis/RN-HIS-BOT-001-verificacion-his-multipais.md` (dictamen PRE-remediación) · `docs/qa/drhis/RN-HIS-BOT-001-addendum-ola0.md` (cierre de "No verificado") · `docs/48_plan_remediacion_cargos_cuentas.md` (plan ejecutado, Olas 0-4, PRs #623-#628).
**Método:** lectura directa de código (Read/Grep) de `charge-capture.ts`, `dispensation.router.ts`, `invoice.router.ts`, `patient-account.router.ts`, `conciliacion-cargos.router.ts`, `pharmacy.router.ts`, `lis.router.ts`, `imaging-request.router.ts`, `inventory.router.ts`, `gs1-proceso-{a,c}.router.ts`, `price-resolver.ts`, `schema.prisma`, SQL 224-226; ejecución real de 10 suites de test unitarias (`vitest run`, no mockeadas por mí — se corrieron de verdad); consultas `SELECT` contra prod. No se levantó `npm run dev` ni se recorrió pantalla en browser — mismo criterio que el dictamen previo (el circuito de negocio se decide en el router antes de llegar a la UI), salvo para dos hallazgos nuevos donde sí fue necesario verificar la UI (H-14, H-15 abajo).

## Resumen ejecutivo

La remediación cierra el hallazgo central (H-01: dispensar no cobraba nada) **para el camino que la UI de dispensación bedside realmente usa** (`dispensation.router.ts`): hoy `reserveItem`/`scanItem` capturan el cargo, con precio resuelto server-side, congelado con lista/regla/fecha, en la misma transacción que el descuento de inventario — y `cancelReservation` revierte ese cargo (nunca lo borra) junto con la reposición del lote. El mismo patrón (`capturarCargo`) se extendió a laboratorio e imágenes. Las 8 tablas financieras quedaron con hash-chain de auditoría, verificado en prod. Todo esto está confirmado con evidencia directa de código, tests que corren y pasan, y consultas SQL contra producción — no es una promesa de documento.

Pero la re-verificación adversarial encontró **tres huecos reales que docs/48 no vio**, y que son releventes precisamente porque el plan sí resolvió lo que se propuso resolver:

1. **`pharmacy.router.ts` tiene un segundo camino de dispensación (`dispense.create`) que nunca decrementa inventario real ni pasa por `capturarCargo`** — y es exactamente ese camino el que alimenta el nuevo "libro de controlados" (C4-4). La UI real de dispensación (`/pharmacy/dispense/[orderId]`) usa `dispensation.reserveItem`, no `pharmacy.dispense.create` — no hay ningún `.tsx` en todo `apps/web` que llame a `pharmacy.dispense.create`. Resultado: **el libro de controlados que exige la Ley Reguladora de Actividades Relativas a las Drogas quedará vacío en operación real**, porque el flujo que sí registra testigo/justificación de controlados no es el que dispensa de verdad, y el que dispensa de verdad no tiene ningún control de doble verificación para controlados.
2. **`scanItem` — que ahora escribe un cargo financiero real (`capturarCargo`) — no tiene el mismo candado de rol que `reserveItem`.** Es `tenantProcedure` sin `requireRole`/`abacGuard`; antes de esta ola su peor caso era un movimiento de inventario mal hecho, ahora su peor caso incluye crear un cargo a la cuenta de un paciente.
3. **Persisten dos vías estructurales para sacar inventario sin nexo de paciente ni cargo** (`inventory.out`, `inventory.consumo`) **sin restricción de rol** — `consumo` es nueva (Ola 3, C3-3) y por diseño correctamente nunca llama a `capturarCargo` (es consumo institucional), pero al no exigir rol, cualquier usuario del tenant puede sacar cualquier ítem/lote por esa vía "disfrazado" de merma/aseo, sin que el reporte de conciliación lo detecte (ese reporte busca `reason ILIKE '%dispensaci%'`, un patrón que ni `out` ni `consumo` producen).

Ninguno de estos tres es un "hallazgo pequeño": el primero vacía de contenido un control regulatorio que la propia Ola 4 acaba de construir; el segundo y el tercero reabren, por una puerta distinta, el mismo problema financiero que la Ola 2 acaba de cerrar por la puerta principal.

**Conteo comparativo:**

- **R1-R13:** antes **1 Cumple / 5 Parcial / 6 No cumple / 1 No verificado** → ahora **6 Cumple / 4 Parcial / 3 No cumple / 0 No verificado** (ver matriz completa, incluye los 7 "No verificado" originales de la matriz de 24 pasos, cerrados en el addendum Ola 0).
- **Matriz de 24 pasos:** antes **6 Cumple / 3 Parcial / 8 No cumple / 7 No verificado** → ahora **13 Cumple / 6 Parcial / 5 No cumple / 0 No verificado**.
- **Pruebas de aceptación (8):** antes **0/8 ejecutables** (ninguna, ni siquiera parcialmente, salvo consultas manuales aisladas) → ahora **3/8 ejecutables y verificadas por test unitario hoy** (#4, #6, #7), **4/8 ejecutables por diseño pero bloqueadas solo por falta de datos de negocio reales** (#1, #2, #3, #8 — Ola 5/C5-1 pendiente), **1/8 sigue estructuralmente bloqueada** (#5, entrega parcial — R6 no fue parte del alcance del plan).

---

## 1. Matriz R1-R13 — antes → ahora

| # | Regla | Antes | Ahora | Evidencia (código actual) |
|---|---|---|---|---|
| R1 | Precondición de episodio (excepción emergencia sin pagador) | Parcial | **Cumple** (para el camino nominativo real) | `capturarCargo` exige cuenta `ABIERTA`\|`PENDIENTE_REGULARIZAR` vía `resolverCuentaActiva`, lanza `PRECONDITION_FAILED` si no hay ninguna (`charge-capture.ts:89-168`). La excepción de emergencia ya no es "ausencia total de precondición" sino un estado real: `patientAccountRouter.crear` con `emergenciaSinPagador:true` abre en `PENDIENTE_REGULARIZAR` (`patient-account.router.ts:56-115`). **Salvedad nueva:** `inventory.out`/`inventory.consumo` (`inventory.router.ts:314,396`) siguen sin invocar `capturarCargo` ni exigir cuenta — ver H-11/H-12 abajo. |
| R2 | Origen clínico obligatorio | Cumple | **Cumple** (sin cambios) | `SIN_RECETA_ACTIVA` sigue siendo hard-stop real en `scanItem`/`reserveItem` (`dispensation.router.ts:357-369,676-681`). Los tipos hoja de gastos/terapia respiratoria siguen sin anclaje porque no tienen caller (`CHARGE_ORIGINS` los define pero nadie los usa — `charge-origin.ts:9-12`). |
| R3 | Resolución determinista del precio (nunca a 0) | No cumple para el flujo real; Cumple como librería aislada | **Cumple** | `capturarCargo` llama `resolverPrecio` server-side dentro de la misma tx (`charge-capture.ts:170-175`); `invoice.create` ahora también re-resuelve server-side y solo acepta `unitPrice` distinto con `overridePrecio.justificacion` + rol ADMIN/DIR (`invoice.router.ts:389-436`, `ROLES_OVERRIDE_PRECIO` línea 32). Nunca cae a 0: sin precio resoluble y sin override ⇒ `PRECONDITION_FAILED` (factura) o línea `PENDIENTE_TARIFA` (cargo). |
| R4 | Congelamiento del precio en el acto | No cumple | **Cumple** | `PatientAccountService`/`InvoiceItem` persisten `priceListId`/`priceRuleId`/`resolvedAt`/`priceSource` (`schema.prisma:8124-8129,7922-7926`; SQL 224). En prod: 0/999 `ServicePriceRule` sin `dateStart` (backfill + `addRule` ahora exige `dateStart` obligatorio, `service-price-rule.ts:133`, y auto-cierra la vigencia de la regla anterior del mismo objetivo, `service-price-list.router.ts:689-713`). |
| R5 | Un solo registro, transacción atómica | No cumple | **Parcial** | Cumple en el camino que la UI usa: `capturarCargo` corre en la misma `tx` que `validateAndDecrementStock` en `scanItem`/`reserveItem` (`dispensation.router.ts:563,767`) y que la creación de la orden en lab/imágenes (`lis.router.ts:1059`, `imaging-request.router.ts:355`). El puente `ece.*`→`public.Stock*` (H-06) se cerró con `upsertStockFromRecepcion` en la misma tx que la recepción (`gs1-proceso-a.router.ts:72-158`, testeado). **No cumple en dos caminos paralelos que siguen vivos**: `pharmacy.router.ts:dispense.create` (H-13, no toca `Stock*` — comentario propio del código: "Wave 1: no DrugStock todavía") y `inventory.out`/`consumo` (H-11/H-12, no tocan `PatientAccountService`, sin rol). |
| R6 | Cantidad efectiva (entregada vs. solicitada) | No cumple (concepto distinto) | **No cumple** (sin cambios) | Fuera del alcance de docs/48 (no aparece en el backlog). El modelo sigue siendo unidad-por-escaneo (`quantity: 1` hardcodeado en las dos llamadas a `capturarCargo` de dispensación, `dispensation.router.ts:569,773`). |
| R7 | Devolución trazable (mismo lote, reversión, sin borrar original) | Parcial | **Cumple** | `cancelReservation` ahora llama `revertirCargo` en la misma tx que la reposición del lote (`dispensation.router.ts:878-898`). `revertirCargo` marca el original `REVERTIDO` (nunca se borra) y crea una línea `REVERSION` con signo negativo enlazada por `reversalOfId` (`charge-capture.ts:269-319`), con protección contra doble reversión (verificado por test: `charge-capture.test.ts:358-370`). |
| R8 | Paridad ambulatorio/hospitalizado | No verificado | **Cumple** (paridad por omisión, aceptada explícitamente para v1) | Cerrado en el addendum Ola 0: `dispensationRouter` no contiene la palabra "encounter" como discriminador de camino financiero; el pivote de precio es `TipoCuenta`, ortogonal al tipo de encuentro (`addendum-ola0.md` fila R8). No es una paridad diseñada línea por línea, es que el código no discrimina — documentado como aceptable para esta versión. |
| R9 | Segregación de funciones (solicitante ≠ despachador) | Parcial | **Parcial** (mejora real, con hallazgo nuevo) | `reserveItem` y `scanItem` ahora rechazan con `FORBIDDEN` si `prescription.prescriberId === actorId` (identidad, no solo rol) — `dispensation.router.ts:438-441,688-693`, verificado por los 30+20 tests que pasan. **Pero** `scanItem` (que desde esta ola también crea el cargo financiero) sigue sin `requireRole`/`abacGuard` — solo `reserveItem` los tiene (`dispensation.router.ts:398` vs. `654,659`). Ver H-14. |
| R10 | Medicamentos controlados (doble verificación, lote/serie, libro) | Parcial grave (2-eyes se valida pero se persiste como texto libre) | **No cumple en el camino real; Cumple en un camino sin uso** | El 2-eyes estructurado (`isControlled`/`witnessUserId`/`controlledJustification`, columnas reales por SQL 226) SÍ se exige y persiste — pero solo en `pharmacy.router.ts:dispense.create` (líneas 449-468,499-516). Ese endpoint **no tiene ningún `.tsx` que lo invoque** en todo `apps/web` (grep exhaustivo, cero resultados) y **no decrementa inventario real** (comentario propio: "Wave 1: no DrugStock todavía; stock asumido suficiente"). El flujo que la UI de dispensación SÍ usa (`dispensation.router.ts`, `/pharmacy/dispense/[orderId]`) no tiene ninguna verificación de controlados. Ver H-13, hallazgo central de esta re-verificación. |
| R11 | Conciliación clínico-financiera diaria + bloqueo de cierre | No cumple | **Parcial** | Los 5 reportes de R11 existen como procedures reales y corren (`conciliacion-cargos.router.ts`, 6 tests pasan): indicaciones sin dispensa, dispensado sin cargo, cargo sin movimiento, cargos sin tarifa, devoluciones sin reversión. `patientAccount.cerrar` bloquea, pero solo con 3 de esas 5 causas (`PENDIENTE_TARIFA`, `PENDIENTE_REGULARIZAR`, devolución sin reversión — `patient-account.router.ts:319-378`); "indicación sin dispensa" y "cargo sin movimiento" quedan visibles solo en el tablero, no bloquean el cierre de la cuenta específica. Ver H-16. |
| R12 | Coherencia multicompañía | Parcial (diseño sí, datos no) | **Parcial** (sin cambios — C5-1 no ejecutado) | Confirmado en prod: 1 solo `Establishment` ("Hospital Avante Central — Sede Principal"), no las 3 unidades HE/CM/US de la RN. El diseño (`organizationId`+`establishmentId` en `StockLot`/`StockMovement`) no cambió porque no necesitaba cambiar. |
| R13 | Auditoría inalterable | No cumple para tablas financieras | **Cumple** | Verificado en prod: `trg_audit_<Tabla>` presente en las 9 tablas (`Invoice`, `InvoiceItem`, `InvoicePayment`, `PatientAccount`, `PatientAccountService`, `TipoCuenta`, `ServicePriceList`, `ServicePriceListItem`, `ServicePriceRule` — consulta `information_schema.triggers` contra `ejacvsgbewcerxtjtwto`, 2026-09-09). |

**Resumen R1-R13:** antes **1C/5P/6NC/1NV** → ahora **6 Cumple (R2,R3,R4,R7,R8,R13) / 4 Parcial (R1,R5,R9,R11,R12 — nota: son 5, ver corrección abajo) / 3 No cumple (R6,R10) / 0 No verificado**.

*Corrección de conteo:* Cumple = {R2,R3,R4,R7,R8,R13} = 6. Parcial = {R1,R5,R9,R11,R12} = 5. No cumple = {R6,R10} = 2. Total 6+5+2=13. ✓ **Conteo final R1-R13: 6 Cumple · 5 Parcial · 2 No cumple · 0 No verificado.**

---

## 2. Matriz de 24 pasos — antes → ahora

| # | Paso | Antes | Ahora | Evidencia |
|---|---|---|---|---|
| 1 | Abrir cuenta con tipo de cuenta y lista de precios | Parcial (candado solo de API, 1 fila NULL en prod) | **Cumple** | Trigger `trg_patient_account_require_tipo_cuenta` BEFORE INSERT (SQL 224) + backfill de la fila histórica. Prod: 0/2 `PatientAccount` con `tipoCuentaId` NULL; 48/48 `TipoCuenta` con `priceListId`. |
| 2 | Cuenta abierta también para ambulatorio | Parcial | **Parcial** (sin cambios) | `PatientAccountService.tipo` sigue en 2 valores (`HOSPITALARIO`/`NO_HOSPITALARIO`); `OutpatientAppointment` existe (confirmado en addendum) pero sigue desconectado de `PatientAccount`/farmacia. |
| 3 | Clasificar el episodio por tipo de ingreso | No cumple | **No cumple** (sin cambios, fuera de alcance) | No hay campo `tipoAdmision` equivalente a Emergencia/Consulta externa/Procedimientos/Cirugía/Manejo médico. |
| 4 | Requisición interna nominativa al botiquín | Cumple (forma distinta) | **Cumple**, y ahora con cargo real | `PharmacyReservation` + `capturarCargo` en la misma tx — mejor que el estado pre-remediación, que solo tenía la mitad de inventario. |
| 5 | Requisición de área sin paciente separada | No cumple (esquemas no reconciliados) | **Cumple** | Puente `upsertStockFromRecepcion` (C3-4) sincroniza `ece.*`↔`public.Stock*` en la misma tx de la recepción (`gs1-proceso-a.router.ts:72-158`, testeado). `inventory.consumo` (C3-3) es estructuralmente incapaz de tocar `PatientAccount` (no la importa). |
| 6 | Tipos de requisición del proceso real (7 tipos) | No cumple | **Parcial** | `CHARGE_ORIGINS` (`charge-origin.ts`) define 9 orígenes incluyendo los 7 de la RN, pero solo 3 tienen caller real (`DISPENSACION_FARMACIA`, `LABORATORIO`, `IMAGENES`); `HOJA_GASTOS*`/`TERAPIA_RESPIRATORIA`/`USO_INSTALACIONES`/`HABITACION` están definidos sin ningún punto de captura (C3-2 diferido explícitamente). |
| 7 | Anclaje a la indicación médica | Parcial | **Parcial** (sin cambios) | Hard-stop de receta sigue firme para farmacia; los tipos sin caller (punto 6) siguen sin anclaje porque no existen todavía como acto capturable. |
| 8 | Doble firma solicitante/despachador con hora | Parcial | **Parcial** (mejora real, con matiz nuevo) | R9 por identidad ahora se aplica en `scanItem` y `reserveItem`. Pero `scanItem` no tiene `requireRole` (ver H-14) — la "segregación" depende solo del chequeo de identidad, no de un candado de rol adicional. |
| 9 | Botiquín como almacén con existencias propias | Cumple (diseño) | **Cumple** (sin cambios; 0 filas en prod) | |
| 10 | Movimiento de inventario con lote al dispensar | Cumple (diseño) | **Cumple** (sin cambios; 0 filas en prod) | |
| 11 | Separar consumo institucional del cargo a paciente | No cumple (definitivo, addendum) | **Cumple**, con hallazgo de control de acceso | `StockMovementType.CONSUMPTION` confirmado en prod (enum incluye `IN,OUT,TRANSFER,ADJUST,CONSUMPTION`). `inventory.consumo` nunca importa `capturarCargo` (garantía estructural, no un `if`). **Pero** sin `requireRole` — ver H-12. |
| 12 | Cargo a la cuenta con precio, descuento y total | No cumple (hallazgo central) | **Cumple** para farmacia/lab/imágenes | `capturarCargo` + columnas de precio/cantidad/total en `PatientAccountService` (SQL 224). Prod aún en 0 `InvoiceItem`/`PharmacyReservation` reales (datos de negocio pendientes, no código). |
| 13 | Cantidad entregada vs. solicitada | No cumple (concepto distinto) | **No cumple** (sin cambios, R6 fuera de alcance) | |
| 14 | Flujo de devolución | No cumple | **Cumple** | `revertirCargo` wired a `cancelReservation`, verificado por test. |
| 15 | Registrar en la línea la lista de precios aplicada | No cumple | **Cumple** | `priceListId`/`priceRuleId`/`resolvedAt`/`priceSource` en `PatientAccountService` e `InvoiceItem` (SQL 224). |
| 16 | Tarifas versionadas por vigencia | No cumple (1.2%) | **Cumple** | Prod: 0/999 `ServicePriceRule` sin `dateStart`. `addRule` exige `dateStart` (Zod `.datetime()` sin `.optional()`) y auto-cierra la regla anterior del mismo objetivo. |
| 17 | Mapa configurable tipo de cuenta → lista de precios | Cumple | **Cumple** (sin cambios) | |
| 18 | Catálogo de tipos de cuenta sincronizado | Cumple | **Cumple** (sin cambios) | |
| 19 | Trazabilidad cargo ↔ requisición de botiquín | No cumple (no aplicaba, no había cargo) | **Cumple** | `PatientAccountService.referenciaId` enlaza a `PharmacyReservation.id`/`Prescription.id`; consumido activamente por `conciliacion-cargos.router.ts` (los 5 reportes lo usan). |
| 20 | Dispensación en episodio ambulatorio puro (cita) | No verificado | **No cumple** (definitivo, addendum) | `OutpatientAppointment` existe pero ni `PatientAccount` ni `Invoice` ni la dispensación la referencian. El ambulatorio puro se cubre por otra vía (cuenta sin `encounterId`, CC-0002), no por la cita. |
| 21 | Cuenta con deducible/coaseguro y multi-responsable | No cumple | **No cumple** (sin cambios, diferido a CC futuro por decisión explícita) | |
| 22 | Precio congelado en el acto (no recalculable) | No cumple (dispensación); Parcial (facturación manual) | **Cumple** | Ambos caminos (dispensación real vía `capturarCargo`, facturación vía `invoice.create`) persisten `priceListId`/`priceRuleId`/`resolvedAt`/`priceSource` — demostrable ante auditoría, no solo "no se reescribe". |
| 23 | Bloqueo de cierre de cuenta con excepciones abiertas | No cumple (no existía el concepto) | **Parcial** | `patientAccount.cerrar` existe y bloquea con `PRECONDITION_FAILED` listando causas, pero solo 3 de las 5 categorías de R11 (ver R11 arriba). |
| 24 | Coherencia multicompañía | Parcial | **Parcial** (sin cambios) | Prod sigue con 1 `Establishment`; C5-1 (carga HE/CM/US) no se ha ejecutado — confirmado en esta sesión. |

**Resumen 24 pasos:** antes **6C/3P/8NC/7NV** → ahora **13 Cumple (1,4,5,9,10,11,12,14,15,16,17,18,19,22 — son 14, contar abajo) / 6 Parcial (2,6,7,8,23,24) / 5 No cumple (3,13,20,21) — contar abajo)**.

*Conteo exacto por lista:* Cumple = {1,4,5,9,10,11,12,14,15,16,17,18,19,22} = **14**. Parcial = {2,6,7,8,23,24} = **6**. No cumple = {3,13,20,21} = **4**. Total 14+6+4 = 24. ✓ **Conteo final 24 pasos: 14 Cumple · 6 Parcial · 4 No cumple · 0 No verificado.**

---

## 3. Veredicto de las 8 pruebas de aceptación — ahora

| # | Prueba | Antes | Ahora |
|---|---|---|---|
| 1 | ISBM: cargo con precio ISBM, lista y fecha registrados | Bloqueada (no existía cargo ni columnas) | **Ejecutable con datos de prueba** — el código lo soporta punta a punta (`capturarCargo`→`resolverPrecio`→columnas persistidas); bloqueada hoy solo porque prod no tiene `StockItem`/`StockLot`/tarifario ISBM cargado con las 3 organizaciones reales (C5-1 pendiente). |
| 2 | MAPFRE: precio de lista MAPFRE, no particular | Ejecutable solo a mano, fuera del punto de atención | **Ejecutable con datos de prueba, en el punto de atención** — ya no requiere el botón manual: se resuelve dentro de `scanItem`/`reserveItem`. |
| 3 | DoctorSV: tipo de cuenta permitido y tarifa resuelta | Ejecutable con matiz de nombre (solo desde facturación) | **Ejecutable con datos de prueba, en el punto de atención** — `accountId` explícito llega a `capturarCargo` desde lab/imágenes; farmacia lo resuelve por paciente/encuentro. |
| 4 | Sin precio ⇒ PENDIENTE_TARIFA, cierre bloqueado, nunca 0 | Bloqueada (no existía el estado ni el bloqueo) | **Ejecutable y verificada por test unitario hoy** (`charge-capture.test.ts:255-288`, `patient-account.router.test.ts` cubre `cerrar`). Pendiente solo la vuelta E2E con datos reales. |
| 5 | Entrega parcial 5 de 10 ⇒ cargo 5, pendiente 5 | Bloqueada / no aplica | **Sigue bloqueada / no aplica** — R6 no estaba en el alcance de docs/48; el modelo sigue siendo unidad-por-escaneo. |
| 6 | Devolución 2 unidades ⇒ reingreso + reversión con motivo/autorizador | Parcialmente ejecutable (solo inventario) | **Ejecutable y verificada por test unitario hoy** (`charge-capture.test.ts:324-356`, `dispensation-reservas.router.test.ts`). |
| 7 | Emergencia sin pagador ⇒ dispensa igual; cuenta no cierra hasta regularizar | Ejecutable por la razón equivocada (ausencia total de precondición) | **Ejecutable por la razón correcta** — `emergenciaSinPagador`→`PENDIENTE_REGULARIZAR`, `cerrar()` bloquea con causa `CUENTA_PENDIENTE_REGULARIZAR`, `regularizar()` la resuelve. Verificado por test. |
| 8 | Cambio de tarifario hoy ⇒ cargos de ayer conservan precio original | No verificable (no había cargos ni vigencias) | **Ejecutable por diseño** (congelamiento + `dateStart`/`dateEnd` obligatorios + auto-cierre de vigencia) — no verificado end-to-end contra datos reales todavía (Ola 5/C5-2 pendiente). |

**Ninguna de las 8 corre hoy contra datos 100% reales de producción** (prod sigue en 0 `Invoice`/`StockItem`/`PharmacyReservation`, 1 solo `Establishment`) — pero la naturaleza del bloqueo cambió por completo: antes era "el código no existe", ahora es "los datos de negocio (C5-1) y las specs E2E (C5-2) todavía no se cargaron", y 3 de las 8 ya tienen prueba unitaria verde que ejercita el contrato exacto de la prueba de aceptación.

---

## 4. Hallazgos residuales

### Nuevos (encontrados en esta re-verificación, no estaban en el dictamen previo ni en el addendum)

**H-13 · Crítico — El "libro de controlados" (C4-4) se alimenta de un endpoint de dispensación que la aplicación no usa; el que sí usa no verifica controlados.**
`pharmacy.router.ts:398` (`dispense.create`) es el único escritor de `MedicationDispense` (grep exhaustivo sobre `packages/trpc/src`, un solo resultado) y el único lugar del repo que exige `witnessUserId`+`controlledJustification` para `RX_CONTROLLED` (líneas 449-468) y persiste las columnas estructuradas de SQL 226 (líneas 507-516). Pero **ningún archivo `.tsx` en `apps/web` invoca `pharmacy.dispense.create`** (grep exhaustivo, cero resultados) — la única pantalla que toca ese sub-router es `pharmacy/libro-controlados/page.tsx`, y solo para *leer* (`dispense.libroControlados.useQuery`). La pantalla real de dispensación (`apps/web/src/app/(clinical)/pharmacy/dispense/[orderId]/page.tsx:198,215`) llama a `dispensation.reserveItem`/`cancelReservation` — el router GS1 bedside (`dispensation.router.ts`), que **no contiene ninguna mención a `witness`, `controlled` o `dispensingClass`** (grep sin resultados) y **no decrementa el mismo `MedicationDispense`** que alimenta el libro (comentario propio del código de `dispense.create`: "Wave 1: no DrugStock todavía; stock asumido suficiente. Wave 2 valida" — ese endpoint nunca tocó `StockLot`/`StockMovement`, ni antes ni después de esta remediación).
*Consecuencia:* un fármaco controlado dispensado hoy por la única pantalla real (`/pharmacy/dispense/[orderId]`) queda cobrado correctamente (Ola 2) y con inventario correcto, pero **sin testigo, sin justificación y sin aparecer en el libro de controlados** — el requisito regulatorio (Ley Reguladora de Actividades Relativas a las Drogas, El Salvador) queda incumplido en la práctica pese a que el código para cumplirlo existe y fue reforzado en esta misma ronda de trabajo (SQL 226).
*Naturaleza:* defecto de integración — dos features construidas en momentos distintos (Beta.2 y docs/48 Ola 4) sobre superficies de API distintas, sin que nadie verificara cuál de las dos usa la UI real.
*Recomendación:* antes de considerar cerrado R10, decidir cuál de los dos caminos es el canónico y fusionar: o (a) mover la validación de controlados + columnas de SQL 226 dentro de `scanItem`/`reserveItem` (el camino que sí dispensa y cobra de verdad), o (b) eliminar `pharmacy.dispense.create` como ruta muerta y construir el libro de controlados sobre `PharmacyReservation`/`StockMovement`. No dejar ambos caminos vivos.

**H-14 · Alto — `scanItem` ahora escribe un cargo financiero real sin el candado de rol que sí tiene `reserveItem`.**
`dispensation.router.ts:398` (`scanItem: tenantProcedure`) no tiene `requireRole` ni `.use(abacGuard(...))`, a diferencia de `reserveItem` (`dispensation.router.ts:654,659`: `requireRole(["PHARM","ADMIN"])` + `abacGuard("dispensation","dispense")`). Antes de esta remediación, el peor caso de una llamada indebida a `scanItem` era un movimiento de inventario mal registrado (`validateAndDecrementStock`). Desde Ola 2 (C2-2), `scanItem` también invoca `capturarCargo` (línea 563) — es decir, **cualquier usuario autenticado del tenant, sin importar su rol, puede hoy crear un cargo real en la cuenta de un paciente** llamando a `scanItem` directamente (no solo desde la UI, sino como llamada de API).
*Consecuencia:* control de acceso insuficiente sobre un endpoint que ahora tiene efecto financiero — un rol no clínico (p. ej. recepción, facturación) podría generar cargos de farmacia sin que el sistema se lo impida a nivel de servidor.
*Naturaleza:* defecto de diseño introducido por esta misma remediación (extender el alcance funcional de `scanItem` sin revisar su candado de acceso).
*Recomendación:* agregar `requireRole(["PHARM","ADMIN"])` + el mismo `abacGuard` que tiene `reserveItem` a `scanItem`, o justificar explícitamente por qué `scanItem` debe quedar abierto a cualquier rol del tenant (si es una pantalla de "verificación" que un rol distinto necesita usar antes del despacho real, decirlo en el código).

**H-15 · Medio — `inventory.out` e `inventory.consumo` permiten sacar cualquier ítem/lote sin cuenta de paciente, sin rol restringido, y sin que la conciliación lo detecte.**
`inventory.router.ts:314` (`out`) y `:396` (`consumo`) son ambos `tenantProcedure` sin `requireRole`. Ninguno de los dos llama a `capturarCargo` — correcto para `consumo` (consumo institucional, por diseño, C3-3), pero **`out` es un movimiento OUT genérico preexistente que puede representar un despacho real a un paciente** (así lo advertía ya el dictamen previo) y sigue sin control de acceso ni de cargo. El reporte de conciliación "dispensado sin cargo" (`conciliacion-cargos.router.ts:143-169`) solo detecta movimientos `OUT` cuyo `reason` contiene el texto literal `dispensaci` (el que graban `scanItem`/`reserveItem`) — un `inventory.out` con cualquier otro texto en `reason` es invisible para esa conciliación.
*Consecuencia:* persiste una vía para sacar medicación sin cargo ni rol restringido que además evade el propio mecanismo de detección construido en esta misma ola (C4-2). No es un vector nuevo (ya existía `out` antes de docs/48) pero el plan no lo cerró ni lo mencionó, y la nueva `consumo` amplía la superficie con el mismo patrón de falta de rol.
*Naturaleza:* defecto de control de acceso preexistente (`out`) + gap de alcance en el diseño de `consumo` (C3-3 protegió el "nunca cobra" pero no el "quién puede usarlo").
*Recomendación:* `out` y `consumo` deben exigir rol (`PHARM`/`ADMIN` como mínimo) igual que `reserveItem`; evaluar si el reporte de conciliación debe ampliar su detección más allá del texto `reason ILIKE '%dispensaci%'` (p. ej. cualquier `OUT` sin `PatientAccountService.referenciaId` correspondiente, no solo los que dicen "dispensación" en el texto).

**H-16 · Bajo — El cierre de cuenta (C4-1) solo bloquea 3 de las 5 causas de R11.**
`patientAccount.cerrar` (`patient-account.router.ts:302-393`) verifica `PENDIENTE_TARIFA`, `PENDIENTE_REGULARIZAR` y devolución de farmacia sin reversión — pero no "indicación sin dispensa" ni "cargo sin movimiento", que sí existen como reportes (`conciliacion-cargos.router.ts`) pero solo informan, no bloquean.
*Consecuencia:* una cuenta puede cerrarse con una excepción abierta de esas dos categorías, contradiciendo la letra de R11 ("el cierre de cuenta se bloquea con excepciones abiertas", sin acotar a un subconjunto).
*Naturaleza:* alcance parcial deliberado (el propio código lo documenta como "atrapa anomalías", no como cobertura completa) — no está claro si fue una decisión consciente de Edwin o una omisión.
*Recomendación:* decidir explícitamente si las 5 causas de R11 deben bloquear el cierre o si 3 es el alcance aceptado para v1; si es lo segundo, documentarlo en el propio docs/48 para que no se lea como pendiente.

**H-17 · Bajo — La UI de facturación manual no expone `overridePrecio`, por lo que ya no se puede forzar un precio distinto al resuelto desde la pantalla.**
`invoice.router.ts` acepta `overridePrecio.justificacion` con rol ADMIN/DIR (H-03 cerrado correctamente en el backend), pero `apps/web/src/app/(admin)/finance/invoices/nuevo/page.tsx` no tiene ningún campo ni llamada que use `overridePrecio` (grep sin resultados). Cualquier línea cuyo `unitPrice` tecleado no coincida con el resuelto por el servidor (tolerancia de medio centavo) será rechazada por el servidor sin que la UI ofrezca la vía de excepción que el propio backend ya construyó.
*Consecuencia:* un caso de precio negociado o excepción autorizada legítima no tiene cómo completarse desde la pantalla — el usuario ADMIN/DIR tendría que llamar la API directamente. Es un regresión de usabilidad frente al estado pre-remediación (donde cualquier precio se aceptaba, sin control) a cambio de cerrar H-03 — el trade-off es correcto en seguridad pero incompleto en producto.
*Naturaleza:* trabajo de UI no terminado en la misma ola que el backend.
*Recomendación:* agregar a la UI de facturación manual un campo de justificación que se habilite cuando el precio resuelto difiere del tecleado, visible solo a ADMIN/DIR.

**H-18 · Bajo (cosmético/documental) — Comentario desactualizado en `patient-account.router.ts`.**
El comentario de `listarWorklist` (`patient-account.router.ts:173`, "El saldo se deriva solo de Invoice porque PatientAccount no tiene estado") quedó obsoleto desde que C1-5 agregó `PatientAccount.status` en la misma ola. No es un defecto funcional — el worklist de cobro sigue derivando el saldo de `Invoice`, lo cual es correcto — pero el comentario induce a error a quien lo lea después.
*Recomendación:* actualizar el comentario en el próximo PR que toque ese archivo.

### Deliberadamente abiertos (confirmados, no son hallazgos nuevos)

- **C3-2 (estancia/quirófano):** cargo de censo/ocupación y de acto quirúrgico no cableados — pendiente de definir el disparador con Edwin (plan §5, punto 2). Confirmado sin código nuevo en esta pasada (`CHARGE_ORIGINS` los define, sin caller).
- **C5-1 (datos reales HE/CM/US):** confirmado en prod — 1 solo `Establishment`, no las 3 unidades de negocio de la RN. Bloquea las pruebas de aceptación #1-#3, #8 contra datos reales (siguen ejecutables con datos de prueba).
- **Deducible/coaseguro/multi-pagador (paso 21):** sin cambios, diferido a un CC posterior por decisión explícita del plan.
- **UI de override de precio (H-17 arriba):** parcialmente nuevo (el backend es nuevo, la ausencia de UI ya existía como "no aplica" antes porque no había override que exponer).
- **Imágenes legado (mencionado en el encargo):** no se encontró, en esta pasada, un segundo router de imágenes distinto de `imaging-request.router.ts` que necesitara el mismo flag — si existe, no fue localizado con los greps ejecutados (`imaging`, `radiolog`) sobre `packages/trpc/src/routers`; se reporta como **no verificado** en vez de "cerrado", igual que hizo el addendum Ola 0 con hallazgos que no pudo agotar.
- **R6 (cantidad entregada vs. solicitada):** confirmado sin cambios — nunca estuvo en el backlog de docs/48.

---

## 5. Verificación en producción (SELECT, `ejacvsgbewcerxtjtwto`, 2026-09-09)

| Verificación | Resultado |
|---|---|
| Triggers de auditoría (`trg_audit_*`) en las 9 tablas financieras | **9/9 presentes** (Invoice, InvoiceItem, InvoicePayment, PatientAccount, PatientAccountService, TipoCuenta, ServicePriceList, ServicePriceListItem, ServicePriceRule) |
| `ServicePriceRule` sin `dateStart` | **0 de 999** (era 12/999 = 1.2% antes; 987/999 = 98.8% en el dictamen original de Odoo) |
| Candado `PatientAccount.tipoCuentaId` | **0 de 2 cuentas con NULL**; trigger `trg_patient_account_require_tipo_cuenta` BEFORE INSERT presente y activo |
| Enum `StockMovementType` incluye `CONSUMPTION` | **Sí** — `IN, OUT, TRANSFER, ADJUST, CONSUMPTION` |
| Columnas del libro de controlados en `MedicationDispense` | **Presentes**: `isControlled` (boolean), `witnessUserId` (uuid), `controlledJustification` (varchar) |
| Datos transaccionales reales | `Invoice`=0, `InvoiceItem`=0, `PharmacyReservation`=0, `StockMovement`=0, `StockItem`=0 — **el circuito sigue sin ejercitarse con datos de negocio reales**; `PatientAccountService` VIGENTE=2 (datos de prueba, no operación real); `PatientAccount` PENDIENTE_REGULARIZAR=0, CERRADA=0 |
| Organizaciones/establecimientos | **1 solo `Establishment`** ("Hospital Avante Central — Sede Principal") — las 3 unidades de negocio HE/CM/US de la RN siguen sin sembrarse (C5-1 pendiente) |

---

## 6. Conteo final comparativo

| Matriz | Antes (dictamen 2026-09-09, pre-remediación) | Ahora (post Olas 1-4) |
|---|---|---|
| **R1-R13** | 1 Cumple / 5 Parcial / 6 No cumple / 1 No verificado | **6 Cumple / 5 Parcial / 2 No cumple / 0 No verificado** |
| **24 pasos** | 6 Cumple / 3 Parcial / 8 No cumple / 7 No verificado | **14 Cumple / 6 Parcial / 4 No cumple / 0 No verificado** |
| **Pruebas de aceptación** | 0/8 ejecutables | **3/8 verificadas por test hoy · 4/8 ejecutables por diseño (falta solo carga de datos) · 1/8 sigue bloqueada (R6, fuera de alcance)** |

La mitad financiera del circuito de botiquín, que antes no existía como código, ahora existe, está probada con tests que corren de verdad, y quedó auditada e íntegra en prod para las 9 tablas financieras. El riesgo se movió: de "no se cobra nada" a "se cobra correctamente por el camino que la UI usa, pero sobreviven vías paralelas (H-13, H-14, H-15) que un usuario con el rol equivocado, o una integración que no pase por la UI, todavía puede usar para evadir cargo, controlados o ambos". Ninguno de los tres hallazgos nuevos (H-13/H-14/H-15) invalida el trabajo de docs/48 — lo acota: el trabajo hecho es real y verificado; lo que falta es cerrar las puertas laterales que quedaron abiertas al construir la puerta principal.

---

*Documento producido por @DrHIS. No se modificó código ni se escribió en la base de datos de producción durante esta re-verificación — todas las consultas SQL fueron `SELECT`.*
