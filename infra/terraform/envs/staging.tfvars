# envs/staging.tfvars
# Valores de staging. NO commitear con valores reales.
# Usar junto con: terraform apply -var-file=envs/staging.tfvars

environment  = "staging"
country_code = "sv"
custom_domain = "staging.avante-his.com"

# Los secrets se inyectan vía TF_VAR_* en CI (GitHub Actions secrets)
# o desde un secrets manager (Vault/Doppler) en pipelines automatizados.
# Ejemplo para testing local:
#   export TF_VAR_supabase_access_token="sbp_..."
#   export TF_VAR_vercel_api_token="..."
#   etc.
