# 08 — Épica E.F2.6: GS1 Trazabilidad Clínica Bedside (Procesos D y E)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @PO — Chief Product Officer
**Fecha:** 2026-05-16
**Marco:** Scrum + SAFe-lite, MoSCoW, Fibonacci, WSJF
**Épica padre:** Fase 2 — Módulos Clínicos y Trazabilidad
**Trazabilidad normativa:** `guia_trazabilidad_hospitalaria_gs1.md` §2.4 (Proceso D), §2.5 (Proceso E), §3 (EPCIS), §4.2 (DoD); `analisis_workflows_ece.md` §3.6, §3.7, §A.8, §B.5
**Stack de referencia:** Next.js 14 App Router, tRPC v11, Prisma 5, Postgres 15 (Supabase), Beta.7/8 eMAR, Beta.15 outbox notifications

---

## Visión de la Épica

> **Para** los farmacéuticos y el personal de enfermería de Inversiones Avante
> **que** deben garantizar la administración segura y trazable de medicamentos a pacientes hospitalizados,
> **la** Épica E.F2.6 **es** el conjunto de capacidades GS1 para dispensación en farmacia y administración bedside,
> **que** aplica la Regla de los 5 Correctos con captura automática de identificadores GS1, hard-stops criptográficos y registro EPCIS de cada acto clínico,
> **eliminando** el riesgo de error de medicación por ingreso manual, sustitución no autorizada o administración fuera de ventana terapéutica.

---

## Definition of Ready (DoR)

- [ ] Catálogos GSRN de pacientes y profesionales poblados con datos de prueba.
- [ ] Esquema `PharmacyOrder`, `MedicationAdministration`, `GS1ScanEvent` y `EpcisEvent` definidos y migrados a Supabase.
- [ ] Maquetas aprobadas por @UIUX (flujo de scanning bedside, pantalla de hard-stop, modo rondas).
- [ ] Pruebas de hardware: pistola USB HID y cámara PWA (`BarcodeDetector` API) validadas en dispositivo objetivo.
- [ ] Receta médica digital activa como pre-condición documentada en contratos tRPC.
- [ ] Alertas de farmacovigilancia conectadas a canal outbox (Beta.15).

---

## Definition of Done (DoD)

Criterios globales de la épica (todos obligatorios antes de marcar cualquier US como Done):

1. **Anti-ingreso-manual:** el formulario de administración clínica no permite ingreso de texto libre en campos GTIN/GSRN — solo evento de lectura de escáner (guia §4.2, Criterio 1).
2. **Stock vencido:** cualquier intento de transferir stock vencido entre GLN dispara `ValidationError` en BD y cancela el asiento de inventario (guia §4.2, Criterio 2).
3. **Regex FNC1:** las interfaces validan prefijos invisibles de control GS1 (FNC1) antes de parsear el DataMatrix.
4. **EPCIS completo:** cada evento persiste las 5 dimensiones WHAT/WHERE/WHEN/WHY/WHO.
5. **Coverage:** coverage >= 80% en líneas/funciones; branches >= 75%.
6. **Accesibilidad:** axe-core sin críticos/serios; navegación por teclado funcional.
7. **eMAR integrado:** cada bedside scan genera fila `MedicationAdministration` (Beta.7/8).
8. **RLS:** todas las queries usan `withTenantContext`; auditoría en `audit.audit_log`.
9. **Notificaciones outbox:** hard-stops y alertas farmacovigilancia fluyen por Beta.15 outbox.
10. **Tests E2E Playwright:** flujo completo D + E con hard-stops y modo offline cubiertos.

---

## Personas involucradas

| Persona | Rol en esta épica |
|---|---|
| P5 Farmacéutico | Picking, validación receta, despacho a servicio |
| P2 Enfermería | Bedside scanning, 5 correctos, registro kardex |
| P1 Médico | Pre-condición: receta digital activa en sistema |
| P8 Super-admin TI | Configuración catálogos GSRN, GLN, dispositivos |
| P9 Paciente | Portador de pulsera GSRN; receptor de la administración segura |

---

## Resumen del Backlog

| Sección | US | SP total | MoSCoW dominante |
|---|---|---|---|
| 1. Catálogos GSRN | US.F2.6.1 – US.F2.6.5 | 28 | Must |
| 2. Proceso D Dispensación | US.F2.6.6 – US.F2.6.20 | 89 | Must |
| 3. Proceso E Bedside + 5 correctos | US.F2.6.21 – US.F2.6.40 | 117 | Must |
| 4. Hardware adapters | US.F2.6.41 – US.F2.6.45 | 26 | Must / Should |
| 5. Modos especiales | US.F2.6.46 – US.F2.6.52 | 42 | Must / Should |
| 6. EPCIS + Farmacovigilancia | US.F2.6.53 – US.F2.6.58 | 34 | Must |
| **TOTAL** | **58 US** | **336 SP** | |

---

## SECCION 1 — Catálogos GSRN Paciente y Profesional

### US.F2.6.1 — Registro y emisión de GSRN paciente (pulsera) (Must · 8 SP)

**Como** personal de admisión
**quiero** que al confirmar la admisión hospitalaria el sistema asigne automáticamente un GSRN al paciente y genere la impresión de pulsera en formato Code 128 / DataMatrix
**para** que cada bedside scan identifique unívocamente a la persona sin riesgo de confusión.

**Trazabilidad:** guia §1.1 (GSRN), §2.5; analisis §B.2 (admisión hospitalaria)

**Criterios de aceptación**

```gherkin
Funcionalidad: Asignación GSRN paciente al admitir

  Escenario: Generación automática al confirmar admisión
    Dado que el paciente con expediente EXP-001 no tiene GSRN asignado
    Y se confirma la "Orden de Ingreso Hospitalario"
    Cuando el sistema procesa la admisión
    Entonces se genera un GSRN único con prefijo de empresa GS1 de la organización
    Y se persiste en "patient.gsrn" con timestamp ISO 8601
    Y se encola la impresión de pulsera en la impresora designada al GLN del servicio destino

  Escenario: Reimpresión de pulsera sin reasignar GSRN
    Dado que el paciente EXP-001 ya tiene GSRN asignado
    Cuando el personal solicita reimpresión por pulsera deteriorada
    Entonces el sistema reutiliza el mismo GSRN sin generar uno nuevo
    Y registra el evento de reimpresión en audit_log

  Escenario: Validación de unicidad GSRN
    Dado que se intenta asignar un GSRN que ya existe en otro paciente de la misma organización
    Cuando el sistema procesa la asignación
    Entonces lanza "ValidationError: GSRN_DUPLICADO"
    Y no persiste el registro
```

**Regla de validación:** Hard Stop — GSRN duplicado cancela la asignación.
**Notas técnicas:** campo `gsrn` en modelo Prisma `Patient`; formato AI (8018) + 18 dígitos; impresión via endpoint tRPC `pharmacy.gsrn.print` que llama servicio de impresión GLN-local.

---

### US.F2.6.2 — Catálogo de GSRN profesionales (badge institucional) (Must · 8 SP)

**Como** administrador clínico
**quiero** gestionar el catálogo de GSRN asignados al personal de salud (médicos, enfermería, farmacéuticos) con su badge institucional en DataMatrix
**para** que cada acto clínico registre inequívocamente al profesional responsable.

**Trazabilidad:** guia §1.1 (GSRN Proveedores), §2.5 paso 1; analisis §B.5

**Criterios de aceptación**

```gherkin
Funcionalidad: Gestión catálogo GSRN profesionales

  Escenario: Alta de GSRN profesional
    Dado que el usuario autenticado tiene rol "ADMIN_CLINICO"
    Cuando registra un nuevo profesional con cédula SAP y asigna GSRN
    Entonces el sistema persiste "StaffGsrn" vinculado al usuario del profesional
    Y genera el DataMatrix para impresión de badge

  Escenario: Inactivación de GSRN al suspender credenciales
    Dado que el profesional con GSRN "8018741300000001" tiene licencia suspendida
    Cuando el admin inactiva sus credenciales en el sistema
    Entonces el GSRN queda en estado "REVOCADO"
    Y cualquier escaneo posterior de ese GSRN retorna Hard Stop "PROFESIONAL_NO_HABILITADO"

  Escenario: Consulta de turno activo por GSRN
    Dado que la enfermera escanea su badge GSRN "8018741300000002"
    Cuando el sistema valida credenciales
    Entonces confirma que el profesional tiene turno activo en el servicio correspondiente
    Y retorna nombre, rol y servicio asignado para mostrar en pantalla
```

**Regla de validación:** Hard Stop — GSRN revocado bloquea cualquier acción clínica.
**Notas técnicas:** modelo `StaffGsrn` con `status: enum(ACTIVE, REVOKED)`; consulta de turno cruza con `StaffSchedule`; tRPC `staff.gsrn.validate`.

---

### US.F2.6.3 — Catálogo de GLN por ubicación hospitalaria (Must · 5 SP)

**Como** administrador TI
**quiero** registrar los GLN de cada ubicación del hospital (almacén, farmacia central, farmacias satélite, servicios de hospitalización, camas)
**para** que cada movimiento de stock y evento EPCIS registre GLN origen y GLN destino con precisión.

**Trazabilidad:** guia §1.1 (GLN), §2.2, §4.1; analisis §B.4 (servicios hospitalarios)

**Criterios de aceptación**

```gherkin
Funcionalidad: Catálogo GLN hospitalario

  Escenario: Registro jerárquico de ubicaciones
    Dado que el admin registra el hospital con GLN raíz "7413000000001"
    Cuando agrega la "Farmacia Central" como hijo
    Entonces el sistema persiste el GLN con referencia al GLN padre
    Y valida formato AI (414) + 13 dígitos con dígito verificador

  Escenario: Asignación de GLN a cama específica
    Dado que existe el servicio "Medicina Interna" con GLN "7413000000010"
    Cuando el admin registra la cama "MI-01"
    Entonces se asigna un sub-GLN único a nivel de cama
    Y queda disponible como WHERE en eventos EPCIS

  Escenario: Prevención de GLN duplicado entre organizaciones
    Dado que el GLN "7413000000001" ya existe para la organización A
    Cuando la organización B intenta registrar el mismo GLN
    Entonces el sistema rechaza con error "GLN_YA_REGISTRADO_OTRA_ORG"
```

**Notas técnicas:** modelo `LocationGln` en Prisma con `parentGlnId`; árbol jerárquico consultable con CTE recursiva.

---

### US.F2.6.4 — Catálogo GTIN de medicamentos (Must · 5 SP)

**Como** farmacéutico jefe
**quiero** mantener el catálogo de GTIN de medicamentos con sus atributos (nombre genérico, nombre comercial, forma farmacéutica, concentración, unidad, equivalencias genérico-comercial)
**para** que la validación en dispensación y bedside scanning compare contra datos maestros confiables.

**Trazabilidad:** guia §1.1 (GTIN), §1.2 (AI 01/17/10/21), §4.1

**Criterios de aceptación**

```gherkin
Funcionalidad: Catálogo GTIN medicamentos

  Escenario: Registro de GTIN con atributos completos
    Dado que el admin farmacia accede al catálogo de medicamentos
    Cuando registra GTIN "07501000001234" con lote "L2024A" y vencimiento "2026-12-31"
    Entonces el sistema almacena los AI (01)(10)(17) en formato GS1
    Y valida el dígito verificador del GTIN-14

  Escenario: Asociación genérico-comercial
    Dado que el GTIN "07501000001234" es el genérico "Amoxicilina 500mg"
    Cuando el admin registra el equivalente comercial GTIN "07501000005678"
    Entonces el sistema crea la relación de sustitución con flag "AUTORIZADA"

  Escenario: Bloqueo por recall de lote
    Dado que se registra alerta de recall para lote "L2024A"
    Cuando cualquier usuario intenta consultar disponibilidad de ese lote
    Entonces el sistema retorna estado "RECALL_ACTIVO"
    Y todos los escaneos de ese lote generan Hard Stop automático
```

**Notas técnicas:** modelo `MedicationGtin`; dígito verificador calculado en `contracts/validators`; integración con `patient.allergies` (modelo `PatientAllergy` existente).

---

### US.F2.6.5 — Dashboard de integridad de catálogos GS1 (Should · 2 SP)

**Como** administrador clínico
**quiero** un panel resumen que muestre el estado de catálogos GSRN/GLN/GTIN (registros activos, alertas pendientes, lotes próximos a vencer)
**para** anticipar problemas antes de que afecten la operación clínica.

**Trazabilidad:** guia §4.1; analisis §A.8 (farmacia)

**Criterios de aceptación**

```gherkin
  Escenario: Indicadores de catálogos al cargar el dashboard
    Dado que el usuario con rol "ADMIN_FARMACIA" accede al panel GS1
    Cuando la página carga
    Entonces muestra conteo de GSRN activos, GLN registrados y GTIN con lotes activos
    Y señala en rojo lotes que vencen en los próximos 30 días
    Y señala en amarillo los GSRN profesionales pendientes de renovación de turno
```

