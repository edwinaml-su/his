# Hallazgo HJ-QX-001 — Schema drift en Programación Quirúrgica (`pc.orden_id` no existe)

**Severidad:** P2 (un módulo con una tarjeta inoperante; el error está capturado y NO tumba la página).
**Entorno:** https://his-avante.vercel.app/ (producción) — reproducible con la app sana.
**Componente:** `packages/trpc/src/routers/ece/bridge-cirugia.router.ts`, procedimiento `listarProgramacion` (las dos ramas del `$queryRaw`).

## Síntoma
`/ece/quirofano/programacion` carga, pero la tarjeta "Cirugías del día" muestra:
```
Invalid `prisma.$queryRaw()` invocation: Raw query failed. Code: `42703`. Message: `column pc.orden_id does not exist`
```

> **Nota:** en la primera pasada, who-check / acto-quirúrgico / consentimiento-qx también daban 500 (Digest `2297802693`). **Reconfirmado: era ruido de la saturación del pool (P0); con la app sana cargan bien.** El único bug determinista es éste.

## Causa raíz (confirmada por código + schema)
La query hace:
```sql
LEFT JOIN ece.preop_checklist pc ON pc.orden_id = r.orden_qx_id
```
en `bridge-cirugia.router.ts` (ramas `salaQxId` y `else`). Pero `ece.preop_checklist` **no tiene** columna `orden_id`: se enlaza por `episodio_hospitalario_id` (DDL `sql/67_preop_checklist.sql:26`; `schema.prisma:5858`). El propio archivo ya lo documenta en otro método (líneas ~625: "no existe orden_id … el campo correcto es … — HE-11 fix"), pero la query de `listarProgramacion` quedó sin corregir.

`ece.reserva_sala_qx` (alias `r`) sí tiene `episodio_id` (`schema.prisma:6842`), que apunta al mismo episodio que `preop_checklist.episodio_hospitalario_id`.

## Fix
Reemplazar la condición del JOIN en **ambas ramas** del `$queryRaw`:
```diff
- LEFT JOIN ece.preop_checklist pc ON pc.orden_id = r.orden_qx_id
+ LEFT JOIN ece.preop_checklist pc ON pc.episodio_hospitalario_id = r.episodio_id
```

## Criterios de cierre
- [x] JOIN corregido en ambas ramas (`pc.episodio_hospitalario_id = r.episodio_id`) → ya no lanza PG 42703. Extra: la rama `salaQxId` también tenía un JOIN roto paciente↔episodio (`p.id = r.episodio_id`, 0 filas) — alineada a la rama `else`. Render con datos sembrados queda para UAT.
- [x] Test de regresión `bridge-cirugia.router.test.ts` #10 — captura el template del `$queryRaw` y asserta el JOIN correcto en ambas ramas (tests del router son mock-based; ejecución contra BD real es E2E/UAT).
- [x] Paridad `schema.prisma` ↔ SQL para `preop_checklist`: modelo Prisma `EcePreopChecklist` reconciliado con `sql/67` (era un stub con `episodio_id`/`datos` inexistentes; ahora refleja `episodio_hospitalario_id` + ítems clínicos). `prisma generate` + typecheck verdes.

**Aplicado:** 2026-06-10 por @Dev. Archivo: `packages/trpc/src/routers/ece/bridge-cirugia.router.ts`, `packages/database/prisma/schema.prisma`. Trazabilidad: `docs/26_trazabilidad_matrix.md` §9.

---

## Addendum (2026-06-10) — el drift era de todo el módulo (HJ-QX-002)

Al verificar el criterio del CHECK de `preop_checklist` contra prod (Supabase MCP), se descubrió que **el bug del JOIN era la punta del iceberg**: `bridge-cirugia.router.ts` se escribió contra un esquema ECE anterior y casi todas sus sentencias raw chocan con el DDL endurecido. Confirmado contra prod (constraints + columnas + enums vivos):

| # | Proc. | Desajuste |
|---|---|---|
| 1 | programar | `orden_ingreso.instancia_id` NOT NULL no se proveía (patrón instancia-first ausente) |
| 2 | programar | `orden_ingreso.estado_registro='borrador'` (CHECK vigente/rectificado) |
| 3 | programar | `orden_ingreso.modalidad='hospitalario'` (CHECK hospitalizacion/hospital_de_dia) |
| 4 | programar | `orden_ingreso.procedencia='interno'` (CHECK 6 valores, ninguno interno) |
| 5 | programar | `episodio_atencion.estado='programado'` (enum abierto/en_curso/cerrado/cancelado) |
| 6 | programar | `episodio_atencion.servicio_categoria='cirugia'` (CHECK no lo incluye) |
| 7 | programar | `episodio_hospitalario.servicio_ingreso_id` (columna real: `servicio_id`) |
| 8 | cancelar | `preop_checklist.estado_registro='cancelado'` (el hallazgo original) |
| 9 | cancelar | `episodio_atencion.fecha_hora_fin` (columna real: `fecha_hora_cierre`) |
| 10 | cancelar | `orden_ingreso.estado_registro='cancelado'` + `motivo_cancelacion` (columna inexistente) |
| 11 | cancelar | guard `includes(estado_registro)` con palabras de workflow → nunca matchea |
| 12 | read | `listProgramacionDia` selecciona `pac.nombre_completo`, pero `ece.paciente` no tiene columna de nombre → 42703 (el nombre vive en `public."Patient"`) |

**Causa raíz:** el estado de *workflow* vive en `documento_instancia` (motor), no en `estado_registro` (ciclo de auditoría: vigente/rectificado). El router metió vocabulario de workflow en columnas de auditoría/enum/inexistentes.

**Decisión (Edwin, 2026-06-10):** alinear el router al DDL (no relajar constraints). Reescritura espejando el canónico `orden-ingreso.router.ts`.

**Validación contra prod (sin persistir):**
- Read path (`listProgramacionDia`): ejecutado en vivo vía MCP → 0 filas, sin error → todas las columnas/joins válidos.
- Write path (`programarCirugia` + `cancelarPrograma`): dry-run transaccional `DO $$ … RAISE` (BEGIN…ROLLBACK) con FKs reales fabricadas → todas las sentencias ejecutan limpio (columnas, CHECK, NOT NULL, FK, trigger estado-log) → `DRYRUN_OK_ROLLBACK`, nada persistió.

**Pendiente (no es código):** sembrar datos maestros ECE de quirófano (`ece.personal_salud`, `ece.sala_qx` están en 0) antes de habilitar la feature; validación E2E con la app.
