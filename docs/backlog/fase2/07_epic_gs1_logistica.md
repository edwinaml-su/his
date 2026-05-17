# Épica E.F2.5 — GS1 Trazabilidad Logística (Procesos A, B, C, F)

**Versión:** 1.0 | **Fecha:** 2026-05-16 | **Autor:** @PO
**Branch:** `docs/fase2-workflows-ece-gs1`
**Streams cubiertos:** 7 de 10 (paralelo Fase 2)

> **FUERA DE SCOPE en este documento:** Procesos D y E (Bedside / Dispensación — Stream 8), ECE workflows (Streams 3-6), cumplimiento transversal (Stream 9), schema diff (Stream 10).

---

## Visión

Dotar a Inversiones Avante Complejo Hospitalario de una capa de trazabilidad GS1 completa sobre la cadena logística de medicamentos e insumos — desde la recepción en muelle hasta el descarte/devolución — usando identificadores globales (GTIN, GLN, SSCC) y eventos EPCIS inmutables. El resultado es visibilidad en tiempo real de cada unidad, eliminación de errores de transcripción manual y cumplimiento con las iniciativas de serialización de MINSAL.

**Objetivo de negocio:** reducir eventos adversos por medicación mal identificada en ≥ 70 %, acortar el tiempo de respuesta ante recall sanitario a < 30 minutos, y habilitar la conciliación automática de inventario por GLN.

---

## Definition of Readiness (DoR)

- [ ] Catálogos de proveedores con GTIN registrados en GS1 El Salvador disponibles.
- [ ] Árbol GLN institucional aprobado por Dirección Farmacia y Logística.
- [ ] Hardware de escaneo (pistola HID / cámara PWA) especificado y adquirido.
- [ ] Acceso a API DESADV del proveedor principal definido (EDI o portal).
- [ ] Librería DataMatrix seleccionada (`@zxing/library` o `bwip-js`).
- [ ] Política de niveles PAR aprobada por Jefe de Farmacia.
- [ ] Canal de recepción de alertas sanitarias MINSAL definido (RSS / correo firmado).

## Definition of Done (DoD) — épica completa

- [ ] 100 % de US merged + tests vitest ≥ 80 % coverage.
- [ ] Eventos EPCIS persistidos en tabla `EpcisEvent` con WHAT/WHERE/WHEN/WHY/WHO.
- [ ] Hard-stops validados en E2E con Playwright (lote bloqueado no pasa).
- [ ] axe-core: sin errores críticos/serios en vistas de muelle y farmacia.
- [ ] Lint + typecheck verde en CI.
- [ ] Entrada en matriz de trazabilidad `docs/05_backlog.md`.
- [ ] Review @QA + @QAF aprobado.
- [ ] Documentación de catálogos GLN/GTIN en `docs/04_modelo_datos.md` actualizada.

---

## Sección 1 — Catálogos Maestros GTIN / GLN / SSCC

### US.F2.5.1 — Gestión del catálogo maestro GTIN

**Como** Químico Farmacéutico Responsable,
**quiero** registrar, editar y consultar productos (medicamentos, insumos, dispositivos) usando el GTIN como clave primaria,
**para** eliminar los códigos internos propietarios y garantizar interoperabilidad con proveedores GS1.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §4.1`

**Dependencias:** Ninguna (es raíz del dominio logístico).

**Reglas de validación:**
- Hard Stop: GTIN duplicado en la misma organización.
- Warning: GTIN con menos de 14 dígitos o sin dígito verificador válido.
- Trigger: creación de GTIN dispara indexación en búsqueda de recalls activos.

**Notas técnicas:** Modelo Prisma nuevo `GtinCatalog { id, gtin String @unique, description, form, concentration, unitDose Boolean, activeIngredient, manufacturer, countryOrigin, organizationId }`. Índice GIN en `description` para búsqueda full-text. Validación de dígito verificador GS1 en `packages/contracts/src/validators/gs1.ts`.

**Criterios de aceptación:**

```gherkin
Feature: Catálogo maestro GTIN

  Scenario: Registro exitoso de producto con GTIN válido
    Given el usuario tiene rol "PHARMACY_ADMIN"
    And el GTIN "07501000001234" no existe en el catálogo
    When ingresa los datos del producto y guarda
    Then el sistema persiste el registro con GTIN como clave primaria
    And genera evento EPCIS WHAT=GTIN WHERE=GLN-institución WHEN=now WHY="MasterData" WHO=userId
    And retorna HTTP 201

  Scenario: Bloqueo por GTIN duplicado (Hard Stop)
    Given el GTIN "07501000001234" ya existe en el catálogo
    When intenta registrar otro producto con ese GTIN
    Then el sistema retorna ValidationError "GTIN ya registrado"
    And NO persiste el segundo registro

  Scenario: Warning por dígito verificador inválido
    Given el usuario ingresa GTIN "07501000001230" con dígito verificador incorrecto
    When presiona guardar
    Then el sistema muestra advertencia "GTIN: dígito verificador no coincide"
    And permite corrección antes de confirmar
```

---

### US.F2.5.2 — Atributos de lote y vencimiento en el catálogo GTIN

**Como** Químico Farmacéutico Responsable,
**quiero** asociar reglas de control de lote (AI 10) y vencimiento (AI 17) a cada GTIN del catálogo,
**para** que el sistema pueda validar automáticamente en todos los procesos logísticos.

**SP:** 5 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §1.2`

**Dependencias:** US.F2.5.1.

**Reglas de validación:**
- Hard Stop: GTIN sin regla de vencimiento no puede recibirse en muelle.
- Warning: fecha de vencimiento a menos de 90 días de la recepción.

**Criterios de aceptación:**

```gherkin
Feature: Atributos de lote y vencimiento en GTIN

  Scenario: Asociar regla de vencimiento obligatoria
    Given el GTIN "07501000001234" existe en el catálogo
    When el farmacéutico define "requiere_lote=true" y "requiere_vencimiento=true"
    Then el sistema persiste la configuración
    And cualquier recepción sin lote o vencimiento generará Hard Stop

  Scenario: Warning de vencimiento próximo en recepción
    Given un producto con vencimiento en 60 días llega al muelle
    When el operador escanea el DataMatrix
    Then el sistema muestra Warning "Producto vence en 60 días — verificar rotación FEFO"
    And permite continuar la recepción con confirmación explícita
```

---

### US.F2.5.3 — Gestión del árbol GLN jerárquico

**Como** Administrador de Logística,
**quiero** registrar y mantener el árbol de ubicaciones GLN (institución → establecimiento → almacén → farmacia → piso → cuarto → cama),
**para** que todos los movimientos de stock queden vinculados a ubicaciones físicas unívocas globales.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.2 + §4.1`

**Dependencias:** Ninguna (catálogo maestro independiente).

**Reglas de validación:**
- Hard Stop: GLN con formato inválido (no 13 dígitos).
- Hard Stop: GLN padre inexistente al crear nodo hijo.
- Warning: GLN sin tipo de ubicación asignado.

**Notas técnicas:** Modelo Prisma nuevo `GlnLocation { id, gln String @unique, name, locationType GlnLocationType, parentGlnId String?, organizationId }`. Enum `GlnLocationType { INSTITUTION, ESTABLISHMENT, WAREHOUSE, PHARMACY, FLOOR, ROOM, BED }`. Estructura de árbol con cierre transitivo para queries de barrido en recall.

**Criterios de aceptación:**

```gherkin
Feature: Árbol GLN jerárquico

  Scenario: Creación exitosa de nodo farmacia bajo almacén
    Given el GLN "7413000000001" (almacén central) existe
    When creo el GLN "7413000000018" como farmacia satélite con parentGln="7413000000001"
    Then el sistema persiste la jerarquía
    And el GLN hijo aparece en la vista de árbol bajo el padre
    And genera evento EPCIS WHERE=nuevo-GLN WHY="LocationMasterData"

  Scenario: Bloqueo por GLN padre inexistente
    Given el GLN padre "9999999999999" no existe
    When intento crear un nodo hijo con ese padre
    Then retorna ValidationError "GLN padre no encontrado"
```

---

### US.F2.5.4 — Gestión del catálogo SSCC (unidades logísticas)

**Como** Operador de Almacén,
**quiero** registrar y consultar los SSCC de pallets y bultos maestros recibidos de proveedores,
**para** asociarlos a los DESADV y controlar el inventario a nivel de unidad logística.

**SP:** 5 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §1.1`

**Dependencias:** US.F2.5.1, US.F2.5.3.

**Reglas de validación:**
- Hard Stop: SSCC de 18 dígitos con dígito verificador inválido.
- Warning: SSCC sin DESADV asociado en recepción.

**Notas técnicas:** Modelo Prisma `SsccUnit { id, sscc String @unique, providerId, desadvId String?, gtinContents Json, organizationId, status SsccStatus }`. Enum `SsccStatus { IN_TRANSIT, RECEIVED, STORED, CONSUMED }`.

**Criterios de aceptación:**

```gherkin
Feature: Catálogo SSCC

  Scenario: Registro de SSCC proveniente de DESADV
    Given existe un DESADV con referencia "DESADV-2026-001"
    And el SSCC "374130000000000011" está listado en él
    When el operador escanea el SSCC en muelle
    Then el sistema crea el registro SsccUnit vinculado al DESADV
    And el estado cambia a RECEIVED

  Scenario: SSCC con dígito verificador inválido
    Given el operador escanea un código con SSCC malformado
    When el sistema procesa la lectura
    Then retorna Hard Stop "SSCC inválido — dígito verificador no coincide"
    And NO registra la recepción
```

---

### US.F2.5.5 — Registro de serie AI (21) para dispositivos médicos

**Como** Químico Farmacéutico Responsable,
**quiero** capturar el número de serie (AI 21) para dispositivos médicos e implantables,
**para** habilitar la trazabilidad individual requerida por MINSAL para este tipo de productos.

