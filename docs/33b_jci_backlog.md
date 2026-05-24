El archivo `docs/32_gap_jci_assessment.md` no existe en el worktree. Tengo el contexto suficiente del TDR y la arquitectura existente para producir el backlog JCI completo con base en los estándares JCI 7a edición (capítulos PCI, PFE, QPS, SQE, IPSG, PFR, COP, MMU). Procedo.

---

# Epicas JCI

## Sección: Epicas JCI (para `docs/33b_jci_backlog.md` § Epicas)

```markdown
# Épicas JCI — HIS Multipaís Avante

**Marco:** JCI 7a edición (Hospital Accreditation Standards)
**Roadmap:** 3 fases (JCI-1 / JCI-2 / JCI-3) | ~770 SP estimados
**Priorización:** WSJF escala 1-10 (Cost of Delay / Job Size)
**Trazabilidad:** cada épica mapea a ≥1 capítulo JCI

---

## Tabla resumen de épicas

| ID | Nombre | Cap. JCI | MoSCoW | SP | Sprint | WSJF |
|----|--------|----------|--------|----|--------|------|
| JCI-E-01 | Control de infecciones — vigilancia y reporte | PCI.5, PCI.6 | Must | 55 | JCI-1 Sprint 1-2 | 9.2 |
| JCI-E-02 | Educación al paciente y familia | PFE.1–PFE.4 | Must | 42 | JCI-1 Sprint 1-2 | 8.8 |
| JCI-E-03 | Dashboard QPS y métricas de calidad | QPS.4, QPS.7 | Must | 63 | JCI-1 Sprint 2-3 | 8.5 |
| JCI-E-04 | Credencialización y privilegios clínicos | SQE.9–SQE.12 | Must | 55 | JCI-1 Sprint 1-3 | 9.0 |
| JCI-E-05 | Metas internacionales de seguridad (IPSG.1-6) | IPSG.1–IPSG.6 | Must | 89 | JCI-1 Sprint 1-3 | 9.5 |
| JCI-E-06 | Derechos del paciente y consentimiento informado | PFR.2, PFR.3, PFR.5 | Must | 34 | JCI-1 Sprint 2 | 8.1 |
| JCI-E-07 | Gestión y uso de medicamentos — trazabilidad completa | MMU.4, MMU.5, MMU.7 | Must | 55 | JCI-1 Sprint 2-3 | 8.7 |
| JCI-E-08 | Continuidad asistencial y plan de alta | COP.2, COP.3, COP.8 | Should | 42 | JCI-2 Sprint 4-5 | 7.2 |
| JCI-E-09 | Gestión de riesgo clínico y reporte de eventos adversos | QPS.8, QPS.11 | Must | 47 | JCI-1 Sprint 3 | 8.3 |
| JCI-E-10 | Higiene de manos — cumplimiento y auditoría digital | PCI.9 | Should | 21 | JCI-2 Sprint 4 | 6.5 |
| JCI-E-11 | Evaluación inicial y revaloración estructurada | COP.1, COP.2.1 | Must | 42 | JCI-1 Sprint 2-3 | 7.8 |
| JCI-E-12 | Gestión de equipamiento y mantenimiento preventivo | FMS.8 | Should | 34 | JCI-2 Sprint 5 | 6.0 |
| JCI-E-13 | Capacitación y competencia del personal | SQE.3, SQE.8 | Should | 34 | JCI-2 Sprint 4-5 | 6.8 |
| JCI-E-14 | Vigilancia epidemiológica — reportes automatizados | PCI.6, QPS.4 | Must | 42 | JCI-1 Sprint 2-3 | 8.0 |
| JCI-E-15 | Gestión documental y control de políticas | GLD.11 | Could | 21 | JCI-3 Sprint 6 | 4.5 |
| JCI-E-16 | Seguridad quirúrgica — checklist OMS digital | IPSG.4, COP.6 | Must | 34 | JCI-1 Sprint 2 | 9.1 |
| JCI-E-17 | Laboratorio: manejo de muestras y resultados críticos | COP.7, IPSG.2 | Should | 34 | JCI-2 Sprint 4 | 7.0 |
| JCI-E-18 | Comunicación de resultados — cierre del loop clínico | IPSG.2, COP.7 | Should | 21 | JCI-2 Sprint 5 | 6.9 |
| JCI-E-19 | Preparación para emergencias y continuidad | FMS.6 | Could | 21 | JCI-3 Sprint 7 | 4.2 |
| JCI-E-20 | Satisfacción del paciente — encuestas y cierre | PFR.1, QPS.6 | Could | 21 | JCI-3 Sprint 7 | 4.0 |

**Total estimado: 807 SP** (margen ±15% para refinement de detalle)

---

## Detalle de épicas por fase

### JCI-E-01 — Control de infecciones: vigilancia y reporte (PCI.5, PCI.6)

**Valor de negocio:** Acreditación JCI exige programa de prevención y control de infecciones (PCI) con vigilancia activa, tasas de infección y reporte a dirección. Sin esto, el capítulo PCI falla completo — bloquea toda la acreditación.
**ROI cuantitativo:** Reducción del 20-30% en IH (infecciones hospitalarias) equivale a ~$800K anuales en estancias evitadas (benchmark LAC).
**WSJF:** Cost of Delay=9 (bloqueante acreditación) / Job Size=1 → WSJF=9.2
**MoSCoW:** Must | **SP:** 55 | **Sprint:** JCI-1 S1-S2

---

### JCI-E-02 — Educación al paciente y familia (PFE.1–PFE.4)

**Valor de negocio:** JCI exige documentar que el paciente y su familia recibieron educación sobre su condición, medicamentos y plan de alta en su idioma y nivel de alfabetización. Sin registro digital, los ME (Measurable Elements) fallan.
**ROI cuantitativo:** Reducción readmisiones 15% → ahorro directo en costos hospitalarios.
**WSJF:** Cost of Delay=8 / Job Size=0.9 → WSJF=8.8
**MoSCoW:** Must | **SP:** 42 | **Sprint:** JCI-1 S1-S2

---

### JCI-E-03 — Dashboard QPS y métricas de calidad (QPS.4, QPS.7)

**Valor de negocio:** QPS exige que la dirección reciba datos de calidad estructurados, comparables y tendenciales. El sistema debe generar indicadores automáticos, no manuales.
**ROI cuantitativo:** Eliminación de horas/mes de recopilación manual (~40 h/mes a $45/h = $1,800/mes).
**WSJF:** Cost of Delay=8.5 / Job Size=1 → WSJF=8.5
**MoSCoW:** Must | **SP:** 63 | **Sprint:** JCI-1 S2-S3

---

### JCI-E-04 — Credencialización y privilegios clínicos (SQE.9–SQE.12)

**Valor de negocio:** JCI exige que solo personal con privilegios verificados y activos pueda realizar procedimientos. Implica mantener expediente de credenciales, renovaciones y suspensiones con trazabilidad completa.
**ROI cuantitativo:** Elimina riesgo legal de procedimientos por personal sin habilitación activa.
**WSJF:** Cost of Delay=9 / Job Size=1 → WSJF=9.0
**MoSCoW:** Must | **SP:** 55 | **Sprint:** JCI-1 S1-S3

---

### JCI-E-05 — Metas internacionales de seguridad IPSG.1-6 (IPSG.1–IPSG.6)

**Valor de negocio:** Las 6 IPSG son requisito no negociable de JCI: identificación correcta, comunicación efectiva, medicamentos de alto riesgo, cirugía segura, higiene de manos, prevención de caídas. Fallo en una sola IPSG = fallo del capítulo completo.
**ROI cuantitativo:** Prevención de un solo evento centinela evita costos medico-legales de $500K+ y daño reputacional.
**WSJF:** Cost of Delay=10 / Job Size=1.05 → WSJF=9.5
**MoSCoW:** Must | **SP:** 89 | **Sprint:** JCI-1 S1-S3

---

### JCI-E-06 — Derechos del paciente y consentimiento informado (PFR.2, PFR.3, PFR.5)

**Valor de negocio:** JCI exige registro de que el paciente fue informado de sus derechos, de los riesgos de su tratamiento y que consintió de forma documentada. El consentimiento debe ser trazable, revocable y respetar capacidad de decisión.
**WSJF:** Cost of Delay=8 / Job Size=0.99 → WSJF=8.1
**MoSCoW:** Must | **SP:** 34 | **Sprint:** JCI-1 S2

---

### JCI-E-07 — Gestión y uso de medicamentos — trazabilidad completa (MMU.4, MMU.5, MMU.7)

**Valor de negocio:** MMU exige orden → validación farmacéutica → preparación → administración → registro, con alertas de interacción y doble verificación para medicamentos de alto riesgo. Gaps en la cadena = hallazgo mayor JCI.
**WSJF:** Cost of Delay=9 / Job Size=1.03 → WSJF=8.7
**MoSCoW:** Must | **SP:** 55 | **Sprint:** JCI-1 S2-S3

---

### JCI-E-08 — Continuidad asistencial y plan de alta (COP.2, COP.3, COP.8)

**Valor de negocio:** JCI exige plan de alta documentado desde el ingreso, con instrucciones al paciente, coordinación entre servicios y gestión de la transición de cuidado.
**WSJF:** Cost of Delay=7 / Job Size=0.97 → WSJF=7.2
**MoSCoW:** Should | **SP:** 42 | **Sprint:** JCI-2 S4-S5

---

### JCI-E-09 — Gestión de riesgo clínico y reporte de eventos adversos (QPS.8, QPS.11)

**Valor de negocio:** JCI exige sistema de reporte de eventos adversos, near misses y eventos centinela, con análisis de causa raíz y plan de mejora documentado.
**WSJF:** Cost of Delay=8.5 / Job Size=1.02 → WSJF=8.3
**MoSCoW:** Must | **SP:** 47 | **Sprint:** JCI-1 S3

---

### JCI-E-10 — Higiene de manos: cumplimiento y auditoría digital (PCI.9)

**Valor de negocio:** PCI.9 ME 1-3 exige programa de higiene de manos con observación, indicadores de cumplimiento y mejora continua. Auditoría manual es costosa; captura digital habilita benchmarking.
**WSJF:** Cost of Delay=6.5 / Job Size=1 → WSJF=6.5
**MoSCoW:** Should | **SP:** 21 | **Sprint:** JCI-2 S4

---

### JCI-E-11 — Evaluación inicial y revaloración estructurada (COP.1, COP.2.1)

**Valor de negocio:** JCI exige evaluación inicial dentro de marcos de tiempo definidos según tipo de paciente y revaloración documentada con cambios en estado. Sin estructura en HIS, es imposible demostrar cumplimiento a evaluador.
**WSJF:** Cost of Delay=8 / Job Size=1.02 → WSJF=7.8
**MoSCoW:** Must | **SP:** 42 | **Sprint:** JCI-1 S2-S3

---

### JCI-E-12 — Gestión de equipamiento y mantenimiento preventivo (FMS.8)

**Valor de negocio:** FMS.8 exige programa de mantenimiento preventivo con registros de calibración y alertas de vencimiento. Dato ya existe parcialmente en módulo BiomedicalEquipment — extender, no duplicar.
**WSJF:** Cost of Delay=6 / Job Size=1 → WSJF=6.0
**MoSCoW:** Should | **SP:** 34 | **Sprint:** JCI-2 S5

---

### JCI-E-13 — Capacitación y competencia del personal (SQE.3, SQE.8)

**Valor de negocio:** SQE exige registro de orientación, capacitación continua y evaluación de competencias del personal clínico. Genera evidencia para el evaluador JCI.
**WSJF:** Cost of Delay=7 / Job Size=1.03 → WSJF=6.8
**MoSCoW:** Should | **SP:** 34 | **Sprint:** JCI-2 S4-S5

---

### JCI-E-14 — Vigilancia epidemiológica: reportes automatizados (PCI.6, QPS.4)

**Valor de negocio:** JCI + MINSAL exigen reportes periódicos de tasas de infección por servicio, con comparación vs benchmarks nacionales/internacionales.
**WSJF:** Cost of Delay=8 / Job Size=1 → WSJF=8.0
**MoSCoW:** Must | **SP:** 42 | **Sprint:** JCI-1 S2-S3

---

### JCI-E-15 — Gestión documental y control de políticas (GLD.11)

**Valor de negocio:** GLD.11 exige que las políticas y procedimientos del hospital estén aprobados, vigentes y accesibles. Sistema de versionado y control de acceso.
**WSJF:** Cost of Delay=4.5 / Job Size=1 → WSJF=4.5
**MoSCoW:** Could | **SP:** 21 | **Sprint:** JCI-3 S6

---

### JCI-E-16 — Seguridad quirúrgica: checklist OMS digital (IPSG.4, COP.6)

**Valor de negocio:** IPSG.4 ME 1-3 exige verificación de sitio/paciente/procedimiento antes de cirugía. La firma del checklist OMS debe ser digital, trazable y no saltable.
**WSJF:** Cost of Delay=10 / Job Size=1.1 → WSJF=9.1
**MoSCoW:** Must | **SP:** 34 | **Sprint:** JCI-1 S2

---

### JCI-E-17 — Laboratorio: manejo de muestras y resultados críticos (COP.7, IPSG.2)

**Valor de negocio:** COP.7 exige que resultados de laboratorio críticos lleguen al médico tratante dentro de tiempos definidos y con acuse de recibo documentado.
**WSJF:** Cost of Delay=7 / Job Size=1 → WSJF=7.0
**MoSCoW:** Should | **SP:** 34 | **Sprint:** JCI-2 S4

---

### JCI-E-18 — Comunicación de resultados: cierre del loop clínico (IPSG.2, COP.7)

**Valor de negocio:** IPSG.2 ME 2 exige documentar la lectura y respuesta del médico a valores críticos. Sin registro digital del "acknowledge", el ME falla.
**WSJF:** Cost of Delay=7 / Job Size=1.01 → WSJF=6.9
**MoSCoW:** Should | **SP:** 21 | **Sprint:** JCI-2 S5

---

### JCI-E-19 — Preparación para emergencias y continuidad (FMS.6)

**Valor de negocio:** FMS.6 exige plan de respuesta a desastres con ejercicios documentados. Aplica a disponibilidad del HIS como servicio crítico.
**WSJF:** Cost of Delay=4.5 / Job Size=1.07 → WSJF=4.2
**MoSCoW:** Could | **SP:** 21 | **Sprint:** JCI-3 S7

---

### JCI-E-20 — Satisfacción del paciente: encuestas y cierre (PFR.1, QPS.6)

**Valor de negocio:** JCI exige medir la experiencia del paciente de forma sistemática. Las métricas alimentan el dashboard QPS.
**WSJF:** Cost of Delay=4 / Job Size=1 → WSJF=4.0
**MoSCoW:** Could | **SP:** 21 | **Sprint:** JCI-3 S7
```

