# 43 — Infraestructura para Nube Privada (Kubernetes self-hosted, sin Supabase)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @SRE — Site Reliability Engineer
**Versión:** 1.0 — 2026-06-24
**Estado:** Advisory / estimación — NO son manifiestos finales.
**Complementa:** `docs/28_infra_runbook.md` (IaC + topología actual Vercel/Supabase), `docs/15_production_runbook.md` (deploy + rollback), `docs/41_runbook_backup_dr.md` (backup/DR).

> Registro de la especificación técnica y la estimación para desplegar **la misma arquitectura del HIS en una nube privada / Kubernetes self-hosted**, bajo el modelo **"App + Postgres puro (sin Supabase)"** elegido por el dueño del producto. Es un escenario de **evaluación**: este documento NO modifica el despliegue actual ni los manifiestos vigentes en `infra/k8s/`.

---

## 0. Alcance y restricciones

- **No toca el despliegue actual.** El entorno productivo vigente (Vercel + Supabase) y los manifiestos `infra/k8s/base`, `overlays/staging`, `overlays/prod` quedan **intactos**. El target privado se materializaría como un **overlay Kustomize aislado y aditivo** (`infra/k8s/overlays/private-cloud/`) que: (a) **agrega** los recursos nuevos (Postgres, pgbouncer, GoTrue, MinIO, Harbor, observabilidad, backups) y (b) **parchea** las variables de entorno de `his-web` (Supabase → servicios internos) en build-time, dejando el `base` byte-por-byte idéntico.
- **Perfil de carga supuesto:** hospital mediano, **100-300 usuarios clínicos concurrentes** (médicos, enfermería, admisión, farmacia), turnos de 8 h con pico de 30 min al inicio de turno.
- **Fuente:** valores de `his-web` anclados a `infra/k8s/base/deployment-web.yaml` + `hpa.yaml`; el resto razonado para el perfil declarado. Donde se asume, se declara.

---

## 1. CAVEAT — Esto NO es un lift-and-shift, es reemplazo de plataforma

Quitar Supabase obliga a reescribir/reemplazar cuatro subsistemas **antes** de que cualquier manifiesto funcione en producción. El trabajo de infraestructura asume que esa reescritura ocurre en paralelo.

| Subsistema | Hoy (Supabase) | Reemplazo self-hosted | Esfuerzo |
|---|---|---|---|
| **Auth** | `supabase.auth.signInWithPassword`, SSO Azure (`auth.identities`), MFA, `resetPassword` → `auth.users.encrypted_password` | **GoTrue self-hosted** (menor delta: misma API y schema `auth.*`) o Keycloak/Authentik (más esfuerzo) | **Alto** |
| **RLS / JWT** | `withTenantContext` demota a rol `authenticated`; policies usan `auth.uid()`/`auth.jwt()` | Crear rol `authenticated` + schema `auth` con `auth.uid()`/`auth.jwt()` leyendo GUCs; reusar `public.set_tenant_context`. **El TS de `rls-context.ts` no cambia.** | Medio |
| **Vault (MFA portal)** | `PortalAccount.mfaSecret` vía `get_portal_mfa_secret()` (SECDEF, `vault.decrypted_secrets`) | **pgsodium** en Postgres 15, o Hashicorp Vault con sidecar | Bajo |
| **Storage** | bucket `ece-documentos-asociados` vía `createSignedUploadUrl` | **MinIO** (S3-compatible); cambia el route handler `api/ece/documento-asociado/signed-url` de `@supabase/supabase-js` a `@aws-sdk/client-s3` | Bajo |

Los manifiestos web actuales cubren ~35 % del trabajo; el 65 % restante es la plataforma de datos y el reemplazo de los servicios gestionados.

---

## 2. Topología de componentes (target)

```
Namespace: his-avante (overlay private-cloud)

Internet / Intranet
   │  LoadBalancer / VIP
   ▼
[ingress-nginx]  ── TLS (cert-manager LE  ó  CA interna)
   │
[his-web x3→10]  Deployment + HPA
   │
[pgbouncer x2]   pool transaction-mode
   │
[postgres-primary] StatefulSet ──streaming repl──► [postgres-standby]
   │
[gotrue x2]   auth self-hosted (schema auth.*)
[minio x1]    object storage S3 (imágenes/archivos médicos)
[harbor]      registry privado de contenedores
[prometheus] [grafana] [loki]   observabilidad
```