**SP:** 5 | **MoSCoW:** Should | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §1.2`

**Dependencias:** US.F2.5.1.

**Reglas de validación:**
- Hard Stop: dispositivo marcado como "requiere serie" sin AI (21) en recepción.

**Criterios de aceptación:**

```gherkin
Feature: Número de serie AI (21)

  Scenario: Captura obligatoria de serie en dispositivo implantable
    Given el GTIN "07501000009999" tiene flag "requiere_serie=true"
    When el operador intenta recibir sin escanear AI (21)
    Then el sistema muestra Hard Stop "Este dispositivo requiere número de serie"
    And bloquea la confirmación de recepción

  Scenario: Captura exitosa de serie
    Given el operador escanea DataMatrix con AI 01+17+10+21
    When el sistema parsea el código
    Then almacena GTIN, vencimiento, lote y serie en el registro de recepción
```

---

## Sección 2 — Proceso A: Recepción Logística (Inbound)

### US.F2.5.6 — Parsing y matching del DESADV

**Como** Operador de Almacén,
**quiero** importar o recibir el DESADV (aviso de expedición del proveedor) y que el sistema lo cruce con la orden de compra activa,
**para** tener la referencia previa antes del escaneo físico en muelle.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.1`

**Dependencias:** US.F2.5.1, US.F2.5.4.

**Reglas de validación:**
- Warning: DESADV sin orden de compra vinculada.
- Hard Stop: DESADV para proveedor no registrado en el sistema.
- Trigger: DESADV importado notifica al Jefe de Almacén vía outbox (patrón Beta.15).

**Notas técnicas:** Modelo `Desadv { id, reference, providerId, purchaseOrderId?, expectedDelivery, ssccLines Json, status DesadvStatus }`. Parser de EDI EDIFACT básico o JSON según acuerdo con proveedor. Integración con outbox de notificaciones (patrón Beta.15).

**Criterios de aceptación:**

```gherkin
Feature: Parsing de DESADV

  Scenario: Importación exitosa de DESADV con OC vinculada
    Given existe la OC "OC-2026-0145" en el sistema
    And el proveedor envía DESADV con referencia "DESADV-2026-001" que la cita
    When el sistema recibe el DESADV (upload JSON o EDI)
    Then parsea los SSCC y los asocia a la OC
    And el estado del DESADV queda en PENDING_ARRIVAL
    And se envía notificación push a Jefe de Almacén vía outbox
    And genera evento EPCIS WHY="Receiving" WHO=systemUser WHAT=SSCCs WHERE=GLN-muelle

  Scenario: DESADV sin OC vinculada
    Given el DESADV "DESADV-2026-002" no cita ninguna OC del sistema
    When se importa
    Then genera Warning "DESADV sin orden de compra — requiere vinculación manual"
    And queda en estado UNMATCHED pendiente de acción del supervisor
```

---

### US.F2.5.7 — Escaneo de SSCC en muelle (validación contra DESADV)

**Como** Operador de Almacén,
**quiero** escanear el SSCC de cada pallet/bulto con pistola HID o cámara PWA en el muelle de descarga y que el sistema lo valide contra el DESADV,
**para** confirmar que lo recibido coincide con lo declarado por el proveedor.

**SP:** 13 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.1`

**Dependencias:** US.F2.5.6.

**Hardware requerido:** Pistola USB HID (Zebra DS2278 o equivalente) / cámara PWA (QuaggaJS o ZXing WASM).

**Reglas de validación:**
- Hard Stop: SSCC no listado en ningún DESADV activo.
- Hard Stop: SSCC ya marcado como RECEIVED (duplicado).
- Warning: SSCC en DESADV pero fuera de ventana de entrega esperada (+/- 2 días).
- Trigger: match exitoso cambia estado DESADV-línea a RECEIVED.

**Notas técnicas:** Endpoint tRPC `receiving.scanSscc`. Debounce de lectura HID 200ms. Modo cámara: acceso a `getUserMedia` desde PWA. Parseo de código GS1-128: separar FNC1 y extraer AI (00) para SSCC.

**Criterios de aceptación:**

```gherkin
Feature: Escaneo SSCC en muelle

  Scenario: Escaneo exitoso con match DESADV
    Given el DESADV "DESADV-2026-001" está en estado PENDING_ARRIVAL
    And el SSCC "374130000000000011" está listado en él
    When el operador escanea el SSCC con pistola HID
    Then el sistema valida el match en < 500ms
    And cambia el estado de la línea a RECEIVED
    And genera evento EPCIS: WHAT=SSCC WHERE=GLN-muelle-descarga WHEN=ISO8601 WHY="Receiving/inbound" WHO=operatorGSRN
    And muestra confirmación visual en pantalla

  Scenario: SSCC no listado (Hard Stop)
    Given el SSCC "374130000000000099" no existe en ningún DESADV activo
    When el operador lo escanea
    Then el sistema muestra Hard Stop en rojo "SSCC desconocido — no está en ningún envío esperado"
    And solicita acción: [Rechazar] | [Reportar discrepancia]
    And NO actualiza inventario

  Scenario: Escaneo duplicado (Hard Stop)
    Given el SSCC "374130000000000011" ya fue recibido hoy
    When se intenta escanear nuevamente
    Then Hard Stop "SSCC ya recibido — posible duplicado"
```

---

### US.F2.5.8 — Escaneo de GTIN + Lote + Vencimiento (recepción sin SSCC)

**Como** Operador de Almacén,
**quiero** recibir unidades escaneando el DataMatrix con GTIN + AI10 (lote) + AI17 (vencimiento) cuando el proveedor no usa SSCC,
**para** mantener trazabilidad completa incluso sin aviso de expedición previo.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.1 + §1.2`

**Dependencias:** US.F2.5.1.

**Reglas de validación:**
- Hard Stop: GTIN no registrado en catálogo maestro.
- Hard Stop: vencimiento ya pasado al momento de recepción.
- Warning: vencimiento < 90 días.
- Trigger: registro de recepción dispara actualización de stock por GLN.

**Criterios de aceptación:**

```gherkin
Feature: Recepción GTIN sin SSCC

  Scenario: Escaneo de DataMatrix con AI 01+17+10
    Given el producto GTIN "07501000001234" existe en catálogo
    And el operador escanea un DataMatrix que contiene "(01)07501000001234(17)270101(10)LOTE-ABC"
    When el sistema parsea el código
    Then extrae GTIN="07501000001234", vencimiento="2027-01-01", lote="LOTE-ABC"
    And registra recepción con cantidad ingresada manualmente
    And genera evento EPCIS WHAT=GTIN+lote+vencimiento WHERE=GLN-muelle WHEN=now WHY="Receiving" WHO=operatorId

  Scenario: Vencimiento pasado (Hard Stop)
    Given el DataMatrix contiene vencimiento "230101" (enero 2023)
    When el sistema valida la fecha
    Then muestra Hard Stop "Producto vencido — recepción bloqueada"
    And registra el intento en log de auditoría
```

---

### US.F2.5.9 — Bloqueo automático por alerta sanitaria (recall activo)

**Como** Sistema de Trazabilidad,
**quiero** cruzar cada lote recibido contra el registro de alertas sanitarias activas (MINSAL / fabricante),
**para** bloquear automáticamente el ingreso de lotes comprometidos antes de que entren al inventario.

**SP:** 13 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.1 + §2.6`

**Dependencias:** US.F2.5.8, US.F2.5.16 (gestión de recalls — Proceso F).

**Reglas de validación:**
- Hard Stop: lote en alerta sanitaria activa → recepción bloqueada sin posibilidad de override por operador.
- Trigger: bloqueo notifica a Jefe de Farmacia y Dirección Médica vía outbox (Beta.15).

**Criterios de aceptación:**

```gherkin
Feature: Bloqueo por alerta sanitaria en recepción

  Scenario: Lote en alerta — bloqueo en muelle
    Given el lote "LOTE-RECALL-X" del GTIN "07501000001234" está en alertas activas
    When el operador escanea el DataMatrix en muelle
    Then el sistema muestra Hard Stop en rojo "LOTE EN ALERTA SANITARIA — Recepción bloqueada"
    And muestra motivo de alerta y fecha de emisión
    And genera evento EPCIS WHY="AlertBlock" WHO=systemAudit
    And envía notificación push a Jefe de Farmacia y Dirección Médica
    And NO actualiza inventario

  Scenario: Lote sin alertas — flujo normal
    Given el lote "LOTE-NORMAL" no tiene alertas activas
    When el operador escanea
    Then el sistema continúa el flujo de recepción sin interrupción
```

---

### US.F2.5.10 — Gestión de recepción parcial y discrepancias

**Como** Jefe de Almacén,
**quiero** registrar recepciones parciales (menos unidades que el DESADV) y discrepancias (unidades distintas a lo declarado),
**para** generar el acta de discrepancia y gestionar la devolución o ajuste con el proveedor.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.1`

**Dependencias:** US.F2.5.7.

**Reglas de validación:**
- Warning: cantidad recibida < cantidad declarada en DESADV (parcial).
- Hard Stop: unidades en DESADV no encontradas al cierre de sesión de recepción → requiere acta.
- Trigger: cierre con discrepancia genera acta en PDF y notificación al proveedor.

**Criterios de aceptación:**

```gherkin
Feature: Recepción parcial y discrepancias

  Scenario: Recepción de 8 de 10 SSCC declarados
    Given el DESADV declara 10 SSCC
    When el operador escanea solo 8 y cierra la sesión
    Then el sistema muestra Warning "2 SSCC pendientes de recepción"
    And permite elegir: [Marcar como recepción parcial] | [Esperar siguiente envío]
    And si elige parcial, genera acta con SSCC faltantes y fecha

  Scenario: Unidad recibida no declarada en DESADV
    Given el DESADV "DESADV-2026-001" lista SSCC específicos
    And el operador escanea un SSCC no listado
    When el sistema lo detecta
    Then genera Warning "SSCC no declarado en DESADV — posible error de envío"
    And permite registrar como discrepancia con nota
```

---

### US.F2.5.11 — Confirmación de recepción y actualización de stock por GLN

