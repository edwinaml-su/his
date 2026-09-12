# CC-0027 — Alta hospitalaria en dos fases

| | |
|---|---|
| Solicitante | Edwin Martínez (Avante) |
| Fecha | 2026-09-12 |
| SQL | `packages/database/sql/234_cc0027_alta_hospitalaria_dos_fases.sql` — **APLICADO a prod 2026-09-12 vía MCP (proyecto `ejacvsgbewcerxtjtwto`) — NO re-aplicar.** |
| Estado | Implementado — backend + UI mínima + tests. Pendiente UAT de Edwin. |

## Directiva del solicitante (verbatim funcional)

**Fase 1 — Alta Médica** (dictamen clínico): firma de nota de egreso/epicrisis,
receta e indicaciones post-hospitalarias, notificación a enfermería para
cierre de expediente. Ya existía: `encounter-discharge.router.dischargeEncounter`
(epicrisis + `dischargedAt`).

**Fase 2 — Alta Administrativa** (conciliación financiera): consolidación/
auditoría de consumos, conciliación con aseguradoras, liquidación final.
Concluye por UNA de dos rutas:

- **(A) Cancelación total de cargos**: saldo pagado 100% al egreso
  (efectivo/tarjeta) O la aseguradora emite carta de cobertura/finiquito
  aprobando el 100% de la cuenta.
- **(B) Cuenta por Cobrar (CxC)**: sin liquidez inmediata para deducible/
  coaseguro/cuenta particular ⇒ compromiso financiero diferido — el paciente
  o un fiador solidario firma documento formal de aceptación de deuda
  (pagaré, convenio de pago o reconocimiento de deuda), formalizando la CxC
  **y otorgando la autorización de egreso físico**.

El egreso físico requiere alta administrativa concluida (ruta A o B).

## Estado previo (verificado antes de construir)

- `patientAccount.cerrar` (docs/48 Ola 4, C4-1) ya bloqueaba por 6 causas de
  conciliación — la "consolidación/auditoría de consumos" del requerimiento
  YA estaba cubierta por ese bloque. #636 agregó UI mínima de cerrar/
  regularizar y el errorFormatter ya reenvía `causas` al cliente.
- `Invoice`/`InvoiceItem`/`InvoicePayment` existen (facturación + pagos);
  `conciliacionCargos.resumen` consolida brechas clínico-financieras (pero
  por rango de fechas, no saldo de una cuenta puntual).
- NO existía: CxC, pagaré/convenio/reconocimiento, carta de cobertura/
  finiquito, fase administrativa como concepto propio, ni gate de egreso
  físico. `dischargeEncounter` no tocaba la cuenta.

## Diseño

### Modelo de datos (SQL 234)

- **`AccountReceivable`** (CxC): `saldoInicial`/`saldoActual`, tipo de
  documento (`PAGARE`/`CONVENIO_PAGO`/`RECONOCIMIENTO_DEUDA`), folio,
  firmante (`PACIENTE`/`FIADOR`) + nombre + documento, plazo en días,
  `estado` (`ABIERTA`/`PAGADA`/`INCOBRABLE`). RLS tenant estándar + trigger
  de auditoría hash-chain (`trg_audit_AccountReceivable`, reutiliza
  `audit.fn_audit_row()` — patrón SQL 224, TDR §6.3: es tabla financiera).
- **`CoverageLetter`** (carta de cobertura/finiquito): tipo
  (`CARTA_COBERTURA`/`FINIQUITO`), `montoAprobado`, `folio`, `insurerId`
  opcional. Mismo patrón de RLS + auditoría.
- **`PatientAccount.altaAdministrativaAt/By/altaRuta`**: marca cuándo/quién/
  por qué ruta se concluyó la Fase 2.
- **`Encounter.egresoAutorizadoAt/By`**: la autorización de egreso físico
  que emite la Fase 2 — es lo que gatea la liberación de cama.

### Backend

- **`patientAccount.liquidacion`** (query): `totalCargos` (suma
  `PatientAccountService.totalPrice` VIGENTE) − `totalPagos` (suma
  `InvoicePayment.amount` de las facturas ancladas a la cuenta) −
  `coberturaAprobada` (suma `CoverageLetter.montoAprobado`) = `saldo`. No
  compone con `conciliacionCargos.resumen`: ese reporte cuenta BRECHAS en un
  rango de fechas (indicaciones sin dispensar, cargos sin movimiento, etc.),
  no un saldo corriente de una cuenta — son complementarios, no
  sustituibles.
