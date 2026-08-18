# scripts/db-init

Montado como `/docker-entrypoint-initdb.d` en el servicio `postgres` de
`docker-compose.yml` (raíz). La imagen oficial `postgres:15-alpine` ejecuta,
en orden alfabético, cualquier `*.sql`, `*.sql.gz` o `*.sh` que encuentre acá
**solo la primera vez** que se crea el volumen `postgres-data` (si el data
directory ya existe, estos scripts no vuelven a correr).

Uso previsto: bootstrap liviano de Postgres local (extensiones tipo
`pgcrypto`/`uuid-ossp`, roles), **no** el flujo de hardening/RLS del proyecto
— ese vive en `packages/database/sql/` y se aplica a Supabase vía SQL Editor
o MCP (ver CLAUDE.md, sección "Layout monorepo").

Directorio vacío por ahora — sin scripts de init aún. Se deja versionado
(con este README) para que Docker no lo cree como carpeta root-owned en el
host al hacer `docker compose up`.
