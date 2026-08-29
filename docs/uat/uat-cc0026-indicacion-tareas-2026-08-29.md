# UAT — CC-0026: Indicación médica firmada → tareas por área + órdenes reales + tableros — 2026-08-29

| | |
|---|---|
| Ambiente objetivo | **Producción** — https://his-avante.vercel.app |
| Evaluador | Edwin Martínez (ejecución en prod) · @DrHIS (autor del guion; dry-run en stack local de test 2026-08-29) |
| Alcance | Circuito CC-0026 completo: CPOE 8 categorías → firma MC → CareTask por área + LabOrder/ImagingRequest reales + cola farmacia → tableros `/tableros` |
| Referencias | `docs/CC/0026/REQ-CC-0026-indicacion-tareas-tableros.md` (D1/D2/D3) · `docs/flujos/IND_MED.md` (ficha NTEC Doc 6) · PR #572 (implementación) · PR #577 (fix outbox que desbloqueó la firma) |
| Estado del circuito en prod | **CERO uso real** verificado 2026-08-29: 0 indicaciones firmadas, 0 ítems, 0 CareTask. Este guion parte desde cero, precondiciones incluidas. |

---

## 1. Objetivo y alcance

### Qué valida

1. **D2 — Ruteo al firmar.** Una indicación firmada por el médico genera, en una sola transacción:
   - una **tarea de enfermería** (`CareTask` rol NURSE) por cada ítem de movimiento / dieta / cuidados / **medicamento** / procedimiento / interconsulta;
   - por cada ítem de **laboratorio**: una **LabOrder real** (LIS, estado ORDERED) + una CareTask del área LABORATORIO (LAB_TECHNICIAN) — **sin** tarea de enfermería;
   - por cada ítem de **gabinete**: un **ImagingRequest + ImagingOrder reales** + una CareTask del área IMAGENES (RAD_TECHNICIAN) — **sin** tarea de enfermería;
   - los ítems de medicamento además se materializan a la **cola de conciliación farmacia/eMAR** (`ece.indicacion_farmacia_pendiente`).
