# Terraform — HIS Multipaís (esqueleto Fase 7)

> **Estado:** No implementado en MVP. En MVP los recursos se aprovisionan a mano vía dashboards (Supabase, Vercel, GitHub) y el control manual cabe en el alcance.
> Esta carpeta queda preparada para Fase 7 — "Madurez operativa": cuando se introduzcan ambientes adicionales (capacitación, pre-prod) y se requiera reproducibilidad/drift detection.

## Estructura prevista

```
infra/terraform/
├── README.md                 (este archivo)
├── main.tf                   composición de módulos
├── variables.tf              variables raíz
├── outputs.tf                outputs útiles para CI
├── versions.tf               required_providers + versiones pinneadas
├── backend.tf                state remoto (S3 + DynamoDB lock o Terraform Cloud)
├── envs/
│   ├── preview.tfvars
│   ├── staging.tfvars
│   └── production.tfvars
└── modules/
    ├── supabase/             proyecto, DB password rotation, storage buckets, edge functions
    ├── vercel/               project, domains, env vars por env, integración con repo GitHub
    └── github/               branch protection, required checks, secrets de ambiente
```

## Módulos previstos

### `modules/supabase`
**Provider:** `supabase/supabase` (oficial)
**Recursos:**
- `supabase_project` — uno por env (preview compartido, staging, production por país en Fase 7)
- `supabase_branch` — preview branches (Supabase Branching)
- Storage buckets: `patient-documents`, `lab-reports`, `dicom-cache` (privados, RLS-protected)
- Configuración de Auth (providers, MFA enforcement, session duration)

**Inputs clave:**
- `project_name`, `region`, `db_password` (sensitive)
- `pitr_enabled` (Point In Time Recovery — sí en staging/prod)

### `modules/vercel`
**Provider:** `vercel/vercel`
**Recursos:**
- `vercel_project` con `framework = "nextjs"`, `root_directory = "apps/web"`
- `vercel_project_domain` — dominio custom por país (ej. `sv.avante-his.com`)
- `vercel_project_environment_variable` — uno por secret listado en TDR §29.4
- `vercel_deployment_protection` — habilitar para preview/staging

### `modules/github`
**Provider:** `integrations/github`
**Recursos:**
- `github_branch_protection` para `main` y `develop`:
  - `required_status_checks`: ci.yml jobs
  - `required_pull_request_reviews`: 1 reviewer mínimo
  - `enforce_admins`: true en producción
- `github_actions_secret` — los listados en `docs/08_devops.md`
- `github_repository_environment` — preview/staging/production con required reviewers

## State remoto

Pendiente de decidir entre:
- **Terraform Cloud** (free tier, encryption at rest, integración GitHub nativa) — recomendado.
- **S3 + DynamoDB lock** (si AWS ya está en uso para otros workloads).

## Convenciones

- **Plan en PR, apply manual.** Pipeline GitHub Actions corre `terraform plan` en cada PR a `main`; `apply` solo desde `workflow_dispatch` con aprobación.
- **No usar `terraform destroy` contra production.** Eliminar recursos manualmente con runbook.
- **Secrets:** nunca comitear `*.tfvars` con valores reales — usar `*.auto.tfvars` ignorado por git, o leer de Vault/Doppler con `data` sources.

## Trabajo pendiente para Fase 7

- [ ] Escoger backend (TF Cloud vs S3).
- [ ] Definir naming convention de proyectos por país (un proyecto Supabase por país vs. compartido).
- [ ] Implementar módulos en este orden: `github` → `vercel` → `supabase`.
- [ ] Pipeline `.github/workflows/terraform.yml` con `plan` automático + `apply` manual.
- [ ] Importar recursos creados manualmente en MVP (`terraform import`).
- [ ] Documentar runbook de rotación de credenciales (DB password, service role key).
