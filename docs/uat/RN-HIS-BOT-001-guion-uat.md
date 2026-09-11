# Guion UAT — RN-HIS-BOT-001 (cargos de botiquín a la cuenta del paciente)

| Campo | Valor |
|---|---|
| Para | Edwin Martínez |
| Preparado por | @QA |
| Fecha | 2026-09-11 |
| Basado en | `docs/47_rn_his_bot_001_botiquin_cargos.md` §4 (las 8 pruebas de aceptación de la regla) |
| Circuito verificado | `docs/48_plan_remediacion_cargos_cuentas.md` (Olas 1-4b) + `docs/qa/drhis/RN-HIS-BOT-001-reverificacion-post-remediacion.md` |
| Specs automatizados equivalentes | `apps/web/e2e/cargos-rn-bot-001.spec.ts` (8 pruebas, 5 en `@smoke`) |

## Qué es esto

Ocho pruebas manuales, una por cada regla de negocio que definimos para que
**dispensar del botiquín siempre genere un cargo correcto en la cuenta del
paciente** — nunca gratis, nunca con el precio equivocado, nunca perdido.
Cada prueba dice: qué pantalla usar, qué datos necesita, qué pasos seguir, qué
tiene que pasar, y cómo saber si pasó o falló.

**No hace falta leer código.** Donde una prueba SÍ requiere ayuda técnica
(dos de las ocho, ver más abajo), se dice explícitamente por qué.

## Antes de empezar

1. **Ambiente:** ejecutar contra un ambiente con datos de prueba reales
   (staging o el ambiente E2E local). Si el ambiente está vacío, cada prueba
   dice qué precondición de datos necesita y en qué pantalla se crea.
2. **Usuario:** iniciar sesión con un usuario que tenga rol **Administrador**
   (puede dispensar Y administrar tarifarios — cubre todos los pasos de este
   guion sin cambiar de usuario a mitad de una prueba).
3. **Un paciente por prueba.** Cada una de las 8 pruebas usa un paciente
   distinto con su propia cuenta — así ninguna prueba contamina el resultado
   de otra. Si tenés que crear los datos a mano, seguí el mismo patrón (un
   paciente nuevo por prueba).
4. **Tarifarios de prueba:** cada prueba dice el precio esperado. Si el
   ambiente no tiene un tarifario "ISBM"/"MAPFRE"/"DoctorSV" cargado, se
   pueden crear en **Finanzas → Tarifarios** (`/finance/price-lists`) y
   asignarse a un tipo de cuenta en **Finanzas → Tipos de Cuenta**
   (`/finance/tipos-cuenta`). El inventario (ítem + lote) se carga en
   **Inventario** (`/inventory` → "Nuevo").

## Cómo reportar un fallo

Para cada prueba que falle: capturar pantalla del resultado, anotar el
paciente/cuenta usados, y si el error aparece en pantalla copiar el texto
exacto. Reportar a @QA con el número de prueba (1-8) de este documento.

---

## Prueba 1 — ISBM: precio de licitación

**Qué verifica:** al dispensar un insumo cubierto por el tarifario ISBM, el
cargo debe salir con el precio de ESE tarifario, y debe quedar registrado
CUÁL tarifario y CUÁNDO se aplicó (no solo el número final).

**Datos previos:** paciente con cuenta abierta cuyo tipo de cuenta sea
**Licitaciones/ISBM**, con una lista de precios asignada que tenga el insumo
a dispensar. Insumo cargado en Inventario con existencia disponible.

**Pantalla:** Farmacia → Dispensación (`/pharmacy/dispense`) → abrir la orden
del paciente de prueba.

**Pasos:**
1. Escanear (o escribir) el GTIN-14 del insumo.
2. Escribir el número de lote.
3. Click en **"Validar y reservar"**.

