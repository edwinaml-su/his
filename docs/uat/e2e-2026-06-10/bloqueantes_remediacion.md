# Bloqueantes de la remediación de drift ECE (2026-06-11)

> De los ~28 routers con drift, **24 quedaron alineados al DDL** (typecheck trpc+web verde, 2560 tests verdes). Estos **5 ítems NO se pudieron cerrar solo alineando el router**: requieren una **decisión de DDL o de diseño** (la tabla está incompleta, falta, o tiene un conflicto). No los apliqué a producción por ser tablas clínicas/legales sensibles y necesitar criterio @DBA/@AS.

## Estado de la remediación — ✅ TODOS RESUELTOS (2026-06-11)
| | |
|---|---|
| ✅ Routers alineados al DDL | 24 (incl. bridge-cirugia) |
| ✅ Bloqueantes B1–B5 | resueltos (ver abajo) |
| DDL aplicado a prod (MCP) | sql/165–168 (drops + 14 columnas + jerarquía) |
| Verificación | typecheck trpc+web verde · 2542 tests verde |

**Resumen de cierre:**
- **B1** (CHECK contradictorios) → drop 4 legacy (`sql/165`).
- **B2** (rectificacion) → flujo de aprobación en `solicitud_arco` + registro inmutable en `rectificacion` (`sql/166`); procedures `aprobar/rechazar/firmar` restaurados.
- **B3** (certificado-defuncion) → +6 columnas legales (`sql/167`); router instancia-first preservando contrato UI.
- **B4** (gs1_gln) → +`id`/`parent_id`/`establecimiento_id` (`sql/168`, `codigo` sigue PK por 10 FKs); jerarquía habilitada.
- **B5** (bedside-hardstops) → eliminado (código muerto, no cableado).

Commits: `8879007` (quirófano) · `eb6ea0b` (23 routers) · `97d0924` (UI+reverts) · `6a1b92d` (B1 drops) · `589ab4a` (B1–B5). Todo **local, sin push**.

> Histórico de cada bloqueante (cómo estaba antes de resolverse) abajo.

---

## B1 — CHECK duplicados contradictorios — ✅ RESUELTO (2026-06-11)
**Era:** tres columnas tenían DOS CHECK contradictorios cada una (Postgres exige ambos → tabla inescribible):
- `administracion_medicamento.estado`: `{administrado,omitido,diferido}` vs `chk_admin_med_estado {PROGRAMADA,...}`.
- `historia_clinica.estado_registro`: `chk_hc_estado_registro {borrador,firmado,validado,anulado}` vs legacy `{vigente,rectificado}`.
- `indicaciones_medicas.estado_registro` y `.vigencia`: workflow `{borrador,...}`/`{ACTIVA,...}` vs legacy `{vigente,rectificado}`/`{activa,suspendida,modificada}`.

**Aplicado vía MCP execute_sql** (autorizado): `DROP CONSTRAINT` de los 4 legacy
(`historia_clinica_estado_registro_check`, `indicaciones_medicas_vigencia_check`,
`indicaciones_medicas_estado_registro_check`, `chk_admin_med_estado`). Verificado:
cada columna queda con un solo CHECK (el de workflow). Dry-run de insertabilidad
confirma que `borrador`/`ACTIVA`/`administrado` pasan el CHECK (solo bloquea FK/trigger,
esperado). Desbloquea `registro-enfermeria`, `indicaciones-medicas`, `historia-clinica`.

> Nota 1: `chk_motivo_omision_requerido` (admin_med) referencia mayúsculas `OMITIDA/RECHAZADA`; con el router escribiendo `omitido` minúsculas no dispara — inofensivo (no se recreó, por instrucción).
> Nota 2: `indicaciones_medicas` tiene además un trigger JCI **IPSG.1** (`IPSG1_WRISTBAND_REQUIRED`) que exige GSRN de pulsera del paciente — lógica de negocio correcta, no drift.
> ⚠️ Reproducibilidad: el DROP se aplicó solo en prod (execute_sql). Recomendado un `sql/NNN_*.sql` numerado que documente los drops, para que un rebuild desde `packages/database/sql/` no recree los constraints legacy.

