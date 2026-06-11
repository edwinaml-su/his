# Flujo 4 — ECE — ATENCIÓN

**Estado global: PASS** · 10/10 vistas funcionales · 0 errores (app estable).

Smoke E2E no destructivo (no se crean documentos clínicos). Varias vistas requieren UUID de episodio para listar datos — comportamiento esperado.

| # | Ruta | Vista | Resultado |
|---|---|---|---|
| 4.1 | `/ece/signos-vitales` | Signos Vitales — historial ECE con **datos reales** (TA, FC, FR, Temp, SpO₂, Dolor; registros del 17/5/26 con clasificación Normal/alterado). Botón "Nuevo registro". | PASS |
| 4.2 | `/ece/indicaciones` | Indicaciones Médicas — Órdenes CPOE con trazabilidad de firma MC y administración enfermería (**NTEC Doc 6**). Requiere UUID de episodio. | PASS |
| 4.3 | `/ece/valoracion-inicial-enfermeria` | Valoración Inicial de Enfermería — registro maestro al ingreso (**NTEC §4**). Filtros por episodio/estado. | PASS |
| 4.4 | `/ece/registro-enfermeria` | Registro de Enfermería — agenda del turno (Turno activo "Matutino 06:00–14:00"). Sin pacientes asignados. | PASS |
| 4.5 | `/ece/evolucion` | Evoluciones médicas — 0 registros, "Nueva evolución", filtros por fecha/autor. | PASS |
| 4.6 | `/ece/estudios` | Estudios (Lab/Imágenes) — solicitudes y resultados (**ECE Doc 18 NTEC**). Pendientes / Con resultado. | PASS |
| 4.7 | `/ece/rectificaciones` | Mis rectificaciones ECE — solicitudes sobre documentos firmados (**NTEC Art. 41**). Se accede desde un documento firmado. | PASS |
| 4.8 | `/ece/kardex` | Kardex de administraciones — entrada por ID de paciente, "Ver kardex". | PASS |
| 4.9 | `/enfermeria/recepcion-farmacia` | Recepción Farmacia — carritos pendientes (tabla: Paciente, MRN, Turno, GLN, Origen, Ítems, Estado). 0 pendientes. | PASS |
| 4.10 | `/medico/substitutions-pending` | Sustituciones pendientes — solicitudes de sustitución de medicamento que requieren autorización del MC. | PASS |

## Hallazgos
Ninguno. Toda la sección renderiza correctamente. Trazabilidad NTEC visible (Doc 6, Doc 18, §4, Art. 41).