| Componente | Tipo K8s | Justificación |
|---|---|---|
| his-web | Deployment | Stateless; HPA para pico de turno |
| ingress-nginx | DaemonSet | Único punto de entrada + TLS. Es el "nginx" frente a la app (no hay nginx aparte dentro del pod — Next.js corre standalone en :3000) |
| pgbouncer | Deployment | Prisma × 3-10 pods agota conexiones de Postgres directo; pool `transaction` |
| postgres-primary | StatefulSet | Estado persistente (PVC) |
| postgres-standby | StatefulSet | Streaming replication; failover → RTO ≤ 4 h. Opcional en v1, recomendado |
| gotrue | Deployment | Reemplazo de Supabase Auth |
| minio | StatefulSet | Reemplazo de Supabase Storage |
| harbor | StatefulSet | Registry privado (reemplaza GHCR en red privada/aire-gapped) |
| prometheus / grafana / loki | StatefulSet / Deployment | Métricas RED + SLOs + logs |

---

## 3. Especificaciones por pod (régimen operativo)

| Componente | Tipo | Réplicas | CPU (req → lim) | Memoria (req → lim) | Disco (PVC) |
|---|---|---|---|---|---|
| his-web (Next.js) | Deployment | 3 (→10 HPA) | 250m → 500m | 256Mi → 512Mi | — efímero |
| ingress-nginx | DaemonSet | 1/nodo | 100m → 500m | 128Mi → 256Mi | — efímero |
| pgbouncer | Deployment | 2 | 100m → 250m | 64Mi → 128Mi | — efímero |
| **postgres-primary** | StatefulSet | 1 | **1000m → 4000m** | **2Gi → 8Gi** | **100 GB data + 20 GB WAL** |
| postgres-standby | StatefulSet | 1 | 500m → 2000m | 1Gi → 4Gi | 100 GB |
| gotrue (auth) | Deployment | 2 | 100m → 250m | 128Mi → 256Mi | — efímero |
| minio (imágenes médicas) | StatefulSet | 1 | 250m → 1000m | 512Mi → 2Gi | 500 GB |
| harbor (registry) | StatefulSet | ~6 | 250m → 500m | 512Mi → 1Gi | 100 GB + 20 GB db |
| prometheus | StatefulSet | 1 | 500m → 1000m | 1Gi → 4Gi | 50 GB |
| grafana | Deployment | 1 | 100m → 250m | 128Mi → 256Mi | 5 GB |
| loki | StatefulSet | 1 | 250m → 500m | 512Mi → 2Gi | 100 GB |

> Los pods stateless (web, nginx, pgbouncer, gotrue) **no reclaman PVC** — usan disco efímero del nodo (imagen + tmp), cubierto por el SSD de sistema del worker.

---

## 4. Base de datos (componente más exigente)

- **Motor:** Postgres 15. `postgres-primary` (StatefulSet) + `postgres-standby` (streaming replication; failover manual o con Patroni → RTO ≤ 4 h).
- **Cómputo primario:** 1 vCPU garantizado / 4 vCPU pico; 2 GB garantizado / 8 GB pico. Amplio porque cada mutación escribe auditoría con cadena de hashes (OLTP + writes de audit).
- **Disco:** 100 GB data + 20 GB WAL. Crece ~10 GB/mes por la cadena de auditoría (retención 10 años, TDR §6.3) → **proyectar ~500 GB a 3 años**. Habilitar expansión de volumen en el StorageClass.
- **pgbouncer obligatorio** delante: `pool_mode=transaction`, `max_client_conn=500`, `default_pool_size=25`.
- **Tuning `postgresql.conf`:** `max_connections=100` (pgbouncer absorbe el resto), `shared_buffers=2GB`, `wal_level=replica`.
- **Inicialización:** schemas `public`/`audit`/`ece` + rol `authenticated` + funciones `auth.uid()`/`auth.jwt()` (stubs que leen GUCs) + `public.set_tenant_context` (ya existe en SQL del repo).
- **Backup:** pgBackRest — base completa semanal + WAL continuo (PITR), retención 13 semanas; `audit_log` es inmutable (no se purga; retención 10 años). Repositorio en almacenamiento externo (NFS o segundo site).

---

## 5. Volúmenes de datos (PVCs)

**StorageClass supuesta:** CSI con replicación — **Longhorn** (bare-metal/on-prem) o **Ceph RBD** (si ya existe Ceph); vSAN CSI si es VMware. `ReadWriteOnce` salvo MinIO distribuido.

