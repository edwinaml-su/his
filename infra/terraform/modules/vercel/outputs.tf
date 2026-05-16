output "project_id" {
  description = "ID del proyecto Vercel."
  value       = vercel_project.his.id
}

output "deployment_url" {
  description = "URL de producción del proyecto."
  value       = "https://${var.custom_domain}"
}
