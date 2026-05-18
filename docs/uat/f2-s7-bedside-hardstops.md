# UAT — F2-S7: Bedside Hard Stops (US.F2.6.27-30)

**Fecha:** 2026-05-18
**Sprint:** Fase 2 — Sprint 7 (GS1 Bedside)
**Autor:** @QA — QA Automation (SDET)
**Trazabilidad:** US.F2.6.27 (feedback UX), US.F2.6.28 (teclado), US.F2.6.29 (hora real), US.F2.6.30 (eMAR)
**Entorno:** Staging (Supabase HIS) + Vercel preview

---

## Resumen Ejecutivo

Prueba de aceptación de usuario para los 8 escenarios de Hard Stop de la Regla de los 5 Correctos en el flujo de administración bedside.

| Resultado | Count |
|---|---|
| PASS | — |
| FAIL | — |
| BLOCKED | — |
| N/A | — |
| **Total** | **8 + 3 adicionales** |

**Status global:** PENDIENTE EJECUCION (dependencias Stream 10/11/12 no mergeadas)

---

## Pre-condiciones

1. Seed ejecutado: `DIRECT_URL=<url> node packages/database/scripts/seed-bedside-hardstops.mjs`
2. Usuarios de prueba activos: `qa.nurse@his.test` / `TestPass123!`
3. URL bedside accesible: `/bedside` en el entorno de staging
4. Hard stop modal implementado (Stream 11 UI): `data-testid="hard-stop-modal"`
5. `aria-live="assertive"` presente en el modal para accesibilidad

---

## Criterios de Aceptación Globales

Para que cualquier caso de hard stop sea PASS, TODOS los siguientes deben cumplirse:

- [ ] Modal full-screen con fondo rojo visible en < 200ms desde el scan
- [ ] Texto del error específico visible en el modal
- [ ] `aria-live="assertive"` anuncia el error (lectura en voz alta)
- [ ] Botón "Cancelar" habilitado y funcional
- [ ] Botón "Confirmar Administración" ausente o deshabilitado
- [ ] NO se crea fila en `MedicationAdministration`
- [ ] NO se actualiza `PharmacyReservation` a estado administrado
- [ ] Entrada en `ece.bedside_hard_stop_log` creada

---

## Casos de Prueba

### HS-01: Paciente Erróneo

**ID:** UAT-F2S7-HS01
**Prioridad:** CRITICA
**US:** US.F2.6.22 + US.F2.6.27

**Setup:**
- Enfermera: `hs01.nurse@his.test` (GSRN activo)
- Indicación asignada al paciente PAC-HS-01
- Acción: escanear pulsera del paciente PAC-HS-02 (diferente)

**Pasos:**
1. Login como `qa.nurse@his.test`
2. Navegar a `/bedside`
3. Escanear badge GSRN de Enfermera HS-01
4. Escanear pulsera GSRN de **PAC-HS-02** (no del paciente de la orden)
5. Observar respuesta del sistema

**Criterios específicos:**
- [ ] Modal rojo con texto "PACIENTE INCORRECTO" visible
- [ ] aria-live anuncia "PACIENTE"
- [ ] NO avanza al Paso 3 (campo GTIN deshabilitado)
- [ ] Sin entrada en MedicationAdministration

**Screenshot:** `uat/screenshots/hs01-paciente-incorrecto.png`
**Status:** PENDIENTE
**Observaciones:** _completar en ejecución_

---

### HS-02: Medicamento Erróneo

**ID:** UAT-F2S7-HS02
**Prioridad:** CRITICA
**US:** US.F2.6.23 + US.F2.6.25 + US.F2.6.27

**Setup:**
- Prescripción: Amoxicilina 500mg
- Acción: escanear DataMatrix de Ibuprofeno 400mg

**Pasos:**
1. Login como `qa.nurse@his.test`
2. Completar Pasos 1 y 2 correctamente para PAC-HS-02
3. Escanear DataMatrix: `(01){GTIN_IBUPROFENO_400}(10)L-HS02-2026(17)271231`
4. Observar respuesta

**Criterios específicos:**
- [ ] Modal rojo con texto "MEDICAMENTO INCORRECTO"
- [ ] Indicador de notificación a farmacovigilancia visible (o log verificable)
- [ ] Sin administración registrada
- [ ] Sin cambio en PharmacyReservation

**Screenshot:** `uat/screenshots/hs02-medicamento-incorrecto.png`
**Status:** PENDIENTE
**Observaciones:** _completar en ejecución_

---

### HS-03: Dosis Errónea

