# Runbook: Contingencia Motor Workflow ECE

**HG-29 — Stream G (P2)**
Versión: 1.0 | Fecha: 2026-05-28 | Referencia: NTEC Art. 44, TDR §6.3

---

## Alcance

Este runbook cubre los escenarios de contingencia del motor de workflow ECE (tablas `ece.tipo_documento`, `ece.flujo_estado`, `ece.flujo_transicion`, `ece.documento_instancia`). Aplica cuando el motor no puede crear, transicionar o certificar documentos clínicos ECE.

---

## Procedimiento de activación de contingencia (NTEC Art. 44)

### Paso 1: Activar modo contingencia en el sistema

El DIR o ADM accede a `/admin/contingencia` y activa el modo:
- **Motivo:** descripción técnica del fallo (ej. "Motor workflow inaccesible — error en tabla ece.documento_instancia").
- **Hora estimada de restauración:** fecha y hora local El Salvador (CST, UTC-6).

El sistema registra automáticamente el evento en `ece.contingencia_evento` y emite un audit log.

### Paso 2: Notificar a todos los servicios activos

El DIR notifica verbalmente (intercomunicador o teléfono) a todos los servicios que el HIS está en modo contingencia. Los profesionales deben:
1. Terminar el registro del paciente actual si es posible.
2. A partir de ese momento, usar formularios en papel.

### Paso 3: Protocolo papel

Imprimir formularios desde `/api/contingencia/forms/<tipo>.pdf`:

| Tipo de documento NTEC | Archivo PDF |
|---|---|
| Hoja de triaje Manchester | `triaje_manchester.pdf` |
| Hoja de ingreso hospitalario | `hoja_ingreso.pdf` |
| Evolución médica | `evolucion_medica.pdf` |
| Indicaciones médicas | `indicaciones.pdf` |
| Nota de enfermería | `nota_enfermeria.pdf` |
| Epicrisis | `epicrisis.pdf` |

Los documentos en papel se custodian en la carpeta física del episodio del paciente.

---

## Digitalización retroactiva al restaurar el sistema

### Verificar restauración del motor

```sql
-- Verificar que la tabla principal responde
SELECT count(*) FROM ece.documento_instancia WHERE created_at > now() - INTERVAL '1 hour';

-- Verificar función de dependencias
SELECT ece.fn_depende_de_efectivo(
  (SELECT id FROM ece.tipo_documento WHERE codigo = 'TRIAJE'),
  NULL
);
```

### Proceso de digitalización

1. Para cada documento registrado en papel durante la contingencia:
   a. Crear el documento en el HIS mediante el flujo normal.
   b. En el campo "Observaciones clínicas" o campo libre correspondiente, agregar:
      ```
      CONTINGENCIA: Registro original en papel el <FECHA> <HORA>.
      Documento físico en carpeta episodio <ID_EPISODIO>.
      Digitalizado retroactivamente por <NOMBRE_PROFESIONAL>.
      ```
   c. Firmar electrónicamente el documento. La firma electrónica es un acto de ratificación del documento original en papel.

2. Actualizar `firmado_en` en `ece.documento_instancia` si hay diferencia entre la fecha real del acto y la fecha de digitalización:
```sql
-- Solo ejecutar si el router no permite fecha retrospectiva
-- Requiere confirmación de DIR y justificación en audit_log
UPDATE ece.documento_instancia
SET datos = jsonb_set(datos, '{observacion_contingencia}',
  '"Contingencia: acto original <FECHA_ORIGINAL>"')
WHERE id = '<UUID_INSTANCIA>';
```

---

## Escenario: Inconsistencia de estados post-contingencia

**Síntoma:** Un documento quedó en estado `borrador` o `en_revision` durante la contingencia y no puede avanzar.

**Diagnóstico:**
```sql
SELECT di.id, di.estado, di.tipo_documento_id, td.codigo,
       di.created_at, di.updated_at
FROM ece.documento_instancia di
JOIN ece.tipo_documento td ON td.id = di.tipo_documento_id
WHERE di.episodio_id = '<UUID_EPISODIO>'
  AND di.created_at BETWEEN '<INICIO_CONTINGENCIA>' AND '<FIN_CONTINGENCIA>';
```

**Verificar transiciones disponibles:**
```sql
SELECT ft.accion, fe_origen.nombre AS desde, fe_destino.nombre AS hasta,
       r.codigo AS rol_autoriza, ft.requiere_firma
FROM ece.flujo_transicion ft
JOIN ece.flujo_estado fe_origen ON fe_origen.id = ft.estado_origen_id
JOIN ece.flujo_estado fe_destino ON fe_destino.id = ft.estado_destino_id
LEFT JOIN public."Role" r ON r.id = ft.rol_autoriza_id
WHERE ft.tipo_documento_id = (
  SELECT tipo_documento_id FROM ece.documento_instancia WHERE id = '<UUID_INSTANCIA>'
);
```

**Resolución:** Ejecutar la transición desde la UI con el rol apropiado. Si el motor rechaza la transición, escalar a N3.

---

## Escenario: Motor workflow inaccesible (tablas ECE no responden)

**Diagnóstico Supabase:**
```sql
-- Verificar bloqueos en tablas ECE
SELECT pid, state, query, wait_event_type, wait_event, query_start
FROM pg_stat_activity
WHERE state != 'idle'
  AND (query LIKE '%ece.documento_instancia%' OR query LIKE '%ece.flujo_%')
ORDER BY query_start;
```

**Verificar pg_cron (si hay jobs pendientes de contingencia):**
```sql
SELECT jobid, jobname, schedule, command, active, runcount, last_run_started_at
FROM cron.job
WHERE jobname LIKE '%contingencia%' OR jobname LIKE '%workflow%';
```

**Si hay bloqueos:**
```sql
-- Terminar procesos bloqueados de larga duración (> 5 minutos)
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'active'
  AND query_start < now() - INTERVAL '5 minutes'
  AND query LIKE '%ece.%';
```

---

## Cierre del período de contingencia

1. DIR desactiva el modo en `/admin/contingencia` → botón "Desactivar modo contingencia".
2. Verificar que todos los documentos en papel fueron digitalizados.
3. Registrar en `audit.audit_log`:
   ```sql
   INSERT INTO audit.audit_log (organization_id, user_id, action, entity, entity_id, justification)
   VALUES (
     '<ORG_ID>',
     '<DIR_USER_ID>',
     'UPDATE',
     'ContingenciaEvento',
     '<CONTINGENCIA_EVENTO_ID>',
     'Contingencia cerrada. N documentos digitalizados retroactivamente. Ver carpeta física episodios <RANGO>.'
   );
   ```

---

## Escalada

| Nivel | Quién | Cuándo |
|---|---|---|
| N1 | DIR del establecimiento | Activación de contingencia, decisiones clínicas |
| N2 | ADM del sistema | Digitalización retroactiva, estados inconsistentes |
| N3 | SRE (Avante DTD) | Motor ECE inaccesible, bloqueos DB |
| N4 | AE + DBA | Corrupción de datos, trigger `fn_assert_dependencias_firmadas` fallando |

---

## Referencias

- NTEC Art. 44: Protocolo de contingencia operativa
- TDR §6.3: Audit log e inmutabilidad
- `docs/37_runbook_contingencia_firma_electronica.md`: Contingencia firma
- `docs/30_runbook_firma_workflow_ece.md`: Runbook general firma ECE
- `CLAUDE.md` §Motor de workflow ECE: descripción de tablas y funciones
