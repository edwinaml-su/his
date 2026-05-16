terraform {
  required_version = ">= 1.7"

  required_providers {
    # Vercel official provider — estable, soporta projects, domains, env vars
    vercel = {
      source  = "vercel/vercel"
      version = "~> 1.11"
    }

    # Supabase provider — limitado: solo gestiona proyectos y configuración básica.
    # No soporta: branch management, RLS policies, storage buckets, edge functions vía TF.
    # TODO: evaluar https://registry.terraform.io/providers/supabase/supabase cuando salga ≥ 1.0
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.4"
    }

    # GitHub — branch protection, secrets, environments
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }

    # AWS — solo si se usa backend S3 + CloudFront/Route53 custom domain
    # Comentado hasta que se decida backend (TF Cloud vs S3)
    # aws = {
    #   source  = "hashicorp/aws"
    #   version = "~> 5.0"
    # }
  }
}
