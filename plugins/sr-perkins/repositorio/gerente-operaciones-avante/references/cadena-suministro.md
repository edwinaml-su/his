# Cadena de suministro hospitalaria — la lidera Operaciones

## Alcance y reparto de responsabilidades

| Eslabón | Decide | Ejecuta | Aprueba / paga |
|---|---|---|---|
| Planificación de demanda | Operaciones (con Médica para protocolos nuevos y Comercial para demanda prevista) | Operaciones | — |
| Compras y negociación | Operaciones | Compras (bajo Operaciones) | Financiera (presupuesto y pago); Legal (contrato) |
| Recepción y almacén central | Operaciones | Almacén | — |
| Subalmacenes por sede y farmacia | Operaciones | Jefe de sede / regente de farmacia | — |
| Distribución interna y FEFO | Operaciones | Almacén / farmacia | — |
| Trazabilidad hasta el paciente | Operaciones (especifica) | Enfermería / farmacia (escanea); TI (sistema) | — |
| Devoluciones, vencidos, mermas | Operaciones | Farmacia / almacén | Financiera (baja contable) |
| Contratos y SLA de proveedores | Operaciones | Operaciones | Legal / Financiera |

Regla: Finanzas no decide qué comprar; Operaciones no paga. Cuando el presupuesto no alcanza, Operaciones presenta la priorización (críticos primero) y Finanzas decide el monto, no el ítem.

## Clasificación del inventario

- **ABC por valor anual consumido**: A ≈ 20 % de ítems / 80 % del valor; B ≈ 30 % / 15 %; C ≈ 50 % / 5 %.
- **XYZ por variabilidad** (coeficiente de variación de la demanda semanal): X < 0,5 estable; Y 0,5–1 estacional o irregular; Z > 1 esporádica.
- **Críticos (marca K)**: sin sustituto terapéutico o técnico y con impacto directo en paciente (hemoderivados, antídotos, insumos de quirófano y UCI, reactivos de laboratorio de urgencia, oxígeno). Un ítem C puede ser K.

| Clase | Política |
|---|---|
| AX / AY | Reorden frecuente, lotes pequeños, contrato con fill rate ≥ 98 %, conteo cíclico semanal |
| AZ | Contrato marco con entregas a demanda; stock de seguridad alto; revisar sustitutos |
| B* | Reorden quincenal; conteo mensual |
| C* | Reorden mensual o kanban de dos cajones; conteo trimestral |
| K (cualquier clase) | Stock de seguridad ≥ 2× lead time; doble proveedor; alerta en HIS al 120 % del mínimo; conteo semanal |

## Dimensionamiento

- Demanda media diaria `d`, desviación `σd`, lead time medio `L` (días) y su desviación `σL`.
- Stock de seguridad `SS = z · √(L·σd² + d²·σL²)`, con `z` = 1,65 (95 %) para A/B, 2,33 (99 %) para K.
- Punto de reorden `ROP = d·L + SS`.
- Cantidad a pedir: EOQ `√(2·D·S / H)` como referencia, ajustada a presentación comercial, caducidad y espacio.
- Días de inventario `DOI = inventario / consumo diario`; meta por clase: A 15–30, B 30–45, C 45–90, K según contrato.

`scripts/ops_toolkit.py reorden --csv demanda.csv` calcula SS, ROP y DOI por ítem y sede.

## Compra con contrato

Cláusulas mínimas que Operaciones exige y Legal redacta: precio y vigencia; lead time comprometido; fill rate mínimo y penalidad por incumplimiento; vida útil remanente mínima a la entrega (≥ 70 % o ≥ 12 meses para fármacos); codificación GS1 obligatoria (GTIN en unidad de venta y de uso, GS1-128/DataMatrix con lote y vencimiento, SSCC en bultos); ficha técnica y registro sanitario SRS vigente; política de devolución y recall; sustitución autorizada por Médica.

## Recepción, almacén y distribución

- Recepción: escaneo contra orden; rechazo si no hay código GS1 legible, lote o vencimiento; cuarentena para discrepancias.
- Ubicaciones codificadas con GLN (sede, almacén, estante); unidades logísticas con SSCC.
- FEFO estricto; bloqueo automático de lote con < 30 días de vida (parametrizable por ítem).
- Subalmacenes por sede: máximo y mínimo por ítem; reposición programada; kanban para C.
- Conteo cíclico: A/K semanal, B mensual, C trimestral; exactitud objetivo ≥ 98 % (por ítem, cantidad y lote).

## Diagnóstico de "no hay"

| Síntoma | Causa típica | Remedio |
|---|---|---|
| No hay y el sistema dice 0 | No se compró / proveedor falló | Revisar ROP, fill rate del proveedor, doble proveedor |
| No hay y el sistema dice que sí | Inventario inexacto, consumo sin registrar, robo | Conteo inmediato, cerrar fuga de registro, controles |
| Sí hay pero en otra sede o estante | Mal ubicado, sin visibilidad multisede | Transferencia, GLN de ubicación, visibilidad en HIS/Odoo |
| Hay pero vencido o bloqueado | FEFO no aplicado, sobrecompra | Ajustar lote de pedido, rotación, devolución a proveedor |

## Scorecard mensual de proveedores

| Criterio | Peso | Cómo se mide |
|---|---|---|
| Fill rate (líneas completas a tiempo) | 30 % | Líneas entregadas completas y en fecha / líneas pedidas |
| Puntualidad (lead time cumplido) | 20 % | Entregas dentro del lead time comprometido / entregas |
| Calidad (rechazos, vida útil, codificación GS1) | 20 % | 1 − (líneas rechazadas / líneas recibidas) |
| Precio vs mercado / contrato | 15 % | Desviación respecto a contrato y a referencia |
| Servicio (respuesta a incidencias, recall, documentación) | 15 % | Escala 1–5 por el comprador y la farmacia |

Puntaje ≥ 85 preferente; 70–84 observado con plan; < 70 sustitución o segundo proveedor obligatorio. `scripts/ops_toolkit.py scorecard --csv proveedores.csv`.

## KPI de la cadena (los define y lidera Operaciones)

Ver `kpi-operativos.md` → sección "Cadena de suministro" para fichas completas. Núcleo: fill rate, rotación, días de inventario, exactitud de inventario, quiebres de críticos, vencimientos y mermas, lead time de proveedores, cumplimiento de SLA, costo logístico / ventas, costo de insumos por egreso y por procedimiento. Cada trimestre, Operaciones propone cuáles son MCI candidatas (ver `4dx-ejecucion.md`).
