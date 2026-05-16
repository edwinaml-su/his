variable "project_name" {
  description = "Nombre del proyecto en Vercel."
  type        = string
}

variable "custom_domain" {
  description = "Dominio custom del ambiente."
  type        = string
}

variable "environment" {
  description = "staging | production"
  type        = string
}

variable "github_owner" {
  description = "Owner del repositorio GitHub."
  type        = string
}

variable "github_repo" {
  description = "Nombre del repositorio GitHub."
  type        = string
}

variable "env_vars" {
  description = "Mapa de variables de entorno a inyectar en el proyecto Vercel."
  type = map(object({
    value     = string
    sensitive = bool
  }))
  sensitive = true
}
