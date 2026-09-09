# 48 — Plan de remediación: ciclo de cargos a cuentas hospitalarias (RN-HIS-BOT-001)

| Campo | Valor |
|---|---|
| Fecha | 2026-09-09 |
| Autor | @Orq (SDLC autónomo), insumos @DrHIS/@AS/@PO |
| Insumos | `docs/47_rn_his_bot_001_botiquin_cargos.md` (RN, verificada contra Odoo) · `docs/qa/drhis/RN-HIS-BOT-001-verificacion-his-multipais.md` (dictamen HIS nuevo, 2026-09-09) |
| Estado | Propuesta — pendiente de aprobación de Edwin |
| Objetivo | Que **todo producto, insumo y servicio** dispensado/prestado genere su cargo a la cuenta hospitalaria: atómico, con precio server-side congelado, auditable e imposible de cerrar con excepciones abiertas (R1–R13 de la RN) |

## 1. Diagnóstico en una frase

La mitad clínica/inventario del circuito existe y está bien hecha (dispensación GS1 nominativa con receta obligatoria, descuento atómico por lote, reversión trazable); la mitad financiera **no existe como código**: ningún acto clínico crea cargos, el motor de precios (CC-0021, correcto) es una calculadora manual, y las 8 tablas financieras están fuera de la cadena de auditoría. El plan construye el eslabón que falta y blinda lo que ya hay, en ese orden.

## 2. Criterio de priorización

1. **Integridad antes que volumen** — auditoría hash-chain y candados de esquema ANTES del primer cargo real (es 100× más barato que retro-auditar).
2. **El eslabón único** — un solo servicio server-side de captura de cargo que TODOS los módulos consumen (la RN Fase 3 lo pide textualmente: "resolución de tarifa como servicio único consumido por botiquín, laboratorio, imágenes, quirófano y cama").
3. **Farmacia primero** (es la RN), servicios después, cierre/conciliación al final — cada ola deja el sistema operable.
4. Los **No verificado** se confirman antes de construir sobre ellos (lección: no fabricar sobre supuestos).

## 3. Backlog priorizado (mapeo hallazgo → ítem → gate de cierre)

| Ítem | Cubre | Sev. | Gate de cierre |
|---|---|---|---|
| C0-1 Confirmar los 7 "No verificado" del dictamen (StockMovementType/consumo institucional, Appointment, RX_CONTROLLED/libro, gs1-proceso-c como sincronizador `ece.*`↔`Stock*`, R8 paridad) | pasos 11/20, R8/R10, H-06 | Bloqueante de diseño | Addendum al dictamen con veredicto definitivo por punto |
| C1-1 Triggers hash-chain en las 8 tablas financieras (SQL nuevo, patrón `trg_audit_*` existente) + `updatedAt` donde falte | **H-02**, R13 | Crítica | `information_schema.triggers` muestra `trg_audit_*` en las 8; test de cadena verifica |
| C1-2 `InvoiceItem` + `priceListId`/`priceRuleId`/`resolvedAt`/`priceSource` (congelamiento demostrable) | **H-05**, R4, paso 15/22 | Alta | Toda línea nueva persiste los 4 campos; consulta de auditoría reconstruye la tarifa |
| C1-3 Candados de esquema: `PatientAccount.tipoCuentaId` NOT NULL (migrando la fila NULL), `invoice.patientAccountId` obligatorio (excepción documentada si existe tipo de comprobante sin cuenta) | **H-08, H-09** | Alta | Constraint en BD + fila legacy corregida; insert directo sin tipo de cuenta falla |
| C1-4 Vigencias de tarifa: `dateStart` obligatorio en `addRule`, backfill `dateStart=createdAt` de las 987 reglas sin fecha, cierre de vigencia automático al cargar tarifario que reemplace reglas | **H-04**, R4 | Alta | 0 reglas activas sin `dateStart`; cargar tarifario nuevo cierra el anterior |
| C1-5 Estados de cuenta: `PatientAccount.status` (ABIERTA · PENDIENTE_REGULARIZAR · CERRADA) + `closedAt`/`closedBy` | R1, base de R11/paso 23 | Alta | Enum en esquema + RLS/auditoría; emergencia abre en PENDIENTE_REGULARIZAR |
| C2-1 **Servicio único `capturarCargo`** (`packages/trpc/src/lib/charge-capture.ts`): recibe `{tx, patientId/cuentaId, code, qty, origen, referenciaId}`; resuelve cuenta activa, llama `resolverPrecio` SERVER-SIDE, crea la línea congelada EN LA MISMA transacción del acto; sin precio ⇒ línea `PENDIENTE_TARIFA` + notificación, **nunca 0**; sin cuenta y no-emergencia ⇒ hard-stop; emergencia ⇒ dispensa y marca cuenta PENDIENTE_REGULARIZAR | **H-01**, R1, R3, R4, R5 | **Crítica** | Test: dispensar crea cargo y movimiento en una tx (revierte junto); precio no resoluble ⇒ PENDIENTE_TARIFA; jamás unitPrice=0 sin override |
| C2-2 Cablear `capturarCargo` en dispensación (`reserveItem`/`scanItem`, misma tx que `validateAndDecrementStock`) | H-01, R5 | Crítica | E2E: escanear unidosis ⇒ StockMovement + línea de cargo con lista/regla/fecha |
| C2-3 `invoice.create` re-resuelve server-side; `unitPrice` manual = **override** con rol autorizado + motivo, auditado | **H-03**, R3 | Alta | API directa con precio arbitrario sin rol/motivo ⇒ rechazo |
| C2-4 Reversión de cargo en devolución: `cancelReservation` genera línea de reversión (nunca borra la original), motivo/autorizador/hora | R7, paso 14 | Alta | Devolver ⇒ reingreso mismo lote + línea negativa enlazada |
| C3-1 Consumir `capturarCargo` desde **laboratorio** (al crear la orden, por examen) e **imágenes** — sus catálogos ya tienen precio/tarifario | encargo "y servicios" | Alta | Orden de lab ⇒ N líneas de cargo congeladas |
| C3-2 Consumir desde **estancia/cama** (cargo diario por censo u ocupación) y **quirófano** (SQL 207 `centro_costo_id` → cargo del acto) — alcance exacto a definir con Edwin | encargo "y servicios" | Media | Definido el disparador, mismo gate que C3-1 |
| C3-3 Taxonomía de tipos de cargo/ingreso (amplía el enum de 2 valores: consumo, hoja de gastos, hoja gastos SOP/UCI, terapia respiratoria, uso de instalaciones, habitación) + anclaje al acto de respaldo por tipo | pasos 3/6, R2 | Media | Cada tipo con su respaldo obligatorio |
| C4-1 `patientAccount.cerrar` con **bloqueos**: líneas PENDIENTE_TARIFA, cuenta PENDIENTE_REGULARIZAR, devoluciones sin reversión | R11, paso 23, prueba 4/7 | Alta | Cerrar con excepción abierta ⇒ PRECONDITION_FAILED listando causas |
| C4-2 Conciliación clínico-financiera: los 5 reportes de R11 (indicación sin dispensa, entregado sin cargo, cargo sin movimiento, precio 0/sin tarifa, devolución sin reversión) como procedures + tablero | R11 | Media | Reportes con datos de prueba; excepción visible bloquea cierre |
| C4-3 Segregación: despachador ≠ prescriptor por IDENTIDAD (no solo rol) en dispensación | R9 | Media | Mismo usuario prescribe y dispensa ⇒ rechazo |
| C5-1 Carga de negocio real: 3 organizaciones/establecimientos HE/CM/US (datos de Edwin), tarifarios con vigencia, precios de catálogo (decisión: carga manual) | **H-07**, R12, paso 24 | Media | Las 8 pruebas de aceptación corren contra HE/CM/US |
| C5-2 Las **8 pruebas de aceptación de la RN** como specs E2E (las de precio, `@smoke`) + guion UAT para Edwin | §4 de la RN | Alta | 8/8 ejecutables; las automatizables en verde en CI |