**Resultado esperado:** la reserva se confirma ("reservado correctamente").
No hace falta ver el precio en pantalla — la pantalla de dispensación no lo
muestra hoy (es una limitación de UI conocida, no de esta prueba). El precio
se verifica desde **Finanzas → Facturación** o el listado de cargos de la
cuenta del paciente: debe existir una línea nueva con el precio del
tarifario ISBM, y no debe estar en blanco ni en $0.

**Criterio pasa/falla:**
- ✅ PASA: la reserva se confirma Y la línea de cargo aparece con el precio
  de la lista ISBM.
- ❌ FALLA: la reserva se rechaza, o el cargo aparece en $0, en blanco, o con
  un precio que no corresponde a la lista ISBM.

---

## Prueba 2 — MAPFRE: precio de la aseguradora, no el particular

**Qué verifica:** el mismo insumo, para un paciente MAPFRE, debe cobrarse al
precio de la lista MAPFRE — nunca al precio "particular" (el que se cobra a
alguien sin seguro).

**Datos previos:** paciente con cuenta abierta cuyo tipo de cuenta sea
**Seguro Médico/MAPFRE**, con lista de precios MAPFRE asignada. Mismo insumo
de la Prueba 1 (o uno equivalente) cargado también en la lista MAPFRE con un
precio DISTINTO al de ISBM y al particular.

**Pantalla:** Farmacia → Dispensación, igual que la Prueba 1, con el paciente
MAPFRE.

**Pasos:** igual que la Prueba 1.

**Resultado esperado:** la línea de cargo debe mostrar el precio de la lista
**MAPFRE** — si conocés el precio "particular" de ese mismo insumo, verificá
explícitamente que NO sea ese el que se cobró.

**Criterio pasa/falla:**
- ✅ PASA: el cargo trae el precio MAPFRE.
- ❌ FALLA: el cargo trae el precio particular, el de otra lista, o $0.

---

## Prueba 3 — DoctorSV: el tipo de cuenta se acepta y cobra en el momento

**Qué verifica:** que un paciente con tipo de cuenta **DoctorSV** pueda
dispensarse SIN que el sistema rechace el tipo de cuenta, y que el precio
salga resuelto ahí mismo, en el mostrador — no que alguien tenga que ir
después a facturación a poner el precio a mano.

**Datos previos:** paciente con cuenta abierta, tipo de cuenta **DoctorSV**,
con su propia lista de precios asignada y el insumo cargado en ella.

**Pantalla:** Farmacia → Dispensación.

**Pasos:** igual que la Prueba 1.

**Resultado esperado:** la reserva se confirma sin ningún mensaje de "tipo de
cuenta no válido" ni similar. El cargo queda con el precio de la lista
DoctorSV, resuelto automáticamente (nadie lo escribió a mano).

**Criterio pasa/falla:**
- ✅ PASA: dispensa sin rechazo y el cargo trae el precio DoctorSV.
- ❌ FALLA: el sistema rechaza el tipo de cuenta, o el cargo queda sin precio
  / en $0 / pendiente de que alguien lo complete a mano.

---

## Prueba 4 — Sin precio en ningún tarifario ⇒ nunca se cobra $0

**Qué verifica:** si un insumo NO tiene precio en ningún tarifario aplicable,
el sistema debe dispensarlo igual (nunca se le niega el medicamento al
paciente por un problema administrativo), pero el cargo debe quedar marcado
como **"pendiente de tarifa"** — nunca en $0 — y eso debe impedir que la
cuenta se cierre hasta que Facturación le ponga un precio.

**Datos previos:** paciente con cuenta abierta y un insumo que a propósito
NO esté cargado en ningún tarifario (ni el de su tipo de cuenta, ni el
tarifario general del hospital).

**Pantalla:** Farmacia → Dispensación.

**Pasos:** igual que la Prueba 1, con el insumo sin precio.

**Resultado esperado:** la reserva se confirma igual (la entrega del
medicamento NUNCA se bloquea por esto). El cargo queda en estado
**"Pendiente de tarifa"**, no en $0 y no en blanco.