**Notas técnicas:** componente Server Component Next.js; datos vía tRPC `pharmacy.catalog.summary`.

---

## SECCION 2 — Proceso D: Dispensación de Recetas y Surtido

> **Cambio de estado del sistema (guia §2.4):** De "Receta Pendiente" → "Asignado / En Tránsito a Cama"

### US.F2.6.6 — Validación de receta digital activa como pre-condición de dispensación (Must · 8 SP)

**Como** farmacéutico de turno
**quiero** que el sistema solo habilite el flujo de dispensación cuando exista una receta médica digital en estado "ACTIVA" firmada por el médico prescriptor
**para** garantizar que ninguna dispensación ocurra sin orden válida, conforme al vínculo indicaciones → kardex de analisis §3.6.

**Trazabilidad:** guia §2.4; analisis §3.6 (indicaciones médicas), §3.7 (kardex), §B.5

**Criterios de aceptación**

```gherkin
Funcionalidad: Pre-condición receta digital activa

  Escenario: Dispensación habilitada con receta activa
    Dado que el médico MC-001 firmó digitalmente la indicación IND-2026-0501 en estado "ACTIVA"
    Cuando el farmacéutico inicia el proceso de dispensación para el paciente PAC-001
    Entonces el sistema habilita la estación de picking
    Y muestra los ítems de la receta con GTIN esperado, dosis y frecuencia

  Escenario: Hard stop por ausencia de receta activa
    Dado que el paciente PAC-002 no tiene indicaciones en estado "ACTIVA"
    Cuando el farmacéutico intenta iniciar dispensación
    Entonces el sistema bloquea el acceso con mensaje "SIN_RECETA_ACTIVA"
    Y no registra ningún movimiento de stock

  Escenario: Hard stop por receta suspendida
    Dado que la indicación IND-2026-0502 fue suspendida por el médico
    Cuando el farmacéutico intenta dispensar ítems de esa indicación
    Entonces el sistema bloquea con "RECETA_SUSPENDIDA"
    Y sugiere verificar con el médico prescriptor
```

**Regla de validación:** Hard Stop — sin receta `ACTIVA` firmada, la estación de picking no abre.
**Notas técnicas:** tRPC `pharmacy.dispense.checkPreconditions`; modelo `PharmacyOrder` con `status: PENDING | DISPENSING | DISPENSED | CANCELLED`; consume `MedicalOrder` del módulo de indicaciones.

---

### US.F2.6.7 — Escaneo GTIN en estación de picking y validación contra orden médica (Must · 13 SP)

**Como** farmacéutico de turno
**quiero** escanear el DataMatrix de cada unidad en el picking y que el sistema valide automáticamente que el GTIN, lote y vencimiento corresponden exactamente a la orden médica activa
**para** eliminar errores de surtido antes de que el medicamento llegue al paciente.

**Trazabilidad:** guia §2.4 (punto de control estación picking), §1.2 (AI 01/10/17)

**Criterios de aceptación**

```gherkin
Funcionalidad: Validación GTIN en picking farmacia

  Escenario: Scan correcto — GTIN coincide con receta
    Dado que la receta IND-2026-0501 incluye "Amoxicilina 500mg, GTIN 07501000001234"
    Y el farmacéutico escanea el DataMatrix "(01)07501000001234(10)L2024A(17)261231"
    Cuando el sistema parsea el string GS1 con regex FNC1
    Entonces valida que GTIN, lote y vencimiento coinciden con la orden
    Y marca el ítem como "ESCANEADO" en la pantalla de picking
    Y genera sonido de confirmación (beep verde)

  Escenario: Hard stop — GTIN no coincide con receta
    Dado que la receta solicita "Amoxicilina 500mg, GTIN 07501000001234"
    Y el farmacéutico escanea "GTIN 07501000009999" (medicamento diferente)
    Cuando el sistema compara
    Entonces lanza Hard Stop "GTIN_NO_COINCIDE_CON_RECETA"
    Y bloquea el ítem en pantalla con fondo rojo y sonido de alerta
    Y no registra el movimiento de stock

  Escenario: Hard stop — medicamento vencido
    Dado que el DataMatrix escaneado contiene vencimiento "AI(17)240101" (enero 2024)
    Cuando el sistema valida la fecha contra el día actual
    Entonces lanza Hard Stop "MEDICAMENTO_VENCIDO"
    Y genera ValidationError en BD
    Y cancela cualquier asiento de inventario pendiente para ese lote
    Y notifica al farmacéutico jefe via canal outbox (Beta.15)

  Escenario: Hard stop — lote en recall activo
    Dado que el lote "L2024A" tiene alerta de recall registrada
    Y el farmacéutico escanea una unidad de ese lote
    Cuando el sistema verifica el estado del lote
    Entonces lanza Hard Stop "LOTE_EN_RECALL"
    Y reporta el intento al módulo de farmacovigilancia
    Y no permite continuar la dispensación
```

**Regla de validación:** Hard Stop en tres escenarios: GTIN no coincide / medicamento vencido / lote en recall.
**Notas técnicas:** librería `gs1-js` o parser propio en `contracts/validators`; regex FNC1 `\x1D` o `]C1`; tRPC `pharmacy.dispense.scanItem`; integración `MedicationGtin.recallStatus`.

---

### US.F2.6.8 — Reserva lógica de número de serie / lote por paciente (Must · 8 SP)

**Como** farmacéutico
**quiero** que al confirmar el scan correcto de una unidad el sistema reserve lógicamente ese número de serie y lote específico a la cuenta del paciente
**para** que ninguna otra dispensación use esa unidad y el rastro sea inequívoco.

**Trazabilidad:** guia §2.4 (reserva lógica de número de serie)

**Criterios de aceptación**

```gherkin
Funcionalidad: Reserva lógica de unidad GS1

  Escenario: Reserva exitosa al escanear unidad válida
    Dado que la unidad serial "21000001" del GTIN "07501000001234" está disponible
    Cuando el farmacéutico confirma el scan para el paciente PAC-001
    Entonces el sistema crea un registro "PharmacyReservation" con status "RESERVED"
    Y el stock lógico de esa unidad queda en estado "ASIGNADO"
    Y ningún otro paciente puede tomar esa unidad

  Escenario: Liberación de reserva al cancelar la dispensación
    Dado que existe una reserva "RESERVED" para PAC-001 de la unidad "21000001"
    Cuando el farmacéutico cancela la dispensación antes de confirmar despacho
    Entonces el sistema cambia el estado a "DISPONIBLE"
    Y registra el evento en audit_log con motivo de cancelación

  Escenario: Expiración automática de reserva sin despacho en 4 horas
    Dado que la reserva fue creada hace más de 4 horas sin confirmación de despacho
    Cuando el job de limpieza se ejecuta
    Entonces la reserva expira y la unidad vuelve a "DISPONIBLE"
    Y se notifica al farmacéutico de turno via outbox
```

**Notas técnicas:** modelo `PharmacyReservation`; job Inngest `pharmacy.reservation.expire`; campo `expiresAt` en la reserva.

---

### US.F2.6.9 — Detección de duplicados en dispensación (Must · 5 SP)

**Como** farmacéutico
**quiero** que el sistema detecte si un ítem ya fue dispensado en el mismo turno o ciclo de indicación
**para** evitar doble dispensación que provoque sobredosis.

**Trazabilidad:** guia §2.4 (detección de duplicados); analisis §3.6 (vigencia indicaciones)

**Criterios de aceptación**

```gherkin
Funcionalidad: Detección de duplicados en dispensación

  Escenario: Hard stop por ítem ya dispensado en turno activo
    Dado que el ítem "Amoxicilina 500mg" de IND-2026-0501 fue dispensado a las 08:00
    Y la frecuencia de la indicación es "cada 8 horas"
    Cuando el farmacéutico intenta dispensar el mismo ítem a las 09:00
    Entonces el sistema lanza Hard Stop "ITEM_YA_DISPENSADO_EN_VENTANA"
    Y muestra la hora de la última dispensación y la próxima ventana permitida

  Escenario: Dispensación permitida fuera de la ventana duplicada
    Dado que el mismo ítem fue dispensado a las 08:00
    Cuando se intenta dispensar a las 16:15 (fuera de ventana de 8 horas)
    Entonces el sistema permite continuar el flujo de scanning
```

**Regla de validación:** Hard Stop — duplicado dentro de la ventana terapéutica.
**Notas técnicas:** consulta sobre `PharmacyOrder.dispensedAt` + `MedicalOrder.frequency`; tRPC `pharmacy.dispense.checkDuplicate`.

---

### US.F2.6.10 — Cross-check de alergias paciente vs medicamento (Must · 8 SP)

**Como** farmacéutico
**quiero** que antes de confirmar la dispensación el sistema compare el GTIN escaneado con el perfil de alergias del paciente
**para** prevenir reacciones alérgicas graves desde el punto de farmacia, como segunda barrera después del médico.

**Trazabilidad:** guia §2.4; analisis §3.2 (alergias en historia clínica), §B.5

**Criterios de aceptación**

```gherkin
Funcionalidad: Cross-check alergias en dispensación

  Escenario: Hard stop por alergia conocida al principio activo
    Dado que el paciente PAC-001 tiene alergia registrada a "Penicilina" en "patient.allergies"
    Y el farmacéutico escanea Amoxicilina (principio activo: Penicilina)
    Cuando el sistema cruza el GTIN con el perfil de alergias
    Entonces lanza Hard Stop "ALERGIA_CONOCIDA: Penicilina"
    Y bloquea la dispensación con panel rojo prominente
    Y reporta el evento al módulo de farmacovigilancia via outbox

  Escenario: Advertencia por alergia a excipiente (no bloqueante)
    Dado que el paciente tiene alergia a "Tartrazina" (excipiente)
    Cuando el farmacéutico escanea un medicamento con ese excipiente
    Entonces el sistema muestra Warning "EXCIPIENTE_ALERGENO"
    Y requiere confirmación explícita del farmacéutico para continuar
    Y registra la confirmación con timestamp en audit_log

  Escenario: Sin alertas cuando no hay alergias relevantes
    Dado que el GTIN escaneado no contiene principios activos ni excipientes alergénicos para el paciente
    Cuando se realiza el cross-check
    Entonces el flujo continúa sin interrupciones
```

**Regla de validación:** Hard Stop por alergia a principio activo; Warning por excipiente.
**Notas técnicas:** modelo `PatientAllergy` existente (Beta.2 pharmacy); mapeo GTIN → principio activo en `MedicationGtin.activeIngredients`; tRPC `pharmacy.dispense.checkAllergies`.

---

### US.F2.6.11 — Sustitución genérico-comercial autorizada (Must · 8 SP)

**Como** farmacéutico
**quiero** poder registrar y aplicar sustituciones de medicamento genérico por comercial (o viceversa) cuando el stock del original no está disponible, con flujo de autorización
**para** garantizar continuidad del tratamiento sin comprometer la seguridad.

**Trazabilidad:** guia §2.4 (sustituciones autorizadas); analisis §3.6 (indicaciones médicas)

**Criterios de aceptación**

```gherkin
Funcionalidad: Sustitución genérico-comercial

  Escenario: Propuesta de sustitución con autorización médica
    Dado que el GTIN original "07501000001234" está agotado
    Y existe equivalente comercial "07501000005678" con relación "AUTORIZADA" en catálogo
    Cuando el farmacéutico activa la sustitución
    Entonces el sistema muestra la equivalencia y requiere autorización del médico prescriptor
    Y al obtener la autorización registra la sustitución en "PharmacySubstitution"
    Y el bedside scan aceptará el nuevo GTIN como válido para esa indicación

  Escenario: Rechazo de sustitución sin equivalencia catalogada
    Dado que no existe relación de sustitución entre dos GTIN
    Cuando el farmacéutico intenta sustituir manualmente
    Entonces el sistema bloquea con "SIN_EQUIVALENCIA_AUTORIZADA"
    Y exige que un médico emita nueva receta con el GTIN diferente

  Escenario: Registro completo de la sustitución en auditoría
    Dado que se realizó una sustitución autorizada
    Cuando se confirma la dispensación
    Entonces el evento EPCIS incluye GTIN original y GTIN sustituto en la dimensión WHAT
    Y el registro queda en audit_log con referencia a la autorización médica
```

**Notas técnicas:** modelo `PharmacySubstitution`; notificación push al médico via tRPC mutation + outbox (Beta.15).

---

### US.F2.6.12 — Armado de carrito unidosis por turno y paciente (Must · 8 SP)

**Como** farmacéutico de turno
**quiero** armar un carrito virtual con el kit completo de unidosis por paciente y turno, escaneando cada ítem
**para** organizar el despacho al servicio de hospitalización de forma trazable y segura.

