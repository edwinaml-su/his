# RN-HIS-BOT-001 — Dispensación de botiquín (Farmacia Interna) y cargo a la cuenta del paciente

**Proceso:** APY — Farmacia interna / Captura de cargos
**Aplica a:** Avante Hospital Especializado (HE), Avante Centro Médico Especializado (CM), Unidad Satelital Surf City (US)
**Versión:** 1.0 · 09-sep-2026 · Autor: TTD
**Ambiente verificado:** Odoo PRODUCCIÓN (HIS operativo actual)
**Limitación declarada:** no se pudo abrir `C:\proyecto` (HIS Avante Multipaís, Next.js/Prisma); la verificación de código de la nueva plataforma queda **No verificada**.

---

## 1. Regla de negocio afinada

### 1.1 Definiciones normalizadas

| Término | Definición operativa |
|---|---|
| **Botiquín (Farmacia Interna)** | Punto de dispensación intrahospitalaria de una unidad operativa, con existencias propias. **No factura al público**: alimenta la cuenta del episodio. Es distinto de **Farmacias Avante** (venta al público por PdV). |
| **Cuenta hospitalaria** | Contenedor único de cargos del episodio, abierto en admisión para **todo** tipo de ingreso: Emergencia, Consulta externa, Procedimientos, Cirugía programada y Manejo médico. Ambulatorio y hospitalizado usan el mismo contenedor. |
| **Tipo de cuenta** | Clasificación del pagador asignada en la admisión (Particular, Seguro Médico, Médico, Empleado, Licitaciones, DoctorSV, B2B). **Es el único determinante de la lista de precios aplicable.** |
| **Requisición interna** | Documento nominativo (un paciente, un episodio) por el que un servicio solicita medicamentos/insumos al botiquín. |
| **Requisición de reabastecimiento** | Documento de área (sin paciente) por el que un servicio repone su stock desde bodega/botiquín. **Nunca genera cargo a paciente.** |

### 1.2 Reglas

**R1 — Precondición de episodio.** Toda requisición interna nominativa exige paciente identificado y episodio abierto con *tipo de cuenta* y *lista de precios* resueltos.
*Excepción irrenunciable:* en emergencia y máxima urgencia se dispensa con episodio abierto en estado **"pagador por definir"**; la atención jamás se condiciona a depósito, papeleo ni resolución de tarifa (Ley de Deberes y Derechos de los Pacientes). La regularización es obligatoria antes del cierre de la cuenta.

**R2 — Origen clínico obligatorio.** Toda requisición de tipo *consumo* debe estar anclada a una indicación médica/prescripción vigente del episodio. Los tipos *hoja de gastos*, *hoja de gastos sala de operaciones*, *hoja de gastos UCI*, *terapia respiratoria* y *uso de instalaciones* se anclan a su acto de respaldo (nota operatoria, registro de UCI, registro de terapia). Sin respaldo clínico no hay dispensación nominativa.

**R3 — Resolución determinista del precio.** El precio se resuelve en este orden y se detiene en la primera coincidencia:
1. **Tarifario de licitación/convenio vigente** (p. ej. ISBM) cuando el tipo de cuenta es Licitaciones y el renglón existe en el tarifario;
2. **Lista de la aseguradora / convenio** del episodio (Seguro Médico, B2B, DoctorSV);
3. **Lista del tipo de cuenta** (Particular, Empleado, Médico);
4. **Lista por defecto de la unidad operativa.**

Si ninguna resuelve un precio > 0, el cargo se crea en estado **"pendiente de tarifa"**, se notifica a Facturación y **se bloquea el cierre de cuenta**. Nunca se cae a precio cero, a costo, ni al precio de venta al público de Farmacias.

**R4 — Congelamiento del precio en el acto.** El precio se fija con la tarifa vigente a la **fecha/hora de entrega**, no a la fecha de cierre. La línea de cargo conserva de forma inmutable: producto, cantidad entregada, lote, precio unitario, descuento, **lista de precios y versión de tarifa aplicadas**, y regla que la determinó. Un cambio posterior de tarifa no reescribe cargos existentes.

