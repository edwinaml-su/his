output "project_id" {
  description = "ID del proyecto Supabase."
  value       = supabase_project.his.id
}

output "project_url" {
  description = "URL pública del proyecto Supabase."
  value       = "https://${supabase_project.his.id}.supabase.co"
}

output "anon_key" {
  description = "Llave anon del proyecto (usar como NEXT_PUBLIC_SUPABASE_ANON_KEY)."
  value       = supabase_project.his.anon_key
  sensitive   = true
}