**Como** Operador de Almacén,
**quiero** confirmar el cierre de la sesión de recepción para que el sistema actualice el stock disponible en el GLN de almacén,
**para** que el inventario refleje en tiempo real las unidades ingresadas.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.1`

**Dependencias:** US.F2.5.7, US.F2.5.8.

**Reglas de validación:**
- Hard Stop: confirmar sin haber procesado todos los SSCC del DESADV sin marcar discrepancia.
- Trigger: confirmación genera evento EPCIS de cambio de estado WHAT=SSCCs WHERE=GLN-almacén WHY="bizStep:receiving disposition:in_progress→active".

**Criterios de aceptación:**

```gherkin
Feature: Confirmación de recepción

  Scenario: Cierre exitoso de sesión de recepción
    Given todos los SSCC del DESADV están escaneados o marcados con discrepancia
    When el supervisor confirma el cierre
    Then el sistema actualiza stock en GLN-almacén por cada GTIN+lote+vencimiento
    And persiste evento EPCIS final con bizStep="receiving" disposition="active"
    And el DESADV cambia a estado COMPLETED
    And las unidades son visibles en consulta de inventario por GLN

  Scenario: Intento de cierre sin procesar todos los SSCC
    Given 3 SSCC aún están en estado PENDING
    When el operador intenta confirmar
    Then Hard Stop "3 SSCC sin procesar — complete la recepción o registre discrepancias"
```

---

### US.F2.5.12 — Interfaz PWA modo muelle (escaneo con cámara)

**Como** Operador de Almacén sin pistola HID disponible,
**quiero** usar la cámara del dispositivo móvil como escáner 2D desde la PWA,
**para** escanear DataMatrix y GS1-128 en el muelle sin depender de hardware dedicado.

**SP:** 8 | **MoSCoW:** Should | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §4.3`

**Dependencias:** US.F2.5.7, US.F2.5.8.

**Hardware requerido:** Smartphone con cámara trasera ≥ 8 MP, Chrome/Safari moderno.

**Notas técnicas:** Integración de `@zxing/browser` en componente React `<BarcodeScanner>`. Solicitud de permiso `getUserMedia`. Feedback de vibración `navigator.vibrate([200])` en lectura exitosa. Parseo de FNC1 (0x1D) para separar AIs.

**Criterios de aceptación:**

```gherkin
Feature: Escaneo PWA con cámara

  Scenario: Lectura exitosa de DataMatrix con cámara
    Given el usuario abre la vista de recepción en móvil
    And activa el modo cámara
    When enfoca un DataMatrix GS1 válido
    Then el sistema decodifica en < 2s
    And extrae los AIs correctamente (01, 17, 10)
    And muestra resultado en pantalla con vibración de confirmación

  Scenario: Código ilegible
    Given el DataMatrix está dañado o fuera de foco
    When el sistema intenta leer
    Then muestra Warning "Código no legible — intente nuevamente o ingrese manual"
    And permite fallback a entrada manual de GTIN
```

---

### US.F2.5.13 — Generación de evento EPCIS de recepción

**Como** Sistema de Trazabilidad,
**quiero** persistir un evento EPCIS completo por cada recepción confirmada con WHAT/WHERE/WHEN/WHY/WHO,
**para** mantener el registro inmutable de la cadena de custodia desde el proveedor.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §3`

**Dependencias:** US.F2.5.11.

**Notas técnicas:** Modelo Prisma `EpcisEvent { id, eventType, what Json, where Json, when DateTime, why Json, who Json, organizationId, createdAt }`. Router tRPC `epcis.create` con `tenantProcedure`. Nunca DELETE/UPDATE sobre `EpcisEvent` — inmutable por diseño (patrón audit hash chain CLAUDE.md §Audit).

**Criterios de aceptación:**

```gherkin
Feature: Evento EPCIS de recepción

  Scenario: Persistencia de evento con los 5 campos core
    Given la recepción "REC-2026-001" es confirmada
    When el sistema genera el evento EPCIS
    Then persiste en tabla EpcisEvent con:
      | campo | valor esperado |
      | what  | {gtin, sscc, lote, vencimiento} |
      | where | {glnOrigen: "proveedor", glnDestino: GLN-almacén} |
      | when  | timestamp ISO8601 con timezone |
      | why   | {bizStep: "receiving", disposition: "active"} |
      | who   | {operatorId, organizationId} |
    And el evento es inmutable (no permite UPDATE)

  Scenario: Consulta de eventos por GTIN y lote
    Given existen eventos EPCIS para GTIN "07501000001234" lote "LOTE-ABC"
    When el farmacéutico consulta el historial de trazabilidad
    Then ve la cadena de eventos ordenada cronológicamente
    And puede exportar en formato JSON
```

---

## Sección 3 — Proceso B: Transferencias Internas y Reabastecimiento

### US.F2.5.14 — Despacho de almacén central con escaneo de origen (GLN)

**Como** Operador de Almacén Central,
**quiero** registrar el despacho de unidades escaneando el GTIN+lote en el almacén (GLN origen) y seleccionando el GLN destino,
**para** iniciar el evento de transferencia con trazabilidad completa.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.2`

**Dependencias:** US.F2.5.3, US.F2.5.11.

**Reglas de validación:**
- Hard Stop: unidad en estado de cuarentena → no puede despacharse.
- Hard Stop: cantidad a despachar > stock disponible en GLN origen.
- Warning: unidad con vencimiento < 30 días.
- Trigger: despacho genera transferencia en estado IN_TRANSIT.

**Notas técnicas:** Modelo `InventoryTransfer { id, fromGlnId, toGlnId, lines Json, status TransferStatus, requestedBy, dispatchedAt, receivedAt? }`. Enum `TransferStatus { REQUESTED, IN_TRANSIT, RECEIVED, CANCELLED }`. Router `inventory.dispatch`.

**Criterios de aceptación:**

```gherkin
Feature: Despacho de almacén central

  Scenario: Despacho exitoso de medicamento
    Given el GLN "7413000000001" (almacén) tiene 100 unidades de GTIN "07501000001234" lote "LOTE-ABC"
    And el GLN destino "7413000000018" (farmacia satélite) es válido
    When el operador escanea las unidades y confirma el despacho de 20
    Then el sistema reduce el stock del GLN origen en 20
    And crea InventoryTransfer en estado IN_TRANSIT
    And genera evento EPCIS WHAT=GTIN+lote WHERE={origen: GLN-almacén, destino: GLN-farmacia} WHEN=now WHY="bizStep:departing" WHO=operatorId
    And notifica al operador destino vía outbox

  Scenario: Unidad en cuarentena (Hard Stop)
    Given el lote "LOTE-RECALL-X" está en estado cuarentena
    When el operador intenta despachar unidades de ese lote
    Then Hard Stop "Lote en cuarentena — despacho bloqueado"
    And registra intento en log de auditoría
```

---

### US.F2.5.15 — Recepción en farmacia satélite / piso con escaneo de destino (GLN)

**Como** Químico Farmacéutico de Farmacia Satélite,
**quiero** confirmar la recepción de unidades escaneando el GTIN+lote en el GLN destino,
**para** cerrar el evento de transferencia y actualizar el stock local.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.2`

**Dependencias:** US.F2.5.14.

**Reglas de validación:**
- Hard Stop: unidad escaneada no coincide con ninguna línea de la transferencia IN_TRANSIT.
- Warning: cantidad recibida difiere de la despachada.
- Trigger: confirmación cierra la transferencia y actualiza stock en GLN destino.

**Criterios de aceptación:**

```gherkin
Feature: Recepción en farmacia satélite

  Scenario: Recepción exitosa que cierra la transferencia
    Given la transferencia "TRF-2026-001" está en IN_TRANSIT hacia GLN "7413000000018"
    And incluye 20 unidades de GTIN "07501000001234" lote "LOTE-ABC"
    When el farmacéutico escanea las 20 unidades en el GLN destino
    Then el sistema marca la transferencia como RECEIVED
    And suma 20 al stock del GLN "7413000000018"
    And genera evento EPCIS WHAT=GTIN+lote WHERE={origen: GLN-almacén, destino: GLN-farmacia} WHY="bizStep:arriving disposition:active" WHEN=now WHO=pharmacistId

  Scenario: Discrepancia en cantidad recibida
    Given la transferencia declara 20 unidades
    And el farmacéutico solo recibe 18
    When confirma con 18 unidades
    Then Warning "Discrepancia: se esperaban 20, se recibieron 18"
    And solicita nota de discrepancia obligatoria
    And notifica al almacén central
```

---

### US.F2.5.16 — Visibilidad en tiempo real del inventario por GLN

**Como** Director de Farmacia,
**quiero** consultar la ubicación y cantidad de cualquier producto (GTIN + lote) en todos los GLN del hospital en tiempo real,
**para** tomar decisiones de reabastecimiento y detectar desbalances de stock.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.2`

**Dependencias:** US.F2.5.14, US.F2.5.15.

**Reglas de validación:**
- Trigger: stock en GLN < nivel mínimo PAR → alerta automática de reabastecimiento.

**Notas técnicas:** Vista materializada `GlnStockView` o query agregada por GLN desde tabla `InventoryMovement`. Endpoint tRPC `inventory.stockByGln`. Actualización en tiempo real via Supabase Realtime o polling cada 60s.

**Criterios de aceptación:**

```gherkin
Feature: Inventario en tiempo real por GLN

  Scenario: Consulta de stock de un GTIN en todos los GLN
    Given el GTIN "07501000001234" tiene stock en 4 GLN distintos
    When el Director de Farmacia consulta el inventario
    Then ve tabla con columnas: GLN | Nombre | Lote | Vencimiento | Cantidad
    And los datos reflejan movimientos de los últimos 60 segundos

  Scenario: Alerta de stock bajo PAR
    Given el GLN "7413000000018" tiene nivel PAR mínimo de 50 unidades para GTIN "07501000001234"
    And el stock actual es 45
    When el sistema evalúa los niveles
    Then genera alerta "Stock bajo PAR en Farmacia Satélite 1 — GTIN 07501000001234"
    And notifica al Jefe de Farmacia vía outbox
```

---

### US.F2.5.17 — Reabastecimiento automático por niveles PAR

**Como** Jefe de Farmacia,
**quiero** definir niveles PAR (mínimo y máximo) por GTIN y GLN, y que el sistema genere solicitudes de reabastecimiento automáticamente cuando se alcanza el mínimo,
**para** evitar desdesabastecimiento en pisos y farmacias satélite.