**ID:** UAT-F2S7-HS03
**Prioridad:** ALTA
**US:** US.F2.6.23 + US.F2.6.27

**Setup:**
- Prescripción: Amoxicilina 500mg
- Acción: escanear DataMatrix de Amoxicilina 1000mg (mismo principio, distinta concentración)

**Pasos:**
1. Completar Pasos 1 y 2 correctamente para PAC-HS-03
2. Escanear DataMatrix: `(01){GTIN_AMOXICILINA_1000}(10)L-HS03-2026(17)271231`
3. Observar respuesta

**Criterios específicos:**
- [ ] Modal rojo con texto "DOSIS INCORRECTA"
- [ ] Sin administración

**Screenshot:** `uat/screenshots/hs03-dosis-incorrecta.png`
**Status:** PENDIENTE
**Observaciones:** _completar en ejecución_

---

### HS-04: Vía Errónea

**ID:** UAT-F2S7-HS04
**Prioridad:** ALTA
**US:** US.F2.6.23 + US.F2.6.27

**Setup:**
- Prescripción: IV
- Acción: seleccionar vía "VO" en pantalla

**Pasos:**
1. Completar Pasos 1 y 2 correctamente para PAC-HS-04
2. Escanear DataMatrix correcto: `(01){GTIN_AMOXICILINA_500}(10)L-HS04-2026(17)271231`
3. Seleccionar vía "VO" (oral) en lugar de "IV"
4. Confirmar

**Criterios específicos:**
- [ ] Modal rojo con texto "VIA INCORRECTA"
- [ ] Sin administración

**Screenshot:** `uat/screenshots/hs04-via-incorrecta.png`
**Status:** PENDIENTE
**Observaciones:** _completar en ejecución_

---

### HS-05: Horario Erróneo

**ID:** UAT-F2S7-HS05
**Prioridad:** ALTA
**US:** US.F2.6.23 + US.F2.6.27 + US.F2.6.29

**Setup:**
- Indicación: dosis a las 08:00, ventana ±30 min
- Acción: administrar a las 09:30 (60 min fuera de ventana)

**Pasos:**
1. Completar Pasos 1 y 2 correctamente para PAC-HS-05
2. En el sistema, configurar reloj de prueba para las 09:30 (o esperar fuera de ventana)
3. Escanear DataMatrix correcto
4. Observar respuesta

**Criterios específicos:**
- [ ] Modal rojo con texto "HORARIO INCORRECTO"
- [ ] Sin administración
- [ ] El timestamp real vs. programado está registrado en el log

**Screenshot:** `uat/screenshots/hs05-hora-incorrecta.png`
**Status:** PENDIENTE
**Nota:** Requiere manipulación de reloj en entorno de prueba o fixture con hora pasada

---

### HS-06: Medicamento Vencido

**ID:** UAT-F2S7-HS06
**Prioridad:** CRITICA
**US:** US.F2.6.23 (DoD §4.2 Criterio 2) + US.F2.6.25 + US.F2.6.27

**Setup:**
- DataMatrix con vencimiento: `AI(17)240101` (1 enero 2024 — pasado)

**Pasos:**
1. Completar Pasos 1 y 2 correctamente para PAC-HS-06
2. Escanear DataMatrix: `(01){GTIN_AMOXICILINA_500}(10)L-HS06-VENCIDO(17)240101`
3. Observar respuesta

**Criterios específicos:**
- [ ] Modal rojo con texto "MEDICAMENTO VENCIDO"
- [ ] ValidationError creado en BD (verificable en audit_log)
- [ ] Cualquier asiento de inventario cancelado
- [ ] Notificación outbox a farmacovigilancia emitida
- [ ] Sin administración registrada

**Screenshot:** `uat/screenshots/hs06-medicamento-vencido.png`
**Status:** PENDIENTE
**Observaciones:** _completar en ejecución_

---

### HS-07: Lote en Recall Activo

**ID:** UAT-F2S7-HS07
**Prioridad:** CRITICA
**US:** US.F2.6.23 + US.F2.6.25 + US.F2.6.27

**Setup:**
- Lote "L-RECALL-2026" marcado como `en_recall=true` en ece.gs1_gtin_lote
- DataMatrix con ese lote (vencimiento vigente)

**Pasos:**
1. Completar Pasos 1 y 2 correctamente para PAC-HS-07
2. Escanear DataMatrix: `(01){GTIN_AMOXICILINA_500}(10)L-RECALL-2026(17)271231`
3. Observar respuesta

