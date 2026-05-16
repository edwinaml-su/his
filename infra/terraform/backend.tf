# Backend de estado remoto.
# OPCIÓN A: Terraform Cloud (recomendado para equipos pequeños — free tier suficiente)
#   Ventajas: encryption at rest, run history, integración GitHub nativa, sin gestionar S3.
#   Pasos: crear org en app.terraform.io, crear workspace "his-avante-<env>",
#          exportar TF_TOKEN_app_terraform_io antes de `terraform init`.

# terraform {
#   cloud {
#     organization = "avante-his"
#     workspaces {
#       name = "his-avante-production"
#     }
#   }
# }

# OPCIÓN B: S3 + DynamoDB lock (si AWS ya está en uso para otros workloads)
#   Pendiente de crear el bucket y la tabla DynamoDB antes de usar.
#   Bucket: his-avante-tfstate (private, versioning ON, SSE-S3)
#   Tabla DynamoDB: his-avante-tflock (LockID, PAY_PER_REQUEST)

# terraform {
#   backend "s3" {
#     bucket         = "his-avante-tfstate"
#     key            = "production/terraform.tfstate"
#     region         = "us-east-1"
#     encrypt        = true
#     dynamodb_table = "his-avante-tflock"
#   }
# }

# TODO (Fase 7): descomentar la opción elegida y borrar la otra.
# Decisión pendiente: ver infra/terraform/README.md §State remoto.