**SP:** 8 | **MoSCoW:** Should | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.2`

**Dependencias:** US.F2.5.16.

**Reglas de validación:**
- Hard Stop: nivel PAR mínimo > máximo.
- Trigger: stock ≤ mínimo PAR → solicitud de reabastecimiento automática al almacén central.

**Notas técnicas:** Modelo `ParLevel { id, gtinId, glnId, minimum, maximum, organizationId }`. Job de evaluación periódica (cron Supabase o Edge Function cada 15 min). Solicitudes en modelo `RestockRequest`.

**Criterios de aceptación:**

```gherkin
Feature: Reabastecimiento por PAR

  Scenario: Generación automática de solicitud al caer bajo mínimo
    Given el PAR mínimo del GTIN "07501000001234" en GLN "7413000000018" es 50
    And el stock cae a 49 por una dispensación
    When el job de evaluación PAR se ejecuta
    Then crea RestockRequest al almacén central por la diferencia hasta máximo
    And notifica al Jefe de Farmacia y al Operador de Almacén
    And genera evento EPCIS WHY="bizStep:repack" WHO=systemUser

  Scenario: Configuración de PAR inválida (Hard Stop)
    Given el farmacéutico ingresa mínimo=100 y máximo=50
    When guarda la configuración
    Then Hard Stop "El mínimo PAR no puede ser mayor que el máximo"
```

---

### US.F2.5.18 — Transferencias con control de cadena de frío

**Como** Operador de Almacén,
**quiero** registrar la temperatura al momento del despacho y de la recepción para productos que requieren cadena de frío,
**para** detectar quiebres de temperatura durante el transporte y activar la cuarentena si corresponde.

**SP:** 8 | **MoSCoW:** Should | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.2 + §2.6`

**Dependencias:** US.F2.5.14, US.F2.5.15.

**Reglas de validación:**
- Hard Stop: temperatura de recepción fuera del rango definido para el GTIN → cuarentena automática.
- Warning: temperatura en rango pero próxima al límite (±1°C del umbral).
- Trigger: quiebre de cadena de frío activa Proceso F para esas unidades.

**Criterios de aceptación:**

```gherkin
Feature: Control de cadena de frío en transferencia

  Scenario: Temperatura dentro de rango — transferencia aprobada
    Given el GTIN "07501000008888" requiere cadena de frío 2–8°C
    And la temperatura registrada en recepción es 5°C
    When el farmacéutico confirma la recepción
    Then el sistema aprueba y actualiza stock normalmente
    And registra temperatura en el evento EPCIS

  Scenario: Quiebre de cadena de frío (Hard Stop)
    Given la temperatura de recepción es 12°C (fuera de 2–8°C)
    When el farmacéutico confirma con temperatura registrada
    Then Hard Stop "Temperatura fuera de rango — cadena de frío comprometida"
    And las unidades pasan automáticamente a estado QUARANTINE
    And genera evento EPCIS WHY="disposition:quarantine"
    And notifica a Jefe de Farmacia y Dirección Médica
```

---

### US.F2.5.19 — Historial de movimientos por GTIN+lote entre GLN

**Como** Químico Farmacéutico,
**quiero** consultar el historial completo de movimientos de un producto (GTIN + lote) entre todos los GLN del hospital,
**para** tener trazabilidad de custodia y soporte para auditorías o investigaciones de incidentes.

**SP:** 5 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.2`

**Dependencias:** US.F2.5.13.

**Criterios de aceptación:**

```gherkin
Feature: Historial de movimientos por GTIN+lote

  Scenario: Consulta de trazabilidad de un lote específico
    Given el lote "LOTE-ABC" del GTIN "07501000001234" tiene 5 movimientos entre GLN
    When el farmacéutico busca por GTIN+lote
    Then ve timeline: Recepción muelle → Almacén → Farmacia satélite → Piso 3
    And cada evento muestra WHO (operador), WHEN (timestamp), WHERE (GLN origen/destino)
    And puede exportar como PDF o JSON para auditoría

  Scenario: Lote sin movimientos registrados
    Given el lote "LOTE-XYZ" no tiene eventos en EpcisEvent
    When se consulta
    Then el sistema retorna "Sin historial de movimientos para este lote"
```

---

### US.F2.5.20 — Solicitud y aprobación de transferencias entre GLN

**Como** Jefe de Farmacia de Piso,
**quiero** solicitar una transferencia desde el almacén central mediante el sistema, y que el Jefe de Almacén la apruebe antes del despacho físico,
**para** tener control sobre los flujos de stock y evitar despachos no autorizados.

**SP:** 5 | **MoSCoW:** Should | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.2`

**Dependencias:** US.F2.5.14.

**Criterios de aceptación:**

```gherkin
Feature: Solicitud de transferencia

  Scenario: Solicitud aprobada y ejecutada
    Given el Jefe de Farmacia crea solicitud de 30 unidades de GTIN "07501000001234"
    When el Jefe de Almacén aprueba la solicitud
    Then el sistema habilita el despacho físico en la vista del operador
    And el estado de la solicitud cambia a APPROVED

  Scenario: Solicitud rechazada
    Given el Jefe de Almacén rechaza la solicitud con motivo "stock insuficiente"
    When el sistema procesa el rechazo
    Then notifica al Jefe de Farmacia con el motivo
    And el estado queda en REJECTED con nota
```

---

### US.F2.5.21 — Vinculación GLN origen-destino en evento EPCIS de transferencia

**Como** Sistema de Trazabilidad,
**quiero** que cada evento de transferencia persista el GLN de origen y de destino en el campo WHERE del evento EPCIS,
**para** que la trazabilidad logística sea consultable por ubicación en cualquier momento.

**SP:** 5 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §3`

**Dependencias:** US.F2.5.13, US.F2.5.14, US.F2.5.15.

**Criterios de aceptación:**

```gherkin
Feature: GLN en evento EPCIS de transferencia

  Scenario: Evento EPCIS con origen y destino
    Given se confirma la transferencia TRF-2026-001
    When el sistema genera el evento EPCIS
    Then el campo where contiene:
      | glnFrom | "7413000000001" (almacén central) |
      | glnTo   | "7413000000018" (farmacia satélite) |
    And ambos GLN existen en el catálogo GlnLocation
    And el evento es inmutable tras su creación

  Scenario: Consulta de transferencias por GLN destino
    Given existen 10 transferencias hacia GLN "7413000000018"
    When el supervisor filtra por GLN destino
    Then ve las 10 transferencias con timeline y cantidades
```

---

## Sección 4 — Proceso C: Fraccionamiento / Unidosis

### US.F2.5.22 — Captura de GTIN padre (caja comercial) en línea de reempaquetado

**Como** Técnico de Farmacia en Línea de Reempaquetado,
**quiero** escanear el GTIN de la caja comercial (padre) al inicio del proceso de fraccionamiento,
**para** que el sistema conozca el origen del lote y el número de dosis contenidas.

**SP:** 5 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.3`

**Dependencias:** US.F2.5.1.

**Reglas de validación:**
- Hard Stop: GTIN padre no registrado en catálogo maestro.
- Hard Stop: GTIN padre en estado de cuarentena o recall.
- Warning: stock del GTIN padre en el GLN es cero.

**Notas técnicas:** Proceso en router `unitDose.startRepack`. Campo `dosesPerPackage` en `GtinCatalog` determina la conciliación.

**Criterios de aceptación:**

```gherkin
Feature: Captura de GTIN padre en fraccionamiento

  Scenario: Inicio de fraccionamiento con GTIN válido
    Given el GTIN "07501000001234" (Amoxicilina 500mg / 14 cápsulas) existe en catálogo
    And tiene stock disponible en GLN farmacia central
    And dosesPerPackage=14
    When el técnico escanea el DataMatrix de la caja
    Then el sistema inicia una sesión de fraccionamiento
    And muestra: GTIN padre, lote, vencimiento y dosis esperadas (14)
    And el stock del padre se reserva lógicamente

  Scenario: GTIN padre en recall (Hard Stop)
    Given el GTIN "07501000001234" lote "LOTE-RECALL" está en alerta sanitaria
    When el técnico intenta iniciar fraccionamiento
    Then Hard Stop "Lote en alerta — fraccionamiento bloqueado"
```

---

### US.F2.5.23 — Generación de GTIN hijo (unidosis) con herencia de lote y vencimiento

**Como** Sistema de Unidosis,
**quiero** generar un GTIN de unidosis (hijo) que herede obligatoriamente el lote (AI 10) y vencimiento (AI 17) del GTIN padre,
**para** que cada unidosis sea trazable hasta su caja comercial de origen.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.3`

**Dependencias:** US.F2.5.22.

**Reglas de validación:**
- Hard Stop: unidosis sin lote heredado.
- Hard Stop: unidosis sin vencimiento heredado.
- Hard Stop: GTIN hijo igual al GTIN padre.

**Notas técnicas:** Modelo `UnitDose { id, gtinChild String, gtinParentId, lot String, expiration Date, serial String @unique, repackSessionId, status UnitDoseStatus }`. El GTIN hijo puede generarse como GS1 DataMatrix con Application Identifier (01) usando el GTIN de la presentación unidosis del catálogo, o un GTIN interno 14 dígitos prefijado con el código de la institución.

**Criterios de aceptación:**

```gherkin
Feature: Generación de GTIN hijo con herencia de atributos

  Scenario: Generación de unidosis con herencia correcta
    Given la sesión de fraccionamiento tiene GTIN padre con lote="LOTE-ABC" vencimiento="2027-01-01"
    When el sistema genera una unidosis
    Then crea registro UnitDose con:
      | gtinParentId | GTIN padre |
      | lot          | "LOTE-ABC" (heredado) |
      | expiration   | 2027-01-01 (heredado) |
      | serial       | UUID único |
    And los atributos son inmutables tras la generación

  Scenario: Intento de generar unidosis sin sesión activa
    Given no hay sesión de fraccionamiento abierta
    When el sistema intenta generar una unidosis
    Then retorna Hard Stop "Sin sesión de fraccionamiento activa"
