# REQ-LIS-EX-002 — Vista «Estudios» del tablero LIS + entrada de menú

| Campo | Valor |
|---|---|
| Control de cambios | **CC-0013b** (iteración 2 del CC-0013) |
| Fecha | 2026-07-29 |
| Solicitante | Edwin Martínez (Inversiones Avante) |
| Rama | `feat/cc-0013b-lab-tablero-estudios` |
| SQL | No requiere (reutiliza modelo CC-0013) |

## 1. Requerimiento
1. El módulo de laboratorio no se encontraba: la entrada del menú «Laboratorio (LIS)» apuntaba a la cola de validación de resultados (`/lis/results`) y no a la asignación/tablero (`/lis/orders`).
2. Tablero que visualice **todos los estudios en todos los estados** (Creado / En proceso / Hecho) con **grid de consulta** y búsqueda por **centro, estado, fecha y paciente**.

## 2. Entregado
- **Menú**: «Laboratorio (LIS)» → `/lis/orders` (asignación + tablero). El wayfinding táctil (kiosko) tenía el mismo defecto y se corrigió. Enlaces cruzados: toolbar «Resultados (validación)» → `/lis/results` y botón de regreso en results.
- **Vista «Estudios»** (`/lis/orders?vista=estudios`, ahora la vista default): KPIs (Total/Creados/En proceso/Hechos) + filtros combinables — texto por paciente/expediente, centro (solicitante o ejecutor), estado, rango de fechas — + grid a nivel de examen (Paciente+expediente, Cuenta, Examen, Sección, Centro, Fecha, Prioridad, Estado con pills del mockup CC-0013) con paginación por cursor.
- Mapeo de estados: **Creado** = DRAFT/ORDERED/COLLECTED · **En proceso** = IN_PROCESS · **Hecho** = RESULTED/VALIDATED · **Anulado** = CANCELLED (solo bajo filtro explícito).
- Fila clickeable → modal de solicitud (reutilizado del tablero por cuenta, extraído como componente compartido) para gestionar estados/instrucciones. Procedure nuevo `order.estudios` + `order.cuentaModal`.

## 3. Notas
- Las tabs quedan: **Estudios** (default) · Tablero por cuenta · Lista. Los KPIs de Estudios respetan los filtros activos (excepto el de estado, para que los contadores sirvan de resumen).
