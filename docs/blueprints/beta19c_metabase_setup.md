# Blueprint Beta.19c — Setup Metabase OSS para HIS Avante

- **Estado:** Runbook operacional (Wave Beta.19c)
- **Fecha:** 2026-05-16
- **Owner:** @SRE + @BID
- **Prerequisito:** Cube.dev corriendo y accesible (Beta.19b); analytics schema con
  facts materializadas; rol `bi_reader` con credenciales en Supabase.

---

## 1. Arquitectura de deployment

```
Internet ──> Vercel (Next.js app) ──iframe──> Metabase OSS
                    |                              |
                    | METABASE_SITE_URL             | Cube.dev REST API
                    |                              | (CUBEJS_API_URL)
                    v                              |
           metabase-jwt.ts                        v
           (firma HS256)              analytics schema (bi_reader)
```

Metabase se ejecuta como servicio separado (no en Vercel). Opciones:

| Opcion | Costo | Cuando usar |
|--------|-------|-------------|
| Docker en VPS/EC2 (esta guia) | ~$20-40/mes | Beta hasta 50 usuarios |
| Metabase Cloud | $85/mes (Starter) | Sin ops; recomendado Go-Live |
| Render.com (Free/Starter) | $0-7/mes | Solo para demo/staging |

---

## 2. Deploy Docker (development/staging)

### 2.1 Requisitos previos

- Docker >= 24
- 2 GB RAM minimos para JVM de Metabase
- Puerto 3001 libre (o el que se configure en `METABASE_SITE_URL`)

### 2.2 docker-compose.yml de referencia

```yaml
version: "3.9"
services:
  metabase:
    image: metabase/metabase:v0.49.0
    container_name: his-metabase
    restart: unless-stopped
    ports:
      - "3001:3000"
    environment:
      MB_DB_TYPE: postgres
      MB_DB_DBNAME: metabase
      MB_DB_PORT: 5432
      MB_DB_USER: metabase_user
      MB_DB_PASS: ${METABASE_DB_PASS}
      MB_DB_HOST: ${METABASE_DB_HOST}
      MB_EMBEDDING_SECRET_KEY: ${METABASE_SECRET_KEY}
      MB_SITE_URL: ${METABASE_SITE_URL}
      JAVA_TOOL_OPTIONS: "-Xmx1g"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 5
```

Metabase requiere su propia base de datos (preferiblemente Postgres separada de
la BD del HIS). Crear una BD `metabase` en Supabase o en un Postgres separado.

### 2.3 Primer arranque

```bash
docker compose up -d
# Esperar ~60 s para que Metabase inicialice la BD
docker logs his-metabase -f
# Navegar a http://localhost:3001 para el wizard de onboarding
```

---

## 3. Conectar Metabase a Cube.dev

### Opcion A — Cube.dev como fuente SQL (recomendada)

Cube.dev expone un endpoint SQL compatible con Postgres via el Cube SQL API.

En Metabase:
1. Settings > Admin > Databases > Add database
2. Tipo: **PostgreSQL**
3. Host: `<CUBEJS_HOST>` (ej. `cube.avante.com.sv`)
4. Puerto: `15432` (puerto SQL de Cube.dev; verificar en `cube.js` config)
5. Database name: cualquier string (Cube ignora este valor)
6. Username: `cubejs`
7. Password: `<CUBEJS_API_SECRET>`
8. SSL: habilitado

Ventaja: Metabase ve las measures y dimensions de Cube como columnas SQL.
Pre-aggregaciones de Cube aplican automaticamente.

### Opcion B — Conexion directa al analytics schema (alternativa)

Solo si Cube.dev no esta disponible. Metabase conecta directamente a Supabase
usando el rol `bi_reader`.

En Metabase:
1. Settings > Admin > Databases > Add database
2. Tipo: **PostgreSQL**
3. Host: `ejacvsgbewcerxtjtwto.supabase.co`
4. Puerto: `5432` (o `6543` para connection pooling)
5. Database: `postgres`
6. Username: `bi_reader`
7. Password: `<BI_READER_PASSWORD>` (desde Supabase Dashboard > Database)
8. Schema: `analytics`
9. SSL: requerido (Supabase siempre SSL)

Limitacion: sin pre-aggregaciones de Cube. Queries mas lentas en vol > 1M filas.

---

## 4. Habilitar embedding firmado

En Metabase: Settings > Admin > Embedding > Enable embedding

```
Embedding secret key: <debe coincidir con METABASE_SECRET_KEY en Vercel>
```

Verificar que la version de Metabase sea >= 0.46. Versiones anteriores no
soportan signed embedding con filtros dinamicos.

---

## 5. Crear los 5 dashboards iniciales

Para cada KPI, crear un dashboard en Metabase y anotar el ID numerico que aparece
en la URL (ej. `http://localhost:3001/dashboard/1` → ID = 1).

### Dashboard K-CLI-01 — Censo de camas