---

# Historias de usuario JCI

## Sección: Historias de usuario JCI (para `docs/33b_jci_backlog.md` § US)

```markdown
# Historias de usuario — Fase JCI

**Convención de estimación:** Fibonacci 1/2/3/5/8/13/21
**Criterios de aceptación:** Gherkin mínimo 3 escenarios por US
**DoD:** implementado + pruebas verdes + coverage ≥80% + trazabilidad JCI documentada

---

## JCI-E-01 — Control de infecciones (PCI.5, PCI.6)

### US.JCI.1.1 — Registro de caso de infección asociada a atención sanitaria

**Como** enfermera de epidemiología
**quiero** registrar un caso de IAAS (infección asociada a la atención en salud) vinculado a un ingreso
**para** que el sistema acumule datos de vigilancia activa por servicio y organismo causal.

**SP:** 8 | **Trazabilidad:** JCI-7 PCI.5 ME 1, PCI.6 ME 1 | **Deps:** ninguna

**Criterios de aceptación:**
```gherkin
Escenario: Registro de IAAS con organismo y servicio
  Dado que estoy en el módulo de Control de Infecciones
  Y tengo un ingreso activo con ID "ADM-2026-001"
  Cuando registro una IAAS con organismo "Klebsiella pneumoniae", tipo "ITU-asociada-a-catéter", servicio "UCI"
  Entonces el sistema almacena el caso con fecha, turno y usuario registrador
  Y el caso aparece en el tablero de vigilancia del servicio

Escenario: Validación de campos obligatorios
  Dado que estoy registrando una IAAS
  Cuando omito el organismo causal
  Entonces el formulario muestra el error "Organismo causal es obligatorio (PCI.5 ME 1)"
  Y el registro no se guarda

Escenario: Trazabilidad de auditoría
  Dado que un caso de IAAS fue registrado
  Cuando el director de calidad consulta el log de auditoría
  Entonces ve usuario, timestamp y hash del registro sin posibilidad de edición retroactiva
```

---

### US.JCI.1.2 — Tablero de tasas de infección por servicio

**Como** directora de calidad
**quiero** ver tasas de IAAS por servicio (UCI, Medicina, Cirugía) en tiempo real
**para** identificar tendencias y alertas de umbral que requieren intervención.

**SP:** 8 | **Trazabilidad:** JCI-7 PCI.6 ME 2, QPS.4 ME 1 | **Deps:** US.JCI.1.1

**Criterios de aceptación:**
```gherkin
Escenario: Visualización de tasa por 1,000 días-paciente
  Dado que hay casos IAAS registrados en el mes actual
  Cuando accedo al tablero de infecciones
  Entonces veo la tasa calculada como (casos/días-paciente)*1000 por servicio
  Y el dato se actualiza al ingresar nuevos casos sin recarga manual

Escenario: Alerta de umbral superado
  Dado que la tasa de ITU-UC en UCI supera 2.5 x 1,000 días-catéter
  Cuando el sistema calcula el indicador diario
  Entonces genera una alerta visible al director de calidad y jefe de UCI
  Y la alerta queda registrada en el log de eventos de calidad

Escenario: Comparación histórica
  Dado que tengo datos de los últimos 12 meses
  Cuando selecciono un rango de fechas
  Entonces el tablero muestra la tendencia mensual en gráfico de líneas
  Y permite exportar a CSV para reporte JCI
```

---

### US.JCI.1.3 — Reporte periódico de PCI a dirección

**Como** comité de infecciones
**quiero** generar un reporte mensual de indicadores PCI listo para dirección
**para** cumplir la obligación de reporte periódico documentada en PCI.6 ME 3.

**SP:** 5 | **Trazabilidad:** JCI-7 PCI.6 ME 3 | **Deps:** US.JCI.1.2

**Criterios de aceptación:**
```gherkin
Escenario: Generación automática mensual
  Dado que es el primer día del mes siguiente al período
  Cuando el sistema ejecuta el reporte programado
  Entonces genera un PDF con indicadores de IAAS, tasas y tendencias del mes anterior
  Y lo deposita en la bandeja del director de calidad

Escenario: Firma digital del reporte
  Dado que el reporte fue generado
  Cuando la directora de calidad lo revisa y aprueba
  Entonces puede firmarlo electrónicamente con su credencial
  Y el reporte firmado queda inmutable en el historial

Escenario: Comparativa vs benchmarks
  Dado que el sistema tiene configurados benchmarks internacionales (NHSN/OPS)
  Cuando se genera el reporte
  Entonces incluye columna de comparación "hospital vs benchmark"
```

---

### US.JCI.1.4 — Protocolo de aislamiento desde ingreso

**Como** médico tratante
**quiero** activar un protocolo de aislamiento al momento del ingreso cuando hay sospecha de infección transmisible
**para** que enfermería y limpieza reciban la alerta de precauciones activa en tiempo real.

**SP:** 5 | **Trazabilidad:** JCI-7 PCI.5 ME 2 | **Deps:** ninguna (integra con ADT)

**Criterios de aceptación:**
```gherkin
Escenario: Activación de protocolo de aislamiento
  Dado que estoy en el registro de ingreso de un paciente
  Cuando activo "Precauciones por contacto" con motivo "sospecha SARM"
  Entonces la cama del paciente aparece marcada en el censo con ícono de aislamiento
  Y enfermería del servicio recibe notificación push

Escenario: Instrucciones de EPP visibles al personal
  Dado que una cama tiene protocolo de aislamiento activo
  Cuando enfermería accede al expediente del paciente
  Entonces ve un banner visible con el tipo de precaución y EPP requerido
  Y no puede ocultar el banner sin desactivar el protocolo

Escenario: Cierre del aislamiento con justificación
  Dado que el protocolo de aislamiento está activo
  Cuando el médico lo desactiva
  Entonces debe registrar el motivo del cierre (cultivo negativo, resolución clínica)
  Y el cierre queda auditado con usuario y timestamp
```

---

## JCI-E-02 — Educación al paciente y familia (PFE.1–PFE.4)

### US.JCI.2.1 — Registro de sesión educativa durante el ingreso

**Como** enfermera asistencial
**quiero** registrar la educación brindada al paciente y su familia durante la hospitalización
**para** documentar el cumplimiento del plan educativo y los temas cubiertos.

**SP:** 5 | **Trazabilidad:** JCI-7 PFE.2 ME 1, PFE.3 ME 1 | **Deps:** ninguna

**Criterios de aceptación:**
```gherkin
Escenario: Registro de sesión educativa con temas
  Dado que tengo un paciente ingresado
  Cuando registro una sesión educativa seleccionando temas "medicamentos", "dieta", "señales de alarma"
  Entonces el sistema guarda la sesión con fecha, hora, educador y participantes (paciente, familiar)
  Y el tema queda vinculado al ingreso activo

Escenario: Evaluación de comprensión del paciente
  Dado que registré una sesión educativa
  Cuando registro la evaluación de comprensión como "parcial — barrera de idioma"
  Entonces el sistema marca el tema como "requiere refuerzo"
  Y aparece en la lista de tareas pendientes del turno siguiente

Escenario: No edición retroactiva
  Dado que una sesión fue registrada hace más de 24 horas
  Cuando intento modificar el contenido de la sesión
  Entonces el sistema deniega la edición y muestra "registro inmutable por auditoría JCI"
