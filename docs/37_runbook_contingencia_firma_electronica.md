# Runbook: Contingencia Firma Electrónica ECE

**HG-25 — Stream G (P2)**
Versión: 1.0 | Fecha: 2026-05-28 | Referencia: NTEC Art. 44, TDR §6.3

---

## Alcance

Este runbook cubre los escenarios de contingencia relacionados con `ece.firma_electronica`. Cuando un profesional de salud no puede firmar documentos ECE por fallo técnico en la infraestructura de firma, se activan los procedimientos aquí descritos.

---

## Escenario 1: PIN bloqueado (failed_attempts >= 5)

**Síntoma:** El profesional recibe error `TOO_MANY_REQUESTS — Firma bloqueada`.

**Diagnóstico:**
```sql
SELECT id, personal_id, failed_attempts, locked_until, revoked_at
FROM ece.firma_electronica
WHERE personal_id = (
  SELECT id FROM ece.personal_salud WHERE his_user_id = '<UUID_USUARIO>'
);
```

**Resolución (DIR o ADMIN):**
```sql
-- Desbloquear firma tras verificación de identidad presencial
UPDATE ece.firma_electronica
SET failed_attempts = 0, locked_until = NULL
WHERE personal_id = (
  SELECT id FROM ece.personal_salud WHERE his_user_id = '<UUID_USUARIO>'
);
```

**Registro obligatorio:** Documentar en `audit.audit_log` con `action = 'UPDATE'`, `entity = 'firma_electronica'`, `justification = 'Desbloqueo manual — verificación presencial por <NOMBRE_DIR>'`.

---

## Escenario 2: Firma revocada

**Síntoma:** Error `FORBIDDEN — La firma electrónica ha sido revocada`.

**Causa posible:** `revoked_at IS NOT NULL` en `ece.firma_electronica`.

**Procedimiento:**

1. Confirmar con DIR que la revocación fue intencional (baja del personal, compromiso de PIN).
2. Si fue error:
```sql
UPDATE ece.firma_electronica
SET revoked_at = NULL
WHERE personal_id = (
  SELECT id FROM ece.personal_salud WHERE his_user_id = '<UUID_USUARIO>'
);
```
3. Si fue intencional: el profesional debe crear una nueva firma vía `/ece/firma/setup`.

---

## Escenario 3: Firma no configurada

**Síntoma:** Error `PRECONDITION_FAILED — Firma electrónica no configurada`.

**Resolución:**
1. El profesional accede a `/ece/firma/setup` y crea su PIN.
2. Si el sistema ECE no está disponible (contingencia total): activar modo contingencia en `/admin/contingencia` y usar formularios en papel (ver Runbook Contingencia Workflow `docs/38_runbook_contingencia_workflow.md`).

---

## Escenario 4: Tabla `ece.firma_electronica` inaccesible

**Síntoma:** Timeouts o error `INTERNAL_SERVER_ERROR` en cualquier acto de firma.

**Diagnóstico Supabase:**
```sql
SELECT schemaname, tablename, tableowner
FROM pg_tables
WHERE schemaname = 'ece' AND tablename = 'firma_electronica';
```

**Acciones:**
1. Verificar logs Supabase → `get_logs` (tipo `postgres`).
2. Si el problema es de bloqueos (deadlock):
```sql
SELECT pid, state, query, wait_event_type, wait_event
FROM pg_stat_activity
WHERE state != 'idle' AND query LIKE '%firma_electronica%';
```
3. Terminar procesos bloqueados si aplica: `SELECT pg_terminate_backend(<pid>);`
4. Si el problema persiste: activar modo contingencia (ver Escenario 5).

---

## Escenario 5: Contingencia total — firma no disponible

Cuando ningún profesional puede firmar documentos ECE:

1. **DIR activa modo contingencia** en `/admin/contingencia`:
   - Motivo: descripción técnica del fallo.
   - Hora estimada de restauración.

2. **Protocolo papel** (NTEC Art. 44):
   - Imprimir formularios desde `/api/contingencia/forms/<tipo>.pdf`.
   - Los formularios papel se firman manualmente con firma manuscrita.
   - Custodiar físicamente en carpeta del episodio.

3. **Digitalización retroactiva** al restaurar el sistema:
   - Ingresar datos del documento en el HIS.
   - En campo "Observaciones" indicar: `CONTINGENCIA: registrado en papel el <FECHA>. Doc físico en <UBICACIÓN>`.
   - El documento se firma electrónicamente como acto de ratificación (no como acto original).

4. **Cierre del período de contingencia:**
   - DIR desactiva el modo en `/admin/contingencia`.
   - Registrar en `audit.audit_log` todos los documentos digitalizados retroactivamente.

---

## Escenario 6: Hash chain roto en audit_log

**Síntoma:** `auditIntegrity.verify` retorna `{ broken: true }`.

**Diagnóstico:**
```sql
-- Identificar la primera ruptura en la cadena
SELECT id, table_name, occurred_at, prev_hash, chain_hash,
       LAG(chain_hash) OVER (PARTITION BY table_name ORDER BY occurred_at) AS expected_prev
FROM audit.audit_log
WHERE table_name = 'firma_electronica'
ORDER BY occurred_at
LIMIT 100;
```

**Importante:** Una ruptura de hash chain NO se repara modificando datos — eso viola TDR §6.3. Se documenta como hallazgo de seguridad y se escala a `@SRE` + `@AE` para análisis forense.

---

## Contactos de escalada

| Nivel | Quién | Cuándo |
|---|---|---|
| N1 | Administrador del sistema HIS | Bloqueo de PIN, firma no configurada |
| N2 | DIR del establecimiento | Revocación, desbloqueo manual |
| N3 | SRE (Avante DTD) | Tabla inaccesible, contingencia total |
| N4 | AE + Seguridad | Hash chain roto, compromiso de firma |

---

## Referencias

- NTEC Art. 42: Rectificaciones y firma electrónica
- NTEC Art. 44: Protocolo de contingencia operativa
- TDR §6.3: Audit log e inmutabilidad criptográfica
- `docs/30_runbook_firma_workflow_ece.md`: Runbook general de firma ECE
- `docs/38_runbook_contingencia_workflow.md`: Contingencia motor workflow