**R5 — Un solo registro, transacción atómica.** La confirmación de entrega en botiquín genera, en un mismo acto: (a) el movimiento de inventario con lote y vencimiento desde la ubicación del botiquín hacia el paciente, y (b) la línea de cargo en la cuenta del episodio. **No existe cargo sin movimiento ni movimiento nominativo sin cargo.** El consumo institucional no nominativo (aseo, docencia, mermas) usa un tipo de operación distinto que nunca toca cuentas de paciente.

**R6 — Cantidad efectiva.** Se carga la cantidad **entregada**, no la solicitada. La entrega parcial genera cargo parcial y deja el pendiente visible.

**R7 — Devolución trazable.** La devolución al botiquín reingresa al **mismo lote** desde el paciente (no desde proveedor) y genera la reversión/nota de crédito de la línea de cargo, con motivo, autorizador y hora. Nunca se borra el cargo original.

**R8 — Paridad ambulatorio/hospitalizado.** La regla es idéntica en ambos; solo cambia la lista aplicable por tipo de cuenta. Ambulatorio con cuenta abierta ⇒ cargo a la cuenta. Paciente sin episodio ⇒ no es botiquín, es Farmacia (PdV) y se factura al momento.

**R9 — Segregación de funciones.** Solicitante (enfermería/sala) ≠ despachador (botiquín). Ambas firmas con usuario, fecha y hora.

**R10 — Medicamentos controlados.** Doble verificación, lote/serie obligatorios y libro de controlados; trazabilidad completa dispensación–administración–devolución.

**R11 — Conciliación clínico-financiera diaria.** Reportes obligatorios: indicaciones sin requisición; requisiciones entregadas sin cargo; cargos sin movimiento de inventario; cargos con precio 0 o sin tarifa; devoluciones sin reversión. **El cierre de cuenta se bloquea con excepciones abiertas.**

**R12 — Coherencia multicompañía.** Botiquín, ubicación de inventario, lista de precios y episodio deben pertenecer a la misma unidad operativa (HE / CM / US). La dispensación cruzada exige transferencia formal entre compañías.

**R13 — Auditoría inalterable.** Quién, cuándo, qué, cuánto, a qué precio y bajo qué lista, sin borrado físico y con control de acceso por rol (Ley de Protección de Datos Personales — Decretos 143/144).

---

## 2. Verificación paso a paso contra el HIS actual

Leyenda: **Cumple** / **Parcial** / **No cumple** / **No verificado**

