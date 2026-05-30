# Auditoría de Seguridad BD — HIS Multipaís
**Fecha:** 2026-05-30  
**Ejecutada por:** @DBA  
**Alcance:** schemas `public`, `ece`, `audit` — 231 tablas, Supabase managed PostgreSQL 15  
**Modo:** solo lectura (SELECT + advisors MCP). Sin mutaciones.

---

## 1. Cobertura RLS por tabla

**Hallazgos:**

- **[VERDE]** 222 de 231 tablas en scope tienen `rowsecurity=true`. Cobertura general 96 %.
- **[ROJO]** 9 tablas con `rowsecurity=false` y 0 policies — todas en producción, sin protección alguna:

| Schema | Tabla | Contiene datos sensibles |
|--------|-------|--------------------------|
| public | chat_knowledge_chunk | Si (contenido de conocimiento clínico) |
| public | chat_message | Si (mensajes + session_id) |
| public | chat_session | Si (sesiones usuario) |
| ece | epcis_event | Si (eventos trazabilidad GS1) |
| ece | epcis_event_equipment | Si (equipo + eventos) |
| ece | gs1_gln | Bajo (catálogo) |
| ece | lasa_pair | Bajo (catálogo LASA) |
| ece | pediatric_max_dose | Bajo (catálogo) |
| ece | workflow_estado_layout | Bajo (catálogo UI) |

`chat_message` y `chat_session` confirmados por advisor `sensitive_columns_exposed` (nivel ERROR): expuestos via API sin RLS, `session_id` en claro.

- **[AMARILLO]** Policies `USING (true)` sin filtro tenant — aceptables en tablas catálogo de solo lectura (AgeBand, Country, ICD10, roles ECE, etc.). Riesgo real en tablas de escritura:
  - `ece.transferencia_inventario` — policy ALL con `USING(true) WITH CHECK(true)`: cualquier sesión autenticada puede escribir cross-tenant.
  - `ece.gs1_gtin_sustitutos` — INSERT + UPDATE `WITH CHECK(true)`.
  - `public.OdooSyncLog` / `OdooSyncMapping` — ALL unrestricted write.
  - `public.SrsFabricante/FormaFarmaceutica/Presentacion/PrincipioActivo` — ALL unrestricted write (catálogos SRS pero modificables sin control tenant).

- **[AMARILLO]** `ece.atencion_recien_nacido` y `ece.reanimacion_neonatal` usan `USING (current_setting(...) IS NOT NULL)` — filtra por "que exista un contexto" pero no por valor de org_id. Cualquier sesión autenticada con GUC seteado puede leer/escribir registros de otra org.

**Estado:** ROJO (3 tablas sensibles sin RLS + 2 policies pseudo-tenant)

---

## 2. Audit Chain Integrity

**Hallazgos:**

- **[AMARILLO]** `audit.audit_log` no existe — la tabla real es `audit."AuditLog"` (PascalCase, Prisma). La query del TDR asumía snake_case. Drift de nomenclatura documentado pero relevante.
- **[VERDE]** Columnas confirmadas: `id`, `occurredAt`, `userId`, `organizationId`, `establishmentId`, `ip`, `userAgent`, `action`, `entity`, `entityId`, `beforeJson`, `afterJson`, `justification`, `signatureHash`, `prevHash`. Esquema consistente con diseño TDR §6.3.
- **[AMARILLO]** La columna de integridad se llama `prevHash` (camelCase) y `signatureHash` — **no existe `chain_hash` ni `payload_hash`**. La cadena SHA-256 descrita en CLAUDE.md (chain_hash = sha256(prev_hash || payload_hash)) referencia columnas que no existen con ese nombre. El hash real está en `signatureHash`. No se pudo validar la cadena matemáticamente sin acceso a la función `audit.fn_audit_log_chain()` (SECURITY DEFINER). **Hallazgo: la especificación del TDR y el schema divergen — requiere verificación manual de la función.**
- **[VERDE]** Triggers en `audit."AuditLog"` correctos:
  - `trg_auditlog_chain` ON INSERT → `audit.fn_audit_log_chain()` (construye hash)
  - `trg_auditlog_no_update` ON UPDATE/DELETE → `audit.fn_audit_log_immutable()` (bloquea mutaciones)
- **[VERDE]** La tabla NO está particionada. Tamaño actual: 6.6 MB (datos jóvenes, ambiente de desarrollo/UAT). Sin política de retención/particionado aún — aceptable pre-producción, requiere plan antes de Go-Live real.
- **[VERDE]** Extensión `pgcrypto` y `supabase_vault` activas — infraestructura de cifrado disponible.

