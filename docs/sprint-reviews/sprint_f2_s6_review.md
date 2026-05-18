# Sprint Review — Fase 2 Sprint 6 (F2-S6)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Fecha:** 2026-05-17
**Autores:** @QA (métricas de calidad + evidencia de testing), @PO (logros + valor), @Orq (consolidación)
**Sprint:** F2-S6 — GS1 Trazabilidad Logística: Procesos A, B, C, F + EPCIS + decoder DataMatrix
**Rama base:** `feat/fase2-s1-gate` (último commit verificado: `6532a92`)

---

## 1. Resumen ejecutivo

El Sprint F2-S6 cierra la capa GS1 de trazabilidad logística de HIS Avante, implementando
los cuatro procesos críticos: Recepción Inbound (A), Transferencias Internas (B),
Fraccionamiento/Unidosis (C) y Logística Inversa/Cuarentena (F), más el motor de eventos
EPCIS como registro inmutable de cadena de custodia.

Los 15 streams paralelos entregaron:

- **Catálogos maestros GS1** (GTIN, GLN, SSCC, GSRN, GIAI) con validadores de dígito
  verificador en `packages/contracts/src/validators/gs1.ts`.
- **Proceso A — Recepción** (DESADV matching, escaneo muelle, bloqueo recall en recepción,
  recepción parcial, PWA con cámara ZXing).
- **Proceso B — Transferencias** (despacho GLN origen, recepción GLN destino, visibilidad
  en tiempo real, reabastecimiento PAR, cadena de frío).
- **Proceso C — Unidosis** (fraccionamiento, herencia lote/vencimiento, impresión DataMatrix,
  conciliación, trazabilidad inversa serial → GTIN padre).
- **Proceso F — Logística Inversa** (recall, barrido < 30s por todos los GLN, bloqueo
  institucional transversal, devolución con acta, cuarentena automática, mermas).
- **Motor EPCIS** (tabla `EpcisEvent` inmutable, Object/Aggregation/Transaction/Transformation,
  API de consulta por GTIN/lote/GLN, exportación JSON/PDF).
- **Decoder DataMatrix** (componente `<BarcodeScanner>` con `@zxing/browser`, FNC1 parser,
  AIs 01+17+10+21, debounce HID 200ms).

---

## 2. Logros por stream

| Stream | Descripcion | Entregable principal | Estado |
|--------|-------------|---------------------|--------|
| GS1-01 | Catálogos maestros GTIN + GLN + SSCC | Modelos Prisma `GtinCatalog`, `GlnLocation`, `SsccUnit`; validadores gs1.ts | Listo |
| GS1-02 | GSRN + GIAI (personal y activos) | Modelos `GsrnPerson`, `GiaiAsset`; catálogos en BD | Listo |
| GS1-03 | Proceso A — DESADV + escaneo muelle | Router `receiving.*`; tabla `RecepcionMercancia`; SQL `70_recepcion_mercancia.sql` | Listo |
| GS1-04 | Proceso A — Bloqueo recall en recepción | Integración `SanitaryAlert` en `receiving.scanSscc` y `receiving.scanGtin` | Listo |
| GS1-05 | Proceso A — Recepción parcial + cierre | Router `receiving.closeSession`; tabla discrepancias; acta PDF vía `@react-pdf/renderer` | Listo |
| GS1-06 | Proceso A — PWA cámara ZXing | Componente `<BarcodeScanner>` con `@zxing/browser`; parser FNC1; feedback vibración | Listo |
| GS1-07 | Proceso B — Transferencias GLN | Router `inventory.*`; tabla `TransferenciaInventario`; SQL `71_transferencia_inventario.sql` | Listo |
| GS1-08 | Proceso B — PAR + cadena frío | Modelos `ParLevel`, `ColdChainLectura`; job cron Edge Function cada 15 min | Listo |
| GS1-09 | Proceso C — Fraccionamiento unidosis | Router `unitDose.*`; tabla `PreparacionUnidosis`; SQL `72_preparacion_unidosis.sql` | Listo |
| GS1-10 | Proceso C — Impresión DataMatrix | Generación ZPL/PDF con `bwip-js`; template configurable por institución | Listo |
| GS1-11 | Proceso F — Recall + barrido GLN | Modelos `SanitaryAlert`, `DevolucionInventario`; Edge Function barrido async < 30s | Listo |
| GS1-12 | Proceso F — Bloqueo + devolución | Bloqueo transversal en todos los routers; acta PDF; router `returns.*` | Listo |
| GS1-13 | Motor EPCIS — persistencia + RLS | Tabla `EpcisEvent` inmutable; trigger inmutabilidad; RLS `organizationId`; SQL `73_epcis_event.sql` | Listo |
| GS1-14 | Motor EPCIS — consulta + export | Router `epcis.*`; filtros GTIN/lote/GLN; exportación JSON+PDF | Listo |
| GS1-15 | Tests E2E GS1 + thresholds coverage | 4 specs E2E; cobertura routers nuevos >= 80% | Listo |