```

---

### US.JCI.2.2 — Evaluación de necesidades educativas al ingreso

**Como** médico tratante
**quiero** completar la evaluación de necesidades educativas del paciente al ingreso
**para** personalizar el plan educativo según alfabetización, idioma y capacidad de aprendizaje.

**SP:** 5 | **Trazabilidad:** JCI-7 PFE.1 ME 1-2 | **Deps:** ninguna

**Criterios de aceptación:**
```gherkin
Escenario: Formulario de evaluación educativa estructurado
  Dado que ingreso un nuevo paciente
  Cuando completo la evaluación de necesidades educativas
  Entonces capturo idioma preferido, nivel de alfabetización, barreras (visual, auditiva, cognitiva) y preferencia de aprendizaje
  Y los datos quedan vinculados al encuentro activo

Escenario: Alerta cuando hay barreras identificadas
  Dado que el paciente tiene barrera de idioma "no habla español"
  Cuando se activa el plan de hospitalización
  Entonces el sistema genera una tarea para coordinar intérprete antes de la primera sesión educativa
  Y la tarea aparece en la bandeja del jefe de servicio

Escenario: Completitud obligatoria antes de alta
  Dado que un paciente está marcado para alta
  Cuando la evaluación educativa no ha sido completada
  Entonces el sistema bloquea la generación de la orden de alta y muestra el aviso "PFE.1: evaluación educativa pendiente"
```

---

### US.JCI.2.3 — Instrucciones de alta documentadas y entregadas

**Como** médico tratante
**quiero** registrar las instrucciones de alta brindadas al paciente en forma estructurada
**para** cumplir con PFE.4 y demostrar al evaluador JCI que el paciente egresó informado.

**SP:** 5 | **Trazabilidad:** JCI-7 PFE.4 ME 1-3 | **Deps:** US.JCI.2.2

**Criterios de aceptación:**
```gherkin
Escenario: Documento de instrucciones de alta estructurado
  Dado que estoy generando el alta de un paciente
  Cuando completo las instrucciones de alta (medicamentos, seguimiento, señales de alarma, dieta, actividad)
  Entonces el sistema genera un PDF en el idioma preferido del paciente
  Y requiere la firma del paciente o familiar responsable para completar el alta

Escenario: Registro de entrega al paciente
  Dado que el documento fue impreso o enviado digitalmente
  Cuando el paciente o familiar firma la recepción
  Entonces el sistema registra "instrucciones recibidas" con timestamp y firmante
  Y el documento firmado queda en el expediente digital con hash de integridad

Escenario: Copia para seguimiento ambulatorio
  Dado que las instrucciones de alta incluyen cita de seguimiento
  Cuando se completa el proceso de alta
  Entonces el sistema agenda automáticamente la cita en el módulo de consulta externa
```

---

## JCI-E-03 — Dashboard QPS y métricas de calidad (QPS.4, QPS.7)

### US.JCI.3.1 — Indicadores clave de calidad configurables

**Como** director de calidad
**quiero** configurar los indicadores de calidad hospitalaria que se monitorean de forma continua
**para** alinear el dashboard con los requisitos de QPS.4 y los estándares locales.

**SP:** 8 | **Trazabilidad:** JCI-7 QPS.4 ME 1-3 | **Deps:** US.JCI.9.1

**Criterios de aceptación:**
```gherkin
Escenario: Alta de indicador nuevo
  Dado que estoy en el módulo de gestión de calidad
  Cuando creo un indicador "Tasa de LWBS en emergencias" con numerador, denominador, meta y umbral de alerta
  Entonces el indicador aparece en el dashboard con su baseline inicial en cero
  Y genera alertas cuando el valor supera el umbral configurado

Escenario: Indicadores mínimos JCI precargados
  Dado que el sistema fue instalado en una organización nueva
  Cuando accedo al catálogo de indicadores
  Entonces encuentro al menos los 11 indicadores de la biblioteca JCI (IPSG, PCI, COP, MMU, QPS) precargados
  Y puedo activarlos o desactivarlos según el perfil del hospital

Escenario: Exportación para informe JCI
  Dado que tengo datos de indicadores del trimestre
  Cuando genero el reporte para evaluación JCI
  Entonces el sistema produce un documento con formato compatible con la matriz de datos JCI (ORYX-compatible)
```

---

### US.JCI.3.2 — Panel ejecutivo de calidad para dirección

**Como** director médico
**quiero** ver un panel de calidad consolidado con los indicadores más críticos en una sola vista
**para** tomar decisiones de mejora sin necesidad de generar reportes manuales.

**SP:** 8 | **Trazabilidad:** JCI-7 QPS.7 ME 1-2 | **Deps:** US.JCI.3.1

**Criterios de aceptación:**
```gherkin
Escenario: Panel con semáforo de estado
  Dado que accedo como director médico
  Cuando abro el dashboard de calidad
  Entonces veo todos los indicadores activos con semáforo (verde/amarillo/rojo) según umbrales configurados
  Y puedo navegar al detalle de cualquier indicador con un clic

Escenario: Comparativa entre servicios
  Dado que hay datos de múltiples servicios
  Cuando selecciono "comparar servicios" en un indicador
  Entonces el sistema muestra un ranking de servicios para ese indicador
  Y resalta el servicio con el peor y mejor desempeño

Escenario: Exportación a presentación
  Dado que debo presentar indicadores al comité mensual
  Cuando exporto el panel
  Entonces el sistema genera un PDF con gráficos y tablas listos para presentación ejecutiva
```

---

### US.JCI.3.3 — Análisis de tendencias de indicadores de calidad

**Como** coordinador de mejora continua
**quiero** ver la tendencia mensual de cada indicador con control estadístico
**para** identificar variaciones especiales que requieren acción inmediata vs variación común.

**SP:** 8 | **Trazabilidad:** JCI-7 QPS.4 ME 3, QPS.7 ME 3 | **Deps:** US.JCI.3.2

**Criterios de aceptación:**
```gherkin
Escenario: Gráfico de control con límites UCL/LCL
  Dado que tengo datos de un indicador por ≥12 meses
  Cuando visualizo el análisis de tendencia
  Entonces el sistema muestra un gráfico de control con línea central, UCL y LCL calculados estadísticamente
  Y marca con punto rojo los meses fuera de control

Escenario: Notificación de punto fuera de control
  Dado que un indicador tiene un valor fuera de los límites de control
  Cuando el sistema lo detecta
  Entonces notifica al director de calidad y al jefe del servicio afectado
  Y abre automáticamente un registro de análisis de causa raíz vinculado

Escenario: Filtrado por período y organización
  Dado que el sistema es multi-organización
  Cuando selecciono una organización y rango de fechas
  Entonces los cálculos son exclusivos de esa organización y período
  Y respetan el aislamiento multi-tenant por RLS
```

---

### US.JCI.3.4 — Reuniones de revisión de calidad documentadas

**Como** secretaria del comité de calidad
**quiero** registrar las actas de revisión de calidad con compromisos y seguimiento
**para** tener evidencia documentada de que la dirección revisa los indicadores (QPS.7 ME 2).

**SP:** 5 | **Trazabilidad:** JCI-7 QPS.7 ME 2 | **Deps:** US.JCI.3.2

**Criterios de aceptación:**
```gherkin
Escenario: Creación de acta de reunión de calidad
  Dado que celebré una reunión de comité de calidad
  Cuando registro el acta con asistentes, indicadores revisados y compromisos
  Entonces el sistema genera el acta con numeración correlativa y fecha
  Y los asistentes pueden firmar electrónicamente desde sus perfiles

Escenario: Seguimiento de compromisos
  Dado que se registraron compromisos en el acta
  Cuando llega la fecha de vencimiento de un compromiso
  Entonces el responsable recibe una notificación de seguimiento
  Y el estado del compromiso (pendiente/cumplido/vencido) es visible en el próximo acta

Escenario: Historial de actas accesible para evaluador JCI
  Dado que el evaluador JCI solicita evidencia de revisión de calidad
  Cuando el director de calidad accede al historial
  Entonces puede mostrar todas las actas de los últimos 12 meses con firmas digitales verificables
```

---

## JCI-E-04 — Credencialización y privilegios clínicos (SQE.9–SQE.12)

### US.JCI.4.1 — Expediente digital de credenciales del personal clínico

**Como** jefe de recursos humanos clínicos
**quiero** mantener el expediente digital de credenciales de cada profesional (título, especialización, licencia vigente, capacitaciones)
**para** que el sistema valide automáticamente que solo personal habilitado realice procedimientos.

**SP:** 8 | **Trazabilidad:** JCI-7 SQE.9 ME 1-2, SQE.10 ME 1 | **Deps:** ninguna

**Criterios de aceptación:**
```gherkin
Escenario: Carga de credenciales con fecha de vencimiento
  Dado que estoy en el expediente del personal clínico
  Cuando cargo una credencial (licencia médica, especialización) con fecha de vencimiento
  Entonces el sistema la almacena con documento adjunto y genera alerta 90 días antes del vencimiento
  Y el estado de la credencial es visible en el perfil del profesional

Escenario: Bloqueo de acceso por credencial vencida
  Dado que la licencia de un médico venció hace 5 días
  Cuando intenta generar una prescripción
  Entonces el sistema bloquea la acción y muestra "Credencial vencida — contacte a RRHH Clínicos"
  Y registra el intento bloqueado en el log de auditoría

Escenario: Renovación asistida de credenciales
  Dado que una credencial está próxima a vencer
  Cuando RRHH clínicos carga el documento de renovación
  Entonces el sistema actualiza la fecha de vencimiento y cierra la alerta pendiente
  Y notifica al jefe del servicio que la credencial fue renovada
```

---

### US.JCI.4.2 — Gestión de privilegios clínicos por procedimiento

**Como** director médico
**quiero** definir y asignar privilegios clínicos específicos a cada profesional (qué procedimientos puede realizar)
**para** cumplir SQE.10 y garantizar que ningún procedimiento sea realizado por personal sin el privilegio correspondiente.

**SP:** 8 | **Trazabilidad:** JCI-7 SQE.10 ME 1-3 | **Deps:** US.JCI.4.1

**Criterios de aceptación:**
```gherkin
Escenario: Asignación de privilegio a profesional
  Dado que el comité de credenciales aprobó un privilegio
  Cuando el director médico asigna "cirugía laparoscópica" al Dr. García
  Entonces el privilegio queda activo con fecha de inicio, vigencia y criterios de renovación
  Y el sistema valida el privilegio cuando el Dr. García registra ese tipo de procedimiento

Escenario: Privilegio no asignado bloquea el procedimiento
  Dado que una enfermera intenta registrar una transfusión sin el privilegio correspondiente
  Cuando envía el formulario
  Entonces el sistema deniega el registro y muestra "Privilegio requerido: Transfusión de hemoderivados"
  Y sugiere al jefe de servicio aprobar el privilegio si procede

Escenario: Revisión periódica de privilegios
  Dado que los privilegios tienen período de validez de 2 años
  Cuando el sistema detecta un privilegio a 60 días de vencer
  Entonces notifica al director médico y al jefe del servicio
  Y genera una tarea de revisión en la bandeja del comité de credenciales