**Trazabilidad:** guia §2.4 (carrito unidosis con kit por turno/paciente); analisis §B.5 (administración medicamentos)

**Criterios de aceptación**

```gherkin
Funcionalidad: Carrito unidosis por turno/paciente

  Escenario: Creación y llenado del carrito
    Dado que el turno "Mañana 07:00-15:00" está activo para el servicio "Medicina Interna"
    Y el farmacéutico inicia el armado del carrito para ese turno
    Cuando escanea cada unidosis por paciente
    Entonces el sistema agrupa los ítems por "paciente → medicamento → hora programada"
    Y valida cada ítem contra la indicación activa del paciente correspondiente
    Y muestra progreso del armado (ítems completados vs. pendientes)

  Escenario: Advertencia por ítem no escaneado al cerrar carrito
    Dado que el carrito tiene 3 ítems pendientes de escanear al cierre del turno
    Cuando el farmacéutico intenta confirmar el carrito
    Entonces el sistema muestra advertencia "ITEMS_PENDIENTES: 3"
    Y exige confirmación explícita antes de cerrar con ítems pendientes

  Escenario: Generación de SSCC al despachar el carrito
    Dado que el carrito está completo y validado
    Cuando el farmacéutico confirma el despacho al servicio destino
    Entonces el sistema genera un SSCC para el lote de transporte
    Y cambia el estado a "EN_TRANSITO_A_SERVICIO"
    Y emite evento EPCIS TransactionEvent con SSCC + GLN destino
```

**Notas técnicas:** modelo `DispensingCart` con `items[]` y `status: OPEN | VALIDATED | DISPATCHED`; SSCC generado según AI (00) 18 dígitos.

---

### US.F2.6.13 — Despacho con SSCC al servicio destino (Must · 8 SP)

**Como** farmacéutico
**quiero** cerrar el despacho del carrito asignando un SSCC y registrando el GLN de origen (farmacia) y GLN destino (servicio de hospitalización)
**para** que el estado del stock cambie a "En tránsito" y quede evidencia trazable del movimiento.

**Trazabilidad:** guia §2.4 (despacho con SSCC al servicio destino + transición de estado); §1.1 (SSCC)

**Criterios de aceptación**

```gherkin
Funcionalidad: Despacho con SSCC

  Escenario: Despacho exitoso al servicio
    Dado que el carrito "CART-2026-001" está en estado "VALIDATED"
    Y el GLN del servicio destino es "7413000000010"
    Cuando el farmacéutico confirma el despacho y escanea el SSCC del contenedor
    Entonces el sistema registra la transición a "DISPATCHED"
    Y actualiza el stock lógico de cada unidad a "EN_TRANSITO"
    Y emite evento EPCIS "AggregationEvent" con SSCC → lista de GTIN hijos
    Y notifica al servicio destino via outbox (Beta.15) con el manifiesto del carrito

  Escenario: Confirmación de recepción en el servicio
    Dado que el carrito llegó al servicio de hospitalización
    Cuando la enfermera de cabecera confirma la recepción escaneando el SSCC
    Entonces el estado cambia a "RECIBIDO_EN_SERVICIO"
    Y el GLN del stock se actualiza al GLN del servicio
    Y se emite evento EPCIS ObjectEvent con disposition "in_transit" → "in_stock"
```

**Notas técnicas:** tRPC `pharmacy.cart.dispatch`; evento EPCIS emitido via worker Inngest; integración con eMAR (Beta.7/8) para notificar que los medicamentos están disponibles bedside.

---

### US.F2.6.14 — Evento EPCIS de dispensación (Must · 5 SP)

**Como** farmacéutico / sistema
**quiero** que cada dispensación genere automáticamente un evento EPCIS con las 5 dimensiones completas
**para** cumplir el estándar GS1 y tener trazabilidad clínica completa desde receta hasta administración.

**Trazabilidad:** guia §3 (meta-prompt EPCIS, 5 dimensiones WHAT/WHERE/WHEN/WHY/WHO)

**Criterios de aceptación**

```gherkin
Funcionalidad: Evento EPCIS dispensación

  Escenario: Evento ObjectEvent generado al confirmar dispensación
    Dado que se confirmó la dispensación del ítem "Amoxicilina 500mg" para PAC-001
    Cuando el worker EPCIS procesa la dispensación
    Entonces persiste en "EpcisEvent":
      - WHAT: GTIN "07501000001234" + lote "L2024A" + vencimiento "2026-12-31" + serial "21000001"
      - WHERE: GLN origen "Farmacia Central" → GLN destino "Medicina Interna"
      - WHEN: timestamp ISO 8601 con precisión de segundo
      - WHY: business_step "dispensing", disposition "dispensed"
      - WHO: GSRN farmacéutico "8018741300000003" + GSRN paciente "8018741300000001"
    Y el evento queda con status "COMMITTED" en la cadena de auditoría

  Escenario: Evento EPCIS rechazado si faltan dimensiones
    Dado que el worker intenta persistir un evento con campo GSRN_paciente nulo
    Cuando se ejecuta la validación del schema EPCIS
    Entonces el worker lanza excepción y reencola el evento para reintento
    Y alerta al equipo via canal de monitoreo
```

**Notas técnicas:** modelo `EpcisEvent` con columnas `what jsonb, where jsonb, when timestamptz, why jsonb, who jsonb`; worker `pharmacy.epcis.dispense` en Inngest; schema JSON validado contra XSD GS1 EPCIS 1.2.

---

### US.F2.6.15 — Confirmación de dispensación completa del kit de turno (Must · 5 SP)

**Como** farmacéutico jefe de turno
**quiero** un resumen al finalizar el turno que muestre el porcentaje de dispensaciones completadas vs. indicadas, con pendientes y motivos de omisión
**para** entregar el turno con evidencia documentada.

**Trazabilidad:** analisis §3.7 (kardex), §B.5

**Criterios de aceptación**

```gherkin
  Escenario: Resumen de cierre de turno
    Dado que el turno "Mañana" llega a su hora de cierre (15:00)
    Cuando el farmacéutico accede al resumen de turno
    Entonces muestra tabla con: paciente, medicamento, estado (dispensado / pendiente / omitido / sustituido)
    Y el porcentaje global de cumplimiento
    Y los ítems pendientes marcados en amarillo con alerta al turno entrante
```

**Notas técnicas:** tRPC `pharmacy.shift.summary`; datos en `DispensingCart` + `PharmacyOrder`.

---

### US.F2.6.16 — Gestión de omisión justificada en dispensación (Should · 3 SP)

**Como** farmacéutico
**quiero** poder registrar una omisión justificada (paciente en cirugía, dieta absoluta, solicitud médica) con código de motivo
**para** que la omisión quede documentada y no aparezca como error en el kardex.

**Trazabilidad:** analisis §3.7 (kardex — estado omitido); §3.6 (indicaciones suspendidas)

**Criterios de aceptación**

```gherkin
  Escenario: Registro de omisión con código de motivo
    Dado que el paciente PAC-001 está en cirugía durante el horario de la dosis
    Cuando el farmacéutico marca el ítem como "OMITIDO"
    Entonces el sistema exige seleccionar un código de motivo del catálogo (PACIENTE_EN_CIRUGIA, DIETA_ABSOLUTA, INDICACION_SUSPENDIDA, OTRO)
    Y si elige "OTRO" requiere texto de descripción
    Y registra la omisión en kardex con usuario y timestamp
    Y el ítem queda diferenciado visualmente del ítem no escaneado
```

**Notas técnicas:** enum `OmissionReason` en Prisma; visible en eMAR (Beta.7/8).

---

### US.F2.6.17 — Historial de dispensaciones por paciente (Should · 3 SP)

**Como** médico o enfermería
**quiero** consultar el historial completo de dispensaciones de un paciente (GTIN, lote, fecha, farmacéutico)
**para** tener visibilidad del registro trazable en el expediente electrónico.

**Trazabilidad:** analisis §3.7 (kardex histórico), §B.5

**Criterios de aceptación**

```gherkin
  Escenario: Consulta del historial
    Dado que el médico MC-001 consulta el expediente del paciente PAC-001
    Cuando accede al tab "Medicamentos dispensados"
    Entonces ve la línea de tiempo de dispensaciones con GTIN, nombre, lote, fecha, farmacéutico y estado
    Y puede filtrar por rango de fechas y por medicamento
    Y los eventos EPCIS vinculados son accesibles como detalle expandible
```

---

### US.F2.6.18 — Alerta de stock bajo durante dispensación (Should · 3 SP)

**Como** farmacéutico
**quiero** recibir una alerta cuando el stock de un GTIN cae por debajo del umbral de seguridad durante el proceso de dispensación
**para** activar reabastecimiento antes de que impacte las próximas rondas.

**Trazabilidad:** analisis §A.8 (farmacia); guia §4.1

**Criterios de aceptación**

```gherkin
  Escenario: Alerta de stock bajo post-dispensación
    Dado que el umbral de seguridad para GTIN "07501000001234" es 10 unidades
    Y después de la dispensación quedan 8 unidades
    Cuando el sistema actualiza el stock
    Entonces emite notificación "STOCK_BAJO" al farmacéutico jefe y al responsable de compras
    Y registra la alerta en el log de eventos outbox (Beta.15)
```

---

### US.F2.6.19 — Pantalla de cola de dispensación para la estación de picking (Must · 5 SP)

**Como** farmacéutico operativo
**quiero** una pantalla de cola que muestre todas las recetas pendientes de dispensar, priorizadas por urgencia y hora de programación
**para** organizar el trabajo de la estación de picking sin perder ninguna orden.

**Trazabilidad:** guia §2.4; analisis §A.8

**Criterios de aceptación**

```gherkin
  Escenario: Cola de dispensación con prioridades
    Dado que existen órdenes en estado "PENDING" para el turno actual
    Cuando el farmacéutico abre la estación de picking
    Entonces la cola muestra: paciente, servicio, medicamentos, hora programada, nivel de urgencia (STAT / ROUTINE)
    Y las órdenes STAT aparecen al tope con color rojo
    Y al seleccionar una orden se activa el modo de escaneo para esa orden específica
```

**Notas técnicas:** componente React con polling via tRPC subscription o Supabase Realtime.

---

### US.F2.6.20 — Reporte diario de trazabilidad de dispensaciones (Should · 5 SP)

**Como** director de farmacia
**quiero** un reporte diario con todas las dispensaciones del día, clasificadas por servicio, farmacéutico, tipo de medicamento y estado (dispensado / omitido / sustituido)
**para** auditar el proceso y detectar desviaciones del estándar GS1.

**Trazabilidad:** guia §3 (auditoría EPCIS); analisis §A.8

**Criterios de aceptación**

```gherkin
  Escenario: Generación del reporte diario
    Dado que es el cierre del día operativo
    Cuando el director ejecuta "Reporte de dispensaciones"
    Entonces el sistema genera un PDF/CSV con: total dispensaciones, omisiones, sustituciones, hard stops activados, eventos farmacovigilancia
    Y cada línea incluye referencia al evento EPCIS correspondiente
    Y el reporte queda en auditoría con firma del generador y timestamp
```

---

## SECCION 3 — Proceso E: Bedside Scanning y Regla de los 5 Correctos

> **Cambio de estado del sistema (guia §2.5):** De "Dispensado" → "Administrado / Consumido"

### US.F2.6.21 — Flujo secuencial de escaneo bedside: Paso 1 — GSRN profesional (Must · 8 SP)

**Como** enfermera de turno
**quiero** iniciar la administración escaneando mi badge institucional (GSRN profesional) para que el sistema valide mis credenciales y turno activo
**para** garantizar que solo personal autorizado y de turno activo puede ejecutar administraciones.

**Trazabilidad:** guia §2.5 (paso 1: GSRN profesional); §3 (WHO en EPCIS)

**Criterios de aceptación**

```gherkin
Funcionalidad: Escaneo GSRN profesional — Paso 1

  Escenario: Validación exitosa de credenciales y turno
    Dado que la enfermera ENF-001 tiene turno activo en "Medicina Interna" (07:00-15:00)
    Cuando escanea su badge GSRN "8018741300000002" a las 10:30
    Entonces el sistema valida: identidad del profesional, licencia vigente y turno activo en el servicio
    Y muestra en pantalla: nombre, rol y servicio asignado
    Y habilita el Paso 2 (escaneo GSRN paciente)
    Y emite sonido de confirmación verde

  Escenario: Hard stop — GSRN profesional revocado
    Dado que las credenciales de ENF-002 están suspendidas
    Cuando escanea su badge
    Entonces el sistema lanza Hard Stop "PROFESIONAL_NO_HABILITADO"
    Y bloquea el avance al Paso 2
    Y registra el intento en audit_log con timestamp

  Escenario: Hard stop — profesional fuera de turno
    Dado que la enfermera ENF-003 tiene turno 15:00-23:00
    Cuando intenta iniciar una administración a las 10:00
    Entonces el sistema lanza Warning "FUERA_DE_TURNO"
    Y exige confirmación con justificación para continuar (sobrecargo, urgencia)
    Y registra el override con usuario supervisor que autoriza

  Escenario: El campo GSRN no permite ingreso manual de texto
    Dado que la enfermera intenta escribir el GSRN directamente con el teclado
    Cuando presiona una tecla alfanumérica en el campo de escaneo
    Entonces el campo rechaza la entrada y muestra "USE EL ESCANER"
```

