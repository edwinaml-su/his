# 30 — Runbook Operacional: Firma Electrónica + Motor Workflow ECE

**Proyecto:** HIS Multipaís — Inversiones Avante / Complejo Hospitalario
**Autor:** @SRE — Site Reliability Engineer
**Versión:** 1.0 — 2026-05-16
**Norma de referencia:** NTEC Acuerdo n.° 1616 (MINSAL, 2024)
**Documento padre:** `docs/15_production_runbook.md` (Runbook general de producción)

> Este runbook cubre exclusivamente el dominio ECE (schema `ece`): firma electrónica simple
> (Arts. 4.17, 23 NTEC), motor de workflow data-driven y sus operaciones de día-2.
> Para incidentes generales de Vercel/Supabase/Sentry consultar el runbook 15.

---

## 1. Orden de aplicación de SQL — setup inicial ECE

Los archivos deben aplicarse en orden estricto (cada uno declara precondiciones).
Usar `mcp__supabase__apply_migration` o Supabase SQL Editor con las cláusulas de
idempotencia que ya tienen cada archivo.

| N.° | Archivo                        | Contenido                                      | Precondición       |
|-----|--------------------------------|------------------------------------------------|--------------------|
| 1   | `55_ece_00_extensions.sql`     | Schema `ece`, extensiones pgcrypto/uuid-ossp   | ninguna            |
| 2   | `56_ece_01_catalogos.sql`      | `ece.institucion`, `ece.establecimiento`, `ece.servicio`, `ece.rol` | 55 |
| 3   | `57_ece_02_seguridad.sql`      | `ece.personal_salud`, `ece.firma_electronica`, RBAC, trigger lockout | 55, 56 |
| 4   | `58_ece_03_paciente.sql`       | `ece.paciente` + índices                       | 55, 56             |
| 5   | `59_ece_04_episodios.sql`      | `ece.episodio_atencion` + índices              | 55, 56, 58         |
| 6   | `60_ece_05_motor.sql`          | Motor workflow: `tipo_documento`, `flujo_estado`, `flujo_transicion`, `documento_rol`, `documento_instancia`, `documento_instancia_historial`, triggers inmutabilidad | 55-59 |
| 7   | `61_ece_06_seeds.sql`          | Seeds de catalogos: tipos de documento, flujos y roles iniciales (pendiente de crear) | 55-60 |
| 8   | `62_ece_07_rls.sql`            | RLS (Opcion B GUC), `ece.bitacora_acceso`, `ece.rectificacion`, trigger DIR-certificar | 55-60 |
| 9   | `63_ece_08_hardening.sql`      | Grants, revokes, indices de soporte adicionales (pendiente de crear) | 55-62 |

**Procedimiento de aplicacion:**

```sql
-- Paso 1: verificar que schema ece no existe en estado parcial
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'ece'
ORDER BY table_name;

-- Si existe estado parcial (tablas huerfanas), revisar logs del apply anterior
-- antes de continuar. No relanzar sin entender el estado.

-- Paso 2: aplicar cada archivo via mcp__supabase__apply_migration en orden
-- (el MCP serializa automaticamente; no lanzar en paralelo)

-- Paso 3: verificar integridad post-apply
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname = 'ece'
ORDER BY tablename;
-- Esperado: 13 tablas minimo tras aplicar 55-62
```

**Verificacion post-apply de triggers criticos:**

```sql
SELECT tgname, tgrelid::regclass, tgenabled
FROM pg_trigger
WHERE tgrelid::text LIKE 'ece.%'
ORDER BY tgrelid::regclass, tgname;
-- Debe incluir: trg_lockout_firma, trg_historial_inmutable,
--               trg_inmutable_bitacora_acceso, trg_dir_certificar
```

---

## 2. Variables de entorno nuevas (Vercel — Production scope)

Agregar en Vercel Dashboard > Project > Settings > Environment Variables
bajo scope **Production** (y Preview si se requiere en staging).

| Variable                       | Valor por defecto     | Scope       | Descripcion                                                                                    |
|--------------------------------|-----------------------|-------------|-----------------------------------------------------------------------------------------------|
| `ECE_FIRMA_CACHE_TTL_MIN`      | `15`                  | Production  | TTL en minutos del cache de verificacion de firma en la capa de aplicacion (tRPC middleware). |
| `ECE_FIRMA_RECOVERY_FROM`      | `ops@avante.com.sv`   | Production  | Direccion remitente de los correos de recuperacion de PIN (reset iniciado por DIR).            |
| `ECE_BREAK_GLASS_ENABLED`      | `false`               | Production  | Habilita acceso de emergencia break-glass al ECE. Solo `true` durante incidente declarado.   |
| `ECE_ARGON2_TIME_COST`         | `3`                   | Production  | Parametro `t` de argon2id. No modificar sin benchmarking previo (ver SLO latencia §6.3).     |
| `ECE_ARGON2_MEMORY_COST_KB`    | `65536`               | Production  | Parametro `m` de argon2id (64 MB). Ajustar solo si la latencia p95 supera 200 ms.            |
| `ECE_ARGON2_PARALLELISM`       | `4`                   | Production  | Parametro `p` de argon2id. Igual al numero de vCPU de la funcion serverless.                 |
| `ECE_PIN_LOCKOUT_ATTEMPTS`     | `5`                   | Production  | Coincide con el CHECK del trigger `trg_lockout_firma`. No modificar sin migrar el trigger.   |
| `ECE_PIN_LOCKOUT_MINUTES`      | `10`                  | Production  | Duracion del lockout automatico. Idem: coordinado con el INTERVAL del trigger.               |

