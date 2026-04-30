# 11 — Publicación en GitHub (`edwinaml-su`)

> **Audiencia:** @SRE / Owner del repositorio
> **Estado:** Repositorio local inicializado en `C:\proyecto\HIS` con 6 commits estructurados en rama `main`. Pendiente: crear el repo remoto en GitHub y hacer el primer push.

---

## ⚠️ Aviso de seguridad — credenciales

La cuenta `edwinaml-su` fue compartida con contraseña en texto plano durante la conversación. Antes de publicar:

1. **Cambiar la contraseña inmediatamente** en https://github.com/settings/security
2. **Habilitar 2FA** (TOTP recomendado)
3. **Generar un Personal Access Token (PAT)** o configurar **SSH key** — nunca usar la contraseña directamente con git
4. **Revocar cualquier sesión activa** desde https://github.com/settings/sessions

GitHub deprecó la autenticación con contraseña para `git push` desde 2021. Las opciones reales son PAT o SSH.

---

## Opción A — Personal Access Token (HTTPS)

### 1. Generar el PAT

1. Ir a https://github.com/settings/tokens?type=beta
2. Click **"Generate new token"** → **"Fine-grained personal access token"**
3. Configuración recomendada para este repo:
   - **Token name:** `his-multipais-push`
   - **Expiration:** 90 días (rotar luego)
   - **Resource owner:** `edwinaml-su`
   - **Repository access:** `Only select repositories` → seleccionar `his-multipais` (después de crearlo)
   - **Permissions → Repository:**
     - Contents: **Read and write**
     - Metadata: Read-only (auto)
     - Pull requests: **Read and write**
     - Workflows: **Read and write** (necesario porque vamos a versionar `.github/workflows/`)
4. Generar y **copiar el token inmediatamente** (no se vuelve a mostrar).

### 2. Crear el repositorio en GitHub

```bash
# Vía web: https://github.com/new
#   Owner: edwinaml-su
#   Name: his-multipais
#   Description: Sistema de Información Hospitalaria Multipaís - Inversiones Avante
#   Visibility: Private (recomendado por contener decisiones arquitectónicas y normativas)
#   NO inicializar con README, .gitignore ni LICENSE (ya los tenemos local)
```

O con `gh` CLI (si está instalado):

```bash
gh auth login    # si aún no autenticado
gh repo create edwinaml-su/his-multipais --private --description "Sistema de Información Hospitalaria Multipaís - Inversiones Avante"
```

### 3. Conectar y hacer push

Desde `C:\proyecto\HIS`:

```bash
git remote add origin https://github.com/edwinaml-su/his-multipais.git
git branch -M main          # asegurar nombre main (ya está)
git push -u origin main
```

Cuando pida credenciales:
- **Username:** `edwinaml-su`
- **Password:** *pegar el PAT* (no la contraseña real)

Para no volver a ingresarlo, usar el credential manager de Windows:

```bash
git config --global credential.helper manager
```

---

## Opción B — SSH (recomendada a largo plazo)

### 1. Generar SSH key

```bash
ssh-keygen -t ed25519 -C "emartinez@complejoavante.com" -f ~/.ssh/id_ed25519_avante
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519_avante
```

### 2. Subir la clave pública a GitHub

```bash
cat ~/.ssh/id_ed25519_avante.pub
# Copiar el contenido y pegarlo en:
# https://github.com/settings/keys → "New SSH key"
#   Title: "Avante Workstation Edwin"
#   Key type: Authentication Key
```

### 3. Conectar y push

```bash
git remote add origin git@github.com:edwinaml-su/his-multipais.git
git push -u origin main
```

---

## Configuración recomendada del repositorio

Una vez en GitHub:

### Branch protection (Settings → Branches → Add rule)

Para `main`:
- ✅ Require a pull request before merging
  - ✅ Require approvals (1 mínimo)
- ✅ Require status checks to pass before merging
  - Seleccionar `typecheck`, `lint`, `test`, `build` cuando CI haya corrido la primera vez
- ✅ Require conversation resolution before merging
- ✅ Require signed commits (cuando todos tengan GPG configurado)
- ✅ Include administrators

### Environments (Settings → Environments)

Crear tres environments con secrets segregados:
- `preview` — sin protección, deploy automático en PR
- `staging` — protected branch `main`
- `production` — required reviewers (`@SRE` + `@PO`), wait timer 5 min

### Secrets requeridos por environment

| Secret | Origen | Notas |
|---|---|---|
| `DATABASE_URL` | Supabase pooler URL | PgBouncer transaction mode |
| `DIRECT_URL` | Supabase direct URL | Para `prisma migrate deploy` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase | Pública pero por env |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase | Pública pero por env |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | **Secreto crítico** |
| `AUTH_SECRET` | `openssl rand -base64 32` | Distinto por env |
| `SENTRY_DSN` | Sentry project | |
| `SENTRY_AUTH_TOKEN` | Sentry user → Auth Tokens | Para source maps |
| `VERCEL_TOKEN` | Vercel account | Solo si deploys vía CLI |

Repo-wide (Settings → Secrets and variables → Actions):
- `GITLEAKS_LICENSE` (opcional, para escaneo extendido)

### GitHub Apps recomendadas

- **Vercel** — auto-deploy preview por PR
- **Sentry** — release tracking
- **Dependabot** — actualizaciones de seguridad (`.github/dependabot.yml` ya creable en Fase 1)
- **CodeQL** — análisis estático (workflow opcional)

---

## Verificación post-push

Después del primer `git push`:

1. ✅ Verificar que los 6 commits aparecen en GitHub
2. ✅ Confirmar que `.github/workflows/ci.yml` arrancó automáticamente
3. ✅ Revisar el primer run de `security.yml` (no debería detectar secretos en commits)
4. ✅ Verificar que `.env.example` está versionado pero `.env` / `.env.local` están en `.gitignore`
5. ✅ Configurar branch protection ANTES de invitar colaboradores

---

## Estado del repo local al momento de este documento

```text
$ git log --oneline
7643071 feat(qa,sre,bdd): add test suites, BDD features, CI/CD, Docker, observability
2cd1f06 feat(web): add Next.js 14 App Router app with auth, routes, and tRPC integration
c4d701d feat(packages): add contracts, trpc, ui, config, infrastructure workspaces
c9ace24 feat(database): add Prisma 4NF schema with 58 models + RLS + audit triggers
02da517 docs(arch): add complete architecture documentation for HIS Multipais
7ae5ac3 chore(repo): initialize Turborepo monorepo with Node 20 + npm workspaces

$ git status
On branch main
nothing to commit, working tree clean
```

**Total:** 209 archivos versionados; 0 archivos sensibles; 0 secretos comprometidos.