**Regla de validación:** Hard Stop — GSRN revocado; Warning — fuera de turno (requiere override documentado).
**DoD guia §4.2, Criterio 1:** campo solo acepta evento de escáner, no texto libre.
**Notas técnicas:** campo HTML con `readOnly` + listener de evento `input` desde dispositivo HID o `BarcodeDetector`; tRPC `nursing.bedside.validateProfessional`.

---

### US.F2.6.22 — Flujo secuencial bedside: Paso 2 — GSRN paciente (pulsera) (Must · 8 SP)

**Como** enfermera de turno (autenticada en Paso 1)
**quiero** escanear la pulsera GSRN del paciente para confirmar su identidad antes de cualquier administración
**para** eliminar el riesgo de administrar un medicamento al paciente incorrecto.

**Trazabilidad:** guia §2.5 (paso 2: GSRN paciente); Regla de los 5 Correctos — "Paciente Correcto"

**Criterios de aceptación**

```gherkin
Funcionalidad: Escaneo GSRN paciente — Paso 2

  Escenario: Confirmación exitosa de identidad
    Dado que el Paso 1 fue completado por ENF-001
    Y el paciente PAC-001 tiene pulsera con GSRN "8018741300000001"
    Cuando ENF-001 escanea la pulsera
    Entonces el sistema muestra: nombre completo, número de expediente, foto (si disponible), alergias activas
    Y habilita el Paso 3 (escaneo GTIN unidosis)

  Escenario: Hard stop — GSRN paciente no pertenece al servicio activo de la enfermera
    Dado que ENF-001 está en "Medicina Interna"
    Y escanea la pulsera de PAC-002 que está en "Pediatría"
    Cuando el sistema valida la ubicación del paciente
    Entonces lanza Hard Stop "PACIENTE_FUERA_DE_SERVICIO"
    Y bloquea el avance al Paso 3

  Escenario: Hard stop — pulsera GSRN no registrada
    Dado que el código escaneado no existe en el catálogo GSRN
    Cuando el sistema busca el GSRN
    Entonces lanza Hard Stop "GSRN_PACIENTE_NO_ENCONTRADO"
    Y solicita verificación de identidad manual con escalamiento a admisión

  Escenario: Mostrar alerta de alergia activa al identificar paciente
    Dado que PAC-001 tiene alergia a "Penicilina" en estado activo
    Cuando el sistema confirma la identidad en el Paso 2
    Entonces muestra un banner de alerta de alergias en rojo antes de habilitar el Paso 3
```

**Notas técnicas:** tRPC `nursing.bedside.validatePatient`; integración con `PatientAllergy` y `Bed.currentPatientId`.

---

### US.F2.6.23 — Flujo secuencial bedside: Paso 3 — GTIN unidosis (Must · 13 SP)

**Como** enfermera de turno (Pasos 1 y 2 completados)
**quiero** escanear el DataMatrix de la unidosis y que el sistema aplique automáticamente la Regla de los 5 Correctos
**para** que solo se confirme la administración cuando los 5 factores estén verificados y sin errores.

**Trazabilidad:** guia §2.5 (paso 3: GTIN unidosis + 5 Correctos + Hard Stops); §4.2

**Criterios de aceptación**

```gherkin
Funcionalidad: Escaneo GTIN unidosis — 5 Correctos

  Escenario: Los 5 correctos se cumplen — administración habilitada
    Dado que ENF-001 completó Pasos 1 y 2 para PAC-001
    Y la unidosis tiene GTIN "07501000001234", lote "L2024A", vencimiento "2026-12-31"
    Y la indicación activa es "Amoxicilina 500mg cada 8h IV"
    Y la hora actual (10:00) está en la ventana terapéutica (08:00-12:00)
    Cuando ENF-001 escanea el DataMatrix de la unidosis
    Entonces el sistema valida los 5 correctos:
      - Paciente correcto: GSRN verificado en Paso 2
      - Medicamento correcto: GTIN coincide con indicación activa
      - Dosis correcta: concentración del GTIN coincide con indicación
      - Vía correcta: la indicación especifica "IV" y se muestra para confirmación manual
      - Hora correcta: timestamp actual dentro de ventana terapéutica (+/- 30 min)
    Y habilita el botón "Confirmar Administración" con pantalla verde

  Escenario: Hard stop — GTIN no coincide con indicación activa (Medicamento Incorrecto)
    Dado que la indicación es "Amoxicilina 500mg" (GTIN "07501000001234")
    Y la enfermera escanea "Ibuprofeno 400mg" (GTIN "07501000009999")
    Cuando el sistema compara GTIN contra la indicación activa del paciente
    Entonces lanza Hard Stop "MEDICAMENTO_INCORRECTO"
    Y bloquea la confirmación con pantalla roja y alerta sonora
    Y reporta el incidente a farmacovigilancia via outbox

  Escenario: Hard stop — medicamento vencido (guia §4.2 Criterio 2)
    Dado que el DataMatrix contiene vencimiento "AI(17)240101"
    Cuando el sistema valida la fecha
    Entonces lanza Hard Stop "MEDICAMENTO_VENCIDO"
    Y genera ValidationError en BD
    Y cancela cualquier asiento de inventario asociado

  Escenario: Hard stop — lote en recall activo
    Dado que el lote "L2024A" tiene alerta de recall en el catálogo
    Cuando el sistema valida el lote al escanear
    Entonces lanza Hard Stop "LOTE_EN_RECALL"
    Y reporta el incidente a farmacovigilancia
    Y no permite continuar la administración

  Escenario: Hard stop — dosis fuera de rango terapéutico (Dosis Incorrecta)
    Dado que la indicación es "Amoxicilina 500mg"
    Y el DataMatrix contiene concentración "1000mg"
    Cuando el sistema compara la concentración
    Entonces lanza Hard Stop "DOSIS_FUERA_DE_RANGO"
    Y no permite continuar

  Escenario: Hard stop — hora fuera de ventana terapéutica (Hora Incorrecta)
    Dado que la dosis de las 08:00 tiene ventana de 30 minutos (+/-)
    Y la enfermera intenta confirmar a las 08:45
    Cuando el sistema valida el timestamp
    Entonces lanza Hard Stop "HORA_FUERA_DE_VENTANA"
    Y exige justificación y override de supervisor para continuar

  Escenario: El campo GTIN no permite ingreso manual de texto
    Dado que la enfermera intenta escribir el GTIN con el teclado
    Cuando presiona una tecla alfanumérica en el campo de escaneo
    Entonces el campo rechaza la entrada y muestra "USE EL ESCANER"
```

**Regla de validación:** Hard Stop en 5 escenarios (medicamento incorrecto / vencido / lote recall / dosis fuera de rango / hora fuera de ventana). Warning en ventana con tolerancia.
**DoD guia §4.2, Criterios 1 y 2:** campo sin texto manual; stock vencido genera ValidationError.
**Notas técnicas:** tRPC `nursing.bedside.validateGtin`; ventana terapéutica configurable en `MedicalOrder.administrationWindow`.

---

### US.F2.6.24 — Confirmación de administración y captura de datos clínicos (Must · 8 SP)

**Como** enfermera de turno
**quiero** que al confirmar la administración el sistema capture: hora real, vía confirmada, y opcionalmente signos vitales pre-administración
**para** tener el registro completo del acto clínico en el eMAR y el kardex.

**Trazabilidad:** guia §2.5 (captura: hora real, vía confirmada, signos vitales); analisis §3.7 (kardex)

**Criterios de aceptación**

```gherkin
Funcionalidad: Confirmación y captura de datos clínicos

  Escenario: Confirmación con datos completos
    Dado que los 5 correctos fueron verificados para PAC-001
    Cuando ENF-001 presiona "Confirmar Administración"
    Entonces el sistema registra:
      - hora_real_administracion: timestamp ISO 8601 del momento de confirmación
      - via_confirmada: seleccionada por la enfermera del catálogo (IV, VO, IM, SC, etc.)
      - signos_vitales_pre: (opcional) presión arterial, FC, temperatura si la enfermera los registra
    Y crea una fila en "MedicationAdministration" (Beta.7/8 eMAR) con status "ADMINISTERED"
    Y cambia el estado del stock de esa unidad a "CONSUMED"
    Y genera el ObjectEvent EPCIS con disposition "consumed"

  Escenario: Registro de signos vitales pre-administración (opcional)
    Dado que el médico indicó "Registrar PA antes de administrar Enalapril"
    Y hay una nota en la indicación marcando los signos como requeridos
    Cuando la enfermera llega al Paso 3
    Entonces el sistema muestra el formulario de signos vitales como REQUERIDO antes de habilitar la confirmación
    Y no permite confirmar sin los valores de signos vitales

  Escenario: Registro de vía de administración
    Dado que la indicación especifica vía "IV"
    Cuando la enfermera confirma la administración
    Entonces debe seleccionar la vía de administración del catálogo
    Y si selecciona una vía diferente a la indicada, el sistema muestra Warning "VIA_DIFERENTE_A_INDICACION"
    Y requiere justificación antes de continuar
```

**Notas técnicas:** modelo `MedicationAdministration` (Beta.7/8); FK a `PharmacyOrder` y a `GS1ScanEvent`; signos vitales opcionales en `jsonb administrationContext`.

---

### US.F2.6.25 — Reporte automático a farmacovigilancia en cualquier hard-stop (Must · 8 SP)

**Como** sistema / farmacéutico de turno
**quiero** que cualquier hard-stop en bedside scanning genere automáticamente un reporte al módulo de farmacovigilancia con todos los datos del incidente
**para** cumplir el requisito regulatorio y evitar que los incidentes queden sin documentar.

**Trazabilidad:** guia §2.5 (reporte automático a farmacovigilancia en hard-stop)

**Criterios de aceptación**

```gherkin
Funcionalidad: Reporte automático farmacovigilancia

  Escenario: Reporte generado en hard-stop LOTE_EN_RECALL
    Dado que se activó el Hard Stop "LOTE_EN_RECALL" para el paciente PAC-001
    Cuando el sistema procesa el hard-stop
    Entonces crea automáticamente un registro en "PharmacyVigilanceReport" con:
      - tipo_incidente: "RECALL_ACTIVO"
      - paciente_id, medico_prescriptor, enfermera_actuante
      - GTIN, lote, vencimiento, GLN de la unidad
      - timestamp ISO 8601 del incidente
      - hard_stop_activado: true
    Y envía notificación al Jefe de Farmacia y al Comité de Farmacovigilancia via outbox (Beta.15)
    Y el reporte queda en estado "PENDIENTE_REVISION" para gestión manual

  Escenario: Reporte generado en hard-stop ALERGIA_CONOCIDA
    Dado que se activó el Hard Stop "ALERGIA_CONOCIDA" en bedside
    Cuando el sistema procesa el hard-stop
    Entonces crea el reporte de farmacovigilancia con tipo_incidente "ALERGIA_CONOCIDA"
    Y vincula el registro de alergia del paciente al reporte
    Y notifica al médico prescriptor

  Escenario: Todos los hard-stops generan reporte — sin excepciones
    Dado cualquier hard-stop de la Regla de los 5 Correctos
    Cuando se activa el hard-stop
    Entonces el sistema SIEMPRE persiste el reporte de farmacovigilancia
    Incluso si la interfaz del usuario falla (el worker Inngest procesa de forma asíncrona)
```

**Notas técnicas:** worker Inngest `nursing.vigilance.reportHardStop`; modelo `PharmacyVigilanceReport`; patrón outbox (Beta.15) garantiza entrega.

---

### US.F2.6.26 — Soporte multi-medicamento por evento (kit de administración) (Must · 8 SP)

**Como** enfermera de turno
**quiero** administrar un kit de múltiples medicamentos en una misma sesión bedside (por ejemplo, medicación de las 08:00 con 4 ítems) sin tener que reiniciar el flujo de autenticación para cada ítem
**para** reducir el tiempo por ronda y minimizar interrupciones al flujo de trabajo.

**Trazabilidad:** guia §2.5 (soporte multi-medicamento por evento / kit); analisis §B.5

**Criterios de aceptación**