```

---

### US.F2.5.24 — Impresión de DataMatrix en línea de reempaquetado

**Como** Técnico de Farmacia,
**quiero** imprimir el DataMatrix GS1 en el empaque de la unidosis inmediatamente después de su generación,
**para** que el producto fraccionado sea escaneable en todos los puntos del proceso logístico y clínico.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.3`

**Dependencias:** US.F2.5.23.

**Hardware requerido:** Impresora de etiquetas con cabezal térmico (Zebra ZD420 o equivalente), interfaz USB/LAN.

**Notas técnicas:** Generación del DataMatrix con `bwip-js` (Node.js server-side) o `@bwip-js/browser`. Codificación: AIs (01)+(17)+(10)+(21) concatenados con FNC1 separador. Impresión via ZPL a Zebra o PDF a impresora genérica. Template de etiqueta configurable por institución.

**Criterios de aceptación:**

```gherkin
Feature: Impresión DataMatrix unidosis

  Scenario: Impresión exitosa post-generación
    Given se genera la unidosis con GTIN "07501000001234-U" lote "LOTE-ABC" serial "SN-001"
    When el sistema envía a imprimir
    Then genera un DataMatrix con AI (01)+(17)+(10)+(21) codificados
    And el código impreso es decodificable con pistola HID estándar
    And se registra el evento de impresión en el log de la sesión

  Scenario: Impresora no disponible
    Given la impresora está offline
    When el sistema intenta enviar el trabajo de impresión
    Then Warning "Impresora no disponible — el trabajo queda en cola"
    And permite continuar la generación (la impresión se recupera cuando la impresora vuelva)
```

---

### US.F2.5.25 — Conciliación de unidosis (total hijos = dosis/caja × cajas)

**Como** Jefe de Farmacia,
**quiero** que el sistema valide que el total de unidosis generadas sea igual a (dosis por caja × número de cajas procesadas) al cerrar la sesión de fraccionamiento,
**para** detectar pérdidas o errores de conteo antes de que las unidades entren al stock.

**SP:** 5 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.3`

**Dependencias:** US.F2.5.23.

**Reglas de validación:**
- Hard Stop: total generado ≠ total esperado → no permite cierre sin autorización de Jefe Farmacia.
- Warning: diferencia ≤ 2% (merma de proceso aceptable) → permite cierre con nota.

**Criterios de aceptación:**

```gherkin
Feature: Conciliación de fraccionamiento

  Scenario: Conciliación exacta
    Given se procesaron 5 cajas de 14 dosis (esperado = 70 unidosis)
    And el sistema registra 70 unidosis generadas
    When el técnico cierra la sesión
    Then la conciliación pasa y el cierre se confirma automáticamente
    And genera evento EPCIS de transformación (Transformation Event)

  Scenario: Discrepancia fuera de tolerancia (Hard Stop)
    Given se esperaban 70 unidosis pero se generaron 65
    And la diferencia (7.1%) supera el 2% de tolerancia
    When el técnico intenta cerrar
    Then Hard Stop "Discrepancia de fraccionamiento: 5 unidades no contabilizadas"
    And requiere autorización del Jefe de Farmacia con nota explicativa

  Scenario: Discrepancia dentro de tolerancia (Warning)
    Given se esperaban 70 y se generaron 69 (diferencia 1.4%)
    When el técnico cierra
    Then Warning "1 unidosis de diferencia — dentro de tolerancia (≤2%)"
    And permite cierre con nota de merma obligatoria
```

---

### US.F2.5.26 — Evento EPCIS de transformación (Transformation Event)

**Como** Sistema de Trazabilidad,
**quiero** persistir un Transformation Event EPCIS al cerrar la sesión de fraccionamiento,
**para** registrar de manera inmutable la conversión de GTIN padre a GTIN hijos con todos los identificadores involucrados.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.3 + §3`

**Dependencias:** US.F2.5.25, US.F2.5.13.

**Criterios de aceptación:**

```gherkin
Feature: Transformation Event EPCIS

  Scenario: Persistencia del evento de transformación
    Given la sesión de fraccionamiento "REPACK-001" cierra con conciliación exitosa
    When el sistema genera el Transformation Event
    Then persiste en EpcisEvent con:
      | eventType | TransformationEvent |
      | what.inputs  | [GTIN padre × 5 cajas] |
      | what.outputs | [GTIN hijos × 70 unidosis con seriales] |
      | where     | GLN línea de reempaquetado |
      | when      | timestamp ISO8601 |
      | why       | bizStep:"repack" disposition:"active" |
      | who       | {technicianId, supervisorId, organizationId} |
    And el evento es inmutable

  Scenario: Trazabilidad inversa unidosis → padre
    Given la unidosis "SN-001" fue generada en fraccionamiento de GTIN "07501000001234"
    When el farmacéutico consulta la trazabilidad de la unidosis
    Then ve el Transformation Event que la originó
    And puede navegar al GTIN padre con su historial completo
```

---

### US.F2.5.27 — Trazabilidad inversa (unidosis → GTIN padre)

**Como** Químico Farmacéutico,
**quiero** consultar el GTIN padre, lote y vencimiento originales a partir del serial de una unidosis,
**para** responder ante incidentes de seguridad del paciente o investigaciones de farmacovigilancia.

**SP:** 5 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.3`

**Dependencias:** US.F2.5.26.

**Criterios de aceptación:**

```gherkin
Feature: Trazabilidad inversa unidosis

  Scenario: Búsqueda por serial de unidosis
    Given la unidosis serial "SN-001" existe en el sistema
    When el farmacéutico busca por serial
    Then ve: GTIN padre, lote heredado, vencimiento heredado, fecha de fraccionamiento, técnico responsable
    And puede exportar como reporte de trazabilidad

  Scenario: Serial no encontrado
    Given el serial "SN-XXXX" no existe
    When se busca
    Then retorna "Serial no encontrado — verifique el código impreso"
```

---

### US.F2.5.28 — Gestión de stock de unidosis por GLN

**Como** Farmacéutico de Piso,
**quiero** ver el stock de unidosis disponibles por GLN (farmacia → piso → cuarto),
**para** despachar la cantidad exacta según la orden médica activa.

**SP:** 5 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.3`

**Dependencias:** US.F2.5.25, US.F2.5.15.

**Criterios de aceptación:**

```gherkin
Feature: Stock de unidosis por GLN

  Scenario: Consulta de unidosis disponibles en piso
    Given el GLN "7413000000025" (Piso 3) tiene 45 unidosis de GTIN "07501000001234-U"
    When el farmacéutico consulta el stock del piso
    Then ve: GTIN, descripción, lote, vencimiento, cantidad disponible
    And ordenado por FEFO (primero vence, primero sale)

  Scenario: Sin stock de unidosis
    Given el stock del GLN es 0 para el producto solicitado
    When el farmacéutico consulta
    Then Warning "Sin unidosis disponibles — solicitar reabastecimiento"
    And habilita botón de solicitud de transferencia
```

---

## Sección 5 — Proceso F: Logística Inversa y Cuarentena

### US.F2.5.29 — Captura y registro de recall de fabricante / MINSAL

**Como** Director de Farmacia,
**quiero** registrar en el sistema una alerta de recall proveniente del fabricante o de MINSAL (manual o vía RSS),
**para** iniciar inmediatamente el barrido de todos los GLN y el bloqueo de las unidades comprometidas.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.6`

**Dependencias:** US.F2.5.3.

**Reglas de validación:**
- Trigger inmediato: creación de recall activa barrido en todos los GLN (US.F2.5.30).
- Hard Stop: recall sin GTIN y sin lote → no se puede crear (ambiguo).

**Notas técnicas:** Modelo `SanitaryAlert { id, gtin, lot String?, expirationDate Date?, source AlertSource, severity AlertSeverity, description, issuedAt, isActive Boolean, organizationId }`. Enum `AlertSource { MANUFACTURER, MINSAL, MANUAL }`. Feed RSS MINSAL parseado via Edge Function (si disponible). Patrón outbox para notificación masiva.

**Criterios de aceptación:**

```gherkin
Feature: Registro de recall

  Scenario: Registro manual de recall MINSAL
    Given el Director de Farmacia recibe comunicado de MINSAL
    When ingresa: GTIN="07501000001234", lote="LOTE-RECALL-X", motivo, severidad=CRITICAL
    Then el sistema crea la alerta como activa
    And dispara inmediatamente el barrido por todos los GLN (US.F2.5.30)
    And genera evento EPCIS WHY="bizStep:recall" WHO=directorId
    And registra en log de auditoría con timestamp

  Scenario: Recall sin GTIN ni lote (Hard Stop)
    Given el usuario no especifica GTIN ni lote
    When intenta guardar
    Then Hard Stop "Debe especificar al menos GTIN o lote para un recall"
```

---

### US.F2.5.30 — Barrido instantáneo por todos los GLN ante recall

**Como** Sistema de Trazabilidad,
**quiero** ejecutar un barrido de inventario en todos los GLN al registrar un recall para identificar todas las unidades comprometidas,
**para** proceder con el bloqueo lógico antes de cualquier dispensación.

**SP:** 13 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.6`

**Dependencias:** US.F2.5.29, US.F2.5.3.

**Reglas de validación:**
- Trigger: barrido debe completarse en < 30 segundos (SLO) independientemente del número de GLN.
- Trigger: cada unidad encontrada pasa automáticamente a QUARANTINE.

**Notas técnicas:** Query SQL con árbol GLN completo (CTE recursiva) filtrando `InventoryMovement` por GTIN+lote. Ejecutable como Supabase Edge Function asíncrona disparada por insert en `SanitaryAlert`. SLO medido con `infrastructure/observability`.

**Criterios de aceptación:**