> **Nota NTEC Art. 6 lit. c:** `ECE_BREAK_GLASS_ENABLED` debe permanecer `false` en
> operacion normal. Activar solo bajo el procedimiento de contingencia descrito en §7.

---

## 3. Procedimientos operativos

### 3.1 Reset de PIN de usuario (solo rol DIR)

**Cuando usar:** el profesional olvido su PIN y no puede recuperarlo autonomamente,
o se sospecha compromiso del PIN.

**Quien puede ejecutar:** exclusivamente personal con rol `DIR` (Director) en el
establecimiento correspondiente, con evidencia documentada en bitacora.

**Prerequisitos:** verificar identidad del solicitante por canal secundario
(presencial o videoconferencia grabada).

```sql
-- PASO 1: Identificar al profesional y su firma actual
SELECT
  ps.id            AS personal_id,
  ps.nombre_completo,
  ps.documento_identidad,
  fe.id            AS firma_id,
  fe.failed_attempts,
  fe.locked_until,
  fe.revoked_at,
  fe.last_rotated_at
FROM ece.personal_salud ps
JOIN ece.firma_electronica fe ON fe.personal_id = ps.id
WHERE ps.documento_identidad = '<DUI_DEL_PROFESIONAL>';

-- PASO 2: Verificar que no esta revocada (revoked_at IS NOT NULL = comprometida)
-- Si revoked_at IS NOT NULL, escalar a @AS; el reset de PIN no es suficiente.

-- PASO 3: La capa de aplicacion genera el nuevo hash argon2id.
-- El reset NUNCA se hace directo en BD con texto plano.
-- Invocar el endpoint tRPC protegido: ece.firma.resetPin (requiere rol DIR)
-- o usar el script admin: scripts/ece-reset-pin.mjs

-- PASO 4: Registrar el reset en bitacora_acceso (lo hace el endpoint/script)
-- Verificar que se registró:
SELECT accion, autorizado, ocurrido_en, justificacion
FROM ece.bitacora_acceso
WHERE personal_id = '<PERSONAL_ID>'
  AND accion = 'reset_pin'
ORDER BY ocurrido_en DESC
LIMIT 5;

-- PASO 5: Confirmar que failed_attempts = 0 y locked_until = NULL
SELECT failed_attempts, locked_until, last_rotated_at
FROM ece.firma_electronica
WHERE personal_id = '<PERSONAL_ID>';
```

**Post-reset:** el profesional debe establecer un nuevo PIN en su proximo acceso.
El sistema forzara el cambio si `last_rotated_at < now() - interval '1 day'` tras reset.

**Registro de auditoria obligatorio:** todo reset de PIN genera entrada en
`ece.bitacora_acceso` con `accion = 'reset_pin'` y `justificacion` no nula.
La ausencia de este registro es un hallazgo de cumplimiento NTEC Art. 55.

---

### 3.2 Unlock de cuenta bloqueada por intentos fallidos

**Cuando usar:** el profesional supero 5 intentos fallidos y `locked_until` esta en el
futuro. El lockout automatico dura 10 minutos; esta operacion es para desbloqueo
inmediato cuando el negocio no puede esperar (ej. urgencia clinica).

**Quien puede ejecutar:** rol DIR o el administrador tecnico HIS.

```sql
-- PASO 1: Confirmar estado de lockout
SELECT
  fe.personal_id,
  ps.nombre_completo,
  fe.failed_attempts,
  fe.locked_until,
  now() AS ahora,
  CASE
    WHEN fe.locked_until > now() THEN 'BLOQUEADA — expira en ' ||
      extract(epoch from (fe.locked_until - now()))::int || ' segundos'
    ELSE 'LIBRE'
  END AS estado
FROM ece.firma_electronica fe
JOIN ece.personal_salud ps ON ps.id = fe.personal_id
WHERE fe.personal_id = '<PERSONAL_ID>';

-- PASO 2: Desbloqueo inmediato
-- El trigger trg_lockout_firma resetea locked_until cuando failed_attempts va a 0.
-- Actualizar failed_attempts directamente (requiere service_role o rol bypassrls):
UPDATE ece.firma_electronica
SET
  failed_attempts = 0,
  locked_until    = NULL
WHERE personal_id = '<PERSONAL_ID>';
-- El trigger SET failed_attempts = 0 libera el locked_until automaticamente.

-- PASO 3: Registrar en bitacora
INSERT INTO ece.bitacora_acceso (
  personal_id, recurso_id, accion, autorizado,
  justificacion, establecimiento_id
)
SELECT
  '<PERSONAL_ID_DIRECTOR_QUE_DESBLOQUEA>'::uuid,
  fe.personal_id,
  'unlock_firma',
  true,
  'Desbloqueo manual por urgencia clinica — autorizado por DIR',
  ps.establecimiento_id
FROM ece.firma_electronica fe
JOIN ece.personal_salud ps ON ps.id = fe.personal_id
WHERE fe.personal_id = '<PERSONAL_ID>';

-- PASO 4: Verificar
SELECT failed_attempts, locked_until FROM ece.firma_electronica
WHERE personal_id = '<PERSONAL_ID>';
-- Esperado: failed_attempts = 0, locked_until = NULL
```

