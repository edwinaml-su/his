################################################################################
# main.tf — HIS Multipaís · Orquestación de módulos
# Fase 7 · Wave SRE
################################################################################

# Configuración de providers (tokens desde variables sensibles)
provider "vercel" {
  api_token = var.vercel_api_token
  team      = var.vercel_team_id != "" ? var.vercel_team_id : null
}

provider "supabase" {
  access_token = var.supabase_access_token
}

provider "github" {
  token = var.github_token
  owner = var.github_owner
}

# --------------------------------------------------------------------------- #
# Locals — convenciones de nombre
# --------------------------------------------------------------------------- #

locals {
  # Slug único por proyecto + país + ambiente: his-avante-sv-production
  project_slug = "${var.project_name}-${var.country_code}-${var.environment}"

  # Tags comunes (Vercel no soporta tags aún, se usa en GitHub/AWS si aplica)
  common_tags = {
    project     = var.project_name
    environment = var.environment
    country     = var.country_code
    managed_by  = "terraform"
    team        = "sre-avante"
  }
}

# --------------------------------------------------------------------------- #
# Módulo: Supabase
# --------------------------------------------------------------------------- #

module "supabase" {
  source = "./modules/supabase"

  organization_id = var.supabase_organization_id
  project_name    = local.project_slug
  region          = var.supabase_region
  db_password     = var.supabase_db_password
  environment     = var.environment
}

# --------------------------------------------------------------------------- #
# Módulo: Vercel
# --------------------------------------------------------------------------- #

module "vercel" {
  source = "./modules/vercel"

  project_name   = local.project_slug
  custom_domain  = var.custom_domain
  environment    = var.environment
  github_owner   = var.github_owner
  github_repo    = var.github_repository

  # Secrets inyectados como env vars (sensitive — no aparecen en plan output)
  env_vars = {
    DATABASE_URL                  = { value = var.database_url, sensitive = true }
    DIRECT_URL                    = { value = var.direct_url, sensitive = true }
    NEXT_PUBLIC_SUPABASE_URL      = { value = var.next_public_supabase_url, sensitive = false }
    NEXT_PUBLIC_SUPABASE_ANON_KEY = { value = var.next_public_supabase_anon_key, sensitive = true }
    SUPABASE_SERVICE_ROLE_KEY     = { value = var.supabase_service_role_key, sensitive = true }
    SUPABASE_JWT_SECRET           = { value = var.supabase_jwt_secret, sensitive = true }
    AUTH_SECRET                   = { value = var.auth_secret, sensitive = true }
    AUDIT_HASH_SECRET             = { value = var.audit_hash_secret, sensitive = true }
    SENTRY_DSN                    = { value = var.sentry_dsn, sensitive = true }
    NEXT_PUBLIC_SENTRY_DSN        = { value = var.next_public_sentry_dsn, sensitive = true }
    SENTRY_ENVIRONMENT            = { value = var.environment, sensitive = false }
    NEXT_PUBLIC_SENTRY_ENVIRONMENT = { value = var.environment, sensitive = false }
    NEXT_TELEMETRY_DISABLED       = { value = "1", sensitive = false }
  }

  depends_on = [module.supabase]
}

# --------------------------------------------------------------------------- #
# Módulo: GitHub
# --------------------------------------------------------------------------- #

module "github" {
  source = "./modules/github"

  repository  = var.github_repository
  environment = var.environment

  # Protección de rama main: requerir CI verde + 1 review
  protect_main = true
}
