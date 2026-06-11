# Flujo 3 — CLÍNICO (Pacientes, Admisión, Camas, Triaje)

**Estado global: BLOQUEADO por incidente de producción.** Ver `99_incidente_500.md`.

Durante esta sección se detectó primero fallas en rutas específicas y luego una **caída global (HTTP 500)** de toda la aplicación. Los resultados se dividen en lo capturado antes de la caída y lo que quedó bloqueado.

## Capturado antes de la caída

### 3.1 Pacientes `/patients` — PASS (en primera pasada) → luego 500
**Esperado:** Master Patient Index con búsqueda y alta.
**Obtenido (1ª pasada):** Encabezado "Pacientes — Master Patient Index", botón "Nuevo paciente" y campo "Búsqueda" (1 input). Renderizó correctamente.
**Después:** Pasó a devolver "Application error … Digest 1672498537" de forma consistente (3/3 recargas).
**Resultado:** Render inicial OK; no se alcanzó a probar la búsqueda funcional ni la validación DUI/NIT/NIE por la caída.

### 3.2 Censo realtime `/census` — PASS
**Obtenido:** "Censo realtime — Ocupación, movimientos del día y KPIs por servicio (US-5.4). Refresh automático cada 30 segundos." Filtro por servicio ("Todos los servicios"). KPIs: % Ocupación global 0.0% (0/0 operativas), Ingresos hoy 0, Egresos hoy 0. Secciones "Ocupación de camas / Estadísticas por servicio / Movimientos" en estado de carga.
**Resultado:** PASS (estructura y KPIs renderizan; datos en cero — sin actividad o sin camas sembradas en el tenant).

### 3.3 Mapa de camas `/beds` — PARCIAL
**Obtenido:** "Mapa de camas — Estado de ocupación — Cargando…" (no terminó de cargar el mapa en la ventana observada).
**Resultado:** PARCIAL — quedó en estado "Cargando…"; posible carga diferida o sin datos de camas. No verificado a fondo por la caída posterior.

## Rutas que cayeron primero (frente de la saturación — NO bug propio)

Estas cuatro rutas devolvieron 500 (Digest 1672498537) cuando `/patients`, `/census` y `/beds` aún cargaban. Inicialmente parecían fallas propias, pero **al reconfirmarlas con la app estable todas renderizan correctamente** → fueron el **frente** de la saturación del pool de conexiones (las primeras en topar el límite), no errores deterministas de ruta:

| Ruta | Reconfirmación (app estable) |
|---|---|
| `/transfers` (Traslados internos, US-5.3) | **PASS** — "Nuevo traslado", filtro por servicio, "Sin traslados registrados" |
| `/emergency` (Urgencias, §12) | **PASS** — "Nueva visita", filtros por disposición, lista de visitas |
| `/outpatient` (Consulta Externa, §10) | **PASS** — "Nueva cita", filtros, "Sin citas para los filtros" |
| `/patient-id` (Identificación GSRN) | **PASS** — "Escanee la pulsera GSRN…", botón Identificar |

## Reanudado tras la recuperación

Tras recuperarse la app (ver `99_incidente_500.md`), se reprobaron los flujos núcleo con navegación moderada:

### 3.1b Búsqueda de pacientes `/patients` — PASS
**Pasos:** Escribir "zzqxtest" (término sin coincidencias) en el campo "Buscar por nombre, MRN o DUI…".
**Obtenido:** La búsqueda ejecuta y renderiza la tabla de resultados con columnas **MRN / Nombre / Apellido / Fecha nac.**, vacía (sin coincidencias). La consulta tRPC responde correctamente.
**Resultado:** PASS. (No se probó alta de paciente ni se exfiltró PHI real.)

### 3.4 Wizard de admisión `/admission` — PASS (render)
**Obtenido:** "Admisión — Wizard de admisión hospitalaria (US-5.1 / US-5.2)" con stepper de 4 pasos: **1 Paciente › 2 Datos › 3 Cama › 4 Confirmar**. Paso 1 con búsqueda de paciente y botón "Continuar".
**Resultado:** PASS (estructura del wizard). No se completó la admisión (escritura evitada en producción).

### 3.5 Cola de Triaje `/triage` — PASS
**Obtenido:** "Triage Manchester — Cola pendiente" con tabla (columnas Paciente / Encuentro / Llegada / Último triage). Cola vacía (sin pacientes pendientes).
**Resultado:** PASS (vista de cola). La clasificación Manchester de un paciente requiere un encuentro en cola — no se ejecutó por no crear datos.

### 3.6 Monitor de Triaje `/triage/monitor` — PASS
**Obtenido:** "Monitor de Triage — 0 activos · 0 excedidos · actualiza cada 5s", botones Refrescar / Pantalla completa. Cinco niveles Manchester con sus SLAs de espera máxima: 🔴 INMEDIATO (0 min), 🟠 MUY URGENTE (10 min), 🟡 URGENTE (60 min), 🟢 ESTÁNDAR (120 min), 🔵 NO URGENTE. Todos en 0.
**Resultado:** PASS. Niveles y SLAs Manchester correctos.

## Estado consolidado de la sección

| Ruta | Resultado |
|---|---|
| `/patients` (búsqueda) | PASS |
| `/admission` (wizard) | PASS (render) |
| `/census` | PASS |
| `/beds` | PARCIAL (quedó "Cargando…") |
| `/triage` | PASS |
| `/triage/monitor` | PASS |
| `/transfers` | PASS (tras recuperación) |
| `/emergency` | PASS (tras recuperación) |
| `/outpatient` | PASS (tras recuperación) |
| `/patient-id` | PASS (tras recuperación) |

> Reconfirmado: las 4 rutas que cayeron primero **no tienen bug propio**; fueron el frente de la saturación transitoria del pool (incidente P0). Toda la sección CLÍNICO renderiza correctamente con la app estable. Único pendiente real: `/beds` quedó en "Cargando…" en la ventana observada (reverificar).