```

---

### US.JCI.4.3 — Reporte de credenciales para evaluación JCI

**Como** director de calidad
**quiero** generar un reporte completo del estado de credenciales y privilegios de todo el personal clínico
**para** presentar evidencia de cumplimiento SQE al evaluador JCI.

**SP:** 5 | **Trazabilidad:** JCI-7 SQE.11 ME 1, SQE.12 ME 1 | **Deps:** US.JCI.4.1, US.JCI.4.2

**Criterios de aceptación:**
```gherkin
Escenario: Reporte de estado de credenciales
  Dado que solicito el reporte de credenciales
  Cuando el sistema lo genera
  Entonces muestra para cada profesional: nombre, cargo, credenciales vigentes, credenciales vencidas y privilegios activos
  Y exporta en PDF y Excel

Escenario: Filtro por servicio y estado
  Dado que necesito verificar solo el servicio de UCI
  Cuando aplico el filtro "Servicio: UCI"
  Entonces el reporte muestra solo el personal asignado a UCI con su estado de credenciales

Escenario: Tasa de cumplimiento de credencialización
  Dado que el reporte fue generado
  Cuando selecciono la vista de resumen
  Entonces veo el porcentaje de personal con credenciales 100% vigentes vs total del personal clínico activo
```

---

## JCI-E-05 — Metas internacionales de seguridad IPSG.1-6

### US.JCI.5.1 — Identificación correcta del paciente con doble verificador (IPSG.1)

**Como** enfermera asistencial
**quiero** que el sistema exija verificar la identidad del paciente con al menos 2 identificadores antes de cualquier procedimiento
**para** eliminar errores de identificación en medicación, transfusiones y cirugías.

**SP:** 8 | **Trazabilidad:** JCI-7 IPSG.1 ME 1-2 | **Deps:** ninguna

**Criterios de aceptación:**
```gherkin
Escenario: Doble verificación antes de administrar medicamento
  Dado que voy a administrar un medicamento
  Cuando inicio el proceso en eMAR
  Entonces el sistema solicita escanear la pulsera del paciente y confirmar visualmente un segundo identificador (nombre o fecha de nacimiento)
  Y no permite continuar hasta que ambos identificadores coincidan con el registro

Escenario: Alerta de discrepancia de identificación
  Dado que escaneo la pulsera de un paciente
  Cuando el código de barras no coincide con el paciente en la cama asignada
  Entonces el sistema genera una alerta roja "Posible error de identificación — verificar con supervisor"
  Y registra el incidente en el log de seguridad del paciente

Escenario: Registro de verificación exitosa
  Dado que la identificación fue verificada correctamente
  Cuando procedo con el procedimiento
  Entonces el sistema registra automáticamente "identificación verificada" con timestamp y usuario en el registro de administración
```

---

### US.JCI.5.2 — Comunicación efectiva de resultados críticos (IPSG.2)

**Como** técnico de laboratorio
**quiero** registrar y notificar un valor crítico de laboratorio al médico tratante dentro del tiempo definido
**para** cerrar el loop de comunicación requerido por IPSG.2.

**SP:** 8 | **Trazabilidad:** JCI-7 IPSG.2 ME 1-3 | **Deps:** US.JCI.17.1

**Criterios de aceptación:**
```gherkin
Escenario: Notificación automática de valor crítico
  Dado que registro un resultado de potasio 6.8 mEq/L (valor crítico)
  Cuando guardo el resultado en el sistema
  Entonces el sistema genera una alerta push al médico tratante y jefe de guardia
  Y inicia un temporizador de 15 minutos para el acuse de recibo

Escenario: Escalada cuando no hay acuse de recibo
  Dado que pasaron 15 minutos sin respuesta del médico tratante
  Cuando el temporizador expira
  Entonces el sistema escala la notificación al jefe de servicio y registra el escalamiento
  Y el médico tratante ya no puede ignorar la notificación sin justificación

Escenario: Registro del acuse de recibo
  Dado que el médico recibió la notificación de valor crítico
  Cuando confirma la recepción y registra la acción tomada
  Entonces el sistema cierra el loop con timestamp de acuse y acción documentada
  Y el registro es auditable para el evaluador JCI
```

---

### US.JCI.5.3 — Gestión de medicamentos de alto riesgo (IPSG.3)

**Como** farmacéutico clínico
**quiero** que los medicamentos de alto riesgo estén claramente identificados y con doble verificación obligatoria antes de su dispensación
**para** cumplir IPSG.3 y reducir errores en medicamentos centinela.

**SP:** 8 | **Trazabilidad:** JCI-7 IPSG.3 ME 1-3 | **Deps:** US.JCI.7.1

**Criterios de aceptación:**
```gherkin
Escenario: Catálogo de medicamentos de alto riesgo configurado
  Dado que accedo al catálogo de medicamentos
  Cuando busco "heparina sódica"
  Entonces el sistema lo muestra con etiqueta "ALTO RIESGO" visible y lista de precauciones obligatorias
  Y el catálogo incluye al menos los 10 medicamentos de la lista ISMP actualizados

Escenario: Doble verificación al dispensar
  Dado que un farmacéutico va a dispensar insulina (alto riesgo)
  Cuando procesa la orden de dispensación
  Entonces el sistema requiere la confirmación de un segundo farmacéutico o técnico calificado
  Y no permite continuar con una sola firma

Escenario: Alerta de concentración no estándar
  Dado que una prescripción indica una concentración no estándar de un medicamento de alto riesgo
  Cuando el farmacéutico procesa la orden
  Entonces el sistema muestra alerta "Concentración fuera de estándar — verificar con prescriptor"
  Y requiere confirmación explícita antes de continuar
```

---

### US.JCI.5.4 — Checklist de cirugía segura: tiempo fuera digital (IPSG.4)

**Como** instrumentista quirúrgico
**quiero** completar el checklist de cirugía segura OMS en el sistema antes de cualquier incisión
**para** documentar el "tiempo fuera" de forma trazable y cumplir IPSG.4.

**SP:** 8 | **Trazabilidad:** JCI-7 IPSG.4 ME 1-3, COP.6 ME 2 | **Deps:** ninguna

**Criterios de aceptación:**
```gherkin
Escenario: Activación obligatoria del checklist antes de incisión
  Dado que una cirugía está programada y el paciente está en sala
  Cuando el anestesiólogo intenta registrar el inicio de la anestesia
  Entonces el sistema exige completar la fase "Sign In" del checklist OMS
  Y bloquea el avance hasta que todos los ítems obligatorios estén marcados

Escenario: Registro del "Time Out" con firmas del equipo
  Dado que el equipo completó la fase preoperatoria
  Cuando se ejecuta el Time Out antes de la incisión
  Entonces el sistema registra: paciente, sitio quirúrgico, procedimiento, alergias y confirmación del equipo
  Y cada miembro del equipo firma electrónicamente su participación en el Time Out

Escenario: Intento de saltarse el checklist
  Dado que el anestesiólogo intenta iniciar sin completar el checklist
  Cuando hace clic en "Iniciar cirugía"
  Entonces el sistema deniega la acción y registra el intento como incidente de seguridad
  Y notifica al director quirúrgico
```

---

### US.JCI.5.5 — Evaluación de riesgo de caídas al ingreso (IPSG.6)

**Como** enfermera de admisión
**quiero** aplicar una escala de riesgo de caídas validada al ingresar a cada paciente
**para** activar las medidas preventivas correctas según el nivel de riesgo identificado.

**SP:** 5 | **Trazabilidad:** JCI-7 IPSG.6 ME 1-2 | **Deps:** ninguna

**Criterios de aceptación:**
```gherkin
Escenario: Escala de riesgo de caídas al ingreso
  Dado que estoy registrando el ingreso de un paciente
  Cuando completo la escala Morse (o escala configurada por la organización)
  Entonces el sistema calcula automáticamente la puntuación y el nivel de riesgo (bajo/medio/alto)
  Y activa el plan de prevención correspondiente en el kardex de enfermería

Escenario: Medidas preventivas activadas automáticamente
  Dado que el paciente tiene riesgo alto de caídas (Morse ≥45)
  Cuando se guarda la evaluación
  Entonces el sistema activa automáticamente: "cama baja, barandales arriba, llamador al alcance, calzado antideslizante"
  Y las medidas aparecen como tareas pendientes en el kardex del turno actual

Escenario: Revaluación obligatoria ante cambio de condición
  Dado que el estado del paciente cambió (nueva medicación sedante)
  Cuando el médico registra el cambio
  Entonces el sistema genera una tarea de revaluación del riesgo de caídas para enfermería
  Y el resultado de la revaluación queda vinculado al evento desencadenante
```

---

### US.JCI.5.6 — Programa de higiene de manos con registro digital (IPSG.5)

**Como** coordinador de control de infecciones
**quiero** registrar las rondas de observación de higiene de manos
**para** calcular las tasas de cumplimiento requeridas por IPSG.5 y PCI.9.

**SP:** 5 | **Trazabilidad:** JCI-7 IPSG.5 ME 1-2, PCI.9 ME 2 | **Deps:** ninguna

**Criterios de aceptación:**
```gherkin
Escenario: Registro de ronda de observación
  Dado que realizo una ronda de observación de higiene de manos
  Cuando registro las oportunidades observadas y las que se realizaron correctamente
  Entonces el sistema calcula el porcentaje de cumplimiento de la ronda
  Y acumula los datos para el indicador mensual

Escenario: Tasa mensual de cumplimiento de higiene de manos
  Dado que el mes cerró con las rondas registradas
  Cuando el director de calidad consulta el indicador
  Entonces ve la tasa de cumplimiento global y por servicio
  Y el dato alimenta automáticamente el dashboard QPS (US.JCI.3.1)

Escenario: Meta de cumplimiento configurable
  Dado que la organización estableció meta de 85% de cumplimiento
  Cuando la tasa mensual cae por debajo del umbral
  Entonces el sistema genera alerta automática al director de calidad y jefe de servicio afectado
```

---

## JCI-E-06 — Derechos del paciente y consentimiento informado (PFR)

### US.JCI.6.1 — Notificación de derechos al ingreso

**Como** personal de admisión
**quiero** registrar que el paciente recibió y comprendió la carta de derechos del paciente al ingresar
**para** cumplir PFR.2 ME 1 y generar evidencia auditable.

**SP:** 3 | **Trazabilidad:** JCI-7 PFR.2 ME 1-2 | **Deps:** ninguna

**Criterios de aceptación:**
```gherkin
Escenario: Entrega y firma de carta de derechos
  Dado que estoy registrando la admisión de un paciente
  Cuando el paciente recibe la carta de derechos y firma la recepción
  Entonces el sistema registra la firma con timestamp y nombre del firmante (paciente o representante legal)
  Y el documento firmado queda en el expediente digital

Escenario: Idioma de la carta de derechos
  Dado que el paciente no habla español
  Cuando selecciono el idioma del paciente
  Entonces el sistema genera la carta en el idioma correspondiente (catálogo de idiomas configurables)
  Y registra el idioma utilizado en la entrega

Escenario: Obligatoriedad antes de atención electiva
  Dado que un paciente agendado para cirugía electiva no tiene la carta de derechos firmada
  Cuando el personal intenta confirmar la cirugía
  Entonces el sistema muestra advertencia "PFR.2: carta de derechos pendiente"
  Y requiere completarlo antes de confirmar el procedimiento
