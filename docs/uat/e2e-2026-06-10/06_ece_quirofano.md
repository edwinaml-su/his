# Flujo 6 — ECE — QUIRÓFANO

**Estado global: PASS con 1 bug contenido** · 7 vistas PASS · 1 sección con error capturado · 2 no probadas.

> **Corrección metodológica:** en la primera pasada, who-check / acto-quirúrgico / consentimiento-qx aparecieron en 500 (Digest `2297802693`). Reconfirmados **con la app sana, los tres cargan correctamente** → eran ruido de la saturación del pool (incidente P0), NO bugs propios. El único bug real y reproducible es el de `/programacion` (`pc.orden_id`), detallado en [`98_hallazgo_quirofano_schema_drift.md`](98_hallazgo_quirofano_schema_drift.md).

| # | Ruta | Vista | Resultado |
|---|---|---|---|
| 6.1 | `/ece/quirofano` | Dashboard Quirófano — "Pacientes en tránsito (0)", Alertas, Salas. | PASS |
| 6.2 | `/surgery` | Cirugía — landing del módulo. | PASS (mínimo) |
| 6.3 | `/ece/quirofano/preop` | Preoperatorio — Lista de verificación. "Nuevo checklist", búsqueda por UUID de episodio. | PASS |
| 6.4 | `/ece/quirofano/programacion` | Programación Quirúrgica — la página carga (filtros Fecha / Sala QX) pero la tarjeta **"Cirugías del día"** muestra (reproducible, app sana): `Raw query failed. Code: 42703. Message: column pc.orden_id does not exist`. Error **capturado** dentro de la tarjeta — no tumba la página. | **BUG contenido** |
| 6.5 | `/ece/quirofano/who-check` | WHO Surgical Safety Checklist — "Falta el parámetro actoId en la URL. Accede desde el acto quirúrgico correspondiente." (validación esperada). | PASS |
| 6.6 | `/ece/quirofano/acto-quirurgico` | Actos quirúrgicos — ECE §3.13, registros inmutables post-firma, filtros por episodio/estado. | PASS |
| 6.7 | `/ece/quirofano/consentimiento-qx` | Consentimientos quirúrgicos — CONS_QX, NTEC §4.12, doble firma, inmutables. | PASS |
| 6.8 | `/ece/registro-anestesico` | Registro anestésico | NO PROBADO |
| 6.9 | `/ece/urpa` | URPA (recuperación post-anestésica) | NO PROBADO |

## Análisis
Único hallazgo confirmado: `/programacion` ejecuta un `$queryRaw` en `bridge-cirugia.router.ts` con `LEFT JOIN ece.preop_checklist pc ON pc.orden_id = r.orden_qx_id`, pero `preop_checklist` no tiene columna `orden_id` (se enlaza por `episodio_hospitalario_id`). El error está capturado y mostrado en la tarjeta (degradación correcta). Fix concreto en `REMEDIACION-2026-06-10.md`.

> Las rutas 6.8–6.9 quedan pendientes (se detuvo el sweep por el P0). Reverificar en preview/local.