## B2 — `ece-rectificacion`: tabla append-only vs workflow de aprobación en UI
**Impacto:** la UI (`/ece/rectificaciones/cola`) llama `aprobar`/`rechazar`/`firmar`; la tabla `rectificacion` es **append-only** (`documento_original_id, tabla_origen, motivo, usuario_id, hash_original, campo, valor_anterior, valor_nuevo`) — **no tiene columna de estado** para un flujo aprobar/rechazar. El agente había eliminado esos procedures (rompía la UI) → **revertido** para preservar el contrato.
**Decisión necesaria:** ¿dónde vive el estado de aprobación? Opciones: (a) agregar `estado/aprobador_id/fecha` a `rectificacion`; (b) modelar la aprobación en `solicitud_arco` (que sí tiene estado PENDIENTE/APROBADA/RECHAZADA/EJECUTADA); (c) flujo vía `documento_instancia`. Necesita @AS/@DBA.

## B3 — `certificado-defuncion`: tabla NTEC sin campos legales del formulario
**Impacto:** la UI (`/deaths/*`, `/ece/defuncion/*`) recolecta `lugar_defuncion`, `manera`, `autopsia_realizada`, `observaciones`, `motivo_anulacion`; la tabla `certificado_defuncion` **no los tiene** (sí tiene `clasificacion`, que mapea a "manera"). El agente alineó el router quitando esos campos (rompía la UI) → **revertido** para preservar el formulario legal.
**Decisión necesaria:** un certificado de defunción SV legalmente requiere lugar/manera de defunción. **Recomendado: ALTER ADD COLUMN** `lugar_defuncion text`, `autopsia_realizada boolean`, `observaciones text`, `motivo_anulacion text` (o confirmar que viven en otra tabla). Necesita @DBA + validación legal NTEC.

## B4 — `gs1_gln`: sin `id`/`parent_id` → jerarquía GLN imposible
**Impacto:** `gs1-gln-hierarchy` (UI `/gs1/gln`, árbol de localizaciones) y el sub-router GLN de `gs1-catalogos` asumen `gs1_gln.id` (uuid) + `parent_id`; la tabla real tiene PK `codigo` y **sin** `id`/`parent_id`. La CTE recursiva del árbol es inviable. Routers **revertidos** para preservar el contrato UI.
**Decisión necesaria:** la jerarquía GLN (árbol padre-hijo de ubicaciones) es una feature real. **Recomendado:**
```sql
ALTER TABLE ece.gs1_gln ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE ece.gs1_gln ADD COLUMN parent_id uuid REFERENCES ece.gs1_gln(id);
ALTER TABLE ece.gs1_gln ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX ON ece.gs1_gln(codigo);
```
Luego revertir los routers a la CTE recursiva. Necesita @DBA.

## B5 — `bedside-hardstops`: 3 tablas inexistentes
**Impacto:** el router referencia `ece.indicacion_bedside`, `ece.gs1_gtin_lote`, `ece.bedside_hard_stop_log` — **ninguna existe**. El router **NO está registrado en `_app.ts`** (no es endpoint, no cableado a UI).
**Decisión necesaria:** la lógica de hard-stops ya existe en `bedside.router.ts` (`validate5Correctos`). **Recomendado: eliminar `bedside-hardstops.router.ts`** (código muerto) o, si se quiere la bitácora de hard-stops, crear las 3 tablas (DDL nuevo). Necesita decisión @AS.

---

## Recomendación de cierre
B1 (CHECK admin_med) y B5 (borrar bedside-hardstops) son de bajo riesgo y rápidos — candidatos a cerrar ya con un visto bueno. B2/B3/B4 tocan modelo de datos clínico/legal → @DBA + @AS deciden (agregar columnas/tablas vs re-modelar). Todos los routers afectados quedaron en su **contrato UI original** (no se rompió ninguna pantalla), pendientes del fix de DDL.