> Si el profesional fue bloqueado por un atacante (brute-force), considerar
> revocar la firma (setear `revoked_at = now()`) y emitir una nueva credencial
> en vez de solo desbloquear.

---

### 3.3 Restaurar instancia de workflow en estado inconsistente

**Cuando usar:** `ece.documento_instancia` tiene `estado_actual_id` apuntando a un
`flujo_estado` que no corresponde al ultimo registro en `documento_instancia_historial`,
indicando inconsistencia entre la cabecera y la bitacora.

**Diagnostico:**

```sql
-- Detectar instancias inconsistentes
SELECT
  di.id                   AS instancia_id,
  di.estado_actual_id     AS estado_cabecera,
  fe_cab.codigo           AS estado_cab_codigo,
  h_last.estado_nuevo_id  AS estado_historial,
  fe_hist.codigo          AS estado_hist_codigo,
  h_last.ejecutado_en     AS ultima_transicion
FROM ece.documento_instancia di
JOIN ece.flujo_estado fe_cab  ON fe_cab.id = di.estado_actual_id
LEFT JOIN LATERAL (
  SELECT estado_nuevo_id, ejecutado_en
  FROM ece.documento_instancia_historial
  WHERE instancia_id = di.id
  ORDER BY ejecutado_en DESC
  LIMIT 1
) h_last ON true
LEFT JOIN ece.flujo_estado fe_hist ON fe_hist.id = h_last.estado_nuevo_id
WHERE di.estado_actual_id IS DISTINCT FROM h_last.estado_nuevo_id
  AND h_last.estado_nuevo_id IS NOT NULL;
```

**Correccion (solo si se confirma inconsistencia real, no falso positivo):**

```sql
-- PASO 1: Confirmar la inconsistencia leyendo el historial completo
SELECT
  dih.id, fe_ant.codigo AS estado_anterior, fe_nue.codigo AS estado_nuevo,
  dih.accion, ps.nombre_completo, dih.ejecutado_en
FROM ece.documento_instancia_historial dih
JOIN ece.flujo_estado fe_nue ON fe_nue.id = dih.estado_nuevo_id
LEFT JOIN ece.flujo_estado fe_ant ON fe_ant.id = dih.estado_anterior_id
LEFT JOIN ece.personal_salud ps ON ps.id = dih.ejecutado_por
WHERE dih.instancia_id = '<INSTANCIA_ID>'
ORDER BY dih.ejecutado_en;

-- PASO 2: Alinear cabecera con el ultimo estado del historial
-- Requiere service_role (bypassrls) porque documento_instancia puede
-- tener RLS activa.
UPDATE ece.documento_instancia
SET estado_actual_id = (
  SELECT estado_nuevo_id
  FROM ece.documento_instancia_historial
  WHERE instancia_id = '<INSTANCIA_ID>'
  ORDER BY ejecutado_en DESC
  LIMIT 1
)
WHERE id = '<INSTANCIA_ID>';

-- PASO 3: Insertar registro en documento_instancia_historial documentando
-- la correccion administrativa (la bitacora es append-only, no se modifica).
-- Este INSERT es una entrada especial con accion = 'correccion_admin'.
INSERT INTO ece.documento_instancia_historial (
  instancia_id, estado_anterior_id, estado_nuevo_id,
  accion, ejecutado_por, rol_ejecutor_id, observacion
)
SELECT
  '<INSTANCIA_ID>'::uuid,
  di.estado_actual_id,  -- estado inconsistente anterior
  di.estado_actual_id,  -- mismo estado (la correccion alino, no cambio estado)
  'correccion_admin',
  '<PERSONAL_ID_DIR>'::uuid,
  r.id,
  'Correccion administrativa: alineacion cabecera con historial. ' ||
  'Ticket: <TICKET_ID>. Autorizado por DIR.'
FROM ece.documento_instancia di
JOIN ece.rol r ON r.codigo = 'DIR'
WHERE di.id = '<INSTANCIA_ID>';

-- PASO 4: Verificar consistencia
SELECT
  di.estado_actual_id,
  fe.codigo AS estado_codigo,
  (SELECT estado_nuevo_id FROM ece.documento_instancia_historial
   WHERE instancia_id = di.id ORDER BY ejecutado_en DESC LIMIT 1) = di.estado_actual_id
   AS consistente
FROM ece.documento_instancia di
JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
WHERE di.id = '<INSTANCIA_ID>';
-- Esperado: consistente = true
```