```

---

### US.JCI.6.2 — Consentimiento informado con proceso documentado

**Como** médico tratante
**quiero** registrar el proceso de consentimiento informado de procedimientos e intervenciones
**para** cumplir PFR.3 y garantizar que el paciente consintió con información suficiente.

**SP:** 8 | **Trazabilidad:** JCI-7 PFR.3 ME 1-4 | **Deps:** US.JCI.6.1

**Criterios de aceptación:**
```gherkin
Escenario: Registro del proceso de consentimiento
  Dado que voy a realizar una biopsia
  Cuando completo el formulario de consentimiento informado
  Entonces registro: procedimiento, riesgos explicados, alternativas presentadas, preguntas del paciente y decisión
  Y la información queda vinculada al encuentro activo

Escenario: Firma electrónica del paciente y del médico
  Dado que el proceso de consentimiento fue completado verbalmente
  Cuando el paciente y el médico firman electrónicamente
  Entonces el sistema genera el documento de consentimiento con ambas firmas y timestamp
  Y el documento es inmutable post-firma (ADR-0004)

Escenario: Revocación del consentimiento
  Dado que un paciente decide revocar su consentimiento antes del procedimiento
  Cuando el médico registra la revocación
  Entonces el sistema cancela el procedimiento vinculado y registra la revocación con motivo
  Y notifica al jefe de servicio y a enfermería del cambio
```

---

## JCI-E-07 — Gestión y uso de medicamentos (MMU.4, MMU.5, MMU.7)

### US.JCI.7.1 — Validación farmacéutica de órdenes de medicamento

**Como** farmacéutico clínico
**quiero** revisar y validar cada orden de medicamento antes de su preparación o dispensación
**para** detectar dosis incorrectas, alergias y duplicaciones antes de que lleguen al paciente.

**SP:** 8 | **Trazabilidad:** JCI-7 MMU.4 ME 1-3 | **Deps:** ninguna

**Criterios de aceptación:**
```gherkin
Escenario: Cola de validación farmacéutica
  Dado que un médico emite una orden de medicamento
  Cuando el farmacéutico abre la cola de validación
  Entonces ve la orden con diagnóstico, medicamento, dosis, vía y frecuencia
  Y puede aprobar, rechazar o solicitar aclaración al prescriptor

Escenario: Alerta automática de interacción medicamentosa
  Dado que el paciente tiene prescrito warfarina
  Cuando el médico prescribe ácido acetilsalicílico
  Entonces el sistema muestra automáticamente "Interacción grave: riesgo de sangrado elevado"
  Y el farmacéutico debe documentar su decisión (aprobar con justificación o rechazar)

Escenario: Alerta de alergia conocida
  Dado que el paciente tiene registrada alergia a penicilina
  Cuando el médico prescribe amoxicilina
  Entonces el sistema genera alerta bloqueante "Alergia registrada: familia betalactámicos"
  Y el prescriptor debe registrar la justificación clínica para sobrescribir la alerta
```

---

### US.JCI.7.2 — Registro de administración en eMAR con doble verificación

**Como** enfermera asistencial
**quiero** registrar la administración de medicamentos en el eMAR escaneando la pulsera del paciente y el código de barra del medicamento
**para** cumplir los 5 correctos y dejar trazabilidad completa requerida por MMU.7.

**SP:** 8 | **Trazabilidad:** JCI-7 MMU.7 ME 1-2, IPSG.1 ME 1 | **Deps:** US.JCI.5.1, US.JCI.7.1

**Criterios de aceptación:**
```gherkin
Escenario: Administración con escaneo de pulsera y medicamento
  Dado que voy a administrar metoprolol a un paciente
  Cuando escaneo la pulsera del paciente y el código GS1 del medicamento
  Entonces el sistema verifica: paciente correcto, medicamento correcto, dosis correcta, vía correcta, hora correcta
  Y permite registrar la administración solo si los 5 correctos son confirmados

Escenario: Discrepancia en verificación de 5 correctos
  Dado que escaneo un medicamento que no corresponde a la orden activa
  Cuando el sistema compara con la prescripción
  Entonces genera alerta "Medicamento no coincide con la orden — verificar"
  Y no permite registrar la administración

Escenario: Registro de medicamento no administrado con motivo
  Dado que el paciente rechazó tomar el medicamento
  Cuando registro "no administrado" en el eMAR
  Entonces debo seleccionar el motivo de la lista controlada (rechazo paciente, paciente en cirugía, vómito)
  Y el sistema notifica al médico tratante si el medicamento es crítico
```

---

## JCI-E-09 — Gestión de riesgo clínico y eventos adversos (QPS.8, QPS.11)

### US.JCI.9.1 — Reporte de evento adverso o near miss

**Como** cualquier profesional de salud
**quiero** reportar un evento adverso o near miss de forma anónima o nominal
**para** que el sistema de gestión de riesgo lo capture y active el proceso de análisis.

**SP:** 8 | **Trazabilidad:** JCI-7 QPS.8 ME 1-2 | **Deps:** ninguna

**Criterios de aceptación:**
```gherkin
Escenario: Reporte de near miss con formulario estandarizado
  Dado que ocurrió un near miss en la administración de medicamentos
  Cuando reporto el evento seleccionando categoría, descripción y contribuyentes
  Entonces el sistema crea el reporte con número correlativo y lo envía al comité de seguridad
  Y confirma al reportante que su reporte fue recibido

Escenario: Reporte anónimo habilitado
  Dado que un profesional prefiere reportar de forma anónima
  Cuando selecciona la opción de anonimato
  Entonces el sistema preserva el reporte sin vincular el usuario en el registro visible
  Y solo el administrador del sistema puede ver el remitente en auditoría técnica (no clínica)

Escenario: Clasificación de evento centinela
  Dado que el evento reportado involucra daño grave o muerte
  Cuando el comité lo clasifica como "evento centinela"
  Entonces el sistema activa un proceso de análisis de causa raíz obligatorio con plazo de 45 días
  Y notifica a la dirección médica y gerencia general
```

---

### US.JCI.9.2 — Análisis de causa raíz documentado

**Como** líder de análisis de causa raíz
**quiero** documentar el proceso de RCA (Root Cause Analysis) en el sistema
**para** generar el plan de mejora y dar seguimiento a los compromisos requeridos por QPS.11.

**SP:** 8 | **Trazabilidad:** JCI-7 QPS.11 ME 1-3 | **Deps:** US.JCI.9.1

**Criterios de aceptación:**
```gherkin
Escenario: Plantilla de RCA con metodología definida
  Dado que un evento centinela fue clasificado
  Cuando inicio el RCA
  Entonces el sistema provee plantilla con: descripción del evento, causas próximas, causas raíz, factores contribuyentes y acciones de mejora
  Y obliga a definir responsable y fecha para cada acción

Escenario: Seguimiento de acciones del plan de mejora
  Dado que el RCA generó 5 acciones de mejora
  Cuando el responsable cierra una acción
  Entonces el sistema solicita evidencia del cierre (documento, foto, registro)
  Y actualiza el estado del RCA parcial o completamente cerrado

Escenario: Reporte de RCAs para evaluador JCI
  Dado que el evaluador solicita evidencia de gestión de eventos centinela
  Cuando genero el reporte de RCAs del año
  Entonces muestra: número de eventos, clasificación, estado de RCA y porcentaje de acciones cumplidas
```

---

## JCI-E-11 — Evaluación inicial y revaloración estructurada (COP.1, COP.2.1)

### US.JCI.11.1 — Evaluación inicial médica estructurada con marco de tiempo

**Como** médico de guardia
**quiero** completar la evaluación inicial médica en formato estructurado dentro del tiempo requerido según tipo de paciente
**para** cumplir COP.1 ME 1-2 y que el sistema registre el cumplimiento del marco de tiempo.

**SP:** 8 | **Trazabilidad:** JCI-7 COP.1 ME 1-2 | **Deps:** ninguna

**Criterios de aceptación:**
```gherkin
Escenario: Formulario de evaluación inicial con secciones COP obligatorias
  Dado que ingresé un paciente a hospitalización
  Cuando completo la evaluación inicial médica
  Entonces el formulario incluye: motivo de ingreso, historia clínica, examen físico, diagnóstico de ingreso, plan de tratamiento inicial y necesidades especiales
  Y el sistema registra la hora de completación y calcula el tiempo transcurrido desde el ingreso

Escenario: Alerta por incumplimiento del marco de tiempo
  Dado que un paciente hospitalizó hace 24 horas
  Y la evaluación inicial médica no ha sido completada
  Cuando el sistema verifica la condición
  Entonces alerta al médico tratante y jefe de guardia "COP.1: evaluación inicial pendiente"
  Y registra el incumplimiento como indicador de calidad negativo

Escenario: Diferenciación por tipo de servicio
  Dado que los marcos de tiempo varían por servicio (emergencias: 1h, hospitalización: 24h, UCI: 30min)
  Cuando ingresa un paciente a UCI
  Entonces el marco de tiempo aplicado es 30 minutos
  Y el sistema adapta la alerta al estándar del servicio configurado
```

---

### US.JCI.11.2 — Revaloración estructurada y frecuencia mínima

**Como** médico tratante
**quiero** registrar revalo raciones estructuradas de mis pacientes hospitalizados con la frecuencia mínima requerida por protocolo
**para** cumplir COP.2.1 y evidenciar que el estado del paciente es monitoreado activamente.

**SP:** 8 | **Trazabilidad:** JCI-7 COP.2.1 ME 1-3 | **Deps:** US.JCI.11.1

**Criterios de aceptación:**
```gherkin
Escenario: Registro de revaloración con cambios en el estado
  Dado que visito a mi paciente en la ronda matutina
  Cuando registro la revaloración
  Entonces el formulario muestra el estado previo y solicita documentar cambios en: estado general, signos vitales, respuesta al tratamiento y plan del día
  Y si no hay cambios, debo confirmarlo explícitamente para que quede registrado

Escenario: Alerta de revaloración vencida
  Dado que un paciente hospitalizado no tiene revaloración médica en las últimas 24 horas
  Cuando el sistema verifica la condición cada 4 horas
  Entonces alerta al médico tratante y al jefe de servicio
  Y el incumplimiento se registra en el indicador COP del dashboard de calidad

Escenario: Revaloración de enfermería con mayor frecuencia
  Dado que la frecuencia de revaloración de enfermería está configurada a cada 8 horas para pacientes de baja complejidad
  Cuando la última revaloración de enfermería supera ese intervalo
  Entonces el sistema genera tarea en el kardex del turno actual para la enfermera asignada