2. **D1 — Persistencia.** Las tareas quedan en `public."CareTask"` con trazabilidad a su fuente (`sourceType`/`sourceId`), prioridad y SLA (STAT 60' / Urgente 240' / Rutina 1440' en estudios).
3. **D3 — Tableros.** `/tableros` muestra el grid de áreas con conteos; `/tableros/enfermeria` (rol transversal) y `/tableros/[unidad]` (Laboratorio, Imágenes) muestran las tareas y permiten Iniciar → Completar / Cancelar.
4. **Regla de tipo INICIAL/SUBSECUENTE + plazo 32 h** (SQL 210, server-side): la primera indicación del episodio se firma como INICIAL; las siguientes como SUBSECUENTE; el chip de 32 h informa el plazo.
5. **Atomicidad**: si cualquier materialización falla, la firma completa revierte con mensaje claro (la indicación queda en borrador, nada a medias).

### Qué NO valida

- Administración de medicamentos (eMAR/BCMA, `registrarAdministracion`) — circuito aguas abajo, UAT aparte.
- Procesamiento LIS/RIS posterior (toma de muestra, resultado, validación) — solo se verifica que la orden **nace**.
- La bandeja `/tareas` (workflow-inbox) — explícitamente fuera del CC-0026 (D1).
- Kioscos/menú táctil, cálculo de cargos a cuenta del ítem medicamento (se anota el rubro pero el ciclo de cobro es otra UAT).
- Regla de dependencias documentales del motor ECE (HOJA_ING firmada, etc.) — la creación de indicación no pasa hoy por `documento_instancia`.

---

## 2. Precondiciones — crear desde cero en producción

> Producción está en cero en este circuito. Ejecutar **en orden**. Donde dice “(BD)” la verificación es con query de solo lectura del Anexo A (la corre @Orq vía MCP; Edwin no necesita tocar la BD).

| # | Precondición | Cómo se cumple | Rol necesario |
|---|---|---|---|
| P1 | Sesión iniciada con **establecimiento activo** seleccionado | Login en https://his-avante.vercel.app y elegir org + establecimiento | Cualquiera |
| P2 | Usuario **médico** con rol `PHYSICIAN` (o `MC`) en la org | Verificar en administración de usuarios; si no existe, crearlo/asignar rol antes de empezar. `firmar()` es exclusivo de este rol | ADMIN |
| P3 | Usuario **enfermería** con rol `NURSE` (para operar el tablero) | Ídem P2 | ADMIN |
| P4 | **ECE inicializado** para el establecimiento (existe `ece.establecimiento` para el `Establishment` activo) | (BD) Anexo A, query A-0a. Si falta, la pantalla de indicaciones rechaza con “**ECE no inicializado para este establecimiento.**” — es bloqueador, no seguir | @Orq |
| P5 | **Unidades de servicio con área clasificada**: al menos una `ServiceUnit` activa con `areaType='LABORATORIO'` y una con `areaType='IMAGENES'` en el establecimiento (SQL 212) | (BD) Anexo A, query A-0b. ⚠ Sin esto las tareas de lab/imágenes nacen **sin unidad** y no aparecen en ningún tablero (ver Hallazgos H-02) | @Orq |
| P6 | **Catálogos** poblados: laboratorio (CC-0013, PORTAFOLIO_EX), imágenes (CC-0016) y medicamentos (`Drug`) para el tenant | (BD) Anexo A, query A-0c. Ya sembrados en prod según CC-0013/CC-0016; solo confirmar | @Orq |
| P7 | **Paciente de prueba** registrado | UI: **Pacientes → Nuevo** (`/patients/new`). Usar paciente ficticio identificable (p. ej. apellido “UAT CC0026”), documento de prueba | Admisión / ADMIN |
| P8 | **Admisión hospitalaria activa** del paciente | UI: **Admisión** (`/admission`): elegir el paciente, **Tipo de admisión** = `SCHEDULED` (programada) o `EMERGENCY`, **Servicio**, **Centro de costo**, **Moneda**, **Motivo de consulta**; asignar cama; confirmar. Esto crea el `Encounter` y, por hook automático, el **episodio ECE** (`ece.episodio_atencion` estado `abierto`) con el bridge paciente↔MPI | Admisión |
| P9 | **UUID del episodio** a mano | UI: **Pacientes → [paciente de P7] → pestaña “Admisiones”** → click en la fila de la admisión recién creada → se abre `/ece/admision/{UUID}` (o `/ece/episodio-hospitalario/{UUID}`). **El UUID de la URL es el episodio** que piden las indicaciones. Alternativa: (BD) Anexo A, query A-0d | Cualquiera clínico |

**Nota clínica:** la ficha `docs/flujos/IND_MED.md` exige HOJA_ING firmada como dependencia documental del Art. 36; el circuito actual no la impone en `firmar()`. Para esta UAT basta el episodio abierto de P8; la brecha se registra en Hallazgos si aplica.

---

## 3. Guion paso a paso

Escenario base: *paciente hospitalizado programado; el médico tratante pasa visita y deja la indicación inicial del día: dieta blanda, un antibiótico IV, un hemograma urgente y una radiografía de tórax.*

Convención de resultado: **Pasa / Falla / No verificado** (sin “parcial”). Evidencia obligatoria en los Pasa de pasos críticos (captura o id de registro).

### Escenario A — Creación y firma de la indicación INICIAL (médico, rol PHYSICIAN)

| # | Acción | Resultado esperado (verificable) | Resultado | Evidencia |
|---|---|---|---|---|
| A1 | Con el usuario médico (P2), ir a **/ece/indicaciones**, pegar el UUID del episodio (P9) en el filtro **“Episodio”** y pulsar **“Nueva indicación”** | Se abre `/ece/indicaciones/nueva?episodioId={UUID}`. El campo **Episodio** aparece precargado y bloqueado con la leyenda “Episodio cargado desde la ficha hospitalaria.” | | |
| A2 | Observar la barra **“Tipo de indicación”** | Selector muestra **Inicial** (episodio sin firmas previas) y el chip informa: “Subsecuente: requerida como máximo 32 h después de cada indicación”. El botón de firma dice **“✍ Firmar indicación inicial (0 renglones)”** y está **deshabilitado** | | |
| A3 | Abrir la tarjeta **“Dieta” 🍽️** → llenar la indicación nutricional → **“+ Agregar”** | El modal cierra y la línea aparece en el cuadro de la categoría Dieta. El contador del botón de firma sube a “(1 renglones)” | | |
| A4 | Abrir **“Medicamentos” 💊** → buscar con 3+ letras un producto del catálogo real (p. ej. “ceft”) → seleccionar → **Dosis** (ej. 1), **Unidad**, **Vía** (IV), **Frecuencia** (c/8h — ⚠ el default del modal es “STAT (inmediato)”, ver H-08: elegir SIEMPRE la frecuencia real), **Cantidad a cargar** → **“+ Agregar”** | La línea de medicamento aparece con dosis · vía · frecuencia. Contador “(2 renglones)” | | |
| A5 | Abrir **“Exámenes de laboratorio” 🧪** → buscar “hemograma” (catálogo LIS) → seleccionar → **Prioridad = Urgente**, **Tipo de muestra = Sangre** → **“+ Agregar”** | Línea con “… · Urgente · muestra: Sangre”. Contador “(3 renglones)” | | |
| A6 | Abrir **“Exámenes de gabinete” 🩻** → buscar “tórax” (o el estudio Rx disponible) → seleccionar (la **Modalidad** se resuelve sola desde el catálogo) → **Prioridad = Rutina**, región anatómica → **“+ Agregar”** | Línea con estudio · modalidad · prioridad. Contador “(4 renglones)” | | |
| A7 | Pulsar **“✍ Firmar indicación inicial (4 renglones)”** | La firma ejecuta **sin pedir PIN** (ver H-04). Toast **“Indicación firmada”** con descripción **exacta**: “**2 tarea(s) de enfermería · 1 orden(es) de laboratorio · 1 solicitud(es) de imágenes generada(s).**” y redirección a `/ece/indicaciones`. ⚠ Si el toast no alcanza a verse por la redirección (H-01), los contadores se verifican con los pasos B y las queries del Anexo A | | |
| A8 | En `/ece/indicaciones` (mismo episodio en el filtro) | La indicación aparece con estado **firmado** y vigencia **Activa** | | |

> **Punto de control D2:** 4 renglones → **2** tareas NURSE (dieta y medicamento). Lab y gabinete **no** generan tarea de enfermería: generan la orden real + la tarea de su área ejecutora. Si el toast de A7 reporta 3 o 4 tareas de enfermería, **Falla** (“los estudios no se hacen para enfermería” — decisión D2 corregida por Edwin 2026-08-26).

### Escenario B — Tableros por área

| # | Acción | Resultado esperado (verificable) | Resultado | Evidencia |
|---|---|---|---|---|
| B1 | Ir a **/tableros** (menú lateral: “Tableros por área”) | Grid de tarjetas. **“Enfermería”** muestra **2 pendientes**; la unidad con área **Laboratorio** muestra **1 pendiente**; la de **Imágenes**, **1 pendiente**. Las tarjetas se refrescan solas cada 15 s | | |
| B2 | Entrar a **/tableros/enfermeria** | Columnas **Pendiente / En proceso / Cumplida hoy**. En Pendiente: **2 tarjetas** (la dieta y el medicamento) con nombre y MRN del paciente de P7, tipo `IND_DIETA` / `IND_MED_CUMPLIR`, prioridad Normal. **No** aparecen el hemograma ni la radiografía | | |
| B3 | Entrar al tablero de la unidad **Laboratorio** | 1 tarjeta: el hemograma, tipo `LAB_TO_PROCESS`, prioridad **Alta** (Urgente) y vencimiento “vence …” a **240 min** de la firma | | |
| B4 | Entrar al tablero de la unidad **Imágenes** | 1 tarjeta: la radiografía, tipo `IMAGING_TO_PERFORM`, prioridad Normal, vencimiento a **1440 min** | | |
| B5 | Con el usuario **enfermería** (P3), en `/tableros/enfermeria` pulsar **“Iniciar”** en la tarea de dieta | La tarjeta pasa a la columna **En proceso**; el contador de la tarjeta de /tableros baja en Pendiente y sube En proceso | | |
| B6 | Pulsar **“Completar”** en esa misma tarea | Pasa a **“Cumplida hoy”**. (Al día siguiente ya no se lista — el tablero no muestra histórico) | | |
| B7 | En la tarea del medicamento pulsar **“Cancelar”** → escribir motivo < 5 caracteres → intentar confirmar | El botón **“Confirmar cancelación”** permanece deshabilitado (motivo mínimo 5 caracteres) | | |
| B8 | Completar el motivo (≥ 5 caracteres) → **“Confirmar cancelación”** | La tarea desaparece de las columnas activas | | |

### Escenario C — Órdenes reales en LIS / RIS y cola de farmacia

| # | Acción | Resultado esperado (verificable) | Resultado | Evidencia |
|---|---|---|---|---|
| C1 | Ir a **Laboratorio → Órdenes** (`/lis/orders`, vista Estudios) | Existe una orden nueva del paciente de P7, estado **ORDERED**, prioridad **URGENT**, con el examen del paso A5 | | |
| C2 | Ir al módulo de **Imágenes** (`/imaging`) | Existe la solicitud con **folio `SOL-2026-NNNN`**, prioridad ROUTINE, con el estudio del paso A6 y su modalidad | | |
| C3 | Cola de farmacia: verificación **solo BD** (Anexo A, query A-4) — la cola `ece.indicacion_farmacia_pendiente` **no tiene pantalla** (ver H-03) | 1 fila correspondiente al ítem de medicamento del paso A4, ligada a la indicación firmada | | |

### Escenario D — Verificaciones negativas y regla 32 h

| # | Acción | Resultado esperado (verificable) | Resultado | Evidencia |
|---|---|---|---|---|
| D1 | **Antes** de la primera firma de un episodio nuevo (repetir P7–P9 con un segundo paciente): en `/ece/indicaciones/nueva`, cambiar el tipo a **Subsecuente**, agregar 1 ítem cualquiera y firmar | El servidor **rechaza**; el recuadro rojo muestra **exacto**: “El episodio no tiene ninguna indicación firmada todavía — la primera debe firmarse como tipoIndicacion='INICIAL'.” ⚠ Nota: el **borrador sí queda creado** (create y firmar son dos mutaciones); verificar que la indicación aparece en la lista como `borrador` — es residuo esperado, no defecto de rollback | | |
| D2 | En ese mismo episodio, volver a tipo **Inicial** y firmar | Firma exitosa (primera del episodio) | | |
| D3 | Inmediatamente después, crear **otra** indicación en el mismo episodio | La barra ya solo ofrece **Subsecuente** (Inicial desaparece del selector) y el chip pasa a verde: “Próxima subsecuente antes de {dd/mm hh:mm} — quedan 31 h 5x m” | | |
| D4 | Firmar esa segunda indicación como **Subsecuente · Indicación rápida** con 1 ítem, **antes** de que pasen 32 h | **PASA la firma** (la regla de 32 h es plazo *máximo*, no mínimo). El toast **no** trae advertencia de plazo | | |
| D5 | Subtipo **“Indicación diaria”**: seleccionarlo con solo 1 categoría llenada | El botón **“✍ Firmar indicación diaria”** queda **deshabilitado** hasta que las **8 categorías** tengan al menos un renglón (la indicación diaria es el plan completo del día) | | |
| D6 | Regla de 32 h vencida: **no forzable en la sesión de UAT** (exigiría esperar 32 h). Verificación diferida: al retomar el episodio pasadas 32 h de la última firma, el chip debe estar **rojo** (“⚠ SUBSECUENTE VENCIDA — debió indicarse antes de {fecha} (máx. 32 h)”) y al firmar, el toast agrega “**⚠ Se excedió el plazo de 32h desde la última firma.**”. ⚠ Ver H-05: la implementación **advierte pero no rechaza** la firma tardía — discrepancia literal con el REQ (“rechazo server-side”) a resolver con Edwin | | |
| D7 | Rollback: si en cualquier firma un consumer falla (no forzable desde UI sin datos corruptos), el mensaje esperado es uno de: “No se pudo firmar la indicación: falló la materialización a farmacia/eMAR…”, “…falló la creación de tareas de seguimiento para enfermería…”, “…falló la creación de la orden real de laboratorio/imágenes…”, todos terminando en “**La firma no se aplicó — reintente; si persiste, contacte soporte.**”, y la indicación permanece en `borrador` con **cero** tareas/órdenes hijas (Anexo A, query A-2 sin filas para esa indicación) | | |
| D8 | Ítem de estudio degradado: si el toast de una firma reporta “⚠ N ítem(s) no generaron orden real: …”, la firma **sí** aplicó pero ese estudio **no** tiene orden LIS/RIS — el motivo lo dice el propio toast (paciente sin bridge al MPI, examen fuera de catálogo). Registrar como hallazgo con el motivo textual | | |

### Escenario E — Seguridad de acceso (spot-check)

| # | Acción | Resultado esperado (verificable) | Resultado | Evidencia |
|---|---|---|---|---|
| E1 | Con el usuario **enfermería** (P3) intentar abrir `/ece/indicaciones/nueva` y firmar | La creación/firma debe estar **negada** para NURSE (la firma de indicaciones es acto médico — `create/firmar` exigen PHYSICIAN). La lectura de la lista sí es permitida | | |
| E2 | Con el médico, verificar que el tablero de otra organización no es visible (si dispone de segunda org de prueba) | Aislamiento por tenant: los tableros solo muestran tareas de la org/establecimiento activos | | |

---

## 4. Anexo A — Verificaciones de respaldo en BD (solo lectura, para @Orq)

> Ejecutar vía MCP Supabase (`mcp__supabase__execute_sql`) sobre el proyecto HIS. Ninguna query escribe.

```sql
-- A-0a · Precondición P4: ECE inicializado para el establecimiento activo
SELECT e.id AS ece_establecimiento_id, e.establishment_id, est.name
FROM ece.establecimiento e
JOIN public."Establishment" est ON est.id = e.establishment_id;

-- A-0b · Precondición P5: unidades con área clasificada (LABORATORIO / IMAGENES imprescindibles)
SELECT id, code, name, "areaType", active, "establishmentId"
FROM public."ServiceUnit"
WHERE "areaType" IS NOT NULL
ORDER BY "areaType";

-- A-0c · Precondición P6: catálogos con contenido
SELECT (SELECT count(*) FROM public."LabTest")        AS lab_tests,
       (SELECT count(*) FROM public."ImagingTestAttrs") AS imaging_tests,
       (SELECT count(*) FROM public."Drug")            AS drugs;

-- A-0d · Precondición P9: episodios ECE recientes (para obtener el UUID)
SELECT ea.id AS episodio_id, ea.estado, ea.fecha_hora_inicio,
       p.numero_expediente, ea.public_encounter_id
FROM ece.episodio_atencion ea
JOIN ece.paciente p ON p.id = ea.paciente_id
ORDER BY ea.creado_en DESC
LIMIT 5;

-- A-1 · Conteo de CareTask por rol asignado, tipo y estado (esperado tras A7:
--       NURSE/IND_DIETA 1, NURSE/IND_MED_CUMPLIR 1, LAB_TECHNICIAN/LAB_TO_PROCESS 1,
--       RAD_TECHNICIAN/IMAGING_TO_PERFORM 1)
SELECT "assignedRoleCode", "taskType", status, count(*)
FROM public."CareTask"
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- A-2 · Trazabilidad indicación → ítems → tareas (D1: sourceType/sourceId)
SELECT im.id                    AS indicacion_id,
       im.tipo_indicacion,
       im.estado_registro,
       im.fecha_firma,
       ii.tipo                  AS item_tipo,
       left(ii.descripcion, 60) AS item_descripcion,
       ct."assignedRoleCode",
       ct."taskType",
       ct.status                AS tarea_estado,
       ct."serviceUnitId"
FROM ece.indicaciones_medicas im
JOIN ece.indicacion_item ii ON ii.indicacion_id = im.id
LEFT JOIN public."CareTask" ct
       ON ct."sourceType" = 'INDICACION_ITEM'
      AND ct."sourceId"::text = ii.id::text
ORDER BY im.fecha_firma DESC NULLS LAST, ii.tipo;

-- A-3 · Órdenes reales nacidas de la firma (LIS y RIS) + su CareTask de área
SELECT 'LAB' AS origen, lo.id::text, lo.status::text, lo.priority::text,
       lo."clinicalIndication", lo."createdAt"
FROM public."LabOrder" lo
UNION ALL
SELECT 'IMG', ir.id::text, 'REQUEST', ir.prioridad::text, ir.observaciones, ir."firmadoEn"
FROM public."ImagingRequest" ir
ORDER BY 6 DESC
LIMIT 10;

SELECT ct."assignedRoleCode", ct."taskType", ct."slaMinutes", ct."dueAt", ct.priority, ct.status
FROM public."CareTask" ct
WHERE ct."sourceType" IN ('LAB_ORDER', 'IMAGING_ORDER')
ORDER BY ct."createdAt" DESC;

-- A-4 · Cola de conciliación farmacia (SIN UI — única verificación posible)
SELECT *
FROM ece.indicacion_farmacia_pendiente
ORDER BY 1 DESC
LIMIT 10;

-- A-5 · Regla 32 h: última firma por episodio y horas transcurridas
SELECT episodio_id,
       max(fecha_firma) AS ultima_firma,
       round(EXTRACT(EPOCH FROM (now() - max(fecha_firma))) / 3600.0, 1) AS horas_desde
FROM ece.indicaciones_medicas
WHERE estado_registro IN ('firmado', 'validado')
GROUP BY episodio_id;

-- A-6 · Residuo esperado de D1: borradores huérfanos (create ok, firmar rechazada)
SELECT id, episodio_id, estado_registro, registrado_en
FROM ece.indicaciones_medicas
WHERE estado_registro = 'borrador'
ORDER BY registrado_en DESC;
```

---

## 5. Criterios de aceptación y trazabilidad

### Criterio global PASA/FALLA

- **PASA el circuito** si A1–A8, B1–B8, C1–C3 y D1–D5 dan **Pasa** con evidencia; D6–D8 pueden quedar **No verificado** (requieren tiempo o datos no forzables) sin bloquear.
- **FALLA** ante cualquiera de: conteos del toast distintos de lo esperado (regla D2), tarea de enfermería creada para un estudio, estudio sin orden real **sin** aviso de omisión, tablero que no refleja la tarea, o una firma que reporta éxito con tareas/órdenes ausentes en BD (violación de atomicidad — Crítico).
- Los pasos con “Falla” generan hallazgo numerado en §6 con severidad de `docs/qa/drhis/plantillas.md` (la severidad se asigna por **consecuencia**, no por tamaño).

### Matriz de trazabilidad (CC-0026 y normativa)

| # | Requisito | Fuente | Pasos que lo prueban |
|---|---|---|---|
| 1 | Tarea de primera clase persistida con fuente polimórfica, estados PENDIENTE→EN_PROCESO→CUMPLIDA/CANCELADA, RLS por org | CC-0026 **D1** (SQL 209) | A7, B5–B8, E2, A-1/A-2 |
| 2 | Ruteo al firmar: mov/dieta/cuidados/med/proc/inter → NURSE; lab → LabOrder + tarea área LAB; gab → ImagingRequest+Order + tarea área IMG; **sin** tarea de enfermería para estudios | CC-0026 **D2** (corrección Edwin 2026-08-26) | A7, B2–B4, C1–C2, A-1/A-3 |
| 3 | Tableros por área sobre `ServiceUnit.areaType` + tablero de enfermería por rol | CC-0026 **D3** (SQL 212) | B1–B8 |
| 4 | Indicaciones médicas diarias firmadas por el médico tratante; sin firma no se ejecutan | NTEC (Acuerdo MINSAL n.° 1616/2024) **Art. 36**; Doc 6 | A7, E1, D5 |
| 5 | Firma electrónica simple del profesional por instancia | NTEC **Art. 23 lit. a.4** | A7 (ver H-04) |
| 6 | Inmutabilidad post-firma; cambio de plan = nueva instancia (suspender/cancelar + nueva indicación) | NTEC **Art. 42** | A8, D3–D4 |
| 7 | Transcripción/ejecución de enfermería como acto propio trazable (la tarea NURSE es el vehículo de seguimiento; la administración se firma aparte en eMAR) | NTEC Art. 36 + TDR §16 | B2, B5–B6 |
| 8 | INICIAL única por episodio; SUBSECUENTE con plazo máximo 32 h (server-side) | REQ CC-0026 §mockup (SQL 210) | D1–D6 (ver H-05) |
| 9 | Prescripción alimenta farmacia sin doble digitación | TDR §15 (ciclo del medicamento) | C3 (ver H-03) |

---

## 6. Hallazgos

> Sección a llenar durante la ejecución en producción. Los H-0x siguientes provienen de la **lectura del código y del dry-run local** del 2026-08-29 (ver §7); confirmarlos o descartarlos en prod.

### Pre-identificados en revisión de código (2026-08-29, @DrHIS)

- **H-01 · El toast de confirmación puede no alcanzar a verse · Media (UX)** — `firmar()` exitoso dispara el toast y **en el mismo instante** navega a `/ece/indicaciones`; el toast vive en la página que se desmonta. Consecuencia: el médico puede quedarse sin ver los contadores (única confirmación visible de qué generó su firma). Verificar en A7; si no se ve, es defecto del sistema.
- **H-02 · Tareas de área sin unidad si falta `ServiceUnit.areaType` · Alta (condicional)** — si el establecimiento no tiene unidad activa con `areaType='LABORATORIO'`/`'IMAGENES'`, la CareTask del área nace con `serviceUnitId=null` y **no aparece en ningún tablero** (lab/imágenes no tienen tablero por rol; solo enfermería). La orden LIS/RIS sí existe, pero nadie la ve en tableros. Mitigación: precondición P5 obligatoria.
- **H-03 · La cola de farmacia no tiene pantalla · Media** — `ece.indicacion_farmacia_pendiente` se puebla al firmar pero ninguna UI la consume aún; farmacia no se entera dentro del sistema. Verificable solo por BD (A-4). Naturaleza: alcance pendiente (Ola futura), no regresión.
- **H-04 · Firma sin re-autenticación · Media (normativa)** — la firma de la indicación es un click (“✍ Firmar…”) sin PIN ni segunda credencial, mientras la Historia Clínica (CC-0011) firma con `{id, pin}`. Art. 23 a.4 admite firma electrónica simple, pero la asimetría entre documentos del mismo expediente debilita la posición probatoria. Recomendación: unificar el patrón de firma.
- **H-05 · Regla 32 h: advierte pero no rechaza · Media (discrepancia REQ)** — el REQ dice “rechazo server-side de la mutación que incumpla”; la implementación calcula `plazoExcedido` y solo agrega advertencia al toast. Clínicamente, rechazar una firma tardía sería peor (impediría ponerse al día), pero la decisión debe quedar explícita de Edwin y el REQ actualizarse.
- **H-06 · Borrador huérfano tras firma rechazada · Baja** — crear y firmar son dos mutaciones; si la firma es rechazada (p. ej. D1), el borrador queda creado. No hay pérdida ni inconsistencia, pero acumula borradores; considerar limpieza o reutilización del borrador al reintentar.
- **H-07 · Roles ejecutores inexistentes · Baja (configuración)** — `LAB_TECHNICIAN` y `RAD_TECHNICIAN` no existen hoy como `Role` en prod; el gate del router de tareas los contempla pero nadie los porta. Las tareas de área las operará de facto NURSE/PHYSICIAN hasta crear esos roles (CC-0017 catálogo parametrizable).

### Encontrados durante el dry-run local (ver §7)

- **H-08 · Frecuencia default “STAT (inmediato)” en el modal de medicamentos · Alta (seguridad del paciente)** — `FRECUENCIAS_MED[0]` es STAT (`modal-medicamento.tsx`): un medicamento agregado sin tocar el selector sale prescrito **STAT sin intención del médico**, y de paso la tarea NURSE hereda prioridad **Alta** (el patrón `\bSTAT\b|urgente` del consumer la eleva). Evidencia: en el dry-run el ítem quedó “CEFTRIAXONA 1G IV · 1 mg · VO · STAT (inmediato) · …” sin que el spec seleccionara frecuencia. Consecuencia clínica: dosis inmediatas no deseadas y ruido de prioridad en el tablero. Naturaleza: defecto del sistema (default inseguro). Recomendación: default vacío u obligatorio, nunca STAT.
- **H-09 · Fallo interno en `firmar()` burbujea como error técnico crudo · Media** — cuando falló una pieza interna de la transacción (en el dry-run: función de auditoría ausente en la BD local, dentro de `emitDomainEvent`), el usuario recibe el stack de Prisma (`Invalid prisma.$executeRaw() invocation… function audit.fn_write_manual_audit_entry does not exist`) en el recuadro de error — NO el mensaje operativo “No se pudo firmar la indicación: … La firma no se aplicó”. La **atomicidad sí se cumplió** (la firma revirtió completa: 0 tareas, 0 órdenes, indicación en borrador — verificación positiva de D7), pero el contrato de mensaje claro solo cubre los 3 consumers envueltos en try/catch, no el outbox. Recomendación: envolver también `emitDomainEvent` o mapear INTERNAL a un mensaje operativo.
- **H-01 (actualización) · CONFIRMADO como intermitente** — en 2 de 3 corridas el toast NO alcanzó a verse tras el redirect; en 1 sí. Es una condición de carrera real entre `setToast` y `router.push`. Mantener severidad Media y corregir (toast global tipo sonner, o navegar tras cierre del toast).

### Ejecución en producción (Edwin)

| Hallazgo | Severidad | Paso | Descripción / evidencia |
|---|---|---|---|
| _(pendiente de ejecución)_ | | | |

---

## 7. Dry-run en stack local de test — 2026-08-29 (@DrHIS)

> Ejecutado contra el stack efímero de E2E (Postgres + GoTrue + gateway, `docker-compose.test.yml`, puerto BD 55432 por colisión local), mismo código de producto, con Playwright (spec en el Anexo B) y usuarios `qa.physician`/`qa.nurse` del seed E2E. **No sustituye la ejecución en producción** (catálogos y seeds difieren), pero valida que el guion es ejecutable tal cual. Corrida final: **4/4 specs en verde (48 s)**.

### Resultado por paso del guion

| Pasos | Resultado | Evidencia (respuesta real del servidor / BD) |
|---|---|---|
| A1–A2 | **Pasa** | Episodio precargado y bloqueado; chip “Subsecuente: requerida como máximo 32 h…”; botón “✍ Firmar indicación inicial (0 renglones)” deshabilitado |
| A3–A6 | **Pasa** | Contador sube 1→4 renglones (dieta, CEFTRIAXONA 1G IV, HEMOGRAMA COMPLETO·Urgente, RADIOGRAFIA DE TORAX PA) |
| A7 | **Pasa** | `{"estadoRegistro":"firmado","tasksCreated":2,"labOrdersCreated":1,"imagingRequestsCreated":1,"ordenesOmitidas":[],"plazoExcedido":false}` — el contrato D2 exacto |
| A8 | **Pasa** | Lista muestra “Firmado MC · Activa”. ⚠ gotcha de automatización: el listado renderiza copia dual responsive (tabla+cards) — filtrar `:visible` |
| B1 | **Pasa** | `/tableros`: Enfermería “2 pendientes”, Laboratorio Clínico “1 pendiente”, Imágenes/Radiología “1 pendiente” |
| B2 | **Pasa** | `/tableros/enfermeria`: IND_DIETA + IND_MED_CUMPLIR con paciente “MARIA PRUEBA UAT CC0026”; cero LAB_TO_PROCESS/IMAGING_TO_PERFORM |
| B3 | **Pasa** | Tablero Laboratorio: LAB_TO_PROCESS, prioridad Alta, `slaMinutes=240` |
| B4 | **Pasa** | Tablero Imágenes: IMAGING_TO_PERFORM, `slaMinutes=1440`, folio `SOL-2026-0001`, modalidad CR |
| B5–B6 | **Pasa** | Iniciar → EN_PROCESO; Completar → respuesta `"CUMPLIDA"` y la tarjeta pasa a “Cumplida hoy” (BD: 1 CUMPLIDA con `completedAt`) |
| B7–B8 | **No verificado** | Cancelación con motivo no automatizada en el dry-run — validar en prod |
| C1–C2 | **Pasa (por BD)** | `LabOrder ORDERED/URGENT` + `ImagingRequest SOL-2026-0001 + ImagingOrder CR` creados por la firma (verificado con las queries A-3; las pantallas /lis/orders e /imaging no se recorrieron) |
| C3 | **Pasa (por BD)** | `ece.indicacion_farmacia_pendiente`: 1 fila `PENDIENTE_REVISION_FARMACIA` con el texto verbatim del ítem |
| D1 | **Pasa** | Rechazo exacto: “El episodio no tiene ninguna indicación firmada todavía — la primera debe firmarse como tipoIndicacion='INICIAL'.” + borrador huérfano confirmado (H-06) |
| D2 | **Pasa** | INICIAL firma OK, `tasksCreated:1` |
| D3–D4 | **Pasa** | Chip verde “Próxima subsecuente antes de …”; SUBSECUENTE·rápida firma OK con `plazoExcedido:false`, `horasDesdeUltimaFirma:0.001` |
| D5 | **Pasa** | Con subtipo “Indicación diaria” y 1 sola categoría, el botón “✍ Firmar indicación diaria” queda deshabilitado |
| D6 | **No verificado** | Exige 32 h reales de espera |
| D7 | **Pasa (indirecto)** | Con una función interna ausente, la firma revirtió completa (0 tareas/órdenes, indicación en borrador) — pero el mensaje fue stack técnico crudo, ver H-09 |
| D8 | **No verificado** | No se forzó un ítem degradado (`ordenesOmitidas` siempre vacío) |
| E1 | **Pasa** | NURSE al firmar recibe: “Rol requerido: PHYSICIAN, MC” |
| E2 | **No verificado** | Sin segunda org en el stack local |

### Gaps del stack local que Edwin NO verá en prod

Para que el circuito corriera en el Postgres efímero hubo que aplicar a mano (además del bootstrap estándar de e2e-smoke): `201/206/209/210/211`, `ece.current_establecimiento_id_safe()` (de 65) y `fn_next_solicitud_imagen` + secuencia (de 192) — todo YA aplicado en prod según memoria del proyecto. Dato útil para el sprint de portabilidad BD: `prisma db push` + seed dejan el circuito CC-0026 a 7 archivos de distancia.

---

## Anexo B — Spec Playwright del dry-run (para promover a E2E permanente por @QA)

> Corrió 4/4 en verde contra el stack efímero. Para hacerlo spec permanente falta: fixtures autosuficientes (hoy los episodios A/B se crean por SQL, ver §7) y tag `@cc0026`. Guardado aquí porque el PR es docs-only.

```ts
/**
 * Dry-run del guion UAT CC-0026 (docs/uat/uat-cc0026-indicacion-tareas-2026-08-29.md)
 * contra el stack local de test — spec temporal de @DrHIS, 2026-08-29.
 *
 * Requiere fixtures previos (episodios A y B del paciente UAT-CC0026-01) —
 * ver scratchpad uat-fixtures*.sql. Se ejecuta con:
 *   E2E_BASE_URL=http://localhost:3100 npx playwright test e2e/uat-cc0026-dryrun.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { login } from "./_helpers/auth";

const EPISODIO_A = process.env.UAT_EPISODIO_A ?? "94e42a30-37f4-4fdd-83bc-6e995aa85678";
const EPISODIO_B = process.env.UAT_EPISODIO_B ?? "cffe8b8e-cf7e-4316-afa2-9649ccc6f3a6";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

async function selectRadix(page: Page, triggerSelector: string, optionName: string | RegExp) {
  await page.locator(triggerSelector).click();
  await page.getByRole("option", { name: optionName }).click();
}

/** Espera la respuesta de la mutación firmar y devuelve el body como texto. */
function waitFirmarResponse(page: Page) {
  return page.waitForResponse(
    (r) => r.url().includes("eceIndicaciones.firmar") && r.request().method() === "POST",
    { timeout: 30_000 },
  );
}

test("A1-A7: firma INICIAL con dieta+med+lab+gab (episodio A)", async ({ page }) => {
  await login(page, "physician");

  await page.goto(`/ece/indicaciones/nueva?episodioId=${EPISODIO_A}`);
  // A1 — episodio precargado y bloqueado
  const episodio = page.getByTestId("input-episodio-id");
  await expect(episodio).toHaveValue(EPISODIO_A);
  await expect(episodio).toBeDisabled();
  await expect(page.getByText("Episodio cargado desde la ficha hospitalaria.")).toBeVisible();

  // A2 — barra de tipo: chip informativo 32h + botón deshabilitado con 0 renglones
  await expect(page.getByText(/Subsecuente: requerida como máximo 32 h/)).toBeVisible();
  const btnFirmar = page.getByTestId("btn-firmar-indicacion");
  await expect(btnFirmar).toContainText("Firmar indicación inicial (0 renglones)");
  await expect(btnFirmar).toBeDisabled();

  // A3 — Dieta (defaults Normal · Oral)
  await page.getByTestId("btn-agregar-dieta").click();
  await page.getByTestId("btn-agregar-al-cuadro").click();
  await expect(btnFirmar).toContainText("(1 renglones)");

  // A4 — Medicamento del catálogo real
  await page.getByTestId("btn-agregar-med").click();
  await page.locator("#med-busca").fill("ceft");
  await page.getByRole("button", { name: /CEFTRIAXONA/ }).first().click();
  await page.locator("#med-dosis").fill("1");
  await page.getByTestId("btn-agregar-al-cuadro").click();
  await expect(btnFirmar).toContainText("(2 renglones)");

  // A5 — Laboratorio: hemograma, prioridad Urgente
  await page.getByTestId("btn-agregar-lab").click();
  await page.locator("#lab-busca").fill("hemog");
  await page.getByRole("button", { name: /HEMOGRAMA COMPLETO/ }).first().click();
  await selectRadix(page, "#lab-prio", "Urgente");
  await page.getByTestId("btn-agregar-al-cuadro").click();
  await expect(btnFirmar).toContainText("(3 renglones)");

  // A6 — Gabinete: Rx tórax (modalidad se resuelve sola)
  await page.getByTestId("btn-agregar-gab").click();
  await page.locator("#gab-busca").fill("torax");
  await page.getByRole("button", { name: /RADIOGRAFIA DE TORAX/ }).first().click();
  await page.getByTestId("btn-agregar-al-cuadro").click();
  await expect(btnFirmar).toContainText("(4 renglones)");

  // A7 — firmar y capturar los contadores del server
  const respPromise = waitFirmarResponse(page);
  await btnFirmar.click();
  const resp = await respPromise;
  const body = await resp.text();
  console.log("[UAT A7] firmar response:", body.slice(0, 600));
  expect(body).toContain('"tasksCreated":2');
  expect(body).toContain('"labOrdersCreated":1');
  expect(body).toContain('"imagingRequestsCreated":1');
  expect(body).toContain('"ordenesOmitidas":[]');

  // H-01 — ¿el toast alcanza a verse pese al router.push inmediato?
  const toastVisible = await page
    .getByText("Indicación firmada")
    .isVisible({ timeout: 4_000 })
    .catch(() => false);
  console.log(`[UAT A7/H-01] toast visible tras redirect: ${toastVisible}`);

  // A8 — la indicación queda firmada en la lista del episodio
  await page.goto("/ece/indicaciones");
  await page.getByTestId("input-episodio-id").fill(EPISODIO_A);
  // El listado renderiza copia dual responsive (tabla + cards) — filtrar :visible
  await expect(
    page.getByText("Firmado MC").and(page.locator(":visible")).first(),
  ).toBeVisible({ timeout: 30_000 });
});

test("B1-B6: tableros — enfermería con 2 tareas, lab/imágenes con 1; iniciar+completar", async ({ page }) => {
  await login(page, "nurse");

  // B1 — grid de áreas
  await page.goto("/tableros");
  const cardEnf = page.getByRole("listitem").filter({ hasText: "Enfermería" });
  await expect(cardEnf).toContainText("2 pendientes", { timeout: 20_000 });
  const cardLab = page.getByRole("listitem").filter({ hasText: "Laboratorio Clínico" });
  await expect(cardLab).toContainText("1 pendiente");
  const cardImg = page.getByRole("listitem").filter({ hasText: "Imágenes / Radiología" });
  await expect(cardImg).toContainText("1 pendiente");

  // B2 — tablero de enfermería: 2 tarjetas, ningún estudio
  await cardEnf.click();
  await expect(page).toHaveURL(/\/tableros\/enfermeria/);
  await expect(page.getByRole("heading", { name: /Pendiente/ }).first()).toBeVisible();
  await expect(page.getByText("IND_DIETA")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("IND_MED_CUMPLIR")).toBeVisible();
  await expect(page.getByText("LAB_TO_PROCESS")).toHaveCount(0);
  await expect(page.getByText("IMAGING_TO_PERFORM")).toHaveCount(0);
  await expect(page.getByText("PRUEBA UAT CC0026").first()).toBeVisible();

  // B5 — Iniciar la primera tarea pendiente (el orden pone primero la de mayor prioridad)
  const iniciarResp = page.waitForResponse((r) => r.url().includes("careTask.iniciar"), { timeout: 20_000 });
  await page.getByRole("button", { name: /^Iniciar tarea/ }).first().click();
  expect((await iniciarResp).status()).toBe(200);
  await expect
    .poll(async () => page.getByRole("button", { name: /^Iniciar tarea/ }).count(), { timeout: 10_000 })
    .toBe(1); // quedaba 1 pendiente

  // B6 — Completar la tarea (y esperar a que el server confirme antes de navegar)
  const completarResp = page.waitForResponse((r) => r.url().includes("careTask.completar"), { timeout: 20_000 });
  await page.getByRole("button", { name: /^Completar tarea/ }).first().click();
  const completarBody = await (await completarResp).text();
  console.log("[UAT B6] completar response:", completarBody.slice(0, 300));
  expect(completarBody).toContain('"CUMPLIDA"');
  // La tarjeta completada aparece en la columna "Cumplida hoy"
  await expect
    .poll(async () => page.getByRole("button", { name: /^Completar tarea/ }).count(), { timeout: 10_000 })
    .toBe(1);

  // B3 — tablero del área Laboratorio: el hemograma con SLA
  await page.goto("/tableros");
  await page.getByRole("listitem").filter({ hasText: "Laboratorio Clínico" }).click();
  await expect(page.getByText("LAB_TO_PROCESS")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/HEMOGRAMA COMPLETO/).first()).toBeVisible();
  await expect(page.getByText("Alta").first()).toBeVisible(); // prioridad Urgente → HIGH

  // B4 — tablero del área Imágenes
  await page.goto("/tableros");
  await page.getByRole("listitem").filter({ hasText: "Imágenes / Radiología" }).click();
  await expect(page.getByText("IMAGING_TO_PERFORM")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/RADIOGRAFIA DE TORAX/).first()).toBeVisible();
});

test("D1-D4: SUBSECUENTE sin previa rechaza; INICIAL pasa; segunda como SUBSECUENTE pasa (episodio B)", async ({ page }) => {
  await login(page, "physician");

  // D1 — SUBSECUENTE en episodio virgen → PRECONDITION_FAILED con mensaje exacto
  await page.goto(`/ece/indicaciones/nueva?episodioId=${EPISODIO_B}`);
  await page.getByTestId("btn-agregar-dieta").click();
  await page.getByTestId("btn-agregar-al-cuadro").click();
  // Cambiar tipo a Subsecuente (Radix select de la barra)
  await page.getByLabel("Tipo de indicación", { exact: true }).click();
  await page.getByRole("option", { name: "Subsecuente" }).click();
  // Subtipo default "Indicación diaria" exige 8 categorías — usar Indicación rápida
  await page.getByLabel("Subtipo de indicación subsecuente").click();
  await page.getByRole("option", { name: "Indicación rápida" }).click();
  await page.getByTestId("btn-firmar-indicacion").click();
  await expect(page.locator('main p[role="alert"]')).toContainText(
    "El episodio no tiene ninguna indicación firmada todavía",
    { timeout: 20_000 },
  );

  // D2 — volver a INICIAL y firmar (nuevo intento crea otra indicación)
  await page.getByLabel("Tipo de indicación", { exact: true }).click();
  await page.getByRole("option", { name: "Inicial" }).click();
  const resp1 = waitFirmarResponse(page);
  await page.getByTestId("btn-firmar-indicacion").click();
  const body1 = await (await resp1).text();
  console.log("[UAT D2] firmar INICIAL:", body1.slice(0, 400));
  expect(body1).toContain('"tasksCreated":1');

  // D3/D4 — nueva indicación del mismo episodio: solo Subsecuente disponible, firma OK sin plazoExcedido
  await page.goto(`/ece/indicaciones/nueva?episodioId=${EPISODIO_B}`);
  await expect(page.getByText(/Próxima subsecuente antes de/)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("btn-agregar-dieta").click();
  await page.getByTestId("btn-agregar-al-cuadro").click();
  await page.getByLabel("Subtipo de indicación subsecuente").click();
  await page.getByRole("option", { name: "Indicación rápida" }).click();
  const resp2 = waitFirmarResponse(page);
  await page.getByTestId("btn-firmar-indicacion").click();
  const body2 = await (await resp2).text();
  console.log("[UAT D4] firmar SUBSECUENTE:", body2.slice(0, 400));
  expect(body2).toContain('"plazoExcedido":false');
  expect(body2).toContain('"tasksCreated":1');
});

test("E1: NURSE no puede firmar indicaciones", async ({ page }) => {
  await login(page, "nurse");
  await page.goto(`/ece/indicaciones/nueva?episodioId=${EPISODIO_A}`);
  await page.getByTestId("btn-agregar-dieta").click();
  await page.getByTestId("btn-agregar-al-cuadro").click();
  // El episodio ya tiene firmada previa → tipo SUBSECUENTE; el subtipo default
  // "Indicación diaria" exige 8 categorías (botón deshabilitado) — usar rápida.
  await page.getByLabel("Subtipo de indicación subsecuente").click();
  await page.getByRole("option", { name: "Indicación rápida" }).click();
  await page.getByTestId("btn-firmar-indicacion").click();
  // create() es physicianProcedure → FORBIDDEN antes de llegar a firmar
  await expect(page.locator('main p[role="alert"]')).toBeVisible({ timeout: 20_000 });
  const msg = await page.locator('main p[role="alert"]').innerText();
  console.log("[UAT E1] error para NURSE:", msg);
  expect(msg.length).toBeGreaterThan(5);
});
```
