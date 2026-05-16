################################################################################
# modules/github/main.tf
# Branch protection + environments para GitHub Actions.
# Provider: integrations/github ~> 6.0
################################################################################

terraform {
  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
}

# --------------------------------------------------------------------------- #
# Branch protection — main
# --------------------------------------------------------------------------- #

resource "github_branch_protection" "main" {
  count = var.protect_main ? 1 : 0

  repository_id = var.repository

  pattern = "main"

  # Requiere que CI pase (typecheck + lint + test + build)
  required_status_checks {
    strict   = true
    contexts = ["Build, Lint, Test, Typecheck"]
  }

  required_pull_request_reviews {
    dismiss_stale_reviews      = true
    require_code_owner_reviews = false
    required_approving_review_count = 1
  }

  enforce_admins          = var.environment == "production"
  allows_force_pushes     = false
  allows_deletions        = false
  require_conversation_resolution = true
}

# --------------------------------------------------------------------------- #
# GitHub Environment — production (requiere reviewer manual antes de deploy DB)
# --------------------------------------------------------------------------- #

resource "github_repository_environment" "production" {
  environment = "production"
  repository  = var.repository

  deployment_branch_policy {
    protected_branches     = true
    custom_branch_policies = false
  }
}

resource "github_repository_environment" "staging" {
  environment = "staging"
  repository  = var.repository
}
