# GS1 Healthcare aplicado en Avante

## Claves de identificación

| Clave | Qué identifica | Uso en Avante | Quién lo gobierna |
|---|---|---|---|
| **GTIN** (Global Trade Item Number) | Producto comercial en cada nivel de empaque (unidad de uso, caja, bulto) | Medicamentos, insumos médico-quirúrgicos, reactivos, alimentos de cafetería | Catálogo maestro MDM (data owner del catálogo de productos); el proveedor aporta su GTIN, Avante no lo inventa |
| **GLN** (Global Location Number) | Entidad legal, sede, almacén, ubicación física o funcional | Cada hospital, laboratorio, farmacia, almacén central, subalmacén, estante, quirófano | Catálogo maestro MDM (ubicaciones); Operaciones propone altas |
| **SSCC** (Serial Shipping Container Code) | Una unidad logística concreta (tarima, bulto) | Recepción de proveedores y transferencias entre sedes | Lo emite quien arma el bulto (proveedor o almacén central) |
| **GSRN** (Global Service Relation Number) | Relación de servicio (paciente, cuidador) | Pulsera del paciente si se adopta identificación GS1 del paciente | Médica + TI; opcional |
| **GRAI / GIAI** | Activos retornables / activos fijos | Equipos biomédicos, instrumental, contenedores | Operaciones (mantenimiento) |

Regla de oro: **Avante no crea GTIN**; los GTIN son del fabricante. Para ítems sin GTIN (preparados magistrales, kits internos) se usa un código interno marcado como tal en el catálogo, nunca un GTIN ficticio.

## Portadores de datos y qué llevan

- **GS1-128** (lineal, cajas y bultos): GTIN (AI 01), lote (AI 10), vencimiento (AI 17), cantidad (AI 30/37), SSCC (AI 00).
- **GS1 DataMatrix** (2D, unidad de uso y envases pequeños): GTIN (01), vencimiento (17), lote (10), serie (21). Es el portador estándar de medicamentos serializados.
- Lectura: escáneres 2D en recepción, almacén, farmacia, quirófano y pie de cama; el HIS/Odoo debe parsear los AI, no leer el código como texto plano.

## Procesos donde se escanea

| Proceso | Qué se escanea | Qué valida el sistema |
|---|---|---|
| Recepción | SSCC del bulto → GTIN+lote+vencimiento de cada línea | Contra orden de compra; vida útil mínima; registro SRS |
| Ubicación | GLN del estante + GTIN | Ubicación permitida (cadena de frío, controlados) |
| Transferencia entre sedes | SSCC o GTIN+lote; GLN origen/destino | Stock disponible; FEFO |
| Dispensación en farmacia | GTIN+lote; identificador del paciente | Prescripción activa; alergias; interacciones (CDS) |
| Administración al pie de cama | Pulsera del paciente + GTIN+lote | **5 correctos**: paciente, medicamento, dosis, vía, hora; alerta si no coincide |
| Quirófano | GTIN de implantes e insumos de alto costo; GRAI de instrumental | Carga automática a la cuenta del paciente; trazabilidad del implante |
| Laboratorio | GTIN+lote de reactivos; identificación de la muestra | Lote en uso vigente; control de calidad del lote |
| Devolución / vencido / recall | GTIN+lote | Bloqueo, cuarentena, documento de baja |

## EPCIS: eventos para trazabilidad

Cada movimiento genera un evento con **qué** (GTIN+lote/serie o SSCC), **dónde** (GLN), **cuándo** y **por qué** (paso de negocio: recibir, almacenar, transferir, dispensar, administrar, desechar). Con eso un recall se resuelve así:

1. Buscar el lote → lista de GLN donde está o estuvo.
2. Bloquear el lote en todas las ubicaciones (el HIS impide dispensar y administrar).
3. Retirar físicamente y poner en cuarentena.
4. Identificar pacientes a los que se administró (vía evento "administrar") → notificar a Médica.
5. Notificar al proveedor y a la SRS según corresponda; documentar.

Meta: localizar el 100 % de un lote en ≤ 2 horas.

## GDSN: sincronizar el catálogo con proveedores

Los proveedores publican sus fichas de producto (GTIN, descripción, empaque, temperatura, registro sanitario) en un data pool GDSN; Avante las recibe y el MDM las valida antes de activarlas. Beneficio: el catálogo maestro se alimenta de la fuente y no de digitación en recepción. Mientras no haya GDSN con un proveedor, la ficha entra por el ciclo de validación del MDM con el GTIN del empaque como evidencia.

## Encaje con la ruta MDM de Avante

- El catálogo maestro GS1 ya definido tiene data owners por gerencia y un ciclo de validación: Operaciones **propone** (alta, baja, corrección de GTIN/GLN), el data owner **valida**, MDM **publica** al HIS y a Odoo.
- Operaciones es data owner natural de ubicaciones (GLN de almacenes y estantes) y de activos (GRAI); Médica/farmacia de la ficha clínica del producto; Financiera del costo.
- Nunca se crea un código en el almacén o en una hoja de cálculo "mientras tanto": se abre la solicitud al MDM y se usa el código provisional interno marcado como tal.

## Matriz de trazabilidad por tipo de insumo (plantilla)

| Tipo | Clave | Portador | Datos mínimos | Escaneo obligatorio en |
|---|---|---|---|---|
| Medicamento | GTIN | DataMatrix | 01, 17, 10, (21) | Recepción, dispensación, administración |
| Controlado | GTIN | DataMatrix | 01, 17, 10, 21 | Todos + conteo por turno |
| Implante / prótesis | GTIN | DataMatrix o GS1-128 | 01, 17, 10, 21 | Recepción, quirófano (a la cuenta y a la historia) |
| Insumo médico-quirúrgico | GTIN | GS1-128 | 01, 17, 10 | Recepción, subalmacén |
| Reactivo de laboratorio | GTIN | GS1-128 | 01, 17, 10 | Recepción, puesta en uso |
| Hemoderivado | ISBT 128 (compatible) | ISBT | DIN, producto, vencimiento | Recepción, transfusión |
| Alimento (cafetería) | GTIN | EAN-13 / GS1-128 | 01, (17), (10) | Recepción |
| Activo biomédico | GRAI / GIAI | GS1-128 o RFID | Serie | Inventario, mantenimiento |

## Alertas GS1 que el HIS debe emitir

- Lote por vencer (umbral por tipo) y lote vencido en stock.
- Recall activo: bloqueo y aviso a farmacia, enfermería y Operaciones.
- Escaneo que no coincide con el paciente, la prescripción o la ubicación permitida.
- Recepción sin código GS1 legible o con vida útil inferior a la pactada.
- Discrepancia de conteo cíclico por lote.