**Fuera de alcance de este plan (explícito):** deducible/coaseguro/multi-pagador (paso 21 — Fase 3 de la RN, modelo objetivo; se propone como CC separado post-v1), DTE Hacienda (push-back vigente), y el modelo "requisición de área" estilo Odoo (el HIS usa transferencias GLN `gs1-proceso-b`; C0-1 confirma la reconciliación).

## 4. Olas de ejecución

Modelo actual (Edwin + agentes SDLC). Cada ola = 1–2 PRs con CI verde y SQL aplicado a prod vía MCP.

- **Ola 0 — Confirmaciones** (medio día): C0-1. Sin código.
- **Ola 1 — Integridad** (1 día): C1-1…C1-5. Todo esquema/SQL + candados. *Nada de esto requiere decisión nueva.*
- **Ola 2 — El eslabón** (1–2 días): C2-1…C2-4. Al cerrar: **la RN pasa de "no existe el flujo" a "farmacia cumple R1–R7"**.
- **Ola 3 — Servicios** (1–2 días): C3-1 primero (lab/imágenes, sin decisiones); C3-2/C3-3 tras definir alcance de estancia/quirófano con Edwin.
- **Ola 4 — Cierre y conciliación** (1 día): C4-1…C4-3.
- **Ola 5 — Datos reales + UAT** (depende de datos de Edwin): C5-1, C5-2, UAT visual, re-verificación @DrHIS (matriz objetivo: 0 No cumple en R1–R13 salvo paso 21 diferido).

## 5. Decisiones que necesita tomar Edwin

1. **Aprobar este plan** (o ajustar alcance/orden).
2. **C3-2**: ¿qué dispara el cargo de estancia (censo nocturno diario vs. al alta) y el de quirófano (al firmar acto quirúrgico)?
3. **C5-1**: datos reales de HE/CM/US (razones sociales, establecimientos, qué tarifarios rigen en cada una) — sin esto la Ola 5 no arranca.
4. Confirmar que deducible/coaseguro queda para un CC posterior (recomendado).

## 6. Qué NO resuelve este plan

- La carga de precios de catálogo (decisión previa: manual, pantalla de #616) ni las vigencias de tarifarios ISBM/DrSV — C1-4 crea el candado, los datos los carga el negocio.
- La estimación de esfuerzo asume el modelo actual de ejecución; con equipo externo los tiempos cambian pero el ORDEN no.
- Facturación fiscal (DTE) — el cargo a cuenta es el paso previo; el comprobante fiscal sigue diferido por push-back aprobado.