```gherkin
Feature: Barrido de GLN ante recall

  Scenario: Barrido exitoso con unidades encontradas
    Given el recall afecta GTIN "07501000001234" lote "LOTE-RECALL-X"
    And existen 47 unidades distribuidas en 5 GLN distintos
    When se activa el barrido
    Then el sistema identifica las 47 unidades en < 30 segundos
    And lista por GLN: [GLN, cantidad, estado anterior, nuevo estado]
    And cambia todas a estado QUARANTINE
    And genera evento EPCIS por cada GLN: WHY="disposition:quarantine"

  Scenario: Barrido sin unidades encontradas
    Given el recall afecta un lote que ya fue agotado o devuelto
    When se ejecuta el barrido
    Then retorna "0 unidades en inventario activo para este lote"
    And el recall queda activo para bloquear recepciones futuras

  Scenario: SLO de barrido excedido
    Given el barrido tarda > 30 segundos
    When el sistema detecta el timeout
    Then registra alerta en observability y notifica al SRE
    And continúa el barrido en background hasta completar
```

---

### US.F2.5.31 — Bloqueo lógico de lote a nivel institucional

**Como** Sistema de Trazabilidad,
**quiero** que al activarse un recall o cuarentena, el lote quede bloqueado lógicamente en toda la institución,
**para** que cualquier intento de escaneo, despacho o dispensación del lote sea rechazado con Hard Stop.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.6`

**Dependencias:** US.F2.5.30.

**Reglas de validación:**
- Hard Stop en TODOS los procesos: escaneo en muelle (US.F2.5.7), despacho (US.F2.5.14), fraccionamiento (US.F2.5.22) — verifican tabla `SanitaryAlert` antes de proceder.
- Trigger: bloqueo activo notifica vía outbox a todos los farmacéuticos con sesión activa.

**Criterios de aceptación:**

```gherkin
Feature: Bloqueo institucional de lote

  Scenario: Intento de despacho de lote bloqueado
    Given el lote "LOTE-RECALL-X" está en estado QUARANTINE
    When cualquier operador intenta despacharlo desde cualquier GLN
    Then Hard Stop "LOTE BLOQUEADO — Recall activo. Contacte al Director de Farmacia"
    And registra el intento con operatorId y timestamp en log de auditoría

  Scenario: Intento de fraccionamiento de lote bloqueado
    Given el mismo lote está bloqueado
    When el técnico intenta iniciar fraccionamiento
    Then Hard Stop idéntico — el bloqueo es transversal a todos los procesos

  Scenario: Desbloqueo autorizado por Director de Farmacia
    Given el recall ha sido resuelto y las unidades verificadas como seguras
    When el Director de Farmacia cambia el estado a CLEARED con nota
    Then el lote vuelve a estar disponible en todos los procesos
    And se genera evento EPCIS WHY="disposition:active" WHO=directorId
```

---

### US.F2.5.32 — Notificación push a farmacéuticos ante recall

**Como** Químico Farmacéutico,
**quiero** recibir una notificación inmediata en mi sesión activa cuando se activa un recall que afecta productos en mi GLN,
**para** actuar de inmediato sin esperar reportes periódicos.

**SP:** 5 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.6`

**Dependencias:** US.F2.5.29, US.F2.5.30.

**Notas técnicas:** Outbox pattern (Beta.15): evento en tabla `OutboxEvent` procesado por worker. Canales: notificación in-app (Supabase Realtime), correo electrónico, y opcionalmente SMS/WhatsApp si está configurado. Notificación contiene: GTIN, lote, GLN afectados, motivo de recall, instrucciones.

**Criterios de aceptación:**

```gherkin
Feature: Notificación push de recall

  Scenario: Farmacéutico activo recibe notificación inmediata
    Given el farmacéutico "QF-Ana" tiene sesión activa en el sistema
    And su GLN "7413000000018" tiene 15 unidades del lote comprometido
    When se activa el recall
    Then "QF-Ana" recibe notificación in-app en < 60 segundos con:
      | campo | valor |
      | tipo  | RECALL_ALERT |
      | gtin  | 07501000001234 |
      | lote  | LOTE-RECALL-X |
      | cantidadEnSuGln | 15 |
      | instrucciones | "Aislar unidades — no dispensar" |
    And el badge de alertas en el sidebar muestra la alerta en rojo

  Scenario: Farmacéutico sin sesión activa
    Given el farmacéutico "QF-Luis" no tiene sesión activa
    When se activa el recall
    Then el sistema envía correo electrónico con la alerta completa
    And cuando inicie sesión verá el banner de alerta pendiente
```

---

### US.F2.5.33 — Devolución cuantificada al proveedor con acta

**Como** Director de Farmacia,
**quiero** registrar la devolución física de unidades en cuarentena al proveedor con cantidad exacta y generar el acta de devolución,
**para** tener soporte documental del proceso de logística inversa.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.6`

**Dependencias:** US.F2.5.31.

**Reglas de validación:**
- Hard Stop: devolver más unidades de las que hay en cuarentena.
- Trigger: devolución confirmada genera acta en PDF con firma del Director y del proveedor.
- Trigger: genera evento EPCIS WHY="bizStep:returning disposition:returned".

**Notas técnicas:** Modelo `ReturnOrder { id, sanitaryAlertId, providerId, lines Json, actaPdfUrl String?, status ReturnStatus, authorizedBy, returnedAt? }`. Generación de PDF con `@react-pdf/renderer` o `pdfkit`.

**Criterios de aceptación:**

```gherkin
Feature: Devolución cuantificada al proveedor

  Scenario: Devolución exitosa con acta generada
    Given existen 47 unidades en cuarentena del lote "LOTE-RECALL-X"
    And el proveedor "PROVEEDOR-XYZ" es el responsable
    When el Director de Farmacia registra devolución de 47 unidades y confirma
    Then el sistema reduce el inventario en cuarentena a 0
    And genera acta PDF con: fecha, GTIN, lote, cantidad, proveedor, firma digital del Director
    And actualiza el estado de las unidades a RETURNED
    And genera evento EPCIS WHY="returning" WHO=directorId
    And envía acta por correo al proveedor

  Scenario: Cantidad de devolución excede cuarentena (Hard Stop)
    Given solo 47 unidades están en cuarentena
    When el Director intenta devolver 50
    Then Hard Stop "No puede devolver más unidades de las que están en cuarentena (47)"
```

---

### US.F2.5.34 — Cuarentena automática por cadena de frío fuera de rango

**Como** Sistema de Trazabilidad,
**quiero** que cuando la temperatura de recepción de una transferencia esté fuera del rango permitido para el GTIN, las unidades pasen automáticamente a cuarentena sin intervención manual,
**para** evitar que productos comprometidos entren al inventario activo.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.6`

**Dependencias:** US.F2.5.18.

**Reglas de validación:**
- Hard Stop: temperatura fuera de rango → cuarentena automática inmediata.
- Trigger: cuarentena notifica a Jefe de Farmacia, Director Médico y registra en EpcisEvent.

**Criterios de aceptación:**

```gherkin
Feature: Cuarentena automática por temperatura

  Scenario: Temperatura fuera de rango activa cuarentena
    Given el GTIN "07501000008888" requiere 2–8°C
    And la temperatura registrada en recepción es 11°C
    When el sistema evalúa la temperatura al confirmar recepción
    Then las 30 unidades recibidas pasan automáticamente a QUARANTINE
    And el sistema muestra Hard Stop "Temperatura fuera de rango — unidades en cuarentena"
    And genera evento EPCIS WHY="disposition:quarantine" WHO=systemAudit
    And notifica a Jefe de Farmacia y Director Médico

  Scenario: Temperatura en rango — sin cuarentena
    Given la temperatura registrada es 5°C (dentro de 2–8°C)
    When el sistema evalúa
    Then las unidades pasan a inventario activo normalmente
```

---

### US.F2.5.35 — Alertas y cuarentena por vencimientos próximos

**Como** Sistema de Trazabilidad,
**quiero** evaluar diariamente los vencimientos del inventario y generar alertas para productos próximos a vencer, y cuarentena automática al cumplirse la fecha,
**para** garantizar que no se dispensen productos vencidos.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.6`

**Dependencias:** US.F2.5.16.

**Reglas de validación:**
- Warning: vencimiento ≤ 90 días → alerta al Jefe de Farmacia.
- Warning: vencimiento ≤ 30 días → alerta escalada a Director de Farmacia.
- Hard Stop / Cuarentena: vencimiento = hoy o pasado → cuarentena automática inmediata.

**Notas técnicas:** Job programado (Supabase Edge Function / cron diario a las 06:00 CST). Query sobre `InventoryMovement` filtrando `expiration <= now() + interval '90 days'`. Outbox para notificaciones.

**Criterios de aceptación:**

```gherkin
Feature: Alertas de vencimiento

  Scenario: Alerta a 90 días de vencimiento
    Given existen 20 unidades del GTIN "07501000001234" lote "LOTE-ABC" con vencimiento en 85 días
    When el job diario de vencimientos se ejecuta
    Then genera alerta Warning al Jefe de Farmacia: "20 unidades vencen en 85 días"
    And sugiere rotación FEFO o devolución al proveedor

  Scenario: Cuarentena automática al vencer
    Given el lote "LOTE-OLD" tiene vencimiento = hoy
    When el job diario se ejecuta
    Then todas las unidades de ese lote pasan automáticamente a QUARANTINE
    And genera evento EPCIS WHY="disposition:quarantine" WHO=systemAudit
    And notifica a Director de Farmacia y Jefe de Almacén
    And bloquea cualquier intento de dispensación (Hard Stop)

  Scenario: Escalada a Director de Farmacia a 30 días
    Given 10 unidades vencen en 25 días
    When el job se ejecuta
    Then alerta escalada al Director de Farmacia con opción [Devolver] | [Usar prioritariamente]
```

---

### US.F2.5.36 — Registro de mermas con autorización

**Como** Jefe de Farmacia,
**quiero** registrar las mermas de inventario (rotura, deterioro, error de proceso) con motivo detallado y que requieran mi autorización,
**para** mantener el inventario exacto y cumplir con los controles internos de Farmacia.

**SP:** 5 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.6`

**Dependencias:** US.F2.5.16.

**Reglas de validación:**
- Hard Stop: merma > 10 unidades requiere autorización de Director de Farmacia (además del Jefe).
- Trigger: registro de merma genera evento EPCIS WHY="disposition:destroyed".

**Criterios de aceptación:**

