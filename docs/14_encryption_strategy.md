# 14 — Estrategia de cifrado (US-2.11)

> **Status:** Diseño aprobado. Implementación efectiva diferida a **Sprint 2** detrás del feature flag `ENABLE_COLUMN_ENCRYPTION`.
>
> **Owner:** Equipo Tango — E2 Hardening.
> **Stakeholders:** SRE, DBA, Seguridad, Compliance.
> **Referencias:** TDR §29.4 (Datos sensibles), §29.7 (Cifrado), Ley de Protección de Datos Personales SV (Decreto 39/2024), HIPAA §164.312(a)(2)(iv).

---

## 1. Objetivo

Garantizar que los datos clínicos y de identificación personal (PII / PHI) almacenados en HIS Avante están cifrados en **todas las capas** del ciclo de vida del dato (en tránsito, en reposo y en columnas de aplicación), con un esquema de rotación de llaves auditable y compatible con el modelo multi-país (SV / GT / HN / US-cluster).

## 2. Capas de cifrado

El cifrado es **defense in depth**: cada capa neutraliza un vector distinto. Las tres capas se aplican simultáneamente.

### Capa 1 — TLS 1.3 en tránsito (ACTIVA)

| Aspecto | Detalle |
|---|---|
| Estado | **Operativo desde Sprint 0**. |
| Tecnología | TLS 1.3 obligatorio en Vercel (frontend) y Supabase (Postgres + Storage). |
| Configuración | `vercel.json` define HSTS: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`. |
| Cifrado | AEAD: ChaCha20-Poly1305 / AES-256-GCM. |
| Vector mitigado | MITM, sniffing en redes hostiles (hospital wifi, ISP). |

### Capa 2 — At-rest encryption en disco (ACTIVA)

| Aspecto | Detalle |
|---|---|
| Estado | **Operativo desde el provisionamiento de Supabase** (default del producto, no opt-in). |
| Tecnología | AES-256 transparent disk encryption en los volúmenes EBS (AWS) que usa Supabase para Postgres + storage S3 SSE-S3. |
| Llaves | Gestión transparente por AWS KMS — no exportables, rotación anual automática del CMK. |
| Vector mitigado | Robo físico del disco, descarte indebido de hardware, snapshots filtrados. |
| Limitación | NO protege contra accesos lógicos legítimos: una query con credenciales válidas ve los datos en claro. |

### Capa 3 — Application-level column encryption (NUEVA — esta US)

Cifrado a nivel columna usando **pgsodium** (extensión libsodium para Postgres, ya disponible en Supabase) y **Supabase Vault** (wrapper managed sobre pgsodium con rotación de llaves).

Vector mitigado: **DBA hostil, leak por SQL injection, dump de BD desde backup expuesto, exfiltración por desarrollador con acceso al servicio role**.

---

## 3. Selección de columnas a cifrar

> Criterio: **cifrar lo mínimo viable que aporte protección real sin romper queries críticos**. Cifrar todo es tentador pero rompe búsquedas, joins y rendimiento.

### 3.1 Columnas SÍ cifradas

| Tabla | Columna | Tipo dato | Razón | Pierde-búsqueda? |
|---|---|---|---|---|
| `PatientIdentifier` | `value` | text (DUI, NIT, NIE, Pasaporte) | PII directa, ID gubernamental. Buscar por DUI exacto se reemplaza por `hash + cifrado` (búsqueda por hash determinístico). | Parcial: solo búsqueda exacta por hash, no LIKE. |
| `PatientPhone` | `value` | text (E.164) | PII contacto, alto valor en mercado negro. Search exacto vía hash si necesario. | Parcial. |
| `PatientEmail` | `value` | citext | Igual razonamiento que phone. | Parcial. |
| `PatientAllergy` | `notes` | text libre | Datos clínicos que pueden incluir nombres, condiciones, etc. Solo lectura por roles clínicos. | Sí (texto libre, no hay search structurado). |
| `Encounter` | `notes` | text libre | Notas clínicas sensibles. | Sí. |
| `audit.AuditLog` | `beforeJson`, `afterJson` | jsonb | Snapshots de cambios contienen PII de los pacientes implicados. **Crítico**: si la auditoría leakea, leakeas el sistema entero. | Limitada: pgsodium soporta encrypted JSONB con índices GIN sobre subset. |

### 3.2 Columnas NO cifradas (decisión deliberada)

| Tabla | Columna | Por qué NO |
|---|---|---|
| `Patient.firstName` | text | **Searchable** en triage / búsqueda admisión por nombre parcial (LIKE / pg_trgm). Cifrar rompe la búsqueda más usada del sistema. Mitigación alterna: RLS estricto + auditoría de toda lectura. |
| `Patient.lastName` | text | Igual razón. |
| `Patient.birthDate` | date | Necesario para cálculo edad en triage, índices clínicos, validación cruzada con fecha procedimiento. Cifrar bloquearía rangos. |
| `User.email` | citext | Login lookup en hot path. Cifrarlo rompe `findUnique({ where: { email }})`. Mitigación: hash determinístico ya implícito en citext + RLS. |
| `Bed.code`, `Encounter.id` | identificadores no PII | No son PII. |
| Catálogos (countries, currencies, RolesCatalog) | — | Datos públicos / referencia. |

### 3.3 Columnas en evaluación (decidir Sprint 3+)

- `Patient.address` (JSONB): contiene calle/colonia/distrito. Útil para reportes geográficos. Posible cifrado parcial (solo `street`, dejando `city`/`country` en claro). Diferido por complejidad operativa.
- `Insurance.policyNumber`: relevante si activamos módulo seguros completo.

---

## 4. Implementación pgsodium / Supabase Vault

### 4.1 Tecnología elegida

**pgsodium** sobre **Supabase Vault**.

- pgsodium: extensión Postgres con primitivas de libsodium (XChaCha20-Poly1305, secretbox, sealed boxes).
- Supabase Vault: capa managed que añade rotación, key versioning y políticas RLS sobre los secrets.
- Razón vs. alternativas:
  - vs. **pgcrypto**: pgsodium es modern AEAD; pgcrypto es AES-CBC (no autenticado, vulnerable a padding oracles).
  - vs. **cliente-side (Node + libsodium)**: el cliente no puede ejecutar JOINs sobre datos cifrados. Server-side mantiene el modelo SQL.
  - vs. **AWS KMS + envelope encryption**: añade latencia (red) y costo por API call. Para volumen Avante (esperado < 10M ops/mes) Vault es suficiente.

### 4.2 Schema SQL — ver `packages/database/sql/06_column_encryption.sql`

El archivo es un **stub documentado**: contiene los CREATE EXTENSION, los SECURITY LABEL FOR pgsodium y las funciones wrapper, todo COMENTADO. Activarlo en Sprint 2 implica:

1. Levantar el flag `ENABLE_COLUMN_ENCRYPTION=true` en `.env`.
2. Descomentar el SQL en una migración nueva (`db/migrations/2026XX_enable_pgsodium.sql`).
3. Ejecutar la migración en orden: (a) crear key, (b) `pgsodium.create_key()`, (c) etiquetar columnas, (d) trigger de cifrado/descifrado.

### 4.3 Mecanismo: SECURITY LABEL transparente

pgsodium ofrece dos modos:

- **TCE (Transparent Column Encryption)**: declarativo via `SECURITY LABEL FOR pgsodium ON COLUMN xxx IS 'ENCRYPT WITH KEY ID ... '`. La columna se sustituye por una vista que cifra/descifra al vuelo. Las queries existentes funcionan SIN tocar código aplicación. **Esta es la elección**.
- Functional: explícitamente `pgsodium.crypto_aead_det_encrypt(...)` en cada query. Más control pero invasivo.

Plan: TCE para todas las columnas listadas, con fallback functional para JSONB de auditoría (pgsodium TCE sobre JSONB tiene limitaciones en GIN).

---

## 5. Rotación de llaves

### 5.1 Modelo de jerarquía

```
Root Key (Supabase Vault — managed by AWS KMS)
   └── Key Encryption Key (KEK) por organización
         └── Data Encryption Key (DEK) por columna sensible
              └── Cifra los valores