```gherkin
Funcionalidad: Kit de administración multi-medicamento

  Escenario: Administración de kit completo en sesión única
    Dado que ENF-001 completó los Pasos 1 y 2 para PAC-001
    Y la indicación de las 08:00 incluye 4 medicamentos (A, B, C, D)
    Cuando escanea cada unidosis en secuencia
    Entonces el sistema valida los 5 correctos para cada ítem de forma independiente
    Y muestra el progreso del kit (1/4, 2/4, 3/4, 4/4)
    Y no requiere re-escanear el GSRN profesional ni el GSRN paciente entre ítems del mismo kit

  Escenario: Hard stop en un ítem no bloquea los demás del kit
    Dado que el ítem B tiene un hard-stop "MEDICAMENTO_VENCIDO"
    Cuando el sistema activa el hard-stop para el ítem B
    Entonces bloquea solo el ítem B
    Y permite continuar con los ítems C y D del kit
    Y el ítem B queda en estado "BLOQUEADO_POR_HARD_STOP" en el kardex
    Y genera el reporte de farmacovigilancia para el ítem B

  Escenario: Cierre del kit con ítems pendientes
    Dado que el kit tiene 4 ítems y 1 quedó bloqueado por hard-stop
    Cuando la enfermera cierra la sesión del kit
    Entonces el sistema registra el kit con status "PARCIAL"
    Y el ítem bloqueado permanece en la cola con alerta al médico prescriptor
```

**Notas técnicas:** modelo `AdministrationSession` con `items[]`; la sesión persiste el GSRN profesional y paciente para toda la duración del kit.

---

### US.F2.6.27 — Feedback sonoro y visual diferenciado (Must · 3 SP)

**Como** enfermera de turno
**quiero** recibir feedback inequívoco e inmediato (sonoro + visual) al escanear en bedside: verde / sonido OK para éxito, rojo / alerta para hard-stop
**para** actuar de forma segura incluso en ambientes de baja iluminación o ruido.

**Trazabilidad:** guia §2.5 (UX: feedback sonoro + visual); §4.2 Criterio 1

**Criterios de aceptación**

```gherkin
  Escenario: Feedback verde — escaneo correcto
    Dado que un scan pasa todas las validaciones
    Cuando el sistema confirma el resultado
    Entonces muestra fondo verde en el área de resultado y reproduce tono agradable de 300ms

  Escenario: Feedback rojo — hard stop activado
    Dado que un scan activa cualquier hard-stop
    Cuando el sistema detecta el error
    Entonces muestra fondo rojo con texto del error en tipografía grande
    Y reproduce alerta sonora intermitente de 1 segundo
    Y vibra el dispositivo si soporta Vibration API

  Escenario: Accesibilidad — contraste y screen reader
    Dado que un usuario con discapacidad visual usa screen reader
    Cuando ocurre un hard-stop
    Entonces el componente emite un aria-live="assertive" con el texto del error
    Y el contraste de colores cumple WCAG 2.1 AA (4.5:1 mínimo)
```

**Notas técnicas:** Web Vibration API; Audio API para tonos; componente React `ScanResult` con `aria-live`; colores del design system Avante.

---

### US.F2.6.28 — Navegación por teclado en flujo bedside (Should · 3 SP)

**Como** enfermera con pistola USB HID
**quiero** navegar por todas las pantallas del flujo bedside usando solo el teclado (tab, enter, flechas)
**para** no requerir tocar la pantalla cuando ambas manos están ocupadas.

**Trazabilidad:** guia §2.5 (A11y: navegación teclado); DoD §4.2

**Criterios de aceptación**

```gherkin
  Escenario: Navegación completa sin mouse
    Dado que la enfermera usa exclusivamente la pistola USB HID y el teclado
    Cuando navega por el flujo de administración
    Entonces puede completar los 3 pasos usando Tab para mover el foco y Enter para confirmar
    Y el foco visible cumple WCAG 2.1 SC 2.4.7 (focus visible)
    Y no hay trampas de foco en ninguna pantalla
```

---

### US.F2.6.29 — Captura de hora real vs. hora programada y análisis de adherencia (Should · 5 SP)

**Como** coordinador de enfermería
**quiero** que el sistema capture tanto la hora programada como la hora real de administración y calcule la variación
**para** identificar servicios con problemas de adherencia terapéutica.

**Trazabilidad:** analisis §3.7 (kardex — hora real vs. programada); §B.5

**Criterios de aceptación**

```gherkin
  Escenario: Registro de variación horaria
    Dado que la dosis estaba programada para las 08:00
    Y se administró a las 08:22
    Cuando se confirma la administración
    Entonces el sistema registra ambos timestamps
    Y calcula "desvio_minutos": 22
    Y clasifica la administración como "A_TIEMPO" (dentro de ventana +/- 30 min)

  Escenario: Clasificación fuera de ventana
    Dado que la administración ocurrió 45 minutos después de la hora programada
    Y no hubo override de hard-stop
    Cuando se procesa el registro
    Entonces se clasifica como "TARDIO" con desvio = 45
    Y se incluye en el reporte de adherencia del servicio
```

---

### US.F2.6.30 — Vínculo bidireccional bedside scan ↔ eMAR (Beta.7/8) (Must · 8 SP)

**Como** médico tratante
**quiero** que cada bedside scan confirmado genere automáticamente la entrada correspondiente en el eMAR (kardex electrónico) del paciente
**para** tener el registro de administración integrado en el expediente clínico sin doble captura.

**Trazabilidad:** CLAUDE.md Beta.7/8 eMAR; analisis §3.7 (kardex)

**Criterios de aceptación**

```gherkin
Funcionalidad: Integración bedside → eMAR

  Escenario: Creación automática en eMAR al confirmar administración
    Dado que la administración fue confirmada para PAC-001, GTIN "07501000001234"
    Cuando el sistema procesa la confirmación
    Entonces crea en "MedicationAdministration":
      - patientId, medicationId (desde GTIN), orderId (desde indicación)
      - administeredAt (hora real), scheduledAt (hora programada)
      - administeredBy (GSRN profesional → userId)
      - route (vía confirmada)
      - gs1ScanEventId (FK al evento de scan)
      - status: "ADMINISTERED"
    Y el eMAR del paciente refleja la entrada en tiempo real

  Escenario: Estado "OMITIDO" propagado a eMAR
    Dado que un ítem fue marcado como "OMITIDO" con motivo "DIETA_ABSOLUTA"
    Cuando se cierra la sesión de administración
    Entonces el eMAR muestra el ítem con status "OMITTED" y el motivo de omisión

  Escenario: Estado "BLOQUEADO_HARD_STOP" visible en eMAR para médico
    Dado que un hard-stop bloqueó la administración de un ítem
    Cuando el médico consulta el eMAR
    Entonces ve el ítem con status "HARD_STOP" y el tipo de error
    Y puede ver el reporte de farmacovigilancia vinculado
```

**Notas técnicas:** tRPC mutation `nursing.emar.recordAdministration`; usa `withTenantContext` para RLS; FK `gs1ScanEventId` en `MedicationAdministration`.

---

### US.F2.6.31 — Pantalla bedside de lista de medicamentos pendientes del turno (Must · 5 SP)

**Como** enfermera de turno
**quiero** ver al iniciar mi turno la lista de todos los medicamentos pendientes de administrar para cada paciente de mi servicio, ordenados por hora programada
**para** planificar la ronda sin consultar el kardex en papel.

**Trazabilidad:** analisis §3.7 (kardex), §B.5

**Criterios de aceptación**

```gherkin
  Escenario: Lista de pendientes al iniciar turno
    Dado que ENF-001 escanea su badge al iniciar el turno en "Medicina Interna"
    Cuando el sistema carga la vista de turno
    Entonces muestra agrupado por hora: todos los pacientes del servicio con sus medicamentos pendientes
    Y diferencia por color: STAT (rojo), ROUTINE (azul), PRONTO_A_VENCER_VENTANA (amarillo)
    Y la lista se actualiza en tiempo real cuando un ítem es administrado por otro colega
```

**Notas técnicas:** Supabase Realtime subscription; vista tRPC `nursing.shift.pendingMedications`.

---

### US.F2.6.32 — Historial de scan events por unidad GS1 (Should · 3 SP)

**Como** farmacéutico jefe / auditor clínico
**quiero** consultar el historial completo de scan events para un número de serie o lote específico (desde dispensación hasta administración)
**para** tener trazabilidad de extremo a extremo de cada unidad física.

**Trazabilidad:** guia §2.5 + §2.4 (trazabilidad extremo a extremo); §3 (EPCIS)

**Criterios de aceptación**

```gherkin
  Escenario: Timeline de una unidad por número de serie
    Dado que el auditor ingresa el serial "21000001" en el buscador GS1
    Cuando el sistema consulta los eventos EPCIS
    Entonces muestra la línea de tiempo: [Dispensado en Farmacia] → [Despachado al Servicio] → [Administrado bedside]
    Y cada paso incluye WHO (GSRN profesional), WHEN (timestamp), WHERE (GLN) y WHY (business_step)
```

---

### US.F2.6.33 — Visualización de alergias activas durante el flujo bedside (Must · 3 SP)

**Como** enfermera de turno
**quiero** ver las alergias activas del paciente al completar el Paso 2 (identificación) antes de escanear el medicamento
**para** tener conciencia situacional y actuar como barrera adicional.

**Trazabilidad:** analisis §3.7 (kardex alergias); guia §2.4 (cross-check alergias)

**Criterios de aceptación**

```gherkin
  Escenario: Banner de alergias al identificar paciente
    Dado que PAC-001 tiene 2 alergias activas registradas
    Cuando la enfermera completa el Paso 2 exitosamente
    Entonces el sistema muestra un banner permanente de alergias durante toda la sesión bedside
    Y el banner incluye principio activo, tipo de reacción y severidad
    Y no desaparece hasta que la sesión es cerrada
```

---

### US.F2.6.34 — Registro de observaciones de administración (Should · 2 SP)

**Como** enfermera de turno
**quiero** agregar observaciones de texto libre al momento de confirmar la administración (reacción observada, dificultad para tragar, etc.)
**para** complementar el registro del eMAR con información clínica relevante.

**Trazabilidad:** analisis §3.7 (notas de enfermería)

**Criterios de aceptación**

```gherkin
  Escenario: Observación opcional en confirmación
    Dado que la enfermera confirma la administración
    Cuando la pantalla de confirmación aparece
    Entonces hay un campo de texto opcional "Observaciones" (máximo 500 caracteres)
    Y si se ingresa texto, queda en "MedicationAdministration.administrationNotes"
    Y es visible en el eMAR para el médico
```

---

### US.F2.6.35 — Trazabilidad del override de hard-stop (Must · 5 SP)

**Como** auditor clínico
**quiero** que cualquier override (autorización para continuar a pesar de un warning) quede registrado con el usuario que autorizó, el motivo y el timestamp
**para** mantener trazabilidad criptográfica de las decisiones clínicas fuera de protocolo.

**Trazabilidad:** guia §2.5 (modo STAT bypass justificado y registrado); analisis §5 (inmutabilidad Art. 42)

**Criterios de aceptación**

```gherkin
  Escenario: Override de warning con justificación
    Dado que se activó el Warning "FUERA_DE_TURNO" para ENF-003
    Cuando el supervisor autoriza el override
    Entonces el sistema registra en "ClinicalOverride":
      - tipo_warning, usuario_solicitante (ENF-003), usuario_autorizante (SUPERVISOR)
      - motivo_seleccionado del catálogo + texto adicional
      - timestamp ISO 8601
    Y el override queda vinculado al evento de administración en audit_log
    Y es inmutable (no se puede editar ni borrar)

  Escenario: Los hard-stops NUNCA tienen override sin excepción documentada
    Dado que se activa un Hard Stop (no un warning)
    Cuando el sistema muestra el bloqueo
    Entonces no existe ningún botón de "continuar" sin el flujo de autorización de supervisor
    Y la autorización de supervisor requiere escaneo del GSRN del supervisor (no PIN)
```

**Notas técnicas:** modelo `ClinicalOverride` inmutable; trigger en BD que bloquea UPDATE/DELETE.

---

### US.F2.6.36 — Vista de kardex bedside para revisión rápida del médico (Should · 3 SP)

**Como** médico de turno visitando la cama del paciente
**quiero** acceder desde la tablet al kardex de administraciones del día del paciente con solo escanear la pulsera GSRN
**para** verificar rápidamente qué se ha administrado sin abrir el expediente completo.

**Trazabilidad:** analisis §3.7 (kardex médico), §B.5

**Criterios de aceptación**

```gherkin
  Escenario: Kardex de administraciones del día
    Dado que el médico escanea su badge y luego la pulsera del paciente
    Cuando el sistema valida ambos GSRN
    Entonces muestra la vista "Kardex del Día" con todos los medicamentos indicados, su estado actual (administrado / pendiente / omitido / hard-stop) y las horas
    Y el acceso queda registrado en bitácora_acceso
```