---

### 3.4 Rollback de transicion (rectificacion — no DELETE)

**Principio NTEC Art. 42:** los documentos del ECE no se borran ni se revierten
con UPDATE directo. Una transicion ejecutada erroneamente se revierte creando un
registro en `ece.rectificacion` y, si el motor lo permite, ejecutando la transicion
inversa configurada en `ece.flujo_transicion`.

**Cuando usar:** una transicion se ejecuto por error (ej. se firmo el documento
equivocado, o el estado destino fue incorrecto).

```sql
-- PASO 1: Identificar la transicion erronea
SELECT
  dih.id          AS historial_id,
  dih.instancia_id,
  fe_ant.codigo   AS estado_anterior,
  fe_nue.codigo   AS estado_nuevo,
  dih.accion,
  ps.nombre_completo AS ejecutado_por,
  dih.ejecutado_en
FROM ece.documento_instancia_historial dih
JOIN ece.flujo_estado fe_nue ON fe_nue.id = dih.estado_nuevo_id
LEFT JOIN ece.flujo_estado fe_ant ON fe_ant.id = dih.estado_anterior_id
LEFT JOIN ece.personal_salud ps ON ps.id = dih.ejecutado_por
WHERE dih.instancia_id = '<INSTANCIA_ID>'
ORDER BY dih.ejecutado_en DESC;

-- PASO 2: Verificar si existe transicion inversa configurada en el motor
SELECT
  ft.accion, fe_orig.codigo AS origen, fe_dest.codigo AS destino
FROM ece.flujo_transicion ft
JOIN ece.flujo_estado fe_orig ON fe_orig.id = ft.estado_origen_id
JOIN ece.flujo_estado fe_dest ON fe_dest.id = ft.estado_destino_id
WHERE ft.tipo_documento_id = (
  SELECT tipo_documento_id FROM ece.documento_instancia
  WHERE id = '<INSTANCIA_ID>'
)
  AND fe_orig.id = (
    SELECT estado_actual_id FROM ece.documento_instancia
    WHERE id = '<INSTANCIA_ID>'
  );

-- PASO 3: Registrar la rectificacion (obligatorio antes de cualquier accion)
INSERT INTO ece.rectificacion (
  documento_original_id,
  tabla_origen,
  motivo,
  usuario_id,
  hash_original,    -- SHA-256 del payload JSON de la instancia antes de rectificar
  campo,
  valor_anterior,
  valor_nuevo,
  establecimiento_id
)
VALUES (
  '<INSTANCIA_ID>'::uuid,
  'documento_instancia',
  'Transicion ejecutada en estado incorrecto — rectificacion Art. 42 NTEC. Ticket: <TICKET_ID>',
  '<PERSONAL_ID_DIR>'::uuid,
  '<SHA256_HEX_DEL_PAYLOAD>',  -- calcular desde app: encode(digest(row_json, 'sha256'), 'hex')
  'estado_actual_id',
  '<ESTADO_ERRONEO_CODIGO>',
  '<ESTADO_DESTINO_CORRECTO_CODIGO>',
  '<ESTABLECIMIENTO_ID>'::uuid
);

-- PASO 4: Si existe transicion inversa en el motor, ejecutarla via tRPC
-- (endpoint ece.workflow.ejecutarTransicion con accion = 'rectificar' o la accion inversa).
-- Si NO existe transicion inversa, actualizar via service_role + agregar entrada historial:
UPDATE ece.documento_instancia
SET estado_actual_id = '<ESTADO_CORRECTO_ID>'::uuid
WHERE id = '<INSTANCIA_ID>';

INSERT INTO ece.documento_instancia_historial (
  instancia_id, estado_anterior_id, estado_nuevo_id,
  accion, ejecutado_por, rol_ejecutor_id, observacion
)
VALUES (
  '<INSTANCIA_ID>'::uuid,
  '<ESTADO_ERRONEO_ID>'::uuid,
  '<ESTADO_CORRECTO_ID>'::uuid,
  'rectificar',
  '<PERSONAL_ID_DIR>'::uuid,
  (SELECT id FROM ece.rol WHERE codigo = 'DIR'),
  'Rectificacion Art. 42 NTEC. Ver ece.rectificacion id = <RECTIFICACION_ID>. Ticket: <TICKET_ID>'
);
```

**Documentos en estado `certificado` o `firmado` (inmutables por NTEC):** no se puede
revertir el estado. La rectificacion en estos casos implica crear una nueva instancia
del documento con `version = version_anterior + 1` y marcar la original como
`estado_registro = 'rectificado'`. Escalar a @AS para workflow de nueva instancia.