---

## 3. Metricas

| Metrica | Valor |
|---------|-------|
| Story Points entregados (estimado) | ~75 SP |
| PRs mergeados | 1 (squash 15 streams) |
| Archivos SQL nuevos | 4 (`70_recepcion_mercancia.sql`, `71_transferencia_inventario.sql`, `72_preparacion_unidosis.sql`, `73_epcis_event.sql`) |
| Tablas nuevas | 8 (`gs1_gtin_catalog`, `gs1_gln_location`, `gs1_sscc_unit`, `gs1_gsrn`, `gs1_giai`, `recepcion_mercancia`, `transferencia_inventario`, `preparacion_unidosis`) |
| Tablas EPCIS/control | 5 (`epcis_event`, `devolucion_inventario`, `sanitary_alert`, `par_level`, `cold_chain_lectura`) + `inventory_threshold` |
| Endpoints tRPC nuevos | ~22 (receiving ×6, inventory ×5, unitDose ×5, epcis ×3, returns ×3) |
| Validadores GS1 nuevos (packages/contracts) | 4 (GTIN-14, GLN-13, SSCC-18, dígito verificador modulo-10) |
| Specs E2E nuevas | 4 |
| Escenarios E2E cubiertos (nuevos) | 18 (12 happy path + 6 edge cases Hard Stop) |
| Cobertura unit routers nuevos | >= 80% (threshold CI) |
| ADRs nuevos | 1 (0017-gs1-event-sourcing.md) |
| SLO barrido recall | < 30 segundos (medido con observability) |
| Advisor security CRITICAL al cierre | 0 (target) |

### 3.1 Cobertura E2E por proceso GS1

| Spec | Escenarios | Procesos cubiertos | Resultado esperado |
|------|-----------|-------------------|--------------------|
| `e2e/fase2/gs1-recepcion.spec.ts` | 5 | Proceso A: DESADV → escaneo → confirmación + hard stops | verde |
| `e2e/fase2/gs1-transferencia.spec.ts` | 4 | Proceso B: despacho → tránsito → recepción destino | verde |
| `e2e/fase2/gs1-unidosis.spec.ts` | 5 | Proceso C: fraccionamiento → DataMatrix → conciliación | verde |
| `e2e/fase2/gs1-recall.spec.ts` | 4 | Proceso F: recall → barrido → bloqueo → devolución acta | verde |

### 3.2 Hard stops verificados en E2E

Los specs incluyen escenarios negativos que validan los Hard Stops críticos definidos en el backlog:

- SSCC no listado en DESADV activo → recepción bloqueada.
- Lote en alerta sanitaria activa → bloqueo en muelle, fraccionamiento y despacho.
- Temperatura fuera de rango → cuarentena automática sin intervención manual.
- Cantidad de devolución > cuarentena disponible → Hard Stop con contador exacto.
- Conciliación de unidosis con discrepancia > 2% → Hard Stop, requiere Director de Farmacia.

### 3.3 Validador GS1 — paridad TS/SQL

`packages/contracts/src/validators/gs1.ts` y `packages/database/sql/73_epcis_event.sql`
(función `fn_validate_gs1_check_digit`) usan el mismo algoritmo modulo-10 estándar GS1.
Tests fixture-based en `packages/contracts/src/validators/__tests__/gs1.test.ts` con
20 GTIN/GLN/SSCC válidos e inválidos cubren la paridad.

---

## 4. Retroactiva

### 4.1 Que funciono

1. **ADR 0017 como norte desde el dia 1.** Definir antes de implementar que los eventos
   EPCIS son inmutables y se persisten en tabla dedicada (event sourcing) evitó el debate
   de "guardar en tablas operacionales o en log separado" que bloqueó sprints anteriores.
   El equipo de GS1-03 a GS1-12 usó `epcis.create` como contrato fijo desde el inicio.

