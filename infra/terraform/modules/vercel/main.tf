################################################################################
# modules/vercel/main.tf
# Provisiona el proyecto Vercel y sus env vars.
# Provider: vercel/vercel ~> 1.11
################################################################################

terraform {
  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "~> 1.11"
    }
  }
}

# --------------------------------------------------------------------------- #
# Proyecto Vercel
# --------------------------------------------------------------------------- #

resource "vercel_project" "his" {
  name      = var.project_name
  framework = "nextjs"

  git_repository = {
    type              = "github"
    repo              = "${var.github_owner}/${var.github_repo}"
    production_branch = "main"
  }

  # Alineado con vercel.json actual (apps/web es root del Next.js)
  root_directory   = "apps/web"
  build_command    = "npm run build"
  install_command  = "npm ci && npm run -w @his/database generate"
  output_directory = ".next"

  serverless_function_region = "iad1"
}

# --------------------------------------------------------------------------- #
# Variables de entorno (una por entrada del mapa)
# Las sensibles se marcan como sensitive = true para no aparecer en plan output.
# --------------------------------------------------------------------------- #

resource "vercel_project_environment_variable" "vars" {
  for_each = var.env_vars

  project_id = vercel_project.his.id
  key        = each.key
  value      = each.value.value
  target     = ["production"]
  sensitive  = each.value.sensitive
}

# Replicar variables non-sensitive también a preview/staging
# (las sensitive no se replican a preview por seguridad)
resource "vercel_project_environment_variable" "preview_vars" {
  for_each = { for k, v in var.env_vars : k => v if !v.sensitive }

  project_id = vercel_project.his.id
  key        = each.key
  value      = each.value.value
  target     = ["preview"]
  sensitive  = false
}

# --------------------------------------------------------------------------- #
# Dominio custom
# --------------------------------------------------------------------------- #

resource "vercel_project_domain" "custom" {
  project_id = vercel_project.his.id
  domain     = var.custom_domain
}
