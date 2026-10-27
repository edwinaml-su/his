# Apertura de nuevas sedes (laboratorios, edificios, clínicas)

Toda apertura es un proyecto: el PM (`gerente-proyectos-avante`) lleva charter, cronograma, gates y proveedores; Operaciones es el **dueño del resultado y del go-live** y responde por la lista de abajo. Legal lleva licencias y contratos; TI (`jefe-ti`) la plataforma.

## Checklist de puesta en marcha

### A. Legal y regulatorio (Legal, con Operaciones como solicitante)
- Licencia de funcionamiento del establecimiento (MINSAL) y habilitación según tipo (hospital, laboratorio clínico, farmacia).
- Inscripción de profesionales ante las Juntas de Vigilancia (CSSP) y regente de farmacia / director de laboratorio.
- Autorización de la SRS para farmacia y manejo de controlados.
- Permisos municipales, ambientales (desechos bioinfecciosos), bomberos, DTE y matrícula de comercio para la nueva sede.
- Contratos: arrendamiento o compra, proveedores de servicios (limpieza, seguridad, desechos, mantenimiento), especialistas que ocuparán consultorios.

### B. Infraestructura y equipamiento (Operaciones + mantenimiento + TI)
- Planta física entregada con acta; utilidades (energía, respaldo, agua, gases medicinales, climatización) probadas.
- Equipamiento biomédico instalado, calibrado, con GRAI en inventario y plan preventivo cargado.
- Red, Wi-Fi, HIS, Odoo, escáneres 2D, impresoras de etiquetas GS1, cámaras y control de acceso (TI).
- GLN de la sede, sus almacenes y ubicaciones dados de alta en el catálogo maestro (MDM) antes del primer ingreso de inventario.

### C. Cadena de suministro (Operaciones)
- Catálogo de la sede: ítems autorizados por servicio; clasificación ABC/XYZ/K; máximos y mínimos.
- Inventario inicial recibido por escaneo; subalmacén y farmacia con FEFO desde el día 1.
- Proveedores asignados con contrato y lead time para la nueva ubicación; críticos con doble fuente.
- Alertas de stock y vencimiento activas en el HIS para los GLN nuevos.

### D. Personal (Operaciones + RRHH + Médica)
- Dotación por turno calculada y contratada (médicos internos 24 h, enfermería, técnicos, admisión, farmacia, laboratorio, limpieza, seguridad).
- Inducción: SOP de la sede, HIS, escaneo GS1, seguridad del paciente, emergencias.
- Simulacro operativo (día tipo) y simulacro de emergencia antes de abrir.

### E. Procesos y documentos
- SOP mínimos vigentes: admisión y alta, triage, dispensación, recepción de inventario, limpieza y desechos, mantenimiento, contingencias, quejas.
- Tablero operativo de la sede y MCI de apertura (p. ej., "exactitud de inventario ≥ 98 % y 0 quiebres de críticos en los primeros 90 días").
- Plan de contingencia de la sede (ver `calidad-mantenimiento-contingencia.md`).

### F. Comercial y mercadeo (Comercial + Mercadeo, Operaciones confirma capacidad)
- Capacidad declarada (camas, consultorios, pruebas/día) validada por Operaciones antes de prometerla.
- Convenios (ISBM, DoctorSV, aseguradoras) extendidos a la sede.
- Lanzamiento coordinado con fecha real de operación, no de inauguración.

## Gates que Operaciones recomienda al PM

| Gate | Criterio de salida verificable |
|---|---|
| G1 Diseño | Programa médico-arquitectónico aprobado por Médica y Operaciones; catálogo de servicios |
| G2 Obra y equipamiento | Acta de recepción; pruebas de utilidades; equipos calibrados e inventariados |
| G3 Habilitación | Licencias y permisos emitidos; profesionales inscritos |
| G4 Preoperación | Inventario inicial escaneado; dotación completa e inducida; HIS operativo; simulacros aprobados |
| G5 Go-live | Apertura escalonada (soft opening) ≥ 2 semanas; KPI de apertura en verde |
| G6 Estabilización (90 días) | MCI de apertura lograda; lecciones registradas; transferencia al jefe de sede |

## Laboratorio nuevo: particularidades

Director de laboratorio inscrito; control de calidad interno y externo por analito antes de reportar; reactivos con lote en uso trazado; interfaz analizador→HIS (HL7/ASTM) probada con muestras control; TAT medido desde el día 1; manejo de muestras y desechos; cadena de frío con registro continuo.

## Errores que el gerente previene

- Abrir con inventario "prestado" de otra sede sin transferencia registrada.
- Dar de alta ubicaciones sin GLN "mientras tanto".
- Dotación calculada sobre la inauguración y no sobre el día 30 (cuando llega la demanda real).
- Fecha de lanzamiento comercial antes de la licencia.