---

### 3.5 Consulta de auditoria: todas las firmas del ultimo mes

**Proposito:** reporte de cumplimiento mensual Art. 55/56 NTEC. Extrae todos los
eventos de firma del ultimo mes calendario con datos del profesional y documento.

```sql
-- Firmas ejecutadas en el ultimo mes
SELECT
  dih.ejecutado_en                       AS timestamp_firma,
  ps.nombre_completo                     AS profesional,
  ps.documento_identidad                 AS dui_profesional,
  ps.jvpm_codigo                         AS registro_jvpm,
  r.nombre                               AS rol_ejecutor,
  td.codigo                              AS tipo_documento,
  td.nombre                              AS nombre_documento,
  di.id                                  AS instancia_id,
  di.version                             AS version_doc,
  fe_ant.codigo                          AS estado_anterior,
  fe_nue.codigo                          AS estado_nuevo,
  dih.accion,
  dih.observacion,
  CASE WHEN dih.firma_id IS NOT NULL THEN 'SI' ELSE 'NO' END AS con_firma_electronica,
  est.nombre                             AS establecimiento
FROM ece.documento_instancia_historial dih
JOIN ece.personal_salud ps    ON ps.id = dih.ejecutado_por
JOIN ece.rol r                ON r.id  = dih.rol_ejecutor_id
JOIN ece.documento_instancia di ON di.id = dih.instancia_id
JOIN ece.tipo_documento td    ON td.id = di.tipo_documento_id
JOIN ece.flujo_estado fe_nue  ON fe_nue.id = dih.estado_nuevo_id
LEFT JOIN ece.flujo_estado fe_ant ON fe_ant.id = dih.estado_anterior_id
LEFT JOIN ece.establecimiento est ON est.id = ps.establecimiento_id
WHERE dih.firma_id IS NOT NULL   -- solo transiciones que exigieron firma electronica
  AND dih.ejecutado_en >= date_trunc('month', now()) - interval '1 month'
  AND dih.ejecutado_en <  date_trunc('month', now())
ORDER BY dih.ejecutado_en DESC;

-- Resumen estadistico del mismo periodo
SELECT
  td.codigo                        AS tipo_documento,
  r.nombre                         AS rol,
  count(*)                         AS total_firmas,
  count(DISTINCT dih.ejecutado_por) AS profesionales_distintos,
  min(dih.ejecutado_en)            AS primera_firma,
  max(dih.ejecutado_en)            AS ultima_firma
FROM ece.documento_instancia_historial dih
JOIN ece.documento_instancia di ON di.id = dih.instancia_id
JOIN ece.tipo_documento td      ON td.id = di.tipo_documento_id
JOIN ece.rol r                  ON r.id  = dih.rol_ejecutor_id
WHERE dih.firma_id IS NOT NULL
  AND dih.ejecutado_en >= date_trunc('month', now()) - interval '1 month'
  AND dih.ejecutado_en <  date_trunc('month', now())
GROUP BY td.codigo, r.nombre
ORDER BY total_firmas DESC;
```

**Exportar a CSV** para entrega al area de cumplimiento:

```sql
-- Ejecutar en Supabase SQL Editor > Download CSV
-- (el resultado anterior con LIMIT 10000 para evitar timeouts)
```

---

## 4. Alarmas Prometheus

> **Stack de observabilidad:** Prometheus + Grafana (ver runbook 15 §6 para el stack
> completo). Las metricas ECE se exponen desde el middleware tRPC de firma a traves
> del endpoint `/api/metrics` (OpenTelemetry Prometheus exporter).

### 4.1 Pico de PINs fallidos

**Metric name:** `ece_firma_failed_attempts_total`
**Alert name:** `ECEPinFallidosPico`

```yaml
# prometheus/rules/ece_firma.yml
- alert: ECEPinFallidosPico
  expr: |
    rate(ece_firma_failed_attempts_total[1m]) > 50 / 60
  for: 1m
  labels:
    severity: warning
    team: sre
    dominio: ece
  annotations:
    summary: "ECE: tasa de PINs fallidos > 50/min"
    description: |
      La tasa de intentos fallidos de firma electronica supera 50 por minuto
      ({{ $value | printf "%.1f" }}/s en el ultimo minuto).
      Posible ataque de fuerza bruta o mal funcionamiento del cliente.
      Establecimiento: {{ $labels.establecimiento_id }}.
    runbook_url: "https://github.com/edwinaml-su/his/blob/main/docs/30_runbook_firma_workflow_ece.md#41-pico-de-pins-fallidos"
    accion: |
      1. Revisar ece.firma_electronica WHERE failed_attempts > 3 (usuarios en riesgo de lockout).
      2. Revisar ece.bitacora_acceso WHERE accion = 'firma' AND autorizado = false (ultimos 5 min).
      3. Si patron de IP unica → bloquear IP en Vercel WAF.
      4. Si patron de usuario unico → revocar firma y notificar al profesional.
```