```gherkin
Feature: Registro de mermas

  Scenario: Merma ≤ 10 unidades aprobada por Jefe de Farmacia
    Given el Técnico reporta rotura de 3 unidades del GTIN "07501000001234"
    When el Jefe de Farmacia aprueba con motivo "Caída accidental — rotura de envase"
    Then el sistema reduce el stock en 3 unidades
    And genera evento EPCIS WHY="disposition:destroyed" WHO=jefeId
    And registra en log de auditoría con motivo y autorizante

  Scenario: Merma > 10 unidades requiere Director de Farmacia
    Given el Técnico reporta deterioro de 15 unidades
    When el Jefe de Farmacia aprueba
    Then el sistema solicita confirmación adicional del Director de Farmacia
    And la merma queda en estado PENDING hasta la segunda aprobación
```

---

### US.F2.5.37 — Panel de logística inversa y cuarentena

**Como** Director de Farmacia,
**quiero** un panel unificado que muestre todos los recalls activos, unidades en cuarentena por GLN, devoluciones pendientes y mermas del período,
**para** gestionar el Proceso F desde un único punto de control.

**SP:** 5 | **MoSCoW:** Should | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.6`

**Dependencias:** US.F2.5.29, US.F2.5.30, US.F2.5.33, US.F2.5.35, US.F2.5.36.

**Criterios de aceptación:**

```gherkin
Feature: Panel de logística inversa

  Scenario: Visualización consolidada de Proceso F
    Given existen 2 recalls activos, 85 unidades en cuarentena, 1 devolución pendiente
    When el Director accede al panel de Logística Inversa
    Then ve sección "Recalls Activos" con contador y lista
    And sección "Cuarentena por GLN" con mapa de unidades
    And sección "Devoluciones Pendientes" con botón de acción
    And sección "Mermas del Mes" con total y desglose por motivo

  Scenario: Acceso denegado a rol no autorizado
    Given un técnico de farmacia intenta acceder al panel
    When navega a la ruta
    Then el sistema retorna 403 "Acceso denegado — se requiere rol PHARMACY_DIRECTOR"
```

---

### US.F2.5.38 — Registro de devolución por vencimiento próximo al proveedor

**Como** Jefe de Farmacia,
**quiero** registrar devoluciones preventivas al proveedor de productos próximos a vencer antes de su cuarentena obligatoria,
**para** recuperar crédito del proveedor y reducir mermas.

**SP:** 5 | **MoSCoW:** Could | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.6`

**Dependencias:** US.F2.5.33, US.F2.5.35.

**Criterios de aceptación:**

```gherkin
Feature: Devolución preventiva por vencimiento

  Scenario: Devolución antes del vencimiento
    Given el lote "LOTE-PRÓXIMO" vence en 45 días
    And el proveedor acepta devoluciones con > 30 días de vigencia
    When el Jefe de Farmacia registra la devolución preventiva
    Then el sistema reduce el stock activo
    And genera acta de devolución preventiva (no de recall)
    And genera evento EPCIS WHY="returning disposition:returned"
    And el lote NO pasa a cuarentena (es devolución voluntaria activa)
```

---

## Sección 6 — Eventos EPCIS: Persistencia y Consulta

### US.F2.5.39 — Modelo de persistencia de eventos EPCIS

**Como** Arquitecto de Soluciones,
**quiero** un modelo de datos `EpcisEvent` que soporte todos los tipos de eventos del estándar (Object, Aggregation, Transaction, Transformation),
**para** tener una tabla única e inmutable de trazabilidad que cubra los cuatro procesos GS1.

**SP:** 8 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §3`

**Dependencias:** Ninguna (infraestructura base de trazabilidad).

**Notas técnicas:**
```prisma
model EpcisEvent {
  id          String       @id @default(cuid())
  eventType   EpcisEventType  // ObjectEvent | AggregationEvent | TransactionEvent | TransformationEvent
  what        Json         // {gtins?, ssccs?, unitDoses?, inputs?, outputs?}
  where       Json         // {glnFrom?, glnTo?}
  when        DateTime     // ISO8601 con timezone
  why         Json         // {bizStep: String, disposition: String}
  who         Json         // {operatorId?, patientId?, organizationId}
  organizationId String
  createdAt   DateTime     @default(now())
  // sin updatedAt — inmutable
  @@index([organizationId, when])
  @@index([organizationId])
}
```
RLS: solo lectura para roles PHARMACY_*, escritura solo via `withTenantContext` en routers específicos.

**Criterios de aceptación:**

```gherkin
Feature: Modelo EpcisEvent

  Scenario: Creación inmutable de evento
    Given el router epcis.create recibe un evento válido
    When persiste en EpcisEvent
    Then no existe endpoint UPDATE ni DELETE para esa tabla
    And el audit trigger registra la inserción en audit.audit_log
    And el evento es visible en consultas de trazabilidad

  Scenario: RLS aplicado correctamente
    Given el usuario pertenece a organización "ORG-A"
    When consulta eventos EPCIS
    Then solo ve eventos donde organizationId = "ORG-A"
    And usa withTenantContext en el router
```

---

### US.F2.5.40 — API de consulta de eventos EPCIS por GTIN/lote/GLN

**Como** Químico Farmacéutico o Auditor,
**quiero** consultar eventos EPCIS filtrando por GTIN, lote, GLN o rango de fechas,
**para** obtener la trazabilidad completa de cualquier producto o ubicación.

**SP:** 5 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §3`

**Dependencias:** US.F2.5.39.

**Criterios de aceptación:**

```gherkin
Feature: Consulta EPCIS

  Scenario: Búsqueda por GTIN y rango de fechas
    Given existen 15 eventos para GTIN "07501000001234" en enero 2026
    When el auditor filtra por GTIN + fecha_inicio + fecha_fin
    Then retorna los 15 eventos ordenados por WHEN ascendente
    And incluye todos los campos WHAT/WHERE/WHEN/WHY/WHO

  Scenario: Búsqueda por GLN
    Given el GLN "7413000000018" tiene 30 eventos en el mes
    When se filtra por GLN
    Then retorna eventos donde where.glnFrom OR where.glnTo = GLN buscado

  Scenario: Sin resultados
    Given no hay eventos para los filtros aplicados
    When se consulta
    Then retorna lista vacía con mensaje "Sin eventos para los filtros seleccionados"
```

---

### US.F2.5.41 — Exportación de cadena de trazabilidad en formato JSON/PDF

**Como** Director de Farmacia o Auditor MINSAL,
**quiero** exportar la cadena completa de eventos EPCIS de un producto (GTIN + lote) en formato JSON o PDF,
**para** presentar evidencia ante autoridades reguladoras o en investigaciones de incidentes.

**SP:** 5 | **MoSCoW:** Should | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §4.3`

**Dependencias:** US.F2.5.40.

**Criterios de aceptación:**

```gherkin
Feature: Exportación de trazabilidad

  Scenario: Exportación JSON de cadena EPCIS
    Given existen 8 eventos para GTIN "07501000001234" lote "LOTE-ABC"
    When el auditor exporta en JSON
    Then descarga archivo JSON con array de 8 eventos completos
    And el archivo incluye metadata: organización, fecha de exportación, exportador

  Scenario: Exportación PDF con firma
    Given los mismos 8 eventos
    When el Director exporta en PDF
    Then genera PDF con timeline visual de eventos
    And incluye firma digital del Director de Farmacia
    And marca el documento como "Copia para fines regulatorios"
```

---

### US.F2.5.42 — Verificación de integridad de la cadena EPCIS

**Como** Auditor Interno,
**quiero** ejecutar una verificación de integridad sobre la secuencia de eventos EPCIS de un lote,
**para** detectar eventos faltantes, incoherencias de estado o manipulaciones en el registro.

**SP:** 5 | **MoSCoW:** Should | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §3`

**Dependencias:** US.F2.5.39.

**Notas técnicas:** Validaciones: (a) disposición anterior compatible con la nueva (máquina de estados), (b) GLN origen del evento N = GLN destino del evento N-1, (c) timestamps estrictamente crecientes.

**Criterios de aceptación:**

```gherkin
Feature: Integridad cadena EPCIS

  Scenario: Cadena íntegra sin brechas
    Given la cadena de un lote tiene: recepción → despacho → recepción farmacia → fraccionamiento
    When el auditor ejecuta la verificación
    Then el sistema valida transiciones de estado coherentes
    And confirma "Cadena íntegra — 4 eventos, sin brechas detectadas"

  Scenario: Brecha detectada en la cadena
    Given falta el evento de recepción en farmacia entre el despacho y el fraccionamiento
    When se ejecuta la verificación
    Then Warning "Brecha detectada entre evento 2 y 3: unidad no recibida antes de fraccionar"
    And registra la alerta para revisión del auditor
```

---

## Sección 7 — Reportería de Trazabilidad

### US.F2.5.43 — Reporte de inventario en tiempo real por GLN

**Como** Director de Farmacia,
**quiero** un reporte de inventario actual mostrando stock por GLN, GTIN, lote y vencimiento con exportación a Excel,
**para** soporte de decisiones de reabastecimiento y cumplimiento con auditorías internas.

**SP:** 5 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.2`

**Dependencias:** US.F2.5.16.

**Criterios de aceptación:**

```gherkin
Feature: Reporte de inventario por GLN

  Scenario: Generación de reporte completo
    Given el inventario tiene 250 registros activos en 8 GLN
    When el Director ejecuta el reporte
    Then ve tabla: GLN | Nombre | GTIN | Descripción | Lote | Vencimiento | Cantidad | Estado
    And ordenado por GLN ascendente y vencimiento FEFO
    And puede exportar a Excel (.xlsx) con formato institucional

  Scenario: Filtro por estado de inventario
    Given el Director filtra por estado=QUARANTINE
    When aplica el filtro
    Then muestra solo las unidades en cuarentena con motivo
```

---

### US.F2.5.44 — Reporte de trazabilidad completa de un lote

**Como** Jefe de Farmacia,
**quiero** un reporte que muestre el ciclo de vida completo de un lote (recepción → transferencias → fraccionamiento → dispensaciones → devoluciones / mermas),
**para** responder ante auditorías o investigaciones de farmacovigilancia.

**SP:** 5 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §3`