---

### US.F2.6.37 — Notificación al médico en hard-stop bedside (Must · 3 SP)

**Como** médico prescriptor
**quiero** recibir notificación inmediata cuando un hard-stop bloquea la administración de un medicamento que prescribí
**para** tomar acción clínica (cambiar la indicación, gestionar el lote alternativo) sin demora.

**Trazabilidad:** guia §2.5 (reporte automático farmacovigilancia); CLAUDE.md Beta.15 outbox

**Criterios de aceptación**

```gherkin
  Escenario: Notificación push al médico en hard-stop
    Dado que el hard-stop "MEDICAMENTO_INCORRECTO" bloqueó la administración de IND-2026-0501
    Cuando el sistema procesa el reporte de farmacovigilancia
    Entonces envía notificación push (via outbox Beta.15) al médico prescriptor MC-001 con:
      - paciente, medicamento bloqueado, tipo de hard-stop
      - hora del incidente
      - enlace directo al expediente del paciente
    Y la notificación aparece en la bandeja del médico en ≤ 30 segundos
```

---

### US.F2.6.38 — Validación regex FNC1 en parsing de DataMatrix (Must · 3 SP)

**Como** sistema
**quiero** que el parser GS1 valide los prefijos invisibles de control FNC1 antes de extraer los AI del DataMatrix
**para** evitar interpretaciones erróneas de strings mal formados que podrían confundir medicamentos.

**Trazabilidad:** guia §4.3 (Caso de prueba decodificación GS1 / regex FNC1); DoD global

**Criterios de aceptación**

```gherkin
  Escenario: String bien formado con FNC1 explícito
    Dado que el escáner envía el string "(01)07501000001234(10)L2024A(17)261231"
    Cuando el parser GS1 procesa el string
    Entonces extrae correctamente: gtin="07501000001234", lot="L2024A", expiry="2026-12-31"
    Y no lanza excepciones de parsing

  Escenario: String con FNC1 como carácter de control (0x1D)
    Dado que el escáner envía el raw string con 0x1D como separador
    Cuando el parser procesa el string
    Entonces reconoce el 0x1D como separador de AI y extrae correctamente los valores

  Escenario: String mal formado — rechazo
    Dado que el escáner envía un string que no sigue el estándar GS1 AI
    Cuando el parser intenta procesarlo
    Entonces lanza "GS1_PARSE_ERROR" y bloquea la acción
    Y no extrae ningún valor parcial que pueda usarse erróneamente
```

**Notas técnicas:** función `parseGs1DataMatrix(raw: string): Gs1Data | ParseError` en `packages/contracts/src/validators/gs1.ts`; tests unitarios en `__tests__/gs1.test.ts`.

---

### US.F2.6.39 — Registro inmutable de cada GS1 scan event (Must · 5 SP)

**Como** auditor clínico / regulador
**quiero** que cada scan bedside genere un registro inmutable en la cadena de auditoría del sistema
**para** garantizar que ningún evento de administración pueda ser alterado retroactivamente.

**Trazabilidad:** CLAUDE.md §audit hash chain; guia §3 (EPCIS WHEN inmutable ISO 8601)

**Criterios de aceptación**

```gherkin
  Escenario: Registro de scan event inmutable
    Dado que se confirma un bedside scan
    Cuando el sistema persiste el evento
    Entonces crea un registro en "GS1ScanEvent" con:
      - prev_hash, payload_hash, chain_hash (patrón audit hash chain del sistema)
      - tipo: BEDSIDE_SCAN
      - gsrn_profesional, gsrn_paciente, gtin, lote, serial
      - timestamp ISO 8601 con precisión de segundo
      - resultado: OK | HARD_STOP | WARNING_OVERRIDE
    Y el registro NO puede ser modificado (trigger bloquea UPDATE/DELETE)

  Escenario: Verificación de integridad de la cadena
    Dado que el auditor ejecuta la verificación de la cadena de scan events
    Cuando el router "auditIntegrityRouter" valida los hashes
    Entonces confirma que ningún evento ha sido alterado
```

**Notas técnicas:** sigue el mismo patrón que `audit.audit_log` descrito en CLAUDE.md; tabla `gs1.scan_event` con triggers de hash chain.

---

### US.F2.6.40 — Confirmación de identidad alternativa ante pulsera dañada (Should · 3 SP)

**Como** enfermera de turno
**quiero** poder solicitar verificación de identidad alternativa cuando la pulsera GSRN del paciente está dañada o ilegible
**para** no interrumpir la atención urgente mientras se reimprime la pulsera.

**Trazabilidad:** guia §2.5 (gestión de excepciones de identificación)

**Criterios de aceptación**

```gherkin
  Escenario: Pulsera ilegible — flujo de verificación alternativa
    Dado que el escáner no puede leer la pulsera de PAC-001
    Cuando la enfermera activa "Pulsera ilegible"
    Entonces el sistema ofrece verificación por: número de expediente + fecha de nacimiento
    Y requiere autorización de supervisor (GSRN supervisor escaneado)
    Y registra el evento como "IDENTIFICACION_ALTERNATIVA" en audit_log
    Y genera automáticamente una solicitud de reimpresión de pulsera a admisión
```

---

## SECCION 4 — Hardware Adapters (Pistola USB HID y Cámara PWA)

### US.F2.6.41 — Adapter para pistola USB HID (modo teclado) (Must · 8 SP)

**Como** enfermera / farmacéutico usando pistola USB HID
**quiero** que el sistema detecte y procese las lecturas de la pistola como si fueran input de teclado, diferenciando el scan del teclado humano
**para** que la pistola funcione sin drivers adicionales en cualquier dispositivo con USB.

**Trazabilidad:** guia §2.5 (captura con pistola USB HID modo teclado)

**Criterios de aceptación**

```gherkin
Funcionalidad: Adapter pistola USB HID

  Escenario: Detección automática de scan por velocidad de input
    Dado que la enfermera conecta la pistola USB HID
    Cuando escanea un código (la pistola envía todos los caracteres en < 50ms)
    Entonces el adapter detecta la velocidad de input como "scan event" (no teclado humano)
    Y procesa el string completo como un DataMatrix GS1

  Escenario: Separación entre scan y tipeo humano
    Dado que el usuario escribe manualmente en el campo
    Cuando el input ocurre a velocidad de tipeo humano (> 100ms entre caracteres)
    Entonces el adapter identifica el input como tipeo manual
    Y el campo rechaza el input manual con mensaje "USE EL ESCANER"

  Escenario: Compatibilidad con sufijo Enter o Tab de la pistola
    Dado que la pistola está configurada para enviar "Enter" al final de cada scan
    Cuando el adapter recibe el string terminado en Enter
    Entonces strip el sufijo y procesa solo el payload GS1
    Y avanza automáticamente al siguiente paso del flujo
```

**Notas técnicas:** hook `useHidScanner(fieldRef, onScan)` en `packages/ui`; debounce de 50ms para separar scan de tipeo; configurable `scanSuffix: "Enter" | "Tab" | "none"`.

---

### US.F2.6.42 — Adapter para cámara PWA con BarcodeDetector API (Must · 8 SP)

**Como** enfermera usando smartphone o tablet sin pistola
**quiero** usar la cámara del dispositivo para capturar DataMatrix GS1 directamente desde la app PWA
**para** tener capacidad bedside sin hardware especializado.

**Trazabilidad:** guia §2.5 (cámara PWA BarcodeDetector API o zxing-js)

**Criterios de aceptación**

```gherkin
Funcionalidad: Adapter cámara PWA

  Escenario: Detección nativa con BarcodeDetector API
    Dado que el dispositivo soporta BarcodeDetector API (Chrome/Edge modernos)
    Cuando la enfermera activa el modo cámara en la app
    Entonces el adapter usa BarcodeDetector con formato "datamatrix"
    Y muestra el viewfinder en tiempo real con encuadre guía
    Y al detectar el DataMatrix lo procesa automáticamente sin pulsar botón

  Escenario: Fallback a zxing-js en dispositivos sin BarcodeDetector
    Dado que el dispositivo no soporta BarcodeDetector API
    Cuando el adapter detecta la ausencia de la API
    Entonces carga dinámicamente "zxing-js/browser" como fallback
    Y mantiene la misma interfaz de callback "onScan(rawString)"

  Escenario: Timeout y mensaje si no se detecta código en 10 segundos
    Dado que la cámara está activa y no detecta ningún código
    Cuando han pasado 10 segundos
    Entonces muestra el mensaje "No se detectó código — intente acercarse más o usar la pistola"
    Y ofrece botón "Reintentar"
```

**Notas técnicas:** `BarcodeDetector` API disponible en Chrome 83+; polyfill con `import('@zxing/browser')`; hook `useCameraScanner(onScan, options)`; permisos de cámara solicitados vía PWA manifest.

---

### US.F2.6.43 — Configuración de dispositivo de scanning por estación (Should · 5 SP)

**Como** administrador TI
**quiero** configurar qué tipo de dispositivo de scanning está disponible en cada estación (pistola HID / cámara PWA / ambos) y el modo por defecto
**para** que la UI se adapte automáticamente al hardware disponible sin configuración manual por el usuario.

**Trazabilidad:** guia §2.5 (hardware adapters); CLAUDE.md stack Next.js

**Criterios de aceptación**

```gherkin
  Escenario: Configuración por GLN de estación
    Dado que el admin configura la estación "Farmacia-01" como "PISTOLA_HID"
    Y la estación "Cama-MI-01" como "CAMARA_PWA"
    Cuando el usuario abre la app en cada estación
    Entonces el adapter correspondiente se activa por defecto
    Y el usuario puede cambiar manualmente si ambos modos están disponibles
```

**Notas técnicas:** configuración en `StationConfig.scannerType` en BD; leída via tRPC `admin.station.getConfig`; persistida en localStorage para sesiones offline.

---

### US.F2.6.44 — Pruebas de aceptación de hardware (Must · 3 SP)

**Como** @QAF / @QA
**quiero** un conjunto de casos de prueba automatizados que simulen el input de pistola USB HID y cámara PWA
**para** garantizar que los adapters funcionan correctamente sin hardware físico en CI.

**Trazabilidad:** guia §4.3 (pruebas de integración GS1); CLAUDE.md CI pipeline

**Criterios de aceptación**

```gherkin
  Escenario: Simulación de pistola en tests Playwright
    Dado que el test fixture simula input de pistola (string completo en un evento de input)
    Cuando el test ejecuta el flujo bedside completo
    Entonces el adapter procesa el scan correctamente y el flujo avanza
    Y el test pasa en el pipeline CI sin hardware físico

  Escenario: Mock de BarcodeDetector API en Vitest
    Dado que el test configura un mock de "window.BarcodeDetector"
    Cuando el adapter se inicializa
    Entonces usa el mock sin intentar acceder a cámara real
    Y el callback "onScan" se invoca con el código esperado
```

---

### US.F2.6.45 — Soporte multi-formato de código de barras (Should · 2 SP)

**Como** farmacéutico
**quiero** que el sistema acepte Code 128, QR y DataMatrix para pulseras GSRN y medicamentos
**para** interoperar con proveedores que usen diferentes formatos de impresión.

**Trazabilidad:** guia §1.2 (GS1 DataMatrix mandatorio); §2.5 (Code 128/QR/DataMatrix pulsera)

**Criterios de aceptación**

```gherkin
  Escenario: Aceptación de Code 128 en pulsera GSRN
    Dado que la pulsera fue impresa en Code 128 (no DataMatrix)
    Cuando se escanea la pulsera
    Entonces el adapter decodifica correctamente y extrae el GSRN
    Y el flujo continúa normalmente

  Escenario: DataMatrix obligatorio para unidosis
    Dado que el estándar GS1 manda DataMatrix para medicamentos
    Cuando el adapter detecta un Code 128 en el campo de GTIN
    Entonces lanza advertencia "FORMATO_NO_ESTANDAR" y solicita confirmación
    Y registra el evento para auditoría de catálogo de proveedores
```

---

## SECCION 5 — Modos Especiales (Rondas, STAT, Offline)

### US.F2.6.46 — Modo Rondas: flujo optimizado para 8-15 pacientes por turno (Must · 8 SP)

**Como** enfermera de turno
**quiero** un modo de rondas que me permita administrar medicamentos a múltiples pacientes de forma continua sin reiniciar mi autenticación para cada paciente
**para** completar la ronda matutina en el tiempo estipulado del turno.

**Trazabilidad:** guia §2.5 (modo rondas: flujo optimizado para enfermera con 8-15 pacientes)

**Criterios de aceptación**