- **`patientAccount.altaAdministrativa`** (mutation, ADMIN/ACCOUNTANT):
  1. Si la cuenta tiene encuentro vinculado, exige `dischargedAt` (Fase 1
     concluida).
  2. Reutiliza `computeCausasBloqueoCierre` — las MISMAS 6 causas de
     `cerrar`, extraídas a una función compartida (no duplicadas).
  3. Ruta `CANCELACION_TOTAL`: exige `saldo ≤ 0.005`. Ruta `CXC`: exige
     `saldo > 0.005` y crea `AccountReceivable` con `saldoInicial = saldo`.
  4. Transacción: `PatientAccount` → `CERRADA` + `altaAdministrativaAt/By/
     altaRuta`. Si NINGUNA otra `PatientAccount` del mismo encuentro sigue
     activa (un encuentro puede tener varias cuentas — servicios distintos
     — y todas deben concluir su Fase 2): libera la cama diferida desde
     Fase 1 y marca `Encounter.egresoAutorizadoAt/By`.
- **`patientAccount.registrarCartaCobertura`** (mutation, ADMIN/ACCOUNTANT):
  alta de `CoverageLetter`, insumo de la ruta A.
- **`cxc.list`** / **`cxc.registrarAbono`**: worklist de cobros. El abono
  reduce `saldoActual` y pasa a `PAGADA` al llegar a 0 (con margen de medio
  centavo) — NO toca `PatientAccount` (ya está `CERRADA`).

### Gate de egreso físico

`dischargeEncounter` (Fase 1, `encounter-discharge.router.ts`) liberaba la
cama en la MISMA transacción que setea `dischargedAt` — eso es lo que hoy
representa "el paciente deja la cama". Gatear ese release directamente
habría creado un candado circular: `altaAdministrativa` exige `dischargedAt`
ya seteado, así que bloquear el release de Fase 1 hasta que exista
`egresoAutorizadoAt` de Fase 2 habría impedido que Fase 1 completara jamás
para cualquier hospitalización con cuenta activa.

**Resolución**: `dischargeEncounter` ahora DIFIERE (no bloquea) la
liberación de cama si el encuentro tiene una `PatientAccount` no `CERRADA`
vinculada — el alta médica se completa igual (`dischargedAt` se setea,
epicrisis se persiste), solo el egreso físico espera. `altaAdministrativa`
es quien libera la cama al concluir, si ninguna otra cuenta del encuentro
sigue activa.

El helper compartido `packages/trpc/src/lib/egreso-fisico-gate.ts` expone:

- `hasCuentaActiva()` — usado por `dischargeEncounter` para decidir diferir.
- `assertEgresoFisicoAutorizado()` — usado por `bed.router.release` (la
  mutation de liberación manual/genérica) para BLOQUEAR con
  `PRECONDITION_FAILED` si el encuentro tiene cuenta activa sin
  `egresoAutorizadoAt`.

**Excepciones que NO pasan por el gate** (documentadas inline en cada
router, no en el helper): defunción (`death-certificate.router.ts`) y
traslado interno de cama (`encounter-transfer.router.ts`). Ambos liberan la
cama con código inline propio — nunca invocan `bed.router.release` — así
que técnicamente ni siquiera tocan el helper; el óbito no tiene alta
administrativa que lo condicione, y un traslado interno no es un egreso (el
paciente sigue dentro del establecimiento).

### UI

- `apps/web/src/app/(clinical)/patients/[id]/cuentas.tsx` — extiende la
  pestaña de #636: sección "Alta administrativa" por cuenta con desglose de
  liquidación, botón Ruta A (habilitado con saldo ≈ 0), formulario Ruta B
  (documento/folio/firmante/plazo) y registro de carta de cobertura. Badge
  de ruta + "Egreso autorizado" (o el aviso de que otra cuenta del mismo
  encuentro sigue activa) una vez concluida.
- `apps/web/src/app/(admin)/finance/cuentas-por-cobrar/page.tsx` — worklist
  de CxC por estado, con registro de abono inline. Enlazado en el sidebar
  (`nav-sections.ts`, sección Finanzas).

## Fuera de alcance

- Intereses/mora sobre CxC vencidas.
- Gestión de cobranza externa (buró de crédito, terceros).
- Pagos parciales en caja al momento del egreso como flujo dedicado —
  hoy se reflejan como `InvoicePayment` existentes antes de calcular la
  liquidación; no se construyó una pantalla de cobro en el mismo panel.
- Reapertura de una cuenta `CERRADA` (mismo alcance que `cerrar` — decisión
  administrativa futura).
- Notificación automática a portería/seguridad para bloquear la salida
  física del paciente — el gate es de sistema (libera/no libera cama), no
  hay integración con control de acceso físico del edificio.