```

- **Root Key**: rotación automática anual (AWS KMS), no expuesta a la app.
- **KEK por organización**: rotación cada 12 meses o tras incidente. Fácil porque solo re-encripta DEKs (pequeños).
- **DEK por columna**: rotación trimestral planificada. Más costosa (re-encrypt valores), pero acotada a una columna a la vez.

### 5.2 Procedimiento de rotación

1. **Generar nueva DEK** vía `pgsodium.create_key()` con `key_id` versión n+1.
2. **Re-encrypt en background**: job nocturno que lee con DEK_n y reescribe con DEK_(n+1). Usa `UPDATE ... WHERE key_version = n` paginado a 10k filas.
3. **Marcar DEK_n como retired** (no destruir todavía — backups antiguos pueden necesitarla).
4. **GRACE periodo de 90 días** para que backups offline se rotacionen.
5. **Destroy DEK_n** tras grace.

### 5.3 Rotación de emergencia (key compromise)

1. Activar feature flag `EMERGENCY_KEY_ROTATION=true`.
2. Marcar DEK comprometida como `revoked` en Vault.
3. Re-encrypt SÍNCRONO de la columna afectada (lock corto sobre la tabla — aceptable para tablas < 10M rows; para AuditLog usamos rotación particionada por mes).
4. Auditar evento `KEY_ROTATION_EMERGENCY` en `AuditLog` (con la DEK NUEVA, naturalmente).
5. Comunicar a clientes según política Avante de incidentes.

### 5.4 Derivación: AUTH_SECRET vs Vault managed

Considerada y descartada la opción de derivar DEKs desde `AUTH_SECRET` (env var):

| Aspecto | AUTH_SECRET-derived | Supabase Vault (elegida) |
|---|---|---|
| Rotación | Manual, requiere redeploy | Automatizable, sin downtime |
| Custodia | Variable de entorno (visible en Vercel dashboard, logs CI) | AWS KMS (HSM-backed) |
| Audit trail | Deployment logs (escaso) | Vault audit log (completo) |
| Multi-tenant | Una sola clave para todas las orgs | KEK por org natural |
| Compliance | Difícil justificar HIPAA / Ley SV | Justificable |

**Decisión**: Vault. AUTH_SECRET sigue usándose solo para session tokens (no para datos en reposo).

---

## 6. Plan de roll-out (Sprint 2)

| Semana | Hito |
|---|---|
| S2.1 | Migración `pgsodium` activa en staging. Cifrado solo `PatientIdentifier.value`. |
| S2.2 | Cifrado `PatientPhone.value` + `PatientEmail.value`. Métricas de latencia. |
| S2.3 | `PatientAllergy.notes`, `Encounter.notes`. Tests E2E sobre flujo clínico. |
| S2.4 | `audit.AuditLog.beforeJson/afterJson`. Validar performance del audit hash chain. |
| S2.5 | Rotación inicial de DEKs. Documentación SRE definitiva. |
| Producción | Roll-out por org en ventanas de mantenimiento, una a la vez. |

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Performance regresa 2-5x en queries afectadas | Benchmark previo en staging. Aceptable porque las columnas elegidas no están en hot path de búsqueda. |
| Rollback complejo si TCE corrompe datos | Snapshot RDS antes de migración. Re-validación de hash chain de auditoría tras cada batch. |
| Equipo SRE no familiarizado con pgsodium | Runbook detallado + dry-run en staging antes de producción. Capacitación 4h. |
| Backups históricos quedan en claro | Política: backups > 30d se descartan. Backups en grace period se almacenan en bucket separado con KMS distinta. |

## 8. Compliance

- **HIPAA §164.312(a)(2)(iv)**: encryption at rest cumplida por capa 2 + capa 3.
- **HIPAA §164.312(e)(1)**: encryption in transit cumplida por capa 1.
- **Ley SV de Protección de Datos Personales (D.39/2024)**: datos sensibles (Art. 5.k) requieren "medidas de seguridad reforzadas" — la combinación capa 1 + 2 + 3 sobre PII satisface el estándar.
- **Auditoría**: cada acceso a columnas cifradas (`pgsodium.crypto_aead_det_decrypt`) puede loggearse vía trigger en Sprint 3 (no MVP).