| PVC | Componente | Tamaño inicial | Crecimiento | Backup |
|---|---|---|---|---|
| postgres-data | postgres-primary | 100 GB | ~500 GB a 3 años | pgBackRest base + WAL (PITR) |
| postgres-wal | postgres-primary | 20 GB | bajo (se archiva) | archivado a NFS/MinIO |
| postgres-standby-data | postgres-standby | 100 GB | sincronizado | — (es la réplica) |
| minio-data | minio | 500 GB | ~1 TB/año en hospital activo | versionado + snapshot CSI |
| harbor-registry | harbor | 100 GB | ~2 GB/imagen | snapshot CSI semanal |
| harbor-db | harbor | 20 GB | bajo | pg_dump |
| prometheus-data | prometheus | 50 GB | retención 30 d | no crítico |
| loki-data | loki | 100 GB | retención 90 d | no crítico |
| grafana-data | grafana | 5 GB | dashboards en git | no crítico |
| **Total PVC** | | **~1 TB (995 GB)** | | |

> Si se integra PACS/DICOM completo (dcm4chee/Orthanc), `minio-data` se multiplica ×10 → planificación separada.

---

## 6. Almacenamiento de imágenes — dos conceptos distintos

- **(a) Registry de contenedores → Harbor.** Reemplaza `ghcr.io/edwinaml-su/his-web` en red privada/aire-gapped. PVC 100 GB. El paso `docker push` de `.github/workflows/release-image.yml` cambia a `harbor.avante.local/his/his-web`. Incluye Trivy (scan de vulnerabilidades). Los nodos requieren `imagePullSecret` al registry interno.
- **(b) Imágenes/archivos médicos del paciente → MinIO.** Reemplaza Supabase Storage (bucket `ece-documentos-asociados`: PDF, JPEG, TIFF, DICOM). PVC 500 GB. MinIO genera presigned URLs (misma semántica que Supabase). ClusterIP — solo `his-web` lo alcanza.

---

## 7. Ingress / red

```
LoadBalancer/VIP → ingress-nginx (TLS) → Service his-web (ClusterIP) → pods his-web (Next.js standalone :3000)
```

- **No hay nginx adicional** delante de Next.js: el "servidor de aplicación nginx" es el **ingress controller**.
- **TLS:** Opción A — cert-manager + Let's Encrypt (requiere dominio público alcanzable, ya configurado en `infra/k8s/base/ingress.yaml`). Opción B — CA interna (`Issuer` tipo CA) para aire-gapped. Los headers de seguridad (HSTS, X-Frame-Options) ya están en `ingress.yaml`.
- **NetworkPolicy** (requiere CNI Calico/Cilium): his-web→pgbouncer:5432, his-web→gotrue:9999, his-web→minio:9000, pgbouncer→postgres:5432; egress a Internet solo si LE o APIs externas (WHO CIE-11, SRS).

---

## 8. Totales del clúster y hardware

| Métrica | Base (web=3) | Pico HPA (web=10) |
|---|---|---|
| CPU requests | ~5.5 vCPU | ~7.3 vCPU |
| CPU limits | ~15.8 vCPU | ~19.3 vCPU |
| Memoria requests | ~9.6 GiB | ~11.4 GiB |
| Memoria limits | ~29 GiB | ~33 GiB |
| Disco PVC total | ~1 TB | igual |
| Pods activos | ~22 | ~29 |

**Hardware a provisionar:**

```
3 workers      × (8 vCPU / 32 GB RAM / 200 GB SSD sistema)   = 24 vCPU / 96 GB
1 control-plane × (4 vCPU / 16 GB RAM / 100 GB SSD)
+ ~1 TB en almacenamiento de bloques replicado (CSI) para PVCs
```

Deja headroom para tolerar caída de 1 nodo (N-1), rolling updates (maxSurge:1) y burst de HPA. Crecimiento a 300-600 concurrentes: +1-2 workers o subir `his-web` limits a 1000m/1Gi (sin tocar StatefulSets). HA real de control-plane: 3 nodos (quórum etcd); para MVP on-prem, 1 control-plane con backup de etcd es aceptable.

---

## 9. Prerrequisitos del clúster

| Componente | Versión mín. | Notas |
|---|---|---|
| Kubernetes | 1.28+ | EKS/GKE/AKS/RKE2/k3s |
| ingress-nginx | 1.10+ | Helm `ingress-nginx/ingress-nginx` |
| cert-manager | 1.14+ | Helm `jetstack/cert-manager` |
| metrics-server | 0.7+ | Requerido por HPA |
| CNI | Calico / Cilium | Para NetworkPolicy |
| CSI | Longhorn 1.6+ / Ceph CSI 3.x | Provisioning dinámico + expansión de PVC |
| External Secrets Operator / Sealed Secrets | 0.9+ / 0.26+ | Gestión de secretos |
| pgsodium | incluido PG 15 | Reemplazo de Vault MFA |
| pgBackRest | 2.49+ | Backup + PITR (o Barman) |
| Harbor | 2.10+ | Registry + Trivy |
| GoTrue | fork Supabase | Imagen `supabase/gotrue` |
| MinIO | RELEASE.2024+ | Helm `minio/minio` |
| kube-prometheus-stack / Loki | 58+ / 3.x | Observabilidad |