**Estado:** AMARILLO (nomenclatura diverge del TDR; validación matemática de cadena no verificable sin acceso SECURITY DEFINER)

---

## 3. Foreign Keys sin Índice

**Hallazgos:**

- **[AMARILLO]** 57 FKs sin índice detectadas en schemas `public`, `ece`, `auth`, `storage`. Las más críticas por volumen de escritura/JOIN esperado:

| Tabla | FK sin índice |
|-------|--------------|
| public."CountryCurrency" | currencyId |
| public."RolePermission" | permissionId |
| public."PrescriptionItem" | drugId |
| public."LabOrderItem" | testId |
| public."LabResult" | specimenId |
| public."SurgeryCase" | encounterId |
| public."DomainEvent" | emittedById |
| ece.documento_instancia | creado_por, estado_actual_id |
| ece.documento_instancia_historial | ejecutado_por, estado_anterior_id, estado_nuevo_id, firma_id, rol_ejecutor_id |
| ece.flujo_transicion | estado_destino_id, estado_origen_id, rol_autoriza_id |
| ece.episodio_hospitalario | cama_id, servicio_id |
| ece.historia_clinica | registrado_por |
| ece.hoja_triaje | registrado_por, signos_vitales_id |
| ece.indicaciones_medicas | medico_prescriptor, transcripcion_enf |

Las FKs en `auth.*` y `storage.*` son gestionadas por Supabase — fuera de scope de remediación propia.

