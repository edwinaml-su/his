# REQ CC-0026 — Indicación médica → tareas por área + tableros de seguimiento

| | |
|---|---|
| Solicitante | Edwin Martínez (Avante) |
| Fecha | 2026-08-26 |
| Mockup | `docs/CC/0026/avanteindicacionmedicamockup (1).html` (fuente de verdad visual) |
| Estado | Aprobado por Edwin — diseño D1/D2/D3 confirmado |
| Recon técnico | conversación @Orq 2026-08-26 (agente Explore, 6 áreas auditadas) |

## Directiva del solicitante (verbatim funcional)

1. Cada indicación médica firmada **crea una tarea asignada a enfermería** para
   seguimiento y cumplimiento.
2. Signos vitales y exámenes de laboratorio **NO se reimplementan**: llaman a
   las secciones preexistentes (capturador CC-0012; órdenes LIS CC-0013).
   Laboratorio e imágenes generan además tareas para sus áreas respectivas.
3. **Tableros independientes por área** (pantalla de seguimiento de actividades):
   quirófano, laboratorio, imágenes, enfermería, sala de espera, emergencia,
   UCI, UCIN, máxima urgencia, etc.
4. Del mockup se EXCLUYEN sticky header y calculadoras (ya integrados al HIS).

## Mockup — 8 categorías del CPOE

mov (Movimiento de paciente: ingreso/pase/traslado/referencia/remisión, cascada
por sede con catálogo real de pisos/servicios/habitaciones de las 3 sedes) ·
dieta · cuidados (20 subsecciones CUI_SECTIONS, regla abierta=registra /
contraída=no / todas resueltas para agregar; O₂ Venturi flujo↔FiO₂; VMNI/VMI) ·
med (catálogo + cargos a cuenta) · lab (prioridad Rutina/Urgente/STAT + muestra) ·
gab (modalidad + región + prioridad) · proc (consentimiento) · inter
(especialidad). Firma: INICIAL → SUBSECUENTE con deadline 24h (chip countdown,
warn <6h).

## Decisiones de diseño aprobadas

**D1 — `CareTask` persistida (SQL 209).** Tarea de primera clase en `public`:
área (`serviceUnitId`), `assignedRoleCode` (NURSE/LAB_TECH/RAD_TECH/…),
`assigneeId?`, fuente polimórfica (`sourceType`+`sourceId`:
INDICACION_ITEM|LAB_ORDER|IMAGING_ORDER|TRANSFER), estados
`PENDIENTE→EN_PROCESO→CUMPLIDA|CANCELADA`, `dueAt` desde SLA, RLS por org.
La bandeja `/tareas` (workflow-inbox, 100% derivada) NO se toca en este CC.

**D2 — Ruteo al firmar** (consumer síncrono en `firmar()`, patrón
`mar-consumer.ts`): toda categoría → tarea NURSE en la unidad del episodio;
lab → crea `LabOrder` real (LIS) + tarea área LAB; gab → `ImagingRequest`
real + tarea área RX; subsección signos vitales → tarea que abre
`SignosVitalesModal` (CC-0012) desde el tablero. Medicamentos → catálogo
`Drug` del HIS (NO el MED_DATA embebido) ⇒ captura `drugId` estructurado
(cierra parcialmente R06 en el punto de prescripción).

**D3 — Tableros.** `/tableros/[unidad]` genérico sobre `ServiceUnit` +
columna nueva `areaType` + seed de SALA_ESPERA y MAX_URG (hoy inexistentes,
0 grep). Enfermería = rol, no unidad: su tablero filtra
`assignedRoleCode=NURSE` en la(s) unidad(es) del usuario.

## Hechos verificados que condicionan la implementación

- `ece.indicaciones_medicas` = **0 filas en prod** (verificado 2026-08-26 vía
  MCP): el módulo nunca corrió end-to-end. SQL 201 SÍ está aplicado.
- Cola bedside rota por 2 defectos independientes (`estado_registro='vigente'`
  no existe en el CHECK `{borrador,firmado,validado}`; JOIN exige
  `instancia_id` que `create()` nunca escribe) → Ola 0.
- `firmar()` corre bajo **`withEceContext`** → GUCs de
  `ece.set_ece_context(personal, establecimiento)`, NO `app.current_org_id`.
  Las policies de `CareTask` deben contemplar el espacio de GUC correcto
  (trampa documentada 2026-08-18).
- `authenticated` NO tiene INSERT en `audit."AuditLog"` (bloqueante #1
  conocido): `CareTask` NO lleva trigger de auditoría en esta ola.
- Ítems ESTUDIO/PROCEDIMiento hoy son callejón sin salida (0 refs a
  LabOrder/ImagingOrder en el router de indicaciones).
- SLA imágenes ya declarado: STAT 60' / URGENT 240' / ROUTINE 1440'.

## Olas

| Ola | Contenido |
|---|---|
| 0 | Reparar cola bedside + smoke de `firmar()` end-to-end |
| 1 | SQL 209 CareTask + RLS + modelo Prisma + router `care-task` + generación en `firmar()` |
| 2 | `/ece/indicaciones/nueva` extendida al mockup (8 categorías; fidelidad §CLAUDE.md) |
| 3 | `/tableros/[unidad]` + `ServiceUnit.areaType` + seeds |
| 4 | E2E + trazabilidad docs/44 |