| # | Paso o registro que exige la regla | ¿Se puede hoy? | Evidencia en el sistema |
|---|---|---|---|
| 1 | Abrir cuenta con tipo de cuenta y lista de precios en admisión | **Cumple** | `acs.hospitalization.tipo_cuenta` + `pricelist_id`. Muestra real: HOSP8468 Licitaciones→PRECIOS ISBM; HOSP8465 Seguro Médico→PRECIOS MAPFRE; HOSP8467 Particular→Precios Avante |
| 2 | Cuenta abierta también para ambulatorio (emergencia/consulta externa) | **Cumple** | `tipo.ingreso.paciente`: Emergencia, Consulta externa, Procedimientos, Cirugía programada, Manejo médico. 5,912 episodios ambulatorios registrados |
| 3 | Clasificar el episodio por tipo de ingreso | **Parcial** | 1,063 de 14,278 episodios (7.4 %) sin `tipo_admision` |
| 4 | Requisición interna nominativa al botiquín | **Cumple** | `requisiciones.botiquin`, `patient_id` obligatorio, 84,073 documentos |
| 5 | Requisición de área sin paciente (reabastecimiento) separada | **Cumple** | `requisiciones.internas` (área → botiquín), sin paciente ni precio. Separación correcta |
| 6 | Tipos de requisición del proceso real | **Cumple** | consumo, devolución, uso de instalaciones, hoja de gastos, hoja de gastos UCI, hoja de gastos sala de operaciones, terapia respiratoria, solicitud de habitación |
| 7 | Anclaje a la indicación médica | **Parcial** | Existe `indicaciones` (→`indicaciones.medicas`) e `is_medical`, pero el campo **no es obligatorio** |
| 8 | Doble firma solicitante/despachador con hora | **Cumple** | `firma1`/`firma2`, `firmador1`/`firmador2`, `firma1_fecha_hora`, `firma2_fecha_hora`, `hora_entrega`, `responsable_botiquin` |
| 9 | Botiquín como almacén con existencias propias por unidad | **Cumple** | Almacenes BOTIQUIN HOSPITAL ESPECIALIZADO (WHE), BOTIQUIN CENTRO MEDICO (WHC), BOTIQUIN UNIDAD SATELITAL SURFCITY (WHUS) |
| 10 | Movimiento de inventario con lote al dispensar | **Cumple** | Tipos "CARGO A PACIENTES HE/C/US"; `picking_ids`, `medicine.nurse.lot_id` |
| 11 | Separar consumo institucional del cargo a paciente | **Parcial** | Tipos "CONSUMO HOSPITAL HE" y "CONSUMO DE HOSPITAL CM" existen; **Surf City no tiene tipo de consumo institucional** |
| 12 | Cargo a la cuenta del episodio con precio, descuento y total | **Cumple** | `hms.consumable.line` con `hospitalization_id`/`appointment_id`, `precio_unitario`, `descuento`, `subtotal`, `total_neto`. Solo 3 de 592,697 líneas sin episodio |
| 13 | Cantidad entregada vs. solicitada | **Cumple** | `quantity` / `quantity_done` en `medicine.nurse` y `requi.interna.lines` |
| 14 | Flujo de devolución | **Parcial** | Estados `return_requested/approved/processed` y tipos "DEVOLUCIONES BOTIQUIN"; **pero el origen configurado es Partners/Vendors (proveedor), no el paciente** |
| 15 | Registrar en la línea la lista de precios aplicada | **No cumple** | `hms.consumable.line.pricelist_id` existe pero está **vacío en las 592,697 líneas** |
| 16 | Tarifas versionadas por vigencia | **No cumple** | Solo 4 de 4,392 reglas de precio tienen `date_start`/`date_end` |
| 17 | Mapa configurable tipo de cuenta → lista de precios | **No cumple** | `tipo.cuenta.opcion` (7 opciones) no tiene campo de lista; `hospitalization.config.pricelist_id` es una sola lista por defecto. La asignación vive en código |
| 18 | Catálogo de tipos de cuenta sincronizado en todo el flujo | **No cumple** | `requisiciones.botiquin.tipo_cuenta` es un *selection* fijo de 5 valores; faltan **DoctorSV** y **B2B**, que sí existen en `tipo.cuenta.opcion` |
| 19 | Trazabilidad cargo ↔ requisición de botiquín | **No cumple** | `hms.consumable.line` no tiene campo hacia `requisiciones.botiquin`; el vínculo es solo indirecto vía `stock.move` |
| 20 | Dispensación de botiquín en episodio ambulatorio puro (cita) | **No cumple (en la práctica)** | Solo 2 de 84,073 requisiciones tienen `appointment_id`, ambas en borrador/cancelada; 65 sin episodio. El ambulatorio se cubre porque se le abre un episodio de hospitalización |
| 21 | Cuenta como objeto propio con deducible/coaseguro y multi-responsable | **No cumple** | El modelo `cuenta` tiene **2 registros** en producción; deducible y coaseguro no se gestionan |
| 22 | Precio congelado en el acto (no recalculable) | **No verificado** | Existen `cargo_validado` y `notcalculate` ("no recalcular precio"); la política efectiva de recálculo requiere revisión de código |
| 23 | Bloqueo de cierre de cuenta con excepciones abiertas | **No verificado** | Sin evidencia de la regla en los metadatos; requiere revisión de código/vistas |
| 24 | Coherencia multicompañía | **Cumple** | `company_ids` obligatorio en la requisición; almacenes y tipos de operación segregados por compañía |