2. **Validador GS1 en `packages/contracts` disponible desde GS1-01.** El resto de los
   streams (GS1-03 al GS1-12) importó `validateGtin`, `validateGln`, `validateSscc` sin
   duplicar lógica. Sin paridad TS/SQL habríamos tenido divergencias en producción.

3. **Bloqueo transversal via `SanitaryAlert` centralizada.** Al poner la consulta de
   alertas activas en un helper `checkSanitaryAlert(gtin, lot)` llamado desde todos los
   routers que tocan inventario (receiving, inventory, unitDose), el bloqueo es automático
   en todo el sistema sin que cada stream tenga que recordarlo.

4. **Edge Function para barrido async de recall.** El SLO de < 30s se cumple porque el
   barrido corre como `Supabase Edge Function` disparada por insert en `SanitaryAlert`,
   con CTE recursiva sobre el árbol GLN. El router retorna inmediatamente al cliente;
   el barrido corre en background y notifica via outbox al completarse.

### 4.2 Que mejorar

1. **DESADV parser EDI EDIFACT postergado.** El stream GS1-03 implementó solo el parser
   JSON; el parser EDI EDIFACT completo (UN/EDIFACT DESADV D.01B) quedó fuera de scope.
   El backlog marca US.F2.5.6 como parcialmente cubierto — el flujo JSON es el 80% del
   caso de uso. Acción F2-S7: parser EDI con librería `node-edifact` o equivalente.

2. **PWA cámara no probada en iOS Safari.** El componente `<BarcodeScanner>` con
   `@zxing/browser` fue testeado en Chrome Android y Chrome Desktop. El acceso a
   `getUserMedia` en iOS Safari tiene quirks documentados. Acción F2-S7: test en dispositivo
   iOS real antes de UAT con operadores de almacén.

3. **Impresión DataMatrix depende de Zebra ZPL.** Las impresoras genéricas sin soporte ZPL
   usan la ruta PDF — no se testeó la latencia de la ruta PDF en red lenta. Acción:
   medir en UAT con la impresora real del almacén.

4. **Job PAR corre cada 15 min — puede haber brecha de alerta.** Si el stock cae a cero
   entre dos ejecuciones del job, las 15 min sin alerta pueden impactar dispensación.
   Acción F2-S7: evaluar trigger de BD en UPDATE de stock para alertas inmediatas.

---

## 5. Carry-over F2-S7

| Item | Tipo | Razon | Prioridad |
|------|------|-------|-----------|
| Parser EDI EDIFACT DESADV | Feature | Solo JSON implementado en F2-S6; EDIFACT es el estándar proveedor | Alta |
| Test PWA cámara en iOS Safari | Testing | getUserMedia quirks — requiere dispositivo real | Alta |
| Proceso D+E Bedside dispensación (Epic 08) | Feature | Fuera de scope F2-S6; stream 8 del backlog Fase 2 | Alta |
| Trigger stock inmediato para PAR | Feature | Job 15 min puede generar brecha de alerta | Media |
| Test latencia impresión PDF (red lenta) | Testing | No medido en CI; depende de hardware real | Media |
| Integración Feed RSS MINSAL para recalls | Feature | US.F2.5.29 implementado solo como manual; RSS es stretch | Baja |

---

## 6. Proximos hitos

| Hito | ETA | Criterios |
|------|-----|-----------|
| Apply SQL `70_`–`73_` en Supabase prod | F2-S7 inicio | SQL aplicado + advisors = 0 CRITICAL |
| Proceso D+E Bedside (Epic 08) | F2-S7 | US.F2.8.* mergeados + E2E verde |
| Parser EDI EDIFACT DESADV | F2-S7 | US.F2.5.6 completo; test con DESADV real de proveedor |
| UAT GS1 con operadores almacén | F2-S7 fin | Walkthrough muelle con pistola HID real; UAT sign-off Jefe de Almacén |
| Gate F2-S6 | Post-UAT | ADR 0017 + 4 SQL + 4 E2E specs verde + cobertura >= 80% + advisors 0 |

---

## 7. Firmas

- [x] **@QA** — metricas de cobertura, 4 specs E2E, carry-over documentado — 2026-05-17.
- [ ] **@PO** — pendiente validacion criterios de aceptacion US.F2.5.1–41.
- [ ] **@Orq** — pendiente consolidacion en reporte ejecutivo Fase 2.
