################################################################################
# outputs.tf — HIS Multipaís Terraform
# Valores útiles post-apply para CI/CD y documentación
################################################################################

output "supabase_project_id" {
  description = "ID del proyecto Supabase aprovisionado."
  value       = module.supabase.project_id
}

output "supabase_project_url" {
  description = "URL base del proyecto Supabase (NEXT_PUBLIC_SUPABASE_URL)."
  value       = module.supabase.project_url
}

output "vercel_project_id" {
  description = "ID del proyecto Vercel."
  value       = module.vercel.project_id
}

output "app_url" {
  description = "URL de producción de la aplicación."
  value       = module.vercel.deployment_url
}

output "health_check_url" {
  description = "URL del healthcheck para smoke test post-deploy."
  value       = "${module.vercel.deployment_url}/api/health"
}