---

## 10. Estimación de tiempo

- **Esfuerzo de ingeniería neto:** ~6-8 semanas-persona.
- **Calendario prudencial (con pruebas + UAT + cutover + buffer):** **~10-13 semanas (≈2.5-3 meses)**. El sistema es clínico (PHI + auditoría + login dual SSO/password): el tiempo de validación/UAT no se comprime aunque el dev sea asistido.

| # | Fase | Esfuerzo | Depende de |
|---|---|---|---|
| 0 | Diseño/decisiones (GoTrue vs Keycloak, CSI, gestor de secretos, plan de datos) | ~1 sem | — |
| 1 | **Auth self-hosted (GoTrue)** — quitar `signInWithPassword`, SSO Azure, MFA, resetPassword | 2-3 sem | Fase 0 — **ruta crítica** |
| 2 | RLS/JWT en Postgres puro (schema `auth`, rol `authenticated`, GUCs) | 1 sem | Postgres arriba |
| 3 | Storage → MinIO (route handler `signed-url`) | 2-3 días | ∥ paralelo |
| 4 | Vault MFA → pgsodium | 1-2 días | ∥ paralelo |
| 5 | Manifiestos K8s nuevos (overlay `private-cloud`) | 1-2 sem | ∥ a Fase 1 |
| 6 | Migración de datos Supabase → Postgres propio (preservar audit chain) | 1 sem | Fases 1-5 |
| 7 | Integración + pruebas (E2E, RLS, login dual, firma, smoke en clúster) | 1-2 sem | Fase 6 |
| 8 | UAT clínico + cutover (DNS) + hipercuidado | 1-2 sem | Fase 7 |

**Ruta crítica:** `Auth (3) → datos (1) → integración (2) → UAT/cutover (2)` ≈ 8 semanas si infra (Fase 5) y los cambios chicos (3, 4) corren en paralelo; el resto del rango es buffer.

**Acelera:** 35 % web ya hecho (`infra/k8s/base` + imagen Docker reusables); GoTrue (no Keycloak) reduce el delta de código.
**Frena:** PACS/DICOM completo, migración de históricos grandes, o elegir Keycloak → +2-4 semanas.
**Supuesto:** 1 dev full-stack + apoyo @SRE/@DBA puntual.

---

## 11. Brecha vs estado actual (checklist — sin escribir manifiestos)

**Ya sirve tal cual (en `infra/k8s/`):** `namespace.yaml`, `deployment-web.yaml`, `service-web.yaml`, `hpa.yaml`, `overlays/prod/pdb.yaml`, `ingress.yaml` (cambiar ClusterIssuer para CA interna), `configmap.yaml`, `secret-template.yaml` (plantilla).

**Falta crear (overlay `private-cloud`):**
- Postgres: StatefulSet primary + standby, Service, PVC data/WAL, ConfigMap (`postgresql.conf`/`pg_hba.conf`), init schemas + rol `authenticated` + `auth.*`, CronJob pgBackRest.
- pgbouncer: Deployment ×2 + ConfigMap (`pgbouncer.ini`) + Service.
- GoTrue: Deployment ×2 + Service + Secret (`GOTRUE_JWT_SECRET`, DB URL, SMTP) + Job de migraciones `auth.*`.
- MinIO: StatefulSet + Services (api/console) + PVC + Secret + Job (crear bucket + versionado).
- Harbor: Helm values + `imagePullSecret` + actualizar `release-image.yml`.
- Secretos: reemplazar keys `SUPABASE_*` por equivalentes self-hosted (`DATABASE_URL`→pgbouncer, `DIRECT_URL`→primary, JWT secret compartido con GoTrue, endpoint MinIO).
- Observabilidad: Helm kube-prometheus-stack + Loki + Promtail + dashboard RED (endpoint `/api/metrics` ya existe).
- Red: NetworkPolicy por componente + PDB para postgres-primary.

---

> **Decisión pendiente (dueño de producto / @AT):** aprobar el modelo "sin Supabase" y la ventana de ~3 meses antes de generar el overlay. Mientras tanto, el entorno actual (Vercel/Supabase, `docs/28_infra_runbook.md`) permanece como producción.