⚠️ **Nota técnica (requiere asistencia de @Dev/@QA):** hoy no existe una
pantalla donde un usuario de negocio pueda intentar "cerrar" la cuenta del
paciente y ver el mensaje de bloqueo — esa acción solo existe como llamada
técnica (API), todavía sin botón en ninguna pantalla. Para completar esta
prueba, pedile a @Dev/@QA que ejecute el cierre de esta cuenta por API y te
confirme que el sistema lo rechaza citando la línea "pendiente de tarifa"
como causa. Si el cierre se permite igual, es un defecto real — repórtalo
como tal.

**Criterio pasa/falla:**
- ✅ PASA: dispensa igual, el cargo queda "pendiente de tarifa" (nunca $0), y
  el cierre de la cuenta se rechaza mientras esa línea siga pendiente.
- ❌ FALLA: el cargo sale en $0, o el cierre de la cuenta se permite con la
  línea todavía pendiente.

---

## Prueba 5 — Entrega parcial (5 de 10) — NO EJECUTABLE HOY

**Qué verifica la regla original:** si se solicitan 10 unidades y solo se
entregan 5, el cargo debe ser por 5, dejando visible que quedan 5
pendientes.

**Por qué no se puede probar hoy:** la pantalla de dispensación de este HIS
funciona **escaneo por escaneo** — cada escaneo dispensa 1 unidad, y no hay
ningún campo donde el farmacéutico indique "de las 10 que se pidieron, hoy
entrego 5". Automatizar esta prueba, o ejecutarla manualmente de forma
significativa, requeriría construir esa función primero — no es que la
función exista y falle, es que **todavía no existe**. Esto es una decisión
de alcance ya tomada (ver `docs/48_plan_remediacion_cargos_cuentas.md`, la
entrega parcial no está en el backlog de esa ronda de trabajo) — no un
olvido.

**Acción para Edwin:** ninguna — nada que ejecutar. Si la entrega parcial es
prioritaria, es un pedido de función nueva, no un bug de QA.

---

## Prueba 6 — Devolución: reingresa al mismo lote y queda trazable

**Qué verifica:** cuando se cancela una entrega ya reservada (devolución), el
medicamento tiene que volver EXACTAMENTE al lote de donde salió (no a
"inventario genérico"), y el cargo original nunca debe borrarse — en su
lugar aparece una segunda línea que lo anula, con el motivo de la
cancelación.

**Datos previos:** paciente con cuenta abierta y tarifa resuelta (puede ser
el mismo escenario de la Prueba 2, por ejemplo).

**Pantalla:** Farmacia → Dispensación.

**Pasos:**
1. Escanear GTIN y lote, click en **"Validar y reservar"** (igual que la
   Prueba 1). Debe aparecer el aviso "Reserva activa — expira en...".
2. Click en **"Cancelar reserva"**.
3. Escribir un motivo (ej. "Orden médica suspendida").
4. Click en **"Confirmar cancelación"**.

**Resultado esperado:** el aviso de "reserva activa" desaparece. En el
listado de inventario, la cantidad del lote escaneado debe volver a subir en
1 unidad (mismo lote, no otro). En la cuenta del paciente: el cargo original
sigue existiendo (no desaparece de la lista), pero cambia de estado, y
aparece una **segunda línea nueva** con importe negativo y el motivo que
escribiste.

**Criterio pasa/falla:**
- ✅ PASA: el lote recupera la unidad, el cargo original sigue visible (no
  se borró), y aparece la línea de reversión con el motivo.
- ❌ FALLA: el lote no recupera la unidad, el cargo original desaparece de la
  cuenta, o no aparece ninguna línea de reversión.

---

## Prueba 7 — Emergencia sin pagador definido

**Qué verifica:** en una emergencia, si todavía no se sabe quién paga
(seguro, particular, etc.), el sistema tiene que dispensar el medicamento
igual — la atención nunca espera al papeleo — pero la cuenta debe quedar
marcada como "pendiente de regularizar" y no debe poder cerrarse hasta que
alguien le asigne un pagador.

