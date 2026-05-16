# Terraform — HIS Multipaís

**Estado:** Implementado (Wave SRE · Fase 6). Listo para `terraform plan`. El `apply` contra producción requiere decisión explícita de @SRE Lead + @AE (ver §Recomendación).

**Providers:** `vercel/vercel ~> 1.11`, `supabase/supabase ~> 1.4`, `integrations/github ~> 6.0`

---

## Estructura

```
infra/terraform/
├── versions.tf              required_providers pinneados
├── backend.tf               state remoto (descomentar opción elegida)
├── main.tf                  composición de módulos + providers
├── variables.tf             todas las variables raíz
├── outputs.tf               URLs y IDs post-apply
├── envs/
│   ├── staging.tfvars       valores no-secretos de staging
│   └── production.tfvars    valores no-secretos de producción
└── modules/
    ├── supabase/            proyecto Supabase (crea instancia)
    ├── vercel/              proyecto Vercel + env vars + dominio
    └── github/              branch protection + environments
```

---

## Pre-requisitos

1. Terraform CLI `>= 1.7` instalado (`terraform --version`).
2. Decidir y configurar backend remoto en `backend.tf` (Terraform Cloud recomendado).
3. Tokens disponibles:
   - `TF_VAR_supabase_access_token` — app.supabase.com/account/tokens
   - `TF_VAR_vercel_api_token` — vercel.com/account/tokens
   - `TF_VAR_github_token` — github.com/settings/tokens (scopes: repo, admin:org)
4. Todos los secrets de aplicación (ver `variables.tf` §Secrets de aplicación) disponibles como `TF_VAR_*`.

---

## Flujo normal

```bash
# 1. Inicializar (descarga providers, configura backend)
terraform init

# 2. Plan — solo lectura, no hace cambios
terraform plan -var-file=envs/production.tfvars

# 3. Apply — hace cambios reales (requiere aprobación manual)
terraform apply -var-file=envs/production.tfvars

# 4. Ver outputs (URLs, IDs)
terraform output
```

**Staging:**
```bash
terraform workspace new staging   # si se usan workspaces TF
terraform plan  -var-file=envs/staging.tfvars
terraform apply -var-file=envs/staging.tfvars
```

---

## Pipeline CI/CD (`terraform.yml` — planificado Fase 7)

```
PR a main  →  terraform fmt --check  →  terraform validate  →  terraform plan (auto-comment)
Push main  →  terraform apply (workflow_dispatch, required reviewer "production")
```

Hasta que el pipeline esté implementado, apply es manual desde máquina del operador.

---

## Importar recursos existentes (MVP → IaC)

Los recursos actuales (proyecto Supabase + proyecto Vercel) se crearon manualmente. Para importarlos:

```bash
# Vercel project
terraform import module.vercel.vercel_project.his <VERCEL_PROJECT_ID>

# Supabase project
terraform import module.supabase.supabase_project.his <SUPABASE_PROJECT_ID>
```

Obtener IDs:
- Vercel: `vercel ls` o dashboard → Settings → General → Project ID
- Supabase: dashboard → Project Settings → General → Reference ID

---

## Limitaciones conocidas del provider Supabase

El provider `supabase/supabase` (v1.x, 2026-05) **no soporta**:

| Funcionalidad | Alternativa |
|---|---|
| Database branches (staging branch) | `supabase branches create` CLI o Supabase MCP |
| RLS policies | SQL files en `packages/database/sql/` + MCP apply_migration |
| Storage buckets con RLS | Supabase dashboard o SQL INSERT INTO storage.buckets |
| Edge Functions | `mcp__supabase__deploy_edge_function` o CLI |
| Auth configuration (MFA, providers) | Supabase dashboard |
| pg_cron jobs | SQL directo (`packages/database/sql/31_*.sql`) |

---

## Recomendacion: ¿apply contra prod ya?

**NO aplicar contra el proyecto Supabase de producción existente.** El `supabase_project` crearía un proyecto NUEVO (no importaría el existente hasta hacer `terraform import`). Hacerlo sin importar primero destruiría la configuración actual.

**Secuencia segura:**
1. Hacer `terraform import` de los recursos existentes.
2. Correr `terraform plan` y verificar que el plan es `0 to add, 0 to change, 0 to destroy`.
3. Solo entonces activar el workflow de apply.

Para nuevos ambientes (capacitación, staging limpio) sí se puede aplicar directamente.

---

## No hacer

- `terraform destroy` contra production — solo vía runbook de baja formal.
- Commitear `*.tfvars` con valores reales — usar `TF_VAR_*` o un secrets manager.
- Modificar estado remoto manualmente (`terraform state mv/rm`) sin respaldo previo.