**Severidad escalada a `critical`** si la tasa supera 200/min (posible ataque coordinado):

```yaml
- alert: ECEPinFallidosCritico
  expr: |
    rate(ece_firma_failed_attempts_total[1m]) > 200 / 60
  for: 2m
  labels:
    severity: critical
    team: sre
    dominio: ece
  annotations:
    summary: "ECE CRITICO: ataque de fuerza bruta a firma electronica"
    description: "Tasa de PINs fallidos > 200/min. Escalar a @AT y @AS."
    runbook_url: "https://github.com/edwinaml-su/his/blob/main/docs/30_runbook_firma_workflow_ece.md#41-pico-de-pins-fallidos"
```

### 4.2 Tasa de transiciones bloqueadas

**Metric name:** `ece_workflow_transicion_bloqueada_total` / `ece_workflow_transicion_total`
**Alert name:** `ECEWorkflowTransicionesBloqueadas`

```yaml
- alert: ECEWorkflowTransicionesBloqueadas
  expr: |
    rate(ece_workflow_transicion_bloqueada_total[5m])
    /
    (rate(ece_workflow_transicion_total[5m]) + 0.0001)
    > 0.05
  for: 5m
  labels:
    severity: warning
    team: sre
    dominio: ece
  annotations:
    summary: "ECE: tasa de transiciones bloqueadas > 5%"
    description: |
      El {{ $value | humanizePercentage }} de las transiciones de workflow
      estan siendo rechazadas en los ultimos 5 minutos.
      Puede indicar: RLS desconfigurada, contexto ECE no seteado,
      o roles insuficientes en asignaciones vigentes.
    runbook_url: "https://github.com/edwinaml-su/his/blob/main/docs/30_runbook_firma_workflow_ece.md#42-tasa-de-transiciones-bloqueadas"
    accion: |
      1. Revisar logs de tRPC: buscar errores 'Acceso denegado' o 'contexto ECE'.
      2. Verificar ece.asignacion_rol activa para los roles involucrados.
      3. Confirmar que set_ece_context() se llama dentro de transaccion activa.
      4. Si el problema es generalizado, revisar migracion SQL reciente (62_ece_07_rls.sql).
```

### 4.3 Latencia argon2id > 200 ms p95

**Metric name:** `ece_firma_verificacion_duration_seconds` (histogram)
**Alert name:** `ECEFirmaLatenciaArgon2Alta`

```yaml
- alert: ECEFirmaLatenciaArgon2Alta
  expr: |
    histogram_quantile(0.95,
      rate(ece_firma_verificacion_duration_seconds_bucket[5m])
    ) > 0.200
  for: 5m
  labels:
    severity: warning
    team: sre
    dominio: ece
  annotations:
    summary: "ECE: latencia argon2id p95 > 200 ms"
    description: |
      La verificacion de firma electronica (argon2id) tiene latencia p95 de
      {{ $value | humanizeDuration }} superando el umbral de 200 ms.
      El SLO de firma es p95 < 500 ms; esta es una alarma preventiva.
    runbook_url: "https://github.com/edwinaml-su/his/blob/main/docs/30_runbook_firma_workflow_ece.md#43-latencia-argon2id--200-ms-p95"
    accion: |
      1. Revisar ECE_ARGON2_TIME_COST y ECE_ARGON2_PARALLELISM en Vercel.
      2. Verificar que la funcion serverless tenga al menos 1024 MB RAM.
      3. Considerar reducir ECE_ARGON2_TIME_COST de 3 a 2 si la presion es sostenida.
         ADVERTENCIA: cambiar parametros invalida todos los hashes existentes — NO hacer
         sin coordinacion con @AS y nueva migracion de re-hash.
      4. Revisar si hay spike de concurrencia (verificar metricas de firma simultanea).
```

**Alarma de SLO breach (critica):**

```yaml
- alert: ECEFirmaLatenciaBreachSLO
  expr: |
    histogram_quantile(0.95,
      rate(ece_firma_verificacion_duration_seconds_bucket[5m])
    ) > 0.500
  for: 2m
  labels:
    severity: critical
    team: sre
    dominio: ece
  annotations:
    summary: "ECE CRITICO: SLO de firma electronica incumplido (p95 > 500 ms)"
    description: "Latencia p95 de verificacion argon2id supera 500 ms. SLO breach."
```

### 4.4 Tabla resumen de alarmas