**Dependencias:** US.F2.5.40.

**Criterios de aceptación:**

```gherkin
Feature: Reporte de ciclo de vida de lote

  Scenario: Reporte completo de lote con todos los procesos
    Given el lote "LOTE-ABC" pasó por A, B, C y F
    When el Jefe de Farmacia genera el reporte por lote
    Then ve timeline: Recepción (fecha, operador, GLN) → Transferencias → Fraccionamiento → Dispensaciones
    And totales: unidades recibidas, transferidas, fraccionadas, dispensadas, en cuarentena, devueltas, merma
    And cada evento con timestamp y responsable

  Scenario: Exportar para auditoría
    Given el mismo reporte
    When el Jefe exporta en PDF
    Then genera documento de 1-N páginas con firma del Jefe de Farmacia
```

---

### US.F2.5.45 — Reporte de recalls y cuarentenas activas

**Como** Director de Farmacia,
**quiero** un reporte de todas las alertas sanitarias activas con las unidades afectadas por GLN y su estado de resolución,
**para** monitorear el Proceso F y demostrar cumplimiento ante MINSAL.

**SP:** 5 | **MoSCoW:** Must | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.6`

**Dependencias:** US.F2.5.29, US.F2.5.33.

**Criterios de aceptación:**

```gherkin
Feature: Reporte de recalls activos

  Scenario: Vista de recalls con estado de resolución
    Given existen 3 recalls activos y 1 resuelto en el mes
    When el Director genera el reporte
    Then ve: Recall | GTIN | Lote | Fuente | Fecha | Unidades afectadas | Estado | Fecha resolución
    And recalls activos en rojo, resueltos en verde
    And puede hacer drill-down a unidades por GLN

  Scenario: Exportación para MINSAL
    Dado el mismo reporte
    When exporta en PDF
    Then incluye sello institucional y firma del Director
    And detalle de acciones tomadas por cada recall
```

---

### US.F2.5.46 — Dashboard GS1 para Dirección de Farmacia

**Como** Director de Farmacia,
**quiero** un dashboard ejecutivo con KPIs de trazabilidad GS1 (tasa de escaneo, unidades en cuarentena, recalls activos, tiempo de barrido),
**para** monitorear la madurez del programa GS1 y reportar a la Dirección del hospital.

**SP:** 5 | **MoSCoW:** Should | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §4.2`

**Dependencias:** US.F2.5.43, US.F2.5.44, US.F2.5.45.

**Criterios de aceptación:**

```gherkin
Feature: Dashboard GS1

  Scenario: KPIs visibles al ingresar al dashboard
    Given el sistema tiene datos del mes en curso
    When el Director abre el dashboard GS1
    Then ve los KPIs:
      | KPI | Descripción |
      | Tasa de escaneo en muelle | % recepciones con SSCC vs. manuales |
      | Unidades en cuarentena | Total actual |
      | Recalls activos | Contador con semáforo |
      | Tiempo promedio de barrido | En segundos (SLO: < 30s) |
      | Transferencias del día | Por GLN |
    And cada KPI tiene drill-down al reporte detallado

  Scenario: KPI de tiempo de barrido en rojo
    Given el tiempo promedio de barrido del mes es 45 segundos (> SLO 30s)
    When el Director ve el dashboard
    Then el KPI de tiempo de barrido aparece en rojo con indicador de SLO violado
    And enlaza al runbook de optimización
```

---

### US.F2.5.47 — Reporte de conciliación de fraccionamiento

**Como** Auditor de Farmacia,
**quiero** un reporte mensual de todas las sesiones de fraccionamiento con conciliación (esperado vs. generado) y mermas de proceso,
**para** detectar patrones de pérdida y cumplir con controles internos de unidosis.

**SP:** 5 | **MoSCoW:** Could | **Trazabilidad:** `guia_trazabilidad_hospitalaria_gs1.md §2.3`

**Dependencias:** US.F2.5.25.

**Criterios de aceptación:**

```gherkin
Feature: Reporte de conciliación de fraccionamiento

  Scenario: Reporte mensual de sesiones con conciliación
    Given existen 45 sesiones de fraccionamiento en el mes
    When el Auditor genera el reporte mensual
    Then ve: Sesión | GTIN | Cajas procesadas | Unidosis esperadas | Generadas | Diferencia | % | Autorización
    And sesiones con diferencia > 2% en rojo

  Scenario: Sesión con Hard Stop pendiente de autorización
    Given la sesión "REPACK-025" tiene diferencia 5% sin autorización del Director
    When aparece en el reporte
    Then se marca como "Pendiente autorización" con alerta al Auditor
```

---

## Decisiones Pendientes

| ID | Decisión | Responsable | Fecha límite |
|---|---|---|---|
| DP-01 | Formato DESADV: EDI EDIFACT D96A o JSON propietario por proveedor | @AT + Proveedor Principal | Sprint 1 |
| DP-02 | GTIN hijo de unidosis: usar GTIN del catálogo GS1 o GTIN interno 14 dígitos | @PO + Director Farmacia + GS1 SV | Sprint 1 |
| DP-03 | Hardware de escaneo: Zebra DS2278 HID vs. integración NFC/BLE | @AT + Logística | Sprint 0 |
| DP-04 | Feed RSS MINSAL para recalls: disponibilidad y formato a confirmar con MINSAL | @AE + Relaciones Institucionales | Sprint 0 |
| DP-05 | Impresora de etiquetas: ZPL directo vs. PDF genérico | @AT + Farmacia Central | Sprint 1 |
| DP-06 | SLO de barrido de recall (30s): validar con @SRE según volumen de GLN | @SRE | Sprint 1 |
| DP-07 | Retención de EpcisEvents: 10 años (alineado con audit chain CLAUDE.md) o menos | @AE + Legal | Sprint 0 |

---

## Capacidad estimada

| Sección | US | SP |
|---|---|---|
| S1 — Catálogos GTIN/GLN/SSCC | 5 | 31 |
| S2 — Proceso A Inbound | 8 | 74 |
| S3 — Proceso B Transferencias | 8 | 57 |
| S4 — Proceso C Unidosis | 7 | 44 |
| S5 — Proceso F Logística Inversa | 10 | 65 |
| S6 — EPCIS Persistencia/Consulta | 4 | 23 |
| S7 — Reportería | 5 | 25 |
| **Total** | **47** | **319** |

**Velocidad estimada de equipo:** 40–60 SP / sprint de 2 semanas.
**Duración estimada:** 6–8 sprints (12–16 semanas).

### Distribución por MoSCoW
| Prioridad | US | SP |
|---|---|---|
| Must | 31 | 234 |
| Should | 10 | 61 |
| Could | 6 | 24 |

**MVP GS1 (Must):** 31 US / 234 SP — cubre 100% de los procesos A, B, C, F con trazabilidad EPCIS completa.

---

## Riesgos

| ID | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R-01 | Proveedor no envía DESADV — recepción 100% manual | Alta | Medio | Modo de recepción por GTIN+lote siempre disponible (US.F2.5.8) |
| R-02 | Hardware de escaneo no llega a tiempo | Media | Alto | Modo cámara PWA disponible desde Sprint 1 (US.F2.5.12) |
| R-03 | GTIN de proveedores no normalizados a GS1 | Media | Alto | Catálogo maestro con validación de dígito verificador; onboarding de proveedores |
| R-04 | Volumen de EpcisEvents degrada queries | Media | Medio | Índices en `(organizationId, when)`; partición por mes si > 1M eventos/mes |
| R-05 | Feed RSS MINSAL no disponible | Alta | Medio | Captura manual siempre disponible (US.F2.5.29); alerta por correo como fallback |
| R-06 | SLO de barrido 30s difícil con muchos GLN | Baja | Alto | CTE optimizada + job asíncrono + alerta a SRE si SLO se viola |
| R-07 | Impresora de etiquetas incompatible con ZPL | Media | Medio | Fallback a PDF genérico siempre disponible (US.F2.5.24) |

---

## KPIs de Producto (medición de éxito)

| KPI | Baseline | Target 6 meses |
|---|---|---|
| Tasa de escaneo en muelle (vs. ingreso manual) | 0% | ≥ 85% |
| Tiempo de respuesta ante recall (detección → bloqueo total) | > 4 horas | < 30 minutos |
| Unidades dispensadas de lotes vencidos (incidentes) | Desconocido | 0 |
| Cobertura de GLN con stock en tiempo real | 0% | 100% |
| Conciliación de fraccionamiento con diferencia > 2% | Desconocido | < 1% de sesiones |
| Eventos EPCIS con los 5 campos completos | 0% | 100% |

---

## Hardware requerido (consolidado)

| Dispositivo | Uso | Proceso | Cantidad estimada |
|---|---|---|---|
| Pistola USB HID (Zebra DS2278 o equiv.) | Escaneo SSCC/GTIN en muelle y farmacias | A, B, C | 1 por punto de control |
| Cámara PWA (smartphone ≥ 8MP) | Escaneo alternativo | A, B | 2 por turno (backup) |
| Impresora de etiquetas térmicas (Zebra ZD420 o equiv.) | Impresión DataMatrix unidosis | C | 1 por línea de reempaquetado |
| Sensor de temperatura (opcional) | Registro cadena de frío en transferencias | B, F | 1 por transporte refrigerado |

---

## Trazabilidad negocio → épica → US

| Objetivo de negocio | Épica | US clave |
|---|---|---|
| Eliminar errores por medicamento mal identificado | E.F2.5 | US.F2.5.9, US.F2.5.31, US.F2.5.35 |
| Respuesta ante recall < 30 min | E.F2.5 | US.F2.5.29, US.F2.5.30, US.F2.5.32 |
| Visibilidad de stock en tiempo real | E.F2.5 | US.F2.5.16, US.F2.5.43 |
| Trazabilidad de unidosis inversa | E.F2.5 | US.F2.5.23, US.F2.5.26, US.F2.5.27 |
| Cumplimiento MINSAL serialización | E.F2.5 | US.F2.5.5, US.F2.5.13, US.F2.5.39 |
| Control de cadena de frío | E.F2.5 | US.F2.5.18, US.F2.5.34 |
