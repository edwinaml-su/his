variable "organization_id" {
  description = "ID de la organización Supabase."
  type        = string
}

variable "project_name" {
  description = "Nombre del proyecto Supabase."
  type        = string
}

variable "region" {
  description = "Región Supabase."
  type        = string
}

variable "db_password" {
  description = "Password de la base de datos Postgres."
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "staging | production"
  type        = string
}
