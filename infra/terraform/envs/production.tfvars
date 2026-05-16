# envs/production.tfvars
# Valores de producción. NO commitear con valores reales.
# Usar junto con: terraform apply -var-file=envs/production.tfvars

environment  = "production"
country_code = "sv"
custom_domain = "sv.avante-his.com"

# Secrets vía TF_VAR_* (GitHub Actions environment "production", required reviewer)
