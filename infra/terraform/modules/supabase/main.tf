################################################################################
# modules/supabase/main.tf
# Crea y configura el proyecto Supabase para HIS.
#
# LIMITACIONES DEL PROVIDER supabase/supabase:
# - No gestiona: RLS policies, triggers, extensions, pg_cron jobs.
# - No gestiona: Branching (database branches) — hacerlo desde Supabase MCP.
# - No gestiona: Storage buckets con RLS.
# - Storage, Auth config y Edge Functions se aplican vía SQL migration o MCP.
# Ref: https://registry.terraform.io/providers/supabase/supabase/latest/docs
################################################################################

terraform {
  required_providers {
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.4"
    }
  }
}

# --------------------------------------------------------------------------- #
# Proyecto Supabase
# --------------------------------------------------------------------------- #

resource "supabase_project" "his" {
  organization_id   = var.organization_id
  name              = var.project_name
  database_password = var.db_password
  region            = var.region

  # PITR (Point-In-Time Recovery) — disponible en plan Pro.
  # RPO objetivo: ≤ 15 min (SLO-8 en docs/13_slos_kpis.md)
}

# --------------------------------------------------------------------------- #
# TODO (Fase 7) — recursos no soportados por el provider; aplicar vía SQL/MCP
# --------------------------------------------------------------------------- #

# 1. Storage buckets: patient-documents, lab-reports, dicom-cache
#    → Crear vía Supabase dashboard o SQL:
#      INSERT INTO storage.buckets (id, name, public) VALUES ('patient-documents', 'patient-documents', false);
#
# 2. Auth config: MFA enforcement, session duration, external providers
#    → Supabase dashboard → Auth → Settings
#
# 3. Branching (staging branch):
#    → supabase branches create --experimental (CLI) o Supabase MCP
#    → El provider TF no soporta branches aún (2026-05).
#
# 4. Edge Functions (dispatcher, poller):
#    → mcp__supabase__deploy_edge_function o `supabase functions deploy`