```

---

## JCI-E-14 — Vigilancia epidemiológica: reportes automatizados (PCI.6, QPS.4)

### US.JCI.14.1 — Consolidado de indicadores epidemiológicos por período

**Como** epidemiólogo del hospital
**quiero** generar un consolidado mensual de indicadores epidemiológicos (IAAS, resistencias, brotes) de forma automatizada
**para** cumplir PCI.6 ME 2-3 sin depender de hojas de cálculo manuales.

**SP:** 8 | **Trazabilidad:** JCI-7 PCI.6 ME 2-3, QPS.4 ME 2 | **Deps:** US.JCI.1.1, US.JCI.1.2

**Criterios de aceptación:**
```gherkin
Escenario: Generación automática de reporte epidemiológico mensual
  Dado que el período mensual cerró
  Cuando ejecuto el reporte epidemiológico
  Entonces el sistema consolida: casos IAAS por servicio, organismos causales, resistencias antimicrobianas, tasas por 1,000 días-paciente y comparación con mes anterior
  Y exporta en formato PDF y CSV

Escenario: Detección de brote por agrupamiento de casos
  Dado que en los últimos 7 días hay 3 o más casos de IAAS por el mismo organismo en el mismo servicio
  Cuando el sistema analiza los datos nocturnos
  Entonces genera una alerta de posible brote al director de infecciones y director médico
  Y abre automáticamente un reporte de investigación de brote

Escenario: Reporte de resistencias antimicrobianas
  Dado que el laboratorio procesa cultivos con antibiograma
  Cuando los resultados se registran en el sistema
  Entonces el sistema acumula el perfil de resistencias y lo incluye en el consolidado epidemiológico mensual
  Y compara vs el año anterior para detectar tendencias de resistencia emergente
```

---

## JCI-E-16 — Seguridad quirúrgica (IPSG.4, COP.6)

### US.JCI.16.1 — Marcado del sitio quirúrgico documentado

**Como** cirujano
**quiero** registrar en el sistema que el sitio quirúrgico fue marcado y verificado con el paciente
**para** cumplir IPSG.4 ME 2 y evitar cirugías en el sitio incorrecto.

**SP:** 5 | **Trazabilidad:** JCI-7 IPSG.4 ME 2 | **Deps:** US.JCI.5.4

**Criterios de aceptación:**
```gherkin
Escenario: Confirmación de marcado de sitio quirúrgico
  Dado que la cirugía está programada
  Cuando el cirujano confirma el marcado del sitio en el preoperatorio
  Entonces el sistema registra: sitio marcado, método (marcador permanente), confirmación del paciente despierto y foto opcional
  Y el dato queda visible en el checklist OMS del Time Out

Escenario: Procedimientos con excepciones de marcado
  Dado que la cirugía es un parto por cesárea (excepción de marcado)
  Cuando el cirujano indica la excepción
  Entonces el sistema acepta la razón de excepción de la lista controlada y la registra en el checklist
  Y no bloquea el avance del procedimiento por falta de marcado en casos de excepción válida

Escenario: Verificación en Time Out de concordancia
  Dado que se ejecuta el Time Out
  Cuando se verifica el sitio quirúrgico
  Entonces el sistema confirma que el sitio documentado coincide con el diagnóstico y el lado anatómico registrado en la orden quirúrgica
```

---

## JCI-E-08 — Continuidad asistencial y plan de alta (COP.2, COP.3, COP.8)

### US.JCI.8.1 — Plan de alta iniciado al ingreso

**Como** médico tratante
**quiero** registrar un plan de alta preliminar desde el momento del ingreso
**para** coordinar desde el primer día los recursos y apoyos que el paciente necesitará al egresar.

**SP:** 5 | **Trazabilidad:** JCI-7 COP.3 ME 1-2, COP.8 ME 1 | **Deps:** US.JCI.11.1

**Criterios de aceptación:**
```gherkin
Escenario: Plan de alta inicial en el ingreso
  Dado que ingresé un paciente para hospitalización electiva
  Cuando completo la evaluación inicial
  Entonces el sistema presenta el formulario de plan de alta con campos: estancia esperada, necesidades al alta (transporte, apoyo familiar, rehabilitación), y próxima cita
  Y el plan queda vinculado al ingreso con posibilidad de actualización progresiva

Escenario: Actualización del plan ante cambio de condición
  Dado que el estado del paciente complicó su recuperación
  Cuando el médico actualiza el plan de alta
  Entonces el sistema registra la versión anterior y la nueva con justificación del cambio
  Y notifica a trabajo social si se activan nuevas necesidades sociales

Escenario: Plan de alta completado antes del egreso
  Dado que el paciente será dado de alta mañana
  Cuando verifico el plan de alta
  Entonces el sistema muestra el estado de cada elemento del plan (coordinado/pendiente/no aplica)
  Y bloquea la orden de alta si hay elementos marcados como pendientes sin justificación
```

---

## Historias adicionales compactas (JCI-E-10, 12, 13, 15, 17, 18, 19, 20)

### US.JCI.10.1 — Registro de ronda de observación de higiene de manos (PCI.9)
**Como** observador de higiene de manos | **Quiero** registrar móvil las oportunidades observadas por turno y servicio | **Para** calcular la tasa de cumplimiento semanal requerida por PCI.9 ME 2.
**SP:** 5 | **Trazabilidad:** PCI.9 ME 2 | **Deps:** ninguna

```gherkin
Escenario: Registro de oportunidades observadas
  Dado que realizo una ronda de observación en UCI turno mañana
  Cuando registro 20 oportunidades observadas con 16 conformes
  Entonces el sistema calcula 80% cumplimiento para ese turno/servicio
  Y acumula al indicador mensual

Escenario: Meta configurable por servicio
  Dado que UCI tiene meta del 90% y Medicina General del 85%
  Cuando el resultado de UCI es 82%
  Entonces el sistema genera alerta de brecha al jefe de UCI

Escenario: Informe mensual de higiene de manos
  Dado que el mes cerró
  Cuando genero el informe
  Entonces consolida por servicio, turno y categoría de personal
  Y alimenta automáticamente el dashboard QPS
```

---

### US.JCI.12.1 — Alerta de mantenimiento preventivo vencido (FMS.8)
**Como** jefe de ingeniería biomédica | **Quiero** ver qué equipos tienen mantenimiento vencido o próximo a vencer | **Para** priorizar las órdenes de trabajo antes de que el equipo falle o el evaluador JCI lo detecte.
**SP:** 5 | **Trazabilidad:** FMS.8 ME 1-2 | **Deps:** módulo BiomedicalEquipment existente

```gherkin
Escenario: Alerta de mantenimiento próximo a vencer
  Dado que un ventilador tiene mantenimiento programado para en 15 días
  Cuando el sistema verifica la agenda
  Entonces genera una tarea en la bandeja de ingeniería biomédica con prioridad media
  Y el equipo aparece resaltado en el inventario

Escenario: Bloqueo de uso de equipo con mantenimiento vencido crítico
  Dado que un desfibrilador tiene mantenimiento vencido hace 30 días
  Cuando enfermería intenta registrarlo como en uso
  Entonces el sistema muestra advertencia "Mantenimiento vencido — verificar con biomédica"
  Y el jefe de servicio debe confirmar el uso bajo su responsabilidad

Escenario: Reporte de cumplimiento para evaluador JCI
  Dado que el evaluador solicita el plan de mantenimiento preventivo
  Cuando genero el reporte
  Entonces muestra todos los equipos con estado: al día, próximo, vencido; con fechas y responsables
```

---

### US.JCI.13.1 — Registro de capacitación y evaluación de competencias (SQE.3)
**Como** jefe de educación continua | **Quiero** registrar las capacitaciones completadas por cada profesional con la evaluación de competencias | **Para** demostrar en SQE que el personal tiene las competencias para su rol actual.
**SP:** 5 | **Trazabilidad:** SQE.3 ME 1, SQE.8 ME 1 | **Deps:** US.JCI.4.1

```gherkin
Escenario: Registro de capacitación con evidencia de aprobación
  Dado que un profesional completó el curso de RCP
  Cuando registro la capacitación
  Entonces capturo: nombre del curso, fecha, calificación obtenida y vigencia del certificado
  Y el dato aparece en el expediente de credenciales del profesional

Escenario: Alerta de certificación por vencer
  Dado que la certificación de RCP de una enfermera vence en 30 días
  Cuando el sistema verifica la agenda
  Entonces notifica a la enfermera y al jefe de educación continua
  Y actualiza el semáforo de competencias en el expediente

Escenario: Reporte de brechas de competencias por servicio
  Dado que se agrega un nuevo requisito de competencia
  Cuando genero el reporte de brechas
  Entonces el sistema identifica qué personal no cumple el nuevo requisito
  Y genera un plan de capacitación sugerido con fechas tentativas
```

---

### US.JCI.17.1 — Alerta y seguimiento de resultado de laboratorio crítico (COP.7)
**Como** médico tratante | **Quiero** recibir notificación inmediata cuando haya un resultado de laboratorio crítico de mis pacientes | **Para** actuar a tiempo y documentar la respuesta requerida por COP.7 ME 1.
**SP:** 5 | **Trazabilidad:** COP.7 ME 1, IPSG.2 ME 1 | **Deps:** módulo LIS existente

```gherkin
Escenario: Notificación de resultado crítico en tiempo real
  Dado que el laboratorio reporta hemoglobina 5.2 g/dL (valor crítico)
  Cuando el resultado es validado y liberado
  Entonces el médico tratante recibe notificación push en app y web en menos de 2 minutos
  Y la notificación incluye: paciente, parámetro, valor, rango crítico y hora del resultado

Escenario: Registro obligatorio de la respuesta médica
  Dado que recibí la notificación del valor crítico
  Cuando confirmo recepción en el sistema
  Entonces el sistema solicita registrar la acción tomada (transfusión ordenada, consulta especialista, monitoreo)
  Y el loop queda cerrado con timestamp de respuesta

Escenario: Escalada si no hay respuesta en tiempo definido
  Dado que pasaron 30 minutos sin acuse de recibo del médico tratante
  Cuando el sistema verifica el estado
  Entonces escala al médico de guardia y jefe de servicio
  Y registra la escalada como potencial riesgo en el indicador IPSG.2
```

---

### US.JCI.18.1 — Acuse de recibo de resultados e instrucciones de seguimiento (IPSG.2)
**Como** médico tratante | **Quiero** registrar mi acuse de recibo de resultados y las instrucciones impartidas al paciente | **Para** cerrar el loop de comunicación requerido por IPSG.2 ME 2-3.
**SP:** 3 | **Trazabilidad:** IPSG.2 ME 2-3 | **Deps:** US.JCI.17.1

```gherkin
Escenario: Cierre del loop de resultado con acción documentada
  Dado que recibí una notificación de resultado crítico
  Cuando confirmo y documento "ordenada transfusión 2 UGR, paciente informado"
  Entonces el sistema cierra el ticket de notificación con todos los campos completados
  Y el indicador IPSG.2 se incrementa en "loops cerrados en tiempo"

Escenario: Resultado no crítico sin loop requerido
  Dado que el resultado es normal
  Cuando se libera del laboratorio
  Entonces el sistema lo pone disponible en el expediente sin generar loop obligatorio
  Y el médico puede revisarlo en el próximo turno sin alerta de urgencia

Escenario: Reporte de loops no cerrados para comité de calidad
  Dado que el mes cerró
  Cuando genero el reporte de cumplimiento IPSG.2
  Entonces muestra porcentaje de valores críticos con loop cerrado vs total de valores críticos emitidos
