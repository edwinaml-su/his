# SLA Retención y Eliminación de Datos

**HG-26 / HG-27 — Stream G (P2)**
Versión: 1.0 | Fecha: 2026-05-28
Referencia: NTEC Art. 6, TDR §6.3, LOPD El Salvador (Decreto 594), RNPN

---

## 1. Períodos de retención por categoría

### Datos clínicos (NTEC Art. 6)

| Categoría | Tabla(s) principal(es) | Retención mínima | Retención sistema |
|---|---|---|---|
| Expediente clínico completo | `ece.documento_instancia` + tablas de payload | 10 años desde último acto clínico | 10 años (inmutable) |
| Audit log cadena hash | `audit.audit_log` | 10 años | 10 años (inmutable por diseño) |
| Historial de triaje | `ece.hoja_triaje` | 10 años | 10 años |
| Certificados de defunción | `ece.certificado_defuncion` | Permanente | Permanente |
| Rectificaciones | `ece.rectificacion` | 10 años (vinculado al doc original) | 10 años |
| Firma electrónica (metadata) | `ece.firma_electronica` | Mientras el profesional esté activo + 5 años | 5 años post-revocación |

### Datos operativos

| Categoría | Tabla(s) | Retención mínima | Política de archivo |
|---|---|---|---|
| Sesiones de usuario | `auth.sessions` (Supabase) | 30 días inactivo | Purge automático por Supabase Auth |
| Outbox de eventos | `public.outbox` | 90 días post-publicación | `published_at IS NOT NULL AND published_at < now() - INTERVAL '90 days'` |
| Notificaciones leídas | `public."Notification"` | 1 año | Archivadas en tabla `notification_archive` |
| Logs de contingencia | `ece.contingencia_evento` | 10 años | Retención full |
| Logs de IP/acceso | `audit.access_log` (si existe) | 2 años | Archivo a cold storage S3 |

### Datos de farmacia y GS1

| Categoría | Tabla(s) | Retención |
|---|---|---|
| Trazabilidad GS1 EPCIS | `gs1.epcis_event` | 10 años (RTCA) |
| Administraciones BCMA | `"MedicationAdministration"` | 10 años |
| Reservas lógicas vencidas | `gs1.reservation` | 3 años post-expiración |

---

## 2. Política de purge (eliminación definitiva)

### Regla general
Los datos clínicos **no se eliminan nunca** del sistema de producción. Se marcan como archivados con `archived_at` pero permanecen en BD para cumplir TDR §6.3.

### Excepciones: datos de soporte técnico
Los siguientes datos sí pueden purgarse tras el período de retención:

```sql
-- Purge outbox publicado hace más de 90 días (pg_cron: diario 03:00 CST)
DELETE FROM public.outbox
WHERE published_at IS NOT NULL
  AND published_at < now() - INTERVAL '90 days';

-- Archivo de notificaciones leídas hace más de 1 año
INSERT INTO public.notification_archive
SELECT * FROM public."Notification"
WHERE status = 'READ' AND "updatedAt" < now() - INTERVAL '1 year';

DELETE FROM public."Notification"
WHERE status = 'READ' AND "updatedAt" < now() - INTERVAL '1 year';
```

---

## 3. Reporte de retención (`/api/retencion/report.csv`)

El endpoint `GET /api/retencion/report.csv` genera un CSV con los registros próximos a vencer en los próximos 90 días, invocando `ece.retencion_proximos_vencer()`.

**Autenticación:** Requiere sesión Supabase válida con rol `DIR` o `ADMIN`.

**Formato del CSV:**

```
tabla,id,fecha_vencimiento,descripcion,accion_requerida
ece.documento_instancia,<uuid>,2026-08-01,Expediente paciente X,Revisar renovación
ece.firma_electronica,<uuid>,2026-07-15,Firma Dr. Y post-revocación,Confirmar eliminación
```

**Ejecución manual:**
```bash
curl -H "Authorization: Bearer <TOKEN>" \
  https://<SUPABASE_URL>/api/retencion/report.csv \
  -o retencion_$(date +%Y-%m-%d).csv
```

---

## 4. SLA de respuesta a solicitudes ARCO (LOPD El Salvador)

Las solicitudes de Acceso, Rectificación, Cancelación u Oposición de datos personales se responden según los siguientes plazos:

| Tipo de solicitud | Plazo legal | Plazo interno HIS |
|---|---|---|
| Acceso (ver mis datos) | 30 días hábiles | 15 días hábiles |
| Rectificación (corregir datos) | 30 días hábiles | 20 días hábiles |
| Cancelación (eliminar datos no clínicos) | 30 días hábiles | 20 días hábiles |
| Oposición (uso de datos) | 30 días hábiles | 10 días hábiles |

**Notas:**
- Los datos clínicos **no son cancelables** (NTEC Art. 6 prevalece sobre LOPD para datos de salud).
- La cancelación aplica solo a datos de perfil, preferencias y marketing.
- Toda solicitud ARCO se registra en `audit.audit_log` con `action = 'ARCO_REQUEST'`.

---

## 5. Verificación anual de retención

Cada año (enero) el equipo SRE ejecuta:

1. `GET /api/retencion/report.csv` para el año vigente.
2. Revisión de pg_cron jobs de purge:
   ```sql
   SELECT jobname, schedule, last_run_started_at, last_successful_run
   FROM cron.job
   WHERE jobname LIKE '%purge%' OR jobname LIKE '%archive%' OR jobname LIKE '%retencion%';
   ```
3. Confirmación con DIR/Compliance que las políticas siguen siendo válidas.
4. Actualización de este documento si hay cambios normativos.

---

## 6. Backup y recuperación

Los backups de Supabase se retienen 30 días (Point-in-Time Recovery). Para datos con retención de 10 años, el backup de producción es complementario — la fuente de verdad son los registros en BD.

**RTO (Recovery Time Objective):** 4 horas para datos clínicos críticos.
**RPO (Recovery Point Objective):** 5 minutos (WAL streaming Supabase).

---

## Referencias

- NTEC Art. 6: Retención de expedientes clínicos (10 años mínimo)
- TDR §6.3: Audit log inmutable y hash chain
- LOPD El Salvador (Decreto 594): Derechos ARCO
- `docs/28_infra_runbook.md`: Operaciones de infraestructura y backups
- `docs/15_production_runbook.md`: Runbook de producción general
- `packages/database/sql/05_audit_hash_chain.sql`: Implementación hash chain
