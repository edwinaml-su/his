variable "repository" {
  description = "Nombre del repositorio GitHub."
  type        = string
}

variable "environment" {
  description = "staging | production"
  type        = string
}

variable "protect_main" {
  description = "Si true, aplica branch protection en main."
  type        = bool
  default     = true
}
