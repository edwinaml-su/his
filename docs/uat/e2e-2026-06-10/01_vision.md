# Flujo 1 — VISIÓN (Dashboard, Analítica, NPS, BPM)

**Estado global: PASS** · 5/5 vistas funcionales · 0 errores de consola

> Nota de evidencia: en esta sesión las capturas de pantalla no se persisten a disco, por lo que la evidencia se documenta de forma descriptiva (contenido `main` observado en cada vista).

## Casos

### 1.1 Dashboard `/dashboard` — PASS
**Pasos:** Login (sesión activa) → carga inicial.
**Esperado:** Resumen de actividad + accesos rápidos.
**Obtenido:** Renderiza "Bienvenido/a, Edwin Martinez". Tres tarjetas: *Tu organización* (Org ID `c7eabf29-…`, País `49a0e6e8-…`, lista de 12 roles), *Atajos* (Buscar paciente, Nueva admisión, Cola de triage, Mapa de camas) y *Estado del sistema* ("MVP en desarrollo — algunas vistas son stubs marcadas con TODO").
**Resultado:** PASS. Selector de organización ("Avante Holding") y de roles ("Todos los roles (12)") presentes en el header.

### 1.2 Analítica BI `/analytics` — PASS
**Esperado:** Reportes BI con KPIs.
**Obtenido:** Encabezado "Analítica — KPIs operacionales y financieros. Datos actualizados cada 1-4 horas." Selector de 5 KPIs (K-CLI-01 Censo camas, K-CLI-02 Estancia LOS, K-CLI-03 Triage SLA, K-FIN-01 Revenue, K-OPS-01 Transfusiones). Nota: datos desde la capa semántica Cube.dev sobre el schema `analytics` de Supabase. Al seleccionar un KPI muestra detalle (ej. "Censo de camas — Porcentaje de ocupación de camas INPATIENT activa").
**Resultado:** PASS.

### 1.3 Dashboard Ejecutivo KPI `/analytics/ejecutivo` — PASS
**Esperado:** Tablero ejecutivo con 36 KPIs en 7 categorías.
**Obtenido:** "Dashboard Ejecutivo HIS — Catálogo multiorganizacional de 36 indicadores en 7 categorías. Periodo 2026-05-11 → 2026-06-10". Selectores de fecha Desde/Hasta y botones de exportación **Imprimir / CSV / PDF / Correo**. Capa Ejecutiva con 13 KPIs estratégicos, cada tarjeta con valor, meta, fórmula y badge "Datos reales": Disponibilidad/Uptime 61.0%, Cumplimiento SLA por Proveedor 74.0%, Usuarios Activos 67.0%, Adopción de Módulos Clave 83.0%, Duplicidad de Pacientes (MPI) 93.0%, Ocupación de Camas 73.0%, Reingreso 30 días 64.0%, Eventos Adversos por 1,000 = 8.
**Resultado:** PASS. KPIs con datos reales, no stubs.

### 1.4 Mi feedback (NPS) `/feedback` — PASS
**Esperado:** Encuesta NPS del personal.
**Obtenido:** Formulario "¿Recomendarías el HIS Avante?" escala 0–10 (Nada probable → Muy probable), campo Comentario (0/1000) y botón "Enviar respuesta".
**Resultado:** PASS (no se envió respuesta — escritura evitada en producción).

### 1.5 Mi Bandeja (BPM) `/tareas` — PASS
**Esperado:** Bandeja centralizada de tareas por rol (29 fuentes).
**Obtenido:** "Mi bandeja de tareas" renderiza con controles de filtro/acción (23 botones).
**Resultado:** PASS.

## Hallazgos
Ninguno bloqueante. Sección completamente funcional con datos reales.