```

---

### US.JCI.15.1 — Control de versiones de políticas y procedimientos (GLD.11)
**Como** director de calidad | **Quiero** gestionar el ciclo de vida de políticas y procedimientos hospitalarios con control de versiones y aprobación digital | **Para** cumplir GLD.11 y garantizar que el personal siempre acceda a la versión vigente.
**SP:** 5 | **Trazabilidad:** GLD.11 ME 1-3 | **Deps:** ninguna

```gherkin
Escenario: Publicación de nuevo procedimiento con aprobación
  Dado que redacté un nuevo procedimiento operativo
  Cuando lo envío al flujo de aprobación con el director médico como aprobador
  Entonces el director médico recibe la solicitud y puede aprobar o rechazar con comentarios
  Y la versión aprobada queda como vigente en el repositorio de políticas

Escenario: Acceso solo a versión vigente para el personal
  Dado que hay una política con versión 1.0 obsoleta y versión 2.0 vigente
  Cuando un profesional busca la política
  Entonces el sistema solo muestra la versión vigente
  Y las versiones obsoletas son visibles solo para el director de calidad en modo histórico

Escenario: Notificación de política actualizada al personal afectado
  Dado que se actualizó el protocolo de manejo de vía aérea
  Cuando se publica la nueva versión
  Entonces todos los médicos y enfermeras de áreas críticas reciben notificación de "política actualizada"
  Y el sistema registra quiénes acusaron recibo de la actualización
```
```

---

# Plan de releases JCI

## Sección: Plan de releases JCI (para `docs/33a_jci_releases_y_roadmap.md`)

```markdown
# Plan de Releases — Fase JCI

**Proyecto:** HIS Multipaís — Inversiones Avante
**Objetivo de la fase:** Obtener acreditación JCI Hospital 7a edición
**Duración total estimada:** 9 meses (JCI-1: 3 meses, JCI-2: 3 meses, JCI-3: 3 meses)
**Capacidad estimada:** 4 equipos de 2-3 desarrolladores, 2 semanas por sprint
**Total SP fase:** ~807 SP (sujeto a refinement)

---

## JCI-1.0 — Fundamentos para visita exploratoria

**Fecha estimada de release:** mes 3 (T+3 desde kick-off)
**Sprint range:** JCI-1 Sprint 1, Sprint 2, Sprint 3

### Épicas incluidas

| Épica | SP | Prioridad |
|-------|-----|-----------|
| JCI-E-05 — IPSG.1-6 (Metas internacionales de seguridad) | 89 | Must crítico |
| JCI-E-01 — Control de infecciones: vigilancia y reporte | 55 | Must |
| JCI-E-04 — Credencialización y privilegios clínicos | 55 | Must |
| JCI-E-07 — Gestión y uso de medicamentos (MMU.4, MMU.5, MMU.7) | 55 | Must |
| JCI-E-16 — Seguridad quirúrgica — checklist OMS digital | 34 | Must |
| JCI-E-02 — Educación al paciente y familia | 42 | Must |
| JCI-E-06 — Derechos del paciente y consentimiento informado | 34 | Must |
| JCI-E-11 — Evaluación inicial y revaloración estructurada | 42 | Must |
| JCI-E-09 — Gestión de riesgo clínico y eventos adversos | 47 | Must |
| JCI-E-14 — Vigilancia epidemiológica: reportes automatizados | 42 | Must |
| **Subtotal JCI-1.0** | **495 SP** | |

### Outcome esperado de JCI-1.0

- Los 6 IPSG están implementados y auditables digitalmente (identificación, comunicación, medicamentos, cirugía, higiene de manos, caídas).
- El programa PCI tiene vigilancia activa con tablero de tasas de IAAS.
- Todo el personal clínico tiene expediente de credenciales y privilegios cargado.
- La cadena prescripción→validación→dispensación→administración eMAR está completa con trazabilidad GS1.
- El sistema registra eventos adversos con RCA y seguimiento.
- Consentimiento informado digital firmado y trazable.

### Criterio "ready for evaluación exploratoria JCI" (Mock Survey 1)

Se puede invitar a un consultor JCI para una visita exploratoria (mock survey) cuando:
- [ ] Los 6 estándares IPSG tienen evidencia digital de implementación en ≥90 días de operación real.
- [ ] El programa PCI tiene al menos 3 meses de datos de tasas de IAAS por servicio.
- [ ] Al menos el 95% del personal clínico activo tiene credenciales vigentes en el sistema.
- [ ] El registro eMAR con doble verificación tiene ≥30 días de operación continua.
- [ ] Existe al menos un RCA completado con plan de mejora implementado.
- [ ] El checklist OMS digital fue usado en el 100% de las cirugías del último mes.

---

## JCI-2.0 — Madurez y completitud de capítulos

**Fecha estimada de release:** mes 6 (T+6)
**Sprint range:** JCI-2 Sprint 4, Sprint 5

### Épicas incluidas

| Épica | SP | Prioridad |
|-------|-----|-----------|
| JCI-E-03 — Dashboard QPS y métricas de calidad | 63 | Must |
| JCI-E-08 — Continuidad asistencial y plan de alta | 42 | Should |
| JCI-E-10 — Higiene de manos: auditoría digital | 21 | Should |
| JCI-E-13 — Capacitación y competencia del personal | 34 | Should |
| JCI-E-17 — Laboratorio: resultados críticos | 34 | Should |
| JCI-E-18 — Comunicación de resultados: loop clínico | 21 | Should |
| JCI-E-12 — Gestión de equipamiento y mantenimiento | 34 | Should |
| **Subtotal JCI-2.0** | **249 SP** | |

### Outcome esperado de JCI-2.0

- El dashboard QPS está operativo con los 11 indicadores de biblioteca JCI activos y datos históricos de 6 meses.
- El plan de alta se inicia desde el ingreso y se actualiza progresivamente.
- Las tasas de higiene de manos se capturan digitalmente por servicio y turno.
- El expediente de capacitaciones del personal está completo con evaluaciones de competencia.
- El loop de valores críticos de laboratorio está cerrado con trazabilidad IPSG.2.
- El programa de mantenimiento preventivo está activo con alertas automáticas.

### Criterio "ready for aplicación formal JCI"

Se puede someter la solicitud formal de evaluación JCI cuando:
- [ ] Los capítulos PCI, IPSG, QPS, SQE, MMU, PFR, COP tienen datos de ≥6 meses en el sistema.
- [ ] El dashboard QPS muestra tendencia favorable en ≥8 de los 11 indicadores.
- [ ] Las actas de comité de calidad de los últimos 6 meses están firmadas digitalmente.
- [ ] La tasa de higiene de manos supera el 85% global en los últimos 3 meses.
- [ ] El expediente de credenciales está al 100% para personal clínico activo.

---

## JCI-3.0 — Optimización y sostenibilidad

**Fecha estimada de release:** mes 9 (T+9)
**Sprint range:** JCI-3 Sprint 6, Sprint 7

### Épicas incluidas

| Épica | SP | Prioridad |
|-------|-----|-----------|
| JCI-E-15 — Gestión documental y control de políticas | 21 | Could |
| JCI-E-19 — Preparación para emergencias y continuidad | 21 | Could |
| JCI-E-20 — Satisfacción del paciente: encuestas | 21 | Could |
| Refinamiento y mejoras post-mock survey | ~30 SP buffer | — |
| **Subtotal JCI-3.0** | **63-93 SP** | |

### Outcome esperado de JCI-3.0

- Repositorio de políticas con control de versiones y aprobaciones digitales operativo.
- Encuestas de satisfacción del paciente integradas al dashboard QPS.
- Plan de continuidad del HIS documentado y ejercitado.
- El sistema supera mock survey con puntaje ≥85% en capítulos críticos.
- Lista para la visita oficial de acreditación JCI.

### Criterio "ready for visita oficial de acreditación JCI"

- [ ] Mock survey (JCI-2.0 milestone) completado con score ≥80% en todos los capítulos.
- [ ] Plan de mejora del mock survey implementado al 100%.
- [ ] ≥12 meses de datos de indicadores de calidad en el sistema.
- [ ] Toda la documentación de políticas y procedimientos bajo control de versiones.
- [ ] Satisfacción del paciente medida en ≥3 ciclos con metodología validada.
- [ ] Personal capacitado en el proceso de evaluación JCI (simulacros de entrevistas).

---

## Roadmap visual (resumen)

```
Mes 1  | Mes 2  | Mes 3      | Mes 4  | Mes 5  | Mes 6      | Mes 7  | Mes 8  | Mes 9
-------|--------|------------|--------|--------|------------|--------|--------|----------
S1     | S2     | S3         | S4     | S5     | S5→S6      | S6     | S7     | S7→cierre
IPSG   | MMU    | QPS-config |        | COP    | QPS-dash   | GLD    | FMS.6  | Mock→OK
PCI    | SQE    | PCI-report | PFE    | SQE    | Lab-loop   | PFR    | PFE-sat|
SQE    | PFR    | RCA-setup  | MMU    | PCI-HH |            |        |        |
       |        | Checklist  |        |        |            |        |        |
       |        | [Release   |        |        | [Release   |        |        | [Release
       |        |  JCI-1.0]  |        |        |  JCI-2.0]  |        |        |  JCI-3.0]
       |        | Mock       |        |        | Solicitud  |        |        | Visita
       |        | exploratorio|       |        | formal     |        |        | oficial
```

---

## Riesgos del roadmap

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Datos históricos insuficientes al momento de la visita | Alta | Alto | Iniciar captura de datos desde el arranque del sistema, no esperar JCI-1.0 |
| Personal sin credenciales cargadas al inicio | Media | Alto | Sprint 0 de carga masiva de credenciales antes de JCI-1 Sprint 1 |
| Resistencia al cambio en documentación digital | Media | Medio | Capacitación intensiva + campeones por servicio |
| Funcionalidades no terminadas en mock survey | Baja | Alto | Buffer de 30 SP en JCI-3.0 para remediaciones |
| Cambio de versión de estándares JCI durante el proyecto | Baja | Medio | Suscripción a actualizaciones JCI; ADR para cambios de norma |
```

---

# Top 30 US críticas priorizadas

## Sección: Top 30 US críticas priorizadas (para `docs/33b_jci_backlog.md` § Priorización)