```gherkin
Funcionalidad: Modo Rondas

  Escenario: Inicio de modo rondas con re-autenticación por paciente
    Dado que ENF-001 activa "Modo Rondas" en el turno de mañana
    Cuando escanea su badge GSRN (autenticación única al iniciar)
    Entonces el sistema mantiene la sesión de la enfermera activa por la duración del turno
    Y para cada paciente solo exige escanear la pulsera GSRN (Paso 2) y los GTIN (Paso 3)
    Y la pantalla muestra el orden sugerido de pacientes optimizado por ubicación geográfica de camas

  Escenario: Transición entre pacientes en modo rondas
    Dado que ENF-001 terminó la administración para PAC-001
    Cuando pulsa "Siguiente Paciente"
    Entonces el sistema limpia el contexto del paciente anterior
    Y activa el Paso 2 para el próximo paciente en la cola de rondas
    Y muestra el progreso de la ronda (3 de 12 pacientes completados)

  Escenario: Expiración de sesión en modo rondas por inactividad
    Dado que ENF-001 no ha escaneado nada en 5 minutos
    Cuando el timer de inactividad expira
    Entonces el sistema requiere re-escaneo del badge GSRN de la enfermera para continuar
    Y muestra "Sesión suspendida por inactividad — re-escanee su badge"

  Escenario: Hard stop en paciente no interrumpe la ronda completa
    Dado que PAC-003 tiene un hard-stop activo
    Cuando el sistema activa el hard-stop durante la ronda
    Entonces registra el bloqueo, genera el reporte y permite avanzar al siguiente paciente
    Y PAC-003 queda en la cola de "Pendientes por resolver"
```

**Notas técnicas:** `RoundSession` persistida en BD con TTL de turno (8h); lista de pacientes ordenada por GLN de cama; tRPC `nursing.round.start`, `nursing.round.nextPatient`.

---

### US.F2.6.47 — Modo STAT: administración urgente con bypass justificado (Must · 8 SP)

**Como** enfermera de turno / médico
**quiero** activar el modo STAT para administrar un medicamento urgente fuera de la ventana terapéutica normal, con bypass documentado y autorizado
**para** responder a emergencias clínicas sin que el sistema lo bloquee, pero dejando registro completo.

**Trazabilidad:** guia §2.5 (modo STAT / urgencia con bypass justificado y registrado)

**Criterios de aceptación**

```gherkin
Funcionalidad: Modo STAT

  Escenario: Activación de modo STAT con autorización médica
    Dado que el médico MC-001 ordena administración STAT de un medicamento fuera de ventana
    Cuando ENF-001 activa el modo STAT en la pantalla bedside
    Entonces el sistema requiere escaneo del GSRN del médico autorizante
    Y registro del motivo STAT (catálogo: EMERGENCIA_CLINICA, CAMBIO_INDICACION, OTRO)
    Y si se selecciona "OTRO" exige texto de descripción
    Y una vez autorizado, los hard-stops de ventana terapéutica se suspenden para ese evento
    Y el evento queda marcado como "STAT" en el eMAR con referencia a la autorización

  Escenario: Hard-stops de seguridad NO se suspenden en modo STAT
    Dado que el modo STAT está activo
    Cuando el sistema detecta "MEDICAMENTO_VENCIDO" o "LOTE_EN_RECALL"
    Entonces el hard-stop de seguridad prevalece sobre el modo STAT
    Y no hay bypass posible para estos hard-stops

  Escenario: Registro completo de administración STAT
    Dado que se completó una administración en modo STAT
    Cuando el sistema procesa la confirmación
    Entonces el evento EPCIS incluye en la dimensión WHY: business_step "stat_administration"
    Y el reporte de farmacovigilancia es generado automáticamente para revisión posterior
```

**Notas técnicas:** flag `isStatAdministration` en `MedicationAdministration`; override registrado en `ClinicalOverride` con GSRN del médico autorizante.

---

### US.F2.6.48 — Modo Offline: PWA con cola de sincronización (Must · 13 SP)

**Como** enfermera usando la app en zona sin WiFi
**quiero** que la app funcione offline y encole los scan events para sincronizarlos cuando se restaure la conexión
**para** que la caída del WiFi no interrumpa la administración de medicamentos.

**Trazabilidad:** guia §2.5 (capacidades offline PWA con cola sync cuando WiFi cae)

**Criterios de aceptación**

```gherkin
Funcionalidad: Modo Offline PWA

  Escenario: Detección de pérdida de conexión
    Dado que la enfermera está en modo rondas y el WiFi cae
    Cuando el sistema detecta la pérdida de conexión (navigator.onLine = false)
    Entonces muestra el indicador "MODO OFFLINE" en la barra de estado
    Y continúa permitiendo el flujo bedside usando datos cacheados (indicaciones, catálogos GSRN/GTIN)

  Escenario: Cola de scan events offline con IndexedDB
    Dado que el sistema está en modo offline
    Cuando la enfermera completa administraciones
    Entonces los scan events son encolados en IndexedDB con estado "PENDING_SYNC"
    Y se muestran en la UI con indicador "Pendiente de sincronización"

  Escenario: Sincronización automática al restaurar conexión
    Dado que hay 5 eventos en cola "PENDING_SYNC"
    Cuando el WiFi se restaura (navigator.onLine = true)
    Entonces el background sync worker procesa la cola en orden cronológico
    Y cada evento persiste en el servidor y cambia a "SYNCED"
    Y se genera el evento EPCIS correspondiente
    Y la UI actualiza el estado de cada administración

  Escenario: Conflicto de sincronización detectado
    Dado que durante el offline otro usuario también registró datos del mismo paciente
    Cuando el sync worker detecta conflicto (timestamps solapados)
    Entonces aplica la política "last-write-wins" por timestamp y lo reporta al supervisor
    Y ambos eventos quedan en audit_log

  Escenario: Límite de operaciones offline
    Dado que el modo offline está activo
    Entonces el sistema solo permite administraciones (no cancelaciones ni modificaciones de indicaciones)
    Y avisa que las operaciones de farmacia requieren conexión

  Escenario: Catálogos críticos cacheados para uso offline
    Dado que la app inicia con conexión disponible
    Cuando los catálogos GSRN, GTIN y GLN son descargados
    Entonces quedan persistidos en IndexedDB con TTL de 8 horas (1 turno)
    Y en modo offline las validaciones usan estos catálogos cacheados
```

**Notas técnicas:** Service Worker con Workbox; sync queue en IndexedDB via `idb` library; Background Sync API; catálogos cacheados con `Cache-Control` del SW; los hard-stops de seguridad (vencimiento, recall) se validan contra los catálogos offline cacheados — si el recall se dio después del último cache, el sistema advierte "CONECTIVIDAD REQUERIDA PARA VALIDAR RECALLS".

---

### US.F2.6.49 — Indicador de estado de sincronización offline en UI (Should · 3 SP)

**Como** supervisor de enfermería
**quiero** ver en el dashboard cuántos eventos están pendientes de sincronización y en qué dispositivos
**para** saber si hay administraciones que aún no han llegado al servidor central.

**Trazabilidad:** guia §2.5 (cola sync); analisis §B.5

**Criterios de aceptación**

```gherkin
  Escenario: Dashboard de estado offline
    Dado que el supervisor accede al panel de turno
    Cuando hay dispositivos en modo offline con eventos pendientes
    Entonces el panel muestra: dispositivo (hostname/IP), cantidad de eventos pendientes, último sync exitoso
    Y los dispositivos offline se marcan con icono de "sin conexión"
```

---

### US.F2.6.50 — Modo ronda con ruta optimizada de camas (Should · 3 SP)

**Como** enfermera de turno
**quiero** que el modo rondas sugiera el orden de camas geográficamente óptimo para minimizar desplazamientos
**para** reducir el tiempo de ronda y llegar antes a los pacientes con ventana terapéutica próxima a cerrar.

**Trazabilidad:** guia §2.5 (modo rondas optimizado)

**Criterios de aceptación**

```gherkin
  Escenario: Orden de ronda sugerido
    Dado que la enfermera inicia la ronda en "Medicina Interna"
    Cuando el sistema genera el orden de ronda
    Entonces ordena las camas minimizando la distancia recorrida (orden por pasillo/número de cama)
    Y prioriza los pacientes con ventana terapéutica cerrándose en los próximos 15 minutos (color amarillo → naranja → rojo)
```

---

### US.F2.6.51 — Pausa y reanudación de sesión de ronda (Should · 2 SP)

**Como** enfermera de turno
**quiero** poder pausar la ronda (atender una urgencia) y reanudarla desde el punto donde la dejé
**para** no perder el progreso del turno ante interrupciones imprevistas.

**Trazabilidad:** analisis §B.5

**Criterios de aceptación**

```gherkin
  Escenario: Pausa y reanudación de ronda
    Dado que ENF-001 tiene 7 de 12 pacientes completados
    Cuando activa "Pausar Ronda" para atender una urgencia
    Entonces el sistema guarda el estado de la ronda con pacientes completados/pendientes
    Y al reanudar, muestra exactamente el estado previo de la ronda
    Y registra el tiempo de pausa en el log de turno
```

---

### US.F2.6.52 — Alerta de ventana terapéutica próxima a cerrar (Must · 3 SP)

**Como** enfermera de turno
**quiero** recibir alertas 15 minutos antes de que cierre la ventana terapéutica de un medicamento pendiente
**para** priorizar la visita a ese paciente y administrar la dosis a tiempo.

**Trazabilidad:** guia §2.5 (5 correctos — hora correcta); analisis §3.7

**Criterios de aceptación**

```gherkin
  Escenario: Alerta de ventana próxima a cerrar
    Dado que PAC-005 tiene dosis de "Enalapril" con ventana hasta las 09:00
    Y son las 08:45
    Cuando el sistema evalúa las ventanas activas
    Entonces envía notificación push a ENF-001 "VENTANA_CERRANDO: Enalapril para PAC-005 — 15 min restantes"
    Y marca al paciente en naranja en la lista de rondas
```

**Notas técnicas:** worker Inngest schedulado cada 5 min; `nursing.shift.checkTherapeuticWindows`.

---

## SECCION 6 — Eventos EPCIS Clínicos y Farmacovigilancia

### US.F2.6.53 — ObjectEvent EPCIS por cada scan de unidosis (Must · 5 SP)

**Como** sistema
**quiero** persistir un ObjectEvent EPCIS por cada scan individual de unidosis en dispensación o bedside
**para** tener trazabilidad atómica de cada unidad física a través de todos sus estados.

**Trazabilidad:** guia §3 (meta-prompt EPCIS, ObjectEvent); §2.4, §2.5

**Criterios de aceptación**

```gherkin
Funcionalidad: ObjectEvent EPCIS por scan

  Escenario: ObjectEvent al confirmar scan en dispensación
    Dado que el farmacéutico confirma el scan de la unidad serial "21000001"
    Cuando el worker EPCIS procesa el evento
    Entonces persiste ObjectEvent con:
      - WHAT: "epcList: [sgtin: 07501000001234.21000001]" + lote + vencimiento
      - WHERE: readPoint GLN "Farmacia Central"
      - WHEN: eventTime ISO 8601 + recordTime ISO 8601
      - WHY: business_step "dispensing", disposition "dispensed"
      - WHO: GSRN farmacéutico en "sourceList"

  Escenario: ObjectEvent al confirmar administración bedside
    Dado que la enfermera confirma la administración de la unidad "21000001"
    Cuando el worker procesa el evento
    Entonces persiste ObjectEvent con:
      - WHAT: sgtin "07501000001234.21000001"
      - WHERE: readPoint GLN cama "MI-01"
      - WHEN: eventTime = hora real de administración
      - WHY: business_step "administering", disposition "consumed"
      - WHO: GSRN enfermera + GSRN paciente en "sourceList"
```

---

### US.F2.6.54 — TransactionEvent EPCIS vinculando receta y administración (Must · 5 SP)

**Como** auditor clínico
**quiero** que el sistema genere un TransactionEvent EPCIS que vincule la receta médica con el evento de administración bedside
**para** tener trazabilidad completa de la cadena prescripción → dispensación → administración.

**Trazabilidad:** guia §3 (TransactionEvent, vínculo receta ↔ administración)

**Criterios de aceptación**

```gherkin
Funcionalidad: TransactionEvent EPCIS

  Escenario: TransactionEvent al completar la cadena
    Dado que la unidad "21000001" fue dispensada (ObjectEvent #1) y administrada (ObjectEvent #2)
    Cuando el worker genera el TransactionEvent
    Entonces persiste:
      - WHAT: epcList con el sgtin de la unidad
      - WHERE: GLN del acto de administración (cama)
      - WHEN: timestamp ISO 8601 de la administración
      - WHY: business_step "accepting", disposition "consumed"
            bizTransactionList: [{type: "po", id: "IND-2026-0501"}] (referencia a la receta)
      - WHO: GSRN enfermera + GSRN paciente
    Y el TransactionEvent queda vinculado a los dos ObjectEvents relacionados
```

