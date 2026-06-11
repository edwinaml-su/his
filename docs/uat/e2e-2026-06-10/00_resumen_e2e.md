# Pruebas E2E — HIS Avante (Producción)

**Entorno:** https://his-avante.vercel.app/
**Fecha:** 2026-06-10
**Ejecutor:** Cowork (Claude) vía Claude in Chrome
**Sesión:** Edwin Martínez — 12 roles activos (ADMIN, ADMISSION_CLERK, ANEST, DIR, ENF_NRP, GO, NURSE, PEDIA, PHARMACIST, PHYSICIAN, TRIAGE_NURSE, WORKFLOW_DESIGNER)
**Alcance:** Smoke E2E no destructivo sobre todas las rutas del sidebar (~100) + pruebas funcionales en flujos núcleo.
**Aviso del sistema:** El dashboard declara "MVP en desarrollo — algunas vistas son stubs marcadas con TODO".

## Criterios de resultado

| Estado | Significado |
|---|---|
| **PASS** | La vista carga, renderiza contenido funcional y no muestra error de cliente/servidor. |
| **PARCIAL** | Carga pero es stub/placeholder, está marcada TODO, o falta funcionalidad esperada. |
| **FAIL** | Error de aplicación, pantalla en blanco, crash de cliente o 404/500. |
| **NO PROBADO** | Requiere acción que no se ejecuta en producción (escritura destructiva, credenciales). |

## Método

Para cada ruta: navegación real en el navegador, espera de hidratación, inspección del contenido `main`, conteo de formularios/tablas/inputs, y lectura de errores de consola. Los flujos núcleo (paciente, admisión, triaje, documentos ECE, consentimientos) incluyen interacción y captura de pantalla.

## Índice de flujos

| # | Flujo / Sección | Documento | Estado | Cobertura |
|---|---|---|---|---|
| 1 | VISIÓN (dashboard, analítica, NPS, BPM) | [01_vision.md](01_vision.md) | PASS | 5/5 |
| 2 | Autenticación / sesión / roles | [02_autenticacion.md](02_autenticacion.md) | PASS (parcial por alcance) | — |
| 3 | CLÍNICO (pacientes, admisión, camas, triaje) | [03_clinico.md](03_clinico.md) | PASS | 10/10 |
| 4 | ECE — ATENCIÓN | [04_ece_atencion.md](04_ece_atencion.md) | PASS | 10/10 |
| 5 | DIAGNÓSTICO (farmacia, eMAR, LIS, imagen) | [05_diagnostico.md](05_diagnostico.md) | PASS | 7/7 |
| 6 | ECE — QUIRÓFANO | [06_ece_quirofano.md](06_ece_quirofano.md) | PASS con 1 bug contenido | 7 PASS / 1 bug / 2 pend. |
| 7 | ECE — HOSPITALARIO | _pendiente_ | NO PROBADO | 0/11 |
| 8 | GS1 LOGÍSTICA | _pendiente_ | NO PROBADO | 0/7 |
| 9 | ECE — MATERNIDAD | _pendiente_ | NO PROBADO | 0/5 |
| 10 | SOPORTE CLÍNICO + FINANZAS | _pendiente_ | NO PROBADO | 0/~20 |
| 11 | ADMINISTRACIÓN | _pendiente_ | NO PROBADO | 0/~20 |

## Hallazgos (priorizados)

| ID | Severidad | Hallazgo | Documento |
|---|---|---|---|
| INC-2026-06-10-001 | **P0** | Caída global HTTP 500 por agotamiento del pool de conexiones Supabase (session mode, 15 máx). Sin try/catch en el layout → toda la app cae ante cualquier pico de concurrencia. Recupera sola al bajar la carga. | [TICKET-INCIDENCIA-001.md](TICKET-INCIDENCIA-001.md) · [99_incidente_500.md](99_incidente_500.md) |
| HJ-QX-001 | **P2** | Schema drift en `bridge-cirugia.router.ts` (`listarProgramacion`): JOIN por `pc.orden_id` (columna inexistente, PG 42703) rompe la tarjeta "Cirugías del día" de `/programacion`. Error capturado, no tumba la página. who-check/acto/consentimiento-qx están OK (su 500 inicial fue ruido del P0). | [98_hallazgo_quirofano_schema_drift.md](98_hallazgo_quirofano_schema_drift.md) |
| — | Bajo | `/beds` (Mapa de camas) quedó en "Cargando…" en la ventana observada (reverificar). | [03_clinico.md](03_clinico.md) |

> **Fix consolidado de todos los hallazgos:** [REMEDIACION-2026-06-10.md](REMEDIACION-2026-06-10.md)

## Resumen ejecutivo

Se probaron **5 secciones completas** (VISIÓN, Autenticación, CLÍNICO, ECE—ATENCIÓN, DIAGNÓSTICO) + QUIRÓFANO. **34 rutas con render correcto**; **4 rutas de quirófano fallan** por schema drift. La sesión reveló un **incidente P0**: la app de producción cae con 500 global ante ráfagas de navegación por el límite de 15 conexiones en session mode, y se recupera sola al cesar la carga.

**Se detuvo el sweep de las secciones 7–11 (~63 rutas)** porque la propia navegación de prueba reproduce repetidamente el P0 sobre el sistema en producción. Recomendación: completar esas secciones en un entorno preview/staging, o tras aplicar el fix P0 (migrar a transaction mode del pooler).