| N.° | Nombre                              | Metrica clave                                    | Umbral          | Severidad | For   |
|-----|-------------------------------------|--------------------------------------------------|-----------------|-----------|-------|
| 1   | `ECEPinFallidosPico`                | `rate(ece_firma_failed_attempts_total[1m])`      | > 50/min        | warning   | 1 min |
| 2   | `ECEPinFallidosCritico`             | `rate(ece_firma_failed_attempts_total[1m])`      | > 200/min       | critical  | 2 min |
| 3   | `ECEWorkflowTransicionesBloqueadas` | ratio bloqueadas/total transiciones              | > 5%            | warning   | 5 min |
| 4   | `ECEFirmaLatenciaArgon2Alta`        | `histogram_quantile(0.95, ...)` verificacion     | > 200 ms        | warning   | 5 min |
| 5   | `ECEFirmaLatenciaBreachSLO`         | `histogram_quantile(0.95, ...)` verificacion     | > 500 ms        | critical  | 2 min |

**Enrutamiento de alertas:**
- `warning` → canal Slack `#his-ops-alerts` (horario laboral).
- `critical` → PagerDuty on-call + canal `#his-ops-critical` (24/7).

---

## 5. SLOs del dominio ECE

### 5.1 Firma electronica — latencia p95

| SLI | Objetivo | Ventana de medicion | Error budget |
|-----|----------|---------------------|--------------|
| Latencia p95 de `ece.firma.verificar` (argon2id end-to-end desde tRPC) | < 500 ms | rolling 30 dias | 500 ms × 5% = 25 ms de margen |
| Latencia p99 de `ece.firma.verificar` | < 1000 ms | rolling 30 dias | — |

**Medicion:** `histogram_quantile(0.95, rate(ece_firma_verificacion_duration_seconds_bucket[30d]))`

**Burn rate alert (fast burn):** si el error budget se consume al doble de la tasa esperada
en una ventana de 1 hora, emitir alerta `critical` antes de que el SLO se rompa.

### 5.2 Transicion de workflow — latencia p95

| SLI | Objetivo | Ventana de medicion |
|-----|----------|---------------------|
| Latencia p95 de `ece.workflow.ejecutarTransicion` (incluye validacion RBAC + insert historial) | < 300 ms | rolling 30 dias |

**Medicion:** `histogram_quantile(0.95, rate(ece_workflow_transicion_duration_seconds_bucket[30d]))`

### 5.3 Disponibilidad del servicio ECE

| SLI | Objetivo | Calculo | Ventana |
|-----|----------|---------|---------|
| Disponibilidad endpoints ECE (`/api/trpc/ece.*`) | 99.5% | `(total_requests - error_5xx) / total_requests` | rolling 30 dias |

**Error budget mensual:** 99.5% → 0.5% de downtime = 3.65 horas/mes = 219 minutos/mes.

**SLO heredado de la plataforma:** el ECE comparte la disponibilidad de Vercel + Supabase
(ver runbook 15 §1). La disponibilidad objetivo de 99.5% es alcanzable con los SLAs vendor
(Vercel 99.99%, Supabase 99.9%).

### 5.4 Dashboard Grafana sugerido

Panel recomendado en dashboard `HIS — ECE Operations`:

```
Row 1: Firma Electronica
  - Latencia p50/p95/p99 (time series, 1h window)
  - Tasa de exito de firmas (gauge, %)
  - PINs fallidos por establecimiento (heatmap)
  - Cuentas bloqueadas activas (stat)

Row 2: Motor Workflow
  - Transiciones por tipo_documento (bar chart)
  - Tasa de transiciones bloqueadas (gauge, threshold 5%)
  - Estados actuales de documentos (pie chart por estado)
  - Latencia p95 de transicion (time series)

Row 3: Auditoria
  - Tasa de escritura en bitacora_acceso (time series)
  - Rectificaciones por dia (bar chart)
  - Firmas del dia por establecimiento (stat)
```

---

## 6. Metricas instrumentadas (instrumentacion desde tRPC)

Los endpoints tRPC del dominio ECE deben instrumentar las siguientes metricas OpenTelemetry:

```typescript
// packages/infrastructure/src/observability/ece-metrics.ts

// Histograma de verificacion de firma (argon2id)
ece_firma_verificacion_duration_seconds: Histogram  // labels: establecimiento_id
// Contador de intentos fallidos de firma
ece_firma_failed_attempts_total: Counter            // labels: establecimiento_id
// Histograma de transicion de workflow
ece_workflow_transicion_duration_seconds: Histogram // labels: tipo_documento, accion
// Contador de transiciones bloqueadas
ece_workflow_transicion_bloqueada_total: Counter    // labels: tipo_documento, accion, razon
// Contador total de transiciones
ece_workflow_transicion_total: Counter              // labels: tipo_documento, accion
```

---

## 7. Plan de contingencia (Art. 6 lit. c NTEC)

**Escenario:** el sistema ECE (Vercel + Supabase) no esta disponible durante la atencion
de un paciente. NTEC Art. 6 lit. c exige que el Complejo Hospitalario garantice la
continuidad del expediente ante fallas tecnicas.

### 7.1 Criterios de activacion del plan de contingencia

Activar el plan cuando **cualquiera** de las siguientes condiciones persista mas de 15 minutos:

1. `ECE*` endpoints devuelven HTTP 503 o timeout sostenido (Vercel downtime).
2. Supabase Postgres no acepta conexiones (pooler caido o mantenimiento).
3. La disponibilidad ECE cae por debajo del 90% en una ventana de 15 minutos.
4. `ECE_BREAK_GLASS_ENABLED` se activa pero el acceso break-glass no funciona.

**Quien activa:** el @SRE on-call o, en ausencia, el Director del establecimiento,
con notificacion inmediata al area de TI.

### 7.2 Procedimiento de captura en papel

Cuando el sistema ECE no este disponible:

1. **Imprimir formularios en papel.** El archivo `scripts/forms/ece_contingencia/`
   contiene PDFs preimpresos de:
   - Nota de evolucion medica (Form-ECE-01)
   - Orden medica / prescripcion (Form-ECE-02)
   - Registro de signos vitales (Form-ECE-03)
   - Consentimiento informado simplificado (Form-ECE-04)
   - Registro de administracion de medicamentos (Form-ECE-05)

2. **Firma manuscrita obligatoria.** El profesional firma cada formulario con:
   - Nombre completo
   - Numero de registro JVPM
   - Fecha y hora (nivel hora:minuto)
   - Sello del establecimiento

3. **Registro en bitacora de contingencia (fisico).** El coordinador de turno
   registra en el libro de contingencias:
   - Hora de inicio de la falla
   - Numero de pacientes afectados
   - Formularios emitidos (correlativo)
   - Hora de reestablecimiento del sistema

4. **Custodia de documentos.** Los formularios en papel se guardan bajo llave
   en el archivo temporal del servicio. El plazo maximo para digitacion es
   **8 horas** tras el reestablecimiento del sistema (no pasar a la siguiente guardia).

### 7.3 Digitacion posterior (post-recuperacion)

Una vez reestablecido el sistema ECE:

1. Habilitar `ECE_BREAK_GLASS_ENABLED=true` temporalmente para el personal digitador
   si los documentos requieren ser ingresados bajo contexto de paciente ya atendido.

2. Ingresar los documentos con la **fecha y hora reales de la atencion** (no la hora
   de digitacion). El sistema registra ambas: `fecha_atencion` y `creado_en` (timestamp
   de ingreso al sistema).

3. En el campo `observacion` de cada documento ingresar:
   ```
   DIGITACION POST-CONTINGENCIA. Documento original en papel en archivo temporal
   del servicio <NOMBRE_SERVICIO>. Correlativo formulario: <NUMERO>. Falla: <TICKET_ID>.
   Digitado por: <NOMBRE_DIGITADOR> el <FECHA_HORA_DIGITACION>.
   ```

4. La firma electronica en estos documentos la aplica el profesional responsable
   original (no el digitador) al momento de la validacion del documento ingresado.
   Si el profesional ya no esta en turno, el Director del servicio autoriza y firma.

5. Adjuntar escaneo del formulario en papel al documento digital usando la
   funcionalidad de adjuntos del ECE (cuando este disponible).

6. Registrar el episodio de contingencia en `ece.bitacora_acceso` con
   `accion = 'digitacion_contingencia'` y `justificacion` detallando el ticket
   y el correlativo del formulario en papel.

7. **Desactivar** `ECE_BREAK_GLASS_ENABLED=false` inmediatamente tras completar
   la digitacion. Registrar en el runbook de incidentes la duracion de la activacion.

### 7.4 Notificacion a la autoridad sanitaria

Si la falla afecta datos de mas de 50 pacientes o persiste mas de 4 horas, notificar
a MINSAL (Departamento de Informatica en Salud) dentro de las 24 horas siguientes,
adjuntando el reporte del incidente generado desde Sentry + el libro de contingencias.

---

## 8. Referencias cruzadas

| Documento | Contenido relacionado |
|-----------|----------------------|
| `docs/15_production_runbook.md` | Runbook general: Vercel, Supabase, Sentry, rollback |
| `docs/02_arquitectura_software.md` | ADRs de arquitectura ECE |
| `docs/17_hipercuidado_runbook.md` | Protocolo post-deploy |
| `packages/database/sql/57_ece_02_seguridad.sql` | Schema y trigger de lockout firma |
| `packages/database/sql/60_ece_05_motor.sql` | Schema del motor workflow |
| `packages/database/sql/62_ece_07_rls.sql` | RLS, bitacora, rectificacion |
| `TDR_HIS_Multipais.md` §ECE | Terminos de referencia regulatorios |
| Acuerdo 1616 MINSAL 2024, Art. 42 | Rectificacion de expediente |
| Acuerdo 1616 MINSAL 2024, Art. 55/56 | Bitacora de acceso, retencion |
| Acuerdo 1616 MINSAL 2024, Art. 6 lit. c | Contingencia y continuidad del expediente |

---

*Runbook creado por @SRE. Proxima revision: post-go-live ECE (Fase 2 completada) o ante cambio de parametros argon2id.*