1. New Dashboard > "K-CLI-01 Censo de Camas"
2. Add question > SQL (usando la conexion Cube.dev o analytics):
   ```sql
   SELECT
     estab_name,
     COUNT(*) FILTER (WHERE is_active AND admission_type = 'INPATIENT') AS camas_ocupadas,
     ROUND(
       COUNT(*) FILTER (WHERE is_active AND admission_type = 'INPATIENT') * 100.0 /
       NULLIF(COUNT(*) FILTER (WHERE is_active), 0), 1
     ) AS pct_ocupacion
   FROM analytics.fact_encounter fe
   JOIN analytics.dim_establishment e ON e.estab_sk = fe.estab_sk
   WHERE organization_id = {{organization_id}}
   GROUP BY estab_name ORDER BY pct_ocupacion DESC;
   ```
3. Agregar filtro `organization_id` como Variable de tipo Text.
4. Visualizacion: Row chart (barras horizontales por servicio).
5. Sharing > Embed > Enable for this dashboard.
6. En Embedding settings: marcar `organization_id` como "Locked" (fijado por JWT).
7. Anotar el ID del dashboard → `METABASE_DASHBOARD_K_CLI_01=<id>`.

### Dashboard K-CLI-02 — Length of Stay

Similar al anterior con la query de LOS promedio (ver blueprint beta19c_dashboards.md
KPI K-CLI-02). Visualizacion: Line chart con 2 series (avg_los / median_los).

### Dashboard K-CLI-03 — Triage SLA

Dos number cards (P1 en SLA / P2 en SLA) + trend table 7 dias.
Nota: requiere columna `triage_wait_minutes` en fact_encounter (pendiente Beta.19b).
Mientras tanto: mostrar datos de placeholder o deshabilitar el dashboard.

### Dashboard K-FIN-01 — Revenue mensual

Bar chart agrupado por ledger_kind con filtro de anno/mes.
Solo visible para usuarios con roles financieros (enforcement via JWT payload).

### Dashboard K-OPS-01 — Tasa reaccion transfusional

Number card (porcentaje) + sparkline ultimos 30 dias.
Umbral: linea horizontal en 0.5 % para referencia visual.

---

## 6. Variables de entorno en Vercel

Agregar en Vercel Dashboard > Project > Settings > Environment Variables:

```bash
# URL publica de Metabase (sin trailing slash)
METABASE_SITE_URL=https://bi.avante.com.sv

# Clave simetrica para firmar JWT (debe coincidir con MB_EMBEDDING_SECRET_KEY)
METABASE_SECRET_KEY=<output de: openssl rand -hex 32>

# IDs numericos de cada dashboard (obtener post-setup)
METABASE_DASHBOARD_K_CLI_01=1
METABASE_DASHBOARD_K_CLI_02=2
METABASE_DASHBOARD_K_CLI_03=3
METABASE_DASHBOARD_K_FIN_01=4
METABASE_DASHBOARD_K_OPS_01=5
```

**Entorno:** Production y Preview. No agregar a `.env.local` en git (ya en .gitignore).

---

## 7. Rotacion de METABASE_SECRET_KEY

1. Generar nueva clave: `openssl rand -hex 32`
2. Actualizar `MB_EMBEDDING_SECRET_KEY` en docker-compose y reiniciar Metabase.
3. Actualizar `METABASE_SECRET_KEY` en Vercel > Environment Variables.
4. Hacer redeploy en Vercel (o esperar siguiente deploy automatico).
5. Los tokens anteriores expiran en maximo 5 minutos (TTL del JWT). No hay
   ventana de doble-firma necesaria dado el TTL corto.

**Frecuencia recomendada:** cada 90 dias, o inmediatamente si hay sospecha de
compromiso.

---

## 8. Validacion post-setup

```bash
# 1. Verificar que Metabase responde
curl -f ${METABASE_SITE_URL}/api/health

# 2. Verificar embedding habilitado (debe responder 200, no 403)
curl ${METABASE_SITE_URL}/api/embed/dashboard/<dashboard_id>

# 3. En la app HIS: navegar a /analytics y verificar que los iframes carguen
# Con usuario que tenga rol ADMIN o MEDICAL_DIRECTOR
```

---

## 9. Troubleshooting frecuente

| Sintoma | Causa probable | Solucion |
|---------|---------------|----------|
| iframe muestra "Embedding disabled" | Embedding no habilitado en Metabase admin | Settings > Admin > Embedding > Enable |
| JWT expired error en consola | TTL demasiado corto o clock skew | Verificar hora del servidor Metabase vs Vercel |
| organization_id filter ignored | Filtro no marcado como "Locked" en dashboard | Ir a dashboard > Sharing > Embed > marcar Locked |
| Metabase no conecta a Cube.dev | Puerto SQL de Cube cerrado | Verificar firewall/security group en puerto 15432 |
| iframes vacios sin error | CORS bloqueado | Agregar dominio de Vercel a Metabase > Embedding > Allowed origins |

---

## Referencias

- Metabase Signed Embedding: https://www.metabase.com/docs/latest/embedding/signed-embedding
- Cube.dev SQL API: https://cube.dev/docs/product/apis-integrations/sql-api
- ADR 0009 — BI Medallion Architecture
- `docs/blueprints/beta19c_dashboards.md` — definicion de KPIs