**Resumen:** 11 Cumple · 5 Parcial · 6 No cumple · 2 No verificado.

---

## 3. Hallazgos priorizados

**H-01 · Alto — La línea de cargo no guarda con qué lista de precios se cobró.**
Las 592,697 líneas de cargo tienen `pricelist_id` vacío; solo queda el precio resultante.
*Consecuencia:* ante una glosa de aseguradora o una auditoría ISBM no se puede demostrar qué tarifa se aplicó ni por qué. Reproceso manual y riesgo de rechazo de cobro.
*Causa:* falta de configuración/desarrollo. *Recomendación:* poblar `pricelist_id` y añadir `pricelist_item_id` y `fecha_tarifa` al momento de crear la línea.

**H-02 · Alto — Tarifas sin vigencia: no hay versionado.**
4 de 4,392 reglas de precio tienen fechas.
*Consecuencia:* una actualización de tarifario cambia el precio de cargos aún no facturados; imposible reconstruir el precio vigente a la fecha del acto. Riesgo fiscal y de convenio.
*Recomendación:* obligar `date_start`/`date_end` en toda regla y cerrar la vigencia anterior al cargar un tarifario nuevo (aplica de inmediato al tarifario ISBM y a DrSV 2026).

**H-03 · Alto — La relación tipo de cuenta → lista de precios no es parametrizable.**
El catálogo `tipo.cuenta.opcion` (7 opciones) no tiene columna de lista de precios; la asignación está en código y `hospitalization.config` solo ofrece una lista por defecto.
*Consecuencia:* cada nueva aseguradora, convenio o tipo de cuenta exige desarrollo del proveedor; riesgo de cobrar con la lista equivocada. Es exactamente la dependencia que la estrategia de proveedores busca reducir.
*Recomendación:* añadir `pricelist_id` (y `pricelist_ids` por compañía) a `tipo.cuenta.opcion` y resolver R3 desde ese catálogo.

**H-04 · Alto — El catálogo de tipos de cuenta está desincronizado en el botiquín.**
La requisición ofrece 5 tipos; el catálogo maestro tiene 7 (faltan DoctorSV y B2B).
*Consecuencia:* pacientes DoctorSV y B2B pueden dispensarse con tipo de cuenta en blanco o mal clasificado → precio incorrecto y fuga de ingresos. Es un caso de catálogo maestro no gobernado (aplica la ruta MDM).
*Recomendación:* sustituir el *selection* por un `many2one` a `tipo.cuenta.opcion` y hacerlo campo relacionado de solo lectura desde el episodio.

**H-05 · Alto — La devolución de paciente entra como devolución de proveedor.**
Los tipos "DEVOLUCIONES BOTIQUIN" tienen origen Partners/Vendors.
*Consecuencia:* el reingreso no revierte el movimiento nominativo del paciente; se rompe la trazabilidad lote–paciente y se distorsiona el costeo. La reversión del cargo queda dependiendo de un ajuste manual.
*Recomendación:* configurar el origen en Partners/Customers y encadenar la devolución al albarán de cargo original.

**H-06 · Medio — El cargo no es trazable hasta la requisición que lo originó.**
No hay campo de la línea de cargo hacia `requisiciones.botiquin`.
*Consecuencia:* la conciliación "entregado sin cargo / cargado sin entrega" (R11) no puede automatizarse; hoy es imposible medir la fuga.
*Recomendación:* añadir `requisicion_id` en `hms.consumable.line` y publicar el reporte de conciliación diario.