**Datos previos:** paciente con una cuenta abierta EN EMERGENCIA, sin tipo de
cuenta/pagador asignado todavía (si tu ambiente no tiene un caso así,
pedile a @Dev que abra una cuenta de emergencia sin pagador para esta
prueba — es el mismo botón/flujo de admisión de emergencia, solo que se deja
el campo de pagador vacío a propósito).

**Pantalla:** Farmacia → Dispensación, con el paciente de emergencia.

**Pasos:** igual que la Prueba 1.

**Resultado esperado:** la reserva se confirma sin ningún rechazo por falta
de pagador. El cargo queda registrado con el precio del tarifario general
del hospital (el que aplica cuando no hay uno más específico).

⚠️ **Nota técnica (requiere asistencia de @Dev/@QA):** igual que la Prueba
4, "cerrar cuenta" y "asignar pagador a una cuenta pendiente" todavía no
tienen botón en ninguna pantalla — son llamadas técnicas. Pedile a @Dev/@QA
que confirme por vos: (a) que el intento de cerrar la cuenta se rechaza
mientras no tenga pagador, y (b) que, después de asignarle un pagador, el
cierre sí se permite.

**Criterio pasa/falla:**
- ✅ PASA: dispensa sin pedir pagador, con precio correcto; el cierre se
  bloquea hasta asignar pagador y se permite después.
- ❌ FALLA: la dispensación se bloquea por falta de pagador (viola la Ley de
  Deberes y Derechos de los Pacientes), o la cuenta se puede cerrar sin
  pagador asignado.

---

## Prueba 8 — Cambio de tarifario hoy: lo de ayer no cambia de precio

**Qué verifica:** si hoy se actualiza un tarifario (nuevo precio), los cargos
que ya se generaron AYER con el precio viejo tienen que conservar ESE
precio — nunca recalcularse hacia arriba o hacia abajo con la tarifa nueva.

**Datos previos:** paciente con cuenta abierta y un tarifario vigente desde
antes de hoy (ej. desde ayer), con un precio conocido para el insumo de
prueba.

**Pantalla:** Farmacia → Dispensación, y luego Finanzas → Tarifarios
(`/finance/price-lists`) para el cambio de precio.

**Pasos:**
1. Dispensar el insumo de prueba (igual que la Prueba 1) y anotar el precio
   que quedó en el cargo (verificalo en el listado de cargos de la cuenta).
2. Ir a **Finanzas → Tarifarios**, abrir la lista de precios usada, y
   agregar una regla nueva para ese mismo insumo con un precio DISTINTO,
   vigente desde hoy.
3. Volver a Farmacia → Dispensación y dispensar el MISMO insumo otra vez
   (mismo paciente, otro escaneo).
4. Revisar de nuevo el listado de cargos de la cuenta.

**Resultado esperado:** el cargo del **paso 1** (dispensado antes del cambio)
sigue mostrando el precio ORIGINAL — no cambió. El cargo del **paso 3**
(dispensado después del cambio) muestra el precio NUEVO.

**Criterio pasa/falla:**
- ✅ PASA: el cargo de ayer conserva su precio original; el de hoy usa el
  precio nuevo.
- ❌ FALLA: el cargo de ayer cambió de precio después de actualizar el
  tarifario (esto sería un problema serio — significa que el sistema puede
  reescribir cobros ya hechos).

---

## Resumen para marcar mientras ejecutás

| # | Prueba | Pasa | Falla | Observaciones |
|---|---|---|---|---|
| 1 | ISBM |  |  |  |
| 2 | MAPFRE (no particular) |  |  |  |
| 3 | DoctorSV |  |  |  |
| 4 | Sin precio ⇒ pendiente de tarifa |  |  |  |
| 5 | Entrega parcial | — | — | No ejecutable hoy (fuera de alcance, ver arriba) |
| 6 | Devolución |  |  |  |
| 7 | Emergencia sin pagador |  |  |  |
| 8 | Cambio de tarifario |  |  |  |
