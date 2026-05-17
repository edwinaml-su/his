# @his/bi — BI Semantic Layer (Beta.19b)

Workspace de BI para HIS Avante. Implementa la capa semantica sobre el Gold layer
de `analytics` (Postgres/Supabase), via Cube.dev y dbt snapshots.

**Wave:** Beta.19b | **Owner:** @BID | **ADR:** 0009

---

## Estructura

```
packages/bi/
  cube/
    cube.js              # Configuracion principal Cube.dev
    schema/
      Encounters.js      # Cube fact_encounter (KPIs clinicos)
      LabResults.js      # Cube fact_lab_result (TAT, valores criticos)
      Prescriptions.js   # Cube fact_prescription + dim_drug
      Transfusions.js    # Cube fact_transfusion (hemovigilancia)
      JournalLines.js    # Cube fact_journal_line + dims compartidas
  dbt/
    dbt_project.yml      # Configuracion dbt proyecto his_bi
    snapshots/
      dim_patient_snapshot.sql  # SCD Tipo 2 real via dbt check strategy
    models/
      sources.yml        # Declaracion sources Bronze (public schema)
  README.md              # Este archivo
  package.json
```

---

## Configuracion rapida — Cube.dev

### 1. Variables de entorno

Crear `packages/bi/.env.local` (no commitear):

```env
CUBEJS_DB_HOST=<ref>.supabase.co
CUBEJS_DB_PORT=5432
CUBEJS_DB_NAME=postgres
CUBEJS_DB_USER=bi_reader
CUBEJS_DB_PASS=<password-bi-reader>
CUBEJS_DB_SSL=true
CUBEJS_API_SECRET=<secret-32-chars-random>
CUBEJS_DEV_MODE=true
```

### 2. Iniciar servidor

```bash
cd packages/bi
npm install
npm run cube:dev
# Cube Playground disponible en http://localhost:4000
```

### 3. Validar schema

```bash
npm run cube:validate
```

---

## Configuracion rapida — dbt snapshot

### 1. profiles.yml

Agregar en `~/.dbt/profiles.yml`:

```yaml
his_bi:
  target: dev
  outputs:
    dev:
      type: postgres
      host: <ref>.supabase.co
      port: 5432
      dbname: postgres
      user: service_role    # dbt necesita WRITE en analytics schema
      password: <service-role-password>
      schema: analytics
      sslmode: require
```

### 2. Instalar dbt

```bash
pip install dbt-postgres
```

### 3. Verificar conexion

```bash
cd packages/bi/dbt
dbt debug
```

### 4. Correr snapshot dim_patient

```bash
dbt snapshot --select dim_patient_snapshot
```

Esto crea/actualiza `analytics.dim_patient_snapshot` con versiones SCD Tipo 2.
Primera ejecucion: crea todas las filas con `dbt_valid_to = NULL`.
Ejecuciones siguientes: detecta cambios en `age_band`, `biological_sex`, `is_active`
y crea nuevas versiones cerrando las anteriores con `dbt_valid_to`.

### 5. Verificar resultado

```sql
SELECT patient_id, age_band, biological_sex, dbt_valid_from, dbt_valid_to
FROM analytics.dim_patient_snapshot
WHERE dbt_valid_to IS NULL   -- versiones actuales
ORDER BY patient_id
LIMIT 10;
```

---

## Uso desde Next.js (Beta.19c)

```typescript
// Placeholder — integracion real en Beta.19c
import cubejs from '@cubejs-client/core';

const cubejsApi = cubejs(
  process.env.CUBE_API_TOKEN!,
  { apiUrl: process.env.CUBE_API_URL! }
);

const resultSet = await cubejsApi.load({
  measures: ['Encounters.count', 'Encounters.avgLOSDays'],
  dimensions: ['Encounters.admissionType'],
  timeDimensions: [{
    dimension: 'Encounters.admittedDate',
    granularity: 'month',
  }],
  // organizationId va en el JWT / securityContext
});
```

---

## Monitoreo de refresh

```sql
-- Estado de cada dataset
SELECT * FROM analytics.v_refresh_status ORDER BY dataset;

-- Errores recientes
SELECT dataset, error_msg, run_at
FROM analytics.bi_refresh_log
WHERE status = 'error'
ORDER BY run_at DESC
LIMIT 20;
```

---

## Dependencias SQL (aplicar en orden)

1. `packages/database/sql/48_bi_analytics_schema.sql` — schema + dim_date/org/estab
2. `packages/database/sql/49_bi_rls.sql` — RLS + set_bi_context()
3. `packages/database/sql/50_bi_facts_dims_extended.sql` — 4 dims + 5 facts + refresh_all()
4. `packages/database/sql/51_bi_pg_cron_refresh.sql` — pg_cron jobs + bi_refresh_log
