################################################################################
# Variables raíz — HIS Multipaís Terraform
# Valores reales en envs/*.tfvars (NO comitear valores reales)
################################################################################

variable "environment" {
  description = "Nombre del ambiente: staging | production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment debe ser 'staging' o 'production'."
  }
}

variable "project_name" {
  description = "Nombre base del proyecto (slug Vercel / Supabase)"
  type        = string
  default     = "his-avante"
}

variable "country_code" {
  description = "Código de país ISO 3166-1 alpha-2. Multi-país: un workspace TF por país."
  type        = string
  default     = "sv"
  validation {
    condition     = can(regex("^[a-z]{2}$", var.country_code))
    error_message = "country_code debe ser 2 letras minúsculas (ISO 3166-1 alpha-2)."
  }
}

# --------------------------------------------------------------------------- #
# Supabase
# --------------------------------------------------------------------------- #

variable "supabase_access_token" {
  description = "Token de API de Supabase (Management API). Obtener en app.supabase.com/account/tokens."
  type        = string
  sensitive   = true
}

variable "supabase_organization_id" {
  description = "ID de la organización Supabase."
  type        = string
}

variable "supabase_db_password" {
  description = "Password del usuario postgres del proyecto Supabase. Mínimo 16 chars. Rota cada 12 meses."
  type        = string
  sensitive   = true
}

variable "supabase_region" {
  description = "Región Supabase. Para El Salvador usar sa-east-1 (Sao Paulo) — más cercana."
  type        = string
  default     = "sa-east-1"
}

# --------------------------------------------------------------------------- #
# Vercel
# --------------------------------------------------------------------------- #

variable "vercel_api_token" {
  description = "Token API de Vercel. Obtener en vercel.com/account/tokens."
  type        = string
  sensitive   = true
}

variable "vercel_team_id" {
  description = "ID del team en Vercel (si el proyecto está bajo un team). Dejar vacío para accounts personales."
  type        = string
  default     = ""
}

variable "custom_domain" {
  description = "Dominio custom del ambiente. Ej: sv.avante-his.com (production) o staging.avante-his.com."
  type        = string
  # Sin default — forzar especificar por ambiente
}

# --------------------------------------------------------------------------- #
# Secrets de aplicación (se inyectan como env vars en Vercel)
# No tienen valores default — DEBEN existir en *.tfvars o en TF_VAR_* env
# --------------------------------------------------------------------------- #

variable "database_url" {
  description = "DATABASE_URL Supabase pooler (port 6543, transaction mode). Para runtime Vercel."
  type        = string
  sensitive   = true
}

variable "direct_url" {
  description = "DIRECT_URL Supabase (port 5432). Para Prisma migrations."
  type        = string
  sensitive   = true
}

variable "next_public_supabase_url" {
  description = "NEXT_PUBLIC_SUPABASE_URL — URL pública del proyecto Supabase."
  type        = string
}

variable "next_public_supabase_anon_key" {
  description = "NEXT_PUBLIC_SUPABASE_ANON_KEY — llave anon pública."
  type        = string
  sensitive   = true
}

variable "supabase_service_role_key" {
  description = "SUPABASE_SERVICE_ROLE_KEY — server-only, nunca exponer a cliente."
  type        = string
  sensitive   = true
}

variable "supabase_jwt_secret" {
  description = "SUPABASE_JWT_SECRET — para verificar JWTs en backend."
  type        = string
  sensitive   = true
}

variable "auth_secret" {
  description = "AUTH_SECRET — NextAuth sessions secret. Mínimo 32 bytes random."
  type        = string
  sensitive   = true
}

variable "audit_hash_secret" {
  description = "AUDIT_HASH_SECRET — pepper del chain de audit. NUNCA rotar (rompe verificación histórica)."
  type        = string
  sensitive   = true
}

variable "sentry_dsn" {
  description = "SENTRY_DSN — DSN server/edge de Sentry."
  type        = string
  sensitive   = true
  default     = ""
}

variable "next_public_sentry_dsn" {
  description = "NEXT_PUBLIC_SENTRY_DSN — DSN cliente de Sentry."
  type        = string
  sensitive   = true
  default     = ""
}

# --------------------------------------------------------------------------- #
# GitHub
# --------------------------------------------------------------------------- #

variable "github_token" {
  description = "GitHub token con permisos repo + admin:org para branch protection y secrets."
  type        = string
  sensitive   = true
}

variable "github_owner" {
  description = "Owner del repositorio GitHub (user o org)."
  type        = string
  default     = "edwinaml-su"
}

variable "github_repository" {
  description = "Nombre del repositorio GitHub."
  type        = string
  default     = "his"
}