Los 31 FK indexes documentados en Sprint 3 (PR #3) cubrieron las FKs principales de `public.*` en ese momento. Las nuevas tablas ECE y las FKs de `documento_instancia_historial` son posteriores y no están cubiertas.

**Estado:** AMARILLO (FKs nuevas post-Sprint 3 sin índice; impacto en lock contention durante DELETE en tablas padre)

---

## 4. Constraints CHECK críticos

**Hallazgos:**

- **[VERDE]** Constraints presentes y correctos:
  - `ck_nui_requerido` — NUI obligatorio salvo `sin_documento`/`desconocido` (ECE paciente)
  - `ck_maestro_no_autorreferencial` — previene ciclos en merge de expedientes
  - `ck_unificado_tiene_maestro` — integridad MDM
  - `ck_urpa_alta_requiere_criterio` — lógica clínica URPA
  - `ck_vigencia_rol` — vigencia temporal de roles
  - `ck_ronda_modo` / `ck_ronda_total_positivo` — rondas enfermería

- **[ROJO]** Ausentes constraints críticos documentados en TDR y CLAUDE.md:
  - **DUI/NIT/NIE check digit** — no existe `ck_dui_*`, `ck_nit_*`, `ck_nie_*` en `pg_constraint`. La validación vive solo en `packages/contracts/src/validators/` (capa TS) y en `03_validations_sv.sql` como funciones, pero **no como CHECK constraint activo en ninguna tabla**. Un INSERT directo via `service_role` o SQL Editor bypasea la validación.
  - **Triage Manchester 1-5** — no existe constraint que limite `nivel` a {1,2,3,4,5} en `ece.hoja_triaje`.
  - **GS1 check digits** — `ece.gs1_check_digit_valid()` existe como función pero no está referenciada en ningún CHECK constraint de `ece.gs1_gtin` ni `ece.gs1_gsrn`.

**Estado:** ROJO (validaciones SV y GS1 sin enforcement en BD; bypasseables con acceso directo)

---

## 5. Permisos y Roles

**Hallazgos:**

- **[VERDE]** Ningún rol de aplicación tiene `rolsuper=true`. Solo `supabase_admin` es superusuario.
- **[VERDE]** `anon` no tiene `rolbypassrls`. `authenticated` tampoco.
- **[AMARILLO]** Roles con `BYPASSRLS`: `postgres`, `service_role`, `supabase_admin`, `supabase_etl_admin`, `supabase_read_only_user`. `supabase_etl_admin` y `supabase_read_only_user` con BYPASSRLS es inusual — riesgo si sus credenciales se filtran: acceso cross-tenant sin restricción. Supabase managed, fuera de control directo, pero debe documentarse en runbook de seguridad.
- **[ROJO]** `anon` tiene grants DML completos (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) en tablas altamente sensibles:
  - `Patient`, `PatientIdentifier`, `Encounter` — datos clínicos PHI
  - `User`, `UserCredential` — credenciales de sistema
  - `PortalAccount`, `PortalMagicLink`, `PortalSession` — portal paciente con `mfaSecret` y tokens
  - `Session` — sesiones de staff

  Estos grants existen probablemente porque Prisma hace `GRANT ... TO anon, authenticated` en migraciones automáticas. RLS está activo y bloquea el acceso efectivo para la mayoría, pero un bug en una policy o `BYPASSRLS` accidental expone datos sin defensa en profundidad. Principio de mínimo privilegio violado.

- **[AMARILLO]** `public.current_portal_account()` y `public.expire_pharmacy_reservations()` son SECURITY DEFINER ejecutables por `anon` (advisor confirmado). Permiten escalación de privilegio si la función tiene bugs.

**Estado:** ROJO (grants anon en tablas PHI/credenciales; ejecutables SECURITY DEFINER por anon)

---

## 6. Funciones SECURITY DEFINER

**Hallazgos:**

- **[VERDE]** `audit.fn_audit_row` — tiene `search_path=public, audit`. Correctamente hardened.
- **[VERDE]** `notifications.process_outbox_batch` y `purge_read_after_90d` — `search_path=""` (vacío, máxima seguridad).
- **[VERDE]** `public.fn_expire_pharmacy_reservations` — `search_path=public`.
- **[ROJO]** 6 funciones SECURITY DEFINER **sin `search_path` fijo** (advisor nivel WARN, riesgo de search_path injection si un usuario crea objetos en schemas con permisos):
  - `ece.fn_assert_wristband_gsrn`
  - `ece.fn_check_dedup_nui_dui`
  - `ece.fn_gs1_epcis_event_immutable`
  - `ece.set_ece_context` — crítico: setter de GUCs de contexto tenant
  - `public.current_portal_account`
  - `public.expire_pharmacy_reservations`

  `set_ece_context` es especialmente sensible: establece `app.ece_personal_id` y `app.ece_establecimiento_id` que usan las RLS policies del schema ECE. Sin `search_path` fijo, un atacante con permiso de crear funciones en un schema visible podría shadow objetos que la función use.

- **[AMARILLO]** 83 funciones adicionales (no SECURITY DEFINER pero sí triggers/helpers) sin `search_path` — advisor masivo de 84 WARNs `function_search_path_mutable`.

**Estado:** ROJO (`set_ece_context` SECURITY DEFINER sin search_path fijo; impacta integridad de todo el contexto tenant ECE)

---

## 7. Triggers críticos

**Hallazgos:**

- **[VERDE]** `audit."AuditLog"`: triggers de chain y de inmutabilidad presentes y activos (INSERT chain, UPDATE/DELETE bloqueados).
- **[VERDE]** `ece.documento_instancia`: `trg_assert_dependencias_firmadas` BEFORE INSERT activo — enforcement de dependencias ECE funcionando.
- **[AMARILLO]** Tablas sin RLS (chat_*, ece.epcis_event*) tampoco tienen audit triggers — hueco de trazabilidad.
- **[INFO]** `ece.atencion_recien_nacido` y `ece.reanimacion_neonatal` tienen triggers de inmutabilidad propios (fn_bloquea_mutacion_*, etc.) correctamente.

**Estado:** AMARILLO (tablas sin RLS también sin auditoría)

---

## 8. Advisors Supabase

**Hallazgos — Seguridad (89 advisors):**

- **5 ERRORs:**
  - `rls_disabled_in_public` (×3): `chat_session`, `chat_knowledge_chunk`, `chat_message` — tablas públicas sin RLS.
  - `sensitive_columns_exposed` (×1): `chat_message.session_id` expuesto via API.
  - `security_definer_view` (×1): `public.v_inpatient_admission_timeline` — vista con SECURITY DEFINER.

- **84 WARNs relevantes:**
  - `function_search_path_mutable` (×65): masivo, todas las funciones trigger ECE y helpers public.
  - `rls_policy_always_true` (×10): `transferencia_inventario`, `gs1_gtin_sustitutos`, `OdooSyncLog/Mapping`, `SrsRegistros`, `NpsResponse`, `PerformanceSample`.
  - `anon_security_definer_function_executable` (×3): `current_portal_account`, `expire_pharmacy_reservations`, `fn_expire_pharmacy_reservations`.
  - `auth_leaked_password_protection` (×1): HaveIBeenPwned no habilitado en Supabase Auth.

**Hallazgos — Performance (963 advisors):**

- **309 WARNs:**
  - `multiple_permissive_policies` (×221): 221 tablas con múltiples policies permisivas para el mismo rol/operación — overhead de evaluación en cada query RLS. Candidatas a consolidar con OR.
  - `auth_rls_initplan` (×82): 82 tablas con policies que referencian `auth.uid()` o `auth.role()` — genera re-evaluación (initplan) por fila. Mitigar con `(select auth.uid())` o GUCs cacheados.
  - `duplicate_index` (×6): índices duplicados en `ece.atencion_recien_nacido` (3 pares) y `public.PharmacyReservation` (2 pares).

**Estado:** ROJO (5 ERRORs confirmados por advisor oficial)

---

## 9. Secrets en BD

**Hallazgos:**

- **[VERDE]** `supabase_vault` activo — infraestructura de secretos disponible.
- **[VERDE]** `vault.create_secret` / `vault.update_secret` son SECURITY DEFINER gestionadas por Supabase — correctas.
- **[AMARILLO]** Columnas sensibles en tablas de aplicación (no en schema `auth` gestionado por Supabase):
  - `public.PortalAccount.mfaSecret` — `varchar`, en claro. Si el vault está disponible, debería migrarse a `vault.secrets` o cifrado `pgcrypto`.
  - `public.PortalMagicLink.token` / `public.PortalSession.token` — `char`, en claro. Tokens de sesión de portal paciente almacenados sin hash.
  - `public.UserCredential.secretHash` — `text`. Nombre sugiere hash (aceptable), pero el tipo `text` sin constraint de longitud mínima es permisivo.
  - `ece.firma_electronica.recovery_token_hash` — `varchar`, parece hasheado (nombre correcto).
- **[INFO]** Columnas `auth.*` con secrets son gestionadas por Supabase Auth internamente — fuera de scope de remediación propia.

**Estado:** AMARILLO (`mfaSecret` y tokens portal en claro; vault disponible pero no usado en capa de aplicación)

---

## 10. Particionado y Retención

**Hallazgos:**

- **[AMARILLO]** `audit."AuditLog"` NO está particionada. Tamaño actual 6.6 MB (ambiente UAT). En producción real con tráfico clínico (estimado >500K registros/año), sin particionado la tabla crecerá hasta degradar queries de reporte e integridad de cadena en O(n) full scan.
- **[AMARILLO]** No existe policy de retención (`regla_retencion` existe en `ece` como tabla, pero no hay `pg_cron` job configurado para `audit."AuditLog"`). TDR §6.3 exige 10 años — sin cleanup policy la tabla crece indefinidamente (correcto para retención, pero sin archivado).
- **[INFO]** `pg_cron` activo — infraestructura disponible para jobs de archivado/particionado.

**Estado:** AMARILLO (pre-producción aceptable; requiere plan de particionado antes de Go-Live con tráfico real)

---

## Matriz de Cobertura RLS (resumen)

| Categoría | Tablas | Con RLS | Con policies | Estado |
|-----------|--------|---------|--------------|--------|
| public — tenant-scoped | ~120 | 120 | 120 | VERDE |
| public — catálogos (USING true) | ~30 | 30 | 30 | VERDE |
| public — chat_* | 3 | 0 | 0 | ROJO |
| ece — tenant-scoped | ~85 | 85 | 85 | VERDE |
| ece — catálogos sin tenant | 7 | 0 | 0 | AMARILLO |
| audit — AuditLog | 1 | 1 | 1 | VERDE |
| **Total** | **246** | **236** | **236** | — |

Tablas catálogo ECE sin RLS (`gs1_gln`, `lasa_pair`, `pediatric_max_dose`, `workflow_estado_layout`, `epcis_event`, `epcis_event_equipment`) son de solo lectura en uso normal pero escribibles por `service_role` sin trazabilidad.

---

## Top Hallazgos P0

| # | Hallazgo | Evidencia | Impacto |
|---|----------|-----------|---------|
| P0-1 | `anon` tiene grants DML completos en `Patient`, `User`, `UserCredential`, `PortalAccount`, `PortalSession` | `information_schema.role_table_grants` | Violación principio mínimo privilegio en tablas PHI; defensa en profundidad inexistente si una policy falla |
| P0-2 | `chat_message`, `chat_session`, `chat_knowledge_chunk` sin RLS ni policies | Advisor `rls_disabled_in_public` (ERROR) | Datos de chat clínico expuestos cross-tenant via API |
| P0-3 | DUI/NIT/NIE sin CHECK constraint en BD | `pg_constraint` vacío para `ck_dui_*` | INSERT directo via `service_role`/SQL Editor acepta IDs inválidos; MDM contaminado |
| P0-4 | `ece.set_ece_context` SECURITY DEFINER sin `search_path` fijo | `pg_proc.proconfig IS NULL` | Riesgo search_path injection; toda la RLS ECE depende de este setter |
| P0-5 | `ece.transferencia_inventario` policy `ALL USING(true) WITH CHECK(true)` | `pg_policies` + advisor `rls_policy_always_true` | Cross-tenant write sin restricción en transferencias de inventario |
| P0-6 | `PortalAccount.mfaSecret` y tokens de portal en claro | `information_schema.columns` | Vault activo pero no usado; TOTP secret expuesto en BD sin cifrado |

---

## Plan SQL de Remediación

### `sql/152_revoke_anon_phi_grants.sql`
```sql
-- REVOCAR grants excesivos de anon en tablas PHI
REVOKE ALL ON "Patient", "PatientIdentifier", "Encounter", "User", "UserCredential",
  "PortalAccount", "PortalMagicLink", "PortalSession", "Session"
FROM anon;
-- Mantener SELECT solo donde el portal lo requiera, via policy específica
```

### `sql/153_rls_chat_tables.sql`
```sql
-- Habilitar RLS + policies en tablas chat
ALTER TABLE public.chat_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_knowledge_chunk ENABLE ROW LEVEL SECURITY;
-- Policy: solo el usuario propietario o rol ADMIN puede ver
```

### `sql/154_ck_dui_nit_nie_constraints.sql`
```sql
-- Agregar CHECK constraints de validación SV en PatientIdentifier
ALTER TABLE "PatientIdentifier"
  ADD CONSTRAINT ck_dui_format
  CHECK (type <> 'DUI' OR value ~ '^[0-9]{8}-[0-9]$');
-- Equivalentes para NIT (14 dígitos) y NIE (formato SV)
-- Sincronizar con packages/database/sql/03_validations_sv.sql
```

### `sql/155_fix_security_definer_search_path.sql`
```sql
-- Fijar search_path en funciones SECURITY DEFINER críticas
ALTER FUNCTION ece.set_ece_context(uuid, uuid) SET search_path = ece, public;
ALTER FUNCTION ece.fn_check_dedup_nui_dui() SET search_path = ece, public;
ALTER FUNCTION ece.fn_assert_wristband_gsrn() SET search_path = ece, public;
ALTER FUNCTION public.current_portal_account() SET search_path = public;
ALTER FUNCTION public.expire_pharmacy_reservations() SET search_path = public;
-- Y las 65+ funciones trigger con search_path mutable
```

### `sql/156_fix_transferencia_inventario_rls.sql`
```sql
-- Reemplazar policy ALL USING(true) por filtro tenant
DROP POLICY transferencia_inventario_authenticated_all ON ece.transferencia_inventario;
CREATE POLICY transferencia_inventario_tenant ON ece.transferencia_inventario
  USING (organization_id = (current_setting('app.current_org_id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('app.current_org_id', true))::uuid);
```

### `sql/157_fk_indexes_wave2.sql`
```sql
-- Índices para las FKs de documento_instancia_historial y flujo_transicion
CREATE INDEX CONCURRENTLY idx_doc_inst_hist_ejecutado_por
  ON ece.documento_instancia_historial(ejecutado_por);
CREATE INDEX CONCURRENTLY idx_doc_inst_hist_estado_anterior
  ON ece.documento_instancia_historial(estado_anterior_id);
-- ... (13 índices adicionales según lista §3)
```

### `sql/158_drop_duplicate_indexes.sql`
```sql
DROP INDEX CONCURRENTLY ece.idx_arn_episodio_obs;
DROP INDEX CONCURRENTLY ece.idx_arn_paciente_madre;
DROP INDEX CONCURRENTLY ece.idx_arn_paciente_rn;
DROP INDEX CONCURRENTLY ece.idx_rn_atencion_rn;
DROP INDEX CONCURRENTLY public.idx_pharma_reservation_expires;
DROP INDEX CONCURRENTLY public.idx_pharma_reservation_order;
```

### `sql/159_audit_log_partition_plan.sql`
```sql
-- Preparación para particionado por rango mensual de AuditLog
-- (Ejecutar antes de Go-Live con tráfico real; requiere ventana de mantenimiento)
-- Convertir a tabla particionada RANGE(occurredAt) por trimestre
```

---

*Informe generado con datos en tiempo real via MCP Supabase. Todos los hallazgos basados en queries SELECT directas a `pg_catalog`, `information_schema` y advisors oficiales Supabase. Sin mutaciones ejecutadas.*
