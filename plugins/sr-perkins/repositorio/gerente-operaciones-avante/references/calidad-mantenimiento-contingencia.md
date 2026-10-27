# Calidad y seguridad del paciente, mantenimiento, continuidad operativa

## Calidad y seguridad del paciente

Médica define el estándar clínico; Operaciones garantiza las condiciones y responde por el sistema de gestión.

- **Sistema**: política de calidad; mapa de procesos; SOP vigentes con versión; auditorías internas (ISO 9001 como marco); comité de calidad y seguridad del paciente mensual.
- **Eventos adversos**: reporte sin castigo; clasificación (incidente sin daño, evento adverso, centinela); análisis causa raíz (5 porqués / Ishikawa / Londres) en ≤ 15 días; plan de acción con dueño y fecha; seguimiento en comité.
- **Metas internacionales de seguridad del paciente** operativizadas: identificación correcta (pulsera + escaneo), comunicación efectiva (entrega de turno estandarizada), medicamentos de alto riesgo, cirugía segura (checklist), reducción de infecciones (higiene de manos medida), prevención de caídas.
- **Acreditación**: brecha contra el estándar elegido (p. ej., JCI o modelo nacional) → plan por capítulo → auditoría simulada → certificación.

### Inspecciones y auditorías externas (MINSAL, CSSP, SRS, MTPS)
1. Recibir con acta; registrar fecha, autoridad, alcance.
2. Entregar solo lo requerido; copias; nunca originales sin acta.
3. Respuesta a hallazgos en plazo, con evidencia; Legal revisa el escrito.
4. Matriz de cumplimiento actualizada (licencias, inscripciones, registros sanitarios, desechos, controlados, seguridad ocupacional).

## Mantenimiento e infraestructura

- **Inventario de activos** con GRAI/GIAI, criticidad (A: soporte de vida, B: diagnóstico, C: apoyo), ubicación GLN, historial.
- **Plan preventivo** por fabricante y criticidad; calibración y verificación de seguridad eléctrica; contratos de servicio con SLA de respuesta (A: ≤ 4 h; B: ≤ 24 h; C: ≤ 72 h) y equipo de respaldo.
- **Planta física y utilidades**: energía (planta de emergencia probada semanalmente con carga; UPS), agua (reserva ≥ 48 h), gases medicinales (manifold y alarmas), climatización crítica (quirófano, UCI, farmacia, laboratorio), elevadores, sistema contra incendios.
- **Orden de trabajo** única (preventiva/correctiva), prioridad P1–P4, tiempo de respuesta y cierre con verificación del usuario.
- Indicadores en `kpi-operativos.md`.

## Continuidad operativa y gestión de crisis

### Escenarios mínimos con plan
| Escenario | Respuesta inmediata | Dueño |
|---|---|---|
| Corte de energía | Planta en ≤ 10 s; verificar UCI/quirófano/laboratorio/farmacia; suspender electivas si > 2 h | Mantenimiento / jefe de sede |
| Falla de agua | Reserva; proveedor de cisterna; restringir usos | Mantenimiento |
| Caída del HIS / red | Modo contingencia en papel (formatos preimpresos), identificación manual doble verificación, registro posterior; TI comunica ETA | TI / jefe de sede |
| Quiebre de crítico / recall | Transferencia entre sedes; sustituto autorizado por Médica; recall según `gs1-trazabilidad.md` | Operaciones / farmacia |
| Sobredemanda (epidemia, evento masivo) | Plan de camas de expansión, triage ampliado, llamada a personal de reserva, derivación entre sedes | Gerente de Operaciones |
| Incendio / sismo / inundación | Evacuación por zonas, punto de reunión, brigadas, comunicación | Brigada / jefe de sede |
| Incidente de seguridad física | Protocolo de seguridad, autoridades, protección de personal y pacientes | Seguridad / jefe de sede |
| Ausentismo masivo / paro | Dotación mínima, redistribución, horas extra conforme a ley | Operaciones / RRHH |

### Estructura de respuesta
- Comité de crisis: Gerente de Operaciones (coordina), Médica, Legal, RRHH, TI, Mercadeo (comunicación); dirección informada.
- Comunicación: interna (cadena de llamadas), pacientes y familiares, autoridades, medios (Mercadeo con Legal).
- Registro: bitácora de la crisis con hora, decisión, responsable; revisión post-incidente en ≤ 7 días; lecciones a la bitácora.

### Simulacros
Mínimo dos por año por sede (uno de evacuación, uno de contingencia de HIS o sobredemanda); evaluación con hallazgos y plan.

## Lean y mejora continua (caja de herramientas)

- **5 porqués / Ishikawa** para causa raíz de un problema puntual.
- **A3** para un problema que necesita un mes y un equipo.
- **SIPOC y mapa de valor** para ver el flujo completo antes de tocarlo.
- **Teoría de restricciones**: identificar la restricción (la cama, el quirófano, el laboratorio, el proveedor), explotarla, subordinar el resto, elevarla, repetir.
- **PDCA** para pilotos; **5S** para almacenes y estaciones; **kanban** para insumos C; **poka-yoke** con escaneo GS1.
- **Six Sigma (DMAIC)** solo para variación medible y recurrente con impacto (p. ej., TAT de laboratorio).