**Criterios específicos:**
- [ ] Modal rojo con texto "LOTE EN RECALL"
- [ ] Notificación outbox a farmacovigilancia emitida
- [ ] Registro en farmacovigilancia creado con tipo "RECALL_ACTIVO"
- [ ] Sin administración
- [ ] Botón Cancelar funcional — cierra modal y regresa al inicio del flujo

**Screenshot:** `uat/screenshots/hs07-lote-recall.png`
**Status:** PENDIENTE
**Observaciones:** _completar en ejecución_

---

### HS-08: Enfermera con GSRN Revocado

**ID:** UAT-F2S7-HS08
**Prioridad:** CRITICA
**US:** US.F2.6.21 + US.F2.6.27

**Setup:**
- GSRN `GSRN_ENF_08_REVOCADO` marcado `activo=false` en ece.gs1_gsrn

**Pasos:**
1. Login como `qa.nurse@his.test`
2. Navegar a `/bedside`
3. Escanear badge del enfermero HS-08 (GSRN revocado)
4. Observar respuesta (el hard stop ocurre en el Paso 1)

**Criterios específicos:**
- [ ] Modal rojo con texto "PROFESIONAL NO HABILITADO"
- [ ] El Paso 2 (campo GSRN paciente) NO se habilita
- [ ] Notificación outbox a administración emitida
- [ ] Intento registrado en audit_log con timestamp

**Screenshot:** `uat/screenshots/hs08-profesional-revocado.png`
**Status:** PENDIENTE
**Observaciones:** _completar en ejecución_

---

## Casos de Prueba Adicionales

### A11Y-01: Accesibilidad del Modal de Hard Stop

**ID:** UAT-F2S7-A11Y01
**Prioridad:** ALTA
**US:** US.F2.6.27 (criterio "contraste y screen reader")

**Criterios:**
- [ ] `aria-live="assertive"` presente en el region de anuncio de error
- [ ] Contraste de texto sobre fondo rojo ≥ 4.5:1 (WCAG 2.1 AA)
- [ ] Foco visible dentro del modal al abrirse (WCAG SC 2.4.7)
- [ ] Focus trap activo: Tab no sale del modal mientras está abierto
- [ ] axe-core: 0 violaciones críticas, 0 violaciones serias en el modal

**Status:** PENDIENTE

---

### A11Y-02: Navegación por Teclado (US.F2.6.28)

**ID:** UAT-F2S7-A11Y02
**Prioridad:** ALTA
**US:** US.F2.6.28

**Criterios:**
- [ ] Tab navega entre Paso 1, Paso 2, Paso 3 y el botón Cancelar
- [ ] Enter confirma acciones cuando el elemento tiene foco
- [ ] No hay trampas de foco fuera del modal
- [ ] Foco visible cumple WCAG SC 2.4.7

**Status:** PENDIENTE

---

### PERF-01: Performance de Validación

**ID:** UAT-F2S7-PERF01
**Prioridad:** MEDIA
**US:** US.F2.6.27 (< 200ms modal, < 500ms p95)

**Mediciones esperadas:**
- Modal de hard stop aparece en < 200ms desde el evento de scan
- 5 iteraciones de los 5 correctos completan en < 500ms p95

| Iteración | Tiempo (ms) | Status |
|---|---|---|
| 1 | — | — |
| 2 | — | — |
| 3 | — | — |
| 4 | — | — |
| 5 | — | — |
| **p95** | — | — |

**Status:** PENDIENTE

---

## Dependencias y Bloqueos

| Dependencia | Stream | Status | Impacto |
|---|---|---|---|
| Router `nursing.bedside.validateGtin` | Stream 10 | PENDIENTE MERGE | Bloquea HS-01 a HS-08 |
| Modal `<HardStopModal>` con data-testid | Stream 11 UI | PENDIENTE MERGE | Bloquea todos |
| Integración eMAR `MedicationAdministration` FK gs1ScanEventId | Stream 12 | PENDIENTE MERGE | Bloquea invariante |
| Outbox Beta.15 para notificaciones farmacovigilancia | Beta.15 | MERGEADO | OK |

---

## Firma de Go/No-Go

| Rol | Nombre | Fecha | Estado |
|---|---|---|---|
| @QA (SDET) | — | — | PENDIENTE |
| @QAF (Funcional) | — | — | PENDIENTE |
| @Dev | — | — | PENDIENTE |
| @PO | — | — | PENDIENTE |

**Veredicto:** PENDIENTE EJECUCION

---

*Generado por @QA — QA Automation (SDET), Inversiones Avante. Sprint F2-S7.*