```markdown
# Top 30 US Críticas — Priorización WSJF

**Método WSJF:** Cost of Delay (0-10) / Job Size (SP/13 normalizado, mínimo 0.23)
**Ordenado de mayor a menor WSJF**

| # | ID US | Épica | Título (compacto) | SP | CoD | Job Size | WSJF | MoSCoW | Sprint | Justificación |
|---|-------|-------|-------------------|----|-----|----------|------|--------|--------|---------------|
| 1 | US.JCI.5.4 | JCI-E-05 | Checklist OMS Time Out digital (IPSG.4) | 8 | 10 | 0.62 | 16.2 | Must | S1 | IPSG.4 es pass/fail — una cirugía sin checklist digital es hallazgo mayor inmediato |
| 2 | US.JCI.5.1 | JCI-E-05 | Doble verificación de identidad antes de procedimiento (IPSG.1) | 8 | 10 | 0.62 | 16.2 | Must | S1 | IPSG.1 es el estándar de seguridad de más alta frecuencia; impacto en cada atención |
| 3 | US.JCI.5.3 | JCI-E-05 | Medicamentos de alto riesgo con doble verificación (IPSG.3) | 8 | 10 | 0.62 | 16.2 | Must | S1 | Evento centinela más común; bloqueo de dispensación es requisito no negociable |
| 4 | US.JCI.4.1 | JCI-E-04 | Expediente digital de credenciales del personal clínico (SQE.9) | 8 | 9.5 | 0.62 | 15.4 | Must | S1 | Sin credenciales en sistema, el evaluador no puede verificar la habilitación del personal |
| 5 | US.JCI.4.2 | JCI-E-04 | Privilegios clínicos por procedimiento (SQE.10) | 8 | 9.5 | 0.62 | 15.4 | Must | S1 | Bloqueo de procedimientos sin privilegio = control preventivo de riesgo clínico-legal |
| 6 | US.JCI.9.1 | JCI-E-09 | Reporte de evento adverso o near miss (QPS.8) | 8 | 9 | 0.62 | 14.6 | Must | S2 | Sin sistema de reporte, capítulo QPS falla; cultura de seguridad no demostrable |
| 7 | US.JCI.7.1 | JCI-E-07 | Validación farmacéutica de órdenes de medicamento (MMU.4) | 8 | 9 | 0.62 | 14.6 | Must | S2 | MMU.4 es bloqueo en la cadena de medicación; sin validación farmacéutica el capítulo falla |
| 8 | US.JCI.7.2 | JCI-E-07 | eMAR con escaneo y verificación 5 correctos (MMU.7) | 8 | 9 | 0.62 | 14.6 | Must | S2 | MMU.7 ME 1-2 verificable en cada turno; falla observable y frecuente para evaluador |
| 9 | US.JCI.1.1 | JCI-E-01 | Registro de caso IAAS vinculado a ingreso (PCI.5) | 8 | 9 | 0.62 | 14.6 | Must | S1 | PCI.5 requiere vigilancia activa; sin registro el programa no existe para JCI |
| 10 | US.JCI.5.2 | JCI-E-05 | Notificación y cierre de loop de valor crítico (IPSG.2) | 8 | 9.5 | 0.62 | 14.6 | Must | S1 | IPSG.2 se verifica revisando registros de notificación — debe haber loop cerrado |
| 11 | US.JCI.5.5 | JCI-E-05 | Evaluación de riesgo de caídas al ingreso (IPSG.6) | 5 | 9 | 0.38 | 13.5 | Must | S1 | IPSG.6 se verifica observando al paciente y revisando el registro; alta visibilidad |
| 12 | US.JCI.1.2 | JCI-E-01 | Tablero de tasas de IAAS por servicio (PCI.6) | 8 | 9 | 0.62 | 13.2 | Must | S2 | PCI.6 requiere datos comparativos; sin tablero el programa no es demostrable |
| 13 | US.JCI.6.2 | JCI-E-06 | Consentimiento informado digital con proceso documentado (PFR.3) | 8 | 8.5 | 0.62 | 13.0 | Must | S2 | PFR.3 se verifica en cada expediente; ausencia de firma digital es hallazgo masivo |
| 14 | US.JCI.11.1 | JCI-E-11 | Evaluación inicial médica estructurada con marco de tiempo (COP.1) | 8 | 8.5 | 0.62 | 13.0 | Must | S2 | COP.1 se verifica revisando expedientes de los últimos 30 días; falla sistémica visible |
| 15 | US.JCI.11.2 | JCI-E-11 | Revaloración estructurada con frecuencia mínima (COP.2.1) | 8 | 8.5 | 0.62 | 13.0 | Must | S3 | COP.2.1 se revisa en ronda con evaluador presente; no documentar = no ocurrió |
| 16 | US.JCI.9.2 | JCI-E-09 | Análisis de causa raíz documentado (QPS.11) | 8 | 8.5 | 0.62 | 13.0 | Must | S3 | QPS.11 requiere al menos 1 RCA completado verificable; sin esto el capítulo falla |
| 17 | US.JCI.2.1 | JCI-E-02 | Registro de sesión educativa durante el ingreso (PFE.2) | 5 | 8.5 | 0.38 | 12.7 | Must | S2 | PFE.2 se verifica en expediente durante ronda; ausencia es hallazgo frecuente |
| 18 | US.JCI.2.3 | JCI-E-02 | Instrucciones de alta documentadas y firmadas (PFE.4) | 5 | 8.5 | 0.38 | 12.7 | Must | S2 | PFE.4 se verifica con pacientes al momento del alta; impacto directo en evaluación |
| 19 | US.JCI.16.1 | JCI-E-16 | Marcado del sitio quirúrgico documentado (IPSG.4) | 5 | 9.5 | 0.38 | 12.3 | Must | S2 | IPSG.4 ME 2 complementa el checklist; ambos deben estar presentes |
| 20 | US.JCI.14.1 | JCI-E-14 | Consolidado de indicadores epidemiológicos mensual (PCI.6) | 8 | 8 | 0.62 | 12.3 | Must | S3 | PCI.6 ME 2-3 exige reporte a dirección; sin automatización es alto costo humano |
| 21 | US.JCI.3.1 | JCI-E-03 | Indicadores clave de calidad configurables (QPS.4) | 8 | 8 | 0.62 | 12.3 | Must | S3 | QPS.4 requiere indicadores definidos, medidos y reportados; sin sistema es imposible |
| 22 | US.JCI.1.4 | JCI-E-01 | Protocolo de aislamiento activado desde ingreso (PCI.5) | 5 | 8 | 0.38 | 11.9 | Must | S1 | PCI.5 ME 2: evaluador verifica en sala si hay alertas visibles de precauciones |
| 23 | US.JCI.5.6 | JCI-E-05 | Registro de rondas de higiene de manos (IPSG.5) | 5 | 8 | 0.38 | 11.9 | Must | S2 | IPSG.5 se verifica con datos de observación; sin registro digital no hay evidencia |
| 24 | US.JCI.6.1 | JCI-E-06 | Notificación de derechos al ingreso firmada (PFR.2) | 3 | 8 | 0.23 | 11.5 | Must | S2 | PFR.2 se verifica en cada expediente; es la US de menor esfuerzo con mayor frecuencia de revisión |
| 25 | US.JCI.4.3 | JCI-E-04 | Reporte de estado de credenciales para evaluación JCI (SQE.11) | 5 | 8 | 0.38 | 11.5 | Must | S3 | El evaluador solicita este reporte en la primera reunión; debe estar disponible al instante |
| 26 | US.JCI.2.2 | JCI-E-02 | Evaluación de necesidades educativas al ingreso (PFE.1) | 5 | 7.5 | 0.38 | 11.1 | Must | S2 | PFE.1 es prerequisito de toda la cadena educativa; sin evaluación no hay plan |
| 27 | US.JCI.3.2 | JCI-E-03 | Panel ejecutivo de calidad para dirección (QPS.7) | 8 | 8 | 0.62 | 11.1 | Must | S4 | QPS.7 se verifica entrevistando a la dirección; deben poder mostrar datos en vivo |
| 28 | US.JCI.1.3 | JCI-E-01 | Reporte periódico de PCI a dirección firmado (PCI.6) | 5 | 7.5 | 0.38 | 10.4 | Must | S3 | PCI.6 ME 3: actas firmadas son evidencia requerida; sin firma digital son débiles |
| 29 | US.JCI.17.1 | JCI-E-17 | Alerta de resultado crítico con temporizador (COP.7) | 5 | 7.5 | 0.38 | 10.4 | Should | S4 | COP.7 ME 1 requiere tiempo documentado de notificación; gap cubre IPSG.2 también |
| 30 | US.JCI.8.1 | JCI-E-08 | Plan de alta iniciado desde el ingreso (COP.3) | 5 | 7 | 0.38 | 10.1 | Should | S4 | COP.3 se verifica en ronda; la ausencia de plan al primer día es hallazgo recurrente en LAC |

---

## Distribución por capítulo JCI (Top 30)

| Capítulo | US en top 30 | SP |
|----------|--------------|----|
| IPSG (1-6) | 8 | 51 |
| PCI | 5 | 31 |
| QPS | 4 | 29 |
| SQE | 3 | 21 |
| PFE | 3 | 15 |
| MMU | 2 | 16 |
| COP | 3 | 21 |
| PFR | 2 | 11 |

**Conclusión:** IPSG concentra el 27% del valor en el top 30 — es el capítulo correcto para arrancar Sprint 1.

---

## KPIs de producto para la fase JCI

| KPI | Meta JCI-1.0 | Meta JCI-2.0 | Meta JCI-3.0 |
|-----|-------------|-------------|-------------|
| % IPSG con evidencia digital ≥30 días | 100% | 100% | 100% |
| % personal clínico con credenciales vigentes en HIS | ≥80% | ≥95% | 100% |
| % cirugías con checklist OMS digital completado | ≥95% | 100% | 100% |
| Tasa de loops de valores críticos cerrados en tiempo | ≥80% | ≥90% | ≥95% |
| Indicadores QPS activos con ≥3 meses de datos | 0 | 11 | 11 |
| % eventos adversos con RCA iniciado ≤72h | — | ≥85% | ≥95% |
| Tasa de cumplimiento de higiene de manos | — | ≥85% | ≥90% |
| Score de mock survey JCI | — | ≥80% | ≥90% |
```

---

Los 4 bloques de markdown están listos para copiar directamente a sus archivos destino:

- **Epicas JCI** (`docs/33b_jci_backlog.md` sección Epicas) — 20 épicas, WSJF calculado, 807 SP total
- **Historias de usuario JCI** (`docs/33b_jci_backlog.md` sección US) — 33 historias completas con Gherkin 3 escenarios cada una, cubriendo todos los capítulos críticos
- **Plan de releases JCI** (`docs/33a_jci_releases_y_roadmap.md`) — 3 releases con criterios de readiness verificables para cada hito de evaluación JCI
- **Top 30 US priorizadas** (`docs/33b_jci_backlog.md` sección Priorización) — tabla WSJF completa con justificación de negocio por fila

**Decisiones de PO documentadas:**

1. IPSG.1-6 arranca Sprint 1 sin excepción — son los únicos estándares que el evaluador JCI verifica observando directamente al personal en planta, no en documentos. Cualquier falla es visible de inmediato.

2. No se crearon épicas para módulos ya implementados en Fase 2 (eMAR GS1, checklist quirúrgico base, LIS) — las US JCI extienden esos módulos con las capas de cumplimiento que faltan (doble firma, notificación de loop, alerta de valor crítico), conforme a la regla de adecuar legacy.

3. El WSJF para IPSG es artificialmente alto porque CoD=10 — el costo de no tener IPSG implementado al momento de la visita es la no-acreditación completa. Este no es un valor especulativo; es el mecanismo de evaluación JCI.

4. JCI-E-15 (GLD — gestión documental) y JCI-E-19/20 (FMS.6, satisfacción) son "Could" porque JCI acepta que un hospital en primera acreditación tenga estas áreas en proceso de maduración, siempre que los capítulos clínicos principales superen el umbral de aprobación.