**H-07 · Medio — El botiquín no opera sobre episodios ambulatorios de cita.**
2 de 84,073 requisiciones con cita, ninguna concluida.
*Consecuencia:* la regla "los servicios ambulatorios también se cargan a la cuenta" se cumple hoy solo porque a los ambulatorios se les abre un episodio de hospitalización — un rodeo que distorsiona censo, estancias e indicadores.
*Recomendación:* decidir explícitamente el modelo de episodio ambulatorio (habilitar `appointment_id` en la requisición) o formalizar el episodio ambulatorio como tipo de admisión y documentar que el censo excluye esos registros.

**H-08 · Medio — La requisición no exige indicación médica.**
`indicaciones` es opcional.
*Consecuencia:* dispensación nominativa sin orden médica trazable; debilita el expediente y expone al hospital ante reclamos y ante glosa por falta de respaldo.
*Recomendación:* obligatorio para tipo *consumo*; para los demás tipos, exigir el acto de respaldo correspondiente.

**H-09 · Medio — Surf City no tiene tipo de operación de consumo institucional.**
*Consecuencia:* el consumo no nominativo de esa unidad se registra por otra vía (probablemente como cargo o como ajuste), ensuciando costo y cuentas.
*Recomendación:* replicar el tipo "CONSUMO" y su ubicación virtual en la compañía Unidad Satelital Surfcity.

**H-10 · Medio — 7.4 % de episodios sin tipo de admisión.**
*Consecuencia:* indicadores de producción y la separación ambulatorio/hospitalizado quedan incompletos.
*Recomendación:* campo obligatorio y depuración retroactiva.

**H-11 · Bajo — El modelo de cuenta con deducible y coaseguro está sin usar** (2 registros). Mientras siga así, deducible, coaseguro y cuentas divididas paciente/aseguradora se manejan fuera del sistema.

---

## 4. Recomendaciones por fase

**Fase 1 — antes de cualquier cierre de mes (configuración, sin desarrollo mayor)**
Corregir el origen de las devoluciones (H-05); crear el tipo de consumo institucional de Surf City (H-09); volver obligatorios `tipo_admision` e `indicaciones` (H-08, H-10); cargar vigencias en los tarifarios ISBM y DrSV 2026 (H-02).

**Fase 2 — desarrollo con el proveedor (cobro completo y auditable)**
`pricelist_id` en `tipo.cuenta.opcion` con resolución R3 (H-03); `many2one` al catálogo en la requisición (H-04); persistencia de lista, regla y fecha de tarifa en la línea de cargo (H-01); `requisicion_id` en la línea (H-06); reporte de conciliación clínico-financiera y bloqueo de cierre con excepciones abiertas (R11).

**Fase 3 — modelo de datos objetivo (HIS Avante Multipaís)**
Cuenta como entidad de primer nivel (episodio ambulatorio y hospitalario bajo el mismo contrato), con pagador, deducible, coaseguro, tope autorizado y cuentas divididas; resolución de tarifa como servicio único consumido por botiquín, laboratorio, imágenes, quirófano y cama; línea de cargo inmutable con firma de tarifa.

---

### Pruebas de aceptación de la regla

1. Paciente Licitaciones ISBM: dispensar un insumo del tarifario ⇒ cargo con precio ISBM, lista y fecha de tarifa registradas.
2. Paciente Seguro Médico MAPFRE: dispensar el mismo insumo ⇒ precio de la lista MAPFRE, no el particular.
3. Paciente DoctorSV: la requisición debe permitir el tipo de cuenta DoctorSV y resolver su tarifa.
4. Producto sin precio en la lista aplicable ⇒ cargo "pendiente de tarifa" y cierre de cuenta bloqueado; nunca precio 0.
5. Entrega parcial 5 de 10 ⇒ cargo por 5, pendiente por 5.
6. Devolución de 2 unidades ⇒ reingreso al mismo lote y reversión del cargo por 2, con motivo y autorizador.
7. Emergencia sin pagador definido ⇒ se dispensa igual; la cuenta no cierra hasta regularizar.
8. Cambio de tarifario hoy ⇒ los cargos de ayer conservan su precio original.