---

### US.F2.6.55 — Disposiciones EPCIS en todo el ciclo de vida (Must · 3 SP)

**Como** sistema
**quiero** que cada transición de estado del medicamento mapee correctamente a una disposition EPCIS estándar
**para** garantizar interoperabilidad con sistemas externos de farmacovigilancia y auditoría GS1.

**Trazabilidad:** guia §3 (disposition: dispensed, in_progress, completed, recalled)

**Criterios de aceptación**

```gherkin
Funcionalidad: Mapping de disposiciones EPCIS

  Escenario: Mapeo correcto de disposiciones
    Dado el ciclo de vida de una unidad
    Cuando el sistema genera eventos EPCIS en cada transición
    Entonces aplica el mapeo:
      | Estado del sistema       | Disposition EPCIS   |
      | RESERVADO (picking)      | in_progress         |
      | DESPACHADO (al servicio) | in_transit          |
      | EN_SERVICIO              | in_stock            |
      | ADMINISTRADO (bedside)   | consumed            |
      | RECALL_ACTIVO            | recalled            |
      | VENCIDO_BLOQUEADO        | expired             |
      | HARD_STOP_BLOQUEADO      | non_sellable        |
```

---

### US.F2.6.56 — Reporte consolidado de farmacovigilancia (Must · 8 SP)

**Como** Comité de Farmacovigilancia
**quiero** un reporte consolidado que agrupe todos los incidentes de hard-stop, alertas de recall y reportes de farmacovigilancia del período
**para** analizar patrones y proponer mejoras al proceso de seguridad del paciente.

**Trazabilidad:** guia §2.5 (reporte automático farmacovigilancia); §4.3 (caso prueba recall)

**Criterios de aceptación**

```gherkin
Funcionalidad: Reporte consolidado farmacovigilancia

  Escenario: Generación del reporte periódico
    Dado que el Comité solicita el reporte del mes
    Cuando ejecuta "Reporte de Farmacovigilancia"
    Entonces el sistema genera:
      - Total hard-stops por tipo (GTIN_NO_COINCIDE, VENCIDO, RECALL, ALERGIA, DOSIS, HORA)
      - Top 5 medicamentos con más incidentes
      - Servicios con más hard-stops
      - Tiempo promedio de resolución por tipo de incidente
      - Lista detallada de casos con enlace al expediente del paciente
    Y el reporte puede exportarse en PDF/CSV
    Y queda registrado en auditoría con firma del solicitante

  Escenario: Simulación de alerta recall ministerial (prueba de integración QA)
    Dado que llega un comunicado de recall del lote "X" de cualquier medicamento
    Cuando el administrador registra el recall en el sistema
    Entonces todos los escaneos de ese lote en todos los GLN generan Hard Stop inmediato
    Y el sistema genera alerta global a todos los farmacéuticos y supervisores de turno
    Y el reporte de impacto muestra qué pacientes recibieron ese lote en los últimos N días
```

---

### US.F2.6.57 — Trazabilidad inversa: recall → pacientes expuestos (Must · 5 SP)

**Como** director médico
**quiero** que al registrar un recall de lote el sistema identifique inmediatamente qué pacientes recibieron unidades de ese lote
**para** activar el protocolo de seguimiento clínico de forma oportuna.

**Trazabilidad:** guia §4.3 (caso de prueba alerta recall); §2.6 (logística inversa/cuarentena)

**Criterios de aceptación**

```gherkin
  Escenario: Identificación de pacientes expuestos
    Dado que el lote "L2024A" del GTIN "07501000001234" es declarado en recall
    Cuando el administrador registra el recall en el sistema
    Entonces el sistema consulta los ObjectEvent EPCIS de los últimos 90 días
    Y genera la lista de pacientes que recibieron unidades de ese lote
    Y notifica al médico tratante de cada paciente afectado via outbox (Beta.15)
    Y cambia el estado de todas las unidades restantes de ese lote a "RECALLED" en todos los GLN
    Y bloquea cualquier nuevo scan de ese lote con Hard Stop inmediato
```

**Notas técnicas:** query sobre `EpcisEvent` con filtros `what.gtin = X AND what.lot = L AND why.disposition = consumed`; notificación masiva via Inngest fan-out.

---

### US.F2.6.58 — Exportación EPCIS XML/JSON para interoperabilidad (Should · 5 SP)

**Como** director de TI
**quiero** exportar los eventos EPCIS en formato XML o JSON estándar GS1 EPCIS 1.2 / 2.0
**para** interoperar con sistemas regulatorios externos o auditores de calidad.

**Trazabilidad:** guia §3 (meta-prompt EPCIS, arquitectura de workflows GS1)

**Criterios de aceptación**

```gherkin
  Escenario: Exportación de eventos EPCIS en rango de fechas
    Dado que el auditor solicita los eventos EPCIS del 01/05/2026 al 15/05/2026
    Cuando ejecuta la exportación
    Entonces el sistema genera el archivo EPCIS XML conforme al schema GS1 EPCIS 1.2
    Y el archivo incluye EPCISHeader con sender GLN y timestamp de generación
    Y cada evento tiene todas las dimensiones WHAT/WHERE/WHEN/WHY/WHO completas
    Y el formato JSON alternativo es válido contra el JSON-LD de EPCIS 2.0
```

**Notas técnicas:** endpoint tRPC `epcis.export`; serialización con `fast-xml-parser`; validación contra XSD EPCIS.

---

## Dependencias Técnicas

| Dependencia | Tipo | Impacta | Prioridad |
|---|---|---|---|
| Modelos Prisma: `PharmacyOrder`, `MedicationAdministration`, `GS1ScanEvent`, `EpcisEvent`, `PharmacyReservation`, `StaffGsrn`, `LocationGln`, `MedicationGtin`, `DispensingCart`, `RoundSession`, `PharmacyVigilanceReport`, `ClinicalOverride`, `PharmacySubstitution`, `AdministrationSession` | @DBA | Todas las US | Bloqueante |
| Beta.7/8 eMAR — modelo `MedicationAdministration` con FKs a `GS1ScanEvent` | @Dev | US.F2.6.24, .30 | Alta |
| Beta.15 outbox notifications — canal para hard-stops y farmacovigilancia | @Dev | US.F2.6.25, .37, .57 | Alta |
| `packages/contracts/src/validators/gs1.ts` — parser DataMatrix + regex FNC1 | @Dev | US.F2.6.7, .23, .38 | Alta |
| Hook `useHidScanner` y `useCameraScanner` en `packages/ui` | @Dev | US.F2.6.41, .42 | Alta |
| Worker Inngest `pharmacy.epcis.*` y `nursing.vigilance.*` | @Dev | US.F2.6.14, .25, .56 | Alta |
| Service Worker PWA + Workbox + IndexedDB | @Dev | US.F2.6.48, .49 | Alta |
| RLS: `withTenantContext` en todos los routers nuevos | @Dev | Todas | Bloqueante |
| Maquetas @UIUX: pantalla picking, bedside scan, modo rondas, hard-stop, modo offline | @UIUX | US.F2.6.7, .21-23, .27, .46, .48 | Alta |
| Fixtures de prueba: GSRN válidos, GTIN con AI completos | @QA | Todas | Alta |

---

## Hardware Requerido

| Dispositivo | Uso | Especificación mínima |
|---|---|---|
| Pistola USB HID modo teclado | Farmacia (picking), camas (bedside) | 2D DataMatrix + QR; modo teclado; velocidad scan > 300 scans/h |
| Tablet/smartphone con cámara | Bedside scanning PWA | Chrome 83+ o Edge; cámara trasera 8MP; WiFi 802.11ac |
| Impresora de pulseras | Admisión | Zebra ZD series o compatible ZPL; Code 128 / DataMatrix |
| Impresora de badges | RR.HH. / Admin | DataMatrix en policarbonato o PVC |

---

## Librerías Sugeridas

| Librería | Uso | Justificación |
|---|---|---|
| `BarcodeDetector` API (nativa) | Cámara PWA | Sin dependencia; disponible Chrome 83+ |
| `@zxing/browser` | Fallback cámara | Amplio soporte de formatos; licencia Apache 2.0 |
| `idb` (Jake Archibald) | IndexedDB offline queue | API Promise-based; sin transitive deps pesadas |
| `workbox-window` + `workbox-strategies` | Service Worker PWA | Abstracción sobre SW; integra con Next.js |
| `fast-xml-parser` | Export EPCIS XML | Serialización bidireccional XML ↔ JSON; performance |
| Parser GS1 interno | `contracts/validators/gs1.ts` | Sin deps externas; controlado; paridad TS ↔ SQL |

---

## KPIs de Producto

| KPI | Meta | Fuente de datos |
|---|---|---|
| Tasa de error de medicación pre/post | Reducción >= 70% en 6 meses | `PharmacyVigilanceReport` |
| Hard-stops activados por turno | Baseline + tendencia semanal | `GS1ScanEvent.resultado = HARD_STOP` |
| Tiempo promedio de ronda (modo rondas) | < 45 min para 12 pacientes | `RoundSession.endTime - startTime` |
| Tasa de administraciones en ventana terapéutica | >= 95% | `MedicationAdministration.desvio_minutos` |
| Eventos EPCIS completos (5 dimensiones) | 100% | `EpcisEvent` con validación schema |
| Uptime modo offline | >= 99.5% (operación continua ante caída WiFi) | Service Worker sync queue |
| Cobertura de tests | >= 80% líneas / 75% branches | CI pipeline coverage report |

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Hardware incompatible (pistola no soporta DataMatrix) | Media | Alto | Probar 3 modelos antes de adquirir; fallback cámara PWA siempre disponible |
| BarcodeDetector API no disponible en iOS Safari | Alta | Medio | Fallback zxing-js probado en CI; documentar requerimiento Chrome/Edge |
| Catálogos GTIN desactualizados en proveedores locales | Media | Alto | Proceso de carga masiva CSV con validación de dígito verificador |
| Latencia de workers Inngest en hard-stops | Baja | Alto | Hard-stops validados síncronamente en el router tRPC; worker solo para EPCIS y notificaciones |
| Conflictos de sync offline con múltiples enfermeras en una cama | Baja | Medio | Política last-write-wins por timestamp; alerta de conflicto al supervisor |
| Resistencia del personal a no ingresar texto manual | Alta | Alto | Capacitación + UI que hace imposible el bypass; feedback inmediato |

---

## Decisiones de Diseño

| Decisión | Alternativas consideradas | Justificación |
|---|---|---|
| Hard-stops síncronos en tRPC (no en worker) | Worker asíncrono | Latencia inaceptable para acto clínico; el worker es solo para EPCIS |
| IndexedDB para cola offline (no localStorage) | localStorage, sessionStorage | Soporte para objetos grandes; transaccional; no tiene límite de 5MB |
| Parser GS1 interno en `contracts/validators` | Librería npm externa | Control total; paridad TS ↔ SQL; sin vulnerabilidades de supply chain |
| GSRN en campo `readOnly` con listener de escáner | Campo `disabled` | `disabled` no dispara eventos de input del escáner HID; `readOnly` sí |
| Sesión de ronda con TTL de turno (8h) en BD | Solo en memoria del cliente | Tolerancia a crashes/refreshes; auditoría de sesión |

---

## Capacidad Estimada

| Sprint (2 semanas) | Secciones | US | SP |
|---|---|---|---|
| Sprint 1 | Sección 1 (catálogos) + US.F2.6.6-7 | 7 | 57 |
| Sprint 2 | US.F2.6.8-15 (Proceso D core) | 8 | 52 |
| Sprint 3 | US.F2.6.16-20 + US.F2.6.21-23 (Proceso E core) | 8 | 59 |
| Sprint 4 | US.F2.6.24-32 (confirmación + eMAR + multi-med) | 9 | 55 |
| Sprint 5 | Sección 4 (hardware) + US.F2.6.33-40 | 11 | 55 |
| Sprint 6 | Sección 5 (modos especiales) | 7 | 42 |
| Sprint 7 | Sección 6 (EPCIS + farmacovigilancia) | 6 | 34 |
| Holgura / bugs / refinement | — | 2 | ~10 |
| **TOTAL** | | **58 US** | **~364 SP** |

> Capacidad asumida: equipo de 4 desarrolladores, velocidad ~55 SP/sprint. Ajustar según velocidad real del equipo en Sprint 1.

---

*Documento generado por @PO — Chief Product Officer, Inversiones Avante. Insumos: `guia_trazabilidad_hospitalaria_gs1.md` §1, §2.4, §2.5, §3, §4.2; `analisis_workflows_ece.md` §A.8, §B.5, §3.6, §3.7; CLAUDE.md Beta.2 pharmacy, Beta.7/8 eMAR, Beta.15 outbox. Versión 1.0 — 2026-05-16.*
